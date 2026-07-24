begin;

create type public.background_job_status as enum (
  'running', 'completed', 'completed_with_errors', 'failed'
);

create type public.component_health_status as enum (
  'healthy', 'degraded', 'unavailable', 'unknown'
);

create table public.background_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('mailbox_pipeline', 'health_probe')),
  trigger_source text not null check (trigger_source in ('cron', 'manual', 'smoke')),
  status public.background_job_status not null default 'running',
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz,
  stage_results jsonb not null default '{}'::jsonb,
  items_processed integer not null default 0 check (items_processed >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  safe_error_code text,
  safe_error_message text,
  lock_timeout_seconds integer not null check (lock_timeout_seconds between 30 and 900),
  created_at timestamptz not null default now(),
  constraint background_job_stage_results_object
    check (jsonb_typeof(stage_results) = 'object'),
  constraint background_job_terminal_values check (
    (status = 'running' and completed_at is null)
    or (status <> 'running' and completed_at is not null)
  )
);

create unique index background_job_one_running
on public.background_job_runs(job_type)
where status = 'running';

create index background_job_runs_recent
on public.background_job_runs(job_type, started_at desc);

create table public.system_component_status (
  component text primary key check (
    component in ('application', 'supabase', 'storage', 'mailru_imap',
      'mailru_smtp', 'openai', 'mailbox_sync', 'background_jobs')
  ),
  status public.component_health_status not null default 'unknown',
  checked_at timestamptz not null default now(),
  last_success_at timestamptz,
  safe_error_code text,
  safe_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  updated_by_run_id uuid references public.background_job_runs(id) on delete set null,
  constraint system_component_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create function public.prevent_background_job_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Background job records are immutable';
  end if;
  if old.status <> 'running'
    or new.id <> old.id
    or new.job_type <> old.job_type
    or new.trigger_source <> old.trigger_source
    or new.started_at <> old.started_at
    or new.created_at <> old.created_at
    or new.lock_timeout_seconds <> old.lock_timeout_seconds then
    raise exception 'Background job records are immutable';
  end if;
  if new.status = 'running' and new.completed_at is not null then
    raise exception 'Running background job cannot be completed';
  end if;
  return new;
end;
$$;

create trigger background_job_runs_immutable
before update or delete on public.background_job_runs
for each row execute function public.prevent_background_job_mutation();

create function public.claim_background_job(
  p_job_type text,
  p_trigger_source text,
  p_lock_timeout_seconds integer,
  p_minimum_interval_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  running_row public.background_job_runs;
  created_id uuid;
  last_started timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('background:' || p_job_type, 0));
  if p_job_type not in ('mailbox_pipeline', 'health_probe')
    or p_trigger_source not in ('cron', 'manual', 'smoke')
    or p_lock_timeout_seconds not between 30 and 900
    or p_minimum_interval_seconds not between 0 and 3600 then
    raise exception 'BACKGROUND_JOB_INPUT_INVALID';
  end if;

  select * into running_row
  from public.background_job_runs
  where job_type = p_job_type and status = 'running'
  for update;

  if found and running_row.heartbeat_at <
    now() - make_interval(secs => p_lock_timeout_seconds) then
    update public.background_job_runs
    set status = 'failed',
        completed_at = now(),
        heartbeat_at = now(),
        error_count = greatest(error_count, 1),
        safe_error_code = 'STALE_LOCK_RECOVERED',
        safe_error_message = 'A stale worker lock was recovered.'
    where id = running_row.id;
    insert into public.audit_events (
      actor_id, entity_type, entity_id, action, metadata
    ) values (
      null, 'background_job', running_row.id, 'background_job.stale_lock_recovered',
      jsonb_build_object('job_type', p_job_type, 'run_id', running_row.id)
    );
    running_row := null;
  end if;

  if running_row.id is not null then
    insert into public.audit_events (
      actor_id, entity_type, entity_id, action, metadata
    ) values (
      null, 'background_job', running_row.id, 'background_job.concurrent_skipped',
      jsonb_build_object('job_type', p_job_type, 'run_id', running_row.id)
    );
    return jsonb_build_object(
      'claimed', false, 'reason', 'already_running', 'run_id', running_row.id
    );
  end if;

  select max(started_at) into last_started
  from public.background_job_runs
  where job_type = p_job_type;
  if last_started is not null
    and last_started > now() - make_interval(secs => p_minimum_interval_seconds) then
    return jsonb_build_object(
      'claimed', false, 'reason', 'cooldown', 'run_id', null
    );
  end if;

  insert into public.background_job_runs (
    job_type, trigger_source, lock_timeout_seconds
  ) values (
    p_job_type, p_trigger_source, p_lock_timeout_seconds
  ) returning id into created_id;

  insert into public.audit_events (
    actor_id, entity_type, entity_id, action, metadata
  ) values (
    null, 'background_job', created_id, 'background_job.started',
    jsonb_build_object(
      'job_type', p_job_type, 'run_id', created_id,
      'trigger_source', p_trigger_source
    )
  );
  return jsonb_build_object(
    'claimed', true, 'reason', null, 'run_id', created_id
  );
end;
$$;

create function public.heartbeat_background_job(
  p_run_id uuid,
  p_stage_results jsonb,
  p_items_processed integer,
  p_error_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.background_job_runs
  set heartbeat_at = now(),
      stage_results = p_stage_results,
      items_processed = greatest(p_items_processed, 0),
      error_count = greatest(p_error_count, 0)
  where id = p_run_id
    and status = 'running'
    and jsonb_typeof(p_stage_results) = 'object';
  if not found then raise exception 'BACKGROUND_JOB_NOT_RUNNING'; end if;
end;
$$;

create function public.finish_background_job(
  p_run_id uuid,
  p_status text,
  p_stage_results jsonb,
  p_items_processed integer,
  p_error_count integer,
  p_safe_error_code text,
  p_safe_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.background_job_runs;
begin
  if p_status not in ('completed', 'completed_with_errors', 'failed')
    or jsonb_typeof(p_stage_results) <> 'object' then
    raise exception 'BACKGROUND_JOB_FINISH_INVALID';
  end if;
  update public.background_job_runs
  set status = p_status::public.background_job_status,
      completed_at = now(),
      heartbeat_at = now(),
      stage_results = p_stage_results,
      items_processed = greatest(p_items_processed, 0),
      error_count = greatest(p_error_count, 0),
      safe_error_code = nullif(left(coalesce(p_safe_error_code, ''), 100), ''),
      safe_error_message = nullif(left(coalesce(p_safe_error_message, ''), 500), '')
  where id = p_run_id and status = 'running'
  returning * into run_row;
  if run_row.id is null then raise exception 'BACKGROUND_JOB_NOT_RUNNING'; end if;

  insert into public.audit_events (
    actor_id, entity_type, entity_id, action, metadata
  ) values (
    null, 'background_job', run_row.id,
    case when p_status = 'failed'
      then 'background_job.failed'
      else 'background_job.completed' end,
    jsonb_build_object(
      'job_type', run_row.job_type, 'run_id', run_row.id,
      'status', p_status, 'items_processed', run_row.items_processed,
      'error_count', run_row.error_count,
      'safe_error_code', run_row.safe_error_code
    )
  );
end;
$$;

create function public.record_component_health(
  p_component text,
  p_status text,
  p_run_id uuid,
  p_safe_error_code text,
  p_safe_error_message text,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_component not in (
    'application', 'supabase', 'storage', 'mailru_imap', 'mailru_smtp',
    'openai', 'mailbox_sync', 'background_jobs'
  ) or p_status not in ('healthy', 'degraded', 'unavailable', 'unknown')
    or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'COMPONENT_HEALTH_INPUT_INVALID';
  end if;
  insert into public.system_component_status (
    component, status, checked_at, last_success_at, safe_error_code,
    safe_error_message, metadata, updated_by_run_id
  ) values (
    p_component, p_status::public.component_health_status, now(),
    case when p_status = 'healthy' then now() else null end,
    nullif(left(coalesce(p_safe_error_code, ''), 100), ''),
    nullif(left(coalesce(p_safe_error_message, ''), 500), ''),
    p_metadata, p_run_id
  )
  on conflict (component) do update
  set status = excluded.status,
      checked_at = excluded.checked_at,
      last_success_at = case when excluded.status = 'healthy'
        then excluded.checked_at
        else public.system_component_status.last_success_at end,
      safe_error_code = excluded.safe_error_code,
      safe_error_message = excluded.safe_error_message,
      metadata = excluded.metadata,
      updated_by_run_id = excluded.updated_by_run_id;
end;
$$;

alter table public.background_job_runs enable row level security;
alter table public.system_component_status enable row level security;

create policy background_job_runs_admin_select on public.background_job_runs
for select to authenticated using (public.is_active_user() and public.is_admin());
create policy component_health_admin_select on public.system_component_status
for select to authenticated using (public.is_active_user() and public.is_admin());

revoke all on public.background_job_runs from public, anon, authenticated;
revoke all on public.system_component_status from public, anon, authenticated;
grant select on public.background_job_runs, public.system_component_status
to authenticated;

revoke all on function public.claim_background_job(text, text, integer, integer)
from public, anon, authenticated;
revoke all on function public.heartbeat_background_job(uuid, jsonb, integer, integer)
from public, anon, authenticated;
revoke all on function public.finish_background_job(
  uuid, text, jsonb, integer, integer, text, text
) from public, anon, authenticated;
revoke all on function public.record_component_health(
  text, text, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.claim_background_job(text, text, integer, integer)
to service_role;
grant execute on function public.heartbeat_background_job(uuid, jsonb, integer, integer)
to service_role;
grant execute on function public.finish_background_job(
  uuid, text, jsonb, integer, integer, text, text
) to service_role;
grant execute on function public.record_component_health(
  text, text, uuid, text, text, jsonb
) to service_role;

commit;
