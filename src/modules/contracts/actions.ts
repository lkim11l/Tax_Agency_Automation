"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { checkContractEligibility, generateContract } from "./service";

function target(id: string, type: "error" | "success", message: string) {
  return `/applications/${id}?${type}=${encodeURIComponent(message)}`;
}

const requestSchema = z.object({
  applicationId: z.string().uuid(),
  templateId: z.string().uuid(),
  force: z.enum(["0", "1"]).default("0"),
  forceReason: z.string().trim().max(1000).optional(),
});

export async function checkContractEligibilityAction(formData: FormData) {
  const parsed = requestSchema.safeParse({
    applicationId: formData.get("application_id"),
    templateId: formData.get("template_id"),
    force: "0",
  });
  if (!parsed.success) redirect("/applications?error=Invalid eligibility request.");
  let destination: string;
  try {
    const result = await checkContractEligibility(parsed.data.applicationId, parsed.data.templateId);
    destination = target(
      parsed.data.applicationId,
      result.ready ? "success" : "error",
      result.ready
        ? "Application is ready for contract generation."
        : `Blocked: ${result.blockingReasons.join(", ")}`,
    );
  } catch (error) {
    destination = target(
      parsed.data.applicationId,
      "error",
      error instanceof Error ? error.message : "Eligibility check failed.",
    );
  }
  redirect(destination);
}

export async function generateContractAction(formData: FormData) {
  const parsed = requestSchema.safeParse({
    applicationId: formData.get("application_id"),
    templateId: formData.get("template_id"),
    force: formData.get("force") ?? "0",
    forceReason: formData.get("force_reason") || undefined,
  });
  if (!parsed.success || (parsed.data.force === "1" && (parsed.data.forceReason?.length ?? 0) < 2)) {
    redirect("/applications?error=Invalid generation request.");
  }
  let destination: string;
  try {
    const result = await generateContract({
      applicationId: parsed.data.applicationId,
      templateId: parsed.data.templateId,
      force: parsed.data.force === "1",
      forceReason: parsed.data.forceReason,
    });
    revalidatePath(`/applications/${parsed.data.applicationId}`);
    destination = target(
      parsed.data.applicationId,
      "success",
      result.cacheHit
        ? "Generation cache hit; existing immutable version returned."
        : "Contract version generated for human review.",
    );
  } catch (error) {
    destination = target(
      parsed.data.applicationId,
      "error",
      error instanceof Error ? error.message : "Contract generation failed.",
    );
  }
  redirect(destination);
}
