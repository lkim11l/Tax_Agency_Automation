import { createHash } from "node:crypto";

import {
  REPORT_BUCKET,
  REPORT_SCHEMA_VERSION,
  aggregateRegistryRows,
  reportCacheKey,
  safeFilterSummary,
  stableFingerprint,
  type RegistryFilters,
} from "./domain";
import {
  calculateMonthlyMetrics,
  loadAllRegistryRows,
  reportExecution,
  type ReportExecution,
  type ReportExportRecord,
} from "./repository";
import { serializeContractReport, verifyContractReport } from "./xlsx";

type Claim = { claimed: boolean; cache_hit: boolean; report_id: string };

function reportFilename(filters: RegistryFilters) {
  return `contract-report-${filters.dateFrom}-${filters.dateTo}.xlsx`;
}

export async function generateReport(input: {
  filters: RegistryFilters;
  reportType?: "registry" | "monthly";
  force?: boolean;
  forceReason?: string | null;
}, execution?: ReportExecution) {
  const context = await reportExecution(execution);
  if (input.force && context.role !== "admin") {
    throw new Error("Administrator access is required for forced regeneration.");
  }
  const { rows } = await loadAllRegistryRows(input.filters, context);
  const totals = aggregateRegistryRows(rows);
  const metrics = await calculateMonthlyMetrics(rows, context);
  const dataFingerprint = stableFingerprint({ rows, totals, metrics });
  const reportType = input.reportType ?? "monthly";
  const cacheKey = reportCacheKey({
    actorId: context.actorId,
    reportType,
    filters: input.filters,
    dataFingerprint,
  });
  const claimResult = await context.admin.rpc("claim_report_export", {
    p_actor_id: context.actorId,
    p_report_type: reportType,
    p_period_start: input.filters.dateFrom,
    p_period_end: input.filters.dateTo,
    p_filters: safeFilterSummary(input.filters),
    p_report_schema_version: REPORT_SCHEMA_VERSION,
    p_data_fingerprint: dataFingerprint,
    p_cache_key: cacheKey,
    p_force: input.force ?? false,
    p_force_reason: input.forceReason ?? null,
  });
  if (claimResult.error || !claimResult.data) {
    throw new Error(`Unable to claim report generation: ${claimResult.error?.message ?? "unknown error"}`);
  }
  const claim = claimResult.data as Claim;
  if (claim.cache_hit) return { reportId: claim.report_id, cacheHit: true as const };
  if (!claim.claimed) throw new Error("Report generation is already running.");

  let storagePath: string | null = null;
  try {
    const generatedAt = new Date();
    const content = await serializeContractReport({
      rows,
      totals,
      metrics,
      filters: input.filters,
      generatedBy: context.actorId,
      generatedAt,
      fingerprint: dataFingerprint,
    });
    const workbookCheck = await verifyContractReport(content);
    if (workbookCheck.contractRows !== rows.length) throw new Error("REPORT_ROW_COUNT_MISMATCH");
    const checksum = createHash("sha256").update(content).digest("hex");
    const filename = reportFilename(input.filters);
    storagePath = `${context.actorId}/${claim.report_id}/${filename}`;
    const uploaded = await context.admin.storage.from(REPORT_BUCKET).upload(storagePath, content, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
    if (uploaded.error) throw new Error(`REPORT_STORAGE_UPLOAD_FAILED:${uploaded.error.message}`);
    const finalized = await context.admin.rpc("finalize_report_export", {
      p_report_id: claim.report_id,
      p_actor_id: context.actorId,
      p_row_count: rows.length,
      p_checksum: checksum,
      p_storage_path: storagePath,
      p_filename: filename,
      p_file_size: content.length,
    });
    if (finalized.error) throw new Error(`REPORT_FINALIZE_FAILED:${finalized.error.message}`);
    return { reportId: claim.report_id, cacheHit: false as const, checksum, rows: rows.length };
  } catch (error) {
    if (storagePath) await context.admin.storage.from(REPORT_BUCKET).remove([storagePath]);
    await context.admin.rpc("fail_report_export", {
      p_report_id: claim.report_id,
      p_actor_id: context.actorId,
      p_error_code: error instanceof Error ? error.message.split(":")[0].slice(0, 100) : "REPORT_FAILED",
      p_error_message: "Report generation failed. Review server logs.",
    });
    throw error;
  }
}

export async function getReportForDownload(
  reportId: string,
  execution?: ReportExecution,
) {
  const context = await reportExecution(execution);
  const result = await context.admin
    .from("report_exports")
    .select("*")
    .eq("id", reportId)
    .eq("status", "completed")
    .maybeSingle();
  const report = result.data as ReportExportRecord | null;
  if (result.error || !report || (!report.storage_path) ||
      (context.role !== "admin" && report.generated_by !== context.actorId)) {
    throw new Error("Report is not available.");
  }
  const audit = await context.admin.rpc("record_report_download", {
    p_report_id: reportId,
    p_actor_id: context.actorId,
  });
  if (audit.error) throw new Error("Unable to audit report download.");
  const signed = await context.admin.storage
    .from(REPORT_BUCKET)
    .createSignedUrl(report.storage_path, 60);
  if (signed.error || !signed.data) throw new Error("Unable to create report download link.");
  return { report, signedUrl: signed.data.signedUrl };
}
