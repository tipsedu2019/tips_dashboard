create extension if not exists pgcrypto;

create table if not exists public.academic_exam_material_plans (
  id uuid primary key default gen_random_uuid(),
  academic_year integer not null default extract(year from now()),
  subject text not null,
  school_id uuid not null references public.academic_schools(id) on delete cascade,
  grade text not null,
  exam_period_code text not null,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.academic_exam_material_plans
  add column if not exists academic_year integer not null default extract(year from now()),
  add column if not exists subject text,
  add column if not exists school_id uuid references public.academic_schools(id) on delete cascade,
  add column if not exists grade text,
  add column if not exists exam_period_code text,
  add column if not exists note text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists academic_exam_material_plans_unique_key
  on public.academic_exam_material_plans (academic_year, subject, school_id, grade, exam_period_code);

create table if not exists public.academic_exam_material_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.academic_exam_material_plans(id) on delete cascade,
  material_category text not null,
  title text,
  publisher text,
  scope_detail text,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.academic_exam_material_items
  add column if not exists plan_id uuid references public.academic_exam_material_plans(id) on delete cascade,
  add column if not exists material_category text,
  add column if not exists title text,
  add column if not exists publisher text,
  add column if not exists scope_detail text,
  add column if not exists note text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists academic_exam_material_items_plan_idx
  on public.academic_exam_material_items (plan_id, material_category, sort_order);

create table if not exists public.academy_curriculum_period_catalogs (
  id uuid primary key default gen_random_uuid(),
  academic_year integer not null default extract(year from now()),
  subject text not null,
  academy_grade text not null,
  period_code text not null,
  period_label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.academy_curriculum_period_catalogs
  add column if not exists academic_year integer not null default extract(year from now()),
  add column if not exists subject text,
  add column if not exists academy_grade text,
  add column if not exists period_code text,
  add column if not exists period_label text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists academy_curriculum_period_catalogs_unique_key
  on public.academy_curriculum_period_catalogs (academic_year, subject, academy_grade, period_code);

create table if not exists public.academy_curriculum_period_plans (
  id uuid primary key default gen_random_uuid(),
  academic_year integer not null default extract(year from now()),
  subject text not null,
  academy_grade text not null,
  catalog_id uuid references public.academy_curriculum_period_catalogs(id) on delete cascade,
  period_type text not null default 'fixed',
  period_code text not null,
  period_label text not null,
  scope_type text not null default 'template',
  class_id uuid references public.classes(id) on delete cascade,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.academy_curriculum_period_plans
  add column if not exists academic_year integer not null default extract(year from now()),
  add column if not exists subject text,
  add column if not exists academy_grade text,
  add column if not exists catalog_id uuid references public.academy_curriculum_period_catalogs(id) on delete cascade,
  add column if not exists period_type text not null default 'fixed',
  add column if not exists period_code text,
  add column if not exists period_label text,
  add column if not exists scope_type text not null default 'template',
  add column if not exists class_id uuid references public.classes(id) on delete cascade,
  add column if not exists note text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists academy_curriculum_period_plans_template_unique_key
  on public.academy_curriculum_period_plans (academic_year, subject, academy_grade, period_code, scope_type)
  where class_id is null;

create unique index if not exists academy_curriculum_period_plans_class_unique_key
  on public.academy_curriculum_period_plans (academic_year, subject, academy_grade, period_code, scope_type, class_id)
  where class_id is not null;

create table if not exists public.academy_curriculum_period_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.academy_curriculum_period_plans(id) on delete cascade,
  material_category text not null,
  textbook_id uuid references public.textbooks(id) on delete set null,
  title text,
  publisher text,
  plan_detail text,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.academy_curriculum_period_items
  add column if not exists plan_id uuid references public.academy_curriculum_period_plans(id) on delete cascade,
  add column if not exists material_category text,
  add column if not exists textbook_id uuid references public.textbooks(id) on delete set null,
  add column if not exists title text,
  add column if not exists publisher text,
  add column if not exists plan_detail text,
  add column if not exists note text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists academy_curriculum_period_items_plan_idx
  on public.academy_curriculum_period_items (plan_id, material_category, sort_order);

do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'set_updated_at'
      and pg_function_is_visible(oid)
  ) then
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academic_exam_material_plans') then
      create trigger set_updated_at_academic_exam_material_plans
      before update on public.academic_exam_material_plans
      for each row
      execute function public.set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academic_exam_material_items') then
      create trigger set_updated_at_academic_exam_material_items
      before update on public.academic_exam_material_items
      for each row
      execute function public.set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academy_curriculum_period_catalogs') then
      create trigger set_updated_at_academy_curriculum_period_catalogs
      before update on public.academy_curriculum_period_catalogs
      for each row
      execute function public.set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academy_curriculum_period_plans') then
      create trigger set_updated_at_academy_curriculum_period_plans
      before update on public.academy_curriculum_period_plans
      for each row
      execute function public.set_updated_at();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_academy_curriculum_period_items') then
      create trigger set_updated_at_academy_curriculum_period_items
      before update on public.academy_curriculum_period_items
      for each row
      execute function public.set_updated_at();
    end if;
  end if;
end
$$;

alter table public.academic_exam_material_plans enable row level security;
alter table public.academic_exam_material_items enable row level security;
alter table public.academy_curriculum_period_catalogs enable row level security;
alter table public.academy_curriculum_period_plans enable row level security;
alter table public.academy_curriculum_period_items enable row level security;

drop policy if exists academic_exam_material_plans_authenticated_select on public.academic_exam_material_plans;
create policy academic_exam_material_plans_authenticated_select
  on public.academic_exam_material_plans
  for select
  to authenticated
  using (true);

drop policy if exists academic_exam_material_plans_teacher_write on public.academic_exam_material_plans;
create policy academic_exam_material_plans_teacher_write
  on public.academic_exam_material_plans
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));

drop policy if exists academic_exam_material_items_authenticated_select on public.academic_exam_material_items;
create policy academic_exam_material_items_authenticated_select
  on public.academic_exam_material_items
  for select
  to authenticated
  using (true);

drop policy if exists academic_exam_material_items_teacher_write on public.academic_exam_material_items;
create policy academic_exam_material_items_teacher_write
  on public.academic_exam_material_items
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));

drop policy if exists academy_curriculum_period_catalogs_authenticated_select on public.academy_curriculum_period_catalogs;
create policy academy_curriculum_period_catalogs_authenticated_select
  on public.academy_curriculum_period_catalogs
  for select
  to authenticated
  using (true);

drop policy if exists academy_curriculum_period_catalogs_teacher_write on public.academy_curriculum_period_catalogs;
create policy academy_curriculum_period_catalogs_teacher_write
  on public.academy_curriculum_period_catalogs
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));

drop policy if exists academy_curriculum_period_plans_authenticated_select on public.academy_curriculum_period_plans;
create policy academy_curriculum_period_plans_authenticated_select
  on public.academy_curriculum_period_plans
  for select
  to authenticated
  using (true);

drop policy if exists academy_curriculum_period_plans_teacher_write on public.academy_curriculum_period_plans;
create policy academy_curriculum_period_plans_teacher_write
  on public.academy_curriculum_period_plans
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));

drop policy if exists academy_curriculum_period_items_authenticated_select on public.academy_curriculum_period_items;
create policy academy_curriculum_period_items_authenticated_select
  on public.academy_curriculum_period_items
  for select
  to authenticated
  using (true);

drop policy if exists academy_curriculum_period_items_teacher_write on public.academy_curriculum_period_items;
create policy academy_curriculum_period_items_teacher_write
  on public.academy_curriculum_period_items
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));
