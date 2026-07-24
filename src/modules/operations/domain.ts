export type JobTrigger = "cron" | "manual" | "smoke";
export type JobStatus =
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed";
export type ComponentName =
  | "application"
  | "supabase"
  | "storage"
  | "mailru_imap"
  | "mailru_smtp"
  | "openai"
  | "mailbox_sync"
  | "background_jobs";
export type ComponentStatus = "healthy" | "degraded" | "unavailable" | "unknown";

export type StageResult = {
  status: "completed" | "completed_with_errors" | "failed" | "skipped";
  attempts: number;
  durationMs: number;
  processed: number;
  errors: number;
  safeErrorCode?: string;
};

export type BackgroundRun = {
  id: string;
  job_type: "mailbox_pipeline" | "health_probe";
  trigger_source: JobTrigger;
  status: JobStatus;
  started_at: string;
  heartbeat_at: string;
  completed_at: string | null;
  stage_results: Record<string, StageResult>;
  items_processed: number;
  error_count: number;
  safe_error_code: string | null;
  safe_error_message: string | null;
};

export type ComponentHealth = {
  component: ComponentName;
  status: ComponentStatus;
  checked_at: string;
  last_success_at: string | null;
  safe_error_code: string | null;
  safe_error_message: string | null;
  metadata: Record<string, unknown>;
};

export function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/credential|authentication|unauthorized|forbidden/u.test(message)) {
    return { code: "AUTHENTICATION_FAILED", message: "Authentication failed." };
  }
  if (/rate.?limit|too many requests/u.test(message)) {
    return { code: "RATE_LIMITED", message: "The provider rate limit was reached." };
  }
  if (/timeout|timed out/u.test(message)) {
    return { code: "TIMEOUT", message: "The operation timed out." };
  }
  if (/network|socket|connect|unavailable|econn/u.test(message)) {
    return { code: "SERVICE_UNAVAILABLE", message: "The dependency is unavailable." };
  }
  if (/storage/u.test(message)) {
    return { code: "STORAGE_UNAVAILABLE", message: "Storage is unavailable." };
  }
  return { code: "OPERATION_FAILED", message: "The operation failed safely." };
}
