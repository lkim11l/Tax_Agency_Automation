import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSyntheticContractTemplate } from "../fixtures/contract-docx";
import { recalculateCompleteness } from "@/modules/clarification/service";
import {
  approveTemplate,
  checkContractEligibility,
  generateContract,
  uploadTemplateVersion,
} from "@/modules/contracts/service";
import { DOCX_MIME } from "@/modules/contracts/constants";

// Regression coverage for the 2026-07-24 contract generation incident
// (application 7d95a537-f018-4d53-a47a-9e66235b9723, template
// services-pilot-v2). The confirmed root cause was NOT the static hypothesis
// (a rule-set/template required_fields mismatch never firing for that
// application's actual data) — it was (1) begin_contract_generation's
// defense-in-depth staleness re-check raising a bare, unprefixed Postgres
// exception that bypassed safeGenerationErrorMessage's GENERATION_BLOCKED:
// routing entirely, and (2) checkContractEligibility's own staleness check
// never considering extracted_fields.updated_at, so it could report
// ready=true right up until the DB claim disagreed. These scenarios exercise
// the broader architectural gaps the incident's static hypothesis
// (correctly) worried about, which are real and independently worth this
// coverage even though they were not what caused this specific incident.

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

describe.sequential("contract generation incident regression (Step 9)", () => {
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

  // extraRequiredFields is applied via a direct row update AFTER approval,
  // deliberately bypassing approveTemplate's own strategy-B validation
  // (which would reject client_* fields the services-contract rule set
  // doesn't cover) — this simulates a template whose required_fields were
  // set before that validation existed (exactly like the real, still-active
  // "services" v1.0.0 mock template in production), so these tests exercise
  // the required-render-value check itself (Step 5), independent of whether
  // strategy B would have prevented this specific required_fields set today.
  async function createTemplate(code: string, extraRequiredFields: string[] = []) {
    const uploaded = await uploadTemplateVersion(
      {
        name: `Regression fixture ${code}`,
        code,
        description: null,
        templateType: "services",
        version: "1.0.0",
        requiredRuleSet: "services-contract",
        requiredPlaceholders: [],
        filename: `${code}.docx`,
        mimeType: DOCX_MIME,
        content: createSyntheticContractTemplate(),
      },
      { actorId: adminId, role: "admin", admin: service },
    );
    templateIds.push(uploaded.templateId);
    await approveTemplate(uploaded.templateId, { actorId: adminId, role: "admin", admin: service });
    if (extraRequiredFields.length) {
      const current = await service.from("contract_templates").select("required_fields").eq("id", uploaded.templateId).single();
      expect(current.error).toBeNull();
      const patched = await service
        .from("contract_templates")
        .update({ required_fields: [...(current.data!.required_fields as string[]), ...extraRequiredFields] })
        .eq("id", uploaded.templateId);
      expect(patched.error).toBeNull();
    }
    return uploaded.templateId;
  }

  function field(applicationId: string, name: string, value: string | number) {
    return {
      application_id: applicationId,
      field_name: name,
      structured_value: {
        value,
        normalizedValue: value,
        rawValue: value,
        sourceType: "manual",
        confidence: 1,
        requiresReview: false,
        reason: "MANUAL_ENTRY",
      },
      raw_value: String(value),
      source_type: "manual",
      confidence: 1,
      requires_review: false,
      conflict_detected: false,
      manually_corrected: true,
    };
  }

  const FULL_FIELD_SET: Record<string, string | number> = {
    legal_name: "ООО «Регрессия»",
    short_name: "ООО «Р»",
    inn: "7707083893",
    kpp: "770701001",
    ogrn: "1027700132195",
    legal_address: "г. Москва, ул. Тестовая, д. 1",
    actual_address: "г. Москва, ул. Тестовая, д. 1",
    bank_name: "АО «Синтетический банк»",
    bank_account: "40702810900000000001",
    correspondent_account: "30101810400000000225",
    bik: "044525225",
    signer_name: "Иванов Иван Иванович",
    signer_position: "Генеральный директор",
    signer_authority: "Устав",
    authority_document: "Устав",
    authority_number: "1",
    authority_date: "2020-01-01",
    contract_subject: "Оказание консультационных услуг",
    contract_amount: 50000,
    currency: "RUB",
    performance_start_date: "2026-08-01",
    performance_end_date: "2026-08-31",
    // The synthetic fixture (createSyntheticContractTemplate) embeds every
    // contractPlaceholder as literal template text, including this one — the
    // real docx.ts renderer has no start/end-date substitution for it (see
    // the comment on the required-render-value check in service.ts), so it
    // always needs a value whenever a template's text references it.
    performance_period_text: "с 1 по 31 августа 2026 г.",
    payment_terms: "Оплата в течение 10 рабочих дней после подписания акта",
    additional_conditions: "Результат передаётся в электронном виде",
  };

  async function seedFields(applicationId: string, overrides: Record<string, string | number | undefined> = {}) {
    const values: Record<string, string | number | undefined> = { ...FULL_FIELD_SET, ...overrides };
    const rows = Object.entries(values)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([name, value]) => field(applicationId, name, value));
    const inserted = await service.from("extracted_fields").insert(rows);
    expect(inserted.error).toBeNull();
  }

  it("regression A: a missing template-required client field blocks eligibility with its Russian label visible", async () => {
    const applicationId = await createApplication(`Regression A ${Date.now()}`);
    const templateId = await createTemplate(`reg-a-${Date.now()}`, ["client_short_name"]);
    await seedFields(applicationId, { short_name: undefined });
    await recalculateCompleteness({
      applicationId,
      ruleSetId: "services-contract",
      initiatedBy: adminId,
      admin: service,
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.ready).toBe(false);
    expect(eligibility.blockingReasons).toContain("REQUIRED_RENDER_VALUE_MISSING");
    expect(eligibility.missingRenderFields).toContain("client_short_name");
  });

  it("regression B: multiple missing required fields are all reported, not just the first", async () => {
    const applicationId = await createApplication(`Regression B ${Date.now()}`);
    const templateId = await createTemplate(`reg-b-${Date.now()}`, ["client_short_name", "client_bik"]);
    await seedFields(applicationId, { short_name: undefined, bik: undefined });
    await recalculateCompleteness({
      applicationId,
      ruleSetId: "services-contract",
      initiatedBy: adminId,
      admin: service,
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.ready).toBe(false);
    expect(eligibility.missingRenderFields).toEqual(
      expect.arrayContaining(["client_short_name", "client_bik"]),
    );
  });

  it("regression C: fully complete data (including template-specific extras) proceeds to a normal successful generation", async () => {
    const applicationId = await createApplication(`Regression C ${Date.now()}`);
    const templateId = await createTemplate(`reg-c-${Date.now()}`, ["client_short_name"]);
    await seedFields(applicationId);
    await recalculateCompleteness({
      applicationId,
      ruleSetId: "services-contract",
      initiatedBy: adminId,
      admin: service,
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.ready).toBe(true);
    expect(eligibility.missingRenderFields).toEqual([]);

    const result = await generateContract(
      { applicationId, templateId },
      { actorId: adminId, role: "admin", admin: service },
    );
    expect(result.cacheHit).toBe(false);
    expect((result as { contract_number: string }).contract_number).toMatch(/^TAA/u);
  });

  it("regression D: a feminine signer name declines successfully and does not block generation", async () => {
    const applicationId = await createApplication(`Regression D ${Date.now()}`);
    const templateId = await createTemplate(`reg-d-${Date.now()}`);
    await seedFields(applicationId, { signer_name: "Иванова Мария Ивановна" });
    await recalculateCompleteness({
      applicationId,
      ruleSetId: "services-contract",
      initiatedBy: adminId,
      admin: service,
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).not.toContain("SIGNER_NAME_DECLENSION_UNRELIABLE");
    expect(eligibility.ready).toBe(true);

    const result = await generateContract(
      { applicationId, templateId },
      { actorId: adminId, role: "admin", admin: service },
    );
    expect(result.cacheHit).toBe(false);
  });

  it("regression E: an unrecognized signer name blocks generation with a specific, non-generic reason", async () => {
    const applicationId = await createApplication(`Regression E ${Date.now()}`);
    const templateId = await createTemplate(`reg-e-${Date.now()}`);
    await seedFields(applicationId, { signer_name: "Ким Иван Иванович" });
    await recalculateCompleteness({
      applicationId,
      ruleSetId: "services-contract",
      initiatedBy: adminId,
      admin: service,
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.ready).toBe(false);
    expect(eligibility.blockingReasons).toContain("SIGNER_NAME_DECLENSION_UNRELIABLE");

    let thrown: unknown = null;
    try {
      await generateContract({ applicationId, templateId }, { actorId: adminId, role: "admin", admin: service });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("SIGNER_NAME_DECLENSION_UNRELIABLE");
    expect((thrown as Error).message.startsWith("GENERATION_BLOCKED:")).toBe(true);
  });
});
