begin;

alter table public.contract_versions
  drop constraint contract_versions_status_check,
  add constraint contract_versions_status_check check (
    status in (
      'generated', 'awaiting_review', 'approved', 'rejected', 'superseded',
      'delivered', 'delivery_failed', 'void'
    )
  );

create type public.contract_review_decision as enum (
  'approved', 'rejected', 'returned_for_regeneration'
);

create type public.contract_delivery_draft_status as enum (
  'draft', 'ready', 'sending', 'sent', 'send_failed',
  'reconciliation_required', 'cancelled', 'superseded'
);

create type public.contract_delivery_attempt_status as enum (
  'sending', 'sent', 'safe_failure', 'delivery_unknown'
);

create table public.contract_version_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  contract_version_id uuid not null unique
    references public.contract_versions(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  decision public.contract_review_decision not null,
  comment text,
  version_checksum text not null,
  source_fingerprint text not null,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint contract_review_checksum_format
    check (version_checksum ~ '^[0-9a-f]{64}$'),
  constraint contract_review_fingerprint_format
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint contract_review_rejection_comment
    check (
      decision = 'approved'
      or char_length(btrim(coalesce(comment, ''))) between 2 and 4000
    ),
  constraint contract_review_comment_length
    check (comment is null or char_length(comment) <= 4000)
);

create table public.contract_delivery_drafts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  contract_version_id uuid not null references public.contract_versions(id) on delete restrict,
  version integer not null check (version > 0),
  previous_draft_id uuid references public.contract_delivery_drafts(id) on delete restrict,
  recipient text not null,
  recipient_source text not null
    check (recipient_source in ('confirmed_inbound', 'manual')),
  subject text not null,
  body_text text not null,
  attachment_filename text not null,
  version_checksum text not null,
  status public.contract_delivery_draft_status not null default 'draft',
  created_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  sent_by uuid references public.profiles(id) on delete restrict,
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_delivery_draft_version_key
    unique (contract_version_id, version),
  constraint contract_delivery_draft_checksum_format
    check (version_checksum ~ '^[0-9a-f]{64}$'),
  constraint contract_delivery_draft_recipient_length
    check (char_length(recipient) between 3 and 320 and recipient !~ E'[\\r\\n]'),
  constraint contract_delivery_draft_subject_safe
    check (char_length(btrim(subject)) between 1 and 500 and subject !~ E'[\\r\\n]'),
  constraint contract_delivery_draft_body_safe
    check (char_length(btrim(body_text)) between 1 and 50000)
);

create index contract_delivery_drafts_application_idx
on public.contract_delivery_drafts(application_id, created_at desc);

create table public.contract_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_draft_id uuid not null
    references public.contract_delivery_drafts(id) on delete restrict,
  application_id uuid not null references public.applications(id) on delete restrict,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  contract_version_id uuid not null references public.contract_versions(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  delivery_key text not null,
  idempotency_key text not null unique,
  status public.contract_delivery_attempt_status not null,
  provider text not null,
  rfc_message_id text not null,
  provider_message_id text,
  recipient text not null,
  subject text not null,
  body_text text not null,
  attachment_filename text not null,
  attachment_mime text not null,
  attachment_size bigint not null check (attachment_size > 0),
  attachment_checksum text not null,
  provider_response text,
  safe_error_code text,
  safe_error_message text,
  outgoing_email_message_id uuid references public.email_messages(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  constraint contract_delivery_attempt_number_key
    unique (delivery_draft_id, attempt_number),
  constraint contract_delivery_attempt_checksum_format
    check (attachment_checksum ~ '^[0-9a-f]{64}$')
);

create unique index contract_delivery_one_running
on public.contract_delivery_attempts(delivery_draft_id)
where status = 'sending';

create index contract_delivery_attempts_application_idx
on public.contract_delivery_attempts(application_id, started_at desc);

create table public.contract_delivery_attachments (
  id uuid primary key default gen_random_uuid(),
  delivery_attempt_id uuid not null unique
    references public.contract_delivery_attempts(id) on delete restrict,
  email_message_id uuid not null
    references public.email_messages(id) on delete restrict,
  contract_version_id uuid not null
    references public.contract_versions(id) on delete restrict,
  filename text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create trigger contract_delivery_drafts_set_updated_at
before update on public.contract_delivery_drafts
for each row execute function public.set_updated_at();

create or replace function public.prevent_contract_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Contract versions are immutable';
  end if;
  if (to_jsonb(new) - 'status') is distinct from
     (to_jsonb(old) - 'status') then
    raise exception 'Contract version content is immutable';
  end if;
  return new;
end;
$$;

create function public.prevent_contract_review_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Contract review records are immutable';
end;
$$;

create trigger contract_reviews_immutable
before update or delete on public.contract_version_reviews
for each row execute function public.prevent_contract_review_mutation();

create function public.review_contract_version(
  p_contract_version_id uuid,
  p_reviewer_id uuid,
  p_decision public.contract_review_decision,
  p_comment text,
  p_verified_checksum text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.contract_versions;
  contract_row public.contracts;
  review_id uuid;
  next_status text;
  audit_action text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_contract_version_id::text, 0));
  perform set_config('request.jwt.claim.sub', p_reviewer_id::text, true);

  if not exists (
    select 1 from public.profiles
    where id = p_reviewer_id and is_active
      and role in ('admin', 'specialist')
  ) then
    raise exception 'REVIEWER_NOT_ALLOWED';
  end if;

  select * into version_row
  from public.contract_versions
  where id = p_contract_version_id
  for update;
  if not found then raise exception 'CONTRACT_VERSION_NOT_FOUND'; end if;
  if version_row.status <> 'awaiting_review' then
    raise exception 'CONTRACT_VERSION_NOT_AWAITING_REVIEW';
  end if;
  if version_row.checksum <> p_verified_checksum then
    raise exception 'CONTRACT_VERSION_CHECKSUM_MISMATCH';
  end if;
  if not exists (
    select 1 from public.audit_events
    where actor_id = p_reviewer_id
      and entity_type = 'contract_version'
      and entity_id = p_contract_version_id
      and action = 'contract.review_opened'
  ) then
    raise exception 'CONTRACT_MUST_BE_OPENED_BEFORE_REVIEW';
  end if;

  select * into contract_row
  from public.contracts
  where id = version_row.contract_id
  for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if contract_row.status in ('sent', 'delivered') then
    raise exception 'CONTRACT_ALREADY_DELIVERED';
  end if;

  if not exists (
    select 1 from public.contract_templates
    where id = version_row.template_id
      and version = version_row.template_version
  ) or not exists (
    select 1 from public.completeness_runs
    where id = version_row.completeness_run_id
  ) then
    raise exception 'CONTRACT_REVIEW_PROVENANCE_MISSING';
  end if;

  if p_decision = 'approved' and exists (
    select 1 from public.contract_versions
    where contract_id = version_row.contract_id
      and version_number > version_row.version_number
      and status not in ('rejected', 'superseded', 'void')
  ) then
    raise exception 'NEWER_ACTIVE_VERSION_EXISTS';
  end if;

  next_status := case p_decision
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    else 'superseded'
  end;
  audit_action := case p_decision
    when 'approved' then 'contract.approved'
    when 'rejected' then 'contract.rejected'
    else 'contract.returned_for_regeneration'
  end;

  insert into public.contract_version_reviews (
    application_id, contract_id, contract_version_id, reviewer_id, decision, comment,
    version_checksum, source_fingerprint
  ) values (
    contract_row.application_id, contract_row.id, version_row.id, p_reviewer_id, p_decision,
    nullif(btrim(coalesce(p_comment, '')), ''),
    version_row.checksum, version_row.source_fingerprint
  )
  returning id into review_id;

  update public.contract_versions
  set status = next_status
  where id = version_row.id;

  if p_decision = 'approved' then
    update public.contracts
    set current_version_id = version_row.id,
        approved_version_id = version_row.id,
        approved_by = p_reviewer_id,
        approved_at = now(),
        status = 'approved'
    where id = contract_row.id;
    update public.applications
    set status = 'contract_ready'
    where id = contract_row.application_id;
  else
    update public.contracts
    set status = 'under_review'
    where id = contract_row.id;
    update public.applications
    set status = 'contract_revision_required'
    where id = contract_row.application_id;
  end if;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    p_reviewer_id, contract_row.application_id, 'contract_version',
    version_row.id, audit_action,
    jsonb_build_object(
      'application_id', contract_row.application_id,
      'contract_id', contract_row.id,
      'contract_version_id', version_row.id,
      'version_number', version_row.version_number,
      'checksum', version_row.checksum,
      'reviewer_id', p_reviewer_id,
      'review_id', review_id
    )
  );

  return review_id;
end;
$$;

create function public.claim_contract_delivery(
  p_delivery_draft_id uuid,
  p_actor_id uuid,
  p_delivery_key text,
  p_idempotency_key text,
  p_rfc_message_id text,
  p_attachment_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row public.contract_delivery_drafts;
  version_row public.contract_versions;
  review_row public.contract_version_reviews;
  existing_attempt public.contract_delivery_attempts;
  attempt_row public.contract_delivery_attempts;
  next_attempt integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_delivery_draft_id::text, 0));
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);

  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and is_active
      and role in ('admin', 'specialist')
  ) then raise exception 'DELIVERY_ACTOR_NOT_ALLOWED'; end if;

  select * into draft_row
  from public.contract_delivery_drafts
  where id = p_delivery_draft_id
  for update;
  if not found then raise exception 'DELIVERY_DRAFT_NOT_FOUND'; end if;

  select * into version_row
  from public.contract_versions
  where id = draft_row.contract_version_id
  for update;
  select * into review_row
  from public.contract_version_reviews
  where contract_version_id = version_row.id
    and decision = 'approved';

  if draft_row.status not in ('ready', 'send_failed') then
    raise exception 'DELIVERY_DRAFT_NOT_SENDABLE';
  end if;
  if version_row.status <> 'approved'
    or review_row.id is null
    or version_row.checksum <> draft_row.version_checksum
    or review_row.version_checksum <> version_row.checksum then
    raise exception 'APPROVED_VERSION_MISMATCH';
  end if;
  if not exists (
    select 1 from public.contracts
    where id = draft_row.contract_id
      and application_id = draft_row.application_id
      and approved_version_id = version_row.id
  ) then raise exception 'APPROVED_VERSION_NOT_ACTIVE'; end if;

  select * into existing_attempt
  from public.contract_delivery_attempts
  where delivery_key = p_delivery_key
    and status in ('sent', 'delivery_unknown')
  order by started_at desc
  limit 1;
  if found then
    insert into public.audit_events (
      actor_id, application_id, entity_type, entity_id, action, metadata
    ) values (
      p_actor_id, draft_row.application_id, 'contract_delivery_attempt',
      existing_attempt.id, 'contract.delivery_cache_hit',
      jsonb_build_object(
        'application_id', draft_row.application_id,
        'contract_id', draft_row.contract_id,
        'contract_version_id', version_row.id,
        'delivery_id', draft_row.id,
        'checksum', version_row.checksum
      )
    );
    return jsonb_build_object(
      'claimed', false,
      'cache_hit', existing_attempt.status = 'sent',
      'reconciliation_required', existing_attempt.status = 'delivery_unknown',
      'attempt_id', existing_attempt.id,
      'provider_message_id', existing_attempt.provider_message_id
    );
  end if;

  if exists (
    select 1 from public.contract_delivery_attempts
    where delivery_draft_id = draft_row.id and status = 'sending'
  ) then raise exception 'DELIVERY_ALREADY_RUNNING'; end if;

  select coalesce(max(attempt_number), 0) + 1 into next_attempt
  from public.contract_delivery_attempts
  where delivery_draft_id = draft_row.id;

  insert into public.contract_delivery_attempts (
    delivery_draft_id, application_id, contract_id, contract_version_id,
    attempt_number, delivery_key, idempotency_key, status, provider,
    rfc_message_id, recipient, subject, body_text, attachment_filename,
    attachment_mime, attachment_size, attachment_checksum, created_by
  ) values (
    draft_row.id, draft_row.application_id, draft_row.contract_id,
    version_row.id, next_attempt, p_delivery_key, p_idempotency_key,
    'sending', 'mailru', p_rfc_message_id, draft_row.recipient,
    draft_row.subject, draft_row.body_text, draft_row.attachment_filename,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    p_attachment_size, version_row.checksum, p_actor_id
  )
  returning * into attempt_row;

  update public.contract_delivery_drafts
  set status = 'sending'
  where id = draft_row.id;
  update public.applications
  set status = 'sending'
  where id = draft_row.application_id;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    p_actor_id, draft_row.application_id, 'contract_delivery_attempt',
    attempt_row.id, 'contract.delivery_started',
    jsonb_build_object(
      'application_id', draft_row.application_id,
      'contract_id', draft_row.contract_id,
      'contract_version_id', version_row.id,
      'version_number', version_row.version_number,
      'checksum', version_row.checksum,
      'delivery_id', draft_row.id,
      'recipient_domain', split_part(lower(draft_row.recipient), '@', 2)
    )
  );

  return jsonb_build_object(
    'claimed', true, 'cache_hit', false,
    'reconciliation_required', false,
    'attempt_id', attempt_row.id,
    'attempt_number', attempt_row.attempt_number
  );
end;
$$;

create function public.finalize_contract_delivery(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_provider_message_id text,
  p_provider_response text,
  p_sender text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.contract_delivery_attempts;
  draft_row public.contract_delivery_drafts;
  version_row public.contract_versions;
  email_id uuid;
begin
  select * into attempt_row
  from public.contract_delivery_attempts
  where id = p_attempt_id and status = 'sending'
  for update;
  if not found then raise exception 'DELIVERY_ATTEMPT_NOT_RUNNING'; end if;
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);

  select * into draft_row
  from public.contract_delivery_drafts
  where id = attempt_row.delivery_draft_id
  for update;
  select * into version_row
  from public.contract_versions
  where id = attempt_row.contract_version_id
  for update;

  if version_row.status <> 'approved'
    or version_row.checksum <> attempt_row.attachment_checksum
    or draft_row.version_checksum <> version_row.checksum then
    raise exception 'APPROVED_VERSION_CHANGED';
  end if;

  insert into public.email_messages (
    provider, provider_message_id, mailbox_identifier, direction, sender,
    recipients, subject, plain_body, occurred_at, processing_status,
    application_id, rfc_message_id, reference_message_ids, cc, raw_headers
  ) values (
    'mailru', p_provider_message_id, lower(p_sender), 'outbound', p_sender,
    jsonb_build_array(jsonb_build_object('address', attempt_row.recipient)),
    attempt_row.subject, attempt_row.body_text, now(), 'completed',
    attempt_row.application_id, p_provider_message_id, '[]'::jsonb,
    '[]'::jsonb, '{}'::jsonb
  )
  returning id into email_id;

  update public.contract_delivery_attempts
  set status = 'sent',
      provider_message_id = p_provider_message_id,
      provider_response = left(p_provider_response, 1000),
      outgoing_email_message_id = email_id,
      completed_at = now()
  where id = attempt_row.id;

  insert into public.contract_delivery_attachments (
    delivery_attempt_id, email_message_id, contract_version_id,
    filename, mime_type, file_size, checksum
  ) values (
    attempt_row.id, email_id, version_row.id,
    attempt_row.attachment_filename, attempt_row.attachment_mime,
    attempt_row.attachment_size, attempt_row.attachment_checksum
  );

  update public.contract_delivery_drafts
  set status = 'sent', sent_by = p_actor_id, sent_at = now()
  where id = draft_row.id;
  update public.contract_versions
  set status = 'delivered'
  where id = version_row.id;
  update public.contracts
  set status = 'delivered', sent_at = now()
  where id = attempt_row.contract_id;
  update public.applications
  set status = 'contract_sent'
  where id = attempt_row.application_id;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    p_actor_id, attempt_row.application_id, 'contract_delivery_attempt',
    attempt_row.id, 'contract.delivered',
    jsonb_build_object(
      'application_id', attempt_row.application_id,
      'contract_id', attempt_row.contract_id,
      'contract_version_id', version_row.id,
      'version_number', version_row.version_number,
      'checksum', version_row.checksum,
      'delivery_id', draft_row.id,
      'recipient_domain', split_part(lower(attempt_row.recipient), '@', 2),
      'smtp_message_id', p_provider_message_id
    )
  );
  return email_id;
end;
$$;

create function public.fail_contract_delivery(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_error_code text,
  p_error_message text,
  p_delivery_unknown boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.contract_delivery_attempts;
begin
  update public.contract_delivery_attempts
  set status = case when p_delivery_unknown
      then 'delivery_unknown'::public.contract_delivery_attempt_status
      else 'safe_failure'::public.contract_delivery_attempt_status end,
      safe_error_code = left(p_error_code, 100),
      safe_error_message = left(p_error_message, 500),
      completed_at = now()
  where id = p_attempt_id and status = 'sending'
  returning * into attempt_row;
  if attempt_row.id is null then return; end if;
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);

  update public.contract_delivery_drafts
  set status = case when p_delivery_unknown
      then 'reconciliation_required'::public.contract_delivery_draft_status
      else 'send_failed'::public.contract_delivery_draft_status end
  where id = attempt_row.delivery_draft_id;
  update public.applications
  set status = 'contract_ready'
  where id = attempt_row.application_id and status = 'sending';

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    p_actor_id, attempt_row.application_id, 'contract_delivery_attempt',
    attempt_row.id,
    case when p_delivery_unknown
      then 'contract.delivery_uncertain'
      else 'contract.delivery_failed' end,
    jsonb_build_object(
      'application_id', attempt_row.application_id,
      'contract_id', attempt_row.contract_id,
      'contract_version_id', attempt_row.contract_version_id,
      'delivery_id', attempt_row.delivery_draft_id,
      'checksum', attempt_row.attachment_checksum,
      'recipient_domain', split_part(lower(attempt_row.recipient), '@', 2),
      'safe_error_code', left(p_error_code, 100)
    )
  );
end;
$$;

alter table public.contract_version_reviews enable row level security;
alter table public.contract_delivery_drafts enable row level security;
alter table public.contract_delivery_attempts enable row level security;
alter table public.contract_delivery_attachments enable row level security;

create policy contract_reviews_active_select on public.contract_version_reviews
for select to authenticated using (public.is_active_user());
create policy contract_delivery_drafts_active_select on public.contract_delivery_drafts
for select to authenticated using (public.is_active_user());
create policy contract_delivery_attempts_active_select on public.contract_delivery_attempts
for select to authenticated using (public.is_active_user());
create policy contract_delivery_attachments_active_select on public.contract_delivery_attachments
for select to authenticated using (public.is_active_user());

revoke all on public.contract_version_reviews from public, anon, authenticated;
revoke all on public.contract_delivery_drafts from public, anon, authenticated;
revoke all on public.contract_delivery_attempts from public, anon, authenticated;
revoke all on public.contract_delivery_attachments from public, anon, authenticated;
grant select on public.contract_version_reviews, public.contract_delivery_drafts,
  public.contract_delivery_attempts, public.contract_delivery_attachments
  to authenticated;

revoke all on function public.review_contract_version(
  uuid, uuid, public.contract_review_decision, text, text
) from public, anon, authenticated;
revoke all on function public.claim_contract_delivery(
  uuid, uuid, text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.finalize_contract_delivery(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.fail_contract_delivery(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.review_contract_version(
  uuid, uuid, public.contract_review_decision, text, text
) to service_role;
grant execute on function public.claim_contract_delivery(
  uuid, uuid, text, text, text, bigint
) to service_role;
grant execute on function public.finalize_contract_delivery(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.fail_contract_delivery(
  uuid, uuid, text, text, boolean
) to service_role;

commit;
