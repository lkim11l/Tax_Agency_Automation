import { describe, expect, it } from "vitest";

import { normalizeDocumentText, pageMarker, sheetMarker } from "./normalization";

describe("document text normalization", () => {
  it("normalizes line endings and controls without changing legal words", () => {
    expect(normalizeDocumentText("Clause  1\r\nValue\u0000 X\n\n\n\nEnd").text).toBe(
      "Clause 1\nValue X\n\n\nEnd",
    );
  });

  it("creates stable source markers", () => {
    expect(pageMarker(2)).toBe("[PAGE 2]");
    expect(sheetMarker("Rates] 2026")).toBe("[SHEET: Rates 2026]");
  });
});
