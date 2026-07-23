import { describe, expect, it } from "vitest";

import { contractExtractionSchema, missingExtractedValue } from "./schema";
import { syntheticExtraction, syntheticValue } from "./test-fixtures";

describe("contract extraction schema", () => {
  it("validates the complete versioned structure", () => {
    expect(
      contractExtractionSchema.parse(
        syntheticExtraction({
          organization: { inn: syntheticValue({ value: "7707083893" }) },
        }),
      ).organization.inn.normalizedValue,
    ).toBe("7707083893");
  });

  it("represents missing values as null and review-required", () => {
    expect(missingExtractedValue()).toEqual(
      expect.objectContaining({
        value: null,
        normalizedValue: null,
        rawValue: null,
        requiresReview: true,
        reason: "NOT_FOUND",
      }),
    );
  });

  it("rejects empty strings used in place of missing values", () => {
    const extraction = syntheticExtraction();
    extraction.organization.legal_name = {
      ...missingExtractedValue(),
      value: "",
      normalizedValue: "",
    };
    expect(contractExtractionSchema.safeParse(extraction).success).toBe(false);
  });
});
