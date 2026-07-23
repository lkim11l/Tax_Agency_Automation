"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { templateFormValues, templateSchema } from "./domain";
import { createTemplate, updateTemplate } from "./repository";

function issues(error: { issues: Array<{ message: string }> }) {
  return error.issues.map((issue) => issue.message).join(" ");
}

export async function createTemplateAction(formData: FormData) {
  const parsed = templateSchema.safeParse(templateFormValues(formData));
  if (!parsed.success) {
    redirect(`/templates?error=${encodeURIComponent(issues(parsed.error))}`);
  }

  let id: string;
  try {
    id = await createTemplate(parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create template metadata.";
    redirect(`/templates?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/templates");
  redirect(`/templates/${id}?success=created`);
}

export async function updateTemplateAction(formData: FormData) {
  const id = formData.get("template_id");
  if (typeof id !== "string") {
    redirect("/templates?error=Invalid template identifier.");
  }

  const parsed = templateSchema.safeParse(templateFormValues(formData));
  if (!parsed.success) {
    redirect(`/templates/${id}?error=${encodeURIComponent(issues(parsed.error))}`);
  }

  try {
    await updateTemplate(id, parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update template metadata.";
    redirect(`/templates/${id}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/templates");
  revalidatePath(`/templates/${id}`);
  redirect(`/templates/${id}?success=updated`);
}
