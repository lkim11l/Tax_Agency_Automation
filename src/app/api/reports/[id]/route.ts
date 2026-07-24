import { NextResponse } from "next/server";

import { getReportForDownload } from "@/modules/reports/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { signedUrl } = await getReportForDownload(id);
    return NextResponse.redirect(signedUrl);
  } catch {
    return NextResponse.json({ error: { code: "REPORT_NOT_AVAILABLE" } }, { status: 404 });
  }
}
