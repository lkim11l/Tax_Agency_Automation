import { describe, expect, it } from "vitest";

import { isProtectedPath } from "./paths";

describe("isProtectedPath", () => {
  it.each([
    "/applications",
    "/applications/123",
    "/counterparties",
    "/templates",
    "/reports",
    "/settings",
  ])("protects %s", (pathname) => {
    expect(isProtectedPath(pathname)).toBe(true);
  });

  it.each(["/", "/login", "/api/health", "/applications-public"])(
    "does not protect %s",
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(false);
    },
  );
});
