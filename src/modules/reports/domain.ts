import { createHash } from "node:crypto";

import { z } from "zod";

export const REPORT_SCHEMA_VERSION = "contract-report-v1";
export const REPORT_BUCKET = "report-exports";

export const registrySortFields = [
  "received_at",
  "contract_amount",
  "contract_number",
  "counterparty_name",
  "application_status",
] as const;

const optionalText = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
  z.string().max(200).optional(),
);
const optionalDate = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
);

export const registryFiltersSchema = z.object({
  dateFrom: optionalDate,
  dateTo: optionalDate,
  applicationNumber: optionalText,
  contractNumber: optionalText,
  counterparty: optionalText,
  inn: optionalText,
  applicationStatus: optionalText,
  contractStatus: optionalText,
  assignedTo: z.preprocess(
    (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
    z.string().uuid().optional(),
  ),
  templateType: optionalText,
  currency: z.preprocess(
    (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
    z.string().regex(/^[A-Z]{3}$/u).optional(),
  ),
  conflicts: z.enum(["any", "yes", "no"]).default("any"),
  sent: z.enum(["any", "sent", "unsent"]).default("any"),
  sort: z.enum(registrySortFields).default("received_at"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
}).superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateTo < value.dateFrom) {
    context.addIssue({
      code: "custom",
      path: ["dateTo"],
      message: "End date cannot be before start date.",
    });
  }
});

export type RegistryFilters = z.infer<typeof registryFiltersSchema>;

export type RegistryRow = {
  application_id: string;
  application_number: string;
  application_title: string;
  received_at: string;
  application_status: string;
  assigned_to: string | null;
  application_created_by: string | null;
  contract_subject: string | null;
  contract_amount: number | null;
  currency: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  inn: string | null;
  bank_account: string | null;
  specialist_name: string | null;
  specialist_email: string | null;
  contract_id: string | null;
  contract_number: string | null;
  contract_status: string | null;
  approved_at: string | null;
  sent_at: string | null;
  current_version_id: string | null;
  version_number: number | null;
  generated_at: string | null;
  contract_date: string | null;
  generated_filename: string | null;
  version_checksum: string | null;
  template_id: string | null;
  template_name: string | null;
  template_version: string | null;
  template_type: string | null;
  completeness_percentage: number;
  completeness_ready: boolean;
  has_conflicts: boolean;
  correspondence_count: number;
};

export type RegistryTotals = {
  applicationCount: number;
  contractCount: number;
  approvedContractCount: number;
  unpreparedApplicationCount: number;
  conflictApplicationCount: number;
  amountsByCurrency: Record<string, number>;
  averageDeliveryHours: number | null;
};

export type MonthlyMetrics = {
  newApplications: number;
  processedApplications: number;
  completedContracts: number;
  sentContracts: number;
  waitingForClient: number;
  manualReview: number;
  rejectedContracts: number;
  clarificationEmails: number;
  repeatedClarifications: number;
  averageProcessingHours: number | null;
  amountsByCurrency: Record<string, number>;
  contractsByTemplateType: Record<string, number>;
  workBySpecialist: Record<string, number>;
};

export function parseRegistryFilters(
  input: Record<string, string | string[] | undefined>,
  now = new Date(),
) {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
  return registryFiltersSchema.parse({
    dateFrom: first(input.dateFrom) ?? monthStart,
    dateTo: first(input.dateTo) ?? monthEnd,
    applicationNumber: first(input.applicationNumber),
    contractNumber: first(input.contractNumber),
    counterparty: first(input.counterparty),
    inn: first(input.inn),
    applicationStatus: first(input.applicationStatus),
    contractStatus: first(input.contractStatus),
    assignedTo: first(input.assignedTo),
    templateType: first(input.templateType),
    currency: first(input.currency),
    conflicts: first(input.conflicts),
    sent: first(input.sent),
    sort: first(input.sort),
    direction: first(input.direction),
    page: first(input.page),
    pageSize: first(input.pageSize),
  });
}

export function safeFilterSummary(filters: RegistryFilters) {
  return {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    application_number_filter: Boolean(filters.applicationNumber),
    contract_number_filter: Boolean(filters.contractNumber),
    counterparty_filter: Boolean(filters.counterparty),
    inn_filter: Boolean(filters.inn),
    application_status: filters.applicationStatus ?? null,
    contract_status: filters.contractStatus ?? null,
    assigned_to_filter: Boolean(filters.assignedTo),
    template_type: filters.templateType ?? null,
    currency: filters.currency ?? null,
    conflicts: filters.conflicts,
    sent: filters.sent,
    sort: filters.sort,
    direction: filters.direction,
  };
}

export function aggregateRegistryRows(rows: RegistryRow[]): RegistryTotals {
  const applications = new Set(rows.map((row) => row.application_id));
  const contracts = new Set(
    rows.flatMap((row) => row.contract_id ? [row.contract_id] : []),
  );
  const approved = new Set(
    rows.flatMap((row) =>
      row.contract_id && ["approved", "delivered", "sent"].includes(row.contract_status ?? "")
        ? [row.contract_id]
        : []),
  );
  const unprepared = new Set(
    rows.flatMap((row) => row.contract_id ? [] : [row.application_id]),
  );
  const conflicts = new Set(
    rows.flatMap((row) => row.has_conflicts ? [row.application_id] : []),
  );
  const amountsByCurrency: Record<string, number> = {};
  const deliveryHours: number[] = [];
  for (const row of rows) {
    if (row.contract_amount !== null && row.currency) {
      amountsByCurrency[row.currency] =
        (amountsByCurrency[row.currency] ?? 0) + Number(row.contract_amount);
    }
    if (row.sent_at) {
      const duration =
        (new Date(row.sent_at).getTime() - new Date(row.received_at).getTime()) /
        3_600_000;
      if (Number.isFinite(duration) && duration >= 0) deliveryHours.push(duration);
    }
  }
  return {
    applicationCount: applications.size,
    contractCount: contracts.size,
    approvedContractCount: approved.size,
    unpreparedApplicationCount: unprepared.size,
    conflictApplicationCount: conflicts.size,
    amountsByCurrency: Object.fromEntries(
      Object.entries(amountsByCurrency).sort(([a], [b]) => a.localeCompare(b)),
    ),
    averageDeliveryHours: deliveryHours.length
      ? deliveryHours.reduce((sum, value) => sum + value, 0) / deliveryHours.length
      : null,
  };
}

export function stableFingerprint(value: unknown) {
  const stable = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, nested]) => [key, stable(nested)]),
      );
    }
    return item;
  };
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function reportCacheKey(input: {
  actorId: string;
  reportType: "registry" | "monthly";
  filters: RegistryFilters;
  dataFingerprint: string;
}) {
  return stableFingerprint({
    actor_id: input.actorId,
    report_type: input.reportType,
    report_schema_version: REPORT_SCHEMA_VERSION,
    filters: safeFilterSummary(input.filters),
    data_fingerprint: input.dataFingerprint,
  });
}

export function excelSafeText(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!value) return "";
  return /^[=+\-@]/u.test(value) ? `'${value}` : value;
}
