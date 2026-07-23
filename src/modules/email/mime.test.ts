import { describe, expect, it } from "vitest";

import { parseMimeMessage } from "./mime";

const fixture = Buffer.from(
  [
    "From: Sender <sender@example.test>",
    "To: Receiver <receiver@example.test>",
    "Cc: Copy <copy@example.test>",
    "Subject: Contract request",
    "Message-ID: <ROOT@EXAMPLE.TEST>",
    "In-Reply-To: <parent@example.test>",
    "References: <first@example.test> <parent@example.test>",
    "Date: Wed, 22 Jul 2026 12:00:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="boundary"',
    "",
    "--boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Plain body",
    "--boundary",
    "Content-Type: application/pdf",
    "Content-Disposition: attachment; filename=\"contract.pdf\"",
    "Content-Transfer-Encoding: base64",
    "",
    "dGVzdA==",
    "--boundary--",
  ].join("\r\n"),
);

describe("MIME parsing", () => {
  it("extracts bodies, addressing, threading and attachments", async () => {
    const message = await parseMimeMessage({
      source: fixture,
      uid: 42,
      uidValidity: "7",
    });
    expect(message.rfcMessageId).toBe("<root@example.test>");
    expect(message.inReplyTo).toBe("<parent@example.test>");
    expect(message.references).toEqual([
      "<first@example.test>",
      "<parent@example.test>",
    ]);
    expect(message.sender.address).toBe("sender@example.test");
    expect(message.recipients[0]?.address).toBe("receiver@example.test");
    expect(message.plainBody).toContain("Plain body");
    expect(message.attachments[0]).toMatchObject({
      filename: "contract.pdf",
      mimeType: "application/pdf",
      size: 4,
    });
  });

  it("uses mailbox identity safely when Message-ID is missing", async () => {
    const source = Buffer.from(
      "From: sender@example.test\r\nTo: receiver@example.test\r\n\r\nBody",
    );
    const message = await parseMimeMessage({
      source,
      uid: 5,
      uidValidity: "9",
    });
    expect(message.rfcMessageId).toBeNull();
    expect(message.providerMessageId).toBe("imap:9:5");
  });
});
