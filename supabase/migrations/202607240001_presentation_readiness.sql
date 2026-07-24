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
