import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  || required("NEXT_PUBLIC_SUPABASE_ANON_KEY");

function client() {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signedIn(email: string, password: string) {
  const instance = client();
  const { error } = await instance.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return instance;
}

describe.sequential("hosted Phase 9 operational controls", () => {
  it("denies anonymous operational reads and RPC claims", async () => {
    const anonymous = client();
    for (const table of ["background_job_runs", "system_component_status"]) {
      const result = await anonymous.from(table).select("*").limit(1);
      expect(result.error !== null || result.data?.length === 0).toBe(true);
    }
    expect((await anonymous.rpc("claim_background_job", {
      p_job_type: "mailbox_pipeline",
      p_trigger_source: "smoke",
      p_lock_timeout_seconds: 300,
      p_minimum_interval_seconds: 0,
    })).error).not.toBeNull();
  });

  it("allows admin read-only visibility but denies direct mutation", async () => {
    const admin = await signedIn(
      required("SUPABASE_TEST_ADMIN_EMAIL"),
      required("SUPABASE_TEST_ADMIN_PASSWORD"),
    );
    expect((await admin.from("background_job_runs").select("id").limit(1)).error).toBeNull();
    expect((await admin.from("system_component_status").select("component").limit(1)).error).toBeNull();
    expect((await admin.from("background_job_runs").insert({
      job_type: "mailbox_pipeline",
      trigger_source: "manual",
    })).error).not.toBeNull();
    await admin.auth.signOut();
  });

  it.each([
    ["SUPABASE_TEST_SPECIALIST_EMAIL", "SUPABASE_TEST_SPECIALIST_PASSWORD"],
    ["SUPABASE_TEST_INACTIVE_EMAIL", "SUPABASE_TEST_INACTIVE_PASSWORD"],
  ])("hides operational state from specialist profile %s", async (emailName, passwordName) => {
    const user = await signedIn(required(emailName), required(passwordName));
    const result = await user.from("background_job_runs").select("id").limit(10);
    expect(result.error === null ? result.data : []).toEqual([]);
    await user.auth.signOut();
  });
});
