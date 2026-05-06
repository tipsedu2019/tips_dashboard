alter table public.students
  add column if not exists status text not null default '재원';

update public.students
set status = '재원'
where status is null or btrim(status) = '';

do $$
begin
  alter table public.students
    add constraint students_status_check check (status in ('재원', '퇴원'));
exception
  when duplicate_object then null;
end
$$;

create index if not exists students_status_idx
  on public.students (status);

create table if not exists public.student_class_enrollment_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  action text not null check (action in ('enrolled', 'waitlist', 'removed')),
  previous_mode text check (previous_mode is null or previous_mode in ('enrolled', 'waitlist')),
  next_mode text check (next_mode is null or next_mode in ('enrolled', 'waitlist')),
  memo text not null default '',
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists student_class_enrollment_history_student_changed_idx
  on public.student_class_enrollment_history (student_id, changed_at desc);

create index if not exists student_class_enrollment_history_class_changed_idx
  on public.student_class_enrollment_history (class_id, changed_at desc);

alter table public.student_class_enrollment_history enable row level security;

drop policy if exists student_class_enrollment_history_authenticated_select
  on public.student_class_enrollment_history;
create policy student_class_enrollment_history_authenticated_select
  on public.student_class_enrollment_history
  for select
  to authenticated
  using (true);

drop policy if exists student_class_enrollment_history_staff_write
  on public.student_class_enrollment_history;
create policy student_class_enrollment_history_staff_write
  on public.student_class_enrollment_history
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'teacher'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher'));
