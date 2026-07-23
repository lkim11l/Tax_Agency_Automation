import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202607230001_phase1_application_registry.sql",
  ),
  "utf8",
);

describe("Phase 1 migration contract", () => {
  it.each([
    "profiles",
    "applications",
    "counterparties",
    "email_messages",
    "attachments",
    "extracted_fields",
    "contract_templates",
    "contracts",
    "contract_versions",
    "status_history",
    "audit_events",
  ])("creates the %s table", (table) => {
    expect(migration).toContain(`create table public.${table}`);
    expect(migration).toContain(`alter table public.${table} enable row level security`);
  });

  it("uses a sequence instead of row counts for application numbers", () => {
    expect(migration).toContain("create sequence public.application_number_seq");
    expect(migration).toContain("nextval('public.application_number_seq')");
    expect(migration).not.toMatch(
      /count\s*\(\s*\*\s*\)[\s\S]*application_number/i,
    );
  });

  it("records status history and audit in the application update transaction", () => {
    expect(migration).toContain("create function public.record_application_change()");
    expect(migration).toContain("insert into public.status_history");
    expect(migration).toContain("'application.status_changed'");
    expect(migration).toContain("after insert or update on public.applications");
  });

  it("does not grant direct audit mutation or contract-version mutation", () => {
    expect(migration).not.toMatch(
      /grant\s+(insert|update|delete)[^;]*public\.audit_events/i,
    );
    expect(migration).toContain("create trigger contract_versions_immutable");
  });
});
