"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getOperationalContext } from "@/lib/auth/context";

import { runExtraction, runPendingExtractions } from "./orchestrator";
import { correctExtractedField } from "./repository";

function target(applicationId: string, type: "error" | "success", message: string) {
  return `/applications/${applicationId}?${type}=${encodeURIComponent(message)}`;
}

export async function runExtractionAction(formData: FormData) {
  const parsed = z
    .object({
      applicationId: z.string().uuid(),
      force: z.enum(["0", "1"]).default("0"),
    })
    .safeParse({
      applicationId: formData.get("application_id"),
      force: formData.get("force") ?? "0",
    });
  if (!parsed.success) redirect("/applications?error=Invalid extraction request.");
  let result;
  try {
    const context = await getOperationalContext();
    if (parsed.data.force === "1" && context.profile.role !== "admin") {
      throw new Error("Administrator access is required for force extraction.");
    }
    result = await runExtraction({
      applicationId: parsed.data.applicationId,
      initiatedBy: context.profile.id,
      force: parsed.data.force === "1",
    });
    revalidatePath(`/applications/${parsed.data.applicationId}`);
  } catch (error) {
    redirect(
      target(
        parsed.data.applicationId,
        "error",
        error instanceof Error ? error.message : "Extraction failed.",
      ),
    );
  }
  redirect(
    target(
      parsed.data.applicationId,
      result.status === "failed" ? "error" : "success",
      result.status === "cache_hit"
        ? "Extraction cache hit; no API tokens were spent."
        : `Extraction status: ${result.status}.`,
    ),
  );
}

export async function runPendingExtractionsAction(formData: FormData) {
  const applicationId = z.string().uuid().safeParse(formData.get("application_id"));
  if (!applicationId.success) redirect("/applications?error=Invalid application.");
  let count = 0;
  try {
    const context = await getOperationalContext();
    if (context.profile.role !== "admin") {
      throw new Error("Administrator access is required for batch extraction.");
    }
    count = (await runPendingExtractions(100, context.profile.id)).length;
    revalidatePath(`/applications/${applicationId.data}`);
  } catch (error) {
    redirect(
      target(
        applicationId.data,
        "error",
        error instanceof Error ? error.message : "Batch extraction failed.",
      ),
    );
  }
  redirect(target(applicationId.data, "success", `Processed ${count} application(s).`));
}

export async function correctExtractedFieldAction(formData: FormData) {
  const parsed = z
    .object({
      applicationId: z.string().uuid(),
      fieldName: z.string().min(1).max(100),
      value: z.string().max(10_000),
      reason: z.string().trim().min(2).max(1000),
      action: z.enum(["corrected", "candidate_selected", "manual_null_set"]),
      sourceType: z.string().max(100).optional(),
      sourceId: z.string().uuid().optional().or(z.literal("")),
      sourceMarker: z.string().max(300).optional(),
      sourceExcerpt: z.string().max(500).optional(),
    })
    .safeParse({
      applicationId: formData.get("application_id"),
      fieldName: formData.get("field_name"),
      value: formData.get("value") ?? "",
      reason: formData.get("reason"),
      action: formData.get("action") ?? "corrected",
      sourceType: formData.get("source_type") || undefined,
      sourceId: formData.get("source_id") || undefined,
      sourceMarker: formData.get("source_marker") || undefined,
      sourceExcerpt: formData.get("source_excerpt") || undefined,
    });
  if (!parsed.success) redirect("/applications?error=Invalid correction.");
  try {
    await correctExtractedField({
      applicationId: parsed.data.applicationId,
      fieldName: parsed.data.fieldName,
      value: parsed.data.action === "manual_null_set" ? null : parsed.data.value,
      reason: parsed.data.reason,
      action: parsed.data.action,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId || null,
      sourceMarker: parsed.data.sourceMarker,
      sourceExcerpt: parsed.data.sourceExcerpt,
    });
    revalidatePath(`/applications/${parsed.data.applicationId}`);
  } catch (error) {
    redirect(
      target(
        parsed.data.applicationId,
        "error",
        error instanceof Error ? error.message : "Correction failed.",
      ),
    );
  }
  redirect(target(parsed.data.applicationId, "success", "Extracted field updated."));
}
