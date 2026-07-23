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
