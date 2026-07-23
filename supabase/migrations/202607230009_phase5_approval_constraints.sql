alter table public.clarification_drafts
  add constraint clarification_status_requires_approval
  check (
    status not in ('approved', 'sending', 'sent')
    or (approved_by is not null and approved_at is not null)
  );
