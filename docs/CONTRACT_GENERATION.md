# Contract generation

## Eligibility

Generation is blocked unless the application and latest completeness run exist,
the run is ready and non-blocking, its rule set matches the approved active
template, its extraction fingerprint is current, no blocking
conflict/review-required result remains, and no source is newer than the run.
Required rendered values are previewed before a number is allocated.

The UI result is informational. PostgreSQL rechecks critical state at claim and
finalization. A source change during rendering makes finalization fail and the
uploaded object is removed.

## Mapping and rendering

`contract-mapping-v1` maps normalized domain values to
`contract-placeholders-v1`. It does not invent short names, addresses, payment
terms, conditions, identifiers, or signer authority. Dates use Russian text;
amounts use two decimals; RUB words use deterministic ruble/kopeck grammar.
Unsupported currency blocks generation.

The renderer replaces only allow-listed `w:t` text. It supports paragraphs,
tables, headers, footers, and split Word runs. Unrelated OOXML entries remain
unchanged. Output is reopened as a bounded ZIP, checked for unresolved
placeholders, and checksummed.

## Numbering, persistence, and idempotency

PostgreSQL allocates unique `TAA-YYYY-NNNNNN` numbers under an application
advisory lock. Input cannot choose a number. Successful contracts retain their
number across versions.

The idempotency key includes application, template ID/version, source
fingerprint, completeness run, mapping version, and placeholder schema version.
An identical completed request returns the existing version. An in-progress
duplicate is safely rejected and can be retried. Admin force regeneration
requires a reason and appends a version without overwriting prior objects.

Every version stores template/source versions, safe rendered values, private
path, SHA-256, byte size, generator, and `awaiting_review`. Database triggers
reject version update/delete. Phase 6 does not approve or send contracts.
