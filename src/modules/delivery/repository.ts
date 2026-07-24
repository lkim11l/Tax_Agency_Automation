import { getOperationalContext } from "@/lib/auth/context";

export const DELIVERY_DRAFT_SELECT =
  "id,contract_version_id,draft_version:version,recipient,recipient_source,subject,body_text,attachment_filename,version_checksum,status,created_at,sent_at";
export const DELIVERY_DRAFT_ORDER_COLUMN = "version";

export type DeliveryStateErrorCode =
  | "DELIVERY_SCHEMA_MISMATCH"
  | "DELIVERY_STATE_UNAVAILABLE";

type QueryError = {
  code?: string;
  message: string;
};

function deliveryErrorCode(error: QueryError): DeliveryStateErrorCode {
  const message = error.message.toLowerCase();
  return error.code === "42703" ||
    error.code === "PGRST204" ||
    (message.includes("column") && message.includes("does not exist"))
    ? "DELIVERY_SCHEMA_MISMATCH"
    : "DELIVERY_STATE_UNAVAILABLE";
}

function logDeliveryError(source: string, error: QueryError) {
  const safeCode = deliveryErrorCode(error);
  console.error("delivery_state_load_failed", {
    safeCode,
    source,
    databaseCode: error.code ?? "UNKNOWN",
  });
  return safeCode;
}

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
      .select(DELIVERY_DRAFT_SELECT)
      .eq("application_id", applicationId)
      .order(DELIVERY_DRAFT_ORDER_COLUMN, { ascending: false }),
    supabase
      .from("contract_delivery_attempts")
      .select("id,delivery_draft_id,status,provider_message_id,safe_error_code,safe_error_message,started_at,completed_at")
      .eq("application_id", applicationId)
      .order("started_at", { ascending: false }),
  ]);
  const errors = [
    ["reviews", reviews.error],
    ["drafts", drafts.error],
    ["attempts", attempts.error],
  ] as const;
  const errorCodes = errors.flatMap(([source, error]) =>
    error ? [logDeliveryError(source, error)] : [],
  );

  return {
    reviews: reviews.data ?? [],
    drafts: drafts.data ?? [],
    attempts: attempts.data ?? [],
    errorCode: errorCodes.includes("DELIVERY_SCHEMA_MISMATCH")
      ? "DELIVERY_SCHEMA_MISMATCH" as const
      : errorCodes[0] ?? null,
  };
}
