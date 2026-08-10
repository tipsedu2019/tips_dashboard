begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function dashboard_private.correct_registration_observation_feedback_v1_impl(
  p_observation_id uuid,
  p_suitability_result text,
  p_feedback_reason text,
  p_correction_reason text,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_decision_kind text,
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
  v_suitability_result text := pg_catalog.btrim(p_suitability_result);
  v_feedback_reason text := nullif(pg_catalog.btrim(p_feedback_reason), '');
  v_correction_reason text := nullif(pg_catalog.btrim(p_correction_reason), '');
  v_expected_decision_kind text := case
    when p_expected_decision_kind is null then null
    else pg_catalog.btrim(p_expected_decision_kind)
  end;
  v_fingerprint text;
  v_existing_operation text;
  v_existing_fingerprint text;
  v_existing_response jsonb;
  v_existing_track_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_suitability_before text;
  v_feedback_reason_before text;
  v_feedback_revision_before bigint;
  v_response jsonb;
begin
  if p_observation_id is null
    or v_suitability_result is null
    or v_suitability_result not in ('fit', 'unfit')
    or v_feedback_reason is null
    or v_correction_reason is null
    or p_expected_observation_revision is null
    or p_expected_observation_revision < 1
    or p_expected_feedback_revision is null
    or p_expected_feedback_revision < 1
    or (
      p_expected_decision_kind is not null
      and v_expected_decision_kind not in (
        'enrollment',
        'waiting_current_class',
        'waiting_new_class',
        'waiting_next_opening',
        'not_registered',
        're_observation'
      )
    )
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_feedback_correction_invalid'
      using errcode = '22023';
  end if;

  select profile.role
  into v_actor_role
  from public.profiles profile
  where profile.id = v_actor;

  v_fingerprint :=
    dashboard_private.registration_observation_request_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'operation', 'correct_feedback',
        'observationId', p_observation_id,
        'suitabilityResult', v_suitability_result,
        'feedbackReason', v_feedback_reason,
        'correctionReason', v_correction_reason,
        'expectedObservationRevision', p_expected_observation_revision,
        'expectedFeedbackRevision', p_expected_feedback_revision,
        'expectedDecisionKind', v_expected_decision_kind
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
    if v_existing_operation <> 'correct_feedback'
      or v_existing_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    if not exists (
      select 1
      from public.ops_registration_subject_tracks track
      join public.ops_registration_observations observation
        on observation.track_id = track.id
       and observation.task_id = track.task_id
      where observation.id = p_observation_id
        and track.id = v_existing_track_id
        and (
          v_actor_role in ('admin', 'staff')
          or (
            observation.decision_kind is null
            and v_actor_role = 'teacher'
            and observation.teacher_profile_id = v_actor
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

  perform event.observation_id
  from dashboard_private.registration_observation_domain_events event
  where event.observation_id = v_observation.id
    and event.appointment_id = v_appointment.id
    and event.notification_revision = v_appointment.notification_revision
    and event.event_kind = 'observation_feedback_submitted'
    and event.booking_fact_hash = v_observation.booking_fact_hash
    and event.source_revision = v_observation.source_revision
  for update;
  if not found then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
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
    or v_observation.decision_kind is distinct from v_expected_decision_kind
  then
    raise exception 'registration_observation_stale_revision'
      using errcode = '40001';
  end if;
  if v_observation.status <> 'completed'
    or v_observation.attendance <> 'attended'
    or v_observation.suitability_result is null
    or v_observation.feedback_reason is null
    or v_observation.feedback_submitted_by is null
    or v_observation.feedback_submitted_at is null
    or v_appointment.kind <> 'observation_class'
    or v_appointment.status <> 'completed'
  then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;
  if v_observation.decision_kind is not null then
    if v_actor_role not in ('admin', 'staff') then
      raise exception 'registration_observation_not_found'
        using errcode = 'P0002';
    end if;
    if v_suitability_result <> v_observation.suitability_result then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;
    if v_observation.decision_kind = 're_observation'
      and exists (
        select 1
        from public.ops_registration_observations later
        where later.track_id = v_track.id
          and (
            later.created_at > v_observation.created_at
            or (
              later.created_at = v_observation.created_at
              and later.id > v_observation.id
            )
          )
          and not (
            later.decision_kind is null
            and later.status = 'canceled'
          )
      )
    then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;
  end if;

  v_suitability_before := v_observation.suitability_result;
  v_feedback_reason_before := v_observation.feedback_reason;
  v_feedback_revision_before := v_observation.feedback_revision;

  update public.ops_registration_observations observation
  set suitability_result = v_suitability_result,
      feedback_reason = v_feedback_reason,
      feedback_revision = observation.feedback_revision + 1,
      updated_by = v_actor,
      updated_at = pg_catalog.now()
  where observation.id = v_observation.id
  returning observation.* into v_observation;

  perform dashboard_private.write_registration_track_event_v2(
    v_track.task_id,
    v_track.id,
    'registration_observation_feedback_corrected',
    v_track.workflow_status,
    v_track.workflow_status,
    null,
    pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'observationId', v_observation.id,
      'before', pg_catalog.jsonb_build_object(
        'suitabilityResult', v_suitability_before,
        'feedbackReason', v_feedback_reason_before,
        'feedbackRevision', v_feedback_revision_before
      ),
      'after', pg_catalog.jsonb_build_object(
        'suitabilityResult', v_observation.suitability_result,
        'feedbackReason', v_observation.feedback_reason,
        'feedbackRevision', v_observation.feedback_revision
      ),
      'correctionReason', v_correction_reason,
      'correctedByProfileId', v_actor
    ),
    'user',
    null
  );

  v_response := dashboard_private.registration_observation_response_v1(
    'correct_feedback',
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
    'correct_feedback',
    p_request_key,
    v_track.id,
    v_fingerprint,
    v_response
  );

  return v_response;
end;
$$;

create function dashboard_private.decide_registration_observation_v1_impl(
  p_observation_id uuid,
  p_decision_kind text,
  p_waiting_class_id uuid,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_track_workflow_revision integer,
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
  v_decision_kind text := pg_catalog.btrim(p_decision_kind);
  v_target_workflow_status text;
  v_waiting_detail_kind text;
  v_fingerprint text;
  v_existing_operation text;
  v_existing_fingerprint text;
  v_existing_response jsonb;
  v_existing_track_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_workflow_revision_before integer;
  v_observation_revision_before bigint;
  v_feedback_revision_before bigint;
  v_response jsonb;
begin
  if p_observation_id is null
    or v_decision_kind is null
    or v_decision_kind not in (
      'enrollment',
      'waiting_current_class',
      'waiting_new_class',
      'waiting_next_opening',
      'not_registered',
      're_observation'
    )
    or (
      v_decision_kind = 'waiting_current_class'
    ) is distinct from (
      p_waiting_class_id is not null
    )
    or p_expected_observation_revision is null
    or p_expected_observation_revision < 1
    or p_expected_feedback_revision is null
    or p_expected_feedback_revision < 0
    or p_expected_track_workflow_revision is null
    or p_expected_track_workflow_revision < 1
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_decision_invalid'
      using errcode = '22023';
  end if;

  select profile.role
  into v_actor_role
  from public.profiles profile
  where profile.id = v_actor;

  v_fingerprint :=
    dashboard_private.registration_observation_request_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'operation', 'decide',
        'observationId', p_observation_id,
        'decisionKind', v_decision_kind,
        'waitingClassId', p_waiting_class_id,
        'expectedObservationRevision', p_expected_observation_revision,
        'expectedFeedbackRevision', p_expected_feedback_revision,
        'expectedTrackWorkflowRevision', p_expected_track_workflow_revision
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
    if v_existing_operation <> 'decide'
      or v_existing_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    if not exists (
      select 1
      from public.ops_registration_subject_tracks track
      join public.ops_registration_observations observation
        on observation.track_id = track.id
       and observation.task_id = track.task_id
      where observation.id = p_observation_id
        and track.id = v_existing_track_id
        and (
          v_actor_role in ('admin', 'staff')
          or track.director_profile_id = v_actor
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

  perform event.observation_id
  from dashboard_private.registration_observation_domain_events event
  where event.observation_id = v_observation.id
    and event.appointment_id = v_appointment.id
    and event.notification_revision = v_appointment.notification_revision
    and event.event_kind = case v_observation.status
      when 'completed' then 'observation_feedback_submitted'
      when 'no_show' then 'observation_no_show'
      else '__invalid__'
    end
    and event.booking_fact_hash = v_observation.booking_fact_hash
    and event.source_revision = v_observation.source_revision
  for update;
  if not found then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;

  if not (
    v_actor_role in ('admin', 'staff')
    or v_track.director_profile_id = v_actor
  ) then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  if v_observation.revision <> p_expected_observation_revision
    or v_observation.feedback_revision <> p_expected_feedback_revision
    or v_track.workflow_revision <> p_expected_track_workflow_revision
  then
    raise exception 'registration_observation_stale_revision'
      using errcode = '40001';
  end if;
  if v_track.workflow_status <> 'observation_completed'
    or v_observation.status not in ('completed', 'no_show')
    or v_observation.decision_kind is not null
    or v_appointment.kind <> 'observation_class'
    or v_appointment.status <> 'completed'
  then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;
  if v_observation.status = 'completed'
    and (
      v_observation.attendance <> 'attended'
      or v_observation.suitability_result is null
      or v_observation.feedback_reason is null
      or v_observation.feedback_submitted_by is null
      or v_observation.feedback_submitted_at is null
    )
  then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;
  if v_observation.status = 'no_show'
    and v_observation.attendance <> 'no_show'
  then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;
  if v_decision_kind = 'waiting_current_class' then
    perform class.id
    from public.classes class
    where class.id = p_waiting_class_id
      and class.subject = v_track.subject
      and class.closed_at is null
    for share;
    if not found then
      raise exception 'registration_observation_transition_rejected'
        using errcode = '55000';
    end if;
  end if;

  v_target_workflow_status := case v_decision_kind
    when 'enrollment' then 'enrollment_requested'
    when 'waiting_current_class' then 'waiting_current_class'
    when 'waiting_new_class' then 'waiting_new_class'
    when 'waiting_next_opening' then 'waiting_next_opening'
    when 'not_registered' then 'not_registered'
    when 're_observation' then 'observation_requested'
  end;
  v_waiting_detail_kind := case v_decision_kind
    when 'waiting_current_class' then 'current_class'
    when 'waiting_new_class' then 'current_term_opening'
    when 'waiting_next_opening' then 'next_term_opening'
    else null
  end;
  v_workflow_revision_before := v_track.workflow_revision;
  v_observation_revision_before := v_observation.revision;
  v_feedback_revision_before := v_observation.feedback_revision;

  update public.ops_registration_observations observation
  set decision_kind = v_decision_kind,
      decided_by = v_actor,
      decided_at = pg_catalog.now(),
      revision = observation.revision + 1,
      updated_by = v_actor,
      updated_at = pg_catalog.now()
  where observation.id = v_observation.id
  returning observation.* into v_observation;

  if v_decision_kind = 're_observation' then
    update public.ops_registration_subject_tracks track
    set workflow_status = v_target_workflow_status,
        workflow_revision = track.workflow_revision + 1,
        workflow_status_entered_at = pg_catalog.now(),
        waiting_detail_kind = null,
        waiting_detail_class_id = null,
        waiting_detail_retake_decision = null,
        updated_at = pg_catalog.now()
    where track.id = v_track.id
    returning track.* into v_track;
  else
    update public.ops_registration_subject_tracks track
    set workflow_status = v_target_workflow_status,
        workflow_revision = track.workflow_revision + 1,
        workflow_status_entered_at = pg_catalog.now(),
        observation_return_workflow_status = null,
        waiting_detail_kind = v_waiting_detail_kind,
        waiting_detail_class_id = p_waiting_class_id,
        waiting_detail_retake_decision = null,
        updated_at = pg_catalog.now()
    where track.id = v_track.id
    returning track.* into v_track;
  end if;

  perform dashboard_private.write_registration_track_event_v2(
    v_track.task_id,
    v_track.id,
    'registration_observation_decided',
    'observation_completed',
    v_track.workflow_status,
    null,
    pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'observationId', v_observation.id,
      'decisionKind', v_observation.decision_kind,
      'waitingClassId', p_waiting_class_id,
      'workflowRevisionBefore', v_workflow_revision_before,
      'workflowRevisionAfter', v_track.workflow_revision,
      'observationRevisionBefore', v_observation_revision_before,
      'observationRevisionAfter', v_observation.revision,
      'feedbackRevisionBefore', v_feedback_revision_before,
      'feedbackRevisionAfter', v_observation.feedback_revision,
      'appointmentNotificationRevisionBefore',
        v_appointment.notification_revision,
      'appointmentNotificationRevisionAfter',
        v_appointment.notification_revision,
      'decidedByProfileId', v_actor
    ),
    'user',
    null
  );

  v_response := dashboard_private.registration_observation_response_v1(
    'decide',
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
    'decide',
    p_request_key,
    v_track.id,
    v_fingerprint,
    v_response
  );

  return v_response;
end;
$$;

create function public.correct_registration_observation_feedback_v1(
  p_observation_id uuid,
  p_suitability_result text,
  p_feedback_reason text,
  p_correction_reason text,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_decision_kind text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.correct_registration_observation_feedback_v1_impl(
    p_observation_id,
    p_suitability_result,
    p_feedback_reason,
    p_correction_reason,
    p_expected_observation_revision,
    p_expected_feedback_revision,
    p_expected_decision_kind,
    p_request_key
  );
$$;

create function public.decide_registration_observation_v1(
  p_observation_id uuid,
  p_decision_kind text,
  p_waiting_class_id uuid,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_track_workflow_revision integer,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.decide_registration_observation_v1_impl(
    p_observation_id,
    p_decision_kind,
    p_waiting_class_id,
    p_expected_observation_revision,
    p_expected_feedback_revision,
    p_expected_track_workflow_revision,
    p_request_key
  );
$$;

alter function dashboard_private.correct_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, text, text
) owner to postgres;
alter function dashboard_private.decide_registration_observation_v1_impl(
  uuid, text, uuid, bigint, bigint, integer, text
) owner to postgres;
alter function public.correct_registration_observation_feedback_v1(
  uuid, text, text, text, bigint, bigint, text, text
) owner to postgres;
alter function public.decide_registration_observation_v1(
  uuid, text, uuid, bigint, bigint, integer, text
) owner to postgres;

revoke all on function dashboard_private.correct_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.decide_registration_observation_v1_impl(
  uuid, text, uuid, bigint, bigint, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.correct_registration_observation_feedback_v1(
  uuid, text, text, text, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.decide_registration_observation_v1(
  uuid, text, uuid, bigint, bigint, integer, text
) from public, anon, authenticated, service_role;

grant execute on function dashboard_private.correct_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, text, text
) to authenticated;
grant execute on function dashboard_private.decide_registration_observation_v1_impl(
  uuid, text, uuid, bigint, bigint, integer, text
) to authenticated;
grant execute on function public.correct_registration_observation_feedback_v1(
  uuid, text, text, text, bigint, bigint, text, text
) to authenticated;
grant execute on function public.decide_registration_observation_v1(
  uuid, text, uuid, bigint, bigint, integer, text
) to authenticated;

commit;
