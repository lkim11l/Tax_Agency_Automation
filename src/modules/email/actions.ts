"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getOperationalContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin.server";

import { safeOperationalError } from "./errors";
import { reprocessMessageByUid, syncMailbox } from "./ingestion";

function emailRedirect(type: "error" | "success", message: string): never {
  redirect(`/email?${type}=${encodeURIComponent(message)}`);
}

async function requireAdmin() {
  const context = await getOperationalContext();
  if (context.profile.role !== "admin") {
    throw new Error("Administrator access is required.");
  }
  return context;
}

export async function syncEmailAction() {
  let result: Awaited<ReturnType<typeof syncMailbox>>;
  try {
    await requireAdmin();
    result = await syncMailbox();
  } catch (error) {
    emailRedirect("error", safeOperationalError(error));
  }
  revalidatePath("/email");
  revalidatePath("/applications");
  emailRedirect(
    "success",
    `Sync completed: ${result.messagesProcessed} processed, ${result.errors} failed.`,
  );
}

export async function manualLinkEmailAction(formData: FormData) {
  const parsed = z
    .object({
      applicationId: z.string().uuid(),
      emailMessageId: z.string().uuid(),
    })
    .safeParse({
      applicationId: formData.get("application_id"),
      emailMessageId: formData.get("email_message_id"),
    });
  if (!parsed.success) {
    return emailRedirect("error", "A valid application identifier is required.");
  }

  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.rpc("manual_link_email", {
      p_application_id: parsed.data.applicationId,
      p_email_message_id: parsed.data.emailMessageId,
    });
    if (error) throw new Error("Manual email linkage failed.");
  } catch (error) {
    emailRedirect("error", safeOperationalError(error));
  }
  revalidatePath("/email");
  revalidatePath(`/applications/${parsed.data.applicationId}`);
  emailRedirect("success", "Email linked to the application.");
}

export async function reprocessEmailAction(formData: FormData) {
  const emailMessageId = z.string().uuid().safeParse(formData.get("email_message_id"));
  if (!emailMessageId.success) {
    return emailRedirect("error", "A valid email identifier is required.");
  }

  let result: Awaited<ReturnType<typeof reprocessMessageByUid>>;
  try {
    const { supabase } = await requireAdmin();
    const message = await supabase
      .from("email_messages")
      .select("mailbox_uid")
      .eq("id", emailMessageId.data)
      .single();
    if (message.error || !message.data?.mailbox_uid) {
      throw new Error("Email message is unavailable for reprocessing.");
    }
    const queued = await supabase.rpc("reprocess_email", {
      p_email_message_id: emailMessageId.data,
    });
    if (queued.error) throw new Error("Unable to queue email reprocessing.");
    result = await reprocessMessageByUid(
      Number(message.data.mailbox_uid),
      undefined,
      createAdminClient(),
    );
  } catch (error) {
    emailRedirect("error", safeOperationalError(error));
  }
  revalidatePath("/email");
  emailRedirect(
    result.errors > 0 ? "error" : "success",
    result.errors > 0 ? "Email reprocessing failed." : "Email reprocessed.",
  );
}
