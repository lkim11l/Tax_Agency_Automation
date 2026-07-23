import type { DocumentParser, ParserResult, ValidatedDocument } from "../types";
import { DOCUMENT_PARSER_VERSION } from "../types";

export class ImageParser implements DocumentParser {
  readonly type = "image-review";
  readonly version = `${DOCUMENT_PARSER_VERSION}:no-ocr`;

  supports(document: ValidatedDocument) {
    return document.format === "image";
  }

  async parse(document: ValidatedDocument): Promise<ParserResult> {
    return {
      status: "review_required",
      parserType: this.type,
      parserVersion: this.version,
      normalizedText: null,
      sourceMetadata: {
        validated_mime_type: document.mimeType,
      },
      warnings: ["Image content was validated but OCR is not enabled in Phase 3."],
      errorCode: "OCR_REQUIRED",
      errorMessage: "Image OCR requires manual review.",
    };
  }
}
