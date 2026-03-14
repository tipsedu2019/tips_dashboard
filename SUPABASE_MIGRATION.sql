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

alter table public.classes
  add column if not exists status text,
  add column if not exists lessons jsonb default '[]'::jsonb,
  add column if not exists schedule_plan jsonb;

update public.classes
set status = '수업 진행 중'
where status = '수강' or status is null;

create table if not exists public.academic_schools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text check (category in ('elementary', 'middle', 'high')),
  color text,
  textbooks jsonb default '{}'::jsonb,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.academic_schools
  add column if not exists category text,
  add column if not exists color text,
  add column if not exists textbooks jsonb default '{}'::jsonb,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.academic_events
  add column if not exists school_id uuid references public.academic_schools(id) on delete set null,
  add column if not exists grade text default 'all',
  add column if not exists note text;

create table if not exists public.academic_curriculum_profiles (
  id uuid primary key default gen_random_uuid(),
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
  add column if not exists school_id uuid references public.academic_schools(id) on delete cascade,
  add column if not exists grade text,
  add column if not exists subject text,
  add column if not exists main_textbook_title text,
  add column if not exists main_textbook_publisher text,
  add column if not exists note text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists academic_curriculum_profiles_school_grade_subject_key
  on public.academic_curriculum_profiles (school_id, grade, subject);

create table if not exists public.academic_supplement_materials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.academic_curriculum_profiles(id) on delete cascade,
  title text not null,
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

create table if not exists public.academic_exam_days (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.academic_schools(id) on delete cascade,
  grade text not null,
  subject text not null check (subject in ('영어', '수학')),
  exam_date date not null,
  label text,
  note text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.academic_exam_days
  add column if not exists school_id uuid references public.academic_schools(id) on delete cascade,
  add column if not exists grade text,
  add column if not exists subject text,
  add column if not exists exam_date date,
  add column if not exists label text,
  add column if not exists note text,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.academic_exam_scopes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.academic_curriculum_profiles(id) on delete cascade,
  academic_event_id uuid references public.academic_events(id) on delete set null,
  academic_exam_day_id uuid references public.academic_exam_days(id) on delete set null,
  period_label text,
  textbook_scope text,
  supplement_scope text,
  other_scope text,
  note text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.academic_exam_scopes
  add column if not exists profile_id uuid references public.academic_curriculum_profiles(id) on delete cascade,
  add column if not exists academic_event_id uuid references public.academic_events(id) on delete set null,
  add column if not exists academic_exam_day_id uuid references public.academic_exam_days(id) on delete set null,
  add column if not exists period_label text,
  add column if not exists textbook_scope text,
  add column if not exists supplement_scope text,
  add column if not exists other_scope text,
  add column if not exists note text,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.app_preferences (
  key text primary key,
  value jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.app_preferences
  add column if not exists value jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_academic_schools'
  ) then
    create trigger set_updated_at_academic_schools
      before update on public.academic_schools
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_academic_curriculum_profiles'
  ) then
    create trigger set_updated_at_academic_curriculum_profiles
      before update on public.academic_curriculum_profiles
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_academic_supplement_materials'
  ) then
    create trigger set_updated_at_academic_supplement_materials
      before update on public.academic_supplement_materials
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_academic_exam_days'
  ) then
    create trigger set_updated_at_academic_exam_days
      before update on public.academic_exam_days
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_academic_exam_scopes'
  ) then
    create trigger set_updated_at_academic_exam_scopes
      before update on public.academic_exam_scopes
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_app_preferences'
  ) then
    create trigger set_updated_at_app_preferences
      before update on public.app_preferences
      for each row execute function public.set_updated_at();
  end if;
end
$$;

alter table public.academic_schools enable row level security;
alter table public.academic_curriculum_profiles enable row level security;
alter table public.academic_supplement_materials enable row level security;
alter table public.academic_exam_days enable row level security;
alter table public.academic_exam_scopes enable row level security;
alter table public.app_preferences enable row level security;

drop policy if exists academic_schools_authenticated_select on public.academic_schools;
create policy academic_schools_authenticated_select
  on public.academic_schools
  for select
  to authenticated
  using (true);

drop policy if exists academic_schools_authenticated_write on public.academic_schools;
create policy academic_schools_authenticated_write
  on public.academic_schools
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists academic_curriculum_profiles_authenticated_select on public.academic_curriculum_profiles;
create policy academic_curriculum_profiles_authenticated_select
  on public.academic_curriculum_profiles
  for select
  to authenticated
  using (true);

drop policy if exists academic_curriculum_profiles_authenticated_write on public.academic_curriculum_profiles;
create policy academic_curriculum_profiles_authenticated_write
  on public.academic_curriculum_profiles
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists academic_supplement_materials_authenticated_select on public.academic_supplement_materials;
create policy academic_supplement_materials_authenticated_select
  on public.academic_supplement_materials
  for select
  to authenticated
  using (true);

drop policy if exists academic_supplement_materials_authenticated_write on public.academic_supplement_materials;
create policy academic_supplement_materials_authenticated_write
  on public.academic_supplement_materials
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists academic_exam_days_authenticated_select on public.academic_exam_days;
create policy academic_exam_days_authenticated_select
  on public.academic_exam_days
  for select
  to authenticated
  using (true);

drop policy if exists academic_exam_days_authenticated_write on public.academic_exam_days;
create policy academic_exam_days_authenticated_write
  on public.academic_exam_days
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists academic_exam_scopes_authenticated_select on public.academic_exam_scopes;
create policy academic_exam_scopes_authenticated_select
  on public.academic_exam_scopes
  for select
  to authenticated
  using (true);

drop policy if exists academic_exam_scopes_authenticated_write on public.academic_exam_scopes;
create policy academic_exam_scopes_authenticated_write
  on public.academic_exam_scopes
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists app_preferences_authenticated_select on public.app_preferences;
create policy app_preferences_authenticated_select
  on public.app_preferences
  for select
  to authenticated
  using (true);

drop policy if exists app_preferences_authenticated_write on public.app_preferences;
create policy app_preferences_authenticated_write
  on public.app_preferences
  for all
  to authenticated
  using (true)
  with check (true);
