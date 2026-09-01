begin;
select plan(47);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('99100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'booking-admin@example.invalid', crypt('booking-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'booking-director@example.invalid', crypt('booking-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'booking-unrelated@example.invalid', crypt('booking-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('99100000-0000-4000-8000-000000000001', 'admin', '청강 예약 관리자', 'booking-admin@example.invalid', now(), now()),
  ('99100000-0000-4000-8000-000000000003', 'teacher', '청강 예약 원장', 'booking-director@example.invalid', now(), now()),
  ('99100000-0000-4000-8000-000000000004', 'viewer', '청강 예약 무관계자', 'booking-unrelated@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id in (
  '99100000-0000-4000-8000-000000000001',
  '99100000-0000-4000-8000-000000000003',
  '99100000-0000-4000-8000-000000000004'
);

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email,
  dashboard_role
)
values (
  '99100000-0000-4000-8000-000000000101', '청강 예약 원장',
  array['영어']::text[], true, 9981,
  '99100000-0000-4000-8000-000000000003',
  'booking-director@example.invalid', 'teacher'
);
update public.profiles
set teacher_catalog_id = '99100000-0000-4000-8000-000000000101'
where id = '99100000-0000-4000-8000-000000000003';

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  '99100000-0000-4000-8000-000000000102', '청강 예약 101호',
  array['영어']::text[], true, 9982, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
values
  (
    '99100000-0000-4000-8000-000000000103', '청강 예약 영어반',
    '영어', '수업 진행 중', 'normalized', '{"sessions":[]}'::jsonb
  ),
  (
    '99100000-0000-4000-8000-000000000193', '청강 예약 legacy 영어반',
    '영어', '수업 진행 중', 'legacy',
    pg_catalog.jsonb_build_object(
      'sessions', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'sessionKey', 'booking-legacy-session-a',
          'date', (current_date + 21)::text,
          'scheduleState', 'active',
          'teacherCatalogId', '99100000-0000-4000-8000-000000000101',
          'teacherName', '청강 예약 원장',
          'classroomCatalogId', '99100000-0000-4000-8000-000000000102',
          'classroomName', '청강 예약 101호'
        )
      ),
      'textbooks', '[]'::jsonb
    )
  );

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '99100000-0000-4000-8000-000000000103',
    '99100000-0000-4000-8000-000000000111',
    'registration_observation_booking_test'
  );
end;
$$;
insert into public.class_schedule_slots(
  id, class_id, weekday, start_time, end_time,
  teacher_catalog_id, teacher_name, classroom_catalog_id, classroom_name,
  sort_order
)
values (
  '99100000-0000-4000-8000-000000000194',
  '99100000-0000-4000-8000-000000000193',
  extract(dow from current_date + 21)::smallint,
  '16:00', '18:00',
  '99100000-0000-4000-8000-000000000101', '청강 예약 원장',
  '99100000-0000-4000-8000-000000000102', '청강 예약 101호',
  0
);
insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state, start_time, end_time,
  teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id,
  classroom_name_snapshot, origin, revision
)
values
  (
    '99100000-0000-4000-8000-000000000104',
    '99100000-0000-4000-8000-000000000103',
    'booking-session-a', current_date + 7, 'active', '18:00', '20:00',
    '99100000-0000-4000-8000-000000000101', '청강 예약 원장',
    '99100000-0000-4000-8000-000000000102', '청강 예약 101호',
    'manual', 7
  ),
  (
    '99100000-0000-4000-8000-000000000114',
    '99100000-0000-4000-8000-000000000103',
    'booking-session-b', current_date + 14, 'active', '19:00', '21:00',
    '99100000-0000-4000-8000-000000000101', '청강 예약 원장',
    '99100000-0000-4000-8000-000000000102', '청강 예약 101호',
    'manual', 3
  );

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values
  ('99100000-0000-4000-8000-000000000105', '청강 enter fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 입장학생'),
  ('99100000-0000-4000-8000-000000000115', '청강 booking fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 예약학생'),
  ('99100000-0000-4000-8000-000000000125', '청강 generic fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 일반학생'),
  ('99100000-0000-4000-8000-000000000135', '청강 canceled fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 취소학생'),
  ('99100000-0000-4000-8000-000000000145', '청강 correction fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 재청강학생'),
  ('99100000-0000-4000-8000-000000000155', '청강 rollback fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 롤백학생'),
  ('99100000-0000-4000-8000-000000000165', '청강 active guard fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 활성청강학생'),
  ('99100000-0000-4000-8000-000000000175', '청강 unfit general fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 부적합일반학생'),
  ('99100000-0000-4000-8000-000000000195', '청강 legacy payload fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 legacy학생');

insert into public.ops_registration_details(task_id)
values
  ('99100000-0000-4000-8000-000000000105'),
  ('99100000-0000-4000-8000-000000000115'),
  ('99100000-0000-4000-8000-000000000125'),
  ('99100000-0000-4000-8000-000000000135'),
  ('99100000-0000-4000-8000-000000000145'),
  ('99100000-0000-4000-8000-000000000155'),
  ('99100000-0000-4000-8000-000000000165'),
  ('99100000-0000-4000-8000-000000000175'),
  ('99100000-0000-4000-8000-000000000195');

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values
  ('99100000-0000-4000-8000-000000000106', '99100000-0000-4000-8000-000000000105', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'consultation_completed', 1, now(), null, 0),
  ('99100000-0000-4000-8000-000000000116', '99100000-0000-4000-8000-000000000115', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'observation_requested', 2, now(), 'consultation_completed', 0),
  ('99100000-0000-4000-8000-000000000126', '99100000-0000-4000-8000-000000000125', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'consultation_completed', 1, now(), null, 0),
  ('99100000-0000-4000-8000-000000000136', '99100000-0000-4000-8000-000000000135', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'observation_requested', 1, now(), 'waiting_new_class', 1),
  ('99100000-0000-4000-8000-000000000146', '99100000-0000-4000-8000-000000000145', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'observation_requested', 4, now(), 'consultation_completed', 2),
  ('99100000-0000-4000-8000-000000000156', '99100000-0000-4000-8000-000000000155', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'observation_requested', 1, now(), 'consultation_completed', 0),
  ('99100000-0000-4000-8000-000000000166', '99100000-0000-4000-8000-000000000165', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'consultation_completed', 1, now(), null, 1),
  ('99100000-0000-4000-8000-000000000176', '99100000-0000-4000-8000-000000000175', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'observation_requested', 3, now(), 'consultation_completed', 2),
  ('99100000-0000-4000-8000-000000000196', '99100000-0000-4000-8000-000000000195', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'observation_requested', 1, now(), 'consultation_completed', 0);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision,
  created_by, created_at, updated_at
)
values
  ('99100000-0000-4000-8000-000000000137', '99100000-0000-4000-8000-000000000135', 'observation_class', ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'canceled', 2, '99100000-0000-4000-8000-000000000001', now() - interval '3 days', now() - interval '3 days'),
  ('99100000-0000-4000-8000-000000000147', '99100000-0000-4000-8000-000000000145', 'observation_class', ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'completed', 4, '99100000-0000-4000-8000-000000000001', now() - interval '4 days', now() - interval '4 days'),
  ('99100000-0000-4000-8000-000000000157', '99100000-0000-4000-8000-000000000145', 'observation_class', ((current_date + 14 + time '19:00') at time zone 'Asia/Seoul'), '본관', 'canceled', 2, '99100000-0000-4000-8000-000000000001', now() - interval '2 days', now() - interval '2 days'),
  ('99100000-0000-4000-8000-000000000167', '99100000-0000-4000-8000-000000000165', 'observation_class', ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 1, '99100000-0000-4000-8000-000000000001', now() - interval '1 day', now() - interval '1 day'),
  ('99100000-0000-4000-8000-000000000177', '99100000-0000-4000-8000-000000000175', 'observation_class', ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'completed', 4, '99100000-0000-4000-8000-000000000001', now() - interval '4 days', now() - interval '4 days'),
  ('99100000-0000-4000-8000-000000000187', '99100000-0000-4000-8000-000000000175', 'observation_class', ((current_date + 14 + time '19:00') at time zone 'Asia/Seoul'), '본관', 'canceled', 2, '99100000-0000-4000-8000-000000000001', now() - interval '2 days', now() - interval '2 days');

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
  feedback_revision, decision_kind, decided_by, decided_at, revision,
  created_by, updated_by, created_at, updated_at
)
values
  (
    '99100000-0000-4000-8000-000000000138',
    '99100000-0000-4000-8000-000000000135',
    '99100000-0000-4000-8000-000000000136',
    '99100000-0000-4000-8000-000000000137',
    '99100000-0000-4000-8000-000000000103',
    'normalized', '99100000-0000-4000-8000-000000000104', null,
    current_date + 7,
    ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'),
    ((current_date + 7 + time '20:00') at time zone 'Asia/Seoul'),
    'active', 7, null,
    '{"authority":"normalized","sessionId":"99100000-0000-4000-8000-000000000104","revision":7}'::jsonb,
    repeat('a', 64), '99100000-0000-4000-8000-000000000101',
    '99100000-0000-4000-8000-000000000003',
    '99100000-0000-4000-8000-000000000102', '영어', '청강 예약 영어반',
    '청강 예약 원장', '청강 예약 101호', '본관', 'canceled', null,
    null, null, null, null, null, null, 0, null, null, null, 2,
    '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000001',
    now() - interval '3 days', now() - interval '3 days'
  ),
  (
    '99100000-0000-4000-8000-000000000148',
    '99100000-0000-4000-8000-000000000145',
    '99100000-0000-4000-8000-000000000146',
    '99100000-0000-4000-8000-000000000147',
    '99100000-0000-4000-8000-000000000103',
    'normalized', '99100000-0000-4000-8000-000000000104', null,
    current_date + 7,
    ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'),
    ((current_date + 7 + time '20:00') at time zone 'Asia/Seoul'),
    'active', 7, null,
    '{"authority":"normalized","sessionId":"99100000-0000-4000-8000-000000000104","revision":7}'::jsonb,
    repeat('b', 64), '99100000-0000-4000-8000-000000000101',
    '99100000-0000-4000-8000-000000000003',
    '99100000-0000-4000-8000-000000000102', '영어', '청강 예약 영어반',
    '청강 예약 원장', '청강 예약 101호', '본관', 'completed', 'attended',
    '99100000-0000-4000-8000-000000000001', now() - interval '4 days',
    'unfit', '합성 부적합', '99100000-0000-4000-8000-000000000003',
    now() - interval '4 days', 3, 're_observation',
    '99100000-0000-4000-8000-000000000003', now() - interval '4 days', 7,
    '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000001',
    now() - interval '4 days', now() - interval '4 days'
  ),
  (
    '99100000-0000-4000-8000-000000000158',
    '99100000-0000-4000-8000-000000000145',
    '99100000-0000-4000-8000-000000000146',
    '99100000-0000-4000-8000-000000000157',
    '99100000-0000-4000-8000-000000000103',
    'normalized', '99100000-0000-4000-8000-000000000114', null,
    current_date + 14,
    ((current_date + 14 + time '19:00') at time zone 'Asia/Seoul'),
    ((current_date + 14 + time '21:00') at time zone 'Asia/Seoul'),
    'active', 3, null,
    '{"authority":"normalized","sessionId":"99100000-0000-4000-8000-000000000114","revision":3}'::jsonb,
    repeat('c', 64), '99100000-0000-4000-8000-000000000101',
    '99100000-0000-4000-8000-000000000003',
    '99100000-0000-4000-8000-000000000102', '영어', '청강 예약 영어반',
    '청강 예약 원장', '청강 예약 101호', '본관', 'canceled', null,
    null, null, null, null, null, null, 0, null, null, null, 1,
    '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000001',
    now() - interval '2 days', now() - interval '2 days'
  ),
  (
    '99100000-0000-4000-8000-000000000168',
    '99100000-0000-4000-8000-000000000165',
    '99100000-0000-4000-8000-000000000166',
    '99100000-0000-4000-8000-000000000167',
    '99100000-0000-4000-8000-000000000103',
    'normalized', '99100000-0000-4000-8000-000000000104', null,
    current_date + 7,
    ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'),
    ((current_date + 7 + time '20:00') at time zone 'Asia/Seoul'),
    'active', 7, null,
    '{"authority":"normalized","sessionId":"99100000-0000-4000-8000-000000000104","revision":7}'::jsonb,
    repeat('d', 64), '99100000-0000-4000-8000-000000000101',
    '99100000-0000-4000-8000-000000000003',
    '99100000-0000-4000-8000-000000000102', '영어', '청강 예약 영어반',
    '청강 예약 원장', '청강 예약 101호', '본관', 'scheduled', null,
    null, null, null, null, null, null, 0, null, null, null, 1,
    '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000001',
    now() - interval '1 day', now() - interval '1 day'
  ),
  (
    '99100000-0000-4000-8000-000000000178',
    '99100000-0000-4000-8000-000000000175',
    '99100000-0000-4000-8000-000000000176',
    '99100000-0000-4000-8000-000000000177',
    '99100000-0000-4000-8000-000000000103',
    'normalized', '99100000-0000-4000-8000-000000000104', null,
    current_date + 7,
    ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'),
    ((current_date + 7 + time '20:00') at time zone 'Asia/Seoul'),
    'active', 7, null,
    '{"authority":"normalized","sessionId":"99100000-0000-4000-8000-000000000104","revision":7}'::jsonb,
    repeat('e', 64), '99100000-0000-4000-8000-000000000101',
    '99100000-0000-4000-8000-000000000003',
    '99100000-0000-4000-8000-000000000102', '영어', '청강 예약 영어반',
    '청강 예약 원장', '청강 예약 101호', '본관', 'completed', 'attended',
    '99100000-0000-4000-8000-000000000001', now() - interval '4 days',
    'unfit', '일반 원장결정 부적합 fixture',
    '99100000-0000-4000-8000-000000000003', now() - interval '4 days',
    2, 'not_registered', '99100000-0000-4000-8000-000000000003',
    now() - interval '4 days', 5,
    '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000001',
    now() - interval '4 days', now() - interval '4 days'
  ),
  (
    '99100000-0000-4000-8000-000000000188',
    '99100000-0000-4000-8000-000000000175',
    '99100000-0000-4000-8000-000000000176',
    '99100000-0000-4000-8000-000000000187',
    '99100000-0000-4000-8000-000000000103',
    'normalized', '99100000-0000-4000-8000-000000000114', null,
    current_date + 14,
    ((current_date + 14 + time '19:00') at time zone 'Asia/Seoul'),
    ((current_date + 14 + time '21:00') at time zone 'Asia/Seoul'),
    'active', 3, null,
    '{"authority":"normalized","sessionId":"99100000-0000-4000-8000-000000000114","revision":3}'::jsonb,
    repeat('f', 64), '99100000-0000-4000-8000-000000000101',
    '99100000-0000-4000-8000-000000000003',
    '99100000-0000-4000-8000-000000000102', '영어', '청강 예약 영어반',
    '청강 예약 원장', '청강 예약 101호', '본관', 'canceled', null,
    null, null, null, null, null, null, 0, null, null, null, 1,
    '99100000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000001',
    now() - interval '2 days', now() - interval '2 days'
  );

create or replace function pg_temp.registration_observation_booking_set_actor(
  p_actor uuid
)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (
        select profile.email from public.profiles profile where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.registration_observation_withdraw_exit_kind_probe(
  p_exit_kind text,
  p_request_key text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.withdraw_registration_observation_v1(
    '99100000-0000-4000-8000-000000000136',
    p_exit_kind,
    'enrollment_requested',
    null,
    1,
    null,
    null,
    null,
    p_request_key
  );
  raise exception 'registration_observation_withdraw_unexpected_success'
    using errcode = 'P0001';
end;
$$;

create or replace function pg_temp.registration_observation_save_revision_probe(
  p_observation_id uuid,
  p_expected_workflow_revision integer,
  p_expected_appointment_notification_revision integer,
  p_expected_observation_revision bigint,
  p_request_key text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.save_registration_observation_booking_v1(
    '99100000-0000-4000-8000-000000000116',
    p_observation_id,
    '99100000-0000-4000-8000-000000000103',
    'normalized',
    '99100000-0000-4000-8000-000000000104',
    null,
    p_expected_workflow_revision,
    p_expected_appointment_notification_revision,
    p_expected_observation_revision,
    p_request_key
  );
  raise exception 'registration_observation_save_unexpected_success'
    using errcode = 'P0001';
end;
$$;

create or replace function pg_temp.registration_observation_withdraw_revision_probe(
  p_exit_kind text,
  p_target_workflow_status text,
  p_decision_observation_id uuid,
  p_expected_decision_observation_revision bigint,
  p_expected_decision_feedback_revision bigint,
  p_request_key text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.withdraw_registration_observation_v1(
    '99100000-0000-4000-8000-000000000146',
    p_exit_kind,
    p_target_workflow_status,
    p_decision_observation_id,
    4,
    p_expected_decision_observation_revision,
    p_expected_decision_feedback_revision,
    '사유',
    p_request_key
  );
  raise exception 'registration_observation_withdraw_unexpected_success'
    using errcode = 'P0001';
end;
$$;

create or replace function pg_temp.registration_observation_reschedule_stale_probe(
  p_observation_id uuid,
  p_expected_appointment_notification_revision integer,
  p_expected_observation_revision bigint,
  p_request_key text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.save_registration_observation_booking_v1(
    '99100000-0000-4000-8000-000000000116',
    p_observation_id,
    '99100000-0000-4000-8000-000000000103',
    'normalized',
    '99100000-0000-4000-8000-000000000104',
    null,
    null,
    p_expected_appointment_notification_revision,
    p_expected_observation_revision,
    p_request_key
  );
  raise exception 'registration_observation_reschedule_unexpected_success'
    using errcode = 'P0001';
end;
$$;

create temporary table registration_observation_booking_results(
  result_key text primary key,
  response jsonb not null
) on commit drop;
grant all on registration_observation_booking_results to authenticated;

insert into dashboard_private.registration_observation_runtime_settings(
  singleton, activation_version, updated_at, updated_by
)
values (
  true, 1, now(), '99100000-0000-4000-8000-000000000001'
)
on conflict (singleton) do update
set activation_version = excluded.activation_version,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

-- The reviewed isolated baseline keeps notification control-plane rows empty.
-- Disabled rules let this booking test exercise domain-event atomicity without
-- materializing a delivery or contacting a provider.
set constraints all deferred;

with seed(rule_id, template_id, event_key) as (
  values
    (
      '99100000-0000-4000-8000-000000000301'::uuid,
      '99100000-0000-4000-8000-000000000401'::uuid,
      'registration.observation_scheduled'::text
    ),
    (
      '99100000-0000-4000-8000-000000000302'::uuid,
      '99100000-0000-4000-8000-000000000402'::uuid,
      'registration.observation_rescheduled'::text
    ),
    (
      '99100000-0000-4000-8000-000000000303'::uuid,
      '99100000-0000-4000-8000-000000000403'::uuid,
      'registration.observation_canceled'::text
    ),
    (
      '99100000-0000-4000-8000-000000000304'::uuid,
      '99100000-0000-4000-8000-000000000404'::uuid,
      'registration.observation_reminder_due'::text
    ),
    (
      '99100000-0000-4000-8000-000000000305'::uuid,
      '99100000-0000-4000-8000-000000000405'::uuid,
      'registration.observation_feedback_due'::text
    )
)
insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  enabled, active_template_id, revision,
  created_by, created_actor_kind, updated_by, updated_actor_kind
)
select
  seed.rule_id, 'global', 'registration', seed.event_key,
  'google_chat', 'subject_team', 'immediate', 'immediate', null, null,
  false, seed.template_id, 1, null, 'system', null, 'system'
from seed
where not exists (
  select 1
  from dashboard_private.notification_rules rule
  where rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = seed.event_key
);

with seed(rule_id, template_id) as (
  values
    (
      '99100000-0000-4000-8000-000000000301'::uuid,
      '99100000-0000-4000-8000-000000000401'::uuid
    ),
    (
      '99100000-0000-4000-8000-000000000302'::uuid,
      '99100000-0000-4000-8000-000000000402'::uuid
    ),
    (
      '99100000-0000-4000-8000-000000000303'::uuid,
      '99100000-0000-4000-8000-000000000403'::uuid
    ),
    (
      '99100000-0000-4000-8000-000000000304'::uuid,
      '99100000-0000-4000-8000-000000000404'::uuid
    ),
    (
      '99100000-0000-4000-8000-000000000305'::uuid,
      '99100000-0000-4000-8000-000000000405'::uuid
    )
)
insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind
)
select
  seed.template_id, seed.rule_id, 1,
  '청강 예약 상태분리 테스트', '비활성 규칙 테스트', '[]'::jsonb, 3,
  dashboard_private.notification_seed_template_checksum_v1(
    '청강 예약 상태분리 테스트', '비활성 규칙 테스트', '[]'::jsonb, 3
  ),
  null, 'system'
from seed
where exists (
  select 1
  from dashboard_private.notification_rules rule
  where rule.id = seed.rule_id
)
and not exists (
  select 1
  from dashboard_private.notification_templates template
  where template.id = seed.template_id
);

set constraints all immediate;

select function_returns('public', 'enter_registration_observation_v1', array['uuid','integer','text'], 'jsonb');
select function_returns('public', 'save_registration_observation_booking_v1', array['uuid','uuid','uuid','text','uuid','text','integer','integer','bigint','text'], 'jsonb');
select function_returns('public', 'cancel_registration_observation_v1', array['uuid','integer','bigint','text'], 'jsonb');
select function_returns('public', 'withdraw_registration_observation_v1', array['uuid','text','text','uuid','integer','bigint','bigint','text','text'], 'jsonb');
select ok(
  has_function_privilege('authenticated', 'public.enter_registration_observation_v1(uuid,integer,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_registration_observation_v1(uuid,integer,bigint,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'dashboard_private.enter_registration_observation_v1_impl(uuid,integer,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'dashboard_private.save_registration_observation_booking_v1_impl(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'dashboard_private.cancel_registration_observation_v1_impl(uuid,integer,bigint,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'dashboard_private.withdraw_registration_observation_v1_impl(uuid,text,text,uuid,integer,bigint,bigint,text,text)', 'EXECUTE'),
  'authenticated can execute the public and delegated booking surface but not retired withdrawal'
);
select ok(
  not has_function_privilege('anon', 'public.enter_registration_observation_v1(uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.ops_registration_observations', 'INSERT')
  and not has_table_privilege('authenticated', 'dashboard_private.registration_observation_mutation_requests', 'SELECT'),
  'anon service and direct-write surfaces remain closed'
);

select pg_temp.registration_observation_booking_set_actor('99100000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.enter_registration_observation_v1('99100000-0000-4000-8000-000000000106', 1, 'unrelated-enter')$$,
  'P0002', 'registration_observation_not_found',
  'a teacher cannot enter an observation track because registration writes are manager-only'
);
reset role;

select pg_temp.registration_observation_booking_set_actor('99100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99100000-0000-4000-8000-000000000116', null,
    '99100000-0000-4000-8000-000000000103', 'normalized',
    '99100000-0000-4000-8000-000000000104', null,
    2, 1, null, 'invalid-new-revisions'
  )$$,
  '22023', 'registration_observation_revision_combination_invalid',
  'new booking rejects notification revision input'
);
select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99100000-0000-4000-8000-000000000116',
    '99100000-0000-4000-8000-000000009999',
    '99100000-0000-4000-8000-000000000103', 'normalized',
    '99100000-0000-4000-8000-000000000104', null,
    2, 1, 1, 'invalid-reschedule-revisions'
  )$$,
  '22023', 'registration_observation_revision_combination_invalid',
  'reschedule rejects workflow revision input'
);
select throws_ok(
  $$select pg_temp.registration_observation_save_revision_probe(
    null, null, null, null, 'invalid-new-missing-workflow'
  )$$,
  'P0001', 'registration_observation_save_unexpected_success',
  'new booking accepts a missing workflow revision and the probe rolls back its successful write'
);
select throws_ok(
  $$select pg_temp.registration_observation_save_revision_probe(
    null, 2, null, 1, 'invalid-new-observation-revision'
  )$$,
  '22023', 'registration_observation_revision_combination_invalid',
  'new booking rejects forbidden observation revision input'
);
select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99100000-0000-4000-8000-000000000116',
    '99100000-0000-4000-8000-000000009999',
    '99100000-0000-4000-8000-000000000103', 'normalized',
    '99100000-0000-4000-8000-000000000104', null,
    null, null, 1, 'invalid-reschedule-missing-notification'
  )$$,
  '22023', 'registration_observation_revision_combination_invalid',
  'reschedule rejects a missing required notification revision'
);
select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99100000-0000-4000-8000-000000000116',
    '99100000-0000-4000-8000-000000009999',
    '99100000-0000-4000-8000-000000000103', 'normalized',
    '99100000-0000-4000-8000-000000000104', null,
    null, 1, null, 'invalid-reschedule-missing-observation'
  )$$,
  '22023', 'registration_observation_revision_combination_invalid',
  'reschedule rejects a missing required observation revision'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'attempts', track.observation_attempt_count,
      'observations', (
        select count(*)
        from public.ops_registration_observations observation
        where observation.track_id = track.id
      ),
      'appointments', (
        select count(*)
        from public.ops_registration_appointments appointment
        where appointment.task_id = track.task_id
          and appointment.kind = 'observation_class'
      ),
      'auditCount', (
        select count(*)
        from public.ops_task_events event
        where event.task_id = track.task_id
      ),
      'receiptCount', (
        select count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.request_key in (
          'invalid-new-revisions',
          'invalid-reschedule-revisions',
          'invalid-new-missing-workflow',
          'invalid-new-observation-revision',
          'invalid-reschedule-missing-notification',
          'invalid-reschedule-missing-observation'
        )
      )
    )
    from public.ops_registration_subject_tracks track
    where track.id = '99100000-0000-4000-8000-000000000116'
  ),
  '{"workflowStatus":"observation_requested","workflowRevision":2,"attempts":0,"observations":0,"appointments":0,"auditCount":0,"receiptCount":0}'::jsonb,
  'invalid save revision combinations leave booking track rows audit and receipts unchanged'
);
set local role authenticated;

insert into registration_observation_booking_results(result_key, response)
select 'enter', public.enter_registration_observation_v1(
  '99100000-0000-4000-8000-000000000106', 999, 'enter-once'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', track.workflow_status,
      'revision', track.workflow_revision,
      'returnStatus', track.observation_return_workflow_status,
      'attempts', track.observation_attempt_count,
      'response', result.response,
      'eventCount', (
        select count(*) from public.ops_task_events event
        where event.task_id = track.task_id
      ),
      'receiptCount', (
        select count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.request_key = 'enter-once'
      ),
      'observationCount', (
        select count(*) from public.ops_registration_observations observation
        where observation.track_id = track.id
      )
    )
    from public.ops_registration_subject_tracks track
    cross join registration_observation_booking_results result
    where track.id = '99100000-0000-4000-8000-000000000106'
      and result.result_key = 'enter'
  ),
  '{"status":"consultation_completed","revision":1,"returnStatus":null,"attempts":0,"response":{"operation":"enter","requestKey":"enter-once","trackId":"99100000-0000-4000-8000-000000000106","workflowStatus":"consultation_completed","workflowRevision":1,"observation":null,"appointment":null,"changed":false},"eventCount":0,"receiptCount":1,"observationCount":0}'::jsonb,
  'enter is a no-op even when its compatibility workflow revision is stale'
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 0
where singleton = true;
set local role authenticated;
select is(
  public.enter_registration_observation_v1(
    '99100000-0000-4000-8000-000000000106', 999, 'enter-once'
  ),
  (select response from registration_observation_booking_results where result_key = 'enter'),
  'same fingerprint replays byte-identical JSON before runtime guard'
);
select throws_ok(
  $$select public.enter_registration_observation_v1('99100000-0000-4000-8000-000000000106', 2, 'enter-once')$$,
  '23505', 'registration_observation_request_key_conflict',
  'same key with another fingerprint conflicts before runtime guard'
);
reset role;
update dashboard_private.registration_observation_runtime_settings
set activation_version = 1
where singleton = true;

set local role authenticated;
select lives_ok(
  $$select public.enter_registration_observation_v1(
    '99100000-0000-4000-8000-000000000106', null, 'enter-stale-revision'
  )$$,
  'enter also accepts a null compatibility workflow revision'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'returnStatus', track.observation_return_workflow_status,
      'eventCount', (
        select pg_catalog.count(*)
        from public.ops_task_events event
        where event.task_id = track.task_id
      ),
      'receiptCount', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.request_key = 'enter-stale-revision'
      )
    )
    from public.ops_registration_subject_tracks track
    where track.id = '99100000-0000-4000-8000-000000000106'
  ),
  '{"workflowStatus":"consultation_completed","workflowRevision":1,"returnStatus":null,"eventCount":0,"receiptCount":1}'::jsonb,
  'enter leaves manual status and audit unchanged while storing its no-op receipt'
);

set local role authenticated;
insert into registration_observation_booking_results(result_key, response)
select 'book-1', public.save_registration_observation_booking_v1(
  '99100000-0000-4000-8000-000000000116', null,
  '99100000-0000-4000-8000-000000000103', 'normalized',
  '99100000-0000-4000-8000-000000000104', null,
  2, null, null, 'book-once'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'attempts', track.observation_attempt_count,
      'workflowRevision', track.workflow_revision,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'notificationRevision', appointment.notification_revision,
      'sameTask', observation.task_id = track.task_id,
      'sameSubject', observation.subject = track.subject,
      'sameSchedule', appointment.scheduled_at = observation.starts_at,
      'samePlace', appointment.place = observation.campus,
      'eventCount', (
        select count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
          and event.event_kind = 'observation_scheduled'
      )
    )
    from registration_observation_booking_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track on track.id = observation.track_id
    where result.result_key = 'book-1'
  ),
  '{"attempts":1,"workflowRevision":2,"observationRevision":1,"feedbackRevision":0,"notificationRevision":1,"sameTask":true,"sameSubject":true,"sameSchedule":true,"samePlace":true,"eventCount":1}'::jsonb,
  'new booking atomically creates exact revision-one rows event and one counter increment'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'observationMatchesCanonical',
        result.response -> 'observation'
          = dashboard_private.registration_observation_attempt_payload_v1(
              observation, appointment, 'booking-session-a'
            ),
      'sessionKey', result.response -> 'observation' ->> 'sessionKey',
      'appointmentMatchesExact',
        result.response -> 'appointment' = pg_catalog.jsonb_build_object(
          'appointmentId', appointment.id,
          'status', appointment.status,
          'scheduledAt', appointment.scheduled_at,
          'place', appointment.place,
          'notificationRevision', appointment.notification_revision
        )
    )
    from registration_observation_booking_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    where result.result_key = 'book-1'
  ),
  '{"observationMatchesCanonical":true,"sessionKey":"booking-session-a","appointmentMatchesExact":true}'::jsonb,
  'normalized booking mutation returns canonical attempt and exact appointment payloads'
);
select is(
  (
    select pg_catalog.jsonb_agg(key order by key)
    from registration_observation_booking_results result,
         lateral pg_catalog.jsonb_object_keys(result.response) key
    where result.result_key = 'book-1'
  ),
  '["appointment","changed","observation","operation","requestKey","trackId","workflowRevision","workflowStatus"]'::jsonb,
  'booking response has the exact common key envelope'
);
select results_eq(
  $$select count(*) from dashboard_private.registration_observation_domain_events
     where event_kind = 'observation_scheduled'$$,
  array[1::bigint],
  'new booking emits exactly one scheduled event'
);
select results_eq(
  $$select count(*) from dashboard_private.registration_observation_domain_events
     where event_kind in ('reminder_due','feedback_due')$$,
  array[0::bigint],
  'core booking emits no due-kind rows'
);

insert into registration_observation_booking_results(result_key, response)
select 'book-legacy', public.save_registration_observation_booking_v1(
  '99100000-0000-4000-8000-000000000196', null,
  '99100000-0000-4000-8000-000000000193', 'legacy',
  null, 'booking-legacy-session-a',
  1, null, null, 'book-legacy-payload'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'observationMatchesCanonical',
        result.response -> 'observation'
          = dashboard_private.registration_observation_attempt_payload_v1(
              observation, appointment, 'booking-legacy-session-a'
            ),
      'sessionKey', result.response -> 'observation' ->> 'sessionKey',
      'legacySessionKey', result.response -> 'observation' ->> 'legacySessionKey',
      'classLessonSessionId', result.response -> 'observation' -> 'classLessonSessionId',
      'appointmentMatchesExact',
        result.response -> 'appointment' = pg_catalog.jsonb_build_object(
          'appointmentId', appointment.id,
          'status', appointment.status,
          'scheduledAt', appointment.scheduled_at,
          'place', appointment.place,
          'notificationRevision', appointment.notification_revision
        )
    )
    from registration_observation_booking_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    where result.result_key = 'book-legacy'
  ),
  '{"observationMatchesCanonical":true,"sessionKey":"booking-legacy-session-a","legacySessionKey":"booking-legacy-session-a","classLessonSessionId":null,"appointmentMatchesExact":true}'::jsonb,
  'legacy booking mutation returns canonical attempt with exact legacy session and appointment payloads'
);

insert into registration_observation_booking_results(result_key, response)
select 'book-replay', public.save_registration_observation_booking_v1(
  '99100000-0000-4000-8000-000000000116', null,
  '99100000-0000-4000-8000-000000000103', 'normalized',
  '99100000-0000-4000-8000-000000000104', null,
  2, null, null, 'book-once'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'sameResponse', original.response = replay.response,
      'attempts', track.observation_attempt_count,
      'events', (
        select count(*) from dashboard_private.registration_observation_domain_events event
        where event.observation_id = (original.response -> 'observation' ->> 'observationId')::uuid
      )
    )
    from registration_observation_booking_results original
    join registration_observation_booking_results replay on replay.result_key = 'book-replay'
    join public.ops_registration_subject_tracks track
      on track.id = '99100000-0000-4000-8000-000000000116'
    where original.result_key = 'book-1'
  ),
  '{"sameResponse":true,"attempts":1,"events":1}'::jsonb,
  'same-key replay preserves JSON event count and attempt counter'
);
select throws_ok(
  $$select public.cancel_registration_observation_v1(
    (select (response -> 'observation' ->> 'observationId')::uuid from registration_observation_booking_results where result_key = 'book-1'),
    1, 1, 'book-once'
  )$$,
  '23505', 'registration_observation_request_key_conflict',
  'same actor key cannot cross from book to cancel operation'
);

insert into registration_observation_booking_results(result_key, response)
select 'reschedule-noop', public.save_registration_observation_booking_v1(
  '99100000-0000-4000-8000-000000000116',
  (select (response -> 'observation' ->> 'observationId')::uuid from registration_observation_booking_results where result_key = 'book-1'),
  '99100000-0000-4000-8000-000000000103', 'normalized',
  '99100000-0000-4000-8000-000000000104', null,
  null, 1, 1, 'reschedule-noop'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'changed', result.response -> 'changed',
      'observationRevision', observation.revision,
      'notificationRevision', appointment.notification_revision,
      'eventCount', (
        select count(*) from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      )
    )
    from registration_observation_booking_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    where result.result_key = 'reschedule-noop'
  ),
  '{"changed":false,"observationRevision":1,"notificationRevision":1,"eventCount":1}'::jsonb,
  'same booking hash stores only its receipt and preserves customer revisions'
);

insert into registration_observation_booking_results(result_key, response)
select 'reschedule-changed', public.save_registration_observation_booking_v1(
  '99100000-0000-4000-8000-000000000116',
  (select (response -> 'observation' ->> 'observationId')::uuid from registration_observation_booking_results where result_key = 'book-1'),
  '99100000-0000-4000-8000-000000000103', 'normalized',
  '99100000-0000-4000-8000-000000000114', null,
  null, 1, 1, 'reschedule-changed'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'changed', result.response -> 'changed',
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'notificationRevision', appointment.notification_revision,
      'workflowRevision', track.workflow_revision,
      'attempts', track.observation_attempt_count,
      'eventCount', (
        select count(*) from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
          and event.event_kind = 'observation_rescheduled'
      )
    )
    from registration_observation_booking_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track on track.id = observation.track_id
    where result.result_key = 'reschedule-changed'
  ),
  '{"changed":true,"observationRevision":2,"feedbackRevision":0,"notificationRevision":2,"workflowRevision":2,"attempts":1,"eventCount":1}'::jsonb,
  'changed booking hash increments only observation and notification revisions'
);
select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99100000-0000-4000-8000-000000000116',
    (select (response -> 'observation' ->> 'observationId')::uuid from registration_observation_booking_results where result_key = 'book-1'),
    '99100000-0000-4000-8000-000000000103', 'normalized',
    '99100000-0000-4000-8000-000000000104', null,
    null, 1, 1, 'reschedule-stale'
  )$$,
  '23514', 'registration_observation_stale_revision',
  'stale reschedule revisions are non-retryable domain conflicts'
);
select throws_ok(
  $$select pg_temp.registration_observation_reschedule_stale_probe(
    (select (response -> 'observation' ->> 'observationId')::uuid from registration_observation_booking_results where result_key = 'book-1'),
    2, 1, 'reschedule-observation-stale'
  )$$,
  '23514', 'registration_observation_stale_revision',
  'observation-only stale reschedule uses the exact non-retryable domain SQLSTATE'
);
select throws_ok(
  $$select pg_temp.registration_observation_reschedule_stale_probe(
    (select (response -> 'observation' ->> 'observationId')::uuid from registration_observation_booking_results where result_key = 'book-1'),
    1, 2, 'reschedule-notification-stale'
  )$$,
  '23514', 'registration_observation_stale_revision',
  'notification-only stale reschedule uses the exact non-retryable domain SQLSTATE'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'observationRevision', observation.revision,
      'notificationRevision', appointment.notification_revision,
      'eventCount', (
        select count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      ),
      'staleReceiptCount', (
        select count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.request_key in (
          'reschedule-observation-stale',
          'reschedule-notification-stale'
        )
      )
    )
    from registration_observation_booking_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    where result.result_key = 'book-1'
  ),
  '{"observationRevision":2,"notificationRevision":2,"eventCount":2,"staleReceiptCount":0}'::jsonb,
  'independent stale reschedules leave revisions events and receipts unchanged'
);

insert into registration_observation_booking_results(result_key, response)
select 'cancel-1', public.cancel_registration_observation_v1(
  (select (response -> 'observation' ->> 'observationId')::uuid from registration_observation_booking_results where result_key = 'book-1'),
  2, 2, 'cancel-once'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'observationStatus', observation.status,
      'appointmentStatus', appointment.status,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'notificationRevision', appointment.notification_revision,
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'attempts', track.observation_attempt_count,
      'eventCount', (
        select count(*) from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
          and event.event_kind = 'observation_canceled'
      )
    )
    from registration_observation_booking_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track on track.id = observation.track_id
    where result.result_key = 'cancel-1'
  ),
  '{"observationStatus":"canceled","appointmentStatus":"canceled","observationRevision":3,"feedbackRevision":0,"notificationRevision":3,"workflowStatus":"observation_requested","workflowRevision":2,"attempts":1,"eventCount":1}'::jsonb,
  'cancel updates both lifecycle rows and leaves track and counter unchanged'
);
select is(
  public.cancel_registration_observation_v1(
    (select (response -> 'observation' ->> 'observationId')::uuid from registration_observation_booking_results where result_key = 'book-1'),
    2, 2, 'cancel-once'
  ),
  (select response from registration_observation_booking_results where result_key = 'cancel-1'),
  'cancel replay returns the original revisions and JSON'
);

insert into registration_observation_booking_results(result_key, response)
select 'book-2', public.save_registration_observation_booking_v1(
  '99100000-0000-4000-8000-000000000116', null,
  '99100000-0000-4000-8000-000000000103', 'normalized',
  '99100000-0000-4000-8000-000000000104', null,
  2, null, null, 'book-after-cancel'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'newId', first.response -> 'observation' ->> 'observationId'
        <> second.response -> 'observation' ->> 'observationId',
      'attempts', track.observation_attempt_count,
      'scheduledEvents', (
        select count(*) from dashboard_private.registration_observation_domain_events event
        join public.ops_registration_observations observation on observation.id = event.observation_id
        where observation.track_id = track.id
          and event.event_kind = 'observation_scheduled'
      )
    )
    from registration_observation_booking_results first
    join registration_observation_booking_results second on second.result_key = 'book-2'
    join public.ops_registration_subject_tracks track
      on track.id = '99100000-0000-4000-8000-000000000116'
    where first.result_key = 'book-1'
  ),
  '{"newId":true,"attempts":2,"scheduledEvents":2}'::jsonb,
  'a canceled attempt is never revived and the next attempt increments once'
);
select public.cancel_registration_observation_v1(
  (select (response -> 'observation' ->> 'observationId')::uuid from registration_observation_booking_results where result_key = 'book-2'),
  1, 1, 'cancel-second'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'dashboard_private.withdraw_registration_observation_v1_impl(uuid,text,text,uuid,integer,bigint,bigint,text,text)',
    'EXECUTE'
  )
  and pg_catalog.pg_get_functiondef(
    'public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)'::regprocedure
  ) like '%dashboard_private.withdraw_registration_observation_v1_impl%',
  'the retired public wrapper delegates to an owner-only implementation with no authenticated grant'
);

reset role;
select throws_ok(
  $$select dashboard_private.withdraw_registration_observation_v1_impl(
    '99100000-0000-4000-8000-000000000136',
    'return_to_previous', 'consultation_completed', null,
    1, null, null, null, 'withdraw-retired-owner'
  )$$,
  '55000', 'registration_observation_withdraw_retired',
  'the owner-only compatibility implementation fails closed with the exact retired contract'
);
set local role authenticated;

select lives_ok(
  $$select public.set_registration_workflow_status_v1(
    '99100000-0000-4000-8000-000000000166',
    'enrollment_requested', 1, 'manual-status-with-active-observation'
  )$$,
  'manual registration status remains editable despite an active observation'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'attempts', track.observation_attempt_count,
      'observationStatus', observation.status,
      'observationRevision', observation.revision,
      'appointmentStatus', appointment.status,
      'notificationRevision', appointment.notification_revision,
      'decision', observation.decision_kind,
      'enrollments', (
        select count(*)
        from public.ops_registration_enrollments enrollment
        where enrollment.track_id = track.id
      ),
      'admissionBatches', (
        select count(*)
        from public.ops_registration_admission_batches batch
        where batch.task_id = track.task_id
      )
    )
    from public.ops_registration_subject_tracks track
    join public.ops_registration_observations observation
      on observation.track_id = track.id
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    where track.id = '99100000-0000-4000-8000-000000000166'
  ),
  '{"workflowStatus":"enrollment_requested","workflowRevision":2,"attempts":1,"observationStatus":"scheduled","observationRevision":1,"appointmentStatus":"scheduled","notificationRevision":1,"decision":null,"enrollments":0,"admissionBatches":0}'::jsonb,
  'manual status editing leaves observation, notification, admission, and enrollment facts unchanged'
);

select ok(
  (
    select pg_catalog.bool_and(
      definition not like '%40001%'
      and definition like '%pg_catalog.pg_advisory_xact_lock%'
      and definition like '%for update%'
    )
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
        as definition
      from pg_catalog.pg_proc procedure
      where procedure.oid in (
        'dashboard_private.enter_registration_observation_v1_impl(uuid,integer,text)'::regprocedure,
        'dashboard_private.save_registration_observation_booking_v1_impl(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)'::regprocedure,
        'dashboard_private.cancel_registration_observation_v1_impl(uuid,integer,bigint,text)'::regprocedure
      )
    ) source
  ),
  'final observation mutations retain advisory and row locks without a synthetic retryable 40001'
);

select ok(
  (
    select pg_catalog.bool_and(
      pg_catalog.strpos(
        definition,
        'from dashboard_private.registration_observation_mutation_requests'
      ) > 0
      and pg_catalog.strpos(
        definition,
        'from dashboard_private.registration_observation_mutation_requests'
      ) < pg_catalog.strpos(
        definition,
        'perform dashboard_private.assert_registration_observation_runtime_v1()'
      )
      and pg_catalog.strpos(
        definition,
        'perform dashboard_private.assert_registration_observation_runtime_v1()'
      ) < pg_catalog.strpos(
        definition,
        'perform dashboard_private.assert_registration_observation_manager_access_v1('
      )
    )
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
        as definition
      from pg_catalog.pg_proc procedure
      where procedure.oid in (
        'dashboard_private.enter_registration_observation_v1_impl(uuid,integer,text)'::regprocedure,
        'dashboard_private.save_registration_observation_booking_v1_impl(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)'::regprocedure,
        'dashboard_private.cancel_registration_observation_v1_impl(uuid,integer,bigint,text)'::regprocedure
      )
    ) source
  ),
  'idempotent replay and key conflicts resolve before runtime readiness and manager access checks'
);

reset role;
create or replace function pg_temp.registration_observation_fail_event()
returns trigger
language plpgsql
as $$
begin
  raise exception 'synthetic_registration_observation_event_failure';
end;
$$;
create trigger registration_observation_fail_event
before insert on dashboard_private.registration_observation_domain_events
for each row execute function pg_temp.registration_observation_fail_event();
set local role authenticated;
select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99100000-0000-4000-8000-000000000156', null,
    '99100000-0000-4000-8000-000000000103', 'normalized',
    '99100000-0000-4000-8000-000000000104', null,
    1, null, null, 'book-event-failure'
  )$$,
  'P0001', 'synthetic_registration_observation_event_failure',
  'domain event failure aborts the booking statement'
);
reset role;
drop trigger registration_observation_fail_event
  on dashboard_private.registration_observation_domain_events;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'attempts', track.observation_attempt_count,
      'observations', (
        select count(*) from public.ops_registration_observations observation
        where observation.track_id = track.id
      ),
      'appointments', (
        select count(*) from public.ops_registration_appointments appointment
        where appointment.task_id = track.task_id
          and appointment.kind = 'observation_class'
      ),
      'receipts', (
        select count(*) from dashboard_private.registration_observation_mutation_requests request
        where request.request_key = 'book-event-failure'
      )
    )
    from public.ops_registration_subject_tracks track
    where track.id = '99100000-0000-4000-8000-000000000156'
  ),
  '{"attempts":0,"observations":0,"appointments":0,"receipts":0}'::jsonb,
  'counter appointment observation event audit and receipt roll back together'
);
reset role;

update public.teacher_catalogs
set subjects = array['영어팀']::text[]
where id = '99100000-0000-4000-8000-000000000101';

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '99100000-0000-4000-8000-000000000103',
    '99100000-0000-4000-8000-000000000199',
    'registration_observation_booking_test'
  );
end;
$$;
insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state, start_time, end_time,
  teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id,
  classroom_name_snapshot, origin, revision
)
values (
  '99100000-0000-4000-8000-000000000199',
  '99100000-0000-4000-8000-000000000103',
  'booking-team-alias-session', current_date + 30, 'active', '18:00', '20:00',
  '99100000-0000-4000-8000-000000000101', '청강 예약 원장',
  '99100000-0000-4000-8000-000000000102', '청강 예약 101호',
  'manual', 1
);

set local role authenticated;
select lives_ok(
  $$select public.save_class_lesson_session_v1(
    '99100000-0000-4000-8000-000000000199', 1, 'active', current_date + 30,
    '18:00', '20:00',
    '99100000-0000-4000-8000-000000000101',
    '99100000-0000-4000-8000-000000000102',
    '', '', '', '99100000-0000-4000-8000-000000000198',
    '청강 회차 교사 과목 별칭 검증'
  )$$,
  'class session save accepts a team-suffixed teacher subject for the same academic subject'
);
reset role;
select is(
  (select revision from public.class_lesson_sessions
    where id = '99100000-0000-4000-8000-000000000199'),
  2::bigint,
  'team-subject class session save commits the new revision'
);

select ok(
  not exists (
    select 1
    from dashboard_private.registration_observation_domain_events
    where event_kind not in (
      'observation_scheduled',
      'observation_rescheduled',
      'observation_canceled'
    )
  ),
  'booking ceiling persists only scheduled rescheduled and canceled domain events'
);

rollback;
