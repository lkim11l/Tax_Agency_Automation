# Pilot security checklist

- [x] Public signup and anonymous sign-in remain disabled in Supabase config.
- [x] Server credentials have no `NEXT_PUBLIC_` prefix and `.env.local` is ignored.
- [x] Cron requires a constant-time bearer-secret comparison and fails closed.
- [x] Operational tables use admin-read RLS; mutations and RPCs are service-only.
- [x] Private Storage access remains authenticated and signed URLs expire.
- [x] Automatic processing cannot approve or send legal messages.
- [x] Important state transitions produce audit records.
- [x] Filenames, types, sizes and active document content are validated.
- [x] Public health output contains status metadata but no credentials or PII.
- [ ] Configure production secrets and rotate any credentials used before pilot.
- [ ] Verify one production admin and one production specialist; deactivate extras.
- [ ] Review Vercel, Supabase, Mail.ru and OpenAI account access/MFA with owner.
- [ ] Run repository and provider secret scanning before production launch.
- [ ] Complete isolated backup restore rehearsal.

