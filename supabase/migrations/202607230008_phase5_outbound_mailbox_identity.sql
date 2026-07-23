alter table public.email_messages
  drop constraint email_messages_mailbox_identity_complete;

alter table public.email_messages
  add constraint email_messages_mailbox_identity_complete
  check (
    (mailbox_identifier is null and mailbox_uid is null and uid_validity is null)
    or
    (
      direction = 'inbound'
      and mailbox_identifier is not null
      and mailbox_uid is not null
      and uid_validity is not null
    )
    or
    (
      direction = 'outbound'
      and mailbox_identifier is not null
      and mailbox_uid is null
      and uid_validity is null
    )
  );

update public.email_messages
set mailbox_identifier = lower(sender)
where direction = 'outbound'
  and mailbox_identifier is null
  and rfc_message_id is not null;
