# Incident response

1. Preserve evidence: job ID, application number, UTC time, safe error code and
   relevant provider status. Do not paste secrets or customer document text.
2. Stop the scheduler in Vercel when duplicate or unsafe processing is
   suspected. Do not delete records.
3. For IMAP/SMTP failure, verify Mail.ru availability and credentials, then run
   one administrator pipeline. Reconcile ambiguous SMTP delivery manually.
4. For OpenAI failure, leave extraction pending/review-required; do not invent
   values. Retry after provider recovery.
5. For Supabase/Storage failure, stop writes, verify platform status and backup
   availability, then follow `BACKUP_RECOVERY.md`.
6. For leaked credentials, revoke and rotate them at the provider, replace
   Vercel values, redeploy, and review audit/job history.
7. Close the incident only after health is current, idempotency is verified and
   an audit note is retained outside application logs.

