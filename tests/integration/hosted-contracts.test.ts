import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing integration variable: ${name}`);
  return value;
}

function publicKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

function client(key = publicKey()) {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function signIn(instance: SupabaseClient, email: string, password: string) {
  const result = await instance.auth.signInWithPassword({
    email: required(email),
    password: required(password),
  });
  expect(result.error).toBeNull();
}

describe.sequential("hosted Supabase Phase 6 contract acceptance", () => {
  const service = client(process.env.SUPABASE_SECRET_KEY ?? required("SUPABASE_SERVICE_ROLE_KEY"));
  const anonymous = client();
  const specialist = client();
  const inactive = client();

  beforeAll(async () => {
    await signIn(specialist, "SUPABASE_TEST_SPECIALIST_EMAIL", "SUPABASE_TEST_SPECIALIST_PASSWORD");
    await signIn(inactive, "SUPABASE_TEST_INACTIVE_EMAIL", "SUPABASE_TEST_INACTIVE_PASSWORD");
  });

  it("has the Phase 6 tables, columns and private Storage bucket", async () => {
    expect((await service.from("contract_generation_runs").select(
      "id,source_fingerprint,idempotency_key,contract_number,status,force_requested",
    ).limit(1)).error).toBeNull();
    expect((await service.from("contract_versions").select(
      "id,template_id,source_fingerprint,completeness_run_id,mapping_version,rendered_values_snapshot,generated_filename,status",
    ).limit(1)).error).toBeNull();
    const buckets = await service.storage.listBuckets();
    expect(buckets.error).toBeNull();
    expect(buckets.data?.find((item) => item.id === "contract-documents")?.public).toBe(false);
  });

  it("denies anonymous and inactive access while allowing active specialist reads", async () => {
    for (const table of ["contracts", "contract_versions", "contract_generation_runs"]) {
      expect((await specialist.from(table).select("id").limit(1)).error).toBeNull();
      const anonymousResult = await anonymous.from(table).select("id").limit(1);
      expect(anonymousResult.error !== null || anonymousResult.data?.length === 0).toBe(true);
      const inactiveResult = await inactive.from(table).select("id").limit(1);
      expect(inactiveResult.error !== null || inactiveResult.data?.length === 0).toBe(true);
    }
  });

  it("blocks direct specialist template mutations and generation RPC execution", async () => {
    expect((await specialist.from("contract_templates").insert({
      name: "forbidden",
      version: "0",
      variable_schema: {},
      required_fields: [],
    })).error).not.toBeNull();
    const rpc = await specialist.rpc("fail_contract_generation", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_error_code: "FORBIDDEN",
    });
    expect(rpc.error).not.toBeNull();
  });

  it("keeps generated versions immutable and private for inactive users", async () => {
    const version = await service.from("contract_versions")
      .select("id,storage_path,checksum")
      .not("generated_filename", "is", null)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(version.error).toBeNull();
    expect(version.data).not.toBeNull();
    if (!version.data) return;
    expect((await service.from("contract_versions")
      .update({ checksum: version.data.checksum })
      .eq("id", version.data.id)).error).not.toBeNull();
    expect((await specialist.from("contract_versions")
      .update({ checksum: version.data.checksum })
      .eq("id", version.data.id)).error).not.toBeNull();
    expect((await inactive.storage.from("contract-documents")
      .download(version.data.storage_path)).error).not.toBeNull();
  });
});
