import { describe, expect, it } from "vitest";

import {
  calculateOcrQualityMetrics,
  isOcrCandidate,
  type OcrPage,
} from "./ocr";
import { descriptor } from "./test-fixtures";
import type { ParserResult, ValidatedDocument } from "./types";

describe("future OCR provider contract", () => {
  it("calculates deterministic quality metrics without an OCR engine", () => {
    const pages: OcrPage[] = [
      {
        pageNumber: 1,
        text: "Contract amount",
        words: [
          { text: "Contract", confidence: 0.95 },
          { text: "amount", confidence: 0.55 },
        ],
      },
      { pageNumber: 2, text: "", words: [] },
    ];
    expect(calculateOcrQualityMetrics(pages, 1250)).toEqual({
      pageCount: 2,
      blankPageCount: 1,
      recognizedCharacterCount: 15,
      recognizedWordCount: 2,
      meanWordConfidence: 0.75,
      lowConfidenceWordCount: 1,
      lowConfidenceWordRatio: 0.5,
      durationMs: 1250,
    });
  });

  it("rejects invalid provider confidence values", () => {
    expect(() =>
      calculateOcrQualityMetrics(
        [{ pageNumber: 1, text: "bad", words: [{ text: "bad", confidence: 101 }] }],
        1,
      ),
    ).toThrow("between 0 and 1");
  });

  it("selects only image/scanned-PDF OCR_REQUIRED outcomes", () => {
    const content = Buffer.from("fixture");
    const image = {
      ...descriptor("scan.png", "image/png", content),
      content,
      format: "image",
    } as ValidatedDocument;
    const result: ParserResult = {
      status: "review_required",
      parserType: "image-review",
      parserVersion: "1",
      normalizedText: null,
      sourceMetadata: {},
      warnings: [],
      errorCode: "OCR_REQUIRED",
    };
    expect(isOcrCandidate(image, result)).toBe(true);
    expect(
      isOcrCandidate({ ...image, format: "docx" }, result),
    ).toBe(false);
    expect(isOcrCandidate(image, { ...result, status: "failed" })).toBe(false);
  });
});
