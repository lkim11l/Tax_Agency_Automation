export const CONTRACT_BUCKET = "contract-documents";
// Bumped because signer_position_genitive/signer_name_genitive/
// signer_authority_genitive are now mandatory placeholders (see
// MANDATORY_PLACEHOLDERS below) — every template approved under the old
// "v1" schema is missing them and must be treated as incompatible until a
// new version is uploaded and approved. Never bump this without also
// re-checking MANDATORY_PLACEHOLDERS below.
export const PLACEHOLDER_SCHEMA_VERSION = "contract-placeholders-v2";
export const MAPPING_VERSION = "contract-mapping-v2";
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
  // Genitive ("...действующего на основании...") forms for the preamble,
  // deterministically derived — never guessed — from the fields above.
  // See ./declension.ts.
  "signer_name_genitive",
  "signer_position_genitive",
  "signer_authority_genitive",
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

// Every template, regardless of what the uploading admin selects as
// "required", must carry the genitive preamble fields — otherwise the
// preamble can silently fall back to the ungrammatical nominative wording
// ("в лице Генеральный директор ..."). Enforced in uploadTemplateVersion
// (upload time) and reverifyTemplateContent (every generation attempt).
export const MANDATORY_PLACEHOLDERS: readonly ContractPlaceholder[] = [
  "signer_position_genitive",
  "signer_name_genitive",
  "signer_authority_genitive",
];
