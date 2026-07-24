import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/modules/operations/cron-auth";
import { safeFailure } from "@/modules/operations/domain";
import { runMailboxPipeline } from "@/modules/operations/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { status: "denied", error: { code: "CRON_UNAUTHORIZED" } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const result = await runMailboxPipeline("cron");
    return NextResponse.json(
      {
        status: result.claimed ? result.status : "skipped",
        runId: result.runId,
        reason: result.claimed ? null : result.reason,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const failure = safeFailure(error);
    return NextResponse.json(
      { status: "failed", error: { code: failure.code } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
