import { describe, expect, it } from "vitest";

import { loadEmailConfig, loadSupabaseSecretConfig } from "./config";

describe("email config", () => {
  it("loads canonical names", () => {
    const config = loadEmailConfig({
      EMAIL_PROVIDER: "mailru",
      EMAIL_FROM: "mailbox@example.test",
      EMAIL_IMAP_HOST: "imap.example.test",
      EMAIL_IMAP_PORT: "993",
      EMAIL_IMAP_SECURE: "true",
      EMAIL_IMAP_FOLDER: "INBOX",
      EMAIL_IMAP_USERNAME: "user",
      EMAIL_IMAP_PASSWORD: "secret",
      EMAIL_SMTP_HOST: "smtp.example.test",
      EMAIL_SMTP_PORT: "465",
      EMAIL_SMTP_SECURE: "true",
      EMAIL_SMTP_USERNAME: "user",
      EMAIL_SMTP_PASSWORD: "secret",
    });
    expect(config.imap.host).toBe("imap.example.test");
    expect(config.smtp.host).toBe("smtp.example.test");
    expect(config.imap.secure).toBe(true);
  });

  it("supports Phase 2 compatibility aliases and Mail.ru defaults", () => {
    const config = loadEmailConfig({
      EMAIL_PROVIDER: "mailru",
      EMAIL_FROM: "mailbox@example.test",
      EMAIL_HOST: "imap.example.test",
      EMAIL_PORT: "993",
      EMAIL_USERNAME: "user",
      EMAIL_PASSWORD: "secret",
    });
    expect(config.imap.host).toBe("imap.example.test");
    expect(config.imap.port).toBe(993);
    expect(config.smtp.host).toBe("smtp.mail.ru");
    expect(config.smtp.port).toBe(465);
  });

  it("never includes secret values in validation errors", () => {
    const secret = "must-never-appear";
    expect(() =>
      loadEmailConfig({
        EMAIL_PROVIDER: "mailru",
        EMAIL_FROM: "mailbox@example.test",
        EMAIL_HOST: "imap.example.test",
        EMAIL_PORT: "not-a-port",
        EMAIL_USERNAME: "user",
        EMAIL_PASSWORD: secret,
      }),
    ).toThrowError(/EMAIL_IMAP_PORT/);
    try {
      loadEmailConfig({
        EMAIL_PROVIDER: "mailru",
        EMAIL_PASSWORD: secret,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("supports the legacy service-role variable without exposing it", () => {
    const config = loadSupabaseSecretConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.test",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-secret",
    });
    expect(config.secretKey).toBe("legacy-secret");
  });
});
