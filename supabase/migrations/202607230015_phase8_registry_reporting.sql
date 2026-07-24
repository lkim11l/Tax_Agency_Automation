begin;

create type public.report_export_status as enum (
  'processing', 'completed', 'failed'
);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('registry', 'monthly')),
  period_start date not null,
  period_end date not null,
  filters jsonb not null default '{}'::jsonb,
  report_schema_version text not null,
  data_fingerprint text not null,
  cache_key text not null,
  row_count integer not null default 0 check (row_count >= 0),
  generated_by uuid not null references public.profiles(id) on delete restrict,
  generated_at timestamptz,
  checksum text,
  storage_path text,
  filename text,
  file_size bigint,
  status public.report_export_status not null default 'processing',
  force_requested boolean not null default false,
  force_reason text,
  safe_error_code text,
  safe_error_message text,
  created_at timestamptz not null default now(),
  constraint report_exports_period_valid check (period_end >= period_start),
  constraint report_exports_filters_object check (jsonb_typeof(filters) = 'object'),
  constraint report_exports_fingerprint_format check (
    data_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint report_exports_cache_key_format check (cache_key ~ '^[0-9a-f]{64}$'),
  constraint report_exports_checksum_format check (
    checksum is null or checksum ~ '^[0-9a-f]{64}$'
  ),
  constraint report_exports_completed_values check (
    status <> 'completed'
    or (
      generated_at is not null
      and checksum is not null
      and storage_path is not null
      and filename is not null
      and file_size > 0
    )
  ),
  constraint report_exports_force_reason check (
    not force_requested
    or char_length(btrim(coalesce(force_reason, ''))) between 2 and 1000
  )
);

create index report_exports_actor_created_idx
on public.report_exports(generated_by, created_at desc);
create index report_exports_cache_idx
on public.report_exports(cache_key, created_at desc);
create unique index report_exports_one_processing
on public.report_exports(cache_key)
where status = 'processing';

create view public.contract_registry_entries
with (security_invoker = true)
as
select
  a.id as application_id,
  a.application_number,
  a.title as application_title,
  a.received_at,
  a.status::text as application_status,
  a.assigned_to,
  a.created_by as application_created_by,
  a.contract_subject,
  a.contract_amount,
  a.currency,
  cp.id as counterparty_id,
  cp.legal_name as counterparty_name,
  cp.inn,
  cp.bank_account,
  assignee.full_name as specialist_name,
  assignee.email as specialist_email,
  c.id as contract_id,
  c.contract_number,
  c.status::text as contract_status,
  c.approved_at,
  c.sent_at,
  cv.id as current_version_id,
  cv.version_number,
  cv.generated_at,
  cv.generated_at::date as contract_date,
  cv.generated_filename,
  cv.checksum as version_checksum,
  t.id as template_id,
  t.name as template_name,
  t.version as template_version,
  t.template_type,
  coalesce(latest_completeness.percentage, 0) as completeness_percentage,
  coalesce(latest_completeness.is_ready, false) as completeness_ready,
  exists (
    select 1
    from public.extracted_fields ef
    where ef.application_id = a.id
      and ef.conflict_detected
  ) as has_conflicts,
  (
    select count(*)::integer
    from public.email_messages em
    where em.application_id = a.id
  ) as correspondence_count
from public.applications a
left join public.counterparties cp on cp.id = a.counterparty_id
left join public.profiles assignee on assignee.id = a.assigned_to
left join public.contracts c on c.application_id = a.id
left join public.contract_versions cv on cv.id = c.current_version_id
left join public.contract_templates t on t.id = c.template_id
left join lateral (
  select cr.percentage, cr.is_ready
  from public.completeness_runs cr
  where cr.application_id = a.id
  order by cr.created_at desc
  limit 1
) latest_completeness on true;

create function public.prevent_report_export_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

create trigger report_exports_immutable
before update or delete on public.report_exports
for each row execute function public.prevent_report_export_mutation();

create function public.claim_report_export(
  p_actor_id uuid,
  p_report_type text,
  p_period_start date,
  p_period_end date,
  p_filters jsonb,
  p_report_schema_version text,
  p_data_fingerprint text,
  p_cache_key text,
  p_force boolean,
  p_force_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
  cached public.report_exports;
  created_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_cache_key, 0));
  select role into actor_role
  from public.profiles
  where id = p_actor_id and is_active;
  if actor_role is null then raise exception 'REPORT_ACTOR_NOT_ALLOWED'; end if;
  if p_report_type not in ('registry', 'monthly')
    or p_period_end < p_period_start
    or jsonb_typeof(p_filters) <> 'object'
    or p_data_fingerprint !~ '^[0-9a-f]{64}$'
    or p_cache_key !~ '^[0-9a-f]{64}$' then
    raise exception 'REPORT_INPUT_INVALID';
  end if;
  if p_force and (
    actor_role <> 'admin'
    or char_length(btrim(coalesce(p_force_reason, ''))) not between 2 and 1000
  ) then raise exception 'REPORT_FORCE_NOT_ALLOWED'; end if;

  if exists (
    select 1 from public.report_exports
    where cache_key = p_cache_key and status = 'processing'
  ) then raise exception 'REPORT_ALREADY_RUNNING'; end if;

  if not p_force then
    select * into cached
    from public.report_exports
    where cache_key = p_cache_key and status = 'completed'
    order by created_at desc
    limit 1;
    if found then
      insert into public.audit_events (
        actor_id, entity_type, entity_id, action, metadata
      ) values (
        p_actor_id, 'report_export', cached.id, 'report.cache_hit',
        jsonb_build_object(
          'report_id', cached.id,
          'report_type', cached.report_type,
          'period_start', cached.period_start,
          'period_end', cached.period_end,
          'row_count', cached.row_count,
          'checksum', cached.checksum
        )
      );
      return jsonb_build_object(
        'claimed', false, 'cache_hit', true, 'report_id', cached.id
      );
    end if;
  end if;

  insert into public.report_exports (
    report_type, period_start, period_end, filters, report_schema_version,
    data_fingerprint, cache_key, generated_by, force_requested, force_reason
  ) values (
    p_report_type, p_period_start, p_period_end, p_filters,
    p_report_schema_version, p_data_fingerprint, p_cache_key, p_actor_id,
    p_force, nullif(btrim(coalesce(p_force_reason, '')), '')
  )
  returning id into created_id;

  insert into public.audit_events (
    actor_id, entity_type, entity_id, action, metadata
  ) values (
    p_actor_id, 'report_export', created_id,
    case when p_force then 'report.force_regenerated'
      else 'report.generation_started' end,
    jsonb_build_object(
      'report_id', created_id,
      'report_type', p_report_type,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'filter_summary', p_filters
    )
  );
  return jsonb_build_object(
    'claimed', true, 'cache_hit', false, 'report_id', created_id
  );
end;
$$;

create function public.finalize_report_export(
  p_report_id uuid,
  p_actor_id uuid,
  p_row_count integer,
  p_checksum text,
  p_storage_path text,
  p_filename text,
  p_file_size bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.report_exports;
begin
  update public.report_exports
  set status = 'completed',
      row_count = p_row_count,
      checksum = p_checksum,
      storage_path = p_storage_path,
      filename = p_filename,
      file_size = p_file_size,
      generated_at = now()
  where id = p_report_id
    and generated_by = p_actor_id
    and status = 'processing'
    and p_row_count >= 0
    and p_checksum ~ '^[0-9a-f]{64}$'
    and p_file_size > 0
  returning * into report_row;
  if report_row.id is null then raise exception 'REPORT_FINALIZE_DENIED'; end if;

  insert into public.audit_events (
    actor_id, entity_type, entity_id, action, metadata
  ) values (
    p_actor_id, 'report_export', report_row.id, 'report.generated',
    jsonb_build_object(
      'report_id', report_row.id,
      'report_type', report_row.report_type,
      'period_start', report_row.period_start,
      'period_end', report_row.period_end,
      'row_count', report_row.row_count,
      'checksum', report_row.checksum
    )
  );
end;
$$;

create function public.fail_report_export(
  p_report_id uuid,
  p_actor_id uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.report_exports;
begin
  update public.report_exports
  set status = 'failed',
      safe_error_code = left(p_error_code, 100),
      safe_error_message = left(p_error_message, 500)
  where id = p_report_id
    and generated_by = p_actor_id
    and status = 'processing'
  returning * into report_row;
  if report_row.id is null then return; end if;
  insert into public.audit_events (
    actor_id, entity_type, entity_id, action, metadata
  ) values (
    p_actor_id, 'report_export', report_row.id, 'report.generation_failed',
    jsonb_build_object(
      'report_id', report_row.id,
      'report_type', report_row.report_type,
      'period_start', report_row.period_start,
      'period_end', report_row.period_end,
      'safe_error_code', left(p_error_code, 100)
    )
  );
end;
$$;

create function public.record_registry_access(
  p_actor_id uuid,
  p_filtered boolean,
  p_period_start date,
  p_period_end date,
  p_filter_summary jsonb,
  p_row_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles where id = p_actor_id and is_active
  ) then raise exception 'REGISTRY_ACTOR_NOT_ALLOWED'; end if;
  insert into public.audit_events (
    actor_id, entity_type, entity_id, action, metadata
  ) values (
    p_actor_id, 'contract_registry', null,
    case when p_filtered then 'registry.filtered' else 'registry.viewed' end,
    jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'filter_summary', p_filter_summary,
      'row_count', greatest(p_row_count, 0)
    )
  );
end;
$$;

create function public.record_report_download(
  p_report_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.report_exports;
  actor_role public.user_role;
begin
  select role into actor_role from public.profiles
  where id = p_actor_id and is_active;
  select * into report_row from public.report_exports
  where id = p_report_id and status = 'completed'
    and (generated_by = p_actor_id or actor_role = 'admin');
  if report_row.id is null then raise exception 'REPORT_DOWNLOAD_DENIED'; end if;
  insert into public.audit_events (
    actor_id, entity_type, entity_id, action, metadata
  ) values (
    p_actor_id, 'report_export', report_row.id, 'report.downloaded',
    jsonb_build_object(
      'report_id', report_row.id,
      'period_start', report_row.period_start,
      'period_end', report_row.period_end,
      'row_count', report_row.row_count,
      'checksum', report_row.checksum
    )
  );
end;
$$;

alter table public.report_exports enable row level security;
create policy report_exports_active_select on public.report_exports
for select to authenticated using (
  public.is_active_user()
  and (generated_by = auth.uid() or public.is_admin())
);

revoke all on public.contract_registry_entries from public, anon, authenticated;
grant select on public.contract_registry_entries to service_role;
revoke all on public.report_exports from public, anon, authenticated;
grant select on public.report_exports to authenticated;

insert into storage.buckets (id, name, public)
values ('report-exports', 'report-exports', false)
on conflict (id) do update set public = false;

create policy report_exports_storage_select on storage.objects
for select to authenticated using (
  bucket_id = 'report-exports'
  and exists (
    select 1 from public.report_exports r
    where r.storage_path = name
      and r.status = 'completed'
      and (r.generated_by = auth.uid() or public.is_admin())
  )
);

revoke all on function public.claim_report_export(
  uuid, text, date, date, jsonb, text, text, text, boolean, text
) from public, anon, authenticated;
revoke all on function public.finalize_report_export(
  uuid, uuid, integer, text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.fail_report_export(
  uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.record_registry_access(
  uuid, boolean, date, date, jsonb, integer
) from public, anon, authenticated;
revoke all on function public.record_report_download(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.claim_report_export(
  uuid, text, date, date, jsonb, text, text, text, boolean, text
) to service_role;
grant execute on function public.finalize_report_export(
  uuid, uuid, integer, text, text, text, bigint
) to service_role;
grant execute on function public.fail_report_export(
  uuid, uuid, text, text
) to service_role;
grant execute on function public.record_registry_access(
  uuid, boolean, date, date, jsonb, integer
) to service_role;
grant execute on function public.record_report_download(uuid, uuid)
to service_role;

commit;
