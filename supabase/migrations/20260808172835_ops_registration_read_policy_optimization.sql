begin;

create or replace function dashboard_private.can_read_ops_task_v1(
  p_task_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
begin
  if p_task_id is null or v_actor is null then
    return false;
  end if;

  return exists (
    select 1
    from public.ops_tasks task
    where task.id = p_task_id
      and (
        v_role in ('admin', 'staff', 'assistant')
        or task.requested_by = v_actor
        or task.assignee_id = v_actor
        or task.secondary_assignee_id = v_actor
        or dashboard_private.is_ops_word_retest_teacher(task.id)
      )
  );
end;
$$;

alter function dashboard_private.can_read_ops_task_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.can_read_ops_task_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.can_read_ops_task_v1(uuid)
  to authenticated;

create or replace function dashboard_private.can_read_registration_track_v1(
  p_track_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select dashboard_private.can_read_ops_task_v1(track.task_id)
      from public.ops_registration_subject_tracks track
      where track.id = p_track_id
    ),
    false
  );
$$;

alter function dashboard_private.can_read_registration_track_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.can_read_registration_track_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.can_read_registration_track_v1(uuid)
  to authenticated;

drop policy if exists ops_task_events_select on public.ops_task_events;
create policy ops_task_events_select_v2
  on public.ops_task_events
  for select
  to authenticated
  using (
    dashboard_private.can_read_ops_task_v1(task_id)
  );

drop policy if exists ops_registration_subject_tracks_authenticated_select
  on public.ops_registration_subject_tracks;
create policy ops_registration_subject_tracks_select_v2
  on public.ops_registration_subject_tracks
  for select
  to authenticated
  using (
    dashboard_private.can_read_ops_task_v1(task_id)
  );

drop policy if exists ops_registration_appointments_authenticated_select
  on public.ops_registration_appointments;
create policy ops_registration_appointments_select_v2
  on public.ops_registration_appointments
  for select
  to authenticated
  using (
    dashboard_private.can_read_ops_task_v1(task_id)
  );

drop policy if exists ops_registration_admission_batches_authenticated_select
  on public.ops_registration_admission_batches;
create policy ops_registration_admission_batches_select_v2
  on public.ops_registration_admission_batches
  for select
  to authenticated
  using (
    dashboard_private.can_read_ops_task_v1(task_id)
  );

drop policy if exists ops_registration_details_select
  on public.ops_registration_details;
create policy ops_registration_details_select_v2
  on public.ops_registration_details
  for select
  to authenticated
  using (
    dashboard_private.can_read_ops_task_v1(task_id)
  );

drop policy if exists ops_registration_level_tests_authenticated_select
  on public.ops_registration_level_tests;
create policy ops_registration_level_tests_select_v2
  on public.ops_registration_level_tests
  for select
  to authenticated
  using (
    dashboard_private.can_read_registration_track_v1(track_id)
  );

drop policy if exists ops_registration_consultations_authenticated_select
  on public.ops_registration_consultations;
create policy ops_registration_consultations_select_v2
  on public.ops_registration_consultations
  for select
  to authenticated
  using (
    dashboard_private.can_read_registration_track_v1(track_id)
  );

drop policy if exists ops_registration_enrollments_authenticated_select
  on public.ops_registration_enrollments;
create policy ops_registration_enrollments_select_v2
  on public.ops_registration_enrollments
  for select
  to authenticated
  using (
    dashboard_private.can_read_registration_track_v1(track_id)
  );

commit;
