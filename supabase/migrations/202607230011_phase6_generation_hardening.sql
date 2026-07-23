begin;

alter table public.contract_templates
  drop constraint contract_templates_type_check,
  add constraint contract_templates_type_check
    check (template_type is null or template_type in ('services', 'consulting', 'supply')),
  add constraint contract_templates_approved_generation_metadata
    check (
      status <> 'approved'
      or (
        template_type is not null
        and required_rule_set is not null
        and placeholder_schema_version is not null
        and mime_type =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    );

alter table public.contract_versions
  add column generated_by uuid references public.profiles(id) on delete set null;

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

  if exists (
    select 1 from public.email_messages
    where application_id = run_row.application_id
      and created_at > completeness_row.created_at
  ) or exists (
    select 1 from public.attachments
    where application_id = run_row.application_id
      and created_at > completeness_row.created_at
  ) or exists (
    select 1 from public.extracted_fields
    where application_id = run_row.application_id
      and updated_at > completeness_row.created_at
  ) then
    raise exception 'COMPLETENESS_STALE';
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
