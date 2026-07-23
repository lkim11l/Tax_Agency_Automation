import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_TEST_ADMIN_EMAIL",
  "SUPABASE_TEST_ADMIN_PASSWORD",
  "SUPABASE_TEST_SPECIALIST_EMAIL",
  "SUPABASE_TEST_SPECIALIST_PASSWORD",
  "SUPABASE_TEST_INACTIVE_EMAIL",
  "SUPABASE_TEST_INACTIVE_PASSWORD",
] as const;

type RequiredEnvironmentName = (typeof requiredEnvironment)[number];

function required(name: RequiredEnvironmentName): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required integration-test environment variable: ${name}`);
  }
  return value;
}

function publicKey(): string {
  const value =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return value;
}

function client(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    publicKey(),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}

async function signIn(
  instance: SupabaseClient,
  emailName:
    | "SUPABASE_TEST_ADMIN_EMAIL"
    | "SUPABASE_TEST_SPECIALIST_EMAIL"
    | "SUPABASE_TEST_INACTIVE_EMAIL",
  passwordName:
    | "SUPABASE_TEST_ADMIN_PASSWORD"
    | "SUPABASE_TEST_SPECIALIST_PASSWORD"
    | "SUPABASE_TEST_INACTIVE_PASSWORD",
) {
  const { data, error } = await instance.auth.signInWithPassword({
    email: required(emailName),
    password: required(passwordName),
  });
  expect(error).toBeNull();
  expect(data.user).not.toBeNull();
  return data.user!;
}

const phase1Tables = [
  "profiles",
  "applications",
  "counterparties",
  "email_messages",
  "attachments",
  "extracted_fields",
  "contract_templates",
  "contracts",
  "contract_versions",
  "status_history",
  "audit_events",
] as const;

describe.sequential("hosted Supabase Phase 1 acceptance", () => {
  let admin: SupabaseClient;
  let specialist: SupabaseClient;
  let inactive: SupabaseClient;
  let adminId: string;
  let counterpartyId: string;
  let templateId: string;
  const applicationIds: string[] = [];
  const applicationNumbers: string[] = [];
  const runId = `integration-${Date.now()}`;

  beforeAll(async () => {
    for (const name of requiredEnvironment) {
      required(name);
    }
    publicKey();
    admin = client();
    specialist = client();
    inactive = client();
    adminId = (await signIn(
      admin,
      "SUPABASE_TEST_ADMIN_EMAIL",
      "SUPABASE_TEST_ADMIN_PASSWORD",
    )).id;
  });

  afterAll(async () => {
    await Promise.all([
      admin?.auth.signOut(),
      specialist?.auth.signOut(),
      inactive?.auth.signOut(),
    ]);
  });

  it("has every Phase 1 table and denies anonymous reads", async () => {
    const anonymous = client();

    for (const table of phase1Tables) {
      const authenticatedResult = await admin.from(table).select("*").limit(1);
      expect(authenticatedResult.error, `${table} should exist`).toBeNull();

      const anonymousResult = await anonymous.from(table).select("*").limit(1);
      expect(
        anonymousResult.error !== null || anonymousResult.data?.length === 0,
        `${table} must not expose anonymous rows`,
      ).toBe(true);
    }
  });

  it("keeps public sign-up disabled", async () => {
    const response = await fetch(
      `${required("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/settings`,
      { headers: { apikey: publicKey() } },
    );
    const settings = (await response.json()) as { disable_signup?: boolean };
    expect(response.ok).toBe(true);
    expect(settings.disable_signup).toBe(true);
  });

  it("verifies the admin profile and real logout/login", async () => {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("role,is_active")
      .eq("id", adminId)
      .single();
    expect(error).toBeNull();
    expect(profile).toEqual({ role: "admin", is_active: true });

    expect((await admin.auth.getUser()).data.user?.id).toBe(adminId);
    expect((await admin.auth.signOut()).error).toBeNull();
    expect((await admin.auth.getSession()).data.session).toBeNull();
    adminId = (await signIn(
      admin,
      "SUPABASE_TEST_ADMIN_EMAIL",
      "SUPABASE_TEST_ADMIN_PASSWORD",
    )).id;
  });

  it("creates and updates a counterparty with persistence", async () => {
    const { data, error } = await admin
      .from("counterparties")
      .insert({
        legal_name: `Integration Counterparty ${runId}`,
        short_name: "Integration Test",
        inn: null,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    counterpartyId = data!.id;

    expect(
      (
        await admin
          .from("counterparties")
          .update({ contact_name: "Updated Integration Contact" })
          .eq("id", counterpartyId)
      ).error,
    ).toBeNull();

    const freshClient = client();
    await signIn(
      freshClient,
      "SUPABASE_TEST_ADMIN_EMAIL",
      "SUPABASE_TEST_ADMIN_PASSWORD",
    );
    const persisted = await freshClient
      .from("counterparties")
      .select("contact_name")
      .eq("id", counterpartyId)
      .single();
    expect(persisted.error).toBeNull();
    expect(persisted.data?.contact_name).toBe("Updated Integration Contact");
    await freshClient.auth.signOut();
  });

  it("creates and updates template metadata", async () => {
    const { data, error } = await admin
      .from("contract_templates")
      .insert({
        name: `Integration Template ${runId}`,
        description: "Metadata-only integration test",
        version: "1.0",
        status: "draft",
        required_fields: ["contract_subject"],
        variable_schema: {},
        is_active: false,
        created_by: adminId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    templateId = data!.id;

    const updated = await admin
      .from("contract_templates")
      .update({ description: "Updated metadata-only integration test" })
      .eq("id", templateId)
      .select("description")
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data?.description).toContain("Updated");
  });

  it("creates two applications with unique collision-safe numbers", async () => {
    for (const suffix of ["A", "B"]) {
      const { data, error } = await admin
        .from("applications")
        .insert({
          title: `Integration Application ${suffix} ${runId}`,
          source: "manual",
          status: "new",
          priority: "normal",
          received_at: new Date().toISOString(),
          counterparty_id: counterpartyId,
          contract_template_id: templateId,
          contract_subject: "Integration verification only",
          contract_amount: 100,
          currency: "RUB",
          created_by: adminId,
        })
        .select("id,application_number")
        .single();
      expect(error).toBeNull();
      applicationIds.push(data!.id);
      applicationNumbers.push(data!.application_number);
    }

    expect(new Set(applicationNumbers).size).toBe(2);
    for (const number of applicationNumbers) {
      expect(number).toMatch(/^REQ-\d{4}-\d{6,}$/);
    }
  });

  it("persists edits after a new authenticated client session", async () => {
    expect(
      (
        await admin
          .from("applications")
          .update({ payment_terms: "Persisted integration terms" })
          .eq("id", applicationIds[0])
      ).error,
    ).toBeNull();

    const restartedSession = client();
    await signIn(
      restartedSession,
      "SUPABASE_TEST_ADMIN_EMAIL",
      "SUPABASE_TEST_ADMIN_PASSWORD",
    );
    const result = await restartedSession
      .from("applications")
      .select("payment_terms")
      .eq("id", applicationIds[0])
      .single();
    expect(result.error).toBeNull();
    expect(result.data?.payment_terms).toBe("Persisted integration terms");
    await restartedSession.auth.signOut();
  });

  it("changes status atomically and records history and audit", async () => {
    const changed = await admin.rpc("change_application_status", {
      p_application_id: applicationIds[0],
      p_new_status: "processing",
      p_reason: "Hosted integration acceptance",
    });
    expect(changed.error).toBeNull();

    const history = await admin
      .from("status_history")
      .select("previous_status,new_status,reason")
      .eq("application_id", applicationIds[0])
      .eq("new_status", "processing");
    expect(history.error).toBeNull();
    expect(history.data).toContainEqual({
      previous_status: "new",
      new_status: "processing",
      reason: "Hosted integration acceptance",
    });

    const audit = await admin
      .from("audit_events")
      .select("action")
      .eq("application_id", applicationIds[0]);
    expect(audit.error).toBeNull();
    expect(audit.data?.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "application.created",
        "application.updated",
        "application.status_changed",
      ]),
    );
  });

  it("enforces database constraints", async () => {
    const base = {
      title: `Constraint test ${runId}`,
      source: "manual",
      status: "new",
      priority: "normal",
      received_at: new Date().toISOString(),
      created_by: adminId,
    };

    expect(
      (
        await admin.from("applications").insert({
          ...base,
          contract_amount: -1,
          currency: "RUB",
        })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await admin.from("applications").insert({
          ...base,
          performance_start_date: "2026-12-31",
          performance_end_date: "2026-01-01",
        })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await admin.from("applications").insert({
          ...base,
          status: "not_a_real_status",
        })
      ).error,
    ).not.toBeNull();
  });

  it("allows an active specialist operational access", async () => {
    const specialistUser = await signIn(
      specialist,
      "SUPABASE_TEST_SPECIALIST_EMAIL",
      "SUPABASE_TEST_SPECIALIST_PASSWORD",
    );
    const profile = await specialist
      .from("profiles")
      .select("role,is_active")
      .eq("id", specialistUser.id)
      .single();
    expect(profile.error).toBeNull();
    expect(profile.data).toEqual({ role: "specialist", is_active: true });

    const applications = await specialist
      .from("applications")
      .select("id")
      .in("id", applicationIds);
    expect(applications.error).toBeNull();
    expect(applications.data).toHaveLength(2);

    const operationalUpdate = await specialist
      .from("applications")
      .update({ priority: "high" })
      .eq("id", applicationIds[1])
      .select("priority")
      .single();
    expect(operationalUpdate.error).toBeNull();
    expect(operationalUpdate.data?.priority).toBe("high");

    const escalation = await specialist
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", specialistUser.id)
      .select("role");
    expect(escalation.error).toBeNull();
    expect(escalation.data).toEqual([]);

    const unchangedProfile = await specialist
      .from("profiles")
      .select("role")
      .eq("id", specialistUser.id)
      .single();
    expect(unchangedProfile.data?.role).toBe("specialist");
  });

  it("denies an inactive specialist operational rows", async () => {
    await signIn(
      inactive,
      "SUPABASE_TEST_INACTIVE_EMAIL",
      "SUPABASE_TEST_INACTIVE_PASSWORD",
    );
    const applications = await inactive.from("applications").select("id").limit(1);
    expect(applications.error).toBeNull();
    expect(applications.data).toEqual([]);

    const update = await inactive
      .from("applications")
      .update({ priority: "urgent" })
      .eq("id", applicationIds[0])
      .select("id");
    expect(update.error).toBeNull();
    expect(update.data).toEqual([]);
  });

  it("denies anonymous access after operational rows exist", async () => {
    const anonymous = client();
    const checks = [
      anonymous.from("applications").select("id").in("id", applicationIds),
      anonymous.from("counterparties").select("id").eq("id", counterpartyId),
      anonymous.from("contract_templates").select("id").eq("id", templateId),
      anonymous
        .from("audit_events")
        .select("id")
        .eq("application_id", applicationIds[0]),
    ];

    for (const pending of checks) {
      const result = await pending;
      expect(result.error !== null || result.data?.length === 0).toBe(true);
    }
  });

  it("keeps audit and history append-only for authenticated clients", async () => {
    const audit = await admin
      .from("audit_events")
      .update({ action: "tampered" })
      .eq("application_id", applicationIds[0]);
    expect(audit.error).not.toBeNull();

    const history = await admin
      .from("status_history")
      .delete()
      .eq("application_id", applicationIds[0]);
    expect(history.error).not.toBeNull();
  });
});
