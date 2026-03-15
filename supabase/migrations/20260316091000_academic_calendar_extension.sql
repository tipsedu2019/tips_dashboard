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

create table if not exists public.academic_event_exam_details (
  id uuid primary key default gen_random_uuid(),
  academic_event_id uuid not null references public.academic_events(id) on delete cascade,
  school_id uuid references public.academic_schools(id) on delete set null,
  grade text,
  subject text,
  exam_date date,
  exam_date_status text check (exam_date_status in ('exact', 'tbd')),
  curriculum_profile_id uuid references public.academic_curriculum_profiles(id) on delete set null,
  academy_curriculum_plan_id uuid,
  textbook_scope text,
  supplement_scope text,
  other_scope text,
  note text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.academic_event_exam_details
  add column if not exists school_id uuid references public.academic_schools(id) on delete set null,
  add column if not exists grade text,
  add column if not exists subject text,
  add column if not exists exam_date date,
  add column if not exists exam_date_status text,
  add column if not exists curriculum_profile_id uuid references public.academic_curriculum_profiles(id) on delete set null,
  add column if not exists academy_curriculum_plan_id uuid,
  add column if not exists textbook_scope text,
  add column if not exists supplement_scope text,
  add column if not exists other_scope text,
  add column if not exists note text,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.academy_curriculum_plans (
  id uuid primary key default gen_random_uuid(),
  academic_year integer not null default extract(year from now()),
  academy_grade text,
  subject text,
  class_id uuid references public.classes(id) on delete set null,
  main_textbook_id uuid references public.textbooks(id) on delete set null,
  note text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.academy_curriculum_plans
  add column if not exists academic_year integer not null default extract(year from now()),
  add column if not exists academy_grade text,
  add column if not exists subject text,
  add column if not exists class_id uuid references public.classes(id) on delete set null,
  add column if not exists main_textbook_id uuid references public.textbooks(id) on delete set null,
  add column if not exists note text,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.academy_curriculum_materials (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.academy_curriculum_plans(id) on delete cascade,
  textbook_id uuid references public.textbooks(id) on delete set null,
  title text,
  publisher text,
  note text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.academy_curriculum_materials
  add column if not exists textbook_id uuid references public.textbooks(id) on delete set null,
  add column if not exists title text,
  add column if not exists publisher text,
  add column if not exists note text,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

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
    select 1 from pg_trigger where tgname = 'set_updated_at_academic_event_exam_details'
  ) then
    create trigger set_updated_at_academic_event_exam_details
    before update on public.academic_event_exam_details
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_academy_curriculum_plans'
  ) then
    create trigger set_updated_at_academy_curriculum_plans
    before update on public.academy_curriculum_plans
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_academy_curriculum_materials'
  ) then
    create trigger set_updated_at_academy_curriculum_materials
    before update on public.academy_curriculum_materials
    for each row
    execute function public.set_updated_at();
  end if;
end
$$;

alter table public.profiles enable row level security;
alter table public.academic_event_exam_details enable row level security;
alter table public.academy_curriculum_plans enable row level security;
alter table public.academy_curriculum_materials enable row level security;

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

drop policy if exists academic_event_exam_details_authenticated_select on public.academic_event_exam_details;
create policy academic_event_exam_details_authenticated_select
  on public.academic_event_exam_details
  for select
  to authenticated
  using (true);

drop policy if exists academic_event_exam_details_teacher_write on public.academic_event_exam_details;
create policy academic_event_exam_details_teacher_write
  on public.academic_event_exam_details
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));

drop policy if exists academy_curriculum_plans_authenticated_select on public.academy_curriculum_plans;
create policy academy_curriculum_plans_authenticated_select
  on public.academy_curriculum_plans
  for select
  to authenticated
  using (true);

drop policy if exists academy_curriculum_plans_teacher_write on public.academy_curriculum_plans;
create policy academy_curriculum_plans_teacher_write
  on public.academy_curriculum_plans
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));

drop policy if exists academy_curriculum_materials_authenticated_select on public.academy_curriculum_materials;
create policy academy_curriculum_materials_authenticated_select
  on public.academy_curriculum_materials
  for select
  to authenticated
  using (true);

drop policy if exists academy_curriculum_materials_teacher_write on public.academy_curriculum_materials;
create policy academy_curriculum_materials_teacher_write
  on public.academy_curriculum_materials
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));
