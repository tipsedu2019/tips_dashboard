begin;

drop policy if exists classes_authenticated_select on public.classes;
drop policy if exists classes_dashboard_select on public.classes;
drop policy if exists classes_dashboard_write on public.classes;
drop policy if exists classes_staff_write on public.classes;

create policy classes_authenticated_select_v2
  on public.classes
  for select
  to authenticated
  using (true);

create policy classes_dashboard_insert_v2
  on public.classes
  for insert
  to authenticated
  with check (
    (select public.current_dashboard_role()) in ('admin', 'staff', 'teacher')
  );

create policy classes_dashboard_update_v2
  on public.classes
  for update
  to authenticated
  using (
    (select public.current_dashboard_role()) in ('admin', 'staff', 'teacher')
  )
  with check (
    (select public.current_dashboard_role()) in ('admin', 'staff', 'teacher')
  );

create policy classes_dashboard_delete_v2
  on public.classes
  for delete
  to authenticated
  using (
    (select public.current_dashboard_role()) in ('admin', 'staff', 'teacher')
  );

drop policy if exists textbooks_authenticated_select on public.textbooks;
drop policy if exists textbooks_staff_write on public.textbooks;
drop policy if exists textbooks_teacher_write on public.textbooks;

create policy textbooks_authenticated_select_v2
  on public.textbooks
  for select
  to authenticated
  using (true);

create policy textbooks_dashboard_insert_v2
  on public.textbooks
  for insert
  to authenticated
  with check (
    (select public.current_dashboard_role()) in ('admin', 'staff', 'teacher')
  );

create policy textbooks_dashboard_update_v2
  on public.textbooks
  for update
  to authenticated
  using (
    (select public.current_dashboard_role()) in ('admin', 'staff', 'teacher')
  )
  with check (
    (select public.current_dashboard_role()) in ('admin', 'staff', 'teacher')
  );

create policy textbooks_dashboard_delete_v2
  on public.textbooks
  for delete
  to authenticated
  using (
    (select public.current_dashboard_role()) in ('admin', 'staff', 'teacher')
  );

drop policy if exists profiles_staff_write on public.profiles;
drop policy if exists profiles_delete_staff on public.profiles;
drop policy if exists profiles_insert_staff on public.profiles;
drop policy if exists profiles_self_insert on public.profiles;
drop policy if exists profiles_select_self_or_staff on public.profiles;
drop policy if exists profiles_self_identity_select on public.profiles;
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_staff_select on public.profiles;
drop policy if exists "users can read their own profile" on public.profiles;
drop policy if exists profiles_update_self_or_staff on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;

create policy profiles_select_v2
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    or (
      lower(coalesce((select auth.jwt()) ->> 'email', '')) like '%@tipsedu.co.kr'
      and lower(login_id) = split_part(
        lower(coalesce((select auth.jwt()) ->> 'email', '')),
        '@',
        1
      )
    )
    or (select public.current_dashboard_role()) in ('admin', 'staff')
  );

create policy profiles_insert_v2
  on public.profiles
  for insert
  to authenticated
  with check (
    (select public.current_dashboard_role()) in ('admin', 'staff')
    or (
      id = (select auth.uid())
      and role = 'viewer'
    )
  );

create policy profiles_update_v2
  on public.profiles
  for update
  to authenticated
  using (
    id = (select auth.uid())
    or (select public.current_dashboard_role()) in ('admin', 'staff')
  )
  with check (
    id = (select auth.uid())
    or (select public.current_dashboard_role()) in ('admin', 'staff')
  );

create policy profiles_delete_v2
  on public.profiles
  for delete
  to authenticated
  using (
    (select public.current_dashboard_role()) in ('admin', 'staff')
  );

drop policy if exists ops_tasks_select on public.ops_tasks;
drop policy if exists ops_tasks_insert on public.ops_tasks;
drop policy if exists ops_tasks_update on public.ops_tasks;
drop policy if exists ops_tasks_delete on public.ops_tasks;

create policy ops_tasks_select_v2
  on public.ops_tasks
  for select
  to authenticated
  using (
    (select public.current_dashboard_role()) in ('admin', 'staff', 'assistant')
    or requested_by = (select auth.uid())
    or assignee_id = (select auth.uid())
    or secondary_assignee_id = (select auth.uid())
    or dashboard_private.is_ops_word_retest_teacher(id)
  );

create policy ops_tasks_insert_v2
  on public.ops_tasks
  for insert
  to authenticated
  with check (
    type <> 'registration'
    and (
      requested_by is null
      or requested_by = (select auth.uid())
      or (select public.current_dashboard_role()) in ('admin', 'staff', 'assistant')
    )
  );

create policy ops_tasks_update_v2
  on public.ops_tasks
  for update
  to authenticated
  using (
    not dashboard_private.registration_task_has_subject_tracks(id)
    and (
      (select public.current_dashboard_role()) in ('admin', 'staff', 'assistant')
      or requested_by = (select auth.uid())
      or assignee_id = (select auth.uid())
      or secondary_assignee_id = (select auth.uid())
      or dashboard_private.is_ops_word_retest_teacher(id)
    )
  )
  with check (
    not dashboard_private.registration_task_has_subject_tracks(id)
    and (
      (select public.current_dashboard_role()) in ('admin', 'staff', 'assistant')
      or requested_by = (select auth.uid())
      or assignee_id = (select auth.uid())
      or secondary_assignee_id = (select auth.uid())
      or dashboard_private.is_ops_word_retest_teacher(id)
    )
  );

create policy ops_tasks_delete_v2
  on public.ops_tasks
  for delete
  to authenticated
  using (
    not dashboard_private.registration_task_has_subject_tracks(id)
    and (
      (select public.current_dashboard_role()) = 'admin'
      or (
        type = 'general'
        and (
          requested_by = (select auth.uid())
          or assignee_id = (select auth.uid())
          or secondary_assignee_id = (select auth.uid())
        )
      )
      or (
        requested_by = (select auth.uid())
        and status not in ('done', 'canceled')
      )
      or (
        (select public.current_dashboard_role()) = 'staff'
        and (
          type = 'general'
          or status not in ('done', 'canceled')
        )
      )
    )
  );

commit;
