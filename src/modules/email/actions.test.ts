import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(location);
  }
}

const redirect = vi.fn((location: string): never => {
  throw new RedirectSignal(location);
});
const revalidatePath = vi.fn();
const syncMailbox = vi.fn();

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/context", () => ({
  getOperationalContext: vi.fn(async () => ({
    profile: { role: "admin" },
    supabase: {},
  })),
}));
vi.mock("@/lib/supabase/admin.server", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("./ingestion", () => ({
  reprocessMessageByUid: vi.fn(),
  syncMailbox,
}));

describe("email server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not convert a successful sync redirect into an error redirect", async () => {
    syncMailbox.mockResolvedValue({
      applicationCreated: 0,
      attachmentsStored: 0,
      duplicateSkipped: 0,
      errors: 0,
      ignored: 0,
      messagesProcessed: 0,
      repliesLinked: 0,
      unlinkedReplies: 0,
    });
    const { syncEmailAction } = await import("./actions");

    await expect(syncEmailAction()).rejects.toMatchObject({
      location: expect.stringContaining("/email?success="),
    });
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/email");
  });
});
