create type public.extraction_run_status as enum (
  'running',
  'completed',
  'failed'
);

create table public.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  status public.extraction_run_status not null default 'running',
  input_fingerprint text not null,
  source_ids jsonb not null default '[]'::jsonb,
  provider text not null,
  model text not null,
  prompt_version text not null,
  schema_version text not null,
  request_id text,
  input_character_count integer not null default 0,
  input_token_count integer,
  output_token_count integer,
  duration_ms integer,
  conflict_count integer not null default 0,
  safe_error_code text,
  safe_error_message text,
  initiated_by uuid references public.profiles(id) on delete set null,
  force_requested boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint extraction_runs_fingerprint_length check (char_length(input_fingerprint) = 64),
  constraint extraction_runs_source_ids_array check (jsonb_typeof(source_ids) = 'array'),
  constraint extraction_runs_counts_nonnegative check (
    input_character_count >= 0
    and (input_token_count is null or input_token_count >= 0)
    and (output_token_count is null or output_token_count >= 0)
    and (duration_ms is null or duration_ms >= 0)
    and conflict_count >= 0
  ),
  constraint extraction_runs_completion_state check (
    (status = 'running' and completed_at is null and safe_error_code is null)
    or
    (status = 'completed' and completed_at is not null and safe_error_code is null)
    or
    (status = 'failed' and completed_at is not null and safe_error_code is not null)
  )
);

create index extraction_runs_application_idx
on public.extraction_runs (application_id, created_at desc);

create unique index extraction_runs_success_cache_key
on public.extraction_runs (application_id, input_fingerprint)
where status = 'completed' and force_requested = false;

create unique index extraction_runs_active_key
on public.extraction_runs (application_id, input_fingerprint)
where status = 'running';

alter table public.extracted_fields
  add column structured_value jsonb,
  add column source_marker text,
  add column extraction_run_id uuid references public.extraction_runs(id) on delete set null,
  add column prompt_version text,
  add column schema_version text,
  add column model text,
  add column correction_reason text,
  add column conflict_detected boolean not null default false;

create index extracted_fields_run_idx
on public.extracted_fields (extraction_run_id);

create index extracted_fields_application_field_idx
on public.extracted_fields (application_id, field_name, updated_at desc);

create table public.extraction_conflicts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  extraction_run_id uuid not null references public.extraction_runs(id) on delete cascade,
  field_name text not null,
  candidates jsonb not null,
  sources jsonb not null,
  conflict_type text not null,
  requires_review boolean not null default true,
  created_at timestamptz not null default now(),
  constraint extraction_conflicts_candidates_array check (jsonb_typeof(candidates) = 'array'),
  constraint extraction_conflicts_sources_array check (jsonb_typeof(sources) = 'array')
);

create index extraction_conflicts_application_idx
on public.extraction_conflicts (application_id, created_at desc);

create table public.extracted_field_corrections (
  id uuid primary key default gen_random_uuid(),
  extracted_field_id uuid not null references public.extracted_fields(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  previous_structured_value jsonb,
  corrected_structured_value jsonb,
  previous_raw_value text,
  corrected_raw_value text,
  reason text not null,
  correction_action text not null,
  corrected_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint extracted_field_correction_reason_present check (char_length(btrim(reason)) between 2 and 1000),
  constraint extracted_field_correction_action_valid check (
    correction_action in ('corrected', 'candidate_selected', 'manual_null_set')
  )
);

create index extracted_field_corrections_application_idx
on public.extracted_field_corrections (application_id, created_at desc);

create trigger extraction_runs_set_updated_at
before update on public.extraction_runs
for each row execute function public.set_updated_at();

create function public.prevent_extracted_field_correction_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'extracted field correction history is immutable';
end;
$$;

create trigger extracted_field_corrections_immutable
before update or delete on public.extracted_field_corrections
for each row execute function public.prevent_extracted_field_correction_mutation();

alter table public.extraction_runs enable row level security;
alter table public.extraction_conflicts enable row level security;
alter table public.extracted_field_corrections enable row level security;

create policy extraction_runs_select_active
on public.extraction_runs
for select to authenticated
using (public.is_active_user());

create policy extraction_conflicts_select_active
on public.extraction_conflicts
for select to authenticated
using (public.is_active_user());

create policy extracted_field_corrections_select_active
on public.extracted_field_corrections
for select to authenticated
using (public.is_active_user());

create function public.begin_extraction_run(
  p_application_id uuid,
  p_input_fingerprint text,
  p_source_ids jsonb,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_schema_version text,
  p_input_character_count integer,
  p_initiated_by uuid,
  p_force boolean default false
)
returns table (
  run_id uuid,
  claimed boolean,
  cache_hit boolean,
  run_status public.extraction_run_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.extraction_runs;
  created public.extraction_runs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_input_character_count < 0
     or char_length(p_input_fingerprint) <> 64
     or jsonb_typeof(p_source_ids) <> 'array' then
    raise exception 'invalid extraction run input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('extraction:' || p_application_id::text, 0));

  if not p_force then
    select *
    into existing
    from public.extraction_runs
    where application_id = p_application_id
      and input_fingerprint = p_input_fingerprint
      and status = 'completed'
      and force_requested = false
    order by completed_at desc
    limit 1;

    if found then
      insert into public.audit_events (
        actor_id,
        application_id,
        entity_type,
        entity_id,
        action,
        metadata
      ) values (
        p_initiated_by,
        p_application_id,
        'extraction_run',
        existing.id,
        'extraction.cache_hit',
        jsonb_build_object(
          'application_id', p_application_id,
          'extraction_run_id', existing.id,
          'prompt_version', existing.prompt_version,
          'schema_version', existing.schema_version,
          'model', existing.model
        )
      );

      return query select existing.id, false, true, existing.status;
      return;
    end if;
  end if;

  select *
  into existing
  from public.extraction_runs
  where application_id = p_application_id
    and input_fingerprint = p_input_fingerprint
    and status = 'running'
  order by started_at desc
  limit 1;

  if found then
    return query select existing.id, false, false, existing.status;
    return;
  end if;

  insert into public.extraction_runs (
    application_id,
    input_fingerprint,
    source_ids,
    provider,
    model,
    prompt_version,
    schema_version,
    input_character_count,
    initiated_by,
    force_requested
  ) values (
    p_application_id,
    p_input_fingerprint,
    p_source_ids,
    p_provider,
    p_model,
    p_prompt_version,
    p_schema_version,
    p_input_character_count,
    p_initiated_by,
    p_force
  )
  returning * into created;

  insert into public.audit_events (
    actor_id,
    application_id,
    entity_type,
    entity_id,
    action,
    metadata
  ) values (
    p_initiated_by,
    p_application_id,
    'extraction_run',
    created.id,
    'extraction.started',
    jsonb_build_object(
      'application_id', p_application_id,
      'extraction_run_id', created.id,
      'prompt_version', p_prompt_version,
      'schema_version', p_schema_version,
      'model', p_model
    )
  );

  return query select created.id, true, false, created.status;
end;
$$;

create function public.complete_extraction_run(
  p_run_id uuid,
  p_fields jsonb,
  p_conflicts jsonb,
  p_request_id text,
  p_input_token_count integer,
  p_output_token_count integer,
  p_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.extraction_runs;
  field_record jsonb;
  conflict_record jsonb;
  existing_field public.extracted_fields;
  conflict_total integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  if jsonb_typeof(p_fields) <> 'array' or jsonb_typeof(p_conflicts) <> 'array' then
    raise exception 'fields and conflicts must be arrays';
  end if;

  select *
  into run
  from public.extraction_runs
  where id = p_run_id
  for update;

  if not found or run.status <> 'running' then
    raise exception 'extraction run is not active';
  end if;

  for field_record in select value from jsonb_array_elements(p_fields)
  loop
    select *
    into existing_field
    from public.extracted_fields
    where application_id = run.application_id
      and field_name = field_record->>'field_name'
    order by manually_corrected desc, updated_at desc
    limit 1
    for update;

    if found and existing_field.manually_corrected then
      continue;
    elsif found then
      update public.extracted_fields
      set normalized_value = field_record->'normalized_value',
          structured_value = field_record->'structured_value',
          raw_value = field_record->>'raw_value',
          source_type = field_record->>'source_type',
          source_id = nullif(field_record->>'source_id', '')::uuid,
          source_marker = field_record->>'source_marker',
          source_excerpt = field_record->>'source_excerpt',
          confidence = (field_record->>'confidence')::numeric,
          requires_review = (field_record->>'requires_review')::boolean,
          extraction_run_id = run.id,
          prompt_version = run.prompt_version,
          schema_version = run.schema_version,
          model = run.model,
          conflict_detected = (field_record->>'conflict_detected')::boolean,
          correction_reason = null
      where id = existing_field.id;
    else
      insert into public.extracted_fields (
        application_id,
        field_name,
        normalized_value,
        structured_value,
        raw_value,
        source_type,
        source_id,
        source_marker,
        source_excerpt,
        confidence,
        requires_review,
        extraction_run_id,
        prompt_version,
        schema_version,
        model,
        conflict_detected
      ) values (
        run.application_id,
        field_record->>'field_name',
        field_record->'normalized_value',
        field_record->'structured_value',
        field_record->>'raw_value',
        field_record->>'source_type',
        nullif(field_record->>'source_id', '')::uuid,
        field_record->>'source_marker',
        field_record->>'source_excerpt',
        (field_record->>'confidence')::numeric,
        (field_record->>'requires_review')::boolean,
        run.id,
        run.prompt_version,
        run.schema_version,
        run.model,
        (field_record->>'conflict_detected')::boolean
      );
    end if;
  end loop;

  delete from public.extraction_conflicts
  where application_id = run.application_id
    and extraction_run_id = run.id;

  for conflict_record in select value from jsonb_array_elements(p_conflicts)
  loop
    insert into public.extraction_conflicts (
      application_id,
      extraction_run_id,
      field_name,
      candidates,
      sources,
      conflict_type,
      requires_review
    ) values (
      run.application_id,
      run.id,
      conflict_record->>'field_name',
      conflict_record->'candidates',
      conflict_record->'sources',
      conflict_record->>'conflict_type',
      true
    );
  end loop;

  conflict_total := jsonb_array_length(p_conflicts);

  update public.extraction_runs
  set status = 'completed',
      request_id = nullif(p_request_id, ''),
      input_token_count = p_input_token_count,
      output_token_count = p_output_token_count,
      duration_ms = p_duration_ms,
      conflict_count = conflict_total,
      completed_at = now()
  where id = run.id;

  insert into public.audit_events (
    actor_id,
    application_id,
    entity_type,
    entity_id,
    action,
    metadata
  ) values (
    run.initiated_by,
    run.application_id,
    'extraction_run',
    run.id,
    'extraction.completed',
    jsonb_build_object(
      'application_id', run.application_id,
      'extraction_run_id', run.id,
      'prompt_version', run.prompt_version,
      'schema_version', run.schema_version,
      'model', run.model,
      'conflict_count', conflict_total,
      'input_tokens', p_input_token_count,
      'output_tokens', p_output_token_count
    )
  );

  if conflict_total > 0 then
    insert into public.audit_events (
      actor_id,
      application_id,
      entity_type,
      entity_id,
      action,
      metadata
    ) values (
      run.initiated_by,
      run.application_id,
      'extraction_run',
      run.id,
      'extraction.conflict_detected',
      jsonb_build_object(
        'application_id', run.application_id,
        'extraction_run_id', run.id,
        'conflict_count', conflict_total
      )
    );
  end if;
end;
$$;

create function public.fail_extraction_run(
  p_run_id uuid,
  p_error_code text,
  p_error_message text,
  p_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.extraction_runs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  select *
  into run
  from public.extraction_runs
  where id = p_run_id
  for update;

  if not found or run.status <> 'running' then
    return;
  end if;

  update public.extraction_runs
  set status = 'failed',
      safe_error_code = left(coalesce(p_error_code, 'EXTRACTION_FAILED'), 100),
      safe_error_message = left(coalesce(p_error_message, 'Extraction failed.'), 500),
      duration_ms = greatest(coalesce(p_duration_ms, 0), 0),
      completed_at = now()
  where id = run.id;

  insert into public.audit_events (
    actor_id,
    application_id,
    entity_type,
    entity_id,
    action,
    metadata
  ) values (
    run.initiated_by,
    run.application_id,
    'extraction_run',
    run.id,
    'extraction.failed',
    jsonb_build_object(
      'application_id', run.application_id,
      'extraction_run_id', run.id,
      'prompt_version', run.prompt_version,
      'schema_version', run.schema_version,
      'model', run.model,
      'error_code', left(coalesce(p_error_code, 'EXTRACTION_FAILED'), 100)
    )
  );
end;
$$;

create function public.correct_extracted_field(
  p_application_id uuid,
  p_field_name text,
  p_structured_value jsonb,
  p_raw_value text,
  p_reason text,
  p_action text default 'corrected',
  p_source_type text default 'manual',
  p_source_id uuid default null,
  p_source_marker text default null,
  p_source_excerpt text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  field public.extracted_fields;
  action_name text;
begin
  if not public.is_active_user() then
    raise exception 'active user required';
  end if;

  if p_action not in ('corrected', 'candidate_selected', 'manual_null_set')
     or char_length(btrim(coalesce(p_reason, ''))) not between 2 and 1000 then
    raise exception 'invalid correction input';
  end if;

  actor := auth.uid();

  select *
  into field
  from public.extracted_fields
  where application_id = p_application_id
    and field_name = p_field_name
  order by manually_corrected desc, updated_at desc
  limit 1
  for update;

  if not found then
    insert into public.extracted_fields (
      application_id,
      field_name,
      normalized_value,
      structured_value,
      raw_value,
      source_type,
      source_id,
      source_marker,
      source_excerpt,
      confidence,
      requires_review,
      manually_corrected,
      corrected_by,
      correction_reason,
      conflict_detected
    ) values (
      p_application_id,
      p_field_name,
      p_structured_value,
      p_structured_value,
      p_raw_value,
      p_source_type,
      p_source_id,
      p_source_marker,
      p_source_excerpt,
      1,
      false,
      true,
      actor,
      btrim(p_reason),
      false
    )
    returning * into field;
  else
    insert into public.extracted_field_corrections (
      extracted_field_id,
      application_id,
      previous_structured_value,
      corrected_structured_value,
      previous_raw_value,
      corrected_raw_value,
      reason,
      correction_action,
      corrected_by
    ) values (
      field.id,
      p_application_id,
      field.structured_value,
      p_structured_value,
      field.raw_value,
      p_raw_value,
      btrim(p_reason),
      p_action,
      actor
    );

    update public.extracted_fields
    set normalized_value = p_structured_value,
        structured_value = p_structured_value,
        raw_value = p_raw_value,
        source_type = p_source_type,
        source_id = p_source_id,
        source_marker = p_source_marker,
        source_excerpt = p_source_excerpt,
        confidence = 1,
        requires_review = false,
        manually_corrected = true,
        corrected_by = actor,
        correction_reason = btrim(p_reason),
        conflict_detected = false
    where id = field.id;
  end if;

  action_name := case p_action
    when 'candidate_selected' then 'extraction.candidate_selected'
    when 'manual_null_set' then 'extraction.manual_null_set'
    else 'extraction.field_corrected'
  end;

  insert into public.audit_events (
    actor_id,
    application_id,
    entity_type,
    entity_id,
    action,
    metadata
  ) values (
    actor,
    p_application_id,
    'extracted_field',
    field.id,
    action_name,
    jsonb_build_object(
      'application_id', p_application_id,
      'field_name', p_field_name,
      'correction_action', p_action
    )
  );

  return field.id;
end;
$$;

revoke all on public.extraction_runs from anon, authenticated;
revoke all on public.extraction_conflicts from anon, authenticated;
revoke all on public.extracted_field_corrections from anon, authenticated;

grant select on
  public.extraction_runs,
  public.extraction_conflicts,
  public.extracted_field_corrections
to authenticated;

grant select on public.extraction_runs, public.extraction_conflicts
to service_role;

grant execute on function public.begin_extraction_run(
  uuid, text, jsonb, text, text, text, text, integer, uuid, boolean
) to service_role;
grant execute on function public.complete_extraction_run(
  uuid, jsonb, jsonb, text, integer, integer, integer
) to service_role;
grant execute on function public.fail_extraction_run(uuid, text, text, integer)
to service_role;
grant execute on function public.correct_extracted_field(
  uuid, text, jsonb, text, text, text, text, uuid, text, text
) to authenticated;
