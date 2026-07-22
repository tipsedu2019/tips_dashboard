begin;

set local lock_timeout = '5s';

do $$
declare
  v_candidate_count bigint;
  v_science_director_profile_id uuid;
  v_science_director_teacher_id uuid;
begin
  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(profile.id order by profile.id))[1],
    (pg_catalog.array_agg(teacher.id order by profile.id))[1]
  into v_candidate_count, v_science_director_profile_id, v_science_director_teacher_id
  from public.profiles as profile
  join auth.users as account
    on account.id = profile.id
  join public.teacher_catalogs as teacher
    on teacher.profile_id = profile.id
  where (
      pg_catalog.btrim(profile.name) = '김법균'
      or pg_catalog.btrim(teacher.name) = '김법균'
    )
    and teacher.is_visible = true
    and account.deleted_at is null
    and (
      account.banned_until is null
      or account.banned_until <= pg_catalog.now()
    );

  if v_candidate_count <> 1 then
    raise exception 'registration_science_director_candidate_count_invalid:%', v_candidate_count
      using errcode = '23514';
  end if;

  update public.teacher_catalogs as teacher
  set subjects = case
    when '과학팀' = any(teacher.subjects) then teacher.subjects
    else pg_catalog.array_append(teacher.subjects, '과학팀')
  end
  where teacher.id = v_science_director_teacher_id;

  if not exists (
    select 1
    from public.teacher_catalogs as teacher
    where teacher.id = v_science_director_teacher_id
      and teacher.profile_id = v_science_director_profile_id
      and teacher.is_visible = true
      and '과학팀' = any(teacher.subjects)
  ) or not dashboard_private.academic_subject_director_candidate_is_active_v1(
    v_science_director_profile_id,
    '과학'
  ) then
    raise exception 'registration_science_director_candidate_ineligible'
      using errcode = '23514';
  end if;

  update public.academic_subject_settings as setting
  set default_director_profile_id = v_science_director_profile_id
  where setting.subject = '과학';

  if not found then
    raise exception 'registration_science_subject_setting_missing'
      using errcode = 'P0002';
  end if;
end
$$;

create or replace function dashboard_private.delete_registration_case_v1_impl(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()),
    'task_id', p_task_id
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_consultation record;
  v_appointment record;
  v_deleted_task_id uuid;
  v_response jsonb;
begin
  if p_task_id is null or p_request_id is null then
    raise exception 'registration_case_delete_invalid' using errcode = '22023';
  end if;

  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id,
    'delete_registration_case_v1',
    v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-control-plane-workflow:registration', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || p_task_id::text, 0)
  );

  select task.* into v_task
  from public.ops_tasks as task
  where task.id = p_task_id
  for update of task;
  if not found then
    raise exception 'ops_task_not_found' using errcode = 'P0002';
  end if;

  v_actor := dashboard_private.assert_ops_task_actor_v2(v_task, null);
  if v_actor is null
    or v_role is distinct from 'admin'
    or v_task.type <> 'registration'
    or not dashboard_private.registration_task_has_subject_tracks(v_task.id)
  then
    raise exception 'ops_task_delete_forbidden' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_subject_tracks as track
  where track.task_id = v_task.id
  for update of track;

  if v_task.status in ('done', 'canceled')
    or exists (
      select 1
      from public.ops_registration_subject_tracks as track
      where track.task_id = v_task.id
        and track.pipeline_status not in (
          'inquiry',
          'migration_review',
          'level_test_scheduled',
          'level_test_in_progress',
          'consultation_waiting',
          'visit_consultation_scheduled'
        )
    )
    or exists (
      select 1
      from public.ops_registration_enrollments as enrollment
      join public.ops_registration_subject_tracks as track
        on track.id = enrollment.track_id
      where track.task_id = v_task.id
    )
    or exists (
      select 1
      from public.ops_registration_admission_batches as batch
      where batch.task_id = v_task.id
    )
    or exists (
      select 1
      from public.ops_registration_messages as message
      where message.task_id = v_task.id
    )
    or exists (
      select 1
      from public.ops_registration_enrollments as enrollment
      where enrollment.roster_release_source_task_id = v_task.id
    )
  then
    raise exception 'registration_case_delete_not_allowed' using errcode = '55000';
  end if;

  for v_consultation in
    select consultation.id
    from public.ops_registration_consultations as consultation
    join public.ops_registration_subject_tracks as track
      on track.id = consultation.track_id
    where track.task_id = v_task.id
    order by consultation.id
    for update of consultation
  loop
    perform dashboard_private.cancel_registration_phone_projection_v1(
      v_consultation.id,
      'source_canceled'
    );
  end loop;

  for v_appointment in
    select appointment.id
    from public.ops_registration_appointments as appointment
    where appointment.task_id = v_task.id
    order by appointment.id
    for update of appointment
  loop
    perform dashboard_private.cancel_registration_visit_superseded_v1(
      v_appointment.id,
      null::bigint,
      'source_canceled'
    );
    perform dashboard_private.cancel_registration_appointment_reminders_v1(
      v_appointment.id,
      'source_status_changed',
      null::integer,
      pg_catalog.clock_timestamp()
    );
  end loop;

  delete from public.ops_registration_level_tests as level_test
  using public.ops_registration_subject_tracks as track
  where level_test.track_id = track.id
    and track.task_id = v_task.id;

  delete from public.ops_registration_consultations as consultation
  using public.ops_registration_subject_tracks as track
  where consultation.track_id = track.id
    and track.task_id = v_task.id;

  delete from public.ops_registration_appointments as appointment
  where appointment.task_id = v_task.id;

  delete from public.ops_registration_subject_tracks as track
  where track.task_id = v_task.id;

  delete from public.ops_tasks as task
  where task.id = v_task.id
  returning task.id into v_deleted_task_id;

  if v_deleted_task_id is null then
    raise exception 'registration_case_delete_failed' using errcode = 'P0002';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_deleted_task_id,
    'deleted', true
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id,
    'delete_registration_case_v1',
    v_fingerprint,
    v_response
  );
end;
$$;

create or replace function public.delete_registration_case_v1(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select dashboard_private.delete_registration_case_v1_impl(p_task_id, p_request_id);
$$;

revoke all on function dashboard_private.delete_registration_case_v1_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_registration_case_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_registration_case_v1(uuid, uuid) to authenticated;

commit;
