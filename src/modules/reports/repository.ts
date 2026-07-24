import type { SupabaseClient } from "@supabase/supabase-js";

import { getOperationalContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin.server";
import { sanitizePostgrestSearchTerm } from "@/lib/supabase/filter";

import {
  aggregateRegistryRows,
  safeFilterSummary,
  type MonthlyMetrics,
  type RegistryFilters,
  type RegistryRow,
} from "./domain";

export type ReportExecution = {
  actorId: string;
  role: "admin" | "specialist";
  admin: SupabaseClient;
};

export type ReportExportRecord = {
  id: string;
  report_type: "registry" | "monthly";
  period_start: string;
  period_end: string;
  row_count: number;
  generated_at: string | null;
  generated_by: string;
  checksum: string | null;
  storage_path: string | null;
  filename: string | null;
  file_size: number | null;
  status: "processing" | "completed" | "failed";
  force_requested: boolean;
  safe_error_code: string | null;
  created_at: string;
};

export async function reportExecution(execution?: ReportExecution) {
  if (execution) return execution;
  const { profile } = await getOperationalContext();
  return { actorId: profile.id, role: profile.role, admin: createAdminClient() };
}

function registryQuery(
  admin: SupabaseClient,
  execution: Pick<ReportExecution, "actorId" | "role">,
  filters: RegistryFilters,
  count: boolean,
) {
  let query = admin
    .from("contract_registry_entries")
    .select("*", count ? { count: "exact" } : undefined);

  if (execution.role !== "admin") {
    query = query.or(
      `assigned_to.eq.${execution.actorId},application_created_by.eq.${execution.actorId}`,
    );
  }
  if (filters.dateFrom) {
    query = query.gte("received_at", `${filters.dateFrom}T00:00:00.000Z`);
  }
  if (filters.dateTo) {
    query = query.lte("received_at", `${filters.dateTo}T23:59:59.999Z`);
  }
  const textFilters: Array<[keyof RegistryFilters, string]> = [
    ["applicationNumber", "application_number"],
    ["contractNumber", "contract_number"],
    ["counterparty", "counterparty_name"],
    ["inn", "inn"],
  ];
  for (const [filterKey, column] of textFilters) {
    const value = filters[filterKey];
    if (typeof value === "string" && value) {
      const term = sanitizePostgrestSearchTerm(value);
      query = term ? query.ilike(column, `%${term}%`) : query.eq("application_number", "__no_match__");
    }
  }
  if (filters.applicationStatus) query = query.eq("application_status", filters.applicationStatus);
  if (filters.contractStatus) query = query.eq("contract_status", filters.contractStatus);
  if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);
  if (filters.templateType) query = query.eq("template_type", filters.templateType);
  if (filters.currency) query = query.eq("currency", filters.currency);
  if (filters.conflicts !== "any") query = query.eq("has_conflicts", filters.conflicts === "yes");
  if (filters.sent === "sent") query = query.not("sent_at", "is", null);
  if (filters.sent === "unsent") query = query.is("sent_at", null);
  return query;
}

export async function loadAllRegistryRows(
  filters: RegistryFilters,
  execution?: ReportExecution,
) {
  const context = await reportExecution(execution);
  const rows: RegistryRow[] = [];
  const batchSize = 1000;
  for (let start = 0; ; start += batchSize) {
    const result = await registryQuery(context.admin, context, filters, false)
      .order(filters.sort, { ascending: filters.direction === "asc", nullsFirst: false })
      .order("application_id", { ascending: true })
      .range(start, start + batchSize - 1);
    if (result.error) throw new Error(`Unable to load contract registry: ${result.error.message}`);
    const batch = (result.data ?? []) as RegistryRow[];
    rows.push(...batch);
    if (batch.length < batchSize) break;
  }
  return { rows, context };
}

export async function listRegistry(
  filters: RegistryFilters,
  execution?: ReportExecution,
) {
  const context = await reportExecution(execution);
  const start = (filters.page - 1) * filters.pageSize;
  const [pageResult, all] = await Promise.all([
    registryQuery(context.admin, context, filters, true)
      .order(filters.sort, { ascending: filters.direction === "asc", nullsFirst: false })
      .order("application_id", { ascending: true })
      .range(start, start + filters.pageSize - 1),
    loadAllRegistryRows(filters, context),
  ]);
  if (pageResult.error) throw new Error(`Unable to load contract registry: ${pageResult.error.message}`);
  const count = pageResult.count ?? 0;
  const filtered = Object.values(safeFilterSummary(filters)).some((value) =>
    typeof value === "boolean" ? value : value !== null && value !== "any" && value !== "received_at" && value !== "desc",
  );
  const audit = await context.admin.rpc("record_registry_access", {
    p_actor_id: context.actorId,
    p_filtered: filtered,
    p_period_start: filters.dateFrom,
    p_period_end: filters.dateTo,
    p_filter_summary: safeFilterSummary(filters),
    p_row_count: count,
  });
  if (audit.error) throw new Error(`Unable to audit registry access: ${audit.error.message}`);
  return {
    rows: (pageResult.data ?? []) as RegistryRow[],
    count,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.max(1, Math.ceil(count / filters.pageSize)),
    totals: aggregateRegistryRows(all.rows),
  };
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

export async function calculateMonthlyMetrics(
  rows: RegistryRow[],
  execution?: ReportExecution,
): Promise<MonthlyMetrics> {
  const context = await reportExecution(execution);
  const unique = [...new Map(rows.map((row) => [row.application_id, row])).values()];
  const ids = unique.map((row) => row.application_id);
  const [reviews, clarifications] = ids.length
    ? await Promise.all([
        context.admin
          .from("contract_version_reviews")
          .select("application_id,decision,reviewed_at")
          .in("application_id", ids)
          .eq("decision", "rejected"),
        context.admin
          .from("clarification_drafts")
          .select("application_id,version,sent_at")
          .in("application_id", ids)
          .not("sent_at", "is", null),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const metricError = reviews.error ?? clarifications.error;
  if (metricError) throw new Error(`Unable to calculate report metrics: ${metricError.message}`);

  const amountsByCurrency: Record<string, number> = {};
  const contractsByTemplateType: Record<string, number> = {};
  const workBySpecialist: Record<string, number> = {};
  const durations: number[] = [];
  for (const row of unique) {
    if (row.contract_amount !== null && row.currency) {
      amountsByCurrency[row.currency] = (amountsByCurrency[row.currency] ?? 0) + Number(row.contract_amount);
    }
    if (row.contract_id && row.template_type) increment(contractsByTemplateType, row.template_type);
    increment(workBySpecialist, row.specialist_name ?? row.specialist_email ?? "Unassigned");
    if (row.sent_at) {
      const hours = (new Date(row.sent_at).getTime() - new Date(row.received_at).getTime()) / 3_600_000;
      if (hours >= 0 && Number.isFinite(hours)) durations.push(hours);
    }
  }
  return {
    newApplications: unique.length,
    processedApplications: unique.filter((row) => !["new", "processing"].includes(row.application_status)).length,
    completedContracts: unique.filter((row) => ["approved", "delivered", "sent"].includes(row.contract_status ?? "")).length,
    sentContracts: unique.filter((row) => Boolean(row.sent_at)).length,
    waitingForClient: unique.filter((row) => row.application_status === "waiting_for_client").length,
    manualReview: unique.filter((row) =>
      ["needs_data_review", "under_review", "contract_revision_required"].includes(row.application_status),
    ).length,
    rejectedContracts: new Set((reviews.data ?? []).map((row) => row.application_id)).size,
    clarificationEmails: (clarifications.data ?? []).length,
    repeatedClarifications: (clarifications.data ?? []).filter((row) => row.version > 1).length,
    averageProcessingHours: durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : null,
    amountsByCurrency,
    contractsByTemplateType,
    workBySpecialist,
  };
}

export async function listReportExports(execution?: ReportExecution) {
  const context = await reportExecution(execution);
  let query = context.admin.from("report_exports").select(
    "id,report_type,period_start,period_end,row_count,generated_at,generated_by,checksum,storage_path,filename,file_size,status,force_requested,safe_error_code,created_at",
  );
  if (context.role !== "admin") query = query.eq("generated_by", context.actorId);
  const result = await query.order("created_at", { ascending: false }).limit(50);
  if (result.error) throw new Error(`Unable to load report history: ${result.error.message}`);
  return (result.data ?? []) as ReportExportRecord[];
}
