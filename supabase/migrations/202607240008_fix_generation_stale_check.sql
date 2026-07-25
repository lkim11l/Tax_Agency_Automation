begin;

-- begin_contract_generation and finalize_contract_generation each carried
-- their own defense-in-depth staleness re-check comparing wall-clock
-- timestamps (email_messages/attachments.created_at, extracted_fields.
-- updated_at) against completeness_row.created_at. That check is redundant
-- with — and can disagree with — the fingerprint check immediately above it
-- in both functions (completeness_row.extraction_fingerprint <>
-- p_source_fingerprint / run_row.source_fingerprint), which already
-- guarantees completeness reflects the application's current
-- extracted_fields/acceptances as of the exact fingerprint the TS caller
-- just computed (src/modules/clarification/fingerprint.ts's
-- buildCurrentCompletenessFingerprint, which already accounts for every
-- field's value, confidence, requires_review, conflict_detected,
-- manually_corrected and acceptance state — not just its raw value).
--
-- A wall-clock comparison answers a different, less reliable question ("was
-- any row touched more recently than this completeness run") than "did
-- extractable input actually change" — a field can be re-touched (a derived-
-- field sync, a specialist re-confirming an already-correct value) without
-- its value, and therefore the fingerprint, changing at all. Once that
-- happens, the wall-clock check can never be satisfied again: no future
-- completeness recalculation ever produces a *newer* completeness_run row
-- for the same content (recalculateCompleteness intentionally reuses the
-- existing row when the fingerprint is unchanged, to avoid redundant
-- writes), so generation is blocked by COMPLETENESS_STALE forever, with a
-- fingerprint that has genuinely matched the whole time. This exact
-- mechanism is what caused application 7d95a537-f018-4d53-a47a-9e66235b9723
-- to keep failing generation immediately after every "Обработать заявку".
--
-- src/modules/contracts/service.ts's checkContractEligibility already had
-- its own equivalent TS-side check removed in the same fix, in favor of the
-- same fingerprint-based reasoning applied there. This migration closes the
-- matching gap at the two points that actually enforce the claim
-- transactionally, so a request that checkContractEligibility now correctly
-- reports ready=true for can no longer still fail here.
create or replace function public.begin_contract_generation(
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

revoke all on function public.begin_contract_generation(
  uuid, uuid, uuid, text, text, text, text, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.begin_contract_generation(
  uuid, uuid, uuid, text, text, text, text, uuid, boolean, text
) to service_role;

create or replace function public.finalize_contract_generation(
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
  completeness_row public.completeness_runs;
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

  select * into completeness_row
  from public.completeness_runs
  where id = run_row.completeness_run_id
    and application_id = run_row.application_id
    and is_ready
    and not is_blocking
    and extraction_fingerprint = run_row.source_fingerprint;
  if not found then raise exception 'APPLICATION_NOT_READY'; end if;

  if exists (
    select 1 from public.completeness_field_results
    where completeness_run_id = run_row.completeness_run_id and is_blocking
  ) then
    raise exception 'APPLICATION_HAS_BLOCKING_FIELDS';
  end if;

  select * into template_row
  from public.contract_templates
  where id = run_row.template_id
    and status = 'approved'
    and is_active
    and validation_report ->> 'valid' = 'true'
    and placeholder_schema_version = run_row.placeholder_schema_version
    and required_rule_set = completeness_row.rule_set_id;
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
  from public.contract_versions
  where contract_id = contract_row.id;

  insert into public.contract_versions (
    contract_id, version_number, storage_path, checksum, generation_metadata,
    created_by, generated_by, template_id, template_version, source_fingerprint,
    completeness_run_id, extraction_run_id, placeholder_schema_version,
    mapping_version, rendered_values_snapshot, original_filename,
    generated_filename, file_size, status, generation_warnings
  ) values (
    contract_row.id, next_version, p_storage_path, p_checksum,
    jsonb_build_object('generation_run_id', run_row.id),
    run_row.initiated_by, run_row.initiated_by, template_row.id,
    template_row.version, run_row.source_fingerprint,
    run_row.completeness_run_id, p_extraction_run_id,
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
      'application_id', run_row.application_id,
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

revoke all on function public.finalize_contract_generation(
  uuid, text, text, text, bigint, jsonb, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.finalize_contract_generation(
  uuid, text, text, text, bigint, jsonb, jsonb, uuid
) to service_role;

commit;
