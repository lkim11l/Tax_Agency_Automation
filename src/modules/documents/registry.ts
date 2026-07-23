import { DocumentProcessingError } from "./errors";
import { DocxParser } from "./parsers/docx";
import { ImageParser } from "./parsers/image";
import { PdfParser } from "./parsers/pdf";
import { TextParser } from "./parsers/text";
import { XlsxParser } from "./parsers/xlsx";
import type { DocumentParser, ValidatedDocument } from "./types";

const parsers: DocumentParser[] = [
  new DocxParser(),
  new PdfParser(),
  new XlsxParser(),
  new TextParser(),
  new ImageParser(),
];

export function selectDocumentParser(document: ValidatedDocument) {
  const parser = parsers.find((candidate) => candidate.supports(document));
  if (!parser) {
    throw new DocumentProcessingError(
      "UNSUPPORTED_FORMAT",
      "No safe parser is registered for this attachment.",
      "unsupported",
    );
  }
  return parser;
}
