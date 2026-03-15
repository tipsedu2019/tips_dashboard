create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key,
  role text not null default 'viewer' check (role in ('admin', 'staff', 'teacher', 'viewer')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles
  add column if not exists role text not null default 'viewer',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create or replace function public.current_dashboard_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.role
      from public.profiles p
      where p.id = auth.uid()
      limit 1
    ),
    case lower(coalesce(auth.jwt() ->> 'email', ''))
      when 'yeoyuasset@naver.com' then 'admin'
      when 'tipsacademy@naver.com' then 'staff'
      when 'tipsedu@naver.com' then 'teacher'
      else 'viewer'
    end
  );
$$;

grant execute on function public.current_dashboard_role() to authenticated;

alter table public.classes
  add column if not exists term_id uuid,
  add column if not exists period text,
  add column if not exists status text,
  add column if not exists lessons jsonb default '[]'::jsonb,
  add column if not exists schedule_plan jsonb;

update public.classes
set status = '수업 진행 중'
where status in ('수강', '수업 진행 중') or status is null;

update public.classes
set status = '개강 준비 중'
where status in ('개강 예정', '개강 준비 중');

create table if not exists public.class_terms (
  id uuid primary key default gen_random_uuid(),
  academic_year integer not null default extract(year from now()),
  name text not null,
  status text not null check (status in ('수업 진행 중', '개강 준비 중', '종강')),
  start_date date,
  end_date date,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.class_terms
  add column if not exists academic_year integer not null default extract(year from now()),
  add column if not exists name text,
  add column if not exists status text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists class_terms_year_name_key
  on public.class_terms (academic_year, name);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'classes_term_id_fkey'
  ) then
    alter table public.classes
      add constraint classes_term_id_fkey
      foreign key (term_id) references public.class_terms(id) on delete set null;
  end if;
end
$$;

insert into public.class_terms (academic_year, name, status, sort_order)
select
  coalesce(
    nullif(substring(period from '([0-9]{4})'), '')::integer,
    extract(year from now())::integer
  ) as academic_year,
  period,
  case
    when min(
      case
        when status = '종강' then 2
        when status in ('개강 준비 중', '개강 예정') then 1
        else 0
      end
    ) = 2 then '종강'
    when min(
      case
        when status = '종강' then 2
        when status in ('개강 준비 중', '개강 예정') then 1
        else 0
      end
    ) = 1 then '개강 준비 중'
    else '수업 진행 중'
  end,
  row_number() over (
    order by
      coalesce(
        nullif(substring(period from '([0-9]{4})'), '')::integer,
        extract(year from now())::integer
      ),
      period
  )
from public.classes
where coalesce(period, '') <> ''
group by period
on conflict (academic_year, name) do nothing;

update public.classes c
set term_id = t.id
from public.class_terms t
where c.term_id is null
  and coalesce(c.period, '') <> ''
  and c.period = t.name
  and coalesce(
    nullif(substring(c.period from '([0-9]{4})'), '')::integer,
    extract(year from now())::integer
  ) = t.academic_year;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_profiles'
  ) then
    create trigger set_updated_at_profiles
    before update on public.profiles
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_class_terms'
  ) then
    create trigger set_updated_at_class_terms
    before update on public.class_terms
    for each row
    execute function public.set_updated_at();
  end if;
end
$$;

alter table public.profiles enable row level security;
alter table public.class_terms enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists profiles_staff_select on public.profiles;
create policy profiles_staff_select
  on public.profiles
  for select
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists profiles_staff_write on public.profiles;
create policy profiles_staff_write
  on public.profiles
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'))
  with check (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists class_terms_authenticated_select on public.class_terms;
create policy class_terms_authenticated_select
  on public.class_terms
  for select
  to authenticated
  using (true);

drop policy if exists class_terms_staff_write on public.class_terms;
create policy class_terms_staff_write
  on public.class_terms
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'))
  with check (public.current_dashboard_role() in ('admin', 'staff'));
