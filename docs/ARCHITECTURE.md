# MVP Architecture

## Architecture principle

Use a modular monolith. Do not create microservices for MVP.

The application may run as one deployable web service plus PostgreSQL and object storage. Background processing can be introduced only where email ingestion or document parsing requires it.

## Suggested modules

```text
src/
  app/ or routes/
  modules/
    applications/
    counterparties/
    email/
    attachments/
    extraction/
    completeness/
    templates/
    contracts/
    approvals/
    reports/
    audit/
  lib/
    db/
    auth/
    storage/
    ai/
    validation/
```

## Module responsibilities

### Applications
Owns application lifecycle, statuses, ownership, and orchestration.

### Email
Owns mailbox provider integration, ingestion, replies, sending, provider IDs, and idempotency.

### Attachments
Owns file validation, storage, metadata, parsing status, and secure access.

### Extraction
Owns normalized AI schemas, prompts, extraction versions, source references, and review flags.

### Completeness
Owns required-field rules and missing/conflicting-field calculation.

### Templates
Owns approved DOCX templates, variables, required fields, and template versioning.

### Contracts
Owns generation, immutable versions, downloads, and the approved/sent version relationship.

### Approvals
Owns approval, revision, approver identity, and sending gates.

### Reports
Owns registry queries, period metrics, totals, and XLSX export.

### Audit
Owns append-only important activity records.

## Minimum entities

- User
- Application
- Counterparty
- EmailMessage
- Attachment
- ExtractedField
- ContractTemplate
- Contract
- ContractVersion
- StatusHistory
- AuditEvent

## Recommended application flow

```text
Email ingestion
  -> create/find application
  -> save message and attachments
  -> parse attachments
  -> extract fields
  -> completeness check
  -> clarification loop if incomplete
  -> template selection
  -> generate contract version
  -> specialist review
  -> approval
  -> send approved version
  -> registry/reporting
```

## Reliability requirements

- Use database transactions for state transitions that must remain consistent.
- Use idempotency keys for inbound and outbound email operations.
- Store processing states and errors.
- Make retries safe.
- Do not hide partial failures.
- Preserve immutable contract versions.
- Keep provider message IDs.
- Use structured logs without secrets.

## Phase 1 data access

- Server Components and Server Actions call focused repositories under
  `src/modules/*/repository.ts`.
- Repositories use the signed-in Supabase SSR client and require an active
  `profiles` row before operational access.
- Browser code never receives the service-role key.
- PostgreSQL RLS is the final authorization boundary.
- Application status history and audit records are created by database triggers
  in the same transaction as the application mutation.
- Application numbers use a PostgreSQL sequence and a unique constraint; row
  counts are never used.
- `status_history` and `audit_events` are append-only for authenticated users.
- `contract_versions` rejects update and delete operations at the database level.

## Deployment

Keep deployment simple:
- one web application;
- managed PostgreSQL;
- managed object storage;
- one selected email provider;
- one AI provider.

Record the actual choices in `docs/DECISIONS.md`.

## Phase 2 email ingestion

The email module depends on the `EmailProvider` interface rather than directly
on ImapFlow. The Mail.ru adapter opens the configured INBOX read-only, supplies
UID/UIDVALIDITY and raw MIME to the parser, and always closes the connection.
SMTP is limited to TLS/auth verification in this phase.

One polling iteration is:

```text
Mail.ru INBOX
  -> provider fetch
  -> MIME parsing and safe metadata normalization
  -> mailbox-scoped idempotency lock
  -> atomic application/email RPC
  -> private attachment upload and metadata
  -> completed/failed state and append-only audit
  -> mailbox cursor update
```

The `mailbox_sync_state` cursor is reset to UID 0 when UIDVALIDITY changes.
Messages with reply headers are linked only through exact normalized
In-Reply-To/References matches. Unmatched replies remain visible for manual
admin linkage. Received HTML is stored for future sanitized use but never
rendered raw. Attachment downloads use authenticated RLS and 60-second signed
URLs.

## Phase 3 document parsing

The `documents` module owns validation, parser selection, normalization,
orchestration, and result access. Third-party libraries are isolated behind the
`DocumentParser` interface.

```text
private attachment
  -> service-role atomic claim (FOR UPDATE SKIP LOCKED)
  -> signature/archive validation
  -> DocumentParser registry
  -> deterministic normalization
  -> service-role atomic finalize
  -> current result + immutable attempt + audit
```

`attachments` is the queue and stores the operator-facing status. One
`parsed_documents` row is the current result. `document_parse_attempts` retains
each completed attempt. Active users have read-only RLS; administrators request
work through a restricted RPC; browser code never receives the server secret.
Page and sheet markers preserve traceability for future Phase 4 extraction.

OCR is an optional stage after a parser returns `review_required /
OCR_REQUIRED`, not a document parser implementation. `OcrProvider` receives
already validated image/PDF bytes and returns `OcrResult` with page data and
quality metrics. No provider is configured in Phase 3. This seam supports a
future isolated local process or private Linux worker without changing
`DocumentParser`, parser registry, or persisted workflow states.

## Phase 4 structured extraction

The extraction module remains inside the modular monolith. OpenAI is called only
from server actions or trusted CLI processes; browser code never imports the SDK
or receives the API/server key.

```text
email plain text + status=parsed document text + current cards
  -> deterministic candidates and validators
  -> bounded source-marker-aware fragments
  -> chunked Responses API Structured Outputs
  -> local Zod validation and source/format rejection
  -> deterministic merge and conflict detection
  -> service-role atomic persistence
  -> authenticated RLS read and correction RPC
```

`extraction_runs` records fingerprints, versions, request IDs, usage, duration,
status, and safe errors without prompt/document/model-output bodies.
`extracted_fields` is the current view. `extraction_conflicts` records unresolved
candidates. `extracted_field_corrections` is immutable correction history.
Database advisory locks prevent concurrent duplicate runs, and a successful
fingerprint cache avoids repeated token use. Automatic template completeness is
intentionally outside this module and remains Phase 5.

## Phase 6 versioned contract generation

Templates owns immutable private DOCX objects, validation reports, approval
metadata, and lifecycle. Contracts owns explicit placeholder rendering,
deterministic formatting, eligibility, numbering, claims, immutable versions,
and signed downloads.

```text
current extraction + latest completeness fingerprint
  -> server-side eligibility and required-value preview
  -> advisory-lock generation claim and sequence number
  -> template checksum verification
  -> OOXML text render (document/table/header/footer/split runs)
  -> output validation + checksum + private Storage upload
  -> transactional version finalize + status history + audit
  -> awaiting_review (Phase 7 boundary)
```

`fflate` performs bounded ZIP inspection while unrelated OOXML parts remain
unchanged. Only the fixed `{{name}}` schema is accepted; macros, DOCM,
DOCTYPE/entities, unsafe paths, expressions, and unknown placeholders are
blocked. Mutation RPCs are server-role-only. Active specialists/admins have
read-only RLS and short-lived signed downloads. The database rechecks
readiness, blocking fields, staleness, template approval, and fingerprint state
before finalization. Application advisory locks, unique numbers, one running
claim, and a versioned idempotency key protect concurrent requests.

## Phase 7 contract review and delivery

The delivery module owns human decisions, deterministic cover drafts, exact
attachment verification, SMTP claims, and delivery evidence. It never renders
or mutates contract content.

```text
private immutable contract_version
  -> authenticated short-lived review download + audit
  -> service-side Storage checksum/signature verification
  -> immutable checksum-bound human review
  -> versioned deterministic delivery draft
  -> exact approved file re-download and checksum comparison
  -> transactional service-only send claim
  -> Mail.ru SMTP with DOCX attachment
  -> transactional outgoing email + attachment metadata + statuses + audit
```

PostgreSQL advisory locks and unique attempt/idempotency constraints prevent
concurrent duplicate sends. A known pre-DATA failure can be retried explicitly;
an ambiguous error during/after SMTP DATA moves the draft to
`reconciliation_required`. Review and contract file records are immutable.
Active users receive read-only RLS; server actions alone use the secret client
for review and delivery transitions. Phase 8 registry/reporting does not consume
this module yet.
## Phase 8 registry and reporting boundary

`contract_registry_entries` is a service-only read projection; it does not
broaden the Phase 1 table RLS surface. Server repository code applies the actor
scope before filters and pagination and returns one page to the browser.

Reporting derives metrics from the same scoped snapshot. PostgreSQL functions
claim/finalize/fail immutable export records, while the application builds XLSX
with ExcelJS and uploads it to private Storage. A schema/data fingerprint makes
cache reuse deterministic and actor-specific. Direct authenticated mutations
and orchestration calls are denied. Download authorization is rechecked before
issuing a short-lived signed URL.

Phase 9 concerns—deployment, scheduler, production onboarding, and operational
hardening—are deliberately outside this boundary.

## Autonomous processing and review boundary

`application_processing_runs` owns one fingerprinted execution and its persisted
stage state. The service composes existing parsing, extraction and completeness
modules and reuses the extraction fingerprint cache.

`extracted_field_acceptances` stores immutable source-and-value review events
separately from manual corrections. A service-only PostgreSQL function holds an
advisory lock, verifies value fingerprints and records each batch atomically.
Only canonical equivalence or irrelevant candidates may resolve a conflict.

The Russian compact review defaults to fields requiring attention and opens
correction forms on demand. Processing may manage an unsent clarification draft,
but cannot approve or send mail, approve a contract, or deliver a contract.
