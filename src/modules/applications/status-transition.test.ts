import { describe, expect, it } from "vitest";

import { describeStatusTransition } from "./status-transition";

describe("status transition records", () => {
  it("creates matching status history and audit drafts", () => {
    const result = describeStatusTransition({
      applicationId: "30000000-0000-4000-8000-000000000001",
      previousStatus: "new",
      newStatus: "processing",
      actorId: "00000000-0000-4000-8000-000000000001",
      reason: "Work started",
    });

    expect(result.history).toMatchObject({
      previous_status: "new",
      new_status: "processing",
      reason: "Work started",
    });
    expect(result.audit).toMatchObject({
      action: "application.status_changed",
      metadata: { previous_status: "new", new_status: "processing" },
    });
  });
});
