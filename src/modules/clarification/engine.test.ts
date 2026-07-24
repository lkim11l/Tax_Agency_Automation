import { describe, expect, it } from "vitest";

import { buildClarificationDraft, evaluateCompleteness } from "./engine";
import { getRuleSet } from "./rules";

const source = {
  sourceType: "email_message",
  sourceId: "11111111-1111-4111-8111-111111111111",
  sourceMarker: "[EMAIL BODY]",
  sourceExcerpt: "source",
  confidence: 0.95,
  requiresReview: false,
  conflictDetected: false,
  manuallyCorrected: false,
};

describe("completeness engine", () => {
  it("reports deterministic blocking questions in rule order", () => {
    const result = evaluateCompleteness(getRuleSet("standard-contract"), [
      { fieldName: "legal_name", value: "ООО Ромашка", ...source },
      { fieldName: "inn", value: "7707083893", ...source, conflictDetected: true },
    ]);
    expect(result.ready).toBe(false);
    expect(result.conflicts).toBe(1);
    expect(result.missing).toBeGreaterThan(0);
    const body = buildClarificationDraft({
      applicationNumber: "APP-0001",
      result,
    });
    expect(body).toContain("1. Укажите ИНН организации.");
    expect(body).toContain("APP-0001");
  });

  it("accepts a sourced value and a deliberate manual correction", () => {
    const ruleSet = {
      id: "test",
      version: "1",
      label: "test",
      rules: [
        {
          fieldName: "a",
          label: "A",
          question: "A?",
          minimumConfidence: 0.9,
          allowManualConfirmation: true,
          required: true,
        },
        {
          fieldName: "b",
          label: "B",
          question: "B?",
          minimumConfidence: 0.9,
          allowManualConfirmation: true,
          required: true,
        },
      ],
    };
    const result = evaluateCompleteness(ruleSet, [
      { fieldName: "a", value: "value", ...source },
      {
        fieldName: "b",
        value: "confirmed",
        ...source,
        sourceType: "manual",
        sourceId: null,
        sourceExcerpt: null,
        confidence: 1,
        manuallyCorrected: true,
      },
    ]);
    expect(result.ready).toBe(true);
    expect(result.percentage).toBe(100);
  });

  it("treats a deterministic acceptance as complete at low model confidence", () => {
    const ruleSet = {
      id: "test",
      version: "1",
      label: "test",
      rules: [{
        fieldName: "inn",
        label: "ИНН",
        question: "ИНН?",
        minimumConfidence: 0.9,
        allowManualConfirmation: true,
        required: true,
      }],
    };
    const result = evaluateCompleteness(ruleSet, [{
      fieldName: "inn",
      value: "7707083893",
      ...source,
      confidence: 0.4,
      requiresReview: true,
      accepted: true,
    }]);
    expect(result).toEqual(expect.objectContaining({
      ready: true,
      percentage: 100,
      lowConfidence: 0,
    }));
  });

  it("applies conditional alternatives only when every required date exists", () => {
    const ruleSet = getRuleSet("standard-contract");
    const partial = evaluateCompleteness(ruleSet, [
      { fieldName: "performance_start_date", value: "2026-08-01", ...source },
    ]);
    expect(
      partial.fields.find((field) => field.fieldName === "performance_period_text")
        ?.status,
    ).toBe("missing");
    const completeRange = evaluateCompleteness(ruleSet, [
      { fieldName: "performance_start_date", value: "2026-08-01", ...source },
      { fieldName: "performance_end_date", value: "2026-08-31", ...source },
    ]);
    expect(
      completeRange.fields.find(
        (field) => field.fieldName === "performance_period_text",
      )?.required,
    ).toBe(false);
  });

  it("blocks conflicts, low confidence, and missing attribution", () => {
    const ruleSet = {
      id: "test",
      version: "1",
      label: "test",
      rules: [
        {
          fieldName: "conflict",
          label: "Conflict",
          question: "Conflict?",
          minimumConfidence: 0.8,
          allowManualConfirmation: true,
          required: true,
        },
        {
          fieldName: "weak",
          label: "Weak",
          question: "Weak?",
          minimumConfidence: 0.8,
          allowManualConfirmation: true,
          required: true,
        },
        {
          fieldName: "unsourced",
          label: "Unsourced",
          question: "Unsourced?",
          minimumConfidence: 0.8,
          allowManualConfirmation: true,
          required: true,
        },
      ],
    };
    const result = evaluateCompleteness(ruleSet, [
      { fieldName: "conflict", value: "a", ...source, conflictDetected: true },
      { fieldName: "weak", value: "b", ...source, confidence: 0.5 },
      {
        fieldName: "unsourced",
        value: "c",
        ...source,
        sourceExcerpt: null,
      },
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        conflicts: 1,
        lowConfidence: 1,
        invalid: 1,
        percentage: 0,
        ready: false,
      }),
    );
  });
});
