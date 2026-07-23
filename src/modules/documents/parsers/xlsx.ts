import ExcelJS from "exceljs";

import { DocumentProcessingError } from "../errors";
import { DOCUMENT_LIMITS } from "../limits";
import { normalizeDocumentText, sheetMarker } from "../normalization";
import type { DocumentParser, ParserResult, ValidatedDocument } from "../types";
import { DOCUMENT_PARSER_VERSION } from "../types";

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "formula" in value) {
    const result = value.result;
    if (result instanceof Date) return result.toISOString();
    if (result !== null && result !== undefined) return String(result);
    return `'=${value.formula}`;
  }
  if (typeof value === "object" && "richText" in value) {
    return value.richText.map((part) => part.text).join("");
  }
  if (typeof value === "object" && "text" in value) return value.text;
  return String(value);
}

export class XlsxParser implements DocumentParser {
  readonly type = "exceljs";
  readonly version = `${DOCUMENT_PARSER_VERSION}:exceljs-4.4.0`;

  supports(document: ValidatedDocument) {
    return document.format === "xlsx";
  }

  async parse(document: ValidatedDocument): Promise<ParserResult> {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(document.content).buffer);
      const nonemptySheets = workbook.worksheets.filter(
        (worksheet) => worksheet.actualRowCount > 0,
      );
      if (nonemptySheets.length > DOCUMENT_LIMITS.maxSheets) {
        throw new DocumentProcessingError(
          "FILE_LIMIT_EXCEEDED",
          `Workbook exceeds the ${DOCUMENT_LIMITS.maxSheets}-sheet limit.`,
          "blocked",
        );
      }

      const output: string[] = [];
      let rowCount = 0;
      let cellCount = 0;
      const sheetNames: string[] = [];
      for (const worksheet of nonemptySheets) {
        sheetNames.push(worksheet.name);
        output.push(sheetMarker(worksheet.name));
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          rowCount += 1;
          if (rowCount > DOCUMENT_LIMITS.maxRows) {
            throw new DocumentProcessingError(
              "FILE_LIMIT_EXCEEDED",
              `Workbook exceeds the ${DOCUMENT_LIMITS.maxRows}-row limit.`,
              "blocked",
            );
          }
          const cells: string[] = [];
          row.eachCell({ includeEmpty: false }, (cell) => {
            cellCount += 1;
            if (cellCount > DOCUMENT_LIMITS.maxCells) {
              throw new DocumentProcessingError(
                "FILE_LIMIT_EXCEEDED",
                `Workbook exceeds the ${DOCUMENT_LIMITS.maxCells}-cell limit.`,
                "blocked",
              );
            }
            cells.push(`${cell.address}=${cellText(cell)}`);
          });
          if (cells.length > 0) {
            output.push(`[ROW ${rowNumber}] ${cells.join(" | ")}`);
          }
        });
        output.push("");
      }

      const normalized = normalizeDocumentText(output.join("\n"));
      if (!normalized.text) {
        throw new DocumentProcessingError(
          "EMPTY_FILE",
          "The workbook has no non-empty cells.",
          "review_required",
        );
      }
      return {
        status: "parsed",
        parserType: this.type,
        parserVersion: this.version,
        normalizedText: normalized.text,
        sourceMetadata: {
          cell_count: cellCount,
          row_count: rowCount,
          sheet_count: nonemptySheets.length,
          sheet_names: sheetNames,
        },
        warnings: normalized.warnings,
      };
    } catch (error) {
      if (error instanceof DocumentProcessingError) throw error;
      throw new DocumentProcessingError(
        "CORRUPT_DOCUMENT",
        "The XLSX workbook could not be parsed safely.",
      );
    }
  }
}
