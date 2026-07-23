import type { SupabaseClient } from "@supabase/supabase-js";

import { getOperationalContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin.server";
import { classifySmtpFailure } from "@/modules/clarification/workflow";
import { CONTRACT_BUCKET } from "@/modules/contracts/constants";
import { loadEmailConfig } from "@/modules/email/config";
import { createEmailProvider } from "@/modules/email/provider";
import type { EmailProvider } from "@/modules/email/types";

import {
  buildDeliveryDraft,
  deliveryKey,
  DOCX_MIME,
  safeDeliveryAuditMetadata,
  safeDeliveryFilename,
  validateDeliveryHeaders,
  validateReviewInput,
  verifyExactDocx,
  type ReviewDecision,
} from "./domain";

export type DeliveryExecution = {
  actorId: string;
  role: "admin" | "specialist";
  admin: SupabaseClient;
  provider?: EmailProvider;
  sender?: string;
};

async function context(execution?: DeliveryExecution) {
  if (execution) return execution;
  const operational = await getOperationalContext();
  return {
    actorId: operational.profile.id,
    role: operational.profile.role,
    admin: createAdminClient(),
  };
}

async function audit(
  admin: SupabaseClient,
  input: {
    actorId: string;
    applicationId: string;
    entityType: string;
    entityId: string;
    action: string;
    metadata: Record<string, unknown>;
  },
) {
  const result = await admin.from("audit_events").insert({
    actor_id: input.actorId,
    application_id: input.applicationId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    metadata: input.metadata,
  });
  if (result.error) throw new Error("Unable to write delivery audit event.");
}

async function loadVersion(admin: SupabaseClient, contractVersionId: string) {
  const result = await admin.from("contract_versions").select(
    "id,contract_id,version_number,status,storage_path,checksum,source_fingerprint,generated_filename,file_size,template_id,template_version,completeness_run_id,extraction_run_id,contract:contracts!contract_versions_contract_id_fkey(id,application_id,contract_number,current_version_id,approved_version_id,status)",
  ).eq("id", contractVersionId).single();
  if (result.error || !result.data) throw new Error("Contract version not found.");
  const contract = Array.isArray(result.data.contract)
    ? result.data.contract[0]
    : result.data.contract;
  if (!contract) throw new Error("Contract provenance is missing.");
  return { version: result.data, contract };
}

async function downloadVersion(
  admin: SupabaseClient,
  version: { storage_path: string; checksum: string },
  approvalChecksum: string,
) {
  const downloaded = await admin.storage.from(CONTRACT_BUCKET)
    .download(version.storage_path);
  if (downloaded.error || !downloaded.data) {
    throw new Error("Approved contract file is unavailable in private Storage.");
  }
  const content = Buffer.from(await downloaded.data.arrayBuffer());
  verifyExactDocx({
    content,
    expectedChecksum: version.checksum,
    approvalChecksum,
  });
  return content;
}

export async function reviewContractVersion(input: {
  contractVersionId: string;
  decision: ReviewDecision;
  comment?: string | null;
}, execution?: DeliveryExecution) {
  const current = await context(execution);
  const review = validateReviewInput(input);
  const { version } = await loadVersion(current.admin, input.contractVersionId);
  if (version.status !== "awaiting_review") {
    throw new Error("Only a version awaiting review can be reviewed.");
  }
  await downloadVersion(current.admin, version, version.checksum);
  const result = await current.admin.rpc("review_contract_version", {
    p_contract_version_id: version.id,
    p_reviewer_id: current.actorId,
    p_decision: review.decision,
    p_comment: review.comment,
    p_verified_checksum: version.checksum,
  });
  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "Contract review failed.");
  }
  return { reviewId: result.data as string, decision: review.decision };
}

async function confirmedRecipient(
  admin: SupabaseClient,
  applicationId: string,
  sender: string,
) {
  const inbound = await admin.from("email_messages").select("sender")
    .eq("application_id", applicationId)
    .eq("direction", "inbound")
    .neq("sender", sender)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inbound.error) throw new Error("Unable to load a confirmed client email.");
  return inbound.data?.sender ?? null;
}

export async function createDeliveryDraft(input: {
  contractVersionId: string;
  recipient?: string | null;
}, execution?: DeliveryExecution) {
  const current = await context(execution);
  const config = loadEmailConfig();
  const sender = execution?.sender ?? config.from;
  const { version, contract } = await loadVersion(
    current.admin,
    input.contractVersionId,
  );
  const review = await current.admin.from("contract_version_reviews")
    .select("reviewer_id,decision,version_checksum")
    .eq("contract_version_id", version.id)
    .maybeSingle();
  if (
    review.error ||
    !review.data ||
    review.data.decision !== "approved" ||
    version.status !== "approved" ||
    contract.approved_version_id !== version.id
  ) {
    throw new Error("An active checksum-bound approval is required.");
  }
  const application = await current.admin.from("applications")
    .select("application_number")
    .eq("id", contract.application_id)
    .single();
  if (application.error || !application.data) throw new Error("Application not found.");
  const discovered = await confirmedRecipient(
    current.admin,
    contract.application_id,
    sender,
  );
  const rawRecipient = input.recipient?.trim() || discovered;
  if (!rawRecipient) throw new Error("A confirmed client email is required.");
  const content = buildDeliveryDraft(application.data.application_number);
  const recipient = validateDeliveryHeaders(rawRecipient, content.subject);
  if (recipient === sender.toLowerCase()) {
    throw new Error("The agency mailbox cannot be the delivery recipient.");
  }
  const filename = safeDeliveryFilename(
    version.generated_filename || `${contract.contract_number}-v${version.version_number}.docx`,
  );
  const prior = await current.admin.from("contract_delivery_drafts")
    .select("version")
    .eq("contract_version_id", version.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const draft = await current.admin.from("contract_delivery_drafts").insert({
    application_id: contract.application_id,
    contract_id: contract.id,
    contract_version_id: version.id,
    version: (prior.data?.version ?? 0) + 1,
    recipient,
    recipient_source: input.recipient ? "manual" : "confirmed_inbound",
    subject: content.subject,
    body_text: content.body,
    attachment_filename: filename,
    version_checksum: version.checksum,
    status: "ready",
    created_by: current.actorId,
    approved_by: review.data.reviewer_id,
  }).select("id,version").single();
  if (draft.error || !draft.data) throw new Error("Delivery draft creation failed.");
  await audit(current.admin, {
    actorId: current.actorId,
    applicationId: contract.application_id,
    entityType: "contract_delivery_draft",
    entityId: draft.data.id,
    action: "contract.delivery_draft_created",
    metadata: safeDeliveryAuditMetadata({
      applicationId: contract.application_id,
      contractId: contract.id,
      contractVersionId: version.id,
      checksum: version.checksum,
      recipient,
      deliveryId: draft.data.id,
    }),
  });
  return { draftId: draft.data.id as string, version: draft.data.version as number };
}

export async function updateDeliveryDraft(input: {
  draftId: string;
  recipient: string;
  subject: string;
  bodyText: string;
}, execution?: DeliveryExecution) {
  const current = await context(execution);
  const existing = await current.admin.from("contract_delivery_drafts")
    .select("*").eq("id", input.draftId).single();
  if (existing.error || !existing.data) throw new Error("Delivery draft not found.");
  if (!["ready", "draft", "send_failed"].includes(existing.data.status)) {
    throw new Error("This delivery draft can no longer be edited.");
  }
  const recipient = validateDeliveryHeaders(input.recipient, input.subject);
  if (!input.bodyText.trim() || input.bodyText.length > 50_000) {
    throw new Error("Invalid delivery body.");
  }
  const sender = execution?.sender ?? loadEmailConfig().from;
  if (recipient === sender.toLowerCase()) {
    throw new Error("The agency mailbox cannot be the delivery recipient.");
  }
  const created = await current.admin.from("contract_delivery_drafts").insert({
    application_id: existing.data.application_id,
    contract_id: existing.data.contract_id,
    contract_version_id: existing.data.contract_version_id,
    version: existing.data.version + 1,
    previous_draft_id: existing.data.id,
    recipient,
    recipient_source: "manual",
    subject: input.subject.trim(),
    body_text: input.bodyText.trim(),
    attachment_filename: existing.data.attachment_filename,
    version_checksum: existing.data.version_checksum,
    status: "ready",
    created_by: current.actorId,
    approved_by: existing.data.approved_by,
  }).select("id,version").single();
  if (created.error || !created.data) throw new Error("Delivery draft update failed.");
  const superseded = await current.admin.from("contract_delivery_drafts")
    .update({ status: "superseded" }).eq("id", existing.data.id)
    .eq("status", existing.data.status);
  if (superseded.error) throw new Error("Previous delivery draft could not be closed.");
  await audit(current.admin, {
    actorId: current.actorId,
    applicationId: existing.data.application_id,
    entityType: "contract_delivery_draft",
    entityId: created.data.id,
    action: "contract.delivery_draft_updated",
    metadata: {
      ...safeDeliveryAuditMetadata({
        applicationId: existing.data.application_id,
        contractId: existing.data.contract_id,
        contractVersionId: existing.data.contract_version_id,
        checksum: existing.data.version_checksum,
        recipient,
        deliveryId: created.data.id,
      }),
      previous_delivery_id: existing.data.id,
      draft_version: created.data.version,
    },
  });
  return { draftId: created.data.id as string, version: created.data.version as number };
}

export async function cancelDeliveryDraft(
  draftId: string,
  execution?: DeliveryExecution,
) {
  const current = await context(execution);
  const draft = await current.admin.from("contract_delivery_drafts")
    .select("id,application_id,contract_id,contract_version_id,version_checksum,recipient,status")
    .eq("id", draftId).single();
  if (draft.error || !draft.data) throw new Error("Delivery draft not found.");
  if (!["draft", "ready", "send_failed"].includes(draft.data.status)) {
    throw new Error("This delivery draft cannot be cancelled.");
  }
  const changed = await current.admin.from("contract_delivery_drafts")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", draftId).eq("status", draft.data.status);
  if (changed.error) throw new Error("Delivery draft cancellation failed.");
  await audit(current.admin, {
    actorId: current.actorId,
    applicationId: draft.data.application_id,
    entityType: "contract_delivery_draft",
    entityId: draftId,
    action: "contract.delivery_draft_cancelled",
    metadata: safeDeliveryAuditMetadata({
      applicationId: draft.data.application_id,
      contractId: draft.data.contract_id,
      contractVersionId: draft.data.contract_version_id,
      checksum: draft.data.version_checksum,
      recipient: draft.data.recipient,
      deliveryId: draftId,
    }),
  });
}

export async function sendDeliveryDraft(
  draftId: string,
  execution?: DeliveryExecution,
) {
  const current = await context(execution);
  const config = loadEmailConfig();
  const sender = execution?.sender ?? config.from;
  const draft = await current.admin.from("contract_delivery_drafts")
    .select("*").eq("id", draftId).single();
  if (draft.error || !draft.data) throw new Error("Delivery draft not found.");
  const { version, contract } = await loadVersion(
    current.admin,
    draft.data.contract_version_id,
  );
  const review = await current.admin.from("contract_version_reviews")
    .select("decision,version_checksum")
    .eq("contract_version_id", version.id).maybeSingle();
  if (!review.data || review.data.decision !== "approved") {
    throw new Error("Sending without approval is denied.");
  }
  const recipient = validateDeliveryHeaders(draft.data.recipient, draft.data.subject);
  if (recipient === sender.toLowerCase()) {
    throw new Error("The agency mailbox cannot be the delivery recipient.");
  }
  const content = await downloadVersion(
    current.admin,
    version,
    review.data.version_checksum,
  );
  const key = deliveryKey({
    contractVersionId: version.id,
    checksum: version.checksum,
    recipient,
    draftVersion: draft.data.version,
  });
  const completedAttempt = await current.admin.from("contract_delivery_attempts")
    .select("id,status,provider_message_id")
    .eq("delivery_key", key)
    .in("status", ["sent", "delivery_unknown"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (completedAttempt.error) throw new Error("Unable to verify prior delivery.");
  if (completedAttempt.data) {
    await audit(current.admin, {
      actorId: current.actorId,
      applicationId: contract.application_id,
      entityType: "contract_delivery_attempt",
      entityId: completedAttempt.data.id,
      action: "contract.delivery_cache_hit",
      metadata: safeDeliveryAuditMetadata({
        applicationId: contract.application_id,
        contractId: contract.id,
        contractVersionId: version.id,
        checksum: version.checksum,
        recipient,
        deliveryId: draft.data.id,
      }),
    });
    if (completedAttempt.data.status === "delivery_unknown") {
      throw new Error("Delivery reconciliation is required before retry.");
    }
    return {
      sent: true,
      cacheHit: true,
      messageId: completedAttempt.data.provider_message_id ?? null,
    };
  }
  const attempts = await current.admin.from("contract_delivery_attempts")
    .select("id", { count: "exact", head: true })
    .eq("delivery_draft_id", draftId);
  const attemptNumber = (attempts.count ?? 0) + 1;
  const domain = sender.split("@")[1] ?? "localhost";
  const rfcMessageId = `<taa-contract-${key.slice(0, 32)}@${domain}>`;
  const claim = await current.admin.rpc("claim_contract_delivery", {
    p_delivery_draft_id: draftId,
    p_actor_id: current.actorId,
    p_delivery_key: key,
    p_idempotency_key: `${key}:${attemptNumber}`,
    p_rfc_message_id: rfcMessageId,
    p_attachment_size: content.length,
  });
  if (claim.error || !claim.data) throw new Error(claim.error?.message ?? "Delivery claim failed.");
  const claimed = claim.data as {
    claimed: boolean;
    cache_hit: boolean;
    reconciliation_required: boolean;
    attempt_id: string;
    provider_message_id?: string | null;
  };
  if (!claimed.claimed) {
    if (claimed.reconciliation_required) {
      throw new Error("Delivery reconciliation is required before retry.");
    }
    return {
      sent: true,
      cacheHit: true,
      messageId: claimed.provider_message_id ?? rfcMessageId,
    };
  }

  const provider = execution?.provider ?? createEmailProvider();
  try {
    const sent = await provider.sendMessage({
      from: sender,
      to: recipient,
      subject: draft.data.subject,
      text: draft.data.body_text,
      messageId: rfcMessageId,
      attachments: [{
        filename: safeDeliveryFilename(draft.data.attachment_filename),
        content,
        contentType: DOCX_MIME,
      }],
    });
    if (
      sent.rejected.length > 0 ||
      !sent.accepted.map((item) => item.toLowerCase()).includes(recipient)
    ) {
      throw new Error("SMTP_RECIPIENT_NOT_ACCEPTED");
    }
    const finalized = await current.admin.rpc("finalize_contract_delivery", {
      p_attempt_id: claimed.attempt_id,
      p_actor_id: current.actorId,
      p_provider_message_id: sent.messageId || rfcMessageId,
      p_provider_response: sent.response,
      p_sender: sender,
    });
    if (finalized.error || !finalized.data) {
      throw Object.assign(
        new Error("SMTP accepted the contract but persistence failed."),
        { command: "DATA" },
      );
    }
    return {
      sent: true,
      cacheHit: false,
      messageId: sent.messageId || rfcMessageId,
      outgoingEmailId: finalized.data as string,
      checksum: version.checksum,
      contractNumber: contract.contract_number,
    };
  } catch (error) {
    const safe = classifySmtpFailure(error);
    await current.admin.rpc("fail_contract_delivery", {
      p_attempt_id: claimed.attempt_id,
      p_actor_id: current.actorId,
      p_error_code: safe.code,
      p_error_message: safe.message,
      p_delivery_unknown: safe.deliveryUnknown,
    });
    throw new Error(safe.message);
  } finally {
    await provider.close();
  }
}
