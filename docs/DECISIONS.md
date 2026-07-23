# Architecture Decision Log

Record only decisions that materially affect implementation.

## ADR-001 — Modular monolith

Status: Accepted

Decision:
Use one deployable application with clear internal modules.

Reason:
The MVP is small, must ship quickly, and does not need microservice operational complexity.

## ADR-002 — Human approval before contract sending

Status: Accepted

Decision:
Every generated contract requires explicit specialist approval before delivery.

Reason:
The system handles legally significant documents and AI extraction may be wrong.

## ADR-003 — Approved templates only

Status: Accepted

Decision:
Contracts are generated only from customer-approved DOCX templates with explicit variables.

Reason:
The AI must not independently draft or alter legal clauses in MVP.

## ADR-004 — Functional interface over visual design

Status: Accepted

Decision:
Build a plain internal interface and defer visual polish.

Reason:
The commercial objective is a working pilot, not a design showcase.

## ADR-005 — Next.js application foundation

Status: Accepted

Decision:
Use Next.js 16.2.11 with React 19.2.8, App Router, and TypeScript 6.0.3 in strict
mode. Node.js 24 is used in CI, with Node.js 20.9 as the minimum supported
runtime.

Reason:
This provides one deployable modular-monolith foundation with server routes and
server-rendered authenticated pages. TypeScript 6.0.3 is the newest version
supported by the TypeScript ESLint parser bundled with Next.js 16.2.11;
TypeScript 7.0.2 currently has an incompatible peer range.

## ADR-006 — Supabase platform services

Status: Accepted

Decision:
Use Supabase PostgreSQL, Auth, and Storage. Use `@supabase/supabase-js` 2.110.8
and `@supabase/ssr` 0.12.3. Keep service-role credentials server-only. Disable
public and anonymous sign-up; administrators provision users.

Reason:
The required data, identity, and object-storage services are available from one
managed platform. Server-side user validation creates a clear authentication
boundary without exposing privileged keys.

## ADR-007 — Validation toolchain

Status: Accepted

Decision:
Use ESLint 9.39.5 with the Next.js configuration, Vitest 4.1.10 for unit tests,
and GitHub Actions on Node.js 24 for lint, type checking, tests, and production
build.

Reason:
The same deterministic commands run locally and in CI. The lock file includes
security overrides for PostCSS 8.5.22 and Sharp 0.35.0 because the versions
transitively selected by Next.js had published advisories.

## ADR-008 — Phase 1 PostgreSQL schema and RLS

Status: Accepted

Decision:
Use one Supabase migration for the Phase 1 relational foundation. Enforce
documented statuses with PostgreSQL enums, incomplete future data with nullable
columns, and data integrity with foreign keys and check constraints. Require an
active `profiles` row for operational reads and writes. Grant specialists only
the table columns used by Phase 1; reserve deletion and profile administration
for administrators.

Reason:
Database constraints and RLS remain effective even if a UI or Server Action is
bypassed. Column-level grants prevent Phase 1 clients from changing immutable
provenance fields or writing future-phase entities.

## ADR-009 — Atomic history, audit, and application numbering

Status: Accepted

Decision:
Generate application numbers from a PostgreSQL sequence with a unique
constraint. Record application creation, updates, status changes, assignments,
counterparty changes, and template metadata changes with database triggers.
Status history and audit writes occur in the same transaction as the mutation.

Reason:
Counting rows is collision-prone. Database triggers guarantee that supported
write paths cannot accidentally omit required history or audit events.

## ADR-010 — Focused repositories and Zod validation

Status: Accepted

Decision:
Keep Supabase queries in focused server-only repositories for applications,
counterparties, and template metadata. Validate form input with Zod 4.4.3 before
repository calls.

Reason:
This keeps UI components free of query and business logic while avoiding a
premature universal repository framework.

## ADR-011 — Mail.ru through standard IMAP/SMTP polling

Status: Accepted

Decision:
Use a provider-neutral `EmailProvider` boundary with Mail.ru as the first
implementation. Use ImapFlow 1.4.9 for read-only IMAP access, MailParser 3.9.14
for MIME parsing, and Nodemailer 9.0.3 for SMTP connection verification. Run
explicit polling iterations through CLI or an admin-only Server Action; do not
depend on a permanent IMAP IDLE connection.

Email identity is mailbox-scoped using provider, mailbox identifier,
UIDVALIDITY, and UID. RFC Message-ID is an additional idempotency key when
present. A server-only Supabase client performs atomic application/email
ingestion through a restricted PostgreSQL function. Ordinary UI access
continues to use authenticated sessions and RLS.

Reason:
Polling works locally and can later be scheduled by the selected deployment
platform without committing to premature background-job infrastructure.
Mailbox-scoped identity survives missing Message-ID values and UIDVALIDITY
changes. The provider boundary keeps business logic independent from ImapFlow.

## ADR-012 — Versioned parser registry and durable parse attempts

Status: Accepted

Decision:
Use a `DocumentParser` interface and registry with Mammoth 1.12.0 for DOCX,
PDF.js 4.10.38 for text PDFs, ExcelJS 4.4.0 for XLSX, and CSV Parse 7.0.1.
Use Cheerio 1.0.0 only to traverse Mammoth's generated logical HTML and Yauzl
3.4.0 to inspect Office ZIP metadata before extraction. PDF.js 4.10.38 is
selected instead of 6.1.200 because the current release requires Node.js
22.13+, while the project still supports Node.js 20.9+. Override ExcelJS's
transitive UUID with 11.1.1 to remove the published buffer-bounds advisory.

Keep the detailed queue status on `attachments`, the current result in one
`parsed_documents` row per attachment, and every processing attempt in immutable
`document_parse_attempts`. Claim and finalize through service-role-only
PostgreSQL functions; user-facing retries are admin-only.

Reason:
The registry keeps workflow code independent from replaceable file libraries.
Signature and archive checks run before complex parsing. A current-result row
makes the UI simple, while immutable attempts preserve failure and retry
evidence. Database claims and finalization prevent concurrent duplicate parsing
and partial state.

## ADR-013 — OCR remains an optional provider stage

Status: Accepted

Decision:
Define `OcrProvider`, `OcrResult`, per-page OCR data, and provider-independent
quality metrics without installing an OCR engine in Phase 3. Keep image and
scanned-PDF parser outcomes as `review_required / OCR_REQUIRED`. A future OCR
coordinator will consume only those outcomes and use the existing parse
finalization path.

Prefer an isolated, resource-limited Linux container/worker with Tesseract
`rus+eng` and OCRmyPDF over a native production Windows installation. Do not
send source documents to OpenAI Vision or another LLM for OCR.

Reason:
OCRmyPDF/Tesseract brings Python and native PDF/image dependencies and processes
untrusted complex files. Deferring the engine keeps Phase 3 reproducible while
the provider contract prevents future OCR from coupling the working DOCX, PDF,
XLSX, TXT, and CSV parsers to one executable or deployment platform.

## ADR-014 — Versioned OpenAI Structured Outputs extraction

Status: Accepted

Decision:
Use the official OpenAI JavaScript SDK 6.49.0 and Responses API with the exact
`gpt-5.6-sol` model identifier, `contract-extraction-v1` prompt, and
`contract-extraction-schema-v1` Zod schema. Generate strict JSON Schema through
the SDK helper, then apply an independent local Zod parse plus deterministic
source, identifier, date, amount, and currency validation.

Send only bounded normalized text fragments with Phase 3 markers. Never send
binary files, images, OCR_REQUIRED attachments, full application archives,
credentials, or external lookup results. Persist version/usage metadata and
safe errors, not full prompts or model outputs.

Use PostgreSQL advisory locking and versioned input fingerprints for concurrent
idempotency and token cache. Preserve manual corrections in current fields and
append immutable correction history. Legal-value conflicts always require
manual selection.

Reason:
Strict structured output provides a stable transport shape, while local
validation and source enforcement defend against hallucination, malformed
identifiers, and document prompt injection. The provider boundary and persisted
versions keep future model changes measurable and reviewable.

## Pending decisions

Do not resolve without evidence or user input:

- DOCX generation library;
- PDF conversion strategy;
- deployment target;
- background job mechanism.
