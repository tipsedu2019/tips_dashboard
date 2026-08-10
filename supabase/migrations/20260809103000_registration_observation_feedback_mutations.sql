begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

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
  if pg_catalog.now() < v_observation.starts_at then
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
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_event_kind text;
  v_audit_event_type text;
  v_workflow_status_before text;
  v_workflow_revision_before integer;
  v_observation_revision_before bigint;
  v_feedback_revision_before bigint;
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
    request.response_payload
  into
    v_existing_operation,
    v_existing_fingerprint,
    v_existing_response
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
    if pg_catalog.now() < v_observation.ends_at then
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
    if pg_catalog.now() < v_observation.starts_at then
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
