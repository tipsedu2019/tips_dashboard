begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Creating a registration case stores only the facts currently known. Missing
-- facts are valid until the explicit notification/admission actions evaluate
-- their own readiness.
create or replace function dashboard_private.create_registration_case_impl(
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
  v_effective_priority text;
  v_subjects text[];
  v_task_id uuid;
  v_target_fingerprint jsonb;
  v_legacy_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if not exists (
    select 1
    from public.profiles actor
    join auth.users account
      on account.id = actor.id
     and account.deleted_at is null
     and (
       account.banned_until is null
       or account.banned_until <= pg_catalog.now()
     )
    where actor.id = v_actor_id
      and actor.role in ('admin', 'staff')
  ) then
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
  v_effective_priority := coalesce(v_priority, 'normal');

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
  if pg_catalog.cardinality(v_subjects) not between 0 and 3 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;

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
    'priority', v_effective_priority
  );

  -- Preserve replay compatibility with pre-science direct-create receipts,
  -- whose two-subject fingerprint used lexical ordering.
  if pg_catalog.cardinality(v_subjects) > 0
    and not ('과학' = any(v_subjects))
  then
    select pg_catalog.jsonb_set(
      v_target_fingerprint,
      '{subjects}',
      pg_catalog.to_jsonb(
        pg_catalog.array_agg(
          legacy_subject.value
          order by pg_catalog.btrim(legacy_subject.value)
        )
      ),
      true
    )
    into v_legacy_target_fingerprint
    from pg_catalog.unnest(v_subjects) legacy_subject(value);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select
    mutation.response_payload,
    (
      mutation.mutation_type = 'create_case'
        and (
          mutation.target_fingerprint = v_target_fingerprint
          or (
            v_legacy_target_fingerprint is not null
            and mutation.target_fingerprint = v_legacy_target_fingerprint
          )
        )
    )
      or (
        -- Deployed workflow-shaped clients already own receipts under the old
        -- mutation type. Its four operational keys are now ignored inputs, so
        -- replay is determined only by the same flat facts as a new create.
        mutation.mutation_type = 'create_case_with_initial_workflow_v1'
        and (
          mutation.target_fingerprint
              - 'subjectPlans'
              - 'levelTestAppointment'
              - 'visitAppointment'
              - 'directorOverrides'
            = v_target_fingerprint
          or (
            v_legacy_target_fingerprint is not null
            and mutation.target_fingerprint
                - 'subjectPlans'
                - 'levelTestAppointment'
                - 'visitAppointment'
                - 'directorOverrides'
              = v_legacy_target_fingerprint
          )
        )
      )
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

  insert into public.ops_tasks(
    title,
    type,
    status,
    priority,
    requested_by,
    student_id,
    student_name,
    campus,
    subject,
    memo
  ) values (
    coalesce('등록: ' || v_student_name, '등록'),
    'registration',
    'requested',
    v_effective_priority,
    v_actor_id,
    null,
    v_student_name,
    v_campus,
    nullif(pg_catalog.array_to_string(v_subjects, ', '), ''),
    null
  )
  returning id into v_task_id;

  insert into public.ops_registration_details(
    task_id,
    inquiry_at,
    school_grade,
    school_name,
    parent_phone,
    student_phone,
    request_note,
    common_revision
  ) values (
    v_task_id,
    p_inquiry_at,
    v_school_grade,
    v_school_name,
    v_parent_phone,
    v_student_phone,
    v_request_note,
    1
  );

  insert into public.ops_registration_subject_tracks(
    task_id,
    subject,
    pipeline_status,
    migration_review_required
  )
  select v_task_id, subject.value, 'inquiry', false
  from pg_catalog.unnest(v_subjects) subject(value)
  order by dashboard_private.registration_subject_sort_order(subject.value);

  insert into public.ops_task_events(
    task_id,
    actor_id,
    event_type,
    field_name,
    before_value,
    after_value
  ) values (
    v_task_id,
    v_actor_id,
    'registration_case_created',
    'registration_case',
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'actorId', v_actor_id,
      'commonRevision', 1,
      'studentName', v_student_name,
      'schoolGrade', v_school_grade,
      'schoolName', v_school_name,
      'campus', v_campus,
      'inquiryAt', p_inquiry_at,
      'subjects', pg_catalog.to_jsonb(v_subjects),
      'priority', v_effective_priority,
      'occurredAt', pg_catalog.now()
    )::text
  );

  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', 1,
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
  where track.task_id = v_task_id;

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
    'create_case',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function public.create_registration_case(
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
  p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.create_registration_case_impl(
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
    p_request_key
  );
$$;

-- Keep the legacy RPC signature for deployed clients. Workflow plans,
-- appointments, director overrides, reminder creation, and notification
-- targets are intentionally ignored; each is now an explicit later action.
create or replace function public.create_registration_case_with_initial_workflow_v1(
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
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.create_registration_case_impl(
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
    p_request_key
  ) || pg_catalog.jsonb_build_object(
    'appointments', '[]'::jsonb,
    'notificationTargets', '[]'::jsonb,
    'notificationJobs', '[]'::jsonb
  );
$$;

alter function dashboard_private.create_registration_case_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) owner to postgres;
alter function public.create_registration_case(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) owner to postgres;
alter function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) owner to postgres;

revoke all on function dashboard_private.create_registration_case_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.create_registration_case_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) to authenticated;

revoke all on function public.create_registration_case(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_registration_case(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) to authenticated;

revoke all on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) to authenticated;

revoke all on function dashboard_private.create_registration_case_with_reminders_v1_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;

comment on function dashboard_private.create_registration_case_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) is 'Creates a registration fact row with zero to three optional subjects and no operational side effects.';
comment on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) is 'Compatibility RPC that creates facts only and returns empty operational arrays.';

commit;
