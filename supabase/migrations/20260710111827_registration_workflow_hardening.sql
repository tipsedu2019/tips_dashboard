alter table public.ops_registration_details
  add column if not exists level_test_completed_at timestamptz,
  add column if not exists level_test_result text;

create index if not exists ops_registration_details_level_test_completed_at_idx
  on public.ops_registration_details(level_test_completed_at);

alter table public.ops_registration_messages
  drop constraint if exists ops_registration_messages_status_check;

alter table public.ops_registration_messages
  add constraint ops_registration_messages_status_check
  check (status in ('pending', 'accepted', 'failed', 'unknown'));
