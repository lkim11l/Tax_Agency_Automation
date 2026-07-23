begin;

create or replace function public.prevent_document_parse_attempt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

commit;
