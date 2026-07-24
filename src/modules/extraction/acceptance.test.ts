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
    const preview = previewSafeAcceptance(
      [
        field(),
        field({
          id: "33333333-3333-4333-8333-333333333333",
          field_name: "legal_name",
          structured_value: { normalizedValue: null },
          raw_value: null,
          source_excerpt: null,
        }),
      ],
      [],
      new Set(["legal_name"]),
    );
    expect(preview.eligible).toHaveLength(1);
    expect(preview.blocked).toEqual([
      expect.objectContaining({ fieldName: "legal_name", reason: "MISSING_VALUE" }),
    ]);
  });

  it("does not report a missing optional field as blocked", () => {
    const preview = previewSafeAcceptance(
      [
        field({
          id: "33333333-3333-4333-8333-333333333333",
          field_name: "additional_conditions",
          structured_value: { normalizedValue: null },
          raw_value: null,
          source_excerpt: null,
        }),
      ],
      [],
      new Set(["legal_name"]),
    );
    expect(preview.eligible).toHaveLength(0);
    expect(preview.blocked).toHaveLength(0);
  });

  it("auto-accepts all 11 fields that were previously stuck on SOURCE_REQUIRED", () => {
    function evidenceField(
      id: string,
      fieldName: string,
      value: string | number,
      excerpt: string,
    ): AcceptanceField {
      return field({
        id,
        field_name: fieldName,
        structured_value: { normalizedValue: value, rawValue: String(value) },
        raw_value: String(value),
        source_excerpt: excerpt,
      });
    }
    const paymentSentence =
      "Условия оплаты: 50% предоплата, оставшаяся часть в течение 5 рабочих дней после подписания акта выполненных работ.";
    const periodSentence = "Срок оказания услуг: с 5 августа 2026 года по 5 сентября 2026 года";
    const fields = [
      evidenceField("f1", "contact_email", "ivan.petrov@example.ru", "E-mail: ivan.petrov@example.ru"),
      evidenceField("f2", "bank_name", "ПАО Сбербанк", "Банк получателя: «ПАО Сбербанк»"),
      evidenceField(
        "f3",
        "signer_position",
        "Генеральный директор",
        "Подписант: Иванов И.И.\nДолжность подписанта:\nГенеральный директор",
      ),
      evidenceField(
        "f4",
        "contract_subject",
        "Оказание бухгалтерских услуг по ведению учета и сдаче отчетности",
        "Предмет услуг:\nОказание бухгалтерских услуг по ведению учета и сдаче отчетности",
      ),
      evidenceField(
        "f5",
        "additional_conditions",
        "Ежемесячный отчет и сданная отчетность в налоговую инспекцию",
        "Результат оказания услуг:\nЕжемесячный отчет и сданная отчетность в налоговую инспекцию",
      ),
      evidenceField(
        "f6",
        "payment_terms",
        "50% предоплата, оставшаяся часть в течение 5 рабочих дней после подписания акта выполненных работ",
        paymentSentence,
      ),
      evidenceField("f7", "advance_percentage", 50, paymentSentence),
      evidenceField("f8", "payment_due_days", 5, paymentSentence),
      evidenceField(
        "f9",
        "performance_period_text",
        "с 5 августа 2026 года по 5 сентября 2026 года",
        periodSentence,
      ),
      evidenceField("f10", "performance_start_date", "2026-08-05", periodSentence),
      evidenceField("f11", "performance_end_date", "2026-09-05", periodSentence),
    ];
    const preview = previewSafeAcceptance(fields, []);
    expect(preview.eligible).toHaveLength(11);
    expect(preview.blocked).toHaveLength(0);
  });

  it("keeps a field with a real conflict blocked even when its own evidence matches", () => {
    const decision = assessSafeAcceptance(
      field({
        field_name: "contact_email",
        structured_value: { normalizedValue: "ivan@example.ru", rawValue: "ivan@example.ru" },
        raw_value: "ivan@example.ru",
        source_excerpt: "E-mail: ivan@example.ru",
        conflict_detected: true,
      }),
      [
        {
          field_name: "contact_email",
          requires_review: true,
          candidates: [
            {
              normalizedValue: "ivan@example.ru",
              rawValue: "ivan@example.ru",
              sourceExcerpt: "E-mail: ivan@example.ru",
            },
            {
              normalizedValue: "petrov@example.ru",
              rawValue: "petrov@example.ru",
              sourceExcerpt: "E-mail: petrov@example.ru",
            },
          ],
        },
      ],
    );
    expect(decision).toEqual(
      expect.objectContaining({ eligible: false, reason: "TRUE_CONFLICT" }),
    );
  });
});
