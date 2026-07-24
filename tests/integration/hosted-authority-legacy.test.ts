import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { inputFingerprint, processApplication } from "@/modules/applications/processing";
import { recalculateCompleteness } from "@/modules/clarification/service";

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
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function signIn(instance: SupabaseClient, emailName: string, passwordName: string) {
  const result = await instance.auth.signInWithPassword({
    email: required(emailName),
    password: required(passwordName),
  });
  expect(result.error).toBeNull();
  return result.data.user!;
}

const sourceId = "11111111-1111-4111-8111-111111111111";

function legacyMissingValue() {
  return {
    value: null,
    normalizedValue: null,
    rawValue: null,
    sourceType: null,
    sourceId: null,
    sourceMarker: null,
    sourceExcerpt: null,
    confidence: 0,
    requiresReview: true,
    reason: "NOT_FOUND",
    // Deliberately no `fieldState` key: mirrors rows persisted before the
    // authority-derivation helper existed.
  };
}

describe.sequential("legacy application authority derivation on reprocess", () => {
  const service = client(secretKey());
  let adminId = "";
  let applicationId = "";
  let missingCountBeforeFix = 0;

  beforeAll(async () => {
    const admin = client();
    adminId = (await signIn(admin, "SUPABASE_TEST_ADMIN_EMAIL", "SUPABASE_TEST_ADMIN_PASSWORD")).id;
    await admin.auth.signOut();

    const created = await service
      .from("applications")
      .insert({
        title: `Legacy authority reprocess ${Date.now()}`,
        source: "manual",
        status: "needs_data_review",
        priority: "normal",
        received_at: new Date().toISOString(),
        created_by: adminId,
      })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    applicationId = created.data!.id;

    const signerAuthority = {
      value: "Устав",
      normalizedValue: "Устав",
      rawValue: "Устав",
      sourceType: "email_message",
      sourceId,
      sourceMarker: "[EMAIL BODY]",
      sourceExcerpt: "Основание полномочий: Устав",
      confidence: 0.95,
      requiresReview: false,
      reason: "DIRECT_SOURCE",
    };
    // authority_document was already corrected to "Устав" by a specialist
    // before this application ever saw the authority-derivation helper.
    const authorityDocument = {
      value: "Устав",
      normalizedValue: "Устав",
      rawValue: "Устав",
      sourceType: "manual",
      sourceId: null,
      sourceMarker: "[MANUAL CORRECTION]",
      sourceExcerpt: null,
      confidence: 1,
      requiresReview: false,
      reason: "DIRECT_SOURCE",
    };
    const inserted = await service.from("extracted_fields").insert([
      {
        application_id: applicationId,
        field_name: "signer_authority",
        structured_value: signerAuthority,
        raw_value: signerAuthority.rawValue,
        source_type: signerAuthority.sourceType,
        source_id: signerAuthority.sourceId,
        source_marker: signerAuthority.sourceMarker,
        source_excerpt: signerAuthority.sourceExcerpt,
        confidence: signerAuthority.confidence,
        requires_review: signerAuthority.requiresReview,
        conflict_detected: false,
        manually_corrected: false,
      },
      {
        application_id: applicationId,
        field_name: "authority_document",
        structured_value: authorityDocument,
        raw_value: authorityDocument.rawValue,
        source_type: authorityDocument.sourceType,
        source_id: authorityDocument.sourceId,
        source_marker: authorityDocument.sourceMarker,
        source_excerpt: authorityDocument.sourceExcerpt,
        confidence: authorityDocument.confidence,
        requires_review: authorityDocument.requiresReview,
        conflict_detected: false,
        manually_corrected: true,
      },
      {
        application_id: applicationId,
        field_name: "authority_number",
        structured_value: legacyMissingValue(),
        raw_value: null,
        source_type: null,
        source_id: null,
        source_marker: null,
        source_excerpt: null,
        confidence: 0,
        requires_review: true,
        conflict_detected: false,
        manually_corrected: false,
      },
      {
        application_id: applicationId,
        field_name: "authority_date",
        structured_value: legacyMissingValue(),
        raw_value: null,
        source_type: null,
        source_id: null,
        source_marker: null,
        source_excerpt: null,
        confidence: 0,
        requires_review: true,
        conflict_detected: false,
        manually_corrected: false,
      },
    ]);
    expect(inserted.error).toBeNull();

    // Baseline completeness snapshot before any derived-field sync: mirrors an
    // application that was already processed under the old (pre-authority
    // helper) rules and is stuck showing authority_number/date as missing.
    const baseline = await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });
    missingCountBeforeFix = baseline.missing;
    expect(missingCountBeforeFix).toBeGreaterThanOrEqual(2);

    // Seed a completed processing run whose input fingerprint matches the
    // application's current (unchanged) sources/template, so `processApplication`
    // takes the exact cache-hit path this application would take in production
    // on every subsequent "Обработать заявку" click.
    const fingerprint = await inputFingerprint(applicationId, service);
    const run = await service.from("application_processing_runs").insert({
      application_id: applicationId,
      input_fingerprint: fingerprint,
      status: "completed",
      stages: {},
      processed_by: adminId,
      completed_at: new Date().toISOString(),
    });
    expect(run.error).toBeNull();
  });

  afterAll(async () => {
    if (applicationId) await service.from("applications").delete().eq("id", applicationId);
  });

  it("reconciles stale authority_number/authority_date on a cache-hit reprocess", async () => {
    const result = await processApplication({
      applicationId,
      actorId: adminId,
      admin: service,
    });
    expect(result.claimed).toBe(false);
    expect(result.cacheHit).toBe(true);

    const fields = await service
      .from("extracted_fields")
      .select("field_name,structured_value,requires_review,conflict_detected")
      .eq("application_id", applicationId)
      .in("field_name", ["authority_number", "authority_date"]);
    expect(fields.error).toBeNull();
    expect(fields.data).toHaveLength(2);
    for (const field of fields.data ?? []) {
      expect(field.structured_value).toEqual(
        expect.objectContaining({
          value: null,
          normalizedValue: null,
          fieldState: "not_applicable",
          requiresReview: false,
          reason: "NOT_APPLICABLE",
        }),
      );
      expect(field.requires_review).toBe(false);
      expect(field.conflict_detected).toBe(false);
    }

    const runs = await service
      .from("completeness_runs")
      .select("id,missing_count")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(runs.error).toBeNull();
    const latestRun = runs.data![0];
    expect(latestRun.missing_count).toBe(missingCountBeforeFix - 2);

    const fieldResults = await service
      .from("completeness_field_results")
      .select("field_name,is_blocking,status")
      .eq("completeness_run_id", latestRun.id)
      .in("field_name", ["authority_number", "authority_date"]);
    expect(fieldResults.error).toBeNull();
    expect(fieldResults.data).toHaveLength(2);
    for (const fieldResult of fieldResults.data ?? []) {
      expect(fieldResult.is_blocking).toBe(false);
      expect(fieldResult.status).toBe("complete");
    }
  });

  it("is idempotent on a repeated reprocess (no new completeness run, no duplicate updates)", async () => {
    const runsBefore = await service
      .from("completeness_runs")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId);
    expect(runsBefore.error).toBeNull();

    const result = await processApplication({
      applicationId,
      actorId: adminId,
      admin: service,
    });
    expect(result.claimed).toBe(false);
    expect(result.cacheHit).toBe(true);

    const runsAfter = await service
      .from("completeness_runs")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId);
    expect(runsAfter.error).toBeNull();
    expect(runsAfter.count).toBe(runsBefore.count);

    const fields = await service
      .from("extracted_fields")
      .select("structured_value")
      .eq("application_id", applicationId)
      .in("field_name", ["authority_number", "authority_date"]);
    expect(fields.error).toBeNull();
    for (const field of fields.data ?? []) {
      expect(field.structured_value).toEqual(
        expect.objectContaining({ fieldState: "not_applicable", value: null }),
      );
    }
  });
});
