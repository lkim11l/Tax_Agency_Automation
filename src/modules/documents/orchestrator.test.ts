import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { parseAttachment } from "./orchestrator";

function mockClient(content: Buffer, filename = "request.txt", mime = "text/plain") {
  const finalized: Array<Record<string, unknown>> = [];
  let claimed = false;
  const checksum = createHash("sha256").update(content).digest("hex");
  const rpc = vi.fn(async (name: string, parameters: Record<string, unknown>) => {
    if (name === "claim_attachment_for_parsing") {
      if (claimed) return { data: null, error: null };
      claimed = true;
      return {
        data: {
          attachment_id: "00000000-0000-4000-8000-000000000001",
          application_id: "00000000-0000-4000-8000-000000000002",
          attempt_id: "00000000-0000-4000-8000-000000000003",
          original_filename: filename,
          sanitized_filename: filename,
          mime_type: mime,
          size_bytes: content.length,
          storage_path: `test/${filename}`,
          checksum,
        },
        error: null,
      };
    }
    finalized.push(parameters);
    return { data: {}, error: null };
  });
  const download = vi.fn(async () => ({
    data: new Blob([new Uint8Array(content)]),
    error: null,
  }));
  const client = {
    rpc,
    storage: { from: () => ({ download }) },
  } as unknown as SupabaseClient;
  return { client, download, finalized, rpc };
}

describe("document parse orchestrator", () => {
  it("claims, downloads, parses and finalizes exactly once", async () => {
    const fixture = mockClient(Buffer.from("Phase 3 source"));
    const result = await parseAttachment(
      "00000000-0000-4000-8000-000000000001",
      fixture.client,
    );
    expect(result?.result.status).toBe("parsed");
    expect(fixture.download).toHaveBeenCalledOnce();
    expect(fixture.finalized).toHaveLength(1);
    expect(fixture.finalized[0]?.p_result).toMatchObject({
      status: "parsed",
      normalized_text: "Phase 3 source",
    });

    const duplicate = await parseAttachment(undefined, fixture.client);
    expect(duplicate).toBeNull();
    expect(fixture.download).toHaveBeenCalledOnce();
  });

  it("persists stable unsupported status instead of losing the attachment", async () => {
    const fixture = mockClient(
      Buffer.from("{\\rtf1 safe unsupported fixture}"),
      "request.rtf",
      "application/rtf",
    );
    const result = await parseAttachment(undefined, fixture.client);
    expect(result?.result.status).toBe("unsupported");
    expect(result?.result.errorCode).toBe("UNSUPPORTED_FORMAT");
    expect(fixture.finalized[0]?.p_result).toMatchObject({
      status: "unsupported",
      error_code: "UNSUPPORTED_FORMAT",
    });
  });

  it("persists private Storage download failures with no secret details", async () => {
    const fixture = mockClient(Buffer.from("source"));
    fixture.client.storage.from = (() => ({
      download: vi.fn(async () => ({
        data: null,
        error: { message: "provider detail" },
      })),
    })) as unknown as typeof fixture.client.storage.from;
    const result = await parseAttachment(undefined, fixture.client);
    expect(result?.result.status).toBe("failed");
    expect(result?.result.errorCode).toBe("STORAGE_DOWNLOAD_FAILED");
    expect(result?.result.errorMessage).not.toContain("provider detail");
  });
});
