import { describe, expect, it } from "vitest";

import { toApplicationListState } from "./list-state";

describe("application list state", () => {
  it("shows a database failure as an error instead of a false empty state", () => {
    expect(toApplicationListState(null, { message: "database unavailable" })).toEqual({
      kind: "error",
      message: "database unavailable",
    });
  });

  it("uses an empty state only for a successful empty query", () => {
    expect(toApplicationListState([], null)).toEqual({ kind: "empty", items: [] });
  });
});
