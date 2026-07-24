import { describe, expect, it } from "vitest";

import { assessSourceEvidence, type SourceEvidenceField } from "./source-evidence";

const sourceId = "11111111-1111-4111-8111-111111111111";

function field(
  fieldName: string,
  value: string | number,
  excerpt: string,
  overrides: Partial<SourceEvidenceField> = {},
): SourceEvidenceField {
  return {
    field_name: fieldName,
    structured_value: {
      value,
      normalizedValue: value,
      rawValue: String(value),
    },
    raw_value: String(value),
    source_type: "email_message",
    source_id: sourceId,
    source_marker: "[EMAIL BODY]",
    source_excerpt: excerpt,
    ...overrides,
  };
}

describe("assessSourceEvidence — the 11 previously SOURCE_REQUIRED fields", () => {
  it("confirms contact_email from an E-mail label", () => {
    const result = assessSourceEvidence(
      field(
        "contact_email",
        "ivan.petrov@example.ru",
        "Контактное лицо: Иванов И.И.\nE-mail: ivan.petrov@example.ru\nТелефон: +7 999 123 45 67",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: true, reason: "LABELED_LINE_MATCH" }),
    );
  });

  it("confirms bank_name from 'Банк получателя', ignoring typographic quotes", () => {
    const result = assessSourceEvidence(
      field(
        "bank_name",
        "ПАО Сбербанк",
        "Банк получателя: «ПАО Сбербанк»\nБИК: 044525225",
      ),
    );
    expect(result.matched).toBe(true);
  });

  it("confirms signer_position from an adjacent line in the signer block", () => {
    const result = assessSourceEvidence(
      field(
        "signer_position",
        "Генеральный директор",
        "Подписант: Иванов Иван Иванович\nДолжность подписанта:\nГенеральный директор",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: true, reason: "ADJACENT_LABELED_BLOCK" }),
    );
  });

  it("confirms contract_subject via full-text match when the label wraps", () => {
    const result = assessSourceEvidence(
      field(
        "contract_subject",
        "Оказание бухгалтерских услуг по ведению учета и сдаче отчетности",
        "Предмет услуг:\nОказание бухгалтерских услуг по ведению учета и сдаче отчетности",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: true, reason: "FULL_TEXT_MATCH" }),
    );
  });

  it("confirms additional_conditions via full-text match", () => {
    const result = assessSourceEvidence(
      field(
        "additional_conditions",
        "Ежемесячный отчет и сданная отчетность в налоговую инспекцию",
        "Результат оказания услуг:\nЕжемесячный отчет и сданная отчетность в налоговую инспекцию",
      ),
    );
    expect(result.matched).toBe(true);
  });

  it("confirms payment_terms as the full condition sentence", () => {
    const result = assessSourceEvidence(
      field(
        "payment_terms",
        "50% предоплата, оставшаяся часть в течение 5 рабочих дней после подписания акта выполненных работ",
        "Условия оплаты: 50% предоплата, оставшаяся часть в течение 5 рабочих дней после подписания акта выполненных работ",
      ),
    );
    expect(result.matched).toBe(true);
  });

  it("confirms advance_percentage derived from the payment_terms sentence", () => {
    const result = assessSourceEvidence(
      field(
        "advance_percentage",
        50,
        "Условия оплаты: 50% предоплата, оставшаяся часть в течение 5 рабочих дней после подписания акта.",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: true, evidenceType: "derived_percentage" }),
    );
  });

  it("confirms payment_due_days derived from the payment_terms sentence", () => {
    const result = assessSourceEvidence(
      field(
        "payment_due_days",
        5,
        "Условия оплаты: 50% предоплата, оставшаяся часть в течение 5 рабочих дней после подписания акта.",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: true, evidenceType: "derived_days" }),
    );
  });

  it("confirms performance_period_text via full-text match", () => {
    const result = assessSourceEvidence(
      field(
        "performance_period_text",
        "с 5 августа 2026 года по 5 сентября 2026 года",
        "Период оказания услуг:\nс 5 августа 2026 года по 5 сентября 2026 года",
      ),
    );
    expect(result.matched).toBe(true);
  });

  it("confirms performance_start_date as the first date in a 'с X по Y' range", () => {
    const result = assessSourceEvidence(
      field(
        "performance_start_date",
        "2026-08-05",
        "Срок оказания услуг: с 5 августа 2026 года по 5 сентября 2026 года",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({
        matched: true,
        reason: "DATE_RANGE_POSITION_MATCH",
        normalizedEvidence: "2026-08-05",
      }),
    );
  });

  it("confirms performance_end_date as the second date in a 'с X по Y' range", () => {
    const result = assessSourceEvidence(
      field(
        "performance_end_date",
        "2026-09-05",
        "Срок оказания услуг: с 5 августа 2026 года по 5 сентября 2026 года",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({
        matched: true,
        reason: "DATE_RANGE_POSITION_MATCH",
        normalizedEvidence: "2026-09-05",
      }),
    );
  });
});

describe("assessSourceEvidence — required negative cases", () => {
  it("rejects a contact_email that does not match the address in evidence", () => {
    const result = assessSourceEvidence(
      field(
        "contact_email",
        "ivan.petrov@example.com",
        "Контактное лицо: Иванов И.И.\nE-mail: ivan.petrov@example.ru\nТелефон: +7 999 123 45 67",
      ),
    );
    expect(result.matched).toBe(false);
  });

  it("rejects a bank_name absent from the evidence line", () => {
    const result = assessSourceEvidence(
      field("bank_name", "ПАО Сбербанк", "Банк получателя:\nБИК: 044525225"),
    );
    expect(result.matched).toBe(false);
  });

  it("rejects advance_percentage when 50 only appears inside a sum", () => {
    const result = assessSourceEvidence(
      field(
        "advance_percentage",
        50,
        "Сумма договора: 150000 рублей. Оплата в течение 5 рабочих дней после подписания акта.",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: false, reason: "NO_EVIDENCE_PATTERN" }),
    );
  });

  it("rejects payment_due_days when 5 only appears inside a date", () => {
    const result = assessSourceEvidence(
      field(
        "payment_due_days",
        5,
        "Договор действует с 5 августа 2026 года по 5 сентября 2026 года. Оплата после выполнения работ.",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: false, reason: "NO_EVIDENCE_PATTERN" }),
    );
  });

  it("rejects payment_due_days when the source contains conflicting periods (5 and 10 days)", () => {
    const result = assessSourceEvidence(
      field(
        "payment_due_days",
        5,
        "Оплата: 5 рабочих дней после отгрузки первой партии, повторная поставка — 10 календарных дней.",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: false, reason: "AMBIGUOUS_EVIDENCE" }),
    );
  });

  it("does not treat the same day count repeated twice as ambiguous", () => {
    const result = assessSourceEvidence(
      field(
        "payment_due_days",
        5,
        "Оплата в течение 5 рабочих дней. Просрочка свыше 5 рабочих дней влечёт пени.",
      ),
    );
    expect(result.matched).toBe(true);
  });

  it("leaves performance_start_date on review when the range has only one date", () => {
    const result = assessSourceEvidence(
      field(
        "performance_start_date",
        "2026-09-05",
        "Срок оказания услуг: до 5 сентября 2026 года",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: false, reason: "NO_EVIDENCE_PATTERN" }),
    );
  });

  it("rejects performance_start_date when it does not match the normalized source range", () => {
    const result = assessSourceEvidence(
      field(
        "performance_start_date",
        "2026-08-06",
        "Срок оказания услуг: с 5 августа 2026 года по 5 сентября 2026 года",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: false, reason: "VALUE_MISMATCH" }),
    );
  });

  it("rejects contract_subject when the evidence is only semantically similar, not literal", () => {
    const result = assessSourceEvidence(
      field(
        "contract_subject",
        "Ведение бухгалтерского учета",
        "Предмет услуг: Оказание бухгалтерских услуг по ведению учета и сдаче отчетности",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: false, reason: "NO_EVIDENCE_PATTERN" }),
    );
  });

  it("rejects a bare number as payment_terms evidence", () => {
    const result = assessSourceEvidence(
      field(
        "payment_terms",
        "50",
        "Условия оплаты: 50% предоплата, оставшаяся часть в течение 5 рабочих дней после подписания акта.",
      ),
    );
    expect(result).toEqual(
      expect.objectContaining({ matched: false, reason: "NUMERIC_ONLY_VALUE_REJECTED" }),
    );
  });
});
