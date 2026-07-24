import { describe, expect, it } from "vitest";

import { PLACEHOLDER_LABELS } from "./constants";
import { safeBlockingMessage, safeGenerationErrorMessage } from "./messages";

// A raw internal code looks like an all-caps, underscore-separated token
// (GENERATION_BLOCKED, REQUIRED_RENDER_VALUE_MISSING, a bare field name like
// CLIENT_SHORT_NAME, ...). No safe user-facing string may ever contain one.
const RAW_CODE_PATTERN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/u;

describe("regression A: a single missing required render value names the field", () => {
  it("checkContractEligibility-shaped blockingReasons/missingRenderFields produce a message naming the field's Russian label", () => {
    const message = safeBlockingMessage(["REQUIRED_RENDER_VALUE_MISSING"], ["client_short_name"]);
    expect(message).toContain(PLACEHOLDER_LABELS.client_short_name);
    expect(message).not.toMatch(RAW_CODE_PATTERN);
  });
});

describe("regression B: multiple missing required render values are all listed", () => {
  it("lists every missing field, not just the first", () => {
    const message = safeBlockingMessage(
      ["REQUIRED_RENDER_VALUE_MISSING"],
      ["client_short_name", "client_bik", "client_kpp"],
    );
    expect(message).toContain(PLACEHOLDER_LABELS.client_short_name);
    expect(message).toContain(PLACEHOLDER_LABELS.client_bik);
    expect(message).toContain(PLACEHOLDER_LABELS.client_kpp);
  });

  it("survives the exact compound GENERATION_BLOCKED:REQUIRED_RENDER_VALUE_MISSING:<f1>,<f2> shape generateContract throws", () => {
    // This is the precise bug: the old parser did
    // message.slice(prefix.length).split(",") and turned
    // "REQUIRED_RENDER_VALUE_MISSING:client_short_name" into an unmatched
    // pseudo-reason, silently falling through to the fully generic fallback
    // no matter how many fields were actually missing.
    const error = new Error(
      "GENERATION_BLOCKED:REQUIRED_RENDER_VALUE_MISSING:client_short_name,client_bik",
    );
    const message = safeGenerationErrorMessage(error);
    expect(message).toContain(PLACEHOLDER_LABELS.client_short_name);
    expect(message).toContain(PLACEHOLDER_LABELS.client_bik);
    expect(message).not.toBe(
      "Не удалось подготовить договор. Повторно обработайте заявку или обратитесь к администратору.",
    );
  });

  it("keeps the missing-field message intact even alongside other blocking reasons", () => {
    // Independent reasons are joined with ";" precisely so a compound
    // reason's own comma-separated field list is never ambiguous with the
    // reason separator (see generateContract in ./service.ts).
    const error = new Error(
      "GENERATION_BLOCKED:TEMPLATE_NOT_APPROVED;REQUIRED_RENDER_VALUE_MISSING:client_short_name,client_bik",
    );
    const message = safeGenerationErrorMessage(error);
    expect(message).not.toMatch(RAW_CODE_PATTERN);
  });
});

describe("regression E: an undeclinable signer produces a specific, non-generic message", () => {
  it("signer name declension failure has its own message", () => {
    const message = safeBlockingMessage(["SIGNER_NAME_DECLENSION_UNRELIABLE"]);
    expect(message).toMatch(/ФИО подписанта/u);
    expect(message).not.toBe(
      "Формирование договора заблокировано проверками безопасности.",
    );
  });

  it("signer position declension failure has its own message", () => {
    const message = safeBlockingMessage(["SIGNER_POSITION_DECLENSION_UNRELIABLE"]);
    expect(message).toMatch(/должность/iu);
  });

  it("signer authority declension failure has its own message", () => {
    const message = safeBlockingMessage(["SIGNER_AUTHORITY_DECLENSION_UNRELIABLE"]);
    expect(message).toMatch(/полномочий/iu);
  });
});

describe("regression F: no raw machine code ever reaches a user-facing string", () => {
  const knownReasons = [
    "TEMPLATE_SECURITY_REVALIDATION_FAILED",
    "SOURCE_FINGERPRINT_MISMATCH",
    "RULE_SET_MISMATCH",
    "TEMPLATE_NOT_APPROVED",
    "TEMPLATE_VALIDATION_INVALID",
    "UNRESOLVED_CONFLICT",
    "REVIEW_REQUIRED_FIELD",
    "COMPLETENESS_FIELD_BLOCKED",
    "APPLICATION_HAS_BLOCKING_FIELDS",
    "COMPLETENESS_STALE",
    "APPLICATION_NOT_READY",
    "SIGNER_NAME_DECLENSION_UNRELIABLE",
    "SIGNER_POSITION_DECLENSION_UNRELIABLE",
    "SIGNER_AUTHORITY_DECLENSION_UNRELIABLE",
    "AMOUNT_WORDS_UNSUPPORTED_CURRENCY",
    "CONTRACT_AMOUNT_INVALID",
    "MAPPING_VALIDATION_FAILED",
    "SOME_FUTURE_UNKNOWN_CODE",
  ];

  it.each(knownReasons)("safeBlockingMessage([%s]) never leaks the raw code", (reason) => {
    expect(safeBlockingMessage([reason])).not.toMatch(RAW_CODE_PATTERN);
  });

  it.each(knownReasons)("safeGenerationErrorMessage(GENERATION_BLOCKED:%s) never leaks the raw code", (reason) => {
    expect(safeGenerationErrorMessage(new Error(`GENERATION_BLOCKED:${reason}`))).not.toMatch(RAW_CODE_PATTERN);
  });

  it("never leaks the raw code even for the missing-render-value compound shape", () => {
    const message = safeGenerationErrorMessage(
      new Error("GENERATION_BLOCKED:REQUIRED_RENDER_VALUE_MISSING:client_short_name,client_bik"),
    );
    expect(message).not.toMatch(RAW_CODE_PATTERN);
  });

  it("never leaks the raw code for a completely unrecognized error message", () => {
    expect(safeGenerationErrorMessage(new Error("TypeError: something exploded"))).not.toMatch(RAW_CODE_PATTERN);
    expect(safeGenerationErrorMessage("not even an Error")).not.toMatch(RAW_CODE_PATTERN);
  });
});
