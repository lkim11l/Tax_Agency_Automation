import { describe, expect, it } from "vitest";

import { safeOperationalError } from "./errors";

describe("safe email errors", () => {
  it("classifies credential, TLS, timeout, storage and database failures", () => {
    expect(safeOperationalError(new Error("AUTHENTICATIONFAILED"))).toContain(
      "authentication failed",
    );
    expect(safeOperationalError(new Error("TLS certificate error"))).toContain(
      "TLS",
    );
    expect(safeOperationalError(new Error("socket timeout"))).toContain(
      "timed out",
    );
    expect(safeOperationalError(new Error("Storage bucket failed"))).toContain(
      "storage failed",
    );
    expect(safeOperationalError(new Error("database exploded"))).toContain(
      "Review the server diagnostics",
    );
  });

  it("does not echo unknown secrets", () => {
    const secret = "private-mail-password";
    expect(safeOperationalError(new Error(secret))).not.toContain(secret);
  });
});
