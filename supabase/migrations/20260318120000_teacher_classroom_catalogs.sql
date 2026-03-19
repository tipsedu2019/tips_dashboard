create extension if not exists pgcrypto;

create table if not exists public.teacher_catalogs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subjects text[] not null default '{}'::text[],
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teacher_catalogs
  add column if not exists name text,
  add column if not exists subjects text[] not null default '{}'::text[],
  add column if not exists is_visible boolean not null default true,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists teacher_catalogs_name_key
  on public.teacher_catalogs (lower(name));

create table if not exists public.classroom_catalogs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subjects text[] not null default '{}'::text[],
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.classroom_catalogs
  add column if not exists name text,
  add column if not exists subjects text[] not null default '{}'::text[],
  add column if not exists is_visible boolean not null default true,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists classroom_catalogs_name_key
  on public.classroom_catalogs (lower(name));

do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'set_updated_at'
      and pg_function_is_visible(oid)
  ) then
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_teacher_catalogs') then
      create trigger set_updated_at_teacher_catalogs
      before update on public.teacher_catalogs
      for each row
      execute function public.set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_classroom_catalogs') then
      create trigger set_updated_at_classroom_catalogs
      before update on public.classroom_catalogs
      for each row
      execute function public.set_updated_at();
    end if;
  end if;
end
$$;

alter table public.teacher_catalogs enable row level security;
alter table public.classroom_catalogs enable row level security;

drop policy if exists teacher_catalogs_authenticated_select on public.teacher_catalogs;
create policy teacher_catalogs_authenticated_select
  on public.teacher_catalogs
  for select
  to authenticated
  using (true);

drop policy if exists teacher_catalogs_teacher_write on public.teacher_catalogs;
create policy teacher_catalogs_teacher_write
  on public.teacher_catalogs
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));

drop policy if exists classroom_catalogs_authenticated_select on public.classroom_catalogs;
create policy classroom_catalogs_authenticated_select
  on public.classroom_catalogs
  for select
  to authenticated
  using (true);

drop policy if exists classroom_catalogs_teacher_write on public.classroom_catalogs;
create policy classroom_catalogs_teacher_write
  on public.classroom_catalogs
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));
