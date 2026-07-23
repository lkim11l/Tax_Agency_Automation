# Contract delivery operations

## Normal operation

1. Open the application and download the exact `awaiting_review` DOCX.
2. Inspect it outside the application.
3. Approve, reject, or return it with an appropriate comment.
4. For an approved version, create a delivery draft.
5. Confirm recipient, subject, body, filename, and checksum.
6. Use the explicit Mail.ru send action once.
7. Confirm `sent`, provider Message-ID, `contract_sent`, and `delivered`.

Never retry a draft in `reconciliation_required`. Reconcile the recipient/provider
mailbox by the stable RFC Message-ID first. Only a `send_failed` attempt that the
system classified as pre-delivery is eligible for explicit retry.

## Live acceptance

Run:

```bash
npm run test:contract-delivery:live
```

The script uses the approved synthetic Phase 6 template/application only. It
tests unapproved blocking, real rejection, force regeneration, checksum-bound
approval, draft versioning, real SMTP attachment delivery, outgoing persistence,
status history, audit, and duplicate-send cache behavior.

External receipt verification is mandatory. When the command returns a pending
instruction, forward the received DOCX unchanged to the configured Mail.ru INBOX
using the exact subject printed by the command, then rerun it. The second run
parses the received MIME attachment and independently compares SHA-256 and DOCX
signature. Do not mark Phase 7 complete if this step has not passed.

## Safe diagnosis

- `CONTRACT_ATTACHMENT_CHECKSUM_MISMATCH`: do not send; inspect Storage/version
  provenance.
- `CONTRACT_ATTACHMENT_SIGNATURE_INVALID`: do not send; regenerate from an
  approved template.
- `SMTP_SEND_FAILED`: a known pre-delivery failure; correct configuration and
  let an operator retry.
- `SMTP_DELIVERY_UNKNOWN`: reconcile by Message-ID; never blind-retry.

Logs and audit metadata may contain IDs, checksum, recipient domain, safe error
code, and Message-ID. They must not contain SMTP credentials, full document
content, bank details, or the delivery body.
