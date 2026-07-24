"use server";

import { redirect } from "next/navigation";

import { parseRegistryFilters } from "@/modules/reports/domain";
import { generateReport } from "@/modules/reports/service";

export async function generateReportAction(formData: FormData) {
  const filters = parseRegistryFilters(Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string"),
  ) as Record<string, string>);
  const force = formData.get("force") === "true";
  const forceReason = String(formData.get("forceReason") ?? "").trim();
  let result: Awaited<ReturnType<typeof generateReport>>;
  try {
    result = await generateReport({ filters, force, forceReason });
  } catch {
    redirect(`/reports?error=report-failed&dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}`);
  }
  redirect(`/reports?success=${result.cacheHit ? "cache-hit" : "generated"}&report=${result.reportId}&dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}`);
}
