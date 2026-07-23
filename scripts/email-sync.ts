import { safeOperationalError } from "../src/modules/email/errors";
import { syncMailbox } from "../src/modules/email/ingestion";

async function main() {
  try {
    const result = await syncMailbox();
    console.log(
      JSON.stringify({
        status: result.errors === 0 ? "completed" : "completed_with_errors",
        ...result,
      }),
    );
    if (result.errors > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Email synchronization failed: ${safeOperationalError(error)}`);
    process.exitCode = 1;
  }
}

void main();
