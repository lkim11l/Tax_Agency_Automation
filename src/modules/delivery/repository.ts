import { getOperationalContext } from "@/lib/auth/context";

export async function getDeliveryState(applicationId: string) {
  const { supabase } = await getOperationalContext();
  const [reviews, drafts, attempts] = await Promise.all([
    supabase
      .from("contract_version_reviews")
      .select("id,contract_version_id,decision,comment,reviewed_checksum:version_checksum,reviewed_at,reviewer:profiles!contract_version_reviews_reviewer_id_fkey(email,full_name)")
      .eq("application_id", applicationId)
      .order("reviewed_at", { ascending: false }),
    supabase
      .from("contract_delivery_drafts")
      .select("id,contract_version_id,draft_version:version,recipient,recipient_source,subject,body_text,attachment_filename,version_checksum,status,created_at,sent_at")
      .eq("application_id", applicationId)
      .order("draft_version", { ascending: false }),
    supabase
      .from("contract_delivery_attempts")
      .select("id,delivery_draft_id,status,provider_message_id,safe_error_code,safe_error_message,started_at,completed_at")
      .eq("application_id", applicationId)
      .order("started_at", { ascending: false }),
  ]);
  const error = reviews.error ?? drafts.error ?? attempts.error;
  if (error) throw new Error(`Unable to load delivery state: ${error.message}`);
  return {
    reviews: reviews.data ?? [],
    drafts: drafts.data ?? [],
    attempts: attempts.data ?? [],
  };
}
