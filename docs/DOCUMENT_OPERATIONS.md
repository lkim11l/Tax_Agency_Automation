# Document Parsing Operations

## Batch processing

Process up to 100 pending attachments:

```bash
npm run documents:parse-pending
```

The JSON output contains only the number of processed records and terminal
status counts.

## One attachment

Use the attachment UUID shown in the application UI or an authenticated query:

```bash
npm run documents:parse -- --attachment-id=<uuid>
```

The attachment must be `pending`. An administrator can use **Parse** or
**Retry parse** on the application detail page. **Parse all pending** runs the
same worker over the queue.

## Retry and recovery

1. Review the stable error code and safe message.
2. Fix the source, access, or configuration problem.
3. As an administrator, choose **Retry parse**.
4. Confirm a new completed row appears in `document_parse_attempts`.

Do not edit current results, attempts, checksums, or Storage objects manually.
Never run a remote database reset. A corrected customer file must be ingested
as a new attachment with its own checksum.

`review_required` means the file is visible and safe but needs a person.
`unsupported` is a safe format outside Phase 3. `blocked` is an active-content,
spoofing, archive, or limit violation. `failed` is an operational or
corrupt-document failure.

There is no OCR command in Phase 3. `OCR_REQUIRED` is an operator-visible review
state, not evidence that OCR ran. Future OCR installation and worker operations
must be documented and accepted separately.

## Synthetic fixtures and live acceptance

```bash
npm run documents:fixtures
```

Files are written under ignored `tmp/phase3-live-fixtures`. Send them as one
new message to the configured Mail.ru INBOX with subject
`TAA-PHASE3-LIVE-20260723-001`, then run:

```bash
npm run test:documents:live
```

The live command scans read-only for that exact subject, ingests the selected
message idempotently, parses all five attachments, and verifies DOCX/PDF/XLSX
text, source markers, image OCR review, unsupported fallback, private Storage,
attempt history, and audit. It does not delete the acceptance application.

Phase 3 live acceptance completed on 2026-07-23 with all five generated
fixtures. Re-running the command confirmed ingestion and parse idempotency and
fresh-client persistence.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:documents:live
npm run build
npm audit
```

Hosted RLS assertions use anonymous, active specialist, inactive specialist,
and administrator sessions with the public key. The server secret is used only
for fixture setup and the worker path, never to assert user RLS behavior.
