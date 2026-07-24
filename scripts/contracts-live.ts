import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { createAdminClient } from "../src/lib/supabase/admin.server";
import { recalculateCompleteness } from "../src/modules/clarification/service";
import {
  approveTemplate,
  generateContract,
  uploadTemplateVersion,
} from "../src/modules/contracts/service";
import { createSyntheticContractTemplate } from "../tests/fixtures/contract-docx";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing live acceptance variable: ${name}`);
  return value;
}

function publicKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

async function getOrCreateApplication(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
  title: string,
) {
  const existing = await admin.from("applications").select("id,application_number,status")
    .eq("title", title).limit(1).maybeSingle();
  if (existing.error) throw new Error("Unable to inspect live application.");
  if (existing.data) return existing.data;
  const created = await admin.from("applications").insert({
    title,
    source: "manual",
    status: "needs_data_review",
    priority: "normal",
    received_at: new Date().toISOString(),
    created_by: actorId,
  }).select("id,application_number,status").single();
  if (created.error || !created.data) throw new Error("Unable to create live application.");
  return created.data;
}

function manualField(applicationId: string, actorId: string, fieldName: string, value: string | number) {
  return {
    application_id: applicationId,
    field_name: fieldName,
    normalized_value: { value },
    structured_value: {
      value,
      normalizedValue: value,
      rawValue: String(value),
      sourceType: "manual",
      sourceId: null,
      sourceMarker: "[SYNTHETIC PHASE 6 LIVE FIXTURE]",
      sourceExcerpt: null,
      confidence: 1,
      requiresReview: false,
      reason: "DIRECT_SOURCE",
    },
    raw_value: String(value),
    source_type: "manual",
    source_marker: "[SYNTHETIC PHASE 6 LIVE FIXTURE]",
    confidence: 1,
    requires_review: false,
    manually_corrected: true,
    corrected_by: actorId,
    correction_reason: "Synthetic Phase 6 live acceptance fixture.",
    conflict_detected: false,
  };
}

async function seedFields(
  admin: ReturnType<typeof createAdminClient>,
  applicationId: string,
  actorId: string,
  complete: boolean,
) {
  const existing = await admin.from("extracted_fields").select("id")
    .eq("application_id", applicationId).limit(1);
  if (existing.error) throw new Error("Unable to inspect live extraction fields.");
  if ((existing.data?.length ?? 0) > 0) return;
  const values: Record<string, string | number> = complete ? {
    legal_name: "ООО «Синтетический заказчик»",
    short_name: "ООО «СЗ»",
    inn: "7707083893",
    kpp: "770701001",
    ogrn: "1027700132195",
    legal_address: "127006, г. Москва, ул. Тестовая, д. 1",
    actual_address: "127006, г. Москва, ул. Тестовая, д. 1",
    bank_name: "АО «Синтетический банк»",
    bank_account: "40702810900000000001",
    correspondent_account: "30101810400000000225",
    bik: "044525225",
    signer_name: "Иванов Иван Иванович",
    signer_position: "Генеральный директор",
    signer_authority: "Устав",
    contract_subject: "Консультационные услуги по синтетическому сценарию",
    contract_amount: 123456.78,
    currency: "RUB",
    performance_start_date: "2026-08-01",
    performance_end_date: "2026-08-31",
    performance_period_text: "с 1 августа 2026 г. по 31 августа 2026 г.",
    payment_terms: "Оплата в течение 10 рабочих дней после подписания акта",
    additional_conditions: "Результат передается в электронном виде",
  } : {
    legal_name: "ООО «Неполный синтетический заказчик»",
  };
  const inserted = await admin.from("extracted_fields").insert(
    Object.entries(values).map(([name, value]) =>
      manualField(applicationId, actorId, name, value)),
  );
  if (inserted.error) throw new Error("Unable to seed live extraction fields.");
}

async function main() {
  const admin = createAdminClient();
  const profile = await admin.from("profiles").select("id")
    .eq("role", "admin").eq("is_active", true).order("created_at").limit(1).single();
  if (profile.error || !profile.data) throw new Error("No active administrator is available.");
  const actorId = profile.data.id as string;
  const execution = { actorId, role: "admin" as const, admin };

  const templateCode = "phase6-live-services";
  const template = await admin.from("contract_templates").select("id,status,is_active")
    .eq("code", templateCode).eq("version", "1.0.0").maybeSingle();
  if (template.error) throw new Error("Unable to inspect the synthetic template.");
  let templateId: string;
  if (!template.data) {
    const uploaded = await uploadTemplateVersion({
      name: "Phase 6 synthetic services contract",
      code: templateCode,
      description: "Synthetic non-customer template for Phase 6 acceptance.",
      templateType: "services",
      version: "1.0.0",
      requiredRuleSet: "standard-contract",
      // Not the full contractPlaceholders set: approveTemplate now rejects
      // required_fields naming a placeholder neither the rule set nor the
      // system-managed exclusion list explains (Step 6 strategy B).
      // seedFields(..., true) below still fills every one of them, so full
      // generation is unaffected — this only trims required_fields.
      requiredPlaceholders: [],
      filename: "phase6-synthetic-services.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: createSyntheticContractTemplate(),
    }, execution);
    await approveTemplate(uploaded.templateId, execution);
    templateId = uploaded.templateId;
  } else if (template.data.status !== "approved" || !template.data.is_active) {
    await approveTemplate(template.data.id, execution);
    templateId = template.data.id;
  } else {
    templateId = template.data.id;
  }

  const blockedApp = await getOrCreateApplication(
    admin, actorId, "TAA-PHASE6-LIVE-BLOCKED-20260723-003",
  );
  await seedFields(admin, blockedApp.id, actorId, false);
  const blockedCompleteness = await recalculateCompleteness({
    applicationId: blockedApp.id,
    ruleSetId: "standard-contract",
    initiatedBy: actorId,
    admin,
  });
  if (blockedCompleteness.ready) throw new Error("Scenario A unexpectedly became ready.");
  let blockedError = "";
  try {
    await generateContract({ applicationId: blockedApp.id, templateId }, execution);
  } catch (error) {
    blockedError = error instanceof Error ? error.message : "UNKNOWN";
  }
  if (!blockedError.startsWith("GENERATION_BLOCKED:")) {
    throw new Error("Scenario A was not safely denied.");
  }
  const blockedRuns = await admin.from("contract_generation_runs")
    .select("id", { count: "exact", head: true })
    .eq("application_id", blockedApp.id);
  if (blockedRuns.error || blockedRuns.count !== 0) {
    throw new Error("Scenario A allocated a generation run or contract number.");
  }

  const readyApp = await getOrCreateApplication(
    admin, actorId, "TAA-PHASE6-LIVE-READY-20260723-003",
  );
  await seedFields(admin, readyApp.id, actorId, true);
  const readyCompleteness = await recalculateCompleteness({
    applicationId: readyApp.id,
    ruleSetId: "standard-contract",
    initiatedBy: actorId,
    admin,
  });
  if (!readyCompleteness.ready) throw new Error("Scenario B did not become ready.");

  const concurrentRequests = await Promise.allSettled([
    generateContract({ applicationId: readyApp.id, templateId }, execution),
    generateContract({ applicationId: readyApp.id, templateId }, execution),
  ]);
  const generated = concurrentRequests.find(
    (result) => result.status === "fulfilled" && !result.value.cacheHit,
  );
  if (!generated || generated.status !== "fulfilled") {
    throw new Error("Concurrent generation did not create exactly one usable contract.");
  }
  const cached = await generateContract({
    applicationId: readyApp.id,
    templateId,
  }, execution);
  if (!cached.cacheHit) throw new Error("Repeated generation did not return the cached version.");
  const beforeForce = await admin.from("contracts")
    .select("versions:contract_versions!contract_versions_contract_id_fkey(id,version_number,checksum)")
    .eq("application_id", readyApp.id).eq("template_id", templateId).single();
  if (
    beforeForce.error ||
    beforeForce.data?.versions?.length !== 1 ||
    beforeForce.data.versions[0].version_number !== 1
  ) {
    throw new Error("Initial immutable version was not persisted exactly once.");
  }
  const versionOneChecksum = beforeForce.data.versions[0].checksum;
  const forced = await generateContract({
    applicationId: readyApp.id,
    templateId,
    force: true,
    forceReason: "Synthetic Phase 6 force-regeneration acceptance.",
  }, execution);

  const state = await admin.from("contracts")
    .select("id,contract_number,status,current_version_id,versions:contract_versions!contract_versions_contract_id_fkey(id,version_number,storage_path,checksum,file_size,status,rendered_values_snapshot)")
    .eq("application_id", readyApp.id).eq("template_id", templateId).single();
  if (state.error || !state.data) {
    throw new Error(`Generated contract was not persisted: ${state.error?.message ?? "row missing"}`);
  }
  const versions = [...(state.data.versions ?? [])].sort(
    (left, right) => left.version_number - right.version_number,
  );
  if (
    versions.length < 2 ||
    forced.cacheHit ||
    versions.at(-1)?.id !== forced.contract_version_id ||
    versions[0].checksum !== versionOneChecksum
  ) {
    throw new Error("Force regeneration did not preserve version 1 and create version 2.");
  }
  const latest = versions.at(-1)!;
  const download = await admin.storage.from("contract-documents").download(latest.storage_path);
  if (download.error || !download.data) throw new Error("Generated DOCX download failed.");
  const bytes = Buffer.from(await download.data.arrayBuffer());
  await mkdir(resolve("tmp"), { recursive: true });
  const outputPath = resolve("tmp", "phase6-live-output.docx");
  await writeFile(outputPath, bytes);

  const anonymous = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), publicKey(), {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const anonymousRows = await anonymous.from("contract_versions").select("id")
    .eq("id", latest.id);
  const anonymousDownload = await anonymous.storage.from("contract-documents")
    .download(latest.storage_path);
  if (anonymousRows.data?.length || !anonymousDownload.error) {
    throw new Error("Anonymous access to the generated contract was not denied.");
  }

  let specialistAccess: "not_configured" | "verified" = "not_configured";
  const specialistEmail = process.env.SUPABASE_TEST_SPECIALIST_EMAIL?.trim();
  const specialistPassword = process.env.SUPABASE_TEST_SPECIALIST_PASSWORD?.trim();
  if (specialistEmail && specialistPassword) {
    const specialist = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), publicKey(), {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const login = await specialist.auth.signInWithPassword({
      email: specialistEmail,
      password: specialistPassword,
    });
    if (login.error) throw new Error("Specialist login failed.");
    const specialistFile = await specialist.storage.from("contract-documents")
      .download(latest.storage_path);
    if (specialistFile.error) throw new Error("Active specialist could not download the contract.");
    const signed = await specialist.storage.from("contract-documents")
      .createSignedUrl(latest.storage_path, 60);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error("Active specialist could not create a short-lived signed URL.");
    }
    const signedResponse = await fetch(signed.data.signedUrl);
    if (!signedResponse.ok) throw new Error("Short-lived signed contract download failed.");
    specialistAccess = "verified";
  }

  const [audits, history] = await Promise.all([
    admin.from("audit_events").select("action,metadata")
    .in("application_id", [blockedApp.id, readyApp.id])
    .in("action", [
      "contract.generation_failed",
      "contract.generation_started",
      "contract.generated",
      "contract.generation_cache_hit",
      "contract.version_regenerated",
    ]),
    admin.from("status_history").select("new_status")
      .eq("application_id", readyApp.id),
  ]);
  const actions = new Set((audits.data ?? []).map((event) => event.action));
  for (const action of [
    "contract.generation_failed",
    "contract.generation_started",
    "contract.generated",
    "contract.generation_cache_hit",
    "contract.version_regenerated",
  ]) {
    if (!actions.has(action)) throw new Error(`Missing audit action: ${action}`);
  }
  if (
    (audits.data ?? []).some((event) =>
      Object.hasOwn(event.metadata as object, "rendered_values_snapshot"))
  ) {
    throw new Error("Audit metadata contains a rendered contract snapshot.");
  }
  const statuses = new Set((history.data ?? []).map((item) => item.new_status));
  if (!statuses.has("generating_contract") || !statuses.has("contract_ready")) {
    throw new Error("Contract generation status history is incomplete.");
  }

  console.log(JSON.stringify({
    status: "accepted",
    templateId,
    blockedScenario: {
      applicationId: blockedApp.id,
      ready: blockedCompleteness.ready,
      safeError: blockedError.split(":")[0],
      generationRuns: blockedRuns.count,
    },
    generatedScenario: {
      applicationId: readyApp.id,
      applicationNumber: readyApp.application_number,
      completenessReady: readyCompleteness.ready,
      contractNumber: state.data.contract_number,
      contractStatus: state.data.status,
      initialGenerationCacheHit: generated.value.cacheHit,
      concurrentRequestResults: concurrentRequests.map((result) =>
        result.status === "fulfilled"
          ? (result.value.cacheHit ? "cache_hit" : "generated")
          : "safely_rejected_while_running"),
      repeatedGenerationCacheHit: cached.cacheHit,
      versionCount: versions.length,
      versionNumbers: versions.map((version) => version.version_number),
      versionOnePreserved: versions[0].checksum === versionOneChecksum,
      latestChecksumMatches: latest.checksum ===
        (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
      latestFileSize: latest.file_size,
      latestStatus: latest.status,
      outputPath,
    },
    anonymousAccess: "denied",
    specialistAccess,
    auditActions: [...actions].sort(),
    statusHistory: [...statuses],
    manualReviewRequired: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Contract live acceptance failed.");
  process.exitCode = 1;
});
