begin;

alter table public.contract_templates
  add column if not exists legal_approval_status text not null
    default 'pending_customer_approval';

alter table public.contract_templates
  drop constraint if exists contract_templates_legal_approval_status_check,
  add constraint contract_templates_legal_approval_status_check
    check (legal_approval_status in (
      'pending_customer_approval',
      'approved',
      'rejected'
    ));

-- Existing technically approved templates predate the legal approval field.
-- Preserve their current workflow; all newly uploaded templates remain pending.
update public.contract_templates
set legal_approval_status = 'approved'
where status = 'approved';

create index if not exists applications_status_received_at_idx
  on public.applications(status, received_at desc);
create index if not exists applications_assigned_received_at_idx
  on public.applications(assigned_to, received_at desc)
  where assigned_to is not null;
create index if not exists applications_created_at_idx
  on public.applications(created_at desc);
create index if not exists contract_templates_type_updated_at_idx
  on public.contract_templates(template_type, updated_at desc)
  where template_type is not null;
create index if not exists contracts_contract_number_idx
  on public.contracts(contract_number)
  where contract_number is not null;
create index if not exists report_exports_period_idx
  on public.report_exports(period_start, period_end, created_at desc);

create or replace function public.prevent_contract_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.production_cleanup_synthetic', true) = 'on' then
    return old;
  end if;
  raise exception 'Contract versions are immutable';
end;
$$;

create or replace function public.prevent_report_export_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('app.production_cleanup_synthetic', true) = 'on' then
    return old;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Report export records are immutable';
  end if;
  if old.status <> 'processing'
    or new.status not in ('completed', 'failed')
    or new.id <> old.id
    or new.report_type <> old.report_type
    or new.period_start <> old.period_start
    or new.period_end <> old.period_end
    or new.filters <> old.filters
    or new.report_schema_version <> old.report_schema_version
    or new.data_fingerprint <> old.data_fingerprint
    or new.cache_key <> old.cache_key
    or new.generated_by <> old.generated_by
    or new.force_requested <> old.force_requested
    or new.force_reason is distinct from old.force_reason then
    raise exception 'Report export records are immutable';
  end if;
  return new;
end;
$$;

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
      title ~ '^(Integration Application |Hosted Phase |Phase [0-9]+ live synthetic |TAA-PHASE[0-9]+-)'
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

create or replace function public.presentation_dashboard_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.is_active_user() then
      jsonb_build_object('access_denied', true)
    else jsonb_build_object(
      'new_applications', (
        select count(*) from public.applications where status = 'new'
      ),
      'waiting_for_client', (
        select count(*) from public.applications where status = 'waiting_for_client'
      ),
      'review_required', (
        select count(*) from public.applications
        where status in ('needs_data_review', 'under_review', 'contract_revision_required')
      ),
      'contracts_under_review', (
        select count(*) from public.contracts where status = 'under_review'
      ),
      'contracts_sent', (
        select count(*) from public.contracts where status in ('sent', 'delivered')
      ),
      'last_mailbox_sync', (
        select max(completed_at) from public.background_job_runs
        where job_type = 'mailbox_pipeline' and status <> 'running'
      ),
      'system_status', coalesce((
        select case
          when bool_or(status = 'unavailable') then 'unavailable'
          when bool_or(status = 'degraded') then 'degraded'
          else 'healthy'
        end
        from public.system_component_status
      ), 'unknown')
    )
  end;
$$;

revoke all on function public.presentation_dashboard_summary() from public, anon;
grant execute on function public.presentation_dashboard_summary() to authenticated;

grant select (legal_approval_status)
  on public.contract_templates to authenticated;

commit;
