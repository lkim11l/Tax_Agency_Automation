# MVP Roadmap

## Delivery rule

Complete phases in order. A later phase may begin only when the previous phase acceptance gate passes, except for isolated documentation or test preparation.

Target: a functional pilot in approximately three weeks after required access, templates, and sample documents are available.

---

# Phase 0 — Repository foundation

## Objective

Create a reproducible project with clear instructions, validation commands, environment configuration, and a deployable baseline.

## Tasks

- [x] Initialize Next.js TypeScript application.
- [x] Add strict TypeScript configuration.
- [x] Add linting and formatting.
- [x] Add test runner.
- [x] Add `typecheck`, `test`, and `build` scripts.
- [x] Add `.env.example`.
- [x] Add `.gitignore` rules for secrets and customer files.
- [x] Create database project/configuration.
- [x] Create basic authenticated application shell.
- [x] Create health endpoint.
- [x] Add CI for lint, typecheck, tests, and build.
- [x] Confirm clean local setup from README.

## Acceptance gate

- fresh install works;
- application starts;
- health endpoint responds;
- authentication boundary exists;
- validation commands pass;
- no secret is committed.

---

# Phase 1 — Application registry

## Objective

Create the internal data foundation before connecting real email.

## Tasks

- [x] Define database schema.
- [x] Add users.
- [x] Add applications.
- [x] Add counterparties.
- [x] Add email messages.
- [x] Add attachments.
- [x] Add extracted fields.
- [x] Add contract templates.
- [x] Add contracts and versions.
- [x] Add status history.
- [x] Add audit events.
- [x] Add database migrations.
- [x] Seed safe demonstration data.
- [x] Build application list.
- [x] Build application detail page.
- [x] Add status changes.
- [x] Add manual application creation for testing.
- [x] Add basic search and filters.

## Acceptance gate

A signed-in specialist can create, view, edit, and track an application, and every important change is persisted and audited.

Acceptance status: passed against the linked hosted Supabase test project on
2026-07-22. Authenticated CRUD, persistence, status history, audit, constraints,
and anonymous/admin/active-specialist/inactive-specialist RLS were verified.

---

# Phase 2 — Email ingestion

## Objective

Convert incoming mailbox messages into applications without duplication or data loss.

## Tasks

- [x] Confirm one customer email provider.
- [x] Define an email provider interface.
- [x] Implement the selected provider.
- [x] Store provider message and thread IDs.
- [x] Save sender, recipients, subject, body, and timestamps.
- [x] Download supported attachments.
- [x] Store attachments securely.
- [x] Add idempotency protection.
- [x] Link replies to an existing application.
- [x] Add manual reprocessing.
- [x] Add ingestion error visibility.
- [x] Add tests with provider fixtures.

## Acceptance gate

A real test email creates exactly one application, attachments are available, and a reply is linked to the same application.

Acceptance status: passed on 2026-07-22 against the configured Mail.ru mailbox
and linked hosted Supabase project. Root/same-subject/reply behavior,
application linkage, private attachment access, operational polling,
idempotency, restart persistence, UI sync, and safe invalid-credential handling
were verified.

---

# Phase 3 — Document parsing

## Objective

Produce normalized text from supported attachments while preserving source references.

## Tasks

- [x] Parse DOCX.
- [x] Parse text-based PDF.
- [x] Parse XLSX key-value content.
- [x] Add image OCR as a review-required path.
- [x] Validate file type and size.
- [x] Sanitize filenames.
- [x] Store parse status and errors.
- [x] Store normalized extracted text.
- [x] Preserve page, sheet, or document source metadata where possible.
- [x] Add unsupported-file fallback.
- [x] Add parser tests.

## Acceptance gate

Supported files produce readable normalized text, and unsupported or failed files remain visible for manual handling.

Acceptance status: passed on 2026-07-23 against the configured Mail.ru mailbox
and linked hosted Supabase project. DOCX/PDF/XLSX normalized text, page/sheet
markers, PNG OCR review, safe unsupported fallback, private access, anonymous
denial, retries, idempotency, persistence, immutable attempts, and audit were
verified.

---

# Phase 4 — Structured AI extraction

## Objective

Extract contract and counterparty data without fabricating missing information.

## Tasks

- [x] Define Zod or equivalent extraction schema.
- [x] Create versioned extraction prompt.
- [x] Extract organization details.
- [x] Extract signer details.
- [x] Extract contract subject.
- [x] Extract amount and currency.
- [x] Extract dates and payment terms.
- [x] Store source references.
- [x] Store confidence/review flags.
- [x] Return null for missing values.
- [x] Detect conflicting values.
- [x] Allow manual correction.
- [x] Preserve correction history.
- [x] Add safe evaluation fixtures.
- [x] Add extraction tests.

## Acceptance gate

Given approved test documents, the system produces schema-valid data, flags missing/conflicting values, and never invents absent required values.

Acceptance status: passed on 2026-07-23 against the linked hosted Supabase
project and real OpenAI Responses API. Strict schema/local validation, source
attribution, null/conflict behavior, correction history, cache/concurrency,
RLS/audit, OCR exclusion, prompt-injection defense, and a 15-case synthetic
evaluation were verified.

---

# Phase 5 — Completeness and clarification

## Objective

Identify missing fields and run a controlled clarification loop with the client.

## Tasks

- [x] Define required fields per template.
- [x] Calculate application completeness.
- [x] Show missing fields.
- [x] Show conflicting fields.
- [x] Generate an editable clarification draft.
- [x] Require specialist approval before sending.
- [x] Send from the connected mailbox.
- [x] Store sent clarification.
- [x] Link client reply.
- [x] Re-run extraction on new information.
- [x] Recalculate completeness.
- [x] Add send failure handling.
- [x] Add end-to-end clarification test.

## Acceptance gate

An incomplete application can request missing data, receive a reply, become complete, and retain the full conversation history.

---

# Phase 6 — Contract templates and generation

## Objective

Generate a correct DOCX from an approved template and validated application data.

## Tasks

- [x] Define a versioned explicit template variable convention.
- [x] Add private template upload, validation, metadata, approval, and versioning.
- [x] Support the three MVP types: services, consulting, and supply.
- [x] Define required fields and completeness rule set per template.
- [x] Add explicit manual approved-template selection.
- [x] Validate all variables, split runs, ZIP/XML safety, and macros.
- [x] Generate DOCX without changing unrelated OOXML.
- [x] Fail visibly before numbering on unresolved required rendered values.
- [x] Save immutable generated versions with source/version fingerprints.
- [x] Add authenticated short-lived signed download and audit.
- [x] Keep optional PDF conversion disabled until a stable deployment renderer exists.
- [x] Add synthetic unit, hosted integration, concurrency, and live generation tests.

## Acceptance gate

A complete application generates a downloadable contract with no unresolved required placeholders, and the generated version is stored immutably.

---

# Phase 7 — Approval and delivery

## Objective

Ensure only a human-approved contract is sent and preserve evidence of the action.

## Tasks

- [x] Add contract review screen.
- [x] Add approve action.
- [x] Add revision request.
- [x] Record approver and timestamp.
- [x] Block sending before approval.
- [x] Create editable cover email.
- [x] Attach the exact approved version.
- [x] Send through the connected provider.
- [x] Save provider send result.
- [x] Save sent message and attachment version.
- [x] Handle send retries safely.
- [x] Update application status only after confirmed send.
- [x] Add approval and sending tests.

## Acceptance gate

An unapproved contract cannot be sent. An approved contract is sent once, the
exact file is preserved, and the audit log identifies who approved and sent it.
Implementation, SMTP acceptance, and the independently downloaded external
attachment SHA-256 comparison passed.

---

# Phase 8 — Registry and reporting

## Objective

Give the customer an operational registry and a reliable monthly export.

## Tasks

- [x] Build contract registry.
- [x] Add date filters.
- [x] Add status filters.
- [x] Add counterparty filter.
- [x] Add amount totals.
- [x] Add links to application, contract, and correspondence.
- [x] Export XLSX.
- [x] Add monthly summary metrics.
- [x] List waiting-for-client applications.
- [x] List under-review applications.
- [x] List completed and incomplete applications.
- [x] Add report tests.

## Acceptance gate

The user can export a selected period and totals match persisted application and contract data.

Accepted on 2026-07-23 against hosted Supabase and Microsoft Excel. Registry,
scope, filters, pagination, totals, two-sheet XLSX, private persistence, cache,
admin force regeneration, RLS, and audit passed using synthetic data.

---

# Phase 9 — Pilot hardening

## Objective

Run the product with real test traffic while keeping human control.

## Tasks

- [ ] Prepare production environment.
- [ ] Configure backups.
- [x] Configure persisted error monitoring and an admin status page.
- [x] Review application, cron and operational-table access controls.
- [x] Review private storage permissions.
- [ ] Test restore procedure.
- [ ] Run all critical scenarios.
- [x] Test duplicate scheduled processing against the hosted project.
- [ ] Test missing amount.
- [ ] Test missing signer.
- [ ] Test conflicting requisites.
- [ ] Test unsupported attachment.
- [ ] Test AI failure.
- [ ] Test send failure.
- [x] Prepare operator instructions.
- [ ] Train the initial user.
- [ ] Start pilot.
- [ ] Record pilot defects separately from feature requests.

## Acceptance gate

The full real-mailbox workflow completes successfully, critical errors are visible, backups exist, and the customer can operate the system with manual approval.

---

# Post-MVP backlog

## Authorized post-MVP sprint — Autonomous application processing

Acceptance requires a database-claimed one-click pipeline, source-backed
deterministic acceptance, canonical conflict comparison, compact Russian review,
conditional clarification and unchanged human approval/delivery gates.

Implementation and hosted data acceptance passed for `REQ-2026-000273` on
2026-07-24. Vercel verification of the committed UI remains the final deployment
step.

Do not implement these until the MVP acceptance gate passes:

- automatic sending for low-risk standard cases;
- 1C;
- SBIS;
- electronic signature;
- existing archive import;
- additional template packs;
- complex approval chains;
- advanced OCR;
- clause comparison;
- legal risk scoring;
- multi-tenant SaaS;
- customer portal;
- subscription billing;
- advanced analytics;
- mobile app.

---

# Authorized post-MVP sprint — Presentation readiness

## Objective

Prepare the deployed MVP for a customer presentation without adding new
business workflow scope.

## Acceptance gate

- Template uploads expose safe actionable failures and leave no orphan objects.
- Three controlled DOCX templates exist with customer legal approval pending.
- Explicitly marked synthetic production data is removed through a reviewed
  manifest while profiles and infrastructure are preserved.
- Russian internal UI, dashboard, pagination, loading and empty states pass.
- Hobby manual mailbox mode is healthy and remains protected.
- Lint, typecheck, unit, hosted integration, build, audit and production smoke
  pass after deployment.

Current status: implementation and non-destructive migration complete.
Destructive cleanup, template upload and final production acceptance remain
pending explicit confirmation.

Production defect follow-up: the Phase 7 database keeps `version` as the
canonical delivery-draft column. A repository query incorrectly ordered by its
DTO alias `draft_version`; the fix orders by `version`, preserves the alias at
the application boundary, isolates delivery failures to that section, and adds
a service-only hosted schema contract to detect future required-column drift.

Production defect follow-up (contract generation, 2026-07-24): a specialist
saw the fully generic "Не удалось подготовить договор" message instead of a
specific reason. Root cause was two-fold: `begin_contract_generation`'s
defense-in-depth staleness re-check raised a bare, unprefixed Postgres
exception that bypassed `safeGenerationErrorMessage`'s `GENERATION_BLOCKED:`
routing entirely, and `checkContractEligibility`'s own staleness check never
considered `extracted_fields.updated_at`, so it could report `ready=true`
right up until the DB claim disagreed. Fixed by prefixing known claim-RPC
codes before rethrow, aligning eligibility's staleness definition with the
RPC's, and fixing `safeGenerationErrorMessage`'s comma-split parsing of the
compound `REQUIRED_RENDER_VALUE_MISSING:<field1>,<field2>` reason. Also moved
required-render-value checking into `checkContractEligibility` itself
(previously only `generateContract` checked it, after already claiming a
run), added a template-approval guard rejecting `required_fields` the
completeness rule set can't explain, and added an explicit
`LEGALLY_OPTIONAL_PLACEHOLDERS` allowlist so an admin's oversight in
`required_fields` can no longer ship a contract with a silently blank clause.
A separate, independent fix in the same session added feminine Russian name
declension — unrelated to this incident, kept and fully test-covered.

Production defect follow-up (COMPLETENESS_STALE loop, 2026-07-24): the
immediately preceding fix's own extracted_fields.updated_at check (added as a
defense-in-depth mirror of the DB's staleness re-check) turned out to have
the same flaw it was trying to close, just one layer in: it compared
wall-clock recency instead of asking whether extractable input actually
changed. A field re-touched without its value changing (a derived-field
sync, a specialist re-confirming an already-correct value) bumps
`updated_at` forever while `recalculateCompleteness` correctly keeps reusing
the same completeness run (same content fingerprint) — so the wall-clock
check could never again see completeness as "fresh," and generation stayed
permanently blocked despite every reprocess being a legitimate, correct cache
hit. Fixed by replacing both of `loadGenerationSource`'s wall-clock
staleness checks with one fingerprint-based check: does the latest completed
`application_processing_runs` row's `input_fingerprint` match the current
one — the same question `claim_application_processing()` already answers
correctly. The DB-level counterpart (`begin_contract_generation` and
`finalize_contract_generation`'s own wall-clock re-checks) had the identical
redundancy against a fingerprint match already computed a few lines above
each — migration `202607240008_fix_generation_stale_check.sql` removes both,
since removing only the TS side would have left `checkContractEligibility`
reporting ready while the actual claim/finalize still failed. Verified
against the real application: `checkContractEligibility` now reports
`ready=true` and `generateContract` gets past the claim stage for the first
time, reaching a completely separate, pre-existing, and correct block
(`TEST_REQUISITES_PRESENT` — this specific demo application's own data
contains an obviously-fake bank name, and the existing mock-content guard
correctly refuses to render it into a real contract; not a bug, not part of
either incident here).
