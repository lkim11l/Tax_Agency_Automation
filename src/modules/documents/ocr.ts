import type { ParserResult, ValidatedDocument } from "./types";

export type OcrWord = {
  text: string;
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type OcrPage = {
  pageNumber: number;
  text: string;
  words: OcrWord[];
  widthPixels?: number;
  heightPixels?: number;
  resolutionDpi?: number;
  orientationDegrees?: 0 | 90 | 180 | 270;
  orientationConfidence?: number;
};

export type OcrQualityMetrics = {
  pageCount: number;
  blankPageCount: number;
  recognizedCharacterCount: number;
  recognizedWordCount: number;
  meanWordConfidence: number | null;
  lowConfidenceWordCount: number;
  lowConfidenceWordRatio: number | null;
  durationMs: number;
};

export type OcrResult = {
  status: "completed" | "review_required" | "failed";
  provider: string;
  providerVersion: string;
  languages: string[];
  normalizedText: string | null;
  pages: OcrPage[];
  quality: OcrQualityMetrics;
  warnings: string[];
  errorCode: "OCR_ENGINE_UNAVAILABLE" | "OCR_LOW_CONFIDENCE" | "OCR_FAILED" | null;
  errorMessage: string | null;
};

export type OcrRequest = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  checksum: string;
  format: "image" | "pdf";
  content: Buffer;
  languages: string[];
};

export interface OcrProvider {
  readonly name: string;
  readonly version: string;
  isAvailable(): Promise<boolean>;
  recognize(request: OcrRequest, signal: AbortSignal): Promise<OcrResult>;
}

const LOW_CONFIDENCE_THRESHOLD = 0.65;

export function calculateOcrQualityMetrics(
  pages: OcrPage[],
  durationMs: number,
): OcrQualityMetrics {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError("OCR duration must be a non-negative finite number.");
  }
  const words = pages.flatMap((page) => page.words);
  for (const word of words) {
    if (
      !Number.isFinite(word.confidence) ||
      word.confidence < 0 ||
      word.confidence > 1
    ) {
      throw new RangeError("OCR word confidence must be between 0 and 1.");
    }
  }
  const lowConfidenceWordCount = words.filter(
    (word) => word.confidence < LOW_CONFIDENCE_THRESHOLD,
  ).length;
  return {
    pageCount: pages.length,
    blankPageCount: pages.filter((page) => page.text.trim().length === 0).length,
    recognizedCharacterCount: pages.reduce(
      (total, page) => total + page.text.length,
      0,
    ),
    recognizedWordCount: words.length,
    meanWordConfidence:
      words.length === 0
        ? null
        : words.reduce((total, word) => total + word.confidence, 0) /
          words.length,
    lowConfidenceWordCount,
    lowConfidenceWordRatio:
      words.length === 0 ? null : lowConfidenceWordCount / words.length,
    durationMs,
  };
}

export function isOcrCandidate(
  document: ValidatedDocument,
  parserResult: ParserResult,
) {
  return (
    (document.format === "image" || document.format === "pdf") &&
    parserResult.status === "review_required" &&
    parserResult.errorCode === "OCR_REQUIRED"
  );
}
