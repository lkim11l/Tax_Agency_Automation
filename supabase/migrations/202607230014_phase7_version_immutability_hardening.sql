begin;

create or replace function public.prevent_contract_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Contract versions are immutable';
  end if;
  if new.status is not distinct from old.status
    or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Contract version content is immutable';
  end if;
  if not (
    (old.status = 'awaiting_review' and new.status in (
      'approved', 'rejected', 'superseded', 'void'
    ))
    or (old.status = 'approved' and new.status in (
      'delivered', 'delivery_failed', 'superseded', 'void'
    ))
    or (old.status = 'delivery_failed' and new.status in (
      'approved', 'void'
    ))
  ) then
    raise exception 'Invalid contract version status transition';
  end if;
  return new;
end;
$$;

commit;
