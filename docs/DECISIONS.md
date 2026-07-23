# Architecture Decision Log

Record only decisions that materially affect implementation.

## ADR-001 — Modular monolith

Status: Accepted

Decision:
Use one deployable application with clear internal modules.

Reason:
The MVP is small, must ship quickly, and does not need microservice operational complexity.

## ADR-002 — Human approval before contract sending

Status: Accepted

Decision:
Every generated contract requires explicit specialist approval before delivery.

Reason:
The system handles legally significant documents and AI extraction may be wrong.

## ADR-003 — Approved templates only

Status: Accepted

Decision:
Contracts are generated only from customer-approved DOCX templates with explicit variables.

Reason:
The AI must not independently draft or alter legal clauses in MVP.

## ADR-004 — Functional interface over visual design

Status: Accepted

Decision:
Build a plain internal interface and defer visual polish.

Reason:
The commercial objective is a working pilot, not a design showcase.

## Pending decisions

Do not resolve without evidence or user input:

- database hosting choice;
- authentication provider;
- selected mailbox provider;
- object storage provider;
- DOCX generation library;
- PDF conversion strategy;
- deployment target;
- background job mechanism.
