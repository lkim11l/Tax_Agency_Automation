import { getOperationalContext } from "@/lib/auth/context";
import { sanitizePostgrestSearchTerm } from "@/lib/supabase/filter";

import type {
  ApplicationInput,
  ApplicationPriority,
  ApplicationStatus,
} from "./domain";
import { toApplicationListState } from "./list-state";

export type ApplicationListItem = {
  id: string;
  application_number: string;
  title: string;
  status: ApplicationStatus;
  priority: ApplicationPriority;
  contract_subject: string | null;
  contract_amount: number | null;
  currency: string | null;
  received_at: string;
  updated_at: string;
  counterparty: { id: string; legal_name: string } | null;
  assignee: { id: string; full_name: string | null; email: string } | null;
};

export type ApplicationFilters = {
  number?: string;
  title?: string;
  counterparty?: string;
  status?: ApplicationStatus;
  assignedTo?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type ApplicationDetail = ApplicationListItem & {
  source: "manual" | "email";
  counterparty_id: string | null;
  assigned_to: string | null;
  contract_template_id: string | null;
  performance_start_date: string | null;
  performance_end_date: string | null;
  payment_terms: string | null;
  internal_notes: string | null;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  template: { id: string; name: string; version: string } | null;
};

export type StatusHistoryItem = {
  id: string;
  previous_status: ApplicationStatus | null;
  new_status: ApplicationStatus;
  reason: string | null;
  created_at: string;
  changer: { full_name: string | null; email: string } | null;
};

export type AuditEventItem = {
  id: string;
  action: string;
  entity_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: { full_name: string | null; email: string } | null;
};

export type RelatedCounts = {
  emailMessages: number;
  attachments: number;
  extractedFields: number;
  contracts: number;
};

const applicationListSelect = `
  id,
  application_number,
  title,
  status,
  priority,
  contract_subject,
  contract_amount,
  currency,
  received_at,
  updated_at,
  counterparty:counterparties!applications_counterparty_id_fkey(id,legal_name),
  assignee:profiles!applications_assigned_to_fkey(id,full_name,email)
`;

export async function listApplications(filters: ApplicationFilters) {
  const { supabase } = await getOperationalContext();
  let query = supabase
    .from("applications")
    .select(applicationListSelect)
    .order("received_at", { ascending: false });

  if (filters.number) {
    query = query.ilike("application_number", `%${filters.number}%`);
  }
  if (filters.title) {
    query = query.ilike("title", `%${filters.title}%`);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.assignedTo) {
    query = query.eq("assigned_to", filters.assignedTo);
  }
  if (filters.dateFrom) {
    query = query.gte("received_at", `${filters.dateFrom}T00:00:00.000Z`);
  }
  if (filters.dateTo) {
    query = query.lte("received_at", `${filters.dateTo}T23:59:59.999Z`);
  }
  if (filters.counterparty) {
    const term = sanitizePostgrestSearchTerm(filters.counterparty);
    if (!term) {
      return toApplicationListState<ApplicationListItem>([], null);
    }
    const { data: matches, error: counterpartyError } = await supabase
      .from("counterparties")
      .select("id")
      .or(`legal_name.ilike.%${term}%,inn.ilike.%${term}%`);

    if (counterpartyError) {
      return toApplicationListState<ApplicationListItem>(null, counterpartyError);
    }

    const ids = (matches ?? []).map((item) => item.id as string);
    if (ids.length === 0) {
      return toApplicationListState<ApplicationListItem>([], null);
    }
    query = query.in("counterparty_id", ids);
  }

  const { data, error } = await query;
  return toApplicationListState(
    data as unknown as ApplicationListItem[] | null,
    error,
  );
}

export async function getApplication(id: string) {
  const { supabase } = await getOperationalContext();
  const { data, error } = await supabase
    .from("applications")
    .select(
      `${applicationListSelect},
      source,
      counterparty_id,
      assigned_to,
      contract_template_id,
      performance_start_date,
      performance_end_date,
      payment_terms,
      internal_notes,
      created_at,
      completed_at,
      cancelled_at,
      template:contract_templates!applications_contract_template_id_fkey(id,name,version)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load application: ${error.message}`);
  }

  return data as unknown as ApplicationDetail | null;
}

export async function getApplicationActivity(id: string) {
  const { supabase } = await getOperationalContext();
  const [historyResult, auditResult, emails, attachments, extracted, contracts] =
    await Promise.all([
      supabase
        .from("status_history")
        .select(
          "id,previous_status,new_status,reason,created_at,changer:profiles!status_history_changed_by_fkey(full_name,email)",
        )
        .eq("application_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("audit_events")
        .select(
          "id,action,entity_type,metadata,created_at,actor:profiles!audit_events_actor_id_fkey(full_name,email)",
        )
        .eq("application_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("application_id", id),
      supabase
        .from("attachments")
        .select("id", { count: "exact", head: true })
        .eq("application_id", id),
      supabase
        .from("extracted_fields")
        .select("id", { count: "exact", head: true })
        .eq("application_id", id),
      supabase
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .eq("application_id", id),
    ]);

  const firstError =
    historyResult.error ??
    auditResult.error ??
    emails.error ??
    attachments.error ??
    extracted.error ??
    contracts.error;
  if (firstError) {
    throw new Error(`Unable to load application activity: ${firstError.message}`);
  }

  return {
    history: historyResult.data as unknown as StatusHistoryItem[],
    audit: auditResult.data as unknown as AuditEventItem[],
    counts: {
      emailMessages: emails.count ?? 0,
      attachments: attachments.count ?? 0,
      extractedFields: extracted.count ?? 0,
      contracts: contracts.count ?? 0,
    } satisfies RelatedCounts,
  };
}

export async function createApplication(input: ApplicationInput) {
  const { supabase, profile } = await getOperationalContext();
  const { data, error } = await supabase
    .from("applications")
    .insert({
      ...input,
      source: "manual",
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create application: ${error.message}`);
  }

  return data.id as string;
}

export async function updateApplication(id: string, input: ApplicationInput) {
  const { supabase } = await getOperationalContext();
  const { error } = await supabase
    .from("applications")
    .update(input)
    .eq("id", id);

  if (error) {
    throw new Error(`Unable to update application: ${error.message}`);
  }
}

export async function changeApplicationStatus(input: {
  applicationId: string;
  status: ApplicationStatus;
  reason: string | null;
}) {
  const { supabase } = await getOperationalContext();
  const { error } = await supabase.rpc("change_application_status", {
    p_application_id: input.applicationId,
    p_new_status: input.status,
    p_reason: input.reason,
  });

  if (error) {
    throw new Error(`Unable to change status: ${error.message}`);
  }
}

export async function appendApplicationNote(
  applicationId: string,
  note: string,
) {
  const { supabase } = await getOperationalContext();
  const { error } = await supabase.rpc("append_application_note", {
    p_application_id: applicationId,
    p_note: note,
  });

  if (error) {
    throw new Error(`Unable to add comment: ${error.message}`);
  }
}

export async function listAssignableProfiles() {
  const { supabase } = await getOperationalContext();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,email")
    .eq("is_active", true)
    .order("full_name");

  if (error) {
    throw new Error(`Unable to load specialists: ${error.message}`);
  }

  return data as Array<{ id: string; full_name: string | null; email: string }>;
}
