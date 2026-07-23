begin;

create type public.mailbox_sync_status as enum (
  'idle',
  'syncing',
  'completed',
  'failed'
);

create table public.mailbox_sync_state (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  mailbox_identifier text not null,
  folder text not null,
  uid_validity bigint,
  last_processed_uid bigint not null default 0,
  last_successful_sync timestamptz,
  last_attempted_sync timestamptz,
  last_error text,
  sync_status public.mailbox_sync_status not null default 'idle',
  new_message_count integer not null default 0,
  error_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailbox_sync_state_identity_key
    unique (provider, mailbox_identifier, folder),
  constraint mailbox_sync_state_uid_nonnegative
    check (last_processed_uid >= 0),
  constraint mailbox_sync_state_counts_nonnegative
    check (new_message_count >= 0 and error_count >= 0)
);

create trigger mailbox_sync_state_set_updated_at
before update on public.mailbox_sync_state
for each row execute function public.set_updated_at();

alter table public.email_messages
  add column mailbox_identifier text,
  add column mailbox_uid bigint,
  add column uid_validity bigint,
  add column rfc_message_id text,
  add column in_reply_to text,
  add column reference_message_ids jsonb not null default '[]'::jsonb,
  add column cc jsonb not null default '[]'::jsonb,
  add column raw_headers jsonb not null default '{}'::jsonb,
  add column updated_at timestamptz not null default now(),
  add constraint email_messages_references_array
    check (jsonb_typeof(reference_message_ids) = 'array'),
  add constraint email_messages_cc_array
    check (jsonb_typeof(cc) = 'array'),
  add constraint email_messages_raw_headers_object
    check (jsonb_typeof(raw_headers) = 'object'),
  add constraint email_messages_mailbox_identity_complete
    check (
      (mailbox_identifier is null and mailbox_uid is null and uid_validity is null)
      or
      (mailbox_identifier is not null and mailbox_uid is not null and uid_validity is not null)
    ),
  add constraint email_messages_mailbox_uid_positive
    check (mailbox_uid is null or mailbox_uid > 0),
  add constraint email_messages_uid_validity_positive
    check (uid_validity is null or uid_validity > 0);

create unique index email_messages_mailbox_uid_key
on public.email_messages (provider, mailbox_identifier, uid_validity, mailbox_uid)
where mailbox_identifier is not null;

create unique index email_messages_rfc_message_key
on public.email_messages (provider, mailbox_identifier, rfc_message_id)
where mailbox_identifier is not null and rfc_message_id is not null;

create index email_messages_unlinked_idx
on public.email_messages (occurred_at desc)
where direction = 'inbound' and application_id is null;

create trigger email_messages_set_updated_at
before update on public.email_messages
for each row execute function public.set_updated_at();

create unique index attachments_message_checksum_key
on public.attachments (email_message_id, checksum)
where email_message_id is not null;

alter table public.attachments
  alter column application_id drop not null;

alter table public.mailbox_sync_state enable row level security;

create policy mailbox_sync_state_select_active
on public.mailbox_sync_state
for select to authenticated
using (public.is_active_user());

grant usage on type public.mailbox_sync_status to authenticated;
grant select on public.mailbox_sync_state to authenticated;

create function public.ingest_email_message(p_message jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_message public.email_messages;
  linked_application_id uuid;
  new_application_id uuid;
  new_message_id uuid;
  message_references jsonb := coalesce(p_message -> 'reference_message_ids', '[]'::jsonb);
  is_unlinked_reply boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Email ingestion requires the server role';
  end if;

  if nullif(p_message ->> 'provider', '') is null
    or nullif(p_message ->> 'mailbox_identifier', '') is null
    or nullif(p_message ->> 'provider_message_id', '') is null
    or nullif(p_message ->> 'sender', '') is null then
    raise exception 'Required email identity fields are missing';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        ':',
        p_message ->> 'provider',
        p_message ->> 'mailbox_identifier',
        coalesce(
          nullif(p_message ->> 'rfc_message_id', ''),
          concat_ws(
            ':',
            p_message ->> 'uid_validity',
            p_message ->> 'mailbox_uid'
          )
        )
      ),
      0
    )
  );

  select *
  into existing_message
  from public.email_messages
  where provider = p_message ->> 'provider'
    and mailbox_identifier = p_message ->> 'mailbox_identifier'
    and (
      (
        uid_validity = (p_message ->> 'uid_validity')::bigint
        and mailbox_uid = (p_message ->> 'mailbox_uid')::bigint
      )
      or (
        nullif(p_message ->> 'rfc_message_id', '') is not null
        and rfc_message_id = p_message ->> 'rfc_message_id'
      )
    )
  order by occurred_at desc
  limit 1;

  if existing_message.id is not null then
    if not exists (
      select 1
      from public.audit_events
      where entity_type = 'email_message'
        and entity_id = existing_message.id
        and action = 'email.duplicate_skipped'
    ) then
      insert into public.audit_events (
        actor_id, application_id, entity_type, entity_id, action, metadata
      ) values (
        null,
        existing_message.application_id,
        'email_message',
        existing_message.id,
        'email.duplicate_skipped',
        jsonb_build_object('provider', existing_message.provider)
      );
    end if;

    return jsonb_build_object(
      'duplicate', true,
      'email_message_id', existing_message.id,
      'application_id', existing_message.application_id,
      'application_created', false,
      'reply_linked', false,
      'unlinked_reply', false
    );
  end if;

  if nullif(p_message ->> 'in_reply_to', '') is not null then
    select application_id
    into linked_application_id
    from public.email_messages
    where provider = p_message ->> 'provider'
      and mailbox_identifier = p_message ->> 'mailbox_identifier'
      and rfc_message_id = p_message ->> 'in_reply_to'
      and application_id is not null
    order by occurred_at desc
    limit 1;
  end if;

  if linked_application_id is null and jsonb_array_length(message_references) > 0 then
    select application_id
    into linked_application_id
    from public.email_messages
    where provider = p_message ->> 'provider'
      and mailbox_identifier = p_message ->> 'mailbox_identifier'
      and application_id is not null
      and rfc_message_id in (
        select jsonb_array_elements_text(message_references)
      )
    order by occurred_at desc
    limit 1;
  end if;

  is_unlinked_reply :=
    linked_application_id is null
    and (
      nullif(p_message ->> 'in_reply_to', '') is not null
      or jsonb_array_length(message_references) > 0
    );

  if linked_application_id is null and not is_unlinked_reply then
    insert into public.applications (
      title,
      source,
      status,
      priority,
      received_at,
      created_by
    ) values (
      coalesce(nullif(btrim(p_message ->> 'subject'), ''), 'Email without subject'),
      'email',
      'new',
      'normal',
      (p_message ->> 'occurred_at')::timestamptz,
      null
    )
    returning id into new_application_id;
    linked_application_id := new_application_id;
  end if;

  insert into public.email_messages (
    provider,
    provider_message_id,
    provider_thread_id,
    direction,
    sender,
    recipients,
    cc,
    subject,
    plain_body,
    html_body,
    occurred_at,
    processing_status,
    processing_error,
    application_id,
    mailbox_identifier,
    mailbox_uid,
    uid_validity,
    rfc_message_id,
    in_reply_to,
    reference_message_ids,
    raw_headers
  ) values (
    p_message ->> 'provider',
    p_message ->> 'provider_message_id',
    nullif(p_message ->> 'provider_thread_id', ''),
    'inbound',
    p_message ->> 'sender',
    coalesce(p_message -> 'recipients', '[]'::jsonb),
    coalesce(p_message -> 'cc', '[]'::jsonb),
    nullif(p_message ->> 'subject', ''),
    nullif(p_message ->> 'plain_body', ''),
    nullif(p_message ->> 'html_body', ''),
    (p_message ->> 'occurred_at')::timestamptz,
    'processing',
    null,
    linked_application_id,
    p_message ->> 'mailbox_identifier',
    (p_message ->> 'mailbox_uid')::bigint,
    (p_message ->> 'uid_validity')::bigint,
    nullif(p_message ->> 'rfc_message_id', ''),
    nullif(p_message ->> 'in_reply_to', ''),
    message_references,
    coalesce(p_message -> 'raw_headers', '{}'::jsonb)
  )
  returning id into new_message_id;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    null,
    linked_application_id,
    'email_message',
    new_message_id,
    'email.received',
    jsonb_build_object(
      'provider', p_message ->> 'provider',
      'has_message_id', nullif(p_message ->> 'rfc_message_id', '') is not null
    )
  );

  if new_application_id is not null then
    insert into public.audit_events (
      actor_id, application_id, entity_type, entity_id, action, metadata
    ) values (
      null,
      new_application_id,
      'application',
      new_application_id,
      'application.created_from_email',
      jsonb_build_object('email_message_id', new_message_id)
    );
  elsif linked_application_id is not null then
    insert into public.audit_events (
      actor_id, application_id, entity_type, entity_id, action, metadata
    ) values (
      null,
      linked_application_id,
      'email_message',
      new_message_id,
      'email.reply_linked',
      jsonb_build_object('matched_by', case
        when nullif(p_message ->> 'in_reply_to', '') is not null then 'in_reply_to'
        else 'references'
      end)
    );
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'email_message_id', new_message_id,
    'application_id', linked_application_id,
    'application_created', new_application_id is not null,
    'reply_linked', linked_application_id is not null and new_application_id is null,
    'unlinked_reply', is_unlinked_reply
  );
end;
$$;

create function public.manual_link_email(
  p_email_message_id uuid,
  p_application_id uuid
)
returns public.email_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_message public.email_messages;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  update public.email_messages
  set application_id = p_application_id
  where id = p_email_message_id
    and direction = 'inbound'
  returning * into linked_message;

  if linked_message.id is null then
    raise exception 'Email message not found or access denied';
  end if;

  update public.attachments
  set application_id = p_application_id
  where email_message_id = p_email_message_id;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    auth.uid(),
    p_application_id,
    'email_message',
    p_email_message_id,
    'email.manual_linked',
    '{}'::jsonb
  );

  return linked_message;
end;
$$;

create function public.reprocess_email(p_email_message_id uuid)
returns public.email_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_message public.email_messages;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  update public.email_messages
  set processing_status = 'pending', processing_error = null
  where id = p_email_message_id
  returning * into target_message;

  if target_message.id is null then
    raise exception 'Email message not found or access denied';
  end if;

  insert into public.audit_events (
    actor_id, application_id, entity_type, entity_id, action, metadata
  ) values (
    auth.uid(),
    target_message.application_id,
    'email_message',
    target_message.id,
    'email.reprocessed',
    '{}'::jsonb
  );

  return target_message;
end;
$$;

revoke all on function public.ingest_email_message(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_email_message(jsonb) to service_role;
grant execute on function public.manual_link_email(uuid, uuid) to authenticated;
grant execute on function public.reprocess_email(uuid) to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'email-attachments',
  'email-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/tiff'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy email_attachments_select_active
on storage.objects
for select to authenticated
using (
  bucket_id = 'email-attachments'
  and public.is_active_user()
);

commit;
