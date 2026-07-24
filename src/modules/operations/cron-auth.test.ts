import { describe, expect, it } from "vitest";

import { isAuthorizedCronRequest } from "./cron-auth";

describe("cron authorization", () => {
  const environment = { CRON_SECRET: "0123456789abcdef0123456789abcdef" };

  it("accepts the configured bearer token", () => {
    const request = new Request("https://example.test/api/cron/mailbox", {
      headers: { authorization: `Bearer ${environment.CRON_SECRET}` },
    });
    expect(isAuthorizedCronRequest(request, environment)).toBe(true);
  });

  it.each([
    undefined,
    "Bearer wrong",
    "Basic 0123456789abcdef0123456789abcdef",
  ])("rejects an invalid authorization header", (authorization) => {
    const headers = authorization ? { authorization } : undefined;
    expect(
      isAuthorizedCronRequest(
        new Request("https://example.test/api/cron/mailbox", { headers }),
        environment,
      ),
    ).toBe(false);
  });

  it("fails closed when the secret is missing or too short", () => {
    const request = new Request("https://example.test/api/cron/mailbox", {
      headers: { authorization: "Bearer short" },
    });
    expect(isAuthorizedCronRequest(request, {})).toBe(false);
    expect(isAuthorizedCronRequest(request, { CRON_SECRET: "short" })).toBe(false);
  });
});
