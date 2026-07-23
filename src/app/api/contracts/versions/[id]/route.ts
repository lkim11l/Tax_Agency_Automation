import { NextResponse } from "next/server";

import { getOperationalContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin.server";
import { CONTRACT_BUCKET } from "@/modules/contracts/constants";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, profile } = await getOperationalContext();
    const version = await supabase
      .from("contract_versions")
      .select("id,storage_path,checksum,template_id,template_version,completeness_run_id,source_fingerprint,generated_by,contract:contracts!contract_versions_contract_id_fkey(id,application_id)")
      .eq("id", id)
      .maybeSingle();
    if (version.error || !version.data) {
      return NextResponse.json({ error: "Contract version not found." }, { status: 404 });
    }
    const signed = await supabase.storage.from(CONTRACT_BUCKET).createSignedUrl(
      version.data.storage_path,
      60,
    );
    if (signed.error || !signed.data) {
      return NextResponse.json({ error: "Contract access unavailable." }, { status: 403 });
    }
    const relation = Array.isArray(version.data.contract)
      ? version.data.contract[0]
      : version.data.contract;
    const audit = await createAdminClient().from("audit_events").insert({
      actor_id: profile.id,
      application_id: relation?.application_id ?? null,
      entity_type: "contract_version",
      entity_id: id,
      action: "contract.downloaded",
      metadata: {
        contract_id: relation?.id ?? null,
        version_id: id,
        template_id: version.data.template_id,
        template_version: version.data.template_version,
        completeness_run_id: version.data.completeness_run_id,
        source_fingerprint: version.data.source_fingerprint,
        checksum: version.data.checksum,
        generated_by: version.data.generated_by,
      },
    });
    if (audit.error) {
      return NextResponse.json({ error: "Contract download audit failed." }, { status: 500 });
    }
    return NextResponse.redirect(signed.data.signedUrl);
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
