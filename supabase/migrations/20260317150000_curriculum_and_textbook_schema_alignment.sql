create extension if not exists pgcrypto;

create table if not exists public.academic_curriculum_profiles (
  id uuid primary key default gen_random_uuid(),
  academic_year integer not null default extract(year from now()),
  school_id uuid not null references public.academic_schools(id) on delete cascade,
  grade text not null,
  subject text not null,
  main_textbook_title text,
  main_textbook_publisher text,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.academic_curriculum_profiles
  add column if not exists academic_year integer not null default extract(year from now()),
  add column if not exists school_id uuid references public.academic_schools(id) on delete cascade,
  add column if not exists grade text,
  add column if not exists subject text,
  add column if not exists main_textbook_title text,
  add column if not exists main_textbook_publisher text,
  add column if not exists note text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists academic_curriculum_profiles_year_school_grade_subject_key
  on public.academic_curriculum_profiles (academic_year, school_id, grade, subject);

create table if not exists public.academic_supplement_materials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.academic_curriculum_profiles(id) on delete cascade,
  title text,
  publisher text,
  note text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.academic_supplement_materials
  add column if not exists profile_id uuid references public.academic_curriculum_profiles(id) on delete cascade,
  add column if not exists title text,
  add column if not exists publisher text,
  add column if not exists note text,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.textbooks
  add column if not exists title text,
  add column if not exists publisher text,
  add column if not exists price numeric default 0,
  add column if not exists tags text[] not null default '{}',
  add column if not exists lessons jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'textbooks'
      and column_name = 'name'
  ) then
    execute 'update public.textbooks set title = coalesce(nullif(title, ''''), name) where coalesce(title, '''') = ''''';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'set_updated_at'
      and pg_function_is_visible(oid)
  ) then
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academic_curriculum_profiles') then
      create trigger set_updated_at_academic_curriculum_profiles
      before update on public.academic_curriculum_profiles
      for each row
      execute function public.set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academic_supplement_materials') then
      create trigger set_updated_at_academic_supplement_materials
      before update on public.academic_supplement_materials
      for each row
      execute function public.set_updated_at();
    end if;
  end if;
end
$$;

alter table public.academic_curriculum_profiles enable row level security;
alter table public.academic_supplement_materials enable row level security;

drop policy if exists academic_curriculum_profiles_authenticated_select on public.academic_curriculum_profiles;
create policy academic_curriculum_profiles_authenticated_select
  on public.academic_curriculum_profiles
  for select
  to authenticated
  using (true);

drop policy if exists academic_curriculum_profiles_teacher_write on public.academic_curriculum_profiles;
create policy academic_curriculum_profiles_teacher_write
  on public.academic_curriculum_profiles
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));

drop policy if exists academic_supplement_materials_authenticated_select on public.academic_supplement_materials;
create policy academic_supplement_materials_authenticated_select
  on public.academic_supplement_materials
  for select
  to authenticated
  using (true);

drop policy if exists academic_supplement_materials_teacher_write on public.academic_supplement_materials;
create policy academic_supplement_materials_teacher_write
  on public.academic_supplement_materials
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));
