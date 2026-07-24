import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperationalContext: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getOperationalContext: mocks.getOperationalContext,
}));

import {
  DELIVERY_DRAFT_ORDER_COLUMN,
  DELIVERY_DRAFT_SELECT,
  getDeliveryState,
} from "./repository";

type QueryResult = {
  data: unknown[] | null;
  error: { code?: string; message: string } | null;
};

function query(result: QueryResult, orders: string[]) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockImplementation((column: string) => {
    orders.push(column);
    return Promise.resolve(result);
  });
  return builder;
}

function context(results: Record<string, QueryResult>, orders: string[]) {
  return {
    supabase: {
      from: vi.fn((table: string) =>
        query(results[table] ?? { data: [], error: null }, orders)),
    },
  };
}

describe("delivery state repository", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the canonical version column while exposing draft_version", async () => {
    const orders: string[] = [];
    mocks.getOperationalContext.mockResolvedValue(context({
      contract_delivery_drafts: {
        data: [{
          id: "draft-1",
          contract_version_id: "version-1",
          draft_version: 1,
          recipient: "operator@example.test",
          recipient_source: "manual",
          subject: "Contract",
          body_text: "Attached.",
          attachment_filename: "contract.docx",
          version_checksum: "a".repeat(64),
          status: "draft",
          created_at: "2026-07-23T00:00:00Z",
          sent_at: null,
        }],
        error: null,
      },
    }, orders));

    const state = await getDeliveryState("application-1");

    expect(DELIVERY_DRAFT_SELECT).toContain("draft_version:version");
    expect(DELIVERY_DRAFT_ORDER_COLUMN).toBe("version");
    expect(orders).toContain("version");
    expect(state.drafts[0]).toEqual(expect.objectContaining({ draft_version: 1 }));
    expect(state.errorCode).toBeNull();
  });

  it("returns a valid empty state when an application has no delivery draft", async () => {
    mocks.getOperationalContext.mockResolvedValue(context({}, []));

    await expect(getDeliveryState("new-email-application")).resolves.toEqual({
      reviews: [],
      drafts: [],
      attempts: [],
      errorCode: null,
    });
  });

  it("keeps available relationships when an optional delivery query fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getOperationalContext.mockResolvedValue(context({
      contract_version_reviews: {
        data: [{
          id: "review-1",
          reviewer: null,
        }],
        error: null,
      },
      contract_delivery_drafts: {
        data: null,
        error: {
          code: "42703",
          message: "column contract_delivery_drafts.draft_version does not exist",
        },
      },
      contract_delivery_attempts: {
        data: [{ id: "attempt-1" }],
        error: null,
      },
    }, []));

    const state = await getDeliveryState("application-1");

    expect(state.reviews).toEqual([{ id: "review-1", reviewer: null }]);
    expect(state.drafts).toEqual([]);
    expect(state.attempts).toEqual([{ id: "attempt-1" }]);
    expect(state.errorCode).toBe("DELIVERY_SCHEMA_MISMATCH");
    expect(consoleError).toHaveBeenCalledWith("delivery_state_load_failed", {
      safeCode: "DELIVERY_SCHEMA_MISMATCH",
      source: "drafts",
      databaseCode: "42703",
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "contract_delivery_drafts.draft_version",
    );
  });
});
