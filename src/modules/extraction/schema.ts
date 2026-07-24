import { z } from "zod";

import {
  EXTRACTION_SCHEMA_VERSION,
  contractFieldNames,
  organizationFieldNames,
  signerFieldNames,
} from "./constants";

export const extractionReasonSchema = z.enum([
  "NOT_FOUND",
  "AMBIGUOUS",
  "CONFLICT",
  "INVALID_FORMAT",
  "OCR_SOURCE",
  "SOURCE_REQUIRED",
  "LOW_CONFIDENCE",
  "DIRECT_SOURCE",
]);

export const sourceTypeSchema = z.enum([
  "email_message",
  "parsed_document",
  "application",
  "counterparty",
  "manual",
]);

export const extractedValueSchema = z.object({
  value: z.union([z.string().min(1), z.number().nonnegative()]).nullable(),
  normalizedValue: z.union([z.string().min(1), z.number().nonnegative()]).nullable(),
  rawValue: z.string().min(1).nullable(),
  sourceType: sourceTypeSchema.nullable(),
  sourceId: z.string().uuid().nullable(),
  sourceMarker: z.string().min(1).max(300).nullable(),
  sourceExcerpt: z.string().min(1).max(500).nullable(),
  confidence: z.number().min(0).max(1),
  requiresReview: z.boolean(),
  reason: extractionReasonSchema.nullable(),
  fieldState: z.enum(["not_applicable", "system_managed"]).nullable().optional(),
});

function createFieldGroup<const T extends readonly string[]>(fieldNames: T) {
  return z.object(
    Object.fromEntries(fieldNames.map((name) => [name, extractedValueSchema])) as {
      [K in T[number]]: typeof extractedValueSchema;
    },
  );
}

export const organizationExtractionSchema = createFieldGroup(organizationFieldNames);
export const signerExtractionSchema = createFieldGroup(signerFieldNames);
export const contractFieldGroupSchema = createFieldGroup(contractFieldNames);

export const extractionConflictSchema = z.object({
  fieldName: z.string().min(1).max(100),
  candidates: z.array(extractedValueSchema).min(2).max(20),
  sources: z.array(z.string().max(300)).min(2).max(20),
  conflictType: z.enum([
    "DIFFERENT_VALUES",
    "SOURCE_DISAGREEMENT",
    "MANUAL_OVERRIDE",
  ]),
  requiresReview: z.literal(true),
});

export const contractExtractionSchema = z.object({
  extractionVersion: z.literal(EXTRACTION_SCHEMA_VERSION),
  organization: organizationExtractionSchema,
  signer: signerExtractionSchema,
  contract: contractFieldGroupSchema,
  conflicts: z.array(extractionConflictSchema).max(100),
  warnings: z.array(z.string().max(500)).max(100),
});

export type ExtractedValue = z.infer<typeof extractedValueSchema>;
export type ContractExtraction = z.infer<typeof contractExtractionSchema>;
export type ExtractionConflict = z.infer<typeof extractionConflictSchema>;

export function missingExtractedValue(): ExtractedValue {
  return {
    value: null,
    normalizedValue: null,
    rawValue: null,
    sourceType: null,
    sourceId: null,
    sourceMarker: null,
    sourceExcerpt: null,
    confidence: 0,
    requiresReview: true,
    reason: "NOT_FOUND",
  };
}
