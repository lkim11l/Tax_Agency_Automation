# Contract registry

Phase 8 exposes `/registry` as a read-only operational projection of
applications, counterparties, contracts, current immutable versions, templates,
completeness, conflicts, correspondence counts, approval, and delivery state.
It does not load DOCX bytes.

All filters, ordering, pagination, scope, and totals execute on the server.
Administrators see all rows. An active specialist sees a row only when the
application is assigned to or was created by that specialist. The browser
receives one page only.

Supported filters are period, application/contract number, counterparty, INN,
application/contract status, specialist, template type, currency, conflicts,
and sent state. Sorting supports received date, amount, contract number,
counterparty, and application status. Totals preserve currencies separately.

Links lead to the application, counterparty, contract section, correspondence
section, and current private version download.

Phase 9 deployment, scheduling, onboarding, and advanced analytics are outside
this module.
