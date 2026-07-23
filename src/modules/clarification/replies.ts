import type { SupabaseClient } from "@supabase/supabase-js";

import { parseAttachment } from "@/modules/documents/orchestrator";
import { runExtraction } from "@/modules/extraction/orchestrator";
import { resolveExtractionInitiator } from "@/modules/extraction/repository";

import { recalculateCompleteness } from "./service";

async function systemAudit(
  supabase: SupabaseClient,
  applicationId: string,
  emailMessageId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  const result = await supabase.from("audit_events").insert({
    actor_id: null,
    application_id: applicationId,
    entity_type: "email_message",
    entity_id: emailMessageId,
    action,
    metadata,
  });
  if (result.error) throw new Error("Unable to persist reply audit.");
}

export async function processClarificationReplies(
  emailMessageIds: string[],
  supabase: SupabaseClient,
) {
  for (const emailMessageId of emailMessageIds) {
    const message = await supabase
      .from("email_messages")
      .select("id,application_id,in_reply_to,reference_message_ids")
      .eq("id", emailMessageId)
      .single();
    if (message.error || !message.data?.application_id) continue;
    const references = [
      message.data.in_reply_to,
      ...(message.data.reference_message_ids ?? []),
    ].filter(Boolean) as string[];
    if (!references.length) continue;
    const attempt = await supabase
      .from("clarification_send_attempts")
      .select("draft_id,rfc_message_id")
      .eq("application_id", message.data.application_id)
      .in("rfc_message_id", references)
      .eq("status", "sent")
      .limit(1)
      .maybeSingle();
    if (attempt.error || !attempt.data) continue;
    const claimed = await supabase
      .from("clarification_reply_runs")
      .insert({
        inbound_email_message_id: emailMessageId,
        draft_id: attempt.data.draft_id,
        application_id: message.data.application_id,
        status: "processing",
      })
      .select("id")
      .maybeSingle();
    if (claimed.error || !claimed.data) continue;
    const applicationId = message.data.application_id;
    await supabase.from("applications").update({ status: "processing" }).eq("id", applicationId);
    await systemAudit(supabase, applicationId, emailMessageId, "clarification.reply_received");
    try {
      const attachments = await supabase
        .from("attachments")
        .select("id")
        .eq("email_message_id", emailMessageId);
      const parsedDocumentIds: string[] = [];
      for (const attachment of attachments.data ?? []) {
        const parsed = await parseAttachment(attachment.id, supabase);
        if (parsed?.result.status === "parsed") {
          const document = await supabase
            .from("parsed_documents")
            .select("id")
            .eq("attachment_id", attachment.id)
            .maybeSingle();
          if (document.data) parsedDocumentIds.push(document.data.id);
        }
      }
      await systemAudit(supabase, applicationId, emailMessageId, "clarification.reextraction_started", {
        delta_email_message_id: emailMessageId,
        delta_document_count: parsedDocumentIds.length,
      });
      const initiatedBy = await resolveExtractionInitiator(supabase);
      const extraction = await runExtraction({
        applicationId,
        initiatedBy,
        force: true,
        deltaSourceIds: [emailMessageId, ...parsedDocumentIds],
        supabase,
      });
      if (extraction.status === "failed") throw new Error(extraction.errorCode ?? "DELTA_EXTRACTION_FAILED");
      const latest = await supabase
        .from("completeness_runs")
        .select("rule_set_id")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const completeness = await recalculateCompleteness({
        applicationId,
        ruleSetId: latest.data?.rule_set_id ?? "standard-contract",
        triggeredByReplyId: emailMessageId,
        initiatedBy,
        admin: supabase,
      });
      await supabase.from("applications").update({
        status: completeness.ready ? "data_complete" : "needs_data_review",
      }).eq("id", applicationId);
      await supabase.from("clarification_reply_runs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", claimed.data.id);
      await systemAudit(supabase, applicationId, emailMessageId, "clarification.reply_processed", {
        extraction_run_id: extraction.runId,
        completeness_run_id: completeness.runId,
        ready: completeness.ready,
      });
    } catch {
      await supabase.from("applications").update({ status: "needs_data_review" }).eq("id", applicationId);
      await supabase.from("clarification_reply_runs").update({
        status: "failed",
        safe_error_code: "REPLY_PROCESSING_FAILED",
        completed_at: new Date().toISOString(),
      }).eq("id", claimed.data.id);
      await systemAudit(supabase, applicationId, emailMessageId, "clarification.reply_processing_failed", {
        error_code: "REPLY_PROCESSING_FAILED",
      });
    }
  }
}

export async function reconcileUnlinkedClarificationReplies(
  supabase: SupabaseClient,
) {
  const unlinked = await supabase
    .from("email_messages")
    .select("id,in_reply_to,reference_message_ids")
    .eq("direction", "inbound")
    .is("application_id", null)
    .not("in_reply_to", "is", null)
    .order("occurred_at", { ascending: true })
    .limit(100);
  if (unlinked.error) throw new Error("Unable to inspect unlinked replies.");
  const recovered: string[] = [];
  for (const message of unlinked.data ?? []) {
    const references = [
      message.in_reply_to,
      ...(message.reference_message_ids ?? []),
    ].filter(Boolean) as string[];
    const attempt = await supabase
      .from("clarification_send_attempts")
      .select("application_id")
      .in("rfc_message_id", references)
      .eq("status", "sent")
      .limit(1)
      .maybeSingle();
    if (!attempt.data) continue;
    const linked = await supabase
      .from("email_messages")
      .update({ application_id: attempt.data.application_id })
      .eq("id", message.id)
      .is("application_id", null)
      .select("id")
      .maybeSingle();
    if (!linked.data) continue;
    await supabase
      .from("attachments")
      .update({ application_id: attempt.data.application_id })
      .eq("email_message_id", message.id);
    await systemAudit(
      supabase,
      attempt.data.application_id,
      message.id,
      "clarification.reply_reconciled",
      { matched_by: "clarification_send_attempt.rfc_message_id" },
    );
    recovered.push(message.id);
  }
  return recovered;
}
