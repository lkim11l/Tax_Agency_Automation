import { createHash } from "node:crypto";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ReviewDecision =
  | "approved"
  | "rejected"
  | "returned_for_regeneration";

export function validateReviewInput(input: {
  decision: ReviewDecision;
  comment?: string | null;
}) {
  const comment = input.comment?.trim() || null;
  if (input.decision !== "approved" && (!comment || comment.length < 2)) {
    throw new Error("A rejection or regeneration return requires a comment.");
  }
  if (comment && comment.length > 4000) throw new Error("Review comment is too long.");
  return { ...input, comment };
}

export function validateDeliveryHeaders(recipient: string, subject: string) {
  const normalized = recipient.trim().toLowerCase();
  if (
    normalized.length > 320 ||
    /[\r\n]/u.test(recipient) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
  ) {
    throw new Error("Invalid delivery recipient.");
  }
  if (!subject.trim() || subject.length > 500 || /[\r\n]/u.test(subject)) {
    throw new Error("Invalid delivery subject.");
  }
  return normalized;
}

export function buildDeliveryDraft(applicationNumber: string) {
  return {
    subject: `Договор по заявке ${applicationNumber}`,
    body: [
      "Здравствуйте.",
      "",
      `Направляем подготовленный договор по заявке ${applicationNumber}.`,
      "Просим ознакомиться с документом и сообщить о результате проверки.",
      "",
      "С уважением,",
      "Налоговое агентство",
    ].join("\n"),
  };
}

export function safeDeliveryFilename(value: string) {
  const cleaned = value.normalize("NFKC")
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 180);
  if (!cleaned.toLowerCase().endsWith(".docx")) {
    throw new Error("Delivery attachment must be a DOCX file.");
  }
  return cleaned;
}

export function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

export function verifyExactDocx(input: {
  content: Buffer;
  expectedChecksum: string;
  approvalChecksum: string;
}) {
  if (
    input.content.length < 4 ||
    input.content[0] !== 0x50 ||
    input.content[1] !== 0x4b
  ) {
    throw new Error("CONTRACT_ATTACHMENT_SIGNATURE_INVALID");
  }
  const actualChecksum = sha256(input.content);
  if (
    actualChecksum !== input.expectedChecksum ||
    actualChecksum !== input.approvalChecksum
  ) {
    throw new Error("CONTRACT_ATTACHMENT_CHECKSUM_MISMATCH");
  }
  return actualChecksum;
}

export function deliveryKey(input: {
  contractVersionId: string;
  checksum: string;
  recipient: string;
  draftVersion: number;
}) {
  return createHash("sha256")
    .update([
      input.contractVersionId,
      input.checksum,
      input.recipient.toLowerCase(),
      input.draftVersion,
    ].join(":"))
    .digest("hex");
}

export function safeDeliveryAuditMetadata(input: {
  applicationId: string;
  contractId: string;
  contractVersionId: string;
  checksum: string;
  recipient: string;
  deliveryId?: string;
  safeErrorCode?: string;
}) {
  return {
    application_id: input.applicationId,
    contract_id: input.contractId,
    contract_version_id: input.contractVersionId,
    checksum: input.checksum,
    recipient_domain: input.recipient.split("@")[1]?.toLowerCase() ?? "invalid",
    delivery_id: input.deliveryId ?? null,
    safe_error_code: input.safeErrorCode ?? null,
  };
}
