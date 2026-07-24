import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const statusMigration = readFileSync(
  resolve("supabase/migrations/202607230012_phase7_delivery_status_values.sql"),
  "utf8",
);
const migration = readFileSync(
  resolve("supabase/migrations/202607230013_phase7_contract_review_delivery.sql"),
  "utf8",
);
const hardening = readFileSync(
  resolve("supabase/migrations/202607230014_phase7_version_immutability_hardening.sql"),
  "utf8",
);
const schemaContract = readFileSync(
  resolve("supabase/migrations/202607240005_delivery_schema_contract.sql"),
  "utf8",
);

describe("phase 7 migration security contract", () => {
  it("stores checksum-bound reviews, versioned drafts, attempts and attachments", () => {
    expect(migration).toContain("create table public.contract_version_reviews");
    expect(migration).toContain("version_checksum text not null");
    expect(migration).toContain("contract_version_id uuid not null unique");
    expect(migration).toContain("create table public.contract_delivery_drafts");
    expect(migration).toContain("unique (contract_version_id, version)");
    expect(migration).toContain("create table public.contract_delivery_attempts");
    expect(migration).toContain("idempotency_key text not null unique");
    expect(migration).toContain("create table public.contract_delivery_attachments");
    expect(hardening).toContain("new.status is not distinct from old.status");
    expect(hardening).toContain("Invalid contract version status transition");
  });

  it("uses server-only security definer transitions with fixed search paths", () => {
    for (const name of [
      "review_contract_version",
      "claim_contract_delivery",
      "finalize_contract_delivery",
      "fail_contract_delivery",
    ]) {
      expect(migration).toContain(`function public.${name}`);
    }
    expect(migration.match(/security definer/giu)?.length).toBeGreaterThanOrEqual(4);
    expect(migration.match(/set search_path = ''/giu)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).not.toMatch(
      /grant\s+(insert|update|delete|all).*authenticated/iu,
    );
  });

  it("has honest terminal states and excludes destructive SQL", () => {
    expect(migration).toContain("'delivery_unknown'");
    expect(migration).toContain("'reconciliation_required'");
    expect(migration).toContain("'contract.delivery_uncertain'");
    expect(statusMigration).toContain("contract_revision_required");
    expect(statusMigration).toContain("contract_sent");
    expect(statusMigration).toContain("delivered");
    expect(`${statusMigration}\n${migration}\n${hardening}`).not.toMatch(
      /\b(drop\s+table|truncate|delete\s+from)\b/iu,
    );
  });

  it("keeps version as the canonical persisted draft column", () => {
    expect(migration).toMatch(
      /create table public\.contract_delivery_drafts[\s\S]*\bversion integer not null/iu,
    );
    expect(migration).not.toMatch(/\bdraft_version\s+integer/iu);
    expect(schemaContract).toContain(
      "('contract_delivery_drafts', 'version')",
    );
    expect(schemaContract).not.toContain(
      "('contract_delivery_drafts', 'draft_version')",
    );
    expect(schemaContract).toContain("security definer");
    expect(schemaContract).toContain("set search_path = ''");
    expect(schemaContract).toContain("to service_role");
    expect(schemaContract).not.toMatch(
      /\b(drop\s+table|drop\s+column|truncate|delete\s+from)\b/iu,
    );
  });
});
