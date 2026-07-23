import { getOperationalContext } from "@/lib/auth/context";

import type { TemplateInput } from "./domain";

export type TemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  version: string;
  status: "draft" | "approved" | "archived";
  required_fields: string[];
  storage_path: string | null;
  is_active: boolean;
  updated_at: string;
};

export async function listTemplates() {
  const { supabase } = await getOperationalContext();
  const { data, error } = await supabase
    .from("contract_templates")
    .select(
      "id,name,description,version,status,required_fields,storage_path,is_active,updated_at",
    )
    .order("name");

  if (error) {
    throw new Error(`Unable to load templates: ${error.message}`);
  }

  return data as TemplateListItem[];
}

export async function listTemplateOptions() {
  const templates = await listTemplates();
  return templates.map(({ id, name, version }) => ({ id, name, version }));
}

export async function getTemplate(id: string) {
  const { supabase } = await getOperationalContext();
  const { data, error } = await supabase
    .from("contract_templates")
    .select(
      "id,name,description,version,status,required_fields,storage_path,is_active,updated_at",
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
