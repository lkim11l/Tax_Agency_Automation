import type { SupabaseClient } from "@supabase/supabase-js";

import type { ContractExtraction, ExtractedValue } from "./schema";
import { flattenExtraction, groupExtraction } from "./processing";

export type AuthorityBasisKind =
  | "charter"
  | "power_of_attorney"
  | "order"
  | "other";

export type DerivedFieldState = "not_applicable" | "system_managed";

type StoredField = {
  field_name: string;
  structured_value: Record<string, unknown> | null;
  raw_value: string | null;
  source_type: string | null;
  source_id: string | null;
  source_marker: string | null;
  source_excerpt: string | null;
  confidence: number | null;
  requires_review: boolean;
};

function normalizeAuthorityText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

export function classifySignerAuthority(
  value: string | null | undefined,
): AuthorityBasisKind {
  const normalized = normalizeAuthorityText(value);
  if (!normalized) return "other";
  if (normalized === "устав" || normalized.includes("устав")) return "charter";
  if (normalized.includes("доверен")) return "power_of_attorney";
  if (normalized.includes("приказ")) return "order";
  return "other";
}

function fieldState(value: ExtractedValue | undefined) {
  return value?.fieldState ?? null;
}

export function isDerivedNotApplicable(value: ExtractedValue | undefined) {
  return fieldState(value) === "not_applicable";
}

export function isSystemManagedField(value: ExtractedValue | undefined) {
  return fieldState(value) === "system_managed";
}

function withFieldState(
  value: ExtractedValue,
  state: DerivedFieldState,
): ExtractedValue {
  return {
    ...value,
    value: null,
    normalizedValue: null,
    rawValue: null,
    sourceType: null,
    sourceId: null,
    sourceMarker: null,
    sourceExcerpt: null,
    confidence: 1,
    requiresReview: false,
    reason: "NOT_FOUND",
    fieldState: state,
  };
}

function copyDerivedValue(
  source: ExtractedValue,
  normalizedValue: string,
): ExtractedValue {
  return {
    value: normalizedValue,
    normalizedValue,
    rawValue: source.rawValue ?? normalizedValue,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceMarker: source.sourceMarker,
    sourceExcerpt: source.sourceExcerpt,
    confidence: Math.max(source.confidence, 0.85),
    requiresReview: false,
    reason: "DIRECT_SOURCE",
  };
}

export function applyDerivedFieldRules(
  extraction: ContractExtraction,
): ContractExtraction {
  const fields = flattenExtraction(extraction);
  const signerAuthority = fields.signer_authority;
  const classification = classifySignerAuthority(
    String(signerAuthority.normalizedValue ?? signerAuthority.value ?? ""),
  );

  if (classification === "charter") {
    if (!signerAuthority.normalizedValue && !signerAuthority.value) {
      return extraction;
    }
    if (!fields.authority_document.normalizedValue && !fields.authority_document.value) {
      fields.authority_document = copyDerivedValue(signerAuthority, "Устав");
    }
    fields.authority_number = withFieldState(fields.authority_number, "not_applicable");
    fields.authority_date = withFieldState(fields.authority_date, "not_applicable");
  } else if (
    classification === "power_of_attorney" ||
    classification === "order"
  ) {
    const basis = String(signerAuthority.normalizedValue ?? signerAuthority.value ?? "").trim();
    if (
      basis &&
      !fields.authority_document.normalizedValue &&
      !fields.authority_document.value
    ) {
      fields.authority_document = copyDerivedValue(signerAuthority, basis);
    }
  }

  if (!fields.contract_date.normalizedValue && !fields.contract_date.value) {
    fields.contract_date = withFieldState(fields.contract_date, "system_managed");
  }

  return groupExtraction(fields, extraction.conflicts, extraction.warnings);
}

function serializeDerivedField(fieldName: string, value: ExtractedValue) {
  return {
    field_name: fieldName,
    structured_value: value,
    raw_value: value.rawValue,
    source_type: value.sourceType,
    source_id: value.sourceId,
    source_marker: value.sourceMarker,
    source_excerpt: value.sourceExcerpt,
    confidence: value.confidence,
    requires_review: value.requiresReview,
  };
}

function storedToExtraction(fields: StoredField[]): ContractExtraction {
  const values = Object.fromEntries(
    fields.map((field) => [
      field.field_name,
      (field.structured_value ?? {
        value: field.raw_value,
        normalizedValue: field.raw_value,
        rawValue: field.raw_value,
        sourceType: field.source_type,
        sourceId: field.source_id,
        sourceMarker: field.source_marker,
        sourceExcerpt: field.source_excerpt,
        confidence: field.confidence ?? 0,
        requiresReview: field.requires_review,
        reason: null,
      }) as ExtractedValue,
    ]),
  );
  return groupExtraction(values as never, [], []);
}

export async function syncDerivedFieldRules(input: {
  applicationId: string;
  admin: SupabaseClient;
}) {
  const result = await input.admin
    .from("extracted_fields")
    .select(
      "field_name,structured_value,raw_value,source_type,source_id,source_marker,source_excerpt,confidence,requires_review",
    )
    .eq("application_id", input.applicationId);
  if (result.error) throw new Error("Не удалось загрузить извлечённые поля.");
  const current = storedToExtraction((result.data ?? []) as StoredField[]);
  const derived = applyDerivedFieldRules(current);
  const flat = flattenExtraction(derived);
  const updates: Array<Record<string, unknown>> = [];
  for (const fieldName of [
    "authority_document",
    "authority_number",
    "authority_date",
    "contract_date",
  ] as const) {
    const next = flat[fieldName];
    const stored = (result.data ?? []).find((field) => field.field_name === fieldName);
    const previous = (stored?.structured_value ?? null) as ExtractedValue | null;
    const changed =
      next.fieldState !== (previous?.fieldState ?? null) ||
      next.normalizedValue !== (previous?.normalizedValue ?? null) ||
      next.rawValue !== (previous?.rawValue ?? null) ||
      next.requiresReview !== (stored?.requires_review ?? true);
    if (changed) {
      updates.push(serializeDerivedField(fieldName, next));
    }
  }
  for (const update of updates) {
    const persisted = await input.admin
      .from("extracted_fields")
      .update({
        structured_value: update.structured_value,
        raw_value: update.raw_value,
        source_type: update.source_type,
        source_id: update.source_id,
        source_marker: update.source_marker,
        source_excerpt: update.source_excerpt,
        confidence: update.confidence,
        requires_review: update.requires_review,
      })
      .eq("application_id", input.applicationId)
      .eq("field_name", update.field_name);
    if (persisted.error) {
      throw new Error("Не удалось сохранить производные правила полей.");
    }
  }
  return derived;
}
