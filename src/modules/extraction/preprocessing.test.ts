import { describe, expect, it } from "vitest";

import {
  chunkFragments,
  createExtractionFingerprint,
  findDeterministicCandidates,
  normalizeAmount,
  normalizeCurrency,
  normalizeDate,
  selectRelevantFragments,
  validateAccount,
  validateBik,
  validateInn,
  validateKpp,
  validateOgrn,
} from "./preprocessing";
import type { ExtractionSource } from "./types";

const source: ExtractionSource = {
  sourceType: "parsed_document",
  sourceId: "11111111-1111-4111-8111-111111111111",
  sourceMarker: "[DOCUMENT]",
  checksum: "a".repeat(64),
  parserVersion: "pdf-v1",
  text: [
    "[PAGE 1]",
    "Реквизиты: ИНН 7707083893, КПП 773601001, ОГРН 1027700132195.",
    "БИК 044525225, счет 40702810900000002851.",
    "Email: test@example.invalid, телефон +7 (999) 123-45-67.",
    "Сумма: 12 500,50 RUB. Срок: 23.07.2026.",
  ].join("\n"),
};

describe("deterministic preprocessing", () => {
  it("validates Russian identifiers and account formatting", () => {
    expect(validateInn("7707083893")).toBe(true);
    expect(validateInn("7707083894")).toBe(false);
    expect(validateKpp("773601001")).toBe(true);
    expect(validateOgrn("1027700132195")).toBe(true);
    expect(validateBik("044525225")).toBe(true);
    expect(validateAccount("40702810900000002851")).toBe(true);
  });

  it("normalizes dates, nonnegative amounts, and supported currencies", () => {
    expect(normalizeDate("23.07.2026")).toBe("2026-07-23");
    expect(normalizeDate("31.02.2026")).toBeNull();
    expect(normalizeAmount("12 500,50")).toBe("12500.50");
    expect(normalizeAmount("-1")).toBeNull();
    expect(normalizeCurrency("руб.")).toBe("RUB");
    expect(normalizeCurrency("GBP")).toBeNull();
  });

  it("finds candidates with source markers and validator results", () => {
    const candidates = findDeterministicCandidates([source]);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "inn",
          normalizedValue: "7707083893",
          sourceMarker: "[PAGE 1]",
          validatorValid: true,
          requiresReview: true,
        }),
      ]),
    );
  });

  it("selects, deduplicates, limits, and chunks relevant fragments", () => {
    const candidates = findDeterministicCandidates([source]);
    const fragments = selectRelevantFragments([source, source], candidates, 10_000);
    expect(fragments).toHaveLength(1);
    expect(fragments[0].sourceMarker).toBe("[PAGE 1]");
    expect(chunkFragments([...fragments, ...fragments], 100)).toHaveLength(2);
  });

  it("creates a stable versioned cache fingerprint", () => {
    const forward = createExtractionFingerprint([source]);
    const reversed = createExtractionFingerprint([{ ...source }]);
    expect(forward).toHaveLength(64);
    expect(reversed).toBe(forward);
    expect(
      createExtractionFingerprint([{ ...source, checksum: "b".repeat(64) }]),
    ).not.toBe(forward);
  });
});
