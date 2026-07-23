begin;

alter table public.contract_templates
  drop constraint if exists approved_template_has_storage;

alter table public.contract_templates
  alter column status type text using status::text,
  add column code text,
  add column template_type text,
  add column checksum text,
  add column original_filename text,
  add column mime_type text,
  add column required_rule_set text,
  add column placeholder_schema_version text,
  add column validation_report jsonb not null default '{}'::jsonb,
  add column approved_by uuid references public.profiles(id) on delete set null,
  add column approved_at timestamptz;

update public.contract_templates
set status = 'awaiting_approval',
    is_active = false
where status = 'approved';

alter table public.contract_templates
  add constraint contract_templates_status_check
    check (status in ('draft', 'awaiting_approval', 'approved', 'inactive', 'archived')),
  add constraint contract_templates_type_check
    check (template_type is null or template_type in ('services', 'consulting', 'supply', 'generic')),
  add constraint contract_templates_code_format
    check (code is null or code ~ '^[a-z0-9][a-z0-9_-]{1,99}$'),
  add constraint contract_templates_checksum_format
    check (checksum is null or checksum ~ '^[0-9a-f]{64}$'),
  add constraint contract_templates_validation_object
    check (jsonb_typeof(validation_report) = 'object'),
  add constraint contract_templates_approval_complete
    check (
      status <> 'approved'
      or (
        is_active
        and storage_path is not null
        and checksum is not null
        and approved_by is not null
        and approved_at is not null
        and validation_report ->> 'valid' = 'true'
      )
    );

create unique index contract_templates_code_version_key
on public.contract_templates(code, version)
where code is not null;

alter table public.contracts
  add column contract_number text,
  add column created_by uuid references public.profiles(id) on delete set null;

create unique index contracts_contract_number_key
on public.contracts(contract_number)
where contract_number is not null;
create unique index contracts_application_template_key
on public.contracts(application_id, template_id);

alter table public.contract_versions
  add column template_id uuid references public.contract_templates(id) on delete restrict,
  add column template_version text,
  add column source_fingerprint text,
  add column completeness_run_id uuid references public.completeness_runs(id) on delete restrict,
  add column extraction_run_id uuid references public.extraction_runs(id) on delete set null,
  add column placeholder_schema_version text,
  add column mapping_version text,
  add column rendered_values_snapshot jsonb not null default '{}'::jsonb,
  add column original_filename text,
  add column generated_filename text,
  add column file_size bigint,
  add column generated_at timestamptz not null default now(),
  add column status text not null default 'awaiting_review',
  add column generation_warnings jsonb not null default '[]'::jsonb;

alter table public.contract_versions
  add constraint contract_versions_status_check
    check (status in ('generated', 'awaiting_review', 'approved', 'rejected', 'superseded', 'void')),
  add constraint contract_versions_source_fingerprint_format
    check (source_fingerprint is null or source_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint contract_versions_rendered_snapshot_object
    check (jsonb_typeof(rendered_values_snapshot) = 'object'),
  add constraint contract_versions_warnings_array
    check (jsonb_typeof(generation_warnings) = 'array'),
  add constraint contract_versions_file_size_positive
    check (file_size is null or file_size > 0);

create sequence public.contract_number_seq;

create function public.format_contract_number(p_sequence bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select 'TAA-' || extract(year from current_date)::integer::text || '-' ||
    lpad(p_sequence::text, 6, '0');
$$;

create type public.contract_generation_run_status as enum (
  'running', 'completed', 'failed'
);

create table public.contract_generation_runs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  template_id uuid not null references public.contract_templates(id) on delete restrict,
  completeness_run_id uuid not null references public.completeness_runs(id) on delete restrict,
  idempotency_key text not null,
  source_fingerprint text not null,
  placeholder_schema_version text not null,
  mapping_version text not null,
  contract_number text not null,
  status public.contract_generation_run_status not null default 'running',
  force_requested boolean not null default false,
  force_reason text,
  contract_version_id uuid references public.contract_versions(id) on delete set null,
  safe_error_code text,
  initiated_by uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint contract_generation_fingerprint_format
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint contract_generation_force_reason
    check (
      not force_requested
      or char_length(btrim(coalesce(force_reason, ''))) between 2 and 1000
    )
);

create unique index contract_generation_idempotency_completed_key
on public.contract_generation_runs(idempotency_key)
where status = 'completed' and not force_requested;
create unique index contract_generation_running_key
on public.contract_generation_runs(application_id)
where status = 'running';

alter table public.contract_generation_runs enable row level security;
create policy contract_generation_runs_select_active
on public.contract_generation_runs for select to authenticated
using (public.is_active_user());

create function public.begin_contract_generation(
  p_application_id uuid,
  p_template_id uuid,
  p_completeness_run_id uuid,
  p_idempotency_key text,
  p_source_fingerprint text,
  p_placeholder_schema_version text,
  p_mapping_version text,
  p_initiated_by uuid,
  p_force boolean default false,
  p_force_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.contract_templates;
  completeness_row public.completeness_runs;
  existing_run public.contract_generation_runs;
  new_run public.contract_generation_runs;
begin
  perform set_config('request.jwt.claim.sub', p_initiated_by::text, true);
  perform pg_advisory_xact_lock(hashtextextended(p_application_id::text, 0));

  select * into template_row
  from public.contract_templates
  where id = p_template_id;
  if not found or template_row.status <> 'approved' or not template_row.is_active then
    raise exception 'TEMPLATE_NOT_APPROVED';
  end if;

  select * into completeness_row
  from public.completeness_runs
  where id = p_completeness_run_id
    and application_id = p_application_id;
  if not found
    or not completeness_row.is_ready
    or completeness_row.is_blocking
    or completeness_row.extraction_fingerprint <> p_source_fingerprint
    or template_row.required_rule_set <> completeness_row.rule_set_id then
    raise exception 'APPLICATION_NOT_READY';
  end if;

  if exists (
    select 1 from public.completeness_field_results
    where completeness_run_id = p_completeness_run_id and is_blocking
  ) then
    raise exception 'APPLICATION_HAS_BLOCKING_FIELDS';
  end if;

  if exists (
    select 1 from public.email_messages
    where application_id = p_application_id
      and created_at > completeness_row.created_at
  ) or exists (
    select 1 from public.attachments
    where application_id = p_application_id
      and created_at > completeness_row.created_at
  ) or exists (
    select 1 from public.extracted_fields
    where application_id = p_application_id
      and updated_at > completeness_row.created_at
  ) then
    raise exception 'COMPLETENESS_STALE';
  end if;

  if not p_force then
    select * into existing_run
    from public.contract_generation_runs
    where idempotency_key = p_idempotency_key
      and status = 'completed'
      and not force_requested
    order by completed_at desc
    limit 1;
    if found then
      insert into public.audit_events (
        actor_id, application_id, entity_type, entity_id, action, metadata
      ) values (
        p_initiated_by, p_application_id, 'contract_version',
        existing_run.contract_version_id, 'contract.generation_cache_hit',
        jsonb_build_object(
          'template_id', p_template_id,
          'completeness_run_id', p_completeness_run_id,
          'source_fingerprint', p_source_fingerprint
        )
      );
      return jsonb_build_object(
        'run_id', existing_run.id,
        'claimed', false,
        'cache_hit', true,
        'contract_version_id', existing_run.contract_version_id
      );
    end if;
  end if;

  insert into public.contract_generation_runs (
    application_id, template_id, completeness_run_id, idempotency_key,
    source_fingerprint, placeholder_schema_version, mapping_version,
    initiated_by, force_requested, force_reason, contract_number
  ) values (
    p_application_id, p_template_id, p_completeness_run_id, p_idempotency_key,
    p_source_fingerprint, p_placeholder_schema_version, p_mapping_version,
    p_initiated_by, p_force, nullif(btrim(coalesce(p_force_reason, '')), ''),
    coalesce(
      (
        select contract_number from public.contracts
        where application_id = p_application_id and template_id = p_template_id
      ),
      public.format_contract_number(nextval('public.contract_number_seq'))
    )
  )
  returning * into new_run;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    p_initiated_by, p_application_id, 'contract_generation_run', new_run.id,
    'contract.generation_started',
    jsonb_build_object(
      'template_id', p_template_id,
      'completeness_run_id', p_completeness_run_id,
      'source_fingerprint', p_source_fingerprint,
      'force_requested', p_force
    )
  );

  update public.applications
  set status = 'generating_contract'
  where id = p_application_id;

  return jsonb_build_object(
    'run_id', new_run.id,
    'claimed', true,
    'cache_hit', false,
    'contract_version_id', null,
    'contract_number', new_run.contract_number
  );
end;
$$;

create function public.finalize_contract_generation(
  p_run_id uuid,
  p_storage_path text,
  p_checksum text,
  p_generated_filename text,
  p_file_size bigint,
  p_rendered_values jsonb,
  p_generation_warnings jsonb,
  p_extraction_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.contract_generation_runs;
  template_row public.contract_templates;
  contract_row public.contracts;
  version_row public.contract_versions;
  next_version integer;
begin
  select * into run_row
  from public.contract_generation_runs
  where id = p_run_id and status = 'running'
  for update;
  if not found then raise exception 'GENERATION_RUN_NOT_RUNNING'; end if;

  perform set_config('request.jwt.claim.sub', run_row.initiated_by::text, true);
  perform pg_advisory_xact_lock(hashtextextended(run_row.application_id::text, 0));

  if not exists (
    select 1 from public.completeness_runs
    where id = run_row.completeness_run_id
      and application_id = run_row.application_id
      and is_ready and not is_blocking
      and extraction_fingerprint = run_row.source_fingerprint
  ) then
    raise exception 'APPLICATION_NOT_READY';
  end if;

  select * into template_row from public.contract_templates
  where id = run_row.template_id and status = 'approved' and is_active;
  if not found then raise exception 'TEMPLATE_NOT_APPROVED'; end if;

  select * into contract_row
  from public.contracts
  where application_id = run_row.application_id
    and template_id = run_row.template_id
  for update;

  if not found then
    insert into public.contracts (
      application_id, template_id, contract_number, status, created_by
    ) values (
      run_row.application_id,
      run_row.template_id,
      run_row.contract_number,
      'generated',
      run_row.initiated_by
    )
    returning * into contract_row;
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.contract_versions where contract_id = contract_row.id;

  insert into public.contract_versions (
    contract_id, version_number, storage_path, checksum, generation_metadata,
    created_by, template_id, template_version, source_fingerprint,
    completeness_run_id, extraction_run_id, placeholder_schema_version,
    mapping_version, rendered_values_snapshot, original_filename,
    generated_filename, file_size, status, generation_warnings
  ) values (
    contract_row.id, next_version, p_storage_path, p_checksum,
    jsonb_build_object('generation_run_id', run_row.id),
    run_row.initiated_by, template_row.id, template_row.version,
    run_row.source_fingerprint, run_row.completeness_run_id, p_extraction_run_id,
    run_row.placeholder_schema_version, run_row.mapping_version,
    p_rendered_values, template_row.original_filename, p_generated_filename,
    p_file_size, 'awaiting_review', p_generation_warnings
  )
  returning * into version_row;

  update public.contracts
  set current_version_id = version_row.id,
      status = 'under_review'
  where id = contract_row.id;

  update public.contract_generation_runs
  set status = 'completed',
      contract_version_id = version_row.id,
      completed_at = now()
  where id = run_row.id;

  update public.applications
  set status = 'contract_ready'
  where id = run_row.application_id;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    run_row.initiated_by, run_row.application_id, 'contract_version',
    version_row.id,
    case when run_row.force_requested
      then 'contract.version_regenerated'
      else 'contract.generated'
    end,
    jsonb_build_object(
      'contract_id', contract_row.id,
      'version_id', version_row.id,
      'template_id', template_row.id,
      'template_version', template_row.version,
      'completeness_run_id', run_row.completeness_run_id,
      'source_fingerprint', run_row.source_fingerprint,
      'checksum', p_checksum,
      'generated_by', run_row.initiated_by
    )
  );

  return jsonb_build_object(
    'contract_id', contract_row.id,
    'contract_number', contract_row.contract_number,
    'contract_version_id', version_row.id,
    'version_number', version_row.version_number
  );
end;
$$;

create function public.fail_contract_generation(
  p_run_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.contract_generation_runs;
begin
  update public.contract_generation_runs
  set status = 'failed',
      safe_error_code = left(coalesce(p_error_code, 'GENERATION_FAILED'), 100),
      completed_at = now()
  where id = p_run_id and status = 'running'
  returning * into run_row;

  if run_row.id is not null then
    perform set_config('request.jwt.claim.sub', run_row.initiated_by::text, true);
    update public.applications
    set status = 'data_complete'
    where id = run_row.application_id and status = 'generating_contract';

    insert into public.audit_events (
      actor_id, application_id, entity_type, entity_id, action, metadata
    ) values (
      run_row.initiated_by, run_row.application_id, 'contract_generation_run',
      run_row.id, 'contract.generation_failed',
      jsonb_build_object(
        'template_id', run_row.template_id,
        'completeness_run_id', run_row.completeness_run_id,
        'source_fingerprint', run_row.source_fingerprint,
        'safe_error_code', left(coalesce(p_error_code, 'GENERATION_FAILED'), 100)
      )
    );
  end if;
end;
$$;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'contract-documents',
  'contract-documents',
  false,
  10485760,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy contract_documents_select_active
on storage.objects for select to authenticated
using (bucket_id = 'contract-documents' and public.is_active_user());

drop policy if exists templates_insert_active on public.contract_templates;
drop policy if exists templates_update_active on public.contract_templates;
drop policy if exists templates_delete_admin on public.contract_templates;
revoke insert, update, delete on public.contract_templates from authenticated;

revoke all on public.contract_generation_runs from public, anon, authenticated;
grant select on public.contract_generation_runs to authenticated;
grant usage on type public.contract_generation_run_status to authenticated;
revoke all on function public.begin_contract_generation(
  uuid, uuid, uuid, text, text, text, text, uuid, boolean, text
) from public, anon, authenticated;
revoke all on function public.finalize_contract_generation(
  uuid, text, text, text, bigint, jsonb, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.fail_contract_generation(uuid, text)
from public, anon, authenticated;
grant execute on function public.begin_contract_generation(
  uuid, uuid, uuid, text, text, text, text, uuid, boolean, text
) to service_role;
grant execute on function public.finalize_contract_generation(
  uuid, text, text, text, bigint, jsonb, jsonb, uuid
) to service_role;
grant execute on function public.fail_contract_generation(uuid, text)
to service_role;

commit;
