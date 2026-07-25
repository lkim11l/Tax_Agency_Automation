import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSyntheticContractTemplate } from "../fixtures/contract-docx";
import { recalculateCompleteness } from "@/modules/clarification/service";
import {
  approveTemplate,
  checkContractEligibility,
  uploadTemplateVersion,
} from "@/modules/contracts/service";
import { DOCX_MIME } from "@/modules/contracts/constants";
import { inputFingerprint } from "@/modules/applications/processing";

// Regression coverage for the "COMPLETENESS_STALE loop" incident on
// application 7d95a537-f018-4d53-a47a-9e66235b9723: "Обработать заявку"
// reprocessed successfully (a genuine cache hit — nothing new to extract)
// but checkContractEligibility kept reporting COMPLETENESS_STALE forever
// regardless. loadGenerationSource used to answer "is there a newer email/
// attachment/extracted_fields row at all" (wall-clock) instead of "did input
// actually change" (fingerprint) — the same question
// claim_application_processing() already answers correctly via
// input_fingerprint. Both of loadGenerationSource's old wall-clock checks
// (email/attachment vs. extraction_runs.completed_at, and
// extracted_fields.updated_at vs. completeness_runs.created_at) are replaced
// by a single check: does the latest completed application_processing_runs
// row's input_fingerprint match the current one.

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

describe.sequential("COMPLETENESS_STALE loop regression (Step 3)", () => {
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

  async function createTemplate(code: string) {
    const uploaded = await uploadTemplateVersion(
      {
        name: `Stale-regression fixture ${code}`,
        code,
        description: null,
        templateType: "services",
        version: "1.0.0",
        requiredRuleSet: "standard-contract",
        requiredPlaceholders: [],
        filename: `${code}.docx`,
        mimeType: DOCX_MIME,
        content: createSyntheticContractTemplate(),
      },
      { actorId: adminId, role: "admin", admin: service },
    );
    templateIds.push(uploaded.templateId);
    await approveTemplate(uploaded.templateId, { actorId: adminId, role: "admin", admin: service });
    return uploaded.templateId;
  }

  async function markProcessed(applicationId: string, fingerprint: string) {
    const inserted = await service.from("application_processing_runs").insert({
      application_id: applicationId,
      input_fingerprint: fingerprint,
      status: "completed",
      processed_by: adminId,
      completed_at: new Date().toISOString(),
    });
    expect(inserted.error).toBeNull();
  }

  function email(applicationId: string, plainBody: string | null, suffix: string) {
    const uniqueId = `stale-regression-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return {
      application_id: applicationId,
      provider: "mailru",
      provider_message_id: uniqueId,
      mailbox_identifier: "ops@example.invalid",
      mailbox_uid: Date.now(),
      uid_validity: 1,
      direction: "inbound" as const,
      sender: "client@example.invalid",
      recipients: [{ address: "ops@example.invalid" }],
      subject: "Дополнительная информация",
      plain_body: plainBody,
      occurred_at: new Date().toISOString(),
      processing_status: "completed",
      rfc_message_id: `<${uniqueId}@example.invalid>`,
      reference_message_ids: [],
      cc: [],
      raw_headers: {},
    };
  }

  it("regression A: a cache-hit-shaped email (no extractable body) does not block on COMPLETENESS_STALE", async () => {
    const applicationId = await createApplication(`Stale A ${Date.now()}`);
    const templateId = await createTemplate(`stale-a-${Date.now()}`);
    await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });

    const fingerprint = await inputFingerprint(applicationId, service);
    await markProcessed(applicationId, fingerprint);

    // An auto-reply / duplicate / unparsed message: loadExtractionSources
    // excludes rows with a null plain_body, so this can never change
    // inputFingerprint — it must never be treated as unprocessed new input.
    const inserted = await service.from("email_messages").insert(email(applicationId, null, "no-body"));
    expect(inserted.error).toBeNull();

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).not.toContain("COMPLETENESS_STALE");
  });

  it("regression B: a genuinely new, unprocessed source blocks on COMPLETENESS_STALE", async () => {
    const applicationId = await createApplication(`Stale B ${Date.now()}`);
    const templateId = await createTemplate(`stale-b-${Date.now()}`);
    await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });

    const fingerprint = await inputFingerprint(applicationId, service);
    await markProcessed(applicationId, fingerprint);

    // A real inbound message with body text IS a new extraction source —
    // this changes inputFingerprint, so the cache-hit lookup above no longer
    // matches, and eligibility must correctly ask for reprocessing.
    const inserted = await service.from("email_messages").insert(
      email(applicationId, "Направляем дополнительные реквизиты по заявке.", "with-body"),
    );
    expect(inserted.error).toBeNull();

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).toContain("COMPLETENESS_STALE");
  });

  it("regression C: no application_processing_runs row at all is still correctly blocked", async () => {
    const applicationId = await createApplication(`Stale C ${Date.now()}`);
    const templateId = await createTemplate(`stale-c-${Date.now()}`);
    await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });
    // Deliberately no markProcessed call — "never processed" must not be
    // mistaken for "not stale".

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).toContain("COMPLETENESS_STALE");
  });

  it("regression D: re-touching a field's updated_at without changing its value does not block", async () => {
    const applicationId = await createApplication(`Stale D ${Date.now()}`);
    const templateId = await createTemplate(`stale-d-${Date.now()}`);
    const seeded = await service.from("extracted_fields").insert({
      application_id: applicationId,
      field_name: "legal_name",
      structured_value: {
        value: "ООО Ромашка",
        normalizedValue: "ООО Ромашка",
        rawValue: "ООО Ромашка",
        sourceType: "manual",
        confidence: 1,
        requiresReview: false,
        reason: "MANUAL_ENTRY",
      },
      raw_value: "ООО Ромашка",
      source_type: "manual",
      confidence: 1,
      requires_review: false,
      conflict_detected: false,
      manually_corrected: true,
    });
    expect(seeded.error).toBeNull();

    await recalculateCompleteness({
      applicationId,
      ruleSetId: "standard-contract",
      initiatedBy: adminId,
      admin: service,
    });
    const fingerprint = await inputFingerprint(applicationId, service);
    await markProcessed(applicationId, fingerprint);

    // Re-touch the same field with the IDENTICAL value — this is exactly
    // what a derived-field sync or a specialist re-confirming an
    // already-correct value does: updated_at advances, but nothing
    // extraction-relevant changes, so the fingerprint is unaffected.
    const retouched = await service
      .from("extracted_fields")
      .update({
        structured_value: {
          value: "ООО Ромашка",
          normalizedValue: "ООО Ромашка",
          rawValue: "ООО Ромашка",
          sourceType: "manual",
          confidence: 1,
          requiresReview: false,
          reason: "MANUAL_ENTRY",
        },
      })
      .eq("application_id", applicationId)
      .eq("field_name", "legal_name");
    expect(retouched.error).toBeNull();

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId,
      role: "admin",
      admin: service,
    });
    expect(eligibility.blockingReasons).not.toContain("COMPLETENESS_STALE");
  });
});
