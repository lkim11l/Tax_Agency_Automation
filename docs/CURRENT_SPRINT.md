# Current Sprint

## Current phase

Post-MVP presentation readiness and production cleanup (in progress)

## Sprint goal

Prepare the deployed MVP for a customer presentation without adding new
business features.

## Presentation readiness sprint

- [x] Identify the production template-upload failure as duplicate PostgreSQL
  constraints hidden by generic error handling.
- [x] Add safe template error codes, structured server diagnostics, rollback
  reporting, filename normalization, loading state and double-submit protection.
- [x] Add pending customer legal-approval metadata and block delivery for
  templates without legal approval.
- [x] Add application pagination, request-scoped auth/profile memoization,
  justified indexes and a one-request dashboard summary.
- [x] Add a real-data operations dashboard and predictable route loading state.
- [x] Set Russian as the product default and add shared Russian date, amount,
  status, priority and template-type formatting.
- [x] Correct Hobby health semantics so manual mailbox mode alone is not degraded.
- [x] Add guarded production cleanup dry-run/apply commands and an external
  checksum-protected manifest.
- [x] Complete cleanup dry-run with explicit markers and preservation rules.
- [x] Receive explicit destructive-operation confirmation and apply the guarded
  cleanup migration and manifest.
- [x] Verify zero selected orphaned Storage objects.
- [x] Upload and verify the three presentation DOCX templates with
  `pending_customer_approval`.
- [ ] Deploy the code to Vercel and pass the production acceptance smoke.
- [ ] Record post-deployment performance measurements and close the sprint.

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

- OCR execution (images and scanned PDFs are review-required)
- DOCX generation
- Contract delivery
- Reporting and XLSX export
- Phase 6 or later implementation

## Phase 3 implementation

- [x] Add a library-independent `DocumentParser` registry.
- [x] Add a separate Phase 3 migration and apply it to hosted Supabase.
- [x] Add atomic claims, current results, immutable attempts, retry, and audit.
- [x] Parse DOCX paragraphs, headings, list items, and tables.
- [x] Parse text PDFs with stable page markers.
- [x] Parse non-empty XLSX sheets with row/cell references and safe formulas.
- [x] Parse TXT/CSV with BOM and CSV formula-injection handling.
- [x] Route validated images and scanned PDFs to `OCR_REQUIRED`.
- [x] Define a deferred `OcrProvider`, `OcrResult`, and quality metrics without
  installing or claiming an OCR engine.
- [x] Validate signatures, MIME/extensions, checksums, macros, archives, and limits.
- [x] Add admin parse/retry/batch actions and specialist result visibility.
- [x] Add CLI commands and synthetic fixtures.
- [x] Pass 28 hosted integration tests across Phase 1, Phase 2, and Phase 3.
- [x] Parse the existing real `phase2-live.txt` attachment.
- [x] Pass the five-format Mail.ru live document acceptance.
- [x] Pass final lint, typecheck, unit, integration, live, build, and audit checks.

OCR engine status: intentionally not installed or accepted. On the current
Windows workstation, Docker and WSL command-line entry points exist, but no WSL
distribution is registered and the Docker daemon is not running. Python,
Tesseract, Ghostscript, and OCRmyPDF are not available on PATH. Image/scanned
PDF results therefore remain `review_required / OCR_REQUIRED`.

## Phase 3 acceptance

Acceptance completed on 2026-07-23 against the configured Mail.ru INBOX,
private hosted Supabase Storage, and linked hosted database:

- the exact five-attachment live message was ingested idempotently;
- DOCX paragraphs/table text, PDF page text, and XLSX sheet/row/cell text parsed;
- stable `[PAGE 1]` and `[SHEET: Request]` source markers persisted;
- PNG became `review_required / OCR_REQUIRED`;
- safe RTF became `unsupported / UNSUPPORTED_FORMAT`;
- repeating ingestion and parsing created no duplicate application, attachment,
  current result, or attempt;
- results persisted through a fresh server client;
- active specialist private access passed and anonymous access was denied;
- immutable attempts and required audit events persisted;
- 84 unit/contract tests and 28 hosted integration tests passed;
- lint, strict typecheck, production build, and zero-vulnerability audit passed.

## Phase 4 implementation

- [x] Add versioned strict Zod schema and extraction prompt.
- [x] Verify official OpenAI SDK 6.49.0 and exact `gpt-5.6-sol` access.
- [x] Add deterministic identifiers, contacts, dates, amount, and currency parsing.
- [x] Add marker-aware relevant-fragment selection, limits, chunking, and merge.
- [x] Exclude binary, image, unsupported, and OCR_REQUIRED inputs.
- [x] Add Responses API Structured Outputs and local Zod/source/format validation.
- [x] Add null behavior, deterministic confidence, dedupe, and conflict detection.
- [x] Add durable runs, usage, safe errors, conflicts, and current fields.
- [x] Add advisory-lock concurrency and versioned fingerprint cache.
- [x] Add specialist/admin correction, candidate selection, manual null, and history.
- [x] Add one-application and admin batch UI/CLI actions.
- [x] Add RLS and required extraction audit actions.
- [x] Add 105 local unit/contract tests and 33 hosted integration tests.
- [x] Pass real OpenAI/Supabase live extraction acceptance.
- [x] Pass all 15 synthetic evaluation scenarios without hallucinated missing fields.

## Phase 4 acceptance

Acceptance completed on 2026-07-23 against the linked hosted Supabase project
and real OpenAI Responses API:

- `gpt-5.6-sol` access and strict schema output passed;
- organization, signer, subject, amount/currency, dates, and payment terms persisted;
- missing values remained null and conflicting email/document amounts were recorded;
- every accepted non-null value retained source ID, marker, and short excerpt;
- manual correction/history persisted and survived a fresh authenticated session;
- an unchanged repeat was a cache hit with no second model call;
- concurrent run claims, specialist/admin/inactive/anonymous RLS, and audit passed;
- OCR_REQUIRED content and images produced zero AI calls;
- the 15-case evaluation achieved 100% schema validity, normalized/exact match,
  missing precision, conflict detection, and source attribution, with zero
  hallucinations;
- final live usage was 10,909 input and 4,180 output tokens;
- lint, strict typecheck, 105 unit tests, 33 hosted integration tests, production
  build, and zero-vulnerability audit passed.

## Phase 5 implementation

- [x] Add three versioned deterministic required-field rule sets.
- [x] Add evidence-aware completeness calculation and field results.
- [x] Persist extraction fingerprints, totals, blocking state, and audit.
- [x] Add editable deterministic Russian clarification drafts.
- [x] Add approval revocation/versioning and explicit lifecycle actions.
- [x] Extend Mail.ru provider with SMTP send and persisted idempotent attempts.
- [x] Add conservative safe-failure and delivery-unknown handling.
- [x] Store outbound correspondence and standard reply identifiers.
- [x] Add idempotent reply claims, new-attachment parsing, and delta extraction.
- [x] Preserve manual corrections and recalculate after reply.
- [x] Add plain application-detail operations UI.
- [x] Apply additive hosted migrations 006 and 007.
- [x] Pass local unit tests and hosted Phase 5 RLS/persistence tests.
- [x] Confirm one real SMTP delivery from the dedicated synthetic application.
- [x] Receive and process the real Reply from the controlled external address.
- [x] Complete final validation and documentation acceptance check.

## Phase 5 acceptance

Acceptance completed on 2026-07-23 using the dedicated synthetic application
`REQ-2026-000130`, titled `TAA-PHASE5-LIVE-20260723-001`:

- Mail.ru SMTP confirmed one explicitly approved clarification send;
- a real Gmail Reply linked to the same application by RFC headers;
- the reply was reconciled from the legacy outbound mailbox identity without a
  resend, and the corrected identity contract is migration-backed;
- delta extraction used only the new inbound email source ID;
- the prior three manual corrections remained unchanged;
- completeness recalculated with a persisted extraction fingerprint;
- the result was honestly incomplete at 50% due to one conflict and five
  low-confidence fields, so the application remained `needs_data_review`;
- one inbound message and one reply run persisted;
- repeated mailbox synchronization created no messages, links, runs, or model
  calls;
- required audit events persisted without bodies, credentials, or prompts;
- 116 local tests and 36 hosted integration tests passed;
- lint, strict typecheck, production build, live acceptance, and zero-vulnerability
  audit passed.

## Phase 6 implementation

- [x] Add three template types and immutable version metadata.
- [x] Add private DOCX upload, checksum, validation report, approval, lifecycle,
  and audit.
- [x] Add `contract-placeholders-v1` discovery in paragraphs, tables,
  headers/footers, and split Word runs.
- [x] Block malformed archives, unsafe ZIP paths/limits, macros, DOCM, XML
  entities, unknown/missing placeholders, and unsupported placements.
- [x] Add `contract-mapping-v1`, Russian dates/amounts, and deterministic RUB
  amount words without invented legal values.
- [x] Add server-side readiness/fingerprint/staleness/review checks and required
  rendering preview.
- [x] Add advisory-lock `TAA-YYYY-NNNNNN` numbering, idempotent claims, safe
  concurrent rejection, and admin force reason.
- [x] Add private output Storage, cleanup on failure, immutable versions,
  `awaiting_review`, signed download, status history, and audit.
- [x] Add plain template/application UI without approval or delivery actions.
- [x] Apply hosted migrations 010 and 011 without remote reset.
- [x] Pass synthetic blocked and generated live scenarios, cache hit, concurrent
  request, force version 2, specialist access, and anonymous denial.
- [x] Open the output in Word, export it independently, and visually inspect the
  A4 page, table, header/footer, values, and signature area.

## Phase 6 acceptance

Acceptance completed on 2026-07-23 against the linked hosted Supabase project:

- incomplete synthetic data was denied before contract number allocation;
- the approved synthetic services template passed validation and remained
  distinct from any real customer or legally approved template;
- `REQ-2026-000172` generated contract `TAA-2026-000004`;
- concurrent identical requests produced one version and one safe running
  rejection, followed by a cache hit;
- admin force regeneration created immutable version 2 and preserved version 1;
- the latest checksum matched the downloaded private object;
- active specialist download passed and anonymous access was denied;
- generated status remained `awaiting_review`, with no sending capability;
- all required generation/cache/failure/regeneration audits persisted;
- 128 local unit/contract tests and 40 hosted integration tests passed;
- lint, strict typecheck, production build, live acceptance, and
  zero-vulnerability audit passed.

## Phase 7 implementation

- [x] Add checksum-bound immutable review records and approve/reject/return actions.
- [x] Require an authenticated review download/open event before a decision.
- [x] Block unapproved, rejected, superseded, void, stale, or mismatched versions.
- [x] Add deterministic, editable, versioned delivery drafts.
- [x] Validate and audit confirmed/manual recipients without exposing message bodies.
- [x] Attach the exact private DOCX after signature and two-checksum verification.
- [x] Add service-only transactional delivery claims and concurrent-send protection.
- [x] Persist SMTP attempts, outgoing email, attachment metadata, and safe errors.
- [x] Treat ambiguous SMTP outcomes as reconciliation-required and never auto-retry.
- [x] Update version, contract, application, status history, and audit only after SMTP success.
- [x] Apply hosted migrations 012 and 013 without reset.
- [x] Pass Phase 7 unit/migration-contract and hosted security/persistence tests.
- [x] Send one synthetic approved DOCX through the configured Mail.ru SMTP.
- [x] Verify repeated identical send is a cache hit and creates no second SMTP delivery.
- [x] Download the attachment from the external recipient mailbox and match its SHA-256.
- [x] Run the final complete validation suite after received-attachment verification.
- [x] Commit and push Phase 7.

## Phase 7 acceptance

The synthetic contract for `REQ-2026-000172` was rejected, regenerated,
checksum-approved, and accepted once by Mail.ru SMTP. The persisted version,
review, draft, outgoing email, attachment metadata, Message-ID, application
status, contract status, status history, audit, RLS, and duplicate-send cache
have been verified. The external recipient returned the unchanged DOCX, and its
independently calculated SHA-256 matched the approved version exactly.

## Phase 8 implementation

- [x] Add a database-backed contract registry view over Phase 1–7 records.
- [x] Add server filters, sorting, pagination, links, and filter-scoped totals.
- [x] Keep currency totals separate and calculate deterministic monthly metrics.
- [x] Add `Contracts` and `Summary` XLSX sheets with native number/date types.
- [x] Preserve INN and bank accounts as text and neutralize formula-like values.
- [x] Persist immutable report metadata and checksums in private Storage.
- [x] Add actor-scoped fingerprint cache and admin force regeneration with reason.
- [x] Add admin/specialist scope, anonymous/inactive denial, signed downloads, and audit.
- [x] Apply hosted migration 015 without reset.
- [x] Pass unit, hosted integration, live, artifact-tool render, and Microsoft Excel checks.

## Phase 8 acceptance

Accepted on 2026-07-23 using existing synthetic Phase 1–7 data. The live
registry returned 90 July rows, database totals matched the export, currencies
remained separate, cache and admin force regeneration passed, and the private
XLSX checksum matched Storage. Specialist scope was tested with one temporary
explicitly synthetic assignment and the original assignment was restored.
Microsoft Excel opened the file read-only with exactly `Contracts` and
`Summary`; date, amount, INN, and account formats passed.

## Next phase rule

Phase 9 was started by direct user instruction. Do not start post-MVP work.

## Phase 9 — Pilot hardening and deployment

- [x] Select Vercel Hobby + hosted Supabase as the current production target.
- [x] Keep Hobby deployment free of registered cron schedules.
- [x] Preserve the protected cron endpoint for a future Vercel Pro upgrade.
- [x] Preserve administrator-initiated mailbox synchronization on Hobby.
- [x] Add protected, database-locked, persisted mailbox pipeline runs.
- [x] Limit automation to ingestion, parsing, extraction and completeness.
- [x] Add public safe health and admin-only component/job status.
- [x] Add retry/backoff, stale-run recovery and safe error persistence.
- [x] Add RU/EN locale foundation with Russian as the default.
- [x] Add deployment, operations, incident, backup, security and Russian user docs.
- [x] Apply the operations migration and run two hosted non-sending smoke runs.
- [ ] Link and deploy the Vercel production project.
- [ ] Configure and verify the production URL, domain and production secrets.
- [ ] Provision exactly one production admin and one production specialist.
- [ ] Verify the Hobby deployment and manual synchronization smoke test.
- [ ] After customer payment, enable and verify five-minute Pro cron scheduling.
- [ ] Perform an isolated database-and-Storage restore rehearsal.
- [ ] Run and sign off the complete fresh synthetic end-to-end pilot scenario.
- [ ] Train the initial operator and start the pilot.

Current blocker: Vercel owner authentication/project linking, production
Supabase separation, domain configuration and an owner-supervised restore
environment are not available in this repository session.
