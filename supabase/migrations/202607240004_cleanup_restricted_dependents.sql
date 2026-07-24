begin;

create function public.cleanup_synthetic_application_dependents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.production_cleanup_synthetic', true) <> 'on' then
    return old;
  end if;

  delete from public.contract_delivery_attachments
  where delivery_attempt_id in (
    select id from public.contract_delivery_attempts
    where application_id = old.id
  );
  delete from public.contract_delivery_attempts
  where application_id = old.id;
  delete from public.contract_delivery_drafts
  where application_id = old.id;
  delete from public.contract_version_reviews
  where application_id = old.id;
  return old;
end;
$$;

create trigger applications_cleanup_synthetic_dependents
before delete on public.applications
for each row execute function public.cleanup_synthetic_application_dependents();

commit;
