import { describe, expect, it } from "vitest";

import {
  assessSafeAcceptance,
  previewSafeAcceptance,
  validateAcceptanceValue,
  type AcceptanceField,
} from "./acceptance";

const sourceId = "11111111-1111-4111-8111-111111111111";

function field(overrides: Partial<AcceptanceField> = {}): AcceptanceField {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    field_name: "inn",
    structured_value: {
      value: "7707083893",
      normalizedValue: "7707083893",
      rawValue: "7707083893",
      reason: "DIRECT_SOURCE",
    },
    raw_value: "7707083893",
    source_type: "email_message",
    source_id: sourceId,
    source_marker: "[EMAIL BODY]",
    source_excerpt: "ИНН: 7707083893.",
    confidence: 0.45,
    requires_review: true,
    conflict_detected: false,
    manually_corrected: false,
    extraction_run_id: null,
    ...overrides,
  };
}

describe("safe field acceptance", () => {
  it("accepts a checksum-valid INN from an explicit source despite low model confidence", () => {
    expect(assessSafeAcceptance(field())).toEqual(expect.objectContaining({
      eligible: true,
      reason: "SAFE_SOURCE_VALIDATED",
    }));
  });

  it("does not accept an invalid INN", () => {
    expect(assessSafeAcceptance(field({
      structured_value: { normalizedValue: "7707083894", rawValue: "7707083894" },
      raw_value: "7707083894",
      source_excerpt: "ИНН: 7707083894.",
    }))).toEqual(expect.objectContaining({
      eligible: false,
      reason: "INVALID_VALUE",
    }));
  });

  it("normalizes Russian amount and currency values", () => {
    expect(validateAcceptanceValue("contract_amount", "120 000 рублей")).toBe(true);
    expect(validateAcceptanceValue("currency", "руб.")).toBe(true);
  });

  it("resolves irrelevant numeric candidates but keeps a true conflict blocked", () => {
    const amount = field({
      field_name: "contract_amount",
      structured_value: {
        normalizedValue: "120000",
        rawValue: "120000 рублей",
      },
      raw_value: "120000 рублей",
      source_excerpt: "Стоимость услуг: 120000 рублей.",
      conflict_detected: true,
    });
    const falseConflict = [{
      field_name: "contract_amount",
      requires_review: true,
      candidates: [
        {
          normalizedValue: "120000",
          rawValue: "120000 рублей",
          sourceExcerpt: "Стоимость услуг: 120000 рублей.",
        },
        {
          normalizedValue: "31",
          rawValue: "31",
          sourceExcerpt:
            "Номер заявки: 31\nСтоимость услуг: 120000 рублей.\nСрок оказания услуг: по 31 августа 2026 года.",
        },
      ],
    }];
    expect(assessSafeAcceptance(amount, falseConflict)).toEqual(
      expect.objectContaining({ eligible: true, resolveConflict: true }),
    );

    const trueConflict = [{
      ...falseConflict[0],
      candidates: [
        falseConflict[0].candidates[0],
        {
          normalizedValue: "130000",
          rawValue: "130000 рублей",
          sourceExcerpt: "Стоимость услуг: 130000 рублей.",
        },
      ],
    }];
    expect(assessSafeAcceptance(amount, trueConflict)).toEqual(
      expect.objectContaining({ eligible: false, reason: "TRUE_CONFLICT" }),
    );
  });

  it("previews bulk confirmation without creating manual corrections", () => {
    const preview = previewSafeAcceptance([
      field(),
      field({
        id: "33333333-3333-4333-8333-333333333333",
        field_name: "legal_name",
        structured_value: { normalizedValue: null },
        raw_value: null,
        source_excerpt: null,
      }),
    ]);
    expect(preview.eligible).toHaveLength(1);
    expect(preview.blocked).toEqual([
      expect.objectContaining({ fieldName: "legal_name", reason: "MISSING_VALUE" }),
    ]);
  });
});
