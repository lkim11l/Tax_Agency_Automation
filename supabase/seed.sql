begin;

insert into public.counterparties (
  id, legal_name, short_name, inn, kpp, ogrn, legal_address, contact_name, contact_email
) values
  (
    '10000000-0000-4000-8000-000000000001',
    'Demo Northwind Services LLC',
    'Northwind Demo',
    '7700000001',
    '770001001',
    '1027700000001',
    'Demo address, 1',
    'Demo Contact',
    'contact@example.invalid'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Demo Contoso Operations LLC',
    'Contoso Demo',
    '780000000002',
    null,
    '102780000000002',
    null,
    null,
    null
  )
on conflict (id) do nothing;

insert into public.contract_templates (
  id, name, description, version, status, required_fields, variable_schema, is_active
) values (
  '20000000-0000-4000-8000-000000000001',
  'Demo service agreement metadata',
  'Metadata only. No DOCX file is connected.',
  '0.1',
  'draft',
  '["counterparty_legal_name", "contract_subject", "amount"]'::jsonb,
  '{"type":"object"}'::jsonb,
  false
)
on conflict (id) do nothing;

insert into public.applications (
  id,
  application_number,
  title,
  source,
  status,
  priority,
  received_at,
  counterparty_id,
  contract_template_id,
  contract_subject,
  contract_amount,
  currency,
  payment_terms,
  internal_notes
) values
  (
    '30000000-0000-4000-8000-000000000001',
    'REQ-2026-900001',
    'Demo office support agreement',
    'manual',
    'new',
    'normal',
    '2026-01-15T09:00:00Z',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Demo administrative support services',
    125000.00,
    'RUB',
    'Demo payment terms. Not customer data.',
    'Safe demonstration record.'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'REQ-2026-900002',
    'Demo consulting request',
    'manual',
    'processing',
    'high',
    '2026-02-03T12:30:00Z',
    '10000000-0000-4000-8000-000000000002',
    null,
    'Demo consulting services',
    null,
    null,
    null,
    'Intentionally incomplete demonstration record.'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'REQ-2026-900003',
    'Demo data review request',
    'manual',
    'needs_data_review',
    'low',
    '2026-02-10T08:15:00Z',
    null,
    null,
    null,
    null,
    null,
    null,
    null
  )
on conflict (id) do nothing;

commit;
