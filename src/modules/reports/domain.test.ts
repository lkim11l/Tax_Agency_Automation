import { describe, expect, it } from "vitest";

import {
  aggregateRegistryRows,
  excelSafeText,
  parseRegistryFilters,
  reportCacheKey,
  stableFingerprint,
  type RegistryRow,
} from "./domain";

const row = (overrides: Partial<RegistryRow> = {}): RegistryRow => ({
  application_id: "11111111-1111-4111-8111-111111111111",
  application_number: "REQ-1",
  application_title: "Test",
  received_at: "2026-07-01T00:00:00Z",
  application_status: "contract_sent",
  assigned_to: null,
  application_created_by: null,
  contract_subject: "Services",
  contract_amount: 1250.5,
  currency: "RUB",
  counterparty_id: null,
  counterparty_name: "Example",
  inn: "7700000000",
  bank_account: "40702810000000000001",
  specialist_name: "Specialist",
  specialist_email: "specialist@example.invalid",
  contract_id: "22222222-2222-4222-8222-222222222222",
  contract_number: "TAA-1",
  contract_status: "delivered",
  approved_at: "2026-07-01T03:00:00Z",
  sent_at: "2026-07-01T04:00:00Z",
  current_version_id: "33333333-3333-4333-8333-333333333333",
  version_number: 1,
  generated_at: "2026-07-01T02:00:00Z",
  contract_date: "2026-07-01",
  generated_filename: "contract.docx",
  version_checksum: "a".repeat(64),
  template_id: null,
  template_name: "Services",
  template_version: "1",
  template_type: "services",
  completeness_percentage: 100,
  completeness_ready: true,
  has_conflicts: false,
  correspondence_count: 2,
  ...overrides,
});

describe("Phase 8 report domain", () => {
  it("validates dates, pagination and defaults", () => {
    const filters = parseRegistryFilters({}, new Date("2026-07-23T00:00:00Z"));
    expect(filters).toMatchObject({ dateFrom: "2026-07-01", dateTo: "2026-07-31", page: 1, pageSize: 25 });
    expect(() => parseRegistryFilters({ dateFrom: "2026-08-01", dateTo: "2026-07-01" })).toThrow();
  });

  it("aggregates distinct entities and never merges currency totals", () => {
    const result = aggregateRegistryRows([
      row(),
      row({ contract_id: "44444444-4444-4444-8444-444444444444", currency: "USD", contract_amount: 10 }),
    ]);
    expect(result.applicationCount).toBe(1);
    expect(result.contractCount).toBe(2);
    expect(result.amountsByCurrency).toEqual({ RUB: 1250.5, USD: 10 });
    expect(result.averageDeliveryHours).toBe(4);
  });

  it("creates stable actor-scoped cache keys and neutralizes spreadsheet formulas", () => {
    expect(stableFingerprint({ b: 2, a: 1 })).toBe(stableFingerprint({ a: 1, b: 2 }));
    const filters = parseRegistryFilters({}, new Date("2026-07-23T00:00:00Z"));
    expect(reportCacheKey({ actorId: "a", reportType: "monthly", filters, dataFingerprint: "1" }))
      .not.toBe(reportCacheKey({ actorId: "b", reportType: "monthly", filters, dataFingerprint: "1" }));
    expect(excelSafeText("=WEBSERVICE(\"x\")")).toBe("'=WEBSERVICE(\"x\")");
  });
});
