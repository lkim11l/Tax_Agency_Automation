import { DocumentProcessingError } from "../errors";
import { DOCUMENT_LIMITS } from "../limits";
import { normalizeDocumentText, pageMarker } from "../normalization";
import type { DocumentParser, ParserResult, ValidatedDocument } from "../types";
import { DOCUMENT_PARSER_VERSION } from "../types";

export function mapPdfError(error: unknown): DocumentProcessingError {
  const name =
    typeof error === "object" && error && "name" in error
      ? String(error.name)
      : "";
  if (name === "PasswordException") {
    return new DocumentProcessingError(
      "ENCRYPTED_DOCUMENT",
      "Encrypted PDFs require manual review.",
      "review_required",
    );
  }
  return new DocumentProcessingError(
    "CORRUPT_DOCUMENT",
    "The PDF could not be parsed safely.",
  );
}

export class PdfParser implements DocumentParser {
  readonly type = "pdfjs";
  readonly version = `${DOCUMENT_PARSER_VERSION}:pdfjs-4.10.38`;

  supports(document: ValidatedDocument) {
    return document.format === "pdf";
  }

  async parse(document: ValidatedDocument): Promise<ParserResult> {
    try {
      const { getDocument } = await import(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
      const task = getDocument({
        data: new Uint8Array(document.content),
        isEvalSupported: false,
        useSystemFonts: true,
      });
      const pdf = await task.promise;
      if (pdf.numPages > DOCUMENT_LIMITS.maxPages) {
        await pdf.destroy();
        throw new DocumentProcessingError(
          "FILE_LIMIT_EXCEEDED",
          `PDF exceeds the ${DOCUMENT_LIMITS.maxPages}-page limit.`,
          "blocked",
        );
      }

      const pages: string[] = [];
      let readableCharacters = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        readableCharacters += pageText.replace(/\s/g, "").length;
        pages.push(`${pageMarker(pageNumber)}\n${pageText}`);
        page.cleanup();
      }
      await pdf.destroy();

      if (readableCharacters < 10) {
        return {
          status: "review_required",
          parserType: this.type,
          parserVersion: this.version,
          normalizedText: null,
          sourceMetadata: { page_count: pdf.numPages },
          warnings: ["No reliable text layer was found."],
          errorCode: "OCR_REQUIRED",
          errorMessage: "The PDF appears scanned and requires OCR or manual review.",
        };
      }

      const normalized = normalizeDocumentText(pages.join("\n\n"));
      return {
        status: "parsed",
        parserType: this.type,
        parserVersion: this.version,
        normalizedText: normalized.text,
        sourceMetadata: { page_count: pdf.numPages },
        warnings: normalized.warnings,
      };
    } catch (error) {
      if (error instanceof DocumentProcessingError) throw error;
      throw mapPdfError(error);
    }
  }
}
