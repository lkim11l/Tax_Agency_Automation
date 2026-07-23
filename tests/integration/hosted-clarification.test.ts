import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  return result.data.user!;
}

describe.sequential("hosted Supabase Phase 5 clarification acceptance", () => {
  const service = client(process.env.SUPABASE_SECRET_KEY ?? required("SUPABASE_SERVICE_ROLE_KEY"));
  const anonymous = client();
  const admin = client();
  const specialist = client();
  const inactive = client();
  let adminId = "";
  let applicationId = "";
  let runId = "";
  let draftId = "";

  beforeAll(async () => {
    adminId = (await signIn(admin, "SUPABASE_TEST_ADMIN_EMAIL", "SUPABASE_TEST_ADMIN_PASSWORD")).id;
    await signIn(specialist, "SUPABASE_TEST_SPECIALIST_EMAIL", "SUPABASE_TEST_SPECIALIST_PASSWORD");
    await signIn(inactive, "SUPABASE_TEST_INACTIVE_EMAIL", "SUPABASE_TEST_INACTIVE_PASSWORD");
    const application = await admin.from("applications").insert({
      title: `Phase 5 integration ${Date.now()}`,
      source: "manual",
      status: "needs_data_review",
      priority: "normal",
      received_at: new Date().toISOString(),
      created_by: adminId,
    }).select("id").single();
    expect(application.error).toBeNull();
    applicationId = application.data!.id;
  });

  afterAll(async () => {
    if (applicationId) await service.from("applications").delete().eq("id", applicationId);
    await Promise.all([admin.auth.signOut(), specialist.auth.signOut(), inactive.auth.signOut()]);
  });

  it("exposes no Phase 5 rows to anonymous or inactive users", async () => {
    for (const table of [
      "completeness_runs",
      "completeness_field_results",
      "clarification_drafts",
      "clarification_send_attempts",
      "clarification_reply_runs",
    ]) {
      expect((await admin.from(table).select("id").limit(1)).error).toBeNull();
      const anonymousResult = await anonymous.from(table).select("id").limit(1);
      expect(anonymousResult.error !== null || anonymousResult.data?.length === 0).toBe(true);
      const inactiveResult = await inactive.from(table).select("id").limit(1);
      expect(inactiveResult.error !== null || inactiveResult.data?.length === 0).toBe(true);
    }
  });

  it("persists a versioned completeness snapshot and field results", async () => {
    const run = await service.from("completeness_runs").insert({
      application_id: applicationId,
      rule_set_id: "standard-contract",
      rule_set_version: "1.0.0",
      total_count: 11,
      complete_count: 1,
      missing_count: 10,
      conflict_count: 0,
      low_confidence_count: 0,
      review_required_count: 0,
      invalid_count: 0,
      percentage: 9,
      is_blocking: true,
      is_ready: false,
      created_by: adminId,
    }).select("id").single();
    expect(run.error).toBeNull();
    runId = run.data!.id;
    expect((await service.from("completeness_field_results").insert({
      completeness_run_id: runId,
      application_id: applicationId,
      field_name: "inn",
      label: "ИНН",
      question: "Укажите ИНН организации.",
      is_required: true,
      status: "missing",
      is_blocking: true,
      reason: "VALUE_MISSING",
    })).error).toBeNull();
    expect((await specialist.from("completeness_field_results").select("status").eq("completeness_run_id", runId).single()).data?.status).toBe("missing");
  });

  it("stores approval metadata and immutable send snapshots while blocking direct user writes", async () => {
    const draft = await service.from("clarification_drafts").insert({
      application_id: applicationId,
      completeness_run_id: runId,
      status: "approved",
      recipient: "phase5-recipient@example.invalid",
      subject: "Phase 5 integration",
      body_text: "Deterministic clarification.",
      approved_by: adminId,
      approved_at: new Date().toISOString(),
      created_by: adminId,
      updated_by: adminId,
    }).select("id").single();
    expect(draft.error).toBeNull();
    draftId = draft.data!.id;
    expect((await service.from("clarification_send_attempts").insert({
      draft_id: draftId,
      application_id: applicationId,
      attempt_number: 1,
      idempotency_key: `${draftId}:1:1`,
      status: "safe_failure",
      provider: "mailru",
      rfc_message_id: `<${draftId}@example.invalid>`,
      recipient: "phase5-recipient@example.invalid",
      subject: "Phase 5 integration",
      body_text: "Deterministic clarification.",
      safe_error_code: "SMTP_SEND_FAILED",
      safe_error_message: "Synthetic safe failure.",
      created_by: adminId,
    })).error).toBeNull();
    expect((await specialist.from("clarification_drafts").update({ subject: "forbidden" }).eq("id", draftId)).error).not.toBeNull();
    expect((await inactive.from("clarification_drafts").insert({
      application_id: applicationId,
      completeness_run_id: runId,
      recipient: "denied@example.invalid",
      subject: "denied",
      body_text: "denied",
      created_by: adminId,
      updated_by: adminId,
    })).error).not.toBeNull();
  });
});
