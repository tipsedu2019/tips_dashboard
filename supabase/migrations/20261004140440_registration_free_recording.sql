begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The owner confirmed that registration is optional information plus a manual
-- progress/outcome property. Neither choosing a status nor saving a partial
-- waiting note executes enrollment, books a session, or sends a message.
-- Retain all historical return states; they are no longer a prerequisite for
-- the manual status property. No existing data is rewritten.
alter table public.ops_registration_subject_tracks
  drop constraint ops_registration_subject_tracks_observation_return_workflow_pair_check,
  drop constraint ops_registration_subject_tracks_waiting_detail_class_check,
  add constraint ops_registration_subject_tracks_waiting_detail_class_check
    check (waiting_detail_class_id is null or waiting_detail_kind is not distinct from 'current_class') not valid;

create or replace function dashboard_private.set_registration_workflow_status_v1_impl(
  p_track_id uuid,
  p_workflow_status text,
  p_expected_workflow_revision integer,
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
  v_workflow_status text := nullif(pg_catalog.btrim(p_workflow_status), '');
  v_track public.ops_registration_subject_tracks%rowtype;
  v_target_fingerprint jsonb;
  v_response jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_status_changed boolean;
  v_previous_workflow_status text;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_expected_workflow_revision is null or p_expected_workflow_revision < 1 then
    raise exception 'registration_workflow_revision_invalid' using errcode = '22023';
  end if;
  if v_workflow_status not in (
    'inquiry',
    'level_test_requested',
    'consultation_requested',
    'consultation_completed',
    'waiting_current_class',
    'waiting_new_class',
    'waiting_next_opening',
    'observation_requested',
    'enrollment_requested',
    'payment_in_progress',
    'registered',
    'not_registered',
    'inquiry_only'
  ) then
    raise exception 'registration_workflow_status_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  perform 1
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track
    on track.task_id = task.id
  where track.id = p_track_id
    and task.type = 'registration'
  order by task.id
  for update of task;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
  for update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_workflow_status_access(
    v_track.id,
    v_workflow_status
  );

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'trackId', v_track.id,
    'workflowStatus', v_workflow_status,
    'expectedWorkflowRevision', p_expected_workflow_revision
  );
  select
    mutation.response_payload,
    mutation.task_id = v_track.task_id
      and mutation.mutation_type = 'set_workflow_status'
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
    v_response := v_response || pg_catalog.jsonb_build_object(
      'enrollmentFinalization',
      null
    );
    update dashboard_private.ops_registration_mutations mutation
    set response_payload = v_response
    where mutation.actor_id = v_actor_id
      and mutation.request_key = v_request_key
      and mutation.task_id = v_track.task_id
      and mutation.mutation_type = 'set_workflow_status';
    if not found then
      raise exception 'registration_workflow_receipt_missing' using errcode = '23514';
    end if;
    return v_response;
  end if;

  if v_track.workflow_revision <> p_expected_workflow_revision then
    raise exception 'registration_workflow_status_refresh_required'
      using errcode = '23514';
  end if;

  v_status_changed := v_track.workflow_status is distinct from v_workflow_status;
  if v_status_changed then
    v_previous_workflow_status := v_track.workflow_status;
    update public.ops_registration_subject_tracks track
    set workflow_status = v_workflow_status,
        workflow_revision = track.workflow_revision + 1,
        workflow_status_entered_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where track.id = v_track.id
    returning track.* into v_track;

    perform dashboard_private.write_registration_track_event_v2(
      v_track.task_id,
      v_track.id,
      'registration_workflow_status_changed',
      v_previous_workflow_status,
      v_workflow_status,
      'manual_status_change',
      pg_catalog.jsonb_build_object(
        'workflowStatus', v_workflow_status,
        'workflowRevision', v_track.workflow_revision
      ),
      'user',
      null
    );
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'trackId', v_track.id,
    'workflowStatus', v_track.workflow_status,
    'workflowRevision', v_track.workflow_revision,
    'workflowStatusEnteredAt', v_track.workflow_status_entered_at,
    'enrollmentFinalization', null
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
    'set_workflow_status',
    v_target_fingerprint,
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
  -- Optional information may stay blank. A supplied class remains a real FK.
  if (v_waiting_kind is not null and v_waiting_kind not in (
      'current_class', 'current_term_opening', 'next_term_opening'
    ))
    or (p_class_id is not null and v_waiting_kind is distinct from 'current_class')
    or (v_retake_decision is not null and v_retake_decision not in ('required', 'not_required'))
  then
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

commit;
