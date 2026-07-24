import { z } from "zod";

const seconds = z.coerce.number().int().min(30).max(900);
const attempts = z.coerce.number().int().min(1).max(3);
const minimumInterval = z.coerce.number().int().min(0).max(3600);
const batchSize = z.coerce.number().int().min(1).max(100);

export function loadOperationsConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  const cronSecret = environment.CRON_SECRET?.trim();
  if (!cronSecret || cronSecret.length < 16) {
    throw new Error("CRON_SECRET must contain at least 16 characters.");
  }
  return {
    cronSecret,
    environmentLabel: environment.APP_ENV?.trim() || "development",
    lockTimeoutSeconds: seconds.parse(
      environment.BACKGROUND_JOB_LOCK_TIMEOUT_SECONDS ?? "300",
    ),
    maximumAttempts: attempts.parse(
      environment.BACKGROUND_JOB_MAX_ATTEMPTS ?? "3",
    ),
    minimumIntervalSeconds: minimumInterval.parse(
      environment.BACKGROUND_JOB_MIN_INTERVAL_SECONDS ?? "60",
    ),
    documentBatchSize: batchSize.parse(
      environment.BACKGROUND_JOB_DOCUMENT_BATCH_SIZE ?? "25",
    ),
    extractionBatchSize: batchSize.parse(
      environment.BACKGROUND_JOB_EXTRACTION_BATCH_SIZE ?? "5",
    ),
  };
}
