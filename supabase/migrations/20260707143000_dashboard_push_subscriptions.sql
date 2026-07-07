create table if not exists public.dashboard_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists dashboard_push_subscriptions_profile_idx
  on public.dashboard_push_subscriptions(profile_id, updated_at desc);

create or replace function public.set_dashboard_push_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_dashboard_push_subscriptions_updated_at on public.dashboard_push_subscriptions;
create trigger set_dashboard_push_subscriptions_updated_at
before update on public.dashboard_push_subscriptions
for each row execute function public.set_dashboard_push_subscriptions_updated_at();

alter table public.dashboard_push_subscriptions enable row level security;

revoke all on public.dashboard_push_subscriptions from anon;

grant select, insert, update, delete on public.dashboard_push_subscriptions to authenticated;
grant select, insert, update, delete on public.dashboard_push_subscriptions to service_role;

drop policy if exists dashboard_push_subscriptions_select_own on public.dashboard_push_subscriptions;
create policy dashboard_push_subscriptions_select_own
  on public.dashboard_push_subscriptions
  for select
  to authenticated
  using (profile_id = auth.uid());

drop policy if exists dashboard_push_subscriptions_insert_own on public.dashboard_push_subscriptions;
create policy dashboard_push_subscriptions_insert_own
  on public.dashboard_push_subscriptions
  for insert
  to authenticated
  with check (profile_id = auth.uid());

drop policy if exists dashboard_push_subscriptions_update_own on public.dashboard_push_subscriptions;
create policy dashboard_push_subscriptions_update_own
  on public.dashboard_push_subscriptions
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists dashboard_push_subscriptions_delete_own on public.dashboard_push_subscriptions;
create policy dashboard_push_subscriptions_delete_own
  on public.dashboard_push_subscriptions
  for delete
  to authenticated
  using (profile_id = auth.uid());
