begin;

select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local role postgres;

select ok(
  (
    select pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any(
        array['search_path=', 'search_path=""']::text[]
      )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)'::regprocedure
  ),
  'flat create implementation keeps the postgres-owned empty-search-path security boundary'
);

select ok(
  (
    select pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and not procedure.prosecdef
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any(
        array['search_path=', 'search_path=""']::text[]
      )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'public.create_registration_case(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)'::regprocedure
  ),
  'public flat create wrapper remains a postgres-owned empty-search-path invoker'
);

select ok(
  (
    select pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and not procedure.prosecdef
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any(
        array['search_path=', 'search_path=""']::text[]
      )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'public.create_registration_case_with_initial_workflow_v1(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure
  ),
  'legacy create wrapper remains a postgres-owned empty-search-path invoker'
);

select is(
  pg_catalog.jsonb_build_object(
    'createImplAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)',
      'EXECUTE'
    ),
    'createImplAnon', pg_catalog.has_function_privilege(
      'anon',
      'dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)',
      'EXECUTE'
    ),
    'createImplService', pg_catalog.has_function_privilege(
      'service_role',
      'dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)',
      'EXECUTE'
    ),
    'createPublicAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_registration_case(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)',
      'EXECUTE'
    ),
    'createPublicAnon', pg_catalog.has_function_privilege(
      'anon',
      'public.create_registration_case(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)',
      'EXECUTE'
    ),
    'createPublicService', pg_catalog.has_function_privilege(
      'service_role',
      'public.create_registration_case(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)',
      'EXECUTE'
    ),
    'legacyPublicAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_registration_case_with_initial_workflow_v1(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)',
      'EXECUTE'
    ),
    'legacyPublicAnon', pg_catalog.has_function_privilege(
      'anon',
      'public.create_registration_case_with_initial_workflow_v1(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)',
      'EXECUTE'
    ),
    'legacyPublicService', pg_catalog.has_function_privilege(
      'service_role',
      'public.create_registration_case_with_initial_workflow_v1(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)',
      'EXECUTE'
    ),
    'reminderImplAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'dashboard_private.create_registration_case_with_reminders_v1_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)',
      'EXECUTE'
    ),
    'reminderImplAnon', pg_catalog.has_function_privilege(
      'anon',
      'dashboard_private.create_registration_case_with_reminders_v1_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)',
      'EXECUTE'
    ),
    'reminderImplService', pg_catalog.has_function_privilege(
      'service_role',
      'dashboard_private.create_registration_case_with_reminders_v1_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)',
      'EXECUTE'
    )
  ),
  '{"createImplAnon":false,"createImplAuthenticated":true,"createImplService":false,"createPublicAnon":false,"createPublicAuthenticated":true,"createPublicService":false,"legacyPublicAnon":false,"legacyPublicAuthenticated":true,"legacyPublicService":false,"reminderImplAnon":false,"reminderImplAuthenticated":false,"reminderImplService":false}'::jsonb,
  'only authenticated callers can reach the two public flat-create paths'
);

select ok(
  (
    select definition like '%from public.profiles actor%'
      and definition like '%join auth.users account%'
      and definition like '%account.deleted_at is null%'
      and definition like '%account.banned_until%'
      and definition like '%pg_catalog.pg_advisory_xact_lock%'
      and definition like '%dashboard_private.ops_registration_mutations%'
      and definition like '%create_case_with_initial_workflow_v1%'
      and definition like '%''subjectPlans''%'
      and definition like '%''levelTestAppointment''%'
      and definition like '%''visitAppointment''%'
      and definition like '%''directorOverrides''%'
      and definition like '%registration_case_created%'
      and definition like '%public.ops_task_events%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)'::regprocedure
      ) as definition
    ) source
  ),
  'flat create retains active-manager authorization, request locking, idempotency, and audit'
);

select ok(
  (
    select definition not like '%registration_student_name_required%'
      and definition not like '%registration_school_grade_required%'
      and definition not like '%registration_parent_phone_invalid%'
      and definition not like '%registration_inquiry_at_required%'
      and definition not like '%assert_registration_subject_enabled%'
      and definition not like '%registration_science_grade_invalid%'
      and definition not like '%recompute_registration_parent%'
      and definition not like '%ops_registration_admission_batches%'
      and definition not like '%ops_registration_messages%'
      and definition not like '%ops_registration_enrollments%'
      and definition not like '%ops_registration_appointments%'
      and definition not like '%notification_%'
      and definition not like '%reminder%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)'::regprocedure
      ) as definition
    ) source
  ),
  'flat creation has no completeness, subject-capability, admission, or notification gate'
);

select ok(
  (
    select definition like '%registration_subject_unsupported%'
      and definition like '%registration_subject_invalid%'
      and definition not like '%registration_subjects_required%'
      and definition like '%registration_campus_invalid%'
      and definition like '%registration_priority_invalid%'
      and definition like '%coalesce(v_priority, ''normal'')%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)'::regprocedure
      ) as definition
    ) source
  ),
  'flat creation accepts zero subjects while validating only supplied enum values'
);

select ok(
  (
    select definition like '%dashboard_private.create_registration_case_impl%'
      and definition not like '%create_registration_case_with_reminders_v1_impl%'
      and definition not like '%create_registration_case_with_initial_workflow_v1_impl%'
      and definition not like '%assert_registration_intake_runtime%'
      and definition like '%''appointments''%''[]''::jsonb%'
      and definition like '%''notificationTargets''%''[]''::jsonb%'
      and definition like '%''notificationJobs''%''[]''::jsonb%'
    from (
      select pg_catalog.pg_get_functiondef(
        'public.create_registration_case_with_initial_workflow_v1(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure
      ) as definition
    ) source
  ),
  'legacy workflow-shaped create is a fact-only compatibility delegate'
);

select ok(
  (
    select create_definition not like '%40001%'
      and public_definition not like '%40001%'
      and legacy_definition not like '%40001%'
      and create_definition like
        '%registration_access_denied'' using errcode = ''42501''%'
      and create_definition like
        '%idempotency_key_reused'' using errcode = ''22023''%'
    from (
      select
        pg_catalog.pg_get_functiondef(
          'dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)'::regprocedure
        ) as create_definition,
        pg_catalog.pg_get_functiondef(
          'public.create_registration_case(text,text,text,text,text,text,timestamp with time zone,text[],text,text,text)'::regprocedure
        ) as public_definition,
        pg_catalog.pg_get_functiondef(
          'public.create_registration_case_with_initial_workflow_v1(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure
        ) as legacy_definition
    ) source
  ),
  'flat create paths contain no retryable domain SQLSTATE'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, banned_until, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '99100000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-case-admin@example.invalid',
    crypt('flat-case-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-flat-case"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99100000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-case-staff@example.invalid',
    crypt('flat-case-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-flat-case"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99100000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-case-teacher@example.invalid',
    crypt('flat-case-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-flat-case"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99100000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-case-banned@example.invalid',
    crypt('flat-case-runtime-only', gen_salt('bf')),
    pg_catalog.now(), pg_catalog.now() + interval '1 day',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-flat-case"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '99100000-0000-4000-8000-000000000001', 'admin', '단순생성 관리자',
    'flat-case-admin@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99100000-0000-4000-8000-000000000002', 'staff', '단순생성 관리팀',
    'flat-case-staff@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99100000-0000-4000-8000-000000000003', 'teacher', '단순생성 교사',
    'flat-case-teacher@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99100000-0000-4000-8000-000000000004', 'staff', '단순생성 정지직원',
    'flat-case-banned@example.invalid', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

update public.academic_subject_settings
set is_active = false,
    registration_create_enabled = false
where subject = '과학';

create temporary table registration_flat_case_notification_before
on commit drop
as
select
  (select pg_catalog.count(*) from dashboard_private.notification_events) as event_count,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_event_fanout_jobs
  ) as fanout_job_count,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_deliveries
  ) as delivery_count,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'notification_external_attempt'
      and audit.action = 'external_attempt_registered'
  ) as external_attempt_count;

grant select on registration_flat_case_notification_before to authenticated;

create temporary table registration_flat_case_results(
  case_key text primary key,
  response jsonb not null
) on commit drop;

grant select, insert on registration_flat_case_results to authenticated;

create or replace function pg_temp.registration_flat_case_set_actor(p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (
        select profile.email
        from public.profiles profile
        where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

set local role authenticated;
select pg_temp.registration_flat_case_set_actor(
  '99100000-0000-4000-8000-000000000003'
);

select throws_ok(
  $$
    select public.create_registration_case(
      null, null, null, 'teacher-provisional-phone', null,
      null, null, array[]::text[], null, null,
      'flat-case-teacher-denied'
    )
  $$,
  '42501',
  'registration_access_denied',
  'teachers cannot create registration rows'
);

select pg_temp.registration_flat_case_set_actor(
  '99100000-0000-4000-8000-000000000004'
);

select throws_ok(
  $$
    select public.create_registration_case(
      null, null, null, 'banned-provisional-phone', null,
      null, null, array[]::text[], null, null,
      'flat-case-banned-denied'
    )
  $$,
  '42501',
  'registration_access_denied',
  'a banned staff account cannot create registration rows'
);

select pg_temp.registration_flat_case_set_actor(
  '99100000-0000-4000-8000-000000000001'
);

select throws_ok(
  $$
    select public.create_registration_case(
      null, null, null, null, null,
      '제3관', null, array[]::text[], null, null,
      'flat-case-campus-invalid'
    )
  $$,
  '22023',
  'registration_campus_invalid',
  'a supplied campus still uses the exact enum'
);

select throws_ok(
  $$
    select public.create_registration_case(
      null, null, null, null, null,
      null, null, array[]::text[], null, 'critical',
      'flat-case-priority-invalid'
    )
  $$,
  '22023',
  'registration_priority_invalid',
  'a supplied priority still uses the exact enum'
);

select throws_ok(
  $$
    select public.create_registration_case(
      null, null, null, null, null,
      null, null, array['음악']::text[], null, null,
      'flat-case-subject-invalid'
    )
  $$,
  '22023',
  'registration_subject_unsupported',
  'subjects remain a zero-to-three subset of the canonical registry'
);

select throws_ok(
  $$
    select public.create_registration_case(
      null, null, null, null, null,
      null, null, array[]::text[], null, null,
      ' '
    )
  $$,
  '22023',
  'request_key_required',
  'flat creation still requires an idempotency key'
);

insert into registration_flat_case_results(case_key, response)
select
  'blank-admin',
  public.create_registration_case(
    ' ', '', '', 'provisional-parent-phone', 'student-contact-later',
    '', null, array[]::text[], '', '',
    'flat-case-admin-blank'
  );

select is(
  (
    select pg_catalog.jsonb_build_object(
      'commonRevision', result.response -> 'commonRevision',
      'subjects', result.response -> 'subjects',
      'tracks', result.response -> 'tracks'
    )
    from registration_flat_case_results result
    where result.case_key = 'blank-admin'
  ),
  '{"commonRevision":1,"subjects":[],"tracks":[]}'::jsonb,
  'blank fact creation returns one common revision with zero subjects and tracks'
);

select ok(
  (
    select task.title = '등록'
      and task.student_name is null
      and task.campus is null
      and task.priority = 'normal'
      and task.status = 'requested'
      and task.subject is null
      and task.student_id is null
      and task.requested_by = '99100000-0000-4000-8000-000000000001'
      and detail.inquiry_at is null
      and detail.school_grade is null
      and detail.school_name is null
      and detail.parent_phone = 'provisional-parent-phone'
      and detail.student_phone = 'student-contact-later'
      and detail.request_note is null
      and detail.common_revision = 1
    from registration_flat_case_results result
    join public.ops_tasks task
      on task.id = (result.response ->> 'taskId')::uuid
    join public.ops_registration_details detail on detail.task_id = task.id
    where result.case_key = 'blank-admin'
  ),
  'blank and provisional facts persist with safe defaults and no parent-status recompute'
);

select ok(
  (
    select not exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.task_id = (result.response ->> 'taskId')::uuid
    )
    from registration_flat_case_results result
    where result.case_key = 'blank-admin'
  ),
  'zero-subject creation writes no synthetic track'
);

select is(
  public.create_registration_case(
    ' ', '', '', 'provisional-parent-phone', 'student-contact-later',
    '', null, array[]::text[], '', '',
    'flat-case-admin-blank'
  ),
  (
    select result.response
    from registration_flat_case_results result
    where result.case_key = 'blank-admin'
  ),
  'flat creation replays the exact stored response'
);

select throws_ok(
  $$
    select public.create_registration_case(
      'changed', null, null, 'provisional-parent-phone', null,
      null, null, array[]::text[], null, null,
      'flat-case-admin-blank'
    )
  $$,
  '22023',
  'idempotency_key_reused',
  'flat creation rejects a reused key with a different fact payload'
);

reset role;

insert into dashboard_private.ops_registration_mutations(
  actor_id,
  request_key,
  task_id,
  mutation_type,
  target_fingerprint,
  response_payload
)
select
  '99100000-0000-4000-8000-000000000001',
  'flat-case-seeded-legacy-replay',
  (result.response ->> 'taskId')::uuid,
  'create_case_with_initial_workflow_v1',
  pg_catalog.jsonb_build_object(
    'studentName', '기존 재시도',
    'schoolGrade', '초6',
    'schoolName', '기존학교',
    'parentPhone', '010-1111-2222',
    'studentPhone', null,
    'campus', '본관',
    'inquiryAt', '2026-09-01 09:00:00+09'::timestamptz,
    'subjects', pg_catalog.to_jsonb(array['영어', '수학']::text[]),
    'requestNote', '기존 메모',
    'priority', 'normal',
    'subjectPlans', '{"영어":"level_test","수학":"visit_consultation"}'::jsonb,
    'levelTestAppointment', '{"scheduledAt":"2026-09-02T01:00:00Z"}'::jsonb,
    'visitAppointment', '{"scheduledAt":"2026-09-03T01:00:00Z"}'::jsonb,
    'directorOverrides', '{}'::jsonb
  ),
  pg_catalog.jsonb_build_object(
    'taskId', (result.response ->> 'taskId')::uuid,
    'commonRevision', 1,
    'subjects', pg_catalog.to_jsonb(array['영어', '수학']::text[]),
    'tracks', '[]'::jsonb,
    'appointments', '[{"id":"legacy-appointment"}]'::jsonb,
    'notificationTargets', '[{"id":"legacy-target"}]'::jsonb,
    'notificationJobs', '[{"id":"legacy-job"}]'::jsonb,
    'legacyReplay', true
  )
from registration_flat_case_results result
where result.case_key = 'blank-admin';

insert into registration_flat_case_results(case_key, response)
select 'seeded-legacy-replay', mutation.response_payload
from dashboard_private.ops_registration_mutations mutation
where mutation.actor_id = '99100000-0000-4000-8000-000000000001'
  and mutation.request_key = 'flat-case-seeded-legacy-replay';

set local role authenticated;
select pg_temp.registration_flat_case_set_actor(
  '99100000-0000-4000-8000-000000000001'
);

select is(
  dashboard_private.create_registration_case_impl(
    '기존 재시도', '초6', '기존학교', '010-1111-2222', null,
    '본관', '2026-09-01 09:00:00+09'::timestamptz,
    array['영어', '수학']::text[], '기존 메모', 'normal',
    'flat-case-seeded-legacy-replay'
  ),
  (
    select result.response
    from registration_flat_case_results result
    where result.case_key = 'seeded-legacy-replay'
  ),
  'flat create core replays the exact stored legacy workflow receipt by flat facts'
);

select is(
  public.create_registration_case_with_initial_workflow_v1(
    '기존 재시도', '초6', '기존학교', '010-1111-2222', null,
    '본관', '2026-09-01 09:00:00+09'::timestamptz,
    array['영어', '수학']::text[], '기존 메모', 'normal',
    '{"ignored":"new-plan"}'::jsonb,
    '{"ignored":"new-level-test"}'::jsonb,
    '{"ignored":"new-visit"}'::jsonb,
    '{"ignored":"new-director"}'::jsonb,
    'flat-case-seeded-legacy-replay'
  ),
  (
    select result.response || pg_catalog.jsonb_build_object(
      'appointments', '[]'::jsonb,
      'notificationTargets', '[]'::jsonb,
      'notificationJobs', '[]'::jsonb
    )
    from registration_flat_case_results result
    where result.case_key = 'seeded-legacy-replay'
  ),
  'legacy wrapper replays by flat facts but overwrites stored operational work with empty no-send arrays'
);

select pg_temp.registration_flat_case_set_actor(
  '99100000-0000-4000-8000-000000000002'
);

insert into registration_flat_case_results(case_key, response)
select
  'legacy-staff',
  public.create_registration_case_with_initial_workflow_v1(
    '임시 등록', '', '', 'phone-format-not-ready', null,
    null, null, array['과학', '영어', '수학']::text[], null, null,
    '{"ignored":true}'::jsonb,
    '{"kind":"ignored-level-test"}'::jsonb,
    '{"kind":"ignored-visit"}'::jsonb,
    '["ignored-director"]'::jsonb,
    'flat-case-legacy-staff'
  );

select is(
  (
    select pg_catalog.jsonb_build_object(
      'appointments', result.response -> 'appointments',
      'notificationTargets', result.response -> 'notificationTargets',
      'notificationJobs', result.response -> 'notificationJobs'
    )
    from registration_flat_case_results result
    where result.case_key = 'legacy-staff'
  ),
  '{"appointments":[],"notificationJobs":[],"notificationTargets":[]}'::jsonb,
  'legacy workflow-shaped create returns only empty operational compatibility arrays'
);

select ok(
  (
    select task.title = '등록: 임시 등록'
      and task.status = 'requested'
      and task.priority = 'normal'
      and detail.school_grade is null
      and detail.parent_phone = 'phone-format-not-ready'
      and detail.inquiry_at is null
      and (
        select pg_catalog.array_agg(
          track.subject
          order by case track.subject
            when '영어' then 1
            when '수학' then 2
            when '과학' then 3
            else 99
          end
        )
        from public.ops_registration_subject_tracks track
        where track.task_id = task.id
      ) = array['영어', '수학', '과학']::text[]
    from registration_flat_case_results result
    join public.ops_tasks task
      on task.id = (result.response ->> 'taskId')::uuid
    join public.ops_registration_details detail on detail.task_id = task.id
    where result.case_key = 'legacy-staff'
  ),
  'active staff can store all three subjects without grade or capability gates'
);

reset role;

select ok(
  (
    select pg_catalog.count(*) = 2
    from dashboard_private.ops_registration_mutations mutation
    where mutation.request_key in (
      'flat-case-admin-blank',
      'flat-case-legacy-staff'
    )
      and mutation.mutation_type = 'create_case'
  )
  and (
    select pg_catalog.count(*) = 2
    from public.ops_task_events event_row
    where event_row.event_type = 'registration_case_created'
      and event_row.task_id in (
        select (result.response ->> 'taskId')::uuid
        from registration_flat_case_results result
      )
  ),
  'each created fact row has one receipt and one audit event despite replay'
);

select ok(
  not exists (
    select 1
    from public.ops_registration_appointments appointment
    where appointment.task_id in (
      select (result.response ->> 'taskId')::uuid
      from registration_flat_case_results result
    )
  )
  and not exists (
    select 1
    from public.ops_registration_admission_batches batch
    where batch.task_id in (
      select (result.response ->> 'taskId')::uuid
      from registration_flat_case_results result
    )
  )
  and not exists (
    select 1
    from public.ops_registration_messages message
    where message.task_id in (
      select (result.response ->> 'taskId')::uuid
      from registration_flat_case_results result
    )
  )
  and not exists (
    select 1
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where track.task_id in (
      select (result.response ->> 'taskId')::uuid
      from registration_flat_case_results result
    )
  ),
  'flat creation writes no appointment, admission batch, message, or enrollment'
);

select ok(
  (select pg_catalog.count(*) from dashboard_private.notification_events) =
    (select before.event_count from registration_flat_case_notification_before before)
  and (
    select pg_catalog.count(*)
    from dashboard_private.notification_event_fanout_jobs
  ) = (
    select before.fanout_job_count
    from registration_flat_case_notification_before before
  )
  and (
    select pg_catalog.count(*)
    from dashboard_private.notification_deliveries
  ) = (
    select before.delivery_count
    from registration_flat_case_notification_before before
  )
  and (
    select pg_catalog.count(*)
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'notification_external_attempt'
      and audit.action = 'external_attempt_registered'
  ) = (
    select before.external_attempt_count
    from registration_flat_case_notification_before before
  ),
  'flat creation records no notification event, job, delivery, or provider-send evidence'
);

select ok(
  not exists (
    select 1
    from dashboard_private.ops_registration_mutations mutation
    where mutation.request_key in (
      'flat-case-teacher-denied',
      'flat-case-banned-denied',
      'flat-case-campus-invalid',
      'flat-case-priority-invalid',
      'flat-case-subject-invalid'
    )
  ),
  'denied and invalid creation attempts are zero-write'
);

select * from finish();
rollback;
