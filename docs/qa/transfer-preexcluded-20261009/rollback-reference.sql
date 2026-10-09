-- Recovery only. Requires separately coordinated production authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $recovery$ begin
 if md5(pg_get_functiondef('dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)'::regprocedure))<>'a7de38de2c929326f7c934bded532530' then raise exception 'transfer_recovery_definition_drift' using errcode='55000';end if;
 execute $original$CREATE OR REPLACE FUNCTION dashboard_private.complete_ops_transfer_roster_transition_impl(p_task_id uuid, p_request_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_transfer_details%rowtype;
  v_pre_student public.students%rowtype;
  v_student public.students%rowtype;
  v_from_class public.classes%rowtype;
  v_to_class public.classes%rowtype;
  v_claim public.ops_registration_enrollments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_student_id uuid;
  v_from_class_id uuid;
  v_to_class_id uuid;
  v_pre_claim_id uuid;
  v_pre_claim_count integer;
  v_pre_track_id uuid;
  v_pre_parent_id uuid;
  v_current_claim_id uuid;
  v_current_claim_count integer;
  v_current_track_id uuid;
  v_current_parent_id uuid;
  v_parent_ids uuid[] := array[]::uuid[];
  v_class_ids uuid[] := array[]::uuid[];
  v_name_key text;
  v_parent_phone_key text;
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

  -- transfer_preliminary_source
  select task.student_id, detail.from_class_id, detail.to_class_id
  into v_student_id, v_from_class_id, v_to_class_id
  from public.ops_tasks task
  join public.ops_transfer_details detail on detail.task_id = task.id
  where task.id = p_task_id
    and task.type = 'transfer';
  if v_student_id is null or v_from_class_id is null or v_to_class_id is null then
    raise exception 'ops_transfer_management_link_required' using errcode = '22023';
  end if;
  if v_from_class_id = v_to_class_id then
    raise exception 'ops_transfer_classes_must_differ' using errcode = '22023';
  end if;
  select student.*
  into v_pre_student
  from public.students student
  where student.id = v_student_id;
  if not found then
    raise exception 'registration_student_not_found' using errcode = 'P0002';
  end if;
  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_pre_claim_count, v_pre_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_from_class_id
    and enrollment.roster_active;
  if v_pre_claim_count > 1 then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
  if v_pre_claim_count = 1 then
    select enrollment.track_id, track.task_id
    into v_pre_track_id, v_pre_parent_id
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.id = v_pre_claim_id;
    v_parent_ids := array[v_pre_parent_id]::uuid[];
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentId', v_student_id,
    'fromClassId', v_from_class_id,
    'toClassId', v_to_class_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- transfer_parent_task_locks
  perform 1
  from public.ops_tasks task
  where task.id = p_task_id
    or task.id = any(v_parent_ids)
  order by task.id
  for update;
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'transfer';
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_transfer_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'ops_transfer_detail_required' using errcode = '23514';
  end if;

  -- transfer_track_lock
  perform 1
  from public.ops_registration_subject_tracks track
  where track.id = v_pre_track_id
    and track.task_id = v_pre_parent_id
  order by track.id
  for update;

  -- transfer_identity_lock
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

  -- transfer_student_lock
  select student.*
  into v_student
  from public.students student
  where student.id = v_student_id
  for update;
  if not found
    or v_task.student_id is distinct from v_student_id
    or v_detail.from_class_id is distinct from v_from_class_id
    or v_detail.to_class_id is distinct from v_to_class_id
    or pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
    ) is distinct from v_name_key
    or pg_catalog.regexp_replace(
      coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
    ) is distinct from v_parent_phone_key
  then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  -- transfer_claim_rescan
  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_current_claim_count, v_current_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_from_class_id
    and enrollment.roster_active;
  if v_current_claim_count > 1 then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
  if v_current_claim_count = 1 then
    select enrollment.track_id, track.task_id
    into v_current_track_id, v_current_parent_id
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.id = v_current_claim_id;
  else
    v_current_claim_id := null;
    v_current_track_id := null;
    v_current_parent_id := null;
  end if;
  if v_current_claim_count is distinct from v_pre_claim_count
    or v_current_claim_id is distinct from v_pre_claim_id
    or v_current_track_id is distinct from v_pre_track_id
    or v_current_parent_id is distinct from v_pre_parent_id
  then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  -- transfer_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = any(v_parent_ids)
  order by batch.id
  for update;

  -- transfer_claim_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.roster_active
    and enrollment.class_id in (v_from_class_id, v_to_class_id)
  order by enrollment.id
  for update;

  -- transfer_claim_locked_rescan
  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_current_claim_count, v_current_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_from_class_id
    and enrollment.roster_active;
  if v_current_claim_count > 1 then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
  if v_current_claim_count = 1 then
    select enrollment.track_id, track.task_id
    into v_current_track_id, v_current_parent_id
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.id = v_current_claim_id;
  else
    v_current_claim_id := null;
    v_current_track_id := null;
    v_current_parent_id := null;
  end if;
  if v_current_claim_count is distinct from v_pre_claim_count
    or v_current_claim_id is distinct from v_pre_claim_id
    or v_current_track_id is distinct from v_pre_track_id
    or v_current_parent_id is distinct from v_pre_parent_id
  then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  select pg_catalog.array_agg(class_id order by class_id)
  into v_class_ids
  from (
    select v_from_class_id as class_id
    union
    select v_to_class_id as class_id
  ) affected;
  -- transfer_class_locks
  perform 1
  from public.classes class
  where class.id = any(v_class_ids)
  order by class.id
  for update;
  select class.* into v_from_class from public.classes class where class.id = v_from_class_id;
  select class.* into v_to_class from public.classes class where class.id = v_to_class_id;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'complete_transfer_roster_transition'
  );

  -- transfer_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'complete_transfer_roster_transition'
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

  -- transfer_mutable_state_check
  if v_task.status in ('done', 'canceled')
    or v_detail.timetable_roster_updated
  then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '40001';
  end if;
  if not v_detail.makeedu_transfer_done
    or not v_detail.fee_processed
    or not v_detail.textbook_fee_processed
  then
    raise exception 'ops_transfer_checklist_incomplete' using errcode = '40001';
  end if;
  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '40001';
  end if;
  if v_from_class.id is null or v_to_class.id is null then
    raise exception 'ops_transfer_class_not_found' using errcode = 'P0002';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_from_class.student_ids), '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_from_class.waitlist_ids), '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_to_class.student_ids), '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_to_class.waitlist_ids), '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  if not (coalesce(v_student.class_ids, '[]'::jsonb) ? v_from_class_id::text)
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_from_class_id::text
    or not (coalesce(pg_catalog.to_jsonb(v_from_class.student_ids), '[]'::jsonb) ? v_student_id::text)
    or coalesce(pg_catalog.to_jsonb(v_from_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text
  then
    raise exception 'registration_roster_mode_conflict' using errcode = '40001';
  end if;
  if coalesce(v_student.class_ids, '[]'::jsonb) ? v_to_class_id::text
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_to_class_id::text
    or coalesce(pg_catalog.to_jsonb(v_to_class.student_ids), '[]'::jsonb) ? v_student_id::text
    or coalesce(pg_catalog.to_jsonb(v_to_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text
  then
    raise exception 'registration_roster_mode_conflict' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = v_student_id
      and enrollment.class_id = v_to_class_id
      and enrollment.roster_active
  ) then
    raise exception 'registration_student_class_already_active' using errcode = '40001';
  end if;
  if v_current_claim_id is not null then
    select enrollment.*
    into v_claim
    from public.ops_registration_enrollments enrollment
    where enrollment.id = v_current_claim_id;
    if v_claim.status <> 'enrolled' then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = v_claim.track_id;
    if exists (
      select 1
      from public.ops_registration_admission_batches batch
      join public.ops_registration_enrollments enrollment
        on enrollment.admission_batch_id = batch.id
      where enrollment.track_id = v_claim.track_id
        and batch.status not in ('completed', 'canceled')
    ) then
      raise exception 'registration_open_admission_batch' using errcode = '40001';
    end if;
  end if;

  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id,
    v_from_class_id,
    'removed',
    'enrolled',
    v_current_claim_id,
    'transfer_from_class',
    v_actor_id
  );
  if v_current_claim_id is not null then
    update public.ops_registration_enrollments enrollment
    set
      status = 'enrolled',
      roster_active = false,
      roster_released_at = pg_catalog.now(),
      roster_release_reason = 'transfer_from_class',
      roster_release_source_task_id = p_task_id,
      roster_release_kind = 'transfer',
      updated_at = pg_catalog.now()
    where enrollment.id = v_current_claim_id
      and enrollment.status = 'enrolled'
      and enrollment.roster_active;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
  end if;
  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id,
    v_to_class_id,
    'enrolled',
    'removed',
    null,
    'transfer_to_class',
    v_actor_id
  );

  if v_current_claim_id is not null then
    perform dashboard_private.write_registration_track_event(
      v_track.task_id,
      v_track.id,
      'registration_enrollment_roster_released',
      v_track.pipeline_status,
      v_track.pipeline_status,
      'transfer_from_class',
      pg_catalog.jsonb_build_object(
        'enrollmentId', v_current_claim_id,
        'sourceTaskId', p_task_id,
        'releaseKind', 'transfer',
        'destinationClassId', v_to_class_id,
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
    perform dashboard_private.recompute_registration_parent(v_track.task_id);
  end if;

  update public.ops_transfer_details
  set
    timetable_roster_updated = true,
    updated_at = pg_catalog.now()
  where task_id = p_task_id
    and not timetable_roster_updated;
  if not found then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '40001';
  end if;
  update public.ops_tasks
  set
    status = 'done',
    completed_at = pg_catalog.now(),
    class_id = v_to_class_id,
    class_name = v_to_class.name,
    subject = v_to_class.subject,
    updated_at = pg_catalog.now()
  where id = p_task_id
    and type = 'transfer'
    and status not in ('done', 'canceled');
  if not found then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '40001';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values
    (p_task_id, v_actor_id, 'auto_checked', '시간표 명단 변경', '', '완료'),
    (
      p_task_id,
      v_actor_id,
      'auto_synced',
      '수업명단',
      coalesce(v_from_class.name, ''),
      coalesce(v_to_class.name, '') || ' 등록 · transfer_to_class'
    ),
    (p_task_id, v_actor_id, 'auto_synced', '학생 상태', '재원', '재원');

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentId', v_student_id,
    'fromClassId', v_from_class_id,
    'toClassId', v_to_class_id,
    'releasedEnrollmentId', v_current_claim_id,
    'studentStatus', '재원',
    'taskStatus', 'done',
    'timetableRosterUpdated', true
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id,
    'complete_transfer_roster_transition', v_target_fingerprint, v_response
  );
  return v_response;
end;
$function$

$original$;
end;$recovery$;
do $recovery$ begin
 if md5(pg_get_functiondef('dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks,text,uuid)'::regprocedure))<>'1cc5bbfb8f019ab8eadd57094972d229' then raise exception 'transfer_recovery_definition_drift' using errcode='55000';end if;
 execute $original$CREATE OR REPLACE FUNCTION dashboard_private.record_ops_transition_notification_source_v1(p_task ops_tasks, p_event_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := dashboard_private.assert_ops_task_actor_v2(p_task, null);
  v_source_event_id uuid;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_transfer public.ops_transfer_details%rowtype;
  v_withdrawal public.ops_withdrawal_details%rowtype;
  v_student public.students%rowtype;
  v_class public.classes%rowtype;
  v_teacher_name text;
  v_requester_name text;
  v_actor_name text;
  v_selected_subject text;
  v_selected_class text;
  v_requested_withdrawal_date date;
  v_requested_withdrawal_snapshot_status text;
  v_requested_withdrawal_round text;
  v_applied_withdrawal_date date;
  v_applied_withdrawal_round text;
  v_other_active_subjects jsonb;
  v_payload jsonb;
  v_recorded jsonb;
  v_existing_event_id uuid;
  v_existing_job_id uuid;
begin
  if p_request_id is null
    or p_task.type not in ('transfer', 'withdrawal')
    or p_event_key not in (
      'transfer.submitted', 'transfer.processing_started',
      'transfer.details_changed', 'transfer.completed',
      'transfer.canceled', 'transfer.reopened',
      'withdrawal.submitted', 'withdrawal.processing_started',
      'withdrawal.details_changed', 'withdrawal.completed',
      'withdrawal.canceled', 'withdrawal.reopened'
    )
    or pg_catalog.split_part(p_event_key, '.', 1) <> p_task.type
  then
    raise exception 'ops_transition_notification_event_invalid' using errcode = '22023';
  end if;

  select source.id into v_source_event_id
  from public.ops_task_events source
  where source.task_id = p_task.id
    and source.request_id = p_request_id
    and source.event_type = p_event_key;
  if found then
    select event_row.id, job.id
    into strict v_existing_event_id, v_existing_job_id
    from dashboard_private.notification_events event_row
    join dashboard_private.notification_event_fanout_jobs job
      on job.event_id = event_row.id
    where event_row.workflow_key = p_task.type
      and event_row.event_key = p_event_key
      and event_row.source_type = 'ops_task_event'
      and event_row.source_id = v_source_event_id::text
      and event_row.occurrence_key = v_source_event_id::text;
    return pg_catalog.jsonb_build_object(
      'sourceEventId', v_source_event_id,
      'notificationEventId', v_existing_event_id,
      'fanoutJobId', v_existing_job_id
    );
  end if;
  v_source_event_id := pg_catalog.gen_random_uuid();

  if p_task.type = 'transfer' then
    select detail.* into v_transfer
    from public.ops_transfer_details detail
    where detail.task_id = p_task.id;
    if not found then
      raise exception 'ops_transfer_detail_required' using errcode = '23514';
    end if;
    v_teacher_name := coalesce(nullif(v_transfer.from_teacher_name, ''), nullif(v_transfer.to_teacher_name, ''));
  else
    select detail.* into v_withdrawal
    from public.ops_withdrawal_details detail
    where detail.task_id = p_task.id;
    if not found then
      raise exception 'ops_withdrawal_detail_required' using errcode = '23514';
    end if;
    if p_task.student_id is null or p_task.class_id is null then
      raise exception 'ops_withdrawal_management_link_required' using errcode = '22023';
    end if;
    select class_row.* into v_class
    from public.classes class_row
    where class_row.id = p_task.class_id;
    if not found then
      raise exception 'registration_class_not_found' using errcode = 'P0002';
    end if;
    v_teacher_name := nullif(v_withdrawal.teacher_name, '');
    v_selected_subject := nullif(pg_catalog.btrim(v_class.subject), '');
    v_selected_class := coalesce(
      nullif(pg_catalog.btrim(v_class.name), ''),
      nullif(pg_catalog.btrim(p_task.class_name), '')
    );
    if v_selected_subject not in ('영어', '수학', '과학') or v_selected_class is null then
      raise exception 'ops_withdrawal_subject_snapshot_invalid' using errcode = '23514';
    end if;

    v_requested_withdrawal_date := v_withdrawal.withdrawal_date;
    v_requested_withdrawal_round := nullif(pg_catalog.btrim(v_withdrawal.withdrawal_session), '');

    if p_event_key = 'withdrawal.completed' then
      select
        nullif(coalesce(
          source.payload ->> 'requested_withdrawal_date',
          source.payload ->> 'withdrawal_date'
        ), '')::date,
        nullif(pg_catalog.btrim(coalesce(
          source.payload ->> 'requested_withdrawal_round',
          source.payload ->> 'withdrawal_round'
        )), '')
      into v_requested_withdrawal_date, v_requested_withdrawal_round
      from public.ops_task_events source
      where source.task_id = p_task.id
        and source.event_type = 'withdrawal.submitted'
      order by source.created_at, source.id
      limit 1;
      v_requested_withdrawal_snapshot_status := case
        when not found then 'missing'
        when v_requested_withdrawal_date is null
          or v_requested_withdrawal_round is null then 'incomplete'
        else 'complete'
      end;
      v_applied_withdrawal_date := v_withdrawal.withdrawal_date;
      v_applied_withdrawal_round := nullif(pg_catalog.btrim(v_withdrawal.withdrawal_session), '');
      if v_applied_withdrawal_date is null or v_applied_withdrawal_round is null then
        raise exception 'ops_withdrawal_applied_snapshot_required' using errcode = '23514';
      end if;

      select student.* into v_student
      from public.students student
      where student.id = p_task.student_id;
      if not found then
        raise exception 'registration_student_not_found' using errcode = 'P0002';
      end if;
      if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
      then
        raise exception 'registration_roster_projection_invalid' using errcode = '23514';
      end if;

      select coalesce(
        pg_catalog.jsonb_agg(remaining.subject order by remaining.subject_sort),
        '[]'::jsonb
      )
      into v_other_active_subjects
      from (
        select distinct
          pg_catalog.btrim(class_row.subject) as subject,
          case pg_catalog.btrim(class_row.subject)
            when '영어' then 1
            when '수학' then 2
            when '과학' then 3
          end as subject_sort
        from public.classes class_row
        where class_row.id <> p_task.class_id
          and pg_catalog.btrim(class_row.subject) in ('영어', '수학', '과학')
          and pg_catalog.btrim(class_row.subject) <> v_selected_subject
          and (
            coalesce(v_student.class_ids, '[]'::jsonb) ? class_row.id::text
            or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? class_row.id::text
            or exists (
              select 1
              from public.ops_registration_enrollments enrollment
              where enrollment.student_id = p_task.student_id
                and enrollment.class_id = class_row.id
                and enrollment.roster_active
            )
          )
      ) remaining;
    end if;
  end if;

  select nullif(pg_catalog.btrim(profile.name), '')
  into v_requester_name
  from public.profiles profile
  where profile.id = p_task.requested_by;

  select nullif(pg_catalog.btrim(profile.name), '')
  into v_actor_name
  from public.profiles profile
  where profile.id = v_actor;

  v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task_id', p_task.id,
    'notification_subjects', dashboard_private.ops_subject_notification_subjects_v1(p_task.id),
    'student_name', p_task.student_name,
    'grade', case when p_task.type = 'withdrawal' then v_withdrawal.school_grade else '' end,
    'inquiry_at', '',
    'registration_checked', '',
    'task_status', p_task.status,
    'status', p_task.status,
    'requester_name', v_requester_name,
    'teacher_name', v_teacher_name,
    'before_class', case when p_task.type = 'transfer' then v_transfer.from_class_name end,
    'after_class', case when p_task.type = 'transfer' then v_transfer.to_class_name end,
    'requested_effective_date', case when p_task.type = 'transfer' then v_transfer.to_class_start_date end,
    'before_class_end_date', case when p_task.type = 'transfer' then v_transfer.from_class_end_date end,
    'after_class_start_date', case when p_task.type = 'transfer' then v_transfer.to_class_start_date end,
    'before_end_date', case when p_task.type = 'transfer' then v_transfer.from_class_end_date end,
    'after_start_date', case when p_task.type = 'transfer' then v_transfer.to_class_start_date end,
    'subjects', case when p_task.type = 'withdrawal' then v_selected_subject end,
    'selected_subject', case when p_task.type = 'withdrawal' then v_selected_subject end,
    'selected_class', case when p_task.type = 'withdrawal' then v_selected_class end,
    'requested_withdrawal_snapshot_status', v_requested_withdrawal_snapshot_status,
    'requested_withdrawal_date', case when p_task.type = 'withdrawal' then v_requested_withdrawal_date end,
    'requested_withdrawal_round', case when p_task.type = 'withdrawal' then v_requested_withdrawal_round end,
    'applied_withdrawal_date', case when p_event_key = 'withdrawal.completed' then v_applied_withdrawal_date end,
    'applied_withdrawal_round', case when p_event_key = 'withdrawal.completed' then v_applied_withdrawal_round end,
    'other_active_subjects', case when p_event_key = 'withdrawal.completed' then v_other_active_subjects end,
    'actor_name', v_actor_name,
    'reason', case
      when p_task.type = 'transfer' then v_transfer.transfer_reason
      else v_withdrawal.customer_reason
    end,
    'memo', p_task.memo,
    'class_name', case
      when p_task.type = 'withdrawal' then v_selected_class
      else coalesce(v_transfer.to_class_name, p_task.class_name)
    end,
    'withdrawal_date', case when p_task.type = 'withdrawal' then v_withdrawal.withdrawal_date end,
    'withdrawal_round', case when p_task.type = 'withdrawal' then v_withdrawal.withdrawal_session end,
    'requester_profile_id', p_task.requested_by,
    'management_profile_ids', pg_catalog.to_jsonb(dashboard_private.ops_task_management_profile_ids_v2()),
    'source_event_id', v_source_event_id,
    'occurred_at', v_occurred_at
  ));

  if p_event_key in ('transfer.canceled', 'transfer.reopened', 'withdrawal.canceled', 'withdrawal.reopened') then
    with canceled as (
      update dashboard_private.notification_deliveries delivery
      set status = 'canceled',
          status_reason = 'source_status_changed',
          next_attempt_at = null,
          claimed_by = null,
          claim_token = null,
          lease_expires_at = null,
          resolved_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      from dashboard_private.notification_events event_row
      where delivery.event_id = event_row.id
        and event_row.workflow_key = p_task.type
        and event_row.payload ->> 'task_id' = p_task.id::text
        and delivery.status in ('pending', 'retry_wait')
      returning delivery.id
    )
    update dashboard_private.notification_deliveries delivery
    set cancel_requested_at = coalesce(
          delivery.cancel_requested_at,
          pg_catalog.clock_timestamp()
        ),
        cancel_reason = 'source_status_changed',
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = p_task.type
      and event_row.payload ->> 'task_id' = p_task.id::text
      and delivery.status = 'claimed';
  end if;

  insert into public.ops_task_events(
    id, task_id, actor_id, event_type, field_name,
    before_value, after_value, request_id, payload, created_at
  ) values (
    v_source_event_id, p_task.id, v_actor, p_event_key,
    case when p_event_key like '%.details_changed' then 'details' else 'status' end,
    null, p_task.status, p_request_id, v_payload, v_occurred_at
  );

  v_recorded := dashboard_private.record_notification_event_v1(
    'global',
    p_task.type,
    p_event_key,
    'ops_task_event',
    v_source_event_id::text,
    null,
    v_source_event_id::text,
    v_actor,
    v_occurred_at,
    1,
    v_payload,
    null,
    null
  );

  return pg_catalog.jsonb_build_object(
    'sourceEventId', v_source_event_id,
    'notificationEventId', v_recorded ->> 'event_id',
    'fanoutJobId', v_recorded ->> 'fanout_job_id'
  );
end;
$function$

$original$;
end;$recovery$;
commit;
