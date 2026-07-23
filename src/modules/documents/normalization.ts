import { DOCUMENT_LIMITS } from "./limits";

export type NormalizedText = {
  text: string;
  warnings: string[];
};

export function normalizeDocumentText(input: string): NormalizedText {
  const normalized = input
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (normalized.length <= DOCUMENT_LIMITS.maxTextCharacters) {
    return { text: normalized, warnings: [] };
  }

  return {
    text: normalized.slice(0, DOCUMENT_LIMITS.maxTextCharacters),
    warnings: [
      `Extracted text was truncated at ${DOCUMENT_LIMITS.maxTextCharacters} characters.`,
    ],
  };
}

export function pageMarker(page: number) {
  return `[PAGE ${page}]`;
}

export function sheetMarker(name: string) {
  return `[SHEET: ${name.replace(/[\r\n\]]/g, " ").replace(/\s+/g, " ").trim()}]`;
}
