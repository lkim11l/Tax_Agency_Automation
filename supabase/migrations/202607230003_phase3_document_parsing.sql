begin;

create type public.document_parse_status as enum (
  'pending',
  'processing',
  'parsed',
  'review_required',
  'unsupported',
  'blocked',
  'failed'
);

alter table public.attachments
  alter column parse_status drop default,
  alter column parse_status type public.document_parse_status
    using (
      case parse_status::text
        when 'completed' then 'parsed'
        else parse_status::text
      end
    )::public.document_parse_status,
  alter column parse_status set default 'pending',
  add column parse_error_code text,
  add column parse_started_at timestamptz,
  add column parse_completed_at timestamptz;

create index attachments_parse_pending_idx
on public.attachments (created_at, id)
where parse_status = 'pending';

update storage.buckets
set allowed_mime_types = null
where id = 'email-attachments';

create table public.parsed_documents (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null unique
    references public.attachments(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  status public.document_parse_status not null,
  parser_type text not null,
  parser_version text not null,
  normalized_text text,
  text_length integer not null default 0,
  detected_language text,
  source_metadata jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parsed_documents_text_length_nonnegative
    check (text_length >= 0),
  constraint parsed_documents_text_length_matches
    check (text_length = char_length(coalesce(normalized_text, ''))),
  constraint parsed_documents_metadata_object
    check (jsonb_typeof(source_metadata) = 'object'),
  constraint parsed_documents_warnings_array
    check (jsonb_typeof(warnings) = 'array'),
  constraint parsed_documents_completion_state
    check (
      (status in ('pending', 'processing') and completed_at is null)
      or
      (status in ('parsed', 'review_required', 'unsupported', 'blocked', 'failed')
        and completed_at is not null)
    ),
  constraint parsed_documents_error_state
    check (
      (status = 'parsed' and error_code is null and error_message is null)
      or status <> 'parsed'
    )
);

create index parsed_documents_application_idx
on public.parsed_documents (application_id, updated_at desc);

create table public.document_parse_attempts (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null
    references public.attachments(id) on delete cascade,
  status public.document_parse_status not null,
  parser_type text not null,
  parser_version text not null,
  text_length integer not null default 0,
  source_metadata jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint document_parse_attempts_text_length_nonnegative
    check (text_length >= 0),
  constraint document_parse_attempts_metadata_object
    check (jsonb_typeof(source_metadata) = 'object'),
  constraint document_parse_attempts_warnings_array
    check (jsonb_typeof(warnings) = 'array'),
  constraint document_parse_attempts_completion_state
    check (
      (status = 'processing' and completed_at is null)
      or
      (status in ('parsed', 'review_required', 'unsupported', 'blocked', 'failed')
        and completed_at is not null)
    )
);

create index document_parse_attempts_attachment_idx
on public.document_parse_attempts (attachment_id, started_at desc);

create trigger parsed_documents_set_updated_at
before update on public.parsed_documents
for each row execute function public.set_updated_at();

create function public.prevent_document_parse_attempt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.completed_at is not null then
    raise exception 'Document parse attempts are immutable after completion';
  end if;
  return new;
end;
$$;

create trigger document_parse_attempts_immutable
before update or delete on public.document_parse_attempts
for each row execute function public.prevent_document_parse_attempt_mutation();

alter table public.parsed_documents enable row level security;
alter table public.document_parse_attempts enable row level security;

create policy parsed_documents_select_active
on public.parsed_documents
for select to authenticated
using (public.is_active_user());

create policy document_parse_attempts_select_active
on public.document_parse_attempts
for select to authenticated
using (public.is_active_user());

create function public.claim_attachment_for_parsing(
  p_attachment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.attachments;
  attempt_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Document parsing requires the server role';
  end if;

  select *
  into target
  from public.attachments
  where parse_status = 'pending'
    and (p_attachment_id is null or id = p_attachment_id)
  order by created_at, id
  for update skip locked
  limit 1;

  if target.id is null then
    return null;
  end if;

  update public.attachments
  set
    parse_status = 'processing',
    parse_error = null,
    parse_error_code = null,
    parse_started_at = now(),
    parse_completed_at = null
  where id = target.id;

  insert into public.document_parse_attempts (
    attachment_id,
    status,
    parser_type,
    parser_version,
    started_at
  ) values (
    target.id,
    'processing',
    'registry',
    '1',
    now()
  )
  returning id into attempt_id;

  insert into public.parsed_documents (
    attachment_id,
    application_id,
    status,
    parser_type,
    parser_version,
    normalized_text,
    text_length,
    detected_language,
    source_metadata,
    warnings,
    error_code,
    error_message,
    started_at,
    completed_at
  ) values (
    target.id,
    target.application_id,
    'processing',
    'registry',
    '1',
    null,
    0,
    null,
    '{}'::jsonb,
    '[]'::jsonb,
    null,
    null,
    now(),
    null
  )
  on conflict (attachment_id) do update set
    application_id = excluded.application_id,
    status = excluded.status,
    parser_type = excluded.parser_type,
    parser_version = excluded.parser_version,
    normalized_text = null,
    text_length = 0,
    detected_language = null,
    source_metadata = '{}'::jsonb,
    warnings = '[]'::jsonb,
    error_code = null,
    error_message = null,
    started_at = excluded.started_at,
    completed_at = null;

  insert into public.audit_events (
    actor_id,
    application_id,
    entity_type,
    entity_id,
    action,
    metadata
  ) values (
    null,
    target.application_id,
    'attachment',
    target.id,
    'document.parse_started',
    jsonb_build_object('attempt_id', attempt_id)
  );

  return jsonb_build_object(
    'attachment_id', target.id,
    'application_id', target.application_id,
    'attempt_id', attempt_id,
    'original_filename', target.original_filename,
    'sanitized_filename', target.sanitized_filename,
    'mime_type', target.mime_type,
    'size_bytes', target.size_bytes,
    'storage_path', target.storage_path,
    'checksum', target.checksum
  );
end;
$$;

create function public.finalize_document_parse(
  p_attachment_id uuid,
  p_attempt_id uuid,
  p_result jsonb
)
returns public.parsed_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.attachments;
  parsed public.parsed_documents;
  final_status public.document_parse_status;
  final_action text;
  completed_time timestamptz := now();
  result_text text := p_result ->> 'normalized_text';
  result_metadata jsonb := coalesce(p_result -> 'source_metadata', '{}'::jsonb);
  result_warnings jsonb := coalesce(p_result -> 'warnings', '[]'::jsonb);
begin
  if auth.role() <> 'service_role' then
    raise exception 'Document parsing requires the server role';
  end if;

  final_status := (p_result ->> 'status')::public.document_parse_status;
  if final_status not in ('parsed', 'review_required', 'unsupported', 'blocked', 'failed') then
    raise exception 'Invalid terminal document parse status';
  end if;
  if jsonb_typeof(result_metadata) <> 'object'
    or jsonb_typeof(result_warnings) <> 'array' then
    raise exception 'Invalid document parse metadata';
  end if;

  select *
  into target
  from public.attachments
  where id = p_attachment_id
  for update;

  if target.id is null or target.parse_status <> 'processing' then
    raise exception 'Attachment is not actively being parsed';
  end if;

  update public.attachments
  set
    parse_status = final_status,
    parse_error_code = nullif(p_result ->> 'error_code', ''),
    parse_error = nullif(p_result ->> 'error_message', ''),
    parse_completed_at = completed_time
  where id = p_attachment_id;

  insert into public.parsed_documents (
    attachment_id,
    application_id,
    status,
    parser_type,
    parser_version,
    normalized_text,
    text_length,
    detected_language,
    source_metadata,
    warnings,
    error_code,
    error_message,
    started_at,
    completed_at
  ) values (
    p_attachment_id,
    target.application_id,
    final_status,
    coalesce(nullif(p_result ->> 'parser_type', ''), 'unknown'),
    coalesce(nullif(p_result ->> 'parser_version', ''), '1'),
    result_text,
    char_length(coalesce(result_text, '')),
    nullif(p_result ->> 'detected_language', ''),
    result_metadata,
    result_warnings,
    nullif(p_result ->> 'error_code', ''),
    nullif(p_result ->> 'error_message', ''),
    target.parse_started_at,
    completed_time
  )
  on conflict (attachment_id) do update set
    application_id = excluded.application_id,
    status = excluded.status,
    parser_type = excluded.parser_type,
    parser_version = excluded.parser_version,
    normalized_text = excluded.normalized_text,
    text_length = excluded.text_length,
    detected_language = excluded.detected_language,
    source_metadata = excluded.source_metadata,
    warnings = excluded.warnings,
    error_code = excluded.error_code,
    error_message = excluded.error_message,
    started_at = excluded.started_at,
    completed_at = excluded.completed_at
  returning * into parsed;

  update public.document_parse_attempts
  set
    status = final_status,
    parser_type = parsed.parser_type,
    parser_version = parsed.parser_version,
    text_length = parsed.text_length,
    source_metadata = parsed.source_metadata,
    warnings = parsed.warnings,
    error_code = parsed.error_code,
    error_message = parsed.error_message,
    completed_at = completed_time
  where id = p_attempt_id
    and attachment_id = p_attachment_id
    and status = 'processing'
    and completed_at is null;

  if not found then
    raise exception 'Active parse attempt was not found';
  end if;

  final_action := case final_status
    when 'parsed' then 'document.parsed'
    when 'review_required' then 'document.parse_review_required'
    when 'unsupported' then 'document.parse_unsupported'
    when 'blocked' then 'document.parse_blocked'
    else 'document.parse_failed'
  end;

  insert into public.audit_events (
    actor_id,
    application_id,
    entity_type,
    entity_id,
    action,
    metadata
  ) values (
    null,
    target.application_id,
    'attachment',
    target.id,
    final_action,
    jsonb_build_object(
      'attempt_id', p_attempt_id,
      'error_code', parsed.error_code,
      'parser_type', parsed.parser_type,
      'parser_version', parsed.parser_version,
      'text_length', parsed.text_length,
      'warning_count', jsonb_array_length(parsed.warnings)
    )
  );

  if jsonb_array_length(parsed.warnings) > 0 then
    insert into public.audit_events (
      actor_id,
      application_id,
      entity_type,
      entity_id,
      action,
      metadata
    ) values (
      null,
      target.application_id,
      'attachment',
      target.id,
      'document.parse_warning',
      jsonb_build_object(
        'attempt_id', p_attempt_id,
        'warning_count', jsonb_array_length(parsed.warnings)
      )
    );
  end if;

  return parsed;
end;
$$;

create function public.request_document_parse(p_attachment_id uuid)
returns public.attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.attachments;
  previous_status public.document_parse_status;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  select parse_status
  into previous_status
  from public.attachments
  where id = p_attachment_id
  for update;

  if previous_status is null then
    raise exception 'Attachment not found or access denied';
  end if;
  if previous_status = 'processing' then
    raise exception 'Attachment is already being parsed';
  end if;

  update public.attachments
  set
    parse_status = 'pending',
    parse_error = null,
    parse_error_code = null,
    parse_started_at = null,
    parse_completed_at = null
  where id = p_attachment_id
  returning * into target;

  insert into public.audit_events (
    actor_id,
    application_id,
    entity_type,
    entity_id,
    action,
    metadata
  ) values (
    auth.uid(),
    target.application_id,
    'attachment',
    target.id,
    case
      when previous_status = 'pending' then 'document.parse_requested'
      else 'document.parse_retried'
    end,
    jsonb_build_object('previous_status', previous_status)
  );

  return target;
end;
$$;

revoke all on function public.claim_attachment_for_parsing(uuid)
from public, anon, authenticated;
revoke all on function public.finalize_document_parse(uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.request_document_parse(uuid)
from public, anon;

grant usage on type public.document_parse_status to authenticated;
grant select on public.parsed_documents, public.document_parse_attempts
to authenticated;
grant execute on function public.claim_attachment_for_parsing(uuid)
to service_role;
grant execute on function public.finalize_document_parse(uuid, uuid, jsonb)
to service_role;
grant execute on function public.request_document_parse(uuid)
to authenticated;

commit;
