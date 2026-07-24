begin;

create table public.extraction_acceptance_batches (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  acceptance_method text not null check (acceptance_method in ('automatic', 'bulk')),
  validator_version text not null,
  batch_fingerprint text not null check (char_length(batch_fingerprint) = 64),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  accepted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (application_id, batch_fingerprint)
);

create table public.extracted_field_acceptances (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.extraction_acceptance_batches(id) on delete restrict,
  application_id uuid not null references public.applications(id) on delete cascade,
  extracted_field_id uuid not null references public.extracted_fields(id) on delete cascade,
  extraction_run_id uuid references public.extraction_runs(id) on delete set null,
  value_fingerprint text not null check (char_length(value_fingerprint) = 64),
  acceptance_method text not null check (acceptance_method in ('automatic', 'bulk')),
  validator_version text not null,
  accepted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (extracted_field_id, value_fingerprint)
);

create table public.application_processing_runs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  input_fingerprint text not null check (char_length(input_fingerprint) = 64),
  status text not null default 'running'
    check (status in ('running', 'completed', 'completed_with_review', 'failed')),
  stages jsonb not null default '{}'::jsonb,
  processed_by uuid not null references public.profiles(id) on delete restrict,
  safe_error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint application_processing_completion_consistent check (
    (status = 'running' and completed_at is null and safe_error_code is null)
    or
    (status in ('completed', 'completed_with_review') and completed_at is not null and safe_error_code is null)
    or
    (status = 'failed' and completed_at is not null and safe_error_code is not null)
  )
);

create unique index application_processing_one_running
  on public.application_processing_runs(application_id)
  where status = 'running';

create unique index application_processing_success_cache
  on public.application_processing_runs(application_id, input_fingerprint)
  where status in ('completed', 'completed_with_review');

create unique index completeness_runs_fingerprint_key
  on public.completeness_runs(
    application_id, rule_set_id, rule_set_version, extraction_fingerprint
  );

alter table public.extraction_conflicts
  add column resolved_at timestamptz,
  add column resolution_type text,
  add column resolution_metadata jsonb not null default '{}'::jsonb,
  add constraint extraction_conflicts_resolution_consistent check (
    (resolved_at is null and resolution_type is null)
    or
    (resolved_at is not null and resolution_type in ('canonical_equivalence', 'irrelevant_candidate'))
  );

create index extraction_acceptances_application_idx
  on public.extracted_field_acceptances(application_id, created_at desc);

alter table public.extraction_acceptance_batches enable row level security;
alter table public.extracted_field_acceptances enable row level security;
alter table public.application_processing_runs enable row level security;

create policy extraction_acceptance_batches_active_select
on public.extraction_acceptance_batches
for select to authenticated
using (public.is_active_user());

create policy extracted_field_acceptances_active_select
on public.extracted_field_acceptances
for select to authenticated
using (public.is_active_user());

create policy application_processing_runs_active_select
on public.application_processing_runs
for select to authenticated
using (public.is_active_user());

revoke all on public.extraction_acceptance_batches from public, anon, authenticated;
revoke all on public.extracted_field_acceptances from public, anon, authenticated;
revoke all on public.application_processing_runs from public, anon, authenticated;
grant select on public.extraction_acceptance_batches, public.extracted_field_acceptances
  to authenticated;
grant select on public.application_processing_runs to authenticated;

create function public.prevent_extraction_acceptance_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'extraction acceptance records are immutable';
end;
$$;

create trigger extracted_field_acceptances_immutable
before update or delete on public.extracted_field_acceptances
for each row execute function public.prevent_extraction_acceptance_mutation();

create function public.record_safe_field_acceptances(
  p_application_id uuid,
  p_actor_id uuid,
  p_method text,
  p_validator_version text,
  p_batch_fingerprint text,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_batch public.extraction_acceptance_batches;
  created_batch public.extraction_acceptance_batches;
  candidate jsonb;
  field public.extracted_fields;
  expected_fingerprint text;
  inserted_count integer := 0;
  blocked_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_method not in ('automatic', 'bulk')
     or char_length(p_batch_fingerprint) <> 64
     or jsonb_typeof(p_candidates) <> 'array'
     or not exists (
       select 1 from public.profiles
       where id = p_actor_id and is_active and role in ('admin', 'specialist')
     ) then
    raise exception 'invalid acceptance input';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('field-acceptance:' || p_application_id::text, 0)
  );

  select * into existing_batch
  from public.extraction_acceptance_batches
  where application_id = p_application_id
    and batch_fingerprint = p_batch_fingerprint;
  if found then
    return jsonb_build_object(
      'batch_id', existing_batch.id,
      'accepted_count', existing_batch.accepted_count,
      'blocked_count', existing_batch.blocked_count,
      'cache_hit', true
    );
  end if;

  insert into public.extraction_acceptance_batches (
    application_id, acceptance_method, validator_version,
    batch_fingerprint, accepted_by
  ) values (
    p_application_id, p_method, p_validator_version,
    p_batch_fingerprint, p_actor_id
  )
  returning * into created_batch;

  for candidate in select value from jsonb_array_elements(p_candidates)
  loop
    select * into field
    from public.extracted_fields
    where id = (candidate->>'field_id')::uuid
      and application_id = p_application_id
    for update;
    if not found then
      blocked_count := blocked_count + 1;
      continue;
    end if;

    expected_fingerprint := encode(
      extensions.digest(
        concat_ws(
          '|',
          field.field_name,
          coalesce(field.structured_value->>'normalizedValue', field.raw_value, ''),
          coalesce(field.source_type, ''),
          coalesce(field.source_id::text, ''),
          coalesce(field.source_marker, ''),
          coalesce(field.source_excerpt, '')
        ),
        'sha256'
      ),
      'hex'
    );
    if expected_fingerprint <> candidate->>'value_fingerprint' then
      blocked_count := blocked_count + 1;
      continue;
    end if;

    insert into public.extracted_field_acceptances (
      batch_id, application_id, extracted_field_id, extraction_run_id,
      value_fingerprint, acceptance_method, validator_version, accepted_by
    ) values (
      created_batch.id, p_application_id, field.id, field.extraction_run_id,
      expected_fingerprint, p_method, p_validator_version, p_actor_id
    )
    on conflict (extracted_field_id, value_fingerprint) do nothing;

    if found then
      inserted_count := inserted_count + 1;
    end if;

    update public.extracted_fields
    set requires_review = false,
        conflict_detected = case
          when coalesce((candidate->>'resolve_conflict')::boolean, false)
            then false
          else conflict_detected
        end
    where id = field.id;

    if coalesce((candidate->>'resolve_conflict')::boolean, false) then
      update public.extraction_conflicts
      set requires_review = false,
          resolved_at = now(),
          resolution_type = 'irrelevant_candidate',
          resolution_metadata = jsonb_build_object(
            'validator_version', p_validator_version,
            'batch_id', created_batch.id
          )
      where application_id = p_application_id
        and field_name = field.field_name
        and requires_review;
    end if;
  end loop;

  update public.extraction_acceptance_batches
  set accepted_count = inserted_count,
      blocked_count = blocked_count
  where id = created_batch.id;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    p_actor_id, p_application_id, 'extraction_acceptance_batch',
    created_batch.id,
    case p_method
      when 'bulk' then 'extraction.bulk_accepted'
      else 'extraction.safe_fields_auto_accepted'
    end,
    jsonb_build_object(
      'application_id', p_application_id,
      'acceptance_method', p_method,
      'validator_version', p_validator_version,
      'accepted_count', inserted_count,
      'blocked_count', blocked_count
    )
  );

  return jsonb_build_object(
    'batch_id', created_batch.id,
    'accepted_count', inserted_count,
    'blocked_count', blocked_count,
    'cache_hit', false
  );
end;
$$;

revoke all on function public.record_safe_field_acceptances(
  uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_safe_field_acceptances(
  uuid, uuid, text, text, text, jsonb
) to service_role;

create function public.claim_application_processing(
  p_application_id uuid,
  p_actor_id uuid,
  p_input_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.application_processing_runs;
  created public.application_processing_runs;
begin
  if auth.role() <> 'service_role'
     or char_length(p_input_fingerprint) <> 64
     or not exists (
       select 1 from public.profiles
       where id = p_actor_id and is_active and role in ('admin', 'specialist')
     ) then
    raise exception 'invalid processing claim';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('application-processing:' || p_application_id::text, 0)
  );
  select * into existing
  from public.application_processing_runs
  where application_id = p_application_id
    and input_fingerprint = p_input_fingerprint
    and status in ('completed', 'completed_with_review')
  order by completed_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'claimed', false, 'cache_hit', true, 'run_id', existing.id,
      'status', existing.status
    );
  end if;
  select * into existing
  from public.application_processing_runs
  where application_id = p_application_id and status = 'running'
  limit 1;
  if found then
    return jsonb_build_object(
      'claimed', false, 'cache_hit', false, 'run_id', existing.id,
      'status', existing.status
    );
  end if;
  insert into public.application_processing_runs (
    application_id, input_fingerprint, processed_by
  ) values (
    p_application_id, p_input_fingerprint, p_actor_id
  ) returning * into created;
  return jsonb_build_object(
    'claimed', true, 'cache_hit', false, 'run_id', created.id,
    'status', created.status
  );
end;
$$;

revoke all on function public.claim_application_processing(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_application_processing(uuid, uuid, text)
  to service_role;

commit;
