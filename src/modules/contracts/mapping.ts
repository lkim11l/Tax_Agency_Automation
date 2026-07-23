import { rublesInWords } from "./amount-words";
import type { ContractPlaceholder } from "./constants";

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

export type MappingSource = {
  applicationNumber: string;
  contractNumber: string;
  generatedDate: string;
  fields: Record<string, string | number | null>;
};

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
  const dates = ["performance_start_date", "performance_end_date"] as const;
  const result: Partial<Record<ContractPlaceholder, string>> = {
    application_number: input.applicationNumber,
    contract_number: input.contractNumber,
    contract_date: formatRussianDate(
      String(value("contract_date") ?? input.generatedDate),
    ),
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
    signer_name: String(value("signer_name") ?? ""),
    signer_position: String(value("signer_position") ?? ""),
    signer_authority: String(value("signer_authority") ?? ""),
    contract_subject: String(value("contract_subject") ?? ""),
    contract_amount: amount === null ? "" : formatAmount(amount),
    contract_amount_words: amount === null ? "" : rublesInWords(amount),
    currency,
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
