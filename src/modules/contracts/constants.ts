export const CONTRACT_BUCKET = "contract-documents";
export const PLACEHOLDER_SCHEMA_VERSION = "contract-placeholders-v1";
export const MAPPING_VERSION = "contract-mapping-v1";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const contractPlaceholders = [
  "application_number",
  "contract_number",
  "contract_date",
  "client_legal_name",
  "client_short_name",
  "client_inn",
  "client_kpp",
  "client_ogrn",
  "client_legal_address",
  "client_actual_address",
  "client_bank_name",
  "client_bank_account",
  "client_correspondent_account",
  "client_bik",
  "signer_name",
  "signer_position",
  "signer_authority",
  "contract_subject",
  "contract_amount",
  "contract_amount_words",
  "currency",
  "performance_start_date",
  "performance_end_date",
  "performance_period_text",
  "payment_terms",
  "additional_conditions",
] as const;

export type ContractPlaceholder = (typeof contractPlaceholders)[number];
