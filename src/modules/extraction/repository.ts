import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getOperationalContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin.server";

import type { ExtractionSource } from "./types";
import {
  extractedValueSchema,
  missingExtractedValue,
  type ContractExtraction,
} from "./schema";
import {
  extractionFieldNames,
  organizationFieldNames,
  signerFieldNames,
  contractFieldNames,
} from "./constants";
import {
  fieldValueFingerprint,
  previewSafeAcceptance,
  type AcceptanceField,
} from "./acceptance";
import { syncDerivedFieldRules } from "./authority";
import { getRuleSet } from "@/modules/clarification/rules";

function checksum(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function labeledText(
  marker: string,
  record: Record<string, string | number | null | undefined>,
) {
  const lines = Object.entries(record)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .map(([name, value]) => `${name}: ${value}`);
  return lines.length ? `${marker}\n${lines.join("\n")}` : "";
}

export async function loadExtractionSources(
  applicationId: string,
  supabase: SupabaseClient = createAdminClient(),
) {
  const [applicationResult, emailResult, documentsResult] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id,title,contract_subject,contract_amount,currency,performance_start_date,performance_end_date,payment_terms,counterparty:counterparties(id,legal_name,short_name,inn,kpp,ogrn,legal_address,actual_address,bank_name,bank_account,correspondent_account,bik,signer_name,signer_position,signer_authority,contact_name,contact_email,contact_phone)",
      )
      .eq("id", applicationId)
      .maybeSingle(),
    supabase
      .from("email_messages")
      .select("id,subject,plain_body,occurred_at")
      .eq("application_id", applicationId)
      .not("plain_body", "is", null)
      .order("occurred_at"),
    supabase
      .from("parsed_documents")
      .select(
        "id,normalized_text,parser_version,attachment:attachments!inner(id,checksum,parse_status)",
      )
      .eq("application_id", applicationId)
      .eq("status", "parsed")
      .not("normalized_text", "is", null)
      .order("created_at"),
  ]);
  const error = applicationResult.error ?? emailResult.error ?? documentsResult.error;
  if (error) throw new Error(`Unable to load extraction sources: ${error.message}`);
  if (!applicationResult.data) throw new Error("Application not found.");

  const sources: ExtractionSource[] = [];
  const application = applicationResult.data as Record<string, unknown>;
  const applicationText = labeledText("[APPLICATION CARD]", {
    title: application.title as string | null,
    contract_subject: application.contract_subject as string | null,
    contract_amount: application.contract_amount as number | null,
    currency: application.currency as string | null,
    performance_start_date: application.performance_start_date as string | null,
    performance_end_date: application.performance_end_date as string | null,
    payment_terms: application.payment_terms as string | null,
  });
  if (applicationText) {
    sources.push({
      sourceType: "application",
      sourceId: applicationId,
      sourceMarker: "[APPLICATION CARD]",
      text: applicationText,
      checksum: checksum(applicationText),
    });
  }

  const relation = application.counterparty;
  const counterparty = (Array.isArray(relation) ? relation[0] : relation) as
    | Record<string, string | null>
    | null;
  if (counterparty?.id) {
    const counterpartyText = labeledText("[COUNTERPARTY CARD]", counterparty);
    sources.push({
      sourceType: "counterparty",
      sourceId: counterparty.id,
      sourceMarker: "[COUNTERPARTY CARD]",
      text: counterpartyText,
      checksum: checksum(counterpartyText),
    });
  }

  for (const message of emailResult.data ?? []) {
    const text = `[EMAIL BODY]\nSubject: ${message.subject ?? ""}\n${message.plain_body ?? ""}`.trim();
    if (!text) continue;
    sources.push({
      sourceType: "email_message",
      sourceId: message.id,
      sourceMarker: "[EMAIL BODY]",
      text,
      checksum: checksum(text),
    });
  }

  for (const document of documentsResult.data ?? []) {
    const relationValue = document.attachment;
    const attachment = (Array.isArray(relationValue) ? relationValue[0] : relationValue) as
      | { checksum: string; parse_status: string }
      | undefined;
    if (!document.normalized_text || attachment?.parse_status !== "parsed") continue;
    sources.push({
      sourceType: "parsed_document",
      sourceId: document.id,
      sourceMarker: "[DOCUMENT]",
      text: document.normalized_text,
      checksum: attachment.checksum,
      parserVersion: document.parser_version,
      ocrDerived: false,
    });
  }
  return sources;
}

export async function resolveExtractionInitiator(
  supabase: SupabaseClient = createAdminClient(),
) {
  const configuredEmail = process.env.SUPABASE_TEST_ADMIN_EMAIL?.trim();
  let query = supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true);
  if (configuredEmail) query = query.eq("email", configuredEmail);
  const { data, error } = await query.order("created_at").limit(1).maybeSingle();
  if (error || !data) throw new Error("No active administrator is available.");
  return data.id as string;
}

export async function loadCurrentExtraction(
  applicationId: string,
  supabase: SupabaseClient = createAdminClient(),
): Promise<ContractExtraction | null> {
  const result = await supabase
    .from("extracted_fields")
    .select("field_name,structured_value")
    .eq("application_id", applicationId);
  if (result.error) throw new Error("Unable to load current extraction.");
  if (!result.data?.length) return null;
  const values = new Map(
    result.data.map((row) => [
      row.field_name,
      extractedValueSchema.safeParse(row.structured_value),
    ]),
  );
  const group = (names: readonly string[]) =>
    Object.fromEntries(
      names.map((name) => {
        const parsed = values.get(name);
        return [name, parsed?.success ? parsed.data : missingExtractedValue()];
      }),
    );
  return {
    extractionVersion: "contract-extraction-schema-v1",
    organization: group(organizationFieldNames) as ContractExtraction["organization"],
    signer: group(signerFieldNames) as ContractExtraction["signer"],
    contract: group(contractFieldNames) as ContractExtraction["contract"],
    conflicts: [],
    warnings: extractionFieldNames.length ? ["Merged with the previous extraction during delta processing."] : [],
  };
}

export type ExtractionFieldRecord = {
  id: string;
  field_name: string;
  structured_value: Record<string, unknown> | null;
  raw_value: string | null;
  source_type: string | null;
  source_id: string | null;
  source_marker: string | null;
  source_excerpt: string | null;
  confidence: number | null;
  requires_review: boolean;
  manually_corrected: boolean;
  correction_reason: string | null;
  conflict_detected: boolean;
  extraction_run_id: string | null;
  updated_at: string;
  accepted?: boolean;
};

export async function getApplicationExtraction(applicationId: string) {
  const { supabase, profile } = await getOperationalContext();
  const [fields, runs, conflicts, corrections, documentSources, acceptances, application] =
    await Promise.all([
    supabase
      .from("extracted_fields")
      .select(
        "id,field_name,structured_value,raw_value,source_type,source_id,source_marker,source_excerpt,confidence,requires_review,manually_corrected,correction_reason,conflict_detected,extraction_run_id,updated_at",
      )
      .eq("application_id", applicationId)
      .order("field_name"),
    supabase
      .from("extraction_runs")
      .select(
        "id,status,provider,model,prompt_version,schema_version,request_id,input_character_count,input_token_count,output_token_count,duration_ms,conflict_count,safe_error_code,safe_error_message,force_requested,started_at,completed_at",
      )
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("extraction_conflicts")
      .select("id,extraction_run_id,field_name,candidates,sources,conflict_type,requires_review,resolved_at,created_at")
      .eq("application_id", applicationId)
      .eq("requires_review", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("extracted_field_corrections")
      .select(
        "id,extracted_field_id,previous_structured_value,corrected_structured_value,reason,correction_action,created_at,corrector:profiles!extracted_field_corrections_corrected_by_fkey(full_name,email)",
      )
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("parsed_documents")
      .select("id,attachment_id")
      .eq("application_id", applicationId),
    supabase
      .from("extracted_field_acceptances")
      .select("extracted_field_id,value_fingerprint,acceptance_method,created_at")
      .eq("application_id", applicationId),
    supabase
      .from("applications")
      .select("contract_template_id")
      .eq("id", applicationId)
      .single(),
  ]);
  const error =
    fields.error ??
    runs.error ??
    conflicts.error ??
    corrections.error ??
    documentSources.error ??
    acceptances.error ??
    application.error;
  if (error) throw new Error(`Unable to load extracted data: ${error.message}`);
  let ruleSetId = "standard-contract";
  if (application.data?.contract_template_id) {
    const template = await supabase
      .from("contract_templates")
      .select("required_rule_set")
      .eq("id", application.data.contract_template_id)
      .maybeSingle();
    if (template.error) throw new Error(`Unable to load template rules: ${template.error.message}`);
    ruleSetId = template.data?.required_rule_set || ruleSetId;
  }
  const requiredFieldNames = new Set(
    getRuleSet(ruleSetId).rules.filter((rule) => rule.required).map((rule) => rule.fieldName),
  );
  const fieldRows = (fields.data ?? []) as unknown as ExtractionFieldRecord[];
  const accepted = new Set(
    (acceptances.data ?? []).map((item) =>
      `${item.extracted_field_id}:${item.value_fingerprint}`),
  );
  const decoratedFields = fieldRows.map((field) => ({
    ...field,
    accepted: accepted.has(
      `${field.id}:${fieldValueFingerprint(field as AcceptanceField)}`,
    ),
  }));
  const acceptancePreview = previewSafeAcceptance(
    decoratedFields as AcceptanceField[],
    (conflicts.data ?? []) as Array<{
      field_name: string;
      candidates: unknown;
      requires_review: boolean;
    }>,
    requiredFieldNames,
  );
  return {
    fields: decoratedFields,
    runs: runs.data ?? [],
    conflicts: conflicts.data ?? [],
    corrections: corrections.data ?? [],
    acceptances: acceptances.data ?? [],
    acceptancePreview,
    requiredFieldNames: [...requiredFieldNames],
    documentSources: Object.fromEntries(
      (documentSources.data ?? []).map((source) => [source.id, source.attachment_id]),
    ) as Record<string, string>,
    isAdmin: profile.role === "admin",
  };
}

export async function correctExtractedField(input: {
  applicationId: string;
  fieldName: string;
  value: string | number | null;
  reason: string;
  action: "corrected" | "candidate_selected" | "manual_null_set";
  sourceType?: string;
  sourceId?: string | null;
  sourceMarker?: string | null;
  sourceExcerpt?: string | null;
}) {
  const { supabase } = await getOperationalContext();
  const structured =
    input.value === null
      ? {
          value: null,
          normalizedValue: null,
          rawValue: null,
          sourceType: "manual",
          sourceId: null,
          sourceMarker: null,
          sourceExcerpt: null,
          confidence: 1,
          requiresReview: false,
          reason: "NOT_FOUND",
        }
      : {
          value: input.value,
          normalizedValue: input.value,
          rawValue: String(input.value),
          sourceType: input.sourceType ?? "manual",
          sourceId: input.sourceId ?? null,
          sourceMarker: input.sourceMarker ?? "[MANUAL CORRECTION]",
          sourceExcerpt: input.sourceExcerpt ?? null,
          confidence: 1,
          requiresReview: false,
          reason: "DIRECT_SOURCE",
        };
  const { data, error } = await supabase.rpc("correct_extracted_field", {
    p_application_id: input.applicationId,
    p_field_name: input.fieldName,
    p_structured_value: structured,
    p_raw_value: input.value === null ? null : String(input.value),
    p_reason: input.reason,
    p_action: input.action,
    p_source_type: input.sourceType ?? "manual",
    p_source_id: input.sourceId ?? null,
    p_source_marker: input.sourceMarker ?? "[MANUAL CORRECTION]",
    p_source_excerpt: input.sourceExcerpt ?? null,
  });
  if (error) throw new Error(`Unable to correct extracted field: ${error.message}`);
  if (
    input.fieldName === "signer_authority" ||
    input.fieldName === "authority_document" ||
    input.fieldName === "authority_number" ||
    input.fieldName === "authority_date"
  ) {
    await syncDerivedFieldRules({
      applicationId: input.applicationId,
      admin: createAdminClient(),
    });
  }
  return data as string;
}
