import {
  contractFieldNames,
  organizationFieldNames,
  signerFieldNames,
} from "./constants";
import {
  contractExtractionSchema,
  missingExtractedValue,
  type ContractExtraction,
  type ExtractedValue,
} from "./schema";

function missingGroup<T extends readonly string[]>(names: T) {
  return Object.fromEntries(names.map((name) => [name, missingExtractedValue()])) as {
    [K in T[number]]: ExtractedValue;
  };
}
export function syntheticExtraction(
  overrides: Partial<{
    organization: Partial<ContractExtraction["organization"]>;
    signer: Partial<ContractExtraction["signer"]>;
    contract: Partial<ContractExtraction["contract"]>;
    conflicts: ContractExtraction["conflicts"];
    warnings: string[];
  }> = {},
) {
  return contractExtractionSchema.parse({
    extractionVersion: "contract-extraction-schema-v1",
    organization: {
      ...missingGroup(organizationFieldNames),
      ...overrides.organization,
    },
    signer: {
      ...missingGroup(signerFieldNames),
      ...overrides.signer,
    },
    contract: {
      ...missingGroup(contractFieldNames),
      ...overrides.contract,
    },
    conflicts: overrides.conflicts ?? [],
    warnings: overrides.warnings ?? [],
  });
}

export function syntheticValue(input: {
  value: string | number;
  normalizedValue?: string | number;
  sourceId?: string;
  sourceMarker?: string;
  sourceExcerpt?: string;
  confidence?: number;
  sourceType?: ExtractedValue["sourceType"];
}): ExtractedValue {
  return {
    value: input.value,
    normalizedValue: input.normalizedValue ?? input.value,
    rawValue: String(input.value),
    sourceType: input.sourceType ?? "email_message",
    sourceId: input.sourceId ?? "11111111-1111-4111-8111-111111111111",
    sourceMarker: input.sourceMarker ?? "[EMAIL BODY]",
    sourceExcerpt: input.sourceExcerpt ?? `ИНН: ${input.value}`,
    confidence: input.confidence ?? 0.8,
    requiresReview: false,
    reason: "DIRECT_SOURCE",
  };
}
