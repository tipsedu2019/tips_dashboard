do $$
declare
  channel_constraint text;
begin
  select conname into channel_constraint
  from pg_constraint
  where conrelid = 'public.makeup_notification_settings'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%google_chat_admin%'
    and pg_get_constraintdef(oid) like '%google_chat_english%'
    and pg_get_constraintdef(oid) like '%channel%'
  limit 1;

  if channel_constraint is not null then
    execute format('alter table public.makeup_notification_settings drop constraint %I', channel_constraint);
  end if;
end;
$$;

alter table public.makeup_notification_settings
  add constraint makeup_notification_settings_channel_check
  check (channel in (
    'dashboard_personal',
    'dashboard_management',
    'google_chat_executive',
    'google_chat_admin',
    'google_chat_math',
    'google_chat_english'
  ));

insert into public.makeup_notification_settings (trigger_kind, channel, enabled)
select trigger_kind, 'google_chat_executive', true
from unnest(array['submitted', 'approved', 'returned', 'rejected', 'completed', 'canceled']::text[]) trigger_kind
on conflict (trigger_kind, channel) do nothing;
