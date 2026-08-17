begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Appointment eligibility follows the appointment and its active activities.
-- A subject track may legitimately advance before staff previews or sends the
-- booking message, so its current workflow stage is not an appointment fact.
alter function dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(text, uuid)
  rename to resolve_registration_customer_message_source_pre_booking_eligibility_v1;

revoke all on function dashboard_private.resolve_registration_customer_message_source_pre_booking_eligibility_v1(text, uuid)
  from public, anon, authenticated, service_role;

create function dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(
  p_message_kind text,
  p_source_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_phone_digits text;
  v_appointment public.ops_registration_appointments%rowtype;
  v_subjects jsonb;
  v_participants jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;

  if p_message_kind not in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder'
  ) then
    return dashboard_private.resolve_registration_customer_message_source_pre_booking_eligibility_v1(
      p_message_kind,
      p_source_id
    );
  end if;

  v_task_id := dashboard_private.registration_customer_message_source_task_pre_observation_v1(
    p_message_kind,
    p_source_id
  );

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
    and nullif(pg_catalog.btrim(task.student_name), '') is not null
  for share;
  if not found then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for share;
  if not found then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  v_phone_digits := pg_catalog.regexp_replace(
    coalesce(v_detail.parent_phone, ''),
    '[^0-9]',
    '',
    'g'
  );
  if v_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_source_id
    and appointment.task_id = v_task_id
    and appointment.status = 'scheduled'
    and appointment.scheduled_at > pg_catalog.clock_timestamp()
  for share;

  if not found
    or (p_message_kind = 'level_test_booking' and v_appointment.kind <> 'level_test')
    or (
      p_message_kind = 'visit_consultation_booking'
      and v_appointment.kind <> 'visit_consultation'
    )
  then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  if v_appointment.kind = 'level_test' then
    perform 1
    from public.ops_registration_level_tests level_test
    join public.ops_registration_subject_tracks track
      on track.id = level_test.track_id
    where level_test.appointment_id = v_appointment.id
    order by level_test.id, track.id
    for share of level_test, track;

    select
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'trackId', participant.track_id,
          'subject', participant.subject,
          'workflowStatus', participant.workflow_status,
          'workflowRevision', participant.workflow_revision,
          'activityId', participant.activity_id,
          'activityStatus', participant.activity_status
        ) order by participant.subject_order, participant.track_id, participant.activity_id
      ),
      pg_catalog.jsonb_agg(
        participant.subject
        order by participant.subject_order, participant.track_id
      )
    into v_participants, v_subjects
    from (
      select
        track.id as track_id,
        track.subject,
        track.workflow_status,
        track.workflow_revision,
        level_test.id as activity_id,
        level_test.status as activity_status,
        case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 else 99 end
          as subject_order
      from public.ops_registration_level_tests level_test
      join public.ops_registration_subject_tracks track
        on track.id = level_test.track_id
      where level_test.appointment_id = v_appointment.id
        and level_test.status in ('scheduled', 'in_progress')
        and track.task_id = v_task_id
    ) participant;
  else
    perform 1
    from public.ops_registration_consultations consultation
    join public.ops_registration_subject_tracks track
      on track.id = consultation.track_id
    where consultation.appointment_id = v_appointment.id
    order by consultation.id, track.id
    for share of consultation, track;

    select
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'trackId', participant.track_id,
          'subject', participant.subject,
          'workflowStatus', participant.workflow_status,
          'workflowRevision', participant.workflow_revision,
          'activityId', participant.activity_id,
          'activityStatus', participant.activity_status
        ) order by participant.subject_order, participant.track_id, participant.activity_id
      ),
      pg_catalog.jsonb_agg(
        participant.subject
        order by participant.subject_order, participant.track_id
      )
    into v_participants, v_subjects
    from (
      select
        track.id as track_id,
        track.subject,
        track.workflow_status,
        track.workflow_revision,
        consultation.id as activity_id,
        consultation.status as activity_status,
        case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 else 99 end
          as subject_order
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track
        on track.id = consultation.track_id
      where consultation.appointment_id = v_appointment.id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled'
        and track.task_id = v_task_id
    ) participant;
  end if;

  if v_participants is null
    or pg_catalog.jsonb_array_length(v_participants) = 0
  then
    raise exception 'registration_customer_message_source_ineligible'
      using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'sourceId', p_source_id,
    'taskId', v_task_id,
    'trackId', null,
    'appointmentId', v_appointment.id,
    'sourceRevision', v_appointment.notification_revision,
    'studentName', pg_catalog.btrim(v_task.student_name),
    'parentPhoneDigits', v_phone_digits,
    'subjects', v_subjects,
    'appointmentKind', v_appointment.kind,
    'scheduledAt', v_appointment.scheduled_at,
    'place', pg_catalog.btrim(v_appointment.place),
    'participants', v_participants
  );
end;
$$;

alter function dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(text, uuid)
  owner to postgres;
revoke all on function dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(text, uuid)
  from public, anon, authenticated, service_role;

commit;
