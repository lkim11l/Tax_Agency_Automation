import { createClient } from "@supabase/supabase-js";

import { createAdminClient } from "../src/lib/supabase/admin.server";
import { EMAIL_ATTACHMENT_BUCKET } from "../src/modules/email/attachments";
import { processSnapshot } from "../src/modules/email/ingestion";
import { createEmailProvider } from "../src/modules/email/provider";
import { parseAttachment } from "../src/modules/documents/orchestrator";

const expected: Record<string, { status: string; marker?: string; error?: string }> = {
  "phase3-live.docx": { status: "parsed", marker: "INN | 1234567890" },
  "phase3-live.pdf": { status: "parsed", marker: "[PAGE 1]" },
  "phase3-live.xlsx": { status: "parsed", marker: "[SHEET: Request]" },
  "phase3-live.png": { status: "review_required", error: "OCR_REQUIRED" },
  "phase3-live.rtf": { status: "unsupported", error: "UNSUPPORTED_FORMAT" },
};

function publicKey() {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("Missing public Supabase key.");
  return key;
}

async function main() {
  const subject =
    process.env.DOCUMENT_LIVE_TEST_SUBJECT ?? "TAA-PHASE3-LIVE-20260723-001";
  const provider = createEmailProvider();
  const service = createAdminClient();
  try {
    await provider.verifyImap();
    const snapshot = await provider.fetchIncoming(0);
    const message = snapshot.messages.find(
      (candidate) =>
        candidate.subject === subject &&
        Object.keys(expected).every((filename) =>
          candidate.attachments.some(
            (attachment) => attachment.filename === filename,
          ),
        ),
    );
    if (!message) {
      console.error(
        `Live document email not found. Subject: ${subject}. Expected: ${Object.keys(expected).join(", ")}`,
      );
      process.exitCode = 2;
      return;
    }

    const selected = { ...snapshot, messages: [message] };
    const first = await processSnapshot(service, selected);
    const second = await processSnapshot(service, selected);
    if (first.errors > 0 || second.errors > 0) {
      throw new Error("Live document email ingestion reported an error.");
    }

    const email = await service
      .from("email_messages")
      .select("id,application_id")
      .eq("provider", "mailru")
      .eq("mailbox_identifier", snapshot.mailboxIdentifier)
      .eq("uid_validity", snapshot.uidValidity)
      .eq("mailbox_uid", message.uid)
      .single();
    if (email.error || !email.data?.application_id) {
      throw new Error("Live document email was not persisted to an application.");
    }

    const attachments = await service
      .from("attachments")
      .select(
        "id,original_filename,storage_path,parse_status,parse_error_code,parsed_documents(normalized_text,text_length,source_metadata,warnings)",
      )
      .eq("email_message_id", email.data.id);
    if (attachments.error || attachments.data?.length !== Object.keys(expected).length) {
      throw new Error("Live document attachment metadata is incomplete.");
    }

    for (const attachment of attachments.data) {
      if (attachment.parse_status === "pending") {
        await parseAttachment(attachment.id, service);
      }
    }

    const persisted = await service
      .from("attachments")
      .select(
        "id,original_filename,storage_path,parse_status,parse_error_code,parsed_documents(normalized_text,text_length,source_metadata,warnings)",
      )
      .eq("email_message_id", email.data.id);
    if (persisted.error) throw new Error("Live parse result lookup failed.");
    for (const attachment of persisted.data ?? []) {
      const rule = expected[attachment.original_filename];
      if (!rule || attachment.parse_status !== rule.status) {
        throw new Error(`Unexpected live status for ${attachment.original_filename}.`);
      }
      if (rule.error && attachment.parse_error_code !== rule.error) {
        throw new Error(`Unexpected live error code for ${attachment.original_filename}.`);
      }
      const parsed = Array.isArray(attachment.parsed_documents)
        ? attachment.parsed_documents[0]
        : attachment.parsed_documents;
      if (rule.marker && !parsed?.normalized_text?.includes(rule.marker)) {
        throw new Error(`Source marker missing for ${attachment.original_filename}.`);
      }
    }

    const completedDocx = persisted.data?.find(
      (attachment) => attachment.original_filename === "phase3-live.docx",
    );
    if (!completedDocx) throw new Error("Live DOCX result is missing.");
    const attemptsBeforeRepeat = await service
      .from("document_parse_attempts")
      .select("id", { count: "exact", head: true })
      .eq("attachment_id", completedDocx.id);
    const repeatedParse = await parseAttachment(completedDocx.id, service);
    if (repeatedParse !== null) {
      throw new Error("A completed live attachment was claimed a second time.");
    }
    const attemptsAfterRepeat = await service
      .from("document_parse_attempts")
      .select("id", { count: "exact", head: true })
      .eq("attachment_id", completedDocx.id);
    if (
      attemptsBeforeRepeat.error ||
      attemptsAfterRepeat.error ||
      attemptsBeforeRepeat.count !== attemptsAfterRepeat.count
    ) {
      throw new Error("Repeated live parsing created a duplicate attempt.");
    }

    const restartedService = createAdminClient();
    const persistedAfterRestart = await restartedService
      .from("parsed_documents")
      .select("attachment_id,status")
      .in(
        "attachment_id",
        persisted.data!.map((attachment) => attachment.id),
      );
    if (
      persistedAfterRestart.error ||
      persistedAfterRestart.data?.length !== Object.keys(expected).length
    ) {
      throw new Error("Live parse results did not persist through a fresh client.");
    }

    const specialist = createClient(
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
    const signedIn = await specialist.auth.signInWithPassword({
      email: process.env.SUPABASE_TEST_SPECIALIST_EMAIL ?? "",
      password: process.env.SUPABASE_TEST_SPECIALIST_PASSWORD ?? "",
    });
    if (signedIn.error) throw new Error("Live specialist sign-in failed.");
    const signed = await specialist.storage
      .from(EMAIL_ATTACHMENT_BUCKET)
      .createSignedUrl(persisted.data![0]!.storage_path, 60);
    if (signed.error) throw new Error("Live specialist private download failed.");
    const anonymous = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      publicKey(),
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    const denied = await anonymous.storage
      .from(EMAIL_ATTACHMENT_BUCKET)
      .createSignedUrl(persisted.data![0]!.storage_path, 60);
    if (!denied.error) throw new Error("Anonymous live document access was allowed.");

    const attempts = await service
      .from("document_parse_attempts")
      .select("id,status")
      .in(
        "attachment_id",
        persisted.data!.map((attachment) => attachment.id),
      );
    if (attempts.error || attempts.data?.length < Object.keys(expected).length) {
      throw new Error("Live parse attempt history is incomplete.");
    }
    const audit = await service
      .from("audit_events")
      .select("action")
      .eq("application_id", email.data.application_id)
      .like("action", "document.%");
    const actions = new Set((audit.data ?? []).map((event) => event.action));
    for (const action of [
      "document.parsed",
      "document.parse_review_required",
      "document.parse_unsupported",
    ]) {
      if (!actions.has(action)) throw new Error(`Missing live audit action: ${action}.`);
    }

    await specialist.auth.signOut();
    console.log("Mail.ru live document ingestion: passed");
    console.log("DOCX/PDF/XLSX parsing: passed");
    console.log("Image OCR-required handling: passed");
    console.log("Unsupported fallback: passed");
    console.log("Repeated ingestion idempotency: passed");
    console.log("Repeated parse idempotency: passed");
    console.log("Fresh-client persistence: passed");
    console.log("Private Storage RLS: passed");
    console.log("Attempt history and audit: passed");
    console.log(`Application ID: ${email.data.application_id}`);
    console.log(
      `Attachment IDs: ${persisted.data
        ?.map((attachment) => `${attachment.original_filename}=${attachment.id}`)
        .join(", ")}`,
    );
  } finally {
    await provider.close();
  }
}

void main();
