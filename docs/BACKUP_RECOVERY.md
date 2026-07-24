# Backup and recovery

## Strategy

- Enable hosted Supabase daily database backups and select retention suitable
  for the pilot; enable PITR when the required recovery point is shorter.
- Back up private Storage objects separately: Supabase database backups contain
  object metadata but not the stored files.
- Export Vercel environment-variable names and configuration, never plaintext
  secrets. Keep credentials in the approved secret manager.
- Retain generated immutable artifacts and checksums in an encrypted,
  access-controlled object backup.

## Recovery rehearsal

1. Create an isolated recovery Supabase project.
2. Restore a selected database backup there.
3. Restore private Storage objects to matching private paths.
4. point a non-production Vercel preview at recovery resources.
5. Verify auth, RLS, attachments, generated checksums, audit history, registry,
   reporting and one idempotent mailbox run using synthetic data.
6. Destroy the isolated environment according to retention policy.

No destructive restore was performed against the linked hosted project. A
complete database-and-Storage restore remains a mandatory owner-supervised
pilot gate.

