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
