begin;

create or replace function public.prevent_document_parse_attempt_mutation()
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
    if exists (
      select 1
      from public.attachments
      where id = old.attachment_id
    ) then
      raise exception 'Document parse attempts are immutable';
    end if;
    return old;
  end if;
  if old.completed_at is not null then
    raise exception 'Document parse attempts are immutable after completion';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_extracted_field_correction_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('app.production_cleanup_synthetic', true) = 'on' then
    return old;
  end if;
  raise exception 'extracted field correction history is immutable';
end;
$$;

create or replace function public.prevent_contract_review_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('app.production_cleanup_synthetic', true) = 'on' then
    return old;
  end if;
  raise exception 'Contract review records are immutable';
end;
$$;

commit;
