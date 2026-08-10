begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function dashboard_private.assert_registration_observation_feedback_access_v1(
  p_observation_id uuid,
  p_access_kind text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_access jsonb;
begin
  if v_actor is null or p_access_kind is distinct from 'read' then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select pg_catalog.jsonb_build_object(
    'actorProfileId', actor.id,
    'accessKind', case
      when actor.role in ('admin', 'staff') then 'manager'
      when actor.id = observation.teacher_profile_id then 'assigned_teacher'
      else 'director'
    end
  )
  into v_access
  from public.ops_registration_observations observation
  join public.ops_registration_subject_tracks track
    on track.id = observation.track_id
   and track.task_id = observation.task_id
  join public.profiles actor
    on actor.id = v_actor
  join auth.users account
    on account.id = actor.id
   and account.deleted_at is null
   and (
     account.banned_until is null
     or account.banned_until <= pg_catalog.now()
   )
  where observation.id = p_observation_id
    and (
      actor.id = observation.teacher_profile_id
      or actor.role in ('admin', 'staff')
      or actor.id = track.director_profile_id
    )
  limit 1;

  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  return v_access;
end;
$$;

alter function dashboard_private.assert_registration_observation_feedback_access_v1(uuid, text) owner to postgres;
revoke all on function dashboard_private.assert_registration_observation_feedback_access_v1(uuid, text) from public, anon, authenticated, service_role;

create function dashboard_private.get_registration_observation_feedback_impl_v1(
  p_observation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_actor is null
    or not exists (
      select 1
      from public.profiles actor
      join auth.users account
        on account.id = actor.id
       and account.deleted_at is null
       and (
         account.banned_until is null
         or account.banned_until <= pg_catalog.now()
       )
      where actor.id = v_actor
    )
  then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_observation_feedback_access_v1(
    p_observation_id,
    'read'
  );

  select pg_catalog.jsonb_build_object(
    'observationId', observation.id,
    'taskId', observation.task_id,
    'trackId', observation.track_id,
    'appointmentId', observation.appointment_id,
    'studentName', task.student_name,
    'studentGrade', registration_detail.school_grade,
    'subject', observation.subject,
    'classId', observation.class_id,
    'className', observation.class_name_snapshot,
    'sessionAuthority', observation.session_authority,
    'sessionDate', observation.session_date,
    'sessionKey', case
      when observation.session_authority = 'normalized' then lesson.session_key
      else observation.legacy_session_key
    end,
    'classLessonSessionId', observation.class_lesson_session_id,
    'legacySessionKey', observation.legacy_session_key,
    'sourceRevision', observation.source_revision,
    'startsAt', observation.starts_at,
    'endsAt', observation.ends_at,
    'classroomName', observation.classroom_name_snapshot,
    'teacherName', observation.teacher_name_snapshot,
    'status', observation.status,
    'attendance', observation.attendance,
    'suitabilityResult', observation.suitability_result,
    'feedbackReason', observation.feedback_reason,
    'proxySubmitted', case
      when observation.feedback_submitted_by is null then false
      else observation.feedback_submitted_by <> observation.teacher_profile_id
    end,
    'feedbackSubmittedByName', feedback_submitter.name,
    'feedbackSubmittedAt', observation.feedback_submitted_at,
    'revision', observation.revision,
    'feedbackRevision', observation.feedback_revision,
    'appointmentNotificationRevision', appointment.notification_revision,
    'trackWorkflowRevision', track.workflow_revision,
    'decisionKind', observation.decision_kind
  )
  into v_result
  from public.ops_registration_observations observation
  join public.ops_registration_appointments appointment
    on appointment.id = observation.appointment_id
   and appointment.task_id = observation.task_id
   and appointment.kind = 'observation_class'
  join public.ops_registration_subject_tracks track
    on track.id = observation.track_id
   and track.task_id = observation.task_id
  join public.ops_tasks task
    on task.id = observation.task_id
   and task.type = 'registration'
  join public.ops_registration_details registration_detail
    on registration_detail.task_id = task.id
  join public.classes class
    on class.id = observation.class_id
   and class.subject = observation.subject
  join public.teacher_catalogs teacher
    on teacher.id = observation.teacher_catalog_id
  join public.profiles assigned_teacher
    on assigned_teacher.id = observation.teacher_profile_id
   and teacher.profile_id = assigned_teacher.id
  left join public.class_lesson_sessions lesson
    on lesson.id = observation.class_lesson_session_id
   and lesson.class_id = observation.class_id
  left join public.profiles feedback_submitter
    on feedback_submitter.id = observation.feedback_submitted_by
  left join auth.users feedback_submitter_account
    on feedback_submitter_account.id = feedback_submitter.id
   and feedback_submitter_account.deleted_at is null
   and (
     feedback_submitter_account.banned_until is null
     or feedback_submitter_account.banned_until <= pg_catalog.now()
   )
  where observation.id = p_observation_id
    and (
      (
        observation.session_authority = 'normalized'
        and nullif(pg_catalog.btrim(lesson.session_key), '') is not null
      )
      or (
        observation.session_authority = 'legacy'
        and lesson.id is null
        and nullif(pg_catalog.btrim(observation.legacy_session_key), '') is not null
      )
    )
    and (
      (
        observation.feedback_submitted_by is null
        and observation.feedback_submitted_at is null
      )
      or (
        observation.feedback_submitted_by is not null
        and observation.feedback_submitted_at is not null
        and feedback_submitter_account.id is not null
        and nullif(pg_catalog.btrim(feedback_submitter.name), '') is not null
      )
    );

  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

alter function dashboard_private.get_registration_observation_feedback_impl_v1(uuid) owner to postgres;
revoke all on function dashboard_private.get_registration_observation_feedback_impl_v1(uuid) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.get_registration_observation_feedback_impl_v1(uuid) to authenticated;

create function public.get_registration_observation_feedback_v1(p_observation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select dashboard_private.get_registration_observation_feedback_impl_v1(
    p_observation_id
  );
$$;

alter function public.get_registration_observation_feedback_v1(uuid) owner to postgres;
revoke all on function public.get_registration_observation_feedback_v1(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_registration_observation_feedback_v1(uuid) to authenticated;

commit;
