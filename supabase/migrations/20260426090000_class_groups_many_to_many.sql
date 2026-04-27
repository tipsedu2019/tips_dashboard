create extension if not exists pgcrypto;

create table if not exists public.class_schedule_sync_groups (
  id uuid primary key default gen_random_uuid(),
  term_id uuid references public.class_terms(id) on delete set null,
  name text not null,
  subject text,
  color text not null default '#3182f6',
  note text not null default '',
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.class_schedule_sync_groups
  add column if not exists term_id uuid references public.class_terms(id) on delete set null,
  add column if not exists name text,
  add column if not exists subject text,
  add column if not exists color text not null default '#3182f6',
  add column if not exists note text not null default '',
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_default boolean not null default false,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.class_schedule_sync_group_members (
  group_id uuid not null references public.class_schedule_sync_groups(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  primary key (group_id, class_id)
);

alter table public.class_schedule_sync_group_members
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz default now();

drop index if exists public.class_schedule_sync_group_members_class_id_key;

create index if not exists class_schedule_sync_groups_sort_idx
  on public.class_schedule_sync_groups (sort_order, name);

create unique index if not exists class_schedule_sync_groups_single_default_idx
  on public.class_schedule_sync_groups (is_default)
  where is_default;

create index if not exists class_schedule_sync_group_members_class_id_idx
  on public.class_schedule_sync_group_members (class_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_class_schedule_sync_groups'
  ) then
    create trigger set_updated_at_class_schedule_sync_groups
      before update on public.class_schedule_sync_groups
      for each row execute function public.set_updated_at();
  end if;
end
$$;

alter table public.class_schedule_sync_groups enable row level security;
alter table public.class_schedule_sync_group_members enable row level security;

drop policy if exists class_schedule_sync_groups_authenticated_select on public.class_schedule_sync_groups;
create policy class_schedule_sync_groups_authenticated_select
  on public.class_schedule_sync_groups
  for select
  to authenticated
  using (true);

drop policy if exists class_schedule_sync_groups_staff_write on public.class_schedule_sync_groups;
drop policy if exists class_schedule_sync_groups_authenticated_write on public.class_schedule_sync_groups;
create policy class_schedule_sync_groups_authenticated_write
  on public.class_schedule_sync_groups
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'))
  with check (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists class_schedule_sync_group_members_authenticated_select on public.class_schedule_sync_group_members;
create policy class_schedule_sync_group_members_authenticated_select
  on public.class_schedule_sync_group_members
  for select
  to authenticated
  using (true);

drop policy if exists class_schedule_sync_group_members_staff_write on public.class_schedule_sync_group_members;
drop policy if exists class_schedule_sync_group_members_authenticated_write on public.class_schedule_sync_group_members;
create policy class_schedule_sync_group_members_authenticated_write
  on public.class_schedule_sync_group_members
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'))
  with check (public.current_dashboard_role() in ('admin', 'staff'));
