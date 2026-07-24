# Reporting

The monthly report is a deterministic database snapshot. It contains counts for
new/processed applications, completed/sent contracts, waiting/manual-review
work, rejected versions, clarification activity, average processing time,
currency-separated amounts, template types, and specialist workload.

The XLSX schema version is `contract-report-v1` and has exactly two worksheets:

- `Contracts`: stable registry columns, one row per selected registry entry;
- `Summary`: period, generator, timestamp, fingerprint, totals, and metrics.

Dates are native Excel dates, amounts are numeric, currency is separate, and
INN/bank accounts are text. Formula-leading text is prefixed to prevent
spreadsheet formula injection. Email bodies, credentials, prompts, model output,
and DOCX contents are excluded.

Each export persists period, safe filter summary, schema/data fingerprint,
actor, row count, SHA-256, private path, filename, status, and safe error. The
cache key includes actor, report type, filters, schema, and data fingerprint.
Only administrators may force regeneration, and a reason is mandatory.
