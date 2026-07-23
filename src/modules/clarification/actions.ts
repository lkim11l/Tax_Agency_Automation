"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  createDraft,
  recalculateCompleteness,
  sendApprovedDraft,
  transitionDraft,
  updateDraft,
} from "./service";

function target(applicationId: string, kind: "error" | "success", message: string) {
  return `/applications/${applicationId}?${kind}=${encodeURIComponent(message)}`;
}

async function perform(
  applicationId: string,
  success: string,
  operation: () => Promise<unknown>,
) {
  try {
    await operation();
    revalidatePath(`/applications/${applicationId}`);
  } catch (error) {
    redirect(target(applicationId, "error", error instanceof Error ? error.message : "Clarification operation failed."));
  }
  redirect(target(applicationId, "success", success));
}

const applicationId = z.string().uuid();

export async function recalculateCompletenessAction(formData: FormData) {
  const parsed = z.object({
    applicationId,
    ruleSetId: z.string().min(2).max(100),
  }).safeParse({
    applicationId: formData.get("application_id"),
    ruleSetId: formData.get("rule_set_id"),
  });
  if (!parsed.success) redirect("/applications?error=Invalid completeness request.");
  await perform(parsed.data.applicationId, "Completeness recalculated.", () =>
    recalculateCompleteness(parsed.data),
  );
}

export async function createDraftAction(formData: FormData) {
  const parsed = z.object({
    applicationId,
    completenessRunId: z.string().uuid(),
    recipient: z.string().trim().email().max(320),
  }).safeParse({
    applicationId: formData.get("application_id"),
    completenessRunId: formData.get("completeness_run_id"),
    recipient: formData.get("recipient"),
  });
  if (!parsed.success) redirect("/applications?error=Invalid draft request.");
  await perform(parsed.data.applicationId, "Clarification draft created.", () =>
    createDraft(parsed.data),
  );
}

export async function updateDraftAction(formData: FormData) {
  const parsed = z.object({
    applicationId,
    draftId: z.string().uuid(),
    recipient: z.string().trim().email().max(320),
    subject: z.string().trim().min(1).max(500).refine((value) => !/[\r\n]/u.test(value), "Subject cannot contain line breaks."),
    bodyText: z.string().trim().min(1).max(50_000),
  }).safeParse({
    applicationId: formData.get("application_id"),
    draftId: formData.get("draft_id"),
    recipient: formData.get("recipient"),
    subject: formData.get("subject"),
    bodyText: formData.get("body_text"),
  });
  if (!parsed.success) redirect("/applications?error=Invalid draft update.");
  await perform(parsed.data.applicationId, "Draft saved; changed content requires renewed approval.", () =>
    updateDraft(parsed.data),
  );
}

export async function transitionDraftAction(formData: FormData) {
  const parsed = z.object({
    applicationId,
    draftId: z.string().uuid(),
    workflowAction: z.enum(["submit", "approve", "return", "cancel"]),
  }).safeParse({
    applicationId: formData.get("application_id"),
    draftId: formData.get("draft_id"),
    workflowAction: formData.get("workflow_action"),
  });
  if (!parsed.success) redirect("/applications?error=Invalid draft transition.");
  await perform(parsed.data.applicationId, `Draft action completed: ${parsed.data.workflowAction}.`, () =>
    transitionDraft(parsed.data.draftId, parsed.data.workflowAction),
  );
}

export async function sendDraftAction(formData: FormData) {
  const parsed = z.object({
    applicationId,
    draftId: z.string().uuid(),
  }).safeParse({
    applicationId: formData.get("application_id"),
    draftId: formData.get("draft_id"),
  });
  if (!parsed.success) redirect("/applications?error=Invalid send request.");
  await perform(parsed.data.applicationId, "Clarification sent through Mail.ru SMTP.", () =>
    sendApprovedDraft(parsed.data.draftId),
  );
}
