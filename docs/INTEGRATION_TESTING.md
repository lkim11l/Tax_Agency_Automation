# Phase 1 Supabase Integration Testing

These checks require a real local or dedicated test Supabase project. Unit tests
and mocks do not satisfy this checklist.

## Local database

1. Start Docker Desktop.
2. Run `npm run db:start`.
3. Run `npm run db:reset`.
4. Run `npm run db:lint`.
5. Confirm the migration and safe seed complete without errors.

## Authentication setup

1. Create a user in Supabase Dashboard Authentication.
2. Confirm the user has a matching active `public.profiles` row.
3. Promote the user to `admin` only when administrative access is required.
4. Copy only the project URL and anon key to `.env.local`.
5. Never copy the service-role key into a `NEXT_PUBLIC_*` variable.

Create three dedicated users and configure their `profiles`:

- admin, active;
- specialist, active;
- specialist, inactive.

Store their test credentials only in ignored `.env.local`. Run:

```bash
npm run test:integration
```

The suite intentionally fails when required credentials are missing or invalid.
RLS assertions use only the publishable/legacy anon key and signed-in user
sessions.

## Application acceptance

1. Run `npm run dev`.
2. Confirm an unauthenticated request redirects to `/login`.
3. Sign in with the Dashboard-created user.
4. Create a counterparty and find it by legal name and INN.
5. Create a manual application with that counterparty.
6. Confirm the number matches `REQ-YYYY-NNNNNN`.
7. Find the application by number, title, counterparty, status, assignee, and date.
8. Edit the application and assign a responsible specialist.
9. Change its status with a reason.
10. Add an internal comment.
11. Confirm the detail page shows status history and audit events.
12. Confirm a random valid UUID at `/applications/[id]` returns 404.
13. Deactivate the test profile and confirm access is denied.
14. Reactivate it only if the account is still needed.

## Database assertions

- The application source is `manual`.
- Optional empty values are SQL `null`.
- The amount is non-negative and currency is controlled.
- End date is not earlier than start date.
- Status history and audit records exist for mutations.
- Direct authenticated update/delete of `audit_events` fails.
- Direct authenticated update/delete of `contract_versions` fails.
- An anonymous request cannot select operational tables.

Record the date, environment, migration version, test user role, and results in
`docs/CURRENT_SPRINT.md`. Do not include keys, tokens, or customer data.

## Hosted acceptance result

- Date: 2026-07-22
- Environment: linked hosted Supabase test project
- Migration: `202607230001_phase1_application_registry.sql`
- Tables: all 11 Phase 1 tables verified
- Public registration: disabled
- Test roles: admin/active, specialist/active, specialist/inactive
- Integration suite: 13 tests passed
- Auth runtime: SSR login/logout passed
- Application runtime: list, create page, detail, counterparties, and templates
  returned HTTP 200 with a real authenticated session
- Missing application: authenticated random UUID returned HTTP 404 before
  streaming
- Anonymous and post-logout access: redirected to `/login`
- Persistence: verified with a fresh authenticated client and an application
  server restart
- Data: integration-only records with generated identifiers; no customer data

## Phase 2 hosted checks

`npm run test:integration` also verifies migration
`202607230002_phase2_email_ingestion.sql`: mailbox sync state, concurrent
idempotency, same-subject independence, exact reply matching, unlinked review,
application linkage, attachment metadata, private Storage, audit, admin-only
operations, and anonymous/active/inactive user RLS.

The server key is permitted only for worker/setup/cleanup operations. All RLS
assertions use anonymous or signed-in user sessions. The suite removes only its
generated rows and objects.

## Phase 2 acceptance result

- Date: 2026-07-22
- Provider: configured Mail.ru INBOX over IMAP/SMTP
- Migration: `202607230002_phase2_email_ingestion.sql`
- Connection verification: real IMAP and SMTP passed
- Live fixtures: root with text attachment, independent same-subject message,
  and real reply
- Live result: two applications, reply linked to the root, one private
  attachment, no duplicate on repeated processing
- Operational polling: five messages processed once; next iteration processed
  zero
- Hosted suite: 21 tests passed
- RLS: anonymous denied; active specialist allowed; inactive specialist denied;
  admin operations allowed
- Runtime: production login/logout, anonymous redirect, admin UI sync,
  correspondence rendering, and restart persistence passed
- Negative auth: safe error confirmed without exposing the real password

## Phase 3 document acceptance

`tests/integration/hosted-documents.test.ts` uses synthetic in-memory
DOCX/PDF/XLSX/image/unsupported fixtures. It verifies:

- current results and immutable attempts;
- atomic `FOR UPDATE SKIP LOCKED` claims;
- DOCX/PDF/XLSX source text and markers;
- image `OCR_REQUIRED` and unsupported fallback;
- retry behavior and one current result per attachment;
- anonymous, inactive specialist, active specialist, and admin RLS;
- admin-only parse requests;
- private Storage signed access;
- constraints and safe audit metadata.

User RLS assertions use only public-key user sessions. The server secret is
limited to fixture setup, worker execution, and cleanup.

The separate `npm run test:documents:live` command verifies the exact Mail.ru
message and five private hosted attachments. Phase 3 acceptance completed on
2026-07-23 with 28 hosted integration tests and the real live command passing.
