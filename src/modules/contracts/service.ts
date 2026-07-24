import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getOperationalContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin.server";
import { computeExtractionFingerprint } from "@/modules/clarification/fingerprint";

import {
  CONTRACT_BUCKET,
  DOCX_MIME,
  MAPPING_VERSION,
  PLACEHOLDER_SCHEMA_VERSION,
} from "./constants";
import {
  renderDocxTemplate,
  validateDocxTemplate,
  type TemplateValidationReport,
} from "./docx";
import { mapContractValues } from "./mapping";
import {
  classifyTemplateDatabaseError,
  normalizeDocxFilename,
  TemplateUploadError,
} from "@/modules/templates/upload-errors";

type Execution = { actorId: string; role: "admin" | "specialist"; admin: SupabaseClient };

async function executionContext(execution?: Execution) {
  if (execution) return execution;
  const { profile } = await getOperationalContext();
  return { actorId: profile.id, role: profile.role, admin: createAdminClient() };
}

function checksum(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function safeFilename(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 180) || "contract.docx";
}

async function audit(
  admin: SupabaseClient,
  input: {
    actorId: string;
    applicationId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    metadata: Record<string, unknown>;
  },
) {
  const result = await admin.from("audit_events").insert({
    actor_id: input.actorId,
    application_id: input.applicationId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    metadata: input.metadata,
  });
  if (result.error) throw new Error("Unable to write audit event.");
}

export async function uploadTemplateVersion(input: {
  name: string;
  code: string;
  description: string | null;
  templateType: "services" | "consulting" | "supply";
  version: string;
  requiredRuleSet: string;
  requiredPlaceholders: string[];
  filename: string;
  mimeType: string;
  content: Buffer;
  operationId?: string;
}, execution?: Execution) {
  const context = await executionContext(execution);
  const operationId = input.operationId ?? randomUUID();
  if (context.role !== "admin") {
    throw new TemplateUploadError("TEMPLATE_RLS_DENIED");
  }
  const filename = normalizeDocxFilename(input.filename);
  const report = validateDocxTemplate({
    content: input.content,
    mimeType: DOCX_MIME,
    requiredPlaceholders: input.requiredPlaceholders,
  });
  const unsafeReport = report.errors.some((code) =>
    [
      "MIME_TYPE_INVALID",
      "MACROS_NOT_ALLOWED",
      "DOCX_CORE_PART_MISSING",
      "PLACEHOLDER_UNSUPPORTED_XML",
      "XML_ENTITIES_NOT_ALLOWED",
    ].includes(code) ||
    /signature|archive|path|expansion|ZIP/iu.test(code),
  );
  if (unsafeReport) {
    throw new TemplateUploadError("TEMPLATE_VALIDATION_FAILED");
  }
  const digest = checksum(input.content);
  const templateId = randomUUID();
  const storagePath = `templates/${input.code}/${input.version}/${templateId}/${safeFilename(filename)}`;
  const upload = await context.admin.storage
    .from(CONTRACT_BUCKET)
    .upload(storagePath, input.content, {
      contentType: DOCX_MIME,
      upsert: false,
    });
  if (upload.error) {
    console.error(JSON.stringify({
      operation: "template.upload",
      operation_id: operationId,
      safe_code: "TEMPLATE_STORAGE_UPLOAD_FAILED",
      supabase_code: upload.error.name ?? null,
      http_status: null,
      rollback: "not_required",
    }));
    throw new TemplateUploadError("TEMPLATE_STORAGE_UPLOAD_FAILED", {
      supabaseCode: upload.error.name,
      rollback: "not_required",
    });
  }
  try {
    const created = await context.admin.from("contract_templates").insert({
      id: templateId,
      name: input.name,
      code: input.code,
      description: input.description,
      template_type: input.templateType,
      version: input.version,
      status: report.valid ? "awaiting_approval" : "draft",
      storage_path: storagePath,
      checksum: digest,
      original_filename: safeFilename(filename),
      mime_type: DOCX_MIME,
      required_rule_set: input.requiredRuleSet,
      placeholder_schema_version: PLACEHOLDER_SCHEMA_VERSION,
      required_fields: input.requiredPlaceholders,
      variable_schema: { placeholders: report.placeholders },
      validation_report: report,
      is_active: false,
      created_by: context.actorId,
    });
    if (created.error) throw classifyTemplateDatabaseError(created.error);
    await audit(context.admin, {
      actorId: context.actorId,
      entityType: "contract_template",
      entityId: templateId,
      action: "template.version_created",
      metadata: {
        checksum: digest,
        version: input.version,
        code: input.code,
        placeholder_schema_version: PLACEHOLDER_SCHEMA_VERSION,
      },
    });
    await audit(context.admin, {
      actorId: context.actorId,
      entityType: "contract_template",
      entityId: templateId,
      action: "template.uploaded",
      metadata: { checksum: digest, version: input.version, code: input.code },
    });
    await audit(context.admin, {
      actorId: context.actorId,
      entityType: "contract_template",
      entityId: templateId,
      action: "template.validation_completed",
      metadata: {
        valid: report.valid,
        error_codes: report.errors,
        placeholder_schema_version: PLACEHOLDER_SCHEMA_VERSION,
      },
    });
    return { templateId, report };
  } catch (error) {
    const [metadataRollback, storageRollback] = await Promise.all([
      context.admin.from("contract_templates").delete().eq("id", templateId),
      context.admin.storage.from(CONTRACT_BUCKET).remove([storagePath]),
    ]);
    const rollbackFailed = Boolean(metadataRollback.error || storageRollback.error);
    const classified = error instanceof TemplateUploadError
      ? error
      : new TemplateUploadError("TEMPLATE_DB_INSERT_FAILED");
    console.error(JSON.stringify({
      operation: "template.upload",
      operation_id: operationId,
      safe_code: rollbackFailed ? "TEMPLATE_ROLLBACK_FAILED" : classified.safeCode,
      supabase_code: classified.diagnostic.supabaseCode ?? null,
      table: classified.diagnostic.table ?? "contract_templates",
      constraint: classified.diagnostic.constraint ?? null,
      http_status: classified.diagnostic.httpStatus ?? null,
      rollback: rollbackFailed ? "failed" : "completed",
    }));
    if (rollbackFailed) {
      throw new TemplateUploadError("TEMPLATE_ROLLBACK_FAILED", {
        ...classified.diagnostic,
        rollback: "failed",
      });
    }
    throw new TemplateUploadError(classified.safeCode, {
      ...classified.diagnostic,
      rollback: "completed",
    });
  }
}

export async function approveTemplate(templateId: string, execution?: Execution) {
  const context = await executionContext(execution);
  if (context.role !== "admin") throw new Error("Administrator access is required.");
  const template = await context.admin
    .from("contract_templates")
    .select("id,validation_report")
    .eq("id", templateId)
    .single();
  if (template.error || !template.data) throw new Error("Template not found.");
  const report = template.data.validation_report as TemplateValidationReport;
  if (!report.valid) throw new Error("Template has blocking validation errors.");
  const changed = await context.admin.from("contract_templates").update({
    status: "approved",
    is_active: true,
    approved_by: context.actorId,
    approved_at: new Date().toISOString(),
  }).eq("id", templateId);
  if (changed.error) throw new Error("Template approval failed.");
  await audit(context.admin, {
    actorId: context.actorId,
    entityType: "contract_template",
    entityId: templateId,
    action: "template.approved",
    metadata: {},
  });
}

export async function setTemplateLifecycle(
  templateId: string,
  action: "deactivate" | "archive",
  execution?: Execution,
) {
  const context = await executionContext(execution);
  if (context.role !== "admin") throw new Error("Administrator access is required.");
  const changed = await context.admin.from("contract_templates").update({
    status: action === "archive" ? "archived" : "inactive",
    is_active: false,
  }).eq("id", templateId);
  if (changed.error) throw new Error("Template lifecycle update failed.");
  await audit(context.admin, {
    actorId: context.actorId,
    entityType: "contract_template",
    entityId: templateId,
    action: `template.${action === "archive" ? "archived" : "deactivated"}`,
    metadata: {},
  });
}

async function loadGenerationSource(
  admin: SupabaseClient,
  applicationId: string,
  templateId: string,
) {
  const [application, template, completeness, fields, extraction, newerEmails, newerAttachments] =
    await Promise.all([
      admin.from("applications").select("id,application_number").eq("id", applicationId).single(),
      admin.from("contract_templates").select("*").eq("id", templateId).single(),
      admin.from("completeness_runs").select("*").eq("application_id", applicationId).order("created_at", { ascending: false }).limit(1).single(),
      admin.from("extracted_fields").select("field_name,structured_value,raw_value,confidence,requires_review,conflict_detected,manually_corrected").eq("application_id", applicationId),
      admin.from("extraction_runs").select("id").eq("application_id", applicationId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("email_messages").select("id,created_at").eq("application_id", applicationId).order("created_at", { ascending: false }).limit(1),
      admin.from("attachments").select("id,created_at").eq("application_id", applicationId).order("created_at", { ascending: false }).limit(1),
    ]);
  const error = application.error ?? template.error ?? completeness.error ?? fields.error ?? extraction.error ?? newerEmails.error ?? newerAttachments.error;
  if (error || !application.data || !template.data || !completeness.data) {
    throw new Error("Unable to load contract generation source.");
  }
  const completenessBlockers = await admin
    .from("completeness_field_results")
    .select("status")
    .eq("completeness_run_id", completeness.data.id)
    .eq("is_blocking", true);
  if (completenessBlockers.error) {
    throw new Error("Unable to verify completeness field blockers.");
  }
  const mappedFields = (fields.data ?? []).map((field) => ({
    fieldName: field.field_name,
    value: (field.structured_value as Record<string, unknown> | null)?.normalizedValue ?? field.raw_value,
    confidence: field.confidence,
    requiresReview: field.requires_review,
    conflictDetected: field.conflict_detected,
    manuallyCorrected: field.manually_corrected,
  }));
  const fingerprint = computeExtractionFingerprint(mappedFields);
  const blocking: string[] = [];
  if (template.data.status !== "approved" || !template.data.is_active) blocking.push("TEMPLATE_NOT_APPROVED");
  if (
    template.data.validation_report?.valid !== true ||
    template.data.placeholder_schema_version !== PLACEHOLDER_SCHEMA_VERSION ||
    !template.data.storage_path ||
    !template.data.checksum
  ) {
    blocking.push("TEMPLATE_VALIDATION_INVALID");
  }
  if (!completeness.data.is_ready || completeness.data.is_blocking) blocking.push("APPLICATION_NOT_READY");
  if ((completenessBlockers.data?.length ?? 0) > 0) {
    blocking.push("COMPLETENESS_FIELD_BLOCKED");
  }
  if (mappedFields.some((field) => field.conflictDetected)) blocking.push("UNRESOLVED_CONFLICT");
  if (mappedFields.some((field) => field.requiresReview)) blocking.push("REVIEW_REQUIRED_FIELD");
  if (completeness.data.extraction_fingerprint !== fingerprint) blocking.push("SOURCE_FINGERPRINT_MISMATCH");
  if (template.data.required_rule_set !== completeness.data.rule_set_id) blocking.push("RULE_SET_MISMATCH");
  const completenessTime = new Date(completeness.data.created_at).getTime();
  if ([newerEmails.data?.[0], newerAttachments.data?.[0]].some((item) => item && new Date(item.created_at).getTime() > completenessTime)) {
    blocking.push("COMPLETENESS_STALE");
  }
  return {
    application: application.data,
    template: template.data,
    completeness: completeness.data,
    fields: Object.fromEntries(mappedFields.map((field) => [field.fieldName, field.value])) as Record<string, string | number | null>,
    fingerprint,
    blocking,
    extractionRunId: extraction.data?.id ?? null,
  };
}

export async function checkContractEligibility(
  applicationId: string,
  templateId: string,
) {
  const { admin } = await executionContext();
  const source = await loadGenerationSource(admin, applicationId, templateId);
  return {
    ready: source.blocking.length === 0,
    blockingReasons: source.blocking,
    completenessRunId: source.completeness.id as string,
    sourceFingerprint: source.fingerprint,
  };
}

export async function generateContract(input: {
  applicationId: string;
  templateId: string;
  force?: boolean;
  forceReason?: string | null;
}, execution?: Execution) {
  const context = await executionContext(execution);
  if (input.force && context.role !== "admin") throw new Error("Administrator access is required for force regeneration.");
  const source = await loadGenerationSource(context.admin, input.applicationId, input.templateId);
  if (source.blocking.length) {
    await audit(context.admin, {
      actorId: context.actorId,
      applicationId: input.applicationId,
      entityType: "application",
      entityId: input.applicationId,
      action: "contract.generation_failed",
      metadata: {
        template_id: input.templateId,
        completeness_run_id: source.completeness.id,
        source_fingerprint: source.fingerprint,
        safe_error_code: "GENERATION_BLOCKED",
        blocking_reasons: source.blocking,
      },
    });
    throw new Error(`GENERATION_BLOCKED:${source.blocking.join(",")}`);
  }
  let previewValues: ReturnType<typeof mapContractValues>;
  try {
    previewValues = mapContractValues({
      applicationNumber: source.application.application_number,
      contractNumber: "TAA-PENDING",
      generatedDate: new Date().toISOString().slice(0, 10),
      fields: source.fields,
    });
  } catch (error) {
    await audit(context.admin, {
      actorId: context.actorId,
      applicationId: input.applicationId,
      entityType: "application",
      entityId: input.applicationId,
      action: "contract.generation_failed",
      metadata: {
        template_id: input.templateId,
        completeness_run_id: source.completeness.id,
        source_fingerprint: source.fingerprint,
        safe_error_code: error instanceof Error ? error.message : "MAPPING_VALIDATION_FAILED",
      },
    });
    throw error;
  }
  const requiredPlaceholders = Array.isArray(source.template.required_fields)
    ? source.template.required_fields as string[]
    : [];
  const missingRequired = requiredPlaceholders.filter(
    (name) => !previewValues[name as keyof typeof previewValues],
  );
  if (missingRequired.length) {
    await audit(context.admin, {
      actorId: context.actorId,
      applicationId: input.applicationId,
      entityType: "application",
      entityId: input.applicationId,
      action: "contract.generation_failed",
      metadata: {
        template_id: input.templateId,
        completeness_run_id: source.completeness.id,
        source_fingerprint: source.fingerprint,
        safe_error_code: "REQUIRED_RENDER_VALUE_MISSING",
        missing_placeholders: missingRequired,
      },
    });
    throw new Error(`GENERATION_BLOCKED:REQUIRED_RENDER_VALUE_MISSING:${missingRequired.join(",")}`);
  }
  const idempotencyKey = createHash("sha256").update([
    input.applicationId,
    input.templateId,
    source.template.version,
    source.fingerprint,
    source.completeness.id,
    MAPPING_VERSION,
    PLACEHOLDER_SCHEMA_VERSION,
  ].join(":")).digest("hex");
  const begin = await context.admin.rpc("begin_contract_generation", {
    p_application_id: input.applicationId,
    p_template_id: input.templateId,
    p_completeness_run_id: source.completeness.id,
    p_idempotency_key: input.force ? `${idempotencyKey}:${randomUUID()}` : idempotencyKey,
    p_source_fingerprint: source.fingerprint,
    p_placeholder_schema_version: PLACEHOLDER_SCHEMA_VERSION,
    p_mapping_version: MAPPING_VERSION,
    p_initiated_by: context.actorId,
    p_force: input.force ?? false,
    p_force_reason: input.forceReason ?? null,
  });
  if (begin.error || !begin.data) throw new Error(begin.error?.message ?? "Generation claim failed.");
  const claim = begin.data as {
    run_id: string;
    claimed: boolean;
    cache_hit: boolean;
    contract_version_id: string | null;
    contract_number?: string;
  };
  if (claim.cache_hit) return { cacheHit: true as const, versionId: claim.contract_version_id };
  if (!claim.claimed || !claim.contract_number) throw new Error("Generation is already running.");

  let storagePath: string | null = null;
  try {
    const download = await context.admin.storage
      .from(CONTRACT_BUCKET)
      .download(source.template.storage_path);
    if (download.error || !download.data) throw new Error("TEMPLATE_DOWNLOAD_FAILED");
    const templateContent = Buffer.from(await download.data.arrayBuffer());
    if (checksum(templateContent) !== source.template.checksum) throw new Error("TEMPLATE_CHECKSUM_MISMATCH");
    const renderedValues = mapContractValues({
      applicationNumber: source.application.application_number,
      contractNumber: claim.contract_number,
      generatedDate: new Date().toISOString().slice(0, 10),
      fields: source.fields,
    });
    const output = renderDocxTemplate({ content: templateContent, values: renderedValues });
    const outputReport = validateDocxTemplate({
      content: output,
      mimeType: DOCX_MIME,
      requiredPlaceholders: [],
    });
    if (outputReport.placeholders.length || outputReport.errors.some((item) => item !== "TEMPLATE_HAS_NO_PLACEHOLDERS")) {
      throw new Error("OUTPUT_VALIDATION_FAILED");
    }
    const filename = safeFilename(`${claim.contract_number}-v${Date.now()}.docx`);
    storagePath = `applications/${input.applicationId}/runs/${claim.run_id}/${filename}`;
    const uploaded = await context.admin.storage.from(CONTRACT_BUCKET).upload(storagePath, output, {
      contentType: DOCX_MIME,
      upsert: false,
    });
    if (uploaded.error) throw new Error("OUTPUT_STORAGE_FAILED");
    const finalized = await context.admin.rpc("finalize_contract_generation", {
      p_run_id: claim.run_id,
      p_storage_path: storagePath,
      p_checksum: checksum(output),
      p_generated_filename: filename,
      p_file_size: output.length,
      p_rendered_values: renderedValues,
      p_generation_warnings: source.template.validation_report?.warnings ?? [],
      p_extraction_run_id: source.extractionRunId,
    });
    if (finalized.error || !finalized.data) throw new Error("GENERATION_PERSISTENCE_FAILED");
    return {
      cacheHit: false as const,
      ...(finalized.data as {
        contract_id: string;
        contract_number: string;
        contract_version_id: string;
        version_number: number;
      }),
    };
  } catch (error) {
    if (storagePath) await context.admin.storage.from(CONTRACT_BUCKET).remove([storagePath]);
    await context.admin.rpc("fail_contract_generation", {
      p_run_id: claim.run_id,
      p_error_code: error instanceof Error ? error.message.slice(0, 100) : "GENERATION_FAILED",
    });
    throw error;
  }
}
