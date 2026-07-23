import { z } from "zod";

import { runExtraction } from "../src/modules/extraction/orchestrator";

async function main() {
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith("--application-id="))
    ?.split("=")[1];
  const applicationId = z.string().uuid().parse(argument);
  const force = process.argv.includes("--force");
  const result = await runExtraction({ applicationId, force });

  console.log(
    JSON.stringify({
      runId: result.runId,
      status: result.status,
      cacheHit: result.cacheHit,
      inputCharacters: result.inputCharacters,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      conflictCount: result.conflictCount,
      errorCode: result.errorCode ?? null,
    }),
  );
  if (result.status === "failed") process.exitCode = 1;
}

main().catch(() => {
  console.error("Extraction command failed.");
  process.exitCode = 1;
});
