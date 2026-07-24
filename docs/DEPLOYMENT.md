# Production deployment

## Target

Deploy the Next.js application to Vercel Hobby and keep
PostgreSQL/Auth/private Storage in a dedicated hosted Supabase production
project. On Hobby, an administrator starts mailbox synchronization manually
from `/settings`. No Vercel Cron is registered and no OCR worker is deployed.

After the customer approves Vercel Pro, automatic synchronization can be
enabled every five minutes without changing the protected endpoint or
background-processing implementation.

## Owner actions

1. Create a new Vercel project from this GitHub repository and select `main`.
2. Keep the Hobby plan. The committed `vercel.json` intentionally contains no
   `crons` entry, so deployment does not attempt to register a Pro-frequency
   schedule.
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
9. Invoke `GET /api/health`, sign in as the administrator, and run mailbox
   synchronization from `/settings`. Confirm the persisted run and component
   statuses appear on that page.

This repository is not currently linked to a Vercel project, so no production
URL or domain has been verified.

## Hobby runtime behavior

Mailbox synchronization is manual from the administrator page. The same
background pipeline still uses a PostgreSQL lock, rejects concurrent runs,
recovers stale claims, retries transient stages, and persists stages, counts,
audit records, and safe errors. Email ingestion, document parsing, extraction
and completeness remain idempotent. The job never approves or sends
clarification or contract messages.

## Upgrade to Pro

After payment, add this entry to `vercel.json` and deploy:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/mailbox",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Keep the existing server-only `CRON_SECRET`. Vercel will call the retained
`GET /api/cron/mailbox` endpoint with its bearer authorization. Verify one
automatic run on `/settings` after deployment. Do not configure a second
scheduler.
