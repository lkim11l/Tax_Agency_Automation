import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { aggregateRegistryRows, parseRegistryFilters } from "../src/modules/reports/domain";
import { listRegistry, loadAllRegistryRows, type ReportExecution } from "../src/modules/reports/repository";
import { generateReport } from "../src/modules/reports/service";
import { verifyContractReport } from "../src/modules/reports/xlsx";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing live variable: ${name}`);
  return value;
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
const url = required("NEXT_PUBLIC_SUPABASE_URL");
const secret = process.env.SUPABASE_SECRET_KEY?.trim() || required("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const profiles = await admin.from("profiles").select("id,email,role,is_active")
  .in("email", [required("SUPABASE_TEST_ADMIN_EMAIL"), required("SUPABASE_TEST_SPECIALIST_EMAIL")]);
assert(!profiles.error, `Unable to load live actors: ${profiles.error?.message}`);
const adminProfile = profiles.data?.find((item) => item.role === "admin" && item.is_active);
const specialistProfile = profiles.data?.find((item) => item.role === "specialist" && item.is_active);
assert(adminProfile && specialistProfile, "Active admin and specialist profiles are required.");
const adminExecution: ReportExecution = { actorId: adminProfile.id, role: "admin", admin };
const specialistExecution: ReportExecution = { actorId: specialistProfile.id, role: "specialist", admin };
const filters = parseRegistryFilters({
  dateFrom: "2026-07-01", dateTo: "2026-07-31", page: "1", pageSize: "10",
  sort: "received_at", direction: "desc",
});

const allAdmin = await loadAllRegistryRows(filters, adminExecution);
assert(allAdmin.rows.length > 0, "Hosted Phase 8 acceptance requires existing July synthetic applications.");
const page = await listRegistry(filters, adminExecution);
assert(page.rows.length <= 10 && page.count === allAdmin.rows.length, "Server pagination count mismatch.");
assert(JSON.stringify(page.totals) === JSON.stringify(aggregateRegistryRows(allAdmin.rows)), "Registry totals mismatch.");
const sentOnly = await loadAllRegistryRows({ ...filters, sent: "sent" }, adminExecution);
assert(sentOnly.rows.every((row) => row.sent_at), "Delivery filter leaked unsent rows.");
const specialistFilters = parseRegistryFilters({
  dateFrom: "2020-01-01", dateTo: "2030-12-31", page: "1", pageSize: "10",
});
let specialistRows = await loadAllRegistryRows(specialistFilters, specialistExecution);
let temporaryAssignment: { id: string; assignedTo: string | null } | null = null;
if (specialistRows.rows.length === 0) {
  const candidate = allAdmin.rows.find((row) => /phase|live|taa/iu.test(row.application_title));
  assert(candidate, "No explicitly synthetic application is available for specialist scope acceptance.");
  temporaryAssignment = { id: candidate.application_id, assignedTo: candidate.assigned_to };
  const assigned = await admin.from("applications").update({ assigned_to: specialistProfile.id })
    .eq("id", candidate.application_id);
  assert(!assigned.error, "Unable to create a temporary specialist scope fixture.");
  specialistRows = await loadAllRegistryRows(specialistFilters, specialistExecution);
}
let specialistReport: Awaited<ReturnType<typeof generateReport>>;
try {
  assert(specialistRows.rows.length > 0, "Specialist scope returned no synthetic rows.");
  assert(specialistRows.rows.every((row) =>
    row.assigned_to === specialistProfile.id || row.application_created_by === specialistProfile.id
  ), "Specialist registry scope leaked an unrelated application.");
  specialistReport = await generateReport({ filters: specialistFilters }, specialistExecution);
  assert(specialistReport.reportId, "Specialist-scoped report was not generated.");
} finally {
  if (temporaryAssignment) {
    const restored = await admin.from("applications")
      .update({ assigned_to: temporaryAssignment.assignedTo })
      .eq("id", temporaryAssignment.id);
    assert(!restored.error, "Temporary specialist assignment could not be restored.");
  }
}

const first = await generateReport({ filters }, adminExecution);
const second = await generateReport({ filters }, adminExecution);
assert(second.cacheHit && second.reportId === first.reportId, "Identical report was not cached.");
const forced = await generateReport({
  filters, force: true, forceReason: "Phase 8 hosted acceptance",
}, adminExecution);
assert(!forced.cacheHit && forced.reportId !== first.reportId, "Admin force regeneration did not create a new artifact.");
const report = await admin.from("report_exports").select("*").eq("id", forced.reportId).single();
assert(!report.error && report.data?.status === "completed" && report.data.storage_path, "Forced report was not persisted.");
assert(report.data.row_count === allAdmin.rows.length, "Persisted report row count differs from registry.");
const download = await admin.storage.from("report-exports").download(report.data.storage_path);
assert(!download.error && download.data, "Private report artifact could not be downloaded by the service.");
const content = Buffer.from(await download.data.arrayBuffer());
assert(createHash("sha256").update(content).digest("hex") === report.data.checksum, "Report checksum mismatch.");
const workbook = await verifyContractReport(content);
assert(workbook.contractRows === allAdmin.rows.length, "XLSX registry row count mismatch.");
const outputPath = join(process.env.TEMP ?? process.cwd(), "tax-agency-phase8-live.xlsx");
await writeFile(outputPath, content);

const immutable = await admin.from("report_exports").update({ row_count: 999 }).eq("id", forced.reportId);
assert(immutable.error, "Completed report metadata was mutable.");
const audits = await admin.from("audit_events").select("action,metadata").in("action", [
  "registry.viewed", "registry.filtered", "report.generated", "report.cache_hit",
  "report.force_regenerated",
]).order("created_at", { ascending: false }).limit(30);
assert(!audits.error, "Unable to inspect Phase 8 audit events.");
const actions = new Set((audits.data ?? []).map((item) => item.action));
for (const action of ["report.generated", "report.cache_hit", "report.force_regenerated"]) {
  assert(actions.has(action), `Missing live audit event: ${action}`);
}
assert(!JSON.stringify(audits.data).match(/bank_account|counterparty_name|application_number_filter":"[^bf]/iu),
  "Sensitive report values appeared in audit metadata.");

console.log(JSON.stringify({
  status: "ok",
  adminRows: allAdmin.rows.length,
  specialistRows: specialistRows.rows.length,
  cachedReportId: first.reportId,
  forcedReportId: forced.reportId,
  specialistReportId: specialistReport.reportId,
  checksum: report.data.checksum,
  workbook,
  outputPath,
}, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 8 live acceptance failed.");
  process.exitCode = 1;
});
