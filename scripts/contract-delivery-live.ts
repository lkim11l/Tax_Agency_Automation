import { createAdminClient } from "../src/lib/supabase/admin.server";
import { recalculateCompleteness } from "../src/modules/clarification/service";
import { CONTRACT_BUCKET } from "../src/modules/contracts/constants";
import { generateContract } from "../src/modules/contracts/service";
import {
  createDeliveryDraft,
  reviewContractVersion,
  sendDeliveryDraft,
  updateDeliveryDraft,
  type DeliveryExecution,
} from "../src/modules/delivery/service";
import { sha256, verifyExactDocx } from "../src/modules/delivery/domain";
import { createEmailProvider } from "../src/modules/email/provider";
import { loadEmailConfig } from "../src/modules/email/config";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function activeAdmin(admin: ReturnType<typeof createAdminClient>) {
  const result = await admin.from("profiles").select("id,role")
    .eq("role", "admin").eq("is_active", true).limit(1).maybeSingle();
  assert(!result.error && result.data, "An active synthetic-test admin is required.");
  return result.data;
}

async function findExternalRecipient(
  admin: ReturnType<typeof createAdminClient>,
  agencyAddress: string,
) {
  const configured = process.env.CONTRACT_DELIVERY_TEST_RECIPIENT?.trim();
  if (configured) return configured;
  const inbound = await admin.from("email_messages").select("sender")
    .eq("direction", "inbound")
    .neq("sender", agencyAddress)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assert(!inbound.error && inbound.data?.sender, "No confirmed external test recipient was found.");
  return inbound.data.sender;
}

async function recordReviewOpen(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
  version: {
    id: string;
    storage_path: string;
    checksum: string;
    version_number: number;
  },
  contract: {
    id: string;
    application_id: string;
  },
) {
  const download = await admin.storage.from(CONTRACT_BUCKET).download(version.storage_path);
  assert(!download.error && download.data, "Synthetic review DOCX is missing from private Storage.");
  const content = Buffer.from(await download.data.arrayBuffer());
  verifyExactDocx({
    content,
    expectedChecksum: version.checksum,
    approvalChecksum: version.checksum,
  });
  const event = await admin.from("audit_events").insert({
    actor_id: actorId,
    application_id: contract.application_id,
    entity_type: "contract_version",
    entity_id: version.id,
    action: "contract.review_opened",
    metadata: {
      application_id: contract.application_id,
      contract_id: contract.id,
      contract_version_id: version.id,
      version_number: version.version_number,
      checksum: version.checksum,
      synthetic_test: true,
    },
  });
  assert(!event.error, "Unable to persist synthetic review-open audit.");
  return content;
}

async function findSyntheticAwaiting(admin: ReturnType<typeof createAdminClient>) {
  const templates = await admin.from("contract_templates")
    .select("id,name")
    .ilike("name", "%synthetic%");
  assert(!templates.error && templates.data?.length, "No synthetic contract template exists.");
  const contracts = await admin.from("contracts")
    .select("id,application_id,template_id,contract_number,status")
    .in("template_id", templates.data.map((item) => item.id));
  assert(!contracts.error && contracts.data?.length, "No synthetic contract exists.");
  const contractIds = contracts.data.map((item) => item.id);
  const versions = await admin.from("contract_versions")
    .select("id,contract_id,version_number,status,storage_path,checksum,generated_filename")
    .in("contract_id", contractIds)
    .eq("status", "awaiting_review")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assert(!versions.error && versions.data, "No synthetic contract version awaits review.");
  const contract = contracts.data.find((item) => item.id === versions.data!.contract_id);
  const applicationResult = contract
    ? await admin.from("applications").select("id,application_number,title")
      .eq("id", contract.application_id).single()
    : null;
  const application = applicationResult?.data;
  assert(contract && application && contract.template_id, "Synthetic contract provenance is incomplete.");
  return { application, contract, version: versions.data };
}

async function verifyReceiptIfPresent(
  admin: ReturnType<typeof createAdminClient>,
  expected: {
    applicationNumber: string;
    checksum: string;
    filename: string;
    messageId: string;
  },
) {
  const receiptSubject = `TAA-PHASE7-RECEIPT-${expected.applicationNumber}`;
  const provider = createEmailProvider();
  try {
    await provider.verifyImap();
    const snapshot = await provider.fetchIncoming(0);
    const receipt = snapshot.messages.find((message) =>
      message.subject?.includes(receiptSubject) &&
      message.attachments.some((attachment) => attachment.filename === expected.filename),
    );
    if (!receipt) return { verified: false, receiptSubject };
    const attachment = receipt.attachments.find((item) => item.filename === expected.filename)!;
    assert(sha256(attachment.content) === expected.checksum, "Received attachment checksum differs.");
    assert(attachment.content[0] === 0x50 && attachment.content[1] === 0x4b, "Received file is not DOCX.");
    return { verified: true, receiptSubject, receivedMessageId: receipt.rfcMessageId };
  } finally {
    await provider.close();
  }
}

async function validatePersistedDelivery(
  admin: ReturnType<typeof createAdminClient>,
  draftId: string,
) {
  const draft = await admin.from("contract_delivery_drafts")
    .select("id,application_id,contract_id,contract_version_id,attachment_filename,version_checksum,status,sent_at")
    .eq("id", draftId).single();
  assert(!draft.error && draft.data?.status === "sent", "Delivery draft was not persisted as sent.");
  const attempt = await admin.from("contract_delivery_attempts")
    .select("id,status,provider_message_id,outgoing_email_message_id,attachment_checksum")
    .eq("delivery_draft_id", draftId).eq("status", "sent").single();
  assert(!attempt.error && attempt.data?.outgoing_email_message_id, "Outgoing delivery attempt is missing.");
  assert(attempt.data.attachment_checksum === draft.data.version_checksum, "Persisted checksum mismatch.");
  const attachment = await admin.from("contract_delivery_attachments")
    .select("checksum,filename,file_size,mime_type")
    .eq("delivery_attempt_id", attempt.data.id).single();
  assert(!attachment.error && attachment.data?.checksum === draft.data.version_checksum, "Attachment metadata mismatch.");
  const application = await admin.from("applications").select("application_number,status")
    .eq("id", draft.data.application_id).single();
  const contract = await admin.from("contracts").select("status")
    .eq("id", draft.data.contract_id).single();
  const version = await admin.from("contract_versions").select("status")
    .eq("id", draft.data.contract_version_id).single();
  assert(application.data?.status === "contract_sent", "Application did not reach contract_sent.");
  assert(contract.data?.status === "delivered", "Contract did not reach delivered.");
  assert(version.data?.status === "delivered", "Version did not reach delivered.");
  return {
    ...draft.data,
    applicationNumber: application.data.application_number,
    messageId: attempt.data.provider_message_id as string,
  };
}

async function main() {
  const admin = createAdminClient();
  const config = loadEmailConfig();
  const actor = await activeAdmin(admin);
  const execution: DeliveryExecution = {
    actorId: actor.id,
    role: "admin",
    admin,
    sender: config.from,
  };

  const existing = await admin.from("contract_delivery_drafts")
    .select("id")
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!existing.error && existing.data) {
    const persisted = await validatePersistedDelivery(admin, existing.data.id);
    const receipt = await verifyReceiptIfPresent(admin, {
      applicationNumber: persisted.applicationNumber,
      checksum: persisted.version_checksum,
      filename: persisted.attachment_filename,
      messageId: persisted.messageId,
    });
    if (!receipt.verified) {
      console.log(JSON.stringify({
        status: "manual_receipt_verification_required",
        subject: receipt.receiptSubject,
        forward_to: config.from,
        expected_filename: persisted.attachment_filename,
        expected_checksum: persisted.version_checksum,
        smtp_message_id: persisted.messageId,
      }, null, 2));
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify({
      status: "passed",
      application_number: persisted.applicationNumber,
      filename: persisted.attachment_filename,
      checksum: persisted.version_checksum,
      smtp_message_id: persisted.messageId,
      received_message_id: receipt.receivedMessageId,
      received_attachment_verified: true,
    }, null, 2));
    return;
  }

  const recipient = await findExternalRecipient(admin, config.from);
  const initial = await findSyntheticAwaiting(admin);
  let unapprovedBlocked = false;
  try {
    await createDeliveryDraft({
      contractVersionId: initial.version.id,
      recipient,
    }, execution);
  } catch {
    unapprovedBlocked = true;
  }
  assert(unapprovedBlocked, "Unapproved version unexpectedly produced a delivery draft.");

  await recordReviewOpen(admin, actor.id, initial.version, initial.contract);
  await reviewContractVersion({
    contractVersionId: initial.version.id,
    decision: "rejected",
    comment: "Synthetic Phase 7 rejection acceptance.",
  }, execution);
  let rejectedBlocked = false;
  try {
    await createDeliveryDraft({
      contractVersionId: initial.version.id,
      recipient,
    }, execution);
  } catch {
    rejectedBlocked = true;
  }
  assert(rejectedBlocked, "Rejected version unexpectedly produced a delivery draft.");

  await recalculateCompleteness({
    applicationId: initial.application.id,
    ruleSetId: "standard-contract",
    initiatedBy: actor.id,
    admin,
  });
  const generated = await generateContract({
    applicationId: initial.application.id,
    templateId: initial.contract.template_id,
    force: true,
    forceReason: "Synthetic Phase 7 new-version approval acceptance.",
  }, {
    actorId: actor.id,
    role: "admin",
    admin,
  });
  const generatedVersionId = "versionId" in generated
    ? generated.versionId
    : generated.contract_version_id;
  assert(generatedVersionId, "Regeneration did not return a contract version ID.");
  const newVersion = await admin.from("contract_versions")
    .select("id,contract_id,version_number,status,storage_path,checksum,generated_filename")
    .eq("id", generatedVersionId).single();
  assert(!newVersion.error && newVersion.data, "Regenerated synthetic version is missing.");
  await recordReviewOpen(admin, actor.id, newVersion.data, initial.contract);
  await reviewContractVersion({
    contractVersionId: newVersion.data.id,
    decision: "approved",
    comment: "Synthetic Phase 7 approval after exact DOCX inspection.",
  }, execution);

  const review = await admin.from("contract_version_reviews")
    .select("version_checksum,decision")
    .eq("contract_version_id", newVersion.data.id).single();
  assert(review.data?.decision === "approved", "Approval did not persist.");
  assert(review.data.version_checksum === newVersion.data.checksum, "Approval checksum mismatch.");

  const created = await createDeliveryDraft({
    contractVersionId: newVersion.data.id,
    recipient,
  }, execution);
  const originalDraft = await admin.from("contract_delivery_drafts")
    .select("recipient,subject,body_text")
    .eq("id", created.draftId).single();
  assert(originalDraft.data, "Initial delivery draft is missing.");
  const updated = await updateDeliveryDraft({
    draftId: created.draftId,
    recipient: originalDraft.data.recipient,
    subject: originalDraft.data.subject,
    bodyText: originalDraft.data.body_text,
  }, execution);
  assert(updated.version === created.version + 1, "Delivery draft version did not increment.");

  const sent = await sendDeliveryDraft(updated.draftId, execution);
  assert(sent.sent && !sent.cacheHit, "Mail.ru SMTP delivery did not complete.");
  const repeated = await sendDeliveryDraft(updated.draftId, execution);
  assert(repeated.cacheHit, "Repeated delivery did not return the persisted cache result.");
  const persisted = await validatePersistedDelivery(admin, updated.draftId);

  const audits = await admin.from("audit_events").select("action")
    .eq("application_id", persisted.application_id)
    .in("action", [
      "contract.review_opened",
      "contract.rejected",
      "contract.approved",
      "contract.delivery_draft_created",
      "contract.delivery_draft_updated",
      "contract.delivery_started",
      "contract.delivered",
      "contract.delivery_cache_hit",
    ]);
  const actions = new Set((audits.data ?? []).map((item) => item.action));
  for (const action of [
    "contract.review_opened",
    "contract.rejected",
    "contract.approved",
    "contract.delivery_started",
    "contract.delivered",
    "contract.delivery_cache_hit",
  ]) assert(actions.has(action), `Missing audit action: ${action}`);

  const receipt = await verifyReceiptIfPresent(admin, {
    applicationNumber: persisted.applicationNumber,
    checksum: persisted.version_checksum,
    filename: persisted.attachment_filename,
    messageId: persisted.messageId,
  });
  if (!receipt.verified) {
    console.log(JSON.stringify({
      status: "smtp_sent_manual_receipt_verification_required",
      subject: receipt.receiptSubject,
      forward_to: config.from,
      expected_filename: persisted.attachment_filename,
      expected_checksum: persisted.version_checksum,
      smtp_message_id: persisted.messageId,
      unapproved_blocked: true,
      rejected_blocked: true,
      duplicate_send_blocked: true,
    }, null, 2));
    process.exitCode = 2;
    return;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Contract delivery live acceptance failed.");
  process.exitCode = 1;
});
