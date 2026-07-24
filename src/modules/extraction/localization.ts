export const extractionFieldLabelsRu: Record<string, string> = {
  legal_name: "Полное наименование",
  short_name: "Краткое наименование",
  inn: "ИНН",
  kpp: "КПП",
  ogrn: "ОГРН",
  legal_address: "Юридический адрес",
  actual_address: "Фактический адрес",
  bank_name: "Банк",
  bank_account: "Расчётный счёт",
  correspondent_account: "Корреспондентский счёт",
  bik: "БИК",
  contact_name: "Контактное лицо",
  contact_email: "Контактный email",
  contact_phone: "Контактный телефон",
  signer_name: "ФИО подписанта",
  signer_position: "Должность подписанта",
  signer_authority: "Основание полномочий",
  authority_document: "Документ о полномочиях",
  authority_date: "Дата документа о полномочиях",
  authority_number: "Номер документа о полномочиях",
  contract_subject: "Предмет договора",
  contract_amount: "Сумма договора",
  currency: "Валюта",
  performance_start_date: "Дата начала исполнения",
  performance_end_date: "Дата окончания исполнения",
  performance_period_text: "Срок исполнения",
  payment_terms: "Условия оплаты",
  payment_due_days: "Срок оплаты, дней",
  advance_percentage: "Аванс, %",
  contract_date: "Дата договора",
  additional_conditions: "Дополнительные условия",
};

export function extractionFieldLabelRu(fieldName: string) {
  return extractionFieldLabelsRu[fieldName] ?? "Извлечённое поле";
}

export const reviewStatusLabelsRu = {
  accepted: "Подтверждено автоматически",
  conflict: "Найдены разные значения",
  invalid: "Значение не прошло проверку",
  missing: "Значение отсутствует",
  review: "Требуется проверка",
  not_applicable: "Не требуется",
  system_managed: "Назначается автоматически",
  optional_empty: "Необязательное поле",
} as const;

export function extractionReasonRu(reason: string | null | undefined) {
  const labels: Record<string, string> = {
    AMBIGUOUS: "Найдено несколько возможных значений",
    CONFLICT: "Найдены разные значения",
    CONFIDENCE_BELOW_THRESHOLD: "Требуется проверка источника",
    DIRECT_SOURCE: "Значение найдено в источнике",
    INVALID_FORMAT: "Неверный формат",
    MANUAL_REVIEW_REQUIRED: "Требуется проверка",
    NOT_FOUND: "Значение не найдено",
    NOT_APPLICABLE: "Поле не применяется",
    OCR_SOURCE: "Требуется проверка распознанного текста",
    SOURCE_REQUIRED: "Не найден подтверждающий источник",
  };
  return reason ? (labels[reason] ?? "Требуется проверка") : "";
}

export function evidenceReasonRu(reason: string | null | undefined) {
  const labels: Record<string, string> = {
    MISSING_ATTRIBUTION: "не указан источник значения",
    NO_VALUE: "значение отсутствует",
    NO_EVIDENCE_PATTERN: "в тексте источника нет явного текстового подтверждения",
    VALUE_MISMATCH: "значение не совпадает с текстом источника",
    AMBIGUOUS_EVIDENCE: "в источнике найдено несколько разных значений",
    NUMERIC_ONLY_VALUE_REJECTED: "требуется полный текст условия, а не отдельное число",
    NO_FIELD_SPECIFIC_RULE: "требуется проверить источник",
  };
  return reason ? (labels[reason] ?? "требуется проверить источник") : "требуется проверить источник";
}
