begin;

-- A withdrawal task represents the selected class/subject. Other live subjects
-- remain enrolled or waitlisted, and the student becomes withdrawn only after
-- the selected class was their final live roster or registration claim.
create or replace function dashboard_private.complete_ops_withdrawal_roster_transition_impl(
  p_task_id uuid,
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
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_withdrawal_details%rowtype;
  v_pre_student public.students%rowtype;
  v_student public.students%rowtype;
  v_class public.classes%rowtype;
  v_claim public.ops_registration_enrollments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_student_id uuid;
  v_source_class_id uuid;
  v_pre_parent_ids uuid[] := array[]::uuid[];
  v_current_parent_ids uuid[] := array[]::uuid[];
  v_affected_class_ids uuid[] := array[]::uuid[];
  v_released_enrollment_ids uuid[] := array[]::uuid[];
  v_canceled_waitlist_ids uuid[] := array[]::uuid[];
  v_recomputed_parent_ids uuid[] := array[]::uuid[];
  v_name_key text;
  v_parent_phone_key text;
  v_claim_id uuid;
  v_claim_count integer;
  v_parent_id uuid;
  v_remaining_live_roster_count integer := 0;
  v_next_student_status text;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  -- withdrawal_preliminary_source
  select task.student_id, task.class_id
  into v_student_id, v_source_class_id
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'withdrawal';
  if v_student_id is null or v_source_class_id is null then
    raise exception 'ops_withdrawal_management_link_required' using errcode = '22023';
  end if;
  select student.*
  into v_pre_student
  from public.students student
  where student.id = v_student_id;
  if not found then
    raise exception 'registration_student_not_found' using errcode = 'P0002';
  end if;
  select coalesce(
    pg_catalog.array_agg(distinct track.task_id order by track.task_id),
    array[]::uuid[]
  )
  into v_pre_parent_ids
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_source_class_id
    and enrollment.roster_active;

  -- verification_checkpoint_withdrawal_after_parent_snapshot
  perform dashboard_private.await_registration_verification_checkpoint(
    'withdrawal_after_parent_snapshot', p_task_id, v_student_id
  );

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentId', v_student_id,
    'sourceClassId', v_source_class_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- withdrawal_parent_task_locks
  perform 1
  from public.ops_tasks task
  where task.id = p_task_id
    or task.id = any(v_pre_parent_ids)
  order by task.id
  for update;
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'withdrawal';
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_withdrawal_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'ops_withdrawal_detail_required' using errcode = '23514';
  end if;

  -- withdrawal_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = any(v_pre_parent_ids)
  order by track.id
  for update;

  -- withdrawal_identity_lock
  v_name_key := pg_catalog.lower(
    pg_catalog.regexp_replace(coalesce(v_pre_student.name, ''), '\s+', '', 'g')
  );
  v_parent_phone_key := pg_catalog.regexp_replace(
    coalesce(v_pre_student.parent_contact, ''), '\D+', '', 'g'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-student:' || v_name_key || ':' || v_parent_phone_key,
      0
    )
  );

  -- withdrawal_student_lock
  select student.*
  into v_student
  from public.students student
  where student.id = v_student_id
  for update;
  if not found
    or v_task.student_id is distinct from v_student_id
    or v_task.class_id is distinct from v_source_class_id
    or pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
    ) is distinct from v_name_key
    or pg_catalog.regexp_replace(
      coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
    ) is distinct from v_parent_phone_key
  then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  -- withdrawal_parent_rescan
  select coalesce(
    pg_catalog.array_agg(distinct track.task_id order by track.task_id),
    array[]::uuid[]
  )
  into v_current_parent_ids
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_source_class_id
    and enrollment.roster_active;
  if v_current_parent_ids is distinct from v_pre_parent_ids then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  -- withdrawal_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = any(v_current_parent_ids)
  order by batch.id
  for update;

  -- withdrawal_claim_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_source_class_id
    and enrollment.roster_active
  order by enrollment.id
  for update;

  v_affected_class_ids := array[v_source_class_id];

  -- withdrawal_class_locks
  select class.*
  into v_class
  from public.classes class
  where class.id = v_source_class_id
  for update;
  if not found then
    raise exception 'registration_class_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'complete_withdrawal_roster_transition'
  );

  -- withdrawal_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'complete_withdrawal_roster_transition'
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

  -- withdrawal_mutable_state_check
  if v_task.status in ('done', 'canceled')
    or v_detail.timetable_roster_updated
  then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
  end if;
  if not v_detail.makeedu_withdrawal_done
    or not v_detail.fee_processed
    or not v_detail.textbook_fee_processed
  then
    raise exception 'ops_withdrawal_checklist_incomplete' using errcode = '40001';
  end if;
  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '40001';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  if not (coalesce(v_student.class_ids, '[]'::jsonb) ? v_source_class_id::text)
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_source_class_id::text
  then
    raise exception 'ops_withdrawal_source_roster_required' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    left join public.ops_registration_admission_batches batch
      on batch.id = enrollment.admission_batch_id
    where enrollment.student_id = v_student_id
      and enrollment.class_id = v_source_class_id
      and enrollment.roster_active
      and (
        enrollment.status = 'planned'
        or batch.status not in ('completed', 'canceled')
      )
  ) then
    raise exception 'registration_open_admission_batch' using errcode = '40001';
  end if;

  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_claim_count, v_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_source_class_id
    and enrollment.roster_active;
  if v_claim_count > 1 then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
  if v_claim_count = 1 then
    select enrollment.*
    into v_claim
    from public.ops_registration_enrollments enrollment
    where enrollment.id = v_claim_id;
    if v_claim.status <> 'enrolled' then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
  else
    v_claim_id := null;
  end if;

  -- verification_checkpoint_withdrawal_before_status_flip
  perform dashboard_private.await_registration_verification_checkpoint(
    'withdrawal_before_status_flip', p_task_id, v_student_id
  );

  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id,
    v_source_class_id,
    'removed',
    'enrolled',
    v_claim_id,
    'withdrawal_completed',
    v_actor_id
  );

  if v_claim_id is not null then
    update public.ops_registration_enrollments enrollment
    set
      status = 'enrolled',
      roster_active = false,
      roster_released_at = pg_catalog.now(),
      roster_release_reason = 'withdrawal_completed',
      roster_release_source_task_id = p_task_id,
      roster_release_kind = 'withdrawal',
      updated_at = pg_catalog.now()
    where enrollment.id = v_claim_id
      and enrollment.status = 'enrolled'
      and enrollment.roster_active;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
    v_released_enrollment_ids := pg_catalog.array_append(
      v_released_enrollment_ids, v_claim_id
    );
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = v_claim.track_id;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
    perform dashboard_private.write_registration_track_event(
      v_track.task_id,
      v_track.id,
      'registration_enrollment_roster_released',
      v_track.pipeline_status,
      v_track.pipeline_status,
      'withdrawal_completed',
      pg_catalog.jsonb_build_object(
        'enrollmentId', v_claim_id,
        'sourceTaskId', p_task_id,
        'releaseKind', 'withdrawal',
        'enrollmentSnapshot', pg_catalog.jsonb_build_object(
          'id', v_claim.id,
          'classId', v_claim.class_id,
          'textbookId', v_claim.textbook_id,
          'admissionBatchId', v_claim.admission_batch_id,
          'classStartDate', v_claim.class_start_date,
          'classStartSessionKey', v_claim.class_start_session_key,
          'classStartSession', v_claim.class_start_session,
          'status', v_claim.status,
          'sortOrder', v_claim.sort_order
        )
      )
    );
    v_recomputed_parent_ids := pg_catalog.array_append(
      v_recomputed_parent_ids, v_track.task_id
    );
  end if;

  select student.*
  into v_student
  from public.students student
  where student.id = v_student_id;
  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  v_remaining_live_roster_count :=
    pg_catalog.jsonb_array_length(coalesce(v_student.class_ids, '[]'::jsonb))
    + pg_catalog.jsonb_array_length(coalesce(v_student.waitlist_class_ids, '[]'::jsonb))
    + (
      select pg_catalog.count(*)::integer
      from public.ops_registration_enrollments enrollment
      where enrollment.student_id = v_student_id
        and enrollment.roster_active
    );
  v_next_student_status := case when v_remaining_live_roster_count = 0 then '퇴원' else '재원' end;

  if v_next_student_status = '퇴원' then
    update public.students
    set status = '퇴원'
    where id = v_student_id
      and status = '재원';
    if not found then
      raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
    end if;
  elsif v_student.status <> '재원' then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
  end if;

  update public.ops_withdrawal_details
  set
    timetable_roster_updated = true,
    updated_at = pg_catalog.now()
  where task_id = p_task_id
    and not timetable_roster_updated;
  if not found then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
  end if;
  update public.ops_tasks
  set
    status = 'done',
    completed_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where id = p_task_id
    and type = 'withdrawal'
    and status not in ('done', 'canceled');
  if not found then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values
    (p_task_id, v_actor_id, 'auto_checked', '시간표 명단 변경', '', '완료'),
    (
      p_task_id, v_actor_id, 'auto_synced', '수업명단', '',
      coalesce(v_class.name, v_task.class_name, v_source_class_id::text)
        || ' 제거 · withdrawal_completed'
    ),
    (
      p_task_id, v_actor_id, 'auto_synced', '학생 상태', '재원',
      v_next_student_status
    );

  select coalesce(
    pg_catalog.array_agg(distinct parent_id order by parent_id),
    array[]::uuid[]
  )
  into v_recomputed_parent_ids
  from pg_catalog.unnest(v_recomputed_parent_ids) parent_id;
  foreach v_parent_id in array v_recomputed_parent_ids
  loop
    perform dashboard_private.recompute_registration_parent(v_parent_id);
  end loop;

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentId', v_student_id,
    'sourceClassId', v_source_class_id,
    'affectedClassIds', pg_catalog.to_jsonb(v_affected_class_ids),
    'releasedEnrollmentIds', pg_catalog.to_jsonb(v_released_enrollment_ids),
    'canceledWaitlistEnrollmentIds', pg_catalog.to_jsonb(v_canceled_waitlist_ids),
    'studentStatus', v_next_student_status,
    'taskStatus', 'done',
    'timetableRosterUpdated', true
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id,
    'complete_withdrawal_roster_transition', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid, text)
  owner to postgres;
revoke all on function dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid, text)
  from public, anon, authenticated, service_role;

commit;
