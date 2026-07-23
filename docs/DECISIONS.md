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

## ADR-005 — Next.js application foundation

Status: Accepted

Decision:
Use Next.js 16.2.11 with React 19.2.8, App Router, and TypeScript 6.0.3 in strict
mode. Node.js 24 is used in CI, with Node.js 20.9 as the minimum supported
runtime.

Reason:
This provides one deployable modular-monolith foundation with server routes and
server-rendered authenticated pages. TypeScript 6.0.3 is the newest version
supported by the TypeScript ESLint parser bundled with Next.js 16.2.11;
TypeScript 7.0.2 currently has an incompatible peer range.

## ADR-006 — Supabase platform services

Status: Accepted

Decision:
Use Supabase PostgreSQL, Auth, and Storage. Use `@supabase/supabase-js` 2.110.8
and `@supabase/ssr` 0.12.3. Keep service-role credentials server-only. Disable
public and anonymous sign-up; administrators provision users.

Reason:
The required data, identity, and object-storage services are available from one
managed platform. Server-side user validation creates a clear authentication
boundary without exposing privileged keys.

## ADR-007 — Validation toolchain

Status: Accepted

Decision:
Use ESLint 9.39.5 with the Next.js configuration, Vitest 4.1.10 for unit tests,
and GitHub Actions on Node.js 24 for lint, type checking, tests, and production
build.

Reason:
The same deterministic commands run locally and in CI. The lock file includes
security overrides for PostCSS 8.5.10 and Sharp 0.35.0 because the versions
transitively selected by Next.js had published advisories.

## Pending decisions

Do not resolve without evidence or user input:

- selected mailbox provider;
- DOCX generation library;
- PDF conversion strategy;
- deployment target;
- background job mechanism.
