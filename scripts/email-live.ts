import { createClient } from "@supabase/supabase-js";

import { createAdminClient } from "../src/lib/supabase/admin.server";
import { EMAIL_ATTACHMENT_BUCKET } from "../src/modules/email/attachments";
import { loadEmailConfig } from "../src/modules/email/config";
import { safeOperationalError } from "../src/modules/email/errors";
import { processSnapshot } from "../src/modules/email/ingestion";
import { MailruEmailProvider } from "../src/modules/email/mailru-provider";
import { createEmailProvider } from "../src/modules/email/provider";

function publicKey() {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("Missing public Supabase key for live acceptance.");
  }
  return key;
}

async function main() {
  const prefix = process.env.EMAIL_LIVE_TEST_PREFIX?.trim() || "TAA-PHASE2-LIVE-";
  const provider = createEmailProvider();
  let service: ReturnType<typeof createAdminClient> | null = null;
  const createdApplicationIds: string[] = [];
  const createdEmailIds: string[] = [];
  const createdStoragePaths: string[] = [];

  try {
    await provider.verifyImap();
    await provider.verifySmtp();
    const snapshot = await provider.fetchIncoming(0);
    const matching = snapshot.messages.filter((message) =>
      message.subject?.includes(prefix),
    );

    console.log("IMAP verification: passed");
    console.log("SMTP verification: passed");
    console.log(`Acceptance messages found: ${matching.length}`);

    const roots = matching.filter(
      (message) => !message.inReplyTo && message.references.length === 0,
    );
    const replies = matching.filter(
      (message) => message.inReplyTo || message.references.length > 0,
    );
    const rootWithAttachment = roots.find(
      (message) => message.attachments.length > 0 && message.rfcMessageId,
    );
    const matchingReply = rootWithAttachment
      ? replies.find(
          (message) =>
            message.inReplyTo === rootWithAttachment.rfcMessageId ||
            message.references.includes(rootWithAttachment.rfcMessageId!),
        )
      : undefined;
    const sameSubjectNonReply = rootWithAttachment
      ? roots.find(
          (message) =>
            message.uid !== rootWithAttachment.uid &&
            message.subject === rootWithAttachment.subject,
        )
      : undefined;

    if (!rootWithAttachment || !matchingReply || !sameSubjectNonReply) {
      console.error(
        `Live acceptance incomplete. Send a root with a safe attachment, a separate same-subject message, and a real reply. Subject prefix: ${prefix}`,
      );
      process.exitCode = 2;
      return;
    }

    service = createAdminClient();
    const selected = [rootWithAttachment, sameSubjectNonReply, matchingReply];
    const uids = selected.map((message) => message.uid);
    const before = await service
      .from("email_messages")
      .select("id,application_id")
      .eq("provider", "mailru")
      .eq("mailbox_identifier", snapshot.mailboxIdentifier)
      .eq("uid_validity", snapshot.uidValidity)
      .in("mailbox_uid", uids);
    if (before.error) throw new Error("Database live-fixture lookup failed.");
    const beforeEmailIds = new Set((before.data ?? []).map((row) => row.id as string));
    const beforeApplicationIds = new Set(
      (before.data ?? [])
        .map((row) => row.application_id as string | null)
        .filter((id): id is string => Boolean(id)),
    );

    const selectedSnapshot = { ...snapshot, messages: selected };
    const first = await processSnapshot(service, selectedSnapshot);
    const second = await processSnapshot(service, selectedSnapshot);
    if (first.errors > 0 || second.errors > 0) {
      throw new Error("Live email processing reported an error.");
    }

    const persisted = await service
      .from("email_messages")
      .select("id,application_id,mailbox_uid,processing_status")
      .eq("provider", "mailru")
      .eq("mailbox_identifier", snapshot.mailboxIdentifier)
      .eq("uid_validity", snapshot.uidValidity)
      .in("mailbox_uid", uids);
    if (persisted.error || persisted.data?.length !== 3) {
      throw new Error("Live message persistence verification failed.");
    }
    const byUid = new Map(
      persisted.data.map((row) => [Number(row.mailbox_uid), row]),
    );
    const rootRow = byUid.get(rootWithAttachment.uid);
    const separateRow = byUid.get(sameSubjectNonReply.uid);
    const replyRow = byUid.get(matchingReply.uid);
    if (
      !rootRow?.application_id ||
      !separateRow?.application_id ||
      rootRow.application_id === separateRow.application_id ||
      replyRow?.application_id !== rootRow.application_id
    ) {
      throw new Error("Live application/reply linkage verification failed.");
    }

    const attachments = await service
      .from("attachments")
      .select("id,storage_path")
      .eq("email_message_id", rootRow.id);
    if (attachments.error || !attachments.data?.length) {
      throw new Error("Live attachment persistence verification failed.");
    }

    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      publicKey(),
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
    const signIn = await userClient.auth.signInWithPassword({
      email: process.env.SUPABASE_TEST_SPECIALIST_EMAIL ?? "",
      password: process.env.SUPABASE_TEST_SPECIALIST_PASSWORD ?? "",
    });
    if (signIn.error) throw new Error("Live user-session verification failed.");
    const signed = await userClient.storage
      .from(EMAIL_ATTACHMENT_BUCKET)
      .createSignedUrl(attachments.data[0]!.storage_path, 60);
    if (signed.error) throw new Error("Live private attachment access failed.");
    const anonymous = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      publicKey(),
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
    const denied = await anonymous.storage
      .from(EMAIL_ATTACHMENT_BUCKET)
      .createSignedUrl(attachments.data[0]!.storage_path, 60);
    if (!denied.error) throw new Error("Anonymous attachment access was not denied.");
    await userClient.auth.signOut();

    const validConfig = loadEmailConfig();
    const invalidProvider = new MailruEmailProvider({
      ...validConfig,
      imap: {
        ...validConfig.imap,
        password: `${validConfig.imap.password}-invalid-acceptance`,
      },
    });
    let invalidCredentialSafe = false;
    try {
      await invalidProvider.verifyImap();
    } catch (error) {
      const safeError = safeOperationalError(error);
      invalidCredentialSafe = !safeError.includes(validConfig.imap.password);
    } finally {
      await invalidProvider.close();
    }
    if (!invalidCredentialSafe) {
      throw new Error("Invalid credential handling exposed sensitive data.");
    }

    for (const row of persisted.data) {
      if (!beforeEmailIds.has(row.id)) createdEmailIds.push(row.id);
      if (
        row.application_id &&
        !beforeApplicationIds.has(row.application_id) &&
        !createdApplicationIds.includes(row.application_id)
      ) {
        createdApplicationIds.push(row.application_id);
      }
    }
    if (!beforeEmailIds.has(rootRow.id)) {
      createdStoragePaths.push(
        ...attachments.data.map((attachment) => attachment.storage_path),
      );
    }

    console.log("Live ingestion: passed");
    console.log("Application creation: passed");
    console.log("Reply linking: passed");
    console.log("Repeated sync idempotency: passed");
    console.log("Private attachment access: passed");
    console.log("Invalid-credential safety: passed");
  } catch (error) {
    console.error(`Live email acceptance failed: ${safeOperationalError(error)}`);
    process.exitCode = 1;
  } finally {
    if (service && createdStoragePaths.length > 0) {
      await service.storage
        .from(EMAIL_ATTACHMENT_BUCKET)
        .remove(createdStoragePaths);
    }
    if (service && createdEmailIds.length > 0) {
      await service.from("email_messages").delete().in("id", createdEmailIds);
    }
    if (service && createdApplicationIds.length > 0) {
      await service.from("applications").delete().in("id", createdApplicationIds);
    }
    await provider.close();
  }
}

void main();
