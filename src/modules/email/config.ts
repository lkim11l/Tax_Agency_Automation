import { z } from "zod";

const booleanValue = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const portValue = z.coerce.number().int().min(1).max(65535);

export type EmailConfig = {
  provider: "mailru";
  from: string;
  imap: {
    host: string;
    port: number;
    secure: boolean;
    folder: string;
    username: string;
    password: string;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
  };
};

function required(
  environment: Record<string, string | undefined>,
  canonicalName: string,
  aliases: string[] = [],
): string {
  for (const name of [canonicalName, ...aliases]) {
    const value = environment[name]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required environment variable: ${canonicalName}`);
}

function optional(
  environment: Record<string, string | undefined>,
  canonicalName: string,
  aliases: string[] = [],
): string | undefined {
  for (const name of [canonicalName, ...aliases]) {
    const value = environment[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseNamed<T>(
  schema: z.ZodType<T>,
  name: string,
  value: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid environment variable: ${name}`);
  }
  return parsed.data;
}

export function loadEmailConfig(
  environment: Record<string, string | undefined> = process.env,
): EmailConfig {
  const providerValue = required(environment, "EMAIL_PROVIDER")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (providerValue !== "mailru") {
    throw new Error("Unsupported EMAIL_PROVIDER. Expected: mailru");
  }
  const provider = "mailru" as const;

  const username = required(environment, "EMAIL_IMAP_USERNAME", [
    "EMAIL_USERNAME",
  ]);
  const password = required(environment, "EMAIL_IMAP_PASSWORD", [
    "EMAIL_PASSWORD",
  ]);
  const imapPort = optional(environment, "EMAIL_IMAP_PORT", ["EMAIL_PORT"]) ?? "993";
  const smtpPort = optional(environment, "EMAIL_SMTP_PORT") ?? "465";

  return {
    provider,
    from: required(environment, "EMAIL_FROM"),
    imap: {
      host: required(environment, "EMAIL_IMAP_HOST", ["EMAIL_HOST"]),
      port: parseNamed(portValue, "EMAIL_IMAP_PORT", imapPort),
      secure: parseNamed(
        booleanValue,
        "EMAIL_IMAP_SECURE",
        optional(environment, "EMAIL_IMAP_SECURE") ?? "true",
      ),
      folder: optional(environment, "EMAIL_IMAP_FOLDER") ?? "INBOX",
      username,
      password,
    },
    smtp: {
      host: optional(environment, "EMAIL_SMTP_HOST") ?? "smtp.mail.ru",
      port: parseNamed(portValue, "EMAIL_SMTP_PORT", smtpPort),
      secure: parseNamed(
        booleanValue,
        "EMAIL_SMTP_SECURE",
        optional(environment, "EMAIL_SMTP_SECURE") ?? "true",
      ),
      username:
        optional(environment, "EMAIL_SMTP_USERNAME") ?? username,
      password:
        optional(environment, "EMAIL_SMTP_PASSWORD") ?? password,
    },
  };
}

export function loadSupabaseSecretConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  return {
    url: required(environment, "NEXT_PUBLIC_SUPABASE_URL"),
    secretKey: required(environment, "SUPABASE_SECRET_KEY", [
      "SUPABASE_SERVICE_ROLE_KEY",
    ]),
  };
}
