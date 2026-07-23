import { describe, expect, it } from "vitest";

import { sanitizePostgrestSearchTerm } from "./filter";

describe("sanitizePostgrestSearchTerm", () => {
  it("removes PostgREST filter syntax characters", () => {
    expect(sanitizePostgrestSearchTerm("Demo%,id.eq.secret")).toBe(
      "Demo id eq secret",
    );
  });
});
