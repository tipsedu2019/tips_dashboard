revoke all privileges on table public.ops_registration_messages from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.ops_registration_messages
  from authenticated;

grant select on table public.ops_registration_messages to authenticated;
