begin;

alter table public.ops_registration_consultations
  add column ready_at timestamptz,
  add column ready_source text;

alter table public.ops_registration_consultations
  add constraint ops_registration_consultations_ready_source_check
  check (ready_source is null or ready_source in (
    'inquiry', 'level_test_completion', 'visit_reopened',
    'director_resolved', 'track_reopened', 'migration', 'legacy'
  )) not valid;

alter table public.ops_registration_consultations
  add constraint ops_registration_consultations_mode_readiness_check
  check (
    (mode = 'phone' and ready_at is not null and ready_source is not null)
    or (mode = 'visit' and ready_at is null and ready_source is null)
  ) not valid;

-- registration_phone_readiness_backfill
with registration_track_events as (
  select
    event.id,
    event.task_id,
    event.created_at,
    event.after_value::jsonb as payload
  from public.ops_task_events event
  where event.event_type = 'registration_track_event'
    and event.after_value is not null
    and pg_catalog.left(pg_catalog.ltrim(event.after_value), 1) = '{'
    and event.after_value::jsonb ->> 'version' = '1'
), legacy_phone_times as (
  select distinct on (event.task_id)
    event.task_id,
    nullif(event.after_value::jsonb #>> '{timestamps,phoneConsultationAt}', '')::timestamptz
      as phone_consultation_at
  from public.ops_task_events event
  where event.event_type = 'legacy_registration_imported'
    and event.after_value is not null
    and pg_catalog.left(pg_catalog.ltrim(event.after_value), 1) = '{'
    and event.after_value::jsonb ->> 'version' = '1'
  order by event.task_id, event.created_at, event.id
), readiness_candidates as (
  select
    consultation.id as consultation_id,
    case
      when track_event.payload ->> 'eventType' = 'level_test_completed'
        and attempt.completed_at is not null
        then attempt.completed_at
      when track_event.payload ->> 'eventType' = 'inquiry_routed'
        then detail.inquiry_at
      when track_event.payload ->> 'eventType' in (
        'appointment_canceled', 'appointment_subject_deselected', 'track_reopened'
      )
        then coalesce(
          nullif(track_event.payload ->> 'occurredAt', '')::timestamptz,
          track_event.created_at
        )
      when track_event.payload ->> 'eventType' = 'migration_review_resolved'
        then coalesce(
          legacy.phone_consultation_at,
          nullif(track_event.payload ->> 'occurredAt', '')::timestamptz,
          track_event.created_at
        )
      when track_event.payload ->> 'eventType' in (
        'director_default_resolved',
        'director_manual_override',
        'director_phone_queue_repaired'
      )
        then track.stage_entered_at
    end as ready_at,
    case
      when track_event.payload ->> 'eventType' = 'level_test_completed'
        and attempt.completed_at is not null
        then 'level_test_completion'
      when track_event.payload ->> 'eventType' = 'inquiry_routed'
        then 'inquiry'
      when track_event.payload ->> 'eventType' in (
        'appointment_canceled', 'appointment_subject_deselected'
      )
        then 'visit_reopened'
      when track_event.payload ->> 'eventType' = 'track_reopened'
        then 'track_reopened'
      when track_event.payload ->> 'eventType' = 'migration_review_resolved'
        then 'migration'
      when track_event.payload ->> 'eventType' in (
        'director_default_resolved',
        'director_manual_override',
        'director_phone_queue_repaired'
      )
        then 'director_resolved'
    end as ready_source,
    case
      when track_event.payload ->> 'eventType' = 'level_test_completed'
        and attempt.completed_at is not null
        then 10
      when track_event.payload ->> 'eventType' in (
        'inquiry_routed',
        'appointment_canceled',
        'appointment_subject_deselected',
        'track_reopened',
        'migration_review_resolved'
      )
        then 20
      else 30
    end as source_precedence,
    track_event.created_at as event_created_at,
    track_event.id as event_id
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track
    on track.id = consultation.track_id
  join public.ops_registration_details detail
    on detail.task_id = track.task_id
  join registration_track_events track_event
    on track_event.task_id = track.task_id
    and track_event.payload ->> 'trackId' = track.id::text
    and coalesce(
      track_event.payload #>> '{metadata,consultationId}',
      track_event.payload #>> '{metadata,phoneConsultationId}'
    ) = consultation.id::text
  left join public.ops_registration_level_tests attempt
    on attempt.id::text = track_event.payload #>> '{metadata,attemptId}'
    and attempt.track_id = track.id
  left join legacy_phone_times legacy on legacy.task_id = track.task_id
  where consultation.mode = 'phone'
    and track_event.payload ->> 'eventType' in (
      'level_test_completed',
      'inquiry_routed',
      'appointment_canceled',
      'appointment_subject_deselected',
      'track_reopened',
      'migration_review_resolved',
      'director_default_resolved',
      'director_manual_override',
      'director_phone_queue_repaired'
    )
), ranked_readiness as (
  select distinct on (candidate.consultation_id)
    candidate.consultation_id,
    candidate.ready_at,
    candidate.ready_source
  from readiness_candidates candidate
  where candidate.ready_at is not null
    and candidate.ready_source is not null
  order by
    candidate.consultation_id,
    candidate.source_precedence,
    candidate.event_created_at,
    candidate.event_id
)
update public.ops_registration_consultations consultation
set
  ready_at = readiness.ready_at,
  ready_source = readiness.ready_source
from ranked_readiness readiness
where consultation.id = readiness.consultation_id
  and consultation.mode = 'phone';

update public.ops_registration_consultations consultation
set
  ready_at = consultation.created_at,
  ready_source = 'legacy'
where consultation.mode = 'phone'
  and (consultation.ready_at is null or consultation.ready_source is null);

alter table public.ops_registration_consultations
  validate constraint ops_registration_consultations_ready_source_check;
alter table public.ops_registration_consultations
  validate constraint ops_registration_consultations_mode_readiness_check;

create index ops_registration_consultations_phone_waiting_ready_idx
  on public.ops_registration_consultations(ready_at, track_id)
  where mode = 'phone' and status = 'waiting';

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
  active_phone.ready_source as phone_ready_source
from public.ops_registration_subject_tracks track
left join lateral (
  select
    appointment.scheduled_at,
    appointment.place
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
  select
    consultation.ready_at,
    consultation.ready_source
  from public.ops_registration_consultations consultation
  where consultation.track_id = track.id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.created_at desc, consultation.id desc
  limit 1
) active_phone on true;

revoke all on table public.ops_registration_subject_track_summaries
  from public, anon, authenticated;
grant select on table public.ops_registration_subject_track_summaries
  to authenticated;

create or replace function dashboard_private.route_registration_inquiry_impl(
  p_track_id uuid,
  p_destination text,
  p_waiting_kind text,
  p_class_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_destination text := nullif(pg_catalog.btrim(p_destination), '');
  v_waiting_kind text := nullif(pg_catalog.btrim(p_waiting_kind), '');
  v_task_id uuid;
  v_source_status text;
  v_inquiry_at timestamptz;
  v_consultation_id uuid;
  v_enrollment_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_destination is null
    or v_destination not in ('consultation_waiting', 'waiting', 'inquiry_closed')
  then
    raise exception 'registration_inquiry_destination_invalid' using errcode = '22023';
  end if;
  if v_destination = 'waiting' then
    if v_waiting_kind is null
      or v_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening')
    then
      raise exception 'waiting_kind_required' using errcode = '22023';
    end if;
    if v_waiting_kind = 'current_class' and p_class_id is null then
      raise exception 'waiting_class_required' using errcode = '22023';
    end if;
    if v_waiting_kind <> 'current_class' and p_class_id is not null then
      raise exception 'waiting_class_not_allowed' using errcode = '22023';
    end if;
  elsif v_waiting_kind is not null then
    raise exception 'waiting_kind_not_allowed' using errcode = '22023';
  elsif p_class_id is not null then
    raise exception 'waiting_class_not_allowed' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', null,
    'trackId', p_track_id,
    'destination', v_destination,
    'waitingKind', v_waiting_kind,
    'classId', p_class_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_set(
    v_target_fingerprint, '{taskId}', pg_catalog.to_jsonb(v_task_id), true
  );

  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.inquiry_at
  into v_inquiry_at
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  select track.pipeline_status
  into v_source_status
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'route_inquiry'
  );

  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'route_inquiry'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;
  if v_source_status <> 'inquiry' then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  if v_destination = 'consultation_waiting' then
    perform dashboard_private.assert_registration_track_director_ready(p_track_id);
    insert into public.ops_registration_consultations(
      track_id, appointment_id, mode, status, director_profile_id,
      ready_at, ready_source
    )
    select
      p_track_id, null, 'phone', 'waiting', track.director_profile_id,
      v_inquiry_at, 'inquiry'
    from public.ops_registration_subject_tracks track
    where track.id = p_track_id
    returning id into v_consultation_id;
  elsif v_destination = 'waiting' and v_waiting_kind = 'current_class' then
    perform dashboard_private.apply_registration_current_class_wait(
      v_task_id, p_track_id, p_class_id, v_actor_id
    );
    select enrollment.id
    into v_enrollment_id
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
    for update;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
  end if;

  perform dashboard_private.transition_registration_track_status(
    p_track_id,
    v_destination,
    case when v_destination = 'waiting' then v_waiting_kind else null end,
    null,
    false
  );
  perform dashboard_private.write_registration_track_event(
    v_task_id,
    p_track_id,
    'inquiry_routed',
    v_source_status,
    v_destination,
    null,
    pg_catalog.jsonb_build_object(
      'waitingKind', v_waiting_kind,
      'classId', p_class_id,
      'consultationId', v_consultation_id,
      'enrollmentId', v_enrollment_id
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', track.id,
    'subject', track.subject,
    'status', track.pipeline_status,
    'waitingKind', track.waiting_kind,
    'consultationId', v_consultation_id,
    'enrollmentId', v_enrollment_id,
    'directorProfileId', track.director_profile_id,
    'stageEnteredAt', track.stage_entered_at
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'route_inquiry', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.route_registration_inquiry_impl(uuid, text, text, uuid, text)
  owner to postgres;
revoke execute on function dashboard_private.route_registration_inquiry_impl(uuid, text, text, uuid, text) from public, anon;
grant execute on function dashboard_private.route_registration_inquiry_impl(uuid, text, text, uuid, text) to authenticated;

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
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_assignment_source text := nullif(pg_catalog.btrim(p_assignment_source), '');
  v_rule_key text := nullif(pg_catalog.btrim(p_rule_key), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_resolution jsonb;
  v_visit_appointment_id uuid;
  v_phone_consultation_id uuid;
  v_phone_director_id uuid;
  v_track_id uuid;
  v_notification_id uuid;
  v_notification_dedupe_key text;
  v_event_type text;
  v_next_source text;
  v_next_rule_key text;
  v_next_assigned_at timestamptz;
  v_assignment_changed boolean;
  v_phone_created boolean := false;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_assignment_source is null
    or v_assignment_source not in ('default', 'manual', 'clear_default')
  then
    raise exception 'registration_director_assignment_source_invalid' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', null,
    'trackId', p_track_id,
    'directorProfileId', p_director_profile_id,
    'assignmentSource', v_assignment_source,
    'ruleKey', v_rule_key,
    'expectedCommonRevision', p_expected_common_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_set(
    v_target_fingerprint, '{taskId}', pg_catalog.to_jsonb(v_task_id), true
  );

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select consultation.appointment_id
  into v_visit_appointment_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
  order by consultation.id
  limit 1;
  if v_visit_appointment_id is not null then
    perform 1
    from public.ops_registration_appointments appointment
    where appointment.id = v_visit_appointment_id
    for update;
  end if;
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.status in ('waiting', 'scheduled')
  order by consultation.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'assign_director'
  );
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'assign_director'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;
  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;
  if v_track.pipeline_status in ('registered', 'not_registered', 'inquiry_closed') then
    raise exception 'registration_director_assignment_terminal' using errcode = '40001';
  end if;
  if v_visit_appointment_id is not null then
    raise exception 'registration_visit_reassign_requires_reschedule' using errcode = '40001';
  end if;

  v_resolution := dashboard_private.resolve_registration_default_director(
    v_track.subject, v_detail.school_grade, v_detail.inquiry_at
  );
  if v_assignment_source = 'default' then
    if p_director_profile_id is null or v_rule_key is null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
      or v_resolution ->> 'status' <> 'resolved'
      or nullif(v_resolution ->> 'profileId', '')::uuid is distinct from p_director_profile_id
      or v_resolution ->> 'ruleKey' is distinct from v_rule_key
    then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    if not dashboard_private.is_active_registration_director(p_director_profile_id) then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
    v_next_source := 'default';
    v_next_rule_key := v_rule_key;
    v_event_type := 'director_default_resolved';
  elsif v_assignment_source = 'manual' then
    if p_director_profile_id is null or v_rule_key is not null then
      raise exception 'registration_director_manual_invalid' using errcode = '22023';
    end if;
    if not dashboard_private.is_active_registration_director(p_director_profile_id) then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
    v_next_source := 'manual';
    v_next_rule_key := null;
    v_event_type := 'director_manual_override';
  else
    if p_director_profile_id is not null or v_rule_key is not null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
    then
      raise exception 'registration_director_clear_denied' using errcode = '40001';
    end if;
    if v_resolution ->> 'status' = 'resolved' then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    v_next_source := null;
    v_next_rule_key := null;
    v_event_type := 'director_default_cleared';
  end if;

  v_assignment_changed :=
    v_track.director_profile_id is distinct from p_director_profile_id
    or v_track.director_assignment_source is distinct from v_next_source
    or v_track.director_assignment_rule_key is distinct from v_next_rule_key;
  v_next_assigned_at := case
    when p_director_profile_id is null then null
    when v_assignment_changed then pg_catalog.now()
    else v_track.director_assigned_at
  end;
  if v_assignment_changed then
    update public.ops_registration_subject_tracks
    set
      director_profile_id = p_director_profile_id,
      director_assignment_source = v_next_source,
      director_assignment_rule_key = v_next_rule_key,
      director_assigned_at = v_next_assigned_at,
      updated_at = pg_catalog.now()
    where id = p_track_id;
  end if;

  select consultation.id, consultation.director_profile_id
  into v_phone_consultation_id, v_phone_director_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.id
  limit 1
  for update;

  if p_director_profile_id is not null then
    if v_phone_consultation_id is not null then
      delete from public.dashboard_notifications notification
      where notification.type = 'registration_consultation'
        and notification.read_at is null
        and notification.recipient_profile_id is distinct from p_director_profile_id
        and notification.dedupe_key =
          'registration:' || v_task_id::text || ':track:' || p_track_id::text
          || ':consultation:' || v_phone_consultation_id::text
          || ':director:' || v_phone_director_id::text;
      if v_phone_director_id is distinct from p_director_profile_id then
        update public.ops_registration_consultations
        set director_profile_id = p_director_profile_id,
            updated_at = pg_catalog.now()
        where id = v_phone_consultation_id;
      end if;
    elsif v_track.pipeline_status = 'consultation_waiting' then
      insert into public.ops_registration_consultations(
        track_id, appointment_id, mode, status, director_profile_id,
        ready_at, ready_source
      ) values (
        p_track_id, null, 'phone', 'waiting', p_director_profile_id,
        v_track.stage_entered_at, 'director_resolved'
      ) returning id into v_phone_consultation_id;
      v_phone_created := true;
    end if;

    if v_phone_consultation_id is not null then
      v_notification_dedupe_key :=
        'registration:' || v_task_id::text || ':track:' || p_track_id::text
        || ':consultation:' || v_phone_consultation_id::text
        || ':director:' || p_director_profile_id::text;
      insert into public.dashboard_notifications as existing(
        recipient_profile_id, recipient_team, actor_profile_id, type,
        title, body, href, metadata, dedupe_key
      ) values (
        p_director_profile_id,
        null,
        v_actor_id,
        'registration_consultation',
        '[' || v_track.subject || '] 전화상담 대기',
        v_task.student_name || ' 학생 상담을 확인하세요.',
        '/admin/registration?taskId=' || v_task_id::text || '&trackId=' || p_track_id::text,
        pg_catalog.jsonb_build_object(
          'taskId', v_task_id,
          'trackId', p_track_id,
          'consultationId', v_phone_consultation_id,
          'subject', v_track.subject,
          'directorProfileId', p_director_profile_id
        ),
        v_notification_dedupe_key
      )
      on conflict (dedupe_key) do update
      set
        recipient_profile_id = excluded.recipient_profile_id,
        recipient_team = excluded.recipient_team,
        actor_profile_id = excluded.actor_profile_id,
        type = excluded.type,
        title = excluded.title,
        body = excluded.body,
        href = excluded.href,
        metadata = excluded.metadata,
        read_at = null,
        created_at = pg_catalog.now()
      where v_track.director_profile_id is distinct from p_director_profile_id
      returning existing.id into v_notification_id;
      if v_notification_id is null then
        select notification.id
        into v_notification_id
        from public.dashboard_notifications notification
        where notification.dedupe_key = v_notification_dedupe_key;
      end if;
    end if;
  elsif v_phone_consultation_id is not null then
    delete from public.dashboard_notifications notification
    where notification.type = 'registration_consultation'
      and notification.read_at is null
      and notification.dedupe_key =
        'registration:' || v_task_id::text || ':track:' || p_track_id::text
        || ':consultation:' || v_phone_consultation_id::text
        || ':director:' || v_phone_director_id::text;
  end if;

  if v_assignment_changed then
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      p_track_id,
      v_event_type,
      coalesce(v_track.director_assignment_source, 'unassigned'),
      coalesce(v_next_source, 'unassigned'),
      null,
      pg_catalog.jsonb_build_object(
        'previousDirectorProfileId', v_track.director_profile_id,
        'directorProfileId', p_director_profile_id,
        'ruleKey', v_next_rule_key,
        'consultationId', v_phone_consultation_id,
        'notificationDedupeKey', v_notification_dedupe_key
      )
    );
  elsif v_phone_created then
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      p_track_id,
      'director_phone_queue_repaired',
      v_track.pipeline_status,
      v_track.pipeline_status,
      null,
      pg_catalog.jsonb_build_object(
        'directorProfileId', p_director_profile_id,
        'consultationId', v_phone_consultation_id,
        'notificationDedupeKey', v_notification_dedupe_key
      )
    );
  end if;

  perform dashboard_private.recompute_registration_parent(v_task_id);
  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', v_detail.common_revision,
    'trackId', track.id,
    'subject', track.subject,
    'status', track.pipeline_status,
    'directorProfileId', track.director_profile_id,
    'directorAssignmentSource', track.director_assignment_source,
    'directorAssignmentRuleKey', track.director_assignment_rule_key,
    'directorAssignedAt', track.director_assigned_at,
    'consultationId', v_phone_consultation_id,
    'notificationId', v_notification_id,
    'notificationDedupeKey', v_notification_dedupe_key,
    'requiresDirectorAssignment', track.director_profile_id is null
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'assign_director', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.assign_registration_track_director_impl(uuid, uuid, text, text, integer, text)
  owner to postgres;
revoke execute on function dashboard_private.assign_registration_track_director_impl(uuid, uuid, text, text, integer, text) from public, anon;
grant execute on function dashboard_private.assign_registration_track_director_impl(uuid, uuid, text, text, integer, text) to authenticated;

create or replace function dashboard_private.save_registration_shared_appointment_impl(
  p_appointment_id uuid,
  p_task_id uuid,
  p_kind text,
  p_scheduled_at timestamptz,
  p_place text,
  p_track_ids uuid[],
  p_replace_remaining boolean,
  p_expected_notification_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_place text := nullif(pg_catalog.btrim(p_place), '');
  v_track_ids uuid[];
  v_track_count integer;
  v_task_exists boolean := false;
  v_task_student_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_appointment public.ops_registration_appointments%rowtype;
  v_appointment_id uuid;
  v_new_appointment_id uuid;
  v_activity_id uuid;
  v_activity_ids uuid[] := array[]::uuid[];
  v_existing_track_ids uuid[] := array[]::uuid[];
  v_scheduled_track_ids uuid[] := array[]::uuid[];
  v_added_track_ids uuid[] := array[]::uuid[];
  v_deselected_track_ids uuid[] := array[]::uuid[];
  v_active_track_ids uuid[] := array[]::uuid[];
  v_canceled_track_ids uuid[] := array[]::uuid[];
  v_requires_director_assignment_track_ids uuid[] := array[]::uuid[];
  v_attempt_number integer;
  v_latest_attempt_status text;
  v_active_activity_count integer;
  v_child_count integer := 0;
  v_terminal_child_count integer := 0;
  v_real_diff boolean := false;
  v_director_ready boolean;
  v_old_notification_revision integer;
  v_new_notification_revision integer := 1;
  v_old_appointment_status text;
  v_notification_targets jsonb := '[]'::jsonb;
  v_phone_consultation_id uuid;
  v_phone_director_id uuid;
  v_phone_consultation_count integer;
  v_wait_enrollment_id uuid;
  v_wait_student_id uuid;
  v_wait_class_id uuid;
  v_event_type text;
  v_track record;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('level_test', 'visit_consultation') then
    raise exception 'registration_appointment_kind_invalid' using errcode = '22023';
  end if;
  if p_scheduled_at is null then
    raise exception 'registration_appointment_scheduled_at_required' using errcode = '22023';
  end if;
  if v_place is null then
    raise exception 'registration_appointment_place_required' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct track_id order by track_id),
    array[]::uuid[]
  )
  into v_track_ids
  from pg_catalog.unnest(coalesce(p_track_ids, array[]::uuid[])) selected(track_id)
  where track_id is not null;
  if pg_catalog.cardinality(v_track_ids) not between 1 and 2 then
    raise exception 'registration_appointment_tracks_required' using errcode = '22023';
  end if;
  if p_appointment_id is null
    and p_expected_notification_revision is not null
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;
  if p_appointment_id is null and coalesce(p_replace_remaining, false) then
    raise exception 'registration_appointment_replacement_requires_existing' using errcode = '22023';
  end if;
  if p_appointment_id is not null
    and p_expected_notification_revision is null
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'taskId', p_task_id,
    'kind', p_kind,
    'scheduledAt', p_scheduled_at,
    'place', v_place,
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'replaceRemaining', coalesce(p_replace_remaining, false),
    'expectedNotificationRevision', p_expected_notification_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select task.student_id
  into v_task_student_id
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  v_task_exists := found;
  if not v_task_exists then
    raise exception 'registration_appointment_task_mismatch' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- appointment_parent_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;
  select pg_catalog.count(*)
  into v_track_count
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids)
    and track.task_id = p_task_id;
  if v_track_count <> pg_catalog.cardinality(v_track_ids) then
    raise exception 'registration_appointment_task_mismatch' using errcode = '22023';
  end if;

  -- appointment_row_lock
  if p_appointment_id is not null then
    select appointment.*
    into v_appointment
    from public.ops_registration_appointments appointment
    where appointment.id = p_appointment_id
      and appointment.task_id = p_task_id
    order by appointment.id
    for update;
    if not found or v_appointment.task_id is distinct from p_task_id then
      raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
    end if;
    if v_appointment.kind is distinct from p_kind then
      raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
    end if;
  end if;

  -- appointment_activity_locks
  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = p_task_id
  order by attempt.id
  for update of attempt;

  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = p_task_id
  order by consultation.id
  for update of consultation;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'save_appointment'
  );

  -- appointment_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'save_appointment'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- appointment_stale_revision_check
  if p_appointment_id is not null
    and v_appointment.notification_revision is distinct from p_expected_notification_revision
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;

  if p_appointment_id is not null then
    if exists (
      select 1
      from public.ops_registration_level_tests attempt
      join public.ops_registration_subject_tracks track on track.id = attempt.track_id
      where attempt.appointment_id = p_appointment_id
        and track.task_id is distinct from p_task_id
    ) or exists (
      select 1
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track on track.id = consultation.track_id
      where consultation.appointment_id = p_appointment_id
        and track.task_id is distinct from p_task_id
    ) then
      raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
    end if;

    if p_kind = 'level_test' then
      if exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = p_appointment_id
      ) then
        raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
      end if;

      select
        pg_catalog.count(*),
        coalesce(
          pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id)
            filter (where attempt.status = 'scheduled'),
          array[]::uuid[]
        ),
        pg_catalog.count(*) filter (
          where attempt.status in ('in_progress', 'completed', 'absent', 'canceled')
        )
      into
        v_child_count,
        v_existing_track_ids,
        v_scheduled_track_ids,
        v_terminal_child_count
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

      select
        pg_catalog.count(*),
        coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id)
            filter (where consultation.status = 'scheduled'),
          array[]::uuid[]
        ),
        pg_catalog.count(*) filter (
          where consultation.status in ('completed', 'canceled')
        )
      into
        v_child_count,
        v_existing_track_ids,
        v_scheduled_track_ids,
        v_terminal_child_count
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit';
    end if;

    if v_child_count = 0 then
      raise exception 'registration_appointment_tracks_required' using errcode = '23514';
    end if;
    if v_appointment.status <> 'scheduled' then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    select coalesce(
      pg_catalog.array_agg(candidate.track_id order by candidate.track_id),
      array[]::uuid[]
    )
    into v_added_track_ids
    from (
      select selected.track_id
      from pg_catalog.unnest(v_track_ids) selected(track_id)
      except
      select existing.track_id
      from pg_catalog.unnest(v_existing_track_ids) existing(track_id)
    ) candidate;

    select coalesce(
      pg_catalog.array_agg(candidate.track_id order by candidate.track_id),
      array[]::uuid[]
    )
    into v_deselected_track_ids
    from (
      select existing.track_id
      from pg_catalog.unnest(v_scheduled_track_ids) existing(track_id)
      except
      select selected.track_id
      from pg_catalog.unnest(v_track_ids) selected(track_id)
    ) candidate;

    if coalesce(p_replace_remaining, false) then
      -- replacement_appointment_edit
      if v_terminal_child_count = 0
        or pg_catalog.cardinality(v_scheduled_track_ids) = 0
      then
        raise exception 'registration_appointment_immutable' using errcode = '40001';
      end if;
      if v_track_ids is distinct from v_scheduled_track_ids then
        raise exception 'registration_appointment_replacement_track_set_mismatch' using errcode = '22023';
      end if;

      for v_track in
        select track.*
        from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
        join public.ops_registration_subject_tracks track on track.id = selected.track_id
        where track.task_id = p_task_id
        order by track.id
      loop
        if p_kind = 'level_test' then
          if v_track.pipeline_status <> 'level_test_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        else
          if v_track.pipeline_status <> 'visit_consultation_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
          perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        end if;
      end loop;

      update public.ops_registration_appointments appointment
      set
        notification_revision = notification_revision + 1,
        updated_at = pg_catalog.now()
      where appointment.id = p_appointment_id
      returning appointment.notification_revision into v_old_notification_revision;

      if p_kind = 'level_test' then
        update public.ops_registration_level_tests attempt
        set
          status = 'canceled',
          completed_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
        where attempt.appointment_id = p_appointment_id
          and attempt.status = 'scheduled';
      else
        update public.ops_registration_consultations consultation
        set
          status = 'canceled',
          updated_at = pg_catalog.now()
        where consultation.appointment_id = p_appointment_id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled';
      end if;
      if not found then
        raise exception 'registration_appointment_immutable' using errcode = '40001';
      end if;
      v_canceled_track_ids := v_scheduled_track_ids;

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
      ) returning id into v_new_appointment_id;

      v_activity_ids := array[]::uuid[];
      for v_track in
        select track.*
        from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
        join public.ops_registration_subject_tracks track on track.id = selected.track_id
        where track.task_id = p_task_id
        order by track.id
      loop
        if p_kind = 'level_test' then
          select coalesce(max(attempt.attempt_number), 0) + 1
          into v_attempt_number
          from public.ops_registration_level_tests attempt
          where attempt.track_id = v_track.id;

          insert into public.ops_registration_level_tests(
            track_id, appointment_id, attempt_number, status
          ) values (
            v_track.id, v_new_appointment_id, v_attempt_number, 'scheduled'
          ) returning id into v_activity_id;

          perform dashboard_private.transition_registration_track_status(
            v_track.id, 'level_test_scheduled', null, null, false
          );
        else
          insert into public.ops_registration_consultations(
            track_id, appointment_id, mode, status, director_profile_id,
            ready_at, ready_source
          ) values (
            v_track.id,
            v_new_appointment_id,
            'visit',
            'scheduled',
            v_track.director_profile_id,
            null,
            null
          ) returning id into v_activity_id;

          perform dashboard_private.transition_registration_track_status(
            v_track.id, 'visit_consultation_scheduled', null, null, false
          );
        end if;

        v_activity_ids := pg_catalog.array_append(v_activity_ids, v_activity_id);
        perform dashboard_private.write_registration_track_event(
          p_task_id,
          v_track.id,
          'appointment_replaced',
          v_track.pipeline_status,
          v_track.pipeline_status,
          null,
          pg_catalog.jsonb_build_object(
            'oldAppointmentId', p_appointment_id,
            'newAppointmentId', v_new_appointment_id,
            'oldNotificationRevision', v_old_notification_revision,
            'notificationRevision', v_new_notification_revision,
            'kind', p_kind,
            'oldScheduledAt', v_appointment.scheduled_at,
            'oldPlace', v_appointment.place,
            'scheduledAt', p_scheduled_at,
            'place', v_place,
            'activeTrackIds', pg_catalog.to_jsonb(v_scheduled_track_ids),
            'canceledTrackIds', pg_catalog.to_jsonb(v_canceled_track_ids),
            'activityId', v_activity_id,
            'attemptNumber', case when p_kind = 'level_test' then v_attempt_number else null end,
            'changeKind', 'appointment_replaced'
          )
        );
      end loop;

      if p_kind = 'level_test' then
        if exists (
          select 1
          from public.ops_registration_level_tests attempt
          where attempt.appointment_id = p_appointment_id
            and attempt.status in ('scheduled', 'in_progress')
        ) then
          v_old_appointment_status := 'scheduled';
        elsif not exists (
          select 1
          from public.ops_registration_level_tests attempt
          where attempt.appointment_id = p_appointment_id
            and attempt.status in ('completed', 'absent', 'canceled')
            and attempt.status <> 'canceled'
        ) then
          v_old_appointment_status := 'canceled';
        else
          v_old_appointment_status := 'completed';
        end if;
      else
        if exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.appointment_id = p_appointment_id
            and consultation.mode = 'visit'
            and consultation.status = 'scheduled'
        ) then
          v_old_appointment_status := 'scheduled';
        elsif not exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.appointment_id = p_appointment_id
            and consultation.mode = 'visit'
            and consultation.status <> 'canceled'
        ) then
          v_old_appointment_status := 'canceled';
        else
          v_old_appointment_status := 'completed';
        end if;
      end if;

      update public.ops_registration_appointments appointment
      set status = v_old_appointment_status, updated_at = pg_catalog.now()
      where appointment.id = p_appointment_id;

      perform dashboard_private.recompute_registration_parent(p_task_id);

      v_notification_targets := case
        when p_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'appointmentId', p_appointment_id,
            'notificationRevision', v_old_notification_revision
          ),
          pg_catalog.jsonb_build_object(
            'appointmentId', v_new_appointment_id,
            'notificationRevision', v_new_notification_revision
          )
        )
        else '[]'::jsonb
      end;
      v_response := pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'appointmentId', v_new_appointment_id,
        'notificationRevision', v_new_notification_revision,
        'oldAppointmentId', p_appointment_id,
        'newAppointmentId', v_new_appointment_id,
        'trackIds', pg_catalog.to_jsonb(v_scheduled_track_ids),
        'activityIds', pg_catalog.to_jsonb(v_activity_ids),
        'requiresDirectorAssignmentTrackIds', '[]'::jsonb,
        'notificationTargets', v_notification_targets
      );

      insert into dashboard_private.ops_registration_mutations(
        actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
      ) values (
        v_actor_id, v_request_key, p_task_id, 'save_appointment',
        v_target_fingerprint, v_response
      );
      return v_response;
    end if;

    -- ordinary_appointment_edit
    if v_terminal_child_count > 0
      or v_child_count <> pg_catalog.cardinality(v_scheduled_track_ids)
    then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track on track.id = selected.track_id
      where track.task_id = p_task_id
      order by track.id
    loop
      if p_kind = 'level_test' then
        select pg_catalog.count(*)
        into v_active_activity_count
        from public.ops_registration_level_tests attempt
        where attempt.track_id = v_track.id
          and attempt.status in ('scheduled', 'in_progress')
          and attempt.appointment_id is distinct from p_appointment_id;
        if v_active_activity_count > 0 then
          raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
        end if;

        if v_track.id = any(v_existing_track_ids) then
          if v_track.pipeline_status <> 'level_test_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        else
          select attempt.status
          into v_latest_attempt_status
          from public.ops_registration_level_tests attempt
          where attempt.track_id = v_track.id
          order by attempt.attempt_number desc, attempt.id desc
          limit 1;
          if (
            v_track.pipeline_status = 'inquiry'
            or (
              v_track.pipeline_status = 'waiting'
              and v_track.level_test_retake_decision = 'required'
            )
            or (
              v_track.pipeline_status = 'level_test_scheduled'
              and v_latest_attempt_status in ('absent', 'canceled')
            )
          ) is not true then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        end if;
      else
        perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        select pg_catalog.count(*)
        into v_active_activity_count
        from public.ops_registration_consultations consultation
        where consultation.track_id = v_track.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
          and consultation.appointment_id is distinct from p_appointment_id;
        if v_active_activity_count > 0 then
          raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
        end if;

        if v_track.id = any(v_existing_track_ids) then
          if v_track.pipeline_status <> 'visit_consultation_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        else
          if v_track.pipeline_status <> 'consultation_waiting' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
          select pg_catalog.count(*)
          into v_phone_consultation_count
          from public.ops_registration_consultations consultation
          where consultation.track_id = v_track.id
            and consultation.mode = 'phone'
            and consultation.status = 'waiting';
          if v_phone_consultation_count <> 1 then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        end if;
      end if;
    end loop;

    v_real_diff := v_appointment.scheduled_at is distinct from p_scheduled_at
      or v_appointment.place is distinct from v_place
      or v_track_ids is distinct from v_existing_track_ids;
    if not v_real_diff then
      if p_kind = 'level_test' then
        select coalesce(
          pg_catalog.array_agg(attempt.id order by attempt.track_id, attempt.id),
          array[]::uuid[]
        )
        into v_activity_ids
        from public.ops_registration_level_tests attempt
        where attempt.appointment_id = p_appointment_id
          and attempt.status = 'scheduled';
      else
        select coalesce(
          pg_catalog.array_agg(consultation.id order by consultation.track_id, consultation.id),
          array[]::uuid[]
        )
        into v_activity_ids
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = p_appointment_id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled';
      end if;

      v_response := pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'appointmentId', p_appointment_id,
        'notificationRevision', v_appointment.notification_revision,
        'trackIds', pg_catalog.to_jsonb(v_existing_track_ids),
        'activityIds', pg_catalog.to_jsonb(v_activity_ids),
        'requiresDirectorAssignmentTrackIds', '[]'::jsonb,
        'notificationTargets', '[]'::jsonb
      );
      insert into dashboard_private.ops_registration_mutations(
        actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
      ) values (
        v_actor_id, v_request_key, p_task_id, 'save_appointment',
        v_target_fingerprint, v_response
      );
      return v_response;
    end if;

    if p_kind = 'level_test' and pg_catalog.cardinality(v_added_track_ids) > 0 then
      perform 1
      from public.students student
      join (
        select distinct enrollment.student_id
        from public.ops_registration_enrollments enrollment
        join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
        where track.id = any(v_added_track_ids)
          and track.task_id = p_task_id
          and track.pipeline_status = 'waiting'
          and track.waiting_kind = 'current_class'
          and track.level_test_retake_decision = 'required'
          and enrollment.status = 'waitlisted'
          and enrollment.roster_active
          and enrollment.student_id is not null
      ) affected on affected.student_id = student.id
      order by student.id
      for update of student;

      perform 1
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
      where track.id = any(v_added_track_ids)
        and track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
      order by enrollment.id
      for update of enrollment;

      perform 1
      from public.classes class
      join (
        select distinct enrollment.class_id
        from public.ops_registration_enrollments enrollment
        join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
        where track.id = any(v_added_track_ids)
          and track.task_id = p_task_id
          and track.pipeline_status = 'waiting'
          and track.waiting_kind = 'current_class'
          and track.level_test_retake_decision = 'required'
          and enrollment.status = 'waitlisted'
          and enrollment.roster_active
      ) affected on affected.class_id = class.id
      order by class.id
      for update of class;

      for v_track in
        select track.*
        from pg_catalog.unnest(v_added_track_ids) selected(track_id)
        join public.ops_registration_subject_tracks track on track.id = selected.track_id
        where track.task_id = p_task_id
          and track.pipeline_status = 'waiting'
          and track.waiting_kind = 'current_class'
          and track.level_test_retake_decision = 'required'
        order by track.id
      loop
        select enrollment.id, enrollment.student_id, enrollment.class_id
        into v_wait_enrollment_id, v_wait_student_id, v_wait_class_id
        from public.ops_registration_enrollments enrollment
        join public.classes class on class.id = enrollment.class_id
        where enrollment.track_id = v_track.id
          and enrollment.status = 'waitlisted'
          and enrollment.roster_active
          and pg_catalog.btrim(class.subject) = v_track.subject
          and enrollment.student_id = v_task_student_id
        order by enrollment.id
        for update of enrollment, class;
        if not found or v_wait_student_id is null then
          raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
        end if;

        perform dashboard_private.apply_student_class_roster_mode(
          v_wait_student_id,
          v_wait_class_id,
          'removed',
          'waitlist',
          v_wait_enrollment_id,
          'level_test_retake_scheduled',
          v_actor_id
        );
        update public.ops_registration_enrollments enrollment
        set
          status = 'canceled',
          roster_active = false,
          roster_released_at = null,
          roster_release_reason = null,
          roster_release_source_task_id = null,
          roster_release_kind = null,
          updated_at = pg_catalog.now()
        where enrollment.id = v_wait_enrollment_id
          and enrollment.roster_active;
        if not found then
          raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
        end if;
      end loop;
    end if;

    update public.ops_registration_appointments appointment
    set
      scheduled_at = p_scheduled_at,
      place = v_place,
      notification_revision = notification_revision + 1,
      updated_at = pg_catalog.now()
    where appointment.id = p_appointment_id
    returning appointment.notification_revision into v_old_notification_revision;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_deselected_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track on track.id = selected.track_id
      where track.task_id = p_task_id
      order by track.id
    loop
      v_phone_consultation_id := null;
      if p_kind = 'level_test' then
        update public.ops_registration_level_tests attempt
        set
          status = 'canceled',
          completed_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
        where attempt.appointment_id = p_appointment_id
          and attempt.track_id = v_track.id
          and attempt.status = 'scheduled';
        if not found then
          raise exception 'registration_appointment_immutable' using errcode = '40001';
        end if;

        select pg_catalog.count(*)
        into v_active_activity_count
        from public.ops_registration_level_tests attempt
        where attempt.track_id = v_track.id
          and attempt.status in ('scheduled', 'in_progress');
        if v_active_activity_count = 0 then
          perform dashboard_private.transition_registration_track_status(
            v_track.id, 'inquiry', null, null, false
          );
        end if;
      else
        update public.ops_registration_consultations consultation
        set status = 'canceled', updated_at = pg_catalog.now()
        where consultation.appointment_id = p_appointment_id
          and consultation.track_id = v_track.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled';
        if not found then
          raise exception 'registration_appointment_immutable' using errcode = '40001';
        end if;

        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'consultation_waiting', null, null, false
        );
        v_director_ready := true;
        begin
          perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        exception
          when sqlstate '40001' then
            if sqlerrm is distinct from 'registration_director_refresh_required' then
              raise;
            end if;
            v_director_ready := false;
        end;

        if v_director_ready then
          if exists (
            select 1
            from public.ops_registration_consultations consultation
            where consultation.mode = 'phone'
              and consultation.status = 'waiting'
              and consultation.track_id = v_track.id
          ) then
            raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
          end if;
          insert into public.ops_registration_consultations(
            track_id, appointment_id, mode, status, director_profile_id,
            ready_at, ready_source
          ) values (
            v_track.id, null, 'phone', 'waiting', v_track.director_profile_id,
            pg_catalog.now(), 'visit_reopened'
          ) returning id into v_phone_consultation_id;
        else
          v_requires_director_assignment_track_ids := pg_catalog.array_append(
            v_requires_director_assignment_track_ids, v_track.id
          );
        end if;
      end if;

      v_canceled_track_ids := pg_catalog.array_append(v_canceled_track_ids, v_track.id);
      perform dashboard_private.write_registration_track_event(
        p_task_id,
        v_track.id,
        'appointment_subject_deselected',
        v_track.pipeline_status,
        case
          when p_kind = 'level_test' and v_active_activity_count = 0 then 'inquiry'
          when p_kind = 'visit_consultation' then 'consultation_waiting'
          else v_track.pipeline_status
        end,
        'appointment_subject_deselected',
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision,
          'kind', p_kind,
          'scheduledAt', p_scheduled_at,
          'place', v_place,
          'activeTrackIds', pg_catalog.to_jsonb(v_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_deselected_track_ids),
          'phoneConsultationId', v_phone_consultation_id,
          'changeKind', 'appointment_subject_deselected'
        )
      );
      if p_kind = 'visit_consultation' and not v_director_ready then
        perform dashboard_private.write_registration_track_event(
          p_task_id,
          v_track.id,
          'director_assignment_required',
          'consultation_waiting',
          'consultation_waiting',
          'appointment_subject_deselected',
          pg_catalog.jsonb_build_object(
            'appointmentId', p_appointment_id,
            'notificationRevision', v_old_notification_revision,
            'changeKind', 'director_assignment_required'
          )
        );
      end if;
    end loop;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_added_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track on track.id = selected.track_id
      where track.task_id = p_task_id
      order by track.id
    loop
      v_phone_consultation_id := null;
      if p_kind = 'level_test' then
        select coalesce(max(attempt.attempt_number), 0) + 1
        into v_attempt_number
        from public.ops_registration_level_tests attempt
        where attempt.track_id = v_track.id;
        insert into public.ops_registration_level_tests(
          track_id, appointment_id, attempt_number, status
        ) values (
          v_track.id, p_appointment_id, v_attempt_number, 'scheduled'
        ) returning id into v_activity_id;
        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'level_test_scheduled', null, null, false
        );
      else
        update public.ops_registration_consultations consultation
        set status = 'canceled', updated_at = pg_catalog.now()
        where consultation.track_id = v_track.id
          and consultation.mode = 'phone'
          and consultation.status = 'waiting'
        returning consultation.id, consultation.director_profile_id
        into v_phone_consultation_id, v_phone_director_id;
        if not found then
          raise exception 'registration_invalid_source_state' using errcode = '40001';
        end if;

        delete from public.dashboard_notifications notification
        where notification.type = 'registration_consultation'
          and notification.read_at is null
          and notification.dedupe_key =
            'registration:' || p_task_id::text || ':track:' || v_track.id::text
            || ':consultation:' || v_phone_consultation_id::text
            || ':director:' || v_phone_director_id::text;

        insert into public.ops_registration_consultations(
          track_id, appointment_id, mode, status, director_profile_id,
          ready_at, ready_source
        ) values (
          v_track.id, p_appointment_id, 'visit', 'scheduled', v_track.director_profile_id,
          null, null
        ) returning id into v_activity_id;
        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'visit_consultation_scheduled', null, null, false
        );
      end if;

      perform dashboard_private.write_registration_track_event(
        p_task_id,
        v_track.id,
        case
          when p_kind = 'level_test' and v_track.pipeline_status = 'inquiry'
            then 'level_test_scheduled'
          when p_kind = 'level_test' then 'level_test_retake_scheduled'
          else 'visit_scheduled'
        end,
        v_track.pipeline_status,
        case when p_kind = 'level_test' then 'level_test_scheduled' else 'visit_consultation_scheduled' end,
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision,
          'kind', p_kind,
          'scheduledAt', p_scheduled_at,
          'place', v_place,
          'activityId', v_activity_id,
          'activeTrackIds', pg_catalog.to_jsonb(v_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_deselected_track_ids),
          'changeKind', 'appointment_updated'
        )
      );
    end loop;

    for v_track in
      select track.*
      from public.ops_registration_subject_tracks track
      where track.task_id = p_task_id
        and track.id = any(v_track_ids)
        and track.id <> all(v_added_track_ids)
      order by track.id
    loop
      perform dashboard_private.write_registration_track_event(
        p_task_id,
        v_track.id,
        'appointment_updated',
        v_track.pipeline_status,
        v_track.pipeline_status,
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision,
          'kind', p_kind,
          'scheduledAt', p_scheduled_at,
          'place', v_place,
          'activeTrackIds', pg_catalog.to_jsonb(v_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_deselected_track_ids),
          'changeKind', 'appointment_updated'
        )
      );
    end loop;

    if p_kind = 'level_test' then
      select
        coalesce(
          pg_catalog.array_agg(attempt.id order by attempt.track_id, attempt.id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
          array[]::uuid[]
        )
      into v_activity_ids, v_active_track_ids
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id
        and attempt.status = 'scheduled';
    else
      select
        coalesce(
          pg_catalog.array_agg(consultation.id order by consultation.track_id, consultation.id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
          array[]::uuid[]
        )
      into v_activity_ids, v_active_track_ids
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled';
    end if;
    if v_active_track_ids is distinct from v_track_ids then
      raise exception 'registration_appointment_active_activity_exists' using errcode = '23514';
    end if;

    select coalesce(
      pg_catalog.array_agg(distinct track_id order by track_id),
      array[]::uuid[]
    )
    into v_requires_director_assignment_track_ids
    from pg_catalog.unnest(v_requires_director_assignment_track_ids) required(track_id);

    perform dashboard_private.recompute_registration_parent(p_task_id);
    v_notification_targets := case
      when p_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision
        )
      )
      else '[]'::jsonb
    end;
    v_response := pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'appointmentId', p_appointment_id,
      'notificationRevision', v_old_notification_revision,
      'trackIds', pg_catalog.to_jsonb(v_track_ids),
      'activityIds', pg_catalog.to_jsonb(v_activity_ids),
      'requiresDirectorAssignmentTrackIds',
        pg_catalog.to_jsonb(v_requires_director_assignment_track_ids),
      'notificationTargets', v_notification_targets
    );

    insert into dashboard_private.ops_registration_mutations(
      actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
    ) values (
      v_actor_id, v_request_key, p_task_id, 'save_appointment',
      v_target_fingerprint, v_response
    );
    return v_response;
  end if;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track
      on track.id = selected.track_id
    where track.task_id = p_task_id
    order by track.id
  loop
    if p_kind = 'level_test' then
      select pg_catalog.count(*)
      into v_active_activity_count
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id
        and attempt.status in ('scheduled', 'in_progress');
      if v_active_activity_count > 0 then
        raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
      end if;

      select attempt.status
      into v_latest_attempt_status
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id
      order by attempt.attempt_number desc, attempt.id desc
      limit 1;

      if (
        v_track.pipeline_status = 'inquiry'
        or (
          v_track.pipeline_status = 'waiting'
          and v_track.level_test_retake_decision = 'required'
        )
        or (
          v_track.pipeline_status = 'level_test_scheduled'
          and v_latest_attempt_status in ('absent', 'canceled')
        )
      ) is not true then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;
    else
      perform dashboard_private.assert_registration_track_director_ready(v_track.id);
      if v_track.pipeline_status <> 'consultation_waiting' then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;

      select pg_catalog.count(*)
      into v_active_activity_count
      from public.ops_registration_consultations consultation
      where consultation.track_id = v_track.id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled';
      if v_active_activity_count > 0 then
        raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
      end if;

      select pg_catalog.count(*)
      into v_phone_consultation_count
      from public.ops_registration_consultations consultation
      where consultation.track_id = v_track.id
        and consultation.mode = 'phone'
        and consultation.status = 'waiting';
      if v_phone_consultation_count <> 1 then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;
    end if;
  end loop;

  if p_kind = 'level_test' then
    -- current_class_retest_student_locks
    perform 1
    from public.students student
    join (
      select distinct enrollment.student_id
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track
        on track.id = enrollment.track_id
      where track.id = any(v_track_ids)
        and track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
        and enrollment.student_id is not null
    ) affected on affected.student_id = student.id
    order by student.id
    for update of student;

    -- current_class_retest_claim_locks
    perform 1
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track
      on track.id = enrollment.track_id
    where track.id = any(v_track_ids)
      and track.task_id = p_task_id
      and track.pipeline_status = 'waiting'
      and track.waiting_kind = 'current_class'
      and track.level_test_retake_decision = 'required'
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
    order by enrollment.id
    for update of enrollment;

    -- current_class_retest_class_locks
    perform 1
    from public.classes class
    join (
      select distinct enrollment.class_id
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track
        on track.id = enrollment.track_id
      where track.id = any(v_track_ids)
        and track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
    ) affected on affected.class_id = class.id
    order by class.id
    for update of class;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track
        on track.id = selected.track_id
      where track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
      order by track.id
    loop
      select enrollment.id, enrollment.student_id, enrollment.class_id
      into v_wait_enrollment_id, v_wait_student_id, v_wait_class_id
      from public.ops_registration_enrollments enrollment
      join public.classes class on class.id = enrollment.class_id
      where enrollment.track_id = v_track.id
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
        and pg_catalog.btrim(class.subject) = v_track.subject
        and enrollment.student_id = v_task_student_id
      order by enrollment.id
      for update of enrollment, class;
      if not found or v_wait_student_id is null then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;

      perform dashboard_private.apply_student_class_roster_mode(
        v_wait_student_id,
        v_wait_class_id,
        'removed',
        'waitlist',
        v_wait_enrollment_id,
        'registration level-test retake scheduled',
        v_actor_id
      );

      -- current_class_retest_claim_deactivation
      update public.ops_registration_enrollments enrollment
      set
        status = 'canceled',
        roster_active = false,
        updated_at = pg_catalog.now()
      where enrollment.id = v_wait_enrollment_id
        and enrollment.roster_active;
      if not found then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;
    end loop;
  end if;

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
  returning id into v_appointment_id;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track
      on track.id = selected.track_id
    where track.task_id = p_task_id
    order by track.id
  loop
    if p_kind = 'level_test' then
      select coalesce(max(attempt.attempt_number), 0) + 1
      into v_attempt_number
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id;

      insert into public.ops_registration_level_tests(
        track_id,
        appointment_id,
        attempt_number,
        status
      ) values (
        v_track.id,
        v_appointment_id,
        v_attempt_number,
        'scheduled'
      )
      returning id into v_activity_id;

      v_event_type := case
        when v_track.pipeline_status = 'inquiry' then 'level_test_scheduled'
        else 'level_test_retake_scheduled'
      end;
      perform dashboard_private.transition_registration_track_status(
        v_track.id,
        'level_test_scheduled',
        null,
        null,
        false
      );
    else
      -- visit_phone_cancellation
      update public.ops_registration_consultations consultation
      set
        status = 'canceled',
        updated_at = pg_catalog.now()
      where consultation.track_id = v_track.id
        and consultation.mode = 'phone'
        and consultation.status = 'waiting'
      returning consultation.id, consultation.director_profile_id
      into v_phone_consultation_id, v_phone_director_id;
      if not found then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;

      -- visit_phone_notification_cleanup
      delete from public.dashboard_notifications notification
      where notification.type = 'registration_consultation'
        and notification.read_at is null
        and notification.dedupe_key =
          'registration:' || p_task_id::text || ':track:' || v_track.id::text
          || ':consultation:' || v_phone_consultation_id::text
          || ':director:' || v_phone_director_id::text;

      insert into public.ops_registration_consultations(
        track_id,
        appointment_id,
        mode,
        status,
        director_profile_id,
        ready_at,
        ready_source
      ) values (
        v_track.id,
        v_appointment_id,
        'visit',
        'scheduled',
        v_track.director_profile_id,
        null,
        null
      )
      returning id into v_activity_id;

      v_event_type := 'visit_scheduled';
      perform dashboard_private.transition_registration_track_status(
        v_track.id,
        'visit_consultation_scheduled',
        null,
        null,
        false
      );
    end if;

    v_activity_ids := pg_catalog.array_append(v_activity_ids, v_activity_id);
    perform dashboard_private.write_registration_track_event(
      p_task_id,
      v_track.id,
      v_event_type,
      v_track.pipeline_status,
      case
        when p_kind = 'level_test' then 'level_test_scheduled'
        else 'visit_consultation_scheduled'
      end,
      null,
      pg_catalog.jsonb_build_object(
        'appointmentId', v_appointment_id,
        'notificationRevision', 1,
        'kind', p_kind,
        'scheduledAt', p_scheduled_at,
        'place', v_place,
        'activityId', v_activity_id,
        'attemptNumber', case when p_kind = 'level_test' then v_attempt_number else null end,
        'canceledPhoneConsultationId', case
          when p_kind = 'visit_consultation' then v_phone_consultation_id
          else null
        end,
        'activeTrackIds', pg_catalog.to_jsonb(v_track_ids),
        'canceledTrackIds', '[]'::jsonb,
        'changeKind', 'created'
      )
    );
  end loop;

  perform dashboard_private.recompute_registration_parent(p_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'appointmentId', v_appointment_id,
    'notificationRevision', 1,
    'kind', p_kind,
    'scheduledAt', p_scheduled_at,
    'place', v_place,
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'activityIds', pg_catalog.to_jsonb(v_activity_ids),
    'requiresDirectorAssignmentTrackIds', '[]'::jsonb,
    'notificationTargets', case
      when p_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointmentId', v_appointment_id,
          'notificationRevision', 1
        )
      )
      else '[]'::jsonb
    end
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
    'save_appointment',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.save_registration_shared_appointment_impl(uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text)
  owner to postgres;
revoke execute on function dashboard_private.save_registration_shared_appointment_impl(uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text) from public, anon;
grant execute on function dashboard_private.save_registration_shared_appointment_impl(uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text) to authenticated;

create or replace function dashboard_private.cancel_registration_appointment_impl(
  p_appointment_id uuid,
  p_expected_notification_revision integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_task_id uuid;
  v_kind text;
  v_appointment public.ops_registration_appointments%rowtype;
  v_child_count integer := 0;
  v_scheduled_track_ids uuid[] := array[]::uuid[];
  v_active_track_ids uuid[] := array[]::uuid[];
  v_requires_director_assignment_track_ids uuid[] := array[]::uuid[];
  v_scheduled_count integer := 0;
  v_other_active_count integer := 0;
  v_new_appointment_status text;
  v_notification_revision integer;
  v_director_ready boolean;
  v_phone_consultation_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_track record;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_appointment_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_expected_notification_revision is null then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;
  if v_reason is null then
    raise exception 'registration_appointment_cancel_reason_required' using errcode = '22023';
  end if;

  -- Resolve identifiers without treating this lookup as authority. The locked
  -- parent, tracks, appointment, and activities below remain authoritative.
  select appointment.task_id, appointment.kind
  into v_task_id, v_kind
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'expectedNotificationRevision', p_expected_notification_revision,
    'reason', v_reason
  );
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
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- A registration case has at most two tracks. Locking the complete parent
  -- set avoids adding a late track lock after the appointment tier.
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
  order by appointment.id
  for update;
  if not found or v_appointment.kind is distinct from v_kind then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = v_task_id
  order by attempt.id
  for update of attempt;

  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = v_task_id
  order by consultation.id
  for update of consultation;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, null, 'cancel_appointment'
  );

  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'cancel_appointment'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  if v_appointment.notification_revision is distinct from p_expected_notification_revision then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.ops_registration_level_tests attempt
    join public.ops_registration_subject_tracks track on track.id = attempt.track_id
    where attempt.appointment_id = p_appointment_id
      and track.task_id is distinct from v_task_id
  ) or exists (
    select 1
    from public.ops_registration_consultations consultation
    join public.ops_registration_subject_tracks track on track.id = consultation.track_id
    where consultation.appointment_id = p_appointment_id
      and track.task_id is distinct from v_task_id
  ) then
    raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
  end if;

  if v_kind = 'level_test' then
    if exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
    ) then
      raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
    end if;

    select
      pg_catalog.count(*),
      coalesce(
        pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id)
          filter (where attempt.status = 'scheduled'),
        array[]::uuid[]
      )
    into v_child_count, v_scheduled_track_ids
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = p_appointment_id;
  elsif v_kind = 'visit_consultation' then
    if exists (
      select 1
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id
    ) or exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and (
          consultation.mode <> 'visit'
          or consultation.status not in ('scheduled', 'completed', 'canceled')
        )
    ) then
      raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
    end if;

    select
      pg_catalog.count(*),
      coalesce(
        pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id)
          filter (where consultation.status = 'scheduled'),
        array[]::uuid[]
      )
    into v_child_count, v_scheduled_track_ids
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit';
  else
    raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
  end if;

  if v_child_count = 0 then
    raise exception 'registration_appointment_tracks_required' using errcode = '23514';
  end if;
  v_scheduled_count := pg_catalog.cardinality(v_scheduled_track_ids);
  if v_scheduled_count = 0 then
    raise exception 'registration_appointment_immutable' using errcode = '40001';
  end if;
  if v_appointment.status <> 'scheduled' then
    raise exception 'registration_appointment_immutable' using errcode = '40001';
  end if;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track on track.id = selected.track_id
    where track.task_id = v_task_id
    order by track.id
  loop
    if v_kind = 'level_test' and v_track.pipeline_status <> 'level_test_scheduled' then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
    if v_kind = 'visit_consultation'
      and v_track.pipeline_status <> 'visit_consultation_scheduled'
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  end loop;

  if v_kind = 'level_test' then
    update public.ops_registration_level_tests attempt
    set
      status = 'canceled',
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
    where attempt.appointment_id = p_appointment_id
      and attempt.status = 'scheduled';
    if not found then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    select coalesce(
      pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
      array[]::uuid[]
    )
    into v_active_track_ids
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = p_appointment_id
      and attempt.status in ('scheduled', 'in_progress');

    if pg_catalog.cardinality(v_active_track_ids) > 0 then
      v_new_appointment_status := 'scheduled';
    elsif not exists (
      select 1
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id
        and attempt.status <> 'canceled'
    ) then
      v_new_appointment_status := 'canceled';
    else
      v_new_appointment_status := 'completed';
    end if;
  else
    update public.ops_registration_consultations consultation
    set
      status = 'canceled',
      updated_at = pg_catalog.now()
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled';
    if not found then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    select coalesce(
      pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
      array[]::uuid[]
    )
    into v_active_track_ids
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled';

    if pg_catalog.cardinality(v_active_track_ids) > 0 then
      v_new_appointment_status := 'scheduled';
    elsif not exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit'
        and consultation.status <> 'canceled'
    ) then
      v_new_appointment_status := 'canceled';
    else
      v_new_appointment_status := 'completed';
    end if;
  end if;

  update public.ops_registration_appointments appointment
  set
    status = v_new_appointment_status,
    notification_revision = notification_revision + 1,
    updated_at = pg_catalog.now()
  where appointment.id = p_appointment_id
  returning appointment.notification_revision into v_notification_revision;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track on track.id = selected.track_id
    where track.task_id = v_task_id
    order by track.id
  loop
    v_phone_consultation_id := null;
    if v_kind = 'level_test' then
      select pg_catalog.count(*)
      into v_other_active_count
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id
        and attempt.status in ('scheduled', 'in_progress');

      if v_other_active_count = 0 then
        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'inquiry', null, null, false
        );
      end if;

      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'appointment_canceled',
        v_track.pipeline_status,
        case when v_other_active_count = 0 then 'inquiry' else v_track.pipeline_status end,
        v_reason,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_notification_revision,
          'kind', v_kind,
          'scheduledAt', v_appointment.scheduled_at,
          'place', v_appointment.place,
          'changeKind', 'appointment_canceled',
          'activeTrackIds', pg_catalog.to_jsonb(v_active_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_scheduled_track_ids)
        )
      );
    else
      perform dashboard_private.transition_registration_track_status(
        v_track.id, 'consultation_waiting', null, null, false
      );

      v_director_ready := true;
      begin
        perform dashboard_private.assert_registration_track_director_ready(v_track.id);
      exception
        when sqlstate '40001' then
          if sqlerrm is distinct from 'registration_director_refresh_required' then
            raise;
          end if;
          v_director_ready := false;
      end;

      if v_director_ready then
        if exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.track_id = v_track.id
            and consultation.status in ('waiting', 'scheduled')
        ) then
          raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
        end if;

        insert into public.ops_registration_consultations(
          track_id,
          appointment_id,
          mode,
          status,
          director_profile_id,
          ready_at,
          ready_source
        ) values (
          v_track.id,
          null,
          'phone',
          'waiting',
          v_track.director_profile_id,
          pg_catalog.now(),
          'visit_reopened'
        )
        returning id into v_phone_consultation_id;
      else
        v_requires_director_assignment_track_ids := pg_catalog.array_append(
          v_requires_director_assignment_track_ids,
          v_track.id
        );
      end if;

      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'appointment_canceled',
        v_track.pipeline_status,
        'consultation_waiting',
        v_reason,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_notification_revision,
          'kind', v_kind,
          'scheduledAt', v_appointment.scheduled_at,
          'place', v_appointment.place,
          'changeKind', 'appointment_canceled',
          'activeTrackIds', pg_catalog.to_jsonb(v_active_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_scheduled_track_ids),
          'phoneConsultationId', v_phone_consultation_id
        )
      );

      if not v_director_ready then
        perform dashboard_private.write_registration_track_event(
          v_task_id,
          v_track.id,
          'director_assignment_required',
          'consultation_waiting',
          'consultation_waiting',
          v_reason,
          pg_catalog.jsonb_build_object(
            'appointmentId', p_appointment_id,
            'notificationRevision', v_notification_revision,
            'changeKind', 'director_assignment_required'
          )
        );
      end if;
    end if;
  end loop;

  select coalesce(
    pg_catalog.array_agg(distinct track_id order by track_id),
    array[]::uuid[]
  )
  into v_requires_director_assignment_track_ids
  from pg_catalog.unnest(v_requires_director_assignment_track_ids) required(track_id);

  perform dashboard_private.recompute_registration_parent(v_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'notificationRevision', v_notification_revision,
    'requiresDirectorAssignmentTrackIds',
      pg_catalog.to_jsonb(v_requires_director_assignment_track_ids),
    'notificationTargets', case
      when v_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_notification_revision
        )
      )
      else '[]'::jsonb
    end
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
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.cancel_registration_appointment_impl(uuid, integer, text, text)
  owner to postgres;
revoke execute on function dashboard_private.cancel_registration_appointment_impl(uuid, integer, text, text) from public, anon;
grant execute on function dashboard_private.cancel_registration_appointment_impl(uuid, integer, text, text) to authenticated;

create or replace function dashboard_private.complete_registration_level_test_attempt_impl(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_status text := pg_catalog.lower(nullif(pg_catalog.btrim(p_status), ''));
  v_material_link text := nullif(pg_catalog.btrim(p_material_link), '');
  v_task_id uuid;
  v_track_id uuid;
  v_appointment_id uuid;
  v_attempt public.ops_registration_level_tests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_active_track_ids uuid[] := array[]::uuid[];
  v_canceled_track_ids uuid[] := array[]::uuid[];
  v_appointment_status text;
  v_next_track_status text;
  v_consultation_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_status is null or v_status not in ('completed', 'absent', 'canceled') then
    raise exception 'registration_level_test_status_invalid' using errcode = '22023';
  end if;
  if p_attempt_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select track.task_id, attempt.track_id, attempt.appointment_id
  into v_task_id, v_track_id, v_appointment_id
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where attempt.id = p_attempt_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'attemptId', p_attempt_id,
    'status', v_status,
    'materialLink', case when v_status = 'completed' then v_material_link else null end
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- level_test_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- level_test_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- level_test_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  -- level_test_appointment_locks
  perform 1
  from public.ops_registration_appointments appointment
  where appointment.task_id = v_task_id
    and appointment.kind = 'level_test'
  order by appointment.id
  for update;

  -- level_test_attempt_locks
  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = v_task_id
  order by attempt.id
  for update of attempt;

  -- level_test_consultation_locks
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = v_task_id
    and consultation.status in ('waiting', 'scheduled')
  order by consultation.id
  for update of consultation;

  select attempt.*
  into v_attempt
  from public.ops_registration_level_tests attempt
  where attempt.id = p_attempt_id
    and attempt.track_id = v_track_id
    and attempt.appointment_id = v_appointment_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = v_appointment_id
    and appointment.task_id = v_task_id
    and appointment.kind = 'level_test';
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, v_track_id, 'complete_level_test'
  );

  -- level_test_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'complete_level_test'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- level_test_mutable_state_check
  if v_appointment.task_id is distinct from v_task_id
    or v_appointment.kind <> 'level_test'
    or v_appointment.status <> 'scheduled'
  then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  if v_status = 'completed' then
    if v_attempt.status <> 'in_progress'
      or v_track.pipeline_status <> 'level_test_in_progress'
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
    if v_material_link is null then
      raise exception 'registration_level_test_material_link_required' using errcode = '22023';
    end if;
    perform dashboard_private.assert_registration_track_director_ready(v_track_id);
    if exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.track_id = v_track_id
        and consultation.status in ('waiting', 'scheduled')
    ) then
      raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
    end if;
  elsif v_status in ('absent', 'canceled') then
    if v_attempt.status not in ('scheduled', 'in_progress')
      or (
        v_attempt.status = 'scheduled'
        and v_track.pipeline_status <> 'level_test_scheduled'
      )
      or (
        v_attempt.status = 'in_progress'
        and v_track.pipeline_status <> 'level_test_in_progress'
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  end if;

  update public.ops_registration_level_tests attempt
  set
    status = v_status,
    completed_at = pg_catalog.now(),
    material_link = case when v_status = 'completed' then v_material_link else null end,
    updated_at = pg_catalog.now()
  where attempt.id = p_attempt_id
    and attempt.status = v_attempt.status
  returning attempt.* into v_attempt;
  if not found then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  if v_status = 'completed' then
    insert into public.ops_registration_consultations(
      track_id, appointment_id, mode, status, director_profile_id,
      ready_at, ready_source
    ) values (
      v_track_id, null, 'phone', 'waiting', v_track.director_profile_id,
      v_attempt.completed_at, 'level_test_completion'
    ) returning id into v_consultation_id;
    v_next_track_status := 'consultation_waiting';
  else
    v_next_track_status := 'level_test_scheduled';
  end if;

  perform dashboard_private.transition_registration_track_status(
    v_track_id,
    case when v_status = 'completed' then 'consultation_waiting' else 'level_test_scheduled' end,
    null,
    null,
    false
  );

  if exists (
    select 1
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = v_appointment_id
      and attempt.status in ('scheduled', 'in_progress')
  ) then
    v_appointment_status := 'scheduled';
  elsif not exists (
    select 1
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = v_appointment_id
      and attempt.status <> 'canceled'
  ) then
    v_appointment_status := 'canceled';
  else
    v_appointment_status := 'completed';
  end if;

  update public.ops_registration_appointments appointment
  set status = v_appointment_status, updated_at = pg_catalog.now()
  where appointment.id = v_appointment_id
    and appointment.status is distinct from v_appointment_status;

  select coalesce(
    pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
    array[]::uuid[]
  )
  into v_active_track_ids
  from public.ops_registration_level_tests attempt
  where attempt.appointment_id = v_appointment_id
    and attempt.status in ('scheduled', 'in_progress');
  select coalesce(
    pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
    array[]::uuid[]
  )
  into v_canceled_track_ids
  from public.ops_registration_level_tests attempt
  where attempt.appointment_id = v_appointment_id
    and attempt.status = 'canceled';

  perform dashboard_private.write_registration_track_event(
    v_task_id,
    v_track_id,
    case v_status
      when 'completed' then 'level_test_completed'
      when 'absent' then 'level_test_absent'
      else 'level_test_canceled'
    end,
    v_track.pipeline_status,
    v_next_track_status,
    null,
    pg_catalog.jsonb_build_object(
      'appointmentId', v_appointment_id,
      'notificationRevision', v_appointment.notification_revision,
      'attemptId', p_attempt_id,
      'attemptNumber', v_attempt.attempt_number,
      'resultStatus', v_status,
      'appointmentStatus', v_appointment_status,
      'consultationId', v_consultation_id,
      'activeTrackIds', pg_catalog.to_jsonb(v_active_track_ids),
      'canceledTrackIds', pg_catalog.to_jsonb(v_canceled_track_ids),
      'changeKind', 'level_test_result_recorded'
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', v_track_id,
    'attemptId', p_attempt_id,
    'appointmentId', v_appointment_id,
    'attemptNumber', v_attempt.attempt_number,
    'status', v_attempt.status,
    'materialLink', v_attempt.material_link,
    'completedAt', v_attempt.completed_at,
    'trackStatus', v_next_track_status,
    'appointmentStatus', v_appointment_status,
    'consultationId', v_consultation_id
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'complete_level_test',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.complete_registration_level_test_attempt_impl(uuid, text, text, text)
  owner to postgres;
revoke execute on function dashboard_private.complete_registration_level_test_attempt_impl(uuid, text, text, text) from public, anon;
grant execute on function dashboard_private.complete_registration_level_test_attempt_impl(uuid, text, text, text) to authenticated;

create or replace function dashboard_private.resolve_registration_migration_review_impl(
  p_task_id uuid,
  p_assignments jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_payload jsonb := coalesce(p_assignments, '{}'::jsonb);
  v_normalized_assignments jsonb;
  v_normalized_track_states jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_legacy_before jsonb;
  v_legacy_after jsonb;
  v_legacy_booleans jsonb;
  v_legacy_pipeline_status text;
  v_legacy_student_id uuid;
  v_legacy_class_id uuid;
  v_legacy_textbook_id uuid;
  v_legacy_updated_at timestamptz;
  v_level_test_at timestamptz;
  v_level_test_completed_at timestamptz;
  v_phone_consultation_at timestamptz;
  v_visit_consultation_at timestamptz;
  v_consultation_completed_at timestamptz;
  v_class_start_date date;
  v_class_start_session text;
  v_level_group_present boolean;
  v_consultation_group_present boolean;
  v_placement_group_present boolean;
  v_level_track_id uuid;
  v_consultation_track_id uuid;
  v_placement_track_id uuid;
  v_level_preserve boolean := false;
  v_consultation_preserve boolean := false;
  v_placement_preserve boolean := false;
  v_review_count integer;
  v_single_review_track_id uuid;
  v_state jsonb;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_target_status text;
  v_waiting_kind text;
  v_state_class_id uuid;
  v_class public.classes%rowtype;
  v_student public.students%rowtype;
  v_session_key text;
  v_session_validation jsonb;
  v_appointment_id uuid;
  v_consultation_id uuid;
  v_enrollment_id uuid;
  v_batch_id uuid;
  v_batch_status text;
  v_revision integer;
  v_admission_notice_sent boolean;
  v_makeedu_registered boolean;
  v_invoice_sent boolean;
  v_payment_checked boolean;
begin
  if v_actor_id is null or p_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  -- migration_review_payload_validation
  if pg_catalog.jsonb_typeof(v_payload) <> 'object' then
    raise exception 'registration_migration_payload_invalid' using errcode = '22023';
  end if;
  if exists (
      select 1
      from pg_catalog.jsonb_object_keys(coalesce(p_assignments, '{}'::jsonb)) payload_key
      where payload_key not in ('assignments', 'trackStates')
    )
    or pg_catalog.jsonb_typeof(coalesce(v_payload -> 'assignments', '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_migration_payload_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'assignments', '[]'::jsonb)) assignment_item
    where pg_catalog.jsonb_typeof(assignment_item) <> 'object'
  ) then
    raise exception 'registration_migration_assignment_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'assignments', '[]'::jsonb)) assignment_item
    where exists (
        select 1 from pg_catalog.jsonb_object_keys(assignment_item) assignment_key
        where assignment_key not in ('group', 'trackId', 'preserveAsCommonHistory')
      )
      or nullif(pg_catalog.btrim(assignment_item ->> 'group'), '') not in ('level_test', 'consultation', 'placement')
      or not (assignment_item ? 'preserveAsCommonHistory')
      or pg_catalog.jsonb_typeof(assignment_item -> 'preserveAsCommonHistory') <> 'boolean'
      or (
        nullif(pg_catalog.btrim(assignment_item ->> 'trackId'), '') is not null
        and nullif(pg_catalog.btrim(assignment_item ->> 'trackId'), '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      or (
        coalesce(assignment_item -> 'preserveAsCommonHistory' = 'true'::jsonb, false)
        = (nullif(pg_catalog.btrim(assignment_item ->> 'trackId'), '') is not null)
      )
  ) then
    raise exception 'registration_migration_assignment_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'assignments', '[]'::jsonb)) assignment_item
    group by nullif(pg_catalog.btrim(assignment_item ->> 'group'), '')
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_migration_assignment_group_duplicate' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) state_item
    where pg_catalog.jsonb_typeof(state_item) <> 'object'
  ) then
    raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) state_item
    where exists (
        select 1 from pg_catalog.jsonb_object_keys(state_item) state_key
        where state_key not in ('trackId', 'targetStatus', 'waitingKind', 'classId')
      )
      or nullif(pg_catalog.btrim(state_item ->> 'trackId'), '') is null
      or nullif(pg_catalog.btrim(state_item ->> 'trackId'), '')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.lower(nullif(pg_catalog.btrim(state_item ->> 'targetStatus'), '')) not in (
        'inquiry', 'level_test_scheduled', 'consultation_waiting',
        'visit_consultation_scheduled', 'waiting', 'enrollment_decided',
        'enrollment_processing', 'registered', 'not_registered', 'inquiry_closed'
      )
      or (
        nullif(pg_catalog.btrim(state_item ->> 'classId'), '') is not null
        and nullif(pg_catalog.btrim(state_item ->> 'classId'), '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
  ) then
    raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) state_item
    group by nullif(pg_catalog.btrim(state_item ->> 'trackId'), '')
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_migration_track_state_duplicate' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'group', nullif(pg_catalog.btrim(assignment_item ->> 'group'), ''),
        'trackId', nullif(pg_catalog.btrim(assignment_item ->> 'trackId'), '')::uuid,
        'preserveAsCommonHistory', (assignment_item ->> 'preserveAsCommonHistory')::boolean
      ) order by assignment_item ->> 'group'
    ),
    '[]'::jsonb
  )
  into v_normalized_assignments
  from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'assignments', '[]'::jsonb)) assignment_item;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'trackId', nullif(pg_catalog.btrim(state_item ->> 'trackId'), '')::uuid,
        'targetStatus', pg_catalog.lower(nullif(pg_catalog.btrim(state_item ->> 'targetStatus'), '')),
        'waitingKind', pg_catalog.lower(nullif(pg_catalog.btrim(state_item ->> 'waitingKind'), '')),
        'classId', nullif(pg_catalog.btrim(state_item ->> 'classId'), '')::uuid
      ) order by state_item ->> 'trackId'
    ),
    '[]'::jsonb
  )
  into v_normalized_track_states
  from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) state_item;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'assignments', v_normalized_assignments,
    'trackStates', v_normalized_track_states
  );

  -- migration_review_actor_request_lock
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- migration_review_task_detail_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- migration_review_track_lock
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;
  select pg_catalog.count(*)
  into v_review_count
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
    and track.pipeline_status = 'migration_review'
    and track.migration_review_required;
  select track.id
  into v_single_review_track_id
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
    and track.pipeline_status = 'migration_review'
    and track.migration_review_required
  order by track.id
  limit 1;
  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'resolve_migration_review'
  );

  -- migration_review_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'resolve_migration_review'
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

  -- migration_review_evidence_validation
  if v_review_count = 0
    or pg_catalog.jsonb_array_length(v_normalized_track_states) <> v_review_count
    or exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.task_id = p_task_id
        and track.pipeline_status = 'migration_review'
        and track.migration_review_required
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
          where nullif(state_item ->> 'trackId', '')::uuid = track.id
        )
    )
  then
    raise exception 'registration_migration_track_states_incomplete' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
    left join public.ops_registration_subject_tracks track
      on track.id = nullif(state_item ->> 'trackId', '')::uuid
      and track.task_id = p_task_id
      and track.pipeline_status = 'migration_review'
      and track.migration_review_required
    where track.id is null
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_assignments) assignment_item
    left join public.ops_registration_subject_tracks track
      on track.id = nullif(assignment_item ->> 'trackId', '')::uuid
      and track.task_id = p_task_id
      and track.pipeline_status = 'migration_review'
      and track.migration_review_required
    where assignment_item ->> 'trackId' is not null
      and track.id is null
  ) then
    raise exception 'registration_migration_assignment_track_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.pipeline_status = 'migration_review'
      and track.migration_review_required
      and not exists (
        select 1
        from public.ops_task_events event
        where event.task_id = p_task_id
          and event.event_type = 'legacy_registration_imported'
          and (event.after_value::jsonb ->> 'version') = '1'
          and nullif(event.after_value::jsonb ->> 'trackId', '')::uuid = track.id
      )
  ) then
    raise exception 'registration_migration_legacy_snapshot_missing' using errcode = '23514';
  end if;
  if (
    select pg_catalog.count(distinct pg_catalog.jsonb_build_object(
      'pipelineStatus', event.before_value::jsonb ->> 'pipelineStatus',
      'studentId', event.before_value::jsonb ->> 'studentId',
      'classId', event.before_value::jsonb ->> 'classId',
      'textbookId', event.before_value::jsonb ->> 'textbookId',
      'timestamps', event.after_value::jsonb -> 'timestamps',
      'legacyBooleans', event.after_value::jsonb -> 'legacyBooleans'
    ))
    from public.ops_task_events event
    where event.task_id = p_task_id
      and event.event_type = 'legacy_registration_imported'
      and (event.after_value::jsonb ->> 'version') = '1'
  ) <> 1 then
    raise exception 'registration_migration_legacy_snapshot_conflict' using errcode = '23514';
  end if;

  select event.before_value::jsonb, event.after_value::jsonb
  into v_legacy_before, v_legacy_after
  from public.ops_task_events event
  where event.task_id = p_task_id
    and event.event_type = 'legacy_registration_imported'
    and (event.after_value::jsonb ->> 'version') = '1'
  order by event.created_at, event.id
  limit 1;
  v_legacy_pipeline_status := nullif(v_legacy_before ->> 'pipelineStatus', '');
  v_legacy_student_id := nullif(v_legacy_before ->> 'studentId', '')::uuid;
  v_legacy_class_id := nullif(v_legacy_before ->> 'classId', '')::uuid;
  v_legacy_textbook_id := nullif(v_legacy_before ->> 'textbookId', '')::uuid;
  v_legacy_booleans := coalesce(v_legacy_after -> 'legacyBooleans', '{}'::jsonb);
  v_legacy_updated_at := nullif(v_legacy_after #>> '{timestamps,taskUpdatedAt}', '')::timestamptz;
  v_level_test_at := nullif(v_legacy_after #>> '{timestamps,levelTestAt}', '')::timestamptz;
  v_level_test_completed_at := nullif(v_legacy_after #>> '{timestamps,levelTestCompletedAt}', '')::timestamptz;
  v_phone_consultation_at := nullif(v_legacy_after #>> '{timestamps,phoneConsultationAt}', '')::timestamptz;
  v_visit_consultation_at := nullif(v_legacy_after #>> '{timestamps,visitConsultationAt}', '')::timestamptz;
  v_consultation_completed_at := nullif(v_legacy_after #>> '{timestamps,consultationAt}', '')::timestamptz;
  v_class_start_date := nullif(v_legacy_after #>> '{timestamps,classStartDate}', '')::date;
  v_class_start_session := nullif(pg_catalog.btrim(v_legacy_after #>> '{timestamps,classStartSession}'), '');
  v_admission_notice_sent := coalesce((v_legacy_booleans ->> 'admissionNoticeSent')::boolean, false);
  v_makeedu_registered := coalesce((v_legacy_booleans ->> 'makeeduRegistered')::boolean, false);
  v_invoice_sent := coalesce((v_legacy_booleans ->> 'makeeduInvoiceSent')::boolean, false);
  v_payment_checked := coalesce((v_legacy_booleans ->> 'paymentChecked')::boolean, false);

  v_level_group_present := v_level_test_at is not null
    or v_level_test_completed_at is not null
    or nullif(pg_catalog.btrim(v_detail.level_test_place), '') is not null
    or nullif(pg_catalog.btrim(v_detail.level_test_material_link), '') is not null
    or nullif(pg_catalog.btrim(v_detail.level_test_result), '') is not null;
  v_consultation_group_present := v_visit_consultation_at is not null
    or v_consultation_completed_at is not null
    or nullif(pg_catalog.btrim(v_detail.visit_consultation_place), '') is not null
    or nullif(v_legacy_after #>> '{timestamps,phoneConsultationAt}', '') is not null;
  v_placement_group_present := v_legacy_student_id is not null
    or v_legacy_class_id is not null
    or v_legacy_textbook_id is not null
    or v_class_start_date is not null
    or v_class_start_session is not null
    or v_admission_notice_sent
    or v_makeedu_registered
    or v_invoice_sent
    or v_payment_checked;

  select nullif(assignment_item ->> 'trackId', '')::uuid,
    coalesce((assignment_item ->> 'preserveAsCommonHistory')::boolean, false)
  into v_level_track_id, v_level_preserve
  from pg_catalog.jsonb_array_elements(v_normalized_assignments) assignment_item
  where assignment_item ->> 'group' = 'level_test';
  select nullif(assignment_item ->> 'trackId', '')::uuid,
    coalesce((assignment_item ->> 'preserveAsCommonHistory')::boolean, false)
  into v_consultation_track_id, v_consultation_preserve
  from pg_catalog.jsonb_array_elements(v_normalized_assignments) assignment_item
  where assignment_item ->> 'group' = 'consultation';
  select nullif(assignment_item ->> 'trackId', '')::uuid,
    coalesce((assignment_item ->> 'preserveAsCommonHistory')::boolean, false)
  into v_placement_track_id, v_placement_preserve
  from pg_catalog.jsonb_array_elements(v_normalized_assignments) assignment_item
  where assignment_item ->> 'group' = 'placement';

  if v_review_count = 1 then
    if v_level_group_present and v_level_track_id is null and not v_level_preserve then
      v_level_track_id := v_single_review_track_id;
    end if;
    if v_consultation_group_present and v_consultation_track_id is null and not v_consultation_preserve then
      v_consultation_track_id := v_single_review_track_id;
    end if;
    if v_placement_group_present and v_placement_track_id is null and not v_placement_preserve then
      v_placement_track_id := v_single_review_track_id;
    end if;
  end if;
  if (v_level_group_present and v_level_track_id is null and not v_level_preserve)
    or (v_consultation_group_present and v_consultation_track_id is null and not v_consultation_preserve)
    or (v_placement_group_present and v_placement_track_id is null and not v_placement_preserve)
  then
    raise exception 'registration_migration_group_assignment_required' using errcode = '22023';
  end if;
  if (not v_level_group_present and (v_level_track_id is not null or v_level_preserve))
    or (not v_consultation_group_present and (v_consultation_track_id is not null or v_consultation_preserve))
    or (not v_placement_group_present and (v_placement_track_id is not null or v_placement_preserve))
  then
    raise exception 'registration_migration_assignment_group_empty' using errcode = '22023';
  end if;

  perform 1
  from public.ops_registration_appointments appointment
  where appointment.task_id = p_task_id
  order by appointment.id
  for update;
  perform 1
  from public.ops_registration_level_tests level_test
  join public.ops_registration_subject_tracks track on track.id = level_test.track_id
  where track.task_id = p_task_id
  order by level_test.id
  for update of level_test;
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = p_task_id
  order by consultation.id
  for update of consultation;
  if exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.pipeline_status = 'migration_review'
      and (
        exists (select 1 from public.ops_registration_level_tests level_test where level_test.track_id = track.id)
        or exists (select 1 from public.ops_registration_consultations consultation where consultation.track_id = track.id)
        or exists (select 1 from public.ops_registration_enrollments enrollment where enrollment.track_id = track.id)
      )
  ) then
    raise exception 'registration_migration_review_child_invariant' using errcode = '23514';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
    where state_item ->> 'targetStatus' = 'waiting'
      and state_item ->> 'waitingKind' = 'current_class'
  ) then
    if pg_catalog.regexp_replace(
        coalesce(v_task.student_name, ''), '\s+', '', 'g'
      ) = ''
      or pg_catalog.regexp_replace(
        coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
      ) = ''
    then
      raise exception 'registration_student_identity_required' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'registration-student:'
          || pg_catalog.lower(pg_catalog.regexp_replace(
            v_task.student_name, '\s+', '', 'g'
          ))
          || ':'
          || pg_catalog.regexp_replace(v_detail.parent_phone, '\D+', '', 'g'),
        0
      )
    );
  end if;

  if v_legacy_student_id is not null then
    select student.*
    into v_student
    from public.students student
    where student.id = v_legacy_student_id
    for update;
  end if;
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = p_task_id
  order by batch.id
  for update;
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = p_task_id
  order by enrollment.id
  for update of enrollment;
  if v_legacy_student_id is not null and v_legacy_class_id is not null then
    perform 1
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = v_legacy_student_id
      and enrollment.class_id = v_legacy_class_id
    order by enrollment.id
    for update;
  end if;
  if v_legacy_class_id is not null then
    select class.*
    into v_class
    from public.classes class
    where class.id = v_legacy_class_id
    for update;
  end if;
  if v_legacy_textbook_id is not null then
    perform 1
    from public.textbooks textbook
    where textbook.id = v_legacy_textbook_id
    order by textbook.id
    for update;
    if not found then
      raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
    end if;
  end if;

  for v_state in
    select state_item
    from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
    order by state_item ->> 'trackId'
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = nullif(v_state ->> 'trackId', '')::uuid
      and track.task_id = p_task_id;
    v_target_status := v_state ->> 'targetStatus';
    v_waiting_kind := nullif(v_state ->> 'waitingKind', '');
    v_state_class_id := nullif(v_state ->> 'classId', '')::uuid;

    if v_target_status = 'waiting' then
      if v_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening')
        or (v_waiting_kind = 'current_class') is distinct from (v_state_class_id is not null)
      then
        raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
      end if;
    elsif v_waiting_kind is not null then
      raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
    elsif v_target_status in ('enrollment_decided', 'enrollment_processing', 'registered') then
      if v_state_class_id is null or v_state_class_id is distinct from v_legacy_class_id then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    elsif v_state_class_id is not null then
      raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
    end if;

    if v_target_status = 'level_test_scheduled'
      and (
        v_level_track_id is distinct from v_track.id
        or v_level_test_at is null
        or nullif(pg_catalog.btrim(v_detail.level_test_place), '') is null
      )
    then
      raise exception 'registration_migration_level_test_evidence_invalid' using errcode = '23514';
    end if;
    if v_target_status = 'visit_consultation_scheduled'
      and (
        v_consultation_track_id is distinct from v_track.id
        or v_visit_consultation_at is null
        or nullif(pg_catalog.btrim(v_detail.visit_consultation_place), '') is null
      )
    then
      raise exception 'registration_migration_visit_evidence_invalid' using errcode = '23514';
    end if;
    if v_target_status in ('consultation_waiting', 'visit_consultation_scheduled') then
      perform dashboard_private.assert_registration_track_director_ready(v_track.id);
    end if;
    if v_target_status = 'waiting' and v_waiting_kind = 'current_class' then
      perform 1
      from public.classes class
      where class.id = v_state_class_id
        and pg_catalog.btrim(class.subject) = v_track.subject;
      if not found then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    end if;
    if v_target_status in ('enrollment_decided', 'enrollment_processing', 'registered') then
      if v_target_status in ('enrollment_processing', 'registered')
        and (
          v_task.student_id is distinct from v_legacy_student_id
          or v_student.id is null
          or pg_catalog.lower(
            pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
          ) is distinct from pg_catalog.lower(
            pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g')
          )
          or pg_catalog.regexp_replace(
            coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
          ) is distinct from pg_catalog.regexp_replace(
            coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
          )
          or (
            nullif(pg_catalog.btrim(v_detail.school_name), '') is not null
            and v_student.school is distinct from v_detail.school_name
          )
          or (
            nullif(pg_catalog.btrim(v_detail.student_phone), '') is not null
            and pg_catalog.regexp_replace(
              coalesce(v_student.contact, ''), '\D+', '', 'g'
            ) is distinct from pg_catalog.regexp_replace(
              v_detail.student_phone, '\D+', '', 'g'
            )
          )
        )
      then
        raise exception 'registration_student_identity_mismatch' using errcode = '23514';
      end if;
      if v_target_status in ('enrollment_processing', 'registered')
        and exists (
          select 1
          from public.ops_registration_enrollments enrollment
          where enrollment.student_id = v_legacy_student_id
            and enrollment.class_id = v_legacy_class_id
            and enrollment.roster_active
        )
      then
        raise exception 'registration_student_class_already_active' using errcode = '23514';
      end if;
      if v_placement_track_id is distinct from v_track.id
        or v_class.id is null
        or pg_catalog.btrim(v_class.subject) is distinct from v_track.subject
        or (
          v_legacy_textbook_id is not null
          and not (coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb) ? v_legacy_textbook_id::text)
        )
        or (v_class_start_date is null) is distinct from (v_class_start_session is null)
      then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
      if v_class_start_date is not null then
        if v_class_start_session !~ '^[1-9][0-9]*회차$' then
          raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
        end if;
        v_session_key := v_class_start_date::text || ':'
          || substring(v_class_start_session from '^([1-9][0-9]*)회차$');
        v_session_validation := dashboard_private.validate_registration_class_session(
          v_class.id, v_class_start_date, v_session_key
        );
        if not coalesce((v_session_validation ->> 'valid')::boolean, false)
          or v_session_validation ->> 'sessionLabel' is distinct from v_class_start_session
        then
          raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
        end if;
      elsif v_target_status in ('enrollment_processing', 'registered') then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    end if;
    if v_target_status = 'enrollment_processing' then
      if not (
        v_legacy_pipeline_status like '5-1.%'
        or v_legacy_pipeline_status like '6.%'
      )
        or v_student.id is null
        or v_student.status = '퇴원'
        or not v_admission_notice_sent
        or (v_legacy_pipeline_status like '6.%' and not v_makeedu_registered)
        or (v_invoice_sent and not v_makeedu_registered)
        or (v_payment_checked and not v_invoice_sent)
        or ((v_invoice_sent or v_payment_checked) and v_legacy_updated_at is null)
        or coalesce(v_student.class_ids, '[]'::jsonb) ? v_class.id::text
        or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_class.id::text
        or coalesce(v_class.student_ids, '[]'::jsonb) ? v_student.id::text
        or coalesce(v_class.waitlist_ids, '[]'::jsonb) ? v_student.id::text
      then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    end if;
    if v_target_status = 'registered' then
      if not (v_legacy_pipeline_status like '7.%')
        or v_student.id is null
        or v_student.status <> '재원'
        or not coalesce((v_legacy_booleans ->> 'admissionNoticeSent')::boolean, false)
        or not coalesce((v_legacy_booleans ->> 'makeeduRegistered')::boolean, false)
        or not coalesce((v_legacy_booleans ->> 'makeeduInvoiceSent')::boolean, false)
        or not coalesce((v_legacy_booleans ->> 'paymentChecked')::boolean, false)
        or v_legacy_updated_at is null
        or not (coalesce(v_student.class_ids, '[]'::jsonb) ? v_class.id::text)
        or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_class.id::text
        or not (coalesce(v_class.student_ids, '[]'::jsonb) ? v_student.id::text)
        or coalesce(v_class.waitlist_ids, '[]'::jsonb) ? v_student.id::text
      then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    end if;
  end loop;

  -- migration_review_activity_creation
  for v_state in
    select state_item
    from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
    order by state_item ->> 'trackId'
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = nullif(v_state ->> 'trackId', '')::uuid
      and track.task_id = p_task_id;
    v_target_status := v_state ->> 'targetStatus';
    v_waiting_kind := nullif(v_state ->> 'waitingKind', '');
    v_state_class_id := nullif(v_state ->> 'classId', '')::uuid;
    v_appointment_id := null;
    v_consultation_id := null;
    v_enrollment_id := null;
    v_batch_id := null;

    if v_target_status = 'level_test_scheduled' then
      insert into public.ops_registration_appointments(
        task_id, kind, scheduled_at, place, status, created_by
      ) values (
        p_task_id, 'level_test', v_level_test_at,
        pg_catalog.btrim(v_detail.level_test_place), 'scheduled', v_actor_id
      ) returning id into v_appointment_id;
      insert into public.ops_registration_level_tests(
        track_id, appointment_id, attempt_number, status
      ) values (
        v_track.id, v_appointment_id, 1, 'scheduled'
      );
    elsif v_target_status = 'consultation_waiting' then
      insert into public.ops_registration_consultations(
        track_id, appointment_id, mode, status, director_profile_id,
        ready_at, ready_source
      ) values (
        v_track.id, null, 'phone', 'waiting', v_track.director_profile_id,
        coalesce(v_phone_consultation_at, pg_catalog.now()), 'migration'
      ) returning id into v_consultation_id;
    elsif v_target_status = 'visit_consultation_scheduled' then
      insert into public.ops_registration_appointments(
        task_id, kind, scheduled_at, place, status, created_by
      ) values (
        p_task_id, 'visit_consultation', v_visit_consultation_at,
        pg_catalog.btrim(v_detail.visit_consultation_place), 'scheduled', v_actor_id
      ) returning id into v_appointment_id;
      insert into public.ops_registration_consultations(
        track_id, appointment_id, mode, status, director_profile_id,
        ready_at, ready_source
      ) values (
        v_track.id, v_appointment_id, 'visit', 'scheduled', v_track.director_profile_id,
        null, null
      ) returning id into v_consultation_id;
    elsif v_target_status = 'waiting' and v_waiting_kind = 'current_class' then
      perform dashboard_private.apply_registration_current_class_wait(
        p_task_id, v_track.id, v_state_class_id, v_actor_id
      );
      select enrollment.id
      into v_enrollment_id
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = v_track.id
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active;
    elsif v_target_status = 'enrollment_decided' then
      insert into public.ops_registration_enrollments(
        track_id, class_id, textbook_id, class_start_date,
        class_start_session_key, class_start_session, status,
        makeedu_registered, roster_active, sort_order
      ) values (
        v_track.id, v_legacy_class_id, v_legacy_textbook_id, v_class_start_date,
        v_session_key, v_class_start_session, 'planned', false, false, 0
      ) returning id into v_enrollment_id;
    elsif v_target_status in ('enrollment_processing', 'registered') then
      select coalesce(pg_catalog.max(batch.revision_number), 0) + 1
      into v_revision
      from public.ops_registration_admission_batches batch
      where batch.task_id = p_task_id;
      if v_target_status = 'registered' then
        v_batch_status := 'completed';
      elsif v_payment_checked then
        v_batch_status := 'paid';
      elsif v_invoice_sent then
        v_batch_status := 'invoiced';
      else
        v_batch_status := 'draft';
      end if;
      insert into public.ops_registration_admission_batches(
        task_id, revision_number, status, invoice_sent_at, payment_confirmed_at
      ) values (
        p_task_id,
        v_revision,
        v_batch_status,
        case when v_batch_status in ('invoiced', 'paid', 'completed') then v_legacy_updated_at end,
        case when v_batch_status in ('paid', 'completed') then v_legacy_updated_at end
      ) returning id into v_batch_id;
      insert into public.ops_registration_enrollments(
        track_id, student_id, admission_batch_id, class_id, textbook_id,
        class_start_date, class_start_session_key, class_start_session,
        status, makeedu_registered, roster_active, sort_order
      ) values (
        v_track.id, v_legacy_student_id, v_batch_id, v_legacy_class_id, v_legacy_textbook_id,
        v_class_start_date, v_session_key, v_class_start_session,
        case when v_target_status = 'registered' then 'enrolled' else 'planned' end,
        v_makeedu_registered,
        true,
        0
      ) returning id into v_enrollment_id;
    end if;

    -- migration_review_transition
    perform dashboard_private.transition_registration_track_status(
      v_track.id,
      v_target_status,
      case when v_target_status = 'waiting' then v_waiting_kind else null end,
      null,
      false
    );
    perform dashboard_private.write_registration_track_event(
      p_task_id,
      v_track.id,
      'migration_review_resolved',
      'migration_review',
      v_target_status,
      null,
      pg_catalog.jsonb_build_object(
        'assignments', v_normalized_assignments,
        'targetState', v_state,
        'levelTestTrackId', v_level_track_id,
        'consultationTrackId', v_consultation_track_id,
        'placementTrackId', v_placement_track_id,
        'appointmentId', v_appointment_id,
        'consultationId', v_consultation_id,
        'enrollmentId', v_enrollment_id,
        'batchId', v_batch_id,
        'legacyPipelineStatus', v_legacy_pipeline_status
      )
    );
  end loop;

  -- migration_review_parent_recompute
  perform dashboard_private.recompute_registration_parent(p_task_id);
  select pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'tracks', coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', track.id,
        'taskId', track.task_id,
        'subject', track.subject,
        'status', track.pipeline_status,
        'directorProfileId', track.director_profile_id,
        'waitingKind', track.waiting_kind,
        'migrationReviewRequired', track.migration_review_required,
        'stageEnteredAt', track.stage_entered_at
      ) order by case track.subject when '영어' then 0 when '수학' then 1 else 9 end, track.id
    ), '[]'::jsonb)
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;

  -- migration_review_receipt_insert
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id,
    'resolve_migration_review', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.resolve_registration_migration_review_impl(uuid, jsonb, text)
  owner to postgres;
revoke execute on function dashboard_private.resolve_registration_migration_review_impl(uuid, jsonb, text) from public, anon;
grant execute on function dashboard_private.resolve_registration_migration_review_impl(uuid, jsonb, text) to authenticated;

create or replace function dashboard_private.reopen_registration_track_impl(
  p_track_id uuid,
  p_destination text,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_destination text := pg_catalog.lower(nullif(pg_catalog.btrim(p_destination), ''));
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_consultation_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_track_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'registration_reopen_reason_required' using errcode = '22023';
  end if;
  if v_destination is null or v_destination not in ('inquiry', 'consultation_waiting') then
    raise exception 'registration_reopen_destination_invalid' using errcode = '22023';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'destination', v_destination,
    'reason', v_reason
  );

  -- reopen_track_actor_request_lock
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- reopen_track_task_detail_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- reopen_track_track_lock
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'reopen_track'
  );
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
  order by consultation.id
  for update;

  -- reopen_track_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'reopen_track'
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

  -- reopen_track_mutable_state_check
  if v_track.pipeline_status not in ('not_registered', 'inquiry_closed')
    or v_track.migration_review_required
  then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_admission_batches batch
    join public.ops_registration_enrollments enrollment
      on enrollment.admission_batch_id = batch.id
    where enrollment.track_id = p_track_id
      and batch.status not in ('completed', 'canceled')
  ) then
    raise exception 'registration_open_admission_batch' using errcode = '40001';
  end if;

  -- reopen_track_activity_creation
  if v_destination = 'consultation_waiting' then
    perform dashboard_private.assert_registration_track_director_ready(p_track_id);
    insert into public.ops_registration_consultations(
      track_id, appointment_id, mode, status, director_profile_id,
      ready_at, ready_source
    )
    select
      track.id, null, 'phone', 'waiting', track.director_profile_id,
      pg_catalog.now(), 'track_reopened'
    from public.ops_registration_subject_tracks track
    where track.id = p_track_id
      and not exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.track_id = track.id
          and consultation.status in ('waiting', 'scheduled')
      )
    returning id into v_consultation_id;
    if v_consultation_id is null then
      raise exception 'registration_active_consultation_conflict' using errcode = '40001';
    end if;
  end if;

  -- reopen_track_transition
  perform dashboard_private.transition_registration_track_status(
    p_track_id,
    v_destination,
    null,
    null,
    false
  );
  perform dashboard_private.write_registration_track_event(
    v_task_id,
    p_track_id,
    'track_reopened',
    v_track.pipeline_status,
    v_destination,
    v_reason,
    pg_catalog.jsonb_build_object('consultationId', v_consultation_id)
  );

  -- reopen_track_parent_recompute
  perform dashboard_private.recompute_registration_parent(v_task_id);
  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', track.id,
    'subject', track.subject,
    'status', track.pipeline_status,
    'directorProfileId', track.director_profile_id,
    'consultationId', v_consultation_id,
    'stageEnteredAt', track.stage_entered_at
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;

  -- reopen_track_receipt_insert
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id,
    'reopen_track', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.reopen_registration_track_impl(uuid, text, text, text)
  owner to postgres;
revoke execute on function dashboard_private.reopen_registration_track_impl(uuid, text, text, text) from public, anon;
grant execute on function dashboard_private.reopen_registration_track_impl(uuid, text, text, text) to authenticated;

create function dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_subjects text[],
  p_request_note text,
  p_priority text,
  p_subject_plans jsonb,
  p_level_test_appointment jsonb,
  p_visit_appointment jsonb,
  p_director_overrides jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_school_grade text := nullif(pg_catalog.btrim(p_school_grade), '');
  v_school_name text := nullif(pg_catalog.btrim(p_school_name), '');
  v_parent_phone text := nullif(pg_catalog.btrim(p_parent_phone), '');
  v_student_phone text := nullif(pg_catalog.btrim(p_student_phone), '');
  v_campus text := nullif(pg_catalog.btrim(p_campus), '');
  v_request_note text := nullif(pg_catalog.btrim(p_request_note), '');
  v_priority text := nullif(pg_catalog.btrim(p_priority), '');
  v_parent_phone_digits text;
  v_subjects text[];
  v_subject text;
  v_plan text;
  v_subject_plans jsonb;
  v_level_test_appointment jsonb;
  v_visit_appointment jsonb;
  v_director_overrides jsonb;
  v_level_test_subjects text[] := array[]::text[];
  v_visit_subjects text[] := array[]::text[];
  v_appointment_subjects text[] := array[]::text[];
  v_level_test_scheduled_at timestamptz;
  v_visit_scheduled_at timestamptz;
  v_level_test_place text;
  v_visit_place text;
  v_directors jsonb := '{}'::jsonb;
  v_director_resolution jsonb;
  v_director_profile_id uuid;
  v_director_source text;
  v_director_rule_key text;
  v_override_text text;
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_level_test_appointment_id uuid;
  v_visit_appointment_id uuid;
  v_activity_id uuid;
  v_consultation_id uuid;
  v_level_test_track_ids uuid[] := array[]::uuid[];
  v_visit_track_ids uuid[] := array[]::uuid[];
  v_notification_targets jsonb := '[]'::jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_tracks jsonb := '[]'::jsonb;
  v_appointments jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if v_actor_id is null
    or (public.current_dashboard_role() in ('admin', 'staff')) is not true
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
    where subject.value is null
      or nullif(pg_catalog.btrim(subject.value), '') is null
      or pg_catalog.btrim(subject.value) not in ('영어', '수학')
  ) then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.array_agg(normalized.subject order by normalized.subject_order),
    array[]::text[]
  )
  into v_subjects
  from (
    select distinct
      pg_catalog.btrim(subject.value) as subject,
      case pg_catalog.btrim(subject.value) when '영어' then 0 else 1 end as subject_order
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
    where nullif(pg_catalog.btrim(subject.value), '') is not null
  ) normalized;
  if pg_catalog.cardinality(v_subjects) = 0 then
    raise exception 'registration_subjects_required' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_subjects) not between 1 and 2 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;
  if v_student_name is null then
    raise exception 'registration_student_name_required' using errcode = '22023';
  end if;
  if v_school_grade is null then
    raise exception 'registration_school_grade_required' using errcode = '22023';
  end if;
  v_parent_phone_digits := pg_catalog.regexp_replace(
    coalesce(v_parent_phone, ''), '\D+', '', 'g'
  );
  if v_parent_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_parent_phone_invalid' using errcode = '22023';
  end if;
  if p_inquiry_at is null then
    raise exception 'registration_inquiry_at_required' using errcode = '22023';
  end if;
  if v_campus is null or v_campus not in ('본관', '별관') then
    raise exception 'registration_campus_invalid' using errcode = '22023';
  end if;
  if v_priority is null or v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'registration_priority_invalid' using errcode = '22023';
  end if;

  -- Validate every JSON container before using object or array expansion.
  if p_subject_plans is null
    or pg_catalog.jsonb_typeof(p_subject_plans) <> 'object'
  then
    raise exception 'registration_initial_subject_plan_invalid' using errcode = '22023';
  end if;
  v_subject_plans := p_subject_plans;
  if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_subject_plans) plan_key
      where plan_key <> all(v_subjects)
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(v_subject_plans)
    ) <> pg_catalog.cardinality(v_subjects)
    or exists (
      select 1
      from pg_catalog.jsonb_each(v_subject_plans) plan_entry
      where pg_catalog.jsonb_typeof(plan_entry.value) <> 'string'
        or pg_catalog.btrim(plan_entry.value #>> '{}') not in (
          'inquiry', 'level_test', 'direct_phone', 'visit'
        )
    )
  then
    raise exception 'registration_initial_subject_plan_invalid' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_object_agg(
    subject.value,
    pg_catalog.btrim(v_subject_plans ->> subject.value)
    order by case subject.value when '영어' then 0 else 1 end
  )
  into v_subject_plans
  from pg_catalog.unnest(v_subjects) subject(value);

  select coalesce(
    pg_catalog.array_agg(subject.value order by case subject.value when '영어' then 0 else 1 end),
    array[]::text[]
  )
  into v_level_test_subjects
  from pg_catalog.unnest(v_subjects) subject(value)
  where v_subject_plans ->> subject.value = 'level_test';
  select coalesce(
    pg_catalog.array_agg(subject.value order by case subject.value when '영어' then 0 else 1 end),
    array[]::text[]
  )
  into v_visit_subjects
  from pg_catalog.unnest(v_subjects) subject(value)
  where v_subject_plans ->> subject.value = 'visit';

  v_level_test_appointment := case
    when p_level_test_appointment is null
      or pg_catalog.jsonb_typeof(p_level_test_appointment) = 'null'
      then null
    else p_level_test_appointment
  end;
  if (pg_catalog.cardinality(v_level_test_subjects) = 0)
      is distinct from (v_level_test_appointment is null)
  then
    raise exception 'registration_initial_appointment_membership_invalid'
      using errcode = '22023';
  end if;
  if v_level_test_appointment is not null then
    if pg_catalog.jsonb_typeof(v_level_test_appointment) <> 'object' then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_level_test_appointment) appointment_key
        where appointment_key not in ('scheduledAt', 'place', 'subjects')
      )
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(v_level_test_appointment)
      ) <> 3
    then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_level_test_appointment -> 'scheduledAt') <> 'string'
      or pg_catalog.jsonb_typeof(v_level_test_appointment -> 'place') <> 'string'
    then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_level_test_appointment -> 'subjects') <> 'array' then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_level_test_appointment -> 'subjects'
      ) subject_item
      where pg_catalog.jsonb_typeof(subject_item) <> 'string'
    ) then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    select coalesce(
      pg_catalog.array_agg(normalized.subject order by normalized.subject_order),
      array[]::text[]
    )
    into v_appointment_subjects
    from (
      select distinct
        pg_catalog.btrim(subject_item #>> '{}') as subject,
        case pg_catalog.btrim(subject_item #>> '{}') when '영어' then 0 else 1 end
          as subject_order
      from pg_catalog.jsonb_array_elements(
        v_level_test_appointment -> 'subjects'
      ) subject_item
    ) normalized;
    if v_appointment_subjects is distinct from v_level_test_subjects
      or pg_catalog.cardinality(v_appointment_subjects)
        <> pg_catalog.jsonb_array_length(v_level_test_appointment -> 'subjects')
    then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    v_level_test_place := nullif(
      pg_catalog.btrim(v_level_test_appointment ->> 'place'), ''
    );
    begin
      v_level_test_scheduled_at := nullif(
        pg_catalog.btrim(v_level_test_appointment ->> 'scheduledAt'), ''
      )::timestamptz;
    exception when others then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end;
    if v_level_test_scheduled_at is null or v_level_test_place is null then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    v_level_test_appointment := pg_catalog.jsonb_build_object(
      'scheduledAt', v_level_test_scheduled_at,
      'place', v_level_test_place,
      'subjects', pg_catalog.to_jsonb(v_level_test_subjects)
    );
  end if;

  v_visit_appointment := case
    when p_visit_appointment is null
      or pg_catalog.jsonb_typeof(p_visit_appointment) = 'null'
      then null
    else p_visit_appointment
  end;
  if (pg_catalog.cardinality(v_visit_subjects) = 0)
      is distinct from (v_visit_appointment is null)
  then
    raise exception 'registration_initial_appointment_membership_invalid'
      using errcode = '22023';
  end if;
  if v_visit_appointment is not null then
    if pg_catalog.jsonb_typeof(v_visit_appointment) <> 'object' then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_visit_appointment) appointment_key
        where appointment_key not in ('scheduledAt', 'place', 'subjects')
      )
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(v_visit_appointment)
      ) <> 3
    then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_visit_appointment -> 'scheduledAt') <> 'string'
      or pg_catalog.jsonb_typeof(v_visit_appointment -> 'place') <> 'string'
    then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_visit_appointment -> 'subjects') <> 'array' then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_visit_appointment -> 'subjects') subject_item
      where pg_catalog.jsonb_typeof(subject_item) <> 'string'
    ) then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    select coalesce(
      pg_catalog.array_agg(normalized.subject order by normalized.subject_order),
      array[]::text[]
    )
    into v_appointment_subjects
    from (
      select distinct
        pg_catalog.btrim(subject_item #>> '{}') as subject,
        case pg_catalog.btrim(subject_item #>> '{}') when '영어' then 0 else 1 end
          as subject_order
      from pg_catalog.jsonb_array_elements(
        v_visit_appointment -> 'subjects'
      ) subject_item
    ) normalized;
    if v_appointment_subjects is distinct from v_visit_subjects
      or pg_catalog.cardinality(v_appointment_subjects)
        <> pg_catalog.jsonb_array_length(v_visit_appointment -> 'subjects')
    then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    v_visit_place := nullif(pg_catalog.btrim(v_visit_appointment ->> 'place'), '');
    begin
      v_visit_scheduled_at := nullif(
        pg_catalog.btrim(v_visit_appointment ->> 'scheduledAt'), ''
      )::timestamptz;
    exception when others then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end;
    if v_visit_scheduled_at is null or v_visit_place is null then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    v_visit_appointment := pg_catalog.jsonb_build_object(
      'scheduledAt', v_visit_scheduled_at,
      'place', v_visit_place,
      'subjects', pg_catalog.to_jsonb(v_visit_subjects)
    );
  end if;

  if p_director_overrides is null then
    v_director_overrides := '{}'::jsonb;
  elsif pg_catalog.jsonb_typeof(p_director_overrides) <> 'object' then
    raise exception 'registration_director_override_invalid' using errcode = '22023';
  else
    v_director_overrides := p_director_overrides;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_each(v_director_overrides) override_entry
    where override_entry.key <> all(v_subjects)
      or pg_catalog.jsonb_typeof(override_entry.value) <> 'string'
      or nullif(pg_catalog.btrim(override_entry.value #>> '{}'), '') is null
      or pg_catalog.btrim(override_entry.value #>> '{}')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'registration_director_override_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_each(v_director_overrides) override_entry
    where not dashboard_private.is_active_registration_director(
      pg_catalog.btrim(override_entry.value #>> '{}')::uuid
    )
  ) then
    raise exception 'registration_director_override_invalid' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.jsonb_object_agg(
      override_entry.key,
      pg_catalog.btrim(override_entry.value #>> '{}')::uuid::text
      order by case override_entry.key when '영어' then 0 else 1 end
    ),
    '{}'::jsonb
  )
  into v_director_overrides
  from pg_catalog.jsonb_each(v_director_overrides) override_entry;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'studentName', v_student_name,
    'schoolGrade', v_school_grade,
    'schoolName', v_school_name,
    'parentPhone', v_parent_phone,
    'studentPhone', v_student_phone,
    'campus', v_campus,
    'inquiryAt', p_inquiry_at,
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'requestNote', v_request_note,
    'priority', v_priority,
    'subjectPlans', v_subject_plans,
    'levelTestAppointment', v_level_test_appointment,
    'visitAppointment', v_visit_appointment,
    'directorOverrides', v_director_overrides
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- registration_initial_receipt_lookup
  select
    mutation.response_payload,
    mutation.mutation_type = 'create_case_with_initial_workflow_v1'
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

  -- Resolve every selected subject before the parent insert so director
  -- failures have stable codes and no partially-created case can survive.
  foreach v_subject in array v_subjects
  loop
    v_plan := v_subject_plans ->> v_subject;
    v_override_text := nullif(v_director_overrides ->> v_subject, '');
    v_director_profile_id := null;
    v_director_source := null;
    v_director_rule_key := null;
    if v_override_text is not null then
      v_director_profile_id := v_override_text::uuid;
      v_director_source := 'manual';
    else
      v_director_resolution := dashboard_private.resolve_registration_default_director(
        v_subject, v_school_grade, p_inquiry_at
      );
      if v_director_resolution ->> 'status' = 'resolved' then
        v_director_profile_id := nullif(
          v_director_resolution ->> 'profileId', ''
        )::uuid;
        v_director_rule_key := nullif(v_director_resolution ->> 'ruleKey', '');
        if dashboard_private.is_active_registration_director(v_director_profile_id) then
          v_director_source := 'default';
        else
          v_director_profile_id := null;
          v_director_rule_key := null;
        end if;
      end if;
    end if;
    if v_plan in ('direct_phone', 'visit') and v_director_profile_id is null then
      raise exception 'registration_director_required' using errcode = '22023';
    end if;
    v_directors := pg_catalog.jsonb_set(
      v_directors,
      array[v_subject],
      pg_catalog.jsonb_build_object(
        'profileId', v_director_profile_id,
        'source', v_director_source,
        'ruleKey', v_director_rule_key
      ),
      true
    );
  end loop;

  insert into public.ops_tasks(
    title, type, status, priority, requested_by, student_id,
    student_name, campus, subject, memo
  ) values (
    '등록: ' || v_student_name,
    'registration',
    'requested',
    v_priority,
    v_actor_id,
    null,
    v_student_name,
    v_campus,
    pg_catalog.array_to_string(v_subjects, ', '),
    null
  ) returning id into v_task_id;

  insert into public.ops_registration_details(
    task_id, inquiry_at, school_grade, school_name, parent_phone,
    student_phone, request_note, pipeline_status, common_revision
  ) values (
    v_task_id, p_inquiry_at, v_school_grade, v_school_name, v_parent_phone,
    v_student_phone, v_request_note, '0. 등록 문의', 1
  );

  insert into public.ops_registration_subject_tracks(
    task_id,
    subject,
    pipeline_status,
    director_profile_id,
    director_assignment_source,
    director_assignment_rule_key,
    director_assigned_at,
    migration_review_required
  )
  select
    v_task_id,
    subject.value,
    'inquiry',
    nullif(v_directors #>> array[subject.value, 'profileId'], '')::uuid,
    nullif(v_directors #>> array[subject.value, 'source'], ''),
    nullif(v_directors #>> array[subject.value, 'ruleKey'], ''),
    case
      when nullif(v_directors #>> array[subject.value, 'profileId'], '') is not null
        then pg_catalog.now()
      else null
    end,
    false
  from pg_catalog.unnest(v_subjects) subject(value)
  order by case subject.value when '영어' then 0 else 1 end;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values (
    v_task_id,
    v_actor_id,
    'registration_case_created',
    'registration_case',
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'actorId', v_actor_id,
      'subjects', pg_catalog.to_jsonb(v_subjects),
      'occurredAt', pg_catalog.now()
    )::text
  );

  if pg_catalog.cardinality(v_level_test_subjects) > 0 then
    insert into public.ops_registration_appointments(
      task_id, kind, scheduled_at, place, status, notification_revision, created_by
    ) values (
      v_task_id,
      'level_test',
      v_level_test_scheduled_at,
      v_level_test_place,
      'scheduled',
      1,
      v_actor_id
    ) returning id into v_level_test_appointment_id;

    select coalesce(
      pg_catalog.array_agg(track.id order by track.id),
      array[]::uuid[]
    )
    into v_level_test_track_ids
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and track.subject = any(v_level_test_subjects);

    for v_track in
      select track.*
      from public.ops_registration_subject_tracks track
      where track.task_id = v_task_id
        and track.subject = any(v_level_test_subjects)
      order by track.id
    loop
      insert into public.ops_registration_level_tests(
        track_id, appointment_id, attempt_number, status
      ) values (
        v_track.id, v_level_test_appointment_id, 1, 'scheduled'
      ) returning id into v_activity_id;
      perform dashboard_private.transition_registration_track_status(
        v_track.id, 'level_test_scheduled', null, null, false
      );
      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'level_test_scheduled',
        'inquiry',
        'level_test_scheduled',
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', v_level_test_appointment_id,
          'notificationRevision', 1,
          'kind', 'level_test',
          'scheduledAt', v_level_test_scheduled_at,
          'place', v_level_test_place,
          'activityId', v_activity_id,
          'attemptNumber', 1,
          'activeTrackIds', pg_catalog.to_jsonb(v_level_test_track_ids),
          'canceledTrackIds', '[]'::jsonb,
          'changeKind', 'created'
        )
      );
    end loop;
  end if;

  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and v_subject_plans ->> track.subject = 'direct_phone'
    order by track.id
  loop
    insert into public.ops_registration_consultations(
      track_id, appointment_id, mode, status, director_profile_id,
      ready_at, ready_source
    ) values (
      v_track.id, null, 'phone', 'waiting', v_track.director_profile_id,
      p_inquiry_at, 'inquiry'
    ) returning id into v_consultation_id;
    perform dashboard_private.transition_registration_track_status(
      v_track.id, 'consultation_waiting', null, null, false
    );
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      v_track.id,
      'inquiry_routed',
      'inquiry',
      'consultation_waiting',
      null,
      pg_catalog.jsonb_build_object(
        'consultationId', v_consultation_id,
        'initialAction', 'direct_phone'
      )
    );
  end loop;

  if pg_catalog.cardinality(v_visit_subjects) > 0 then
    insert into public.ops_registration_appointments(
      task_id, kind, scheduled_at, place, status, notification_revision, created_by
    ) values (
      v_task_id,
      'visit_consultation',
      v_visit_scheduled_at,
      v_visit_place,
      'scheduled',
      1,
      v_actor_id
    ) returning id into v_visit_appointment_id;

    select coalesce(
      pg_catalog.array_agg(track.id order by track.id),
      array[]::uuid[]
    )
    into v_visit_track_ids
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and track.subject = any(v_visit_subjects);

    for v_track in
      select track.*
      from public.ops_registration_subject_tracks track
      where track.task_id = v_task_id
        and track.subject = any(v_visit_subjects)
      order by track.id
    loop
      insert into public.ops_registration_consultations(
        track_id, appointment_id, mode, status, director_profile_id,
        ready_at, ready_source
      ) values (
        v_track.id,
        v_visit_appointment_id,
        'visit',
        'scheduled',
        v_track.director_profile_id,
        null,
        null
      ) returning id into v_activity_id;
      perform dashboard_private.transition_registration_track_status(
        v_track.id, 'visit_consultation_scheduled', null, null, false
      );
      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'visit_scheduled',
        'inquiry',
        'visit_consultation_scheduled',
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', v_visit_appointment_id,
          'notificationRevision', 1,
          'kind', 'visit_consultation',
          'scheduledAt', v_visit_scheduled_at,
          'place', v_visit_place,
          'activityId', v_activity_id,
          'activeTrackIds', pg_catalog.to_jsonb(v_visit_track_ids),
          'canceledTrackIds', '[]'::jsonb,
          'changeKind', 'created'
        )
      );
    end loop;
    v_notification_targets := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'appointmentId', v_visit_appointment_id,
        'notificationRevision', 1
      )
    );
  end if;

  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and v_subject_plans ->> track.subject = 'inquiry'
    order by track.id
  loop
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      v_track.id,
      'initial_inquiry_selected',
      'inquiry',
      'inquiry',
      null,
      pg_catalog.jsonb_build_object('initialAction', 'inquiry')
    );
  end loop;

  perform dashboard_private.recompute_registration_parent(v_task_id);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', track.id,
        'taskId', track.task_id,
        'subject', track.subject,
        'status', track.pipeline_status,
        'directorProfileId', track.director_profile_id,
        'directorAssignmentSource', track.director_assignment_source,
        'directorAssignmentRuleKey', track.director_assignment_rule_key,
        'waitingKind', track.waiting_kind,
        'levelTestRetakeDecision', track.level_test_retake_decision,
        'migrationReviewRequired', track.migration_review_required,
        'stageEnteredAt', track.stage_entered_at
      ) order by case track.subject when '영어' then 0 else 1 end, track.id
    ),
    '[]'::jsonb
  )
  into v_tracks
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', appointment.id,
        'taskId', appointment.task_id,
        'kind', appointment.kind,
        'scheduledAt', appointment.scheduled_at,
        'place', appointment.place,
        'status', appointment.status,
        'notificationRevision', appointment.notification_revision,
        'createdAt', appointment.created_at,
        'updatedAt', appointment.updated_at
      ) order by
        case appointment.kind when 'level_test' then 0 else 1 end,
        appointment.id
    ),
    '[]'::jsonb
  )
  into v_appointments
  from public.ops_registration_appointments appointment
  where appointment.task_id = v_task_id;

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', 1,
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'tracks', v_tracks,
    'appointments', v_appointments,
    'notificationTargets', v_notification_targets
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_task_id,
    'create_case_with_initial_workflow_v1',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.create_registration_case_with_initial_workflow_v1_impl(text, text, text, text, text, text, timestamptz, text[], text, text, jsonb, jsonb, jsonb, jsonb, text) owner to postgres;
revoke execute on function dashboard_private.create_registration_case_with_initial_workflow_v1_impl(text, text, text, text, text, text, timestamptz, text[], text, text, jsonb, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function dashboard_private.create_registration_case_with_initial_workflow_v1_impl(text, text, text, text, text, text, timestamptz, text[], text, text, jsonb, jsonb, jsonb, jsonb, text) to authenticated;

create function public.create_registration_case_with_initial_workflow_v1(
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_subjects text[],
  p_request_note text,
  p_priority text,
  p_subject_plans jsonb,
  p_level_test_appointment jsonb,
  p_visit_appointment jsonb,
  p_director_overrides jsonb,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
    p_student_name,
    p_school_grade,
    p_school_name,
    p_parent_phone,
    p_student_phone,
    p_campus,
    p_inquiry_at,
    p_subjects,
    p_request_note,
    p_priority,
    p_subject_plans,
    p_level_test_appointment,
    p_visit_appointment,
    p_director_overrides,
    p_request_key
  );
$$;

alter function public.create_registration_case_with_initial_workflow_v1(text, text, text, text, text, text, timestamptz, text[], text, text, jsonb, jsonb, jsonb, jsonb, text) owner to postgres;
revoke execute on function public.create_registration_case_with_initial_workflow_v1(text, text, text, text, text, text, timestamptz, text[], text, text, jsonb, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.create_registration_case_with_initial_workflow_v1(text, text, text, text, text, text, timestamptz, text[], text, text, jsonb, jsonb, jsonb, jsonb, text) to authenticated;

create function public.registration_intake_workflow_runtime_version()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select 1;
$$;

alter function public.registration_intake_workflow_runtime_version()
  owner to postgres;
revoke execute on function public.registration_intake_workflow_runtime_version() from public, anon;
grant execute on function public.registration_intake_workflow_runtime_version() to authenticated;

commit;
