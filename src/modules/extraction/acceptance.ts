import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

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
import { canonicalComparable } from "./processing";

export const SAFE_ACCEPTANCE_VALIDATOR_VERSION = "safe-field-acceptance-v1";

export type AcceptanceField = {
  id: string;
  field_name: string;
  structured_value: Record<string, unknown> | null;
  raw_value: string | null;
  source_type: string | null;
  source_id: string | null;
  source_marker: string | null;
  source_excerpt: string | null;
  confidence: number | null;
  requires_review: boolean;
  conflict_detected: boolean;
  manually_corrected: boolean;
  extraction_run_id?: string | null;
  accepted?: boolean;
};

type ConflictRecord = {
  field_name: string;
  candidates: unknown;
  requires_review?: boolean;
};

export type AcceptanceDecision = {
  fieldId: string;
  fieldName: string;
  valueFingerprint: string;
  eligible: boolean;
  resolveConflict: boolean;
  reason:
    | "SAFE_SOURCE_VALIDATED"
    | "MISSING_VALUE"
    | "INVALID_VALUE"
    | "SOURCE_REQUIRED"
    | "TRUE_CONFLICT"
    | "MANUALLY_CONFIRMED"
    | "ALREADY_ACCEPTED"
    | "NOT_APPLICABLE"
    | "SYSTEM_MANAGED";
};

const labelPatterns: Record<string, RegExp> = {
  legal_name: /(?:полное\s+наименование|legal_name)\s*:/iu,
  short_name: /(?:краткое\s+наименование|short_name)\s*:/iu,
  inn: /инн\s*:/iu,
  kpp: /кпп\s*:/iu,
  ogrn: /огрн\s*:/iu,
  legal_address: /(?:юридический\s+адрес|legal_address)\s*:/iu,
  actual_address: /(?:фактический\s+адрес|actual_address)\s*:/iu,
  bank_name: /(?:банк|bank_name)\s*:/iu,
  bank_account: /(?:расч[её]тный\s+сч[её]т|bank_account|р\/с)\s*:/iu,
  correspondent_account:
    /(?:корреспондентский\s+сч[её]т|correspondent_account|к\/с)\s*:/iu,
  bik: /бик\s*:/iu,
  contact_name: /(?:контактное\s+лицо|contact_name)\s*:/iu,
  contact_email: /(?:контактный\s+email|email|contact_email)\s*:/iu,
  contact_phone: /(?:контактный\s+телефон|телефон|contact_phone)\s*:/iu,
  signer_name: /(?:подписант|фио\s+подписанта|signer_name)\s*:/iu,
  signer_position: /(?:должность|signer_position)\s*:/iu,
  signer_authority: /(?:основание\s+полномочий|signer_authority)\s*:/iu,
  authority_document: /(?:документ\s+о\s+полномочиях|authority_document)\s*:/iu,
  authority_date: /(?:дата\s+документа|authority_date)\s*:/iu,
  authority_number: /(?:номер\s+документа|authority_number)\s*:/iu,
  contract_subject: /(?:предмет\s+договора|contract_subject)\s*:/iu,
  contract_amount: /(?:стоимость(?:\s+услуг)?|сумма(?:\s+договора)?|contract_amount)\s*:/iu,
  currency: /(?:валюта|currency)\s*:/iu,
  performance_start_date: /(?:дата\s+начала|performance_start_date)\s*:/iu,
  performance_end_date: /(?:дата\s+окончания|performance_end_date)\s*:/iu,
  performance_period_text: /(?:срок\s+(?:оказания\s+услуг|исполнения)|performance_period_text)\s*:/iu,
  payment_terms: /(?:условия\s+оплаты|payment_terms)\s*:/iu,
  payment_due_days: /(?:срок\s+оплаты|payment_due_days)\s*:/iu,
  advance_percentage: /(?:аванс|advance_percentage)\s*:/iu,
  contract_date: /(?:дата\s+договора|contract_date)\s*:/iu,
  additional_conditions: /(?:дополнительные\s+условия|additional_conditions)\s*:/iu,
};

function valueOf(field: AcceptanceField) {
  return field.structured_value?.normalizedValue ?? field.raw_value;
}

function normalizedEvidence(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

function sourceMatches(field: AcceptanceField) {
  if (
    !field.source_type ||
    field.source_type === "manual" ||
    !field.source_id ||
    !field.source_marker ||
    !field.source_excerpt
  ) return false;
  const excerpt = normalizedEvidence(field.source_excerpt);
  const raw = normalizedEvidence(
    field.structured_value?.rawValue ?? field.raw_value ?? valueOf(field),
  );
  const pattern = labelPatterns[field.field_name];
  if (!pattern || raw.length === 0 || !excerpt.includes(raw)) return false;
  return field.source_excerpt
    .split(/\r?\n/u)
    .some((line) => pattern.test(line) && normalizedEvidence(line).includes(raw));
}

export function fieldValueFingerprint(field: AcceptanceField) {
  const payload = [
    field.field_name,
    String(valueOf(field) ?? ""),
    field.source_type ?? "",
    field.source_id ?? "",
    field.source_marker ?? "",
    field.source_excerpt ?? "",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function validateAcceptanceValue(fieldName: string, value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (fieldName === "inn") return validateInn(text);
  if (fieldName === "kpp") return validateKpp(text);
  if (fieldName === "ogrn") return validateOgrn(text);
  if (fieldName === "bik") return validateBik(text);
  if (fieldName === "bank_account" || fieldName === "correspondent_account") {
    return validateAccount(text);
  }
  if (fieldName === "contract_amount") return normalizeAmount(text) !== null;
  if (fieldName === "currency") return normalizeCurrency(text) !== null;
  if (
    fieldName === "authority_date" ||
    fieldName === "contract_date" ||
    fieldName === "performance_start_date" ||
    fieldName === "performance_end_date"
  ) return normalizeDate(text) !== null;
  if (fieldName === "contact_email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text);
  if (fieldName === "contact_phone") {
    const digits = text.replace(/\D/gu, "").replace(/^8/u, "7");
    return digits.length === 11 && digits.startsWith("7");
  }
  if (fieldName === "payment_due_days") return /^\d{1,4}$/u.test(text);
  if (fieldName === "advance_percentage") {
    const number = Number(text.replace(",", "."));
    return Number.isFinite(number) && number >= 0 && number <= 100;
  }
  return text.length >= 2;
}

function candidateRelevant(fieldName: string, candidate: Record<string, unknown>) {
  const comparable = canonicalComparable(fieldName, {
    normalizedValue: candidate.normalizedValue as string | number | null,
    value: candidate.value as string | number | null,
    rawValue: candidate.rawValue as string | null,
  });
  const excerpt = String(candidate.sourceExcerpt ?? "");
  const pattern = labelPatterns[fieldName];
  const matchingLine = excerpt
    .split(/\r?\n/u)
    .find((line) => pattern?.test(line));
  if (!matchingLine) return false;
  const labeledValue = matchingLine.includes(":")
    ? matchingLine.slice(matchingLine.indexOf(":") + 1)
    : matchingLine;
  const labeledComparable = canonicalComparable(fieldName, {
    normalizedValue: null,
    value: null,
    rawValue: labeledValue,
  });
  return comparable !== null &&
    validateAcceptanceValue(fieldName, comparable) &&
    labeledComparable === comparable;
}

function conflictResolution(
  field: AcceptanceField,
  conflicts: ConflictRecord[],
) {
  const relevant = conflicts
    .filter((conflict) => conflict.field_name === field.field_name && conflict.requires_review !== false)
    .flatMap((conflict) => Array.isArray(conflict.candidates) ? conflict.candidates : [])
    .filter((candidate): candidate is Record<string, unknown> =>
      typeof candidate === "object" && candidate !== null,
    )
    .filter((candidate) => candidateRelevant(field.field_name, candidate));
  if (!field.conflict_detected) return { blocked: false, resolve: false };
  const canonical = new Set(
    relevant
      .map((candidate) => canonicalComparable(field.field_name, {
        normalizedValue: candidate.normalizedValue as string | number | null,
        value: candidate.value as string | number | null,
        rawValue: candidate.rawValue as string | null,
      }))
      .filter((value): value is string => value !== null),
  );
  const current = canonicalComparable(field.field_name, {
    normalizedValue: valueOf(field) as string | number | null,
    value: valueOf(field) as string | number | null,
    rawValue: field.raw_value,
  });
  return {
    blocked: canonical.size !== 1 || !current || !canonical.has(current),
    resolve: canonical.size === 1 && !!current && canonical.has(current),
  };
}

function fieldState(field: AcceptanceField) {
  const state = field.structured_value?.fieldState;
  return typeof state === "string" ? state : null;
}

export function assessSafeAcceptance(
  field: AcceptanceField,
  conflicts: ConflictRecord[] = [],
): AcceptanceDecision {
  const fingerprint = fieldValueFingerprint(field);
  if (field.accepted) {
    return {
      fieldId: field.id, fieldName: field.field_name, valueFingerprint: fingerprint,
      eligible: false, resolveConflict: false, reason: "ALREADY_ACCEPTED",
    };
  }
  if (fieldState(field) === "not_applicable") {
    return {
      fieldId: field.id, fieldName: field.field_name, valueFingerprint: fingerprint,
      eligible: false, resolveConflict: false, reason: "NOT_APPLICABLE",
    };
  }
  if (fieldState(field) === "system_managed") {
    return {
      fieldId: field.id, fieldName: field.field_name, valueFingerprint: fingerprint,
      eligible: false, resolveConflict: false, reason: "SYSTEM_MANAGED",
    };
  }
  if (field.manually_corrected) {
    return {
      fieldId: field.id, fieldName: field.field_name, valueFingerprint: fingerprint,
      eligible: false, resolveConflict: false, reason: "MANUALLY_CONFIRMED",
    };
  }
  const value = valueOf(field);
  if (value === null || value === undefined || String(value).trim() === "") {
    return {
      fieldId: field.id, fieldName: field.field_name, valueFingerprint: fingerprint,
      eligible: false, resolveConflict: false, reason: "MISSING_VALUE",
    };
  }
  if (!validateAcceptanceValue(field.field_name, value)) {
    return {
      fieldId: field.id, fieldName: field.field_name, valueFingerprint: fingerprint,
      eligible: false, resolveConflict: false, reason: "INVALID_VALUE",
    };
  }
  if (!sourceMatches(field)) {
    return {
      fieldId: field.id, fieldName: field.field_name, valueFingerprint: fingerprint,
      eligible: false, resolveConflict: false, reason: "SOURCE_REQUIRED",
    };
  }
  const conflict = conflictResolution(field, conflicts);
  if (conflict.blocked) {
    return {
      fieldId: field.id, fieldName: field.field_name, valueFingerprint: fingerprint,
      eligible: false, resolveConflict: false, reason: "TRUE_CONFLICT",
    };
  }
  return {
    fieldId: field.id,
    fieldName: field.field_name,
    valueFingerprint: fingerprint,
    eligible: true,
    resolveConflict: conflict.resolve,
    reason: "SAFE_SOURCE_VALIDATED",
  };
}

export function previewSafeAcceptance(
  fields: AcceptanceField[],
  conflicts: ConflictRecord[] = [],
  requiredFieldNames: ReadonlySet<string> = new Set(),
) {
  const decisions = fields.map((field) => assessSafeAcceptance(field, conflicts));
  const eligible = decisions.filter((decision) => decision.eligible);
  const blocked = decisions.filter((decision) => {
    if (
      decision.reason === "ALREADY_ACCEPTED" ||
      decision.reason === "MANUALLY_CONFIRMED" ||
      decision.reason === "NOT_APPLICABLE" ||
      decision.reason === "SYSTEM_MANAGED"
    ) {
      return false;
    }
    if (decision.reason === "MISSING_VALUE") {
      return requiredFieldNames.has(decision.fieldName);
    }
    return !decision.eligible;
  });
  return { decisions, eligible, blocked };
}

export async function recordSafeFieldAcceptances(input: {
  applicationId: string;
  actorId: string;
  method: "automatic" | "bulk";
  admin: SupabaseClient;
  requiredFieldNames?: ReadonlySet<string>;
}) {
  const [fields, conflicts] = await Promise.all([
    input.admin
      .from("extracted_fields")
      .select("id,field_name,structured_value,raw_value,source_type,source_id,source_marker,source_excerpt,confidence,requires_review,conflict_detected,manually_corrected,extraction_run_id")
      .eq("application_id", input.applicationId),
    input.admin
      .from("extraction_conflicts")
      .select("field_name,candidates,requires_review")
      .eq("application_id", input.applicationId)
      .eq("requires_review", true),
  ]);
  if (fields.error || conflicts.error) throw new Error("Не удалось проверить извлечённые данные.");
  const [acceptances] = await Promise.all([
    input.admin
      .from("extracted_field_acceptances")
      .select("extracted_field_id,value_fingerprint")
      .eq("application_id", input.applicationId),
  ]);
  if (acceptances.error) throw new Error("Не удалось проверить подтверждения данных.");
  const accepted = new Set(
    (acceptances.data ?? []).map((item) =>
      `${item.extracted_field_id}:${item.value_fingerprint}`),
  );
  const decoratedFields = ((fields.data ?? []) as AcceptanceField[]).map((field) => ({
    ...field,
    accepted: accepted.has(`${field.id}:${fieldValueFingerprint(field)}`),
  }));
  const preview = previewSafeAcceptance(
    decoratedFields,
    (conflicts.data ?? []) as ConflictRecord[],
    input.requiredFieldNames,
  );
  const candidates = preview.eligible.map((decision) => ({
    field_id: decision.fieldId,
    value_fingerprint: decision.valueFingerprint,
    resolve_conflict: decision.resolveConflict,
  }));
  const batchFingerprint = createHash("sha256")
    .update(JSON.stringify({
      applicationId: input.applicationId,
      method: input.method,
      candidates: candidates.map((candidate) => [
        candidate.field_id,
        candidate.value_fingerprint,
        candidate.resolve_conflict,
      ]),
      validator: SAFE_ACCEPTANCE_VALIDATOR_VERSION,
    }))
    .digest("hex");
  const result = await input.admin.rpc("record_safe_field_acceptances", {
    p_application_id: input.applicationId,
    p_actor_id: input.actorId,
    p_method: input.method,
    p_validator_version: SAFE_ACCEPTANCE_VALIDATOR_VERSION,
    p_batch_fingerprint: batchFingerprint,
    p_candidates: candidates,
  });
  if (result.error) throw new Error("Не удалось сохранить подтверждение данных.");
  return {
    preview,
    result: result.data as {
      batch_id: string;
      accepted_count: number;
      blocked_count: number;
      cache_hit: boolean;
    },
  };
}
