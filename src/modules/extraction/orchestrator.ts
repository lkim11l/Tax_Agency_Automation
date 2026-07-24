import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin.server";

import {
  EXTRACTION_MODEL,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_PROVIDER,
  EXTRACTION_SCHEMA_VERSION,
  MAX_EXTRACTION_INPUT_CHARACTERS,
} from "./constants";
import { ExtractionError, toSafeExtractionError } from "./errors";
import { extractWithOpenAi } from "./openai-provider.server";
import {
  chunkFragments,
  createExtractionFingerprint,
  findDeterministicCandidates,
  formatCandidates,
  formatFragments,
  selectRelevantFragments,
} from "./preprocessing";
import { applyDerivedFieldRules } from "./authority";
import {
  enforceSourceAttribution,
  mergeExtractions,
  serializeConflicts,
  serializeFields,
} from "./processing";
import { buildExtractionInput, extractionSystemPrompt } from "./prompt";
import {
  loadExtractionSources,
  loadCurrentExtraction,
  resolveExtractionInitiator,
} from "./repository";
import type { ExtractionRunResult } from "./types";

type BeginResult = {
  run_id: string;
  claimed: boolean;
  cache_hit: boolean;
  run_status: "running" | "completed" | "failed";
};

async function auditRetry(
  supabase: SupabaseClient,
  input: {
    applicationId: string;
    runId: string;
    initiatedBy: string;
    attempt: number;
    errorCode: string;
  },
) {
  const { error } = await supabase.from("audit_events").insert({
    actor_id: input.initiatedBy,
    application_id: input.applicationId,
    entity_type: "extraction_run",
    entity_id: input.runId,
    action: "extraction.retried",
    metadata: {
      application_id: input.applicationId,
      extraction_run_id: input.runId,
      attempt: input.attempt,
      error_code: input.errorCode,
      prompt_version: EXTRACTION_PROMPT_VERSION,
      schema_version: EXTRACTION_SCHEMA_VERSION,
      model: EXTRACTION_MODEL,
    },
  });
  if (error) throw new Error("Unable to record extraction retry.");
}

export async function runExtraction(input: {
  applicationId: string;
  initiatedBy?: string;
  force?: boolean;
  supabase?: SupabaseClient;
  deltaSourceIds?: string[];
}): Promise<ExtractionRunResult> {
  const supabase = input.supabase ?? createAdminClient();
  const initiatedBy =
    input.initiatedBy ?? (await resolveExtractionInitiator(supabase));
  const allSources = await loadExtractionSources(input.applicationId, supabase);
  const requestedSources = input.deltaSourceIds?.length
    ? allSources.filter((source) => input.deltaSourceIds?.includes(source.sourceId))
    : allSources;
  if (requestedSources.length === 0) {
    throw new ExtractionError(
      "NO_ELIGIBLE_SOURCES",
      "No parsed text or email body is available for extraction.",
    );
  }

  const candidates = findDeterministicCandidates(requestedSources);
  const fragments = selectRelevantFragments(requestedSources, candidates);
  const sourceText = formatFragments(fragments);
  const candidateText = formatCandidates(candidates);
  const requestInput = buildExtractionInput({
    deterministicCandidates: candidateText,
    selectedFragments: sourceText,
  });
  if (requestInput.length > MAX_EXTRACTION_INPUT_CHARACTERS + 30_000) {
    throw new ExtractionError(
      "INPUT_TOO_LARGE",
      "Relevant source text exceeds the extraction limit.",
    );
  }

  const fingerprint = createExtractionFingerprint(allSources);
  const begin = await supabase.rpc("begin_extraction_run", {
    p_application_id: input.applicationId,
    p_input_fingerprint: fingerprint,
    p_source_ids: requestedSources.map((source) => source.sourceId),
    p_provider: EXTRACTION_PROVIDER,
    p_model: EXTRACTION_MODEL,
    p_prompt_version: EXTRACTION_PROMPT_VERSION,
    p_schema_version: EXTRACTION_SCHEMA_VERSION,
    p_input_character_count: requestInput.length,
    p_initiated_by: initiatedBy,
    p_force: input.force ?? false,
  });
  if (begin.error) throw new Error(`Unable to start extraction: ${begin.error.message}`);
  const claim = (Array.isArray(begin.data) ? begin.data[0] : begin.data) as
    | BeginResult
    | null;
  if (!claim) throw new Error("Extraction claim returned no result.");
  if (claim.cache_hit) {
    const cached = await supabase
      .from("extraction_runs")
      .select("input_character_count,input_token_count,output_token_count,conflict_count")
      .eq("id", claim.run_id)
      .single();
    return {
      runId: claim.run_id,
      status: "cache_hit",
      cacheHit: true,
      inputCharacters: cached.data?.input_character_count ?? requestInput.length,
      inputTokens: cached.data?.input_token_count ?? null,
      outputTokens: cached.data?.output_token_count ?? null,
      conflictCount: cached.data?.conflict_count ?? 0,
    };
  }
  if (!claim.claimed) {
    return {
      runId: claim.run_id,
      status: "already_running",
      cacheHit: false,
      inputCharacters: requestInput.length,
      inputTokens: null,
      outputTokens: null,
      conflictCount: 0,
    };
  }

  const startedAt = Date.now();
  try {
    const chunks = chunkFragments(fragments);
    const partials = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let hasInputUsage = false;
    let hasOutputUsage = false;
    let requestId: string | null = null;
    for (const chunk of chunks) {
      const response = await extractWithOpenAi({
        instructions: extractionSystemPrompt,
        sourceText: buildExtractionInput({
          deterministicCandidates: candidateText,
          selectedFragments: formatFragments(chunk),
        }),
        onRetry: ({ attempt, errorCode }) =>
          auditRetry(supabase, {
            applicationId: input.applicationId,
            runId: claim.run_id,
            initiatedBy,
            attempt,
            errorCode,
          }),
      });
      partials.push(
        enforceSourceAttribution(response.extraction, requestedSources, chunk),
      );
      requestId ??= response.requestId;
      if (response.inputTokens !== null) {
        inputTokens += response.inputTokens;
        hasInputUsage = true;
      }
      if (response.outputTokens !== null) {
        outputTokens += response.outputTokens;
        hasOutputUsage = true;
      }
    }

    const baseline = input.deltaSourceIds?.length
      ? await loadCurrentExtraction(input.applicationId, supabase)
      : null;
    if (baseline) partials.unshift(baseline);
    const extraction = applyDerivedFieldRules(mergeExtractions(partials, candidates));
    const completed = await supabase.rpc("complete_extraction_run", {
      p_run_id: claim.run_id,
      p_fields: serializeFields(extraction),
      p_conflicts: serializeConflicts(extraction),
      p_request_id: requestId ?? "",
      p_input_token_count: hasInputUsage ? inputTokens : null,
      p_output_token_count: hasOutputUsage ? outputTokens : null,
      p_duration_ms: Date.now() - startedAt,
    });
    if (completed.error) {
      throw new ExtractionError(
        "PERSISTENCE_FAILED",
        "Structured extraction could not be persisted.",
      );
    }
    return {
      runId: claim.run_id,
      status: "completed",
      cacheHit: false,
      inputCharacters: requestInput.length,
      inputTokens: hasInputUsage ? inputTokens : null,
      outputTokens: hasOutputUsage ? outputTokens : null,
      conflictCount: extraction.conflicts.length,
    };
  } catch (error) {
    const safe = toSafeExtractionError(error);
    await supabase.rpc("fail_extraction_run", {
      p_run_id: claim.run_id,
      p_error_code: safe.code,
      p_error_message: safe.message,
      p_duration_ms: Date.now() - startedAt,
    });
    return {
      runId: claim.run_id,
      status: "failed",
      cacheHit: false,
      inputCharacters: requestInput.length,
      inputTokens: null,
      outputTokens: null,
      conflictCount: 0,
      errorCode: safe.code,
    };
  }
}

export async function runPendingExtractions(
  maximum = 100,
  initiatedBy?: string,
  supabase: SupabaseClient = createAdminClient(),
) {
  const { data, error } = await supabase
    .from("applications")
    .select("id,parsed_documents!inner(id,status)")
    .eq("parsed_documents.status", "parsed")
    .order("created_at")
    .limit(maximum);
  if (error) throw new Error(`Unable to list extraction candidates: ${error.message}`);
  const actor = initiatedBy ?? (await resolveExtractionInitiator(supabase));
  const results = [];
  for (const application of data ?? []) {
    results.push(
      await runExtraction({
        applicationId: application.id,
        initiatedBy: actor,
        supabase,
      }),
    );
  }
  return results;
}
