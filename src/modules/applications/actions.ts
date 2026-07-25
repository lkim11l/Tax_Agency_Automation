"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

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

export async function bulkArchiveApplicationsAction(formData: FormData) {
  const parsed = z.object({
    applicationIds: z.array(z.uuid()).min(1),
  }).safeParse({
    applicationIds: formData.getAll("application_ids"),
  });
  if (!parsed.success) redirect("/applications?error=Выберите хотя бы одну заявку.");
  const results = await Promise.allSettled(
    parsed.data.applicationIds.map((applicationId) =>
      changeApplicationStatus({ applicationId, status: "archived", reason: "Archived by admin from the applications list." }),
    ),
  );
  const failedCount = results.filter((result) => result.status === "rejected").length;
  revalidatePath("/applications");
  if (failedCount > 0) {
    const okCount = results.length - failedCount;
    redirect(`/applications?error=${encodeURIComponent(`Архивировано: ${okCount}. Не удалось: ${failedCount}.`)}`);
  }
  redirect(`/applications?success=${encodeURIComponent(`Архивировано заявок: ${results.length}.`)}`);
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
