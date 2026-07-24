import { NextResponse } from "next/server";

import { getPublicHealthSnapshot } from "@/modules/operations/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const timestamp = new Date().toISOString();
  try {
    const snapshot = await getPublicHealthSnapshot();
    const unavailable = snapshot.components.some(
      (component) => component.status === "unavailable",
    );
    const staleSync = !snapshot.lastMailboxRun ||
      Date.now() - new Date(snapshot.lastMailboxRun.started_at).getTime() > 15 * 60_000;
    const degraded = unavailable || staleSync || snapshot.failedJobsLast24Hours > 0;
    return NextResponse.json(
      {
        status: degraded ? "degraded" : "ok",
        service: "tax-agency-automation",
        timestamp,
        version: process.env.npm_package_version ?? "unknown",
        environment: process.env.APP_ENV ?? "unknown",
        components: snapshot.components,
        mailbox: {
          lastRunStatus: snapshot.lastMailboxRun?.status ?? "never",
          lastRunStartedAt: snapshot.lastMailboxRun?.started_at ?? null,
        },
        failedJobsLast24Hours: snapshot.failedJobsLast24Hours,
      },
      {
        status: degraded ? 503 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        service: "tax-agency-automation",
        timestamp,
        version: process.env.npm_package_version ?? "unknown",
        environment: process.env.APP_ENV ?? "unknown",
        components: [],
        mailbox: { lastRunStatus: "unknown", lastRunStartedAt: null },
        failedJobsLast24Hours: null,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
