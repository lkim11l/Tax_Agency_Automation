# Presentation readiness

## Scope

This sprint improves the deployed internal MVP without adding business
features. Production remains on Vercel Hobby with manual Mail.ru
synchronization and hosted Supabase.

## Template upload incident

Request `js9vf-1784867226917-49708ce4a519` followed an earlier successful insert
of the same template version. The repeat violated
`contract_templates_name_version_key` and
`contract_templates_code_version_key` (`23505`). Generic error handling hid the
real Supabase response.

The upload path now maps duplicate, validation, Storage, insert, constraint,
RLS, schema-cache and rollback failures to safe codes. Logs contain operation
ID, safe code, Supabase code, table, constraint, HTTP status and rollback
outcome only.

## Controlled templates

The files under `tmp/mock-templates` are checksum-pinned presentation artifacts
derived from unchanged sources. Production names do not contain `MOCK`. New
rows retain `pending_customer_approval`, displayed exactly as
`Ожидает утверждения заказчиком`. They are not legally approved for real
clients.

## Cleanup safety

```bash
npm run production:cleanup-synthetic -- --dry-run
npm run production:cleanup-synthetic -- --apply
```

Selection is limited to exact Integration/Hosted Phase/TAA markers, two
inventoried Mail.ru onboarding subjects, known integration actors and Storage
paths referenced by those rows. Apply refuses a changed manifest or candidate
set. Profiles, Auth users, migrations, configuration, mailbox/security/locking/
retry/audit infrastructure and every unmarked row are preserved.

The final confirmed manifest on 24.07.2026 selected and removed 100
applications, 32 counterparties, 33 templates, 11 report exports and 50 Storage
objects. Database deletion completed before Storage removal, all selected paths
were removed, and the post-operation candidate inventory was empty.

Three checksum-pinned presentation templates were then uploaded under the
production codes `consulting`, `services` and `supply`. All passed validation
and remain `pending_customer_approval`.

## Performance baseline

Measurements used an authenticated test admin against
`https://tax-agency-automation.vercel.app`.

| Route | Cold TTFB | Cold total | Warm TTFB | Warm total | Payload |
|---|---:|---:|---:|---:|---:|
| `/applications` | 1203 ms | 2214 ms | 769 ms | 1035 ms | 117164 B |
| `/registry` | 252 ms | 791 ms | 278 ms | 853 ms | 70673 B |
| `/templates` | 342 ms | 693 ms | 300 ms | 606 ms | 42926 B |
| `/reports` | 378 ms | 990 ms | 1148 ms | 2203 ms | 26597 B |
| `/settings` | 671 ms | 1143 ms | 218 ms | 690 ms | 18841 B |

Changes include 25-row application pagination, request-scoped auth/profile
memoization, parallel reads, a one-request dashboard summary, route loading
feedback and indexes for actual sort/filter paths. Vercel Hobby cold starts
remain possible. Final measurements are recorded only after deployment.

## Index rationale

- `(status, received_at desc)` supports queue status and newest-first order.
- `(assigned_to, received_at desc)` supports specialist queues.
- `applications(created_at desc)` supports operational time ordering.
- `(template_type, updated_at desc)` supports template browsing.
- `contracts(contract_number)` supports registry lookup.
- `(period_start, period_end, created_at desc)` supports report history.
