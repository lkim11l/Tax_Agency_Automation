import type { SupabaseClient } from "@supabase/supabase-js";

import { getOperationalContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin.server";

import type {
  BackgroundRun,
  ComponentHealth,
  ComponentName,
  ComponentStatus,
  JobStatus,
  JobTrigger,
  StageResult,
} from "./domain";

export async function claimJob(
  input: {
    jobType: "mailbox_pipeline" | "health_probe";
    trigger: JobTrigger;
    lockTimeoutSeconds: number;
    minimumIntervalSeconds: number;
  },
  admin: SupabaseClient,
) {
  const result = await admin.rpc("claim_background_job", {
    p_job_type: input.jobType,
    p_trigger_source: input.trigger,
    p_lock_timeout_seconds: input.lockTimeoutSeconds,
    p_minimum_interval_seconds: input.minimumIntervalSeconds,
  });
  if (result.error || !result.data) {
    throw new Error(`Unable to claim background job: ${result.error?.message ?? "unknown"}`);
  }
  return result.data as { claimed: boolean; reason: string | null; run_id: string | null };
}

export async function heartbeatJob(
  runId: string,
  stages: Record<string, StageResult>,
  processed: number,
  errors: number,
  admin: SupabaseClient,
) {
  const result = await admin.rpc("heartbeat_background_job", {
    p_run_id: runId,
    p_stage_results: stages,
    p_items_processed: processed,
    p_error_count: errors,
  });
  if (result.error) throw new Error("Unable to persist background job progress.");
}

export async function finishJob(
  input: {
    runId: string;
    status: Exclude<JobStatus, "running">;
    stages: Record<string, StageResult>;
    processed: number;
    errors: number;
    safeErrorCode?: string | null;
    safeErrorMessage?: string | null;
  },
  admin: SupabaseClient,
) {
  const result = await admin.rpc("finish_background_job", {
    p_run_id: input.runId,
    p_status: input.status,
    p_stage_results: input.stages,
    p_items_processed: input.processed,
    p_error_count: input.errors,
    p_safe_error_code: input.safeErrorCode ?? null,
    p_safe_error_message: input.safeErrorMessage ?? null,
  });
  if (result.error) throw new Error("Unable to finalize background job.");
}

export async function recordComponentHealth(
  input: {
    component: ComponentName;
    status: ComponentStatus;
    runId?: string | null;
    safeErrorCode?: string | null;
    safeErrorMessage?: string | null;
    metadata?: Record<string, unknown>;
  },
  admin: SupabaseClient,
) {
  const result = await admin.rpc("record_component_health", {
    p_component: input.component,
    p_status: input.status,
    p_run_id: input.runId ?? null,
    p_safe_error_code: input.safeErrorCode ?? null,
    p_safe_error_message: input.safeErrorMessage ?? null,
    p_metadata: input.metadata ?? {},
  });
  if (result.error) throw new Error(`Unable to persist ${input.component} health.`);
}

export async function getSystemOperations() {
  const { profile, supabase } = await getOperationalContext();
  if (profile.role !== "admin") throw new Error("Administrator access is required.");
  const [components, runs] = await Promise.all([
    supabase.from("system_component_status").select("*").order("component"),
    supabase.from("background_job_runs").select("*")
      .order("started_at", { ascending: false }).limit(30),
  ]);
  const error = components.error ?? runs.error;
  if (error) throw new Error("Unable to load system operations.");
  return {
    components: (components.data ?? []) as ComponentHealth[],
    runs: (runs.data ?? []) as BackgroundRun[],
  };
}

export async function getPublicHealthSnapshot() {
  const admin = createAdminClient();
  const [components, latestRun, failedRuns] = await Promise.all([
    admin.from("system_component_status")
      .select("component,status,checked_at,last_success_at").order("component"),
    admin.from("background_job_runs")
      .select("status,started_at,completed_at")
      .eq("job_type", "mailbox_pipeline")
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("background_job_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("started_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);
  const error = components.error ?? latestRun.error ?? failedRuns.error;
  if (error) throw new Error("Health persistence is unavailable.");
  return {
    components: components.data ?? [],
    lastMailboxRun: latestRun.data ?? null,
    failedJobsLast24Hours: failedRuns.count ?? 0,
  };
}
