"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { counterpartyFormValues, counterpartySchema } from "./domain";
import {
  createCounterparty,
  updateCounterparty,
} from "./repository";

function issues(error: { issues: Array<{ message: string }> }) {
  return error.issues.map((issue) => issue.message).join(" ");
}

export async function createCounterpartyAction(formData: FormData) {
  const parsed = counterpartySchema.safeParse(counterpartyFormValues(formData));
  if (!parsed.success) {
    redirect(`/counterparties?error=${encodeURIComponent(issues(parsed.error))}`);
  }

  let id: string;
  try {
    id = await createCounterparty(parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create counterparty.";
    redirect(`/counterparties?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/counterparties");
  redirect(`/counterparties/${id}?success=created`);
}

export async function updateCounterpartyAction(formData: FormData) {
  const id = formData.get("counterparty_id");
  if (typeof id !== "string") {
    redirect("/counterparties?error=Invalid counterparty identifier.");
  }

  const parsed = counterpartySchema.safeParse(counterpartyFormValues(formData));
  if (!parsed.success) {
    redirect(
      `/counterparties/${id}?error=${encodeURIComponent(issues(parsed.error))}`,
    );
  }

  try {
    await updateCounterparty(id, parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update counterparty.";
    redirect(`/counterparties/${id}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/counterparties");
  revalidatePath(`/counterparties/${id}`);
  redirect(`/counterparties/${id}?success=updated`);
}
