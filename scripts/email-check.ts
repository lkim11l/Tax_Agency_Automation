import { safeOperationalError } from "../src/modules/email/errors";
import { createEmailProvider } from "../src/modules/email/provider";

async function main() {
  let provider: ReturnType<typeof createEmailProvider> | null = null;
  let failed = false;
  try {
    provider = createEmailProvider();
    try {
      await provider.verifyImap();
      console.log("IMAP verification: passed");
    } catch (error) {
      console.error(`IMAP verification failed: ${safeOperationalError(error)}`);
      failed = true;
    }
    try {
      await provider.verifySmtp();
      console.log("SMTP verification: passed");
    } catch (error) {
      console.error(`SMTP verification failed: ${safeOperationalError(error)}`);
      failed = true;
    }
  } catch (error) {
    console.error(`Email configuration failed: ${safeOperationalError(error)}`);
    failed = true;
  } finally {
    await provider?.close();
    if (failed) process.exitCode = 1;
  }
}

void main();
