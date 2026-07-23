import { describe, expect, it } from "vitest";

import { normalizeMessageId, parseReferences } from "./identifiers";

describe("email identifiers", () => {
  it("normalizes Message-ID values", () => {
    expect(normalizeMessageId(" Message@Example.COM ")).toBe(
      "<message@example.com>",
    );
    expect(normalizeMessageId("<Message@Example.COM>")).toBe(
      "<message@example.com>",
    );
    expect(normalizeMessageId(null)).toBeNull();
  });

  it("parses and deduplicates References", () => {
    expect(parseReferences("<one@test> <TWO@test> <one@test>")).toEqual([
      "<one@test>",
      "<two@test>",
    ]);
  });
});
