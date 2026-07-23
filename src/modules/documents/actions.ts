"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getOperationalContext } from "@/lib/auth/context";

import { parseAttachment, parsePendingAttachments } from "./orchestrator";

async function requireAdmin() {
  const context = await getOperationalContext();
  if (context.profile.role !== "admin") {
    throw new Error("Administrator access is required.");
  }
  return context;
}

function targetPath(applicationId: string, type: "error" | "success", message: string) {
  return `/applications/${applicationId}?${type}=${encodeURIComponent(message)}`;
}

export async function parseDocumentAction(formData: FormData) {
  const input = z
    .object({
      applicationId: z.string().uuid(),
      attachmentId: z.string().uuid(),
    })
    .safeParse({
      applicationId: formData.get("application_id"),
      attachmentId: formData.get("attachment_id"),
    });
  if (!input.success) redirect("/applications?error=Invalid document request.");

  let status: string;
  try {
    const { supabase } = await requireAdmin();
    const queued = await supabase.rpc("request_document_parse", {
      p_attachment_id: input.data.attachmentId,
    });
    if (queued.error) throw new Error(queued.error.message);
    const result = await parseAttachment(input.data.attachmentId);
    if (!result) throw new Error("The attachment could not be claimed.");
    status = result.result.status;
    revalidatePath(`/applications/${input.data.applicationId}`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Document parsing failed.";
    redirect(targetPath(input.data.applicationId, "error", message));
  }
  redirect(
    targetPath(
      input.data.applicationId,
      status === "parsed" ? "success" : "error",
      `Document status: ${status}.`,
    ),
  );
}

export async function parsePendingDocumentsAction(formData: FormData) {
  const applicationId = z.string().uuid().safeParse(formData.get("application_id"));
  if (!applicationId.success) redirect("/applications?error=Invalid application.");
  let processed: number;
  try {
    await requireAdmin();
    const results = await parsePendingAttachments();
    processed = results.length;
    revalidatePath(`/applications/${applicationId.data}`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Batch parsing failed.";
    redirect(targetPath(applicationId.data, "error", message));
  }
  redirect(
    targetPath(
      applicationId.data,
      "success",
      `Processed ${processed} pending attachment(s).`,
    ),
  );
}
