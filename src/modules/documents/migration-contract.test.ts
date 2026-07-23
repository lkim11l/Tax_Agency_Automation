import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/202607230003_phase3_document_parsing.sql",
  ),
  "utf8",
);
const cascadeMigration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/202607230004_phase3_attempt_cascade.sql",
  ),
  "utf8",
);

describe("Phase 3 migration contract", () => {
  it("defines all parse states and immutable attempt history", () => {
    for (const status of [
      "pending",
      "processing",
      "parsed",
      "review_required",
      "unsupported",
      "blocked",
      "failed",
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toContain("document_parse_attempts_immutable");
    expect(migration).toContain("parsed_documents_text_length_matches");
  });

  it("claims pending work atomically and exposes worker RPCs only to service role", () => {
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("where parse_status = 'pending'");
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain(
      "grant execute on function public.claim_attachment_for_parsing(uuid)\nto service_role",
    );
    expect(migration).toContain(
      "revoke all on function public.claim_attachment_for_parsing(uuid)\nfrom public, anon, authenticated",
    );
  });

  it("uses active-user read RLS and no authenticated table writes", () => {
    expect(migration).toContain("parsed_documents_select_active");
    expect(migration).toContain("document_parse_attempts_select_active");
    expect(migration).not.toMatch(
      /grant (insert|update|delete)[\s\S]*parsed_documents[\s\S]*authenticated/i,
    );
  });

  it("records required document audit actions", () => {
    for (const action of [
      "document.parse_started",
      "document.parsed",
      "document.parse_failed",
      "document.parse_warning",
      "document.parse_review_required",
      "document.parse_unsupported",
      "document.parse_blocked",
      "document.parse_retried",
    ]) {
      expect(migration).toContain(action);
    }
  });

  it("sets empty search paths and contains no destructive reset", () => {
    expect(migration).toContain("set search_path = ''");
    expect(migration).not.toMatch(/\b(drop table|truncate|delete from|db reset)\b/i);
  });

  it("allows only parent-driven cascade deletion of immutable attempts", () => {
    expect(cascadeMigration).toContain("from public.attachments");
    expect(cascadeMigration).toContain(
      "raise exception 'Document parse attempts are immutable'",
    );
    expect(cascadeMigration).toContain("return old");
    expect(cascadeMigration).toContain("set search_path = ''");
  });
});
