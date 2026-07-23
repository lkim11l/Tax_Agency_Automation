import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing integration variable: ${name}`);
  return value;
}

function publicKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

function client(key = publicKey()) {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function signIn(instance: SupabaseClient, email: string, password: string) {
  const result = await instance.auth.signInWithPassword({
    email: required(email),
    password: required(password),
  });
  expect(result.error).toBeNull();
}

describe.sequential("hosted Supabase Phase 7 delivery security", () => {
  const service = client(process.env.SUPABASE_SECRET_KEY ?? required("SUPABASE_SERVICE_ROLE_KEY"));
  const anonymous = client();
  const specialist = client();
  const admin = client();
  const inactive = client();

  beforeAll(async () => {
    await signIn(specialist, "SUPABASE_TEST_SPECIALIST_EMAIL", "SUPABASE_TEST_SPECIALIST_PASSWORD");
    await signIn(admin, "SUPABASE_TEST_ADMIN_EMAIL", "SUPABASE_TEST_ADMIN_PASSWORD");
    await signIn(inactive, "SUPABASE_TEST_INACTIVE_EMAIL", "SUPABASE_TEST_INACTIVE_PASSWORD");
  });

  it("has all Phase 7 tables and columns", async () => {
    expect((await service.from("contract_version_reviews").select(
      "id,application_id,contract_id,contract_version_id,decision,version_checksum,reviewed_at",
    ).limit(1)).error).toBeNull();
    expect((await service.from("contract_delivery_drafts").select(
      "id,contract_version_id,version,recipient,status,version_checksum",
    ).limit(1)).error).toBeNull();
    expect((await service.from("contract_delivery_attempts").select(
      "id,delivery_draft_id,attempt_number,idempotency_key,status,attachment_checksum",
    ).limit(1)).error).toBeNull();
    expect((await service.from("contract_delivery_attachments").select(
      "id,delivery_attempt_id,email_message_id,checksum,file_size",
    ).limit(1)).error).toBeNull();
  });

  it("allows active reads but denies anonymous and inactive users", async () => {
    for (const table of [
      "contract_version_reviews",
      "contract_delivery_drafts",
      "contract_delivery_attempts",
      "contract_delivery_attachments",
    ]) {
      expect((await specialist.from(table).select("id").limit(1)).error).toBeNull();
      expect((await admin.from(table).select("id").limit(1)).error).toBeNull();
      const anonymousResult = await anonymous.from(table).select("id").limit(1);
      expect(anonymousResult.error !== null || anonymousResult.data?.length === 0).toBe(true);
      const inactiveResult = await inactive.from(table).select("id").limit(1);
      expect(inactiveResult.error !== null || inactiveResult.data?.length === 0).toBe(true);
    }
  });

  it("persists the exact outgoing version, immutable review and status/audit trail", async () => {
    const draft = await service.from("contract_delivery_drafts")
      .select("id,application_id,contract_id,contract_version_id,version_checksum,status")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(draft.error).toBeNull();
    expect(draft.data).not.toBeNull();
    if (!draft.data) return;

    const review = await service.from("contract_version_reviews")
      .select("id,decision,version_checksum")
      .eq("contract_version_id", draft.data.contract_version_id)
      .single();
    expect(review.data?.decision).toBe("approved");
    expect(review.data?.version_checksum).toBe(draft.data.version_checksum);
    expect((await service.from("contract_version_reviews")
      .update({ comment: "forbidden mutation" })
      .eq("id", review.data!.id)).error).not.toBeNull();

    const attempt = await service.from("contract_delivery_attempts")
      .select("id,status,outgoing_email_message_id,attachment_checksum")
      .eq("delivery_draft_id", draft.data.id)
      .eq("status", "sent")
      .single();
    expect(attempt.data?.attachment_checksum).toBe(draft.data.version_checksum);
    expect(attempt.data?.outgoing_email_message_id).toBeTruthy();
    expect((await service.from("contract_delivery_attachments")
      .select("checksum,contract_version_id")
      .eq("delivery_attempt_id", attempt.data!.id)
      .single()).data).toEqual(expect.objectContaining({
        checksum: draft.data.version_checksum,
        contract_version_id: draft.data.contract_version_id,
      }));
    expect((await service.from("email_messages")
      .select("id,direction,processing_status")
      .eq("id", attempt.data!.outgoing_email_message_id)
      .single()).data).toEqual(expect.objectContaining({
        direction: "outbound",
        processing_status: "completed",
      }));

    expect((await service.from("applications").select("status")
      .eq("id", draft.data.application_id).single()).data?.status).toBe("contract_sent");
    expect((await service.from("contracts").select("status")
      .eq("id", draft.data.contract_id).single()).data?.status).toBe("delivered");
    const version = await service.from("contract_versions").select("status,storage_path")
      .eq("id", draft.data.contract_version_id).single();
    expect(version.data?.status).toBe("delivered");
    expect((await specialist.storage.from("contract-documents")
      .download(version.data!.storage_path)).error).toBeNull();

    const history = await service.from("status_history").select("new_status")
      .eq("application_id", draft.data.application_id)
      .in("new_status", ["contract_revision_required", "contract_ready", "sending", "contract_sent"]);
    expect(new Set((history.data ?? []).map((item) => item.new_status))).toEqual(
      new Set(["contract_revision_required", "contract_ready", "sending", "contract_sent"]),
    );
    const audit = await service.from("audit_events").select("action,metadata")
      .eq("application_id", draft.data.application_id)
      .in("action", [
        "contract.review_opened",
        "contract.rejected",
        "contract.approved",
        "contract.delivery_started",
        "contract.delivered",
        "contract.delivery_cache_hit",
      ]);
    const actions = new Set((audit.data ?? []).map((item) => item.action));
    for (const action of [
      "contract.review_opened",
      "contract.rejected",
      "contract.approved",
      "contract.delivery_started",
      "contract.delivered",
      "contract.delivery_cache_hit",
    ]) expect(actions.has(action)).toBe(true);
    expect(JSON.stringify(audit.data)).not.toMatch(/smtp_password|bank_account|body_text/iu);
  });

  it("denies direct specialist mutations and service-only RPCs", async () => {
    const mutation = await specialist.from("contract_version_reviews").insert({
      application_id: "00000000-0000-0000-0000-000000000000",
      contract_id: "00000000-0000-0000-0000-000000000000",
      contract_version_id: "00000000-0000-0000-0000-000000000000",
      reviewer_id: "00000000-0000-0000-0000-000000000000",
      decision: "approved",
      reviewed_checksum: "0".repeat(64),
      source_fingerprint: "0".repeat(64),
    });
    expect(mutation.error).not.toBeNull();
    const rpc = await specialist.rpc("claim_contract_delivery", {
      p_delivery_draft_id: "00000000-0000-0000-0000-000000000000",
      p_actor_id: "00000000-0000-0000-0000-000000000000",
      p_delivery_key: "0".repeat(64),
      p_idempotency_key: "forbidden",
      p_rfc_message_id: "<forbidden@example.invalid>",
      p_attachment_size: 4,
    });
    expect(rpc.error).not.toBeNull();
  });
});
