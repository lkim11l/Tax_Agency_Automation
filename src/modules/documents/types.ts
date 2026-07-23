export const DOCUMENT_PARSER_VERSION = "1";

export const DOCUMENT_ERROR_CODES = [
  "ARCHIVE_BLOCKED",
  "ARCHIVE_LIMIT_EXCEEDED",
  "CHECKSUM_MISMATCH",
  "CORRUPT_DOCUMENT",
  "EMPTY_FILE",
  "ENCRYPTED_DOCUMENT",
  "EXECUTABLE_BLOCKED",
  "FILE_LIMIT_EXCEEDED",
  "FILE_TOO_LARGE",
  "MACROS_BLOCKED",
  "MIME_EXTENSION_MISMATCH",
  "OCR_REQUIRED",
  "PARSER_TIMEOUT",
  "STORAGE_DOWNLOAD_FAILED",
  "UNSUPPORTED_FORMAT",
] as const;

export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

export type DocumentParseStatus =
  | "pending"
  | "processing"
  | "parsed"
  | "review_required"
  | "unsupported"
  | "blocked"
  | "failed";

export type SupportedDocumentFormat =
  | "docx"
  | "pdf"
  | "xlsx"
  | "txt"
  | "csv"
  | "image";

export type AttachmentDescriptor = {
  attachmentId: string;
  applicationId: string | null;
  originalFilename: string;
  sanitizedFilename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  checksum: string;
};

export type ValidatedDocument = AttachmentDescriptor & {
  content: Buffer;
  format: SupportedDocumentFormat;
};

export type ParserResult = {
  status: Extract<
    DocumentParseStatus,
    "parsed" | "review_required" | "unsupported" | "blocked" | "failed"
  >;
  parserType: string;
  parserVersion: string;
  normalizedText: string | null;
  detectedLanguage?: string | null;
  sourceMetadata: Record<string, unknown>;
  warnings: string[];
  errorCode?: DocumentErrorCode | null;
  errorMessage?: string | null;
};

export interface DocumentParser {
  readonly type: string;
  readonly version: string;
  supports(document: ValidatedDocument): boolean;
  parse(document: ValidatedDocument): Promise<ParserResult>;
}

export type ClaimedAttachment = AttachmentDescriptor & {
  attemptId: string;
};
