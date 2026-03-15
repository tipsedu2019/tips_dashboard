create extension if not exists pgcrypto;

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

alter table public.profiles enable row level security;

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

do $$
begin
  if to_regclass('public.class_terms') is not null then
    alter table public.class_terms enable row level security;

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
  end if;

  if to_regclass('public.academic_event_exam_details') is not null then
    alter table public.academic_event_exam_details enable row level security;

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
  end if;

  if to_regclass('public.academy_curriculum_plans') is not null then
    alter table public.academy_curriculum_plans enable row level security;

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
  end if;

  if to_regclass('public.academy_curriculum_materials') is not null then
    alter table public.academy_curriculum_materials enable row level security;

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
  end if;
end
$$;
