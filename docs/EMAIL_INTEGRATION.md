# Mail.ru Email Integration

## Scope

Phase 2 receives one configured Mail.ru INBOX through standard IMAP, creates or
links applications, and stores supported attachments privately. SMTP is
verified but is not used to send mail in this phase. Spam, Trash, Drafts, Sent,
AI, OCR, document parsing, clarifications, and contract delivery are excluded.

## Mail.ru setup

Enable access for external email applications in Mail.ru and create an
external-application password. Store it only in ignored `.env.local`; the normal
mailbox password should not be placed in source control.

Canonical server-only variables:

```text
EMAIL_PROVIDER=mailru
EMAIL_FROM=
EMAIL_IMAP_HOST=imap.mail.ru
EMAIL_IMAP_PORT=993
EMAIL_IMAP_SECURE=true
EMAIL_IMAP_FOLDER=INBOX
EMAIL_IMAP_USERNAME=
EMAIL_IMAP_PASSWORD=
EMAIL_SMTP_HOST=smtp.mail.ru
EMAIL_SMTP_PORT=465
EMAIL_SMTP_SECURE=true
EMAIL_SMTP_USERNAME=
EMAIL_SMTP_PASSWORD=
SUPABASE_SECRET_KEY=
```

`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USERNAME`, `EMAIL_PASSWORD`, and
`SUPABASE_SERVICE_ROLE_KEY` are temporary compatibility aliases. New
environments should use the canonical names.

## Processing model

`npm run email:sync` performs one polling iteration. It opens only the
configured folder read-only, compares UIDVALIDITY, fetches UIDs after the saved
cursor, parses MIME, and closes the connection. It can later be invoked by cron
after a deployment target is selected.

Application and email creation occur in one restricted database transaction.
Provider/mailbox/UIDVALIDITY/UID and RFC Message-ID prevent duplicates,
including concurrent syncs. Exact In-Reply-To and References values link replies.
An unmatched reply remains unlinked for operator review.

## Attachments

Attachments are limited to 10 MiB. Executable extensions and active-content
media types are blocked during ingestion. Other files are retained privately so
Phase 3 can validate content signatures and keep safe unsupported formats
visible instead of silently losing them. Filenames are sanitized, SHA-256 is
stored, and checksum-prefixed object paths prevent filename collisions. Objects
live in the private `email-attachments` bucket. Active authenticated users
receive 60-second signed download URLs; anonymous access is denied.

HTML email is retained for possible future sanitized rendering but Phase 2
shows only plain text and never loads remote tracking images.

## Security

The worker's Supabase secret is used only by server code with session
persistence and token refresh disabled. Client Components never import it.
Normal pages use authenticated user sessions and RLS. Logs and audit metadata
exclude passwords, keys, message bodies, and attachment contents.
