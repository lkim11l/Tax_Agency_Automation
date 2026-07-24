import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202607230015_phase8_registry_reporting.sql"),
  "utf8",
).toLowerCase();

describe("Phase 8 migration contract", () => {
  it("keeps report storage private, exports immutable and orchestration service-only", () => {
    expect(migration).toContain("create table public.report_exports");
    expect(migration).toContain("create view public.contract_registry_entries");
    expect(migration).toContain("values ('report-exports', 'report-exports', false)");
    expect(migration).toContain("report_exports_immutable");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toMatch(/\b(drop table|truncate|delete from)\b/u);
  });
});
