import { parsePendingAttachments } from "../src/modules/documents/orchestrator";

async function main() {
  const results = await parsePendingAttachments();
  console.log(
    JSON.stringify({
      processed: results.length,
      statuses: results.reduce<Record<string, number>>((counts, item) => {
        counts[item.result.status] = (counts[item.result.status] ?? 0) + 1;
        return counts;
      }, {}),
    }),
  );
}

void main();
