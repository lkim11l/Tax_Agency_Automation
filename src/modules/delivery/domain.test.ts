import { describe, expect, it } from "vitest";

import {
  buildDeliveryDraft,
  deliveryKey,
  safeDeliveryAuditMetadata,
  safeDeliveryFilename,
  validateDeliveryHeaders,
  validateReviewInput,
  verifyExactDocx,
} from "./domain";

describe("contract delivery domain", () => {
  it("requires a review reason for rejection and regeneration return", () => {
    expect(() => validateReviewInput({ decision: "rejected" })).toThrow();
    expect(() => validateReviewInput({
      decision: "returned_for_regeneration",
      comment: "  ",
    })).toThrow();
    expect(validateReviewInput({ decision: "approved" }).comment).toBeNull();
  });

  it("creates deterministic Russian delivery content", () => {
    const first = buildDeliveryDraft("REQ-2026-000001");
    expect(buildDeliveryDraft("REQ-2026-000001")).toEqual(first);
    expect(first.subject).toContain("REQ-2026-000001");
    expect(first.body).toContain("Налоговое агентство");
  });

  it("validates recipient and blocks header injection", () => {
    expect(validateDeliveryHeaders("Client@Example.test", "Contract")).toBe(
      "client@example.test",
    );
    expect(() => validateDeliveryHeaders(
      "client@example.test\r\nBcc: attacker@example.test",
      "Contract",
    )).toThrow();
    expect(() => validateDeliveryHeaders("invalid", "Contract")).toThrow();
    expect(() => validateDeliveryHeaders("client@example.test", "x\nBcc: y")).toThrow();
  });

  it("sanitizes client-controlled attachment names", () => {
    expect(safeDeliveryFilename("../../Договор № 1.docx")).toBe("Договор-No-1.docx");
    expect(() => safeDeliveryFilename("contract.pdf")).toThrow();
  });

  it("binds the exact DOCX signature and both checksums", async () => {
    const { sha256 } = await import("./domain");
    const content = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const checksum = sha256(content);
    expect(verifyExactDocx({
      content,
      expectedChecksum: checksum,
      approvalChecksum: checksum,
    })).toBe(checksum);
    expect(() => verifyExactDocx({
      content,
      expectedChecksum: "0".repeat(64),
      approvalChecksum: checksum,
    })).toThrow("CHECKSUM_MISMATCH");
    expect(() => verifyExactDocx({
      content: Buffer.from("not docx"),
      expectedChecksum: checksum,
      approvalChecksum: checksum,
    })).toThrow("SIGNATURE_INVALID");
  });

  it("builds stable version-bound idempotency keys", () => {
    const base = {
      contractVersionId: "v1",
      checksum: "a".repeat(64),
      recipient: "client@example.test",
      draftVersion: 1,
    };
    expect(deliveryKey(base)).toBe(deliveryKey(base));
    expect(deliveryKey({ ...base, draftVersion: 2 })).not.toBe(deliveryKey(base));
  });

  it("keeps audit metadata free of message and document bodies", () => {
    const metadata = safeDeliveryAuditMetadata({
      applicationId: "a",
      contractId: "c",
      contractVersionId: "v",
      checksum: "f".repeat(64),
      recipient: "client@example.test",
    });
    expect(metadata.recipient_domain).toBe("example.test");
    expect(JSON.stringify(metadata)).not.toContain("body");
    expect(JSON.stringify(metadata)).not.toContain("bank");
  });
});
