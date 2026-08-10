begin;
select plan(41);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

create extension if not exists dblink;

-- Each assertion below names the production break it catches: before start,
-- before end, stale observation, stale feedback, stale appointment, assigned
-- teacher, unrelated teacher, duplicate request replay, request key conflict,
-- proxy attribution, exact observation_attendance_recorded /
-- observation_feedback_submitted / observation_no_show facts, and the
-- dblink_send_query race where exactly one concurrent submit succeeds.

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('99300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-admin@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99300000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-staff@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99300000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-teacher@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-unrelated@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99300000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-director@example.invalid', crypt('feedback-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('99300000-0000-4000-8000-000000000001', 'admin', '청강 피드백 관리자', 'feedback-admin@example.invalid', now(), now()),
  ('99300000-0000-4000-8000-000000000002', 'staff', '청강 피드백 직원', 'feedback-staff@example.invalid', now(), now()),
  ('99300000-0000-4000-8000-000000000003', 'teacher', '청강 피드백 담당교사', 'feedback-teacher@example.invalid', now(), now()),
  ('99300000-0000-4000-8000-000000000004', 'teacher', '청강 피드백 무관교사', 'feedback-unrelated@example.invalid', now(), now()),
  ('99300000-0000-4000-8000-000000000005', 'teacher', '청강 피드백 원장', 'feedback-director@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id in (
  '99300000-0000-4000-8000-000000000003',
  '99300000-0000-4000-8000-000000000004'
);
insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email,
  dashboard_role
)
values
  (
    '99300000-0000-4000-8000-000000000101', '청강 피드백 담당교사',
    array['영어']::text[], true, 9971,
    '99300000-0000-4000-8000-000000000003',
    'feedback-teacher@example.invalid', 'teacher'
  ),
  (
    '99300000-0000-4000-8000-000000000111', '청강 피드백 무관교사',
    array['영어']::text[], true, 9972,
    '99300000-0000-4000-8000-000000000004',
    'feedback-unrelated@example.invalid', 'teacher'
  );
update public.profiles
set teacher_catalog_id = case id
  when '99300000-0000-4000-8000-000000000003' then '99300000-0000-4000-8000-000000000101'::uuid
  else '99300000-0000-4000-8000-000000000111'::uuid
end
where id in (
  '99300000-0000-4000-8000-000000000003',
  '99300000-0000-4000-8000-000000000004'
);

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  '99300000-0000-4000-8000-000000000102', '청강 피드백 101호',
  array['영어']::text[], true, 9973, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
values (
  '99300000-0000-4000-8000-000000000103', '청강 피드백 영어반',
  '영어', '수업 진행 중', 'normalized', '{"sessions":[]}'::jsonb
);

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '99300000-0000-4000-8000-000000000103',
    '99300000-0000-4000-8000-000000000112',
    'registration_observation_feedback_submit_test'
  );
end;
$$;
insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state,
  start_time, end_time, teacher_catalog_id, teacher_name_snapshot,
  classroom_catalog_id, classroom_name_snapshot, origin, revision
)
values
  (
    '99300000-0000-4000-8000-000000000104',
    '99300000-0000-4000-8000-000000000103',
    'feedback-past-session', current_date - 1, 'active', '18:00', '20:00',
    '99300000-0000-4000-8000-000000000101', '청강 피드백 담당교사',
    '99300000-0000-4000-8000-000000000102', '청강 피드백 101호',
    'manual', 7
  ),
  (
    '99300000-0000-4000-8000-000000000114',
    '99300000-0000-4000-8000-000000000103',
    'feedback-future-session', current_date + 1, 'active', '18:00', '20:00',
    '99300000-0000-4000-8000-000000000101', '청강 피드백 담당교사',
    '99300000-0000-4000-8000-000000000102', '청강 피드백 101호',
    'manual', 8
  ),
  (
    '99300000-0000-4000-8000-000000000124',
    '99300000-0000-4000-8000-000000000103',
    'feedback-ongoing-session', current_date, 'active',
    '00:00', '23:59',
    '99300000-0000-4000-8000-000000000101', '청강 피드백 담당교사',
    '99300000-0000-4000-8000-000000000102', '청강 피드백 101호',
    'manual', 9
  );

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values
  ('99300000-0000-4000-8000-000000000105', '청강 future boundary', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 미래학생'),
  ('99300000-0000-4000-8000-000000000115', '청강 ongoing boundary', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 진행학생'),
  ('99300000-0000-4000-8000-000000000125', '청강 attendance then feedback', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 참석학생'),
  ('99300000-0000-4000-8000-000000000135', '청강 atomic replay', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 원자학생'),
  ('99300000-0000-4000-8000-000000000145', '청강 no show', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 노쇼학생'),
  ('99300000-0000-4000-8000-000000000155', '청강 stale auth', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 stale학생'),
  ('99300000-0000-4000-8000-000000000165', '청강 proxy', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 대리학생'),
  ('99300000-0000-4000-8000-000000000175', '청강 event rollback', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 롤백학생'),
  ('99300000-0000-4000-8000-000000000185', '청강 runtime guard', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 runtime학생');

insert into public.ops_registration_details(task_id)
values
  ('99300000-0000-4000-8000-000000000105'),
  ('99300000-0000-4000-8000-000000000115'),
  ('99300000-0000-4000-8000-000000000125'),
  ('99300000-0000-4000-8000-000000000135'),
  ('99300000-0000-4000-8000-000000000145'),
  ('99300000-0000-4000-8000-000000000155'),
  ('99300000-0000-4000-8000-000000000165'),
  ('99300000-0000-4000-8000-000000000175'),
  ('99300000-0000-4000-8000-000000000185');

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values
  ('99300000-0000-4000-8000-000000000106', '99300000-0000-4000-8000-000000000105', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 1, now(), 'consultation_completed', 1),
  ('99300000-0000-4000-8000-000000000116', '99300000-0000-4000-8000-000000000115', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 2, now(), 'consultation_completed', 1),
  ('99300000-0000-4000-8000-000000000126', '99300000-0000-4000-8000-000000000125', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 5, now(), 'consultation_completed', 1),
  ('99300000-0000-4000-8000-000000000136', '99300000-0000-4000-8000-000000000135', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 2, now(), 'consultation_completed', 1),
  ('99300000-0000-4000-8000-000000000146', '99300000-0000-4000-8000-000000000145', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 3, now(), 'consultation_completed', 1),
  ('99300000-0000-4000-8000-000000000156', '99300000-0000-4000-8000-000000000155', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 4, now(), 'consultation_completed', 1),
  ('99300000-0000-4000-8000-000000000166', '99300000-0000-4000-8000-000000000165', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 9, now(), 'consultation_completed', 1),
  ('99300000-0000-4000-8000-000000000176', '99300000-0000-4000-8000-000000000175', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 4, now(), 'consultation_completed', 1),
  ('99300000-0000-4000-8000-000000000186', '99300000-0000-4000-8000-000000000185', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 1, now(), 'consultation_completed', 1);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, created_by
)
values
  ('99300000-0000-4000-8000-000000000107', '99300000-0000-4000-8000-000000000105', 'observation_class', ((current_date + 1 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 3, '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000117', '99300000-0000-4000-8000-000000000115', 'observation_class', now() - interval '1 hour', '본관', 'scheduled', 3, '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000127', '99300000-0000-4000-8000-000000000125', 'observation_class', ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 3, '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000137', '99300000-0000-4000-8000-000000000135', 'observation_class', ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 4, '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000147', '99300000-0000-4000-8000-000000000145', 'observation_class', ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 5, '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000157', '99300000-0000-4000-8000-000000000155', 'observation_class', ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 6, '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000167', '99300000-0000-4000-8000-000000000165', 'observation_class', ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 2, '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000177', '99300000-0000-4000-8000-000000000175', 'observation_class', ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 1, '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000187', '99300000-0000-4000-8000-000000000185', 'observation_class', ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 7, '99300000-0000-4000-8000-000000000001');

insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, status, feedback_revision, revision,
  created_by, updated_by
)
values
  ('99300000-0000-4000-8000-000000000108', '99300000-0000-4000-8000-000000000105', '99300000-0000-4000-8000-000000000106', '99300000-0000-4000-8000-000000000107', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000114', null, current_date + 1, ((current_date + 1 + time '18:00') at time zone 'Asia/Seoul'), ((current_date + 1 + time '20:00') at time zone 'Asia/Seoul'), 'active', 8, null, '{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000114","revision":8}'::jsonb, repeat('a', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 피드백 영어반', '청강 피드백 담당교사', '청강 피드백 101호', '본관', 'scheduled', 0, 1, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000118', '99300000-0000-4000-8000-000000000115', '99300000-0000-4000-8000-000000000116', '99300000-0000-4000-8000-000000000117', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000124', null, current_date, now() - interval '1 hour', now() + interval '1 hour', 'active', 9, null, '{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000124","revision":9}'::jsonb, repeat('b', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 피드백 영어반', '청강 피드백 담당교사', '청강 피드백 101호', '본관', 'scheduled', 0, 1, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000128', '99300000-0000-4000-8000-000000000125', '99300000-0000-4000-8000-000000000126', '99300000-0000-4000-8000-000000000127', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000104', null, current_date - 1, ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 1 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('c', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 피드백 영어반', '청강 피드백 담당교사', '청강 피드백 101호', '본관', 'scheduled', 0, 4, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000138', '99300000-0000-4000-8000-000000000135', '99300000-0000-4000-8000-000000000136', '99300000-0000-4000-8000-000000000137', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000104', null, current_date - 1, ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 1 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('d', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 피드백 영어반', '청강 피드백 담당교사', '청강 피드백 101호', '본관', 'scheduled', 0, 7, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000148', '99300000-0000-4000-8000-000000000145', '99300000-0000-4000-8000-000000000146', '99300000-0000-4000-8000-000000000147', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000104', null, current_date - 1, ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 1 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('e', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 피드백 영어반', '청강 피드백 담당교사', '청강 피드백 101호', '본관', 'scheduled', 0, 3, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000158', '99300000-0000-4000-8000-000000000155', '99300000-0000-4000-8000-000000000156', '99300000-0000-4000-8000-000000000157', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000104', null, current_date - 1, ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 1 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('f', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 피드백 영어반', '청강 피드백 담당교사', '청강 피드백 101호', '본관', 'scheduled', 0, 9, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000168', '99300000-0000-4000-8000-000000000165', '99300000-0000-4000-8000-000000000166', '99300000-0000-4000-8000-000000000167', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000104', null, current_date - 1, ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 1 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('1', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 피드백 영어반', '청강 피드백 담당교사', '청강 피드백 101호', '본관', 'scheduled', 0, 2, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000178', '99300000-0000-4000-8000-000000000175', '99300000-0000-4000-8000-000000000176', '99300000-0000-4000-8000-000000000177', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000104', null, current_date - 1, ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 1 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('2', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 피드백 영어반', '청강 피드백 담당교사', '청강 피드백 101호', '본관', 'scheduled', 0, 6, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001'),
  ('99300000-0000-4000-8000-000000000188', '99300000-0000-4000-8000-000000000185', '99300000-0000-4000-8000-000000000186', '99300000-0000-4000-8000-000000000187', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000104', null, current_date - 1, ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 1 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('3', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 피드백 영어반', '청강 피드백 담당교사', '청강 피드백 101호', '본관', 'scheduled', 0, 1, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001');

create or replace function pg_temp.registration_observation_feedback_set_actor(
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
      'role', 'authenticated'
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true
  );
end;
$$;

create temporary table registration_observation_feedback_results(
  result_key text primary key,
  response jsonb not null
) on commit drop;
grant all on registration_observation_feedback_results to authenticated;

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1,
    updated_at = now(),
    updated_by = '99300000-0000-4000-8000-000000000001'
where singleton = true;

select function_returns(
  'public', 'record_registration_observation_attendance_v1',
  array['uuid', 'bigint', 'integer', 'text'], 'jsonb'
);
select function_returns(
  'public', 'submit_registration_observation_feedback_v1',
  array['uuid', 'text', 'text', 'text', 'bigint', 'bigint', 'integer', 'text'],
  'jsonb'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.record_registration_observation_attendance_v1(uuid,bigint,integer,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.submit_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.submit_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.record_registration_observation_attendance_v1(uuid,bigint,integer,text)',
    'EXECUTE'
  ),
  'only authenticated owns the public feedback mutation surface'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.ops_registration_observations', 'INSERT'
  )
  and not has_table_privilege(
    'authenticated', 'public.ops_registration_observations', 'UPDATE'
  )
  and not has_table_privilege(
    'authenticated',
    'dashboard_private.registration_observation_mutation_requests',
    'SELECT'
  )
  and not has_table_privilege(
    'authenticated',
    'dashboard_private.registration_observation_domain_events',
    'SELECT'
  ),
  'feedback callers have no direct core or private-ledger write/read bypass'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles owner on owner.oid = procedure.proowner
    where namespace.nspname in ('public', 'dashboard_private')
      and procedure.proname in (
        'record_registration_observation_attendance_v1',
        'record_registration_observation_attendance_v1_impl',
        'submit_registration_observation_feedback_v1',
        'submit_registration_observation_feedback_v1_impl'
      )
      and owner.rolname = 'postgres'
      and exists (
        select 1
        from pg_catalog.unnest(
          coalesce(procedure.proconfig, array[]::text[])
        ) as config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      )
  ),
  4::bigint,
  'all four feedback functions are postgres owned with an empty search path'
);

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000002'
);
set local role authenticated;
select throws_ok(
  $$select public.record_registration_observation_attendance_v1(
    '99300000-0000-4000-8000-000000000108', 1, 3,
    'feedback-before-start-attendance'
  )$$,
  '55000', 'registration_observation_time_boundary_rejected',
  'attendance before start is rejected by canonical server time'
);
reset role;

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000003'
);
set local role authenticated;
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000108',
    'no_show', null, null, 1, 0, 3,
    'feedback-before-start-no-show'
  )$$,
  '55000', 'registration_observation_time_boundary_rejected',
  'no show before start is rejected by canonical server time'
);
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000118',
    'attended', 'fit', '종료 전 평가', 1, 0, 3,
    'feedback-before-end-fit'
  )$$,
  '55000', 'registration_observation_time_boundary_rejected',
  'fit feedback before end is rejected by canonical server time'
);
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000108',
    'attended', 'fit', '   ', 1, 0, 3,
    'feedback-invalid-empty-reason'
  )$$,
  '22023', 'registration_observation_feedback_invalid',
  'attended input requires a nonempty reason'
);
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000108',
    'no_show', 'fit', null, 1, 0, 3,
    'feedback-invalid-no-show-result'
  )$$,
  '22023', 'registration_observation_feedback_invalid',
  'no show input requires null suitability and reason'
);
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000108',
    null, null, null, 1, 0, 3,
    'feedback-invalid-null-attendance'
  )$$,
  '22023', 'registration_observation_feedback_invalid',
  'feedback input requires a nonnull attendance discriminator'
);
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000118',
    'attended', null, '적합성 누락', 1, 0, 3,
    'feedback-invalid-null-suitability'
  )$$,
  '22023', 'registration_observation_feedback_invalid',
  'attended input requires a nonnull suitability result'
);
select throws_ok(
  $$select public.record_registration_observation_attendance_v1(
    '99300000-0000-4000-8000-000000000158', 9, 6,
    'feedback-teacher-attendance-only'
  )$$,
  '42501', 'registration_observation_attendance_access_denied',
  'assigned teacher cannot call the attendance-only RPC'
);
reset role;

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000004'
);
set local role authenticated;
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000158',
    'attended', 'fit', '무관 교사', 9, 0, 6,
    'feedback-unrelated-teacher'
  )$$,
  'P0002', 'registration_observation_not_found',
  'unrelated teacher cannot submit feedback for the row'
);
reset role;

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000005'
);
set local role authenticated;
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000158',
    'attended', 'fit', '원장 직접 입력', 9, 0, 6,
    'feedback-director-submit'
  )$$,
  'P0002', 'registration_observation_not_found',
  'track director can read but cannot submit teacher feedback'
);
reset role;

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000003'
);
set local role authenticated;
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000158',
    'attended', 'fit', 'stale observation', 8, 0, 6,
    'feedback-stale-observation'
  )$$,
  '40001', 'registration_observation_stale_revision',
  'stale observation revision is rejected'
);
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000158',
    'attended', 'fit', 'stale feedback', 9, 1, 6,
    'feedback-stale-feedback'
  )$$,
  '40001', 'registration_observation_stale_revision',
  'stale feedback revision is rejected'
);
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000158',
    'attended', 'fit', 'stale appointment', 9, 0, 5,
    'feedback-stale-appointment'
  )$$,
  '40001', 'registration_observation_stale_revision',
  'stale appointment notification revision is rejected'
);
reset role;

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000002'
);
set local role authenticated;
insert into registration_observation_feedback_results(result_key, response)
select 'attendance', public.record_registration_observation_attendance_v1(
  '99300000-0000-4000-8000-000000000128', 4, 3,
  'feedback-attendance-success'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'operation', response ->> 'operation',
      'workflowStatus', response ->> 'workflowStatus',
      'workflowRevision', (response ->> 'workflowRevision')::integer,
      'observationStatus', response #>> '{observation,status}',
      'observationRevision',
        (response #>> '{observation,revision}')::bigint,
      'feedbackRevision',
        (response #>> '{observation,feedbackRevision}')::bigint,
      'appointmentStatus', response #>> '{appointment,status}',
      'notificationRevision',
        (response #>> '{appointment,notificationRevision}')::integer,
      'changed', (response ->> 'changed')::boolean
    )
    from registration_observation_feedback_results
    where result_key = 'attendance'
  ),
  '{"operation":"record_attendance","workflowStatus":"observation_feedback_pending","workflowRevision":6,"observationStatus":"attended_feedback_pending","observationRevision":5,"feedbackRevision":0,"appointmentStatus":"completed","notificationRevision":3,"changed":true}'::jsonb,
  'attendance response returns the exact unchanged-notification revision matrix'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'appointmentStatus', appointment.status,
      'notificationRevision', appointment.notification_revision,
      'observationStatus', observation.status,
      'attendance', observation.attendance,
      'attendanceActor', observation.attendance_recorded_by,
      'attendanceAt', observation.attendance_recorded_at is not null,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision
    )
    from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    where observation.id = '99300000-0000-4000-8000-000000000128'
  ),
  '{"appointmentStatus":"completed","notificationRevision":3,"observationStatus":"attended_feedback_pending","attendance":"attended","attendanceActor":"99300000-0000-4000-8000-000000000002","attendanceAt":true,"observationRevision":5,"feedbackRevision":0,"workflowStatus":"observation_feedback_pending","workflowRevision":6}'::jsonb,
  'attendance updates appointment observation and track atomically'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'eventKind', event.event_kind,
      'observationId', event.observation_id,
      'appointmentId', event.appointment_id,
      'notificationRevision', event.notification_revision,
      'bookingFactHash', event.booking_fact_hash,
      'sourceRevision', event.source_revision
    )
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = '99300000-0000-4000-8000-000000000128'
  ),
  '{"eventKind":"observation_attendance_recorded","observationId":"99300000-0000-4000-8000-000000000128","appointmentId":"99300000-0000-4000-8000-000000000127","notificationRevision":3,"bookingFactHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","sourceRevision":{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}}'::jsonb,
  'attendance emits one exact tagged domain outbox fact'
);

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000002'
);
set local role authenticated;
insert into registration_observation_feedback_results(result_key, response)
select 'attendance-replay', public.record_registration_observation_attendance_v1(
  '99300000-0000-4000-8000-000000000128', 4, 3,
  'feedback-attendance-success'
);
select throws_ok(
  $$select public.record_registration_observation_attendance_v1(
    '99300000-0000-4000-8000-000000000128', 5, 3,
    'feedback-attendance-success'
  )$$,
  '23505', 'registration_observation_request_key_conflict',
  'attendance request key conflict rejects a different fingerprint'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'sameResponse', original.response = replay.response,
      'events', (
        select count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = '99300000-0000-4000-8000-000000000128'
      ),
      'receipts', (
        select count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.track_id = '99300000-0000-4000-8000-000000000126'
          and request.request_key = 'feedback-attendance-success'
      )
    )
    from registration_observation_feedback_results original
    join registration_observation_feedback_results replay on true
    where original.result_key = 'attendance'
      and replay.result_key = 'attendance-replay'
  ),
  '{"sameResponse":true,"events":1,"receipts":1}'::jsonb,
  'duplicate attendance request replay returns the stored response once'
);

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000003'
);
set local role authenticated;
insert into registration_observation_feedback_results(result_key, response)
select 'feedback-after-attendance',
  public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000128',
    'attended', 'fit', '  수업 참여가 좋음  ', 5, 0, 3,
    'feedback-after-attendance-success'
  );
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'operation', response ->> 'operation',
      'workflowStatus', response ->> 'workflowStatus',
      'workflowRevision', (response ->> 'workflowRevision')::integer,
      'observationStatus', response #>> '{observation,status}',
      'observationRevision',
        (response #>> '{observation,revision}')::bigint,
      'feedbackRevision',
        (response #>> '{observation,feedbackRevision}')::bigint,
      'notificationRevision',
        (response #>> '{appointment,notificationRevision}')::integer
    )
    from registration_observation_feedback_results
    where result_key = 'feedback-after-attendance'
  ),
  '{"operation":"submit_feedback","workflowStatus":"observation_completed","workflowRevision":7,"observationStatus":"completed","observationRevision":6,"feedbackRevision":1,"notificationRevision":3}'::jsonb,
  'feedback after attendance returns the exact independent revision matrix'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'appointmentStatus', appointment.status,
      'notificationRevision', appointment.notification_revision,
      'observationStatus', observation.status,
      'attendance', observation.attendance,
      'attendanceActor', observation.attendance_recorded_by,
      'suitability', observation.suitability_result,
      'reason', observation.feedback_reason,
      'feedbackActor', observation.feedback_submitted_by,
      'feedbackAt', observation.feedback_submitted_at is not null,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision
    )
    from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    where observation.id = '99300000-0000-4000-8000-000000000128'
  ),
  '{"appointmentStatus":"completed","notificationRevision":3,"observationStatus":"completed","attendance":"attended","attendanceActor":"99300000-0000-4000-8000-000000000002","suitability":"fit","reason":"수업 참여가 좋음","feedbackActor":"99300000-0000-4000-8000-000000000003","feedbackAt":true,"observationRevision":6,"feedbackRevision":1,"workflowStatus":"observation_completed","workflowRevision":7}'::jsonb,
  'feedback preserves attendance attribution and records the actual teacher'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'events', count(*),
      'feedbackEvents', count(*) filter (
        where event.event_kind = 'observation_feedback_submitted'
      ),
      'sourceRevision', (
        max(event.source_revision::text) filter (
          where event.event_kind = 'observation_feedback_submitted'
        )
      )::jsonb
    )
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = '99300000-0000-4000-8000-000000000128'
  ),
  '{"events":2,"feedbackEvents":1,"sourceRevision":{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}}'::jsonb,
  'feedback adds one exact source-tagged event without replacing attendance'
);
select is(
  (
    select count(*)
    from public.ops_task_events event
    where event.task_id = '99300000-0000-4000-8000-000000000125'
      and event.event_type = 'registration_track_event'
      and (event.after_value::jsonb ->> 'event_type') in (
        'registration_observation_attendance_recorded',
        'registration_observation_feedback_submitted'
      )
  ),
  2::bigint,
  'attendance and feedback each persist one audit event'
);

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000003'
);
set local role authenticated;
insert into registration_observation_feedback_results(result_key, response)
select 'atomic-feedback', public.submit_registration_observation_feedback_v1(
  '99300000-0000-4000-8000-000000000138',
  'attended', 'unfit', '  진도 적응이 어려움  ', 7, 0, 4,
  'feedback-atomic-success'
);
insert into registration_observation_feedback_results(result_key, response)
select 'atomic-feedback-replay',
  public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000138',
    'attended', 'unfit', '  진도 적응이 어려움  ', 7, 0, 4,
    'feedback-atomic-success'
  );
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000138',
    'attended', 'unfit', '다른 사유', 7, 0, 4,
    'feedback-atomic-success'
  )$$,
  '23505', 'registration_observation_request_key_conflict',
  'feedback request key conflict rejects a different fingerprint'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'operation', original.response ->> 'operation',
      'sameResponse', original.response = replay.response,
      'observationRevision',
        (original.response #>> '{observation,revision}')::bigint,
      'feedbackRevision',
        (original.response #>> '{observation,feedbackRevision}')::bigint,
      'workflowRevision',
        (original.response ->> 'workflowRevision')::integer,
      'notificationRevision',
        (original.response #>> '{appointment,notificationRevision}')::integer
    )
    from registration_observation_feedback_results original
    join registration_observation_feedback_results replay on true
    where original.result_key = 'atomic-feedback'
      and replay.result_key = 'atomic-feedback-replay'
  ),
  '{"operation":"submit_feedback","sameResponse":true,"observationRevision":8,"feedbackRevision":1,"workflowRevision":3,"notificationRevision":4}'::jsonb,
  'atomic attended feedback and duplicate request replay return exact revisions'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'appointmentStatus', appointment.status,
      'notificationRevision', appointment.notification_revision,
      'observationStatus', observation.status,
      'attendance', observation.attendance,
      'attendanceActor', observation.attendance_recorded_by,
      'suitability', observation.suitability_result,
      'reason', observation.feedback_reason,
      'feedbackActor', observation.feedback_submitted_by,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'events', (
        select count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      ),
      'receipts', (
        select count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.track_id = track.id
          and request.request_key = 'feedback-atomic-success'
      )
    )
    from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    where observation.id = '99300000-0000-4000-8000-000000000138'
  ),
  '{"appointmentStatus":"completed","notificationRevision":4,"observationStatus":"completed","attendance":"attended","attendanceActor":"99300000-0000-4000-8000-000000000003","suitability":"unfit","reason":"진도 적응이 어려움","feedbackActor":"99300000-0000-4000-8000-000000000003","observationRevision":8,"feedbackRevision":1,"workflowStatus":"observation_completed","workflowRevision":3,"events":1,"receipts":1}'::jsonb,
  'atomic attended feedback changes every core fact exactly once'
);

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000003'
);
set local role authenticated;
insert into registration_observation_feedback_results(result_key, response)
select 'no-show', public.submit_registration_observation_feedback_v1(
  '99300000-0000-4000-8000-000000000148',
  'no_show', null, null, 3, 0, 5,
  'feedback-no-show-success'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'operation', response ->> 'operation',
      'observationRevision',
        (response #>> '{observation,revision}')::bigint,
      'feedbackRevision',
        (response #>> '{observation,feedbackRevision}')::bigint,
      'workflowRevision', (response ->> 'workflowRevision')::integer,
      'notificationRevision',
        (response #>> '{appointment,notificationRevision}')::integer
    )
    from registration_observation_feedback_results
    where result_key = 'no-show'
  ),
  '{"operation":"submit_feedback","observationRevision":4,"feedbackRevision":0,"workflowRevision":4,"notificationRevision":5}'::jsonb,
  'no show response increments no feedback or notification revision'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'appointmentStatus', appointment.status,
      'notificationRevision', appointment.notification_revision,
      'observationStatus', observation.status,
      'attendance', observation.attendance,
      'attendanceActor', observation.attendance_recorded_by,
      'suitabilityIsNull', observation.suitability_result is null,
      'reasonIsNull', observation.feedback_reason is null,
      'feedbackActorIsNull', observation.feedback_submitted_by is null,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision
    )
    from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    where observation.id = '99300000-0000-4000-8000-000000000148'
  ),
  '{"appointmentStatus":"completed","notificationRevision":5,"observationStatus":"no_show","attendance":"no_show","attendanceActor":"99300000-0000-4000-8000-000000000003","suitabilityIsNull":true,"reasonIsNull":true,"feedbackActorIsNull":true,"observationRevision":4,"feedbackRevision":0,"workflowStatus":"observation_completed","workflowRevision":4}'::jsonb,
  'no show writes no suitability or feedback facts'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'eventKind', event.event_kind,
      'notificationRevision', event.notification_revision,
      'bookingFactHash', event.booking_fact_hash,
      'sourceRevision', event.source_revision
    )
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = '99300000-0000-4000-8000-000000000148'
  ),
  '{"eventKind":"observation_no_show","notificationRevision":5,"bookingFactHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","sourceRevision":{"authority":"normalized","sessionId":"99300000-0000-4000-8000-000000000104","revision":7}}'::jsonb,
  'no show emits one exact tagged domain outbox fact'
);

select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into registration_observation_feedback_results(result_key, response)
select 'proxy', public.submit_registration_observation_feedback_v1(
  '99300000-0000-4000-8000-000000000168',
  'attended', 'fit', '관리자 대리 입력', 2, 0, 2,
  'feedback-proxy-success'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'teacherProfileId', observation.teacher_profile_id,
      'attendanceActor', observation.attendance_recorded_by,
      'feedbackActor', observation.feedback_submitted_by,
      'proxySubmitted', detail.payload -> 'proxySubmitted',
      'feedbackSubmittedByName',
        detail.payload -> 'feedbackSubmittedByName',
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'workflowRevision', track.workflow_revision,
      'notificationRevision', appointment.notification_revision
    )
    from public.ops_registration_observations observation
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    cross join lateral public.get_registration_observation_feedback_v1(
      observation.id
    ) detail(payload)
    where observation.id = '99300000-0000-4000-8000-000000000168'
  ),
  '{"teacherProfileId":"99300000-0000-4000-8000-000000000003","attendanceActor":"99300000-0000-4000-8000-000000000001","feedbackActor":"99300000-0000-4000-8000-000000000001","proxySubmitted":true,"feedbackSubmittedByName":"청강 피드백 관리자","observationRevision":3,"feedbackRevision":1,"workflowRevision":10,"notificationRevision":2}'::jsonb,
  'proxy submission preserves the assigned teacher and stores the actual actor'
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 0
where singleton = true;
select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000003'
);
set local role authenticated;
select throws_ok(
  $$select public.submit_registration_observation_feedback_v1(
    '99300000-0000-4000-8000-000000000188',
    'attended', 'fit', 'runtime guard', 1, 0, 7,
    'feedback-runtime-inactive'
  )$$,
  '55000', 'registration_observation_runtime_inactive',
  'runtime zero rejects feedback before any core write'
);
reset role;
update dashboard_private.registration_observation_runtime_settings
set activation_version = 1
where singleton = true;

select ok(
  not exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id in (
      '99300000-0000-4000-8000-000000000126',
      '99300000-0000-4000-8000-000000000136',
      '99300000-0000-4000-8000-000000000146',
      '99300000-0000-4000-8000-000000000166'
    )
  )
  and not exists (
    select 1
    from public.ops_registration_admission_batches admission
    where admission.task_id in (
      '99300000-0000-4000-8000-000000000125',
      '99300000-0000-4000-8000-000000000135',
      '99300000-0000-4000-8000-000000000145',
      '99300000-0000-4000-8000-000000000165'
    )
  ),
  'attendance feedback and no show create no enrollment admission or payment facts'
);

create temporary table registration_observation_feedback_concurrency_results(
  worker text not null,
  sqlstate text not null,
  response jsonb,
  message text
) on commit drop;

select dblink_connect(
  'feedback_submit_a',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select dblink_connect(
  'feedback_submit_b',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select dblink_exec(connection_name, $remote$
  create or replace function pg_temp.registration_observation_feedback_capture(
    p_sql text
  )
  returns table(result_sqlstate text, response jsonb, message text)
  language plpgsql
  as $capture$
  begin
    begin
      execute p_sql into response;
      result_sqlstate := '00000';
      message := null;
      return next;
    exception
      when others then
        get stacked diagnostics
          result_sqlstate = returned_sqlstate,
          message = message_text;
        response := null;
        return next;
    end;
  end;
  $capture$;
  do $actor$
  begin
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      '99200000-0000-4000-8000-000000000003',
      false
    );
    perform pg_catalog.set_config(
      'request.jwt.claim.role', 'authenticated', false
    );
  end;
  $actor$;
  set role authenticated;
$remote$)
from (values ('feedback_submit_a'), ('feedback_submit_b'))
  connection(connection_name);

select dblink_send_query(
  'feedback_submit_a',
  $query$select * from pg_temp.registration_observation_feedback_capture(
    $statement$select public.submit_registration_observation_feedback_v1(
      '99200000-0000-4000-8000-000000000108',
      'attended', 'fit', '동시 제출 A', 1, 0, 3,
      'feedback-concurrent-a'
    )$statement$
  )$query$
);
select dblink_send_query(
  'feedback_submit_b',
  $query$select * from pg_temp.registration_observation_feedback_capture(
    $statement$select public.submit_registration_observation_feedback_v1(
      '99200000-0000-4000-8000-000000000108',
      'attended', 'unfit', '동시 제출 B', 1, 0, 3,
      'feedback-concurrent-b'
    )$statement$
  )$query$
);
insert into registration_observation_feedback_concurrency_results
select 'a', result.*
from dblink_get_result('feedback_submit_a')
  as result(sqlstate text, response jsonb, message text);
insert into registration_observation_feedback_concurrency_results
select 'b', result.*
from dblink_get_result('feedback_submit_b')
  as result(sqlstate text, response jsonb, message text);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'successes', count(*) filter (where sqlstate = '00000'),
      'stale', count(*) filter (where sqlstate = '40001')
    )
    from registration_observation_feedback_concurrency_results
  ),
  '{"successes":1,"stale":1}'::jsonb,
  'one concurrent submit succeeds and one stale worker loses'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'appointmentStatus', appointment.status,
      'notificationRevision', appointment.notification_revision,
      'observationStatus', observation.status,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'events', (
        select count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      ),
      'receipts', (
        select count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.track_id = track.id
          and request.request_key in (
            'feedback-concurrent-a', 'feedback-concurrent-b'
          )
      )
    )
    from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    where observation.id = '99200000-0000-4000-8000-000000000108'
  ),
  '{"appointmentStatus":"completed","notificationRevision":3,"observationStatus":"completed","observationRevision":2,"feedbackRevision":1,"workflowStatus":"observation_completed","workflowRevision":2,"events":1,"receipts":1}'::jsonb,
  'concurrent winner commits one atomic state event and request receipt'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'eventKind', event.event_kind,
      'notificationRevision', event.notification_revision,
      'bookingFactHash', event.booking_fact_hash,
      'sourceRevision', event.source_revision
    )
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = '99200000-0000-4000-8000-000000000108'
  ),
  '{"eventKind":"observation_feedback_submitted","notificationRevision":3,"bookingFactHash":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","sourceRevision":{"authority":"normalized","sessionId":"99200000-0000-4000-8000-000000000104","revision":7}}'::jsonb,
  'concurrent winner copies the committed fixture source tag exactly'
);

select dblink_disconnect('feedback_submit_a');
select dblink_disconnect('feedback_submit_b');

create or replace function pg_temp.registration_observation_fail_feedback_event()
returns trigger
language plpgsql
as $$
begin
  raise exception 'synthetic_registration_observation_feedback_event_failure';
end;
$$;
create trigger registration_observation_fail_feedback_event
before insert on dashboard_private.registration_observation_domain_events
for each row execute function pg_temp.registration_observation_fail_feedback_event();
select pg_temp.registration_observation_feedback_set_actor(
  '99300000-0000-4000-8000-000000000002'
);
set local role authenticated;
select throws_ok(
  $$select public.record_registration_observation_attendance_v1(
    '99300000-0000-4000-8000-000000000178', 6, 1,
    'feedback-event-failure'
  )$$,
  'P0001', 'synthetic_registration_observation_feedback_event_failure',
  'domain event failure aborts attendance atomically'
);
reset role;
drop trigger registration_observation_fail_feedback_event
  on dashboard_private.registration_observation_domain_events;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'appointmentStatus', appointment.status,
      'notificationRevision', appointment.notification_revision,
      'observationStatus', observation.status,
      'attendanceIsNull', observation.attendance is null,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'events', (
        select count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      ),
      'receipts', (
        select count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.track_id = track.id
      ),
      'audits', (
        select count(*)
        from public.ops_task_events event
        where event.task_id = track.task_id
          and event.event_type = 'registration_track_event'
          and event.after_value::jsonb ->> 'event_type'
            = 'registration_observation_attendance_recorded'
      )
    )
    from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    where observation.id = '99300000-0000-4000-8000-000000000178'
  ),
  '{"appointmentStatus":"scheduled","notificationRevision":1,"observationStatus":"scheduled","attendanceIsNull":true,"observationRevision":6,"feedbackRevision":0,"workflowStatus":"observation_requested","workflowRevision":4,"events":0,"receipts":0,"audits":0}'::jsonb,
  'event failure rolls back appointment observation track audit and receipt'
);

select * from finish();
rollback;
