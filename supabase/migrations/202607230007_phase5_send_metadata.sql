alter table public.completeness_runs
  add column extraction_fingerprint text not null default repeat('0', 64),
  add constraint completeness_extraction_fingerprint_format
    check (extraction_fingerprint ~ '^[0-9a-f]{64}$');

alter table public.clarification_send_attempts
  add column provider_message_id text;
