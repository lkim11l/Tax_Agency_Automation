import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns a structured healthy response without caching", async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "ok",
      service: "tax-agency-automation",
    });
    expect(new Date(body.timestamp).toString()).not.toBe("Invalid Date");
  });
});
