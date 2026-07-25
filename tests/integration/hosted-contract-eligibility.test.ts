import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSyntheticContractTemplate } from "../fixtures/contract-docx";
import { recalculateCompleteness } from "@/modules/clarification/service";
import {
  approveTemplate,
  checkContractEligibility,
  uploadTemplateVersion,
} from "@/modules/contracts/service";
import { recordSafeFieldAcceptances } from "@/modules/extraction/acceptance";
import { inputFingerprint } from "@/modules/applications/processing";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing integration variable: ${name}`);
  return value;
}

function publicKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

function secretKey() {
  return process.env.SUPABASE_SECRET_KEY ?? required("SUPABASE_SERVICE_ROLE_KEY");
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

describe.sequential("contract generation eligibility after safe field acceptance", () => {
  const service = client(secretKey());
  let adminId = "";
  const applicationIds: string[] = [];
  const templateIds: string[] = [];

  beforeAll(async () => {
    const admin = client();
    adminId = (await signIn(admin, "SUPABASE_TEST_ADMIN_EMAIL", "SUPABASE_TEST_ADMIN_PASSWORD")).id;
    await admin.auth.signOut();
  });

  afterAll(async () => {
    for (const applicationId of applicationIds) {
      await service.from("applications").delete().eq("id", applicationId);
    }
    for (const templateId of templateIds) {
      const template = await service.from("contract_templates").select("storage_path").eq("id", templateId).maybeSingle();
      if (template.data?.storage_path) {
        await service.storage.from("contract-documents").remove([template.data.storage_path]);
      }
      await service.from("contract_templates").delete().eq("id", templateId);
    }
  });

  async function createApplication(title: string) {
    const created = await service
      .from("applications")
      .insert({
        title,
        source: "manual",
        status: "needs_data_review",
        priority: "normal",
        received_at: new Date().toISOString(),
        created_by: adminId,
      })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    applicationIds.push(created.data!.id);
    return created.data!.id as string;
  }

  async function createApprovedTemplate(ruleSetId: string, code: string) {
    const uploaded = await uploadTemplateVersion(
      {
        name: `Eligibility fixture ${code}`,
        code,
        description: null,
        templateType: "services",
        version: "1.0.0",
        requiredRuleSet: ruleSetId,
        // Not the full contractPlaceholders set: approveTemplate now rejects
        // required_fields naming a placeholder neither the rule set nor the
        // system-managed exclusion list explains (Step 6 strategy B) — these
        // scenarios exercise fingerprint/staleness/conflict eligibility
        // mechanics, not required_fields content, so leave required_fields
        // to whatever uploadTemplateVersion unions in on its own
        // (MANDATORY_PLACEHOLDERS). The synthetic fixture's DOCX text still
        // contains every placeholder regardless of what's "required".
        requiredPlaceholders: [],
        filename: `${code}.docx`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content: createSyntheticContractTemplate(),
      },
      { actorId: adminId, role: "admin", admin: service },
    );
    templateIds.push(uploaded.templateId);
    await approveTemplate(uploaded.templateId, { actorId: adminId, role: "admin", admin: service });
    return uploaded.templateId;
  }

  function labeledField(
    applicationId: string,
    fieldName: string,
    value: string,
    excerpt: string,
  ) {
    const structured = {
      value,
      normalizedValue: value,
      rawValue: value,
      sourceType: "email_message",
      sourceId: "11111111-1111-4111-8111-111111111111",
      sourceMarker: "[EMAIL BODY]",
      sourceExcerpt: excerpt,
      confidence: 0.95,
      requiresReview: true,
      reason: "DIRECT_SOURCE",
    };
    return {
      application_id: applicationId,
      field_name: fieldName,
      structured_value: structured,
      raw_value: value,
      source_type: "email_message",
      source_id: "11111111-1111-4111-8111-111111111111",
      source_marker: "[EMAIL BODY]",
      source_excerpt: excerpt,
      confidence: 0.95,
      requires_review: true,
      conflict_detected: false,
      manually_corrected: false,
    };
  }

  async function seedSevenAcceptableFields(applicationId: string) {
    const rows = [
      labeledField(applicationId, "legal_name", "ООО Ромашка", "Полное наименование: ООО Ромашка"),
      labeledField(applicationId, "inn", "7707083893", "ИНН: 7707083893."),
      labeledField(applicationId, "kpp", "770701001", "КПП: 770701001."),
      labeledField(applicationId, "bik", "044525225", "БИК: 044525225."),
      labeledField(
        applicationId,
        "bank_account",
        "40702810900000012345",
        "Расчётный счёт: 40702810900000012345.",
      ),
      labeledField(
        applicationId,
        "correspondent_account",
        "30101810400000000225",
        "Корреспондентский счёт: 30101810400000000225.",
      ),
      labeledField(
        applicationId,
        "legal_address",
        "г. Москва, ул. Ленина, д.1",
        "Юридический адрес: г. Москва, ул. Ленина, д.1",
      ),
    ];
    const inserted = await service.from("extracted_fields").insert(rows);
    expect(inserted.error).toBeNull();
  }

  it("scenario A: SOURCE_FINGERPRINT_MISMATCH is absent after bulk-accepting fields", async () => {
    const applicationId = await createApplication(`Eligibility scenario A ${Date.now()}`);
    const templateId = await createApprovedTemplate("standard-contract", `elig-a-${Date.now()}`);
    await seedSevenAcceptableFields(applicationId);

    const before = await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });
    expect(before.cacheHit).toBe(false);

    const accepted = await recordSafeFieldAcceptances({
      applicationId,
      actorId: adminId,
      method: "bulk",
      admin: service,
    });
    expect(accepted.result.accepted_count).toBeGreaterThanOrEqual(7);

    const after = await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });
    expect(after.runId).not.toBe(before.runId);

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).not.toContain("SOURCE_FINGERPRINT_MISMATCH");
    expect(eligibility.completenessRunId).toBe(after.runId);
  });

  it("scenario B: the template's own rule-set run is selected, not just the latest run", async () => {
    const applicationId = await createApplication(`Eligibility scenario B ${Date.now()}`);
    const templateId = await createApprovedTemplate("services-contract", `elig-b-${Date.now()}`);
    await seedSevenAcceptableFields(applicationId);

    // Compute services-contract FIRST, then standard-contract SECOND, so the
    // absolute latest run belongs to the OTHER rule set — this only passes
    // if selection is filtered by rule_set_id rather than "most recent".
    const servicesRun = await recalculateCompleteness({
      applicationId,
      ruleSetId: "services-contract",
      initiatedBy: adminId,
      admin: service,
    });
    await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).not.toContain("RULE_SET_MISMATCH");
    expect(eligibility.completenessRunId).toBe(servicesRun.runId);
  });

  it("scenario C: with no matching run, eligibility recalculates automatically in one call", async () => {
    const applicationId = await createApplication(`Eligibility scenario C ${Date.now()}`);
    const templateId = await createApprovedTemplate("standard-contract", `elig-c-${Date.now()}`);
    await seedSevenAcceptableFields(applicationId);

    const before = await service
      .from("completeness_runs")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId);
    expect(before.count ?? 0).toBe(0);

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).not.toContain("SOURCE_FINGERPRINT_MISMATCH");
    expect(eligibility.blockingReasons).not.toContain("RULE_SET_MISMATCH");

    const after = await service
      .from("completeness_runs")
      .select("id,rule_set_id,extraction_fingerprint")
      .eq("application_id", applicationId);
    expect(after.data).toHaveLength(1);
    expect(after.data![0].rule_set_id).toBe("standard-contract");
    expect(after.data![0].extraction_fingerprint).toBe(eligibility.sourceFingerprint);
  });

  it("scenario D: a genuinely new, unprocessed email keeps generation blocked as stale", async () => {
    // Rewritten for the fingerprint-based COMPLETENESS_STALE check (loadGenerationSource
    // in src/modules/contracts/service.ts no longer compares wall-clock
    // timestamps — a newer email/attachment/extracted_fields row that never
    // changed inputFingerprint is a legitimate cache hit, not staleness; see
    // hosted-completeness-stale-regression.test.ts for that distinction).
    // This scenario must establish a completed application_processing_runs
    // row matching the CURRENT fingerprint first (the cache-hit baseline a
    // real "Обработать заявку" would leave behind), then add a real new
    // source afterward, so the assertion actually exercises "does input
    // fingerprint still match", not just "no processing run exists at all".
    const applicationId = await createApplication(`Eligibility scenario D ${Date.now()}`);
    const templateId = await createApprovedTemplate("standard-contract", `elig-d-${Date.now()}`);
    await seedSevenAcceptableFields(applicationId);

    await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });
    const baselineFingerprint = await inputFingerprint(applicationId, service);
    const processed = await service.from("application_processing_runs").insert({
      application_id: applicationId,
      input_fingerprint: baselineFingerprint,
      status: "completed",
      processed_by: adminId,
      completed_at: new Date().toISOString(),
    });
    expect(processed.error).toBeNull();

    const email = await service.from("email_messages").insert({
      application_id: applicationId,
      provider: "mailru",
      provider_message_id: `stale-check-${Date.now()}`,
      mailbox_identifier: "ops@example.invalid",
      mailbox_uid: Date.now(),
      uid_validity: 1,
      direction: "inbound",
      sender: "client@example.invalid",
      recipients: [{ address: "ops@example.invalid" }],
      subject: "Дополнительные документы",
      plain_body: "Направляем дополнительные документы по заявке.",
      occurred_at: new Date().toISOString(),
      processing_status: "completed",
      rfc_message_id: `<stale-check-${Date.now()}@example.invalid>`,
      reference_message_ids: [],
      cc: [],
      raw_headers: {},
    });
    expect(email.error).toBeNull();

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).toContain("COMPLETENESS_STALE");
  });

  it("scenario E: a real unresolved conflict keeps generation blocked", async () => {
    const applicationId = await createApplication(`Eligibility scenario E ${Date.now()}`);
    const templateId = await createApprovedTemplate("standard-contract", `elig-e-${Date.now()}`);
    await seedSevenAcceptableFields(applicationId);
    const conflicted = await service
      .from("extracted_fields")
      .update({ conflict_detected: true })
      .eq("application_id", applicationId)
      .eq("field_name", "inn");
    expect(conflicted.error).toBeNull();

    await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).toContain("UNRESOLVED_CONFLICT");
  });
});
