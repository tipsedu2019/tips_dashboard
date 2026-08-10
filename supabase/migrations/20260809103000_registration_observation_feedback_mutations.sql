begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function dashboard_private.assert_registration_observation_current_session_v1(
  p_observation_id uuid,
  p_operation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_actor_role text;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_class public.classes%rowtype;
  v_lesson public.class_lesson_sessions%rowtype;
  v_slot public.class_schedule_slots%rowtype;
  v_teacher public.teacher_catalogs%rowtype;
  v_classroom public.classroom_catalogs%rowtype;
  v_sessions jsonb;
  v_selected_session jsonb := '{}'::jsonb;
  v_row record;
  v_row_key text;
  v_seen_keys text[] := array[]::text[];
  v_selected_count integer := 0;
  v_slot_count integer := 0;
  v_catalog_count integer := 0;
  v_session_key text;
  v_session_date date;
  v_schedule_state text;
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
begin
  if p_observation_id is null
    or p_operation is null
    or p_operation not in ('record_attendance', 'submit_feedback')
  then
    raise exception 'registration_observation_session_source_dirty'
      using errcode = '55000';
  end if;

  select profile.role
  into v_actor_role
  from public.profiles profile
  where profile.id = v_actor;

  select observation.*
  into v_observation
  from public.ops_registration_observations observation
  where observation.id = p_observation_id;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_observation.track_id
    and track.task_id = v_observation.task_id;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  if p_operation = 'record_attendance' then
    if v_actor_role not in ('admin', 'staff') then
      raise exception 'registration_observation_attendance_access_denied'
        using errcode = '42501';
    end if;
  elsif not (
    v_actor_role in ('admin', 'staff')
    or (
      v_actor_role = 'teacher'
      and v_actor = v_observation.teacher_profile_id
    )
  ) then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select class.*
  into v_class
  from public.classes class
  where class.id = v_observation.class_id
    and class.subject = v_track.subject
    and class.closed_at is null
  for share;
  if not found then
    raise exception 'registration_observation_session_source_dirty'
      using errcode = '55000';
  end if;

  if v_observation.session_authority = 'normalized' then
    if public.continuous_class_schedule_runtime_version() <> 1
      or v_class.schedule_storage_mode <> 'normalized'
      or v_observation.class_lesson_session_id is null
      or v_observation.legacy_session_key is not null
    then
      raise exception 'registration_observation_session_source_dirty'
        using errcode = '55000';
    end if;

    select lesson.*
    into v_lesson
    from public.class_lesson_sessions lesson
    where lesson.id = v_observation.class_lesson_session_id
      and lesson.class_id = v_observation.class_id
    for share;
    if not found
      or nullif(pg_catalog.btrim(v_lesson.session_key), '') is null
      or v_lesson.schedule_state not in ('active', 'makeup')
      or v_lesson.start_time is null
      or v_lesson.end_time is null
      or v_lesson.start_time >= v_lesson.end_time
    then
      raise exception 'registration_observation_session_source_dirty'
        using errcode = '55000';
    end if;

    v_session_key := v_lesson.session_key;
    v_session_date := v_lesson.session_date;
    v_schedule_state := v_lesson.schedule_state;
    v_start_time := v_lesson.start_time;
    v_end_time := v_lesson.end_time;
    v_session_source_revision := v_lesson.revision;
    v_source_revision := pg_catalog.jsonb_build_object(
      'authority', 'normalized',
      'sessionId', v_lesson.id,
      'revision', v_lesson.revision
    );
    v_teacher_catalog_id := v_lesson.teacher_catalog_id;
    v_classroom_catalog_id := v_lesson.classroom_catalog_id;
    v_teacher_name_fallback := nullif(
      pg_catalog.btrim(v_lesson.teacher_name_snapshot), ''
    );
    v_classroom_name_fallback := nullif(
      pg_catalog.btrim(v_lesson.classroom_name_snapshot), ''
    );
  elsif v_observation.session_authority = 'legacy' then
    if v_class.schedule_storage_mode not in ('legacy', 'shadow')
      or v_observation.class_lesson_session_id is not null
      or nullif(pg_catalog.btrim(v_observation.legacy_session_key), '') is null
    then
      raise exception 'registration_observation_session_source_dirty'
        using errcode = '55000';
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
        raise exception 'registration_observation_session_source_dirty'
          using errcode = '55000';
      end if;
      v_seen_keys := pg_catalog.array_append(v_seen_keys, v_row_key);
      if v_row_key = v_observation.legacy_session_key then
        v_selected_count := v_selected_count + 1;
        v_selected_session := v_row.value;
      end if;
    end loop;
    if v_selected_count <> 1 then
      raise exception 'registration_observation_session_source_dirty'
        using errcode = '55000';
    end if;

    v_session_key := v_observation.legacy_session_key;
    begin
      v_session_date := coalesce(
        nullif(pg_catalog.btrim(v_selected_session ->> 'date'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'sessionDate'), ''),
        nullif(pg_catalog.btrim(v_selected_session ->> 'session_date'), '')
      )::date;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'registration_observation_session_source_dirty'
          using errcode = '55000';
    end;
    if v_session_date is null then
      raise exception 'registration_observation_session_source_dirty'
        using errcode = '55000';
    end if;

    v_schedule_state := pg_catalog.lower(coalesce(
      nullif(pg_catalog.btrim(v_selected_session ->> 'scheduleState'), ''),
      nullif(pg_catalog.btrim(v_selected_session ->> 'schedule_state'), ''),
      nullif(pg_catalog.btrim(v_selected_session ->> 'state'), ''),
      'active'
    ));
    if v_schedule_state = 'normal' then
      v_schedule_state := 'active';
    end if;
    if v_schedule_state not in ('active', 'makeup') then
      raise exception 'registration_observation_session_source_dirty'
        using errcode = '55000';
    end if;

    select count(*)
    into v_slot_count
    from public.class_schedule_slots slot
    where slot.class_id = v_observation.class_id
      and slot.weekday = extract(dow from v_session_date)::smallint;
    if v_slot_count <> 1 then
      raise exception 'registration_observation_session_source_dirty'
        using errcode = '55000';
    end if;

    select slot.*
    into v_slot
    from public.class_schedule_slots slot
    where slot.class_id = v_observation.class_id
      and slot.weekday = extract(dow from v_session_date)::smallint
    limit 1
    for share;
    v_start_time := v_slot.start_time;
    v_end_time := v_slot.end_time;
    if v_start_time is null
      or v_end_time is null
      or v_start_time >= v_end_time
    then
      raise exception 'registration_observation_session_source_dirty'
        using errcode = '55000';
    end if;

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
        raise exception 'registration_observation_session_source_dirty'
          using errcode = '55000';
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
    raise exception 'registration_observation_session_source_dirty'
      using errcode = '55000';
  end if;

  if v_teacher_catalog_id is not null then
    select teacher.*
    into v_teacher
    from public.teacher_catalogs teacher
    where teacher.id = v_teacher_catalog_id
      and teacher.is_visible = true
      and teacher.profile_id is not null
      and (
        pg_catalog.cardinality(teacher.subjects) = 0
        or v_track.subject = any(teacher.subjects)
      )
    for share;
  elsif v_observation.session_authority = 'legacy' then
    select count(*)
    into v_catalog_count
    from public.teacher_catalogs teacher
    where teacher.is_visible = true
      and teacher.profile_id is not null
      and pg_catalog.lower(teacher.name) = pg_catalog.lower(v_teacher_name_fallback)
      and (
        pg_catalog.cardinality(teacher.subjects) = 0
        or v_track.subject = any(teacher.subjects)
      );
    if v_catalog_count = 1 then
      select teacher.*
      into v_teacher
      from public.teacher_catalogs teacher
      where teacher.is_visible = true
        and teacher.profile_id is not null
        and pg_catalog.lower(teacher.name) = pg_catalog.lower(v_teacher_name_fallback)
        and (
          pg_catalog.cardinality(teacher.subjects) = 0
          or v_track.subject = any(teacher.subjects)
        )
      for share;
    end if;
  end if;
  if v_teacher.id is null
    or not dashboard_private.notification_profile_is_active_v1(
      v_teacher.profile_id
    )
  then
    raise exception 'registration_observation_session_source_dirty'
      using errcode = '55000';
  end if;

  v_catalog_count := 0;
  if v_classroom_catalog_id is not null then
    select classroom.*
    into v_classroom
    from public.classroom_catalogs classroom
    where classroom.id = v_classroom_catalog_id
      and classroom.is_visible = true
      and classroom.campus in ('본관', '별관')
      and (
        pg_catalog.cardinality(classroom.subjects) = 0
        or v_track.subject = any(classroom.subjects)
      )
    for share;
  elsif v_observation.session_authority = 'legacy' then
    select count(*)
    into v_catalog_count
    from public.classroom_catalogs classroom
    where classroom.is_visible = true
      and classroom.campus in ('본관', '별관')
      and pg_catalog.lower(classroom.name)
        = pg_catalog.lower(v_classroom_name_fallback)
      and (
        pg_catalog.cardinality(classroom.subjects) = 0
        or v_track.subject = any(classroom.subjects)
      );
    if v_catalog_count = 1 then
      select classroom.*
      into v_classroom
      from public.classroom_catalogs classroom
      where classroom.is_visible = true
        and classroom.campus in ('본관', '별관')
        and pg_catalog.lower(classroom.name)
          = pg_catalog.lower(v_classroom_name_fallback)
        and (
          pg_catalog.cardinality(classroom.subjects) = 0
          or v_track.subject = any(classroom.subjects)
        )
      for share;
    end if;
  end if;
  if v_classroom.id is null then
    raise exception 'registration_observation_session_source_dirty'
      using errcode = '55000';
  end if;

  v_starts_at := (v_session_date + v_start_time) at time zone 'Asia/Seoul';
  v_ends_at := (v_session_date + v_end_time) at time zone 'Asia/Seoul';
  if v_observation.session_date is distinct from v_session_date
    or v_observation.starts_at is distinct from v_starts_at
    or v_observation.ends_at is distinct from v_ends_at
    or v_observation.session_schedule_state is distinct from v_schedule_state
    or v_observation.session_source_revision
      is distinct from v_session_source_revision
    or v_observation.legacy_session_source_hash
      is distinct from v_legacy_session_source_hash
    or v_observation.source_revision is distinct from v_source_revision
    or v_observation.teacher_catalog_id is distinct from v_teacher.id
    or v_observation.teacher_profile_id is distinct from v_teacher.profile_id
    or v_observation.teacher_name_snapshot is distinct from v_teacher.name
    or v_observation.classroom_catalog_id is distinct from v_classroom.id
    or v_observation.classroom_name_snapshot is distinct from v_classroom.name
    or v_observation.campus is distinct from v_classroom.campus
  then
    raise exception 'registration_observation_session_source_dirty'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'startsAt', v_starts_at,
    'endsAt', v_ends_at,
    'sourceRevision', v_source_revision
  );
end;
$$;

create function dashboard_private.record_registration_observation_attendance_v1_impl(
  p_observation_id uuid,
  p_expected_observation_revision bigint,
  p_expected_appointment_notification_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_actor_role text;
  v_fingerprint text;
  v_existing_operation text;
  v_existing_fingerprint text;
  v_existing_response jsonb;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_workflow_status_before text;
  v_workflow_revision_before integer;
  v_observation_revision_before bigint;
  v_current_session jsonb;
  v_response jsonb;
begin
  select profile.role
  into v_actor_role
  from public.profiles profile
  where profile.id = v_actor;

  if v_actor_role not in ('admin', 'staff') then
    raise exception 'registration_observation_attendance_access_denied'
      using errcode = '42501';
  end if;
  if p_observation_id is null
    or p_expected_observation_revision is null
    or p_expected_observation_revision < 1
    or p_expected_appointment_notification_revision is null
    or p_expected_appointment_notification_revision < 1
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_attendance_invalid'
      using errcode = '22023';
  end if;

  v_fingerprint :=
    dashboard_private.registration_observation_request_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'operation', 'record_attendance',
        'observationId', p_observation_id,
        'expectedObservationRevision', p_expected_observation_revision,
        'expectedAppointmentNotificationRevision',
          p_expected_appointment_notification_revision
      )
    );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_key, 0)
  );
  select
    request.operation,
    request.request_fingerprint,
    request.response_payload
  into
    v_existing_operation,
    v_existing_fingerprint,
    v_existing_response
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing_operation <> 'record_attendance'
      or v_existing_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    return v_existing_response;
  end if;

  perform dashboard_private.assert_registration_observation_runtime_v1();

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = (
    select observation.track_id
    from public.ops_registration_observations observation
    where observation.id = p_observation_id
  )
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select observation.*
  into v_observation
  from public.ops_registration_observations observation
  where observation.id = p_observation_id
    and observation.track_id = v_track.id
    and observation.task_id = v_track.task_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = v_observation.appointment_id
    and appointment.task_id = v_track.task_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  if v_observation.revision <> p_expected_observation_revision
    or v_appointment.notification_revision
      <> p_expected_appointment_notification_revision
  then
    raise exception 'registration_observation_stale_revision'
      using errcode = '40001';
  end if;
  if v_track.workflow_status <> 'observation_requested'
    or v_observation.status <> 'scheduled'
    or v_observation.decision_kind is not null
    or v_appointment.kind <> 'observation_class'
    or v_appointment.status <> 'scheduled'
  then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;
  v_current_session :=
    dashboard_private.assert_registration_observation_current_session_v1(
      v_observation.id,
      'record_attendance'
    );
  if pg_catalog.now() < (v_current_session ->> 'startsAt')::timestamptz then
    raise exception 'registration_observation_time_boundary_rejected'
      using errcode = '55000';
  end if;

  v_workflow_status_before := v_track.workflow_status;
  v_workflow_revision_before := v_track.workflow_revision;
  v_observation_revision_before := v_observation.revision;

  update public.ops_registration_appointments appointment
  set status = 'completed',
      updated_at = pg_catalog.now()
  where appointment.id = v_appointment.id
  returning appointment.* into v_appointment;

  update public.ops_registration_observations observation
  set status = 'attended_feedback_pending',
      attendance = 'attended',
      attendance_recorded_by = v_actor,
      attendance_recorded_at = pg_catalog.now(),
      revision = observation.revision + 1,
      updated_by = v_actor,
      updated_at = pg_catalog.now()
  where observation.id = v_observation.id
  returning observation.* into v_observation;

  update public.ops_registration_subject_tracks track
  set workflow_status = 'observation_feedback_pending',
      workflow_revision = track.workflow_revision + 1,
      workflow_status_entered_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where track.id = v_track.id
  returning track.* into v_track;

  insert into dashboard_private.registration_observation_domain_events(
    observation_id,
    appointment_id,
    notification_revision,
    event_kind,
    booking_fact_hash,
    source_revision
  ) values (
    v_observation.id,
    v_appointment.id,
    v_appointment.notification_revision,
    'observation_attendance_recorded',
    v_observation.booking_fact_hash,
    v_observation.source_revision
  );

  perform dashboard_private.write_registration_track_event_v2(
    v_track.task_id,
    v_track.id,
    'registration_observation_attendance_recorded',
    v_workflow_status_before,
    v_track.workflow_status,
    null,
    pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'observationId', v_observation.id,
      'appointmentId', v_appointment.id,
      'workflowRevisionBefore', v_workflow_revision_before,
      'workflowRevisionAfter', v_track.workflow_revision,
      'observationRevisionBefore', v_observation_revision_before,
      'observationRevisionAfter', v_observation.revision,
      'feedbackRevisionBefore', v_observation.feedback_revision,
      'feedbackRevisionAfter', v_observation.feedback_revision,
      'appointmentNotificationRevisionBefore',
        v_appointment.notification_revision,
      'appointmentNotificationRevisionAfter',
        v_appointment.notification_revision
    ),
    'user',
    null
  );

  v_response := dashboard_private.registration_observation_response_v1(
    'record_attendance',
    p_request_key,
    v_track,
    v_observation,
    v_appointment,
    true
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id,
    operation,
    request_key,
    track_id,
    request_fingerprint,
    response_payload
  ) values (
    v_actor,
    'record_attendance',
    p_request_key,
    v_track.id,
    v_fingerprint,
    v_response
  );

  return v_response;
end;
$$;

create function dashboard_private.submit_registration_observation_feedback_v1_impl(
  p_observation_id uuid,
  p_attendance text,
  p_suitability_result text,
  p_feedback_reason text,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_appointment_notification_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_actor_role text;
  v_attendance text := pg_catalog.btrim(p_attendance);
  v_suitability_result text := pg_catalog.btrim(p_suitability_result);
  v_feedback_reason text :=
    nullif(pg_catalog.btrim(p_feedback_reason), '');
  v_fingerprint text;
  v_existing_operation text;
  v_existing_fingerprint text;
  v_existing_response jsonb;
  v_existing_track_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_event_kind text;
  v_audit_event_type text;
  v_workflow_status_before text;
  v_workflow_revision_before integer;
  v_observation_revision_before bigint;
  v_feedback_revision_before bigint;
  v_current_session jsonb;
  v_response jsonb;
begin
  if p_observation_id is null
    or p_expected_observation_revision is null
    or p_expected_observation_revision < 1
    or p_expected_feedback_revision is null
    or p_expected_feedback_revision < 0
    or p_expected_appointment_notification_revision is null
    or p_expected_appointment_notification_revision < 1
    or nullif(pg_catalog.btrim(p_request_key), '') is null
    or v_attendance is null
    or v_attendance not in ('attended', 'no_show')
    or (
      v_attendance = 'attended'
      and (
        v_suitability_result is null
        or v_suitability_result not in ('fit', 'unfit')
        or v_feedback_reason is null
      )
    )
    or (
      v_attendance = 'no_show'
      and (
        p_suitability_result is not null
        or p_feedback_reason is not null
      )
    )
  then
    raise exception 'registration_observation_feedback_invalid'
      using errcode = '22023';
  end if;

  select profile.role
  into v_actor_role
  from public.profiles profile
  where profile.id = v_actor;

  v_fingerprint :=
    dashboard_private.registration_observation_request_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'operation', 'submit_feedback',
        'observationId', p_observation_id,
        'attendance', v_attendance,
        'suitabilityResult', case
          when v_attendance = 'attended' then v_suitability_result
          else null
        end,
        'feedbackReason', case
          when v_attendance = 'attended' then v_feedback_reason
          else null
        end,
        'expectedObservationRevision', p_expected_observation_revision,
        'expectedFeedbackRevision', p_expected_feedback_revision,
        'expectedAppointmentNotificationRevision',
          p_expected_appointment_notification_revision
      )
    );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_key, 0)
  );
  select
    request.operation,
    request.request_fingerprint,
    request.response_payload,
    request.track_id
  into
    v_existing_operation,
    v_existing_fingerprint,
    v_existing_response,
    v_existing_track_id
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing_operation <> 'submit_feedback'
      or v_existing_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    if not exists (
      select 1
      from public.ops_registration_observations observation
      join public.ops_registration_subject_tracks track
        on track.id = observation.track_id
       and track.task_id = observation.task_id
      where observation.id = p_observation_id
        and observation.track_id = v_existing_track_id
        and (
          v_actor_role in ('admin', 'staff')
          or (
            v_actor_role = 'teacher'
            and v_actor = observation.teacher_profile_id
          )
        )
    ) then
      raise exception 'registration_observation_not_found'
        using errcode = 'P0002';
    end if;
    return v_existing_response;
  end if;

  perform dashboard_private.assert_registration_observation_runtime_v1();

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = (
    select observation.track_id
    from public.ops_registration_observations observation
    where observation.id = p_observation_id
  )
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select observation.*
  into v_observation
  from public.ops_registration_observations observation
  where observation.id = p_observation_id
    and observation.track_id = v_track.id
    and observation.task_id = v_track.task_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = v_observation.appointment_id
    and appointment.task_id = v_track.task_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  if not (
    v_actor_role in ('admin', 'staff')
    or (
      v_actor_role = 'teacher'
      and v_actor = v_observation.teacher_profile_id
    )
  ) then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  if v_observation.revision <> p_expected_observation_revision
    or v_observation.feedback_revision <> p_expected_feedback_revision
    or v_appointment.notification_revision
      <> p_expected_appointment_notification_revision
  then
    raise exception 'registration_observation_stale_revision'
      using errcode = '40001';
  end if;
  if v_observation.decision_kind is not null
    or v_appointment.kind <> 'observation_class'
  then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;

  if v_attendance = 'attended' then
    if not (
      (
        v_track.workflow_status = 'observation_requested'
        and v_observation.status = 'scheduled'
        and v_appointment.status = 'scheduled'
      )
      or (
        v_track.workflow_status = 'observation_feedback_pending'
        and v_observation.status = 'attended_feedback_pending'
        and v_observation.attendance = 'attended'
        and v_appointment.status = 'completed'
      )
    ) then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;
    v_current_session :=
      dashboard_private.assert_registration_observation_current_session_v1(
        v_observation.id,
        'submit_feedback'
      );
    if pg_catalog.now() < (v_current_session ->> 'endsAt')::timestamptz then
      raise exception 'registration_observation_time_boundary_rejected'
        using errcode = '55000';
    end if;
    v_event_kind := 'observation_feedback_submitted';
    v_audit_event_type := 'registration_observation_feedback_submitted';
  else
    if v_track.workflow_status <> 'observation_requested'
      or v_observation.status <> 'scheduled'
      or v_appointment.status <> 'scheduled'
    then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;
    v_current_session :=
      dashboard_private.assert_registration_observation_current_session_v1(
        v_observation.id,
        'submit_feedback'
      );
    if pg_catalog.now() < (v_current_session ->> 'startsAt')::timestamptz then
      raise exception 'registration_observation_time_boundary_rejected'
        using errcode = '55000';
    end if;
    v_event_kind := 'observation_no_show';
    v_audit_event_type := 'registration_observation_no_show';
  end if;

  v_workflow_status_before := v_track.workflow_status;
  v_workflow_revision_before := v_track.workflow_revision;
  v_observation_revision_before := v_observation.revision;
  v_feedback_revision_before := v_observation.feedback_revision;

  update public.ops_registration_appointments appointment
  set status = 'completed',
      updated_at = pg_catalog.now()
  where appointment.id = v_appointment.id
  returning appointment.* into v_appointment;

  if v_attendance = 'attended' then
    update public.ops_registration_observations observation
    set status = 'completed',
        attendance = 'attended',
        attendance_recorded_by = case
          when observation.status = 'scheduled' then v_actor
          else observation.attendance_recorded_by
        end,
        attendance_recorded_at = case
          when observation.status = 'scheduled' then pg_catalog.now()
          else observation.attendance_recorded_at
        end,
        suitability_result = v_suitability_result,
        feedback_reason = v_feedback_reason,
        feedback_submitted_by = v_actor,
        feedback_submitted_at = pg_catalog.now(),
        feedback_revision = observation.feedback_revision + 1,
        revision = observation.revision + 1,
        updated_by = v_actor,
        updated_at = pg_catalog.now()
    where observation.id = v_observation.id
    returning observation.* into v_observation;
  else
    update public.ops_registration_observations observation
    set status = 'no_show',
        attendance = 'no_show',
        attendance_recorded_by = v_actor,
        attendance_recorded_at = pg_catalog.now(),
        revision = observation.revision + 1,
        updated_by = v_actor,
        updated_at = pg_catalog.now()
    where observation.id = v_observation.id
    returning observation.* into v_observation;
  end if;

  update public.ops_registration_subject_tracks track
  set workflow_status = 'observation_completed',
      workflow_revision = track.workflow_revision + 1,
      workflow_status_entered_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where track.id = v_track.id
  returning track.* into v_track;

  insert into dashboard_private.registration_observation_domain_events(
    observation_id,
    appointment_id,
    notification_revision,
    event_kind,
    booking_fact_hash,
    source_revision
  ) values (
    v_observation.id,
    v_appointment.id,
    v_appointment.notification_revision,
    v_event_kind,
    v_observation.booking_fact_hash,
    v_observation.source_revision
  );

  perform dashboard_private.write_registration_track_event_v2(
    v_track.task_id,
    v_track.id,
    v_audit_event_type,
    v_workflow_status_before,
    v_track.workflow_status,
    null,
    pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'observationId', v_observation.id,
      'appointmentId', v_appointment.id,
      'attendance', v_observation.attendance,
      'suitabilityResult', v_observation.suitability_result,
      'proxySubmitted', v_actor <> v_observation.teacher_profile_id,
      'assignedTeacherProfileId', v_observation.teacher_profile_id,
      'submittedByProfileId', v_actor,
      'workflowRevisionBefore', v_workflow_revision_before,
      'workflowRevisionAfter', v_track.workflow_revision,
      'observationRevisionBefore', v_observation_revision_before,
      'observationRevisionAfter', v_observation.revision,
      'feedbackRevisionBefore', v_feedback_revision_before,
      'feedbackRevisionAfter', v_observation.feedback_revision,
      'appointmentNotificationRevisionBefore',
        v_appointment.notification_revision,
      'appointmentNotificationRevisionAfter',
        v_appointment.notification_revision
    ),
    'user',
    null
  );

  v_response := dashboard_private.registration_observation_response_v1(
    'submit_feedback',
    p_request_key,
    v_track,
    v_observation,
    v_appointment,
    true
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id,
    operation,
    request_key,
    track_id,
    request_fingerprint,
    response_payload
  ) values (
    v_actor,
    'submit_feedback',
    p_request_key,
    v_track.id,
    v_fingerprint,
    v_response
  );

  return v_response;
end;
$$;

create function public.record_registration_observation_attendance_v1(
  p_observation_id uuid,
  p_expected_observation_revision bigint,
  p_expected_appointment_notification_revision integer,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.record_registration_observation_attendance_v1_impl(
    p_observation_id,
    p_expected_observation_revision,
    p_expected_appointment_notification_revision,
    p_request_key
  );
$$;

create function public.submit_registration_observation_feedback_v1(
  p_observation_id uuid,
  p_attendance text,
  p_suitability_result text,
  p_feedback_reason text,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_appointment_notification_revision integer,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.submit_registration_observation_feedback_v1_impl(
    p_observation_id,
    p_attendance,
    p_suitability_result,
    p_feedback_reason,
    p_expected_observation_revision,
    p_expected_feedback_revision,
    p_expected_appointment_notification_revision,
    p_request_key
  );
$$;

alter function dashboard_private.assert_registration_observation_current_session_v1(
  uuid, text
) owner to postgres;
alter function dashboard_private.record_registration_observation_attendance_v1_impl(
  uuid, bigint, integer, text
) owner to postgres;
alter function dashboard_private.submit_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, integer, text
) owner to postgres;
alter function public.record_registration_observation_attendance_v1(
  uuid, bigint, integer, text
) owner to postgres;
alter function public.submit_registration_observation_feedback_v1(
  uuid, text, text, text, bigint, bigint, integer, text
) owner to postgres;

revoke all on function dashboard_private.assert_registration_observation_current_session_v1(
  uuid, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.record_registration_observation_attendance_v1_impl(
  uuid, bigint, integer, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.submit_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_registration_observation_attendance_v1(
  uuid, bigint, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.submit_registration_observation_feedback_v1(
  uuid, text, text, text, bigint, bigint, integer, text
) from public, anon, authenticated, service_role;

grant execute on function dashboard_private.record_registration_observation_attendance_v1_impl(
  uuid, bigint, integer, text
) to authenticated;
grant execute on function dashboard_private.submit_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, integer, text
) to authenticated;
grant execute on function public.record_registration_observation_attendance_v1(
  uuid, bigint, integer, text
) to authenticated;
grant execute on function public.submit_registration_observation_feedback_v1(
  uuid, text, text, text, bigint, bigint, integer, text
) to authenticated;

commit;
