import {
  contractFieldNames,
  extractionFieldNames,
  organizationFieldNames,
  signerFieldNames,
  type ExtractionFieldName,
} from "./constants";
import {
  contractExtractionSchema,
  missingExtractedValue,
  type ContractExtraction,
  type ExtractedValue,
  type ExtractionConflict,
} from "./schema";
import {
  normalizeAmount,
  normalizeCurrency,
  normalizeDate,
  validateAccount,
  validateBik,
  validateInn,
  validateKpp,
  validateOgrn,
} from "./preprocessing";
import type {
  DeterministicCandidate,
  ExtractionSource,
  SelectedFragment,
} from "./types";

type FlatExtraction = Record<ExtractionFieldName, ExtractedValue>;

export function flattenExtraction(extraction: ContractExtraction): FlatExtraction {
  return {
    ...extraction.organization,
    ...extraction.signer,
    ...extraction.contract,
  };
}

export function groupExtraction(
  fields: FlatExtraction,
  conflicts: ExtractionConflict[],
  warnings: string[],
): ContractExtraction {
  const pick = <T extends readonly ExtractionFieldName[]>(names: T) =>
    Object.fromEntries(names.map((name) => [name, fields[name]])) as {
      [K in T[number]]: ExtractedValue;
    };
  return contractExtractionSchema.parse({
    extractionVersion: "contract-extraction-schema-v1",
    organization: pick(organizationFieldNames),
    signer: pick(signerFieldNames),
    contract: pick(contractFieldNames),
    conflicts,
    warnings: [...new Set(warnings)].slice(0, 100),
  });
}

function comparable(value: ExtractedValue) {
  if (value.normalizedValue === null) return null;
  return String(value.normalizedValue).trim().toLocaleLowerCase("ru-RU");
}

export function canonicalComparable(
  fieldName: string,
  value: Pick<ExtractedValue, "normalizedValue" | "value" | "rawValue">,
) {
  const raw = String(value.normalizedValue ?? value.value ?? value.rawValue ?? "").trim();
  if (!raw) return null;
  if (fieldName === "contract_amount") return normalizeAmount(raw);
  if (fieldName === "currency") return normalizeCurrency(raw);
  if (
    fieldName === "performance_start_date" ||
    fieldName === "performance_end_date" ||
    fieldName === "authority_date" ||
    fieldName === "contract_date"
  ) {
    return normalizeDate(raw);
  }
  if (["inn", "kpp", "ogrn", "bik", "bank_account", "correspondent_account"].includes(fieldName)) {
    return raw.replace(/\D/gu, "");
  }
  return raw.replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

function sourceExists(
  value: ExtractedValue,
  sources: ExtractionSource[],
  fragments: SelectedFragment[],
) {
  if (
    value.value === null ||
    !value.sourceId ||
    !value.sourceType ||
    !value.sourceMarker ||
    !value.sourceExcerpt
  ) {
    return false;
  }
  const source = sources.find(
    (item) => item.sourceId === value.sourceId && item.sourceType === value.sourceType,
  );
  if (!source || source.ocrDerived) return false;
  const markerValid = fragments.some(
    (fragment) =>
      fragment.sourceId === value.sourceId &&
      fragment.sourceType === value.sourceType &&
      fragment.sourceMarker === value.sourceMarker,
  );
  const normalizedSource = source.text.replace(/\s+/gu, " ");
  const normalizedExcerpt = value.sourceExcerpt.replace(/\s+/gu, " ").trim();
  return markerValid && normalizedExcerpt.length > 0 && normalizedSource.includes(normalizedExcerpt);
}

export function enforceSourceAttribution(
  extraction: ContractExtraction,
  sources: ExtractionSource[],
  fragments: SelectedFragment[],
) {
  const fields = flattenExtraction(extraction);
  for (const name of extractionFieldNames) {
    const field = fields[name];
    if (field.value === null) {
      fields[name] = {
        ...missingExtractedValue(),
        reason: field.reason ?? "NOT_FOUND",
      };
      continue;
    }
    if (!sourceExists(field, sources, fragments)) {
      fields[name] = {
        ...field,
        confidence: Math.min(field.confidence, 0.2),
        requiresReview: true,
        reason: "SOURCE_REQUIRED",
      };
      continue;
    }
    const textValue = String(field.normalizedValue ?? field.value);
    const valid =
      name === "inn"
        ? validateInn(textValue)
        : name === "kpp"
          ? validateKpp(textValue)
          : name === "ogrn"
            ? validateOgrn(textValue)
            : name === "bik"
              ? validateBik(textValue)
              : name === "bank_account" || name === "correspondent_account"
                ? validateAccount(textValue)
                : name === "performance_start_date" ||
                    name === "performance_end_date" ||
                    name === "authority_date" ||
                    name === "contract_date"
                  ? normalizeDate(textValue) !== null
                  : name === "contract_amount"
                    ? normalizeAmount(textValue) !== null
                    : name === "currency"
                      ? normalizeCurrency(textValue) !== null
                      : true;
    if (!valid) {
      fields[name] = {
        ...field,
        value: null,
        normalizedValue: null,
        confidence: 0,
        requiresReview: true,
        reason: "INVALID_FORMAT",
      };
    }
  }
  return groupExtraction(fields, extraction.conflicts, extraction.warnings);
}

function candidateForField(
  name: ExtractionFieldName,
  candidate: DeterministicCandidate,
): ExtractedValue | null {
  if (candidate.fieldName !== name) return null;
  return {
    value: candidate.value,
    normalizedValue: candidate.normalizedValue,
    rawValue: candidate.value,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    sourceMarker: candidate.sourceMarker,
    sourceExcerpt: candidate.sourceExcerpt,
    confidence: candidate.validatorValid ? 0.9 : 0.25,
    requiresReview: true,
    reason: candidate.validatorValid ? "DIRECT_SOURCE" : "INVALID_FORMAT",
  };
}

export function calculateConfidence(input: {
  value: ExtractedValue;
  deterministicMatch?: DeterministicCandidate;
  explicitLabel: boolean;
  conflict: boolean;
  ocrSource: boolean;
}) {
  let score = 0;
  if (input.value.value !== null) score += 0.2;
  if (input.value.sourceId && input.value.sourceMarker && input.value.sourceExcerpt) score += 0.25;
  if (input.explicitLabel) score += 0.15;
  if (input.deterministicMatch?.validatorValid) score += 0.3;
  else if (input.deterministicMatch) score += 0.05;
  score += Math.min(Math.max(input.value.confidence, 0), 1) * 0.1;
  if (input.conflict) score -= 0.35;
  if (input.ocrSource) score = Math.min(score, 0.35);
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function conflictFromValues(
  fieldName: ExtractionFieldName,
  values: ExtractedValue[],
): ExtractionConflict | null {
  const unique = new Map<string, ExtractedValue>();
  for (const value of values) {
    const key = canonicalComparable(fieldName, value);
    if (key !== null && !unique.has(key)) unique.set(key, value);
  }
  if (unique.size < 2) return null;
  const candidates = [...unique.values()];
  return {
    fieldName,
    candidates,
    sources: candidates.map(
      (candidate) =>
        `${candidate.sourceType ?? "unknown"}:${candidate.sourceId ?? "none"}:${candidate.sourceMarker ?? "none"}`,
    ),
    conflictType: "DIFFERENT_VALUES",
    requiresReview: true,
  };
}

export function mergeExtractions(
  partials: ContractExtraction[],
  deterministicCandidates: DeterministicCandidate[],
) {
  const merged = {} as FlatExtraction;
  const conflicts: ExtractionConflict[] = [];
  const warnings = partials.flatMap((partial) => partial.warnings);

  for (const fieldName of extractionFieldNames) {
    const values = partials
      .map((partial) => flattenExtraction(partial)[fieldName])
      .filter((value) => value.value !== null);
    const deterministic = deterministicCandidates
      .filter((candidate) => candidate.validatorValid)
      .map((candidate) => candidateForField(fieldName, candidate))
      .filter((value): value is ExtractedValue => value !== null);
    const allValues = [...values, ...deterministic];
    const conflict = conflictFromValues(fieldName, allValues);
    if (conflict) conflicts.push(conflict);

    const chosen =
      values.sort((left, right) => right.confidence - left.confidence)[0] ??
      deterministic.sort((left, right) => right.confidence - left.confidence)[0] ??
      missingExtractedValue();
    const match = deterministicCandidates.find(
      (candidate) =>
        candidate.fieldName === fieldName &&
        comparable(chosen) === candidate.normalizedValue.toLocaleLowerCase("ru-RU"),
    );
    const explicitLabel = new RegExp(
      `(?:${fieldName.replaceAll("_", "[ _-]")}|инн|кпп|огрн|бик|сумм|оплат|подписант|адрес)`,
      "iu",
    ).test(chosen.sourceExcerpt ?? "");
    merged[fieldName] = {
      ...chosen,
      confidence: calculateConfidence({
        value: chosen,
        deterministicMatch: match,
        explicitLabel,
        conflict: conflict !== null,
        ocrSource: chosen.reason === "OCR_SOURCE",
      }),
      requiresReview:
        chosen.requiresReview ||
        conflict !== null ||
        chosen.value === null ||
        chosen.reason === "SOURCE_REQUIRED",
      reason: conflict ? "CONFLICT" : chosen.reason,
    };
  }

  const modelConflicts = partials.flatMap((partial) => partial.conflicts);
  for (const conflict of modelConflicts) {
    const canonical = new Set(
      conflict.candidates
        .map((candidate) => canonicalComparable(conflict.fieldName, candidate))
        .filter((value): value is string => value !== null),
    );
    if (
      canonical.size > 1 &&
      !conflicts.some((current) => current.fieldName === conflict.fieldName)
    ) {
      conflicts.push(conflict);
    }
  }
  return groupExtraction(merged, conflicts, warnings);
}

export function serializeFields(extraction: ContractExtraction) {
  const flat = flattenExtraction(extraction);
  const conflicting = new Set(extraction.conflicts.map((conflict) => conflict.fieldName));
  return extractionFieldNames.map((fieldName) => {
    const field = flat[fieldName];
    return {
      field_name: fieldName,
      normalized_value: field.normalizedValue,
      structured_value: field,
      raw_value: field.rawValue,
      source_type: field.sourceType,
      source_id: field.sourceId,
      source_marker: field.sourceMarker,
      source_excerpt: field.sourceExcerpt,
      confidence: field.confidence,
      requires_review: field.requiresReview,
      conflict_detected: conflicting.has(fieldName),
    };
  });
}

export function serializeConflicts(extraction: ContractExtraction) {
  return extraction.conflicts.map((conflict) => ({
    field_name: conflict.fieldName,
    candidates: conflict.candidates,
    sources: conflict.sources,
    conflict_type: conflict.conflictType,
  }));
}
