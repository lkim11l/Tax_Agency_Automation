import { describe, expect, it } from "vitest";

import {
  applicationInputSchema,
  applicationStatuses,
  isApplicationNumber,
  statusChangeSchema,
} from "./domain";

const validInput = {
  title: "Service agreement",
  received_at: "2026-07-23T10:00",
  priority: "normal",
  contract_subject: "Advisory services",
  contract_amount: "1000.50",
  currency: "RUB",
  performance_start_date: "2026-08-01",
  performance_end_date: "2026-08-31",
  payment_terms: "",
  counterparty_id: "",
  assigned_to: "",
  contract_template_id: "",
  internal_notes: "",
};

describe("application input validation", () => {
  it("normalizes valid creation input and empty optional fields", () => {
    const result = applicationInputSchema.parse(validInput);

    expect(result.contract_amount).toBe(1000.5);
    expect(result.payment_terms).toBeNull();
    expect(result.counterparty_id).toBeNull();
  });

  it("rejects a negative amount", () => {
    expect(() =>
      applicationInputSchema.parse({ ...validInput, contract_amount: "-1" }),
    ).toThrow(/negative/i);
  });

  it("rejects an invalid date range", () => {
    expect(() =>
      applicationInputSchema.parse({
        ...validInput,
        performance_start_date: "2026-09-01",
        performance_end_date: "2026-08-01",
      }),
    ).toThrow(/End date/i);
  });
});

describe("application statuses and numbers", () => {
  it("accepts every documented status and rejects unknown values", () => {
    for (const status of applicationStatuses) {
      expect(
        statusChangeSchema.safeParse({
          application_id: "30000000-0000-4000-8000-000000000001",
          status,
          reason: "",
        }).success,
      ).toBe(true);
    }

    expect(
      statusChangeSchema.safeParse({
        application_id: "30000000-0000-4000-8000-000000000001",
        status: "unknown",
        reason: "",
      }).success,
    ).toBe(false);
  });

  it("validates collision-safe number format", () => {
    expect(isApplicationNumber("REQ-2026-000001")).toBe(true);
    expect(isApplicationNumber("REQ-2026-1")).toBe(false);
    expect(isApplicationNumber("REQ-XXXX-000001")).toBe(false);
  });
});
