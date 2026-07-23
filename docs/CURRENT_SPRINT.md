# Current Sprint

## Current phase

Phase 1 — Application registry (implementation complete; real Supabase acceptance pending)

## Sprint goal

Create the internal database foundation and a working manual application
registry before connecting email or AI services.

## Completed implementation

- [x] Preserve Phase 0 and confirm a clean repository.
- [x] Define profiles and MVP roles.
- [x] Define applications and collision-safe application numbers.
- [x] Define counterparties.
- [x] Define future email message and attachment schema without integration.
- [x] Define future extracted field schema without AI.
- [x] Define template metadata, contracts, and immutable contract versions.
- [x] Define status history and append-only audit events.
- [x] Add constraints, indexes, triggers, and RLS policies.
- [x] Add repeatable safe demonstration seed data.
- [x] Add focused repositories and server-side validation.
- [x] Build application list, filters, and honest error/empty states.
- [x] Build manual application creation.
- [x] Build application detail editing, assignment, status, and comments.
- [x] Show related entity counts, status history, and audit.
- [x] Build minimal counterparty create/search/edit operations.
- [x] Build template metadata create/list/edit operations.
- [x] Add unit and migration-contract tests.
- [x] Pass lint, strict typecheck, unit tests, and production build.

## Acceptance verification

- [ ] Apply migrations to a clean local Supabase database.
- [ ] Create a real Dashboard user and verify active-profile access.
- [ ] Verify inactive-profile denial against RLS.
- [ ] Exercise create/edit/status/comment/search/filter flows against PostgreSQL.
- [ ] Verify persisted status history and audit records.
- [ ] Verify missing application returns 404 with a configured database.

Blocked locally on 2026-07-22: Docker Desktop is installed but its Linux daemon
is not running, `.env.local` is absent, and no hosted Supabase credentials were
provided. Unit tests and production build do not substitute for these checks.

## Explicitly excluded

- Email provider integration
- AI extraction
- File parsing or OCR
- Clarification email
- DOCX generation
- Contract delivery
- Reporting and XLSX export
- Phase 2 or later implementation

## Remaining setup

1. Start Docker Desktop or link a dedicated hosted Supabase project.
2. Run `npm run db:reset` locally, or review and run `npx supabase db push`.
3. Create the first user in Supabase Dashboard and configure `.env.local`.
4. Complete `docs/INTEGRATION_TESTING.md`.
5. Mark Phase 1 acceptance complete only after real persistence is verified.
