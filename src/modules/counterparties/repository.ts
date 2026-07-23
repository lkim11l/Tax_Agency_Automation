import { getOperationalContext } from "@/lib/auth/context";
import { sanitizePostgrestSearchTerm } from "@/lib/supabase/filter";

import type { CounterpartyInput } from "./domain";

export type CounterpartyListItem = {
  id: string;
  legal_name: string;
  short_name: string | null;
  inn: string | null;
  contact_name: string | null;
  contact_email: string | null;
  updated_at: string;
};

export async function listCounterparties(search = "") {
  const { supabase } = await getOperationalContext();
  let query = supabase
    .from("counterparties")
    .select("id,legal_name,short_name,inn,contact_name,contact_email,updated_at")
    .order("legal_name");

  if (search) {
    const term = sanitizePostgrestSearchTerm(search);
    if (term) {
      query = query.or(`legal_name.ilike.%${term}%,inn.ilike.%${term}%`);
    }
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Unable to load counterparties: ${error.message}`);
  }

  return data as CounterpartyListItem[];
}

export async function listCounterpartyOptions() {
  const items = await listCounterparties();
  return items.map(({ id, legal_name, inn }) => ({ id, legal_name, inn }));
}

export async function getCounterparty(id: string) {
  const { supabase } = await getOperationalContext();
  const { data, error } = await supabase
    .from("counterparties")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load counterparty: ${error.message}`);
  }

  return data as (CounterpartyInput & { id: string }) | null;
}

export async function createCounterparty(input: CounterpartyInput) {
  const { supabase } = await getOperationalContext();
  const { data, error } = await supabase
    .from("counterparties")
    .insert(input)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create counterparty: ${error.message}`);
  }

  return data.id as string;
}

export async function updateCounterparty(id: string, input: CounterpartyInput) {
  const { supabase } = await getOperationalContext();
  const { error } = await supabase
    .from("counterparties")
    .update(input)
    .eq("id", id);

  if (error) {
    throw new Error(`Unable to update counterparty: ${error.message}`);
  }
}
