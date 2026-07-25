begin;

-- cleanup_synthetic_records's application title allowlist predates several
-- newer integration test suites (hosted-contract-eligibility.test.ts,
-- hosted-contract-generation-regression.test.ts,
-- hosted-completeness-stale-regression.test.ts) whose fixture titles
-- ("Eligibility scenario ...", "Regression ...", "Stale ...") never matched
-- it — any interrupted/CI-killed run of those suites left its applications
-- permanently uncleanable through the official path. Broaden the regex to
-- cover them; every other check (manifest match, service-role, active-admin
-- actor) is unchanged.
create or replace function public.cleanup_synthetic_records(
  p_application_ids uuid[],
  p_counterparty_ids uuid[],
  p_template_ids uuid[],
  p_report_ids uuid[],
  p_allowed_actor_ids uuid[],
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application_count integer;
  counterparty_count integer;
  template_count integer;
  report_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'CLEANUP_SERVICE_ROLE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and role = 'admin' and is_active
  ) then
    raise exception 'CLEANUP_ACTIVE_ADMIN_REQUIRED';
  end if;

  select count(*) into application_count
  from public.applications
  where id = any(p_application_ids)
    and (
      title ~ '^(Integration Application |Hosted Phase |Phase [0-9]+ live synthetic |TAA-PHASE[0-9]+-|Eligibility scenario|Regression |Stale )'
      or title in (
        'Первое письмо на почте',
        'Добавлен номер телефона +1541368**** в аккаунте'
      )
    );
  if application_count <> coalesce(array_length(p_application_ids, 1), 0) then
    raise exception 'CLEANUP_APPLICATION_MANIFEST_MISMATCH';
  end if;

  select count(*) into counterparty_count
  from public.counterparties
  where id = any(p_counterparty_ids)
    and legal_name ~ '^Integration Counterparty integration-[0-9]+$';
  if counterparty_count <> coalesce(array_length(p_counterparty_ids, 1), 0) then
    raise exception 'CLEANUP_COUNTERPARTY_MANIFEST_MISMATCH';
  end if;

  select count(*) into template_count
  from public.contract_templates
  where id = any(p_template_ids)
    and (
      name ~ '^Integration Template integration-[0-9]+$'
      or name ~* '(^|[^a-z])(phase [0-9]+|synthetic|mock)([^a-z]|$)'
      or coalesce(code, '') ~* '(phase[0-9]+|synthetic|mock)'
    );
  if template_count <> coalesce(array_length(p_template_ids, 1), 0) then
    raise exception 'CLEANUP_TEMPLATE_MANIFEST_MISMATCH';
  end if;

  select count(*) into report_count
  from public.report_exports
  where id = any(p_report_ids)
    and generated_by = any(p_allowed_actor_ids);
  if report_count <> coalesce(array_length(p_report_ids, 1), 0) then
    raise exception 'CLEANUP_REPORT_MANIFEST_MISMATCH';
  end if;

  perform set_config('app.production_cleanup_synthetic', 'on', true);
  delete from public.applications where id = any(p_application_ids);
  delete from public.contract_templates where id = any(p_template_ids);
  delete from public.counterparties where id = any(p_counterparty_ids);
  delete from public.report_exports where id = any(p_report_ids);

  insert into public.audit_events (
    actor_id, entity_type, action, metadata
  ) values (
    p_actor_id,
    'system',
    'production.synthetic_cleanup_completed',
    jsonb_build_object(
      'applications', application_count,
      'counterparties', counterparty_count,
      'templates', template_count,
      'reports', report_count
    )
  );

  return jsonb_build_object(
    'applications', application_count,
    'counterparties', counterparty_count,
    'templates', template_count,
    'reports', report_count
  );
end;
$$;

revoke all on function public.cleanup_synthetic_records(
  uuid[], uuid[], uuid[], uuid[], uuid[], uuid
) from public, anon, authenticated;
grant execute on function public.cleanup_synthetic_records(
  uuid[], uuid[], uuid[], uuid[], uuid[], uuid
) to service_role;

commit;
