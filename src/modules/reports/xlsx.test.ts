import { describe, expect, it } from "vitest";

import { aggregateRegistryRows, parseRegistryFilters, type MonthlyMetrics, type RegistryRow } from "./domain";
import { serializeContractReport, verifyContractReport } from "./xlsx";

describe("Phase 8 XLSX", () => {
  it("creates stable Contracts and Summary sheets with native data types", async () => {
    const rows = [{
      application_id: "11111111-1111-4111-8111-111111111111",
      application_number: "=unsafe", application_title: "Test",
      received_at: "2026-07-01T00:00:00Z", application_status: "contract_sent",
      assigned_to: null, application_created_by: null, contract_subject: "Services",
      contract_amount: 12.5, currency: "RUB", counterparty_id: null,
      counterparty_name: "Example", inn: "0077000000", bank_account: "040702810000000000001",
      specialist_name: "Specialist", specialist_email: null,
      contract_id: "22222222-2222-4222-8222-222222222222", contract_number: "TAA-1",
      contract_status: "delivered", approved_at: "2026-07-01T03:00:00Z",
      sent_at: "2026-07-01T04:00:00Z", current_version_id: "33333333-3333-4333-8333-333333333333",
      version_number: 1, generated_at: "2026-07-01T02:00:00Z", contract_date: "2026-07-01",
      generated_filename: "contract.docx", version_checksum: "a".repeat(64),
      template_id: null, template_name: "Services", template_version: "1",
      template_type: "services", completeness_percentage: 100, completeness_ready: true,
      has_conflicts: false, correspondence_count: 1,
    }] satisfies RegistryRow[];
    const metrics: MonthlyMetrics = {
      newApplications: 1, processedApplications: 1, completedContracts: 1,
      sentContracts: 1, waitingForClient: 0, manualReview: 0, rejectedContracts: 0,
      clarificationEmails: 0, repeatedClarifications: 0, averageProcessingHours: 3,
      amountsByCurrency: { RUB: 12.5 }, contractsByTemplateType: { services: 1 },
      workBySpecialist: { Specialist: 1 },
    };
    const content = await serializeContractReport({
      rows, totals: aggregateRegistryRows(rows), metrics,
      filters: parseRegistryFilters({}, new Date("2026-07-23T00:00:00Z")),
      generatedBy: "admin", generatedAt: new Date("2026-07-23T00:00:00Z"),
      fingerprint: "f".repeat(64),
    });
    expect(content.subarray(0, 2).toString()).toBe("PK");
    expect(await verifyContractReport(content)).toEqual({ contractRows: 1, summaryRows: 22 });
  });
});
