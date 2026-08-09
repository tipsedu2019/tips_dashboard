begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create index ops_registration_observations_track_created_idx
  on public.ops_registration_observations(track_id, created_at desc, id desc);

create or replace function dashboard_private.assert_registration_observation_manager_access_v1(
  p_track_id uuid
)
returns public.ops_registration_subject_tracks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_track public.ops_registration_subject_tracks%rowtype;
begin
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  join public.profiles actor
    on actor.id = (select auth.uid())
  join auth.users account
    on account.id = actor.id
   and account.deleted_at is null
   and (account.banned_until is null or account.banned_until <= pg_catalog.now())
  where track.id = p_track_id
    and (
      actor.role in ('admin', 'staff')
      or track.director_profile_id = actor.id
    );

  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  return v_track;
end;
$$;

create or replace function dashboard_private.list_registration_observation_sessions_v1_impl(
  p_track_id uuid,
  p_class_id uuid,
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_track public.ops_registration_subject_tracks%rowtype;
  v_class public.classes%rowtype;
  v_result jsonb;
begin
  v_track := dashboard_private.assert_registration_observation_manager_access_v1(
    p_track_id
  );
  if p_class_id is null
    or p_date_from is null
    or p_date_to is null
    or p_date_from < current_date
    or p_date_to < p_date_from
    or p_date_to - p_date_from > 120
  then
    raise exception 'registration_observation_date_range_invalid'
      using errcode = '22023';
  end if;

  select class.*
  into v_class
  from public.classes class
  where class.id = p_class_id
    and class.subject = v_track.subject
    and class.closed_at is null;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  if v_class.schedule_storage_mode = 'normalized'
    and public.continuous_class_schedule_runtime_version() = 1
  then
    with candidates as materialized (
      select
        lesson.id,
        lesson.session_date,
        lesson.start_time
      from public.class_lesson_sessions lesson
      where lesson.class_id = p_class_id
        and lesson.session_date between p_date_from and p_date_to
        and lesson.schedule_state in ('active', 'makeup')
        and lesson.start_time is not null
        and lesson.end_time is not null
        and lesson.start_time < lesson.end_time
        and (lesson.session_date + lesson.start_time) at time zone 'Asia/Seoul'
          > pg_catalog.now()
      order by lesson.session_date, lesson.start_time, lesson.id
      limit 240
    ),
    resolved as materialized (
      select
        candidate.session_date,
        candidate.start_time,
        candidate.id,
        dashboard_private.resolve_registration_observation_session_v1(
          p_track_id,
          p_class_id,
          'normalized',
          candidate.id,
          null
        ) as payload
      from candidates candidate
    )
    select coalesce(
      pg_catalog.jsonb_agg(
        resolved.payload
        order by resolved.session_date, resolved.start_time, resolved.id
      ),
      '[]'::jsonb
    )
    into v_result
    from resolved;
  elsif v_class.schedule_storage_mode in ('legacy', 'shadow') then
    with source_sessions as materialized (
      select session.value
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'sessions') = 'array'
            then v_class.schedule_plan -> 'sessions'
          when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'session_list') = 'array'
            then v_class.schedule_plan -> 'session_list'
          else '[]'::jsonb
        end
      ) session(value)
    ),
    canonical as materialized (
      select
        source.value,
        coalesce(
          nullif(pg_catalog.btrim(source.value ->> 'sessionKey'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'session_key'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'id'), '')
        ) as session_key,
        coalesce(
          nullif(pg_catalog.btrim(source.value ->> 'date'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'sessionDate'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'session_date'), '')
        ) as session_date_text,
        case pg_catalog.lower(coalesce(
          nullif(pg_catalog.btrim(source.value ->> 'scheduleState'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'schedule_state'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'state'), ''),
          'active'
        ))
          when 'normal' then 'active'
          else pg_catalog.lower(coalesce(
            nullif(pg_catalog.btrim(source.value ->> 'scheduleState'), ''),
            nullif(pg_catalog.btrim(source.value ->> 'schedule_state'), ''),
            nullif(pg_catalog.btrim(source.value ->> 'state'), ''),
            'active'
          ))
        end as schedule_state
      from source_sessions source
    ),
    dated as materialized (
      select
        canonical.session_key,
        case
          when canonical.session_date_text ~ '^\d{4}-\d{2}-\d{2}$'
            then canonical.session_date_text::date
          else null
        end as session_date
      from canonical
      where canonical.session_key is not null
        and canonical.schedule_state in ('active', 'makeup')
    ),
    candidates as materialized (
      select dated.session_key, dated.session_date
      from dated
      cross join lateral (
        select
          pg_catalog.count(*)::integer as slot_count,
          pg_catalog.min(slot.start_time) as start_time
        from public.class_schedule_slots slot
        where slot.class_id = p_class_id
          and slot.weekday = extract(dow from dated.session_date)::smallint
      ) slot_fact
      where dated.session_date between p_date_from and p_date_to
        and (
          slot_fact.slot_count <> 1
          or (dated.session_date + slot_fact.start_time) at time zone 'Asia/Seoul'
            > pg_catalog.now()
        )
      order by dated.session_date, dated.session_key
      limit 240
    ),
    resolved as materialized (
      select
        candidate.session_date,
        candidate.session_key,
        dashboard_private.resolve_registration_observation_session_v1(
          p_track_id,
          p_class_id,
          'legacy',
          null,
          candidate.session_key
        ) as payload
      from candidates candidate
    )
    select coalesce(
      pg_catalog.jsonb_agg(
        resolved.payload
        order by resolved.session_date,
          (resolved.payload ->> 'startsAt')::timestamptz,
          resolved.session_key
      ),
      '[]'::jsonb
    )
    into v_result
    from resolved;
  else
    raise exception 'registration_observation_session_invalid'
      using errcode = '22023';
  end if;

  return v_result;
end;
$$;

create or replace function dashboard_private.registration_observation_attempt_payload_v1(
  p_observation public.ops_registration_observations,
  p_appointment public.ops_registration_appointments,
  p_session_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'observationId', p_observation.id,
    'taskId', p_observation.task_id,
    'trackId', p_observation.track_id,
    'appointmentId', p_observation.appointment_id,
    'appointmentStatus', p_appointment.status,
    'classId', p_observation.class_id,
    'subject', p_observation.subject,
    'className', p_observation.class_name_snapshot,
    'sessionAuthority', p_observation.session_authority,
    'classLessonSessionId', p_observation.class_lesson_session_id,
    'legacySessionKey', p_observation.legacy_session_key,
    'sessionKey', p_session_key,
    'scheduleState', p_observation.session_schedule_state,
    'sessionDate', p_observation.session_date,
    'startsAt', p_observation.starts_at,
    'endsAt', p_observation.ends_at,
    'sessionSourceRevision', p_observation.session_source_revision,
    'legacySessionSourceHash', p_observation.legacy_session_source_hash,
    'sourceRevision', p_observation.source_revision,
    'teacherCatalogId', p_observation.teacher_catalog_id,
    'teacherProfileId', p_observation.teacher_profile_id,
    'teacherName', p_observation.teacher_name_snapshot,
    'classroomCatalogId', p_observation.classroom_catalog_id,
    'classroomName', p_observation.classroom_name_snapshot,
    'campus', p_observation.campus,
    'textbooks', p_observation.textbook_snapshot,
    'progress', p_observation.progress_snapshot,
    'bookingFactHash', p_observation.booking_fact_hash,
    'status', p_observation.status,
    'attendance', p_observation.attendance,
    'suitabilityResult', p_observation.suitability_result,
    'decisionKind', p_observation.decision_kind,
    'revision', p_observation.revision,
    'feedbackRevision', p_observation.feedback_revision,
    'appointmentNotificationRevision', p_appointment.notification_revision,
    'createdAt', p_observation.created_at,
    'updatedAt', p_observation.updated_at
  );
$$;

create or replace function dashboard_private.assert_registration_observation_attempt_limit_v1(
  p_attempt_limit integer
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_attempt_limit is null or p_attempt_limit not between 1 and 50 then
    raise exception 'registration_observation_attempt_limit_invalid'
      using errcode = '22023';
  end if;

  return p_attempt_limit;
end;
$$;

create or replace function dashboard_private.registration_observation_manager_detail_rows_v1(
  p_track_id uuid,
  p_attempt_limit integer
)
returns table(
  row_kind text,
  payload jsonb,
  sort_created_at timestamptz,
  sort_id uuid,
  sort_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorized as materialized (
    select dashboard_private.assert_registration_observation_manager_access_v1($1) as track
  ),
  validated as materialized (
    select
      authorized.track,
      dashboard_private.assert_registration_observation_attempt_limit_v1($2) as attempt_limit
    from authorized
  ),
  track_row(row_kind, payload, sort_created_at, sort_id, sort_name) as materialized (
    select
      'track'::text,
      pg_catalog.jsonb_build_object(
        'trackId', (input.track).id,
        'taskId', (input.track).task_id,
        'subject', (input.track).subject,
        'workflowStatus', (input.track).workflow_status,
        'workflowRevision', (input.track).workflow_revision,
        'observationReturnWorkflowStatus', (input.track).observation_return_workflow_status,
        'directorProfileId', (input.track).director_profile_id
      ),
      null::timestamptz,
      (input.track).id,
      null::text
    from validated input
  ),
  attempt_rows(row_kind, payload, sort_created_at, sort_id, sort_name) as materialized (
    select
      'attempt'::text,
      dashboard_private.registration_observation_attempt_payload_v1(
        bounded.observation_row,
        bounded.appointment_row,
        bounded.session_key
      ),
      bounded.created_at,
      bounded.id,
      null::text
    from validated input
    cross join lateral (
      select
        observation as observation_row,
        appointment as appointment_row,
        coalesce(lesson.session_key, observation.legacy_session_key) as session_key,
        observation.created_at,
        observation.id
      from public.ops_registration_observations observation
      join public.ops_registration_appointments appointment
        on appointment.id = observation.appointment_id
       and appointment.task_id = observation.task_id
      left join public.class_lesson_sessions lesson
        on lesson.id = observation.class_lesson_session_id
       and lesson.class_id = observation.class_id
      where observation.track_id = (input.track).id
        and observation.task_id = (input.track).task_id
      order by observation.created_at desc, observation.id desc
      limit input.attempt_limit
    ) bounded
  ),
  current_row(row_kind, payload, sort_created_at, sort_id, sort_name) as materialized (
    select
      'current'::text,
      dashboard_private.registration_observation_attempt_payload_v1(
        bounded.observation_row,
        bounded.appointment_row,
        bounded.session_key
      ),
      bounded.created_at,
      bounded.id,
      null::text
    from validated input
    cross join lateral (
      select
        observation as observation_row,
        appointment as appointment_row,
        coalesce(lesson.session_key, observation.legacy_session_key) as session_key,
        observation.created_at,
        observation.id
      from public.ops_registration_observations observation
      join public.ops_registration_appointments appointment
        on appointment.id = observation.appointment_id
       and appointment.task_id = observation.task_id
      left join public.class_lesson_sessions lesson
        on lesson.id = observation.class_lesson_session_id
       and lesson.class_id = observation.class_id
      where observation.track_id = (input.track).id
        and observation.task_id = (input.track).task_id
        and observation.decision_kind is null
        and observation.status in (
          'scheduled',
          'attended_feedback_pending',
          'completed',
          'no_show'
        )
      limit 1
    ) bounded
  ),
  latest_enrollment_row(row_kind, payload, sort_created_at, sort_id, sort_name) as materialized (
    select
      'latest_enrollment'::text,
      pg_catalog.to_jsonb(bounded.id),
      bounded.created_at,
      bounded.id,
      null::text
    from validated input
    cross join lateral (
      select recent.id, recent.created_at
      from (values
        ('scheduled'::text),
        ('attended_feedback_pending'),
        ('completed'),
        ('no_show'),
        ('canceled')
      ) status_candidate(status)
      cross join lateral (
        select observation.id, observation.created_at
        from public.ops_registration_observations observation
        where observation.track_id = (input.track).id
          and observation.decision_kind = 'enrollment'
          and observation.status = status_candidate.status
        order by observation.created_at desc, observation.id desc
        limit 1
      ) recent
      order by recent.created_at desc, recent.id desc
      limit 1
    ) bounded
  ),
  class_rows(row_kind, payload, sort_created_at, sort_id, sort_name) as materialized (
    select
      'class'::text,
      pg_catalog.jsonb_build_object(
        'id', bounded.id,
        'name', bounded.name,
        'subject', bounded.subject
      ),
      null::timestamptz,
      bounded.id,
      bounded.name
    from validated input
    cross join lateral (
      select class.id, class.name, class.subject
      from public.classes class
      where class.subject = (input.track).subject
        and class.closed_at is null
      order by class.name, class.id
      limit 100
    ) bounded
  )
  select * from track_row
  union all
  select * from attempt_rows
  union all
  select * from current_row
  union all
  select * from latest_enrollment_row
  union all
  select * from class_rows;
$$;

create or replace function dashboard_private.registration_observation_manager_attempt_read_v1(
  p_track_id uuid,
  p_observation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with authorized as materialized (
    select dashboard_private.assert_registration_observation_manager_access_v1($1) as track
  )
  select pg_catalog.jsonb_build_object(
    'trackId', (input.track).id,
    'taskId', (input.track).task_id,
    'observation', dashboard_private.registration_observation_attempt_payload_v1(
      bounded.observation_row,
      bounded.appointment_row,
      bounded.session_key
    )
  )
  from authorized input
  cross join lateral (
    select
      observation as observation_row,
      appointment as appointment_row,
      coalesce(lesson.session_key, observation.legacy_session_key) as session_key
    from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
     and appointment.task_id = observation.task_id
    join public.ops_tasks task
      on task.id = observation.task_id
     and task.id = (input.track).task_id
     and task.type = 'registration'
    left join public.class_lesson_sessions lesson
      on lesson.id = observation.class_lesson_session_id
     and lesson.class_id = observation.class_id
    where observation.id = $2
      and observation.track_id = (input.track).id
      and observation.task_id = (input.track).task_id
      and nullif(pg_catalog.btrim(
        coalesce(lesson.session_key, observation.legacy_session_key)
      ), '') is not null
    limit 1
  ) bounded;
$$;

create or replace function dashboard_private.get_registration_observation_manager_detail_v1_impl(
  p_track_id uuid,
  p_attempt_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with shared_rows as materialized (
    select *
    from dashboard_private.registration_observation_manager_detail_rows_v1(
      p_track_id,
      p_attempt_limit
    )
  )
  select pg_catalog.jsonb_build_object(
    'track', (
      select row.payload
      from shared_rows row
      where row.row_kind = 'track'
      limit 1
    ),
    'currentObservation', (
      select row.payload
      from shared_rows row
      where row.row_kind = 'current'
      limit 1
    ),
    'latestEnrollmentDecisionObservationId', (
      select row.payload
      from shared_rows row
      where row.row_kind = 'latest_enrollment'
      limit 1
    ),
    'attempts', coalesce((
      select pg_catalog.jsonb_agg(
        row.payload
        order by row.sort_created_at desc, row.sort_id desc
      )
      from shared_rows row
      where row.row_kind = 'attempt'
    ), '[]'::jsonb),
    'classes', coalesce((
      select pg_catalog.jsonb_agg(
        row.payload
        order by row.sort_name, row.sort_id
      )
      from shared_rows row
      where row.row_kind = 'class'
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function dashboard_private.get_registration_observation_manager_attempt_v1_impl(
  p_track_id uuid,
  p_observation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := dashboard_private.registration_observation_manager_attempt_read_v1(
    p_track_id,
    p_observation_id
  );

  if v_result is null then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

create or replace function public.list_registration_observation_sessions_v1(
  p_track_id uuid,
  p_class_id uuid,
  p_date_from date,
  p_date_to date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select dashboard_private.list_registration_observation_sessions_v1_impl(
    p_track_id,
    p_class_id,
    p_date_from,
    p_date_to
  );
$$;

create or replace function public.get_registration_observation_manager_detail_v1(
  p_track_id uuid,
  p_attempt_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select dashboard_private.get_registration_observation_manager_detail_v1_impl(
    p_track_id,
    p_attempt_limit
  );
$$;

create or replace function public.get_registration_observation_manager_attempt_v1(
  p_track_id uuid,
  p_observation_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select dashboard_private.get_registration_observation_manager_attempt_v1_impl(
    p_track_id,
    p_observation_id
  );
$$;

create or replace view public.ops_registration_subject_track_summaries
with (security_invoker = true)
as
select
  track.id,
  track.task_id,
  track.subject,
  track.pipeline_status,
  track.director_profile_id,
  track.director_assignment_source,
  track.director_assignment_rule_key,
  track.waiting_kind,
  track.level_test_retake_decision,
  track.migration_review_required,
  track.stage_entered_at,
  track.updated_at,
  active_visit.scheduled_at as visit_scheduled_at,
  active_visit.place as visit_place,
  active_phone.ready_at as phone_ready_at,
  active_phone.ready_source as phone_ready_source,
  track.workflow_status,
  track.workflow_revision,
  track.workflow_status_entered_at,
  track.waiting_detail_kind,
  track.waiting_detail_class_id,
  track.waiting_detail_retake_decision,
  track.enrollment_detail_rows,
  active_level_test.scheduled_at as level_test_scheduled_at,
  active_level_test.place as level_test_place,
  case when observation_manager.allowed is true
    then track.observation_attempt_count else null
  end as observation_attempt_count,
  case when observation_manager.allowed is true
    then current_observation.id else null
  end as observation_current_id,
  case when observation_manager.allowed is true
    then current_observation.status else null
  end as observation_current_status,
  case when observation_manager.allowed is true
    then current_observation.appointment_id else null
  end as observation_current_appointment_id,
  case when observation_manager.allowed is true
    then current_observation.scheduled_at else null
  end as observation_nearest_scheduled_at,
  case when observation_manager.allowed is true
    then current_observation.place else null
  end as observation_nearest_place,
  case when observation_manager.allowed is true
    then current_observation.notification_revision else null
  end as observation_notification_revision,
  case when observation_manager.allowed is true
    then current_observation.revision else null
  end as observation_revision,
  case when observation_manager.allowed is true
    then current_observation.feedback_revision else null
  end as observation_feedback_revision
from public.ops_registration_subject_tracks track
left join lateral (
  select true as allowed
  where (select public.current_dashboard_role()) in ('admin', 'staff')
    or dashboard_private.registration_observation_track_director_profile_id_matches_v1(
      track.id
    )
  limit 1
) observation_manager on true
left join lateral (
  select appointment.scheduled_at, appointment.place
  from public.ops_registration_consultations consultation
  join public.ops_registration_appointments appointment
    on appointment.id = consultation.appointment_id
  where consultation.track_id = track.id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
    and appointment.kind = 'visit_consultation'
    and appointment.status = 'scheduled'
  order by consultation.created_at desc, consultation.id desc
  limit 1
) active_visit on true
left join lateral (
  select consultation.ready_at, consultation.ready_source
  from public.ops_registration_consultations consultation
  where consultation.track_id = track.id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.created_at desc, consultation.id desc
  limit 1
) active_phone on true
left join lateral (
  select appointment.scheduled_at, appointment.place
  from public.ops_registration_level_tests level_test
  join public.ops_registration_appointments appointment
    on appointment.id = level_test.appointment_id
  where level_test.track_id = track.id
    and level_test.status in ('scheduled', 'in_progress')
    and appointment.kind = 'level_test'
    and appointment.status = 'scheduled'
  order by level_test.attempt_number desc,
    level_test.created_at desc,
    level_test.id desc
  limit 1
) active_level_test on true
left join lateral (
  select
    observation.id,
    observation.status,
    observation.appointment_id,
    observation.revision,
    observation.feedback_revision,
    appointment.scheduled_at,
    appointment.place,
    appointment.notification_revision
  from public.ops_registration_observations observation
  join public.ops_registration_appointments appointment
    on appointment.id = observation.appointment_id
   and appointment.task_id = observation.task_id
  where observation.track_id = track.id
    and observation.decision_kind is null
    and observation.status in (
      'scheduled',
      'attended_feedback_pending',
      'completed',
      'no_show'
    )
  limit 1
) current_observation on true;

alter function dashboard_private.assert_registration_observation_manager_access_v1(uuid)
  owner to postgres;
alter function dashboard_private.list_registration_observation_sessions_v1_impl(uuid, uuid, date, date)
  owner to postgres;
alter function dashboard_private.registration_observation_attempt_payload_v1(public.ops_registration_observations, public.ops_registration_appointments, text)
  owner to postgres;
alter function dashboard_private.assert_registration_observation_attempt_limit_v1(integer)
  owner to postgres;
alter function dashboard_private.registration_observation_manager_detail_rows_v1(uuid, integer)
  owner to postgres;
alter function dashboard_private.registration_observation_manager_attempt_read_v1(uuid, uuid)
  owner to postgres;
alter function dashboard_private.get_registration_observation_manager_detail_v1_impl(uuid, integer)
  owner to postgres;
alter function dashboard_private.get_registration_observation_manager_attempt_v1_impl(uuid, uuid)
  owner to postgres;
alter function public.list_registration_observation_sessions_v1(uuid, uuid, date, date)
  owner to postgres;
alter function public.get_registration_observation_manager_detail_v1(uuid, integer)
  owner to postgres;
alter function public.get_registration_observation_manager_attempt_v1(uuid, uuid)
  owner to postgres;

revoke all on function dashboard_private.assert_registration_observation_manager_access_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_attempt_payload_v1(public.ops_registration_observations, public.ops_registration_appointments, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_observation_attempt_limit_v1(integer)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_manager_detail_rows_v1(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_manager_attempt_read_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function dashboard_private.list_registration_observation_sessions_v1_impl(uuid, uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.get_registration_observation_manager_detail_v1_impl(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.get_registration_observation_manager_attempt_v1_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.list_registration_observation_sessions_v1_impl(uuid, uuid, date, date)
  to authenticated;
grant execute on function dashboard_private.get_registration_observation_manager_detail_v1_impl(uuid, integer)
  to authenticated;
grant execute on function dashboard_private.get_registration_observation_manager_attempt_v1_impl(uuid, uuid)
  to authenticated;

revoke all on function public.list_registration_observation_sessions_v1(uuid, uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_registration_observation_manager_detail_v1(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_registration_observation_manager_attempt_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_registration_observation_sessions_v1(uuid, uuid, date, date)
  to authenticated;
grant execute on function public.get_registration_observation_manager_detail_v1(uuid, integer)
  to authenticated;
grant execute on function public.get_registration_observation_manager_attempt_v1(uuid, uuid)
  to authenticated;

revoke all on table public.ops_registration_subject_track_summaries
  from public, anon, service_role;
grant select on table public.ops_registration_subject_track_summaries
  to authenticated;

create or replace function dashboard_private.registration_observation_booking_fact_hash_v1(
  p_fact jsonb
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select dashboard_private.continuous_class_schedule_hash_v1(
    pg_catalog.jsonb_build_object(
      'classId', p_fact -> 'classId',
      'subject', p_fact -> 'subject',
      'sessionAuthority', p_fact -> 'sessionAuthority',
      'classLessonSessionId', p_fact -> 'classLessonSessionId',
      'legacySessionKey', p_fact -> 'legacySessionKey',
      'sessionKey', p_fact -> 'sessionKey',
      'scheduleState', p_fact -> 'scheduleState',
      'sessionDate', p_fact -> 'sessionDate',
      'startsAt', p_fact -> 'startsAt',
      'endsAt', p_fact -> 'endsAt',
      'teacherCatalogId', p_fact -> 'teacherCatalogId',
      'teacherProfileId', p_fact -> 'teacherProfileId',
      'teacherName', p_fact -> 'teacherName',
      'classroomCatalogId', p_fact -> 'classroomCatalogId',
      'classroomName', p_fact -> 'classroomName',
      'campus', p_fact -> 'campus'
    )
  );
$$;

create or replace function dashboard_private.registration_observation_legacy_session_content_hash_v1(
  p_schedule_plan jsonb,
  p_session_key text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sessions jsonb;
  v_row record;
  v_row_key text;
  v_seen_keys text[] := array[]::text[];
  v_selected_count integer := 0;
  v_selected_session jsonb;
  v_canonical_session_key text;
  v_envelope jsonb;
begin
  if nullif(pg_catalog.btrim(p_session_key), '') is null then
    raise exception 'registration_observation_legacy_session_invalid'
      using errcode = '22023';
  end if;

  v_sessions := case
    when pg_catalog.jsonb_typeof(p_schedule_plan -> 'sessions') = 'array'
      then p_schedule_plan -> 'sessions'
    when pg_catalog.jsonb_typeof(p_schedule_plan -> 'session_list') = 'array'
      then p_schedule_plan -> 'session_list'
    else '[]'::jsonb
  end;

  for v_row in
    select session.value
    from pg_catalog.jsonb_array_elements(v_sessions) session(value)
  loop
    v_row_key := coalesce(
      nullif(pg_catalog.btrim(v_row.value ->> 'sessionKey'), ''),
      nullif(pg_catalog.btrim(v_row.value ->> 'session_key'), ''),
      nullif(pg_catalog.btrim(v_row.value ->> 'id'), '')
    );
    if v_row_key is null or v_row_key = any(v_seen_keys) then
      raise exception 'registration_observation_legacy_session_invalid'
        using errcode = '22023';
    end if;
    v_seen_keys := pg_catalog.array_append(v_seen_keys, v_row_key);
    if v_row_key = p_session_key then
      v_selected_count := v_selected_count + 1;
      v_selected_session := v_row.value;
    end if;
  end loop;

  if v_selected_count <> 1 then
    raise exception 'registration_observation_legacy_session_invalid'
      using errcode = '22023';
  end if;

  v_canonical_session_key := p_session_key;
  v_envelope := pg_catalog.jsonb_build_object(
    'textbooks',
    coalesce((
      select pg_catalog.jsonb_agg(book.value order by book.ordinality)
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(p_schedule_plan -> 'textbooks') = 'array'
            then p_schedule_plan -> 'textbooks'
          else '[]'::jsonb
        end
      ) with ordinality book(value, ordinality)
      where nullif(pg_catalog.btrim(book.value ->> 'textbookId'), '') in (
        select nullif(pg_catalog.btrim(entry.value ->> 'textbookId'), '')
        from pg_catalog.jsonb_array_elements(
          case
            when pg_catalog.jsonb_typeof(v_selected_session -> 'textbookEntries') = 'array'
              then v_selected_session -> 'textbookEntries'
            else '[]'::jsonb
          end
        ) entry(value)
      )
    ), '[]'::jsonb),
    'sessions',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sessionKey', v_canonical_session_key,
      'textbookEntries',
      case
        when pg_catalog.jsonb_typeof(v_selected_session -> 'textbookEntries') = 'array'
          then v_selected_session -> 'textbookEntries'
        else '[]'::jsonb
      end
    ))
  );

  return dashboard_private.continuous_class_schedule_content_hash_v1(v_envelope);
end;
$$;

create or replace function dashboard_private.resolve_registration_observation_session_v1(
  p_track_id uuid,
  p_class_id uuid,
  p_session_authority text,
  p_class_lesson_session_id uuid,
  p_legacy_session_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_track public.ops_registration_subject_tracks%rowtype;
  v_class public.classes%rowtype;
  v_lesson public.class_lesson_sessions%rowtype;
  v_slot public.class_schedule_slots%rowtype;
  v_teacher public.teacher_catalogs%rowtype;
  v_classroom public.classroom_catalogs%rowtype;
  v_sessions jsonb;
  v_row record;
  v_row_key text;
  v_seen_keys text[] := array[]::text[];
  v_selected_count integer := 0;
  v_selected_session jsonb := '{}'::jsonb;
  v_session_key text;
  v_schedule_state text;
  v_session_date date;
  v_start_time time;
  v_end_time time;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_session_source_revision bigint;
  v_legacy_session_source_hash text;
  v_source_revision jsonb;
  v_teacher_catalog_id uuid;
  v_classroom_catalog_id uuid;
  v_teacher_name_fallback text;
  v_classroom_name_fallback text;
  v_catalog_count integer;
  v_slot_count integer;
  v_textbook_entries jsonb;
  v_textbooks jsonb;
  v_progress_value text;
  v_progress text;
  v_booking_fact jsonb;
  v_booking_fact_hash text;
begin
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  where track.id = p_track_id;

  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select class.*
  into v_class
  from public.classes class
  where class.id = p_class_id
    and class.subject = v_track.subject
    and class.closed_at is null;

  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  if p_session_authority = 'normalized' then
    if public.continuous_class_schedule_runtime_version() <> 1
      or not (v_class.schedule_storage_mode = 'normalized')
      or p_class_lesson_session_id is null
      or p_legacy_session_key is not null
    then
      raise exception 'registration_observation_session_invalid'
        using errcode = '22023';
    end if;

    select lesson.*
    into v_lesson
    from public.class_lesson_sessions lesson
    where lesson.id = p_class_lesson_session_id
      and lesson.class_id = p_class_id
      and lesson.schedule_state in ('active', 'makeup')
      and lesson.start_time is not null
      and lesson.end_time is not null
      and lesson.start_time < lesson.end_time;

    if not found or nullif(pg_catalog.btrim(v_lesson.session_key), '') is null then
      raise exception 'registration_observation_session_invalid'
        using errcode = '22023';
    end if;

    v_session_key := v_lesson.session_key;
    v_schedule_state := v_lesson.schedule_state;
    v_session_date := v_lesson.session_date;
    v_start_time := v_lesson.start_time;
    v_end_time := v_lesson.end_time;
    v_session_source_revision := v_lesson.revision;
    v_teacher_catalog_id := v_lesson.teacher_catalog_id;
    v_classroom_catalog_id := v_lesson.classroom_catalog_id;
    v_teacher_name_fallback := nullif(pg_catalog.btrim(v_lesson.teacher_name_snapshot), '');
    v_classroom_name_fallback := nullif(pg_catalog.btrim(v_lesson.classroom_name_snapshot), '');

    v_sessions := case
      when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'sessions') = 'array'
        then v_class.schedule_plan -> 'sessions'
      when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'session_list') = 'array'
        then v_class.schedule_plan -> 'session_list'
      else '[]'::jsonb
    end;
    for v_row in
      select session.value
      from pg_catalog.jsonb_array_elements(v_sessions) session(value)
    loop
      v_row_key := coalesce(
        nullif(pg_catalog.btrim(v_row.value ->> 'sessionKey'), ''),
        nullif(pg_catalog.btrim(v_row.value ->> 'session_key'), ''),
        nullif(pg_catalog.btrim(v_row.value ->> 'id'), '')
      );
      if v_row_key = v_session_key then
        v_selected_count := v_selected_count + 1;
        v_selected_session := v_row.value;
      end if;
    end loop;
    if v_selected_count > 1 then
      raise exception 'registration_observation_session_invalid'
        using errcode = '22023';
    end if;

    v_source_revision := pg_catalog.jsonb_build_object(
      'authority', 'normalized',
      'sessionId', p_class_lesson_session_id,
      'revision', v_session_source_revision
    );
  elsif p_session_authority = 'legacy' then
    if not (v_class.schedule_storage_mode in ('legacy', 'shadow'))
      or p_class_lesson_session_id is not null
      or nullif(pg_catalog.btrim(p_legacy_session_key), '') is null
    then
      raise exception 'registration_observation_legacy_session_invalid'
        using errcode = '22023';
    end if;

    v_sessions := case
      when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'sessions') = 'array'
        then v_class.schedule_plan -> 'sessions'
      when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'session_list') = 'array'
        then v_class.schedule_plan -> 'session_list'
      else '[]'::jsonb
    end;

    for v_row in
      select session.value
      from pg_catalog.jsonb_array_elements(v_sessions) session(value)
    loop
      v_row_key := coalesce(
        nullif(pg_catalog.btrim(v_row.value ->> 'sessionKey'), ''),
        nullif(pg_catalog.btrim(v_row.value ->> 'session_key'), ''),
        nullif(pg_catalog.btrim(v_row.value ->> 'id'), '')
      );
      if v_row_key is null or v_row_key = any(v_seen_keys) then
        raise exception 'registration_observation_legacy_session_invalid'
          using errcode = '22023';
      end if;
      v_seen_keys := pg_catalog.array_append(v_seen_keys, v_row_key);
      if v_row_key = p_legacy_session_key then
        v_selected_count := v_selected_count + 1;
        v_selected_session := v_row.value;
      end if;
    end loop;

    if v_selected_count <> 1 then
      raise exception 'registration_observation_legacy_session_invalid'
        using errcode = '22023';
    end if;

    v_session_key := p_legacy_session_key;
    begin
      v_session_date := coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'date'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'sessionDate'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'session_date'), '')
      )::date;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'registration_observation_legacy_session_invalid'
          using errcode = '22023';
    end;
    if v_session_date is null then
      raise exception 'registration_observation_legacy_session_invalid'
        using errcode = '22023';
    end if;

    v_schedule_state := pg_catalog.lower(coalesce(
      nullif(pg_catalog.btrim(v_selected_session ->> 'scheduleState'), ''),
      nullif(pg_catalog.btrim(v_selected_session ->> 'schedule_state'), ''),
      nullif(pg_catalog.btrim(v_selected_session ->> 'state'), ''),
      'active'
    ));
    v_schedule_state := case v_schedule_state
      when 'normal' then 'active'
      else v_schedule_state
    end;
    if v_schedule_state not in ('active', 'makeup') then
      raise exception 'registration_observation_legacy_session_invalid'
        using errcode = '22023';
    end if;

    select count(*)
    into v_slot_count
    from public.class_schedule_slots slot
    where slot.class_id = p_class_id
      and slot.weekday = extract(dow from v_session_date)::smallint;
    if v_slot_count <> 1 then
      raise exception 'registration_observation_session_time_ambiguous'
        using errcode = '22023';
    end if;

    select slot.*
    into v_slot
    from public.class_schedule_slots slot
    where slot.class_id = p_class_id
      and slot.weekday = extract(dow from v_session_date)::smallint
    limit 1;
    v_start_time := v_slot.start_time;
    v_end_time := v_slot.end_time;

    begin
      v_teacher_catalog_id := coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'teacherCatalogId'), '')::uuid,
        nullif(pg_catalog.btrim(v_selected_session ->> 'teacher_catalog_id'), '')::uuid,
        v_slot.teacher_catalog_id
      );
      v_classroom_catalog_id := coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'classroomCatalogId'), '')::uuid,
        nullif(pg_catalog.btrim(v_selected_session ->> 'classroom_catalog_id'), '')::uuid,
        v_slot.classroom_catalog_id
      );
    exception
      when invalid_text_representation then
        raise exception 'registration_observation_legacy_session_invalid'
          using errcode = '22023';
    end;
    v_teacher_name_fallback := coalesce(
      nullif(pg_catalog.btrim(v_selected_session ->> 'teacherName'), ''),
      nullif(pg_catalog.btrim(v_selected_session ->> 'teacher_name'), ''),
      nullif(pg_catalog.btrim(v_slot.teacher_name), ''),
      nullif(pg_catalog.btrim(v_class.teacher), '')
    );
    v_classroom_name_fallback := coalesce(
      nullif(pg_catalog.btrim(v_selected_session ->> 'classroomName'), ''),
      nullif(pg_catalog.btrim(v_selected_session ->> 'classroom_name'), ''),
      nullif(pg_catalog.btrim(v_slot.classroom_name), ''),
      nullif(pg_catalog.btrim(v_class.room), '')
    );

    v_legacy_session_source_hash :=
      dashboard_private.registration_observation_legacy_session_content_hash_v1(
        v_class.schedule_plan,
        v_session_key
      );
    v_source_revision := pg_catalog.jsonb_build_object(
      'authority', 'legacy',
      'sessionKey', v_session_key,
      'contentHash', v_legacy_session_source_hash
    );
  else
    raise exception 'registration_observation_session_invalid'
      using errcode = '22023';
  end if;

  v_starts_at := (v_session_date + v_start_time) at time zone 'Asia/Seoul';
  v_ends_at := (v_session_date + v_end_time) at time zone 'Asia/Seoul';
  if v_start_time is null
    or v_end_time is null
    or v_start_time >= v_end_time
    or v_starts_at <= pg_catalog.now()
  then
    raise exception 'registration_observation_session_invalid'
      using errcode = '22023';
  end if;

  if v_teacher_catalog_id is not null then
    select teacher.*
    into v_teacher
    from public.teacher_catalogs teacher
    where teacher.id = v_teacher_catalog_id
      and teacher.is_visible = true
      and teacher.profile_id is not null
      and (pg_catalog.cardinality(teacher.subjects) = 0 or v_track.subject = any(teacher.subjects));
  elsif p_session_authority = 'legacy' then
    select count(*)
    into v_catalog_count
    from public.teacher_catalogs teacher
    where teacher.is_visible = true
      and teacher.profile_id is not null
      and pg_catalog.lower(teacher.name) = pg_catalog.lower(v_teacher_name_fallback)
      and (pg_catalog.cardinality(teacher.subjects) = 0 or v_track.subject = any(teacher.subjects));
    if v_catalog_count = 1 then
      select teacher.*
      into v_teacher
      from public.teacher_catalogs teacher
      where teacher.is_visible = true
        and teacher.profile_id is not null
        and pg_catalog.lower(teacher.name) = pg_catalog.lower(v_teacher_name_fallback)
        and (pg_catalog.cardinality(teacher.subjects) = 0 or v_track.subject = any(teacher.subjects));
    end if;
  end if;
  if v_teacher.id is null
    or not dashboard_private.notification_profile_is_active_v1(v_teacher.profile_id)
  then
    raise exception 'registration_observation_session_invalid'
      using errcode = '22023';
  end if;

  if v_classroom_catalog_id is not null then
    select classroom.*
    into v_classroom
    from public.classroom_catalogs classroom
    where classroom.id = v_classroom_catalog_id
      and classroom.is_visible = true
      and classroom.campus in ('본관', '별관')
      and (pg_catalog.cardinality(classroom.subjects) = 0 or v_track.subject = any(classroom.subjects));
  elsif p_session_authority = 'legacy' then
    select count(*)
    into v_catalog_count
    from public.classroom_catalogs classroom
    where classroom.is_visible = true
      and classroom.campus in ('본관', '별관')
      and pg_catalog.lower(classroom.name) = pg_catalog.lower(v_classroom_name_fallback)
      and (pg_catalog.cardinality(classroom.subjects) = 0 or v_track.subject = any(classroom.subjects));
    if v_catalog_count = 1 then
      select classroom.*
      into v_classroom
      from public.classroom_catalogs classroom
      where classroom.is_visible = true
        and classroom.campus in ('본관', '별관')
        and pg_catalog.lower(classroom.name) = pg_catalog.lower(v_classroom_name_fallback)
        and (pg_catalog.cardinality(classroom.subjects) = 0 or v_track.subject = any(classroom.subjects));
    end if;
  end if;
  if v_classroom.id is null then
    raise exception 'registration_observation_session_invalid'
      using errcode = '22023';
  end if;

  v_textbook_entries := case
    when pg_catalog.jsonb_typeof(v_selected_session -> 'textbookEntries') = 'array'
      then v_selected_session -> 'textbookEntries'
    else '[]'::jsonb
  end;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'textbookId', nullif(pg_catalog.btrim(entry.value ->> 'textbookId'), ''),
        'title', coalesce(
          nullif(pg_catalog.btrim(book.value ->> 'title'), ''),
          nullif(pg_catalog.btrim(book.value ->> 'name'), ''),
          nullif(pg_catalog.btrim(entry.value ->> 'textbookTitle'), ''),
          '교재 ' || entry.ordinality::text
        ),
        'planLabel', coalesce(
          nullif(pg_catalog.btrim(entry.value -> 'plan' ->> 'label'), ''),
          nullif(pg_catalog.btrim(entry.value ->> 'planLabel'), ''),
          ''
        ),
        'memo', coalesce(
          nullif(pg_catalog.btrim(entry.value -> 'plan' ->> 'memo'), ''),
          nullif(pg_catalog.btrim(entry.value ->> 'memo'), ''),
          ''
        )
      )
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
  into v_textbooks
  from pg_catalog.jsonb_array_elements(v_textbook_entries)
    with ordinality entry(value, ordinality)
  left join lateral (
    select textbook.value
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'textbooks') = 'array'
          then v_class.schedule_plan -> 'textbooks'
        else '[]'::jsonb
      end
    ) textbook(value)
    where nullif(pg_catalog.btrim(textbook.value ->> 'textbookId'), '')
      = nullif(pg_catalog.btrim(entry.value ->> 'textbookId'), '')
    limit 1
  ) book on true;

  select nullif(pg_catalog.btrim(coalesce(
    nullif(progress.range_label, ''),
    nullif(progress.content, ''),
    nullif(progress.public_note, '')
  )), '')
  into v_progress_value
  from public.progress_logs progress
  where progress.class_id = p_class_id
    and progress.session_id in (
      v_session_key,
      coalesce(p_class_lesson_session_id::text, v_session_key)
    )
  order by progress.updated_at desc nulls last, progress.id desc
  limit 1;

  if v_progress_value is null then
    v_progress_value := case
      when p_session_authority = 'normalized' then coalesce(
        nullif(pg_catalog.btrim(v_lesson.public_note), ''),
        nullif(pg_catalog.btrim(v_lesson.memo), '')
      )
      else coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'publicNote'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'public_note'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'memo'), '')
      )
    end;
  end if;
  v_progress := case
    when v_progress_value is null then '진도: 미입력'
    else '진도: ' || v_progress_value
  end;

  v_booking_fact := pg_catalog.jsonb_build_object(
    'classId', p_class_id,
    'subject', v_track.subject,
    'sessionAuthority', p_session_authority,
    'classLessonSessionId', p_class_lesson_session_id,
    'legacySessionKey', p_legacy_session_key,
    'sessionKey', v_session_key,
    'scheduleState', v_schedule_state,
    'sessionDate', v_session_date,
    'startsAt', v_starts_at,
    'endsAt', v_ends_at,
    'teacherCatalogId', v_teacher.id,
    'teacherProfileId', v_teacher.profile_id,
    'teacherName', v_teacher.name,
    'classroomCatalogId', v_classroom.id,
    'classroomName', v_classroom.name,
    'campus', v_classroom.campus
  );
  v_booking_fact_hash :=
    dashboard_private.registration_observation_booking_fact_hash_v1(v_booking_fact);

  return pg_catalog.jsonb_build_object(
    'classId', p_class_id,
    'subject', v_track.subject,
    'sessionAuthority', p_session_authority,
    'classLessonSessionId', p_class_lesson_session_id,
    'legacySessionKey', p_legacy_session_key,
    'sessionKey', v_session_key,
    'scheduleState', v_schedule_state,
    'sessionDate', v_session_date,
    'startsAt', v_starts_at,
    'endsAt', v_ends_at,
    'sessionSourceRevision', v_session_source_revision,
    'legacySessionSourceHash', v_legacy_session_source_hash,
    'sourceRevision', v_source_revision,
    'teacherCatalogId', v_teacher.id,
    'teacherProfileId', v_teacher.profile_id,
    'teacherName', v_teacher.name,
    'classroomCatalogId', v_classroom.id,
    'classroomName', v_classroom.name,
    'campus', v_classroom.campus,
    'className', v_class.name,
    'textbooks', v_textbooks,
    'progress', v_progress,
    'bookingFactHash', v_booking_fact_hash
  );
end;
$$;

alter function dashboard_private.registration_observation_booking_fact_hash_v1(jsonb)
  owner to postgres;
alter function dashboard_private.registration_observation_legacy_session_content_hash_v1(jsonb, text)
  owner to postgres;
alter function dashboard_private.resolve_registration_observation_session_v1(uuid, uuid, text, uuid, text)
  owner to postgres;

revoke all on function dashboard_private.registration_observation_booking_fact_hash_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_legacy_session_content_hash_v1(jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.resolve_registration_observation_session_v1(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;

commit;
