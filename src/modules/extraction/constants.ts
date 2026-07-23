export const EXTRACTION_PROVIDER = "openai";
export const EXTRACTION_MODEL = "gpt-5.6-sol";
export const EXTRACTION_PROMPT_VERSION = "contract-extraction-v1";
export const EXTRACTION_SCHEMA_VERSION = "contract-extraction-schema-v1";
export const NORMALIZED_TEXT_VERSION = "phase3-normalized-text-v1";

export const MAX_EXTRACTION_INPUT_CHARACTERS = 120_000;
export const MAX_FRAGMENT_CHARACTERS = 6_000;
export const MAX_SOURCE_EXCERPT_CHARACTERS = 500;
export const MAX_EXTRACTION_RETRIES = 2;

export const organizationFieldNames = [
  "legal_name",
  "short_name",
  "inn",
  "kpp",
  "ogrn",
  "legal_address",
  "actual_address",
  "bank_name",
  "bank_account",
  "correspondent_account",
  "bik",
  "contact_name",
  "contact_email",
  "contact_phone",
] as const;

export const signerFieldNames = [
  "signer_name",
  "signer_position",
  "signer_authority",
  "authority_document",
  "authority_date",
  "authority_number",
] as const;

export const contractFieldNames = [
  "contract_subject",
  "contract_amount",
  "currency",
  "performance_start_date",
  "performance_end_date",
  "performance_period_text",
  "payment_terms",
  "payment_due_days",
  "advance_percentage",
  "contract_date",
  "additional_conditions",
] as const;

export const extractionFieldNames = [
  ...organizationFieldNames,
  ...signerFieldNames,
  ...contractFieldNames,
] as const;

export type ExtractionFieldName = (typeof extractionFieldNames)[number];
