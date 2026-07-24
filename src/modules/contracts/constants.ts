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

// Single source of truth for showing a missing-placeholder name to a human
// (a specialist on "Проверить готовность", an admin reading a blocked-run
// audit event). Never surface the bare placeholder identifier itself —
// safeGenerationErrorMessage/safeBlockingMessage in contracts/actions.ts
// look values up here instead of inventing their own wording.
export const PLACEHOLDER_LABELS: Record<ContractPlaceholder, string> = {
  application_number: "Номер заявки",
  contract_number: "Номер договора",
  contract_date: "Дата договора",
  client_legal_name: "Полное наименование контрагента",
  client_short_name: "Краткое наименование контрагента",
  client_inn: "ИНН контрагента",
  client_kpp: "КПП контрагента",
  client_ogrn: "ОГРН контрагента",
  client_legal_address: "Юридический адрес контрагента",
  client_actual_address: "Фактический адрес контрагента",
  client_bank_name: "Наименование банка контрагента",
  client_bank_account: "Расчётный счёт контрагента",
  client_correspondent_account: "Корреспондентский счёт банка",
  client_bik: "БИК банка",
  signer_name: "ФИО подписанта",
  signer_position: "Должность подписанта",
  signer_authority: "Основание полномочий подписанта",
  signer_name_genitive: "ФИО подписанта (родительный падеж)",
  signer_position_genitive: "Должность подписанта (родительный падеж)",
  signer_authority_genitive: "Основание полномочий подписанта (родительный падеж)",
  contract_subject: "Предмет договора",
  contract_amount: "Сумма договора",
  contract_amount_words: "Сумма договора прописью",
  currency: "Валюта договора",
  performance_start_date: "Дата начала срока исполнения",
  performance_end_date: "Дата окончания срока исполнения",
  performance_period_text: "Срок исполнения обязательств",
  payment_terms: "Условия оплаты",
  additional_conditions: "Дополнительные условия",
};

// Never sourced from extraction — always generated or derived (contract
// numbering, the render date, amount-in-words, the genitive preamble forms,
// the currency display form). A completeness rule set must never be asked to
// require one of these, and required_fields validation at template-approval
// time (see approveTemplate in ./service.ts, Step 6 strategy B) always
// excludes them.
export const SYSTEM_MANAGED_PLACEHOLDERS: readonly ContractPlaceholder[] = [
  "application_number",
  "contract_number",
  "contract_date",
  "contract_amount_words",
  "currency",
  "signer_name_genitive",
  "signer_position_genitive",
  "signer_authority_genitive",
];

// Every remaining placeholder maps 1:1 to an extraction field_name of the
// same name (signer_name, contract_subject, payment_terms, ...) — these
// client_* ones are the only placeholders mapping.ts renames along the way
// (see mapContractValues's `value(...)` calls). Kept here as the one place
// that needs to reconstruct "which extraction field renders this
// placeholder" without duplicating mapping.ts's render logic (template
// approval validation, Step 6 strategy B).
export const PLACEHOLDER_TO_EXTRACTION_FIELD: Partial<Record<ContractPlaceholder, string>> = {
  client_legal_name: "legal_name",
  client_short_name: "short_name",
  client_inn: "inn",
  client_kpp: "kpp",
  client_ogrn: "ogrn",
  client_legal_address: "legal_address",
  client_actual_address: "actual_address",
  client_bank_name: "bank_name",
  client_bank_account: "bank_account",
  client_correspondent_account: "correspondent_account",
  client_bik: "bik",
};

// Placeholders allowed to legitimately render an empty string even when a
// template does not list them in required_fields. docs/SCOPE.md's required
// contract fields list treats essentially every other data point here
// (counterparty details, signer, subject, amount, currency, performance
// period, payment terms) as mandatory — additional_conditions is the one
// deliberate exception, an optional catch-all clause a contract may simply
// not need. Everything else that resolves empty is blocking regardless of
// required_fields (see Step 7 / mapContractValuesOrBlock callers), so an
// admin forgetting to mark a field required in required_fields can never
// silently ship a contract with a blank clause it actually needed.
//
// performance_period_text is NOT here even though it's often blank: a blank
// value there is only ever safe when performance_start_date/end_date cover
// the same requirement instead (see rules.ts's requiredUnlessAll) — that's a
// substitution, not an exemption, and stays enforced by the rule set/
// required-render-value check like any other required field.
export const LEGALLY_OPTIONAL_PLACEHOLDERS: readonly ContractPlaceholder[] = [
  "additional_conditions",
];
