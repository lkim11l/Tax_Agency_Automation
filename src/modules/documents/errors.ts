import type {
  DocumentErrorCode,
  DocumentParseStatus,
  ParserResult,
} from "./types";
import { DOCUMENT_PARSER_VERSION } from "./types";

export class DocumentProcessingError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    message: string,
    readonly status: Extract<
      DocumentParseStatus,
      "review_required" | "unsupported" | "blocked" | "failed"
    > = "failed",
  ) {
    super(message);
    this.name = "DocumentProcessingError";
  }
}

export function errorResult(error: unknown): ParserResult {
  const safe =
    error instanceof DocumentProcessingError
      ? error
      : new DocumentProcessingError(
          "CORRUPT_DOCUMENT",
          "The document could not be parsed safely.",
        );
  return {
    status: safe.status,
    parserType: "registry",
    parserVersion: DOCUMENT_PARSER_VERSION,
    normalizedText: null,
    sourceMetadata: {},
    warnings: [],
    errorCode: safe.code,
    errorMessage: safe.message,
  };
}
