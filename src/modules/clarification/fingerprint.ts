import { createHash } from "node:crypto";

export type FingerprintField = {
  fieldName: string;
  value: unknown;
  confidence: number | null;
  requiresReview: boolean;
  conflictDetected: boolean;
  manuallyCorrected: boolean;
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
