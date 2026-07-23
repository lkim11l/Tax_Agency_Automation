begin;

create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'specialist');
create type public.application_source as enum ('manual', 'email');
create type public.application_status as enum (
  'new',
  'processing',
  'needs_data_review',
  'waiting_for_client',
  'data_complete',
  'generating_contract',
  'contract_ready',
  'under_review',
  'needs_revision',
  'approved',
  'sending',
  'sent',
  'completed',
  'processing_error',
  'cancelled'
);
create type public.application_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.email_direction as enum ('inbound', 'outbound');
create type public.processing_status as enum ('pending', 'processing', 'completed', 'failed');
create type public.template_status as enum ('draft', 'approved', 'archived');
create type public.contract_status as enum ('draft', 'generated', 'under_review', 'approved', 'sent', 'cancelled');

create sequence public.application_number_seq;

create function public.generate_application_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'REQ-' || extract(year from current_date)::integer::text || '-' ||
    lpad(nextval('public.application_number_seq')::text, 6, '0');
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'specialist',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_key on public.profiles (lower(email));

create table public.counterparties (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  short_name text,
  inn text,
  kpp text,
  ogrn text,
  legal_address text,
  actual_address text,
  bank_name text,
  bank_account text,
  correspondent_account text,
  bik text,
  signer_name text,
  signer_position text,
  signer_authority text,
  contact_name text,
  contact_email text,
  contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint counterparties_inn_format check (inn is null or inn ~ '^[0-9]{10}([0-9]{2})?$'),
  constraint counterparties_kpp_format check (kpp is null or kpp ~ '^[0-9]{9}$'),
  constraint counterparties_ogrn_format check (ogrn is null or ogrn ~ '^[0-9]{13}([0-9]{2})?$')
);

create index counterparties_legal_name_idx on public.counterparties using gin (to_tsvector('simple', legal_name));
create index counterparties_inn_idx on public.counterparties (inn);

create table public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  version text not null,
  status public.template_status not null default 'draft',
  storage_path text,
  required_fields jsonb not null default '[]'::jsonb,
  variable_schema jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_templates_name_version_key unique (name, version),
  constraint contract_templates_required_fields_array check (jsonb_typeof(required_fields) = 'array'),
  constraint contract_templates_variable_schema_object check (jsonb_typeof(variable_schema) = 'object'),
  constraint approved_template_has_storage check (status <> 'approved' or storage_path is not null)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  application_number text not null default public.generate_application_number(),
  title text not null,
  source public.application_source not null default 'manual',
  status public.application_status not null default 'new',
  priority public.application_priority not null default 'normal',
  received_at timestamptz not null default now(),
  assigned_to uuid references public.profiles(id) on delete set null,
  counterparty_id uuid references public.counterparties(id) on delete set null,
  contract_template_id uuid references public.contract_templates(id) on delete set null,
  contract_subject text,
  contract_amount numeric(18, 2),
  currency char(3),
  performance_start_date date,
  performance_end_date date,
  payment_terms text,
  internal_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint applications_number_key unique (application_number),
  constraint applications_number_format check (application_number ~ '^REQ-[0-9]{4}-[0-9]{6,}$'),
  constraint applications_amount_nonnegative check (contract_amount is null or contract_amount >= 0),
  constraint applications_currency_format check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint applications_performance_dates check (
    performance_start_date is null or performance_end_date is null or
    performance_end_date >= performance_start_date
  )
);

create index applications_status_idx on public.applications (status);
create index applications_assigned_to_idx on public.applications (assigned_to);
create index applications_received_at_idx on public.applications (received_at desc);
create index applications_counterparty_idx on public.applications (counterparty_id);
create index applications_title_idx on public.applications using gin (to_tsvector('simple', title));

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_message_id text not null,
  provider_thread_id text,
  direction public.email_direction not null,
  sender text not null,
  recipients jsonb not null default '[]'::jsonb,
  subject text,
  plain_body text,
  html_body text,
  occurred_at timestamptz not null,
  processing_status public.processing_status not null default 'pending',
  processing_error text,
  application_id uuid references public.applications(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint email_messages_provider_message_key unique (provider, provider_message_id),
  constraint email_messages_recipients_array check (jsonb_typeof(recipients) = 'array')
);

create index email_messages_thread_idx on public.email_messages (provider, provider_thread_id);
create index email_messages_application_idx on public.email_messages (application_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  email_message_id uuid references public.email_messages(id) on delete set null,
  original_filename text not null,
  sanitized_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null,
  checksum text not null,
  parse_status public.processing_status not null default 'pending',
  parse_error text,
  created_at timestamptz not null default now(),
  constraint attachments_size_nonnegative check (size_bytes >= 0),
  constraint attachments_storage_path_key unique (storage_path)
);

create index attachments_application_idx on public.attachments (application_id);
create index attachments_email_message_idx on public.attachments (email_message_id);

create table public.extracted_fields (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  field_name text not null,
  normalized_value jsonb,
  raw_value text,
  source_type text,
  source_id uuid,
  source_excerpt text,
  confidence numeric(4, 3),
  requires_review boolean not null default true,
  manually_corrected boolean not null default false,
  corrected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint extracted_fields_confidence_range check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  )
);

create index extracted_fields_application_idx on public.extracted_fields (application_id);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  template_id uuid not null references public.contract_templates(id) on delete restrict,
  status public.contract_status not null default 'draft',
  current_version_id uuid,
  approved_version_id uuid,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contracts_application_idx on public.contracts (application_id);

create table public.contract_versions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  version_number integer not null,
  storage_path text not null,
  checksum text not null,
  generation_metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint contract_versions_contract_version_key unique (contract_id, version_number),
  constraint contract_versions_storage_path_key unique (storage_path),
  constraint contract_versions_positive_version check (version_number > 0),
  constraint contract_versions_metadata_object check (jsonb_typeof(generation_metadata) = 'object')
);

alter table public.contracts
  add constraint contracts_current_version_fkey
  foreign key (current_version_id) references public.contract_versions(id) on delete set null,
  add constraint contracts_approved_version_fkey
  foreign key (approved_version_id) references public.contract_versions(id) on delete set null;

create table public.status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  previous_status public.application_status,
  new_status public.application_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index status_history_application_idx on public.status_history (application_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  application_id uuid references public.applications(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_application_idx on public.audit_events (application_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger counterparties_set_updated_at before update on public.counterparties
for each row execute function public.set_updated_at();
create trigger templates_set_updated_at before update on public.contract_templates
for each row execute function public.set_updated_at();
create trigger applications_set_updated_at before update on public.applications
for each row execute function public.set_updated_at();
create trigger extracted_fields_set_updated_at before update on public.extracted_fields
for each row execute function public.set_updated_at();
create trigger contracts_set_updated_at before update on public.contracts
for each row execute function public.set_updated_at();

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@invalid.local'),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, email, full_name)
select
  id,
  coalesce(email, id::text || '@invalid.local'),
  nullif(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (id) do nothing;

create function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role = 'admin'
  );
$$;

create function public.record_application_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.status_history (
      application_id, previous_status, new_status, changed_by, reason
    ) values (new.id, null, new.status, actor, 'Application created');

    insert into public.audit_events (
      actor_id, application_id, entity_type, entity_id, action, metadata
    ) values (
      actor, new.id, 'application', new.id, 'application.created',
      jsonb_build_object('source', new.source, 'status', new.status)
    );
    return new;
  end if;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    actor, new.id, 'application', new.id, 'application.updated',
    jsonb_build_object('updated_at', new.updated_at)
  );

  if old.status is distinct from new.status then
    insert into public.status_history (
      application_id, previous_status, new_status, changed_by, reason
    ) values (
      new.id, old.status, new.status, actor,
      nullif(current_setting('app.status_change_reason', true), '')
    );

    insert into public.audit_events (
      actor_id, application_id, entity_type, entity_id, action, metadata
    ) values (
      actor, new.id, 'application', new.id, 'application.status_changed',
      jsonb_build_object('previous_status', old.status, 'new_status', new.status)
    );
  end if;

  if old.assigned_to is distinct from new.assigned_to then
    insert into public.audit_events (
      actor_id, application_id, entity_type, entity_id, action, metadata
    ) values (
      actor, new.id, 'application', new.id, 'application.assignee_changed',
      jsonb_build_object('previous_assignee', old.assigned_to, 'new_assignee', new.assigned_to)
    );
  end if;

  return new;
end;
$$;

create trigger applications_record_change
after insert or update on public.applications
for each row execute function public.record_application_change();

create function public.change_application_status(
  p_application_id uuid,
  p_new_status public.application_status,
  p_reason text default null
)
returns public.applications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_application public.applications;
begin
  perform set_config('app.status_change_reason', coalesce(p_reason, ''), true);

  update public.applications
  set
    status = p_new_status,
    completed_at = case
      when p_new_status = 'completed' then coalesce(completed_at, now())
      else null
    end,
    cancelled_at = case
      when p_new_status = 'cancelled' then coalesce(cancelled_at, now())
      else null
    end
  where id = p_application_id
  returning * into updated_application;

  if updated_application.id is null then
    raise exception 'Application not found or access denied';
  end if;

  return updated_application;
end;
$$;

create function public.append_application_note(
  p_application_id uuid,
  p_note text
)
returns public.applications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_application public.applications;
begin
  if nullif(btrim(p_note), '') is null then
    raise exception 'Note must not be empty';
  end if;

  update public.applications
  set internal_notes = concat_ws(
    E'\n\n',
    nullif(internal_notes, ''),
    '[' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI UTC') || '] ' || btrim(p_note)
  )
  where id = p_application_id
  returning * into updated_application;

  if updated_application.id is null then
    raise exception 'Application not found or access denied';
  end if;

  return updated_application;
end;
$$;

create function public.record_entity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  action_name text;
  entity_name text;
  target_id uuid;
begin
  entity_name := case tg_table_name
    when 'counterparties' then 'counterparty'
    when 'contract_templates' then 'template'
    else tg_table_name
  end;
  target_id := new.id;
  action_name := entity_name || case when tg_op = 'INSERT' then '.created' else '.updated' end;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (actor, null, entity_name, target_id, action_name, '{}'::jsonb);

  return new;
end;
$$;

create trigger counterparties_record_change
after insert or update on public.counterparties
for each row execute function public.record_entity_change();
create trigger templates_record_change
after insert or update on public.contract_templates
for each row execute function public.record_entity_change();

create function public.prevent_contract_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Contract versions are immutable';
end;
$$;

create trigger contract_versions_immutable
before update or delete on public.contract_versions
for each row execute function public.prevent_contract_version_mutation();

alter table public.profiles enable row level security;
alter table public.counterparties enable row level security;
alter table public.contract_templates enable row level security;
alter table public.applications enable row level security;
alter table public.email_messages enable row level security;
alter table public.attachments enable row level security;
alter table public.extracted_fields enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_versions enable row level security;
alter table public.status_history enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_active_team on public.profiles
for select to authenticated using (public.is_active_user());
create policy profiles_update_admin on public.profiles
for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy counterparties_select_active on public.counterparties
for select to authenticated using (public.is_active_user());
create policy counterparties_insert_active on public.counterparties
for insert to authenticated with check (public.is_active_user());
create policy counterparties_update_active on public.counterparties
for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy counterparties_delete_admin on public.counterparties
for delete to authenticated using (public.is_admin());

create policy templates_select_active on public.contract_templates
for select to authenticated using (public.is_active_user());
create policy templates_insert_active on public.contract_templates
for insert to authenticated with check (public.is_active_user());
create policy templates_update_active on public.contract_templates
for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy templates_delete_admin on public.contract_templates
for delete to authenticated using (public.is_admin());

create policy applications_select_active on public.applications
for select to authenticated using (public.is_active_user());
create policy applications_insert_active on public.applications
for insert to authenticated with check (
  public.is_active_user() and created_by = auth.uid() and source = 'manual'
);
create policy applications_update_active on public.applications
for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy applications_delete_admin on public.applications
for delete to authenticated using (public.is_admin());

create policy future_entities_select_email on public.email_messages
for select to authenticated using (public.is_active_user());
create policy future_entities_select_attachments on public.attachments
for select to authenticated using (public.is_active_user());
create policy future_entities_select_extracted on public.extracted_fields
for select to authenticated using (public.is_active_user());
create policy future_entities_select_contracts on public.contracts
for select to authenticated using (public.is_active_user());
create policy future_entities_select_contract_versions on public.contract_versions
for select to authenticated using (public.is_active_user());

create policy status_history_select_active on public.status_history
for select to authenticated using (public.is_active_user());
create policy audit_events_select_active on public.audit_events
for select to authenticated using (public.is_active_user());

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;
grant usage on type
  public.user_role,
  public.application_source,
  public.application_status,
  public.application_priority,
  public.email_direction,
  public.processing_status,
  public.template_status,
  public.contract_status
to authenticated;

grant select on
  public.profiles,
  public.counterparties,
  public.contract_templates,
  public.applications,
  public.email_messages,
  public.attachments,
  public.extracted_fields,
  public.contracts,
  public.contract_versions,
  public.status_history,
  public.audit_events
to authenticated;

grant usage, select on sequence public.application_number_seq to authenticated;
grant execute on function public.generate_application_number() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.change_application_status(uuid, public.application_status, text) to authenticated;
grant execute on function public.append_application_note(uuid, text) to authenticated;

grant insert (
  title,
  source,
  status,
  priority,
  received_at,
  assigned_to,
  counterparty_id,
  contract_template_id,
  contract_subject,
  contract_amount,
  currency,
  performance_start_date,
  performance_end_date,
  payment_terms,
  internal_notes,
  created_by
) on public.applications to authenticated;

grant update (
  title,
  priority,
  received_at,
  assigned_to,
  counterparty_id,
  contract_template_id,
  contract_subject,
  contract_amount,
  currency,
  performance_start_date,
  performance_end_date,
  payment_terms,
  internal_notes,
  status,
  completed_at,
  cancelled_at
) on public.applications to authenticated;

grant insert (
  legal_name,
  short_name,
  inn,
  kpp,
  ogrn,
  legal_address,
  actual_address,
  bank_name,
  bank_account,
  correspondent_account,
  bik,
  signer_name,
  signer_position,
  signer_authority,
  contact_name,
  contact_email,
  contact_phone
) on public.counterparties to authenticated;

grant update (
  legal_name,
  short_name,
  inn,
  kpp,
  ogrn,
  legal_address,
  actual_address,
  bank_name,
  bank_account,
  correspondent_account,
  bik,
  signer_name,
  signer_position,
  signer_authority,
  contact_name,
  contact_email,
  contact_phone
) on public.counterparties to authenticated;

grant insert (
  name,
  description,
  version,
  status,
  storage_path,
  required_fields,
  variable_schema,
  is_active,
  created_by
) on public.contract_templates to authenticated;

grant update (
  name,
  description,
  version,
  status,
  required_fields,
  variable_schema,
  is_active
) on public.contract_templates to authenticated;

grant update (full_name, role, is_active) on public.profiles to authenticated;

commit;
