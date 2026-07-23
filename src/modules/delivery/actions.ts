"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  cancelDeliveryDraft,
  createDeliveryDraft,
  reviewContractVersion,
  sendDeliveryDraft,
  updateDeliveryDraft,
} from "./service";

function destination(applicationId: string, kind: "success" | "error", message: string) {
  return `/applications/${applicationId}?${kind}=${encodeURIComponent(message)}`;
}

async function perform(
  applicationId: string,
  success: string,
  operation: () => Promise<unknown>,
) {
  let target: string;
  try {
    await operation();
    revalidatePath(`/applications/${applicationId}`);
    target = destination(applicationId, "success", success);
  } catch (error) {
    target = destination(
      applicationId,
      "error",
      error instanceof Error ? error.message : "Contract delivery operation failed.",
    );
  }
  redirect(target);
}

const reviewSchema = z.object({
  applicationId: z.string().uuid(),
  contractVersionId: z.string().uuid(),
  decision: z.enum(["approved", "rejected", "returned_for_regeneration"]),
  comment: z.string().max(4000).optional(),
});

export async function reviewContractVersionAction(formData: FormData) {
  const parsed = reviewSchema.safeParse({
    applicationId: formData.get("application_id"),
    contractVersionId: formData.get("contract_version_id"),
    decision: formData.get("decision"),
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) redirect("/applications?error=Invalid contract review.");
  await perform(parsed.data.applicationId, "Contract review recorded.", () =>
    reviewContractVersion(parsed.data),
  );
}

const createSchema = z.object({
  applicationId: z.string().uuid(),
  contractVersionId: z.string().uuid(),
  recipient: z.string().email().optional(),
});

export async function createDeliveryDraftAction(formData: FormData) {
  const parsed = createSchema.safeParse({
    applicationId: formData.get("application_id"),
    contractVersionId: formData.get("contract_version_id"),
    recipient: formData.get("recipient") || undefined,
  });
  if (!parsed.success) redirect("/applications?error=Invalid delivery draft request.");
  await perform(parsed.data.applicationId, "Delivery draft created.", () =>
    createDeliveryDraft(parsed.data),
  );
}

const draftSchema = z.object({
  applicationId: z.string().uuid(),
  draftId: z.string().uuid(),
  recipient: z.string().email(),
  subject: z.string().trim().min(1).max(500),
  bodyText: z.string().trim().min(1).max(50_000),
});

export async function updateDeliveryDraftAction(formData: FormData) {
  const parsed = draftSchema.safeParse({
    applicationId: formData.get("application_id"),
    draftId: formData.get("draft_id"),
    recipient: formData.get("recipient"),
    subject: formData.get("subject"),
    bodyText: formData.get("body_text"),
  });
  if (!parsed.success) redirect("/applications?error=Invalid delivery draft.");
  await perform(parsed.data.applicationId, "A new delivery draft version was saved.", () =>
    updateDeliveryDraft(parsed.data),
  );
}

const commandSchema = z.object({
  applicationId: z.string().uuid(),
  draftId: z.string().uuid(),
});

export async function cancelDeliveryDraftAction(formData: FormData) {
  const parsed = commandSchema.safeParse({
    applicationId: formData.get("application_id"),
    draftId: formData.get("draft_id"),
  });
  if (!parsed.success) redirect("/applications?error=Invalid delivery draft.");
  await perform(parsed.data.applicationId, "Delivery draft cancelled.", () =>
    cancelDeliveryDraft(parsed.data.draftId),
  );
}

export async function sendDeliveryDraftAction(formData: FormData) {
  const parsed = commandSchema.safeParse({
    applicationId: formData.get("application_id"),
    draftId: formData.get("draft_id"),
  });
  if (!parsed.success) redirect("/applications?error=Invalid delivery draft.");
  await perform(parsed.data.applicationId, "Contract accepted by Mail.ru SMTP.", () =>
    sendDeliveryDraft(parsed.data.draftId),
  );
}
