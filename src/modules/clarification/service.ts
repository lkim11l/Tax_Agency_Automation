import type { SupabaseClient } from "@supabase/supabase-js";
import { getOperationalContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin.server";
import { changeApplicationStatus } from "@/modules/applications/repository";
import { loadEmailConfig } from "@/modules/email/config";
import { createEmailProvider } from "@/modules/email/provider";

import {
  buildClarificationDraft,
  evaluateCompleteness,
  type CompletenessFieldInput,
} from "./engine";
import { getRuleSet } from "./rules";
import {
  assertRequiredQuestions,
  assertSafeEmailHeaders,
  classifySmtpFailure,
  draftTransition,
  editDraftState,
} from "./workflow";
import { buildCurrentCompletenessFingerprint, resolveAcceptedFieldIds } from "./fingerprint";

export type WorkflowExecution = {
  actorId: string;
  admin: SupabaseClient;
};

async function actor(execution?: WorkflowExecution) {
  if (execution) {
    return { profile: { id: execution.actorId }, admin: execution.admin };
  }
  const context = await getOperationalContext();
  return { ...context, admin: createAdminClient() };
}

async function audit(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    actorId: string | null;
    applicationId: string;
    entityType: string;
    entityId: string;
    action: string;
    metadata?: Record<string, unknown>;
  },
) {
  const result = await admin.from("audit_events").insert({
    actor_id: input.actorId,
    application_id: input.applicationId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    metadata: input.metadata ?? {},
  });
  if (result.error) throw new Error("Unable to write audit event.");
}

export async function recalculateCompleteness(input: {
  applicationId: string;
  ruleSetId: string;
  triggeredByReplyId?: string | null;
  initiatedBy?: string;
  admin?: SupabaseClient;
}) {
  const context = input.initiatedBy && input.admin
    ? { profile: { id: input.initiatedBy }, admin: input.admin }
    : await actor();
  const { profile, admin } = context;
  const [applicationResult, fieldsResult, acceptancesResult] = await Promise.all([
    admin
      .from("applications")
      .select("id,application_number")
      .eq("id", input.applicationId)
      .single(),
    admin
      .from("extracted_fields")
      .select(
        "id,field_name,structured_value,raw_value,source_type,source_id,source_marker,source_excerpt,confidence,requires_review,conflict_detected,manually_corrected",
      )
      .eq("application_id", input.applicationId),
    admin
      .from("extracted_field_acceptances")
      .select("extracted_field_id,value_fingerprint")
      .eq("application_id", input.applicationId),
  ]);
  if (applicationResult.error || fieldsResult.error || acceptancesResult.error) {
    throw new Error("Unable to load completeness inputs.");
  }
  const rawFields = fieldsResult.data ?? [];
  const rawAcceptances = acceptancesResult.data ?? [];
  const acceptedIds = resolveAcceptedFieldIds(rawFields, rawAcceptances);
  const ruleSet = getRuleSet(input.ruleSetId);
  const fields: CompletenessFieldInput[] = rawFields.map((field) => ({
    fieldName: field.field_name,
    value:
      (field.structured_value as Record<string, unknown> | null)?.normalizedValue ??
      field.raw_value,
    sourceType: field.source_type,
    sourceId: field.source_id,
    sourceMarker: field.source_marker,
    sourceExcerpt: field.source_excerpt,
    confidence: field.confidence,
    requiresReview: field.requires_review,
    conflictDetected: field.conflict_detected,
    manuallyCorrected: field.manually_corrected,
    accepted: acceptedIds.has(field.id),
    fieldState:
      (field.structured_value as Record<string, unknown> | null)?.fieldState ===
        "not_applicable" ||
      (field.structured_value as Record<string, unknown> | null)?.fieldState ===
        "system_managed"
        ? ((field.structured_value as Record<string, unknown>).fieldState as
            | "not_applicable"
            | "system_managed")
        : null,
  }));
  const evaluation = evaluateCompleteness(ruleSet, fields);
  // Same helper contract generation eligibility uses — never diverge here.
  const extractionFingerprint = buildCurrentCompletenessFingerprint({
    fields: rawFields,
    acceptances: rawAcceptances,
  });
  const existing = await admin
    .from("completeness_runs")
    .select("id")
    .eq("application_id", input.applicationId)
    .eq("rule_set_id", ruleSet.id)
    .eq("rule_set_version", ruleSet.version)
    .eq("extraction_fingerprint", extractionFingerprint)
    .maybeSingle();
  if (existing.error) throw new Error("Unable to check completeness cache.");
  if (existing.data) {
    return {
      runId: existing.data.id as string,
      applicationNumber: applicationResult.data.application_number as string,
      cacheHit: true,
      ...evaluation,
    };
  }
  const run = await admin
    .from("completeness_runs")
    .insert({
      application_id: input.applicationId,
      rule_set_id: ruleSet.id,
      rule_set_version: ruleSet.version,
      extraction_fingerprint: extractionFingerprint,
      total_count: evaluation.total,
      complete_count: evaluation.complete,
      missing_count: evaluation.missing,
      conflict_count: evaluation.conflicts,
      low_confidence_count: evaluation.lowConfidence,
      review_required_count: evaluation.reviewRequired,
      invalid_count: evaluation.invalid,
      percentage: evaluation.percentage,
      is_blocking: evaluation.blocking,
      is_ready: evaluation.ready,
      triggered_by_reply_id: input.triggeredByReplyId ?? null,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (run.error || !run.data) throw new Error("Unable to persist completeness run.");
  const details = await admin.from("completeness_field_results").insert(
    evaluation.fields.map((field) => ({
      completeness_run_id: run.data.id,
      application_id: input.applicationId,
      field_name: field.fieldName,
      label: field.label,
      question: field.question,
      is_required: field.required,
      status: field.status,
      is_blocking: field.blocking,
      confidence: field.confidence,
      reason: field.reason,
    })),
  );
  if (details.error) throw new Error("Unable to persist completeness details.");
  await audit(admin, {
    actorId: profile.id,
    applicationId: input.applicationId,
    entityType: "completeness_run",
    entityId: run.data.id,
    action: input.triggeredByReplyId
      ? "completeness.recalculated_after_reply"
      : "completeness.calculated",
    metadata: {
      rule_set_id: ruleSet.id,
      rule_set_version: ruleSet.version,
      percentage: evaluation.percentage,
      ready: evaluation.ready,
    },
  });
  return {
    runId: run.data.id as string,
    applicationNumber: applicationResult.data.application_number as string,
    cacheHit: false,
    ...evaluation,
  };
}

export async function createDraft(input: {
  applicationId: string;
  completenessRunId: string;
  recipient: string;
}, execution?: WorkflowExecution) {
  const { profile, admin } = await actor(execution);
  const [application, run, fields] = await Promise.all([
    admin.from("applications").select("application_number").eq("id", input.applicationId).single(),
    admin.from("completeness_runs").select("id,is_ready").eq("id", input.completenessRunId).eq("application_id", input.applicationId).single(),
    admin.from("completeness_field_results").select("field_name,label,question,is_required,status,is_blocking,confidence,reason").eq("completeness_run_id", input.completenessRunId).order("created_at"),
  ]);
  if (application.error || run.error || fields.error) throw new Error("Unable to load draft inputs.");
  const blocking = (fields.data ?? []).filter((field) => field.is_blocking);
  if (blocking.length === 0) throw new Error("No clarification is needed.");
  const body = buildClarificationDraft({
    applicationNumber: application.data.application_number,
    result: {
      total: 0, complete: 0, missing: 0, conflicts: 0, lowConfidence: 0,
      reviewRequired: 0, invalid: 0, percentage: 0, blocking: true, ready: false,
      fields: blocking.map((field) => ({
        fieldName: field.field_name,
        label: field.label,
        question: field.question,
        required: field.is_required,
        status: field.status,
        blocking: field.is_blocking,
        confidence: field.confidence,
        reason: field.reason,
      })),
    },
  });
  const subject = `Уточнение данных по заявке ${application.data.application_number}`;
  assertSafeEmailHeaders(input.recipient, subject);
  await admin.from("clarification_drafts").update({ status: "superseded" }).eq("application_id", input.applicationId).in("status", ["draft", "awaiting_approval", "approved", "send_failed"]);
  const created = await admin.from("clarification_drafts").insert({
    application_id: input.applicationId,
    completeness_run_id: input.completenessRunId,
    recipient: input.recipient.trim().toLowerCase(),
    subject,
    body_text: body,
    created_by: profile.id,
    updated_by: profile.id,
  }).select("id").single();
  if (created.error || !created.data) throw new Error("Unable to create clarification draft.");
  await audit(admin, { actorId: profile.id, applicationId: input.applicationId, entityType: "clarification_draft", entityId: created.data.id, action: "clarification.draft_generated" });
  return created.data.id as string;
}

export async function updateDraft(input: {
  draftId: string;
  recipient: string;
  subject: string;
  bodyText: string;
}, execution?: WorkflowExecution) {
  const { profile, admin } = await actor(execution);
  const current = await admin.from("clarification_drafts").select("application_id,status,version,recipient,subject,body_text").eq("id", input.draftId).single();
  if (current.error || !current.data) throw new Error("Draft not found.");
  if (!["draft", "awaiting_approval", "approved", "send_failed"].includes(current.data.status)) throw new Error("This draft can no longer be edited.");
  const unknownDelivery = await admin
    .from("clarification_send_attempts")
    .select("id")
    .eq("draft_id", input.draftId)
    .eq("status", "delivery_unknown")
    .limit(1);
  if (unknownDelivery.data?.length) {
    throw new Error("Unknown delivery must be reconciled before editing.");
  }
  const contentChanged = current.data.recipient !== input.recipient || current.data.subject !== input.subject || current.data.body_text !== input.bodyText;
  assertSafeEmailHeaders(input.recipient, input.subject);
  const draftRun = await admin
    .from("clarification_drafts")
    .select("completeness_run_id")
    .eq("id", input.draftId)
    .single();
  const questions = await admin
    .from("completeness_field_results")
    .select("question")
    .eq("completeness_run_id", draftRun.data?.completeness_run_id ?? "")
    .eq("is_blocking", true);
  if (draftRun.error || questions.error) throw new Error("Unable to validate required questions.");
  assertRequiredQuestions(
    input.bodyText,
    (questions.data ?? []).map((item) => item.question),
  );
  const editedState = editDraftState({
    status: current.data.status,
    version: current.data.version,
    changed: contentChanged,
  });
  const updated = await admin.from("clarification_drafts").update({
    recipient: input.recipient.trim().toLowerCase(),
    subject: input.subject.trim(),
    body_text: input.bodyText.trim(),
    status: editedState.status,
    version: editedState.version,
    approved_by: contentChanged ? null : undefined,
    approved_at: contentChanged ? null : undefined,
    updated_by: profile.id,
  }).eq("id", input.draftId);
  if (updated.error) throw new Error("Unable to update draft.");
  await audit(admin, { actorId: profile.id, applicationId: current.data.application_id, entityType: "clarification_draft", entityId: input.draftId, action: contentChanged ? "clarification.draft_edited" : "clarification.draft_saved", metadata: { approval_revoked: contentChanged && current.data.status === "approved" } });
}

export async function transitionDraft(
  draftId: string,
  action: "submit" | "approve" | "return" | "cancel",
  execution?: WorkflowExecution,
) {
  const { profile, admin } = await actor(execution);
  const current = await admin.from("clarification_drafts").select("application_id,status").eq("id", draftId).single();
  if (current.error || !current.data) throw new Error("Draft not found.");
  const nextStatus = draftTransition(current.data.status, action);
  const patch: Record<string, unknown> = { status: nextStatus, updated_by: profile.id };
  if (action === "submit") patch.submitted_at = new Date().toISOString();
  if (action === "approve") {
    patch.approved_by = profile.id;
    patch.approved_at = new Date().toISOString();
  }
  if (action === "return") {
    patch.approved_by = null;
    patch.approved_at = null;
    patch.version = undefined;
  }
  if (action === "cancel") patch.cancelled_at = new Date().toISOString();
  delete patch.version;
  const updated = await admin.from("clarification_drafts").update(patch).eq("id", draftId).eq("status", current.data.status).select("id").maybeSingle();
  if (updated.error || !updated.data) throw new Error("Draft changed concurrently; reload and retry.");
  const auditAction = {
    submit: "clarification.submitted_for_approval",
    approve: "clarification.approved",
    return: "clarification.returned_for_revision",
    cancel: "clarification.cancelled",
  }[action];
  await audit(admin, { actorId: profile.id, applicationId: current.data.application_id, entityType: "clarification_draft", entityId: draftId, action: auditAction });
}

export async function sendApprovedDraft(
  draftId: string,
  execution?: WorkflowExecution,
) {
  const { profile, admin } = await actor(execution);
  const draft = await admin.from("clarification_drafts").select("*").eq("id", draftId).single();
  if (draft.error || !draft.data) throw new Error("Draft not found.");
  if (!["approved", "send_failed"].includes(draft.data.status)) throw new Error("Only an approved or safely failed draft can be sent.");
  if (!draft.data.approved_by || !draft.data.approved_at) throw new Error("Approval is required.");
  assertSafeEmailHeaders(draft.data.recipient, draft.data.subject);
  const existingSent = await admin.from("clarification_send_attempts").select("id").eq("draft_id", draftId).in("status", ["sent", "delivery_unknown"]).limit(1);
  if (existingSent.data?.length) throw new Error("This draft has already been sent or has unknown delivery state.");
  const count = await admin.from("clarification_send_attempts").select("id", { count: "exact", head: true }).eq("draft_id", draftId);
  const attemptNumber = (count.count ?? 0) + 1;
  const config = loadEmailConfig();
  const domain = config.from.split("@")[1] ?? "localhost";
  const rfcMessageId = `<taa-clarification-${draftId}-v${draft.data.version}@${domain}>`;
  const attempt = await admin.from("clarification_send_attempts").insert({
    draft_id: draftId,
    application_id: draft.data.application_id,
    attempt_number: attemptNumber,
    idempotency_key: `${draftId}:${draft.data.version}:${attemptNumber}`,
    status: "sending",
    provider: "mailru",
    rfc_message_id: rfcMessageId,
    recipient: draft.data.recipient,
    subject: draft.data.subject,
    body_text: draft.data.body_text,
    created_by: profile.id,
  }).select("id").single();
  if (attempt.error || !attempt.data) throw new Error("A send is already in progress or this version was already attempted.");
  await admin.from("clarification_drafts").update({ status: "sending", updated_by: profile.id }).eq("id", draftId);
  await audit(admin, { actorId: profile.id, applicationId: draft.data.application_id, entityType: "clarification_send_attempt", entityId: attempt.data.id, action: "clarification.send_started", metadata: { attempt_number: attemptNumber } });
  const provider = createEmailProvider();
  try {
    const sent = await provider.sendMessage({
      from: config.from,
      to: draft.data.recipient,
      subject: draft.data.subject,
      text: draft.data.body_text,
      messageId: rfcMessageId,
    });
    const now = new Date().toISOString();
    const outbound = await admin.from("email_messages").insert({
      application_id: draft.data.application_id,
      provider: "mailru",
      provider_message_id: sent.messageId || rfcMessageId,
      mailbox_identifier: config.from.toLowerCase(),
      direction: "outbound",
      sender: config.from,
      recipients: [{ address: draft.data.recipient }],
      subject: draft.data.subject,
      plain_body: draft.data.body_text,
      occurred_at: now,
      processing_status: "completed",
      rfc_message_id: sent.messageId || rfcMessageId,
      reference_message_ids: [],
      cc: [],
      raw_headers: {},
    });
    if (outbound.error) {
      throw Object.assign(
        new Error("SMTP accepted the message but persistence failed."),
        { command: "DATA" },
      );
    }
    await admin.from("clarification_send_attempts").update({ status: "sent", provider_message_id: sent.messageId || rfcMessageId, provider_response: sent.response.slice(0, 1000), completed_at: now }).eq("id", attempt.data.id);
    await admin.from("clarification_drafts").update({ status: "sent", sent_at: now, updated_by: profile.id }).eq("id", draftId);
    await audit(admin, { actorId: profile.id, applicationId: draft.data.application_id, entityType: "clarification_send_attempt", entityId: attempt.data.id, action: "clarification.sent", metadata: { rfc_message_id: sent.messageId || rfcMessageId } });
    if (execution) {
      await admin.from("applications").update({ status: "waiting_for_client" }).eq("id", draft.data.application_id);
    } else {
      await changeApplicationStatus({ applicationId: draft.data.application_id, status: "waiting_for_client", reason: "Clarification sent to client." });
    }
    return { sent: true, messageId: sent.messageId || rfcMessageId };
  } catch (error) {
    const safe = classifySmtpFailure(error);
    await admin.from("clarification_send_attempts").update({ status: safe.deliveryUnknown ? "delivery_unknown" : "safe_failure", safe_error_code: safe.code, safe_error_message: safe.message, completed_at: new Date().toISOString() }).eq("id", attempt.data.id);
    await admin.from("clarification_drafts").update({ status: "send_failed", updated_by: profile.id }).eq("id", draftId);
    await audit(admin, { actorId: profile.id, applicationId: draft.data.application_id, entityType: "clarification_send_attempt", entityId: attempt.data.id, action: "clarification.send_failed", metadata: { error_code: safe.code, delivery_unknown: safe.deliveryUnknown } });
    throw new Error(safe.message);
  } finally {
    await provider.close();
  }
}

export async function getClarificationState(applicationId: string) {
  const { supabase } = await getOperationalContext();
  const [runs, fields, drafts, attempts, inbound] = await Promise.all([
    supabase.from("completeness_runs").select("*").eq("application_id", applicationId).order("created_at", { ascending: false }).limit(10),
    supabase.from("completeness_field_results").select("*").eq("application_id", applicationId).order("created_at", { ascending: false }),
    supabase.from("clarification_drafts").select("*").eq("application_id", applicationId).order("created_at", { ascending: false }).limit(10),
    supabase.from("clarification_send_attempts").select("*").eq("application_id", applicationId).order("started_at", { ascending: false }).limit(20),
    supabase.from("email_messages").select("sender").eq("application_id", applicationId).eq("direction", "inbound").order("occurred_at", { ascending: false }).limit(1),
  ]);
  const error = runs.error ?? fields.error ?? drafts.error ?? attempts.error ?? inbound.error;
  if (error) throw new Error(`Unable to load clarification state: ${error.message}`);
  const latestRun = runs.data?.[0] ?? null;
  return {
    runs: runs.data ?? [],
    latestRun,
    fields: latestRun ? (fields.data ?? []).filter((field) => field.completeness_run_id === latestRun.id) : [],
    drafts: drafts.data ?? [],
    attempts: attempts.data ?? [],
    suggestedRecipient: inbound.data?.[0]?.sender ?? "",
  };
}
