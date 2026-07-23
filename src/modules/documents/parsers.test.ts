import { describe, expect, it } from "vitest";

import { ImageParser } from "./parsers/image";
import { mapPdfError, PdfParser } from "./parsers/pdf";
import { TextParser } from "./parsers/text";
import { XlsxParser } from "./parsers/xlsx";
import { DocxParser } from "./parsers/docx";
import { validateDocument } from "./security";
import {
  descriptor,
  syntheticDocx,
  syntheticPdf,
  syntheticXlsx,
} from "./test-fixtures";

describe("document parsers", () => {
  it("preserves DOCX paragraphs, headings and table values", async () => {
    const content = syntheticDocx();
    const document = await validateDocument(
      descriptor(
        "contract.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content,
      ),
      content,
    );
    const result = await new DocxParser().parse(document);
    expect(result.status).toBe("parsed");
    expect(result.normalizedText).toContain("Test contract");
    expect(result.normalizedText).toContain("INN | 1234567890");
  });

  it("preserves PDF page markers and text", async () => {
    const content = syntheticPdf();
    const document = await validateDocument(
      descriptor("request.pdf", "application/pdf", content),
      content,
    );
    const result = await new PdfParser().parse(document);
    expect(result.status).toBe("parsed");
    expect(result.normalizedText).toContain("[PAGE 1]");
    expect(result.normalizedText).toContain("Phase 3 PDF text");
  }, 15_000);

  it("routes scanned and encrypted PDFs to review without OCR", async () => {
    const scanned = syntheticPdf("");
    const document = await validateDocument(
      descriptor("scan.pdf", "application/pdf", scanned),
      scanned,
    );
    const result = await new PdfParser().parse(document);
    expect(result).toMatchObject({
      status: "review_required",
      errorCode: "OCR_REQUIRED",
    });
    expect(mapPdfError({ name: "PasswordException" })).toMatchObject({
      code: "ENCRYPTED_DOCUMENT",
      status: "review_required",
    });
  }, 15_000);

  it("preserves XLSX sheets, rows, numbers, dates and safe formulas", async () => {
    const content = await syntheticXlsx();
    const document = await validateDocument(
      descriptor(
        "request.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content,
      ),
      content,
    );
    const result = await new XlsxParser().parse(document);
    expect(result.status).toBe("parsed");
    expect(result.normalizedText).toContain("[SHEET: Request]");
    expect(result.normalizedText).toContain("B2=1250.5");
    expect(result.normalizedText).toContain("2026-07-23");
    expect(result.normalizedText).toContain("'=SUM(B2:B3)");
  });

  it("handles UTF-8 BOM and neutralizes CSV formula-like cells", async () => {
    const text = Buffer.from("\ufeffПривет\r\nмир");
    const textDocument = await validateDocument(
      descriptor("request.txt", "text/plain", text),
      text,
    );
    expect((await new TextParser().parse(textDocument)).normalizedText).toBe(
      "Привет\nмир",
    );

    const csv = Buffer.from("name,value\nrisk,=2+2\n");
    const csvDocument = await validateDocument(
      descriptor("request.csv", "text/csv", csv),
      csv,
    );
    const result = await new TextParser().parse(csvDocument);
    expect(result.normalizedText).toContain("'=2+2");
    expect(result.warnings).toHaveLength(1);
  });

  it("marks validated images as OCR review required", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const document = await validateDocument(
      descriptor("scan.png", "image/png", png),
      png,
    );
    const result = await new ImageParser().parse(document);
    expect(result.status).toBe("review_required");
    expect(result.errorCode).toBe("OCR_REQUIRED");
  });
});
