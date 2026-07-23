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

Implementation status: code-complete. This acceptance gate remains pending until
the migration and authenticated workflows are verified against a real local or
hosted Supabase database.

---

# Phase 2 — Email ingestion

## Objective

Convert incoming mailbox messages into applications without duplication or data loss.

## Tasks

- [ ] Confirm one customer email provider.
- [ ] Define an email provider interface.
- [ ] Implement the selected provider.
- [ ] Store provider message and thread IDs.
- [ ] Save sender, recipients, subject, body, and timestamps.
- [ ] Download supported attachments.
- [ ] Store attachments securely.
- [ ] Add idempotency protection.
- [ ] Link replies to an existing application.
- [ ] Add manual reprocessing.
- [ ] Add ingestion error visibility.
- [ ] Add tests with provider fixtures.

## Acceptance gate

A real test email creates exactly one application, attachments are available, and a reply is linked to the same application.

---

# Phase 3 — Document parsing

## Objective

Produce normalized text from supported attachments while preserving source references.

## Tasks

- [ ] Parse DOCX.
- [ ] Parse text-based PDF.
- [ ] Parse XLSX key-value content.
- [ ] Add image OCR as a review-required path.
- [ ] Validate file type and size.
- [ ] Sanitize filenames.
- [ ] Store parse status and errors.
- [ ] Store normalized extracted text.
- [ ] Preserve page, sheet, or document source metadata where possible.
- [ ] Add unsupported-file fallback.
- [ ] Add parser tests.

## Acceptance gate

Supported files produce readable normalized text, and unsupported or failed files remain visible for manual handling.

---

# Phase 4 — Structured AI extraction

## Objective

Extract contract and counterparty data without fabricating missing information.

## Tasks

- [ ] Define Zod or equivalent extraction schema.
- [ ] Create versioned extraction prompt.
- [ ] Extract organization details.
- [ ] Extract signer details.
- [ ] Extract contract subject.
- [ ] Extract amount and currency.
- [ ] Extract dates and payment terms.
- [ ] Store source references.
- [ ] Store confidence/review flags.
- [ ] Return null for missing values.
- [ ] Detect conflicting values.
- [ ] Allow manual correction.
- [ ] Preserve correction history.
- [ ] Add safe evaluation fixtures.
- [ ] Add extraction tests.

## Acceptance gate

Given approved test documents, the system produces schema-valid data, flags missing/conflicting values, and never invents absent required values.

---

# Phase 5 — Completeness and clarification

## Objective

Identify missing fields and run a controlled clarification loop with the client.

## Tasks

- [ ] Define required fields per template.
- [ ] Calculate application completeness.
- [ ] Show missing fields.
- [ ] Show conflicting fields.
- [ ] Generate an editable clarification draft.
- [ ] Require specialist approval before sending.
- [ ] Send from the connected mailbox.
- [ ] Store sent clarification.
- [ ] Link client reply.
- [ ] Re-run extraction on new information.
- [ ] Recalculate completeness.
- [ ] Add send failure handling.
- [ ] Add end-to-end clarification test.

## Acceptance gate

An incomplete application can request missing data, receive a reply, become complete, and retain the full conversation history.

---

# Phase 6 — Contract templates and generation

## Objective

Generate a correct DOCX from an approved template and validated application data.

## Tasks

- [ ] Define template variable convention.
- [ ] Add template upload and metadata.
- [ ] Support up to three templates.
- [ ] Define required fields per template.
- [ ] Implement deterministic template selection or manual selection.
- [ ] Validate all template variables.
- [ ] Generate DOCX.
- [ ] Fail visibly on unresolved required variables.
- [ ] Save immutable generated versions.
- [ ] Add download.
- [ ] Add optional PDF conversion only if stable.
- [ ] Add generation tests for every approved template.

## Acceptance gate

A complete application generates a downloadable contract with no unresolved required placeholders, and the generated version is stored immutably.

---

# Phase 7 — Approval and delivery

## Objective

Ensure only a human-approved contract is sent and preserve evidence of the action.

## Tasks

- [ ] Add contract review screen.
- [ ] Add approve action.
- [ ] Add revision request.
- [ ] Record approver and timestamp.
- [ ] Block sending before approval.
- [ ] Create editable cover email.
- [ ] Attach the exact approved version.
- [ ] Send through the connected provider.
- [ ] Save provider send result.
- [ ] Save sent message and attachment version.
- [ ] Handle send retries safely.
- [ ] Update application status only after confirmed send.
- [ ] Add approval and sending tests.

## Acceptance gate

An unapproved contract cannot be sent. An approved contract is sent once, the exact file is preserved, and the audit log identifies who approved and sent it.

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
