import { getOperationalContext } from "@/lib/auth/context";

export async function getContractState(applicationId: string) {
  const { supabase, profile } = await getOperationalContext();
  const [templates, contracts, runs] = await Promise.all([
    supabase
      .from("contract_templates")
      .select("id,name,version,template_type,required_rule_set")
      .eq("status", "approved")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("contracts")
      .select("id,contract_number,status,current_version_id,template:contract_templates(name,version),versions:contract_versions!contract_versions_contract_id_fkey(id,version_number,checksum,generated_filename,file_size,generated_at,status,generation_warnings,completeness_run_id,extraction_run_id,template_version)")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("contract_generation_runs")
      .select("id,status,safe_error_code,force_requested,started_at,completed_at")
      .eq("application_id", applicationId)
      .order("started_at", { ascending: false })
      .limit(20),
  ]);
  const error = templates.error ?? contracts.error ?? runs.error;
  if (error) throw new Error(`Unable to load contract state: ${error.message}`);
  return {
    templates: templates.data ?? [],
    contracts: contracts.data ?? [],
    runs: runs.data ?? [],
    isAdmin: profile.role === "admin",
  };
}
