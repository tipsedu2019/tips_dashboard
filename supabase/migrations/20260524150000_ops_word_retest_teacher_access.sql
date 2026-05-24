create schema if not exists dashboard_private;
revoke all on schema dashboard_private from public;
grant usage on schema dashboard_private to authenticated;

create or replace function dashboard_private.is_ops_word_retest_teacher(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ops_word_retests retest
    join public.teacher_catalogs teacher on teacher.id = retest.teacher_catalog_id
    where retest.task_id = target_task_id
      and teacher.profile_id = auth.uid()
  );
$$;

revoke all on function dashboard_private.is_ops_word_retest_teacher(uuid) from public;
grant execute on function dashboard_private.is_ops_word_retest_teacher(uuid) to authenticated;

drop policy if exists ops_tasks_select on public.ops_tasks;
create policy ops_tasks_select
  on public.ops_tasks
  for select
  to authenticated
  using (
    public.current_dashboard_role() in ('admin', 'staff')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
    or dashboard_private.is_ops_word_retest_teacher(id)
  );

drop policy if exists ops_tasks_update on public.ops_tasks;
create policy ops_tasks_update
  on public.ops_tasks
  for update
  to authenticated
  using (
    public.current_dashboard_role() in ('admin', 'staff')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
    or dashboard_private.is_ops_word_retest_teacher(id)
  )
  with check (
    public.current_dashboard_role() in ('admin', 'staff')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
    or dashboard_private.is_ops_word_retest_teacher(id)
  );
