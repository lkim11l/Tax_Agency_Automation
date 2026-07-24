import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  it("fails safely with a structured response when dependencies are unavailable", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "degraded",
      service: "tax-agency-automation",
    });
    expect(new Date(body.timestamp).toString()).not.toBe("Invalid Date");
  });
});
