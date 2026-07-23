import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required integration variable: ${name}`);
  return value;
}

function publicKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
}

function secretKey() {
  return (
    process.env.SUPABASE_SECRET_KEY ??
    required("SUPABASE_SERVICE_ROLE_KEY")
  );
}

function client(key = publicKey()) {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function signIn(
  instance: SupabaseClient,
  emailName: string,
  passwordName: string,
) {
  const result = await instance.auth.signInWithPassword({
    email: required(emailName),
    password: required(passwordName),
  });
  expect(result.error).toBeNull();
}

describe.sequential("hosted Supabase Phase 2 email acceptance", () => {
  const runId = `phase2-${Date.now()}`;
  const mailbox = `${runId}@example.test`;
  const uidValidity = "812345";
  const storagePaths: string[] = [];
  const applicationIds: string[] = [];
  const emailIds: string[] = [];
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let specialist: SupabaseClient;
  let inactive: SupabaseClient;
  let rootApplicationId: string;
  let rootEmailId: string;
  let unlinkedEmailId: string;

  const message = (input: {
    uid: number;
    messageId: string;
    subject?: string;
    inReplyTo?: string | null;
    references?: string[];
  }) => ({
    provider: "mailru",
    mailbox_identifier: mailbox,
    mailbox_uid: input.uid,
    uid_validity: uidValidity,
    provider_message_id: input.messageId,
    provider_thread_id: null,
    rfc_message_id: input.messageId,
    in_reply_to: input.inReplyTo ?? null,
    reference_message_ids: input.references ?? [],
    sender: "sender@example.test",
    recipients: [{ address: mailbox }],
    cc: [],
    subject: input.subject ?? `Hosted Phase 2 ${runId}`,
    plain_body: "Integration fixture body",
    html_body: "<p>Stored but never rendered raw.</p>",
    occurred_at: new Date().toISOString(),
    raw_headers: { "message-id": input.messageId },
  });

  beforeAll(async () => {
    service = client(secretKey());
    admin = client();
    specialist = client();
    inactive = client();
    await signIn(
      admin,
      "SUPABASE_TEST_ADMIN_EMAIL",
      "SUPABASE_TEST_ADMIN_PASSWORD",
    );
    await signIn(
      specialist,
      "SUPABASE_TEST_SPECIALIST_EMAIL",
      "SUPABASE_TEST_SPECIALIST_PASSWORD",
    );
    await signIn(
      inactive,
      "SUPABASE_TEST_INACTIVE_EMAIL",
      "SUPABASE_TEST_INACTIVE_PASSWORD",
    );
  });

  afterAll(async () => {
    if (!service) {
      return;
    }
    if (storagePaths.length > 0) {
      await service.storage.from("email-attachments").remove(storagePaths);
    }
    if (emailIds.length > 0) {
      await service.from("email_messages").delete().in("id", emailIds);
    }
    if (applicationIds.length > 0) {
      await service.from("applications").delete().in("id", applicationIds);
    }
    await service
      .from("mailbox_sync_state")
      .delete()
      .eq("mailbox_identifier", mailbox);
    await Promise.all([
      admin.auth.signOut(),
      specialist.auth.signOut(),
      inactive.auth.signOut(),
    ]);
  });

  it("persists mailbox synchronization state", async () => {
    const result = await service
      .from("mailbox_sync_state")
      .upsert(
        {
          provider: "mailru",
          mailbox_identifier: mailbox,
          folder: "INBOX",
          uid_validity: uidValidity,
          last_processed_uid: 0,
          sync_status: "idle",
        },
        { onConflict: "provider,mailbox_identifier,folder" },
      )
      .select("id,folder,last_processed_uid")
      .single();
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ folder: "INBOX", last_processed_uid: 0 });
  });

  it("atomically prevents duplicate applications during concurrent ingestion", async () => {
    const root = message({
      uid: 100,
      messageId: `<root-${runId}@example.test>`,
    });
    const [first, second] = await Promise.all([
      service.rpc("ingest_email_message", { p_message: root }),
      service.rpc("ingest_email_message", { p_message: root }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const results = [first.data, second.data] as Array<{
      application_id: string;
      duplicate: boolean;
      email_message_id: string;
    }>;
    expect(results.filter((item) => item.duplicate)).toHaveLength(1);
    expect(new Set(results.map((item) => item.email_message_id)).size).toBe(1);
    expect(new Set(results.map((item) => item.application_id)).size).toBe(1);
    rootApplicationId = results[0]!.application_id;
    rootEmailId = results[0]!.email_message_id;
    applicationIds.push(rootApplicationId);
    emailIds.push(rootEmailId);

    const counts = await Promise.all([
      service
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("id", rootApplicationId),
      service
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("id", rootEmailId),
    ]);
    expect(counts[0].count).toBe(1);
    expect(counts[1].count).toBe(1);
  });

  it("does not use the subject as a unique identifier", async () => {
    const result = await service.rpc("ingest_email_message", {
      p_message: message({
        uid: 101,
        messageId: `<same-subject-${runId}@example.test>`,
      }),
    });
    expect(result.error).toBeNull();
    expect(result.data.application_id).not.toBe(rootApplicationId);
    applicationIds.push(result.data.application_id);
    emailIds.push(result.data.email_message_id);
  });

  it("links exact replies and preserves unmatched replies for review", async () => {
    const reply = await service.rpc("ingest_email_message", {
      p_message: message({
        uid: 102,
        messageId: `<reply-${runId}@example.test>`,
        inReplyTo: `<root-${runId}@example.test>`,
      }),
    });
    expect(reply.error).toBeNull();
    expect(reply.data).toMatchObject({
      application_id: rootApplicationId,
      reply_linked: true,
    });
    emailIds.push(reply.data.email_message_id);

    const unlinked = await service.rpc("ingest_email_message", {
      p_message: message({
        uid: 103,
        messageId: `<unlinked-${runId}@example.test>`,
        inReplyTo: `<missing-${runId}@example.test>`,
      }),
    });
    expect(unlinked.error).toBeNull();
    expect(unlinked.data).toMatchObject({
      application_id: null,
      unlinked_reply: true,
    });
    unlinkedEmailId = unlinked.data.email_message_id;
    emailIds.push(unlinkedEmailId);
  });

  it("stores attachment metadata in a private bucket", async () => {
    const storagePath = `applications/${rootApplicationId}/emails/${rootEmailId}/${runId}.txt`;
    storagePaths.push(storagePath);
    const uploaded = await service.storage
      .from("email-attachments")
      .upload(storagePath, Buffer.from("safe integration attachment"), {
        contentType: "text/plain",
      });
    expect(uploaded.error).toBeNull();
    const metadata = await service
      .from("attachments")
      .insert({
        application_id: rootApplicationId,
        email_message_id: rootEmailId,
        original_filename: `${runId}.txt`,
        sanitized_filename: `${runId}.txt`,
        mime_type: "text/plain",
        size_bytes: 27,
        storage_path: storagePath,
        checksum: runId.padEnd(64, "0").slice(0, 64),
        parse_status: "pending",
      })
      .select("id")
      .single();
    expect(metadata.error).toBeNull();

    const userSigned = await specialist.storage
      .from("email-attachments")
      .createSignedUrl(storagePath, 60);
    expect(userSigned.error).toBeNull();
    const anonymousSigned = await client().storage
      .from("email-attachments")
      .createSignedUrl(storagePath, 60);
    expect(anonymousSigned.error).not.toBeNull();
  });

  it("enforces email and attachment RLS for users", async () => {
    const specialistEmail = await specialist
      .from("email_messages")
      .select("id")
      .eq("id", rootEmailId);
    expect(specialistEmail.error).toBeNull();
    expect(specialistEmail.data).toHaveLength(1);

    const inactiveEmail = await inactive
      .from("email_messages")
      .select("id")
      .eq("id", rootEmailId);
    expect(inactiveEmail.data).toEqual([]);

    const anonymous = client();
    const anonymousEmail = await anonymous
      .from("email_messages")
      .select("id")
      .eq("id", rootEmailId);
    const anonymousAttachments = await anonymous
      .from("attachments")
      .select("id")
      .eq("email_message_id", rootEmailId);
    expect(
      anonymousEmail.error !== null || anonymousEmail.data?.length === 0,
    ).toBe(true);
    expect(
      anonymousAttachments.error !== null ||
        anonymousAttachments.data?.length === 0,
    ).toBe(true);
  });

  it("allows only admin manual linkage and reprocessing", async () => {
    const specialistLink = await specialist.rpc("manual_link_email", {
      p_application_id: rootApplicationId,
      p_email_message_id: unlinkedEmailId,
    });
    expect(specialistLink.error).not.toBeNull();

    const adminLink = await admin.rpc("manual_link_email", {
      p_application_id: rootApplicationId,
      p_email_message_id: unlinkedEmailId,
    });
    expect(adminLink.error).toBeNull();
    const linked = await admin
      .from("email_messages")
      .select("application_id")
      .eq("id", unlinkedEmailId)
      .single();
    expect(linked.data?.application_id).toBe(rootApplicationId);

    const specialistReprocess = await specialist.rpc("reprocess_email", {
      p_email_message_id: rootEmailId,
    });
    expect(specialistReprocess.error).not.toBeNull();
    const adminReprocess = await admin.rpc("reprocess_email", {
      p_email_message_id: rootEmailId,
    });
    expect(adminReprocess.error).toBeNull();
    expect(adminReprocess.data.processing_status).toBe("pending");
  });

  it("records the required ingestion audit trail without message bodies", async () => {
    const audit = await admin
      .from("audit_events")
      .select("action,metadata")
      .in("entity_id", emailIds);
    expect(audit.error).toBeNull();
    const actions = audit.data?.map((event) => event.action) ?? [];
    expect(actions).toEqual(
      expect.arrayContaining([
        "email.received",
        "email.duplicate_skipped",
        "email.reply_linked",
        "email.manual_linked",
        "email.reprocessed",
      ]),
    );
    expect(JSON.stringify(audit.data)).not.toContain("Integration fixture body");
  });
});
