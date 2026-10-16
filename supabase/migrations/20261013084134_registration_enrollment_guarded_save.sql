begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Source draft only. The guarded browser save preserves existing fact/history
-- and roster boundaries, and advances only a complete editable enrollment plan.
create function dashboard_private.registration_enrollment_save_snapshot_v2(p_track_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when exists (
    select 1 from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and (enrollment.admission_batch_id is not null or enrollment.roster_active)
  ) then dashboard_private.normalize_registration_enrollment_rows_request_v1(
    coalesce(track.enrollment_detail_rows, '[]'::jsonb)
  ) else dashboard_private.normalize_registration_enrollment_rows_request_v1(coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', enrollment.id,
      'classId', enrollment.class_id,
      'textbookId', enrollment.textbook_id,
      'textbookIds', pg_catalog.to_jsonb(coalesce(enrollment.textbook_ids,
        pg_catalog.array_remove(array[enrollment.textbook_id], null))),
      'classStartDate', enrollment.class_start_date,
      'classStartSessionKey', enrollment.class_start_session_key,
      'classStartLessonSessionId', enrollment.class_start_lesson_session_id,
      'classStartSession', enrollment.class_start_session,
      'classStartSourceObservationId', enrollment.class_start_source_observation_id,
      'sortOrder', enrollment.sort_order
    ) order by enrollment.class_id, enrollment.id)
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and enrollment.student_id is null
      and not enrollment.roster_active
      and enrollment.roster_released_at is null
      and enrollment.roster_release_reason is null
      and enrollment.roster_release_source_task_id is null
      and enrollment.roster_release_kind is null
  ), '[]'::jsonb)) end
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
$$;

alter function dashboard_private.registration_enrollment_save_snapshot_v2(uuid) owner to postgres;
revoke all on function dashboard_private.registration_enrollment_save_snapshot_v2(uuid)
  from public, anon, authenticated, service_role;

create function dashboard_private.save_registration_enrollment_details_guarded_v2_impl(
  p_track_id uuid,
  p_rows jsonb,
  p_expected_rows jsonb,
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
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_rows jsonb;
  v_expected_rows jsonb;
  v_saved_rows jsonb;
  v_externalized boolean;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
  v_status_changed boolean := false;
  v_previous_status text;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  if p_track_id is null or v_request_key is null
    or p_expected_workflow_revision is null or p_expected_workflow_revision < 1
    or p_expected_rows is null
  then
    raise exception 'registration_enrollment_details_invalid' using errcode = '22023';
  end if;
  v_rows := dashboard_private.normalize_registration_enrollment_rows_request_v1(p_rows);
  v_expected_rows := dashboard_private.normalize_registration_enrollment_rows_request_v1(p_expected_rows);

  select track.task_id into v_task_id
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task on task.id = track.task_id and task.type = 'registration'
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_mutation_access(v_task_id, p_track_id, 'save_enrollment_rows');

  -- Serialize task writes/archive while permitting audit FK KEY SHARE. Legacy
  -- director edits hold the track before inserting their task-linked audit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );
  perform 1 from public.ops_tasks task
  where task.id = v_task_id and task.type = 'registration'
  for no key update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  select track.* into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  -- Recheck under locks: an archive or account change cannot authorize replay.
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor_id);
  perform dashboard_private.assert_registration_mutation_access(v_task_id, p_track_id, 'save_enrollment_rows');

  v_fingerprint := pg_catalog.jsonb_build_object(
    'trackId', p_track_id, 'rows', v_rows,
    'expectedRows', v_expected_rows,
    'expectedWorkflowRevision', p_expected_workflow_revision
  );
  select mutation.task_id, mutation.mutation_type, mutation.target_fingerprint,
    mutation.response_payload
  into v_saved_task_id, v_saved_type, v_saved_fingerprint, v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from v_task_id
      or v_saved_type is distinct from 'save_registration_enrollment_details_guarded_v2'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'registration_mutation_request_conflict' using errcode = '22023';
    end if;
    return v_response;
  end if;

  perform 1 from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
  order by enrollment.id for update;
  if v_track.workflow_revision is distinct from p_expected_workflow_revision
    or dashboard_private.registration_enrollment_save_snapshot_v2(p_track_id)
      is distinct from v_expected_rows
  then
    raise exception 'registration_enrollment_details_refresh_required' using errcode = '23514';
  end if;

  select exists (
    select 1 from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and (enrollment.admission_batch_id is not null or enrollment.roster_active)
  ) into v_externalized;
  if v_externalized then
    -- Reconciliation remains a fact-only correction; never touch students,
    -- roster arrays, admission batches, or historical enrollment ownership.
    v_saved_rows := v_rows;
    perform dashboard_private.record_registration_fact_audit_v1(
      v_task_id, p_track_id, 'enrollment_details_external_correction',
      pg_catalog.jsonb_build_object('rows', v_saved_rows)
    );
  else
    v_response := dashboard_private.save_registration_enrollment_rows_canonical_v1(
      p_track_id, v_rows, v_actor_id
    );
    -- Strip response-only ownership metadata before storing a request snapshot.
    select dashboard_private.normalize_registration_enrollment_rows_request_v1(coalesce(
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', row_item.value -> 'id', 'classId', row_item.value -> 'classId',
        'textbookId', row_item.value -> 'textbookId',
        'textbookIds', row_item.value -> 'textbookIds',
        'classStartDate', row_item.value -> 'classStartDate',
        'classStartSessionKey', row_item.value -> 'classStartSessionKey',
        'classStartLessonSessionId', row_item.value -> 'classStartLessonSessionId',
        'classStartSession', row_item.value -> 'classStartSession',
        'classStartSourceObservationId', row_item.value -> 'classStartSourceObservationId',
        'sortOrder', row_item.value -> 'sortOrder'
      )), '[]'::jsonb
    )) into v_saved_rows
    from pg_catalog.jsonb_array_elements(v_response -> 'rows') row_item(value);
  end if;

  update public.ops_registration_subject_tracks track
  set enrollment_detail_rows = v_saved_rows, updated_at = pg_catalog.now()
  where track.id = p_track_id;

  if not v_externalized and not v_track.migration_review_required
    and pg_catalog.jsonb_array_length(v_saved_rows) > 0
    and v_track.workflow_status in (
      'inquiry', 'level_test_requested', 'consultation_requested', 'consultation_completed',
      'waiting_current_class', 'waiting_new_class', 'waiting_next_opening',
      'observation_requested', 'observation_feedback_pending', 'observation_completed'
    )
    and not exists (
      select 1 from pg_catalog.jsonb_array_elements(v_saved_rows) row_item(value)
      where nullif(row_item.value ->> 'classStartDate', '') is null
        or nullif(row_item.value ->> 'classStartSessionKey', '') is null
        or nullif(row_item.value ->> 'classStartSession', '') is null
    )
  then
    v_previous_status := v_track.workflow_status;
    update public.ops_registration_subject_tracks track
    set workflow_status = 'enrollment_requested',
        observation_return_workflow_status = null,
        workflow_revision = track.workflow_revision + 1,
        workflow_status_entered_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where track.id = p_track_id returning track.* into v_track;
    v_status_changed := true;
    perform dashboard_private.write_registration_track_event_v2(
      v_task_id, p_track_id, 'registration_workflow_status_changed',
      v_previous_status, 'enrollment_requested', 'enrollment_details_saved',
      pg_catalog.jsonb_build_object('workflowStatus', 'enrollment_requested',
        'workflowRevision', v_track.workflow_revision), 'user', null
    );
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'trackId', p_track_id, 'rows', v_saved_rows,
    'externalReconciliationRequired', v_externalized,
    'workflowStatus', v_track.workflow_status,
    'workflowRevision', v_track.workflow_revision,
    'workflowStatusEnteredAt', v_track.workflow_status_entered_at,
    'statusChanged', v_status_changed
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id,
    'save_registration_enrollment_details_guarded_v2', v_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.save_registration_enrollment_details_guarded_v2_impl(
  uuid, jsonb, jsonb, integer, text
) owner to postgres;
revoke all on function dashboard_private.save_registration_enrollment_details_guarded_v2_impl(
  uuid, jsonb, jsonb, integer, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_enrollment_details_guarded_v2_impl(
  uuid, jsonb, jsonb, integer, text
) to authenticated;

create function public.save_registration_enrollment_details_guarded_v2(
  p_track_id uuid, p_rows jsonb, p_expected_rows jsonb,
  p_expected_workflow_revision integer, p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.save_registration_enrollment_details_guarded_v2_impl(
    p_track_id, p_rows, p_expected_rows, p_expected_workflow_revision, p_request_key
  );
$$;

alter function public.save_registration_enrollment_details_guarded_v2(
  uuid, jsonb, jsonb, integer, text
) owner to postgres;
revoke all on function public.save_registration_enrollment_details_guarded_v2(
  uuid, jsonb, jsonb, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_registration_enrollment_details_guarded_v2(
  uuid, jsonb, jsonb, integer, text
) to authenticated;

-- Align compatibility writers with the new task-before-track lock order.
-- Old clients keep their fact-only behavior and original receipt fingerprints.
do $registration_enrollment_lock_order$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)'::regprocedure
  );
  v_old := $old$  select track.id, track.task_id
  into v_track$old$;
  v_new := $new$  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );
  perform 1 from public.ops_tasks task
  join public.ops_registration_subject_tracks track on track.task_id = task.id
  where track.id = p_track_id and task.type = 'registration'
  for no key update of task;

  select track.id, track.task_id
  into v_track$new$;
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    <> pg_catalog.length(v_old) then
    raise exception 'registration_enrollment_details_lock_order_drift' using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  v_old := $old$  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );
  select
    mutation.task_id,$old$;
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    <> pg_catalog.length(v_old) then
    raise exception 'registration_enrollment_details_receipt_lock_drift' using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, $new$  select
    mutation.task_id,$new$);
  execute v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.save_registration_enrollment_rows(uuid,jsonb,text)'::regprocedure
  );
  v_old := $old$  select
    mutation.task_id,$old$;
  v_new := $new$  perform 1 from public.ops_tasks task
  where task.id = v_task_id and task.type = 'registration'
  for no key update;
  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'save_enrollment_rows'
  );

  select
    mutation.task_id,$new$;
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    <> pg_catalog.length(v_old) then
    raise exception 'registration_enrollment_rows_lock_order_drift' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$registration_enrollment_lock_order$;

-- Retain the exact final setter, including registered completion-event handling.
-- A requested observation stage requires a durable selected-session booking;
-- completed/feedback stages remain historical states, not selectable targets.
do $registration_observation_requested_status$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::regprocedure
  );
  v_old := $old$    'consultation_completed',
    'waiting_current_class',$old$;
  v_new := $new$    'consultation_completed',
    'observation_requested',
    'waiting_current_class',$new$;
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    <> pg_catalog.length(v_old) then
    raise exception 'registration_observation_status_targets_drift' using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  v_old := $old$  v_status_changed := v_track.workflow_status is distinct from v_workflow_status;$old$;
  v_new := $new$  if v_workflow_status = 'observation_requested' and not exists (
    select 1 from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
     and appointment.task_id = v_track.task_id
     and appointment.kind = 'observation_class'
     and appointment.status = 'scheduled'
    where observation.task_id = v_track.task_id and observation.track_id = v_track.id
      and observation.status = 'scheduled'
      and observation.decision_kind is null
      and observation.session_date is not null
      and ((observation.session_authority = 'normalized' and observation.class_lesson_session_id is not null)
        or (observation.session_authority = 'legacy' and nullif(pg_catalog.btrim(observation.legacy_session_key), '') is not null))
  ) then
    raise exception 'registration_observation_booking_required' using errcode = '23514';
  end if;

  v_status_changed := v_track.workflow_status is distinct from v_workflow_status;$new$;
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    <> pg_catalog.length(v_old) then
    raise exception 'registration_observation_status_guard_drift' using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  v_old := $old$    set workflow_status = v_workflow_status,
        workflow_revision = track.workflow_revision + 1,$old$;
  v_new := $new$    set workflow_status = v_workflow_status,
        observation_return_workflow_status = case
          when v_workflow_status = 'observation_requested' then coalesce(
            track.observation_return_workflow_status,
            case when track.workflow_status in ('consultation_completed', 'waiting_current_class',
              'waiting_new_class', 'waiting_next_opening') then track.workflow_status
              else 'consultation_completed' end
          ) else null end,
        workflow_revision = track.workflow_revision + 1,$new$;
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    <> pg_catalog.length(v_old) then
    raise exception 'registration_observation_status_pair_drift' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$registration_observation_requested_status$;

notify pgrst, 'reload schema';
commit;
