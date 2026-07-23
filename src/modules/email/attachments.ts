import { createHash } from "node:crypto";
import path from "node:path";

export const EMAIL_ATTACHMENT_BUCKET = "email-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
]);

const blockedExtensions = new Set([
  ".bat",
  ".cmd",
  ".com",
  ".exe",
  ".hta",
  ".jar",
  ".js",
  ".jse",
  ".msi",
  ".ps1",
  ".scr",
  ".vbs",
  ".wsf",
]);

export function sanitizeFilename(filename: string): string {
  const basename = path.win32.basename(path.posix.basename(filename));
  const cleaned = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._\-\u0400-\u04ff]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);
  return cleaned || "attachment";
}

export function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function validateAttachment(input: {
  filename: string;
  mimeType: string;
  size: number;
}) {
  const sanitizedFilename = sanitizeFilename(input.filename);
  if (input.size > MAX_ATTACHMENT_BYTES) {
    return { allowed: false as const, reason: "Attachment exceeds the 10 MiB limit." };
  }
  if (input.size < 0) {
    return { allowed: false as const, reason: "Attachment size is invalid." };
  }
  if (blockedExtensions.has(path.extname(sanitizedFilename).toLowerCase())) {
    return { allowed: false as const, reason: "Executable attachments are blocked." };
  }
  if (!allowedMimeTypes.has(input.mimeType.toLowerCase())) {
    return { allowed: false as const, reason: "Attachment type is not allowed." };
  }
  return { allowed: true as const, sanitizedFilename };
}

export function attachmentStoragePath(input: {
  applicationId: string;
  emailMessageId: string;
  filename: string;
  checksum: string;
}) {
  const safe = sanitizeFilename(input.filename);
  return `applications/${input.applicationId}/emails/${input.emailMessageId}/${input.checksum.slice(0, 12)}-${safe}`;
}
