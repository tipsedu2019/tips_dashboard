alter table public.dashboard_notifications
  add column if not exists dedupe_key text;

drop index if exists public.dashboard_notifications_dedupe_key;
create unique index if not exists dashboard_notifications_dedupe_key
  on public.dashboard_notifications(dedupe_key);

create table if not exists public.makeup_notification_settings (
  trigger_kind text not null
    check (trigger_kind in ('submitted', 'approved', 'returned', 'rejected', 'completed', 'canceled')),
  channel text not null
    check (channel in ('dashboard_personal', 'dashboard_management', 'google_chat_executive', 'google_chat_admin', 'google_chat_math', 'google_chat_english')),
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (trigger_kind, channel)
);

create table if not exists public.makeup_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.makeup_requests(id) on delete cascade,
  trigger_kind text not null,
  channel text not null,
  target_type text not null default '',
  target_label text not null default '',
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  recipient_team text,
  google_chat_channel text,
  status text not null
    check (status in ('sent', 'skipped', 'failed', 'disabled', 'deduped')),
  dedupe_key text,
  title text not null default '',
  body text not null default '',
  error text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists makeup_notification_deliveries_request_idx
  on public.makeup_notification_deliveries(request_id, created_at desc);

create index if not exists makeup_notification_deliveries_trigger_idx
  on public.makeup_notification_deliveries(trigger_kind, channel, created_at desc);

insert into public.makeup_notification_settings (trigger_kind, channel, enabled)
select trigger_kind, channel, true
from unnest(array['submitted', 'approved', 'returned', 'rejected', 'completed', 'canceled']::text[]) trigger_kind
cross join unnest(array[
  'dashboard_personal',
  'dashboard_management',
  'google_chat_executive',
  'google_chat_admin',
  'google_chat_math',
  'google_chat_english'
]::text[]) channel
on conflict (trigger_kind, channel) do nothing;

create or replace function public.set_makeup_notification_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_makeup_notification_settings_updated_at on public.makeup_notification_settings;
create trigger set_makeup_notification_settings_updated_at
before update on public.makeup_notification_settings
for each row execute function public.set_makeup_notification_settings_updated_at();

alter table public.makeup_notification_settings enable row level security;
alter table public.makeup_notification_deliveries enable row level security;

revoke all on public.makeup_notification_settings from anon;
revoke all on public.makeup_notification_deliveries from anon;

grant select, insert, update on public.makeup_notification_settings to authenticated;
grant select, insert on public.makeup_notification_deliveries to authenticated;

drop policy if exists makeup_notification_settings_staff_select on public.makeup_notification_settings;
create policy makeup_notification_settings_staff_select
  on public.makeup_notification_settings
  for select
  to authenticated
  using (true);

drop policy if exists makeup_notification_settings_staff_write on public.makeup_notification_settings;
create policy makeup_notification_settings_staff_write
  on public.makeup_notification_settings
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'))
  with check (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists makeup_notification_deliveries_staff_select on public.makeup_notification_deliveries;
create policy makeup_notification_deliveries_staff_select
  on public.makeup_notification_deliveries
  for select
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists makeup_notification_deliveries_insert_authenticated on public.makeup_notification_deliveries;
create policy makeup_notification_deliveries_insert_authenticated
  on public.makeup_notification_deliveries
  for insert
  to authenticated
  with check (true);
