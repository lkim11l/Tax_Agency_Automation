import { runPendingExtractions } from "../src/modules/extraction/orchestrator";

async function main() {
  const results = await runPendingExtractions();
  console.log(
    JSON.stringify({
      processed: results.length,
      completed: results.filter((item) => item.status === "completed").length,
      cacheHits: results.filter((item) => item.status === "cache_hit").length,
      failed: results.filter((item) => item.status === "failed").length,
    }),
  );
  if (results.some((item) => item.status === "failed")) process.exitCode = 1;
}

main().catch(() => {
  console.error("Pending extraction command failed.");
  process.exitCode = 1;
});
