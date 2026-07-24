import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing integration variable: ${name}`);
  return value;
};
const publicKey = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const client = (key = publicKey()) => createClient(required("NEXT_PUBLIC_SUPABASE_URL"), key, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
async function signIn(instance: SupabaseClient, email: string, password: string) {
  expect((await instance.auth.signInWithPassword({ email: required(email), password: required(password) })).error).toBeNull();
}

describe.sequential("hosted Supabase Phase 8 reporting security", () => {
  const service = client(process.env.SUPABASE_SECRET_KEY ?? required("SUPABASE_SERVICE_ROLE_KEY"));
  const anonymous = client();
  const specialist = client();
  const admin = client();
  const inactive = client();
  beforeAll(async () => {
    await signIn(specialist, "SUPABASE_TEST_SPECIALIST_EMAIL", "SUPABASE_TEST_SPECIALIST_PASSWORD");
    await signIn(admin, "SUPABASE_TEST_ADMIN_EMAIL", "SUPABASE_TEST_ADMIN_PASSWORD");
    await signIn(inactive, "SUPABASE_TEST_INACTIVE_EMAIL", "SUPABASE_TEST_INACTIVE_PASSWORD");
  });

  it("has the registry view, report table and private bucket", async () => {
    expect((await service.from("contract_registry_entries").select("application_id,contract_id,bank_account").limit(1)).error).toBeNull();
    expect((await service.from("report_exports").select("id,cache_key,data_fingerprint,status").limit(1)).error).toBeNull();
    expect((await service.from("storage.buckets").select("id")).error).not.toBeNull();
    expect((await service.storage.getBucket("report-exports")).data?.public).toBe(false);
  });

  it("denies direct registry access, inactive/anonymous report reads and specialist mutation", async () => {
    expect((await specialist.from("contract_registry_entries").select("application_id").limit(1)).error).not.toBeNull();
    for (const instance of [anonymous, inactive]) {
      const result = await instance.from("report_exports").select("id").limit(1);
      expect(result.error !== null || result.data?.length === 0).toBe(true);
    }
    expect((await specialist.from("report_exports").insert({
      report_type: "monthly", period_start: "2026-07-01", period_end: "2026-07-31",
      report_schema_version: "x", data_fingerprint: "a".repeat(64),
      cache_key: "b".repeat(64), generated_by: "00000000-0000-0000-0000-000000000000",
    })).error).not.toBeNull();
    expect((await specialist.rpc("claim_report_export", {
      p_actor_id: "00000000-0000-0000-0000-000000000000", p_report_type: "monthly",
      p_period_start: "2026-07-01", p_period_end: "2026-07-31", p_filters: {},
      p_report_schema_version: "x", p_data_fingerprint: "a".repeat(64),
      p_cache_key: "b".repeat(64), p_force: false, p_force_reason: null,
    })).error).not.toBeNull();
  });

  it("keeps completed report records immutable and private objects non-public", async () => {
    const report = await service.from("report_exports").select("id,storage_path,generated_by,status")
      .eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    expect(report.error).toBeNull();
    if (!report.data) return;
    expect((await service.from("report_exports").update({ row_count: 999 }).eq("id", report.data.id)).error).not.toBeNull();
    const anonymousDownload = await anonymous.storage.from("report-exports").download(report.data.storage_path);
    expect(anonymousDownload.error).not.toBeNull();
  });
});
