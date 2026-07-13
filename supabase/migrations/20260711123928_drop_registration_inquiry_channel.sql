set local lock_timeout = '5s';

alter table public.ops_registration_details
  drop column if exists inquiry_channel;
