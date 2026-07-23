# Current Sprint

## Current phase

Phase 2 — Email ingestion (complete)

## Sprint goal

Convert Mail.ru INBOX messages into applications without duplicate processing
or silent loss.

## Phase 1

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

## Phase 2 implementation

- [x] Select Mail.ru through standard IMAP/SMTP.
- [x] Add provider-neutral email interface and typed configuration loader.
- [x] Verify real IMAP TLS/auth and SMTP TLS/auth.
- [x] Add one-iteration polling CLI and admin-only UI action.
- [x] Add mailbox state with UIDVALIDITY handling.
- [x] Add atomic application/email ingestion and mailbox-scoped idempotency.
- [x] Add exact In-Reply-To/References linkage and unlinked review queue.
- [x] Add private attachment storage, validation, checksums, and signed access.
- [x] Add manual linkage, reprocessing, error visibility, and email audit.
- [x] Show plain-text correspondence and attachments on application detail.
- [x] Pass 21 hosted integration tests across Phase 1 and Phase 2.
- [x] Complete live email/application/reply/attachment acceptance.
- [x] Confirm persistence through an application restart after live ingestion.

## Phase 2 acceptance

Acceptance completed on 2026-07-22 against the configured Mail.ru INBOX and
linked hosted Supabase project:

- real IMAP TLS/auth and SMTP TLS/auth passed;
- three prefixed acceptance messages were found;
- two independent same-subject messages created two applications;
- the real reply linked to the first application through reply headers;
- one safe text attachment was stored in the private bucket;
- active authenticated signed access passed and anonymous access was denied;
- repeated live ingestion and a second operational polling iteration created no
  duplicates;
- operational polling persisted five mailbox messages, four applications, one
  reply link, one attachment, and a completed UID cursor without errors;
- production login/logout, anonymous redirect, admin-only UI sync, persisted
  correspondence, plain-text rendering, and error/success state were checked
  after rebuilding and restarting the application;
- an invalid derived password produced only a safe error and did not expose the
  real credential.

The hosted suite passed 21 tests and the local suite passed 59 tests. No
credentials, real message bodies, mailbox addresses, or attachments are stored
in Git.

## Explicitly excluded

- AI extraction
- File parsing or OCR
- Clarification email
- DOCX generation
- Contract delivery
- Reporting and XLSX export
- Phase 3 or later implementation

## Next phase rule

Phase 3 must not begin without a separate direct user instruction.
