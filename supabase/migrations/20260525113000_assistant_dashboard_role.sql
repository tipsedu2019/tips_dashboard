alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'staff', 'teacher', 'assistant', 'viewer'));

alter table public.teacher_catalogs
  drop constraint if exists teacher_catalogs_dashboard_role_check;

alter table public.teacher_catalogs
  add constraint teacher_catalogs_dashboard_role_check
  check (dashboard_role in ('admin', 'staff', 'teacher', 'assistant', 'viewer'));

update public.teacher_catalogs
set dashboard_role = 'assistant'
where '조교팀' = any(subjects)
  and dashboard_role is distinct from 'assistant';

update public.profiles profile
set role = 'assistant'
from public.teacher_catalogs teacher
where teacher.profile_id = profile.id
  and '조교팀' = any(teacher.subjects)
  and profile.role is distinct from 'assistant';

drop policy if exists ops_tasks_select on public.ops_tasks;
create policy ops_tasks_select
  on public.ops_tasks
  for select
  to authenticated
  using (
    public.current_dashboard_role() in ('admin', 'staff', 'assistant')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
    or dashboard_private.is_ops_word_retest_teacher(id)
  );

drop policy if exists ops_tasks_insert on public.ops_tasks;
create policy ops_tasks_insert
  on public.ops_tasks
  for insert
  to authenticated
  with check (
    requested_by is null
    or requested_by = auth.uid()
    or public.current_dashboard_role() in ('admin', 'staff', 'assistant')
  );

drop policy if exists ops_tasks_update on public.ops_tasks;
create policy ops_tasks_update
  on public.ops_tasks
  for update
  to authenticated
  using (
    public.current_dashboard_role() in ('admin', 'staff', 'assistant')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
    or dashboard_private.is_ops_word_retest_teacher(id)
  )
  with check (
    public.current_dashboard_role() in ('admin', 'staff', 'assistant')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
    or dashboard_private.is_ops_word_retest_teacher(id)
  );

do $$
begin
  if to_regclass('public.academic_event_exam_details') is not null then
    drop policy if exists academic_event_exam_details_teacher_write on public.academic_event_exam_details;
    create policy academic_event_exam_details_teacher_write
      on public.academic_event_exam_details
      for all
      to authenticated
      using (public.current_dashboard_role() in ('admin', 'staff', 'teacher', 'assistant'))
      with check (public.current_dashboard_role() in ('admin', 'staff', 'teacher', 'assistant'));
  end if;
end
$$;
