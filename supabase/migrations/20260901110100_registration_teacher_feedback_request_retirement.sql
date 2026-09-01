begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Teacher feedback requests are no longer part of registration. Keep the
-- historical link rows, task rows, feedback facts, and audit rows intact.
drop trigger if exists sync_registration_observation_feedback_task_v1
  on public.ops_registration_observations;
drop trigger if exists guard_registration_feedback_task_completion_v1
  on public.ops_tasks;

create or replace function dashboard_private.sync_registration_observation_feedback_task_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return new;
end;
$$;

create or replace function dashboard_private.guard_registration_feedback_task_completion_v1()
returns trigger
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return new;
end;
$$;

-- Close only still-active requests. The relationship and its history remain
-- available for audit and for reading feedback that was already submitted.
with retirement_events as materialized (
  select
    pg_catalog.gen_random_uuid() as event_id,
    task.id as task_id,
    task.status as before_status,
    pg_catalog.clock_timestamp() as occurred_at
  from dashboard_private.registration_observation_feedback_tasks link
  join public.ops_tasks task
    on task.id = link.task_id
  where task.status not in ('done', 'canceled')
    and not exists (
      select 1
      from public.ops_task_events existing
      where existing.task_id = task.id
        and existing.event_type =
          'registration_observation_feedback_request_retired'
    )
)
insert into public.ops_task_events(
  id,
  task_id,
  actor_id,
  event_type,
  field_name,
  before_value,
  after_value,
  request_id,
  payload,
  created_at
)
select
  event.event_id,
  event.task_id,
  null,
  'registration_observation_feedback_request_retired',
  'status',
  event.before_status,
  'canceled',
  null,
  pg_catalog.jsonb_build_object(
    'reason', 'feature_retired',
    'source', 'system',
    'migration',
      '20260901110100_registration_teacher_feedback_request_retirement',
    'occurredAt', event.occurred_at
  ),
  event.occurred_at
from retirement_events event;

update public.ops_tasks task
set status = 'canceled',
    completed_at = null,
    memo = case
      when pg_catalog.strpos(
        coalesce(task.memo, ''),
        'system:feature_retired'
      ) > 0
        then task.memo
      else pg_catalog.concat_ws(
        E'\n',
        nullif(pg_catalog.btrim(task.memo), ''),
        'system:feature_retired · 교사 피드백 요청 기능 종료'
      )
    end,
    updated_at = pg_catalog.clock_timestamp()
from dashboard_private.registration_observation_feedback_tasks link
where link.task_id = task.id
  and task.status not in ('done', 'canceled');

alter function dashboard_private.sync_registration_observation_feedback_task_v1()
  owner to postgres;
alter function dashboard_private.guard_registration_feedback_task_completion_v1()
  owner to postgres;
revoke all on function dashboard_private.sync_registration_observation_feedback_task_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.guard_registration_feedback_task_completion_v1()
  from public, anon, authenticated, service_role;

-- Retain the RPC names so old clients fail closed instead of accidentally
-- reaching an older definition through a cached schema, but remove all grants.
create or replace function dashboard_private.submit_registration_observation_feedback_v1_impl(
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
security invoker
set search_path = ''
as $$
begin
  raise exception 'registration_observation_feedback_retired'
    using errcode = '55000';
end;
$$;

create or replace function dashboard_private.correct_registration_observation_feedback_v1_impl(
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
security invoker
set search_path = ''
as $$
begin
  raise exception 'registration_observation_feedback_retired'
    using errcode = '55000';
end;
$$;

alter function dashboard_private.submit_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, integer, text
) owner to postgres;
alter function dashboard_private.correct_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, text, text
) owner to postgres;

revoke all on function dashboard_private.submit_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.submit_registration_observation_feedback_v1(
  uuid, text, text, text, bigint, bigint, integer, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.correct_registration_observation_feedback_v1_impl(
  uuid, text, text, text, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.correct_registration_observation_feedback_v1(
  uuid, text, text, text, bigint, bigint, text, text
) from public, anon, authenticated, service_role;

-- Kill the feedback-due producer at its narrowest shared entrypoint. Other
-- observation Chat events keep their existing producer behavior.
create or replace function dashboard_private.insert_registration_observation_chat_job_v1(
  p_domain_event_id uuid,
  p_assignment_fact_id uuid,
  p_observation_id uuid,
  p_appointment_id uuid,
  p_notification_revision integer,
  p_event_key text,
  p_source_revision jsonb,
  p_booking_fact_hash text,
  p_current_booking jsonb,
  p_previous_booking jsonb,
  p_preparation jsonb,
  p_submission jsonb,
  p_mention_role text,
  p_mention_profile_ids uuid[],
  p_due_at timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_rules jsonb;
  v_enabled boolean;
  v_job_id uuid;
begin
  if p_event_key = 'registration.observation_feedback_due' then
    return null;
  end if;

  v_rules := dashboard_private.registration_observation_chat_rule_snapshot_v1(
    p_event_key
  );
  if pg_catalog.jsonb_array_length(v_rules) = 0 then
    raise exception 'registration_observation_chat_rule_missing'
      using errcode = '55000';
  end if;
  select coalesce(
    pg_catalog.bool_or((item ->> 'enabled')::boolean),
    false
  )
  into v_enabled
  from pg_catalog.jsonb_array_elements(v_rules) item;

  insert into dashboard_private.registration_observation_chat_jobs(
    domain_event_id,
    assignment_fact_id,
    observation_id,
    appointment_id,
    notification_revision,
    event_key,
    source_revision,
    booking_fact_hash,
    reservation_snapshot_hash,
    current_booking_snapshot,
    previous_booking_snapshot,
    preparation_snapshot,
    submission_snapshot,
    mention_role,
    mention_profile_ids,
    rule_snapshot,
    due_at,
    expires_at,
    status,
    next_attempt_at,
    last_error_code,
    completed_at
  ) values (
    p_domain_event_id,
    p_assignment_fact_id,
    p_observation_id,
    p_appointment_id,
    p_notification_revision,
    p_event_key,
    p_source_revision,
    p_booking_fact_hash,
    dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
      p_event_key,
      p_current_booking,
      p_previous_booking
    ),
    p_current_booking,
    p_previous_booking,
    p_preparation,
    p_submission,
    p_mention_role,
    dashboard_private.google_chat_canonical_uuid_array_v1(
      p_mention_profile_ids
    ),
    v_rules,
    p_due_at,
    p_expires_at,
    case when v_enabled then 'pending' else 'suppressed' end,
    case when v_enabled then p_due_at else null end,
    case when v_enabled then null else 'rule_disabled_at_source' end,
    case
      when v_enabled then null
      else pg_catalog.clock_timestamp()
    end
  )
  on conflict do nothing
  returning job_id into v_job_id;

  return v_job_id;
end;
$$;

alter function dashboard_private.insert_registration_observation_chat_job_v1(
  uuid, uuid, uuid, uuid, integer, text, jsonb, text, jsonb, jsonb,
  jsonb, jsonb, text, uuid[], timestamptz, timestamptz
) owner to postgres;
revoke all on function dashboard_private.insert_registration_observation_chat_job_v1(
  uuid, uuid, uuid, uuid, integer, text, jsonb, text, jsonb, jsonb,
  jsonb, jsonb, text, uuid[], timestamptz, timestamptz
) from public, anon, authenticated, service_role;

update dashboard_private.notification_rules rule
set enabled = false,
    updated_at = pg_catalog.clock_timestamp()
where rule.workflow_key = 'registration'
  and rule.event_key = 'registration.observation_feedback_due'
  and rule.enabled;

update dashboard_private.registration_observation_chat_jobs job
set status = 'canceled',
    next_attempt_at = null,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    materialized_event_id = null,
    last_error_code = 'feature_retired',
    completed_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
where job.event_key = 'registration.observation_feedback_due'
  and job.status in ('pending', 'claimed');

update dashboard_private.notification_event_fanout_jobs job
set status = 'failed',
    next_attempt_at = null,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    last_error_code = 'feature_retired',
    completed_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
from dashboard_private.notification_events event_row
where event_row.id = job.event_id
  and event_row.workflow_key = 'registration'
  and event_row.event_key = 'registration.observation_feedback_due'
  and job.status in ('pending', 'claimed');

update dashboard_private.notification_deliveries delivery
set status = 'canceled',
    status_reason = 'source_status_changed',
    cancel_reason = 'registration_teacher_feedback_request_retired',
    next_attempt_at = null,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    resolved_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
from dashboard_private.notification_events event_row
where event_row.id = delivery.event_id
  and event_row.workflow_key = 'registration'
  and event_row.event_key = 'registration.observation_feedback_due'
  and delivery.status in ('pending', 'claimed', 'retry_wait');

-- Attendance is an observation fact. It must not advance the independently
-- managed registration status property.
create or replace function dashboard_private.record_registration_observation_attendance_v1_impl(
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

  v_current_session :=
    dashboard_private.assert_registration_observation_current_session_v1(
      v_observation.id,
      'record_attendance'
    );
  if pg_catalog.now() < (v_current_session ->> 'startsAt')::timestamptz then
    raise exception 'registration_observation_time_boundary_rejected'
      using errcode = '55000';
  end if;

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
    v_track.workflow_status,
    v_track.workflow_status,
    null,
    pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'observationId', v_observation.id,
      'appointmentId', v_appointment.id,
      'workflowRevisionBefore', v_track.workflow_revision,
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

-- A management decision confirms the observation fact; it does not set the
-- registration status property and no longer waits for a database feedback row.
create or replace function dashboard_private.decide_registration_observation_v1_impl(
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
  v_fingerprint text;
  v_existing_operation text;
  v_existing_fingerprint text;
  v_existing_response jsonb;
  v_existing_track_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
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

  if v_actor_role not in ('admin', 'staff') then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

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
      when 'attended_feedback_pending' then 'observation_attendance_recorded'
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

  if v_observation.revision <> p_expected_observation_revision
    or v_observation.feedback_revision <> p_expected_feedback_revision
  then
    raise exception 'registration_observation_stale_revision'
      using errcode = '23514';
  end if;
  if v_observation.status not in ('attended_feedback_pending', 'completed', 'no_show')
    or v_observation.decision_kind is not null
    or v_appointment.kind <> 'observation_class'
    or v_appointment.status <> 'completed'
  then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;
  if v_observation.status in ('attended_feedback_pending', 'completed')
    and (
      v_observation.attendance <> 'attended'
      or v_observation.attendance_recorded_by is null
      or v_observation.attendance_recorded_at is null
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

  perform dashboard_private.write_registration_track_event_v2(
    v_track.task_id,
    v_track.id,
    'registration_observation_decided',
    v_track.workflow_status,
    v_track.workflow_status,
    null,
    pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'observationId', v_observation.id,
      'decisionKind', v_observation.decision_kind,
      'waitingClassId', p_waiting_class_id,
      'workflowRevisionBefore', v_track.workflow_revision,
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

alter function dashboard_private.record_registration_observation_attendance_v1_impl(
  uuid, bigint, integer, text
) owner to postgres;
alter function dashboard_private.decide_registration_observation_v1_impl(
  uuid, text, uuid, bigint, bigint, integer, text
) owner to postgres;

revoke all on function dashboard_private.record_registration_observation_attendance_v1_impl(
  uuid, bigint, integer, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.decide_registration_observation_v1_impl(
  uuid, text, uuid, bigint, bigint, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_registration_observation_attendance_v1(
  uuid, bigint, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.decide_registration_observation_v1(
  uuid, text, uuid, bigint, bigint, integer, text
) from public, anon, authenticated, service_role;

grant execute on function dashboard_private.record_registration_observation_attendance_v1_impl(
  uuid, bigint, integer, text
) to authenticated;
grant execute on function dashboard_private.decide_registration_observation_v1_impl(
  uuid, text, uuid, bigint, bigint, integer, text
) to authenticated;
grant execute on function public.record_registration_observation_attendance_v1(
  uuid, bigint, integer, text
) to authenticated;
grant execute on function public.decide_registration_observation_v1(
  uuid, text, uuid, bigint, bigint, integer, text
) to authenticated;

-- Enrollment readiness depends on the observed class/session identity and the
-- management decision. It does not depend on a retired feedback submission.
create or replace function dashboard_private.validate_registration_observation_class_start_source_v1(
  p_track_id uuid,
  p_observation_id uuid,
  p_class_id uuid,
  p_class_start_date date,
  p_class_start_session_key text,
  p_class_start_lesson_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_observation record;
  v_session_key text;
  v_session_label text;
begin
  if (select auth.uid()) is null
    or not dashboard_private.registration_observation_current_actor_is_active_manager_v1()
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if p_track_id is null
    or p_observation_id is null
    or p_class_id is null
    or p_class_start_date is null
    or nullif(
      pg_catalog.btrim(p_class_start_session_key),
      ''
    ) is null
  then
    raise exception 'registration_observation_class_start_source_invalid'
      using errcode = '23514';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    p_track_id,
    'save_enrollment_rows'
  );

  select
    observation.id,
    observation.task_id,
    observation.track_id,
    observation.class_id,
    observation.session_authority,
    observation.class_lesson_session_id,
    observation.legacy_session_key,
    observation.session_date,
    observation.starts_at,
    observation.ends_at,
    observation.status,
    observation.attendance,
    observation.decision_kind,
    lesson.session_key as normalized_session_key
  into v_observation
  from public.ops_registration_observations observation
  join public.ops_registration_subject_tracks track
    on track.id = observation.track_id
   and track.task_id = observation.task_id
  left join public.class_lesson_sessions lesson
    on lesson.id = observation.class_lesson_session_id
   and lesson.class_id = observation.class_id
  where observation.id = p_observation_id
    and observation.task_id = v_task_id
    and observation.task_id = track.task_id
    and observation.track_id = p_track_id
    and observation.class_id = p_class_id
    and observation.status in ('attended_feedback_pending', 'completed')
    and observation.attendance = 'attended'
    and observation.decision_kind = 'enrollment'
  for update of observation;

  if not found then
    raise exception 'registration_observation_class_start_source_invalid'
      using errcode = '23514';
  end if;

  if v_observation.session_authority = 'normalized' then
    if v_observation.class_lesson_session_id is null
      or v_observation.normalized_session_key is null
      or p_class_start_lesson_session_id
        is distinct from v_observation.class_lesson_session_id
      or p_class_start_date is distinct from v_observation.session_date
      or pg_catalog.btrim(p_class_start_session_key)
        is distinct from v_observation.normalized_session_key
    then
      raise exception 'registration_observation_class_start_source_invalid'
        using errcode = '23514';
    end if;
    v_session_key := v_observation.normalized_session_key;
  elsif v_observation.session_authority = 'legacy' then
    if p_class_start_lesson_session_id is not null
      or nullif(
        pg_catalog.btrim(v_observation.legacy_session_key),
        ''
      ) is null
      or p_class_start_date is distinct from v_observation.session_date
      or pg_catalog.btrim(p_class_start_session_key)
        is distinct from pg_catalog.btrim(v_observation.legacy_session_key)
    then
      raise exception 'registration_observation_class_start_source_invalid'
        using errcode = '23514';
    end if;
    v_session_key := pg_catalog.btrim(v_observation.legacy_session_key);
  else
    raise exception 'registration_observation_class_start_source_invalid'
      using errcode = '23514';
  end if;

  v_session_label :=
    pg_catalog.to_char(
      v_observation.starts_at at time zone 'Asia/Seoul',
      'YYYY-MM-DD HH24:MI'
    )
    || '–'
    || pg_catalog.to_char(
      v_observation.ends_at at time zone 'Asia/Seoul',
      'HH24:MI'
    );

  return pg_catalog.jsonb_build_object(
    'observationId', v_observation.id,
    'classId', v_observation.class_id,
    'classStartDate', v_observation.session_date,
    'classStartSessionKey', v_session_key,
    'classStartLessonSessionId',
      case
        when v_observation.session_authority = 'normalized'
          then v_observation.class_lesson_session_id
        else null
      end,
    'classStartSession', v_session_label
  );
end;
$$;

alter function dashboard_private.validate_registration_observation_class_start_source_v1(
  uuid, uuid, uuid, date, text, uuid
) owner to postgres;
revoke all on function dashboard_private.validate_registration_observation_class_start_source_v1(
  uuid, uuid, uuid, date, text, uuid
) from public, anon, authenticated, service_role;

commit;
