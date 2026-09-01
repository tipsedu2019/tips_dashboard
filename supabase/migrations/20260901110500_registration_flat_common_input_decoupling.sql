begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Common registration fields are editable facts. Missing or provisional facts
-- are valid while staff are still collecting information; notification
-- readiness is checked only by the explicit notification action.
create or replace function dashboard_private.update_registration_case_common_impl(
  p_task_id uuid,
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_request_note text,
  p_priority text,
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
  v_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_school_grade text := nullif(pg_catalog.btrim(p_school_grade), '');
  v_school_name text := nullif(pg_catalog.btrim(p_school_name), '');
  v_parent_phone text := nullif(pg_catalog.btrim(p_parent_phone), '');
  v_student_phone text := nullif(pg_catalog.btrim(p_student_phone), '');
  v_campus text := nullif(pg_catalog.btrim(p_campus), '');
  v_request_note text := nullif(pg_catalog.btrim(p_request_note), '');
  v_priority text := nullif(pg_catalog.btrim(p_priority), '');
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_effective_campus text;
  v_effective_priority text;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_next_revision integer;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_campus is not null and v_campus not in ('본관', '별관') then
    raise exception 'registration_campus_invalid' using errcode = '22023';
  end if;
  if v_priority is not null
    and v_priority not in ('low', 'normal', 'high', 'urgent')
  then
    raise exception 'registration_priority_invalid' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '23514';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentName', v_student_name,
    'schoolGrade', v_school_grade,
    'schoolName', v_school_name,
    'parentPhone', v_parent_phone,
    'studentPhone', v_student_phone,
    'campus', v_campus,
    'inquiryAt', p_inquiry_at,
    'requestNote', v_request_note,
    'priority', v_priority,
    'expectedCommonRevision', p_expected_common_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

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

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id,
    null,
    'update_common'
  );

  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'update_common'
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

  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '23514';
  end if;

  v_effective_campus := coalesce(v_campus, v_task.campus);
  v_effective_priority := coalesce(v_priority, v_task.priority, 'normal');

  update public.ops_tasks task
  set
    student_name = v_student_name,
    title = coalesce('등록: ' || v_student_name, '등록'),
    campus = v_effective_campus,
    priority = v_effective_priority,
    updated_at = pg_catalog.now()
  where task.id = p_task_id;

  update public.ops_registration_details detail
  set
    inquiry_at = p_inquiry_at,
    school_grade = v_school_grade,
    school_name = v_school_name,
    parent_phone = v_parent_phone,
    student_phone = v_student_phone,
    request_note = v_request_note,
    common_revision = detail.common_revision + 1,
    updated_at = pg_catalog.now()
  where detail.task_id = p_task_id
  returning detail.common_revision into v_next_revision;

  insert into public.ops_task_events(
    task_id,
    actor_id,
    event_type,
    field_name,
    before_value,
    after_value
  ) values (
    p_task_id,
    v_actor_id,
    'registration_common_info_updated',
    'registration_common',
    pg_catalog.jsonb_build_object(
      'commonRevision', v_detail.common_revision,
      'studentName', v_task.student_name,
      'schoolGrade', v_detail.school_grade,
      'schoolName', v_detail.school_name,
      'parentPhone', v_detail.parent_phone,
      'studentPhone', v_detail.student_phone,
      'campus', v_task.campus,
      'inquiryAt', v_detail.inquiry_at,
      'requestNote', v_detail.request_note,
      'priority', v_task.priority
    )::text,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'commonRevision', v_next_revision,
      'studentName', v_student_name,
      'schoolGrade', v_school_grade,
      'schoolName', v_school_name,
      'parentPhone', v_parent_phone,
      'studentPhone', v_student_phone,
      'campus', v_effective_campus,
      'inquiryAt', p_inquiry_at,
      'requestNote', v_request_note,
      'priority', v_effective_priority,
      'occurredAt', pg_catalog.now()
    )::text
  );

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'commonRevision', v_next_revision
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
    'update_common',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

-- Keep the historical delegate name and response shape for old clients, but
-- make it a fact-only compatibility layer. It must never touch appointment or
-- notification state.
create or replace function dashboard_private.update_registration_case_common_with_reminders_v1_impl(
  p_task_id uuid,
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_request_note text,
  p_priority text,
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
  v_response jsonb;
begin
  v_response := dashboard_private.update_registration_case_common_impl(
    p_task_id,
    p_student_name,
    p_school_grade,
    p_school_name,
    p_parent_phone,
    p_student_phone,
    p_campus,
    p_inquiry_at,
    p_request_note,
    p_priority,
    p_expected_common_revision,
    p_request_key
  );

  v_response := v_response || pg_catalog.jsonb_build_object(
    'notificationJobs',
    '[]'::jsonb
  );
  update dashboard_private.ops_registration_mutations mutation
  set response_payload = v_response
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key
    and mutation.task_id = p_task_id
    and mutation.mutation_type = 'update_common';
  if not found then
    raise exception 'registration_common_receipt_missing' using errcode = '23514';
  end if;
  return v_response;
end;
$$;

-- Saving inquiry facts and adding subjects is one atomic table edit. Subject
-- removal keeps its existing safeguards; notification readiness, appointment
-- revisions, and subject/common cross-field completeness are outside this RPC.
create or replace function dashboard_private.save_registration_case_inquiry_v1_impl(
  p_task_id uuid,
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_request_note text,
  p_priority text,
  p_expected_common_revision integer,
  p_expected_subjects text[],
  p_subjects text[],
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
  v_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_school_grade text := nullif(pg_catalog.btrim(p_school_grade), '');
  v_school_name text := nullif(pg_catalog.btrim(p_school_name), '');
  v_parent_phone text := nullif(pg_catalog.btrim(p_parent_phone), '');
  v_student_phone text := nullif(pg_catalog.btrim(p_student_phone), '');
  v_campus text := nullif(pg_catalog.btrim(p_campus), '');
  v_request_note text := nullif(pg_catalog.btrim(p_request_note), '');
  v_priority text := nullif(pg_catalog.btrim(p_priority), '');
  v_expected_subjects text[];
  v_subjects text[];
  v_current_subjects text[];
  v_added_subjects text[];
  v_track record;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_target_fingerprint jsonb;
  v_receipt_found boolean := false;
  v_receipt_matches boolean := false;
  v_subjects_changed boolean := false;
  v_common_response jsonb;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if coalesce(public.current_dashboard_role(), '') not in ('admin', 'staff') then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_task_id is null then
    raise exception 'registration_task_required' using errcode = '22023';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '23514';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(
      coalesce(p_expected_subjects, array[]::text[])
    ) expected(value)
    where expected.value is null
      or nullif(pg_catalog.btrim(expected.value), '') is null
      or pg_catalog.btrim(expected.value) not in ('영어', '수학', '과학')
  ) then
    raise exception 'registration_subjects_conflict' using errcode = '23514';
  end if;
  select coalesce(
    pg_catalog.array_agg(
      expected.value
      order by dashboard_private.registration_subject_sort_order(expected.value)
    ),
    array[]::text[]
  )
  into v_expected_subjects
  from (
    select distinct pg_catalog.btrim(input.value) as value
    from pg_catalog.unnest(
      coalesce(p_expected_subjects, array[]::text[])
    ) input(value)
    where nullif(pg_catalog.btrim(input.value), '') is not null
  ) expected;

  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
    where subject.value is null
      or nullif(pg_catalog.btrim(subject.value), '') is null
      or pg_catalog.btrim(subject.value) not in ('영어', '수학', '과학')
  ) then
    raise exception 'registration_subject_unsupported' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.array_agg(
      subject.value
      order by dashboard_private.registration_subject_sort_order(subject.value)
    ),
    array[]::text[]
  )
  into v_subjects
  from (
    select distinct pg_catalog.btrim(input.value) as value
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) input(value)
    where nullif(pg_catalog.btrim(input.value), '') is not null
  ) subject;
  if pg_catalog.cardinality(v_subjects) = 0 then
    raise exception 'registration_last_subject_required' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_subjects) not between 1 and 3 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentName', v_student_name,
    'schoolGrade', v_school_grade,
    'schoolName', v_school_name,
    'parentPhone', v_parent_phone,
    'studentPhone', v_student_phone,
    'campus', v_campus,
    'inquiryAt', p_inquiry_at,
    'requestNote', v_request_note,
    'priority', v_priority,
    'expectedCommonRevision', p_expected_common_revision,
    'expectedSubjects', pg_catalog.to_jsonb(v_expected_subjects),
    'subjects', pg_catalog.to_jsonb(v_subjects)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || p_task_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- registration_case_inquiry_task_row_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update of task;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- registration_case_inquiry_detail_row_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update of detail;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- registration_case_inquiry_track_row_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update of track;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id,
    null,
    'update_common'
  );

  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'save_inquiry'
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
      'notificationJobs',
      '[]'::jsonb
    );
    update dashboard_private.ops_registration_mutations mutation
    set response_payload = v_response
    where mutation.actor_id = v_actor_id
      and mutation.request_key = v_request_key
      and mutation.task_id = p_task_id
      and mutation.mutation_type = 'save_inquiry';
    if not found then
      raise exception 'registration_inquiry_receipt_missing' using errcode = '23514';
    end if;
    return v_response;
  end if;

  select coalesce(
    pg_catalog.array_agg(
      track.subject
      order by dashboard_private.registration_subject_sort_order(track.subject)
    ),
    array[]::text[]
  )
  into v_current_subjects
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;

  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '23514';
  end if;
  if v_current_subjects is distinct from v_expected_subjects then
    raise exception 'registration_subjects_conflict' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(
      candidate.value
      order by dashboard_private.registration_subject_sort_order(candidate.value)
    ),
    array[]::text[]
  )
  into v_added_subjects
  from pg_catalog.unnest(v_subjects) candidate(value)
  where not (candidate.value = any(v_current_subjects));

  -- Locks below retain the existing subject-removal safety boundary. Subject
  -- removal itself is intentionally unchanged by this migration.
  perform 1
  from public.ops_registration_level_tests level_test
  join public.ops_registration_subject_tracks track
    on track.id = level_test.track_id
  where track.task_id = p_task_id
  order by level_test.id
  for update of level_test;
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track
    on track.id = consultation.track_id
  where track.task_id = p_task_id
  order by consultation.id
  for update of consultation;
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track
    on track.id = enrollment.track_id
  where track.task_id = p_task_id
  order by enrollment.id
  for update of enrollment;

  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and not (track.subject = any(v_subjects))
    order by track.id
  loop
    if v_track.pipeline_status <> 'inquiry'
      or v_track.director_assignment_source in ('manual', 'migration')
      or exists (
        select 1
        from public.ops_registration_level_tests level_test
        where level_test.track_id = v_track.id
      )
      or exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.track_id = v_track.id
      )
      or exists (
        select 1
        from public.ops_registration_enrollments enrollment
        where enrollment.track_id = v_track.id
      )
      or exists (
        select 1
        from public.ops_task_events event_row
        where event_row.task_id = p_task_id
          and event_row.field_name = 'registration_track:' || v_track.id::text
          and not (
            event_row.event_type = 'registration_track_event'
            and coalesce(
              dashboard_private.try_registration_event_jsonb_object(
                event_row.after_value
              ) ->> 'event_type',
              dashboard_private.try_registration_event_jsonb_object(
                event_row.after_value
              ) ->> 'eventType'
            ) = 'director_default_resolved'
          )
      )
    then
      raise exception 'registration_subject_removal_blocked'
        using errcode = '23514';
    end if;
  end loop;

  -- registration_case_inquiry_prewrite_validation_complete
  v_subjects_changed := v_current_subjects is distinct from v_subjects;

  -- registration_case_inquiry_subject_writes
  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and not (track.subject = any(v_subjects))
    order by track.id
  loop
    insert into public.ops_task_events(
      task_id,
      actor_id,
      event_type,
      field_name,
      before_value,
      after_value
    ) values (
      p_task_id,
      v_actor_id,
      'registration_subject_removed',
      'registration_subject',
      v_track.subject,
      pg_catalog.jsonb_build_object(
        'version', 1,
        'actorId', v_actor_id,
        'trackId', v_track.id,
        'subject', v_track.subject,
        'directorProfileId', v_track.director_profile_id,
        'directorAssignmentSource', v_track.director_assignment_source,
        'directorAssignmentRuleKey', v_track.director_assignment_rule_key,
        'occurredAt', pg_catalog.now()
      )::text
    );
    delete from public.ops_registration_subject_tracks track
    where track.id = v_track.id;
  end loop;

  insert into public.ops_registration_subject_tracks(
    task_id,
    subject,
    pipeline_status,
    migration_review_required
  )
  select p_task_id, candidate.value, 'inquiry', false
  from pg_catalog.unnest(v_added_subjects) candidate(value)
  order by dashboard_private.registration_subject_sort_order(candidate.value);

  if (
    select pg_catalog.count(*)
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
  ) <> pg_catalog.cardinality(v_subjects)
    or exists (
      select 1
      from pg_catalog.unnest(v_subjects) expected(value)
      where not exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.task_id = p_task_id
          and track.subject = expected.value
      )
    )
  then
    raise exception 'registration_subject_track_coverage_mismatch'
      using errcode = '23514';
  end if;

  if v_subjects_changed then
    insert into public.ops_task_events(
      task_id,
      actor_id,
      event_type,
      field_name,
      before_value,
      after_value
    ) values (
      p_task_id,
      v_actor_id,
      'registration_subjects_synced',
      'registration_subjects',
      pg_catalog.to_jsonb(v_current_subjects)::text,
      pg_catalog.jsonb_build_object(
        'version', 1,
        'actorId', v_actor_id,
        'subjects', pg_catalog.to_jsonb(v_subjects),
        'occurredAt', pg_catalog.now()
      )::text
    );
  end if;

  v_common_response :=
    dashboard_private.update_registration_case_common_with_reminders_v1_impl(
      p_task_id,
      p_student_name,
      p_school_grade,
      p_school_name,
      p_parent_phone,
      p_student_phone,
      p_campus,
      p_inquiry_at,
      p_request_note,
      p_priority,
      p_expected_common_revision,
      v_request_key
    );

  select v_common_response || pg_catalog.jsonb_build_object(
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'tracks', coalesce(
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
        ) order by
          dashboard_private.registration_subject_sort_order(track.subject),
          track.id
      ),
      '[]'::jsonb
    )
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;

  update dashboard_private.ops_registration_mutations mutation
  set
    mutation_type = 'save_inquiry',
    target_fingerprint = v_target_fingerprint,
    response_payload = v_response
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key
    and mutation.task_id = p_task_id
    and mutation.mutation_type = 'update_common';
  if not found then
    raise exception 'registration_inquiry_receipt_missing' using errcode = '23514';
  end if;

  return v_response;
end;
$$;

alter function dashboard_private.update_registration_case_common_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) owner to postgres;
alter function dashboard_private.update_registration_case_common_with_reminders_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) owner to postgres;
alter function dashboard_private.save_registration_case_inquiry_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text,
  integer, text[], text[], text
) owner to postgres;

revoke all on function dashboard_private.update_registration_case_common_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.update_registration_case_common_with_reminders_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.update_registration_case_common_with_reminders_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) to authenticated;
revoke all on function dashboard_private.save_registration_case_inquiry_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text,
  integer, text[], text[], text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_case_inquiry_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text,
  integer, text[], text[], text
) to authenticated;

comment on function dashboard_private.update_registration_case_common_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) is 'Stores editable registration facts only; notification and admission readiness are separate actions.';
comment on function dashboard_private.update_registration_case_common_with_reminders_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) is 'Compatibility delegate returning notificationJobs=[] without reminder side effects.';
comment on function dashboard_private.save_registration_case_inquiry_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text,
  integer, text[], text[], text
) is 'Atomically stores editable common facts and subject additions without notification or admission side effects.';

commit;
