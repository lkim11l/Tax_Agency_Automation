"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  applicationFormValues,
  applicationInputSchema,
  formatValidationError,
  noteSchema,
  statusChangeSchema,
} from "./domain";
import {
  appendApplicationNote,
  changeApplicationStatus,
  createApplication,
  updateApplication,
} from "./repository";

function errorLocation(path: string, message: string) {
  return `${path}?error=${encodeURIComponent(message)}`;
}

export async function createApplicationAction(formData: FormData) {
  const parsed = applicationInputSchema.safeParse(applicationFormValues(formData));
  if (!parsed.success) {
    redirect(errorLocation("/applications/new", formatValidationError(parsed.error)));
  }

  let id: string;
  try {
    id = await createApplication(parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create application.";
    redirect(errorLocation("/applications/new", message));
  }

  revalidatePath("/applications");
  redirect(`/applications/${id}?success=created`);
}

export async function updateApplicationAction(formData: FormData) {
  const id = formData.get("application_id");
  if (typeof id !== "string") {
    redirect("/applications?error=Invalid application identifier.");
  }

  const parsed = applicationInputSchema.safeParse(applicationFormValues(formData));
  if (!parsed.success) {
    redirect(errorLocation(`/applications/${id}`, formatValidationError(parsed.error)));
  }

  try {
    await updateApplication(id, parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update application.";
    redirect(errorLocation(`/applications/${id}`, message));
  }

  revalidatePath("/applications");
  revalidatePath(`/applications/${id}`);
  redirect(`/applications/${id}?success=updated`);
}

export async function changeStatusAction(formData: FormData) {
  const parsed = statusChangeSchema.safeParse({
    application_id: formData.get("application_id"),
    status: formData.get("status"),
    reason: formData.get("reason"),
  });
  const id =
    typeof formData.get("application_id") === "string"
      ? String(formData.get("application_id"))
      : "";

  if (!parsed.success) {
    redirect(errorLocation(`/applications/${id}`, formatValidationError(parsed.error)));
  }

  try {
    await changeApplicationStatus({
      applicationId: parsed.data.application_id,
      status: parsed.data.status,
      reason: parsed.data.reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to change status.";
    redirect(errorLocation(`/applications/${id}`, message));
  }

  revalidatePath("/applications");
  revalidatePath(`/applications/${id}`);
  redirect(`/applications/${id}?success=status`);
}

export async function appendNoteAction(formData: FormData) {
  const parsed = noteSchema.safeParse({
    application_id: formData.get("application_id"),
    note: formData.get("note"),
  });
  const id =
    typeof formData.get("application_id") === "string"
      ? String(formData.get("application_id"))
      : "";

  if (!parsed.success) {
    redirect(errorLocation(`/applications/${id}`, formatValidationError(parsed.error)));
  }

  try {
    await appendApplicationNote(parsed.data.application_id, parsed.data.note);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add comment.";
    redirect(errorLocation(`/applications/${id}`, message));
  }

  revalidatePath(`/applications/${id}`);
  redirect(`/applications/${id}?success=comment`);
}
