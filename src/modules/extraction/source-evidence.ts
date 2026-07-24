import { normalizeDate } from "./preprocessing";

export type SourceEvidenceReason =
  | "MISSING_ATTRIBUTION"
  | "NO_VALUE"
  | "LABELED_LINE_MATCH"
  | "ADJACENT_LABELED_BLOCK"
  | "FULL_TEXT_MATCH"
  | "STRICT_PATTERN_MATCH"
  | "DATE_RANGE_POSITION_MATCH"
  | "NO_EVIDENCE_PATTERN"
  | "VALUE_MISMATCH"
  | "AMBIGUOUS_EVIDENCE"
  | "NUMERIC_ONLY_VALUE_REJECTED"
  | "NO_FIELD_SPECIFIC_RULE";

export type SourceEvidenceResult = {
  matched: boolean;
  evidenceType: string | null;
  normalizedEvidence: string | number | null;
  reason: SourceEvidenceReason;
};

export type SourceEvidenceField = {
  field_name: string;
  structured_value: Record<string, unknown> | null;
  raw_value: string | null;
  source_type: string | null;
  source_id: string | null;
  source_marker: string | null;
  source_excerpt: string | null;
};

// Single source of truth for "is this line labeled for this field", shared by
// the safe-acceptance evidence check below and by conflict-candidate
// relevance filtering in ./acceptance. Every field name keeps its original
// strict pattern; only the fields called out for field-specific evidence
// rules gained additional recognized label synonyms. No pattern was removed
// or loosened — this only widens which label spellings count as "the same
// label", the same-line + exact-value requirement is untouched.
export const labelPatterns: Record<string, RegExp> = {
  legal_name: /(?:полное\s+наименование|legal_name)\s*:/iu,
  short_name: /(?:краткое\s+наименование|short_name)\s*:/iu,
  inn: /инн\s*:/iu,
  kpp: /кпп\s*:/iu,
  ogrn: /огрн\s*:/iu,
  legal_address: /(?:юридический\s+адрес|legal_address)\s*:/iu,
  actual_address: /(?:фактический\s+адрес|actual_address)\s*:/iu,
  bank_name: /(?:наименование\s+банка|банк\s+получателя|банк|bank_name)\s*:/iu,
  bank_account: /(?:расч[её]тный\s+сч[её]т|bank_account|р\/с)\s*:/iu,
  correspondent_account:
    /(?:корреспондентский\s+сч[её]т|correspondent_account|к\/с)\s*:/iu,
  bik: /бик\s*:/iu,
  contact_name: /(?:контактное\s+лицо|contact_name)\s*:/iu,
  contact_email: /(?:контактный\s+email|e[-\s]?mail|электронная\s+почта|contact_email)\s*:/iu,
  contact_phone: /(?:контактный\s+телефон|телефон|contact_phone)\s*:/iu,
  signer_name: /(?:подписант|фио\s+подписанта|signer_name)\s*:/iu,
  signer_position: /(?:должность\s+подписанта|должность|руководитель|подписант)\s*:/iu,
  signer_authority: /(?:основание\s+полномочий|signer_authority)\s*:/iu,
  authority_document: /(?:документ\s+о\s+полномочиях|authority_document)\s*:/iu,
  authority_date: /(?:дата\s+документа|authority_date)\s*:/iu,
  authority_number: /(?:номер\s+документа|authority_number)\s*:/iu,
  contract_subject: /(?:предмет\s+договора|предмет\s+услуг|описание\s+услуг|перечень\s+услуг|contract_subject)\s*:/iu,
  contract_amount: /(?:стоимость(?:\s+услуг)?|сумма(?:\s+договора)?|contract_amount)\s*:/iu,
  currency: /(?:валюта|currency)\s*:/iu,
  performance_start_date: /(?:дата\s+начала|performance_start_date)\s*:/iu,
  performance_end_date: /(?:дата\s+окончания|performance_end_date)\s*:/iu,
  performance_period_text:
    /(?:срок\s+оказания\s+услуг|срок\s+исполнения|период\s+оказания\s+услуг|период\s+исполнения|performance_period_text)\s*:/iu,
  payment_terms: /(?:условия\s+оплаты|порядок\s+оплаты|оплата|payment_terms)\s*:/iu,
  payment_due_days: /(?:срок\s+оплаты|payment_due_days)\s*:/iu,
  advance_percentage: /(?:аванс|advance_percentage)\s*:/iu,
  contract_date: /(?:дата\s+договора|contract_date)\s*:/iu,
  additional_conditions:
    /(?:дополнительные\s+условия|результат\s+оказания\s+услуг|результат\s+работ|формат\s+передачи\s+результата|additional_conditions)\s*:/iu,
};

const RUSSIAN_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[«»„""'']/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

function excerptLines(excerpt: string) {
  return excerpt.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function valueOf(field: SourceEvidenceField) {
  return field.structured_value?.normalizedValue ?? field.raw_value;
}

function rawEvidence(field: SourceEvidenceField) {
  return field.structured_value?.rawValue ?? field.raw_value ?? valueOf(field);
}

function notMatched(reason: SourceEvidenceReason): SourceEvidenceResult {
  return { matched: false, evidenceType: null, normalizedEvidence: null, reason };
}

function matchedResult(
  evidenceType: string,
  normalizedEvidence: string | number | null,
  reason: SourceEvidenceReason,
): SourceEvidenceResult {
  return { matched: true, evidenceType, normalizedEvidence, reason };
}

// The original strict check: the field's raw evidence must appear, verbatim
// after normalization, on a line that itself carries one of the field's
// recognized labels. Tried first for every field, including the 11 fields
// below — many of them only needed a wider label vocabulary to pass this,
// nothing more permissive.
function strictLabeledLineMatch(
  fieldName: string,
  excerpt: string,
  raw: string,
): SourceEvidenceResult | null {
  const pattern = labelPatterns[fieldName];
  if (!pattern) return null;
  const normalizedRaw = normalizeText(raw);
  if (!normalizedRaw) return null;
  if (!normalizeText(excerpt).includes(normalizedRaw)) return null;
  const hasLabeledLine = excerpt
    .split(/\r?\n/u)
    .some((line) => pattern.test(line) && normalizeText(line).includes(normalizedRaw));
  return hasLabeledLine ? matchedResult("labeled_line", normalizedRaw, "LABELED_LINE_MATCH") : null;
}

// signer_position: the label and the actual position may sit on two
// consecutive lines of the same "signer block" (e.g. "Подписант: ...\nДолжность: ...").
function assessSignerPosition(rawValue: string, excerpt: string): SourceEvidenceResult {
  const target = normalizeText(rawValue);
  if (!target) return notMatched("NO_VALUE");
  const pattern = labelPatterns.signer_position;
  const lines = excerptLines(excerpt);
  for (let index = 0; index < lines.length; index += 1) {
    if (!pattern.test(lines[index])) continue;
    if (normalizeText(lines[index]).includes(target)) {
      return matchedResult("adjacent_block", target, "LABELED_LINE_MATCH");
    }
    const next = lines[index + 1];
    if (next && normalizeText(next).includes(target)) {
      return matchedResult("adjacent_block", target, "ADJACENT_LABELED_BLOCK");
    }
  }
  return notMatched("NO_EVIDENCE_PATTERN");
}

// contract_subject / additional_conditions / performance_period_text /
// payment_terms: these are full descriptive sentences rather than short
// tokens. When the label is not on the exact same line as the whole text
// (e.g. it wraps), fall back to requiring the complete normalized value to
// appear verbatim anywhere in the excerpt — never a partial/paraphrased
// match, and never confidence-only.
function assessFullTextField(rawValue: string, excerpt: string): SourceEvidenceResult {
  const target = normalizeText(rawValue);
  if (!target || target.length < 3) return notMatched("NO_VALUE");
  if (!normalizeText(excerpt).includes(target)) return notMatched("NO_EVIDENCE_PATTERN");
  return matchedResult("full_text", target, "FULL_TEXT_MATCH");
}

function normalizePercentText(value: unknown) {
  const text = String(value ?? "").trim().replace(",", ".");
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  return String(number);
}

// advance_percentage is frequently a number embedded inside the payment_terms
// sentence rather than its own labeled line. Require the exact percentage to
// sit immediately next to an advance/prepayment word — a bare number that
// happens to also appear in an amount, date, or requisite never matches,
// because those never carry "аванс"/"предоплата" next to them.
function assessAdvancePercentage(rawValue: string, excerpt: string): SourceEvidenceResult {
  const canonical = normalizePercentText(rawValue);
  if (canonical === null) return notMatched("NO_VALUE");
  const num = escapeRegExp(canonical);
  const pattern = new RegExp(
    `(?:(?<!\\d)${num}(?:[.,]0+)?\\s*%\\s*(?:предоплат\\w*|аванс\\w*)` +
      `|(?:предоплат|аванс)\\w*[^%\\d\\n]{0,20}(?<!\\d)${num}(?:[.,]0+)?\\s*%)`,
    "iu",
  );
  if (!pattern.test(excerpt)) return notMatched("NO_EVIDENCE_PATTERN");
  return matchedResult("derived_percentage", canonical, "STRICT_PATTERN_MATCH");
}

// payment_due_days: the number must sit immediately next to "дней"/"рабочих
// дней". If more than one distinct day-count shows up in the excerpt the
// evidence is ambiguous and the field stays on manual review; the same
// number repeated is not a conflict.
function assessPaymentDueDays(rawValue: string, excerpt: string): SourceEvidenceResult {
  const target = String(rawValue).trim();
  if (!/^\d{1,4}$/u.test(target)) return notMatched("NO_VALUE");
  // Note: a trailing `\b` would silently fail here — JS treats Cyrillic
  // letters as non-word characters, so `\b` right after "дней" never matches.
  const dayPattern =
    /(?<!\d)(\d{1,4})(?!\d)\s*(?:\([^)]{0,30}\)\s*)?(?:рабочих\s+|календарных\s+)?дн(?:я|ей|е)?(?![а-яё])/giu;
  const found = new Set<string>();
  for (const match of excerpt.matchAll(dayPattern)) {
    found.add(match[1]);
  }
  if (found.size === 0) return notMatched("NO_EVIDENCE_PATTERN");
  if (found.size > 1) return notMatched("AMBIGUOUS_EVIDENCE");
  const [only] = found;
  if (only !== target) return notMatched("VALUE_MISMATCH");
  return matchedResult("derived_days", only, "STRICT_PATTERN_MATCH");
}

function parseRussianTextDate(text: string): string | null {
  const match = /(\d{1,2})\s+([а-яё]+)\s+(\d{4})/iu.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const monthIndex = RUSSIAN_MONTHS.findIndex(
    (name) => name === match[2].toLocaleLowerCase("ru-RU"),
  );
  if (monthIndex === -1) return null;
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, monthIndex, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== monthIndex ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const PERIOD_RANGE_PATTERN =
  /с\s+(\d{1,2}\s+[а-яё]+\s+\d{4})(?:\s*года?)?\s+(?:по|до)\s+(\d{1,2}\s+[а-яё]+\s+\d{4})(?:\s*года?)?/giu;

// performance_start_date / performance_end_date: deterministically read a
// single "с <date> по <date>" sentence. First date is always the start,
// second is always the end; a reversed or ambiguous (more than one range, or
// only one date) excerpt is left on manual review rather than guessed.
function assessPerformanceDateRange(
  fieldName: "performance_start_date" | "performance_end_date",
  rawValue: string,
  excerpt: string,
): SourceEvidenceResult {
  const matches = [...excerpt.matchAll(PERIOD_RANGE_PATTERN)];
  if (matches.length !== 1) {
    return notMatched(matches.length === 0 ? "NO_EVIDENCE_PATTERN" : "AMBIGUOUS_EVIDENCE");
  }
  const [, startText, endText] = matches[0];
  const startIso = parseRussianTextDate(startText);
  const endIso = parseRussianTextDate(endText);
  if (!startIso || !endIso) return notMatched("NO_EVIDENCE_PATTERN");
  if (startIso >= endIso) return notMatched("AMBIGUOUS_EVIDENCE");
  const target = fieldName === "performance_start_date" ? startIso : endIso;
  const valueIso = normalizeDate(String(rawValue));
  if (!valueIso || valueIso !== target) return notMatched("VALUE_MISMATCH");
  return matchedResult("date_range_position", target, "DATE_RANGE_POSITION_MATCH");
}

export function assessSourceEvidence(field: SourceEvidenceField): SourceEvidenceResult {
  if (
    !field.source_type ||
    field.source_type === "manual" ||
    !field.source_id ||
    !field.source_marker ||
    !field.source_excerpt
  ) {
    return notMatched("MISSING_ATTRIBUTION");
  }
  const raw = String(rawEvidence(field) ?? "").trim();
  if (!raw) return notMatched("NO_VALUE");
  const excerpt = field.source_excerpt;

  // payment_terms must always be the full condition text: reject a bare
  // number before it ever gets the chance to match as a same-line substring
  // of a longer labeled line.
  if (field.field_name === "payment_terms" && /^[\d\s%.,]+$/u.test(normalizeText(raw))) {
    return notMatched("NUMERIC_ONLY_VALUE_REJECTED");
  }

  const strict = strictLabeledLineMatch(field.field_name, excerpt, raw);
  if (strict) return strict;

  switch (field.field_name) {
    case "signer_position":
      return assessSignerPosition(raw, excerpt);
    case "contract_subject":
    case "performance_period_text":
    case "additional_conditions":
    case "payment_terms":
      return assessFullTextField(raw, excerpt);
    case "advance_percentage":
      return assessAdvancePercentage(raw, excerpt);
    case "payment_due_days":
      return assessPaymentDueDays(raw, excerpt);
    case "performance_start_date":
    case "performance_end_date":
      return assessPerformanceDateRange(field.field_name, raw, excerpt);
    default:
      return notMatched("NO_FIELD_SPECIFIC_RULE");
  }
}
