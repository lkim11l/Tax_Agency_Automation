alter type public.application_status
  add value if not exists 'contract_revision_required' after 'needs_revision';

alter type public.application_status
  add value if not exists 'contract_sent' after 'sent';

alter type public.contract_status
  add value if not exists 'delivered' after 'sent';
