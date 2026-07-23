import { describe, expect, it } from "vitest";

import { rublesInWords } from "./amount-words";
import { formatAmount, formatRussianDate, mapContractValues } from "./mapping";

describe("deterministic contract value mapping", () => {
  it("formats Russian dates, money and RUB amount words", () => {
    expect(formatRussianDate("2026-07-23")).toBe("23 июля 2026 г.");
    expect(formatAmount(1234567.8)).toMatch(/1.234.567,80/u);
    expect(rublesInWords(1234.56)).toBe(
      "Одна тысяча двести тридцать четыре рубля 56 копеек",
    );
    expect(rublesInWords(0)).toBe("Ноль рублей 00 копеек");
  });

  it("maps only explicit source values and deterministic system values", () => {
    const values = mapContractValues({
      applicationNumber: "REQ-2026-000130",
      contractNumber: "TAA-2026-000001",
      generatedDate: "2026-07-23",
      fields: {
        legal_name: "ООО «Тест»",
        contract_amount: 1000,
        currency: "rub",
      },
    });
    expect(values.client_legal_name).toBe("ООО «Тест»");
    expect(values.client_short_name).toBe("");
    expect(values.client_actual_address).toBe("");
    expect(values.additional_conditions).toBe("");
    expect(values.contract_number).toBe("TAA-2026-000001");
    expect(values.contract_date).toBe("23 июля 2026 г.");
  });

  it("refuses unsupported currency and invalid amounts", () => {
    expect(() => mapContractValues({
      applicationNumber: "REQ-1",
      contractNumber: "TAA-2026-000001",
      generatedDate: "2026-07-23",
      fields: { contract_amount: 100, currency: "USD" },
    })).toThrow("AMOUNT_WORDS_UNSUPPORTED_CURRENCY");
    expect(() => rublesInWords(-1)).toThrow("Invalid RUB amount");
  });
});
