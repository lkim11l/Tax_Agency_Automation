# Contract templates

## Supported MVP types

Phase 6 supports at most three template types: `services`, `consulting`, and
`supply`. The hosted acceptance uses only a synthetic services template. It is
not legal advice or a customer-approved production form.

## Preparing a DOCX

Use an ordinary macro-free `.docx`. Keep approved legal text, styles, tables,
numbering, page breaks, headers, footers, signatures, and branding in Word.
Insert variables using only `{{placeholder_name}}`. Expressions, conditions,
loops, scripts, DOCM, and macros are unsupported.

The `contract-placeholders-v1` schema contains:

```text
application_number, contract_number, contract_date,
client_legal_name, client_short_name, client_inn, client_kpp, client_ogrn,
client_legal_address, client_actual_address, client_bank_name,
client_bank_account, client_correspondent_account, client_bik,
signer_name, signer_position, signer_authority, contract_subject,
contract_amount, contract_amount_words, currency,
performance_start_date, performance_end_date, performance_period_text,
payment_terms, additional_conditions
```

Placeholders may appear in paragraphs, table cells, headers, footers, one Word
run, or multiple adjacent Word runs. Avoid text boxes, drawings, comments,
footnotes, and other unsupported XML containers.

## Upload, validation, and approval

An administrator uploads a file at `/templates` with a stable code, new version,
type, completeness rule set, and required placeholders. The server validates
MIME/signature, ZIP limits, paths, macros, XML entities, placeholders, and
structure; calculates SHA-256; stores a private immutable object; and records a
validation report and audit.

Blocking errors prevent approval. Approval records the administrator and time
and activates that exact row. Editing an approved binary is unsupported: upload
a new version. Deactivation/archive never changes old contract versions.

## Replacing the synthetic template

Internally approve the real customer DOCX outside the application, upload it
under the intended type/code with a new version, inspect validation, generate a
synthetic contract, compare it with the source in Word, and only then approve
the template. Never commit customer documents or use them as fixtures.
