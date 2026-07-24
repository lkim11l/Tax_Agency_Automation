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
    expect(values.contract_number).toBe("TAA‑2026‑000001");
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

  it("shows the RUB currency as a Russian word, never the literal code", () => {
    const values = mapContractValues({
      applicationNumber: "REQ-1",
      contractNumber: "TAA-2026-000001",
      generatedDate: "2026-07-23",
      fields: { contract_amount: 1000, currency: "rub" },
    });
    expect(values.currency).toBe("рублей");
    expect(values.currency).not.toMatch(/RUB/iu);
  });

  it("fills the genitive preamble fields for a reliably declinable signer", () => {
    const values = mapContractValues({
      applicationNumber: "REQ-1",
      contractNumber: "TAA-2026-000001",
      generatedDate: "2026-07-23",
      fields: {
        signer_position: "Генеральный директор",
        signer_name: "Иванов Иван Иванович",
        signer_authority: "Устав",
      },
    });
    expect(values.signer_position).toBe("Генеральный директор");
    expect(values.signer_position_genitive).toBe("генерального директора");
    expect(values.signer_name).toBe("Иванов Иван Иванович");
    expect(values.signer_name_genitive).toBe("Иванова Ивана Ивановича");
    expect(values.signer_authority).toBe("Устав");
    expect(values.signer_authority_genitive).toBe("Устава");
  });

  it("blocks generation instead of guessing when the signer name cannot be reliably declined", () => {
    expect(() => mapContractValues({
      applicationNumber: "REQ-1",
      contractNumber: "TAA-2026-000001",
      generatedDate: "2026-07-23",
      fields: {
        signer_position: "Генеральный директор",
        signer_name: "Ким Иван Иванович",
        signer_authority: "Устав",
      },
    })).toThrow("SIGNER_NAME_DECLENSION_UNRELIABLE");
  });

  it("blocks generation instead of guessing when the position cannot be reliably declined", () => {
    expect(() => mapContractValues({
      applicationNumber: "REQ-1",
      contractNumber: "TAA-2026-000001",
      generatedDate: "2026-07-23",
      fields: {
        signer_position: "Заместитель по общим вопросам",
        signer_name: "Иванов Иван Иванович",
        signer_authority: "Устав",
      },
    })).toThrow("SIGNER_POSITION_DECLENSION_UNRELIABLE");
  });

  it("blocks generation instead of guessing when the authority basis cannot be reliably declined", () => {
    expect(() => mapContractValues({
      applicationNumber: "REQ-1",
      contractNumber: "TAA-2026-000001",
      generatedDate: "2026-07-23",
      fields: {
        signer_position: "Генеральный директор",
        signer_name: "Иванов Иван Иванович",
        signer_authority: "устное распоряжение учредителя",
      },
    })).toThrow("SIGNER_AUTHORITY_DECLENSION_UNRELIABLE");
  });

  it("fills the genitive preamble fields for a reliably declinable feminine signer", () => {
    const values = mapContractValues({
      applicationNumber: "REQ-1",
      contractNumber: "TAA-2026-000001",
      generatedDate: "2026-07-23",
      fields: {
        signer_position: "Генеральный директор",
        signer_name: "Иванова Мария Ивановна",
        signer_authority: "Устав",
      },
    });
    expect(values.signer_name).toBe("Иванова Мария Ивановна");
    expect(values.signer_name_genitive).toBe("Ивановой Марии Ивановны");
  });

  it("leaves genitive fields empty rather than throwing when no signer data is present", () => {
    const values = mapContractValues({
      applicationNumber: "REQ-1",
      contractNumber: "TAA-2026-000001",
      generatedDate: "2026-07-23",
      fields: {},
    });
    expect(values.signer_position_genitive).toBe("");
    expect(values.signer_name_genitive).toBe("");
    expect(values.signer_authority_genitive).toBe("");
  });

  it("keeps the contract and application numbers unbroken with a non-breaking hyphen", () => {
    const values = mapContractValues({
      applicationNumber: "REQ-2026-000130",
      contractNumber: "TAA-2026-000006",
      generatedDate: "2026-07-23",
      fields: {},
    });
    expect(values.contract_number).not.toContain("-");
    expect(values.contract_number.replaceAll("‑", "-")).toBe("TAA-2026-000006");
    expect(values.application_number).not.toContain("-");
    expect(values.application_number.replaceAll("‑", "-")).toBe("REQ-2026-000130");
  });
});
