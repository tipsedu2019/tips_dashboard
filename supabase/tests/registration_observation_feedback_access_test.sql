begin;
select plan(21);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  deleted_at, banned_until, created_at, updated_at
)
values
  ('99250000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-assigned@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99250000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-admin@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99250000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-staff@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99250000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-director@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99250000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-unrelated@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99250000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-banned-admin@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, now() + interval '1 day', now(), now());

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('99250000-0000-4000-8000-000000000001', 'teacher', '담당 교사', 'feedback-assigned@example.invalid', now(), now()),
  ('99250000-0000-4000-8000-000000000002', 'admin', '대리 관리자', 'feedback-admin@example.invalid', now(), now()),
  ('99250000-0000-4000-8000-000000000003', 'staff', '운영 스태프', 'feedback-staff@example.invalid', now(), now()),
  ('99250000-0000-4000-8000-000000000004', 'teacher', '담당 원장', 'feedback-director@example.invalid', now(), now()),
  ('99250000-0000-4000-8000-000000000005', 'teacher', '무관 교사', 'feedback-unrelated@example.invalid', now(), now()),
  ('99250000-0000-4000-8000-000000000006', 'admin', '차단 관리자', 'feedback-banned-admin@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id in (
  '99250000-0000-4000-8000-000000000001',
  '99250000-0000-4000-8000-000000000002',
  '99250000-0000-4000-8000-000000000003',
  '99250000-0000-4000-8000-000000000004',
  '99250000-0000-4000-8000-000000000005',
  '99250000-0000-4000-8000-000000000006'
);

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email,
  dashboard_role
)
values (
  '99250000-0000-4000-8000-000000000110', '피드백 담당 교사',
  array['영어']::text[], true, 9925,
  '99250000-0000-4000-8000-000000000001',
  'feedback-assigned@example.invalid', 'teacher'
);
update public.profiles
set teacher_catalog_id = '99250000-0000-4000-8000-000000000110'
where id = '99250000-0000-4000-8000-000000000001';

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  '99250000-0000-4000-8000-000000000111', '피드백 101호',
  array['영어']::text[], true, 9925, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
values
  (
    '99250000-0000-4000-8000-000000000101', '피드백 정규반',
    '영어', '수업 진행 중', 'normalized', '{"sessions":[]}'::jsonb
  ),
  (
    '99250000-0000-4000-8000-000000000102', '피드백 legacy반',
    '영어', '수업 진행 중', 'legacy', '{"sessions":[]}'::jsonb
  );

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '99250000-0000-4000-8000-000000000101',
    '99250000-0000-4000-8000-000000000001',
    'registration_observation_feedback_access_test'
  );
end;
$$;

insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state, start_time, end_time,
  teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id,
  classroom_name_snapshot, origin, revision
)
values (
  '99250000-0000-4000-8000-000000000112',
  '99250000-0000-4000-8000-000000000101',
  'feedback-normalized-session', current_date + 7, 'active', '18:00', '20:00',
  '99250000-0000-4000-8000-000000000110', '담당 교사',
  '99250000-0000-4000-8000-000000000111', '피드백 101호',
  'manual', 7
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values
  ('99250000-0000-4000-8000-000000000201', '피드백 normalized', 'registration', 'requested', 'normal', '99250000-0000-4000-8000-000000000002', '정규 학생'),
  ('99250000-0000-4000-8000-000000000202', '피드백 legacy proxy', 'registration', 'requested', 'normal', '99250000-0000-4000-8000-000000000002', '대리 학생'),
  ('99250000-0000-4000-8000-000000000203', '피드백 legacy assigned', 'registration', 'requested', 'normal', '99250000-0000-4000-8000-000000000002', '직접 학생');

insert into public.ops_registration_details(
  task_id, school_grade, school_name, parent_phone, student_phone, request_note
)
values
  ('99250000-0000-4000-8000-000000000201', '고1', '비공개고', '01011112222', '01011113333', '비공개 문의'),
  ('99250000-0000-4000-8000-000000000202', '중3', '숨김중', '01022223333', '01022224444', '숨김 메모'),
  ('99250000-0000-4000-8000-000000000203', '고2', '내부고', '01033334444', '01033335555', '내부 메모');

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values
  ('99250000-0000-4000-8000-000000000301', '99250000-0000-4000-8000-000000000201', '영어', 'consultation_waiting', '99250000-0000-4000-8000-000000000004', 'manual', now(), false, 'observation_requested', 6, now(), 'consultation_completed', 1),
  ('99250000-0000-4000-8000-000000000302', '99250000-0000-4000-8000-000000000202', '영어', 'consultation_waiting', '99250000-0000-4000-8000-000000000004', 'manual', now(), false, 'observation_completed', 9, now(), 'consultation_completed', 1),
  ('99250000-0000-4000-8000-000000000303', '99250000-0000-4000-8000-000000000203', '영어', 'consultation_waiting', '99250000-0000-4000-8000-000000000004', 'manual', now(), false, 'observation_completed', 4, now(), 'consultation_completed', 1);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision,
  created_by
)
values
  ('99250000-0000-4000-8000-000000000401', '99250000-0000-4000-8000-000000000201', 'observation_class', ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 2, '99250000-0000-4000-8000-000000000002'),
  ('99250000-0000-4000-8000-000000000402', '99250000-0000-4000-8000-000000000202', 'observation_class', ((current_date - 7 + time '17:00') at time zone 'Asia/Seoul'), '본관', 'completed', 3, '99250000-0000-4000-8000-000000000002'),
  ('99250000-0000-4000-8000-000000000403', '99250000-0000-4000-8000-000000000203', 'observation_class', ((current_date - 14 + time '16:00') at time zone 'Asia/Seoul'), '본관', 'completed', 4, '99250000-0000-4000-8000-000000000002');

insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, status, attendance,
  attendance_recorded_by, attendance_recorded_at, suitability_result,
  feedback_reason, feedback_submitted_by, feedback_submitted_at,
  feedback_revision, revision, created_by, updated_by
)
values
  (
    '99250000-0000-4000-8000-000000000501',
    '99250000-0000-4000-8000-000000000201',
    '99250000-0000-4000-8000-000000000301',
    '99250000-0000-4000-8000-000000000401',
    '99250000-0000-4000-8000-000000000101',
    'normalized', '99250000-0000-4000-8000-000000000112', null,
    current_date + 7,
    ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'),
    ((current_date + 7 + time '20:00') at time zone 'Asia/Seoul'),
    'active', 7, null,
    '{"authority":"normalized","sessionId":"99250000-0000-4000-8000-000000000112","revision":7}'::jsonb,
    repeat('a', 64), '99250000-0000-4000-8000-000000000110',
    '99250000-0000-4000-8000-000000000001',
    '99250000-0000-4000-8000-000000000111', '영어', '피드백 정규반',
    '담당 교사', '피드백 101호', '본관', 'scheduled', null,
    null, null, null, null, null, null, 0, 4,
    '99250000-0000-4000-8000-000000000002',
    '99250000-0000-4000-8000-000000000002'
  ),
  (
    '99250000-0000-4000-8000-000000000502',
    '99250000-0000-4000-8000-000000000202',
    '99250000-0000-4000-8000-000000000302',
    '99250000-0000-4000-8000-000000000402',
    '99250000-0000-4000-8000-000000000102',
    'legacy', null, 'feedback-legacy-proxy', current_date - 7,
    ((current_date - 7 + time '17:00') at time zone 'Asia/Seoul'),
    ((current_date - 7 + time '19:00') at time zone 'Asia/Seoul'),
    'active', null, repeat('b', 64),
    pg_catalog.jsonb_build_object(
      'authority', 'legacy', 'sessionKey', 'feedback-legacy-proxy',
      'contentHash', repeat('b', 64)
    ),
    repeat('c', 64), '99250000-0000-4000-8000-000000000110',
    '99250000-0000-4000-8000-000000000001',
    '99250000-0000-4000-8000-000000000111', '영어', '피드백 legacy반',
    '담당 교사', '피드백 101호', '본관', 'completed', 'attended',
    '99250000-0000-4000-8000-000000000002', '2026-08-09 03:00:00+00',
    'fit', '대리 입력 피드백', '99250000-0000-4000-8000-000000000002',
    '2026-08-09 03:04:05+00', 2, 8,
    '99250000-0000-4000-8000-000000000002',
    '99250000-0000-4000-8000-000000000002'
  ),
  (
    '99250000-0000-4000-8000-000000000503',
    '99250000-0000-4000-8000-000000000203',
    '99250000-0000-4000-8000-000000000303',
    '99250000-0000-4000-8000-000000000403',
    '99250000-0000-4000-8000-000000000102',
    'legacy', null, 'feedback-legacy-assigned', current_date - 14,
    ((current_date - 14 + time '16:00') at time zone 'Asia/Seoul'),
    ((current_date - 14 + time '18:00') at time zone 'Asia/Seoul'),
    'active', null, repeat('d', 64),
    pg_catalog.jsonb_build_object(
      'authority', 'legacy', 'sessionKey', 'feedback-legacy-assigned',
      'contentHash', repeat('d', 64)
    ),
    repeat('e', 64), '99250000-0000-4000-8000-000000000110',
    '99250000-0000-4000-8000-000000000001',
    '99250000-0000-4000-8000-000000000111', '영어', '피드백 legacy반',
    '담당 교사', '피드백 101호', '본관', 'completed', 'attended',
    '99250000-0000-4000-8000-000000000001', '2026-08-02 04:00:00+00',
    'unfit', '담당 교사 피드백', '99250000-0000-4000-8000-000000000001',
    '2026-08-02 04:05:00+00', 1, 5,
    '99250000-0000-4000-8000-000000000002',
    '99250000-0000-4000-8000-000000000002'
  );

create or replace function pg_temp.feedback_access_set_actor(p_actor uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated'
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.feedback_access_read(
  p_actor uuid,
  p_observation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.feedback_access_set_actor(p_actor);
  execute 'set local role authenticated';
  select public.get_registration_observation_feedback_v1(p_observation_id)
  into v_result;
  execute 'reset role';
  return v_result;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.feedback_access_error_probe(
  p_actor uuid,
  p_observation_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_temp.feedback_access_read(p_actor, p_observation_id);
  raise exception 'feedback_access_unexpected_success' using errcode = 'P0001';
end;
$$;

select function_returns(
  'dashboard_private',
  'assert_registration_observation_feedback_access_v1',
  array['uuid', 'text'],
  'jsonb',
  'feedback row access helper keeps the exact jsonb signature'
);
select function_returns(
  'dashboard_private',
  'get_registration_observation_feedback_impl_v1',
  array['uuid'],
  'jsonb',
  'feedback private read keeps the exact jsonb signature'
);
select function_returns(
  'public',
  'get_registration_observation_feedback_v1',
  array['uuid'],
  'jsonb',
  'feedback public read keeps the exact jsonb signature'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'access', pg_catalog.jsonb_build_object(
        'definer', access_function.prosecdef,
        'stable', access_function.provolatile = 's',
        'owner', pg_catalog.pg_get_userbyid(access_function.proowner),
        'emptySearchPath', exists (
          select 1
          from pg_catalog.unnest(coalesce(access_function.proconfig, '{}'::text[])) config(setting)
          where config.setting in ('search_path=', 'search_path=""')
        )
      ),
      'implementation', pg_catalog.jsonb_build_object(
        'definer', implementation_function.prosecdef,
        'stable', implementation_function.provolatile = 's',
        'owner', pg_catalog.pg_get_userbyid(implementation_function.proowner),
        'emptySearchPath', exists (
          select 1
          from pg_catalog.unnest(coalesce(implementation_function.proconfig, '{}'::text[])) config(setting)
          where config.setting in ('search_path=', 'search_path=""')
        )
      ),
      'wrapper', pg_catalog.jsonb_build_object(
        'definer', wrapper_function.prosecdef,
        'stable', wrapper_function.provolatile = 's',
        'owner', pg_catalog.pg_get_userbyid(wrapper_function.proowner),
        'emptySearchPath', exists (
          select 1
          from pg_catalog.unnest(coalesce(wrapper_function.proconfig, '{}'::text[])) config(setting)
          where config.setting in ('search_path=', 'search_path=""')
        )
      )
    )
    from pg_catalog.pg_proc access_function
    cross join pg_catalog.pg_proc implementation_function
    cross join pg_catalog.pg_proc wrapper_function
    where access_function.oid = pg_catalog.to_regprocedure(
        'dashboard_private.assert_registration_observation_feedback_access_v1(uuid,text)'
      )
      and implementation_function.oid = pg_catalog.to_regprocedure(
        'dashboard_private.get_registration_observation_feedback_impl_v1(uuid)'
      )
      and wrapper_function.oid = pg_catalog.to_regprocedure(
        'public.get_registration_observation_feedback_v1(uuid)'
      )
  ),
  '{"access":{"definer":true,"emptySearchPath":true,"owner":"postgres","stable":true},"implementation":{"definer":true,"emptySearchPath":true,"owner":"postgres","stable":true},"wrapper":{"definer":false,"emptySearchPath":true,"owner":"postgres","stable":true}}'::jsonb,
  'feedback read keeps definer private functions and one public security invoker wrapper'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'accessAuthenticated', pg_catalog.has_function_privilege('authenticated', access_function.oid, 'EXECUTE'),
      'accessAnon', pg_catalog.has_function_privilege('anon', access_function.oid, 'EXECUTE'),
      'accessServiceRole', pg_catalog.has_function_privilege('service_role', access_function.oid, 'EXECUTE'),
      'accessPublic', exists (
        select 1
        from pg_catalog.aclexplode(coalesce(
          access_function.proacl,
          pg_catalog.acldefault('f', access_function.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ),
      'implementationAuthenticated', pg_catalog.has_function_privilege('authenticated', implementation_function.oid, 'EXECUTE'),
      'implementationAnon', pg_catalog.has_function_privilege('anon', implementation_function.oid, 'EXECUTE'),
      'implementationServiceRole', pg_catalog.has_function_privilege('service_role', implementation_function.oid, 'EXECUTE'),
      'implementationPublic', exists (
        select 1
        from pg_catalog.aclexplode(coalesce(
          implementation_function.proacl,
          pg_catalog.acldefault('f', implementation_function.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ),
      'wrapperAuthenticated', pg_catalog.has_function_privilege('authenticated', wrapper_function.oid, 'EXECUTE'),
      'wrapperAnon', pg_catalog.has_function_privilege('anon', wrapper_function.oid, 'EXECUTE'),
      'wrapperServiceRole', pg_catalog.has_function_privilege('service_role', wrapper_function.oid, 'EXECUTE'),
      'wrapperPublic', exists (
        select 1
        from pg_catalog.aclexplode(coalesce(
          wrapper_function.proacl,
          pg_catalog.acldefault('f', wrapper_function.proowner)
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    )
    from pg_catalog.pg_proc access_function
    cross join pg_catalog.pg_proc implementation_function
    cross join pg_catalog.pg_proc wrapper_function
    where access_function.oid = pg_catalog.to_regprocedure(
        'dashboard_private.assert_registration_observation_feedback_access_v1(uuid,text)'
      )
      and implementation_function.oid = pg_catalog.to_regprocedure(
        'dashboard_private.get_registration_observation_feedback_impl_v1(uuid)'
      )
      and wrapper_function.oid = pg_catalog.to_regprocedure(
        'public.get_registration_observation_feedback_v1(uuid)'
      )
  ),
  '{"accessAnon":false,"accessAuthenticated":false,"accessPublic":false,"accessServiceRole":false,"implementationAnon":false,"implementationAuthenticated":true,"implementationPublic":false,"implementationServiceRole":false,"wrapperAnon":false,"wrapperAuthenticated":true,"wrapperPublic":false,"wrapperServiceRole":false}'::jsonb,
  'only authenticated receives the private implementation and public wrapper invoker-chain grants'
);

select is(
  pg_temp.feedback_access_read(
    '99250000-0000-4000-8000-000000000001',
    '99250000-0000-4000-8000-000000000501'
  ) ->> 'observationId',
  '99250000-0000-4000-8000-000000000501',
  'assigned teacher reads the exact assigned observation'
);
select is(
  pg_temp.feedback_access_read(
    '99250000-0000-4000-8000-000000000002',
    '99250000-0000-4000-8000-000000000501'
  ) ->> 'observationId',
  '99250000-0000-4000-8000-000000000501',
  'active admin reads the exact observation'
);
select is(
  pg_temp.feedback_access_read(
    '99250000-0000-4000-8000-000000000003',
    '99250000-0000-4000-8000-000000000501'
  ) ->> 'observationId',
  '99250000-0000-4000-8000-000000000501',
  'active staff reads the exact observation'
);
select is(
  pg_temp.feedback_access_read(
    '99250000-0000-4000-8000-000000000004',
    '99250000-0000-4000-8000-000000000501'
  ) ->> 'observationId',
  '99250000-0000-4000-8000-000000000501',
  'track director reads the exact owned observation'
);

select throws_ok(
  $$select pg_temp.feedback_access_error_probe(
    '99250000-0000-4000-8000-000000000005',
    '99250000-0000-4000-8000-000000000501'
  )$$,
  'P0002',
  'registration_observation_not_found',
  'unrelated teacher receives the same P0002 not-found result for an existing row'
);
select throws_ok(
  $$select pg_temp.feedback_access_error_probe(
    '99250000-0000-4000-8000-000000000005',
    '99250000-0000-4000-8000-000000009999'
  )$$,
  'P0002',
  'registration_observation_not_found',
  'unrelated teacher receives the same P0002 not-found result for a missing row'
);
select throws_ok(
  $$select pg_temp.feedback_access_error_probe(
    '99250000-0000-4000-8000-000000000006',
    '99250000-0000-4000-8000-000000000501'
  )$$,
  'P0002',
  'registration_observation_not_found',
  'banned active-role manager cannot bypass the P0002 row-access boundary'
);

select is(
  (
    select pg_catalog.array_agg(key_name order by key_name)
    from pg_catalog.jsonb_object_keys(
      pg_temp.feedback_access_read(
        '99250000-0000-4000-8000-000000000001',
        '99250000-0000-4000-8000-000000000501'
      )
    ) key_name
  ),
  (
    select pg_catalog.array_agg(key_name order by key_name)
    from pg_catalog.unnest(array[
      'observationId','taskId','trackId','appointmentId','studentName','studentGrade',
      'subject','classId','className','sessionAuthority','sessionDate','sessionKey',
      'classLessonSessionId','legacySessionKey','sourceRevision','startsAt','endsAt',
      'classroomName','teacherName','status','attendance','suitabilityResult','feedbackReason',
      'proxySubmitted','feedbackSubmittedByName','feedbackSubmittedAt','revision',
      'feedbackRevision','appointmentNotificationRevision','trackWorkflowRevision','decisionKind'
    ]::text[]) key_name
  ),
  'normalized feedback read returns only the exact approved key set'
);
select is(
  (
    with response as (
      select pg_temp.feedback_access_read(
        '99250000-0000-4000-8000-000000000001',
        '99250000-0000-4000-8000-000000000501'
      ) as payload
    )
    select pg_catalog.jsonb_build_object(
      'authority', payload ->> 'sessionAuthority',
      'lessonId', payload ->> 'classLessonSessionId',
      'legacyIsNull', payload ->> 'legacySessionKey' is null,
      'sessionKeyNonblank', nullif(pg_catalog.btrim(payload ->> 'sessionKey'), '') is not null,
      'sourceMatchesLesson', payload -> 'sourceRevision' ->> 'sessionId'
        = payload ->> 'classLessonSessionId'
    )
    from response
  ),
  '{"authority":"normalized","legacyIsNull":true,"lessonId":"99250000-0000-4000-8000-000000000112","sessionKeyNonblank":true,"sourceMatchesLesson":true}'::jsonb,
  'normalized branch exposes one nonblank canonical session key and matching source revision'
);
select is(
  (
    with response as (
      select pg_temp.feedback_access_read(
        '99250000-0000-4000-8000-000000000001',
        '99250000-0000-4000-8000-000000000501'
      ) as payload
    )
    select pg_catalog.jsonb_build_object(
      'nameIsNull', payload ->> 'feedbackSubmittedByName' is null,
      'timeIsNull', payload ->> 'feedbackSubmittedAt' is null,
      'proxySubmitted', (payload ->> 'proxySubmitted')::boolean
    )
    from response
  ),
  '{"nameIsNull":true,"proxySubmitted":false,"timeIsNull":true}'::jsonb,
  'normalized observation without feedback returns paired null submitter facts'
);

select is(
  (
    select pg_catalog.array_agg(key_name order by key_name)
    from pg_catalog.jsonb_object_keys(
      pg_temp.feedback_access_read(
        '99250000-0000-4000-8000-000000000004',
        '99250000-0000-4000-8000-000000000502'
      )
    ) key_name
  ),
  (
    select pg_catalog.array_agg(key_name order by key_name)
    from pg_catalog.unnest(array[
      'observationId','taskId','trackId','appointmentId','studentName','studentGrade',
      'subject','classId','className','sessionAuthority','sessionDate','sessionKey',
      'classLessonSessionId','legacySessionKey','sourceRevision','startsAt','endsAt',
      'classroomName','teacherName','status','attendance','suitabilityResult','feedbackReason',
      'proxySubmitted','feedbackSubmittedByName','feedbackSubmittedAt','revision',
      'feedbackRevision','appointmentNotificationRevision','trackWorkflowRevision','decisionKind'
    ]::text[]) key_name
  ),
  'legacy feedback read returns only the exact approved key set'
);
select is(
  (
    with response as (
      select pg_temp.feedback_access_read(
        '99250000-0000-4000-8000-000000000004',
        '99250000-0000-4000-8000-000000000502'
      ) as payload
    )
    select pg_catalog.jsonb_build_object(
      'authority', payload ->> 'sessionAuthority',
      'lessonIsNull', payload ->> 'classLessonSessionId' is null,
      'legacySessionKey', payload ->> 'legacySessionKey',
      'sessionMatchesLegacy', payload ->> 'sessionKey'
        = payload ->> 'legacySessionKey',
      'sourceMatchesLegacy', payload -> 'sourceRevision' ->> 'sessionKey'
        = payload ->> 'legacySessionKey'
    )
    from response
  ),
  '{"authority":"legacy","legacySessionKey":"feedback-legacy-proxy","lessonIsNull":true,"sessionMatchesLegacy":true,"sourceMatchesLegacy":true}'::jsonb,
  'legacy branch preserves inverse source nullability and one matching session key'
);
select is(
  (
    with response as (
      select pg_temp.feedback_access_read(
        '99250000-0000-4000-8000-000000000004',
        '99250000-0000-4000-8000-000000000502'
      ) as payload
    )
    select pg_catalog.jsonb_build_object(
      'proxySubmitted', (payload ->> 'proxySubmitted')::boolean,
      'feedbackSubmittedByName', payload ->> 'feedbackSubmittedByName',
      'feedbackSubmittedAtMatchesStored',
        (payload ->> 'feedbackSubmittedAt')::timestamptz = (
          select observation.feedback_submitted_at
          from public.ops_registration_observations observation
          where observation.id = '99250000-0000-4000-8000-000000000502'
        )
    )
    from response
  ),
  '{"feedbackSubmittedAtMatchesStored":true,"feedbackSubmittedByName":"대리 관리자","proxySubmitted":true}'::jsonb,
  'legacy proxy feedback returns the exact stored server feedbackSubmittedAt instead of another non-null timestamp'
);
select is(
  (
    with response as (
      select pg_temp.feedback_access_read(
        '99250000-0000-4000-8000-000000000001',
        '99250000-0000-4000-8000-000000000503'
      ) as payload
    )
    select pg_catalog.jsonb_build_object(
      'proxySubmitted', (payload ->> 'proxySubmitted')::boolean,
      'feedbackSubmittedByName', payload ->> 'feedbackSubmittedByName',
      'feedbackSubmittedAtMatchesStored',
        (payload ->> 'feedbackSubmittedAt')::timestamptz = (
          select observation.feedback_submitted_at
          from public.ops_registration_observations observation
          where observation.id = '99250000-0000-4000-8000-000000000503'
        )
    )
    from response
  ),
  '{"feedbackSubmittedAtMatchesStored":true,"feedbackSubmittedByName":"담당 교사","proxySubmitted":false}'::jsonb,
  'assigned teacher feedback keeps the exact stored submission time and is never mislabeled as proxy input'
);

update auth.users
set banned_until = pg_catalog.now() + interval '1 day'
where id = '99250000-0000-4000-8000-000000000002';

select throws_ok(
  $$select pg_temp.feedback_access_error_probe(
    '99250000-0000-4000-8000-000000000001',
    '99250000-0000-4000-8000-000000000502'
  )$$,
  'P0002',
  'registration_observation_not_found',
  'a banned feedback submitter makes the row unavailable instead of leaking an inactive profile name'
);

update auth.users
set banned_until = null
where id = '99250000-0000-4000-8000-000000000002';
select is(
  (
    with response as (
      select pg_temp.feedback_access_read(
        '99250000-0000-4000-8000-000000000001',
        '99250000-0000-4000-8000-000000000501'
      ) as payload
    )
    select pg_catalog.jsonb_build_object(
      'studentName', payload ->> 'studentName',
      'studentGrade', payload ->> 'studentGrade',
      'subject', payload ->> 'subject',
      'className', payload ->> 'className',
      'classroomName', payload ->> 'classroomName',
      'teacherName', payload ->> 'teacherName',
      'appointmentNotificationRevision', (payload ->> 'appointmentNotificationRevision')::integer,
      'trackWorkflowRevision', (payload ->> 'trackWorkflowRevision')::integer
    )
    from response
  ),
  '{"appointmentNotificationRevision":2,"className":"피드백 정규반","classroomName":"피드백 101호","studentGrade":"고1","studentName":"정규 학생","subject":"영어","teacherName":"담당 교사","trackWorkflowRevision":6}'::jsonb,
  'feedback projection returns the exact student schedule and revision facts without contact fields'
);

rollback;
