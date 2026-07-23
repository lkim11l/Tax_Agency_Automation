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

- [ ] Build contract registry.
- [ ] Add date filters.
- [ ] Add status filters.
- [ ] Add counterparty filter.
- [ ] Add amount totals.
- [ ] Add links to application, contract, and correspondence.
- [ ] Export XLSX.
- [ ] Add monthly summary metrics.
- [ ] List waiting-for-client applications.
- [ ] List under-review applications.
- [ ] List completed and incomplete applications.
- [ ] Add report tests.

## Acceptance gate

The user can export a selected period and totals match persisted application and contract data.

---

# Phase 9 — Pilot hardening

## Objective

Run the product with real test traffic while keeping human control.

## Tasks

- [ ] Prepare production environment.
- [ ] Configure backups.
- [ ] Configure error monitoring.
- [ ] Review access controls.
- [ ] Review storage permissions.
- [ ] Test restore procedure.
- [ ] Run all critical scenarios.
- [ ] Test duplicate email.
- [ ] Test missing amount.
- [ ] Test missing signer.
- [ ] Test conflicting requisites.
- [ ] Test unsupported attachment.
- [ ] Test AI failure.
- [ ] Test send failure.
- [ ] Prepare operator instructions.
- [ ] Train the initial user.
- [ ] Start pilot.
- [ ] Record pilot defects separately from feature requests.

## Acceptance gate

The full real-mailbox workflow completes successfully, critical errors are visible, backups exist, and the customer can operate the system with manual approval.

---

# Post-MVP backlog

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
