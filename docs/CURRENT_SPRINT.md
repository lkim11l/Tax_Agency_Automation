# Current Sprint

## Current phase

Phase 1 — Application registry (complete)

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

## Hosted Supabase acceptance

- [x] Link the intended hosted project and verify project-ref consistency.
- [x] Review and dry-run the Phase 1 migration.
- [x] Apply the migration without remote reset or remote seed.
- [x] Verify all 11 Phase 1 tables.
- [x] Disable public and anonymous registration.
- [x] Configure admin, active specialist, and inactive specialist users.
- [x] Verify real login/logout and SSR authenticated routes.
- [x] Verify persisted application HTTP 200 and missing application HTTP 404.
- [x] Create two applications with unique sequence-based numbers.
- [x] Verify application edits persist across a new session and server restart.
- [x] Verify counterparty and template metadata create/update.
- [x] Verify atomic status history and audit events.
- [x] Verify database constraints.
- [x] Verify anonymous, admin, active specialist, and inactive specialist RLS.
- [x] Pass 13 hosted integration tests without service-role RLS assertions.

Acceptance completed on 2026-07-22 against the linked hosted test project using
migration `202607230001_phase1_application_registry.sql`. No credentials,
project keys, or customer data are recorded in the repository.

## Explicitly excluded

- Email provider integration
- AI extraction
- File parsing or OCR
- Clarification email
- DOCX generation
- Contract delivery
- Reporting and XLSX export
- Phase 2 or later implementation

## Next phase rule

Phase 2 must not begin without a separate direct user instruction and a selected
mailbox provider.
