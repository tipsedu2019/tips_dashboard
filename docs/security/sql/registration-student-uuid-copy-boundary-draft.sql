-- UUID IDENTITY REVIEW DRAFT; SOURCE ONLY, NOT INSTALLABLE, NOT A MIGRATION.
-- Source candidate: 667102f7d5d491096976a621eaf7973970320677 (privacy candidate + main 4a2cda49).
-- Transfer preimage includes exact PR126 20261009065550 dynamic source patches;
-- requested/applied notification snapshots remain in their separate, untouched producer.
-- PostgreSQL install/runtime/SQLSTATE/rollback/concurrency tests: 0 (auto-review blocked).
-- Metadata-only installer: no historical DML/backfill, grants/RLS/roles/secrets,
-- provider send, cron change, existing migration edits or workflow-status caller edits.
-- Require audit/link -> lifecycle/explicit UUID binder -> identity -> provider gates
-- integration review. This file does not create a binder, student or contact gate.
-- Explicit UUID binding is independent of name/phone/display uid/MakeEdu URL.
-- Missing binding blocks actual enrollment/waiting; it never extends contact retention.
-- Exact actor/key/target receipt replay precedes new UUID prerequisites on batch APIs.
-- Existing task/track/batch/claim/class/queue ordering and finance/last-lesson behavior
-- are retained; typed UUID/created_at rescans replace name/phone student rescans.
-- created_at is NOT an immutable cryptographic identity pin; PK reuse/NULL epochs
-- and other concurrent writers remain required integration/runtime review cases.
-- Legacy admin migration-review and direct Data API student writes remain outside
-- this patch; no blanket privacy protection or old-copy erasure is claimed.
-- Other-thread withdrawal/transfer release candidate is unknown: reconcile exact
-- sources before installing, never overlay another owner's worktree/accepted SQL.
-- One-shot source guards reject drift/replay with 55000; CLI ledger still required.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

do $registration_uuid_identity_install$
declare
  v_spec record;
  v_target pg_catalog.regprocedure;
  v_before pg_catalog.pg_proc%rowtype;
  v_after pg_catalog.pg_proc%rowtype;
  v_definition text;
begin
  for v_spec in
    select * from (values
      ('dashboard_private.apply_registration_current_class_wait(uuid,uuid,uuid,uuid)', '299cd7dc6acbaab2ed2e8a6651bed75ef05f5d0f634c49a0cdbdcc58f7432235', '4fccb90f49472c361368a0d1a46b86c8a71b9b090045f0a9ddabf2110178654e', $uuid_identity_body_1$
declare
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_student public.students%rowtype;
  v_student_id uuid;
  v_class_subject text;
  v_enrollment_id uuid;
begin
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- Waiting roster changes require an explicit persisted UUID.
  if v_task.student_id is null then
    raise exception 'registration_student_uuid_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student-id:' || v_task.student_id::text, 0)
  );

  select student.*
  into v_student
  from public.students student
  where student.id = v_task.student_id
  for update;
  if not found then
    raise exception 'registration_student_not_found' using errcode = 'P0002';
  end if;
  v_student_id := v_student.id;

  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '23514';
  end if;

  perform 1
  from public.ops_registration_enrollments enrollment
  where (
      enrollment.track_id = p_track_id
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
    ) or (
      enrollment.student_id = v_student_id
      and enrollment.class_id = p_class_id
      and enrollment.roster_active
    )
  order by enrollment.id
  for update;

  select pg_catalog.btrim(class.subject)
  into v_class_subject
  from public.classes class
  where class.id = p_class_id
  for update;
  if not found then
    raise exception 'registration_class_not_found' using errcode = 'P0002';
  end if;
  if v_class_subject is distinct from v_track.subject then
    raise exception 'registration_class_subject_mismatch' using errcode = '23514';
  end if;

  select enrollment.id
  into v_enrollment_id
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    and enrollment.status = 'waitlisted'
    and enrollment.roster_active
  for update;

  if found then
    if not exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.id = v_enrollment_id
        and enrollment.student_id = v_student_id
        and enrollment.class_id = p_class_id
    ) then
      raise exception 'registration_student_class_already_active' using errcode = '23514';
    end if;
    perform dashboard_private.apply_student_class_roster_mode(
      v_student_id, p_class_id, 'waitlist', 'waitlist', v_enrollment_id,
      'registration_current_class_wait', p_actor_id
    );
    return;
  end if;

  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = v_student_id
      and enrollment.class_id = p_class_id
      and enrollment.roster_active
  ) then
    raise exception 'registration_student_class_already_active' using errcode = '23514';
  end if;

  -- verification_checkpoint_current_class_wait_before_materialization
  perform dashboard_private.await_registration_verification_checkpoint(
    'current_class_wait_before_materialization', p_task_id, v_student_id
  );

  insert into public.ops_registration_enrollments(
    track_id, student_id, class_id, status, roster_active, sort_order
  ) values (
    p_track_id, v_student_id, p_class_id, 'waitlisted', true, 0
  ) returning id into v_enrollment_id;

  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id, p_class_id, 'waitlist', 'removed', v_enrollment_id,
    'registration_current_class_wait', p_actor_id
  );
end;
$uuid_identity_body_1$),
      ('dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)', '4de8f879bc806c4f004a39830857a4c2243b0f54d2aac194e63660fa2b8c5c8a', 'd51aca568ed13ec6b50d43264554bdaefce09d3db69deac268fc33e087d6ce69', $uuid_identity_body_2$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_track_ids uuid[];
  v_enrollment_ids uuid[];
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_student public.students%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_class record;
  v_session jsonb;
  v_student_id uuid;
  v_track_id uuid;
  v_selected_count integer;
  v_revision_number integer;
  v_batch_id uuid;
  v_source_status text;
  v_unique_constraint text;
  v_rows_response jsonb;
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
  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_track_ids, array[]::uuid[])) track_id
    where track_id is null
  ) or exists (
    select 1
    from pg_catalog.unnest(coalesce(p_enrollment_ids, array[]::uuid[])) enrollment_id
    where enrollment_id is null
  ) then
    raise exception 'registration_admission_batch_selection_invalid' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct track_id order by track_id),
    array[]::uuid[]
  )
  into v_track_ids
  from pg_catalog.unnest(coalesce(p_track_ids, array[]::uuid[])) track_id;
  select coalesce(
    pg_catalog.array_agg(distinct enrollment_id order by enrollment_id),
    array[]::uuid[]
  )
  into v_enrollment_ids
  from pg_catalog.unnest(coalesce(p_enrollment_ids, array[]::uuid[])) enrollment_id;
  if pg_catalog.cardinality(v_track_ids) = 0
    or pg_catalog.cardinality(v_enrollment_ids) = 0
  then
    raise exception 'registration_admission_batch_selection_required' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'enrollmentIds', pg_catalog.to_jsonb(v_enrollment_ids)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_batch_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_batch_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_batch_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'start_admission_batch'
  );

  -- admission_batch_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'start_admission_batch'
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

  -- admission_batch_identity_lock
  if v_task.student_id is null then
    raise exception 'registration_student_uuid_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student-id:' || v_task.student_id::text, 0)
  );

  -- admission_batch_student_locks
  select student.*
  into v_student
  from public.students student
  where student.id = v_task.student_id
  for update;
  if not found then
    raise exception 'registration_student_not_found' using errcode = 'P0002';
  end if;
  v_student_id := v_student.id;

  -- admission_batch_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = p_task_id
  order by batch.id
  for update;

  -- admission_batch_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = p_task_id
    or enrollment.id = any(v_enrollment_ids)
  order by enrollment.id
  for update of enrollment;

  -- admission_batch_class_locks
  perform 1
  from public.classes class
  where class.id in (
    select enrollment.class_id
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
  )
  order by class.id
  for update;

  -- admission_batch_textbook_locks
  perform 1
  from public.textbooks textbook
  where textbook.id in (
    select enrollment.textbook_id
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
      and enrollment.textbook_id is not null
  )
  order by textbook.id
  for update;

  -- admission_batch_mutable_state_check
  -- Admission batch creation is independent from optional admission-form delivery.
  if exists (
    select 1
    from public.ops_registration_admission_batches batch
    where batch.task_id = p_task_id
      and batch.status not in ('completed', 'canceled')
  ) then
    raise exception 'registration_admission_batch_already_open' using errcode = '23514';
  end if;
  if (
    select pg_catalog.count(*)
    from public.ops_registration_subject_tracks track
    where track.id = any(v_track_ids)
      and track.task_id = p_task_id
  ) <> pg_catalog.cardinality(v_track_ids) then
    raise exception 'registration_admission_batch_track_invalid' using errcode = '22023';
  end if;
  -- Manual workflow state is independent. The selected canonical planned rows
  -- below are the admission batch integrity boundary.

  select pg_catalog.count(*)
  into v_selected_count
  from public.ops_registration_enrollments enrollment
  where enrollment.id = any(v_enrollment_ids);
  if v_selected_count <> pg_catalog.cardinality(v_enrollment_ids) then
    raise exception 'registration_admission_batch_enrollment_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
      and (
        enrollment.track_id <> all(v_track_ids)
        or enrollment.status <> 'planned'
        or enrollment.admission_batch_id is not null
        or enrollment.student_id is not null
        or enrollment.roster_active
        or enrollment.roster_released_at is not null
        or enrollment.roster_release_reason is not null
        or enrollment.roster_release_source_task_id is not null
        or enrollment.roster_release_kind is not null
      )
  ) then
    raise exception 'registration_admission_batch_enrollment_invalid' using errcode = '23514';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(v_track_ids) selected(track_id)
    left join public.ops_registration_enrollments enrollment
      on enrollment.track_id = selected.track_id
      and enrollment.id = any(v_enrollment_ids)
    group by selected.track_id
    having pg_catalog.count(enrollment.id) < 1
  ) then
    raise exception 'registration_admission_batch_track_coverage_required' using errcode = '22023';
  end if;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
    order by enrollment.id
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = v_enrollment.track_id;

    select
      class.id,
      pg_catalog.btrim(class.subject) as subject,
      class.textbook_ids,
      class.student_ids,
      class.waitlist_ids
    into v_class
    from public.classes class
    where class.id = v_enrollment.class_id;
    if not found then
      raise exception 'registration_class_not_found' using errcode = 'P0002';
    end if;
    if v_class.subject is distinct from v_track.subject then
      raise exception 'registration_class_subject_mismatch' using errcode = '23514';
    end if;
    if v_enrollment.textbook_id is not null and not (
      exists (
        select 1
        from public.textbooks textbook
        where textbook.id = v_enrollment.textbook_id
      )
      and pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb)
      ) = 'array'
      and coalesce(
        pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb
      ) ? v_enrollment.textbook_id::text
    ) then
      raise exception 'registration_textbook_class_mismatch' using errcode = '23514';
    end if;
    if v_enrollment.class_start_date is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session_key), '') is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session), '') is null
    then
      raise exception 'registration_enrollment_schedule_incomplete' using errcode = '23514';
    end if;
    v_session := dashboard_private.validate_registration_class_session(
      v_enrollment.class_id,
      v_enrollment.class_start_date,
      v_enrollment.class_start_session_key
    );
    if coalesce((v_session ->> 'valid')::boolean, false) is not true
      or (v_session ->> 'sessionDate')::date is distinct from v_enrollment.class_start_date
      or v_session ->> 'sessionKey' is distinct from v_enrollment.class_start_session_key
      or v_session ->> 'sessionLabel' is distinct from v_enrollment.class_start_session
    then
      raise exception 'registration_class_session_invalid' using errcode = '23514';
    end if;
  end loop;

  -- UUID was resolved under the student row lock above; never infer/create here.
  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '23514';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
    order by enrollment.id
  loop
    select class.student_ids, class.waitlist_ids
    into v_class
    from public.classes class
    where class.id = v_enrollment.class_id;
    if pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb)
      ) <> 'array'
      or pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb)
      ) <> 'array'
    then
      raise exception 'registration_roster_projection_invalid' using errcode = '23514';
    end if;
    if coalesce(v_student.class_ids, '[]'::jsonb) ? v_enrollment.class_id::text
      or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_enrollment.class_id::text
      or coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb) ? v_student_id::text
      or coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text
    then
      raise exception 'registration_roster_mode_conflict' using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.student_id = v_student_id
        and enrollment.class_id = v_enrollment.class_id
        and enrollment.roster_active
    ) then
      raise exception 'registration_student_class_already_active' using errcode = '23514';
    end if;
  end loop;

  select coalesce(max(batch.revision_number), 0) + 1
  into v_revision_number
  from public.ops_registration_admission_batches batch
  where batch.task_id = p_task_id;
  insert into public.ops_registration_admission_batches(
    task_id, revision_number, status
  ) values (
    p_task_id, v_revision_number, 'draft'
  ) returning id into v_batch_id;

  -- verification_checkpoint_admission_batch_before_first_claim
  perform dashboard_private.await_registration_verification_checkpoint(
    'admission_batch_before_first_claim', p_task_id, v_student_id
  );

  begin
    update public.ops_registration_enrollments enrollment
    set
      student_id = v_student_id,
      admission_batch_id = v_batch_id,
      roster_active = true,
      updated_at = pg_catalog.now()
    where enrollment.id = any(v_enrollment_ids)
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and enrollment.student_id is null
      and not enrollment.roster_active;
    get diagnostics v_selected_count = row_count;
    if v_selected_count <> pg_catalog.cardinality(v_enrollment_ids) then
      raise exception 'registration_admission_batch_enrollment_invalid' using errcode = '23514';
    end if;
  exception
    when unique_violation then
      get stacked diagnostics v_unique_constraint = constraint_name;
      if v_unique_constraint = 'ops_registration_enrollments_student_class_claim_uidx' then
        raise exception 'registration_student_class_already_active' using errcode = '23514';
      end if;
      raise;
  end;

  foreach v_track_id in array v_track_ids
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = v_track_id;
    v_source_status := v_track.pipeline_status;
    perform dashboard_private.transition_registration_track_status(
      v_track.id, 'enrollment_processing', null, null, false
    );
    perform dashboard_private.write_registration_track_event(
      p_task_id,
      v_track.id,
      'admission_batch_started',
      v_source_status,
      'enrollment_processing',
      null,
      pg_catalog.jsonb_build_object(
        'batchId', v_batch_id,
        'revisionNumber', v_revision_number,
        'enrollmentIds', pg_catalog.to_jsonb(v_enrollment_ids)
      )
    );
  end loop;
  perform dashboard_private.recompute_registration_parent(p_task_id);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', enrollment.id,
        'trackId', enrollment.track_id,
        'studentId', enrollment.student_id,
        'admissionBatchId', enrollment.admission_batch_id,
        'classId', enrollment.class_id,
        'textbookId', enrollment.textbook_id,
        'classStartDate', enrollment.class_start_date,
        'classStartSessionKey', enrollment.class_start_session_key,
        'classStartSession', enrollment.class_start_session,
        'status', enrollment.status,
        'makeeduRegistered', enrollment.makeedu_registered,
        'rosterActive', enrollment.roster_active,
        'rosterReleasedAt', enrollment.roster_released_at,
        'rosterReleaseReason', enrollment.roster_release_reason,
        'rosterReleaseSourceTaskId', enrollment.roster_release_source_task_id,
        'rosterReleaseKind', enrollment.roster_release_kind,
        'sortOrder', enrollment.sort_order
      ) order by enrollment.sort_order, enrollment.class_id, enrollment.id
    ),
    '[]'::jsonb
  )
  into v_rows_response
  from public.ops_registration_enrollments enrollment
  where enrollment.id = any(v_enrollment_ids);
  v_response := pg_catalog.jsonb_build_object(
    'batch', pg_catalog.jsonb_build_object(
      'id', v_batch_id,
      'taskId', p_task_id,
      'revisionNumber', v_revision_number,
      'status', 'draft',
      'invoiceSentAt', null,
      'paymentConfirmedAt', null,
      'createdAt', (
        select batch.created_at
        from public.ops_registration_admission_batches batch
        where batch.id = v_batch_id
      ),
      'updatedAt', (
        select batch.updated_at
        from public.ops_registration_admission_batches batch
        where batch.id = v_batch_id
      )
    ),
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'enrollments', v_rows_response
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id, 'start_admission_batch',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$uuid_identity_body_2$),
      ('dashboard_private.cancel_registration_admission_batch_impl(uuid,jsonb,text,text)', 'fb59c198a3de4c4eb2e0077e97a7e88e5310f2e0fb0eea172e9594172d1b77b3', '77f2b816217b6ac1a3dd6a0cd256947f13d1df165cb2e0f53da830e47f860053', $uuid_identity_body_3$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_batch public.ops_registration_admission_batches%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_resolution jsonb;
  v_normalized_resolution jsonb;
  v_resolutions jsonb := '[]'::jsonb;
  v_track_id_text text;
  v_destination text;
  v_waiting_kind text;
  v_class_id_text text;
  v_class_id uuid;
  v_has_historical_enrollment boolean;
  v_resolution_count integer;
  v_selected_count integer;
  v_rows_response jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_batch_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'registration_cancellation_reason_required' using errcode = '22023';
  end if;
  if p_resolutions is null
    or pg_catalog.jsonb_typeof(p_resolutions) <> 'array'
  then
    raise exception 'registration_admission_resolutions_invalid' using errcode = '22023';
  end if;

  for v_resolution in
    select row.value
    from pg_catalog.jsonb_array_elements(p_resolutions) row(value)
  loop
    if pg_catalog.jsonb_typeof(v_resolution) <> 'object' then
      raise exception 'registration_admission_resolution_key_invalid' using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_resolution) key(value)
      where key.value not in ('trackId', 'destination', 'waitingKind', 'classId')
    ) then
      raise exception 'registration_admission_resolution_key_invalid' using errcode = '22023';
    end if;
    if not (v_resolution ? 'trackId')
      or pg_catalog.jsonb_typeof(v_resolution -> 'trackId') <> 'string'
      or not (v_resolution ? 'destination')
      or pg_catalog.jsonb_typeof(v_resolution -> 'destination') <> 'string'
    then
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;

    v_track_id_text := pg_catalog.lower(pg_catalog.btrim(v_resolution ->> 'trackId'));
    v_destination := pg_catalog.lower(pg_catalog.btrim(v_resolution ->> 'destination'));
    if v_track_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or v_destination not in ('waiting', 'not_registered')
    then
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;

    if not (v_resolution ? 'waitingKind')
      or v_resolution -> 'waitingKind' = 'null'::jsonb
    then
      v_waiting_kind := null;
    elsif pg_catalog.jsonb_typeof(v_resolution -> 'waitingKind') = 'string' then
      v_waiting_kind := pg_catalog.lower(
        nullif(pg_catalog.btrim(v_resolution ->> 'waitingKind'), '')
      );
    else
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;
    if not (v_resolution ? 'classId')
      or v_resolution -> 'classId' = 'null'::jsonb
    then
      v_class_id_text := null;
    elsif pg_catalog.jsonb_typeof(v_resolution -> 'classId') = 'string' then
      v_class_id_text := pg_catalog.lower(
        nullif(pg_catalog.btrim(v_resolution ->> 'classId'), '')
      );
      if v_class_id_text is not null
        and v_class_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;

    if v_destination = 'waiting' then
      if v_waiting_kind not in (
        'current_class', 'current_term_opening', 'next_term_opening'
      ) or (v_waiting_kind = 'current_class') is distinct from (v_class_id_text is not null)
      then
        raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
      end if;
    elsif v_waiting_kind is not null or v_class_id_text is not null then
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;

    v_normalized_resolution := pg_catalog.jsonb_build_object(
      'trackId', v_track_id_text::uuid,
      'destination', v_destination,
      'waitingKind', v_waiting_kind,
      'classId', case when v_class_id_text is null then null else v_class_id_text::uuid end
    );
    v_resolutions := v_resolutions || pg_catalog.jsonb_build_array(v_normalized_resolution);
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    group by row.value ->> 'trackId'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_admission_resolution_duplicate' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(row.value order by row.value ->> 'trackId'),
    '[]'::jsonb
  )
  into v_resolutions
  from pg_catalog.jsonb_array_elements(v_resolutions) row(value);

  select batch.task_id
  into v_task_id
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'batchId', p_batch_id,
    'resolutions', v_resolutions,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_cancel_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_cancel_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_cancel_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
    or track.id in (
      select enrollment.track_id
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
    )
  order by track.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, null, 'cancel_admission_batch'
  );

  -- admission_cancel_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'cancel_admission_batch'
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

  -- admission_cancel_identity_lock
  if v_task.student_id is null then
    raise exception 'registration_student_uuid_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student-id:' || v_task.student_id::text, 0)
  );
  if exists (
    select 1 from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and enrollment.student_id is not null
      and enrollment.student_id is distinct from v_task.student_id
  ) then
    raise exception 'registration_student_identity_mismatch' using errcode = '23514';
  end if;

  -- admission_cancel_student_locks
  perform 1
  from public.students student
  where student.id = v_task.student_id
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
        and enrollment.student_id = student.id
    )
  order by student.id
  for update;

  perform 1 from public.students student where student.id = v_task.student_id;
  if not found then
    raise exception 'registration_student_not_found' using errcode = 'P0002';
  end if;

  -- admission_cancel_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = v_task_id
  order by batch.id
  for update;
  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id
    and batch.task_id = v_task_id;
  if not found then
    raise exception 'registration_admission_batch_not_found' using errcode = 'P0002';
  end if;

  -- admission_cancel_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = v_task_id
    or enrollment.admission_batch_id = p_batch_id
  order by enrollment.id
  for update of enrollment;

  -- admission_cancel_membership_invariant
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.admission_batch_id = p_batch_id
      and track.task_id is distinct from v_task_id
  ) then
    raise exception 'registration_admission_batch_membership_invariant' using errcode = '23514';
  end if;

  -- admission_cancel_class_locks
  perform 1
  from public.classes class
  where class.id in (
    select enrollment.class_id
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where track.task_id = v_task_id
    union
    select (row.value ->> 'classId')::uuid
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    where row.value ->> 'classId' is not null
  )
  order by class.id
  for update;

  -- admission_cancel_mutable_state_check
  if v_batch.status not in ('draft', 'invoiced') then
    raise exception 'registration_admission_batch_finance_correction_required' using errcode = '23514';
  end if;
  select pg_catalog.count(*)
  into v_selected_count
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = p_batch_id;
  if v_selected_count = 0 or exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and (
        enrollment.status <> 'planned'
        or not enrollment.roster_active
        or enrollment.student_id is null
      )
  ) then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  update public.ops_registration_enrollments enrollment
  set
    status = 'canceled',
    roster_active = false,
    roster_released_at = null,
    roster_release_reason = null,
    roster_release_source_task_id = null,
    roster_release_kind = null,
    updated_at = pg_catalog.now()
  where enrollment.admission_batch_id = p_batch_id
    and enrollment.status = 'planned'
    and enrollment.roster_active;
  get diagnostics v_resolution_count = row_count;
  if v_resolution_count <> v_selected_count then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and (enrollment.status <> 'canceled' or enrollment.roster_active)
  ) then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  update public.ops_registration_admission_batches batch
  set
    status = 'canceled',
    updated_at = pg_catalog.now()
  where batch.id = p_batch_id
    and batch.status in ('draft', 'invoiced');
  if not found then
    raise exception 'registration_admission_batch_state_conflict' using errcode = '23514';
  end if;

  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
        and enrollment.track_id = track.id
    )
    order by track.id
  loop
    select exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = v_track.id
        and enrollment.status = 'enrolled'
        and enrollment.admission_batch_id is distinct from p_batch_id
    )
    into v_has_historical_enrollment;
    select pg_catalog.count(*)
    into v_resolution_count
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    where (row.value ->> 'trackId')::uuid = v_track.id;
    select row.value
    into v_resolution
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    where (row.value ->> 'trackId')::uuid = v_track.id
    order by row.value ->> 'trackId'
    limit 1;

    if v_has_historical_enrollment then
      if v_resolution_count <> 0 then
        raise exception 'registration_admission_resolution_extra' using errcode = '22023';
      end if;
      perform dashboard_private.transition_registration_track_status(
        v_track.id, 'registered', null, null, false
      );
      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'admission_batch_canceled',
        v_track.pipeline_status,
        'registered',
        v_reason,
        pg_catalog.jsonb_build_object(
          'batchId', p_batch_id,
          'restoredHistoricalEnrollment', true
        )
      );
      continue;
    end if;

    if v_resolution_count = 0 then
      raise exception 'registration_admission_resolution_missing' using errcode = '22023';
    elsif v_resolution_count > 1 then
      raise exception 'registration_admission_resolution_duplicate' using errcode = '22023';
    end if;
    v_destination := v_resolution ->> 'destination';
    v_waiting_kind := nullif(v_resolution ->> 'waitingKind', '');
    v_class_id := nullif(v_resolution ->> 'classId', '')::uuid;

    if v_destination = 'waiting' and v_waiting_kind = 'current_class' then
      if not exists (
        select 1
        from public.classes class
        where class.id = v_class_id
          and pg_catalog.btrim(class.subject) = v_track.subject
      ) then
        raise exception 'registration_class_subject_mismatch' using errcode = '23514';
      end if;
    end if;

    -- admission_cancel_other_drafts
    update public.ops_registration_enrollments enrollment
    set
      status = 'canceled',
      roster_active = false,
      roster_released_at = null,
      roster_release_reason = null,
      roster_release_source_task_id = null,
      roster_release_kind = null,
      updated_at = pg_catalog.now()
    where enrollment.track_id = v_track.id
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and not enrollment.roster_active;

    if v_destination = 'waiting' and v_waiting_kind = 'current_class' then
      perform dashboard_private.apply_registration_current_class_wait(
        v_task_id, v_track.id, v_class_id, v_actor_id
      );
    end if;
    perform dashboard_private.transition_registration_track_status(
      v_track.id,
      v_destination,
      case when v_destination = 'waiting' then v_waiting_kind else null end,
      null,
      false
    );
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      v_track.id,
      'admission_batch_canceled',
      v_track.pipeline_status,
      v_destination,
      v_reason,
      pg_catalog.jsonb_build_object(
        'batchId', p_batch_id,
        'waitingKind', case when v_destination = 'waiting' then v_waiting_kind else null end,
        'classId', case
          when v_destination = 'waiting' and v_waiting_kind = 'current_class' then v_class_id
          else null
        end,
        'restoredHistoricalEnrollment', false
      )
    );
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    where not exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
        and enrollment.track_id = (row.value ->> 'trackId')::uuid
    )
  ) then
    raise exception 'registration_admission_resolution_extra' using errcode = '22023';
  end if;
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', enrollment.id,
        'trackId', enrollment.track_id,
        'studentId', enrollment.student_id,
        'admissionBatchId', enrollment.admission_batch_id,
        'classId', enrollment.class_id,
        'textbookId', enrollment.textbook_id,
        'classStartDate', enrollment.class_start_date,
        'classStartSessionKey', enrollment.class_start_session_key,
        'classStartSession', enrollment.class_start_session,
        'status', enrollment.status,
        'makeeduRegistered', enrollment.makeedu_registered,
        'rosterActive', enrollment.roster_active,
        'rosterReleasedAt', enrollment.roster_released_at,
        'rosterReleaseReason', enrollment.roster_release_reason,
        'rosterReleaseSourceTaskId', enrollment.roster_release_source_task_id,
        'rosterReleaseKind', enrollment.roster_release_kind,
        'sortOrder', enrollment.sort_order
      ) order by enrollment.sort_order, enrollment.class_id, enrollment.id
    ),
    '[]'::jsonb
  )
  into v_rows_response
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = p_batch_id;
  v_response := pg_catalog.jsonb_build_object(
    'batch', pg_catalog.jsonb_build_object(
      'id', v_batch.id,
      'taskId', v_batch.task_id,
      'revisionNumber', v_batch.revision_number,
      'status', v_batch.status,
      'invoiceSentAt', v_batch.invoice_sent_at,
      'paymentConfirmedAt', v_batch.payment_confirmed_at,
      'createdAt', v_batch.created_at,
      'updatedAt', v_batch.updated_at
    ),
    'enrollments', v_rows_response
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'cancel_admission_batch',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$uuid_identity_body_3$),
      ('dashboard_private.complete_registration_admission_batch_impl(uuid,text)', 'beba8198f4e2288313c37e9a5f368af11f31ef7e345c3b0373cfd36c26394d95', '66d154381bae92fbc0dbe95cecfec1156bd1afdcc7ff49f5b56fae4ac552f509', $uuid_identity_body_4$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_batch public.ops_registration_admission_batches%rowtype;
  v_student public.students%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_class record;
  v_session jsonb;
  v_claim_count integer;
  v_claim_id uuid;
  v_row_count integer;
  v_track_id uuid;
  v_rows_response jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_batch_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  select batch.task_id
  into v_task_id
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'batchId', p_batch_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_complete_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_complete_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_complete_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
    or track.id in (
      select enrollment.track_id
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
    )
  order by track.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, null, 'complete_admission_batch'
  );

  -- admission_complete_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'complete_admission_batch'
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

  -- admission_complete_identity_lock
  if v_task.student_id is null then
    raise exception 'registration_student_uuid_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student-id:' || v_task.student_id::text, 0)
  );
  if exists (
    select 1 from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and enrollment.student_id is not null
      and enrollment.student_id is distinct from v_task.student_id
  ) then
    raise exception 'registration_student_identity_mismatch' using errcode = '23514';
  end if;

  -- admission_complete_student_locks
  perform 1
  from public.students student
  where student.id = v_task.student_id
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
        and enrollment.student_id = student.id
    )
  order by student.id
  for update;
  select student.*
  into v_student
  from public.students student
  where student.id = v_task.student_id;

  -- admission_complete_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = v_task_id
  order by batch.id
  for update;
  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id
    and batch.task_id = v_task_id;
  if not found then
    raise exception 'registration_admission_batch_not_found' using errcode = 'P0002';
  end if;

  -- admission_complete_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = v_task_id
    or enrollment.admission_batch_id = p_batch_id
  order by enrollment.id
  for update of enrollment;

  -- admission_complete_membership_invariant
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.admission_batch_id = p_batch_id
      and track.task_id is distinct from v_task_id
  ) then
    raise exception 'registration_admission_batch_membership_invariant' using errcode = '23514';
  end if;

  -- admission_complete_class_locks
  perform 1
  from public.classes class
  where class.id in (
    select enrollment.class_id
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
  )
  order by class.id
  for update;

  -- admission_complete_textbook_locks
  perform 1
  from public.textbooks textbook
  where textbook.id in (
    select enrollment.textbook_id
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and enrollment.textbook_id is not null
  )
  order by textbook.id
  for update;

  -- admission_complete_mutable_state_check
  if v_batch.status <> 'paid' then
    raise exception 'registration_admission_batch_not_paid' using errcode = '23514';
  end if;
  if v_batch.invoice_sent_at is null
    or v_batch.payment_confirmed_at is null
  then
    raise exception 'registration_admission_batch_finance_invariant' using errcode = '23514';
  end if;
  if v_student.id is distinct from v_task.student_id then
    raise exception 'registration_student_identity_mismatch' using errcode = '23514';
  end if;
  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '23514';
  end if;

  select pg_catalog.count(*)
  into v_row_count
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = p_batch_id;
  if v_row_count = 0 or exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and (
        enrollment.status <> 'planned'
        or not enrollment.roster_active
        or enrollment.student_id is distinct from v_student.id
        or not enrollment.makeedu_registered
      )
  ) then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
    order by enrollment.class_id, enrollment.id
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = v_enrollment.track_id;
    if v_track.pipeline_status <> 'enrollment_processing' then
      raise exception 'registration_invalid_source_state' using errcode = '23514';
    end if;

    select
      class.id,
      pg_catalog.btrim(class.subject) as subject,
      class.textbook_ids,
      class.student_ids,
      class.waitlist_ids
    into v_class
    from public.classes class
    where class.id = v_enrollment.class_id;
    if not found then
      raise exception 'registration_class_not_found' using errcode = 'P0002';
    end if;
    if v_class.subject is distinct from v_track.subject then
      raise exception 'registration_class_subject_mismatch' using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.ops_registration_enrollments other
      where other.track_id = v_enrollment.track_id
        and other.class_id = v_enrollment.class_id
        and other.id <> v_enrollment.id
        and (other.status = 'planned' or other.roster_active)
    ) then
      raise exception 'registration_enrollment_class_conflict' using errcode = '23514';
    end if;
    if v_enrollment.textbook_id is not null and not (
      exists (
        select 1
        from public.textbooks textbook
        where textbook.id = v_enrollment.textbook_id
      )
      and pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb)
      ) = 'array'
      and coalesce(
        pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb
      ) ? v_enrollment.textbook_id::text
    ) then
      raise exception 'registration_textbook_class_mismatch' using errcode = '23514';
    end if;
    if v_enrollment.class_start_date is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session_key), '') is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session), '') is null
    then
      raise exception 'registration_enrollment_schedule_incomplete' using errcode = '23514';
    end if;
    v_session := dashboard_private.validate_registration_class_session(
      v_enrollment.class_id,
      v_enrollment.class_start_date,
      v_enrollment.class_start_session_key
    );
    if coalesce((v_session ->> 'valid')::boolean, false) is not true
      or (v_session ->> 'sessionDate')::date is distinct from v_enrollment.class_start_date
      or v_session ->> 'sessionKey' is distinct from v_enrollment.class_start_session_key
      or v_session ->> 'sessionLabel' is distinct from v_enrollment.class_start_session
    then
      raise exception 'registration_class_session_invalid' using errcode = '23514';
    end if;

    select
      pg_catalog.count(*),
      (pg_catalog.array_agg(claim.id order by claim.id))[1]
    into v_claim_count, v_claim_id
    from public.ops_registration_enrollments claim
    where claim.student_id = v_student.id
      and claim.class_id = v_enrollment.class_id
      and claim.roster_active;
    if v_claim_count <> 1 or v_claim_id is distinct from v_enrollment.id then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;

    if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
      or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
      or pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb)
      ) <> 'array'
      or pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb)
      ) <> 'array'
    then
      raise exception 'registration_roster_projection_invalid' using errcode = '23514';
    end if;
    if coalesce(v_student.class_ids, '[]'::jsonb) ? v_enrollment.class_id::text
      or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_enrollment.class_id::text
      or coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb) ? v_student.id::text
      or coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb) ? v_student.id::text
    then
      raise exception 'registration_roster_mode_conflict' using errcode = '23514';
    end if;
  end loop;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
    order by enrollment.class_id, enrollment.id
  loop
    perform dashboard_private.apply_student_class_roster_mode(
      v_enrollment.student_id,
      v_enrollment.class_id,
      'enrolled',
      'removed',
      v_enrollment.id,
      'registration_admission_batch_completed',
      v_actor_id
    );
  end loop;

  update public.ops_registration_enrollments enrollment
  set
    status = 'enrolled',
    roster_active = true,
    updated_at = pg_catalog.now()
  where enrollment.admission_batch_id = p_batch_id
    and enrollment.status = 'planned'
    and enrollment.roster_active;
  get diagnostics v_claim_count = row_count;
  if v_claim_count <> v_row_count then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  for v_track_id in
    select distinct enrollment.track_id
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
    order by enrollment.track_id
  loop
    perform dashboard_private.transition_registration_track_status(
      v_track_id, 'registered', null, null, false
    );
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      v_track_id,
      'admission_batch_completed',
      'enrollment_processing',
      'registered',
      null,
      pg_catalog.jsonb_build_object('batchId', p_batch_id)
    );
  end loop;
  update public.ops_registration_admission_batches batch
  set
    status = 'completed',
    updated_at = pg_catalog.now()
  where batch.id = p_batch_id
    and batch.status = 'paid'
    and batch.invoice_sent_at is not null
    and batch.payment_confirmed_at is not null;
  if not found then
    raise exception 'registration_admission_batch_state_conflict' using errcode = '23514';
  end if;
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', enrollment.id,
        'trackId', enrollment.track_id,
        'studentId', enrollment.student_id,
        'admissionBatchId', enrollment.admission_batch_id,
        'classId', enrollment.class_id,
        'textbookId', enrollment.textbook_id,
        'classStartDate', enrollment.class_start_date,
        'classStartSessionKey', enrollment.class_start_session_key,
        'classStartSession', enrollment.class_start_session,
        'status', enrollment.status,
        'makeeduRegistered', enrollment.makeedu_registered,
        'rosterActive', enrollment.roster_active,
        'rosterReleasedAt', enrollment.roster_released_at,
        'rosterReleaseReason', enrollment.roster_release_reason,
        'rosterReleaseSourceTaskId', enrollment.roster_release_source_task_id,
        'rosterReleaseKind', enrollment.roster_release_kind,
        'sortOrder', enrollment.sort_order
      ) order by enrollment.sort_order, enrollment.class_id, enrollment.id
    ),
    '[]'::jsonb
  )
  into v_rows_response
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = p_batch_id;
  v_response := pg_catalog.jsonb_build_object(
    'batch', pg_catalog.jsonb_build_object(
      'id', v_batch.id,
      'taskId', v_batch.task_id,
      'revisionNumber', v_batch.revision_number,
      'status', v_batch.status,
      'invoiceSentAt', v_batch.invoice_sent_at,
      'paymentConfirmedAt', v_batch.payment_confirmed_at,
      'createdAt', v_batch.created_at,
      'updatedAt', v_batch.updated_at
    ),
    'enrollments', v_rows_response
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'complete_admission_batch',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$uuid_identity_body_4$),
      ('dashboard_private.cancel_registration_enrollment_impl(uuid,text,text,uuid,text,text)', '0717c27cc90a1d996d79efdb4c235980fd73b03becb249c9c08df488b3439e41', 'cd2392366cc6c82dd705c4546b5dd59de8d874fd2375cff9d9fe0f02a55bcd4b', $uuid_identity_body_5$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_destination text := pg_catalog.lower(nullif(pg_catalog.btrim(p_destination), ''));
  v_waiting_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(p_waiting_kind), ''));
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_task_id uuid;
  v_track_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_student public.students%rowtype;
  v_remaining_live_count integer := 0;
  v_next_status text;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_enrollment_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'registration_cancellation_reason_required' using errcode = '22023';
  end if;
  if v_destination is not null
    and v_destination not in ('enrollment_decided', 'waiting', 'not_registered')
  then
    raise exception 'registration_enrollment_cancellation_destination_invalid' using errcode = '22023';
  end if;

  select track.task_id, enrollment.track_id
  into v_task_id, v_track_id
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where enrollment.id = p_enrollment_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'enrollmentId', p_enrollment_id,
    'destination', v_destination,
    'waitingKind', v_waiting_kind,
    'classId', p_class_id,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- enrollment_cancel_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- enrollment_cancel_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- enrollment_cancel_track_lock
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select enrollment.*
  into v_enrollment
  from public.ops_registration_enrollments enrollment
  where enrollment.id = p_enrollment_id;
  if not found then
    raise exception 'registration_enrollment_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, v_track_id, 'cancel_enrollment'
  );

  -- enrollment_cancel_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'cancel_enrollment'
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

  -- enrollment_cancel_identity_lock
  -- Unclaimed planned-row cancellation still requires no student binding.
  if v_enrollment.status = 'enrolled' and v_enrollment.roster_active then
    if v_task.student_id is null or v_enrollment.student_id is null
      or v_task.student_id is distinct from v_enrollment.student_id then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('registration-student-id:' || v_enrollment.student_id::text, 0)
    );
  end if;

  -- enrollment_cancel_student_lock
  perform 1
  from public.students student
  where student.id = v_enrollment.student_id
    or student.id = v_task.student_id
  order by student.id
  for update;

  -- enrollment_cancel_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = v_task_id
  order by batch.id
  for update;

  -- enrollment_cancel_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = v_track_id
    or (
      v_enrollment.student_id is not null
      and enrollment.student_id = v_enrollment.student_id
      and enrollment.class_id = v_enrollment.class_id
    )
  order by enrollment.id
  for update;
  select enrollment.*
  into v_enrollment
  from public.ops_registration_enrollments enrollment
  where enrollment.id = p_enrollment_id
    and enrollment.track_id = v_track_id;

  -- enrollment_cancel_class_lock
  perform 1
  from public.classes class
  where class.id = v_enrollment.class_id
    or class.id = p_class_id
  order by class.id
  for update;

  -- enrollment_cancel_mutable_state_check
  if v_enrollment.status = 'waitlisted' then
    raise exception 'registration_waiting_transition_required' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.ops_registration_admission_batches batch
    join public.ops_registration_enrollments enrollment
      on enrollment.admission_batch_id = batch.id
    where enrollment.track_id = v_track_id
      and batch.status not in ('completed', 'canceled')
  ) then
    raise exception 'registration_open_admission_batch' using errcode = '23514';
  end if;

  if v_enrollment.status = 'planned' then
    if v_enrollment.admission_batch_id is not null
      or v_enrollment.student_id is not null
      or v_enrollment.roster_active
      or v_destination is not null
      or v_waiting_kind is not null
      or p_class_id is not null
    then
      raise exception 'registration_enrollment_not_cancelable' using errcode = '23514';
    end if;
    update public.ops_registration_enrollments enrollment
    set
      status = 'canceled',
      roster_active = false,
      roster_released_at = null,
      roster_release_reason = null,
      roster_release_source_task_id = null,
      roster_release_kind = null,
      updated_at = pg_catalog.now()
    where enrollment.id = p_enrollment_id
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and enrollment.student_id is null
      and not enrollment.roster_active;
    if not found then
      raise exception 'registration_enrollment_not_cancelable' using errcode = '23514';
    end if;
    v_next_status := v_track.pipeline_status;
  elsif v_enrollment.status = 'enrolled' and v_enrollment.roster_active then
    if v_enrollment.student_id is null
      or v_enrollment.admission_batch_id is null
      or v_task.student_id is distinct from v_enrollment.student_id
      or v_track.pipeline_status <> 'registered'
    then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
    select student.*
    into v_student
    from public.students student
    where student.id = v_enrollment.student_id;
    if not found or v_student.id is distinct from v_task.student_id then
      raise exception 'registration_student_identity_mismatch' using errcode = '23514';
    end if;

    -- enrollment_cancel_live_claim_release
    perform dashboard_private.apply_student_class_roster_mode(
      v_enrollment.student_id,
      v_enrollment.class_id,
      'removed',
      'enrolled',
      v_enrollment.id,
      'registration_enrollment_canceled: ' || v_reason,
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
    where enrollment.id = p_enrollment_id
      and enrollment.status = 'enrolled'
      and enrollment.roster_active;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;

    select pg_catalog.count(*)
    into v_remaining_live_count
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = v_track_id
      and enrollment.status = 'enrolled'
      and enrollment.roster_active;

    if v_remaining_live_count > 0 then
      if v_destination is not null or v_waiting_kind is not null or p_class_id is not null then
        raise exception 'registration_enrollment_destination_not_allowed' using errcode = '22023';
      end if;
      v_next_status := 'registered';
    elsif v_remaining_live_count = 0 then
      if v_destination is null
        or v_destination not in ('enrollment_decided', 'waiting', 'not_registered')
      then
        raise exception 'registration_enrollment_destination_required' using errcode = '22023';
      end if;
      if v_destination = 'waiting' then
        if v_waiting_kind not in (
          'current_class', 'current_term_opening', 'next_term_opening'
        ) or (v_waiting_kind = 'current_class') is distinct from (p_class_id is not null)
        then
          raise exception 'registration_enrollment_cancellation_arguments_invalid' using errcode = '22023';
        end if;
        if v_waiting_kind = 'current_class' and not exists (
          select 1
          from public.classes class
          where class.id = p_class_id
            and pg_catalog.btrim(class.subject) = v_track.subject
        ) then
          raise exception 'registration_class_subject_mismatch' using errcode = '23514';
        end if;
      elsif v_waiting_kind is not null or p_class_id is not null then
        raise exception 'registration_enrollment_cancellation_arguments_invalid' using errcode = '22023';
      end if;

      if v_destination in ('waiting', 'not_registered') then
        -- enrollment_cancel_remaining_drafts
        update public.ops_registration_enrollments enrollment
        set
          status = 'canceled',
          roster_active = false,
          roster_released_at = null,
          roster_release_reason = null,
          roster_release_source_task_id = null,
          roster_release_kind = null,
          updated_at = pg_catalog.now()
        where enrollment.track_id = v_track_id
          and enrollment.status = 'planned'
          and enrollment.admission_batch_id is null
          and enrollment.student_id is null
          and not enrollment.roster_active;
      end if;
      if v_destination = 'waiting' and v_waiting_kind = 'current_class' then
        perform dashboard_private.apply_registration_current_class_wait(
          v_task_id, v_track_id, p_class_id, v_actor_id
        );
      end if;
      perform dashboard_private.transition_registration_track_status(
        v_track_id,
        v_destination,
        case when v_destination = 'waiting' then v_waiting_kind else null end,
        null,
        false
      );
      v_next_status := v_destination;
    end if;
  else
    raise exception 'registration_enrollment_not_cancelable' using errcode = '23514';
  end if;

  perform dashboard_private.write_registration_track_event(
    v_task_id,
    v_track_id,
    'registration_enrollment_canceled',
    v_track.pipeline_status,
    v_next_status,
    v_reason,
    pg_catalog.jsonb_build_object(
      'enrollmentId', p_enrollment_id,
      'remainingLiveEnrollmentCount', v_remaining_live_count,
      'waitingKind', case when v_next_status = 'waiting' then v_waiting_kind else null end,
      'classId', case
        when v_next_status = 'waiting' and v_waiting_kind = 'current_class' then p_class_id
        else null
      end,
      'enrollmentSnapshot', pg_catalog.jsonb_build_object(
        'id', v_enrollment.id,
        'classId', v_enrollment.class_id,
        'textbookId', v_enrollment.textbook_id,
        'admissionBatchId', v_enrollment.admission_batch_id,
        'classStartDate', v_enrollment.class_start_date,
        'classStartSessionKey', v_enrollment.class_start_session_key,
        'classStartSession', v_enrollment.class_start_session,
        'status', v_enrollment.status,
        'sortOrder', v_enrollment.sort_order
      )
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select enrollment.*
  into v_enrollment
  from public.ops_registration_enrollments enrollment
  where enrollment.id = p_enrollment_id;
  v_response := pg_catalog.jsonb_build_object(
    'enrollment', pg_catalog.jsonb_build_object(
      'id', v_enrollment.id,
      'trackId', v_enrollment.track_id,
      'studentId', v_enrollment.student_id,
      'admissionBatchId', v_enrollment.admission_batch_id,
      'classId', v_enrollment.class_id,
      'textbookId', v_enrollment.textbook_id,
      'classStartDate', v_enrollment.class_start_date,
      'classStartSessionKey', v_enrollment.class_start_session_key,
      'classStartSession', v_enrollment.class_start_session,
      'status', v_enrollment.status,
      'makeeduRegistered', v_enrollment.makeedu_registered,
      'rosterActive', v_enrollment.roster_active,
      'rosterReleasedAt', v_enrollment.roster_released_at,
      'rosterReleaseReason', v_enrollment.roster_release_reason,
      'rosterReleaseSourceTaskId', v_enrollment.roster_release_source_task_id,
      'rosterReleaseKind', v_enrollment.roster_release_kind,
      'sortOrder', v_enrollment.sort_order
    ),
    'trackId', v_track_id,
    'trackStatus', v_next_status,
    'remainingLiveEnrollmentCount', v_remaining_live_count
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'cancel_enrollment',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$uuid_identity_body_5$),
      ('dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)', '9aaa1897443d54ff49fd74f677d8ae40a763821b66a5e16dfa509141dffab538', '9b7efe7475743380a5917d806b3e86930c0d2bc28731b584f0525d2981466a55', $uuid_identity_body_6$
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
  v_claim_id uuid;
  v_claim_count integer;
  v_parent_id uuid;
  v_remaining_live_roster_count integer := 0;
  v_next_student_status text;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_roster_mode text;
  v_previous_student_status text;
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student-id:' || v_student_id::text, 0)
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
    or v_student.id is distinct from v_pre_student.id
    or v_student.created_at is distinct from v_pre_student.created_at
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

  -- A withdrawal may be completed after an authorized earlier roster removal.
  -- Settlement checks remain independent records; completion never marks them paid.
  if v_task.status in ('done', 'canceled') then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
  end if;
  if not v_detail.makeedu_withdrawal_done then
    raise exception 'ops_withdrawal_checklist_incomplete' using errcode = '23514';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  if coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_source_class_id::text then
    raise exception 'ops_withdrawal_waitlist_conflict' using errcode = '23514';
  end if;
  v_roster_mode := case when coalesce(v_student.class_ids, '[]'::jsonb) ? v_source_class_id::text
    then 'enrolled' else 'removed' end;
  v_previous_student_status := v_student.status;
  if v_student.status = '퇴원' and v_roster_mode <> 'removed' then
    raise exception 'withdrawal_release_student_status_conflict' using errcode = '23514';
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
    raise exception 'registration_open_admission_batch' using errcode = '23514';
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


  if v_roster_mode = 'removed' and v_claim_id is not null then
    raise exception 'ops_withdrawal_claim_roster_conflict' using errcode = '23514';
  end if;
  -- Preserve the canonical four-array, symmetry and claim validation on both
  -- paths. A removed->removed validation is a no-op and creates no history.
  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id, v_source_class_id, v_roster_mode, v_roster_mode,
    v_claim_id, 'withdrawal_completion_validation', v_actor_id);

  -- An old withdrawal must not remove a later admission/restored relationship.
  -- Initial enrollment history alone does not prove a removal and re-enrollment.
  if v_roster_mode = 'enrolled' and (
    (v_claim_id is not null and v_claim.class_start_date > v_detail.withdrawal_date)
    or exists (
      select 1 from public.student_class_enrollment_history reenrolled
      where reenrolled.student_id = v_student_id and reenrolled.class_id = v_source_class_id
        and reenrolled.action = 'enrolled'
        and (reenrolled.changed_at > v_task.created_at
          or reenrolled.changed_at >= ((v_detail.withdrawal_date + 1)::timestamp at time zone 'Asia/Seoul'))
        and exists (
          select 1 from public.student_class_enrollment_history removed
          where removed.student_id = v_student_id and removed.class_id = v_source_class_id
            and removed.action = 'removed' and removed.changed_at <= reenrolled.changed_at
        )
    )
  ) then
    raise exception 'ops_withdrawal_registration_changed' using errcode = '23514';
  end if;

  if v_detail.withdrawal_date is null then
    raise exception 'withdrawal_last_lesson_date_required' using errcode='23514';
  end if;
  -- Protect a current reservation from every second completion, including a
  -- task with a past date that would otherwise take the immediate-release path.
  -- A manual removal/restoration or a new enrollment owns a new generation.
  update dashboard_private.withdrawal_roster_release_queue_v1 previous
  set status='superseded',claim_source_task_id=null,resolved_at=pg_catalog.clock_timestamp(),last_error_code='withdrawal_release_generation_changed'
  where previous.student_id=v_student_id and previous.class_id=v_source_class_id and previous.status='pending'
    and (previous.expected_claim_id is distinct from v_claim_id or previous.expected_history_count<>
      (select count(*) from public.student_class_enrollment_history
       where student_id=v_student_id and class_id=v_source_class_id));
  if exists(select 1 from dashboard_private.withdrawal_roster_release_queue_v1
    where student_id=v_student_id and class_id=v_source_class_id and status='pending') then
    raise exception 'withdrawal_release_already_scheduled' using errcode='23514';
  end if;
  if v_roster_mode = 'enrolled'
    and v_detail.withdrawal_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
    if v_student.status is distinct from '재원' then
      raise exception 'withdrawal_release_student_status_conflict' using errcode='23514';
    end if;
    -- Reuse the gateway's full reciprocal/claim validation as a no-op. Merely
    -- checking the student array would skip invariants of the old removal path.
    perform dashboard_private.apply_student_class_roster_mode(
      v_student_id,v_source_class_id,'enrolled','enrolled',v_claim_id,'withdrawal_release_schedule_validation',v_actor_id);
    if not dashboard_private.withdrawal_roster_release_scheduler_ready_v1() then
      raise exception 'withdrawal_release_scheduler_not_ready' using errcode='55000';
    end if;
    insert into dashboard_private.withdrawal_roster_release_queue_v1(
      task_id,claim_source_task_id,student_id,class_id,expected_claim_id,expected_history_count,last_lesson_date,actor_id)
    select p_task_id,case when v_claim_id is not null then p_task_id end,v_student_id,v_source_class_id,v_claim_id,
      count(*),v_detail.withdrawal_date,v_actor_id from public.student_class_enrollment_history
    where student_id=v_student_id and class_id=v_source_class_id;
    update public.ops_withdrawal_details set timetable_roster_updated=true,updated_at=pg_catalog.now()
    where task_id=p_task_id;
    if not found then raise exception 'withdrawal_release_state_changed' using errcode='23514'; end if;
    update public.ops_tasks set status='done',completed_at=pg_catalog.now(),updated_at=pg_catalog.now()
    where id=p_task_id and type='withdrawal' and status not in('done','canceled');
    if not found then raise exception 'withdrawal_release_state_changed' using errcode='23514'; end if;
    insert into public.ops_task_events(task_id,actor_id,event_type,field_name,before_value,after_value) values
      (p_task_id,v_actor_id,'auto_checked','시간표 명단 변경','','제외 예약'),
      (p_task_id,v_actor_id,'auto_synced','수업명단','',coalesce(v_class.name,v_task.class_name,v_source_class_id::text)
        || ' 기준일까지 유지 · ' || v_detail.withdrawal_date::text || ' 이후 제외 예약');
    v_response:=pg_catalog.jsonb_build_object('taskId',p_task_id,'studentId',v_student_id,'sourceClassId',v_source_class_id,
      'affectedClassIds',pg_catalog.to_jsonb(v_affected_class_ids),'releasedEnrollmentIds','[]'::jsonb,
      'canceledWaitlistEnrollmentIds','[]'::jsonb,'studentStatus',v_student.status,'taskStatus','done',
      'timetableRosterUpdated',true,'rosterReleaseScheduled',true,'lastLessonDate',v_detail.withdrawal_date);
    insert into dashboard_private.ops_registration_mutations(actor_id,request_key,task_id,mutation_type,target_fingerprint,response_payload)
    values(v_actor_id,v_request_key,p_task_id,'complete_withdrawal_roster_transition',v_target_fingerprint,v_response);
    return v_response;
  end if;
  -- verification_checkpoint_withdrawal_before_status_flip
  perform dashboard_private.await_registration_verification_checkpoint(
    'withdrawal_before_status_flip', p_task_id, v_student_id
  );

  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id,
    v_source_class_id,
    'removed',
    v_roster_mode,
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
    if v_student.status = '재원' then
      update public.students set status = '퇴원' where id = v_student_id and status = '재원';
      if not found then
        raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
      end if;
    elsif v_student.status <> '퇴원' then
      raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
    end if;
  elsif v_student.status <> '재원' then
    raise exception 'withdrawal_release_student_status_conflict' using errcode = '23514';
  end if;

  update public.ops_withdrawal_details
  set timetable_roster_updated = true, updated_at = pg_catalog.now()
  where task_id = p_task_id;
  if not found then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
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
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '23514';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values
    (p_task_id, v_actor_id, 'auto_checked', '시간표 명단 변경', '', '완료'),
    (
      p_task_id, v_actor_id, 'auto_synced', '수업명단', '',
      coalesce(v_class.name, v_task.class_name, v_source_class_id::text)
        || case when v_roster_mode = 'removed' then ' 이미 제외됨 · withdrawal_completed'
          else ' 제거 · withdrawal_completed' end
    ),
    (
      p_task_id, v_actor_id, 'auto_synced', '학생 상태', v_previous_student_status,
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
    'rosterAlreadyRemoved', v_roster_mode = 'removed',
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
$uuid_identity_body_6$),
      ('dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)', 'd4cebfecb6727afb7f714836d382ab530f9c7d419fba5f763f88cf03aafe4a8c', '4772049aa37e924f8c689c094a078e2ae67d76b1c9abef00c778cc8b0f66104b', $uuid_identity_body_7$
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
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_to_claim_id uuid;
  v_to_claim_count integer;
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student-id:' || v_student_id::text, 0)
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
    or v_student.id is distinct from v_pre_student.id
    or v_student.created_at is distinct from v_pre_student.created_at
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
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '23514';
  end if;
  if not v_detail.makeedu_transfer_done
    or not v_detail.fee_processed
    or not v_detail.textbook_fee_processed
  then
    raise exception 'ops_transfer_checklist_incomplete' using errcode = '23514';
  end if;
  -- A saved transfer may outlive removal from the last source roster.
  if v_detail.from_class_end_date is null or v_detail.to_class_start_date is null then
    raise exception 'ops_transfer_schedule_required' using errcode = '23514';
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
  -- Removed source / enrolled destination are valid completion inputs.
  -- Waiting is a different workflow. Reciprocal arrays and element shape are
  -- still validated by apply_student_class_roster_mode under the same locks.
  if coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_from_class_id::text
    or coalesce(v_from_class.waitlist_ids, '[]'::jsonb) ? v_student_id::text
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_to_class_id::text
    or coalesce(v_to_class.waitlist_ids, '[]'::jsonb) ? v_student_id::text
  then
    raise exception 'registration_roster_mode_conflict' using errcode = '23514';
  end if;
  select pg_catalog.count(*), (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_to_claim_count, v_to_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_to_class_id and enrollment.roster_active;
  if v_to_claim_count > 1 or exists (
    select 1 from public.ops_registration_enrollments enrollment
    where enrollment.id = v_to_claim_id
      and (enrollment.status <> 'enrolled'
        or not (coalesce(v_student.class_ids, '[]'::jsonb) ? v_to_class_id::text)
        or not (coalesce(v_to_class.student_ids, '[]'::jsonb) ? v_student_id::text))
  ) then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
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
      raise exception 'registration_open_admission_batch' using errcode = '23514';
    end if;
  end if;

  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id,
    v_from_class_id,
    'removed',
    case when coalesce(v_student.class_ids, '[]'::jsonb) ? v_from_class_id::text then 'enrolled' else 'removed' end,
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
    case when coalesce(v_student.class_ids, '[]'::jsonb) ? v_to_class_id::text then 'enrolled' else 'removed' end,
    v_to_claim_id,
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

  -- An already enrolled destination can be a roster no-op, but the saved
  -- student's status must still reflect the successfully reconciled transfer.
  update public.students set status = '재원'
  where id = v_student_id and status is distinct from '재원';

  update public.ops_transfer_details
  set
    timetable_roster_updated = true,
    updated_at = pg_catalog.now()
  where task_id = p_task_id
    and not timetable_roster_updated;
  if not found then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '23514';
  end if;
  update public.ops_tasks
  set
    status = 'done',
    completed_at = pg_catalog.now(),
    class_id = v_to_class_id,
    class_name = v_detail.to_class_name,
    subject = v_task.subject,
    updated_at = pg_catalog.now()
  where id = p_task_id
    and type = 'transfer'
    and status not in ('done', 'canceled');
  if not found then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '23514';
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
      coalesce(v_detail.from_class_name, ''),
      coalesce(v_detail.to_class_name, '') || ' 등록 · transfer_to_class'
    ),
    (p_task_id, v_actor_id, 'auto_synced', '학생 상태', v_student.status, '재원');

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
$uuid_identity_body_7$),
      ('dashboard_private.finalize_registration_track_enrollments_v1(uuid,uuid)', '67671a69ba4d84ebaf35db425cd071ed628c62ce72b3e2214d95cf00f8e3f4f6', '3e6ea6931921e39cdba67df548cee2819c715bc4631cda4cd5f961af192bfb3a', $uuid_identity_body_8$
declare
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_student public.students%rowtype;
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_class public.classes%rowtype;
  v_batch public.ops_registration_admission_batches%rowtype;
  v_session jsonb;
  v_task_id uuid;
  v_student_id uuid;
  v_batch_id uuid;
  v_batch_count integer;
  v_unbatched_count integer;
  v_row_count integer;
  v_revision_number integer;
  v_source_status text;
  v_changed boolean := false;
  v_enrollment_ids jsonb;
begin
  if p_track_id is null then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task.id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task.id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task.id;
  if v_track.pipeline_status not in ('enrollment_processing', 'registered') then
    raise exception 'registration_enrollment_pipeline_invalid' using errcode = '23514';
  end if;

  -- Explicit persisted UUID only; contact/name/UID/URL are not identity.
  if v_task.student_id is null then
    raise exception 'registration_student_uuid_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student-id:' || v_task.student_id::text, 0)
  );

  select student.*
  into v_student
  from public.students student
  where student.id = v_task.student_id
  for update;
  if not found then
    raise exception 'registration_student_not_found' using errcode = 'P0002';
  end if;
  v_student_id := v_student.id;

  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '23514';
  end if;

  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = v_task.id
  order by batch.id
  for update;

  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = v_task.id
  order by enrollment.id
  for update of enrollment;

  perform 1
  from public.classes class
  where class.id in (
    select enrollment.class_id
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status in ('planned', 'enrolled')
  )
  order by class.id
  for update;

  perform 1
  from public.textbooks textbook
  where textbook.id in (
    select selected.id
    from public.ops_registration_enrollments enrollment
    cross join lateral pg_catalog.unnest(coalesce(enrollment.textbook_ids, array_remove(array[enrollment.textbook_id], null))) selected(id)
    where enrollment.track_id = p_track_id
      and enrollment.status in ('planned', 'enrolled')
  )
  order by textbook.id
  for update;

  select pg_catalog.count(*)
  into v_row_count
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    and (
      enrollment.status = 'planned'
      or (enrollment.status = 'enrolled' and enrollment.roster_active)
    );
  if v_row_count = 0 then
    raise exception 'registration_enrollment_required' using errcode = '23514';
  end if;

  select
    pg_catalog.count(distinct enrollment.admission_batch_id),
    pg_catalog.count(*) filter (where enrollment.admission_batch_id is null),
    (pg_catalog.array_agg(
      distinct enrollment.admission_batch_id
      order by enrollment.admission_batch_id
    ) filter (where enrollment.admission_batch_id is not null))[1]
  into v_batch_count, v_unbatched_count, v_batch_id
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    and enrollment.status = 'planned';
  if v_batch_count > 1 or (v_batch_count = 1 and v_unbatched_count > 0) then
    raise exception 'registration_admission_batch_membership_invariant' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
  ) then
    if v_batch_id is null then
      -- Status-driven registration owns a dedicated compatibility batch. Never
      -- attach this subject to another subject's legacy open batch.
      select coalesce(pg_catalog.max(batch.revision_number), 0) + 1
      into v_revision_number
      from public.ops_registration_admission_batches batch
      where batch.task_id = v_task.id;
      insert into public.ops_registration_admission_batches(
        task_id,
        revision_number,
        status
      ) values (
        v_task.id,
        v_revision_number,
        'completed'
      ) returning id into v_batch_id;
    else
      select batch.*
      into v_batch
      from public.ops_registration_admission_batches batch
      where batch.id = v_batch_id
        and batch.task_id = v_task.id;
      if not found or v_batch.status = 'canceled' then
        raise exception 'registration_admission_batch_membership_invariant' using errcode = '23514';
      end if;
    end if;

  end if;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status in ('planned', 'enrolled')
      and (enrollment.status = 'planned' or enrollment.roster_active)
    order by enrollment.class_id, enrollment.id
  loop
    select class.*
    into v_class
    from public.classes class
    where class.id = v_enrollment.class_id;
    if not found then
      raise exception 'registration_class_not_found' using errcode = 'P0002';
    end if;
    if pg_catalog.btrim(v_class.subject) is distinct from v_track.subject then
      raise exception 'registration_class_subject_mismatch' using errcode = '23514';
    end if;
    if v_class.status = '종강' or v_class.closed_at is not null then
      raise exception 'registration_class_closed' using errcode = '23514';
    end if;
    if exists (
      select 1 from pg_catalog.unnest(coalesce(v_enrollment.textbook_ids, array_remove(array[v_enrollment.textbook_id], null))) selected(id)
      where not exists (select 1 from public.textbooks textbook where textbook.id = selected.id)
        or not coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb) ? selected.id::text
    ) then
      raise exception 'registration_textbook_class_mismatch' using errcode = '23514';
    end if;
    if v_enrollment.class_start_date is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session_key), '') is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session), '') is null
    then
      raise exception 'registration_enrollment_schedule_incomplete' using errcode = '23514';
    end if;
    v_session := dashboard_private.validate_registration_class_session(
      v_enrollment.class_id,
      v_enrollment.class_start_date,
      v_enrollment.class_start_session_key
    );
    if coalesce((v_session ->> 'valid')::boolean, false) is not true
      or (v_session ->> 'sessionDate')::date is distinct from v_enrollment.class_start_date
      or v_session ->> 'sessionKey' is distinct from v_enrollment.class_start_session_key
      or v_session ->> 'sessionLabel' is distinct from v_enrollment.class_start_session
    then
      raise exception 'registration_class_session_invalid' using errcode = '23514';
    end if;

    if v_enrollment.status = 'planned' then
      if v_enrollment.admission_batch_id is null then
        if v_enrollment.student_id is not null or v_enrollment.roster_active then
          raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
        end if;
      elsif v_enrollment.student_id is distinct from v_student_id
        or not v_enrollment.roster_active
      then
        raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
      end if;
      if exists (
        select 1
        from public.ops_registration_enrollments claim
        where claim.student_id = v_student_id
          and claim.class_id = v_enrollment.class_id
          and claim.roster_active
          and claim.id <> v_enrollment.id
      ) then
        raise exception 'registration_student_class_already_active' using errcode = '23514';
      end if;
    elsif v_enrollment.student_id is distinct from v_student_id then
      raise exception 'registration_student_identity_mismatch' using errcode = '23514';
    end if;
  end loop;

  begin
    update public.ops_registration_enrollments enrollment
    set
      student_id = v_student_id,
      admission_batch_id = v_batch_id,
      roster_active = true,
      updated_at = pg_catalog.now()
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and enrollment.student_id is null
      and not enrollment.roster_active;
  exception
    when unique_violation then
      raise exception 'registration_student_class_already_active' using errcode = '23514';
  end;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
    order by enrollment.class_id, enrollment.id
  loop
    perform dashboard_private.apply_student_class_roster_mode(
      v_enrollment.student_id,
      v_enrollment.class_id,
      'enrolled',
      'removed',
      v_enrollment.id,
      'registration_workflow_registered',
      p_actor_id
    );
    v_changed := true;
  end loop;

  update public.ops_registration_enrollments enrollment
  set
    status = 'enrolled',
    roster_active = true,
    updated_at = pg_catalog.now()
  where enrollment.track_id = p_track_id
    and enrollment.status = 'planned'
    and enrollment.student_id = v_student_id
    and enrollment.admission_batch_id = v_batch_id
    and enrollment.roster_active;

  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
  ) then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    join public.students student on student.id = enrollment.student_id
    join public.classes class on class.id = enrollment.class_id
    where enrollment.track_id = p_track_id
      and enrollment.status = 'enrolled'
      and enrollment.roster_active
      and (
        not (coalesce(student.class_ids, '[]'::jsonb) ? enrollment.class_id::text)
        or not (coalesce(pg_catalog.to_jsonb(class.student_ids), '[]'::jsonb) ? enrollment.student_id::text)
        or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? enrollment.class_id::text
        or coalesce(pg_catalog.to_jsonb(class.waitlist_ids), '[]'::jsonb) ? enrollment.student_id::text
      )
  ) then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;

  if v_batch_id is not null and not exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = v_batch_id
      and enrollment.status = 'planned'
  ) then
    update public.ops_registration_admission_batches batch
    set
      status = 'completed',
      updated_at = pg_catalog.now()
    where batch.id = v_batch_id
      and batch.status <> 'canceled';
  end if;

  v_source_status := v_track.pipeline_status;
  perform dashboard_private.transition_registration_track_status(
    p_track_id,
    'registered',
    null,
    null,
    false
  );
  perform dashboard_private.write_registration_track_event_v2(
    v_task.id,
    p_track_id,
    case
      when p_actor_id is null then 'registration_workflow_registered_backfill'
      else 'registration_workflow_registered_roster_finalized'
    end,
    v_source_status,
    'registered',
    case when p_actor_id is null then 'registration_workflow_registered_backfill' else 'manual_status_change' end,
    pg_catalog.jsonb_build_object(
      'studentId', v_student_id,
      'batchId', v_batch_id,
      'changed', v_changed
    ),
    case when p_actor_id is null then 'migration' else 'user' end,
    case when p_actor_id is null then 'registration_workflow_registered_backfill' else null end
  );
  perform dashboard_private.recompute_registration_parent(v_task.id);

  select coalesce(
    pg_catalog.jsonb_agg(enrollment.id order by enrollment.id),
    '[]'::jsonb
  )
  into v_enrollment_ids
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    and enrollment.status = 'enrolled'
    and enrollment.roster_active;

  return pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'studentId', v_student_id,
    'batchId', v_batch_id,
    'enrollmentIds', v_enrollment_ids,
    'changed', v_changed
  );
end;
$uuid_identity_body_8$),
      ('dashboard_private.apply_scheduled_withdrawal_roster_release_v1(uuid)', 'f39848a20c3ef69ff40b75adf7a7377c292c42344bf599c75f2630302757efc0', 'd75c0f7a6319f813a288e6bc900c9686fd0ad3ca03dcb6cc8ebd75df418000c3', $uuid_identity_body_9$
declare
  v_release dashboard_private.withdrawal_roster_release_queue_v1%rowtype;
  v_student public.students%rowtype;
  v_pre_student public.students%rowtype;
  v_class public.classes%rowtype;
  v_claim public.ops_registration_enrollments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_task public.ops_tasks%rowtype;
  v_pre_parent_ids uuid[];
  v_current_parent_ids uuid[];
  v_history_count bigint;
  v_claim_count integer;
  v_claim_id uuid;
  v_actor_id uuid;
  v_task_exists boolean;
  v_superseded boolean := false;
  v_next_status text;
begin
  select * into v_release from dashboard_private.withdrawal_roster_release_queue_v1 where task_id=p_task_id;
  if not found or v_release.status<>'pending' then return 'unchanged'; end if;
  if v_release.last_lesson_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then
    return 'not_due';
  end if;
  select coalesce(pg_catalog.array_agg(distinct track.task_id order by track.task_id),array[]::uuid[])
  into v_pre_parent_ids from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id=enrollment.track_id
  where enrollment.student_id=v_release.student_id and enrollment.class_id=v_release.class_id and enrollment.roster_active;
  -- Preserve the completion gateway's parent -> track -> student -> batch ->
  -- claim -> class lock order; take the queue row only after these domain locks.
  perform 1 from public.ops_tasks task
  where task.id=p_task_id or task.id=any(v_pre_parent_ids) order by task.id for update;
  select * into v_task from public.ops_tasks where id=p_task_id;
  v_task_exists := found;
  if v_task_exists and (v_task.type<>'withdrawal' or v_task.status<>'done'
    or v_task.student_id is distinct from v_release.student_id
    or v_task.class_id is distinct from v_release.class_id) then v_superseded:=true; end if;
  if not v_task_exists and v_release.expected_claim_id is not null then v_superseded:=true; end if;
  perform 1 from public.ops_registration_subject_tracks track
  where track.task_id=any(v_pre_parent_ids) order by track.id for update;
  select * into v_pre_student from public.students where id=v_release.student_id;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student-id:' || v_release.student_id::text, 0)
  );
  select * into v_student from public.students where id=v_release.student_id for update;
  if not found then
    v_superseded:=true;
  elsif v_student.id is distinct from v_pre_student.id
    or v_student.created_at is distinct from v_pre_student.created_at then
    raise exception 'registration_workflow_retry_required' using errcode='40001';
  end if;
  select coalesce(pg_catalog.array_agg(distinct track.task_id order by track.task_id),array[]::uuid[])
  into v_current_parent_ids from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id=enrollment.track_id
  where enrollment.student_id=v_release.student_id and enrollment.class_id=v_release.class_id and enrollment.roster_active;
  if v_current_parent_ids is distinct from v_pre_parent_ids then
    raise exception 'registration_workflow_retry_required' using errcode='40001';
  end if;
  perform 1 from public.ops_registration_admission_batches batch
  where batch.task_id=any(v_current_parent_ids) order by batch.id for update;
  perform 1 from public.ops_registration_enrollments enrollment
  where enrollment.student_id=v_release.student_id and enrollment.class_id=v_release.class_id and enrollment.roster_active
  order by enrollment.id for update;
  select * into v_class from public.classes where id=v_release.class_id for update;
  if not found then v_superseded:=true; end if;
  select * into v_release from dashboard_private.withdrawal_roster_release_queue_v1 where task_id=p_task_id for update;
  if v_release.status<>'pending' then return 'unchanged'; end if;
  if v_release.last_lesson_date >= (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date then return 'not_due'; end if;
  select count(*) into v_history_count from public.student_class_enrollment_history
  where student_id=v_release.student_id and class_id=v_release.class_id;
  select count(*),(pg_catalog.array_agg(id order by id))[1] into v_claim_count,v_claim_id
  from public.ops_registration_enrollments where student_id=v_release.student_id and class_id=v_release.class_id and roster_active;
  if v_history_count<>v_release.expected_history_count or v_claim_count>1
    or v_claim_id is distinct from v_release.expected_claim_id
    or not (coalesce(v_student.class_ids,'[]'::jsonb) ? v_release.class_id::text)
    or coalesce(v_student.waitlist_class_ids,'[]'::jsonb) ? v_release.class_id::text
    or not (coalesce(v_class.student_ids,'[]'::jsonb) ? v_release.student_id::text)
    or coalesce(v_class.waitlist_ids,'[]'::jsonb) ? v_release.student_id::text
  then v_superseded:=true; end if;
  if v_claim_id is not null then
    select * into v_claim from public.ops_registration_enrollments where id=v_claim_id;
    if v_claim.status<>'enrolled' then v_superseded:=true; end if;
    if exists(select 1 from public.ops_registration_admission_batches where id=v_claim.admission_batch_id and status not in('completed','canceled')) then
      v_superseded:=true;
    end if;
  end if;
  if v_superseded then
    update dashboard_private.withdrawal_roster_release_queue_v1
    set status='superseded',claim_source_task_id=null,resolved_at=pg_catalog.clock_timestamp(),last_error_code='withdrawal_release_generation_changed'
    where task_id=p_task_id;
    return 'superseded';
  end if;
  if v_student.status is distinct from '재원' then
    raise exception 'withdrawal_release_student_status_conflict' using errcode='23514';
  end if;
  -- The original actor is attribution only, never a synthesized auth session.
  select id into v_actor_id from auth.users where id=v_release.actor_id;
  perform dashboard_private.apply_student_class_roster_mode(
    v_release.student_id,v_release.class_id,'removed','enrolled',v_claim_id,'withdrawal_scheduled_release',v_actor_id);
  if v_claim_id is not null then
    update public.ops_registration_enrollments
    set roster_active=false,roster_released_at=pg_catalog.clock_timestamp(),roster_release_reason='withdrawal_completed',
      roster_release_source_task_id=p_task_id,roster_release_kind='withdrawal',updated_at=pg_catalog.clock_timestamp()
    where id=v_claim_id and status='enrolled' and roster_active;
    if not found then raise exception 'withdrawal_release_claim_changed' using errcode='23514'; end if;
    select * into v_track from public.ops_registration_subject_tracks where id=v_claim.track_id;
    if not found then raise exception 'withdrawal_release_track_missing' using errcode='23514'; end if;
    -- Preserve the registration history schema without the user-only event
    -- writer, which could create a notification source or require a fake JWT.
    insert into public.ops_task_events(task_id,actor_id,event_type,field_name,before_value,after_value)
    values(v_track.task_id,null,'registration_track_event','registration_track:' || v_track.id::text,null,
      pg_catalog.jsonb_build_object('version',2,'event_type','registration_enrollment_roster_released',
        'actor_profile_id',null,'actor_kind','system','system_source','withdrawal_scheduled_release',
        'track_id',v_track.id,'subject',v_track.subject,'source',v_track.pipeline_status,
        'destination',v_track.pipeline_status,'reason_code','withdrawal_completed',
        'metadata',pg_catalog.jsonb_build_object('enrollmentId',v_claim_id,'sourceTaskId',p_task_id,'releaseKind','withdrawal',
          'enrollmentSnapshot',pg_catalog.jsonb_build_object('id',v_claim.id,'classId',v_claim.class_id,
            'textbookId',v_claim.textbook_id,'admissionBatchId',v_claim.admission_batch_id,
            'classStartDate',v_claim.class_start_date,'classStartSessionKey',v_claim.class_start_session_key,
            'classStartSession',v_claim.class_start_session,'status',v_claim.status,'sortOrder',v_claim.sort_order)),
        'occurred_at',pg_catalog.clock_timestamp())::text);
    perform dashboard_private.recompute_registration_parent(v_track.task_id);
  end if;
  select * into v_student from public.students where id=v_release.student_id;
  v_next_status:=case when pg_catalog.jsonb_array_length(coalesce(v_student.class_ids,'[]'::jsonb))
    + pg_catalog.jsonb_array_length(coalesce(v_student.waitlist_class_ids,'[]'::jsonb))
    + (select count(*) from public.ops_registration_enrollments where student_id=v_release.student_id and roster_active)=0
    then '퇴원' else '재원' end;
  if v_next_status='퇴원' then
    update public.students set status='퇴원' where id=v_release.student_id and status='재원';
    if not found then raise exception 'withdrawal_release_student_status_conflict' using errcode='23514'; end if;
  end if;
  if v_task_exists then
    insert into public.ops_task_events(task_id,actor_id,event_type,field_name,before_value,after_value)
    values(p_task_id,null,'auto_synced','수업명단','기준일까지 유지','제외 적용 · withdrawal_scheduled_release');
  end if;
  update dashboard_private.withdrawal_roster_release_queue_v1
  set status='applied',claim_source_task_id=null,applied_at=pg_catalog.clock_timestamp(),resolved_at=pg_catalog.clock_timestamp(),last_error_code=null
  where task_id=p_task_id;
  return 'applied';
end;
$uuid_identity_body_9$)
    ) as targets(signature, before_sha256, after_sha256, candidate_body)
  loop
    v_target := pg_catalog.to_regprocedure(v_spec.signature);
    if v_target is null then
      raise exception 'registration_uuid_identity_target_missing' using errcode = '55000';
    end if;
    select * into strict v_before from pg_catalog.pg_proc where oid = v_target;
    if pg_catalog.encode(extensions.digest(v_before.prosrc, 'sha256'), 'hex') is distinct from v_spec.before_sha256
      or v_before.proowner is distinct from (select oid from pg_catalog.pg_roles where rolname = 'postgres')
      or v_before.prosecdef is distinct from true
      or coalesce('search_path=""' = any(v_before.proconfig), false) is distinct from true then
      raise exception 'registration_uuid_identity_preimage_drift' using errcode = '55000';
    end if;
    v_definition := pg_catalog.pg_get_functiondef(v_target);
    if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_before.prosrc, '')))
      <> pg_catalog.length(v_before.prosrc) then
      raise exception 'registration_uuid_identity_body_anchor_drift' using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before.prosrc, v_spec.candidate_body);
    select * into strict v_after from pg_catalog.pg_proc where oid = v_target;
    if pg_catalog.encode(extensions.digest(v_after.prosrc, 'sha256'), 'hex') is distinct from v_spec.after_sha256
      or v_after.proowner is distinct from v_before.proowner
      or v_after.proacl is distinct from v_before.proacl
      or v_after.proconfig is distinct from v_before.proconfig
      or v_after.prosecdef is distinct from v_before.prosecdef
      or v_after.provolatile is distinct from v_before.provolatile
      or v_after.proparallel is distinct from v_before.proparallel
      or v_after.proisstrict is distinct from v_before.proisstrict
      or v_after.proleakproof is distinct from v_before.proleakproof
      or v_after.prolang is distinct from v_before.prolang
      or v_after.procost is distinct from v_before.procost
      or v_after.prorows is distinct from v_before.prorows
      or v_after.prosupport is distinct from v_before.prosupport
      or v_after.proretset is distinct from v_before.proretset
      or v_after.prorettype is distinct from v_before.prorettype then
      raise exception 'registration_uuid_identity_metadata_changed' using errcode = '55000';
    end if;
  end loop;
end;
$registration_uuid_identity_install$;

commit;
