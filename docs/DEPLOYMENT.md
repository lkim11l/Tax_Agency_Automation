# Production deployment

## Target

Deploy the Next.js application to Vercel Pro, keep PostgreSQL/Auth/private
Storage in a dedicated hosted Supabase production project, and run the
five-minute mailbox pipeline through Vercel Cron. No OCR worker is deployed.

## Owner actions

1. Create a new Vercel project from this GitHub repository and select `main`.
2. Select the Pro plan: the committed `*/5 * * * *` schedule is not supported
   by the Hobby daily cron limit.
3. Set the production Node.js runtime to a supported Node 24 release.
4. Add every value in `.env.example` that applies to production. At minimum:
   `APP_URL`, `APP_ENV=production`, `CRON_SECRET`, Supabase URL/publishable and
   secret keys, `OPENAI_API_KEY`, canonical `EMAIL_IMAP_*`, canonical
   `EMAIL_SMTP_*`, and `EMAIL_FROM`. Keep legacy email aliases only during a
   controlled migration. Mark all server-only values sensitive.
5. Use a random `CRON_SECRET` of at least 32 bytes. Never use a
   `NEXT_PUBLIC_` prefix for server credentials.
6. Link the CLI to the dedicated production Supabase project, inspect
   `npx supabase db push --dry-run`, then run `npx supabase db push`.
7. Do not load `supabase/seed.sql`. Provision exactly one initial admin and one
   active specialist in Dashboard; disable public signup.
8. Deploy, record the production URL, then configure and verify the custom
   domain and HTTPS.
9. Invoke `GET /api/health`; then call `/api/cron/mailbox` with the bearer
   secret once. Confirm the admin `/settings` page shows both persisted runs.

This repository is not currently linked to a Vercel project, so no production
URL or domain has been verified.

## Runtime behavior

Vercel calls `GET /api/cron/mailbox` every five minutes. The endpoint fails
closed without the bearer secret. PostgreSQL admits one active job, recovers
stale claims after the configured timeout, and preserves stages, counts and
safe errors. Email ingestion, document parsing, extraction and completeness
are idempotent. The job never approves or sends clarification or contract
messages.

