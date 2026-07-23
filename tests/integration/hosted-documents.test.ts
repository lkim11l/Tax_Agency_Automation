import { createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseAttachment } from "@/modules/documents/orchestrator";
import {
  syntheticDocx,
  syntheticPdf,
  syntheticXlsx,
} from "@/modules/documents/test-fixtures";

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
  return process.env.SUPABASE_SECRET_KEY ?? required("SUPABASE_SERVICE_ROLE_KEY");
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
  return result.data.user!;
}

describe.sequential("hosted Supabase Phase 3 document acceptance", () => {
  const runId = `phase3-${Date.now()}`;
  const storagePaths: string[] = [];
  const attachmentIds = new Map<string, string>();
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let specialist: SupabaseClient;
  let inactive: SupabaseClient;
  let applicationId: string;

  beforeAll(async () => {
    service = client(secretKey());
    admin = client();
    specialist = client();
    inactive = client();
    const adminUser = await signIn(
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

    const application = await admin
      .from("applications")
      .insert({
        title: `Hosted Phase 3 ${runId}`,
        source: "manual",
        status: "new",
        priority: "normal",
        received_at: new Date().toISOString(),
        created_by: adminUser.id,
      })
      .select("id")
      .single();
    expect(application.error).toBeNull();
    applicationId = application.data!.id;

    const fixtures = [
      { name: "source.txt", mime: "text/plain", content: Buffer.from("Phase 3 hosted text") },
      {
        name: "contract.docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content: syntheticDocx(),
      },
      { name: "request.pdf", mime: "application/pdf", content: syntheticPdf() },
      {
        name: "request.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content: await syntheticXlsx(),
      },
      {
        name: "scan.png",
        mime: "image/png",
        content: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
        ]),
      },
      {
        name: "unsupported.rtf",
        mime: "application/rtf",
        content: Buffer.from("{\\rtf1 hosted unsupported fixture}"),
      },
    ];

    for (const fixture of fixtures) {
      const checksum = createHash("sha256").update(fixture.content).digest("hex");
      const storagePath = `applications/${applicationId}/phase3/${runId}-${fixture.name}`;
      storagePaths.push(storagePath);
      const upload = await service.storage
        .from("email-attachments")
        .upload(storagePath, fixture.content, { contentType: fixture.mime });
      expect(upload.error).toBeNull();
      const metadata = await service
        .from("attachments")
        .insert({
          application_id: applicationId,
          email_message_id: null,
          original_filename: fixture.name,
          sanitized_filename: fixture.name,
          mime_type: fixture.mime,
          size_bytes: fixture.content.length,
          storage_path: storagePath,
          checksum,
          parse_status: "pending",
        })
        .select("id")
        .single();
      expect(metadata.error).toBeNull();
      attachmentIds.set(fixture.name, metadata.data!.id);
    }
  }, 60_000);

  afterAll(async () => {
    if (storagePaths.length > 0) {
      await service.storage.from("email-attachments").remove(storagePaths);
    }
    if (applicationId) {
      await service.from("applications").delete().eq("id", applicationId);
    }
    await Promise.all([
      admin?.auth.signOut(),
      specialist?.auth.signOut(),
      inactive?.auth.signOut(),
    ]);
  });

  it("creates Phase 3 tables and denies anonymous and inactive reads", async () => {
    for (const table of ["parsed_documents", "document_parse_attempts"]) {
      expect((await admin.from(table).select("id").limit(1)).error).toBeNull();
      const anonymous = await client().from(table).select("id").limit(1);
      expect(anonymous.error !== null || anonymous.data?.length === 0).toBe(true);
      const denied = await inactive.from(table).select("id").limit(1);
      expect(denied.data).toEqual([]);
    }
  });

  it("claims an attachment only once under concurrency and finalizes atomically", async () => {
    const id = attachmentIds.get("source.txt")!;
    const [first, second] = await Promise.all([
      service.rpc("claim_attachment_for_parsing", { p_attachment_id: id }),
      service.rpc("claim_attachment_for_parsing", { p_attachment_id: id }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const claims = [first.data, second.data].filter(Boolean);
    expect(claims).toHaveLength(1);
    const claim = claims[0] as { attempt_id: string };
    const finalized = await service.rpc("finalize_document_parse", {
      p_attachment_id: id,
      p_attempt_id: claim.attempt_id,
      p_result: {
        status: "parsed",
        parser_type: "integration",
        parser_version: "1",
        normalized_text: "Phase 3 hosted text",
        source_metadata: { fixture: true },
        warnings: [],
      },
    });
    expect(finalized.error).toBeNull();
  });

  it("parses DOCX, PDF and XLSX and preserves source markers", async () => {
    for (const name of ["contract.docx", "request.pdf", "request.xlsx"]) {
      const result = await parseAttachment(attachmentIds.get(name), service);
      expect(result?.result.status, name).toBe("parsed");
    }
    const rows = await admin
      .from("parsed_documents")
      .select("attachment_id,normalized_text,source_metadata")
      .in("attachment_id", [
        attachmentIds.get("contract.docx")!,
        attachmentIds.get("request.pdf")!,
        attachmentIds.get("request.xlsx")!,
      ]);
    expect(rows.error).toBeNull();
    const allText = rows.data?.map((row) => row.normalized_text).join("\n") ?? "";
    expect(allText).toContain("INN | 1234567890");
    expect(allText).toContain("[PAGE 1]");
    expect(allText).toContain("[SHEET: Request]");
  }, 60_000);

  it("routes images to OCR review and unsupported files to visible fallback", async () => {
    const image = await parseAttachment(attachmentIds.get("scan.png"), service);
    const unsupported = await parseAttachment(
      attachmentIds.get("unsupported.rtf"),
      service,
    );
    expect(image?.result).toMatchObject({
      status: "review_required",
      errorCode: "OCR_REQUIRED",
    });
    expect(unsupported?.result).toMatchObject({
      status: "unsupported",
      errorCode: "UNSUPPORTED_FORMAT",
    });
  });

  it("allows active users to read results but only admin to request retries", async () => {
    const specialistRead = await specialist
      .from("parsed_documents")
      .select("attachment_id,status")
      .eq("application_id", applicationId);
    expect(specialistRead.error).toBeNull();
    expect(specialistRead.data?.length).toBe(6);

    const target = attachmentIds.get("source.txt")!;
    const specialistRetry = await specialist.rpc("request_document_parse", {
      p_attachment_id: target,
    });
    expect(specialistRetry.error).not.toBeNull();
    const adminRetry = await admin.rpc("request_document_parse", {
      p_attachment_id: target,
    });
    expect(adminRetry.error).toBeNull();
    expect((await parseAttachment(target, service))?.result.status).toBe("parsed");
  });

  it("preserves immutable attempts, current result and required audit", async () => {
    const target = attachmentIds.get("source.txt")!;
    const attempts = await admin
      .from("document_parse_attempts")
      .select("id,status")
      .eq("attachment_id", target)
      .order("started_at");
    expect(attempts.error).toBeNull();
    expect(attempts.data).toHaveLength(2);
    expect(attempts.data?.every((row) => row.status === "parsed")).toBe(true);

    const mutation = await admin
      .from("document_parse_attempts")
      .update({ error_message: "tampered" })
      .eq("id", attempts.data![0]!.id)
      .select("id");
    expect(mutation.error).toBeNull();
    expect(mutation.data).toEqual([]);
    const privilegedMutation = await service
      .from("document_parse_attempts")
      .update({ error_message: "tampered" })
      .eq("id", attempts.data![0]!.id);
    expect(privilegedMutation.error).not.toBeNull();

    const current = await admin
      .from("parsed_documents")
      .select("status,text_length")
      .eq("attachment_id", target)
      .single();
    expect(current.data).toEqual({ status: "parsed", text_length: 19 });

    const audit = await admin
      .from("audit_events")
      .select("action,metadata")
      .eq("application_id", applicationId);
    const actions = audit.data?.map((event) => event.action) ?? [];
    expect(actions).toEqual(
      expect.arrayContaining([
        "document.parse_started",
        "document.parsed",
        "document.parse_review_required",
        "document.parse_unsupported",
        "document.parse_warning",
        "document.parse_retried",
      ]),
    );
    expect(JSON.stringify(audit.data)).not.toContain("Phase 3 hosted text");
  });

  it("enforces constraints, private Storage and no user result writes", async () => {
    const target = attachmentIds.get("source.txt")!;
    const invalid = await service.from("parsed_documents").insert({
      attachment_id: target,
      application_id: applicationId,
      status: "parsed",
      parser_type: "invalid",
      parser_version: "1",
      normalized_text: "abc",
      text_length: 999,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
    expect(invalid.error).not.toBeNull();

    const userWrite = await admin
      .from("parsed_documents")
      .update({ normalized_text: "tampered", text_length: 8 })
      .eq("attachment_id", target)
      .select("attachment_id");
    expect(userWrite.error).toBeNull();
    expect(userWrite.data).toEqual([]);
    const unchanged = await admin
      .from("parsed_documents")
      .select("normalized_text")
      .eq("attachment_id", target)
      .single();
    expect(unchanged.data?.normalized_text).toBe("Phase 3 hosted text");

    const path = storagePaths[0]!;
    expect(
      (await specialist.storage.from("email-attachments").createSignedUrl(path, 60))
        .error,
    ).toBeNull();
    expect(
      (await client().storage.from("email-attachments").createSignedUrl(path, 60))
        .error,
    ).not.toBeNull();
  });
});
