import { simpleParser } from "mailparser";

import { normalizeMessageId, parseReferences } from "./identifiers";
import type { EmailAddress, ProviderMessage } from "./types";

function addresses(
  value:
    | { value?: Array<{ address?: string; name?: string }> }
    | Array<{ value?: Array<{ address?: string; name?: string }> }>
    | undefined,
): EmailAddress[] {
  const entries = Array.isArray(value)
    ? value.flatMap((item) => item.value ?? [])
    : value?.value ?? [];
  return entries
    .filter((item) => Boolean(item.address))
    .map((item) => ({
      address: item.address!.toLowerCase(),
      ...(item.name ? { name: item.name } : {}),
    }));
}

function safeHeaders(headers: Map<string, unknown>): Record<string, string> {
  const allowed = new Set([
    "auto-submitted",
    "content-type",
    "message-id",
    "in-reply-to",
    "precedence",
    "references",
    "x-auto-response-suppress",
  ]);
  const result: Record<string, string> = {};
  for (const [name, value] of headers) {
    if (allowed.has(name.toLowerCase())) {
      result[name.toLowerCase()] = String(value).slice(0, 2000);
    }
  }
  return result;
}

export async function parseMimeMessage(input: {
  source: Buffer;
  uid: number;
  uidValidity: string;
  fallbackDate?: Date;
}): Promise<ProviderMessage> {
  const parsed = await simpleParser(input.source, {
    skipImageLinks: true,
    skipHtmlToText: false,
  });
  const sender = addresses(parsed.from)[0];
  if (!sender) {
    throw new Error("Malformed MIME message: sender address is missing.");
  }

  const rfcMessageId = normalizeMessageId(parsed.messageId);
  const providerMessageId =
    rfcMessageId ?? `imap:${input.uidValidity}:${input.uid}`;

  return {
    uid: input.uid,
    uidValidity: input.uidValidity,
    providerMessageId,
    rfcMessageId,
    inReplyTo: normalizeMessageId(parsed.inReplyTo),
    references: parseReferences(parsed.references),
    sender,
    recipients: addresses(parsed.to),
    cc: addresses(parsed.cc),
    subject: parsed.subject?.trim() || null,
    plainBody: parsed.text?.trim() || null,
    htmlBody: typeof parsed.html === "string" ? parsed.html : null,
    receivedAt: parsed.date ?? input.fallbackDate ?? new Date(),
    rawHeaders: safeHeaders(parsed.headers),
    attachments: parsed.attachments.map((attachment, index) => ({
      content: attachment.content,
      contentId: attachment.contentId,
      filename: attachment.filename || `attachment-${index + 1}`,
      mimeType: attachment.contentType.toLowerCase(),
      size: attachment.size,
    })),
  };
}
