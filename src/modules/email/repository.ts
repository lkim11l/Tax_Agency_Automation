import "server-only";

import { getOperationalContext } from "@/lib/auth/context";

export type MailboxState = {
  provider: string;
  folder: string;
  uid_validity: number | null;
  last_processed_uid: number;
  last_successful_sync: string | null;
  last_attempted_sync: string | null;
  last_error: string | null;
  sync_status: "idle" | "syncing" | "completed" | "failed";
  new_message_count: number;
  error_count: number;
};

export type EmailListItem = {
  id: string;
  application_id: string | null;
  sender: string;
  recipients: Array<{ address: string; name?: string }>;
  subject: string | null;
  plain_body: string | null;
  occurred_at: string;
  processing_status: "pending" | "processing" | "completed" | "failed";
  processing_error: string | null;
  mailbox_uid: number | null;
  attachments: Array<{
    id: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    parse_status: string;
  }>;
};

const emailSelect = `
  id,
  application_id,
  sender,
  recipients,
  subject,
  plain_body,
  occurred_at,
  processing_status,
  processing_error,
  mailbox_uid,
  attachments(id,original_filename,mime_type,size_bytes,parse_status)
`;

export async function getEmailOperations() {
  const { supabase, profile } = await getOperationalContext();
  const [states, unlinked, failed] = await Promise.all([
    supabase
      .from("mailbox_sync_state")
      .select(
        "provider,folder,uid_validity,last_processed_uid,last_successful_sync,last_attempted_sync,last_error,sync_status,new_message_count,error_count",
      )
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("email_messages")
      .select(emailSelect)
      .eq("direction", "inbound")
      .is("application_id", null)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase
      .from("email_messages")
      .select(emailSelect)
      .eq("processing_status", "failed")
      .order("occurred_at", { ascending: false })
      .limit(100),
  ]);
  const error = states.error ?? unlinked.error ?? failed.error;
  if (error) {
    throw new Error(`Unable to load email operations: ${error.message}`);
  }

  return {
    isAdmin: profile.role === "admin",
    state: (states.data?.[0] ?? null) as MailboxState | null,
    unlinked: (unlinked.data ?? []) as unknown as EmailListItem[],
    failed: (failed.data ?? []) as unknown as EmailListItem[],
  };
}

export async function listApplicationEmails(applicationId: string) {
  const { supabase } = await getOperationalContext();
  const { data, error } = await supabase
    .from("email_messages")
    .select(emailSelect)
    .eq("application_id", applicationId)
    .order("occurred_at", { ascending: true });
  if (error) {
    throw new Error(`Unable to load application correspondence: ${error.message}`);
  }
  return (data ?? []) as unknown as EmailListItem[];
}
