import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin.server";

import {
  attachmentStoragePath,
  EMAIL_ATTACHMENT_BUCKET,
  sha256,
  validateAttachment,
} from "./attachments";
import { loadEmailConfig } from "./config";
import { safeOperationalError } from "./errors";
import { createEmailProvider } from "./provider";
import type {
  EmailProvider,
  IngestionResult,
  MailboxSnapshot,
  ProviderMessage,
} from "./types";

type IngestRpcResult = {
  application_created: boolean;
  application_id: string | null;
  duplicate: boolean;
  email_message_id: string;
  reply_linked: boolean;
  unlinked_reply: boolean;
};

function emptyResult(): IngestionResult {
  return {
    applicationCreated: 0,
    attachmentsStored: 0,
    duplicateSkipped: 0,
    errors: 0,
    ignored: 0,
    messagesProcessed: 0,
    repliesLinked: 0,
    unlinkedReplies: 0,
  };
}

function normalizeSubject(subject: string | null) {
  return (
    subject
      ?.normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500) || null
  );
}

export function shouldIgnoreMessage(
  message: ProviderMessage,
  mailboxAddress: string,
) {
  const sender = message.sender.address.toLowerCase();
  if (sender === mailboxAddress.toLowerCase()) {
    return true;
  }
  const localPart = sender.split("@")[0] ?? "";
  if (localPart === "mailer-daemon" || localPart === "postmaster") {
    return true;
  }
  const autoSubmitted = message.rawHeaders["auto-submitted"]?.toLowerCase();
  return Boolean(autoSubmitted && autoSubmitted !== "no");
}

async function audit(
  supabase: SupabaseClient,
  input: {
    action: string;
    applicationId?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await supabase.from("audit_events").insert({
    actor_id: null,
    application_id: input.applicationId ?? null,
    entity_type: input.entityId ? "email_message" : "mailbox",
    entity_id: input.entityId ?? null,
    action: input.action,
    metadata: input.metadata ?? {},
  });
  if (error) {
    throw new Error("Database audit write failed.");
  }
}

async function setMessageState(
  supabase: SupabaseClient,
  emailMessageId: string,
  status: "completed" | "failed" | "processing",
  processingError: string | null,
) {
  const { error } = await supabase
    .from("email_messages")
    .update({ processing_status: status, processing_error: processingError })
    .eq("id", emailMessageId);
  if (error) {
    throw new Error("Database email state update failed.");
  }
}

async function storeAttachments(
  supabase: SupabaseClient,
  message: ProviderMessage,
  ingestion: IngestRpcResult,
) {
  let stored = 0;
  const uploadedPaths: string[] = [];
  const insertedAttachmentIds: string[] = [];

  try {
    for (const attachment of message.attachments) {
      const checksum = sha256(attachment.content);
      const validation = validateAttachment(attachment);
      if (!validation.allowed) {
        await audit(supabase, {
          action: "attachment.blocked",
          applicationId: ingestion.application_id,
          entityId: ingestion.email_message_id,
          metadata: {
            mime_type: attachment.mimeType,
            reason: validation.reason,
            size_bytes: attachment.size,
          },
        });
        throw new Error(validation.reason);
      }

      const existing = await supabase
        .from("attachments")
        .select("id")
        .eq("email_message_id", ingestion.email_message_id)
        .eq("checksum", checksum)
        .maybeSingle();
      if (existing.error) {
        throw new Error("Database attachment lookup failed.");
      }
      if (existing.data) {
        continue;
      }

      const storagePath = attachmentStoragePath({
        applicationId: ingestion.application_id ?? "unlinked",
        emailMessageId: ingestion.email_message_id,
        filename: validation.sanitizedFilename,
        checksum,
      });
      const upload = await supabase.storage
        .from(EMAIL_ATTACHMENT_BUCKET)
        .upload(storagePath, attachment.content, {
          cacheControl: "3600",
          contentType: attachment.mimeType,
          upsert: false,
        });
      if (upload.error) {
        throw new Error("Attachment storage upload failed.");
      }
      uploadedPaths.push(storagePath);

      const metadata = await supabase
        .from("attachments")
        .insert({
          application_id: ingestion.application_id,
          email_message_id: ingestion.email_message_id,
          original_filename: attachment.filename,
          sanitized_filename: validation.sanitizedFilename,
          mime_type: attachment.mimeType,
          size_bytes: attachment.size,
          storage_path: storagePath,
          checksum,
          parse_status: "pending",
        })
        .select("id")
        .single();
      if (metadata.error || !metadata.data) {
        throw new Error("Database attachment metadata write failed.");
      }
      insertedAttachmentIds.push(metadata.data.id as string);
      stored += 1;
      await audit(supabase, {
        action: "attachment.stored",
        applicationId: ingestion.application_id,
        entityId: ingestion.email_message_id,
        metadata: {
          attachment_id: metadata.data.id,
          mime_type: attachment.mimeType,
          size_bytes: attachment.size,
        },
      });
    }
    return stored;
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(EMAIL_ATTACHMENT_BUCKET).remove(uploadedPaths);
    }
    if (insertedAttachmentIds.length > 0) {
      await supabase.from("attachments").delete().in("id", insertedAttachmentIds);
    }
    throw error;
  }
}

async function ingestMessage(
  supabase: SupabaseClient,
  snapshot: MailboxSnapshot,
  message: ProviderMessage,
) {
  const rpc = await supabase.rpc("ingest_email_message", {
    p_message: {
      provider: "mailru",
      mailbox_identifier: snapshot.mailboxIdentifier,
      mailbox_uid: message.uid,
      uid_validity: message.uidValidity,
      provider_message_id: message.providerMessageId,
      provider_thread_id: null,
      rfc_message_id: message.rfcMessageId,
      in_reply_to: message.inReplyTo,
      reference_message_ids: message.references,
      sender: message.sender.address,
      recipients: message.recipients,
      cc: message.cc,
      subject: normalizeSubject(message.subject),
      plain_body: message.plainBody,
      html_body: message.htmlBody,
      occurred_at: message.receivedAt.toISOString(),
      raw_headers: message.rawHeaders,
    },
  });
  if (rpc.error || !rpc.data) {
    throw new Error("Database email ingestion transaction failed.");
  }
  const ingestion = rpc.data as unknown as IngestRpcResult;

  if (ingestion.duplicate) {
    const state = await supabase
      .from("email_messages")
      .select("processing_status")
      .eq("id", ingestion.email_message_id)
      .single();
    if (state.error || state.data?.processing_status === "completed") {
      return { ingestion, attachmentsStored: 0 };
    }
  }

  try {
    await setMessageState(supabase, ingestion.email_message_id, "processing", null);
    const attachmentsStored = await storeAttachments(
      supabase,
      message,
      ingestion,
    );
    await setMessageState(supabase, ingestion.email_message_id, "completed", null);
    return { ingestion, attachmentsStored };
  } catch (error) {
    const safeError = safeOperationalError(error);
    await setMessageState(
      supabase,
      ingestion.email_message_id,
      "failed",
      safeError,
    );
    throw error;
  }
}

export async function processSnapshot(
  supabase: SupabaseClient,
  snapshot: MailboxSnapshot,
) {
  const result = emptyResult();
  for (const message of snapshot.messages) {
    if (shouldIgnoreMessage(message, snapshot.mailboxIdentifier)) {
      result.ignored += 1;
      continue;
    }
    try {
      const processed = await ingestMessage(supabase, snapshot, message);
      result.messagesProcessed += 1;
      result.attachmentsStored += processed.attachmentsStored;
      if (processed.ingestion.duplicate) result.duplicateSkipped += 1;
      if (processed.ingestion.application_created) result.applicationCreated += 1;
      if (processed.ingestion.reply_linked) result.repliesLinked += 1;
      if (processed.ingestion.unlinked_reply) result.unlinkedReplies += 1;
    } catch {
      result.errors += 1;
    }
  }
  return result;
}

export async function verifyEmailConnections(
  provider: EmailProvider = createEmailProvider(),
) {
  try {
    await provider.verifyImap();
    await provider.verifySmtp();
  } finally {
    try {
      await provider.close();
    } catch {
      // Teardown must not override a completed synchronization result.
    }
  }
}

export async function syncMailbox(
  provider: EmailProvider = createEmailProvider(),
  supabase: SupabaseClient = createAdminClient(),
): Promise<IngestionResult> {
  const config = loadEmailConfig();
  const mailboxIdentifier = config.from.toLowerCase();
  const folder = config.imap.folder;
  const current = await supabase
    .from("mailbox_sync_state")
    .select("uid_validity,last_processed_uid")
    .eq("provider", provider.name)
    .eq("mailbox_identifier", mailboxIdentifier)
    .eq("folder", folder)
    .maybeSingle();
  if (current.error) {
    throw new Error("Unable to read mailbox synchronization state.");
  }

  const attemptedAt = new Date().toISOString();
  await supabase.from("mailbox_sync_state").upsert(
    {
      provider: provider.name,
      mailbox_identifier: mailboxIdentifier,
      folder,
      last_attempted_sync: attemptedAt,
      sync_status: "syncing",
      last_error: null,
    },
    { onConflict: "provider,mailbox_identifier,folder" },
  );
  await audit(supabase, {
    action: "email.sync_started",
    metadata: { provider: provider.name, folder },
  });

  try {
    await provider.verifyImap();
    const preliminary = await provider.fetchIncoming(
      Number(current.data?.last_processed_uid ?? 0),
    );
    const uidChanged =
      current.data?.uid_validity &&
      String(current.data.uid_validity) !== preliminary.uidValidity;
    const snapshot = uidChanged
      ? await provider.fetchIncoming(0)
      : preliminary;
    const result = await processSnapshot(supabase, snapshot);
    const lastUid = Math.max(
      Number(uidChanged ? 0 : current.data?.last_processed_uid ?? 0),
      ...snapshot.messages.map((message) => message.uid),
    );
    const successfulAt = new Date().toISOString();
    const update = await supabase
      .from("mailbox_sync_state")
      .update({
        uid_validity: snapshot.uidValidity,
        last_processed_uid: lastUid,
        last_successful_sync: successfulAt,
        last_attempted_sync: attemptedAt,
        last_error: result.errors > 0 ? `${result.errors} message(s) failed.` : null,
        sync_status: result.errors > 0 ? "failed" : "completed",
        new_message_count: result.messagesProcessed,
        error_count: result.errors,
      })
      .eq("provider", provider.name)
      .eq("mailbox_identifier", mailboxIdentifier)
      .eq("folder", folder);
    if (update.error) {
      throw new Error("Unable to update mailbox synchronization state.");
    }
    await audit(supabase, {
      action: result.errors > 0 ? "email.sync_failed" : "email.sync_completed",
      metadata: {
        errors: result.errors,
        messages_processed: result.messagesProcessed,
        provider: provider.name,
      },
    });
    return result;
  } catch (error) {
    const safeError = safeOperationalError(error);
    await supabase
      .from("mailbox_sync_state")
      .update({
        last_error: safeError,
        last_attempted_sync: attemptedAt,
        sync_status: "failed",
      })
      .eq("provider", provider.name)
      .eq("mailbox_identifier", mailboxIdentifier)
      .eq("folder", folder);
    await audit(supabase, {
      action: "email.sync_failed",
      metadata: { provider: provider.name, reason: safeError },
    });
    throw new Error(safeError);
  } finally {
    await provider.close();
  }
}

export async function reprocessMessageByUid(
  uid: number,
  provider: EmailProvider = createEmailProvider(),
  supabase: SupabaseClient = createAdminClient(),
) {
  try {
    const snapshot = await provider.fetchByUid(uid);
    return await processSnapshot(supabase, snapshot);
  } finally {
    try {
      await provider.close();
    } catch {
      // Reprocessing outcome is already persisted before teardown.
    }
  }
}
