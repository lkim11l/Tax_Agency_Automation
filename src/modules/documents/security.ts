import { createHash } from "node:crypto";
import path from "node:path";

import { inspectOfficeArchive } from "./archive";
import { DocumentProcessingError } from "./errors";
import { DOCUMENT_LIMITS } from "./limits";
import type {
  AttachmentDescriptor,
  SupportedDocumentFormat,
  ValidatedDocument,
} from "./types";

const blockedExtensions = new Set([
  ".7z",
  ".apk",
  ".bat",
  ".cmd",
  ".com",
  ".docm",
  ".exe",
  ".hta",
  ".jar",
  ".js",
  ".jse",
  ".msi",
  ".ps1",
  ".rar",
  ".scr",
  ".tar",
  ".vbs",
  ".wsf",
  ".xlsm",
  ".zip",
]);

const macroExtensions = new Set([".docm", ".xlsm"]);
const archiveExtensions = new Set([".7z", ".rar", ".tar", ".zip"]);
const genericMimeTypes = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "",
]);

const formatRules: Record<
  Exclude<SupportedDocumentFormat, "image">,
  { extensions: Set<string>; mimeTypes: Set<string> }
> = {
  docx: {
    extensions: new Set([".docx"]),
    mimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
  },
  pdf: {
    extensions: new Set([".pdf"]),
    mimeTypes: new Set(["application/pdf"]),
  },
  xlsx: {
    extensions: new Set([".xlsx"]),
    mimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
  },
  txt: {
    extensions: new Set([".txt"]),
    mimeTypes: new Set(["text/plain"]),
  },
  csv: {
    extensions: new Set([".csv"]),
    mimeTypes: new Set([
      "application/csv",
      "text/csv",
      "text/plain",
      "application/vnd.ms-excel",
    ]),
  },
};

const imageRules = [
  { extensions: new Set([".jpg", ".jpeg"]), mime: "image/jpeg", type: "jpeg" },
  { extensions: new Set([".png"]), mime: "image/png", type: "png" },
  { extensions: new Set([".webp"]), mime: "image/webp", type: "webp" },
  { extensions: new Set([".tif", ".tiff"]), mime: "image/tiff", type: "tiff" },
] as const;

function startsWith(content: Buffer, bytes: number[]) {
  return bytes.every((value, index) => content[index] === value);
}

function isZip(content: Buffer) {
  return (
    startsWith(content, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(content, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(content, [0x50, 0x4b, 0x07, 0x08])
  );
}

function isPdf(content: Buffer) {
  return content.subarray(0, 1024).includes(Buffer.from("%PDF-"));
}

function isImage(content: Buffer, type: string) {
  if (type === "jpeg") return startsWith(content, [0xff, 0xd8, 0xff]);
  if (type === "png") {
    return startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (type === "webp") {
    return (
      content.subarray(0, 4).toString("ascii") === "RIFF" &&
      content.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return (
    startsWith(content, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(content, [0x4d, 0x4d, 0x00, 0x2a])
  );
}

function hasExecutableSignature(content: Buffer) {
  return (
    startsWith(content, [0x4d, 0x5a]) ||
    startsWith(content, [0x7f, 0x45, 0x4c, 0x46]) ||
    content.subarray(0, 2).toString("ascii") === "#!"
  );
}

function formatFromExtension(extension: string): SupportedDocumentFormat | null {
  for (const [format, rule] of Object.entries(formatRules)) {
    if (rule.extensions.has(extension)) {
      return format as Exclude<SupportedDocumentFormat, "image">;
    }
  }
  return imageRules.some((rule) => rule.extensions.has(extension))
    ? "image"
    : null;
}

function validateMime(
  format: SupportedDocumentFormat,
  extension: string,
  mimeType: string,
) {
  if (genericMimeTypes.has(mimeType)) return;
  if (format === "image") {
    const rule = imageRules.find((item) => item.extensions.has(extension));
    if (rule?.mime === mimeType) return;
  } else if (formatRules[format].mimeTypes.has(mimeType)) {
    return;
  }
  throw new DocumentProcessingError(
    "MIME_EXTENSION_MISMATCH",
    "The filename extension and declared media type do not match.",
    "blocked",
  );
}

async function validateSignature(
  format: SupportedDocumentFormat,
  extension: string,
  content: Buffer,
) {
  if ((format === "docx" || format === "xlsx") && !isZip(content)) {
    throw new DocumentProcessingError(
      "MIME_EXTENSION_MISMATCH",
      "The document content does not match its Office filename.",
      "blocked",
    );
  }
  if (format === "pdf" && !isPdf(content)) {
    throw new DocumentProcessingError(
      "MIME_EXTENSION_MISMATCH",
      "The document content is not a valid PDF signature.",
      "blocked",
    );
  }
  if (format === "image") {
    const rule = imageRules.find((item) => item.extensions.has(extension));
    if (!rule || !isImage(content, rule.type)) {
      throw new DocumentProcessingError(
        "MIME_EXTENSION_MISMATCH",
        "The image content does not match its filename.",
        "blocked",
      );
    }
  }

  if (format === "docx" || format === "xlsx") {
    const inspection = await inspectOfficeArchive(content);
    const lowercase = inspection.entries.map((entry) => entry.toLowerCase());
    if (lowercase.some((entry) => entry.endsWith("/vbaproject.bin"))) {
      throw new DocumentProcessingError(
        "MACROS_BLOCKED",
        "Macro-enabled Office documents are blocked.",
        "blocked",
      );
    }
    const required =
      format === "docx" ? "word/document.xml" : "xl/workbook.xml";
    if (!lowercase.includes(required)) {
      throw new DocumentProcessingError(
        "CORRUPT_DOCUMENT",
        "The Office document does not contain its required content.",
      );
    }
  }
}

export async function validateDocument(
  descriptor: AttachmentDescriptor,
  content: Buffer,
): Promise<ValidatedDocument> {
  const extension = path.extname(descriptor.sanitizedFilename).toLowerCase();
  const mimeType = descriptor.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";

  if (content.length === 0) {
    throw new DocumentProcessingError(
      "EMPTY_FILE",
      "The attachment is empty.",
      "blocked",
    );
  }
  if (
    content.length > DOCUMENT_LIMITS.maxFileBytes ||
    descriptor.sizeBytes > DOCUMENT_LIMITS.maxFileBytes
  ) {
    throw new DocumentProcessingError(
      "FILE_TOO_LARGE",
      "The attachment exceeds the 10 MiB parsing limit.",
      "blocked",
    );
  }
  if (content.length !== descriptor.sizeBytes) {
    throw new DocumentProcessingError(
      "FILE_LIMIT_EXCEEDED",
      "Stored attachment size does not match its database metadata.",
      "blocked",
    );
  }
  const checksum = createHash("sha256").update(content).digest("hex");
  if (checksum !== descriptor.checksum.toLowerCase()) {
    throw new DocumentProcessingError(
      "CHECKSUM_MISMATCH",
      "Stored attachment checksum verification failed.",
      "blocked",
    );
  }
  if (macroExtensions.has(extension)) {
    throw new DocumentProcessingError(
      "MACROS_BLOCKED",
      "Macro-enabled Office documents are blocked.",
      "blocked",
    );
  }
  if (archiveExtensions.has(extension)) {
    throw new DocumentProcessingError(
      "ARCHIVE_BLOCKED",
      "Archive attachments are not parsed.",
      "blocked",
    );
  }
  if (blockedExtensions.has(extension) || hasExecutableSignature(content)) {
    throw new DocumentProcessingError(
      "EXECUTABLE_BLOCKED",
      "Executable or active-content attachments are blocked.",
      "blocked",
    );
  }

  const format = formatFromExtension(extension);
  if (!format) {
    throw new DocumentProcessingError(
      "UNSUPPORTED_FORMAT",
      "This attachment format is not supported for automatic parsing.",
      "unsupported",
    );
  }
  validateMime(format, extension, mimeType);
  await validateSignature(format, extension, content);
  return { ...descriptor, content, format };
}
