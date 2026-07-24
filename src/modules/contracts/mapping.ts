import { rublesInWords } from "./amount-words";
import type { ContractPlaceholder } from "./constants";
import {
  declineSignerAuthorityGenitive,
  declineSignerNameGenitive,
  declineSignerPositionGenitive,
} from "./declension";

export const russianMonths = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

export function formatRussianDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid contract date.");
  return `${date.getUTCDate()} ${russianMonths[date.getUTCMonth()]} ${date.getUTCFullYear()} г.`;
}

export function formatAmount(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(value);
}

// Currency code stays available to callers (audit metadata, etc.) via the
// `currency` value itself; only the visible contract sentence gets the
// natural-language word instead of the literal ISO code.
export function formatCurrencyRu(code: string) {
  if (code === "RUB") return "рублей";
  return code;
}

// Word-processor line breaks can split a hyphenated document number across
// lines. Swap regular hyphens for U+2011 (non-breaking hyphen) — visually
// identical, but Word never wraps at it — so "TAA-2026-000006" always stays
// on one line without changing the displayed characters.
const NON_BREAKING_HYPHEN = "‑";

export function withNonBreakingHyphens(value: string) {
  return value.replaceAll("-", NON_BREAKING_HYPHEN);
}

export type MappingSource = {
  applicationNumber: string;
  contractNumber: string;
  generatedDate: string;
  fields: Record<string, string | number | null>;
};

function requireDeclension(
  outcome: ReturnType<typeof declineSignerPositionGenitive>,
  errorCode: string,
) {
  if (!outcome.reliable) throw new Error(errorCode);
  return outcome.value;
}

export function mapContractValues(input: MappingSource) {
  const value = (name: string) => input.fields[name];
  const amountValue = value("contract_amount");
  const amount =
    typeof amountValue === "number"
      ? amountValue
      : typeof amountValue === "string" && amountValue.trim()
        ? Number(amountValue)
        : null;
  const currency = String(value("currency") ?? "").toUpperCase();
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    throw new Error("CONTRACT_AMOUNT_INVALID");
  }
  if (amount !== null && currency !== "RUB") {
    throw new Error("AMOUNT_WORDS_UNSUPPORTED_CURRENCY");
  }
  const signerPosition = String(value("signer_position") ?? "");
  const signerName = String(value("signer_name") ?? "");
  const signerAuthority = String(value("signer_authority") ?? "");
  // Genitive preamble fields are deterministic-or-nothing: a present value
  // that cannot be reliably declined blocks generation rather than shipping
  // an ungrammatical "в лице Генеральный директор ..." contract — the
  // application stays on review instead.
  const signerPositionGenitive = signerPosition
    ? requireDeclension(declineSignerPositionGenitive(signerPosition), "SIGNER_POSITION_DECLENSION_UNRELIABLE")
    : "";
  const signerNameGenitive = signerName
    ? requireDeclension(declineSignerNameGenitive(signerName), "SIGNER_NAME_DECLENSION_UNRELIABLE")
    : "";
  const signerAuthorityGenitive = signerAuthority
    ? requireDeclension(declineSignerAuthorityGenitive(signerAuthority), "SIGNER_AUTHORITY_DECLENSION_UNRELIABLE")
    : "";
  const dates = ["performance_start_date", "performance_end_date"] as const;
  const result: Partial<Record<ContractPlaceholder, string>> = {
    application_number: withNonBreakingHyphens(input.applicationNumber),
    contract_number: withNonBreakingHyphens(input.contractNumber),
    contract_date: formatRussianDate(input.generatedDate),
    client_legal_name: String(value("legal_name") ?? ""),
    client_short_name: String(value("short_name") ?? ""),
    client_inn: String(value("inn") ?? ""),
    client_kpp: String(value("kpp") ?? ""),
    client_ogrn: String(value("ogrn") ?? ""),
    client_legal_address: String(value("legal_address") ?? ""),
    client_actual_address: String(value("actual_address") ?? ""),
    client_bank_name: String(value("bank_name") ?? ""),
    client_bank_account: String(value("bank_account") ?? ""),
    client_correspondent_account: String(value("correspondent_account") ?? ""),
    client_bik: String(value("bik") ?? ""),
    signer_name: signerName,
    signer_position: signerPosition,
    signer_authority: signerAuthority,
    signer_name_genitive: signerNameGenitive,
    signer_position_genitive: signerPositionGenitive,
    signer_authority_genitive: signerAuthorityGenitive,
    contract_subject: String(value("contract_subject") ?? ""),
    contract_amount: amount === null ? "" : formatAmount(amount),
    contract_amount_words: amount === null ? "" : rublesInWords(amount),
    currency: formatCurrencyRu(currency),
    performance_period_text: String(value("performance_period_text") ?? ""),
    payment_terms: String(value("payment_terms") ?? ""),
    additional_conditions: String(value("additional_conditions") ?? ""),
  };
  for (const name of dates) {
    const raw = value(name);
    result[name] = raw ? formatRussianDate(String(raw)) : "";
  }
  return result as Record<ContractPlaceholder, string>;
}
