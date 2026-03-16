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

alter table public.classes
  add column if not exists status text,
  add column if not exists term_id uuid,
  add column if not exists lessons jsonb default '[]'::jsonb,
  add column if not exists schedule_plan jsonb;

update public.classes
set status = '수업 진행 중'
where status = '수강' or status is null;

update public.classes
set status = '개강 준비 중'
where status = '개강 예정';

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
    select 1 from pg_constraint where conname = 'classes_term_id_fkey'
  ) then
    alter table public.classes
      add constraint classes_term_id_fkey
      foreign key (term_id) references public.class_terms(id) on delete set null;
  end if;
end
$$;

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
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_profiles') then
    create trigger set_updated_at_profiles before update on public.profiles for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_class_terms') then
    create trigger set_updated_at_class_terms before update on public.class_terms for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academic_schools') then
    create trigger set_updated_at_academic_schools before update on public.academic_schools for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academic_curriculum_profiles') then
    create trigger set_updated_at_academic_curriculum_profiles before update on public.academic_curriculum_profiles for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academic_supplement_materials') then
    create trigger set_updated_at_academic_supplement_materials before update on public.academic_supplement_materials for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academic_event_exam_details') then
    create trigger set_updated_at_academic_event_exam_details before update on public.academic_event_exam_details for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academy_curriculum_plans') then
    create trigger set_updated_at_academy_curriculum_plans before update on public.academy_curriculum_plans for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academy_curriculum_materials') then
    create trigger set_updated_at_academy_curriculum_materials before update on public.academy_curriculum_materials for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_app_preferences') then
    create trigger set_updated_at_app_preferences before update on public.app_preferences for each row execute function public.set_updated_at();
  end if;
end
$$;

alter table public.academic_events enable row level security;
alter table public.academic_schools enable row level security;
alter table public.academic_curriculum_profiles enable row level security;
alter table public.academic_supplement_materials enable row level security;
alter table public.academic_event_exam_details enable row level security;
alter table public.academy_curriculum_plans enable row level security;
alter table public.academy_curriculum_materials enable row level security;
alter table public.class_terms enable row level security;
alter table public.app_preferences enable row level security;

drop policy if exists academic_events_authenticated_select on public.academic_events;
create policy academic_events_authenticated_select
  on public.academic_events
  for select
  to authenticated
  using (true);

drop policy if exists academic_events_staff_write on public.academic_events;
create policy academic_events_staff_write
  on public.academic_events
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  );

drop policy if exists academic_schools_authenticated_select on public.academic_schools;
create policy academic_schools_authenticated_select
  on public.academic_schools
  for select
  to authenticated
  using (true);

drop policy if exists academic_schools_staff_write on public.academic_schools;
create policy academic_schools_staff_write
  on public.academic_schools
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  );

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
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  );

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
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  );

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
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  );

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
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  );

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
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  );

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
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  );

drop policy if exists app_preferences_authenticated_select on public.app_preferences;
create policy app_preferences_authenticated_select
  on public.app_preferences
  for select
  to authenticated
  using (true);

drop policy if exists app_preferences_staff_write on public.app_preferences;
create policy app_preferences_staff_write
  on public.app_preferences
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  );
