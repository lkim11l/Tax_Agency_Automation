import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202607230010_phase6_contract_generation.sql"),
  "utf8",
);
const hardening = readFileSync(
  resolve("supabase/migrations/202607230011_phase6_generation_hardening.sql"),
  "utf8",
);
const foundation = readFileSync(
  resolve("supabase/migrations/202607230001_phase1_application_registry.sql"),
  "utf8",
);
const combined = `${foundation}\n${migration}\n${hardening}`;

describe("phase 6 migration security contract", () => {
  it("adds versioned generation state, immutable source metadata and safe numbering", () => {
    expect(combined).toContain("create table public.contract_generation_runs");
    expect(combined).toContain("create sequence public.contract_number_seq");
    expect(combined).toContain("'TAA-'");
    expect(combined).toContain("source_fingerprint text");
    expect(combined).toContain("rendered_values_snapshot jsonb");
    expect(combined).toContain("completeness_run_id uuid");
    expect(combined).toContain("contract_generation_running_key");
    expect(combined).toContain("contracts_contract_number_key");
  });

  it("uses transactional advisory locks and server-only mutation functions", () => {
    expect(combined).toContain("pg_advisory_xact_lock");
    expect(combined).toContain("security definer");
    expect(combined).toContain("set search_path = ''");
    expect(combined).toContain("from public, anon, authenticated");
    expect(combined).toContain("to service_role");
    expect(`${migration}\n${hardening}`).not.toMatch(
      /grant\s+(insert|update|delete|all).*authenticated/iu,
    );
    expect(combined).toContain("contract_versions_immutable");
    expect(combined).toContain("COMPLETENESS_STALE");
  });

  it("keeps storage private and excludes destructive remote operations", () => {
    expect(combined).toContain("'contract-documents'");
    expect(combined).toMatch(/'contract-documents',\s*false/iu);
    expect(combined).toContain("contract_documents_select_active");
    expect(combined).not.toMatch(/\b(drop|truncate)\s+(table\s+)?public\./iu);
    expect(combined).not.toContain("storage.objects for insert to authenticated");
  });
});
