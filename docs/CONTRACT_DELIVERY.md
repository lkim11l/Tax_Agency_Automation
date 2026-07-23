# Contract delivery

A delivery draft references one application, contract, approved version, and
approved checksum. Its Russian subject/body is deterministic. Specialists and
administrators may correct the recipient or text; every edit creates a new draft
version and supersedes the prior draft.

Recipient input is normalized, email-validated, limited in length, and rejected
on CR/LF injection. The default is the latest confirmed inbound client sender.
Manual replacement is an explicit authenticated operation and records an audit
event. The agency Mail.ru address is blocked as a production recipient.

Immediately before SMTP, the server:

1. re-reads the approved review and active approved version;
2. downloads the DOCX from private Storage;
3. checks ZIP signature, MIME, filename, file size, version checksum, and
   approval checksum;
4. creates a database delivery claim;
5. passes those exact bytes to the provider-neutral Mail.ru adapter.

The idempotency key contains contract version ID, SHA-256, normalized recipient,
and draft version. A completed identical request returns its persisted result.
Concurrent claims cannot create two active attempts. Known pre-delivery failures
may be retried by an explicit user action. Timeout/disconnect during or after
SMTP DATA becomes `reconciliation_required`; it is neither failed nor sent and
cannot be automatically retried.

After confirmed SMTP acceptance, one transaction persists the outgoing email,
attempt result, attachment metadata, sent time, and Message-ID, then sets version
and contract to `delivered` and application to `contract_sent`. Phase 8 registry
and reporting are explicitly outside this workflow.
