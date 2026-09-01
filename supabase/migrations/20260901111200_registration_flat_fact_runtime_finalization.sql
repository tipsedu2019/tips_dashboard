-- squawk-ignore-file ban-drop-not-null
-- director_profile_id is intentionally optional for fact-only reservation saves;
-- notification readiness validates it only when an explicit send is requested.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Registration facts are durable input. Notification projections are prepared
-- only by an explicit notification action after its own readiness checks.
drop trigger if exists registration_observation_google_chat_materializer
  on dashboard_private.registration_observation_domain_events;
drop trigger if exists registration_observation_google_chat_assignment_materializer
  on dashboard_private.notification_assignment_change_facts;
drop trigger if exists capture_lightweight_registration_booking_alerts
  on public.ops_registration_appointments;
drop trigger if exists write_registration_phone_queue_event_v1
  on public.ops_registration_consultations;
drop trigger if exists capture_registration_observation_teacher_change
  on public.ops_registration_observations;
drop trigger if exists capture_registration_director_change
  on public.ops_task_events;

-- A director is notification readiness data, not a reservation fact
-- prerequisite.
alter table public.ops_registration_consultations
  alter column director_profile_id drop not null;

create or replace function dashboard_private.record_registration_fact_audit_v1(
  p_task_id uuid,
  p_track_id uuid,
  p_fact_type text,
  p_payload jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if p_task_id is null
    or nullif(pg_catalog.btrim(p_fact_type), '') is null
    or not exists (
      select 1
      from public.ops_tasks task
      where task.id = p_task_id
        and task.type = 'registration'
    )
  then
    raise exception 'registration_fact_audit_invalid' using errcode = '23514';
  end if;

  insert into public.ops_task_events(
    task_id,
    actor_id,
    event_type,
    field_name,
    before_value,
    after_value
  ) values (
    p_task_id,
    (select auth.uid()),
    'registration_fact_saved',
    case
      when p_track_id is null then 'registration_fact'
      else 'registration_fact:' || p_track_id::text
    end,
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'factType', pg_catalog.btrim(p_fact_type),
      'trackId', p_track_id,
      'payload', coalesce(p_payload, '{}'::jsonb)
    )::text
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function dashboard_private.save_registration_appointment_details_impl(
  p_appointment_id uuid,
  p_task_id uuid,
  p_kind text,
  p_scheduled_at timestamptz,
  p_place text,
  p_track_ids uuid[],
  p_expected_notification_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_place text := nullif(pg_catalog.btrim(p_place), '');
  v_track_ids uuid[];
  v_existing_track_ids uuid[] := array[]::uuid[];
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
  v_appointment public.ops_registration_appointments%rowtype;
  v_appointment_id uuid;
  v_activity_id uuid;
  v_activity_ids uuid[] := array[]::uuid[];
  v_track record;
  v_consultation public.ops_registration_consultations%rowtype;
  v_changed boolean := false;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_task_id is null
    or p_kind not in ('level_test', 'visit_consultation')
    or p_scheduled_at is null
    or v_place is null
  then
    raise exception 'registration_appointment_details_invalid' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct item order by item),
    array[]::uuid[]
  )
  into v_track_ids
  from pg_catalog.unnest(coalesce(p_track_ids, array[]::uuid[])) item
  where item is not null;
  if pg_catalog.cardinality(v_track_ids) not between 1 and 2 then
    raise exception 'registration_appointment_tracks_required' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'taskId', p_task_id,
    'kind', p_kind,
    'scheduledAt', p_scheduled_at,
    'place', v_place,
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'expectedNotificationRevision', p_expected_notification_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from p_task_id
      or v_saved_type is distinct from 'save_registration_appointment_details'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'registration_mutation_request_conflict' using errcode = '22023';
    end if;
    return v_response;
  end if;

  perform 1
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    p_task_id,
    null,
    'save_appointment'
  );

  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;
  if (
    select pg_catalog.count(*)
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.id = any(v_track_ids)
      and track.archived_at is null
  ) <> pg_catalog.cardinality(v_track_ids) then
    raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
  end if;

  if p_appointment_id is null then
    insert into public.ops_registration_appointments(
      task_id,
      kind,
      scheduled_at,
      place,
      status,
      notification_revision,
      created_by
    ) values (
      p_task_id,
      p_kind,
      p_scheduled_at,
      v_place,
      'scheduled',
      1,
      v_actor_id
    )
    returning * into v_appointment;
    v_appointment_id := v_appointment.id;
    v_changed := true;
  else
    select appointment.*
    into v_appointment
    from public.ops_registration_appointments appointment
    where appointment.id = p_appointment_id
      and appointment.task_id = p_task_id
    for update;
    if not found or v_appointment.kind is distinct from p_kind then
      raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
    end if;
    if v_appointment.status <> 'scheduled' then
      raise exception 'registration_appointment_not_editable' using errcode = '23514';
    end if;
    if p_expected_notification_revision is null
      or v_appointment.notification_revision
        is distinct from p_expected_notification_revision
    then
      raise exception 'registration_appointment_revision_conflict' using errcode = '23514';
    end if;

    perform 1
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = p_appointment_id
    order by attempt.id
    for update;
    perform 1
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = p_appointment_id
    order by consultation.id
    for update;

    if p_kind = 'level_test' then
      if exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = p_appointment_id
      ) then
        raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
      end if;
      select coalesce(
        pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id)
          filter (where attempt.status in ('scheduled', 'in_progress')),
        array[]::uuid[]
      )
      into v_existing_track_ids
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id;
    else
      if exists (
        select 1
        from public.ops_registration_level_tests attempt
        where attempt.appointment_id = p_appointment_id
      ) or exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = p_appointment_id
          and consultation.mode <> 'visit'
      ) then
        raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
      end if;
      select coalesce(
        pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id)
          filter (where consultation.status in ('waiting', 'scheduled')),
        array[]::uuid[]
      )
      into v_existing_track_ids
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit';
    end if;

    v_changed := v_appointment.scheduled_at is distinct from p_scheduled_at
      or v_appointment.place is distinct from v_place
      or v_existing_track_ids is distinct from v_track_ids;
    update public.ops_registration_appointments appointment
    set scheduled_at = p_scheduled_at,
        place = v_place,
        notification_revision = case
          when v_changed then appointment.notification_revision + 1
          else appointment.notification_revision
        end,
        updated_at = pg_catalog.now()
    where appointment.id = p_appointment_id
    returning * into v_appointment;
    v_appointment_id := v_appointment.id;

    if p_kind = 'level_test' then
      update public.ops_registration_level_tests attempt
      set status = 'canceled',
          completed_at = coalesce(attempt.completed_at, pg_catalog.now()),
          updated_at = pg_catalog.now()
      where attempt.appointment_id = v_appointment_id
        and attempt.status in ('scheduled', 'in_progress')
        and not (attempt.track_id = any(v_track_ids));
    else
      update public.ops_registration_consultations consultation
      set status = 'canceled',
          updated_at = pg_catalog.now()
      where consultation.appointment_id = v_appointment_id
        and consultation.mode = 'visit'
        and consultation.status in ('waiting', 'scheduled')
        and not (consultation.track_id = any(v_track_ids));
    end if;
  end if;

  for v_track in
    select track.id, track.director_profile_id
    from public.ops_registration_subject_tracks track
    where track.id = any(v_track_ids)
      and track.task_id = p_task_id
      and track.archived_at is null
    order by track.id
  loop
    v_activity_id := null;
    if p_kind = 'level_test' then
      select attempt.id
      into v_activity_id
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = v_appointment_id
        and attempt.track_id = v_track.id
        and attempt.status in ('scheduled', 'in_progress')
      order by attempt.id
      limit 1;
      if v_activity_id is null then
        update public.ops_registration_level_tests attempt
        set status = 'scheduled',
            started_at = null,
            completed_at = null,
            material_link = null,
            updated_at = pg_catalog.now()
        where attempt.id = (
          select canceled.id
          from public.ops_registration_level_tests canceled
          where canceled.appointment_id = v_appointment_id
            and canceled.track_id = v_track.id
            and canceled.status = 'canceled'
          order by canceled.id
          limit 1
        )
        returning id into v_activity_id;
      end if;
      if v_activity_id is null then
        if exists (
          select 1
          from public.ops_registration_level_tests attempt
          where attempt.appointment_id = v_appointment_id
            and attempt.track_id = v_track.id
        ) then
          raise exception 'registration_appointment_participant_history_locked'
            using errcode = '23514';
        end if;
        insert into public.ops_registration_level_tests(
          track_id,
          appointment_id,
          attempt_number,
          status
        ) values (
          v_track.id,
          v_appointment_id,
          coalesce((
            select pg_catalog.max(attempt.attempt_number) + 1
            from public.ops_registration_level_tests attempt
            where attempt.track_id = v_track.id
          ), 1),
          'scheduled'
        )
        returning id into v_activity_id;
      end if;
    else
      select consultation.*
      into v_consultation
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = v_appointment_id
        and consultation.track_id = v_track.id
        and consultation.mode = 'visit'
        and consultation.status in ('waiting', 'scheduled')
      order by consultation.id
      limit 1;
      if found then
        v_activity_id := v_consultation.id;
        if v_consultation.director_profile_id
          is distinct from v_track.director_profile_id
        then
          update public.ops_registration_consultations consultation
          set director_profile_id = v_track.director_profile_id,
              updated_at = pg_catalog.now()
          where consultation.id = v_consultation.id;
        end if;
      else
        update public.ops_registration_consultations consultation
        set status = 'scheduled',
            completed_at = null,
            outcome = null,
            director_profile_id = v_track.director_profile_id,
            updated_at = pg_catalog.now()
        where consultation.id = (
          select canceled.id
          from public.ops_registration_consultations canceled
          where canceled.appointment_id = v_appointment_id
            and canceled.track_id = v_track.id
            and canceled.mode = 'visit'
            and canceled.status = 'canceled'
          order by canceled.id
          limit 1
        )
        returning id into v_activity_id;
        if v_activity_id is null then
          insert into public.ops_registration_consultations(
            track_id,
            appointment_id,
            mode,
            status,
            director_profile_id
          ) values (
            v_track.id,
            v_appointment_id,
            'visit',
            'scheduled',
            v_track.director_profile_id
          )
          returning id into v_activity_id;
        end if;
      end if;
    end if;
    v_activity_ids := pg_catalog.array_append(v_activity_ids, v_activity_id);
  end loop;

  perform dashboard_private.record_registration_fact_audit_v1(
    p_task_id,
    null,
    'appointment_details',
    pg_catalog.jsonb_build_object(
      'appointmentId', v_appointment_id,
      'kind', p_kind,
      'scheduledAt', p_scheduled_at,
      'place', v_place,
      'trackIds', pg_catalog.to_jsonb(v_track_ids),
      'revision', v_appointment.notification_revision,
      'changed', v_changed
    )
  );

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'appointmentId', v_appointment_id,
    'notificationRevision', v_appointment.notification_revision,
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'activityIds', pg_catalog.to_jsonb(v_activity_ids)
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    p_task_id,
    'save_registration_appointment_details',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.cancel_registration_appointment_impl(
  p_appointment_id uuid,
  p_expected_notification_revision integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_appointment public.ops_registration_appointments%rowtype;
  v_task_id uuid;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_appointment_id is null
    or p_expected_notification_revision is null
    or v_reason is null
    or v_request_key is null
  then
    raise exception 'registration_appointment_cancel_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'expectedNotificationRevision', p_expected_notification_revision,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select appointment.task_id
  into v_task_id
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id;
  if v_task_id is null then
    raise exception 'registration_appointment_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    null,
    'cancel_appointment'
  );

  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from v_task_id
      or v_saved_type is distinct from 'cancel_appointment'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_response;
  end if;

  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;
  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id
    and appointment.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_appointment_not_found' using errcode = 'P0002';
  end if;

  if v_appointment.notification_revision
      is distinct from p_expected_notification_revision
    or v_appointment.status <> 'scheduled'
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '23514';
  end if;

  perform 1
  from public.ops_registration_level_tests attempt
  where attempt.appointment_id = p_appointment_id
  order by attempt.id
  for update;
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.appointment_id = p_appointment_id
  order by consultation.id
  for update;

  if exists (
    select 1
    from public.ops_registration_level_tests attempt
    join public.ops_registration_subject_tracks track
      on track.id = attempt.track_id
    where attempt.appointment_id = p_appointment_id
      and track.task_id is distinct from v_task_id
  ) or exists (
    select 1
    from public.ops_registration_consultations consultation
    join public.ops_registration_subject_tracks track
      on track.id = consultation.track_id
    where consultation.appointment_id = p_appointment_id
      and track.task_id is distinct from v_task_id
  ) then
    raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
  end if;
  if v_appointment.kind = 'level_test' and exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = p_appointment_id
  ) then
    raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
  end if;
  if v_appointment.kind = 'visit_consultation' and (
    exists (
      select 1
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id
    ) or exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and consultation.mode <> 'visit'
    )
  ) then
    raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
  end if;

  update public.ops_registration_level_tests attempt
  set status = 'canceled',
      completed_at = coalesce(attempt.completed_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  where attempt.appointment_id = p_appointment_id
    and attempt.status in ('scheduled', 'in_progress');
  update public.ops_registration_consultations consultation
  set status = 'canceled',
      updated_at = pg_catalog.now()
  where consultation.appointment_id = p_appointment_id
    and consultation.mode = 'visit'
    and consultation.status in ('waiting', 'scheduled');
  update public.ops_registration_appointments appointment
  set status = 'canceled',
      notification_revision = appointment.notification_revision + 1,
      updated_at = pg_catalog.now()
  where appointment.id = p_appointment_id
  returning * into v_appointment;

  perform dashboard_private.record_registration_fact_audit_v1(
    v_task_id,
    null,
    'appointment_canceled',
    pg_catalog.jsonb_build_object(
      'appointmentId', p_appointment_id,
      'kind', v_appointment.kind,
      'reason', v_reason,
      'revision', v_appointment.notification_revision
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'notificationRevision', v_appointment.notification_revision
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_task_id,
    'cancel_appointment',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(
  p_appointment_id uuid,
  p_expected_notification_revision integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.cancel_registration_appointment_impl($1, $2, $3, $4);
$$;

create or replace function dashboard_private.save_registration_phone_consultation_v1_impl(
  p_track_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_track record;
  v_consultation public.ops_registration_consultations%rowtype;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_track_id is null or v_request_key is null then
    raise exception 'registration_phone_consultation_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.jsonb_build_object('trackId', p_track_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.id, track.task_id, track.director_profile_id
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  where track.id = p_track_id
  for update of track;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    v_track.task_id,
    p_track_id,
    'save_appointment'
  );

  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from v_track.task_id
      or v_saved_type is distinct from 'save_phone_consultation'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'registration_mutation_request_conflict' using errcode = '22023';
    end if;
    return v_response;
  end if;

  select consultation.*
  into v_consultation
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.created_at desc, consultation.id desc
  limit 1
  for update;
  if not found then
    insert into public.ops_registration_consultations(
      track_id,
      appointment_id,
      mode,
      status,
      director_profile_id,
      ready_at,
      ready_source
    ) values (
      p_track_id,
      null,
      'phone',
      'waiting',
      v_track.director_profile_id,
      pg_catalog.now(),
      'inquiry'
    )
    returning * into v_consultation;
  elsif v_consultation.director_profile_id
    is distinct from v_track.director_profile_id
  then
    update public.ops_registration_consultations consultation
    set director_profile_id = v_track.director_profile_id,
        updated_at = pg_catalog.now()
    where consultation.id = v_consultation.id
    returning consultation.* into v_consultation;
  end if;

  perform dashboard_private.record_registration_fact_audit_v1(
    v_track.task_id,
    p_track_id,
    'phone_consultation',
    pg_catalog.jsonb_build_object('consultationId', v_consultation.id)
  );
  v_response := pg_catalog.to_jsonb(v_consultation);
  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_track.task_id,
    'save_phone_consultation',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.save_registration_waiting_details_v2_impl(
  p_track_id uuid,
  p_waiting_kind text,
  p_class_id uuid,
  p_retake_decision text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_waiting_kind text := nullif(pg_catalog.btrim(p_waiting_kind), '');
  v_retake_decision text := nullif(pg_catalog.btrim(p_retake_decision), '');
  v_track record;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_track_id is null or v_request_key is null then
    raise exception 'registration_waiting_details_invalid' using errcode = '22023';
  end if;
  if not (
    v_waiting_kind is null
    and p_class_id is null
    and v_retake_decision is null
  ) and (
    v_waiting_kind is null
    or v_waiting_kind not in (
      'current_class',
      'current_term_opening',
      'next_term_opening'
    )
    or (v_waiting_kind = 'current_class') is distinct from (p_class_id is not null)
    or (
      v_retake_decision is not null
      and v_retake_decision not in ('required', 'not_required')
    )
  ) then
    raise exception 'registration_waiting_details_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'waitingKind', v_waiting_kind,
    'classId', p_class_id,
    'retakeDecision', v_retake_decision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );
  select track.id, track.task_id
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  where track.id = p_track_id
  for update of track;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    v_track.task_id,
    p_track_id,
    'change_waiting_kind'
  );

  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from v_track.task_id
      or v_saved_type is distinct from 'save_registration_waiting_details_v2'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'registration_mutation_request_conflict' using errcode = '22023';
    end if;
    return v_response;
  end if;

  update public.ops_registration_subject_tracks track
  set waiting_detail_kind = v_waiting_kind,
      waiting_detail_class_id = p_class_id,
      waiting_detail_retake_decision = v_retake_decision,
      updated_at = pg_catalog.now()
  where track.id = p_track_id;
  perform dashboard_private.record_registration_fact_audit_v1(
    v_track.task_id,
    p_track_id,
    'waiting_details',
    pg_catalog.jsonb_build_object(
      'waitingKind', v_waiting_kind,
      'classId', p_class_id,
      'retakeDecision', v_retake_decision
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'waitingKind', v_waiting_kind,
    'classId', p_class_id,
    'retakeDecision', v_retake_decision
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_track.task_id,
    'save_registration_waiting_details_v2',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.save_registration_consultation_details_impl(
  p_consultation_id uuid,
  p_status text,
  p_outcome text,
  p_note text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_outcome text := nullif(pg_catalog.btrim(p_outcome), '');
  v_consultation public.ops_registration_consultations%rowtype;
  v_track record;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_consultation_id is null
    or v_request_key is null
    or p_status not in ('waiting', 'scheduled', 'completed', 'canceled')
    or (
      v_outcome is not null
      and v_outcome not in ('enrollment', 'waiting', 'not_registered')
    )
    or (p_status = 'completed' and v_outcome is null)
  then
    raise exception 'registration_consultation_details_invalid' using errcode = '22023';
  end if;

  select consultation.*
  into v_consultation
  from public.ops_registration_consultations consultation
  where consultation.id = p_consultation_id
  for update;
  if not found then
    raise exception 'registration_consultation_not_found' using errcode = 'P0002';
  end if;
  select track.id, track.task_id
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_consultation.track_id
  for update;
  perform dashboard_private.assert_registration_mutation_access(
    v_track.task_id,
    v_track.id,
    'complete_consultation'
  );

  v_fingerprint := pg_catalog.jsonb_build_object(
    'consultationId', p_consultation_id,
    'status', p_status,
    'outcome', v_outcome,
    'note', v_note
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );
  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from v_track.task_id
      or v_saved_type is distinct from 'save_registration_consultation_details'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'registration_mutation_request_conflict' using errcode = '22023';
    end if;
    return v_response;
  end if;

  update public.ops_registration_consultations consultation
  set status = p_status,
      outcome = v_outcome,
      note = v_note,
      completed_at = case
        when p_status = 'completed'
          then coalesce(consultation.completed_at, pg_catalog.now())
        else consultation.completed_at
      end,
      updated_at = pg_catalog.now()
  where consultation.id = p_consultation_id
  returning * into v_consultation;
  perform dashboard_private.record_registration_fact_audit_v1(
    v_track.task_id,
    v_track.id,
    'consultation_details',
    pg_catalog.jsonb_build_object(
      'consultationId', p_consultation_id,
      'status', p_status,
      'outcome', v_outcome,
      'note', v_note
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'consultationId', v_consultation.id,
    'trackId', v_track.id,
    'status', v_consultation.status,
    'outcome', v_consultation.outcome,
    'note', v_consultation.note
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_track.task_id,
    'save_registration_consultation_details',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function public.save_registration_consultation_result_v2(
  p_consultation_id uuid,
  p_outcome text,
  p_note text,
  p_waiting_kind text,
  p_class_id uuid,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_outcome text := pg_catalog.lower(nullif(pg_catalog.btrim(p_outcome), ''));
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_consultation public.ops_registration_consultations%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_consultation_id is null
    or v_request_key is null
    or v_outcome not in (
      'undecided',
      'waiting',
      'observation',
      'enrollment',
      'not_registered'
    )
  then
    raise exception 'registration_consultation_result_invalid' using errcode = '22023';
  end if;

  select consultation.*
  into v_consultation
  from public.ops_registration_consultations consultation
  where consultation.id = p_consultation_id
  for update;
  if not found then
    raise exception 'registration_consultation_not_found' using errcode = 'P0002';
  end if;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_consultation.track_id
  for update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    v_track.task_id,
    v_track.id,
    'complete_consultation'
  );

  v_fingerprint := pg_catalog.jsonb_build_object(
    'consultationId', p_consultation_id,
    'outcome', v_outcome,
    'note', v_note
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );
  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from v_track.task_id
      or v_saved_type is distinct from 'save_consultation_result_v2'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_response;
  end if;

  update public.ops_registration_consultations consultation
  set status = 'completed',
      completed_at = coalesce(consultation.completed_at, pg_catalog.now()),
      outcome = v_outcome,
      note = v_note,
      updated_at = pg_catalog.now()
  where consultation.id = p_consultation_id
  returning * into v_consultation;
  perform dashboard_private.record_registration_fact_audit_v1(
    v_track.task_id,
    v_track.id,
    'consultation_result',
    pg_catalog.jsonb_build_object(
      'consultationId', p_consultation_id,
      'outcome', v_outcome,
      'note', v_note
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'consultation_id', v_consultation.id,
    'status', v_consultation.status,
    'outcome', v_consultation.outcome,
    'note', v_consultation.note,
    'track_id', v_track.id,
    'workflow_status', v_track.workflow_status,
    'workflow_revision', v_track.workflow_revision,
    'waiting_kind', v_track.waiting_detail_kind,
    'prepared_enrollment_id', null
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_track.task_id,
    'save_consultation_result_v2',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.assign_registration_track_director_impl(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_assignment_source text := nullif(pg_catalog.btrim(p_assignment_source), '');
  v_rule_key text := nullif(pg_catalog.btrim(p_rule_key), '');
  v_track public.ops_registration_subject_tracks%rowtype;
  v_task_id uuid;
  v_common_revision integer;
  v_next_source text;
  v_next_rule_key text;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_track_id is null or v_request_key is null then
    raise exception 'registration_director_assignment_invalid' using errcode = '22023';
  end if;
  if p_director_profile_id is null then
    v_next_source := null;
    v_next_rule_key := null;
  else
    if v_assignment_source = 'default' and v_rule_key is not null then
      v_next_source := 'default';
      v_next_rule_key := v_rule_key;
    elsif v_assignment_source in ('manual', 'default') and v_rule_key is null then
      v_next_source := 'manual';
      v_next_rule_key := null;
    else
      raise exception 'registration_director_assignment_invalid' using errcode = '22023';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  where track.id = p_track_id
  for update of track;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_task_id := v_track.task_id;
  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    p_track_id,
    'assign_director'
  );
  if p_director_profile_id is not null
    and not dashboard_private.is_active_subject_director(
      p_director_profile_id,
      v_track.subject
    )
  then
    raise exception 'registration_director_not_allowed' using errcode = '23514';
  end if;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'directorProfileId', p_director_profile_id,
    'assignmentSource', v_next_source,
    'ruleKey', v_next_rule_key,
    'expectedCommonRevision', p_expected_common_revision
  );
  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from v_task_id
      or v_saved_type is distinct from 'assign_director'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_response;
  end if;

  update public.ops_registration_subject_tracks track
  set director_profile_id = p_director_profile_id,
      director_assignment_source = v_next_source,
      director_assignment_rule_key = v_next_rule_key,
      director_assigned_at = case
        when p_director_profile_id is null then null
        when track.director_profile_id is distinct from p_director_profile_id
          or track.director_assignment_source is distinct from v_next_source
          or track.director_assignment_rule_key is distinct from v_next_rule_key
          then pg_catalog.now()
        else track.director_assigned_at
      end,
      updated_at = pg_catalog.now()
  where track.id = p_track_id
  returning * into v_track;
  select detail.common_revision
  into v_common_revision
  from public.ops_registration_details detail
  where detail.task_id = v_task_id;

  perform dashboard_private.record_registration_fact_audit_v1(
    v_task_id,
    p_track_id,
    'director_assignment',
    pg_catalog.jsonb_build_object(
      'directorProfileId', p_director_profile_id,
      'assignmentSource', v_next_source,
      'ruleKey', v_next_rule_key
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', v_common_revision,
    'trackId', v_track.id,
    'subject', v_track.subject,
    'status', v_track.pipeline_status,
    'directorProfileId', v_track.director_profile_id,
    'directorAssignmentSource', v_track.director_assignment_source,
    'directorAssignmentRuleKey', v_track.director_assignment_rule_key,
    'directorAssignedAt', v_track.director_assigned_at,
    'requiresDirectorAssignment', v_track.director_profile_id is null
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_task_id,
    'assign_director',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.assign_registration_track_director_impl(
    $1, $2, $3, $4, $5, $6
  );
$$;

-- Remove the old status gate, retryable business conflicts, observation
-- outcome preconditions, mapped notification event, and parent recomputation
-- from the canonical draft-row writer. Planned rows remain facts; admission
-- execution retains its separate batch/roster integrity RPCs.
do $patch_registration_enrollment_fact_writer$
declare
  v_definition text;
  v_updated text;
  v_retry_code text := '40' || '001';
  v_old text;
  v_new text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)'::pg_catalog.regprocedure
  );
  v_updated := pg_catalog.replace(
    v_definition,
    'using errcode = ' || pg_catalog.quote_literal(v_retry_code),
    'using errcode = ' || pg_catalog.quote_literal('23514')
  );

  v_old := $old$  if v_track.pipeline_status not in ('enrollment_decided', 'registered')
    and coalesce(
      pg_catalog.current_setting(
        'dashboard.registration_status_independent_enrollment',
        true
      ),
      ''
    ) <> 'on'
  then
    raise exception 'registration_invalid_source_state' using errcode = '23514';
  end if;

$old$;
  v_updated := pg_catalog.replace(v_updated, v_old, '');

  v_old := $old$  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_canonical_rows) source_row(value)
    where source_row.value ->> 'classStartSourceObservationId' is not null
  ) then
    perform dashboard_private.assert_registration_observation_runtime_v1();
  end if;

$old$;
  v_updated := pg_catalog.replace(v_updated, v_old, '');

  v_old := $old$  perform dashboard_private.write_registration_track_event_v2(
    v_task_id,
    p_track_id,
    'enrollment_rows_saved',
    v_track.pipeline_status,
    v_track.pipeline_status,
    null,
    pg_catalog.jsonb_build_object(
      'rowIds', pg_catalog.to_jsonb(v_written_ids),
      'rowCount', pg_catalog.cardinality(v_written_ids),
      'rows', v_rows_response
    ),
    'user',
    null
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);
$old$;
  v_new := $new$  perform dashboard_private.record_registration_fact_audit_v1(
    v_task_id,
    p_track_id,
    'enrollment_rows',
    pg_catalog.jsonb_build_object(
      'rowIds', pg_catalog.to_jsonb(v_written_ids),
      'rowCount', pg_catalog.cardinality(v_written_ids),
      'rows', v_rows_response
    )
  );
$new$;
  v_updated := pg_catalog.replace(v_updated, v_old, v_new);

  if v_updated = v_definition
    or pg_catalog.strpos(v_updated, v_retry_code) > 0
    or pg_catalog.strpos(v_updated, 'pipeline_status not in') > 0
    or pg_catalog.strpos(v_updated, 'assert_registration_observation_runtime_v1') > 0
    or pg_catalog.strpos(v_updated, 'write_registration_track_event_v2') > 0
    or pg_catalog.strpos(v_updated, 'recompute_registration_parent') > 0
  then
    raise exception 'registration_enrollment_fact_writer_patch_failed'
      using errcode = '55000';
  end if;
  execute v_updated;
end;
$patch_registration_enrollment_fact_writer$;

do $patch_registration_enrollment_observation_reference$
declare
  v_definition text;
  v_updated text;
  v_old text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)'::pg_catalog.regprocedure
  );
  v_old := $old$    and observation.class_id = p_class_id
    and observation.status in ('attended_feedback_pending', 'completed')
    and observation.attendance = 'attended'
    and observation.decision_kind = 'enrollment'$old$;
  v_updated := pg_catalog.replace(
    v_definition,
    v_old,
    '    and observation.class_id = p_class_id'
  );
  if v_updated = v_definition
    or pg_catalog.strpos(v_updated, 'and observation.status ') > 0
    or pg_catalog.strpos(v_updated, 'and observation.attendance ') > 0
    or pg_catalog.strpos(v_updated, 'observation.decision_kind = ') > 0
  then
    raise exception 'registration_enrollment_observation_reference_patch_failed'
      using errcode = '55000';
  end if;
  execute v_updated;
end;
$patch_registration_enrollment_observation_reference$;

create or replace function dashboard_private.save_registration_enrollment_details_impl(
  p_track_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_track record;
  v_rows jsonb;
  v_externalized boolean;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_track_id is null
    or v_request_key is null
    or p_rows is null
    or pg_catalog.jsonb_typeof(p_rows) <> 'array'
  then
    raise exception 'registration_enrollment_details_invalid' using errcode = '22023';
  end if;

  select track.id, track.task_id
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  where track.id = p_track_id
  for update of track;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    v_track.task_id,
    p_track_id,
    'save_enrollment_rows'
  );
  v_rows := dashboard_private.normalize_registration_enrollment_rows_request_v1(p_rows);
  v_fingerprint := pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'rows', v_rows
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );
  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from v_track.task_id
      or v_saved_type is distinct from 'save_registration_enrollment_details'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'registration_mutation_request_conflict' using errcode = '22023';
    end if;
    return v_response;
  end if;

  select exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and (
        enrollment.admission_batch_id is not null
        or enrollment.roster_active
      )
  )
  into v_externalized;
  if v_externalized then
    v_response := pg_catalog.jsonb_build_object(
      'trackId', p_track_id,
      'rows', v_rows,
      'externalReconciliationRequired', true
    );
  else
    v_response := dashboard_private.save_registration_enrollment_rows_canonical_v1(
      p_track_id,
      v_rows,
      v_actor_id
    ) || pg_catalog.jsonb_build_object(
      'externalReconciliationRequired', false
    );
  end if;

  update public.ops_registration_subject_tracks track
  set enrollment_detail_rows = v_rows,
      updated_at = pg_catalog.now()
  where track.id = p_track_id;
  if v_externalized then
    perform dashboard_private.record_registration_fact_audit_v1(
      v_track.task_id,
      p_track_id,
      'enrollment_details_external_correction',
      pg_catalog.jsonb_build_object('rows', v_rows)
    );
  end if;
  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_track.task_id,
    'save_registration_enrollment_details',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.save_registration_enrollment_details_impl_base(
  p_track_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.save_registration_enrollment_details_impl($1, $2, $3);
$$;

-- A level-test result is a fact correction. Closing the containing appointment
-- is the minimum parent/child reference repair required by the deferred
-- appointment integrity constraint; it must not cancel or materialize any
-- notification work.
create or replace function dashboard_private.reconcile_registration_appointment_parent_v1(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
  v_active_child_count integer := 0;
  v_non_canceled_child_count integer := 0;
  v_next_status text;
  v_notification_revision integer;
begin
  if p_appointment_id is null then
    return pg_catalog.jsonb_build_object('found', false);
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('found', false);
  end if;

  if v_appointment.kind not in ('level_test', 'visit_consultation') then
    return pg_catalog.jsonb_build_object(
      'found', true,
      'status', v_appointment.status,
      'notification_revision', v_appointment.notification_revision,
      'changed', false
    );
  end if;

  if v_appointment.kind = 'level_test' then
    select
      pg_catalog.count(*) filter (where attempt.status in ('scheduled', 'in_progress')),
      pg_catalog.count(*) filter (where attempt.status <> 'canceled')
    into v_active_child_count, v_non_canceled_child_count
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = v_appointment.id;
  else
    select
      pg_catalog.count(*) filter (where consultation.status = 'scheduled'),
      pg_catalog.count(*) filter (where consultation.status <> 'canceled')
    into v_active_child_count, v_non_canceled_child_count
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = v_appointment.id
      and consultation.mode = 'visit';
  end if;

  if v_active_child_count > 0 then
    return pg_catalog.jsonb_build_object(
      'found', true,
      'status', v_appointment.status,
      'notification_revision', v_appointment.notification_revision,
      'changed', false
    );
  end if;

  v_next_status := case
    when v_non_canceled_child_count = 0 then 'canceled'
    else 'completed'
  end;

  if v_appointment.status = v_next_status then
    return pg_catalog.jsonb_build_object(
      'found', true,
      'status', v_appointment.status,
      'notification_revision', v_appointment.notification_revision,
      'changed', false
    );
  end if;

  update public.ops_registration_appointments appointment
  set status = v_next_status,
      notification_revision = appointment.notification_revision + 1,
      updated_at = pg_catalog.now()
  where appointment.id = v_appointment.id
  returning appointment.notification_revision into v_notification_revision;

  return pg_catalog.jsonb_build_object(
    'found', true,
    'status', v_next_status,
    'notification_revision', v_notification_revision,
    'changed', true
  );
end;
$$;

create or replace function dashboard_private.save_registration_level_test_result_impl(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_link text := nullif(pg_catalog.btrim(p_material_link), '');
  v_task_id uuid;
  v_track_id uuid;
  v_appointment_id uuid;
  v_attempt public.ops_registration_level_tests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_target_fingerprint jsonb;
  v_response jsonb;
  v_receipt_found boolean := false;
  v_receipt_matches boolean := false;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_attempt_id is null
    or v_request_key is null
    or p_status is null
    or p_status not in ('completed', 'absent', 'canceled')
    or (p_status = 'completed' and v_link is null)
  then
    raise exception 'registration_level_test_result_invalid' using errcode = '22023';
  end if;

  select track.task_id, attempt.track_id, attempt.appointment_id
  into v_task_id, v_track_id, v_appointment_id
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where attempt.id = p_attempt_id;
  if v_task_id is null then
    raise exception 'registration_level_test_not_found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_level_test_not_found' using errcode = 'P0002';
  end if;

  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  perform 1
  from public.ops_registration_appointments appointment
  where appointment.task_id = v_task_id
    and appointment.kind = 'level_test'
  order by appointment.id
  for update;

  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = v_task_id
  order by attempt.id
  for update of attempt;

  select attempt.*
  into v_attempt
  from public.ops_registration_level_tests attempt
  where attempt.id = p_attempt_id
    and attempt.track_id = v_track_id
    and attempt.appointment_id is not distinct from v_appointment_id;
  if not found then
    raise exception 'registration_level_test_not_found' using errcode = 'P0002';
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_level_test_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_track.task_id,
    v_track.id,
    'complete_level_test'
  );

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'attemptId', v_attempt.id,
    'status', p_status,
    'materialLink', case when p_status = 'completed' then v_link else null end
  );

  select
    mutation.response_payload,
    mutation.task_id = v_track.task_id
      and mutation.mutation_type = 'save_registration_level_test_result'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;

  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then
    return v_response;
  end if;

  update public.ops_registration_level_tests attempt
  set status = p_status,
      material_link = case when p_status = 'completed' then v_link else null end,
      completed_at = coalesce(attempt.completed_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  where attempt.id = p_attempt_id
  returning attempt.* into v_attempt;

  perform dashboard_private.record_registration_fact_audit_v1(
    v_track.task_id,
    v_track.id,
    'level_test_result',
    pg_catalog.jsonb_build_object(
      'attemptId', p_attempt_id,
      'status', p_status
    )
  );

  perform dashboard_private.reconcile_registration_appointment_parent_v1(
    v_attempt.appointment_id
  );

  v_response := pg_catalog.jsonb_build_object(
    'attemptId', v_attempt.id,
    'trackId', v_track.id,
    'status', v_attempt.status,
    'materialLink', v_attempt.material_link
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_track.task_id,
    'save_registration_level_test_result',
    v_target_fingerprint,
    v_response
  );

  return v_response;
end;
$$;

-- The visit event is now created by the explicit send command, never by a
-- reservation trigger. Keep its deterministic source conflict non-retryable.
do $patch_registration_visit_event_sqlstate$
declare
  v_definition text;
  v_updated text;
  v_retry_code text := '40' || '001';
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text)'::pg_catalog.regprocedure
  );
  v_updated := pg_catalog.replace(
    v_definition,
    'using errcode = ' || pg_catalog.quote_literal(v_retry_code),
    'using errcode = ' || pg_catalog.quote_literal('23514')
  );
  if v_updated = v_definition
    or pg_catalog.strpos(v_updated, v_retry_code) > 0
  then
    raise exception 'registration_visit_event_sqlstate_patch_failed'
      using errcode = '55000';
  end if;
  execute v_updated;
end;
$patch_registration_visit_event_sqlstate$;

alter function dashboard_private.write_registration_track_event_v2(
  uuid, uuid, text, text, text, text, jsonb, text, text
) rename to write_registration_track_event_v2_base;

create or replace function dashboard_private.write_registration_track_event_v2(
  p_task_id uuid,
  p_track_id uuid,
  p_event_type text,
  p_source text,
  p_destination text,
  p_reason_code text,
  p_metadata jsonb,
  p_actor_kind text,
  p_system_source text
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.write_registration_track_event_v2_base(
    p_task_id,
    p_track_id,
    p_event_type,
    p_source,
    p_destination,
    p_reason_code,
    p_metadata,
    p_actor_kind,
    p_system_source
  );
$$;

create or replace function dashboard_private.registration_visit_notification_fact_snapshot_v1(
  p_appointment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'appointmentId', appointment.id,
    'taskId', appointment.task_id,
    'notificationRevision', appointment.notification_revision,
    'recipientRevision', appointment.recipient_revision::text,
    'status', appointment.status,
    'scheduledAt', appointment.scheduled_at,
    'place', appointment.place,
    'studentName', task.student_name,
    'trackIds', coalesce((
      select pg_catalog.to_jsonb(pg_catalog.array_agg(
        participant.track_id
        order by dashboard_private.registration_subject_sort_order(track.subject),
          participant.track_id
      ))
      from (
        select distinct consultation.track_id
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = appointment.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
      ) participant
      join public.ops_registration_subject_tracks track
        on track.id = participant.track_id
       and track.task_id = appointment.task_id
       and track.archived_at is null
    ), '[]'::jsonb),
    'directorProfileIds', coalesce((
      select pg_catalog.to_jsonb(pg_catalog.array_agg(
        director.director_profile_id order by director.director_profile_id
      ))
      from (
        select distinct track.director_profile_id
        from public.ops_registration_consultations consultation
        join public.ops_registration_subject_tracks track
          on track.id = consultation.track_id
         and track.task_id = appointment.task_id
         and track.archived_at is null
        where consultation.appointment_id = appointment.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
          and track.director_profile_id is not null
      ) director
    ), '[]'::jsonb)
  )
  from public.ops_registration_appointments appointment
  join public.ops_tasks task
    on task.id = appointment.task_id
   and task.type = 'registration'
  where appointment.id = p_appointment_id
    and appointment.kind = 'visit_consultation';
$$;

create or replace function dashboard_private.registration_visit_notification_source_current_v1(
  p_appointment_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_event dashboard_private.notification_events%rowtype;
begin
  v_snapshot := dashboard_private.registration_visit_notification_fact_snapshot_v1(
    p_appointment_id
  );
  if v_snapshot is null
    or v_snapshot ->> 'status' <> 'scheduled'
    or pg_catalog.jsonb_array_length(v_snapshot -> 'trackIds') = 0
  then
    return false;
  end if;

  select event_row.*
  into v_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'registration'
    and event_row.source_type = 'registration_appointment'
    and event_row.source_id = p_appointment_id::text
    and event_row.source_revision =
      (v_snapshot ->> 'notificationRevision')::bigint
    and event_row.occurrence_key =
      'registration:registration_appointment:'
      || p_appointment_id::text
      || ':source_revision:'
      || (v_snapshot ->> 'notificationRevision')
      || ':immediate'
    and event_row.event_key in (
      'registration.visit_scheduled',
      'registration.visit_rescheduled',
      'registration.visit_replaced',
      'registration.visit_subject_deselected'
    )
  order by event_row.created_at desc, event_row.id desc
  limit 1;
  if not found then
    return false;
  end if;

  return v_event.payload ->> 'appointment_id' = p_appointment_id::text
    and v_event.payload ->> 'notification_revision'
      = v_snapshot ->> 'notificationRevision'
    and v_event.payload ->> 'recipient_revision'
      = v_snapshot ->> 'recipientRevision'
    and v_event.payload ->> 'appointment_status' = 'scheduled'
    and v_event.payload ->> 'scheduled_at'
      is not distinct from v_snapshot ->> 'scheduledAt'
    and v_event.payload ->> 'place'
      is not distinct from v_snapshot ->> 'place'
    and v_event.payload ->> 'student_name'
      is not distinct from v_snapshot ->> 'studentName'
    and v_event.payload -> 'track_ids'
      is not distinct from v_snapshot -> 'trackIds'
    and v_event.payload -> 'director_profile_ids'
      is not distinct from v_snapshot -> 'directorProfileIds'
    and not exists (
      select 1
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track
        on track.id = consultation.track_id
       and track.task_id = (v_snapshot ->> 'taskId')::uuid
       and track.archived_at is null
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled'
        and consultation.director_profile_id
          is distinct from track.director_profile_id
    );
end;
$$;

create or replace function public.ensure_registration_visit_notification_v1(
  p_appointment_id uuid,
  p_expected_notification_revision integer,
  p_request_key text,
  p_intent text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_request_id uuid;
  v_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_task public.ops_tasks%rowtype;
  v_snapshot jsonb;
  v_track_ids uuid[] := array[]::uuid[];
  v_director_ids uuid[] := array[]::uuid[];
  v_missing_fields text[] := array[]::text[];
  v_source_event_id uuid;
  v_event_type text;
  v_had_prior_source boolean;
  v_has_current_revision_source boolean;
  v_source_current boolean;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_appointment_id is null
    or p_expected_notification_revision is null
    or p_expected_notification_revision < 1
    or v_request_key is null
    or dashboard_private.try_registration_event_uuid(v_request_key) is null
    or p_intent is distinct from 'send_registration_visit_notification'
  then
    raise exception 'registration_visit_notification_intent_invalid'
      using errcode = '22023';
  end if;
  v_request_id := dashboard_private.try_registration_event_uuid(v_request_key);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-visit-notification-v1:' || p_appointment_id::text,
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-request:' || v_request_id::text,
    0
  ));

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id
    and appointment.kind = 'visit_consultation'
  for update;
  if not found then
    raise exception 'registration_appointment_not_found' using errcode = 'P0002';
  end if;

  -- Resolve a successful replay before checking the pre-command revision.
  -- This command may advance the source revision once when the same revision
  -- already owns a stale notification snapshot.
  select ledger.*
  into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = v_request_id;
  if found then
    if v_ledger.request_kind <> 'registration_visit_notification_v1'
      or v_ledger.response_payload ->> 'appointmentId'
        is distinct from p_appointment_id::text
      or v_ledger.response_payload ->> 'actorProfileId'
        is distinct from v_actor_id::text
      or v_ledger.response_payload ->> 'requestedRevision'
        is distinct from p_expected_notification_revision::text
      or v_ledger.response_payload ->> 'intent'
        is distinct from p_intent
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    if not dashboard_private.registration_visit_notification_source_current_v1(
      p_appointment_id
    ) then
      raise exception 'registration_visit_notification_refresh_required'
        using errcode = '23514';
    end if;
    return v_ledger.response_payload;
  end if;
  if v_appointment.notification_revision
    is distinct from p_expected_notification_revision
  then
    raise exception 'registration_visit_notification_refresh_required'
      using errcode = '23514';
  end if;
  if v_appointment.status <> 'scheduled' then
    raise exception 'registration_visit_notification_not_ready'
      using errcode = '23514', detail = '예약 상태';
  end if;

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_appointment.task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task.id
  order by track.id
  for update;
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.appointment_id = p_appointment_id
  order by consultation.id
  for update;

  if nullif(pg_catalog.btrim(coalesce(v_task.student_name, '')), '') is null then
    v_missing_fields := pg_catalog.array_append(v_missing_fields, '학생 이름');
  end if;
  if v_appointment.scheduled_at is null then
    v_missing_fields := pg_catalog.array_append(v_missing_fields, '예약 시각');
  end if;
  if nullif(pg_catalog.btrim(coalesce(v_appointment.place, '')), '') is null then
    v_missing_fields := pg_catalog.array_append(v_missing_fields, '예약 장소');
  end if;

  select
    coalesce(
      pg_catalog.array_agg(
        consultation.track_id
        order by dashboard_private.registration_subject_sort_order(track.subject),
          consultation.track_id
      ),
      array[]::uuid[]
    ),
    coalesce(
      pg_catalog.array_agg(distinct track.director_profile_id order by track.director_profile_id)
        filter (where track.director_profile_id is not null),
      array[]::uuid[]
    )
  into v_track_ids, v_director_ids
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track
    on track.id = consultation.track_id
   and track.task_id = v_task.id
   and track.archived_at is null
  where consultation.appointment_id = p_appointment_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled';
  if pg_catalog.cardinality(v_track_ids) = 0 then
    v_missing_fields := pg_catalog.array_append(v_missing_fields, '과목');
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(v_track_ids) participant(track_id)
    join public.ops_registration_subject_tracks track
      on track.id = participant.track_id
    where nullif(pg_catalog.btrim(coalesce(track.subject, '')), '') is null
      or track.director_profile_id is null
      or not dashboard_private.is_active_subject_director(
        track.director_profile_id,
        track.subject
      )
  ) then
    v_missing_fields := pg_catalog.array_append(v_missing_fields, '담당 원장');
  end if;
  if pg_catalog.cardinality(v_missing_fields) > 0 then
    raise exception 'registration_visit_notification_not_ready'
      using errcode = '23514',
        detail = pg_catalog.array_to_string(v_missing_fields, ', ');
  end if;

  -- Recipient snapshots are synchronized only inside this explicit command.
  if exists (
    select 1
    from public.ops_registration_consultations consultation
    join public.ops_registration_subject_tracks track
      on track.id = consultation.track_id
     and track.task_id = v_task.id
     and track.archived_at is null
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled'
      and consultation.director_profile_id
        is distinct from track.director_profile_id
  ) then
    update public.ops_registration_consultations consultation
    set director_profile_id = track.director_profile_id,
        updated_at = pg_catalog.now()
    from public.ops_registration_subject_tracks track
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled'
      and track.id = consultation.track_id
      and track.task_id = v_task.id
      and track.archived_at is null
      and consultation.director_profile_id
        is distinct from track.director_profile_id;
    update public.ops_registration_appointments appointment
    set recipient_revision = appointment.recipient_revision + 1,
        updated_at = pg_catalog.now()
    where appointment.id = p_appointment_id
    returning * into v_appointment;
  end if;

  v_source_current :=
    dashboard_private.registration_visit_notification_source_current_v1(
      p_appointment_id
    );
  select
    pg_catalog.bool_or(true),
    coalesce(pg_catalog.bool_or(
      event_row.source_revision = v_appointment.notification_revision
    ), false)
  into v_had_prior_source, v_has_current_revision_source
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'registration'
    and event_row.source_type = 'registration_appointment'
    and event_row.source_id = p_appointment_id::text
    and event_row.event_key like 'registration.visit_%';
  v_had_prior_source := coalesce(v_had_prior_source, false);

  -- Fact edits already advance notification_revision. Advance only when this
  -- exact revision already owns a stale source, such as a recipient correction.
  if v_has_current_revision_source and not v_source_current then
    update public.ops_registration_appointments appointment
    set notification_revision = appointment.notification_revision + 1,
        updated_at = pg_catalog.now()
    where appointment.id = p_appointment_id
    returning * into v_appointment;
  end if;

  v_snapshot := dashboard_private.registration_visit_notification_fact_snapshot_v1(
    p_appointment_id
  );
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actorProfileId', v_actor_id,
    'appointmentId', p_appointment_id,
    'requestedRevision', p_expected_notification_revision,
    'sourceRevision', v_appointment.notification_revision,
    'intent', p_intent,
    'snapshot', v_snapshot
  )::text);

  if not dashboard_private.registration_visit_notification_source_current_v1(
    p_appointment_id
  ) then
    v_event_type := case
      when v_had_prior_source then 'appointment_updated'
      else 'visit_scheduled'
    end;
    perform dashboard_private.write_registration_track_event_v2(
      v_task.id,
      v_track_ids[1],
      v_event_type,
      'scheduled',
      'scheduled',
      'manual_visit_notification',
      pg_catalog.jsonb_build_object(
        'appointmentId', p_appointment_id,
        'kind', 'visit_consultation',
        'notificationRevision', v_appointment.notification_revision,
        'activeTrackIds', pg_catalog.to_jsonb(v_track_ids),
        'intent', p_intent
      ),
      'user',
      null
    );
  end if;

  if not dashboard_private.registration_visit_notification_source_current_v1(
    p_appointment_id
  ) then
    raise exception 'registration_visit_notification_source_stale'
      using errcode = '23514';
  end if;
  select event_row.id
  into strict v_source_event_id
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'registration'
    and event_row.source_type = 'registration_appointment'
    and event_row.source_id = p_appointment_id::text
    and event_row.source_revision = v_appointment.notification_revision
    and event_row.occurrence_key =
      'registration:registration_appointment:'
      || p_appointment_id::text
      || ':source_revision:'
      || v_appointment.notification_revision::text
      || ':immediate'
    and event_row.event_key in (
      'registration.visit_scheduled',
      'registration.visit_rescheduled',
      'registration.visit_replaced',
      'registration.visit_subject_deselected'
    )
  order by event_row.created_at desc, event_row.id desc
  limit 1;
  v_response := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'actorProfileId', v_actor_id,
    'requestedRevision', p_expected_notification_revision,
    'notificationRevision', v_appointment.notification_revision,
    'recipientRevision', v_appointment.recipient_revision::text,
    'requestKey', v_request_id::text,
    'intent', p_intent,
    'sourceEventId', v_source_event_id,
    'ready', true,
    'alreadyRequested', v_source_current
  );
  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    v_request_id,
    'registration_visit_notification_v1',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

-- Preserve the legacy provider adapter, but fence every plan read against the
-- explicit source snapshot produced above.
alter function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  rename to get_registration_visit_legacy_dispatch_plan_v1_base;

revoke all on function public.get_registration_visit_legacy_dispatch_plan_v1_base(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_registration_visit_legacy_dispatch_plan_v1(
  p_appointment_id uuid,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null
    or p_actor_profile_id is distinct from v_actor_id
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(
    v_actor_id
  );
  if not dashboard_private.registration_visit_notification_source_current_v1(
    p_appointment_id
  ) then
    raise exception 'registration_visit_notification_refresh_required'
      using errcode = '23514';
  end if;
  return public.get_registration_visit_legacy_dispatch_plan_v1_base(
    p_appointment_id,
    v_actor_id
  );
end;
$$;

-- Customer reminders are explicit preview/send actions only. Retire every
-- automatic producer/claim entrypoint while preserving terminal audit rows and
-- the manual customer-message APIs.
drop trigger if exists sync_registration_customer_reminder_cron_active
  on dashboard_private.registration_customer_reminder_settings;

do $retire_registration_customer_reminder_cron$
declare
  v_job record;
begin
  if pg_catalog.to_regclass('cron.job') is not null then
    for v_job in
      select job.jobid
      from cron.job job
      where job.jobname = 'tips-registration-customer-reminder-v1'
      order by job.jobid
    loop
      perform cron.unschedule('tips-registration-customer-reminder-v1');
    end loop;
  end if;
end;
$retire_registration_customer_reminder_cron$;

create or replace function dashboard_private.registration_customer_reminder_schedule_ready_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

create or replace function dashboard_private.invoke_registration_customer_reminder_worker_v1()
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  select null::bigint;
$$;

create or replace function dashboard_private.materialize_registration_observation_solapi_events_v1(
  p_limit integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_observation_solapi_worker_unauthorized'
      using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'registration_observation_solapi_limit_invalid'
      using errcode = '22023';
  end if;
  return 0;
end;
$$;

create or replace function dashboard_private.sync_registration_customer_reminder_jobs_v1()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized'
      using errcode = '42501';
  end if;
  return 0;
end;
$$;

create or replace function public.claim_registration_customer_reminder_job_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized'
      using errcode = '42501';
  end if;
  return null;
end;
$$;

create or replace function public.has_registration_customer_reminder_backlog_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized'
      using errcode = '42501';
  end if;
  return false;
end;
$$;

create or replace function public.continue_registration_customer_reminder_worker_v1()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized'
      using errcode = '42501';
  end if;
  return null;
end;
$$;

create or replace function public.manage_registration_customer_reminder_schedule_v1(
  p_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
begin
  if (select auth.role()) <> 'service_role'
    or p_action is null
    or p_action not in ('inspect', 'install', 'disable', 'remove')
  then
    raise exception 'registration_customer_reminder_schedule_action_invalid'
      using errcode = '22023';
  end if;
  if p_action = 'install' then
    raise exception 'registration_customer_reminder_schedule_retired'
      using errcode = '55000';
  end if;
  if p_action in ('disable', 'remove')
    and pg_catalog.to_regclass('cron.job') is not null
  then
    for v_job in
      select job.jobid
      from cron.job job
      where job.jobname = 'tips-registration-customer-reminder-v1'
      order by job.jobid
    loop
      perform cron.unschedule('tips-registration-customer-reminder-v1');
    end loop;
  end if;
  return dashboard_private.inspect_registration_customer_reminder_schedule_v1();
end;
$$;

create or replace function public.set_registration_customer_reminder_settings_v1(
  p_actor_profile_id uuid,
  p_enabled boolean,
  p_lead_hours smallint,
  p_expected_revision bigint,
  p_template_contract jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  perform dashboard_private.registration_customer_solapi_assert_admin_v1(
    p_actor_profile_id
  );
  if p_enabled is distinct from false
    or p_lead_hours not between 1 and 72
    or p_expected_revision is null
  then
    raise exception 'registration_customer_reminder_automatic_delivery_retired'
      using errcode = '55000';
  end if;
  select settings.*
  into strict v_settings
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton
  for update;
  if v_settings.revision <> p_expected_revision then
    raise exception 'registration_customer_reminder_settings_conflict'
      using errcode = '23514';
  end if;
  update dashboard_private.registration_customer_reminder_settings settings
  set enabled = false,
      lead_hours = p_lead_hours,
      revision = settings.revision + 1,
      updated_by = p_actor_profile_id,
      updated_at = pg_catalog.clock_timestamp()
  where settings.singleton;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'canceled',
      claim_token = null,
      claim_expires_at = null,
      last_error_code = 'explicit_send_required',
      updated_at = pg_catalog.clock_timestamp()
  where job.status in ('pending', 'claimed');
  return public.get_registration_customer_reminder_settings_v1(
    p_actor_profile_id
  );
end;
$$;

do $retire_lightweight_registration_alert_cron$
declare
  v_job record;
begin
  if pg_catalog.to_regclass('cron.job') is not null then
    for v_job in
      select job.jobid
      from cron.job job
      where job.jobname = 'tips-lightweight-registration-reminder-v1'
      order by job.jobid
    loop
      perform cron.unschedule('tips-lightweight-registration-reminder-v1');
    end loop;
  end if;
end;
$retire_lightweight_registration_alert_cron$;

create or replace function dashboard_private.enqueue_lightweight_registration_alerts_v1(
  p_source_kind text,
  p_source_id uuid,
  p_source_revision bigint,
  p_event_kind text,
  p_event_key text
)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select 0;
$$;

create or replace function public.enqueue_lightweight_registration_booking_alerts_v1(
  p_source_kind text,
  p_source_id uuid,
  p_source_revision bigint
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'lightweight_registration_alert_access_denied'
      using errcode = '42501';
  end if;
  return 0;
end;
$$;

create or replace function public.enqueue_due_lightweight_registration_reminders_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'lightweight_registration_alert_access_denied'
      using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'explicit_only',
    'candidateCount', 0,
    'deliveryCount', 0
  );
end;
$$;

create or replace function public.manage_lightweight_registration_alert_schedule_v1(
  p_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
begin
  if (select auth.role()) <> 'service_role'
    or p_action is null
    or p_action not in ('install_inactive', 'activate', 'disable', 'remove')
  then
    raise exception 'lightweight_registration_alert_schedule_action_invalid'
      using errcode = '22023';
  end if;
  if p_action in ('install_inactive', 'activate') then
    raise exception 'lightweight_registration_alert_schedule_retired'
      using errcode = '55000';
  end if;
  if pg_catalog.to_regclass('cron.job') is not null then
    for v_job in
      select job.jobid
      from cron.job job
      where job.jobname = 'tips-lightweight-registration-reminder-v1'
      order by job.jobid
    loop
      perform cron.unschedule('tips-lightweight-registration-reminder-v1');
    end loop;
  end if;
  return pg_catalog.jsonb_build_object(
    'action', p_action,
    'jobId', null,
    'schedule', '0 1 * * *',
    'active', false
  );
end;
$$;

create or replace function public.claim_registration_observation_chat_jobs_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
)
returns setof jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_worker_id), '') is null
    or pg_catalog.octet_length(p_worker_id) > 128
    or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_batch_size is null
    or p_batch_size not between 1 and 100
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 300
  then
    raise exception 'registration_observation_chat_claim_invalid'
      using errcode = '22023';
  end if;
  return;
end;
$$;

create or replace function public.materialize_registration_observation_chat_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_payload_schema_version integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'registration_observation_chat_worker_forbidden'
      using errcode = '42501';
  end if;
  raise exception 'registration_observation_chat_automatic_materialization_retired'
    using errcode = '55000';
end;
$$;

insert into dashboard_private.registration_customer_reminder_settings(
  singleton,
  enabled,
  lead_hours,
  revision
) values (true, false, 3, 1)
on conflict (singleton) do nothing;

update dashboard_private.registration_customer_reminder_settings settings
set enabled = false,
    revision = settings.revision + 1,
    updated_at = pg_catalog.clock_timestamp()
where settings.singleton
  and settings.enabled;

update dashboard_private.registration_customer_reminder_jobs job
set status = 'canceled',
    claim_token = null,
    claim_expires_at = null,
    last_error_code = 'explicit_send_required',
    updated_at = pg_catalog.clock_timestamp()
where job.status in ('pending', 'claimed')
;

insert into dashboard_private.lightweight_registration_alert_runtime_settings(
  singleton,
  enabled
) values (true, false)
on conflict (singleton) do nothing;

update dashboard_private.lightweight_registration_alert_runtime_settings settings
set enabled = false,
    updated_at = pg_catalog.statement_timestamp()
where settings.singleton
  and settings.enabled;

update dashboard_private.lightweight_registration_alert_states state
set result = 'failed_hold',
    last_processed_at = pg_catalog.statement_timestamp(),
    updated_at = pg_catalog.statement_timestamp()
where state.result = 'pending'
  and exists (
    select 1
    from dashboard_private.lightweight_registration_alert_deliveries delivery
    where delivery.state_id = state.id
      and delivery.status in ('pending', 'claimed')
  );

update dashboard_private.lightweight_registration_alert_deliveries delivery
set status = 'failed_hold',
    claim_token = null,
    claim_expires_at = null,
    terminalized_at = pg_catalog.statement_timestamp(),
    updated_at = pg_catalog.statement_timestamp()
where delivery.status in ('pending', 'claimed');

update dashboard_private.registration_observation_chat_jobs job
set status = 'canceled',
    next_attempt_at = null,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    last_error_code = 'explicit_action_required',
    completed_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
where job.status in ('pending', 'claimed');

alter function dashboard_private.record_registration_fact_audit_v1(uuid, uuid, text, jsonb)
  owner to postgres;
alter function dashboard_private.save_registration_appointment_details_impl(
  uuid, uuid, text, timestamptz, text, uuid[], integer, text
) owner to postgres;
alter function dashboard_private.cancel_registration_appointment_impl(uuid, integer, text, text)
  owner to postgres;
alter function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(
  uuid, integer, text, text
) owner to postgres;
alter function dashboard_private.save_registration_phone_consultation_v1_impl(uuid, text)
  owner to postgres;
alter function dashboard_private.save_registration_waiting_details_v2_impl(
  uuid, text, uuid, text, text
) owner to postgres;
alter function dashboard_private.save_registration_consultation_details_impl(
  uuid, text, text, text, text
) owner to postgres;
alter function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) owner to postgres;
alter function dashboard_private.assign_registration_track_director_impl(
  uuid, uuid, text, text, integer, text
) owner to postgres;
alter function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  uuid, uuid, text, text, integer, text
) owner to postgres;
alter function dashboard_private.save_registration_enrollment_rows_canonical_v1(
  uuid, jsonb, uuid
) owner to postgres;
alter function dashboard_private.validate_registration_observation_class_start_source_v1(
  uuid, uuid, uuid, date, text, uuid
) owner to postgres;
alter function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text)
  owner to postgres;
alter function dashboard_private.save_registration_enrollment_details_impl_base(uuid, jsonb, text)
  owner to postgres;
alter function dashboard_private.reconcile_registration_appointment_parent_v1(uuid)
  owner to postgres;
alter function dashboard_private.save_registration_level_test_result_impl(uuid, text, text, text)
  owner to postgres;
alter function dashboard_private.write_registration_track_event_v2_base(
  uuid, uuid, text, text, text, text, jsonb, text, text
) owner to postgres;
alter function dashboard_private.write_registration_track_event_v2(
  uuid, uuid, text, text, text, text, jsonb, text, text
) owner to postgres;
alter function dashboard_private.registration_visit_notification_fact_snapshot_v1(uuid)
  owner to postgres;
alter function dashboard_private.registration_visit_notification_source_current_v1(uuid)
  owner to postgres;
alter function public.ensure_registration_visit_notification_v1(uuid, integer, text, text)
  owner to postgres;
alter function public.get_registration_visit_legacy_dispatch_plan_v1_base(uuid, uuid)
  owner to postgres;
alter function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
alter function dashboard_private.materialize_registration_observation_solapi_events_v1(integer)
  owner to postgres;
alter function dashboard_private.sync_registration_customer_reminder_jobs_v1()
  owner to postgres;
alter function public.claim_registration_customer_reminder_job_v1()
  owner to postgres;
alter function public.has_registration_customer_reminder_backlog_v1()
  owner to postgres;
alter function dashboard_private.registration_customer_reminder_schedule_ready_v1()
  owner to postgres;
alter function dashboard_private.invoke_registration_customer_reminder_worker_v1()
  owner to postgres;
alter function public.continue_registration_customer_reminder_worker_v1()
  owner to postgres;
alter function public.manage_registration_customer_reminder_schedule_v1(text)
  owner to postgres;
alter function public.set_registration_customer_reminder_settings_v1(
  uuid, boolean, smallint, bigint, jsonb
) owner to postgres;
alter function dashboard_private.enqueue_lightweight_registration_alerts_v1(
  text, uuid, bigint, text, text
) owner to postgres;
alter function public.enqueue_lightweight_registration_booking_alerts_v1(
  text, uuid, bigint
) owner to postgres;
alter function public.enqueue_due_lightweight_registration_reminders_v1()
  owner to postgres;
alter function public.manage_lightweight_registration_alert_schedule_v1(text)
  owner to postgres;
alter function public.claim_registration_observation_chat_jobs_v1(
  text, integer, integer
) owner to postgres;
alter function public.materialize_registration_observation_chat_job_v1(
  uuid, uuid, integer, jsonb
) owner to postgres;

revoke all on function dashboard_private.record_registration_fact_audit_v1(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function dashboard_private.save_registration_appointment_details_impl(
  uuid, uuid, text, timestamptz, text, uuid[], integer, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_appointment_details_impl(
  uuid, uuid, text, timestamptz, text, uuid[], integer, text
) to authenticated;

revoke all on function dashboard_private.cancel_registration_appointment_impl(
  uuid, integer, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(
  uuid, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(
  uuid, integer, text, text
) to authenticated;

revoke all on function dashboard_private.save_registration_phone_consultation_v1_impl(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_phone_consultation_v1_impl(uuid, text)
  to authenticated;

revoke all on function dashboard_private.save_registration_waiting_details_v2_impl(
  uuid, text, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_waiting_details_v2_impl(
  uuid, text, uuid, text, text
) to authenticated;

revoke all on function dashboard_private.save_registration_consultation_details_impl(
  uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_consultation_details_impl(
  uuid, text, text, text, text
) to authenticated;

revoke all on function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) to authenticated;

revoke all on function dashboard_private.assign_registration_track_director_impl(
  uuid, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  uuid, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  uuid, uuid, text, text, integer, text
) to authenticated;

revoke all on function dashboard_private.save_registration_enrollment_rows_canonical_v1(
  uuid, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.validate_registration_observation_class_start_source_v1(
  uuid, uuid, uuid, date, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text)
  to authenticated;
revoke all on function dashboard_private.save_registration_enrollment_details_impl_base(
  uuid, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.reconcile_registration_appointment_parent_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_registration_level_test_result_impl(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_level_test_result_impl(
  uuid, text, text, text
) to authenticated;

revoke all on function dashboard_private.write_registration_track_event_v2_base(
  uuid, uuid, text, text, text, text, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_registration_track_event_v2(
  uuid, uuid, text, text, text, text, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_visit_notification_fact_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_visit_notification_source_current_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_registration_visit_notification_v1(
  uuid, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.ensure_registration_visit_notification_v1(
  uuid, integer, text, text
) to authenticated;
revoke all on function public.get_registration_visit_legacy_dispatch_plan_v1_base(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  to authenticated;

revoke all on function dashboard_private.materialize_registration_observation_solapi_events_v1(integer)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.sync_registration_customer_reminder_jobs_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_registration_customer_reminder_job_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_customer_reminder_job_v1()
  to service_role;
revoke all on function public.has_registration_customer_reminder_backlog_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.has_registration_customer_reminder_backlog_v1()
  to service_role;
revoke all on function dashboard_private.registration_customer_reminder_schedule_ready_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.invoke_registration_customer_reminder_worker_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.continue_registration_customer_reminder_worker_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.continue_registration_customer_reminder_worker_v1()
  to service_role;
revoke all on function public.manage_registration_customer_reminder_schedule_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_registration_customer_reminder_schedule_v1(text)
  to service_role;
revoke all on function public.set_registration_customer_reminder_settings_v1(
  uuid, boolean, smallint, bigint, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.set_registration_customer_reminder_settings_v1(
  uuid, boolean, smallint, bigint, jsonb
) to service_role;
revoke all on function dashboard_private.enqueue_lightweight_registration_alerts_v1(
  text, uuid, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_lightweight_registration_booking_alerts_v1(
  text, uuid, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_lightweight_registration_booking_alerts_v1(
  text, uuid, bigint
) to service_role;
revoke all on function public.enqueue_due_lightweight_registration_reminders_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_due_lightweight_registration_reminders_v1()
  to service_role;
revoke all on function public.manage_lightweight_registration_alert_schedule_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_lightweight_registration_alert_schedule_v1(text)
  to service_role;
revoke all on function public.claim_registration_observation_chat_jobs_v1(
  text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_observation_chat_jobs_v1(
  text, integer, integer
) to service_role;
revoke all on function public.materialize_registration_observation_chat_job_v1(
  uuid, uuid, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.materialize_registration_observation_chat_job_v1(
  uuid, uuid, integer, jsonb
) to service_role;

commit;
