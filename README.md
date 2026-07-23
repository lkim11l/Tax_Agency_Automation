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

Phase 0 repository foundation is complete. Phase 1 application registry code,
migrations, RLS policies, and safe seed data are implemented. Real Supabase
acceptance verification remains required before Phase 2.

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
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Do not expose or commit `SUPABASE_SERVICE_ROLE_KEY`. It is reserved for future
server-only administrative operations.

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

## Validation

Run the same checks used by CI:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The local Supabase CLI configuration is in `supabase/config.toml`. It disables
public sign-up and anonymous sign-in. Phase 1 migration and seed instructions are
documented above. See `docs/INTEGRATION_TESTING.md` for the real database
acceptance checklist.

## Status

See `docs/CURRENT_SPRINT.md`.
