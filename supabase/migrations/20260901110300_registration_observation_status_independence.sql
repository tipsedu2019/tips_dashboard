begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Workflow status is a manually edited property. Observation mutations own
-- only observation/appointment facts, their revisions, locks, events, and
-- idempotency receipts. The legacy workflow revision parameter remains in the
-- public signatures and request fingerprints solely for replay compatibility.
create or replace function dashboard_private.enter_registration_observation_v1_impl(
  p_track_id uuid,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_fingerprint text;
  v_existing dashboard_private.registration_observation_mutation_requests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_response jsonb;
begin
  if p_track_id is null
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_enter_invalid'
      using errcode = '22023';
  end if;

  v_fingerprint :=
    dashboard_private.registration_observation_request_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'operation', 'enter',
        'trackId', p_track_id,
        'expectedWorkflowRevision', p_expected_workflow_revision
      )
    );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_key, 0)
  );

  select request.*
  into v_existing
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing.operation <> 'enter'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    return v_existing.response_payload;
  end if;

  perform dashboard_private.assert_registration_observation_runtime_v1();

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_observation_manager_access_v1(
    v_track.id
  );

  v_response := dashboard_private.registration_observation_response_v1(
    'enter', p_request_key, v_track, null, null, false
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id, operation, request_key, track_id,
    request_fingerprint, response_payload
  ) values (
    v_actor, 'enter', p_request_key, v_track.id,
    v_fingerprint, v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.save_registration_observation_booking_v1_impl(
  p_track_id uuid,
  p_observation_id uuid,
  p_class_id uuid,
  p_session_authority text,
  p_class_lesson_session_id uuid,
  p_legacy_session_key text,
  p_expected_workflow_revision integer,
  p_expected_appointment_notification_revision integer,
  p_expected_observation_revision bigint,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_operation text;
  v_fingerprint text;
  v_existing dashboard_private.registration_observation_mutation_requests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_resolved jsonb;
  v_response jsonb;
  v_changed boolean;
  v_attempt_count_before bigint;
  v_observation_revision_before bigint;
  v_notification_revision_before integer;
begin
  if p_track_id is null
    or p_class_id is null
    or nullif(pg_catalog.btrim(p_session_authority), '') is null
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_booking_invalid'
      using errcode = '22023';
  end if;

  if p_observation_id is null then
    if p_expected_appointment_notification_revision is not null
      or p_expected_observation_revision is not null
    then
      raise exception 'registration_observation_revision_combination_invalid'
        using errcode = '22023';
    end if;
    v_operation := 'book';
    v_fingerprint :=
      dashboard_private.registration_observation_request_fingerprint_v1(
        pg_catalog.jsonb_build_object(
          'operation', 'book',
          'trackId', p_track_id,
          'observationId', p_observation_id,
          'classId', p_class_id,
          'sessionAuthority', p_session_authority,
          'classLessonSessionId', p_class_lesson_session_id,
          'legacySessionKey', p_legacy_session_key,
          'expectedWorkflowRevision', p_expected_workflow_revision,
          'expectedAppointmentNotificationRevision',
            p_expected_appointment_notification_revision,
          'expectedObservationRevision', p_expected_observation_revision
        )
      );
  else
    if p_expected_workflow_revision is not null
      or p_expected_appointment_notification_revision is null
      or p_expected_appointment_notification_revision < 1
      or p_expected_observation_revision is null
      or p_expected_observation_revision < 1
    then
      raise exception 'registration_observation_revision_combination_invalid'
        using errcode = '22023';
    end if;
    v_operation := 'reschedule';
    v_fingerprint :=
      dashboard_private.registration_observation_request_fingerprint_v1(
        pg_catalog.jsonb_build_object(
          'operation', 'reschedule',
          'trackId', p_track_id,
          'observationId', p_observation_id,
          'classId', p_class_id,
          'sessionAuthority', p_session_authority,
          'classLessonSessionId', p_class_lesson_session_id,
          'legacySessionKey', p_legacy_session_key,
          'expectedWorkflowRevision', p_expected_workflow_revision,
          'expectedAppointmentNotificationRevision',
            p_expected_appointment_notification_revision,
          'expectedObservationRevision', p_expected_observation_revision
        )
      );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_key, 0)
  );
  select request.*
  into v_existing
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing.operation <> v_operation
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    return v_existing.response_payload;
  end if;

  perform dashboard_private.assert_registration_observation_runtime_v1();

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_observation_manager_access_v1(
    v_track.id
  );

  if v_operation = 'book' then
    if exists (
        select 1
        from public.ops_registration_observations observation
        where observation.track_id = v_track.id
          and observation.decision_kind is null
          and observation.status in (
            'scheduled', 'attended_feedback_pending', 'completed', 'no_show'
          )
      )
      or exists (
        select 1
        from public.ops_registration_observations observation
        join public.ops_registration_appointments appointment
          on appointment.id = observation.appointment_id
        where observation.track_id = v_track.id
          and observation.status = 'scheduled'
          and appointment.status = 'scheduled'
      )
    then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;

    v_resolved := dashboard_private.resolve_registration_observation_session_v1(
      v_track.id,
      p_class_id,
      p_session_authority,
      p_class_lesson_session_id,
      p_legacy_session_key
    );

    insert into public.ops_registration_appointments(
      task_id, kind, scheduled_at, place, status,
      notification_revision, created_by
    ) values (
      v_track.task_id,
      'observation_class',
      (v_resolved ->> 'startsAt')::timestamptz,
      v_resolved ->> 'campus',
      'scheduled',
      1,
      v_actor
    )
    returning * into v_appointment;

    insert into public.ops_registration_observations(
      task_id, track_id, appointment_id, class_id,
      session_authority, class_lesson_session_id, legacy_session_key,
      session_date, starts_at, ends_at, session_schedule_state,
      session_source_revision, legacy_session_source_hash, source_revision,
      booking_fact_hash, teacher_catalog_id, teacher_profile_id,
      classroom_catalog_id, subject, class_name_snapshot,
      teacher_name_snapshot, classroom_name_snapshot, campus,
      textbook_snapshot, progress_snapshot, status, feedback_revision,
      revision, created_by, updated_by
    ) values (
      v_track.task_id,
      v_track.id,
      v_appointment.id,
      (v_resolved ->> 'classId')::uuid,
      v_resolved ->> 'sessionAuthority',
      nullif(v_resolved ->> 'classLessonSessionId', '')::uuid,
      nullif(v_resolved ->> 'legacySessionKey', ''),
      (v_resolved ->> 'sessionDate')::date,
      (v_resolved ->> 'startsAt')::timestamptz,
      (v_resolved ->> 'endsAt')::timestamptz,
      v_resolved ->> 'scheduleState',
      nullif(v_resolved ->> 'sessionSourceRevision', '')::bigint,
      nullif(v_resolved ->> 'legacySessionSourceHash', ''),
      v_resolved -> 'sourceRevision',
      v_resolved ->> 'bookingFactHash',
      (v_resolved ->> 'teacherCatalogId')::uuid,
      (v_resolved ->> 'teacherProfileId')::uuid,
      (v_resolved ->> 'classroomCatalogId')::uuid,
      v_resolved ->> 'subject',
      v_resolved ->> 'className',
      v_resolved ->> 'teacherName',
      v_resolved ->> 'classroomName',
      v_resolved ->> 'campus',
      coalesce(v_resolved -> 'textbooks', '[]'::jsonb),
      coalesce(v_resolved ->> 'progress', ''),
      'scheduled',
      0,
      1,
      v_actor,
      v_actor
    )
    returning * into v_observation;

    v_attempt_count_before := v_track.observation_attempt_count;
    update public.ops_registration_subject_tracks track
    set observation_attempt_count = track.observation_attempt_count + 1,
        updated_at = pg_catalog.now()
    where track.id = v_track.id
    returning track.* into v_track;

    insert into dashboard_private.registration_observation_domain_events(
      observation_id, appointment_id, notification_revision,
      event_kind, booking_fact_hash, source_revision
    ) values (
      v_observation.id,
      v_appointment.id,
      v_appointment.notification_revision,
      'observation_scheduled',
      v_observation.booking_fact_hash,
      v_observation.source_revision
    );

    perform dashboard_private.write_registration_track_event_v2(
      v_track.task_id,
      v_track.id,
      'registration_observation_scheduled',
      v_track.workflow_status,
      v_track.workflow_status,
      null,
      pg_catalog.jsonb_build_object(
        'trackId', v_track.id,
        'observationId', v_observation.id,
        'appointmentId', v_appointment.id,
        'observationRevisionBefore', null,
        'observationRevisionAfter', v_observation.revision,
        'appointmentNotificationRevisionBefore', null,
        'appointmentNotificationRevisionAfter',
          v_appointment.notification_revision,
        'observationAttemptCountBefore', v_attempt_count_before,
        'observationAttemptCountAfter', v_track.observation_attempt_count
      ),
      'user',
      null
    );
    v_changed := true;
  else
    select observation.*
    into v_observation
    from public.ops_registration_observations observation
    where observation.id = p_observation_id
      and observation.track_id = v_track.id
    for update;
    if not found then
      raise exception 'registration_observation_not_found'
        using errcode = 'P0002';
    end if;
    if v_observation.revision <> p_expected_observation_revision then
      raise exception 'registration_observation_stale_revision'
        using errcode = '23514';
    end if;
    if v_observation.status <> 'scheduled'
      or v_observation.decision_kind is not null
    then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
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
    if v_appointment.notification_revision
      <> p_expected_appointment_notification_revision
    then
      raise exception 'registration_observation_stale_revision'
        using errcode = '23514';
    end if;
    if v_appointment.kind <> 'observation_class'
      or v_appointment.status <> 'scheduled'
    then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;

    v_resolved := dashboard_private.resolve_registration_observation_session_v1(
      v_track.id,
      p_class_id,
      p_session_authority,
      p_class_lesson_session_id,
      p_legacy_session_key
    );
    v_changed := v_observation.booking_fact_hash
      <> (v_resolved ->> 'bookingFactHash');

    if v_changed then
      v_observation_revision_before := v_observation.revision;
      v_notification_revision_before := v_appointment.notification_revision;

      update public.ops_registration_appointments appointment
      set scheduled_at = (v_resolved ->> 'startsAt')::timestamptz,
          place = v_resolved ->> 'campus',
          notification_revision = appointment.notification_revision + 1,
          updated_at = pg_catalog.now()
      where appointment.id = v_appointment.id
      returning appointment.* into v_appointment;

      update public.ops_registration_observations observation
      set class_id = (v_resolved ->> 'classId')::uuid,
          session_authority = v_resolved ->> 'sessionAuthority',
          class_lesson_session_id =
            nullif(v_resolved ->> 'classLessonSessionId', '')::uuid,
          legacy_session_key = nullif(v_resolved ->> 'legacySessionKey', ''),
          session_date = (v_resolved ->> 'sessionDate')::date,
          starts_at = (v_resolved ->> 'startsAt')::timestamptz,
          ends_at = (v_resolved ->> 'endsAt')::timestamptz,
          session_schedule_state = v_resolved ->> 'scheduleState',
          session_source_revision =
            nullif(v_resolved ->> 'sessionSourceRevision', '')::bigint,
          legacy_session_source_hash =
            nullif(v_resolved ->> 'legacySessionSourceHash', ''),
          source_revision = v_resolved -> 'sourceRevision',
          booking_fact_hash = v_resolved ->> 'bookingFactHash',
          teacher_catalog_id = (v_resolved ->> 'teacherCatalogId')::uuid,
          teacher_profile_id = (v_resolved ->> 'teacherProfileId')::uuid,
          classroom_catalog_id = (v_resolved ->> 'classroomCatalogId')::uuid,
          subject = v_resolved ->> 'subject',
          class_name_snapshot = v_resolved ->> 'className',
          teacher_name_snapshot = v_resolved ->> 'teacherName',
          classroom_name_snapshot = v_resolved ->> 'classroomName',
          campus = v_resolved ->> 'campus',
          textbook_snapshot = coalesce(v_resolved -> 'textbooks', '[]'::jsonb),
          progress_snapshot = coalesce(v_resolved ->> 'progress', ''),
          revision = observation.revision + 1,
          updated_by = v_actor,
          updated_at = pg_catalog.now()
      where observation.id = v_observation.id
      returning observation.* into v_observation;

      insert into dashboard_private.registration_observation_domain_events(
        observation_id, appointment_id, notification_revision,
        event_kind, booking_fact_hash, source_revision
      ) values (
        v_observation.id,
        v_appointment.id,
        v_appointment.notification_revision,
        'observation_rescheduled',
        v_observation.booking_fact_hash,
        v_observation.source_revision
      );

      perform dashboard_private.write_registration_track_event_v2(
        v_track.task_id,
        v_track.id,
        'registration_observation_rescheduled',
        v_track.workflow_status,
        v_track.workflow_status,
        null,
        pg_catalog.jsonb_build_object(
          'trackId', v_track.id,
          'observationId', v_observation.id,
          'appointmentId', v_appointment.id,
          'observationRevisionBefore', v_observation_revision_before,
          'observationRevisionAfter', v_observation.revision,
          'appointmentNotificationRevisionBefore',
            v_notification_revision_before,
          'appointmentNotificationRevisionAfter',
            v_appointment.notification_revision
        ),
        'user',
        null
      );
    end if;
  end if;

  v_response := dashboard_private.registration_observation_response_v1(
    v_operation,
    p_request_key,
    v_track,
    v_observation,
    v_appointment,
    v_changed
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id, operation, request_key, track_id,
    request_fingerprint, response_payload
  ) values (
    v_actor, v_operation, p_request_key, v_track.id,
    v_fingerprint, v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.cancel_registration_observation_v1_impl(
  p_observation_id uuid,
  p_expected_appointment_notification_revision integer,
  p_expected_observation_revision bigint,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_fingerprint text;
  v_existing dashboard_private.registration_observation_mutation_requests%rowtype;
  v_track_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_observation_revision_before bigint;
  v_notification_revision_before integer;
  v_response jsonb;
begin
  if p_observation_id is null
    or p_expected_appointment_notification_revision is null
    or p_expected_appointment_notification_revision < 1
    or p_expected_observation_revision is null
    or p_expected_observation_revision < 1
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_cancel_invalid'
      using errcode = '22023';
  end if;

  v_fingerprint :=
    dashboard_private.registration_observation_request_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'operation', 'cancel',
        'observationId', p_observation_id,
        'expectedAppointmentNotificationRevision',
          p_expected_appointment_notification_revision,
        'expectedObservationRevision', p_expected_observation_revision
      )
    );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_key, 0)
  );
  select request.*
  into v_existing
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing.operation <> 'cancel'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    return v_existing.response_payload;
  end if;

  perform dashboard_private.assert_registration_observation_runtime_v1();

  select observation.track_id
  into v_track_id
  from public.ops_registration_observations observation
  where observation.id = p_observation_id;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_observation_manager_access_v1(
    v_track.id
  );

  select observation.*
  into v_observation
  from public.ops_registration_observations observation
  where observation.id = p_observation_id
    and observation.track_id = v_track.id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  if v_observation.revision <> p_expected_observation_revision then
    raise exception 'registration_observation_stale_revision'
      using errcode = '23514';
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
  if v_appointment.notification_revision
    <> p_expected_appointment_notification_revision
  then
    raise exception 'registration_observation_stale_revision'
      using errcode = '23514';
  end if;
  if v_observation.status <> 'scheduled'
    or v_observation.decision_kind is not null
    or v_appointment.kind <> 'observation_class'
    or v_appointment.status <> 'scheduled'
  then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;

  v_observation_revision_before := v_observation.revision;
  v_notification_revision_before := v_appointment.notification_revision;
  update public.ops_registration_observations observation
  set status = 'canceled',
      revision = observation.revision + 1,
      updated_by = v_actor,
      updated_at = pg_catalog.now()
  where observation.id = v_observation.id
  returning observation.* into v_observation;
  update public.ops_registration_appointments appointment
  set status = 'canceled',
      notification_revision = appointment.notification_revision + 1,
      updated_at = pg_catalog.now()
  where appointment.id = v_appointment.id
  returning appointment.* into v_appointment;

  insert into dashboard_private.registration_observation_domain_events(
    observation_id, appointment_id, notification_revision,
    event_kind, booking_fact_hash, source_revision
  ) values (
    v_observation.id,
    v_appointment.id,
    v_appointment.notification_revision,
    'observation_canceled',
    v_observation.booking_fact_hash,
    v_observation.source_revision
  );

  perform dashboard_private.write_registration_track_event_v2(
    v_track.task_id,
    v_track.id,
    'registration_observation_canceled',
    v_track.workflow_status,
    v_track.workflow_status,
    null,
    pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'observationId', v_observation.id,
      'appointmentId', v_appointment.id,
      'observationRevisionBefore', v_observation_revision_before,
      'observationRevisionAfter', v_observation.revision,
      'appointmentNotificationRevisionBefore',
        v_notification_revision_before,
      'appointmentNotificationRevisionAfter',
        v_appointment.notification_revision
    ),
    'user',
    null
  );

  v_response := dashboard_private.registration_observation_response_v1(
    'cancel', p_request_key, v_track, v_observation, v_appointment, true
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id, operation, request_key, track_id,
    request_fingerprint, response_payload
  ) values (
    v_actor, 'cancel', p_request_key, v_track.id,
    v_fingerprint, v_response
  );
  return v_response;
end;
$$;

-- Withdrawal previously combined an observation action with a registration
-- status transition. That combined mutation is retired; callers must cancel an
-- active booking and edit the manual status through their separate controls.
create or replace function dashboard_private.withdraw_registration_observation_v1_impl(
  p_track_id uuid,
  p_exit_kind text,
  p_target_workflow_status text,
  p_decision_observation_id uuid,
  p_expected_workflow_revision integer,
  p_expected_decision_observation_revision bigint,
  p_expected_decision_feedback_revision bigint,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'registration_observation_withdraw_retired'
    using errcode = '55000';
end;
$$;

create or replace function public.enter_registration_observation_v1(
  p_track_id uuid,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.enter_registration_observation_v1_impl(
    p_track_id,
    p_expected_workflow_revision,
    p_request_key
  );
$$;

create or replace function public.save_registration_observation_booking_v1(
  p_track_id uuid,
  p_observation_id uuid,
  p_class_id uuid,
  p_session_authority text,
  p_class_lesson_session_id uuid,
  p_legacy_session_key text,
  p_expected_workflow_revision integer,
  p_expected_appointment_notification_revision integer,
  p_expected_observation_revision bigint,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.save_registration_observation_booking_v1_impl(
    p_track_id,
    p_observation_id,
    p_class_id,
    p_session_authority,
    p_class_lesson_session_id,
    p_legacy_session_key,
    p_expected_workflow_revision,
    p_expected_appointment_notification_revision,
    p_expected_observation_revision,
    p_request_key
  );
$$;

create or replace function public.cancel_registration_observation_v1(
  p_observation_id uuid,
  p_expected_appointment_notification_revision integer,
  p_expected_observation_revision bigint,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.cancel_registration_observation_v1_impl(
    p_observation_id,
    p_expected_appointment_notification_revision,
    p_expected_observation_revision,
    p_request_key
  );
$$;

alter function dashboard_private.enter_registration_observation_v1_impl(uuid, integer, text)
  owner to postgres;
alter function dashboard_private.save_registration_observation_booking_v1_impl(uuid, uuid, uuid, text, uuid, text, integer, integer, bigint, text)
  owner to postgres;
alter function dashboard_private.cancel_registration_observation_v1_impl(uuid, integer, bigint, text)
  owner to postgres;
alter function dashboard_private.withdraw_registration_observation_v1_impl(
  uuid, text, text, uuid, integer, bigint, bigint, text, text
) owner to postgres;
alter function public.enter_registration_observation_v1(uuid, integer, text)
  owner to postgres;
alter function public.save_registration_observation_booking_v1(uuid, uuid, uuid, text, uuid, text, integer, integer, bigint, text)
  owner to postgres;
alter function public.cancel_registration_observation_v1(uuid, integer, bigint, text)
  owner to postgres;

revoke all on function dashboard_private.enter_registration_observation_v1_impl(uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_registration_observation_booking_v1_impl(uuid, uuid, uuid, text, uuid, text, integer, integer, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_registration_observation_v1_impl(uuid, integer, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.withdraw_registration_observation_v1_impl(
  uuid, text, text, uuid, integer, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.enter_registration_observation_v1_impl(uuid, integer, text)
  to authenticated;
grant execute on function dashboard_private.save_registration_observation_booking_v1_impl(uuid, uuid, uuid, text, uuid, text, integer, integer, bigint, text)
  to authenticated;
grant execute on function dashboard_private.cancel_registration_observation_v1_impl(uuid, integer, bigint, text)
  to authenticated;

revoke all on function public.enter_registration_observation_v1(uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.save_registration_observation_booking_v1(uuid, uuid, uuid, text, uuid, text, integer, integer, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_registration_observation_v1(uuid, integer, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.withdraw_registration_observation_v1(
  uuid, text, text, uuid, integer, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.enter_registration_observation_v1(uuid, integer, text)
  to authenticated;
grant execute on function public.save_registration_observation_booking_v1(uuid, uuid, uuid, text, uuid, text, integer, integer, bigint, text)
  to authenticated;
grant execute on function public.cancel_registration_observation_v1(uuid, integer, bigint, text)
  to authenticated;

commit;
