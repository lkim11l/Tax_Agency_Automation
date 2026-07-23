import { NextResponse } from "next/server";

import { getOperationalContext } from "@/lib/auth/context";
import { EMAIL_ATTACHMENT_BUCKET } from "@/modules/email/attachments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase } = await getOperationalContext();
    const attachment = await supabase
      .from("attachments")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();
    if (attachment.error || !attachment.data) {
      return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    }
    const signed = await supabase.storage
      .from(EMAIL_ATTACHMENT_BUCKET)
      .createSignedUrl(attachment.data.storage_path, 60);
    if (signed.error || !signed.data) {
      return NextResponse.json(
        { error: "Attachment access is unavailable." },
        { status: 403 },
      );
    }
    return NextResponse.redirect(signed.data.signedUrl);
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
