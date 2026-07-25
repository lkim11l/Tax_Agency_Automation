import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getOperationalContext } from "@/lib/auth/context";
import { getProjectDateIso } from "@/lib/project-time";
import { createAdminClient } from "@/lib/supabase/admin.server";
import {
  buildCurrentCompletenessFingerprint,
  type CompletenessAcceptanceRecord,
  type CompletenessSourceField,
} from "@/modules/clarification/fingerprint";
import { getRuleSet } from "@/modules/clarification/rules";
import { recalculateCompleteness } from "@/modules/clarification/service";
import { inputFingerprint } from "@/modules/applications/processing";

import {
  CONTRACT_BUCKET,
  DOCX_MIME,
  LEGALLY_OPTIONAL_PLACEHOLDERS,
  MANDATORY_PLACEHOLDERS,
  MAPPING_VERSION,
  PLACEHOLDER_SCHEMA_VERSION,
  PLACEHOLDER_TO_EXTRACTION_FIELD,
  SYSTEM_MANAGED_PLACEHOLDERS,
  type ContractPlaceholder,
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

// mapContractValues intentionally throws a plain Error with one of these
// exact machine codes for data it cannot safely render (see mapping.ts).
// Anything else (a defensive/unexpected throw) collapses to a generic code
// so the caller never has to guess what an arbitrary message means.
const MAPPING_BLOCKING_CODES = new Set([
  "CONTRACT_AMOUNT_INVALID",
  "AMOUNT_WORDS_UNSUPPORTED_CURRENCY",
  "SIGNER_POSITION_DECLENSION_UNRELIABLE",
  "SIGNER_NAME_DECLENSION_UNRELIABLE",
  "SIGNER_AUTHORITY_DECLENSION_UNRELIABLE",
]);

// Wraps mapContractValues so a known, safe-to-explain failure (unsupported
// currency, a signer name/position/authority this deterministic renderer
// cannot reliably decline, ...) reaches the caller as a GENERATION_BLOCKED
// reason — the same channel checkContractEligibility already uses — instead
// of a raw Error whose message the UI has no choice but to hide behind a
// generic "try again or contact an administrator".
function mapContractValuesOrBlock(
  input: Parameters<typeof mapContractValues>[0],
): ReturnType<typeof mapContractValues> {
  try {
    return mapContractValues(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = MAPPING_BLOCKING_CODES.has(message) ? message : "MAPPING_VALIDATION_FAILED";
    throw new Error(`GENERATION_BLOCKED:${code}`);
  }
}

// begin_contract_generation re-checks readiness/staleness inside the same
// advisory-locked transaction that claims the run — a defense-in-depth
// re-check against exactly the race this closes (e.g. a field gets manually
// corrected between checkContractEligibility and this call). It raises a
// bare Postgres exception whose message is one of these codes. These are the
// same "blocking reason" vocabulary as `source.blocking` above, so they must
// go through the identical GENERATION_BLOCKED channel — otherwise
// safeGenerationErrorMessage's prefix check misses them entirely and every
// one of them (however well-diagnosed) collapses to the fully generic
// fallback string, even though a specific Russian message already exists.
const CLAIM_BLOCKING_CODES = new Set([
  "TEMPLATE_NOT_APPROVED",
  "APPLICATION_NOT_READY",
  "APPLICATION_HAS_BLOCKING_FIELDS",
  "COMPLETENESS_STALE",
]);

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
  // Mandatory placeholders are never left to the uploading admin's
  // discretion — union them in regardless of what was selected in the
  // upload form, so a template missing the genitive preamble fields can
  // never validate as ready for approval.
  const requiredPlaceholders = [
    ...new Set([...input.requiredPlaceholders, ...MANDATORY_PLACEHOLDERS]),
  ];
  const report = validateDocxTemplate({
    content: input.content,
    mimeType: DOCX_MIME,
    requiredPlaceholders,
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
      required_fields: requiredPlaceholders,
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

// Lets an admin fix name/description/required_fields without re-uploading the
// file — re-validates against the SAME already-stored DOCX (never re-checks
// checksum/content safety, since the file itself is untouched) and updates
// status/validation_report exactly like a fresh upload would. Only allowed
// before approval: an approved template's file+metadata pairing is what
// ADR-016 treats as the immutable, audited record — editing that requires a
// new version, not a silent in-place change.
export async function updateTemplateMetadata(input: {
  templateId: string;
  name: string;
  description: string | null;
  requiredPlaceholders: string[];
}, execution?: Execution) {
  const context = await executionContext(execution);
  if (context.role !== "admin") throw new Error("Administrator access is required.");
  const current = await context.admin
    .from("contract_templates")
    .select("id,status,storage_path,mime_type")
    .eq("id", input.templateId)
    .single();
  if (current.error || !current.data) throw new Error("Template not found.");
  if (!["draft", "awaiting_approval"].includes(current.data.status)) {
    throw new Error("Only a draft or awaiting-approval template can be edited — upload a new version instead.");
  }
  if (!current.data.storage_path) throw new Error("Template has no stored file.");
  const download = await context.admin.storage.from(CONTRACT_BUCKET).download(current.data.storage_path);
  if (download.error || !download.data) throw new Error("Unable to download template file.");
  const content = Buffer.from(await download.data.arrayBuffer());
  const requiredPlaceholders = [
    ...new Set([...input.requiredPlaceholders, ...MANDATORY_PLACEHOLDERS]),
  ];
  const report = validateDocxTemplate({
    content,
    mimeType: current.data.mime_type ?? DOCX_MIME,
    requiredPlaceholders,
  });
  const changed = await context.admin.from("contract_templates").update({
    name: input.name,
    description: input.description,
    required_fields: requiredPlaceholders,
    variable_schema: { placeholders: report.placeholders },
    validation_report: report,
    status: report.valid ? "awaiting_approval" : "draft",
  }).eq("id", input.templateId);
  if (changed.error) throw new Error("Template update failed.");
  await audit(context.admin, {
    actorId: context.actorId,
    entityType: "contract_template",
    entityId: input.templateId,
    action: "template.metadata_updated",
    metadata: { valid: report.valid, error_codes: report.errors },
  });
}

// Strategy B (defense in depth for Step 6): required_fields naming a
// contractPlaceholder that neither the template's own completeness rule set
// covers nor the system-managed exclusion list explains is a template an
// admin can approve today and have generation silently discover the gap on
// tomorrow (exactly the shape of gap this incident's static hypothesis
// worried about) — catch it here instead, before the template ever becomes
// approved/active.
function findUnrecognizedRequiredFields(requiredFields: string[], ruleSetId: string): string[] {
  const ruleSet = getRuleSet(ruleSetId);
  const ruleSetFieldNames = new Set(ruleSet.rules.map((rule) => rule.fieldName));
  return requiredFields.filter((name) => {
    if (SYSTEM_MANAGED_PLACEHOLDERS.includes(name as ContractPlaceholder)) return false;
    const extractionFieldName = PLACEHOLDER_TO_EXTRACTION_FIELD[name as ContractPlaceholder] ?? name;
    return !ruleSetFieldNames.has(extractionFieldName);
  });
}

export async function approveTemplate(templateId: string, execution?: Execution) {
  const context = await executionContext(execution);
  if (context.role !== "admin") throw new Error("Administrator access is required.");
  const template = await context.admin
    .from("contract_templates")
    .select("id,validation_report,required_fields,required_rule_set")
    .eq("id", templateId)
    .single();
  if (template.error || !template.data) throw new Error("Template not found.");
  const report = template.data.validation_report as TemplateValidationReport;
  if (!report.valid) throw new Error("Template has blocking validation errors.");
  const requiredFields = Array.isArray(template.data.required_fields)
    ? (template.data.required_fields as string[])
    : [];
  const unrecognized = findUnrecognizedRequiredFields(requiredFields, template.data.required_rule_set as string);
  if (unrecognized.length) {
    throw new Error(
      `Template requires fields the completeness rule set never checks and that are not system-managed: ${unrecognized.join(", ")}. Add a completeness rule for them or remove them from required_fields before approving.`,
    );
  }
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

export type TemplateRuntimeCheck = {
  ok: boolean;
  reasons: string[];
  currentPlaceholderSchemaVersion: string | null;
  requiredPlaceholderSchemaVersion: string;
};

type TemplateRow = {
  storage_path: string | null;
  checksum: string | null;
  mime_type: string | null;
  required_fields: unknown;
  placeholder_schema_version: string | null;
};

// The DB row (status='approved', is_active=true, validation_report.valid,
// placeholder_schema_version) is never trusted on its own — it only proves
// what was true when the template was last approved, not what is in
// Storage right now. Every generation attempt re-downloads the actual bytes
// and re-runs the CURRENT validateDocxTemplate against them, so a template
// approved before a safety check existed (mock markers, highlighting,
// missing mandatory placeholders) — or one whose stored file was somehow
// swapped after approval — is caught here regardless of its DB status.
export async function reverifyTemplateContent(
  admin: SupabaseClient,
  template: TemplateRow,
): Promise<TemplateRuntimeCheck> {
  const requiredPlaceholderSchemaVersion = PLACEHOLDER_SCHEMA_VERSION;
  const currentPlaceholderSchemaVersion = template.placeholder_schema_version ?? null;
  if (!template.storage_path || !template.checksum) {
    return {
      ok: false,
      reasons: ["TEMPLATE_STORAGE_METADATA_MISSING"],
      currentPlaceholderSchemaVersion,
      requiredPlaceholderSchemaVersion,
    };
  }
  const download = await admin.storage.from(CONTRACT_BUCKET).download(template.storage_path);
  if (download.error || !download.data) {
    return {
      ok: false,
      reasons: ["TEMPLATE_DOWNLOAD_FAILED"],
      currentPlaceholderSchemaVersion,
      requiredPlaceholderSchemaVersion,
    };
  }
  const content = Buffer.from(await download.data.arrayBuffer());
  const reasons: string[] = [];
  if (checksum(content) !== template.checksum) reasons.push("CHECKSUM_MISMATCH");
  const requiredPlaceholders = [
    ...new Set([
      ...(Array.isArray(template.required_fields) ? (template.required_fields as string[]) : []),
      ...MANDATORY_PLACEHOLDERS,
    ]),
  ];
  const report = validateDocxTemplate({
    content,
    mimeType: template.mime_type ?? DOCX_MIME,
    requiredPlaceholders,
  });
  reasons.push(...report.errors);
  if (currentPlaceholderSchemaVersion !== requiredPlaceholderSchemaVersion) {
    reasons.push("PLACEHOLDER_SCHEMA_OUTDATED");
  }
  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    currentPlaceholderSchemaVersion,
    requiredPlaceholderSchemaVersion,
  };
}

// Read-only admin diagnostic: does NOT mutate the template or Supabase in
// any way. Safe to call from a template list/detail page.
export async function getTemplateRuntimeStatus(templateId: string, execution?: Execution) {
  const context = await executionContext(execution);
  const template = await context.admin
    .from("contract_templates")
    .select("storage_path,checksum,mime_type,required_fields,placeholder_schema_version")
    .eq("id", templateId)
    .single();
  if (template.error || !template.data) throw new Error("Template not found.");
  return reverifyTemplateContent(context.admin, template.data as TemplateRow);
}

async function loadGenerationSource(
  admin: SupabaseClient,
  applicationId: string,
  templateId: string,
  actorId: string,
) {
  const [application, template] = await Promise.all([
    admin.from("applications").select("id,application_number").eq("id", applicationId).single(),
    admin.from("contract_templates").select("*").eq("id", templateId).single(),
  ]);
  if (application.error || !application.data || template.error || !template.data) {
    throw new Error("Unable to load contract generation source.");
  }

  const runtimeCheck = await reverifyTemplateContent(admin, template.data as TemplateRow);
  if (!runtimeCheck.ok) {
    console.error(JSON.stringify({
      operation: "contract.template_runtime_revalidation_failed",
      template_id: templateId,
      reasons: runtimeCheck.reasons,
      current_placeholder_schema_version: runtimeCheck.currentPlaceholderSchemaVersion,
      required_placeholder_schema_version: runtimeCheck.requiredPlaceholderSchemaVersion,
    }));
  }

  const ruleSetId = template.data.required_rule_set as string;
  const ruleSet = getRuleSet(ruleSetId);

  const [fieldsResult, acceptancesResult, extraction, latestProcessingRun, currentInputFingerprint] =
    await Promise.all([
      admin
        .from("extracted_fields")
        .select(
          "id,field_name,structured_value,raw_value,source_type,source_id,source_marker,source_excerpt,confidence,requires_review,conflict_detected,manually_corrected,updated_at",
        )
        .eq("application_id", applicationId),
      admin
        .from("extracted_field_acceptances")
        .select("extracted_field_id,value_fingerprint")
        .eq("application_id", applicationId),
      admin.from("extraction_runs").select("id,completed_at").eq("application_id", applicationId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      // "Did input actually change" — the same question
      // claim_application_processing() already answers correctly via
      // input_fingerprint — not "does a newer email/attachment row exist at
      // all". An email/attachment that never changed the fingerprint (an
      // auto-reply, a duplicate, an attachment with no extractable content)
      // is a legitimate cache hit on every future "Обработать заявку", and
      // must never be treated as permanently unprocessed.
      admin
        .from("application_processing_runs")
        .select("id,input_fingerprint,completed_at")
        .eq("application_id", applicationId)
        .in("status", ["completed", "completed_with_review"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      inputFingerprint(applicationId, admin),
    ]);
  const loadError = fieldsResult.error ?? acceptancesResult.error ?? extraction.error ?? latestProcessingRun.error;
  if (loadError) throw new Error("Unable to load contract generation source.");

  const rawFields = (fieldsResult.data ?? []) as (CompletenessSourceField & { updated_at: string })[];
  const rawAcceptances = (acceptancesResult.data ?? []) as CompletenessAcceptanceRecord[];
  // The one and only fingerprint algorithm — identical to the one
  // `recalculateCompleteness` uses, so a completeness run it just produced
  // is always found here by exact match instead of appearing "stale".
  const fingerprint = buildCurrentCompletenessFingerprint({
    fields: rawFields,
    acceptances: rawAcceptances,
  });

  let completeness = await admin
    .from("completeness_runs")
    .select("*")
    .eq("application_id", applicationId)
    .eq("rule_set_id", ruleSetId)
    .eq("rule_set_version", ruleSet.version)
    .eq("extraction_fingerprint", fingerprint)
    .maybeSingle();
  if (completeness.error) throw new Error("Unable to load contract generation source.");

  if (!completeness.data) {
    // No completeness run reflects the application's current data under the
    // selected template's rule set (e.g. right after a bulk field
    // acceptance, or the template's rule set differs from whatever was last
    // calculated). Recalculate automatically instead of requiring a second
    // "Обработать заявку" click before generation can proceed.
    const recalculated = await recalculateCompleteness({
      applicationId,
      ruleSetId,
      initiatedBy: actorId,
      admin,
    });
    const refetched = await admin
      .from("completeness_runs")
      .select("*")
      .eq("id", recalculated.runId)
      .single();
    if (refetched.error || !refetched.data) {
      throw new Error("Unable to load contract generation source.");
    }
    completeness = refetched;
  }
  const completenessRow = completeness.data;

  const completenessBlockers = await admin
    .from("completeness_field_results")
    .select("status")
    .eq("completeness_run_id", completenessRow.id)
    .eq("is_blocking", true);
  if (completenessBlockers.error) {
    throw new Error("Unable to verify completeness field blockers.");
  }
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
  // status='approved' and is_active=true are never sufficient on their own
  // — a template approved before this check existed (or one whose Storage
  // content was altered afterward) is blocked here regardless.
  if (!runtimeCheck.ok) blocking.push("TEMPLATE_SECURITY_REVALIDATION_FAILED");
  if (!completenessRow.is_ready || completenessRow.is_blocking) blocking.push("APPLICATION_NOT_READY");
  if ((completenessBlockers.data?.length ?? 0) > 0) {
    blocking.push("COMPLETENESS_FIELD_BLOCKED");
  }
  if (rawFields.some((field) => field.conflict_detected)) blocking.push("UNRESOLVED_CONFLICT");
  if (rawFields.some((field) => field.requires_review)) blocking.push("REVIEW_REQUIRED_FIELD");
  // Defense in depth: by construction the run above always matches, but
  // never skip verifying it — these two checks must still be able to block.
  if (completenessRow.extraction_fingerprint !== fingerprint) blocking.push("SOURCE_FINGERPRINT_MISMATCH");
  if (template.data.required_rule_set !== completenessRow.rule_set_id) blocking.push("RULE_SET_MISMATCH");
  // "Genuinely unprocessed new input" means exactly what
  // claim_application_processing() already means by a cache miss: no
  // completed processing run covers the current inputFingerprint (source
  // checksums + selected template). Wall-clock comparisons (an email/
  // attachment/extracted_fields row touched "recently") answer a different,
  // less reliable question and can disagree with the cache-hit mechanism
  // forever — e.g. a message that never changed the fingerprint, or a field
  // re-touched (re-confirmed, a derived-rule sync) without its value
  // actually changing. The extraction_fingerprint check just above already
  // covers "does completeness reflect the application's current
  // extracted_fields/acceptances" (and does so from the exact same
  // fingerprint algorithm, not an approximation of it) — no separate
  // wall-clock re-check of extracted_fields.updated_at is needed on top of
  // it, and keeping one caused this application to be stuck showing
  // COMPLETENESS_STALE forever despite reprocessing genuinely finding
  // nothing new.
  if (!latestProcessingRun.data || latestProcessingRun.data.input_fingerprint !== currentInputFingerprint) {
    blocking.push("COMPLETENESS_STALE");
  }
  const mappedFields = Object.fromEntries(
    rawFields.map((field) => [
      field.field_name,
      (field.structured_value as Record<string, unknown> | null)?.normalizedValue ?? field.raw_value,
    ]),
  ) as Record<string, string | number | null>;

  // Required-render-value preview (ADR-per-ARCHITECTURE.md Phase 6: eligibility
  // includes a "required-value preview" step, not just completeness). Compute
  // this here — once — so both checkContractEligibility and generateContract
  // see the identical answer, instead of generateContract discovering a
  // missing client_* field (or an undeclinable signer name/position/authority)
  // only after it has already claimed a generation run.
  let missingRenderFields: string[] = [];
  try {
    const previewValues = mapContractValuesOrBlock({
      applicationNumber: application.data.application_number,
      contractNumber: "TAA-PENDING",
      generatedDate: getProjectDateIso(),
      fields: mappedFields,
    });
    const requiredPlaceholders = Array.isArray(template.data.required_fields)
      ? (template.data.required_fields as string[])
      : [];
    // required_fields is an admin's fallible checklist from upload time, not
    // ground truth — validateDocxTemplate already recorded every placeholder
    // the DOCX text actually contains (variable_schema.placeholders), and
    // never required that set to be a subset of required_fields. Union both,
    // minus the explicit optional allowlist, so a template that references
    // {{client_short_name}} in its text still blocks on a missing value even
    // if the uploading admin forgot to tick that box (Step 7).
    const templatePlaceholders = Array.isArray(
      (template.data.variable_schema as { placeholders?: unknown } | null)?.placeholders,
    )
      ? ((template.data.variable_schema as { placeholders: string[] }).placeholders)
      : [];
    // Deliberately no requiredUnlessAll-style substitution here (unlike
    // rules.ts's completeness rule for performance_period_text): the actual
    // DOCX renderer (renderDocxTemplate in ./docx.ts) has no concept of one
    // placeholder substituting for another — if a template's text literally
    // contains {{performance_period_text}}, it needs that exact value
    // regardless of whether performance_start_date/end_date are also
    // present, or rendering throws PLACEHOLDER_VALUE_MISSING. Eligibility
    // must reflect that renderer's real requirement, not the rule engine's
    // more lenient "either is fine" question-asking logic — a template that
    // doesn't textually reference performance_period_text at all simply
    // never puts it in `templatePlaceholders`, and this check correctly
    // leaves it alone.
    const mustRenderNonEmpty = [...new Set([...requiredPlaceholders, ...templatePlaceholders])].filter(
      (name) => !LEGALLY_OPTIONAL_PLACEHOLDERS.includes(name as ContractPlaceholder),
    );
    missingRenderFields = mustRenderNonEmpty.filter(
      (name) => !previewValues[name as keyof typeof previewValues],
    );
    if (missingRenderFields.length) blocking.push("REQUIRED_RENDER_VALUE_MISSING");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    blocking.push(
      message.startsWith("GENERATION_BLOCKED:") ? message.slice("GENERATION_BLOCKED:".length) : "MAPPING_VALIDATION_FAILED",
    );
  }

  return {
    application: application.data,
    template: template.data,
    completeness: completenessRow,
    fields: mappedFields,
    fingerprint,
    blocking,
    missingRenderFields,
    extractionRunId: extraction.data?.id ?? null,
  };
}

export async function checkContractEligibility(
  applicationId: string,
  templateId: string,
  execution?: Execution,
) {
  const { admin, actorId } = await executionContext(execution);
  const source = await loadGenerationSource(admin, applicationId, templateId, actorId);
  return {
    ready: source.blocking.length === 0,
    blockingReasons: source.blocking,
    missingRenderFields: source.missingRenderFields,
    completenessRunId: source.completeness.id as string,
    sourceFingerprint: source.fingerprint,
  };
}

export type ContractEligibility = Awaited<ReturnType<typeof checkContractEligibility>>;

export async function generateContract(input: {
  applicationId: string;
  templateId: string;
  force?: boolean;
  forceReason?: string | null;
}, execution?: Execution) {
  const context = await executionContext(execution);
  if (input.force && context.role !== "admin") throw new Error("Administrator access is required for force regeneration.");
  const source = await loadGenerationSource(context.admin, input.applicationId, input.templateId, context.actorId);
  if (source.blocking.length) {
    // checkContractEligibility already computed this exact same `blocking`
    // array (loadGenerationSource is the one and only place either function
    // calls) — this fails fast, before begin_contract_generation claims a
    // run, for anything eligibility could already have told the caller,
    // including a missing required render value or an undeclinable
    // signer name/position/authority.
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
        ...(source.missingRenderFields.length ? { missing_render_fields: source.missingRenderFields } : {}),
      },
    });
    // Carry the actual missing field names on the one reason that has them —
    // everything else in `blocking` is already a bare, self-describing code.
    // Reasons are joined with ";", never ",": REQUIRED_RENDER_VALUE_MISSING's
    // own field list is comma-separated, and it can appear alongside other
    // reasons here — a plain "," join would make the two indistinguishable
    // again (see safeGenerationErrorMessage in ./actions.ts).
    const reasons = source.blocking.map((reason) =>
      reason === "REQUIRED_RENDER_VALUE_MISSING"
        ? `REQUIRED_RENDER_VALUE_MISSING:${source.missingRenderFields.join(",")}`
        : reason,
    );
    throw new Error(`GENERATION_BLOCKED:${reasons.join(";")}`);
  }
  const generatedDate = getProjectDateIso();
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
  if (begin.error || !begin.data) {
    const code = begin.error?.message?.trim() ?? "";
    // Before this audit write existed, a rejection here (the exact bug this
    // incident traced to — see CLAIM_BLOCKING_CODES above) left no
    // audit_events row at all: not just a generic user-facing message, but a
    // silent gap in the "every action is auditable" guarantee (AGENTS.md).
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
        safe_error_code: CLAIM_BLOCKING_CODES.has(code) ? "GENERATION_BLOCKED" : "GENERATION_CLAIM_FAILED",
        blocking_reasons: CLAIM_BLOCKING_CODES.has(code) ? [code] : [],
        claim_error: code || null,
      },
    });
    if (CLAIM_BLOCKING_CODES.has(code)) throw new Error(`GENERATION_BLOCKED:${code}`);
    throw new Error(begin.error?.message ?? "Generation claim failed.");
  }
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
    const renderedValues = mapContractValuesOrBlock({
      applicationNumber: source.application.application_number,
      contractNumber: claim.contract_number,
      generatedDate,
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
