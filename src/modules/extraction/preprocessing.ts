import { createHash } from "node:crypto";

import {
  EXTRACTION_MODEL,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SCHEMA_VERSION,
  MAX_EXTRACTION_INPUT_CHARACTERS,
  MAX_FRAGMENT_CHARACTERS,
  NORMALIZED_TEXT_VERSION,
  type ExtractionFieldName,
} from "./constants";
import type {
  DeterministicCandidate,
  ExtractionSource,
  SelectedFragment,
} from "./types";

const keywordPattern =
  /(реквизит|инн|кпп|огрн|бик|расч[её]тн|корреспондент|банк|адрес|сторон|заказчик|исполнитель|подписант|директор|основани|предмет|стоимост|цен[аы]|сумм|срок|период|оплат|аванс|contract|party|signer|subject|amount|payment|bank|address)/iu;

const patterns: Array<{
  kind: DeterministicCandidate["kind"];
  fieldName: ExtractionFieldName | null;
  pattern: RegExp;
}> = [
  { kind: "inn", fieldName: "inn", pattern: /(?<!\d)\d{10}(?:\d{2})?(?!\d)/gu },
  { kind: "kpp", fieldName: "kpp", pattern: /(?<![0-9A-ZА-Я])\d{4}[0-9A-ZА-Я]{2}\d{3}(?![0-9A-ZА-Я])/giu },
  { kind: "ogrn", fieldName: "ogrn", pattern: /(?<!\d)\d{13}(?:\d{2})?(?!\d)/gu },
  { kind: "bik", fieldName: "bik", pattern: /(?<!\d)\d{9}(?!\d)/gu },
  {
    kind: "bank_account",
    fieldName: "bank_account",
    pattern: /(?<!\d)\d{20}(?!\d)/gu,
  },
  {
    kind: "email",
    fieldName: "contact_email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  },
  {
    kind: "phone",
    fieldName: "contact_phone",
    pattern: /(?<!\d)(?:\+7|8)[\s()-]*\d{3}[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/gu,
  },
  {
    kind: "date",
    fieldName: null,
    pattern: /(?<!\d)(?:\d{2}[./-]\d{2}[./-]\d{4}|\d{4}-\d{2}-\d{2})(?!\d)/gu,
  },
  {
    kind: "amount",
    fieldName: "contract_amount",
    pattern: /(?<!\d)\d+(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})?(?!\d)/gu,
  },
  {
    kind: "currency",
    fieldName: "currency",
    pattern: /\b(?:RUB|USD|EUR|CNY|руб(?:\.|лей|ля)?|₽|\$|€)\b/giu,
  },
];

function digits(value: string) {
  return value.replace(/\D/gu, "");
}

export function validateInn(value: string) {
  const input = digits(value);
  if (new Set(input).size < 2) return false;
  const checksum = (numbers: number[], coefficients: number[]) =>
    coefficients.reduce((sum, coefficient, index) => sum + coefficient * numbers[index], 0) %
    11 %
    10;
  const numbers = [...input].map(Number);

  if (input.length === 10) {
    return checksum(numbers, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === numbers[9];
  }
  if (input.length === 12) {
    return (
      checksum(numbers, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === numbers[10] &&
      checksum(numbers, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === numbers[11]
    );
  }
  return false;
}

export function validateOgrn(value: string) {
  const input = digits(value);
  if (new Set(input).size < 2) return false;
  if (input.length === 13) {
    return Number(input.slice(0, 12)) % 11 % 10 === Number(input[12]);
  }
  if (input.length === 15) {
    return Number(input.slice(0, 14)) % 13 % 10 === Number(input[14]);
  }
  return false;
}

export function validateKpp(value: string) {
  return /^\d{4}[0-9A-ZА-Я]{2}\d{3}$/iu.test(value.trim());
}

export function validateBik(value: string) {
  const input = digits(value);
  return /^\d{9}$/u.test(input) && new Set(input).size > 1;
}

export function validateAccount(value: string) {
  const input = digits(value);
  return /^\d{20}$/u.test(input) && new Set(input).size > 1;
}

export function normalizeDate(value: string): string | null {
  const compact = value.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(compact);
  const local = /^(\d{2})[./-](\d{2})[./-](\d{4})$/u.exec(compact);
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (local) {
    day = Number(local[1]);
    month = Number(local[2]);
    year = Number(local[3]);
  } else {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeAmount(value: string): string | null {
  const normalized = value
    .trim()
    .replace(
      /(?:RUB|РУБ(?:\.|ЛЕЙ|ЛЯ|ЛЬ)?|РОССИЙСКИХ?\s+РУБЛ(?:ЕЙ|Я|Ь)?|₽)/giu,
      "",
    )
    .replace(/[.;:]+$/u, "")
    .replace(/[\s\u00a0]/gu, "")
    .replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) {
    return null;
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return normalized;
}

function nearbyLabel(text: string, offset: number) {
  const lineStart = Math.max(
    text.lastIndexOf("\n", offset - 1),
    text.lastIndexOf("\r", offset - 1),
  ) + 1;
  return text.slice(lineStart, offset).slice(-100);
}

function labeledField(
  kind: DeterministicCandidate["kind"],
  text: string,
  offset: number,
) {
  const label = nearbyLabel(text, offset);
  switch (kind) {
    case "kpp":
      return /(?:КПП|KPP)\s*[:№-]?\s*$/iu.test(label);
    case "bik":
      return /(?:БИК|BIK)\s*[:№-]?\s*$/iu.test(label);
    case "bank_account":
      return /(?:РАСЧ[ЕЁ]ТН(?:ЫЙ|ОГО)\s+СЧ[ЕЁ]Т|Р\/С|КОРР(?:\.|ЕСПОНДЕНТСКИЙ)\s+СЧ[ЕЁ]Т|К\/С|BANK\s+ACCOUNT)\s*[:№-]?\s*$/iu.test(label);
    case "amount":
      return /(?:СТОИМОСТЬ(?:\s+УСЛУГ)?|СУММА(?:\s+ДОГОВОРА)?|ЦЕНА|CONTRACT_AMOUNT|AMOUNT)\s*[:№-]?\s*$/iu.test(label);
    default:
      return true;
  }
}

export function normalizeCurrency(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (/^(RUB|РУБ(?:\.|ЛЕЙ|ЛЯ)?|₽)$/u.test(normalized)) return "RUB";
  if (/^(USD|\$)$/u.test(normalized)) return "USD";
  if (/^(EUR|€)$/u.test(normalized)) return "EUR";
  if (normalized === "CNY") return "CNY";
  return null;
}

function validateAndNormalize(kind: DeterministicCandidate["kind"], value: string) {
  switch (kind) {
    case "inn":
      return { valid: validateInn(value), normalized: digits(value) };
    case "kpp":
      return { valid: validateKpp(value), normalized: value.trim().toUpperCase() };
    case "ogrn":
      return { valid: validateOgrn(value), normalized: digits(value) };
    case "bik":
      return { valid: validateBik(value), normalized: digits(value) };
    case "bank_account":
    case "correspondent_account":
      return { valid: validateAccount(value), normalized: digits(value) };
    case "email": {
      const normalized = value.trim().toLowerCase();
      return {
        valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized),
        normalized,
      };
    }
    case "phone": {
      const normalized = digits(value).replace(/^8/u, "7");
      return { valid: normalized.length === 11 && normalized.startsWith("7"), normalized: `+${normalized}` };
    }
    case "date": {
      const normalized = normalizeDate(value);
      return { valid: normalized !== null, normalized: normalized ?? value.trim() };
    }
    case "amount": {
      const normalized = normalizeAmount(value);
      return { valid: normalized !== null, normalized: normalized ?? value.trim() };
    }
    case "currency": {
      const normalized = normalizeCurrency(value);
      return { valid: normalized !== null, normalized: normalized ?? value.trim() };
    }
  }
}

function markerAt(text: string, offset: number, fallback: string) {
  const before = text.slice(0, offset);
  const markerMatches = [...before.matchAll(/^\[(?:PAGE|SHEET|ROW|DOCUMENT)[^\]]*\]/gimu)];
  return markerMatches.at(-1)?.[0] ?? fallback;
}

function excerptAt(text: string, start: number, length: number) {
  const from = Math.max(0, start - 180);
  const to = Math.min(text.length, start + length + 180);
  return text.slice(from, to).replace(/\s+/gu, " ").trim().slice(0, 500);
}

export function findDeterministicCandidates(sources: ExtractionSource[]) {
  const candidates: DeterministicCandidate[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const definition of patterns) {
      for (const match of source.text.matchAll(definition.pattern)) {
        if (match.index === undefined) continue;
        if (!labeledField(definition.kind, source.text, match.index)) continue;
        const checked = validateAndNormalize(definition.kind, match[0]);
        let fieldName = definition.fieldName;
        if (definition.kind === "bank_account") {
          const label = nearbyLabel(source.text, match.index);
          if (/(?:КОРР(?:\.|ЕСПОНДЕНТСКИЙ)\s+СЧ[ЕЁ]Т|К\/С)\s*[:№-]?\s*$/iu.test(label)) {
            fieldName = "correspondent_account";
          }
        }
        const key = `${source.sourceId}:${definition.kind}:${checked.normalized}:${match.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          fieldName,
          kind: definition.kind,
          value: match[0],
          normalizedValue: checked.normalized,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceMarker: markerAt(source.text, match.index, source.sourceMarker),
          sourceExcerpt: excerptAt(source.text, match.index, match[0].length),
          validatorValid: checked.valid,
          confidenceSource: checked.valid ? "regex_validated" : "regex_unvalidated",
          requiresReview: true,
        });
      }
    }
  }
  return candidates;
}

function sourceBlocks(source: ExtractionSource) {
  const lines = source.text.split(/\r?\n/u);
  const blocks: Array<{ marker: string; text: string }> = [];
  let marker = source.sourceMarker;
  let current: string[] = [];
  const flush = () => {
    const text = current.join("\n").trim();
    if (text) blocks.push({ marker, text });
    current = [];
  };
  for (const line of lines) {
    if (/^\[(?:PAGE|SHEET|DOCUMENT)[^\]]*\]/iu.test(line.trim())) {
      flush();
      marker = line.trim();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

export function selectRelevantFragments(
  sources: ExtractionSource[],
  candidates: DeterministicCandidate[],
  maxCharacters = MAX_EXTRACTION_INPUT_CHARACTERS,
) {
  const selected: SelectedFragment[] = [];
  const seen = new Set<string>();
  let used = 0;

  for (const source of sources) {
    for (const block of sourceBlocks(source)) {
      const hasCandidate = candidates.some(
        (candidate) =>
          candidate.sourceId === source.sourceId &&
          (candidate.sourceMarker === block.marker || block.text.includes(candidate.value)),
      );
      if (!hasCandidate && !keywordPattern.test(block.text)) continue;
      const text = block.text.slice(0, MAX_FRAGMENT_CHARACTERS).trim();
      const key = createHash("sha256").update(`${source.sourceId}:${block.marker}:${text}`).digest("hex");
      if (!text || seen.has(key)) continue;
      const cost = text.length + block.marker.length + 120;
      if (used + cost > maxCharacters) break;
      seen.add(key);
      used += cost;
      selected.push({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceMarker: block.marker,
        text,
      });
    }
  }

  if (selected.length === 0) {
    for (const source of sources) {
      const text = source.text.slice(0, Math.min(MAX_FRAGMENT_CHARACTERS, maxCharacters - used)).trim();
      if (!text) continue;
      selected.push({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceMarker: source.sourceMarker,
        text,
      });
      used += text.length;
      if (used >= maxCharacters) break;
    }
  }
  return selected;
}

export function chunkFragments(fragments: SelectedFragment[], maxCharacters = 30_000) {
  const chunks: SelectedFragment[][] = [];
  let current: SelectedFragment[] = [];
  let used = 0;
  for (const fragment of fragments) {
    const cost = fragment.text.length + 200;
    if (current.length > 0 && used + cost > maxCharacters) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(fragment);
    used += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function formatFragments(fragments: SelectedFragment[]) {
  return fragments
    .map(
      (fragment) =>
        `<SOURCE type="${fragment.sourceType}" id="${fragment.sourceId}" marker="${fragment.sourceMarker}">\n${fragment.text}\n</SOURCE>`,
    )
    .join("\n\n");
}

export function formatCandidates(candidates: DeterministicCandidate[]) {
  return candidates
    .map(
      (candidate) =>
        JSON.stringify({
          fieldName: candidate.fieldName,
          kind: candidate.kind,
          value: candidate.value,
          normalizedValue: candidate.normalizedValue,
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          sourceMarker: candidate.sourceMarker,
          validatorValid: candidate.validatorValid,
          requiresReview: true,
        }),
    )
    .join("\n");
}

export function createExtractionFingerprint(sources: ExtractionSource[]) {
  const stableSources = [...sources]
    .map((source) => ({
      id: source.sourceId,
      type: source.sourceType,
      checksum: source.checksum,
      parserVersion: source.parserVersion ?? null,
    }))
    .sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
  return createHash("sha256")
    .update(
      JSON.stringify({
        sources: stableSources,
        normalizedTextVersion: NORMALIZED_TEXT_VERSION,
        promptVersion: EXTRACTION_PROMPT_VERSION,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        model: EXTRACTION_MODEL,
      }),
    )
    .digest("hex");
}
