import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202607240006_autonomous_application_processing.sql"),
  "utf8",
);
const acceptanceRpcFix = readFileSync(
  resolve("supabase/migrations/202607240007_fix_acceptance_rpc_counter.sql"),
  "utf8",
);

describe("autonomous application processing migration", () => {
  it("stores immutable field acceptance separately from corrections", () => {
    expect(migration).toContain("create table public.extraction_acceptance_batches");
    expect(migration).toContain("create table public.extracted_field_acceptances");
    expect(migration).toContain("extracted_field_acceptances_immutable");
    expect(migration).not.toContain("insert into public.extracted_field_corrections");
  });

  it("provides transactional idempotency and persistent processing progress", () => {
    expect(migration).toContain("create table public.application_processing_runs");
    expect(migration).toContain("application_processing_one_running");
    expect(migration).toContain("application_processing_success_cache");
    expect(migration).toContain("completeness_runs_fingerprint_key");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("unique (application_id, batch_fingerprint)");
  });

  it("keeps mutations service-only with fixed search paths and no destructive SQL", () => {
    expect(migration.match(/security definer/giu)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/set search_path = ''/giu)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("to service_role");
    expect(migration).not.toMatch(
      /\b(drop\s+table|drop\s+column|truncate|delete\s+from)\b/iu,
    );
  });

  it("keeps RPC counters unambiguous in the additive production fix", () => {
    expect(acceptanceRpcFix).toContain("v_inserted_count");
    expect(acceptanceRpcFix).toContain("v_blocked_count");
    expect(acceptanceRpcFix).not.toContain("set accepted_count = inserted_count");
    expect(acceptanceRpcFix).not.toContain("set blocked_count = blocked_count");
  });
});
