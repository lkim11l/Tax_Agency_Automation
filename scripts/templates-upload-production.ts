import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { DOCX_MIME } from "@/modules/contracts/constants";
import { validateDocxTemplate } from "@/modules/contracts/docx";
import { uploadTemplateVersion } from "@/modules/contracts/service";

const templates = [
  {
    path: "tmp/mock-templates/consulting-mock.docx",
    hash: "8ee76fe20c7a095f5dab886586b417b473f1d719616745e4d47b067300856c64",
    name: "Договор консультационных услуг",
    code: "consulting",
    type: "consulting" as const,
    ruleSet: "services-contract",
  },
  {
    path: "tmp/mock-templates/services-mock.docx",
    hash: "99edf5895e881df1a0487eddfb1b6ec2ce401ce2f20d0c710d617d10dc7ceda1",
    name: "Договор возмездного оказания услуг",
    code: "services",
    type: "services" as const,
    ruleSet: "services-contract",
  },
  {
    path: "tmp/mock-templates/supply-mock.docx",
    hash: "bb405b46fa57b49c8e361c0abe5a1938928b61e6d2c475543ff32ef8e9cda29e",
    name: "Договор поставки",
    code: "supply",
    type: "supply" as const,
    ruleSet: "supply-contract",
  },
];

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const admin = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const profile = await admin.from("profiles")
    .select("id,role,is_active")
    .eq("email", required("SUPABASE_TEST_ADMIN_EMAIL"))
    .single();
  if (profile.error || !profile.data || profile.data.role !== "admin" || !profile.data.is_active) {
    throw new Error("Known active admin profile was not found.");
  }
  const existing = await admin.from("contract_templates")
    .select("id,code,version")
    .in("code", templates.map((item) => item.code))
    .eq("version", "1.0.0");
  if (existing.error) throw new Error("Unable to check existing template versions.");
  if ((existing.data?.length ?? 0) > 0) {
    throw new Error("One or more production template code/version pairs already exist.");
  }

  const uploaded: Array<{ id: string; path: string }> = [];
  try {
    for (const template of templates) {
      const content = await readFile(resolve(template.path));
      const digest = createHash("sha256").update(content).digest("hex");
      if (digest !== template.hash) throw new Error(`Checksum mismatch for ${template.code}.`);
      const preliminary = validateDocxTemplate({
        content,
        mimeType: DOCX_MIME,
        requiredPlaceholders: [],
      });
      if (!preliminary.valid || preliminary.errors.length || preliminary.placeholders.length === 0) {
        throw new Error(`DOCX validation failed for ${template.code}.`);
      }
      const result = await uploadTemplateVersion({
        name: template.name,
        code: template.code,
        description: "Презентационный шаблон. Ожидает юридического утверждения заказчиком.",
        templateType: template.type,
        version: "1.0.0",
        requiredRuleSet: template.ruleSet,
        requiredPlaceholders: preliminary.placeholders,
        filename: `${template.code}.docx`,
        mimeType: DOCX_MIME,
        content,
      }, {
        actorId: profile.data.id,
        role: "admin",
        admin,
      });
      const metadata = await admin.from("contract_templates")
        .select("id,storage_path,checksum,status,legal_approval_status,validation_report")
        .eq("id", result.templateId)
        .single();
      if (
        metadata.error ||
        metadata.data.checksum !== digest ||
        metadata.data.status !== "awaiting_approval" ||
        metadata.data.legal_approval_status !== "pending_customer_approval" ||
        metadata.data.validation_report?.valid !== true
      ) {
        throw new Error(`Persisted metadata verification failed for ${template.code}.`);
      }
      uploaded.push({ id: result.templateId, path: metadata.data.storage_path });
    }
  } catch (error) {
    for (const template of uploaded.reverse()) {
      await admin.from("contract_templates").delete().eq("id", template.id);
      await admin.storage.from("contract-documents").remove([template.path]);
    }
    throw error;
  }
  console.table(uploaded.map((item, index) => ({
    code: templates[index]?.code,
    id: item.id,
    legalStatus: "pending_customer_approval",
  })));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Template upload failed.");
  process.exitCode = 1;
});
