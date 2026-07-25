begin;

-- prevent_extraction_acceptance_mutation was added after the
-- app.production_cleanup_synthetic bypass convention was established (see
-- prevent_extracted_field_correction_mutation /
-- prevent_contract_version_mutation in earlier migrations) and never picked
-- it up — it unconditionally blocks DELETE, which meant
-- cleanup_synthetic_records() could never actually remove a synthetic
-- application whose extraction ever went through acceptance (cascade delete
-- from applications hits extracted_field_acceptances and fails). Bring it
-- in line with the same pattern: DELETE is allowed only inside the
-- cleanup RPC's transaction; UPDATE stays unconditionally blocked (these
-- records are still immutable in every other context).
create or replace function public.prevent_extraction_acceptance_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('app.production_cleanup_synthetic', true) = 'on' then
    return old;
  end if;
  raise exception 'extraction acceptance records are immutable';
end;
$$;

commit;
