# Structured AI Extraction

## Scope

Phase 4 extracts contract, organization, and signer facts from normalized text.
It does not decide template completeness, draft clarification email, generate a
contract, send mail, perform OCR, use Vision, or make legal conclusions.

## Server-only OpenAI boundary

`OPENAI_API_KEY` is read only in `openai-provider.server.ts`. The OpenAI SDK is
reachable only from server actions and trusted CLI scripts. The key is not
returned to client components, logged, included in errors, persisted, or
committed. `.env.local` remains ignored.

The accepted versions are:

- provider: `openai`;
- SDK: `6.49.0`;
- Responses API model: `gpt-5.6-sol`;
- prompt: `contract-extraction-v1`;
- schema: `contract-extraction-schema-v1`;
- normalized text: `phase3-normalized-text-v1`.

## Pipeline

1. Load plain email bodies, current application/counterparty cards, and only
   `status=parsed` documents.
2. Exclude images, binary files, unsupported files, and OCR_REQUIRED results.
3. Find local INN, KPP, OGRN, BIK, account, email, phone, date, amount, and
   currency candidates.
4. Validate checksums/formats and normalize safe separators.
5. Select marker-aware blocks around candidates and contract keywords, dedupe,
   cap fragments, and chunk by source.
6. Send untrusted text blocks through strict Structured Outputs.
7. Validate the response again with Zod.
8. Reject source-less values and locally invalid identifiers/dates/amounts/
   currencies.
9. Merge equal candidates, persist real conflicts, and never silently resolve
   legally significant disagreements.
10. Atomically persist current fields, run metadata, conflicts, and audit.

The input cap is 120,000 relevant characters, with 6,000 characters per
fragment and 30,000-character request chunks. The whole archive is never sent.

## Schema and null behavior

Every field stores value, normalized value, raw value, source type/ID/marker,
short excerpt, confidence, review flag, and reason. Missing values use explicit
`null`; empty strings are schema-invalid. A non-null value without a valid
source remains review-required. A checksum-invalid identifier becomes a null
confirmed value with `INVALID_FORMAT` review evidence.

## Confidence and conflicts

Confidence combines direct source presence, labels, validated deterministic
matches, parser provenance, conflicts, and model confidence as only a minor
signal. Conflicts reduce confidence and always set `requires_review`.

Conflicts compare email, parsed DOCX/PDF/XLSX/TXT/CSV, current application and
counterparty cards, and manual corrections. Manual corrections take precedence
over every later automatic run.

## Cache

The SHA-256 fingerprint covers application/source IDs and checksums, normalized
text version, prompt version, schema version, and exact model identifier.
Unchanged successful runs return a cache hit without an API call. Force runs are
explicit and audited. PostgreSQL advisory locking and an active-run unique index
prevent concurrent duplicate processing.
