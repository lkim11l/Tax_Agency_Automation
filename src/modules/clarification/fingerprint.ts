import { createHash } from "node:crypto";

import { fieldValueFingerprint, type AcceptanceField } from "@/modules/extraction/acceptance";

export type FingerprintField = {
  fieldName: string;
  value: unknown;
  confidence: number | null;
  requiresReview: boolean;
  conflictDetected: boolean;
  manuallyCorrected: boolean;
  accepted?: boolean;
};

export function computeExtractionFingerprint(fields: FingerprintField[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...fields].sort((left, right) =>
          left.fieldName.localeCompare(right.fieldName),
        ),
      ),
    )
    .digest("hex");
}

// Shape of an `extracted_fields` row as needed to determine both its
// completeness-fingerprint contribution and whether it has been safely
// accepted. Deliberately a superset of `AcceptanceField` (adds `id`, which
// `fieldValueFingerprint` does not need but the accepted-lookup does).
export type CompletenessSourceField = Pick<
  AcceptanceField,
  | "field_name"
  | "structured_value"
  | "raw_value"
  | "source_type"
  | "source_id"
  | "source_marker"
  | "source_excerpt"
  | "confidence"
  | "requires_review"
  | "conflict_detected"
  | "manually_corrected"
> & { id: string };

export type CompletenessAcceptanceRecord = {
  extracted_field_id: string;
  value_fingerprint: string;
};

// Single source of truth for "has this exact field value already been safely
// accepted": every caller that needs to know must resolve it the same way,
// via the field's own current value fingerprint matched against a recorded
// acceptance for that same extracted_field_id.
export function resolveAcceptedFieldIds(
  fields: readonly CompletenessSourceField[],
  acceptances: readonly CompletenessAcceptanceRecord[],
): Set<string> {
  const acceptedKeys = new Set(
    acceptances.map((item) => `${item.extracted_field_id}:${item.value_fingerprint}`),
  );
  const acceptedIds = new Set<string>();
  for (const field of fields) {
    const valueFingerprint = fieldValueFingerprint(field as AcceptanceField);
    if (acceptedKeys.has(`${field.id}:${valueFingerprint}`)) {
      acceptedIds.add(field.id);
    }
  }
  return acceptedIds;
}

// The one and only way to compute "the completeness fingerprint of the
// application's current data". Both `recalculateCompleteness` and contract
// generation eligibility (`loadGenerationSource`) must call this with the
// same raw `extracted_fields`/`extracted_field_acceptances` rows — never
// build the fingerprint field list by hand in more than one place, or the
// two computations silently drift (one omitting `accepted`, for instance)
// and generation blocks on a false SOURCE_FINGERPRINT_MISMATCH forever.
export function buildCurrentCompletenessFingerprint(input: {
  fields: readonly CompletenessSourceField[];
  acceptances: readonly CompletenessAcceptanceRecord[];
}) {
  const acceptedIds = resolveAcceptedFieldIds(input.fields, input.acceptances);
  return computeExtractionFingerprint(
    input.fields.map((field) => ({
      fieldName: field.field_name,
      value: (field.structured_value as Record<string, unknown> | null)?.normalizedValue ?? field.raw_value,
      confidence: field.confidence,
      requiresReview: field.requires_review,
      conflictDetected: field.conflict_detected,
      manuallyCorrected: field.manually_corrected,
      accepted: acceptedIds.has(field.id),
    })),
  );
}
