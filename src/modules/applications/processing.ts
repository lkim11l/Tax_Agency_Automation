import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin.server";
import { createDraft, recalculateCompleteness } from "@/modules/clarification/service";
import { parseAttachment } from "@/modules/documents/orchestrator";
import {
  recordSafeFieldAcceptances,
} from "@/modules/extraction/acceptance";
import { runExtraction } from "@/modules/extraction/orchestrator";
import { loadExtractionSources } from "@/modules/extraction/repository";

const APPLICATION_PROCESSOR_VERSION = "application-processor-v3";

type ProcessingStage = {
  status: "pending" | "running" | "completed" | "review_required" | "failed";
  message: string;
};

async function inputFingerprint(applicationId: string, admin: SupabaseClient) {
  const [sources, application] = await Promise.all([
    loadExtractionSources(applicationId, admin),
    admin
      .from("applications")
      .select("contract_template_id")
      .eq("id", applicationId)
      .single(),
  ]);
  if (application.error) throw new Error("Не удалось загрузить заявку.");
  return createHash("sha256")
    .update(JSON.stringify({
      version: APPLICATION_PROCESSOR_VERSION,
      templateId: application.data.contract_template_id,
      sources: sources
        .map((source) => [source.sourceType, source.sourceId, source.checksum])
        .sort(),
    }))
    .digest("hex");
}

async function saveStages(
  runId: string,
  stages: Record<string, ProcessingStage>,
  admin: SupabaseClient,
) {
  const result = await admin
    .from("application_processing_runs")
    .update({ stages })
    .eq("id", runId)
    .eq("status", "running");
  if (result.error) throw new Error("Не удалось сохранить ход обработки.");
}

async function ruleSetForApplication(applicationId: string, admin: SupabaseClient) {
  const application = await admin
    .from("applications")
    .select("contract_template_id")
    .eq("id", applicationId)
    .single();
  if (application.error) throw new Error("Не удалось определить правила комплектности.");
  if (!application.data.contract_template_id) return "standard-contract";
  const template = await admin
    .from("contract_templates")
    .select("required_rule_set")
    .eq("id", application.data.contract_template_id)
    .maybeSingle();
  if (template.error) throw new Error("Не удалось загрузить правила шаблона.");
  return template.data?.required_rule_set || "standard-contract";
}

async function maybeCreateClarification(input: {
  applicationId: string;
  completenessRunId: string;
  hasBlockingFields: boolean;
  actorId: string;
  admin: SupabaseClient;
}) {
  if (!input.hasBlockingFields) return false;
  const existing = await input.admin
    .from("clarification_drafts")
    .select("id")
    .eq("application_id", input.applicationId)
    .eq("completeness_run_id", input.completenessRunId)
    .limit(1);
  if (existing.error) throw new Error("Не удалось проверить черновик уточнения.");
  if (existing.data?.length) return false;
  const inbound = await input.admin
    .from("email_messages")
    .select("sender")
    .eq("application_id", input.applicationId)
    .eq("direction", "inbound")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inbound.error) throw new Error("Не удалось определить адрес получателя.");
  if (!inbound.data?.sender) return false;
  await createDraft({
    applicationId: input.applicationId,
    completenessRunId: input.completenessRunId,
    recipient: inbound.data.sender,
  }, {
    actorId: input.actorId,
    admin: input.admin,
  });
  return true;
}

async function cancelObsoleteClarifications(input: {
  applicationId: string;
  actorId: string;
  admin: SupabaseClient;
}) {
  const active = await input.admin
    .from("clarification_drafts")
    .select("id")
    .eq("application_id", input.applicationId)
    .in("status", ["draft", "awaiting_approval", "approved"]);
  if (active.error) throw new Error("Не удалось проверить черновики уточнения.");
  if (!active.data?.length) return 0;
  const now = new Date().toISOString();
  const ids = active.data.map((draft) => draft.id);
  const cancelled = await input.admin
    .from("clarification_drafts")
    .update({
      status: "cancelled",
      approved_by: null,
      approved_at: null,
      cancelled_at: now,
      updated_at: now,
      updated_by: input.actorId,
    })
    .in("id", ids)
    .in("status", ["draft", "awaiting_approval", "approved"]);
  if (cancelled.error) throw new Error("Не удалось отменить устаревший черновик уточнения.");
  await input.admin.from("audit_events").insert({
    actor_id: input.actorId,
    application_id: input.applicationId,
    entity_type: "application",
    entity_id: input.applicationId,
    action: "clarification.obsolete_drafts_cancelled",
    metadata: { draft_ids: ids, reason: "application_data_complete" },
  });
  return ids.length;
}

export async function processApplication(input: {
  applicationId: string;
  actorId: string;
  admin?: SupabaseClient;
}) {
  const admin = input.admin ?? createAdminClient();
  const fingerprint = await inputFingerprint(input.applicationId, admin);
  const claim = await admin.rpc("claim_application_processing", {
    p_application_id: input.applicationId,
    p_actor_id: input.actorId,
    p_input_fingerprint: fingerprint,
  });
  if (claim.error) throw new Error("Не удалось запустить обработку заявки.");
  const claimData = claim.data as {
    claimed: boolean;
    cache_hit: boolean;
    run_id: string;
    status: string;
  };
  if (!claimData.claimed) {
    return {
      runId: claimData.run_id,
      status: claimData.status,
      cacheHit: claimData.cache_hit,
      claimed: false,
    };
  }

  const stages: Record<string, ProcessingStage> = {
    documents: { status: "pending", message: "Проверяем вложения" },
    extraction: { status: "pending", message: "Анализируем письмо" },
    acceptance: { status: "pending", message: "Проверяем реквизиты" },
    completeness: { status: "pending", message: "Проверяем комплектность" },
    clarification: { status: "pending", message: "Готовим результат" },
  };
  const finish = async (
    status: "completed" | "completed_with_review" | "failed",
    safeErrorCode: string | null,
  ) => {
    const result = await admin
      .from("application_processing_runs")
      .update({
        status,
        stages,
        safe_error_code: safeErrorCode,
        completed_at: new Date().toISOString(),
      })
      .eq("id", claimData.run_id)
      .eq("status", "running");
    if (result.error) throw new Error("Не удалось завершить обработку заявки.");
  };

  try {
    await admin
      .from("applications")
      .update({ status: "processing" })
      .eq("id", input.applicationId)
      .in("status", ["new", "processing", "needs_data_review", "data_complete", "processing_error"]);

    stages.documents.status = "running";
    await saveStages(claimData.run_id, stages, admin);
    const attachments = await admin
      .from("attachments")
      .select("id")
      .eq("application_id", input.applicationId)
      .eq("parse_status", "pending");
    if (attachments.error) throw new Error("Не удалось загрузить список вложений.");
    for (const attachment of attachments.data ?? []) {
      await parseAttachment(attachment.id, admin);
    }
    stages.documents.status = "completed";
    await saveStages(claimData.run_id, stages, admin);

    stages.extraction.status = "running";
    await saveStages(claimData.run_id, stages, admin);
    const extraction = await runExtraction({
      applicationId: input.applicationId,
      initiatedBy: input.actorId,
      supabase: admin,
    });
    if (extraction.status === "failed") throw new Error("Извлечение данных завершилось ошибкой.");
    stages.extraction.status = "completed";
    await saveStages(claimData.run_id, stages, admin);

    stages.acceptance.status = "running";
    await saveStages(claimData.run_id, stages, admin);
    const acceptance = await recordSafeFieldAcceptances({
      applicationId: input.applicationId,
      actorId: input.actorId,
      method: "automatic",
      admin,
    });
    stages.acceptance = {
      status: "completed",
      message: `Автоматически подтверждено: ${acceptance.preview.eligible.length}`,
    };
    await saveStages(claimData.run_id, stages, admin);

    stages.completeness.status = "running";
    await saveStages(claimData.run_id, stages, admin);
    const completeness = await recalculateCompleteness({
      applicationId: input.applicationId,
      ruleSetId: await ruleSetForApplication(input.applicationId, admin),
      initiatedBy: input.actorId,
      admin,
    });
    stages.completeness = {
      status: completeness.ready ? "completed" : "review_required",
      message: completeness.ready
        ? "Данные готовы"
        : `Требуют внимания: ${completeness.fields.filter((field) => field.blocking).length}`,
    };
    await saveStages(claimData.run_id, stages, admin);

    stages.clarification.status = "running";
    await saveStages(claimData.run_id, stages, admin);
    let draftCreated = false;
    if (completeness.ready) {
      await cancelObsoleteClarifications({
        applicationId: input.applicationId,
        actorId: input.actorId,
        admin,
      });
    } else {
      draftCreated = await maybeCreateClarification({
          applicationId: input.applicationId,
          completenessRunId: completeness.runId,
          hasBlockingFields: true,
          actorId: input.actorId,
          admin,
        });
    }
    stages.clarification = {
      status: "completed",
      message: draftCreated
        ? "Создан черновик уточнения — отправка требует одобрения"
        : "Дополнительное уточнение не требуется",
    };

    await admin
      .from("applications")
      .update({ status: completeness.ready ? "data_complete" : "needs_data_review" })
      .eq("id", input.applicationId);
    await finish(completeness.ready ? "completed" : "completed_with_review", null);
    return {
      claimed: true,
      cacheHit: false,
      runId: claimData.run_id,
      status: completeness.ready ? "completed" : "completed_with_review",
      acceptedCount: acceptance.preview.eligible.length,
      reviewCount: acceptance.preview.blocked.length,
      completeness: completeness.percentage,
      ready: completeness.ready,
      clarificationDraftCreated: draftCreated,
    };
  } catch (error) {
    for (const stage of Object.values(stages)) {
      if (stage.status === "running") stage.status = "failed";
    }
    await finish("failed", "APPLICATION_PROCESSING_FAILED");
    await admin
      .from("applications")
      .update({ status: "processing_error" })
      .eq("id", input.applicationId)
      .eq("status", "processing");
    throw error;
  }
}
