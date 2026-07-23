# Contract operations

## Generate and inspect

1. Confirm extracted values and manually resolve every conflict/review flag.
2. Recalculate completeness with the template's rule set.
3. On `/applications/[id]`, choose an approved active template.
4. Select **Check readiness** and resolve every blocker.
5. Select **Generate DOCX**.
6. Download the `awaiting_review` version and inspect it in Word.

Verify names, identifiers, bank details, signer authority, subject, amount,
dates, terms, all pages/tables, header/footer, signature areas, and formatting.
Human legal/operational review is mandatory.

## Retry and force regeneration

An identical retry returns the existing version. Correct source/template issues
and recalculate completeness before retrying a safe failure. Only an
administrator may force regeneration, with a concrete reason. Force creates a
new immutable version; compare it with the previous version.

## Storage and access

The private `contract-documents` bucket holds templates and outputs. Paths are
server-generated. Active specialists/admins receive a 60-second signed
download; anonymous and inactive users are denied. Downloads are audited. Do
not share signed links as client delivery.

## Synthetic live acceptance

```bash
npm run test:contracts:live
```

The command uses synthetic data and checks a blocked application, approved
synthetic DOCX, concurrent requests, generation, cache hit, force version 2,
checksums, private Storage, specialist download, anonymous denial, and audits.
It writes ignored `tmp/phase6-live-output.docx` for manual inspection.

On Storage/database failure the new orphan is removed and previous versions stay
intact. A concurrent request should be retried after the active run completes.
Phase 7 owns approval, revisions, cover email, and sending.
