import { loadEmailConfig } from "./config";
import { MailruEmailProvider } from "./mailru-provider";
import type { EmailProvider } from "./types";

export function createEmailProvider(): EmailProvider {
  const config = loadEmailConfig();
  switch (config.provider) {
    case "mailru":
      return new MailruEmailProvider(config);
  }
}
