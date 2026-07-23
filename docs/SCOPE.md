# MVP Scope

## Goal

Deliver a working pilot for one customer and one mailbox. The system must process contract requests from email through a controlled human-approved contract delivery flow.

## Included

- one organization;
- one connected mailbox;
- up to three approved contract templates;
- email and attachment ingestion;
- application records;
- parsing of DOCX, text-based PDF, XLSX, and common image formats;
- structured field extraction;
- missing-field detection;
- editable clarification email draft;
- reply linking;
- manual data correction;
- DOCX contract generation;
- optional PDF conversion if reliable;
- mandatory human approval;
- sending the approved version;
- contract registry;
- period report exported to XLSX;
- user authentication;
- audit trail;
- basic error handling;
- simple internal interface.

## Excluded from MVP

- autonomous contract sending;
- autonomous legal conclusions;
- legal clause generation outside approved templates;
- 1C integration;
- SBIS integration;
- electronic signature;
- archive migration;
- multi-tenant SaaS billing;
- customer self-service portal;
- mobile application;
- advanced analytics;
- complex role hierarchy;
- unlimited templates;
- custom workflow builder;
- full OCR guarantee for arbitrary scans;
- production-grade high availability.

## MVP users

### Administrator
- configures mailbox and templates;
- manages users;
- views all applications and logs;
- exports reports.

### Specialist
- reviews extracted data;
- corrects fields;
- approves clarification drafts;
- generates contracts;
- approves and sends contracts;
- updates statuses.

## Core business states

1. `new`
2. `processing`
3. `needs_data_review`
4. `waiting_for_client`
5. `data_complete`
6. `generating_contract`
7. `contract_ready`
8. `under_review`
9. `needs_revision`
10. `approved`
11. `sending`
12. `sent`
13. `completed`
14. `processing_error`
15. `cancelled`

## Required contract fields

The final list is customer-specific. The MVP data model must support at least:

- counterparty legal name;
- INN;
- KPP;
- OGRN;
- legal address;
- bank details;
- signer name;
- signer position;
- signer authority;
- contract subject;
- amount;
- currency;
- performance period;
- payment terms;
- contract date;
- selected template.

## Safety constraints

- Missing values remain missing.
- Conflicting values require manual selection.
- Low-confidence extraction requires review.
- The system does not replace legal review.
- The exact approved file is the exact file sent.
