import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202607230006_phase5_completeness_clarification.sql"),
  "utf8",
);

describe("phase 5 migration security contract", () => {
  it("creates versioned completeness and clarification persistence", () => {
    for (const name of [
      "completeness_runs",
      "completeness_field_results",
      "clarification_drafts",
      "clarification_send_attempts",
      "clarification_reply_runs",
    ]) {
      expect(migration).toContain(`create table public.${name}`);
      expect(migration).toContain(`alter table public.${name} enable row level security`);
    }
    expect(migration).toContain("approved_by uuid references public.profiles");
    expect(migration).toContain("idempotency_key text not null unique");
  });

  it("denies anonymous access and limits authenticated users to reads", () => {
    expect(migration).not.toMatch(/grant\s+(insert|update|delete|all).*authenticated/i);
    expect(migration).toContain("revoke all on public.completeness_runs from anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).not.toMatch(/\b(drop|truncate)\s+(table\s+)?public\./i);
  });
});
