import { createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required integration variable: ${name}`);
  return value;
}

function publicKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
}

function secretKey() {
  return process.env.SUPABASE_SECRET_KEY ?? required("SUPABASE_SERVICE_ROLE_KEY");
}

function client(key = publicKey()) {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function signIn(
  instance: SupabaseClient,
  emailName: string,
  passwordName: string,
) {
  const result = await instance.auth.signInWithPassword({
    email: required(emailName),
    password: required(passwordName),
  });
  expect(result.error).toBeNull();
  return result.data.user!;
}

function field(value: string, sourceId: string) {
  const structured = {
    value,
    normalizedValue: value,
    rawValue: value,
    sourceType: "email_message",
    sourceId,
    sourceMarker: "[EMAIL BODY]",
    sourceExcerpt: `ИНН: ${value}`,
    confidence: 0.9,
    requiresReview: false,
    reason: "DIRECT_SOURCE",
  };
  return {
    field_name: "inn",
    normalized_value: value,
    structured_value: structured,
    raw_value: value,
    source_type: "email_message",
    source_id: sourceId,
    source_marker: "[EMAIL BODY]",
    source_excerpt: `ИНН: ${value}`,
    confidence: 0.9,
    requires_review: false,
    conflict_detected: false,
  };
}

describe.sequential("hosted Supabase Phase 4 extraction acceptance", () => {
  const fingerprint = createHash("sha256").update(`phase4-${Date.now()}`).digest("hex");
  const sourceId = "11111111-1111-4111-8111-111111111111";
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let specialist: SupabaseClient;
  let inactive: SupabaseClient;
  let adminId: string;
  let applicationId: string;
  let runId: string;

  beforeAll(async () => {
    service = client(secretKey());
    admin = client();
    specialist = client();
    inactive = client();
    adminId = (
      await signIn(admin, "SUPABASE_TEST_ADMIN_EMAIL", "SUPABASE_TEST_ADMIN_PASSWORD")
    ).id;
    await signIn(
      specialist,
      "SUPABASE_TEST_SPECIALIST_EMAIL",
      "SUPABASE_TEST_SPECIALIST_PASSWORD",
    );
    await signIn(
      inactive,
      "SUPABASE_TEST_INACTIVE_EMAIL",
      "SUPABASE_TEST_INACTIVE_PASSWORD",
    );
    const created = await admin
      .from("applications")
      .insert({
        title: `Hosted Phase 4 ${Date.now()}`,
        source: "manual",
        status: "new",
        priority: "normal",
        received_at: new Date().toISOString(),
        created_by: adminId,
      })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    applicationId = created.data!.id;
  });

  afterAll(async () => {
    if (applicationId) {
      await service.from("applications").delete().eq("id", applicationId);
    }
    await Promise.all([
      admin?.auth.signOut(),
      specialist?.auth.signOut(),
      inactive?.auth.signOut(),
    ]);
  });

  it("creates Phase 4 tables and denies anonymous and inactive reads", async () => {
    for (const table of [
      "extraction_runs",
      "extraction_conflicts",
      "extracted_field_corrections",
    ]) {
      expect((await admin.from(table).select("id").limit(1)).error).toBeNull();
      const anonymous = await client().from(table).select("id").limit(1);
      expect(anonymous.error !== null || anonymous.data?.length === 0).toBe(true);
      expect((await inactive.from(table).select("id").limit(1)).data).toEqual([]);
    }
  });

  it("claims one concurrent run, persists fields and returns a cache hit", async () => {
    const args = {
      p_application_id: applicationId,
      p_input_fingerprint: fingerprint,
      p_source_ids: [sourceId],
      p_provider: "openai",
      p_model: "gpt-5.6-sol",
      p_prompt_version: "contract-extraction-v1",
      p_schema_version: "contract-extraction-schema-v1",
      p_input_character_count: 100,
      p_initiated_by: adminId,
      p_force: false,
    };
    const [first, second] = await Promise.all([
      service.rpc("begin_extraction_run", args),
      service.rpc("begin_extraction_run", args),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const claims = [...(first.data ?? []), ...(second.data ?? [])] as Array<{
      run_id: string;
      claimed: boolean;
    }>;
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    runId = claims.find((claim) => claim.claimed)!.run_id;

    const completed = await service.rpc("complete_extraction_run", {
      p_run_id: runId,
      p_fields: [field("7707083893", sourceId)],
      p_conflicts: [],
      p_request_id: "req_synthetic",
      p_input_token_count: 25,
      p_output_token_count: 10,
      p_duration_ms: 50,
    });
    expect(completed.error).toBeNull();

    const cached = await service.rpc("begin_extraction_run", args);
    expect(cached.error).toBeNull();
    expect(cached.data?.[0]).toEqual(
      expect.objectContaining({ run_id: runId, cache_hit: true, claimed: false }),
    );
    const persisted = await specialist
      .from("extracted_fields")
      .select("field_name,raw_value,extraction_run_id")
      .eq("application_id", applicationId)
      .single();
    expect(persisted.data).toEqual({
      field_name: "inn",
      raw_value: "7707083893",
      extraction_run_id: runId,
    });
  });

  it("allows active specialist correction and preserves it across re-extraction", async () => {
    const corrected = await specialist.rpc("correct_extracted_field", {
      p_application_id: applicationId,
      p_field_name: "inn",
      p_structured_value: {
        value: "500100732259",
        normalizedValue: "500100732259",
        rawValue: "500100732259",
        sourceType: "manual",
        sourceId: null,
        sourceMarker: "[MANUAL CORRECTION]",
        sourceExcerpt: null,
        confidence: 1,
        requiresReview: false,
        reason: "DIRECT_SOURCE",
      },
      p_raw_value: "500100732259",
      p_reason: "Synthetic verified correction",
      p_action: "corrected",
      p_source_type: "manual",
      p_source_id: null,
      p_source_marker: "[MANUAL CORRECTION]",
      p_source_excerpt: null,
    });
    expect(corrected.error).toBeNull();

    const forced = await service.rpc("begin_extraction_run", {
      p_application_id: applicationId,
      p_input_fingerprint: fingerprint,
      p_source_ids: [sourceId],
      p_provider: "openai",
      p_model: "gpt-5.6-sol",
      p_prompt_version: "contract-extraction-v1",
      p_schema_version: "contract-extraction-schema-v1",
      p_input_character_count: 100,
      p_initiated_by: adminId,
      p_force: true,
    });
    expect(forced.error).toBeNull();
    const forcedRunId = forced.data![0].run_id;
    expect(
      (
        await service.rpc("complete_extraction_run", {
          p_run_id: forcedRunId,
          p_fields: [field("7707083893", sourceId)],
          p_conflicts: [],
          p_request_id: "req_synthetic_force",
          p_input_token_count: 25,
          p_output_token_count: 10,
          p_duration_ms: 50,
        })
      ).error,
    ).toBeNull();

    const persisted = await specialist
      .from("extracted_fields")
      .select("raw_value,manually_corrected,correction_reason")
      .eq("application_id", applicationId)
      .eq("field_name", "inn")
      .single();
    expect(persisted.data).toEqual({
      raw_value: "500100732259",
      manually_corrected: true,
      correction_reason: "Synthetic verified correction",
    });
    const history = await specialist
      .from("extracted_field_corrections")
      .select("correction_action,reason")
      .eq("application_id", applicationId);
    expect(history.data).toEqual([
      {
        correction_action: "corrected",
        reason: "Synthetic verified correction",
      },
    ]);
  });

  it("records safe acceptance transactionally, idempotently, and behind RLS", async () => {
    const extracted = await service
      .from("extracted_fields")
      .select("id,field_name,structured_value,raw_value,source_type,source_id,source_marker,source_excerpt")
      .eq("application_id", applicationId)
      .eq("field_name", "inn")
      .single();
    expect(extracted.error).toBeNull();
    const row = extracted.data!;
    const valueFingerprint = createHash("sha256")
      .update([
        row.field_name,
        String(row.structured_value?.normalizedValue ?? row.raw_value ?? ""),
        row.source_type ?? "",
        row.source_id ?? "",
        row.source_marker ?? "",
        row.source_excerpt ?? "",
      ].join("|"))
      .digest("hex");
    const batchFingerprint = createHash("sha256")
      .update(`integration-acceptance-${applicationId}`)
      .digest("hex");
    const args = {
      p_application_id: applicationId,
      p_actor_id: adminId,
      p_method: "bulk",
      p_validator_version: "safe-field-acceptance-v1",
      p_batch_fingerprint: batchFingerprint,
      p_candidates: [{
        field_id: row.id,
        value_fingerprint: valueFingerprint,
        resolve_conflict: false,
      }],
    };
    const first = await service.rpc("record_safe_field_acceptances", args);
    const repeated = await service.rpc("record_safe_field_acceptances", args);
    expect(first.error).toBeNull();
    expect(first.data).toEqual(expect.objectContaining({
      accepted_count: 1,
      cache_hit: false,
    }));
    expect(repeated.data).toEqual(expect.objectContaining({
      accepted_count: 1,
      cache_hit: true,
    }));
    expect(
      (await specialist
        .from("extracted_field_acceptances")
        .select("id")
        .eq("application_id", applicationId)).data,
    ).toHaveLength(1);
    expect(
      (await inactive
        .from("extracted_field_acceptances")
        .select("id")
        .eq("application_id", applicationId)).data,
    ).toEqual([]);
    const anonymousAcceptance = await client()
      .from("extracted_field_acceptances")
      .select("id")
      .eq("application_id", applicationId);
    expect(
      anonymousAcceptance.error !== null ||
        anonymousAcceptance.data?.length === 0,
    ).toBe(true);
    expect(
      (await specialist.from("extracted_field_acceptances").insert({
        application_id: applicationId,
      })).error,
    ).not.toBeNull();
  });

  it("blocks direct specialist worker writes and inactive corrections", async () => {
    const direct = await specialist.from("extraction_runs").insert({
      application_id: applicationId,
      input_fingerprint: "f".repeat(64),
      provider: "openai",
      model: "gpt-5.6-sol",
      prompt_version: "v1",
      schema_version: "v1",
    });
    expect(direct.error).not.toBeNull();
    const inactiveCorrection = await inactive.rpc("correct_extracted_field", {
      p_application_id: applicationId,
      p_field_name: "inn",
      p_structured_value: null,
      p_raw_value: null,
      p_reason: "Must be denied",
      p_action: "manual_null_set",
    });
    expect(inactiveCorrection.error).not.toBeNull();
  });

  it("persists extraction, correction and cache audit without source data", async () => {
    const audit = await admin
      .from("audit_events")
      .select("action,metadata")
      .eq("application_id", applicationId)
      .in("action", [
        "extraction.started",
        "extraction.completed",
        "extraction.cache_hit",
        "extraction.field_corrected",
      ]);
    expect(new Set(audit.data?.map((event) => event.action))).toEqual(
      new Set([
        "extraction.started",
        "extraction.completed",
        "extraction.cache_hit",
        "extraction.field_corrected",
      ]),
    );
    expect(JSON.stringify(audit.data)).not.toMatch(/api[_-]?key|OPENAI|sourceExcerpt/iu);
  });
});
