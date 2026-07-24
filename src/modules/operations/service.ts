import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin.server";
import { recalculateCompleteness } from "@/modules/clarification/service";
import { parsePendingAttachments } from "@/modules/documents/orchestrator";
import { createEmailProvider } from "@/modules/email/provider";
import { syncMailbox } from "@/modules/email/ingestion";
import { EXTRACTION_MODEL } from "@/modules/extraction/constants";
import { runExtraction } from "@/modules/extraction/orchestrator";
import { resolveExtractionInitiator } from "@/modules/extraction/repository";
import { recordSafeFieldAcceptances } from "@/modules/extraction/acceptance";

import { loadOperationsConfig } from "./config";
import {
  safeFailure,
  type ComponentName,
  type JobTrigger,
  type StageResult,
} from "./domain";
import {
  claimJob,
  finishJob,
  heartbeatJob,
  recordComponentHealth,
} from "./repository";

type StageWork = () => Promise<{ processed?: number; errors?: number } | void>;

async function pause(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stage(
  work: StageWork,
  maximumAttempts: number,
): Promise<StageResult> {
  const started = Date.now();
  let lastFailure = { code: "OPERATION_FAILED", message: "The operation failed safely." };
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const result = await work();
      const errors = result?.errors ?? 0;
      return {
        status: errors > 0 ? "completed_with_errors" : "completed",
        attempts: attempt,
        durationMs: Date.now() - started,
        processed: result?.processed ?? 0,
        errors,
      };
    } catch (error) {
      lastFailure = safeFailure(error);
      if (attempt < maximumAttempts) await pause(500 * 2 ** (attempt - 1));
    }
  }
  return {
    status: "failed",
    attempts: maximumAttempts,
    durationMs: Date.now() - started,
    processed: 0,
    errors: 1,
    safeErrorCode: lastFailure.code,
  };
}

async function healthResult(
  component: ComponentName,
  runId: string,
  admin: SupabaseClient,
  work: () => Promise<void>,
) {
  try {
    await work();
    await recordComponentHealth({
      component,
      status: "healthy",
      runId,
      metadata: {},
    }, admin);
    return { processed: 1, errors: 0 };
  } catch (error) {
    const failure = safeFailure(error);
    await recordComponentHealth({
      component,
      status: "unavailable",
      runId,
      safeErrorCode: failure.code,
      safeErrorMessage: failure.message,
      metadata: {},
    }, admin);
    throw error;
  }
}

async function runAutomaticExtractions(
  maximum: number,
  admin: SupabaseClient,
) {
  const candidates = await admin
    .from("applications")
    .select("id,parsed_documents!inner(id,status)")
    .eq("parsed_documents.status", "parsed")
    .order("updated_at", { ascending: false })
    .limit(maximum);
  if (candidates.error) throw new Error("Unable to list automatic extraction candidates.");
  const initiatedBy = await resolveExtractionInitiator(admin);
  let processed = 0;
  let errors = 0;
  for (const application of candidates.data ?? []) {
    const result = await runExtraction({
      applicationId: application.id,
      initiatedBy,
      supabase: admin,
    });
    processed += 1;
    if (result.status === "failed") {
      errors += 1;
      continue;
    }
    if (!["completed", "cache_hit"].includes(result.status)) continue;
    await recordSafeFieldAcceptances({
      applicationId: application.id,
      actorId: initiatedBy,
      method: "automatic",
      admin,
    });
    const source = await admin.from("applications")
      .select("contract_template_id")
      .eq("id", application.id)
      .single();
    if (source.error) {
      errors += 1;
      continue;
    }
    let ruleSetId = "standard-contract";
    if (source.data.contract_template_id) {
      const template = await admin.from("contract_templates")
        .select("required_rule_set")
        .eq("id", source.data.contract_template_id)
        .maybeSingle();
      if (template.error) {
        errors += 1;
        continue;
      }
      ruleSetId = template.data?.required_rule_set || ruleSetId;
    }
    try {
      await recalculateCompleteness({
        applicationId: application.id,
        ruleSetId,
        initiatedBy,
        admin,
      });
    } catch {
      errors += 1;
    }
  }
  return { processed, errors };
}

async function updateProgress(
  runId: string,
  stages: Record<string, StageResult>,
  admin: SupabaseClient,
) {
  const values = Object.values(stages);
  await heartbeatJob(
    runId,
    stages,
    values.reduce((sum, value) => sum + value.processed, 0),
    values.reduce((sum, value) => sum + value.errors, 0),
    admin,
  );
}

export async function runMailboxPipeline(
  trigger: JobTrigger,
  environment: Record<string, string | undefined> = process.env,
  admin: SupabaseClient = createAdminClient(),
) {
  const config = loadOperationsConfig(environment);
  const claim = await claimJob({
    jobType: "mailbox_pipeline",
    trigger,
    lockTimeoutSeconds: config.lockTimeoutSeconds,
    minimumIntervalSeconds: trigger === "smoke" ? 0 : config.minimumIntervalSeconds,
  }, admin);
  if (!claim.claimed || !claim.run_id) {
    return { claimed: false as const, reason: claim.reason, runId: claim.run_id };
  }
  const runId = claim.run_id;
  const stages: Record<string, StageResult> = {};
  try {
    await recordComponentHealth({
      component: "application", status: "healthy", runId,
      metadata: { environment: config.environmentLabel },
    }, admin);
    await recordComponentHealth({
      component: "background_jobs", status: "healthy", runId, metadata: {},
    }, admin);

    stages.supabase = await stage(
      () => healthResult("supabase", runId, admin, async () => {
        const result = await admin.from("profiles").select("id", { head: true, count: "exact" });
        if (result.error) throw result.error;
      }),
      config.maximumAttempts,
    );
    await updateProgress(runId, stages, admin);

    stages.storage = await stage(
      () => healthResult("storage", runId, admin, async () => {
        const result = await admin.storage.getBucket("email-attachments");
        if (result.error || result.data?.public !== false) {
          throw new Error("Storage unavailable or bucket is not private.");
        }
      }),
      config.maximumAttempts,
    );
    await updateProgress(runId, stages, admin);

    stages.openai = await stage(
      () => healthResult("openai", runId, admin, async () => {
        const apiKey = environment.OPENAI_API_KEY?.trim();
        if (!apiKey) throw new Error("OpenAI authentication is not configured.");
        const client = new OpenAI({ apiKey, timeout: 10_000, maxRetries: 0 });
        await client.models.retrieve(EXTRACTION_MODEL);
      }),
      config.maximumAttempts,
    );
    await updateProgress(runId, stages, admin);

    stages.smtp = await stage(async () => {
      const provider = createEmailProvider();
      try {
        await provider.verifySmtp();
        await recordComponentHealth({
          component: "mailru_smtp", status: "healthy", runId, metadata: {},
        }, admin);
        return { processed: 1, errors: 0 };
      } catch (error) {
        const failure = safeFailure(error);
        await recordComponentHealth({
          component: "mailru_smtp", status: "unavailable", runId,
          safeErrorCode: failure.code, safeErrorMessage: failure.message, metadata: {},
        }, admin);
        throw error;
      } finally {
        await provider.close();
      }
    }, config.maximumAttempts);
    await updateProgress(runId, stages, admin);

    stages.mailbox = await stage(async () => {
      const provider = createEmailProvider();
      try {
        const result = await syncMailbox(provider, admin);
        await recordComponentHealth({
          component: "mailru_imap", status: "healthy", runId, metadata: {},
        }, admin);
        await recordComponentHealth({
          component: "mailbox_sync",
          status: result.errors > 0 ? "degraded" : "healthy",
          runId,
          safeErrorCode: result.errors > 0 ? "MESSAGE_PROCESSING_ERRORS" : null,
          safeErrorMessage: result.errors > 0 ? "Some mailbox messages failed." : null,
          metadata: {
            messages_processed: result.messagesProcessed,
            errors: result.errors,
          },
        }, admin);
        return { processed: result.messagesProcessed, errors: result.errors };
      } catch (error) {
        const failure = safeFailure(error);
        await recordComponentHealth({
          component: "mailru_imap", status: "unavailable", runId,
          safeErrorCode: failure.code, safeErrorMessage: failure.message, metadata: {},
        }, admin);
        await recordComponentHealth({
          component: "mailbox_sync", status: "unavailable", runId,
          safeErrorCode: failure.code, safeErrorMessage: failure.message, metadata: {},
        }, admin);
        throw error;
      } finally {
        await provider.close().catch(() => undefined);
      }
    }, config.maximumAttempts);
    await updateProgress(runId, stages, admin);

    stages.documents = await stage(async () => {
      const results = await parsePendingAttachments(config.documentBatchSize, admin);
      return {
        processed: results.length,
        errors: results.filter((item) =>
          ["failed", "blocked"].includes(item.result.status)
        ).length,
      };
    }, 1);
    await updateProgress(runId, stages, admin);

    stages.extraction = await stage(
      () => runAutomaticExtractions(config.extractionBatchSize, admin),
      1,
    );
    await updateProgress(runId, stages, admin);

    const values = Object.values(stages);
    const errors = values.reduce((sum, value) => sum + value.errors, 0);
    const processed = values.reduce((sum, value) => sum + value.processed, 0);
    const status = errors > 0 ? "completed_with_errors" : "completed";
    await finishJob({
      runId, status, stages, processed, errors,
      safeErrorCode: errors > 0 ? "PIPELINE_PARTIAL_FAILURE" : null,
      safeErrorMessage: errors > 0 ? "One or more pipeline stages require review." : null,
    }, admin);
    return { claimed: true as const, runId, status, stages, processed, errors };
  } catch (error) {
    const failure = safeFailure(error);
    const values = Object.values(stages);
    const processed = values.reduce((sum, value) => sum + value.processed, 0);
    const errors = Math.max(1, values.reduce((sum, value) => sum + value.errors, 0));
    await finishJob({
      runId, status: "failed", stages, processed, errors,
      safeErrorCode: failure.code, safeErrorMessage: failure.message,
    }, admin);
    await recordComponentHealth({
      component: "background_jobs", status: "unavailable", runId,
      safeErrorCode: failure.code, safeErrorMessage: failure.message, metadata: {},
    }, admin);
    throw new Error(failure.message);
  }
}
