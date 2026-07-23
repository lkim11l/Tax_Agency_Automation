import { describe, expect, it } from "vitest";

import {
  attachmentStoragePath,
  MAX_ATTACHMENT_BYTES,
  sanitizeFilename,
  sha256,
  validateAttachment,
} from "./attachments";

describe("email attachments", () => {
  it("sanitizes filenames and prevents path traversal", () => {
    expect(sanitizeFilename("../../contract test.pdf")).toBe("contract_test.pdf");
    expect(sanitizeFilename("..\\..\\agreement.docx")).toBe("agreement.docx");
  });

  it("calculates SHA-256", () => {
    expect(sha256(Buffer.from("test"))).toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
  });

  it("blocks executable and oversized attachments", () => {
    expect(
      validateAttachment({
        filename: "payload.exe",
        mimeType: "application/pdf",
        size: 10,
      }).allowed,
    ).toBe(false);
    expect(
      validateAttachment({
        filename: "large.pdf",
        mimeType: "application/pdf",
        size: MAX_ATTACHMENT_BYTES + 1,
      }).allowed,
    ).toBe(false);
  });

  it("creates deterministic safe paths for duplicate filenames", () => {
    const first = attachmentStoragePath({
      applicationId: "application",
      emailMessageId: "message",
      filename: "contract.pdf",
      checksum: "a".repeat(64),
    });
    const second = attachmentStoragePath({
      applicationId: "application",
      emailMessageId: "message",
      filename: "contract.pdf",
      checksum: "b".repeat(64),
    });
    expect(first).not.toBe(second);
    expect(first).not.toContain("..");
  });
});
