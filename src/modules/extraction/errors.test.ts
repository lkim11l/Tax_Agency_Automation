import { describe, expect, it } from "vitest";

import { ExtractionError, toSafeExtractionError } from "./errors";

describe("safe extraction errors", () => {
  it("classifies retryable rate limits and server errors", () => {
    expect(toSafeExtractionError({ status: 429 }).retryable).toBe(true);
    expect(toSafeExtractionError({ status: 503 }).retryable).toBe(true);
  });

  it("does not retry authentication, refusal, or malformed output", () => {
    expect(toSafeExtractionError({ status: 401 }).retryable).toBe(false);
    expect(new ExtractionError("REFUSED", "Request refused.").retryable).toBe(false);
    expect(
      new ExtractionError("MALFORMED_OUTPUT", "Invalid response.").retryable,
    ).toBe(false);
  });

  it("does not leak provider exception text", () => {
    expect(toSafeExtractionError(new Error("secret request body")).message).toBe(
      "Structured extraction failed.",
    );
  });
});
