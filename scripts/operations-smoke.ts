import { randomBytes } from "node:crypto";

import { runMailboxPipeline } from "../src/modules/operations/service";

async function main() {
  process.env.CRON_SECRET ||= randomBytes(32).toString("hex");
  const first = await runMailboxPipeline("smoke", process.env);
  const second = await runMailboxPipeline("smoke", process.env);

  if (!first.runId || !second.runId) {
    throw new Error("The hosted operations smoke test did not persist both runs.");
  }
  if (first.status === "failed" || second.status === "failed") {
    throw new Error("The hosted operations smoke test reported a failed run.");
  }

  console.log(JSON.stringify({
    ok: true,
    runs: [first.runId, second.runId],
    statuses: [first.status, second.status],
    processed: [first.processed, second.processed],
    note: "No clarification or contract delivery action is part of this pipeline.",
  }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown operations smoke error.";
  console.error(message);
  process.exitCode = 1;
});
