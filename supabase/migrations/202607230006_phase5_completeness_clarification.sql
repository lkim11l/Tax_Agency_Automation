create type public.completeness_field_status as enum (
  'complete', 'missing', 'conflict', 'low_confidence', 'review_required', 'invalid'
);
create type public.clarification_draft_status as enum (
  'draft', 'awaiting_approval', 'approved', 'sending', 'sent',
  'send_failed', 'cancelled', 'superseded'
);
create type public.clarification_send_status as enum (
  'sending', 'sent', 'safe_failure', 'delivery_unknown'
);

create table public.completeness_runs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  rule_set_id text not null check (char_length(rule_set_id) between 2 and 100),
  rule_set_version text not null check (char_length(rule_set_version) between 1 and 50),
  total_count integer not null check (total_count >= 0),
  complete_count integer not null check (complete_count >= 0),
  missing_count integer not null check (missing_count >= 0),
  conflict_count integer not null check (conflict_count >= 0),
  low_confidence_count integer not null check (low_confidence_count >= 0),
  review_required_count integer not null check (review_required_count >= 0),
  invalid_count integer not null check (invalid_count >= 0),
  percentage integer not null check (percentage between 0 and 100),
  is_blocking boolean not null,
  is_ready boolean not null,
  triggered_by_reply_id uuid references public.email_messages(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint completeness_ready_consistent check (is_ready = not is_blocking)
);

create index completeness_runs_application_idx
on public.completeness_runs(application_id, created_at desc);

create table public.completeness_field_results (
  id uuid primary key default gen_random_uuid(),
  completeness_run_id uuid not null references public.completeness_runs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  field_name text not null,
  label text not null,
  question text not null,
  is_required boolean not null,
  status public.completeness_field_status not null,
  is_blocking boolean not null,
  confidence numeric(5,4),
  reason text,
  created_at timestamptz not null default now(),
  unique(completeness_run_id, field_name),
  constraint completeness_confidence_range check (
    confidence is null or confidence between 0 and 1
  )
);

create index completeness_fields_application_idx
on public.completeness_field_results(application_id, created_at desc);

create table public.clarification_drafts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  completeness_run_id uuid not null references public.completeness_runs(id),
  version integer not null default 1 check (version > 0),
  status public.clarification_draft_status not null default 'draft',
  recipient text not null check (recipient ~* '^[^[:space:]@]+@[^[:space:]@]+$'),
  subject text not null check (char_length(subject) between 1 and 500),
  body_text text not null check (char_length(body_text) between 1 and 50000),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  submitted_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clarification_approval_complete check (
    (approved_by is null and approved_at is null)
    or (approved_by is not null and approved_at is not null)
  )
);

create index clarification_drafts_application_idx
on public.clarification_drafts(application_id, created_at desc);

create table public.clarification_send_attempts (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.clarification_drafts(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  idempotency_key text not null unique,
  status public.clarification_send_status not null,
  provider text not null,
  rfc_message_id text not null,
  recipient text not null,
  subject text not null,
  body_text text not null,
  provider_response text,
  safe_error_code text,
  safe_error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  unique(draft_id, attempt_number)
);

create table public.clarification_reply_runs (
  id uuid primary key default gen_random_uuid(),
  inbound_email_message_id uuid not null unique references public.email_messages(id) on delete cascade,
  draft_id uuid not null references public.clarification_drafts(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  status public.processing_status not null default 'processing',
  safe_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create trigger clarification_drafts_set_updated_at
before update on public.clarification_drafts
for each row execute function public.set_updated_at();

alter table public.completeness_runs enable row level security;
alter table public.completeness_field_results enable row level security;
alter table public.clarification_drafts enable row level security;
alter table public.clarification_send_attempts enable row level security;
alter table public.clarification_reply_runs enable row level security;

create policy completeness_runs_active_select on public.completeness_runs
for select to authenticated using (public.is_active_user());
create policy completeness_fields_active_select on public.completeness_field_results
for select to authenticated using (public.is_active_user());
create policy clarification_drafts_active_select on public.clarification_drafts
for select to authenticated using (public.is_active_user());
create policy clarification_attempts_active_select on public.clarification_send_attempts
for select to authenticated using (public.is_active_user());
create policy clarification_reply_runs_active_select on public.clarification_reply_runs
for select to authenticated using (public.is_active_user());

revoke all on public.completeness_runs from anon, authenticated;
revoke all on public.completeness_field_results from anon, authenticated;
revoke all on public.clarification_drafts from anon, authenticated;
revoke all on public.clarification_send_attempts from anon, authenticated;
revoke all on public.clarification_reply_runs from anon, authenticated;

grant select on public.completeness_runs, public.completeness_field_results,
  public.clarification_drafts, public.clarification_send_attempts,
  public.clarification_reply_runs to authenticated;
grant all on public.completeness_runs, public.completeness_field_results,
  public.clarification_drafts, public.clarification_send_attempts,
  public.clarification_reply_runs to service_role;
