import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202607230005_phase4_structured_extraction.sql",
  ),
  "utf8",
);

describe("Phase 4 migration contract", () => {
  it("defines durable runs, conflicts, correction history, and cache locks", () => {
    expect(migration).toContain("create table public.extraction_runs");
    expect(migration).toContain("create table public.extraction_conflicts");
    expect(migration).toContain("create table public.extracted_field_corrections");
    expect(migration).toContain("extraction_runs_active_key");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("preserves manual corrections during repeated extraction", () => {
    expect(migration).toContain("existing_field.manually_corrected");
    expect(migration).toContain("continue;");
    expect(migration).toContain("extracted_field_corrections_immutable");
  });

  it("keeps worker functions service-role-only and correction authenticated", () => {
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain("grant execute on function public.correct_extracted_field");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("public.is_active_user()");
  });

  it("records required safe audit actions without prompts or document text", () => {
    for (const action of [
      "extraction.started",
      "extraction.completed",
      "extraction.failed",
      "extraction.cache_hit",
      "extraction.conflict_detected",
      "extraction.field_corrected",
      "extraction.candidate_selected",
      "extraction.manual_null_set",
    ]) {
      expect(migration).toContain(action);
    }
    expect(migration).not.toMatch(/metadata[\s\S]{0,200}(api_key|full_prompt|model_output)/iu);
  });
});
