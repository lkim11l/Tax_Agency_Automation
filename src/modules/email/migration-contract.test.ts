import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/202607230002_phase2_email_ingestion.sql",
  ),
  "utf8",
);

describe("Phase 2 migration contract", () => {
  it("creates mailbox state and mailbox-scoped idempotency", () => {
    expect(migration).toContain("create table public.mailbox_sync_state");
    expect(migration).toContain("email_messages_mailbox_uid_key");
    expect(migration).toContain("uid_validity");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("uses service-only atomic ingestion and safe function search paths", () => {
    expect(migration).toContain("create function public.ingest_email_message");
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain(
      "grant execute on function public.ingest_email_message(jsonb) to service_role",
    );
    const functions = migration.match(/create function/g) ?? [];
    const safePaths = migration.match(/set search_path = ''/g) ?? [];
    expect(safePaths.length).toBeGreaterThanOrEqual(functions.length);
  });

  it("creates a private constrained attachment bucket and authenticated read RLS", () => {
    expect(migration).toContain("'email-attachments'");
    expect(migration).toMatch(/'email-attachments',\s*false,\s*10485760/);
    expect(migration).toContain("email_attachments_select_active");
    expect(migration).toContain("public.is_active_user()");
  });

  it("does not contain destructive schema operations", () => {
    expect(migration).not.toMatch(/\bdrop\s+(table|schema|database)\b/i);
    expect(migration).not.toMatch(/\btruncate\b/i);
  });
});
