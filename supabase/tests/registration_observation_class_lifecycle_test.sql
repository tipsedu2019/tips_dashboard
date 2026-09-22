begin;
select plan(8);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';
-- Local rollback-only fixture recreates a pre-atomic-close row.
set local app.class_close_mutation = 'v1';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    'f7000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'legacy-slot-admin@example.invalid',
    crypt('legacy-slot-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  ),
  (
    'f7000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'legacy-slot-teacher@example.invalid',
    crypt('legacy-slot-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    'f7000000-0000-4000-8000-000000000001', 'admin',
    '구형 일정 관리자', 'legacy-slot-admin@example.invalid', now(), now()
  ),
  (
    'f7000000-0000-4000-8000-000000000002', 'teacher',
    '구형 일정 선생님', 'legacy-slot-teacher@example.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id = 'f7000000-0000-4000-8000-000000000002';
insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email,
  dashboard_role
)
values (
  'f7000000-0000-4000-8000-000000000011', '구형 일정 선생님',
  array['영어']::text[], true, 9961,
  'f7000000-0000-4000-8000-000000000002',
  'legacy-slot-teacher@example.invalid', 'teacher'
);
update public.profiles
set teacher_catalog_id = 'f7000000-0000-4000-8000-000000000011'
where id = 'f7000000-0000-4000-8000-000000000002';

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  'f7000000-0000-4000-8000-000000000012', '구형 일정 101호',
  array['영어']::text[], true, 9962, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan,
  schedule, teacher, room
)
values (
  'f7000000-0000-4000-8000-000000000020', '구형 일정 영어반',
  '영어', '수업 진행 중', 'legacy',
  pg_catalog.jsonb_build_object(
    'sessions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sessionKey', 'legacy-slot-session-a',
        'date', (current_date + 21)::text,
        'scheduleState', 'active',
        'teacherName', '구형 일정 선생님',
        'classroomName', '구형 일정 101호'
      ),
      pg_catalog.jsonb_build_object(
        'sessionKey', 'legacy-slot-orphan-day',
        'date', (current_date + 22)::text,
        'scheduleState', 'active',
        'teacherName', '구형 일정 선생님',
        'classroomName', '구형 일정 101호'
      )
    ),
    'textbooks', '[]'::jsonb
  ),
  (case extract(dow from current_date + 21)::integer
    when 0 then '일'
    when 1 then '월'
    when 2 then '화'
    when 3 then '수'
    when 4 then '목'
    when 5 then '금'
    when 6 then '토'
  end) || ' 16:00-18:00',
  '구형 일정 선생님',
  '구형 일정 101호'
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values (
  'f7000000-0000-4000-8000-000000000030', '구형 일정 청강 fixture',
  'registration', 'requested', 'normal',
  'f7000000-0000-4000-8000-000000000001', '구형 일정 학생'
);
insert into public.ops_registration_details(task_id)
values ('f7000000-0000-4000-8000-000000000030');
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values (
  'f7000000-0000-4000-8000-000000000031',
  'f7000000-0000-4000-8000-000000000030',
  '영어', 'consultation_waiting',
  'f7000000-0000-4000-8000-000000000002',
  'manual', now(), false,
  'observation_requested', 1, now(), 'consultation_completed', 0
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1,
    updated_at = now(),
    updated_by = 'f7000000-0000-4000-8000-000000000001'
where singleton = true;


update public.classes set schedule = '', schedule_plan = '{}'::jsonb where id = 'f7000000-0000-4000-8000-000000000020';
select set_config('request.jwt.claim.sub', 'f7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Legacy closed classes can have status='종강' while closed_at is still null.
-- Keep the manager picker, session list and booking resolver consistent with
-- the canonical class lifecycle without altering existing observation history.
reset role;
update public.classes set status = '수강'
where id = 'f7000000-0000-4000-8000-000000000020';
set local role authenticated;
select ok(exists (
  select 1 from jsonb_array_elements(public.get_registration_observation_manager_detail_v1(
    'f7000000-0000-4000-8000-000000000031', 10)->'classes') item
  where item->>'id' = 'f7000000-0000-4000-8000-000000000020'
), 'active legacy class remains a booking choice');

reset role;
update public.classes set status = '종강', closed_at = null
where id = 'f7000000-0000-4000-8000-000000000020';
set local role authenticated;
select ok(not exists (
  select 1 from jsonb_array_elements(public.get_registration_observation_manager_detail_v1(
    'f7000000-0000-4000-8000-000000000031', 10)->'classes') item
  where item->>'id' = 'f7000000-0000-4000-8000-000000000020'
), 'closed legacy class is absent even with a null closed_at');
select throws_ok($sql$
  select public.list_registration_observation_sessions_v1(
    'f7000000-0000-4000-8000-000000000031', 'f7000000-0000-4000-8000-000000000020',
    current_date, current_date + 120)
$sql$, 'P0002', 'registration_observation_not_found',
  'stale closed class selections cannot list bookable sessions');
reset role;
select throws_ok($sql$
  select dashboard_private.resolve_registration_observation_session_v1(
    'f7000000-0000-4000-8000-000000000031', 'f7000000-0000-4000-8000-000000000020',
    'legacy', null, 'legacy-slot-session-a')
$sql$, 'P0002', 'registration_observation_not_found',
  'booking resolver rejects closed legacy classes with the exact domain SQLSTATE');

update public.classes set status = '개강 준비'
where id = 'f7000000-0000-4000-8000-000000000020';
set local role authenticated;
select ok(exists (
  select 1 from jsonb_array_elements(public.get_registration_observation_manager_detail_v1(
    'f7000000-0000-4000-8000-000000000031', 10)->'classes') item
  where item->>'id' = 'f7000000-0000-4000-8000-000000000020'
), 'upcoming class remains a booking choice');
select is(jsonb_array_length(public.list_registration_observation_sessions_v1(
    'f7000000-0000-4000-8000-000000000031', 'f7000000-0000-4000-8000-000000000020',
    current_date, current_date + 120)), 0, 'upcoming class may have no generated sessions without being closed');

reset role;
update public.classes set status = '', end_date = current_date - 1
where id = 'f7000000-0000-4000-8000-000000000020';
set local role authenticated;
select ok(not exists (
  select 1 from jsonb_array_elements(public.get_registration_observation_manager_detail_v1(
    'f7000000-0000-4000-8000-000000000031', 10)->'classes') item
  where item->>'id' = 'f7000000-0000-4000-8000-000000000020'
), 'date-derived closed status is also excluded');
reset role;
update public.classes set status = '수강'
where id = 'f7000000-0000-4000-8000-000000000020';
set local role authenticated;
select ok(exists (
  select 1 from jsonb_array_elements(public.get_registration_observation_manager_detail_v1(
    'f7000000-0000-4000-8000-000000000031', 10)->'classes') item
  where item->>'id' = 'f7000000-0000-4000-8000-000000000020'
), 'explicit active status preserves canonical precedence over an old end date');


select * from finish();
rollback;
