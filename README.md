# Tax Agency Automation

Functional MVP for AI-assisted contract workflow automation.

## Product flow

```text
Email
  ↓
Application
  ↓
Attachment parsing
  ↓
Structured extraction
  ↓
Missing-data review
  ↓
Clarification
  ↓
DOCX generation
  ↓
Human approval
  ↓
Email delivery
  ↓
Registry and reporting
```

## Current priority

Reliability first. The interface should be simple and operational. No design polish should delay the end-to-end workflow.

Phase 0 through Phase 4 are complete. Structured extraction passed hosted
database/RLS, real OpenAI Structured Outputs, source attribution, correction,
cache, prompt-injection, and synthetic evaluation acceptance.

## Start here

Codex and developers must read:

1. `AGENTS.md`
2. `docs/SCOPE.md`
3. `docs/ROADMAP.md`
4. `docs/CURRENT_SPRINT.md`
5. `docs/ARCHITECTURE.md`
6. `docs/DECISIONS.md`

## MVP foundation stack

- Next.js 16.2.11 with App Router
- React 19.2.8
- TypeScript 6.0.3 with strict mode
- Supabase PostgreSQL, Auth, and Storage
- Supabase CLI 2.109.1
- Zod 4.4.3
- OpenAI JavaScript SDK 6.49.0 and Responses API
- Vitest 4.1.10
- ESLint 9.39.5
- GitHub Actions

Exact dependency versions are locked in `package-lock.json` and the material
technical decisions are recorded in `docs/DECISIONS.md`.

## Local setup

Prerequisites:

- Node.js 24 (CI version; package minimum is Node.js 20.9);
- npm 11 or later;
- a Supabase project.

Install dependencies:

```bash
npm ci
```

Create a local environment file:

```powershell
Copy-Item .env.example .env.local
```

On macOS or Linux:

```bash
cp .env.example .env.local
```

Set these values in `.env.local` from the Supabase project settings:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Legacy projects may use `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead of the
publishable key.

Set `SUPABASE_SECRET_KEY` only for server-side email ingestion. The legacy
`SUPABASE_SERVICE_ROLE_KEY` name is temporarily accepted. Never expose either
through a `NEXT_PUBLIC_*` variable or commit `.env.local`.

Set `OPENAI_API_KEY` only on the server for Phase 4 extraction. The application
uses the exact `gpt-5.6-sol` identifier, versioned prompt/schema files, strict
Structured Outputs, and a second local Zod validation pass. Never expose this
key through `NEXT_PUBLIC_*`.

## Supabase database setup

Local Supabase requires Docker Desktop with the Linux container engine running.

Start the local stack:

```bash
npm run db:start
```

Apply all migrations to a clean local database and load the repeatable safe seed:

```bash
npm run db:reset
```

The reset command recreates the local database, applies files in
`supabase/migrations`, and loads `supabase/seed.sql`. It is destructive to local
Supabase data.

To stop the local stack:

```bash
npm run db:stop
```

For a hosted project, authenticate the Supabase CLI, link the intended project,
review the migration diff, and apply migrations:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Do not apply the demonstration seed to a production project.

## First user

Create the first user through Supabase Dashboard → Authentication → Users.
Public self-service registration is disabled. The database trigger creates a
`profiles` row with the `specialist` role.

To make the initial operator an administrator, run a reviewed statement in the
Supabase SQL editor, replacing the placeholder email:

```sql
update public.profiles
set role = 'admin'
where email = 'ADMIN_EMAIL_HERE';
```

Never create an `auth.users` row directly with ordinary migration SQL.

Start the application:

```bash
npm run dev
```

Open `http://localhost:3000`. Unauthenticated users are redirected to `/login`.
After signing in, the internal routes are:

- `/applications`
- `/applications/new`
- `/applications/[id]`
- `/counterparties`
- `/templates`
- `/reports`
- `/settings`

The public health endpoint is `GET /api/health`.

## Mail.ru ingestion

Copy the canonical Mail.ru variables from `.env.example` and use an
external-application password. `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USERNAME`, and
`EMAIL_PASSWORD` remain compatibility aliases, but new setup should use the
`EMAIL_IMAP_*` and `EMAIL_SMTP_*` names.

Verify both connections without sending mail:

```bash
npm run email:check
```

Run one polling iteration:

```bash
npm run email:sync
```

Administrators can also run a real iteration and review failures/unlinked
messages at `/email`. See `docs/EMAIL_INTEGRATION.md` and
`docs/EMAIL_OPERATIONS.md`.

## Document parsing

Phase 3 supports DOCX, text PDFs, XLSX, TXT, and CSV. Validated JPEG, PNG, WebP,
TIFF, and scanned PDFs are routed to `review_required / OCR_REQUIRED`; OCR is
not enabled. Safe unknown formats remain visible as `unsupported`. Macro-enabled
Office files, executable/active content, standalone archives, spoofed files,
unsafe Office archives, and configured limit violations are blocked.

Run the pending queue:

```bash
npm run documents:parse-pending
```

Run one pending attachment:

```bash
npm run documents:parse -- --attachment-id=<uuid>
```

Administrators have equivalent real actions on the application detail page.
Active specialists can inspect status, parser/version, source metadata,
warnings, safe errors, text length, normalized text, and the private original.
See `docs/DOCUMENT_PARSING.md` and `docs/DOCUMENT_OPERATIONS.md`.

## Validation

Run the same checks used by CI:

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:email:live
npm run test:documents:live
npm run test:extraction:live
npm run test:extraction:eval
npm run build
npm audit
```

## Structured extraction

Phase 4 uses only normalized email and successfully parsed document text.
Original files, images, OCR_REQUIRED content, and binary data are never sent to
OpenAI. Deterministic validators find and validate candidates before relevant,
bounded source fragments are sent to the Responses API.

Run one application:

```bash
npm run extraction:run -- --application-id=<uuid>
```

Force a new reviewed run:

```bash
npm run extraction:run -- --application-id=<uuid> --force
```

Run the eligible parsed-application batch from a trusted server environment:

```bash
npm run extraction:pending
```

Specialists and administrators can run one extraction and correct values on the
application detail page. Only administrators can start the UI batch. Repeated
unchanged runs use the persisted fingerprint cache. See
`docs/AI_EXTRACTION.md`, `docs/AI_EVALUATION.md`, and
`docs/AI_OPERATIONS.md`.

Hosted integration tests require three dedicated Dashboard users in `.env.local`:

```text
SUPABASE_TEST_ADMIN_EMAIL
SUPABASE_TEST_ADMIN_PASSWORD
SUPABASE_TEST_SPECIALIST_EMAIL
SUPABASE_TEST_SPECIALIST_PASSWORD
SUPABASE_TEST_INACTIVE_EMAIL
SUPABASE_TEST_INACTIVE_PASSWORD
```

Their `profiles` roles/states must be admin/active, specialist/active, and
specialist/inactive. The integration suite uses only user sessions and the
publishable/legacy anon key for RLS assertions. It does not use service-role.

The local Supabase CLI configuration is in `supabase/config.toml`. It disables
public sign-up and anonymous sign-in. Phase 1 migration and seed instructions are
documented above. See `docs/INTEGRATION_TESTING.md` for the real database
acceptance checklist.

## Status

See `docs/CURRENT_SPRINT.md`.
