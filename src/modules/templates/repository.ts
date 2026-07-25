import { getOperationalContext } from "@/lib/auth/context";

import type { TemplateInput } from "./domain";

export type TemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  version: string;
  status: "draft" | "awaiting_approval" | "approved" | "inactive" | "archived";
  required_fields: string[];
  storage_path: string | null;
  is_active: boolean;
  updated_at: string;
  code: string | null;
  template_type: "services" | "consulting" | "supply" | null;
  checksum: string | null;
  original_filename: string | null;
  mime_type: string | null;
  required_rule_set: string | null;
  placeholder_schema_version: string | null;
  validation_report: {
    valid?: boolean;
    errors?: string[];
    warnings?: string[];
    placeholders?: string[];
    duplicates?: string[];
    parts?: string[];
  };
  approved_by: string | null;
  approved_at: string | null;
  legal_approval_status: "pending_customer_approval" | "approved" | "rejected";
  creator?: { email: string; full_name: string | null }[] | null;
  approver?: { email: string; full_name: string | null }[] | null;
};

export async function listTemplates(options?: { includeArchived?: boolean }) {
  const { supabase } = await getOperationalContext();
  let query = supabase
    .from("contract_templates")
    .select(
      "id,name,description,version,status,required_fields,storage_path,is_active,updated_at,code,template_type,checksum,original_filename,mime_type,required_rule_set,placeholder_schema_version,validation_report,approved_by,approved_at,legal_approval_status,creator:profiles!contract_templates_created_by_fkey(email,full_name),approver:profiles!contract_templates_approved_by_fkey(email,full_name)",
    )
    .order("name");
  // Archived templates are excluded by default so they stop cluttering the
  // main list — pass includeArchived to explicitly view them.
  if (!options?.includeArchived) {
    query = query.neq("status", "archived");
  }
  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load templates: ${error.message}`);
  }

  return data as TemplateListItem[];
}

export async function listTemplateOptions() {
  const templates = await listTemplates();
  return templates
    .filter((template) => template.status === "approved" && template.is_active)
    .map(({ id, name, version }) => ({ id, name, version }));
}

export async function getTemplate(id: string) {
  const { supabase } = await getOperationalContext();
  const { data, error } = await supabase
    .from("contract_templates")
    .select(
      "id,name,description,version,status,required_fields,storage_path,is_active,updated_at,code,template_type,checksum,original_filename,mime_type,required_rule_set,placeholder_schema_version,validation_report,approved_by,approved_at,legal_approval_status,creator:profiles!contract_templates_created_by_fkey(email,full_name),approver:profiles!contract_templates_approved_by_fkey(email,full_name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load template: ${error.message}`);
  }

  return data as TemplateListItem | null;
}

export async function createTemplate(input: TemplateInput) {
  const { supabase, profile } = await getOperationalContext();
  const { data, error } = await supabase
    .from("contract_templates")
    .insert({
      ...input,
      variable_schema: {},
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create template metadata: ${error.message}`);
  }

  return data.id as string;
}

export async function updateTemplate(id: string, input: TemplateInput) {
  const { supabase } = await getOperationalContext();
  const { error } = await supabase
    .from("contract_templates")
    .update(input)
    .eq("id", id);

  if (error) {
    throw new Error(`Unable to update template metadata: ${error.message}`);
  }
}
