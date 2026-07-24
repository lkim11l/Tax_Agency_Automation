create or replace function public.record_safe_field_acceptances(
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
  v_inserted_count integer := 0;
  v_blocked_count integer := 0;
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
      v_blocked_count := v_blocked_count + 1;
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
      v_blocked_count := v_blocked_count + 1;
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
      v_inserted_count := v_inserted_count + 1;
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
  set accepted_count = v_inserted_count,
      blocked_count = v_blocked_count
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
      'accepted_count', v_inserted_count,
      'blocked_count', v_blocked_count
    )
  );

  return jsonb_build_object(
    'batch_id', created_batch.id,
    'accepted_count', v_inserted_count,
    'blocked_count', v_blocked_count,
    'cache_hit', false
  );
end;
$$;
