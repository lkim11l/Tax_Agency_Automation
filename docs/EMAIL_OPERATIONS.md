# Email Operations

## Connection check

```bash
npm run email:check
```

This verifies IMAP and SMTP TLS/auth without sending a message or changing
mailbox flags. Errors are converted to operator-safe categories.

## Synchronization

Run one iteration:

```bash
npm run email:sync
```

An administrator can perform the same operation from `/email` with
**Synchronize email**. The page shows connection state, last attempt and
success, last UID, counts, errors, unlinked replies, and failed messages.

Only administrators can synchronize, reprocess, or manually link a message.
Active specialists can read correspondence and attachments allowed by RLS.

## Recovery

Fix the underlying Mail.ru, Storage, or database problem first. Failed messages
remain visible and retain their mailbox UID. Use **Reprocess** to fetch that UID
again. Idempotency constraints prevent a second message, application,
attachment, or repeated audit event. Partial attachment uploads are removed and
the email remains failed until all required operations complete.

For an unmatched reply, copy the target application's UUID into the unlinked
queue and choose **Link**. This operation is audited.

## Live acceptance

First run:

```bash
npm run test:email:live
```

The command checks real IMAP/SMTP and scans read-only for subjects containing
`TAA-PHASE2-LIVE-` (including normal `Re:` replies). It never processes
unrelated email.

From a different test address, send:

1. Subject `TAA-PHASE2-LIVE-<unique-id> ROOT`, a plain-text body, and one small
   `.txt` or `.pdf` attachment.
2. A separate new message with the same subject but no reply headers.
3. A real reply to message 1, preserving In-Reply-To/References.

Then run the live command and one controlled `npm run email:sync`. Verify the
root and non-reply created separate applications, the reply shares the root
application, a repeat sync creates no duplicates, the attachment requires an
active authenticated user, and data persists after restarting the application.
Never delete or alter mailbox messages during acceptance.

The initial Phase 2 acceptance completed on 2026-07-22. The command found the
three prescribed messages, verified two applications and an exact reply link,
confirmed private attachment access and repeated-ingestion idempotency, and
confirmed that an invalid derived password is reported without exposing the
real credential.

## Future scheduling

The sync operation is deliberately a single idempotent iteration. Once the
deployment target is selected, its scheduler may invoke the same server
operation. No permanent IDLE connection or speculative job infrastructure is
required.
