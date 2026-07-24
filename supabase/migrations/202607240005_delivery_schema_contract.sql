begin;

create or replace function public.get_production_schema_contract()
returns table (
  required_table text,
  required_column text,
  is_present boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with required(required_table, required_column) as (
    values
      ('clarification_drafts', 'id'),
      ('clarification_drafts', 'application_id'),
      ('clarification_drafts', 'version'),
      ('clarification_drafts', 'status'),
      ('contract_version_reviews', 'contract_version_id'),
      ('contract_version_reviews', 'decision'),
      ('contract_version_reviews', 'version_checksum'),
      ('contract_delivery_drafts', 'id'),
      ('contract_delivery_drafts', 'application_id'),
      ('contract_delivery_drafts', 'contract_version_id'),
      ('contract_delivery_drafts', 'version'),
      ('contract_delivery_drafts', 'recipient'),
      ('contract_delivery_drafts', 'status'),
      ('contract_delivery_attempts', 'delivery_draft_id'),
      ('contract_delivery_attempts', 'attempt_number'),
      ('contract_delivery_attempts', 'idempotency_key'),
      ('contract_delivery_attempts', 'status'),
      ('contracts', 'application_id'),
      ('contracts', 'contract_number'),
      ('contracts', 'current_version_id'),
      ('contracts', 'approved_version_id'),
      ('contracts', 'status'),
      ('contract_versions', 'contract_id'),
      ('contract_versions', 'version_number'),
      ('contract_versions', 'checksum'),
      ('contract_versions', 'source_fingerprint'),
      ('contract_versions', 'status'),
      ('completeness_runs', 'application_id'),
      ('completeness_runs', 'extraction_fingerprint'),
      ('completeness_runs', 'is_ready'),
      ('extraction_runs', 'application_id'),
      ('extraction_runs', 'input_fingerprint'),
      ('extraction_runs', 'schema_version'),
      ('extraction_runs', 'status')
  )
  select
    required.required_table,
    required.required_column,
    columns.column_name is not null
  from required
  left join information_schema.columns
    on columns.table_schema = 'public'
   and columns.table_name = required.required_table
   and columns.column_name = required.required_column
  order by required.required_table, required.required_column;
$$;

revoke all on function public.get_production_schema_contract()
  from public, anon, authenticated;
grant execute on function public.get_production_schema_contract()
  to service_role;

comment on column public.contract_delivery_drafts.version is
  'Canonical persisted delivery-draft version; application DTOs may expose it as draft_version.';

commit;
