-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as anything
-- that uses the new value, so this migration only adds the enum value —
-- no begin/commit wrapper, matching Postgres's own restriction (a bare
-- statement is implicitly its own transaction).
alter type public.application_status add value if not exists 'archived';
