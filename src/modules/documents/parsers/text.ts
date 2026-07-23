import { parse } from "csv-parse/sync";

import { DocumentProcessingError } from "../errors";
import { DOCUMENT_LIMITS } from "../limits";
import { normalizeDocumentText } from "../normalization";
import type { DocumentParser, ParserResult, ValidatedDocument } from "../types";
import { DOCUMENT_PARSER_VERSION } from "../types";

function decodeText(content: Buffer) {
  if (content[0] === 0xff && content[1] === 0xfe) {
    return new TextDecoder("utf-16le", { fatal: true }).decode(content.subarray(2));
  }
  if (content[0] === 0xfe && content[1] === 0xff) {
    const swapped = Buffer.alloc(content.length - 2);
    for (let index = 2; index + 1 < content.length; index += 2) {
      swapped[index - 2] = content[index + 1]!;
      swapped[index - 1] = content[index]!;
    }
    return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
  }
  const offset =
    content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf ? 3 : 0;
  return new TextDecoder("utf-8", { fatal: true }).decode(content.subarray(offset));
}

function safeCsvCell(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export class TextParser implements DocumentParser {
  readonly type = "plain-text";
  readonly version = `${DOCUMENT_PARSER_VERSION}:textdecoder`;

  supports(document: ValidatedDocument) {
    return document.format === "txt" || document.format === "csv";
  }

  async parse(document: ValidatedDocument): Promise<ParserResult> {
    try {
      const decoded = decodeText(document.content);
      let raw = decoded;
      const metadata: Record<string, unknown> = {
        encoding: document.content[0] === 0xff ? "utf-16le" : "utf-8",
      };
      const warnings: string[] = [];

      if (document.format === "csv") {
        const records = parse(decoded, {
          bom: true,
          max_record_size: DOCUMENT_LIMITS.maxTextCharacters,
          relax_column_count: true,
          skip_empty_lines: false,
        }) as string[][];
        if (records.length > DOCUMENT_LIMITS.maxRows) {
          throw new DocumentProcessingError(
            "FILE_LIMIT_EXCEEDED",
            `CSV exceeds the ${DOCUMENT_LIMITS.maxRows}-row limit.`,
            "blocked",
          );
        }
        let cellCount = 0;
        raw = records
          .map((row, index) => {
            cellCount += row.length;
            if (cellCount > DOCUMENT_LIMITS.maxCells) {
              throw new DocumentProcessingError(
                "FILE_LIMIT_EXCEEDED",
                `CSV exceeds the ${DOCUMENT_LIMITS.maxCells}-cell limit.`,
                "blocked",
              );
            }
            return `[ROW ${index + 1}] ${row.map(safeCsvCell).join(" | ")}`;
          })
          .join("\n");
        metadata.row_count = records.length;
        metadata.cell_count = cellCount;
        if (records.some((row) => row.some((cell) => /^[=+\-@\t\r]/.test(cell)))) {
          warnings.push(
            "Formula-like CSV cells were prefixed with an apostrophe in normalized output.",
          );
        }
      }

      const normalized = normalizeDocumentText(raw);
      if (!normalized.text) {
        throw new DocumentProcessingError(
          "EMPTY_FILE",
          "The text document contains no readable content.",
          "review_required",
        );
      }
      return {
        status: "parsed",
        parserType:
          document.format === "csv" ? "csv-parse" : this.type,
        parserVersion:
          document.format === "csv"
            ? `${DOCUMENT_PARSER_VERSION}:csv-parse-7.0.1`
            : this.version,
        normalizedText: normalized.text,
        sourceMetadata: metadata,
        warnings: [...warnings, ...normalized.warnings],
      };
    } catch (error) {
      if (error instanceof DocumentProcessingError) throw error;
      throw new DocumentProcessingError(
        "CORRUPT_DOCUMENT",
        "The text document encoding or structure is invalid.",
      );
    }
  }
}
