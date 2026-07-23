import { describe, expect, it } from "vitest";

import { shouldIgnoreMessage } from "./ingestion";
import type { ProviderMessage } from "./types";

function message(sender: string, headers: Record<string, string> = {}) {
  return {
    uid: 1,
    uidValidity: "1",
    providerMessageId: "<id@test>",
    rfcMessageId: "<id@test>",
    inReplyTo: null,
    references: [],
    sender: { address: sender },
    recipients: [],
    cc: [],
    subject: "Subject",
    plainBody: "Body",
    htmlBody: null,
    receivedAt: new Date(),
    rawHeaders: headers,
    attachments: [],
  } satisfies ProviderMessage;
}

describe("ingestion filtering", () => {
  it("ignores messages from the configured mailbox", () => {
    expect(
      shouldIgnoreMessage(
        message("mailbox@example.test"),
        "mailbox@example.test",
      ),
    ).toBe(true);
  });

  it("ignores reliable bounce and auto-response markers", () => {
    expect(
      shouldIgnoreMessage(message("mailer-daemon@example.test"), "mailbox@test"),
    ).toBe(true);
    expect(
      shouldIgnoreMessage(
        message("sender@example.test", { "auto-submitted": "auto-replied" }),
        "mailbox@test",
      ),
    ).toBe(true);
  });

  it("accepts ordinary external messages", () => {
    expect(
      shouldIgnoreMessage(message("client@example.test"), "mailbox@example.test"),
    ).toBe(false);
  });
});
