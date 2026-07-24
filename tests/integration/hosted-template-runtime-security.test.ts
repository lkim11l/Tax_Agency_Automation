import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSyntheticContractTemplate } from "../fixtures/contract-docx";
import { checkContractEligibility, uploadTemplateVersion, approveTemplate } from "@/modules/contracts/service";
import {
  contractPlaceholders,
  DOCX_MIME,
  PLACEHOLDER_SCHEMA_VERSION,
} from "@/modules/contracts/constants";

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

function checksumOf(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

// Strips a genitive placeholder's whole table row (label cell + value cell)
// out of the synthetic fixture, simulating a template authored before these
// placeholders existed at all — not merely one where the value is blank.
function withoutGenitivePlaceholders(content: Buffer) {
  const archive = unzipSync(content);
  let xml = strFromU8(archive["word/document.xml"]);
  for (const name of ["signer_name_genitive", "signer_position_genitive", "signer_authority_genitive"]) {
    xml = xml.replace(new RegExp(`<w:tr>(?:(?!</w:tr>).)*?\\{\\{${name}\\}\\}(?:(?!</w:tr>).)*?</w:tr>`, "su"), "");
  }
  expect(xml).not.toContain("_genitive");
  archive["word/document.xml"] = strToU8(xml);
  return Buffer.from(zipSync(archive, { level: 6 }));
}

function withMockMarker(content: Buffer) {
  const archive = unzipSync(content);
  const xml = strFromU8(archive["word/document.xml"]).replace(
    "</w:body>",
    "<w:p><w:r><w:t>MOCK-ШАБЛОН. НЕ ДЛЯ ПОДПИСАНИЯ</w:t></w:r></w:p></w:body>",
  );
  archive["word/document.xml"] = strToU8(xml);
  return Buffer.from(zipSync(archive, { level: 6 }));
}

function withHighlightMarkup(content: Buffer) {
  const archive = unzipSync(content);
  const xml = strFromU8(archive["word/document.xml"]).replace(
    "</w:body>",
    '<w:p><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>требует проверки</w:t></w:r></w:p></w:body>',
  );
  archive["word/document.xml"] = strToU8(xml);
  return Buffer.from(zipSync(archive, { level: 6 }));
}

describe.sequential("template runtime security re-validation before generation", () => {
  const service = client(secretKey());
  let adminId = "";
  const applicationIds: string[] = [];
  const templateIds: string[] = [];
  const storagePaths: string[] = [];

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
      await service.from("contract_templates").delete().eq("id", templateId);
    }
    if (storagePaths.length) {
      await service.storage.from("contract-documents").remove(storagePaths);
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

  // Simulates a template row exactly as it would look if it had been
  // approved before the runtime safety checks existed: bypasses
  // uploadTemplateVersion (which now refuses this content) and writes the
  // file + row directly, the same way a pre-existing production row does.
  async function insertLegacyApprovedTemplate(input: {
    code: string;
    content: Buffer;
    placeholderSchemaVersion: string;
    requiredFields: string[];
    storedChecksum?: string;
  }) {
    const storagePath = `templates/${input.code}/legacy/${Date.now()}.docx`;
    const uploaded = await service.storage.from("contract-documents").upload(storagePath, input.content, {
      contentType: DOCX_MIME,
      upsert: true,
    });
    expect(uploaded.error).toBeNull();
    storagePaths.push(storagePath);
    const created = await service.from("contract_templates").insert({
      name: `Legacy fixture ${input.code}`,
      code: input.code,
      description: null,
      template_type: "services",
      version: `legacy-${Date.now()}`,
      status: "approved",
      storage_path: storagePath,
      checksum: input.storedChecksum ?? checksumOf(input.content),
      original_filename: "legacy.docx",
      mime_type: DOCX_MIME,
      required_rule_set: "standard-contract",
      placeholder_schema_version: input.placeholderSchemaVersion,
      required_fields: input.requiredFields,
      variable_schema: { placeholders: input.requiredFields },
      validation_report: { valid: true, errors: [], warnings: [], placeholders: input.requiredFields, duplicates: [], parts: [] },
      is_active: true,
      approved_by: adminId,
      approved_at: new Date().toISOString(),
      created_by: adminId,
    }).select("id").single();
    expect(created.error).toBeNull();
    templateIds.push(created.data!.id);
    return created.data!.id as string;
  }

  it("scenario A: a legacy approved MOCK template is blocked by runtime re-validation", async () => {
    const applicationId = await createApplication(`Template security scenario A ${Date.now()}`);
    const templateId = await insertLegacyApprovedTemplate({
      code: `sec-a-${Date.now()}`,
      content: withMockMarker(createSyntheticContractTemplate()),
      placeholderSchemaVersion: "contract-placeholders-v1",
      requiredFields: ["application_number", "contract_number"],
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId, role: "admin", admin: service,
    });
    expect(eligibility.ready).toBe(false);
    expect(eligibility.blockingReasons).toContain("TEMPLATE_SECURITY_REVALIDATION_FAILED");
  });

  it("scenario B: a legacy approved template missing genitive placeholders is blocked before render", async () => {
    const applicationId = await createApplication(`Template security scenario B ${Date.now()}`);
    const templateId = await insertLegacyApprovedTemplate({
      code: `sec-b-${Date.now()}`,
      content: withoutGenitivePlaceholders(createSyntheticContractTemplate()),
      placeholderSchemaVersion: "contract-placeholders-v1",
      requiredFields: ["application_number", "contract_number", "signer_position", "signer_name", "signer_authority"],
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId, role: "admin", admin: service,
    });
    expect(eligibility.ready).toBe(false);
    expect(eligibility.blockingReasons).toContain("TEMPLATE_SECURITY_REVALIDATION_FAILED");
  });

  it("scenario C: a new compliant template with the current schema version passes template checks", async () => {
    const applicationId = await createApplication(`Template security scenario C ${Date.now()}`);
    const uploaded = await uploadTemplateVersion(
      {
        name: `Compliant fixture ${Date.now()}`,
        code: `sec-c-${Date.now()}`,
        description: null,
        templateType: "services",
        version: "1.0.0",
        requiredRuleSet: "standard-contract",
        // Not the full contractPlaceholders set: approveTemplate now rejects
        // required_fields naming a placeholder neither the rule set nor the
        // system-managed exclusion list explains (Step 6 strategy B). These
        // scenarios test template security/checksum revalidation, not
        // required_fields content.
        requiredPlaceholders: [],
        filename: "compliant.docx",
        mimeType: DOCX_MIME,
        content: createSyntheticContractTemplate(),
      },
      { actorId: adminId, role: "admin", admin: service },
    );
    templateIds.push(uploaded.templateId);
    expect(uploaded.report.valid).toBe(true);
    await approveTemplate(uploaded.templateId, { actorId: adminId, role: "admin", admin: service });

    const eligibility = await checkContractEligibility(applicationId, uploaded.templateId, {
      actorId: adminId, role: "admin", admin: service,
    });
    expect(eligibility.blockingReasons).not.toContain("TEMPLATE_SECURITY_REVALIDATION_FAILED");
    expect(eligibility.blockingReasons).not.toContain("TEMPLATE_VALIDATION_INVALID");
    expect(eligibility.blockingReasons).not.toContain("TEMPLATE_NOT_APPROVED");
  });

  it("scenario D: a checksum mismatch against the actual Storage file blocks generation", async () => {
    const applicationId = await createApplication(`Template security scenario D ${Date.now()}`);
    const uploaded = await uploadTemplateVersion(
      {
        name: `Tampered fixture ${Date.now()}`,
        code: `sec-d-${Date.now()}`,
        description: null,
        templateType: "services",
        version: "1.0.0",
        requiredRuleSet: "standard-contract",
        // Not the full contractPlaceholders set: approveTemplate now rejects
        // required_fields naming a placeholder neither the rule set nor the
        // system-managed exclusion list explains (Step 6 strategy B). These
        // scenarios test template security/checksum revalidation, not
        // required_fields content.
        requiredPlaceholders: [],
        filename: "tampered.docx",
        mimeType: DOCX_MIME,
        content: createSyntheticContractTemplate(),
      },
      { actorId: adminId, role: "admin", admin: service },
    );
    templateIds.push(uploaded.templateId);
    await approveTemplate(uploaded.templateId, { actorId: adminId, role: "admin", admin: service });

    const templateRow = await service.from("contract_templates").select("storage_path").eq("id", uploaded.templateId).single();
    expect(templateRow.error).toBeNull();
    // Simulate the Storage file being swapped after approval without the DB
    // checksum being updated to match.
    const tampered = withMockMarker(createSyntheticContractTemplate());
    const overwritten = await service.storage.from("contract-documents").upload(
      templateRow.data!.storage_path,
      tampered,
      { contentType: DOCX_MIME, upsert: true },
    );
    expect(overwritten.error).toBeNull();

    const eligibility = await checkContractEligibility(applicationId, uploaded.templateId, {
      actorId: adminId, role: "admin", admin: service,
    });
    expect(eligibility.ready).toBe(false);
    expect(eligibility.blockingReasons).toContain("TEMPLATE_SECURITY_REVALIDATION_FAILED");
  });

  it("scenario E: highlight markup blocks generation even for an already-approved, schema-current template", async () => {
    const applicationId = await createApplication(`Template security scenario E ${Date.now()}`);
    const templateId = await insertLegacyApprovedTemplate({
      code: `sec-e-${Date.now()}`,
      content: withHighlightMarkup(createSyntheticContractTemplate()),
      // Current schema version on purpose: isolates highlight markup as the
      // sole failure reason, independent of the schema-version check.
      placeholderSchemaVersion: PLACEHOLDER_SCHEMA_VERSION,
      requiredFields: [...contractPlaceholders],
    });

    const eligibility = await checkContractEligibility(applicationId, templateId, {
      actorId: adminId, role: "admin", admin: service,
    });
    expect(eligibility.ready).toBe(false);
    expect(eligibility.blockingReasons).toContain("TEMPLATE_SECURITY_REVALIDATION_FAILED");
  });
});
