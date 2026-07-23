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

Phase 0 repository foundation is complete. Phase 1 application registry work has
not started.

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

Create user accounts through the Supabase administrator dashboard. Public
self-service registration is disabled by design.

Start the application:

```bash
npm run dev
```

Open `http://localhost:3000`. Unauthenticated users are redirected to `/login`.
After signing in, the internal routes are:

- `/applications`
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
public sign-up and anonymous sign-in. No Phase 1 database schema is included yet.

## Status

See `docs/CURRENT_SPRINT.md`.
