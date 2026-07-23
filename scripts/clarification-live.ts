import { createAdminClient } from "../src/lib/supabase/admin.server";
import {
  createDraft,
  recalculateCompleteness,
  sendApprovedDraft,
  transitionDraft,
  updateDraft,
} from "../src/modules/clarification/service";
import { loadEmailConfig } from "../src/modules/email/config";
import { syncMailbox } from "../src/modules/email/ingestion";

async function main() {
  const admin = createAdminClient();
  const emailConfig = loadEmailConfig();
  const profile = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .single();
  if (profile.error || !profile.data) throw new Error("No active administrator is available.");
  const execution = { actorId: profile.data.id as string, admin };
  const missingProviderIds = await admin
    .from("clarification_send_attempts")
    .select("id,rfc_message_id")
    .eq("status", "sent")
    .is("provider_message_id", null);
  for (const attempt of missingProviderIds.data ?? []) {
    await admin
      .from("clarification_send_attempts")
      .update({ provider_message_id: attempt.rfc_message_id })
      .eq("id", attempt.id);
  }

  const syntheticTitle = "TAA-PHASE5-LIVE-20260723-001";
  const syntheticApplication = await admin
    .from("applications")
    .select("id,application_number")
    .eq("title", syntheticTitle)
    .limit(1)
    .maybeSingle();
  const existing = syntheticApplication.data
    ? await admin
    .from("clarification_drafts")
    .select("id,application_id,status,recipient,subject,sent_at")
    .eq("application_id", syntheticApplication.data.id)
    .in("status", ["sent", "sending", "send_failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    : { data: null, error: null };

  if (existing.data?.status === "sent") {
    const sync = await syncMailbox(undefined, admin);
    const reply = await admin
      .from("clarification_reply_runs")
      .select("id,status,inbound_email_message_id,completed_at")
      .eq("draft_id", existing.data.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!reply.data) {
      console.log(JSON.stringify({
        status: "awaiting_real_reply",
        applicationId: existing.data.application_id,
        recipient: existing.data.recipient,
        subject: existing.data.subject,
        sentAt: existing.data.sent_at,
        mailboxSync: sync,
        requiredAction: "Reply from the recipient mailbox using the email client's Reply action. Keep the subject and include concrete missing values.",
      }, null, 2));
      process.exitCode = 2;
      return;
    }
    const application = await admin
      .from("applications")
      .select("status")
      .eq("id", existing.data.application_id)
      .single();
    const [
      completeness,
      extraction,
      replyRunCount,
      inboundCount,
      manualFields,
      auditEvents,
    ] = await Promise.all([
      admin
        .from("completeness_runs")
        .select("id,percentage,is_ready,is_blocking,missing_count,conflict_count,low_confidence_count,review_required_count,invalid_count,extraction_fingerprint,triggered_by_reply_id")
        .eq("application_id", existing.data.application_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      admin
        .from("extraction_runs")
        .select("id,status,source_ids,input_token_count,output_token_count")
        .eq("application_id", existing.data.application_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      admin
        .from("clarification_reply_runs")
        .select("id", { count: "exact", head: true })
        .eq("draft_id", existing.data.id),
      admin
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("rfc_message_id", reply.data.inbound_email_message_id
          ? (
              await admin
                .from("email_messages")
                .select("rfc_message_id")
                .eq("id", reply.data.inbound_email_message_id)
                .single()
            ).data?.rfc_message_id ?? ""
          : ""),
      admin
        .from("extracted_fields")
        .select("field_name,raw_value,manually_corrected")
        .eq("application_id", existing.data.application_id)
        .eq("manually_corrected", true)
        .order("field_name"),
      admin
        .from("audit_events")
        .select("action")
        .eq("application_id", existing.data.application_id)
        .in("action", [
          "clarification.reply_received",
          "clarification.reextraction_started",
          "completeness.recalculated_after_reply",
          "clarification.reply_processed",
        ]),
    ]);
    console.log(JSON.stringify({
      status: reply.data.status === "completed" ? "accepted" : "reply_processing_failed",
      applicationId: existing.data.application_id,
      replyRun: reply.data,
      applicationStatus: application.data?.status,
      completeness: completeness.data,
      deltaExtraction: extraction.data,
      replyRunCount: replyRunCount.count,
      inboundMessageCount: inboundCount.count,
      preservedManualFields: manualFields.data,
      auditActions: auditEvents.data?.map((event) => event.action).sort(),
      mailboxSync: sync,
    }, null, 2));
    if (reply.data.status !== "completed") process.exitCode = 1;
    return;
  }

  const recipientLookup = await admin
    .from("email_messages")
    .select("sender")
    .eq("direction", "inbound")
    .ilike("subject", "TAA-PHASE%-LIVE-%")
    .neq("sender", emailConfig.from)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const recipient =
    process.env.CLARIFICATION_LIVE_RECIPIENT?.trim() ??
    recipientLookup.data?.sender;
  if (!recipient || recipient.toLowerCase() === emailConfig.from.toLowerCase()) {
    throw new Error("A controlled external test recipient is required. Set CLARIFICATION_LIVE_RECIPIENT.");
  }
  let selected = syntheticApplication.data;
  if (!selected) {
    const created = await admin.from("applications").insert({
      title: syntheticTitle,
      source: "manual",
      status: "needs_data_review",
      priority: "normal",
      received_at: new Date().toISOString(),
      created_by: execution.actorId,
      contract_subject: "Синтетическая проверка договорного процесса",
    }).select("id,application_number").single();
    if (created.error || !created.data) throw new Error("Unable to create the synthetic live application.");
    selected = created.data;
    const manualField = (fieldName: string, value: string) => ({
      application_id: selected!.id,
      field_name: fieldName,
      normalized_value: { value },
      structured_value: {
        value,
        normalizedValue: value,
        rawValue: value,
        sourceType: "manual",
        sourceId: null,
        sourceMarker: "[SYNTHETIC LIVE FIXTURE]",
        sourceExcerpt: null,
        confidence: 1,
        requiresReview: false,
        reason: "DIRECT_SOURCE",
      },
      raw_value: value,
      source_type: "manual",
      source_marker: "[SYNTHETIC LIVE FIXTURE]",
      confidence: 1,
      requires_review: false,
      manually_corrected: true,
      corrected_by: execution.actorId,
      correction_reason: "Synthetic Phase 5 live acceptance fixture.",
      conflict_detected: false,
    });
    const seeded = await admin.from("extracted_fields").insert([
      manualField("legal_name", "ООО «Синтетический контрагент»"),
      manualField("inn", "7707083893"),
      manualField("contract_subject", "Синтетическая проверка договорного процесса"),
    ]);
    if (seeded.error) throw new Error("Unable to seed synthetic incomplete extraction.");
  }
  const completeness = await recalculateCompleteness({
    applicationId: selected.id,
    ruleSetId: "standard-contract",
    initiatedBy: execution.actorId,
    admin,
  });
  if (completeness.ready) {
    throw new Error("Selected application is already complete; live clarification must use a genuinely incomplete application.");
  }
  const draftId = await createDraft({
    applicationId: selected.id,
    completenessRunId: completeness.runId,
    recipient,
  }, execution);
  const draft = await admin
    .from("clarification_drafts")
    .select("recipient,subject,body_text")
    .eq("id", draftId)
    .single();
  if (draft.error || !draft.data) throw new Error("Unable to load the synthetic draft.");
  await updateDraft({
    draftId,
    recipient: draft.data.recipient,
    subject: draft.data.subject,
    bodyText: `${draft.data.body_text}\n\nИдентификатор проверки: ${syntheticTitle}`,
  }, execution);
  await transitionDraft(draftId, "submit", execution);
  await transitionDraft(draftId, "approve", execution);
  const sent = await sendApprovedDraft(draftId, execution);
  console.log(JSON.stringify({
    status: "sent_awaiting_real_reply",
    applicationId: selected.id,
    applicationNumber: selected.application_number,
    recipient,
    subject: `Уточнение данных по заявке ${selected.application_number}`,
    messageId: sent.messageId,
    requiredAction: "From the recipient mailbox, use Reply on this message, keep its subject, and provide concrete missing values. Then rerun npm run test:clarification:live.",
  }, null, 2));
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Clarification live acceptance failed.");
  process.exitCode = 1;
});
