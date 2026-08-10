begin;
select plan(40);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

create extension if not exists dblink;

-- Every assertion names the production break it catches: teacher correction
-- before decision, teacher correction after decision, admin same-result reason
-- correction, stale feedback revision, duplicate correction replay, duplicate
-- decision replay, request key conflict, waiting class subject mismatch,
-- re-observation active attempt, notification revision unchanged, exact
-- decision mapping, committed dblink_send_query overlap, and the seeded
-- financial state before/after fingerprint. The shared runner additionally
-- requires the registration_observation_provider_outbox_delta=0 receipt.

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('99400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'decision-admin@example.invalid', crypt('decision-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99400000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'decision-staff@example.invalid', crypt('decision-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99400000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'decision-teacher@example.invalid', crypt('decision-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99400000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'decision-unrelated@example.invalid', crypt('decision-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99400000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'decision-director@example.invalid', crypt('decision-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99400000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'decision-next-director@example.invalid', crypt('decision-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('99400000-0000-4000-8000-000000000001', 'admin', '청강 결정 관리자', 'decision-admin@example.invalid', now(), now()),
  ('99400000-0000-4000-8000-000000000002', 'staff', '청강 결정 직원', 'decision-staff@example.invalid', now(), now()),
  ('99400000-0000-4000-8000-000000000003', 'teacher', '청강 결정 담당교사', 'decision-teacher@example.invalid', now(), now()),
  ('99400000-0000-4000-8000-000000000004', 'teacher', '청강 결정 무관교사', 'decision-unrelated@example.invalid', now(), now()),
  ('99400000-0000-4000-8000-000000000005', 'teacher', '청강 결정 원장', 'decision-director@example.invalid', now(), now()),
  ('99400000-0000-4000-8000-000000000006', 'teacher', '청강 결정 후임원장', 'decision-next-director@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id in (
  '99400000-0000-4000-8000-000000000003',
  '99400000-0000-4000-8000-000000000004'
);
insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email,
  dashboard_role
)
values
  ('99400000-0000-4000-8000-000000000101', '청강 결정 담당교사', array['영어']::text[], true, 9961, '99400000-0000-4000-8000-000000000003', 'decision-teacher@example.invalid', 'teacher'),
  ('99400000-0000-4000-8000-000000000111', '청강 결정 무관교사', array['영어']::text[], true, 9962, '99400000-0000-4000-8000-000000000004', 'decision-unrelated@example.invalid', 'teacher');
update public.profiles
set teacher_catalog_id = case id
  when '99400000-0000-4000-8000-000000000003'
    then '99400000-0000-4000-8000-000000000101'::uuid
  else '99400000-0000-4000-8000-000000000111'::uuid
end
where id in (
  '99400000-0000-4000-8000-000000000003',
  '99400000-0000-4000-8000-000000000004'
);

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  '99400000-0000-4000-8000-000000000102', '청강 결정 101호',
  array['영어']::text[], true, 9963, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
values
  ('99400000-0000-4000-8000-000000000103', '청강 결정 영어반', '영어', '수업 진행 중', 'normalized', '{"sessions":[]}'::jsonb),
  ('99400000-0000-4000-8000-000000000193', '청강 결정 수학반', '수학', '수업 진행 중', 'normalized', '{"sessions":[]}'::jsonb);

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '99400000-0000-4000-8000-000000000103',
    '99400000-0000-4000-8000-000000000194',
    'registration_observation_feedback_decisions_test'
  );
end;
$$;
insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state,
  start_time, end_time, teacher_catalog_id, teacher_name_snapshot,
  classroom_catalog_id, classroom_name_snapshot, origin, revision
)
values (
  '99400000-0000-4000-8000-000000000104',
  '99400000-0000-4000-8000-000000000103',
  'decision-past-session', current_date - 2, 'active', '18:00', '20:00',
  '99400000-0000-4000-8000-000000000101', '청강 결정 담당교사',
  '99400000-0000-4000-8000-000000000102', '청강 결정 101호',
  'manual', 7
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values
  ('99400000-0000-4000-8000-000000000105', '청강 correction enrollment', 'registration', 'requested', 'normal', '99400000-0000-4000-8000-000000000001', '합성 결정학생1'),
  ('99400000-0000-4000-8000-000000000115', '청강 waiting current', 'registration', 'requested', 'normal', '99400000-0000-4000-8000-000000000001', '합성 결정학생2'),
  ('99400000-0000-4000-8000-000000000125', '청강 waiting new', 'registration', 'requested', 'normal', '99400000-0000-4000-8000-000000000001', '합성 결정학생3'),
  ('99400000-0000-4000-8000-000000000135', '청강 waiting next', 'registration', 'requested', 'normal', '99400000-0000-4000-8000-000000000001', '합성 결정학생4'),
  ('99400000-0000-4000-8000-000000000145', '청강 not registered', 'registration', 'requested', 'normal', '99400000-0000-4000-8000-000000000001', '합성 결정학생5'),
  ('99400000-0000-4000-8000-000000000155', '청강 re observation', 'registration', 'requested', 'normal', '99400000-0000-4000-8000-000000000001', '합성 결정학생6'),
  ('99400000-0000-4000-8000-000000000165', '청강 invalid scheduled', 'registration', 'requested', 'normal', '99400000-0000-4000-8000-000000000001', '합성 결정학생7');

insert into public.ops_registration_details(task_id)
values
  ('99400000-0000-4000-8000-000000000105'),
  ('99400000-0000-4000-8000-000000000115'),
  ('99400000-0000-4000-8000-000000000125'),
  ('99400000-0000-4000-8000-000000000135'),
  ('99400000-0000-4000-8000-000000000145'),
  ('99400000-0000-4000-8000-000000000155'),
  ('99400000-0000-4000-8000-000000000165');

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values
  ('99400000-0000-4000-8000-000000000106', '99400000-0000-4000-8000-000000000105', '영어', 'consultation_waiting', '99400000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_completed', 7, now(), 'consultation_completed', 1),
  ('99400000-0000-4000-8000-000000000116', '99400000-0000-4000-8000-000000000115', '영어', 'consultation_waiting', '99400000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_completed', 8, now(), 'consultation_completed', 1),
  ('99400000-0000-4000-8000-000000000126', '99400000-0000-4000-8000-000000000125', '영어', 'consultation_waiting', '99400000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_completed', 9, now(), 'consultation_completed', 1),
  ('99400000-0000-4000-8000-000000000136', '99400000-0000-4000-8000-000000000135', '영어', 'consultation_waiting', '99400000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_completed', 10, now(), 'consultation_completed', 1),
  ('99400000-0000-4000-8000-000000000146', '99400000-0000-4000-8000-000000000145', '영어', 'consultation_waiting', '99400000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_completed', 11, now(), 'consultation_completed', 1),
  ('99400000-0000-4000-8000-000000000156', '99400000-0000-4000-8000-000000000155', '영어', 'consultation_waiting', '99400000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_completed', 12, now(), 'consultation_completed', 1),
  ('99400000-0000-4000-8000-000000000166', '99400000-0000-4000-8000-000000000165', '영어', 'consultation_waiting', '99400000-0000-4000-8000-000000000005', 'manual', now(), false, 'observation_requested', 13, now(), 'consultation_completed', 1);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, created_by
)
values
  ('99400000-0000-4000-8000-000000000107', '99400000-0000-4000-8000-000000000105', 'observation_class', now() - interval '2 days', '본관', 'completed', 4, '99400000-0000-4000-8000-000000000001'),
  ('99400000-0000-4000-8000-000000000117', '99400000-0000-4000-8000-000000000115', 'observation_class', now() - interval '2 days', '본관', 'completed', 5, '99400000-0000-4000-8000-000000000001'),
  ('99400000-0000-4000-8000-000000000127', '99400000-0000-4000-8000-000000000125', 'observation_class', now() - interval '2 days', '본관', 'completed', 6, '99400000-0000-4000-8000-000000000001'),
  ('99400000-0000-4000-8000-000000000137', '99400000-0000-4000-8000-000000000135', 'observation_class', now() - interval '2 days', '본관', 'completed', 7, '99400000-0000-4000-8000-000000000001'),
  ('99400000-0000-4000-8000-000000000147', '99400000-0000-4000-8000-000000000145', 'observation_class', now() - interval '2 days', '본관', 'completed', 8, '99400000-0000-4000-8000-000000000001'),
  ('99400000-0000-4000-8000-000000000157', '99400000-0000-4000-8000-000000000155', 'observation_class', now() - interval '2 days', '본관', 'completed', 9, '99400000-0000-4000-8000-000000000001'),
  ('99400000-0000-4000-8000-000000000167', '99400000-0000-4000-8000-000000000165', 'observation_class', now() + interval '1 day', '본관', 'scheduled', 10, '99400000-0000-4000-8000-000000000001');

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
  feedback_revision, revision, created_by, updated_by, created_at, updated_at
)
values
  ('99400000-0000-4000-8000-000000000108', '99400000-0000-4000-8000-000000000105', '99400000-0000-4000-8000-000000000106', '99400000-0000-4000-8000-000000000107', '99400000-0000-4000-8000-000000000103', 'normalized', '99400000-0000-4000-8000-000000000104', null, current_date - 2, now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 'active', 7, null, '{"authority":"normalized","sessionId":"99400000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('a', 64), '99400000-0000-4000-8000-000000000101', '99400000-0000-4000-8000-000000000003', '99400000-0000-4000-8000-000000000102', '영어', '청강 결정 영어반', '청강 결정 담당교사', '청강 결정 101호', '본관', 'completed', 'attended', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 'unfit', '초기 부적합 사유', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 2, 5, '99400000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', '2026-08-01 09:00:00+09', now()),
  ('99400000-0000-4000-8000-000000000118', '99400000-0000-4000-8000-000000000115', '99400000-0000-4000-8000-000000000116', '99400000-0000-4000-8000-000000000117', '99400000-0000-4000-8000-000000000103', 'normalized', '99400000-0000-4000-8000-000000000104', null, current_date - 2, now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 'active', 7, null, '{"authority":"normalized","sessionId":"99400000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('b', 64), '99400000-0000-4000-8000-000000000101', '99400000-0000-4000-8000-000000000003', '99400000-0000-4000-8000-000000000102', '영어', '청강 결정 영어반', '청강 결정 담당교사', '청강 결정 101호', '본관', 'completed', 'attended', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 'fit', '현재 반 대기 적합', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 1, 2, '99400000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', '2026-08-01 10:00:00+09', now()),
  ('99400000-0000-4000-8000-000000000128', '99400000-0000-4000-8000-000000000125', '99400000-0000-4000-8000-000000000126', '99400000-0000-4000-8000-000000000127', '99400000-0000-4000-8000-000000000103', 'normalized', '99400000-0000-4000-8000-000000000104', null, current_date - 2, now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 'active', 7, null, '{"authority":"normalized","sessionId":"99400000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('c', 64), '99400000-0000-4000-8000-000000000101', '99400000-0000-4000-8000-000000000003', '99400000-0000-4000-8000-000000000102', '영어', '청강 결정 영어반', '청강 결정 담당교사', '청강 결정 101호', '본관', 'completed', 'attended', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 'fit', '신규 반 대기 적합', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 2, 3, '99400000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', '2026-08-01 11:00:00+09', now()),
  ('99400000-0000-4000-8000-000000000138', '99400000-0000-4000-8000-000000000135', '99400000-0000-4000-8000-000000000136', '99400000-0000-4000-8000-000000000137', '99400000-0000-4000-8000-000000000103', 'normalized', '99400000-0000-4000-8000-000000000104', null, current_date - 2, now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 'active', 7, null, '{"authority":"normalized","sessionId":"99400000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('d', 64), '99400000-0000-4000-8000-000000000101', '99400000-0000-4000-8000-000000000003', '99400000-0000-4000-8000-000000000102', '영어', '청강 결정 영어반', '청강 결정 담당교사', '청강 결정 101호', '본관', 'completed', 'attended', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 'fit', '다음 개강 대기 적합', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 3, 4, '99400000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', '2026-08-01 12:00:00+09', now()),
  ('99400000-0000-4000-8000-000000000148', '99400000-0000-4000-8000-000000000145', '99400000-0000-4000-8000-000000000146', '99400000-0000-4000-8000-000000000147', '99400000-0000-4000-8000-000000000103', 'normalized', '99400000-0000-4000-8000-000000000104', null, current_date - 2, now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 'active', 7, null, '{"authority":"normalized","sessionId":"99400000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('e', 64), '99400000-0000-4000-8000-000000000101', '99400000-0000-4000-8000-000000000003', '99400000-0000-4000-8000-000000000102', '영어', '청강 결정 영어반', '청강 결정 담당교사', '청강 결정 101호', '본관', 'no_show', 'no_show', '99400000-0000-4000-8000-000000000002', now() - interval '2 days', null, null, null, null, 0, 5, '99400000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', '2026-08-01 13:00:00+09', now()),
  ('99400000-0000-4000-8000-000000000158', '99400000-0000-4000-8000-000000000155', '99400000-0000-4000-8000-000000000156', '99400000-0000-4000-8000-000000000157', '99400000-0000-4000-8000-000000000103', 'normalized', '99400000-0000-4000-8000-000000000104', null, current_date - 2, now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 'active', 7, null, '{"authority":"normalized","sessionId":"99400000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('f', 64), '99400000-0000-4000-8000-000000000101', '99400000-0000-4000-8000-000000000003', '99400000-0000-4000-8000-000000000102', '영어', '청강 결정 영어반', '청강 결정 담당교사', '청강 결정 101호', '본관', 'completed', 'attended', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 'fit', '재청강 적합', '99400000-0000-4000-8000-000000000003', now() - interval '2 days', 4, 6, '99400000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', '2026-08-01 14:00:00+09', now()),
  ('99400000-0000-4000-8000-000000000168', '99400000-0000-4000-8000-000000000165', '99400000-0000-4000-8000-000000000166', '99400000-0000-4000-8000-000000000167', '99400000-0000-4000-8000-000000000103', 'normalized', '99400000-0000-4000-8000-000000000104', null, current_date + 1, now() + interval '1 day', now() + interval '1 day 2 hours', 'active', 7, null, '{"authority":"normalized","sessionId":"99400000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('9', 64), '99400000-0000-4000-8000-000000000101', '99400000-0000-4000-8000-000000000003', '99400000-0000-4000-8000-000000000102', '영어', '청강 결정 영어반', '청강 결정 담당교사', '청강 결정 101호', '본관', 'scheduled', null, null, null, null, null, null, null, 0, 1, '99400000-0000-4000-8000-000000000001', '99400000-0000-4000-8000-000000000001', '2026-08-01 15:00:00+09', now());

insert into dashboard_private.registration_observation_domain_events(
  observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision
)
select
  observation.id,
  observation.appointment_id,
  appointment.notification_revision,
  case observation.status
    when 'no_show' then 'observation_no_show'
    when 'completed' then 'observation_feedback_submitted'
    else 'observation_scheduled'
  end,
  observation.booking_fact_hash,
  observation.source_revision
from public.ops_registration_observations observation
join public.ops_registration_appointments appointment
  on appointment.id = observation.appointment_id
where observation.id in (
  '99400000-0000-4000-8000-000000000108',
  '99400000-0000-4000-8000-000000000118',
  '99400000-0000-4000-8000-000000000128',
  '99400000-0000-4000-8000-000000000138',
  '99400000-0000-4000-8000-000000000148',
  '99400000-0000-4000-8000-000000000158',
  '99400000-0000-4000-8000-000000000168'
);

insert into public.ops_registration_admission_batches(
  id, task_id, revision_number, status, invoice_sent_at,
  payment_confirmed_at, created_at, updated_at
)
values (
  '99400000-0000-4000-8000-000000000191',
  '99400000-0000-4000-8000-000000000105',
  73, 'paid', '2026-08-01 09:00:00+09', '2026-08-01 10:00:00+09',
  '2026-08-01 08:00:00+09', '2026-08-01 10:00:00+09'
);
insert into public.ops_registration_enrollments(
  id, track_id, class_id, status, makeedu_registered, roster_active,
  sort_order, created_at, updated_at
)
values (
  '99400000-0000-4000-8000-000000000192',
  '99400000-0000-4000-8000-000000000106',
  '99400000-0000-4000-8000-000000000103',
  'planned', false, false, 73,
  '2026-08-01 08:00:00+09', '2026-08-01 08:00:00+09'
);

create temporary table registration_observation_decision_financial_state_before
on commit drop
as
select pg_catalog.jsonb_build_object(
  'enrollmentCount', (
    select count(*) from public.ops_registration_enrollments enrollment
    where enrollment.track_id = '99400000-0000-4000-8000-000000000106'
  ),
  'enrollments', (
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(enrollment) order by enrollment.id)
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = '99400000-0000-4000-8000-000000000106'
  ),
  'admissionCount', (
    select count(*) from public.ops_registration_admission_batches admission
    where admission.task_id = '99400000-0000-4000-8000-000000000105'
  ),
  'admissions', (
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(admission) order by admission.id)
    from public.ops_registration_admission_batches admission
    where admission.task_id = '99400000-0000-4000-8000-000000000105'
  ),
  'paymentCount', (
    select count(*) from public.ops_registration_admission_batches payment
    where payment.task_id = '99400000-0000-4000-8000-000000000105'
      and payment.payment_confirmed_at is not null
  )
) as state;

create temporary table registration_observation_decision_results(
  result_key text primary key,
  response jsonb not null
) on commit drop;
grant select, insert on registration_observation_decision_results
to authenticated;

create or replace function pg_temp.registration_observation_decision_set_actor(
  p_actor uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

select function_returns(
  'public', 'correct_registration_observation_feedback_v1',
  array['uuid','text','text','text','bigint','bigint','text','text'],
  'jsonb',
  'correction keeps the exact public signature'
);
select function_returns(
  'public', 'decide_registration_observation_v1',
  array['uuid','text','uuid','bigint','bigint','integer','text'],
  'jsonb',
  'director decision keeps the exact public signature'
);
select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', procedure.proname,
        'definer', procedure.prosecdef,
        'owner', owner.rolname,
        'searchPath', procedure.proconfig
      ) order by procedure.proname
    )
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles owner on owner.oid = procedure.proowner
    where procedure.oid in (
      'dashboard_private.correct_registration_observation_feedback_v1_impl(uuid,text,text,text,bigint,bigint,text,text)'::regprocedure,
      'dashboard_private.decide_registration_observation_v1_impl(uuid,text,uuid,bigint,bigint,integer,text)'::regprocedure,
      'public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)'::regprocedure,
      'public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)'::regprocedure
    )
  ),
  '[{"name":"correct_registration_observation_feedback_v1","definer":false,"owner":"postgres","searchPath":["search_path=\"\""]},{"name":"correct_registration_observation_feedback_v1_impl","definer":true,"owner":"postgres","searchPath":["search_path=\"\""]},{"name":"decide_registration_observation_v1","definer":false,"owner":"postgres","searchPath":["search_path=\"\""]},{"name":"decide_registration_observation_v1_impl","definer":true,"owner":"postgres","searchPath":["search_path=\"\""]}]'::jsonb,
  'private definers and public invokers are postgres-owned with empty search path'
);
select is(
  pg_catalog.jsonb_build_object(
    'authenticatedCorrectionPublic', pg_catalog.has_function_privilege('authenticated', 'public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)', 'EXECUTE'),
    'authenticatedCorrectionPrivate', pg_catalog.has_function_privilege('authenticated', 'dashboard_private.correct_registration_observation_feedback_v1_impl(uuid,text,text,text,bigint,bigint,text,text)', 'EXECUTE'),
    'authenticatedDecisionPublic', pg_catalog.has_function_privilege('authenticated', 'public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)', 'EXECUTE'),
    'authenticatedDecisionPrivate', pg_catalog.has_function_privilege('authenticated', 'dashboard_private.decide_registration_observation_v1_impl(uuid,text,uuid,bigint,bigint,integer,text)', 'EXECUTE'),
    'anonCorrection', pg_catalog.has_function_privilege('anon', 'public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)', 'EXECUTE'),
    'anonDecision', pg_catalog.has_function_privilege('anon', 'public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)', 'EXECUTE'),
    'serviceCorrectionPublic', pg_catalog.has_function_privilege('service_role', 'public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)', 'EXECUTE'),
    'serviceDecisionPublic', pg_catalog.has_function_privilege('service_role', 'public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)', 'EXECUTE'),
    'serviceCorrectionPrivate', pg_catalog.has_function_privilege('service_role', 'dashboard_private.correct_registration_observation_feedback_v1_impl(uuid,text,text,text,bigint,bigint,text,text)', 'EXECUTE'),
    'serviceDecisionPrivate', pg_catalog.has_function_privilege('service_role', 'dashboard_private.decide_registration_observation_v1_impl(uuid,text,uuid,bigint,bigint,integer,text)', 'EXECUTE')
  ),
  '{"authenticatedCorrectionPublic":true,"authenticatedCorrectionPrivate":true,"authenticatedDecisionPublic":true,"authenticatedDecisionPrivate":true,"anonCorrection":false,"anonDecision":false,"serviceCorrectionPublic":false,"serviceDecisionPublic":false,"serviceCorrectionPrivate":false,"serviceDecisionPrivate":false}'::jsonb,
  'only the authenticated public-to-private invoker chain is executable'
);

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000003'
);
set local role authenticated;
insert into registration_observation_decision_results(result_key, response)
select 'teacher-correction', public.correct_registration_observation_feedback_v1(
  '99400000-0000-4000-8000-000000000108',
  'unfit', '수정된 부적합 사유', '교사가 기록을 정정함',
  5, 2, null, 'decision-correction-teacher'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'operation', response ->> 'operation',
      'observationRevision', (response #>> '{observation,revision}')::bigint,
      'feedbackRevision', (response #>> '{observation,feedbackRevision}')::bigint,
      'workflowRevision', (response ->> 'workflowRevision')::integer,
      'notificationRevision', (response #>> '{appointment,notificationRevision}')::integer
    )
    from registration_observation_decision_results
    where result_key = 'teacher-correction'
  ),
  '{"operation":"correct_feedback","observationRevision":5,"feedbackRevision":3,"workflowRevision":7,"notificationRevision":4}'::jsonb,
  'teacher correction before decision increments only feedback revision'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'result', observation.suitability_result,
      'reason', observation.feedback_reason,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'workflowRevision', track.workflow_revision,
      'notificationRevision', appointment.notification_revision,
      'events', (select count(*) from dashboard_private.registration_observation_domain_events event where event.observation_id = observation.id)
    )
    from public.ops_registration_observations observation
    join public.ops_registration_subject_tracks track on track.id = observation.track_id
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    where observation.id = '99400000-0000-4000-8000-000000000108'
  ),
  '{"result":"unfit","reason":"수정된 부적합 사유","observationRevision":5,"feedbackRevision":3,"workflowRevision":7,"notificationRevision":4,"events":1}'::jsonb,
  'correction revision matrix leaves observation workflow notification and tagged event unchanged'
);
select is(
  (
    select (event.after_value::jsonb -> 'metadata')
    from public.ops_task_events event
    where event.task_id = '99400000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'event_type'
        = 'registration_observation_feedback_corrected'
    order by event.created_at desc, event.id desc
    limit 1
  ),
  '{"trackId":"99400000-0000-4000-8000-000000000106","observationId":"99400000-0000-4000-8000-000000000108","before":{"suitabilityResult":"unfit","feedbackReason":"초기 부적합 사유","feedbackRevision":2},"after":{"suitabilityResult":"unfit","feedbackReason":"수정된 부적합 사유","feedbackRevision":3},"correctionReason":"교사가 기록을 정정함","correctedByProfileId":"99400000-0000-4000-8000-000000000003"}'::jsonb,
  'correction audit stores literal before after reason and actor while event owns occurred_at'
);
select ok(
  (
    select event.created_at is not null
    from public.ops_task_events event
    where event.task_id = '99400000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'event_type'
        = 'registration_observation_feedback_corrected'
    order by event.created_at desc, event.id desc
    limit 1
  ),
  'correction audit persists occurred_at on the event row'
);

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000003'
);
set local role authenticated;
insert into registration_observation_decision_results(result_key, response)
select 'teacher-correction-replay', public.correct_registration_observation_feedback_v1(
  '99400000-0000-4000-8000-000000000108',
  'unfit', '수정된 부적합 사유', '교사가 기록을 정정함',
  5, 2, null, 'decision-correction-teacher'
);
reset role;
select is(
  pg_catalog.jsonb_build_object(
    'sameResponse', (
      select a.response = b.response
      from registration_observation_decision_results a
      join registration_observation_decision_results b
        on a.result_key = 'teacher-correction'
       and b.result_key = 'teacher-correction-replay'
    ),
    'feedbackRevision', (select feedback_revision from public.ops_registration_observations where id = '99400000-0000-4000-8000-000000000108'),
    'audits', (
      select count(*) from public.ops_task_events event
      where event.task_id = '99400000-0000-4000-8000-000000000105'
        and event.event_type = 'registration_track_event'
        and event.after_value::jsonb ->> 'event_type' = 'registration_observation_feedback_corrected'
    ),
    'receipts', (
      select count(*) from dashboard_private.registration_observation_mutation_requests request
      where request.track_id = '99400000-0000-4000-8000-000000000106'
        and request.request_key = 'decision-correction-teacher'
    )
  ),
  '{"sameResponse":true,"feedbackRevision":3,"audits":1,"receipts":1}'::jsonb,
  'duplicate correction replay is current-authorized and zero DML'
);

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000003'
);
set local role authenticated;
select throws_ok(
  $$select public.correct_registration_observation_feedback_v1(
    '99400000-0000-4000-8000-000000000108',
    'unfit', '다른 fingerprint', '교사가 기록을 정정함',
    5, 2, null, 'decision-correction-teacher'
  )$$,
  '23505', 'registration_observation_request_key_conflict',
  'correction request key conflict rejects a changed fingerprint'
);
select throws_ok(
  $$select public.correct_registration_observation_feedback_v1(
    '99400000-0000-4000-8000-000000000108',
    'unfit', 'stale feedback revision', '오래된 화면',
    5, 2, null, 'decision-correction-stale'
  )$$,
  '40001', 'registration_observation_stale_revision',
  'stale feedback revision rejects correction'
);
reset role;

update auth.users
set banned_until = now() + interval '1 hour'
where id = '99400000-0000-4000-8000-000000000003';
select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000003'
);
set local role authenticated;
select throws_ok(
  $$select public.correct_registration_observation_feedback_v1(
    '99400000-0000-4000-8000-000000000108',
    'unfit', '정지 계정 수정 시도', '계정 정지 검증',
    5, 3, null, 'decision-correction-inactive'
  )$$,
  'P0002', 'registration_observation_not_found',
  'inactive assigned teacher cannot enter the privileged correction chain'
);
reset role;
update auth.users
set banned_until = null
where id = '99400000-0000-4000-8000-000000000003';

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000004'
);
set local role authenticated;
select throws_ok(
  $$select public.correct_registration_observation_feedback_v1(
    '99400000-0000-4000-8000-000000000108',
    'unfit', '무관 교사 수정', '권한 없는 수정',
    5, 3, null, 'decision-correction-unrelated'
  )$$,
  'P0002', 'registration_observation_not_found',
  'unrelated teacher cannot correct the exact feedback row'
);
reset role;

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000002'
);
set local role authenticated;
insert into registration_observation_decision_results(result_key, response)
select 'staff-pre-decision-correction', public.correct_registration_observation_feedback_v1(
  '99400000-0000-4000-8000-000000000128',
  'fit', '직원 대리 사유 정정', '대리 입력 오탈자',
  3, 2, null, 'decision-correction-staff'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'operation', response ->> 'operation',
      'observationRevision', (response #>> '{observation,revision}')::bigint,
      'feedbackRevision', (response #>> '{observation,feedbackRevision}')::bigint,
      'workflowRevision', (response ->> 'workflowRevision')::integer,
      'notificationRevision', (response #>> '{appointment,notificationRevision}')::integer
    )
    from registration_observation_decision_results
    where result_key = 'staff-pre-decision-correction'
  ),
  '{"operation":"correct_feedback","observationRevision":3,"feedbackRevision":3,"workflowRevision":9,"notificationRevision":6}'::jsonb,
  'staff proxy correction before decision increments feedback revision only'
);

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000003'
);
set local role authenticated;
select throws_ok(
  $$select public.decide_registration_observation_v1(
    '99400000-0000-4000-8000-000000000108', 'enrollment', null,
    5, 3, 7, 'decision-teacher-cannot-decide'
  )$$,
  'P0002', 'registration_observation_not_found',
  'assigned teacher feedback never auto-decides the director outcome'
);
reset role;

update auth.users
set banned_until = now() + interval '1 hour'
where id = '99400000-0000-4000-8000-000000000005';
select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000005'
);
set local role authenticated;
select throws_ok(
  $$select public.decide_registration_observation_v1(
    '99400000-0000-4000-8000-000000000108', 'enrollment', null,
    5, 3, 7, 'decision-inactive-director'
  )$$,
  'P0002', 'registration_observation_not_found',
  'inactive current director cannot enter the privileged decision chain'
);
reset role;
update auth.users
set banned_until = null
where id = '99400000-0000-4000-8000-000000000005';

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000005'
);
set local role authenticated;
insert into registration_observation_decision_results(result_key, response)
select 'enrollment-decision', public.decide_registration_observation_v1(
  '99400000-0000-4000-8000-000000000108', 'enrollment', null,
  5, 3, 7, 'decision-enrollment'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'operation', response ->> 'operation',
      'workflowStatus', response ->> 'workflowStatus',
      'workflowRevision', (response ->> 'workflowRevision')::integer,
      'decisionKind', response #>> '{observation,decisionKind}',
      'observationRevision', (response #>> '{observation,revision}')::bigint,
      'feedbackRevision', (response #>> '{observation,feedbackRevision}')::bigint,
      'notificationRevision', (response #>> '{appointment,notificationRevision}')::integer
    )
    from registration_observation_decision_results
    where result_key = 'enrollment-decision'
  ),
  '{"operation":"decide","workflowStatus":"enrollment_requested","workflowRevision":8,"decisionKind":"enrollment","observationRevision":6,"feedbackRevision":3,"notificationRevision":4}'::jsonb,
  'director enrollment decision permits unfit feedback and increments only domain and track revisions'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'returnStatusIsNull', track.observation_return_workflow_status is null,
      'waitingKindIsNull', track.waiting_detail_kind is null,
      'waitingClassIsNull', track.waiting_detail_class_id is null,
      'decidedBy', observation.decided_by,
      'eventCount', (select count(*) from dashboard_private.registration_observation_domain_events event where event.observation_id = observation.id)
    )
    from public.ops_registration_subject_tracks track
    join public.ops_registration_observations observation on observation.track_id = track.id
    where track.id = '99400000-0000-4000-8000-000000000106'
  ),
  '{"returnStatusIsNull":true,"waitingKindIsNull":true,"waitingClassIsNull":true,"decidedBy":"99400000-0000-4000-8000-000000000005","eventCount":1}'::jsonb,
  'non-re-observation decision clears return status without a transport event'
);
select is(
  (
    select event.after_value::jsonb -> 'metadata'
    from public.ops_task_events event
    where event.task_id = '99400000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'event_type' = 'registration_observation_decided'
    order by event.created_at desc, event.id desc
    limit 1
  ),
  '{"trackId":"99400000-0000-4000-8000-000000000106","observationId":"99400000-0000-4000-8000-000000000108","decisionKind":"enrollment","waitingClassId":null,"workflowRevisionBefore":7,"workflowRevisionAfter":8,"observationRevisionBefore":5,"observationRevisionAfter":6,"feedbackRevisionBefore":3,"feedbackRevisionAfter":3,"appointmentNotificationRevisionBefore":4,"appointmentNotificationRevisionAfter":4,"decidedByProfileId":"99400000-0000-4000-8000-000000000005"}'::jsonb,
  'director decision audit stores mapping actor and the exact revision matrix'
);
select ok(
  (
    select event.created_at is not null
    from public.ops_task_events event
    where event.task_id = '99400000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'event_type'
        = 'registration_observation_decided'
    order by event.created_at desc, event.id desc
    limit 1
  ),
  'director decision audit persists occurred_at on the event row'
);

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000005'
);
set local role authenticated;
insert into registration_observation_decision_results(result_key, response)
select 'enrollment-decision-replay', public.decide_registration_observation_v1(
  '99400000-0000-4000-8000-000000000108', 'enrollment', null,
  5, 3, 7, 'decision-enrollment'
);
reset role;
select is(
  pg_catalog.jsonb_build_object(
    'sameResponse', (
      select a.response = b.response
      from registration_observation_decision_results a
      join registration_observation_decision_results b
        on a.result_key = 'enrollment-decision'
       and b.result_key = 'enrollment-decision-replay'
    ),
    'observationRevision', (select revision from public.ops_registration_observations where id = '99400000-0000-4000-8000-000000000108'),
    'workflowRevision', (select workflow_revision from public.ops_registration_subject_tracks where id = '99400000-0000-4000-8000-000000000106'),
    'audits', (
      select count(*) from public.ops_task_events event
      where event.task_id = '99400000-0000-4000-8000-000000000105'
        and event.event_type = 'registration_track_event'
        and event.after_value::jsonb ->> 'event_type' = 'registration_observation_decided'
    ),
    'receipts', (
      select count(*) from dashboard_private.registration_observation_mutation_requests request
      where request.track_id = '99400000-0000-4000-8000-000000000106'
        and request.request_key = 'decision-enrollment'
    )
  ),
  '{"sameResponse":true,"observationRevision":6,"workflowRevision":8,"audits":1,"receipts":1}'::jsonb,
  'duplicate decision replay is current-authorized and zero DML'
);

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000005'
);
set local role authenticated;
select throws_ok(
  $$select public.decide_registration_observation_v1(
    '99400000-0000-4000-8000-000000000118', 'waiting_current_class',
    '99400000-0000-4000-8000-000000000103', 2, 1, 7,
    'decision-stale-track-revision'
  )$$,
  '40001', 'registration_observation_stale_revision',
  'director decision rejects a stale track workflow revision'
);
select throws_ok(
  $$select public.decide_registration_observation_v1(
    '99400000-0000-4000-8000-000000000108', 'not_registered', null,
    5, 3, 7, 'decision-enrollment'
  )$$,
  '23505', 'registration_observation_request_key_conflict',
  'decision request key conflict rejects a changed fingerprint'
);
reset role;

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000003'
);
set local role authenticated;
select throws_ok(
  $$select public.correct_registration_observation_feedback_v1(
    '99400000-0000-4000-8000-000000000108',
    'unfit', '수정된 부적합 사유', '교사가 기록을 정정함',
    5, 2, null, 'decision-correction-teacher'
  )$$,
  'P0002', 'registration_observation_not_found',
  'teacher correction after decision cannot replay a formerly authorized receipt'
);
select throws_ok(
  $$select public.correct_registration_observation_feedback_v1(
    '99400000-0000-4000-8000-000000000108',
    'unfit', '결정 뒤 교사 신규 수정', '결정 뒤 수정',
    6, 3, 'enrollment', 'decision-correction-after-teacher'
  )$$,
  'P0002', 'registration_observation_not_found',
  'teacher correction after decision is rejected for a new request too'
);
reset role;

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into registration_observation_decision_results(result_key, response)
select 'admin-post-decision-correction', public.correct_registration_observation_feedback_v1(
  '99400000-0000-4000-8000-000000000108',
  'unfit', '결정 뒤 관리자 사유 정정', '오탈자 정정',
  6, 3, 'enrollment', 'decision-correction-admin'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'operation', response ->> 'operation',
      'decisionKind', response #>> '{observation,decisionKind}',
      'result', response #>> '{observation,suitabilityResult}',
      'observationRevision', (response #>> '{observation,revision}')::bigint,
      'feedbackRevision', (response #>> '{observation,feedbackRevision}')::bigint,
      'workflowRevision', (response ->> 'workflowRevision')::integer,
      'notificationRevision', (response #>> '{appointment,notificationRevision}')::integer
    )
    from registration_observation_decision_results
    where result_key = 'admin-post-decision-correction'
  ),
  '{"operation":"correct_feedback","decisionKind":"enrollment","result":"unfit","observationRevision":6,"feedbackRevision":4,"workflowRevision":8,"notificationRevision":4}'::jsonb,
  'admin same-result reason correction after decision increments only feedback revision'
);

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000001'
);
set local role authenticated;
select throws_ok(
  $$select public.correct_registration_observation_feedback_v1(
    '99400000-0000-4000-8000-000000000108',
    'fit', '결정 뒤 결과 변경', '결과 정정 시도',
    6, 4, 'enrollment', 'decision-correction-result-change'
  )$$,
  '55000', 'registration_observation_transition_rejected',
  'admin cannot change suitability after a director decision'
);
reset role;

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000005'
);
set local role authenticated;
select throws_ok(
  $$select public.decide_registration_observation_v1(
    '99400000-0000-4000-8000-000000000118', 'waiting_current_class',
    '99400000-0000-4000-8000-000000000193', 2, 1, 8,
    'decision-waiting-class-mismatch'
  )$$,
  '55000', 'registration_observation_transition_rejected',
  'waiting class subject mismatch fails closed'
);
insert into registration_observation_decision_results(result_key, response)
select 'waiting-current', public.decide_registration_observation_v1(
  '99400000-0000-4000-8000-000000000118', 'waiting_current_class',
  '99400000-0000-4000-8000-000000000103', 2, 1, 8,
  'decision-waiting-current'
);
insert into registration_observation_decision_results(result_key, response)
select 'waiting-new', public.decide_registration_observation_v1(
  '99400000-0000-4000-8000-000000000128', 'waiting_new_class', null,
  3, 3, 9, 'decision-waiting-new'
);
insert into registration_observation_decision_results(result_key, response)
select 'waiting-next', public.decide_registration_observation_v1(
  '99400000-0000-4000-8000-000000000138', 'waiting_next_opening', null,
  4, 3, 10, 'decision-waiting-next'
);
reset role;

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000002'
);
set local role authenticated;
insert into registration_observation_decision_results(result_key, response)
select 'not-registered', public.decide_registration_observation_v1(
  '99400000-0000-4000-8000-000000000148', 'not_registered', null,
  5, 0, 11, 'decision-not-registered'
);
reset role;

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000005'
);
set local role authenticated;
insert into registration_observation_decision_results(result_key, response)
select 're-observation', public.decide_registration_observation_v1(
  '99400000-0000-4000-8000-000000000158', 're_observation', null,
  6, 4, 12, 'decision-re-observation'
);
select throws_ok(
  $$select public.decide_registration_observation_v1(
    '99400000-0000-4000-8000-000000000168', 'not_registered', null,
    1, 0, 13, 'decision-scheduled-rejected'
  )$$,
  '55000', 'registration_observation_transition_rejected',
  'director decision accepts completed or no_show only'
);
reset role;

select is(
  (
    select observation.decided_by
    from public.ops_registration_observations observation
    where observation.id = '99400000-0000-4000-8000-000000000148'
  ),
  '99400000-0000-4000-8000-000000000002'::uuid,
  'staff may make the final decision for an exact authorized row'
);

select is(
  (
    select pg_catalog.jsonb_object_agg(
      result.result_key,
      pg_catalog.jsonb_build_object(
        'workflowStatus', result.response ->> 'workflowStatus',
        'decisionKind', result.response #>> '{observation,decisionKind}'
      ) order by result.result_key
    )
    from registration_observation_decision_results result
    where result.result_key in (
      'waiting-current', 'waiting-new', 'waiting-next',
      'not-registered', 're-observation'
    )
  ),
  '{"not-registered":{"workflowStatus":"not_registered","decisionKind":"not_registered"},"re-observation":{"workflowStatus":"observation_requested","decisionKind":"re_observation"},"waiting-current":{"workflowStatus":"waiting_current_class","decisionKind":"waiting_current_class"},"waiting-new":{"workflowStatus":"waiting_new_class","decisionKind":"waiting_new_class"},"waiting-next":{"workflowStatus":"waiting_next_opening","decisionKind":"waiting_next_opening"}}'::jsonb,
  'director decision maps every approved kind to the exact workflow status'
);
select is(
  (
    select pg_catalog.jsonb_object_agg(
      observation.decision_kind,
      pg_catalog.jsonb_build_object(
        'observationRevision', observation.revision,
        'feedbackRevision', observation.feedback_revision,
        'workflowRevision', track.workflow_revision,
        'notificationRevision', appointment.notification_revision,
        'returnStatus', track.observation_return_workflow_status,
        'waitingKind', track.waiting_detail_kind,
        'waitingClassId', track.waiting_detail_class_id
      ) order by observation.decision_kind
    )
    from public.ops_registration_observations observation
    join public.ops_registration_subject_tracks track on track.id = observation.track_id
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    where observation.id in (
      '99400000-0000-4000-8000-000000000118',
      '99400000-0000-4000-8000-000000000128',
      '99400000-0000-4000-8000-000000000138',
      '99400000-0000-4000-8000-000000000148',
      '99400000-0000-4000-8000-000000000158'
    )
  ),
  '{"not_registered":{"observationRevision":6,"feedbackRevision":0,"workflowRevision":12,"notificationRevision":8,"returnStatus":null,"waitingKind":null,"waitingClassId":null},"re_observation":{"observationRevision":7,"feedbackRevision":4,"workflowRevision":13,"notificationRevision":9,"returnStatus":"consultation_completed","waitingKind":null,"waitingClassId":null},"waiting_current_class":{"observationRevision":3,"feedbackRevision":1,"workflowRevision":9,"notificationRevision":5,"returnStatus":null,"waitingKind":"current_class","waitingClassId":"99400000-0000-4000-8000-000000000103"},"waiting_new_class":{"observationRevision":4,"feedbackRevision":3,"workflowRevision":10,"notificationRevision":6,"returnStatus":null,"waitingKind":"current_term_opening","waitingClassId":null},"waiting_next_opening":{"observationRevision":5,"feedbackRevision":3,"workflowRevision":11,"notificationRevision":7,"returnStatus":null,"waitingKind":"next_term_opening","waitingClassId":null}}'::jsonb,
  'decision revision matrix and return-status rules are exact for every mapping'
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, created_by
)
values (
  '99400000-0000-4000-8000-000000000159',
  '99400000-0000-4000-8000-000000000155',
  'observation_class', now() + interval '2 days', '본관', 'scheduled', 1,
  '99400000-0000-4000-8000-000000000001'
);
insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, status, feedback_revision, revision,
  created_by, updated_by, created_at, updated_at
)
values (
  '99400000-0000-4000-8000-000000000160',
  '99400000-0000-4000-8000-000000000155',
  '99400000-0000-4000-8000-000000000156',
  '99400000-0000-4000-8000-000000000159',
  '99400000-0000-4000-8000-000000000103',
  'normalized', '99400000-0000-4000-8000-000000000104', null,
  current_date + 2, now() + interval '2 days', now() + interval '2 days 2 hours',
  'active', 7, null,
  '{"authority":"normalized","sessionId":"99400000-0000-4000-8000-000000000104","revision":7}'::jsonb,
  repeat('1', 64), '99400000-0000-4000-8000-000000000101',
  '99400000-0000-4000-8000-000000000003',
  '99400000-0000-4000-8000-000000000102', '영어', '청강 결정 영어반',
  '청강 결정 담당교사', '청강 결정 101호', '본관', 'scheduled', 0, 1,
  '99400000-0000-4000-8000-000000000001',
  '99400000-0000-4000-8000-000000000001', now(), now()
);
insert into dashboard_private.registration_observation_domain_events(
  observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision
)
values (
  '99400000-0000-4000-8000-000000000160',
  '99400000-0000-4000-8000-000000000159', 1,
  'observation_scheduled', repeat('1', 64),
  '{"authority":"normalized","sessionId":"99400000-0000-4000-8000-000000000104","revision":7}'::jsonb
);

select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000001'
);
set local role authenticated;
select throws_ok(
  $$select public.correct_registration_observation_feedback_v1(
    '99400000-0000-4000-8000-000000000158',
    'fit', '재청강 이후 과거 사유 수정', '사후 오탈자',
    7, 4, 're_observation', 'decision-re-observation-active-correction'
  )$$,
  '55000', 'registration_observation_transition_rejected',
  're-observation active attempt makes old correction fail closed'
);
reset role;

update public.ops_registration_subject_tracks
set director_profile_id = '99400000-0000-4000-8000-000000000006',
    director_assigned_at = now()
where id = '99400000-0000-4000-8000-000000000126';
select pg_temp.registration_observation_decision_set_actor(
  '99400000-0000-4000-8000-000000000005'
);
set local role authenticated;
select throws_ok(
  $$select public.decide_registration_observation_v1(
    '99400000-0000-4000-8000-000000000128', 'waiting_new_class', null,
    3, 3, 9, 'decision-waiting-new'
  )$$,
  'P0002', 'registration_observation_not_found',
  'duplicate decision replay is denied after current director authorization loss'
);
reset role;

select is(
  pg_catalog.jsonb_build_object(
    'enrollmentCount', (
      select count(*) from public.ops_registration_enrollments enrollment
      where enrollment.track_id = '99400000-0000-4000-8000-000000000106'
    ),
    'enrollments', (
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(enrollment) order by enrollment.id)
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = '99400000-0000-4000-8000-000000000106'
    ),
    'admissionCount', (
      select count(*) from public.ops_registration_admission_batches admission
      where admission.task_id = '99400000-0000-4000-8000-000000000105'
    ),
    'admissions', (
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(admission) order by admission.id)
      from public.ops_registration_admission_batches admission
      where admission.task_id = '99400000-0000-4000-8000-000000000105'
    ),
    'paymentCount', (
      select count(*) from public.ops_registration_admission_batches payment
      where payment.task_id = '99400000-0000-4000-8000-000000000105'
        and payment.payment_confirmed_at is not null
    )
  ),
  (select state from registration_observation_decision_financial_state_before),
  'seeded financial state before remains byte-exact after correction and every decision'
);
select is(
  (
    select count(*)
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id in (
      '99400000-0000-4000-8000-000000000108',
      '99400000-0000-4000-8000-000000000118',
      '99400000-0000-4000-8000-000000000128',
      '99400000-0000-4000-8000-000000000138',
      '99400000-0000-4000-8000-000000000148',
      '99400000-0000-4000-8000-000000000158'
    )
  ),
  6::bigint,
  'provider transport facts remain zero because correction and decision add no domain outbox event'
);

create temporary table registration_observation_decision_concurrency_results(
  worker text not null,
  sqlstate text not null,
  response jsonb,
  message text
) on commit drop;

create function pg_temp.registration_observation_decision_waiting_workers()
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_waiting bigint := 0;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '5 seconds';
begin
  loop
    select count(*)
    into v_waiting
    from pg_catalog.pg_stat_activity activity
    where activity.application_name in (
      'feedback_decision_a',
      'feedback_decision_b'
    )
      and activity.wait_event_type = 'Lock'
      and pg_catalog.cardinality(
        pg_catalog.pg_blocking_pids(activity.pid)
      ) > 0;
    exit when v_waiting = 2
      or pg_catalog.clock_timestamp() >= v_deadline;
    perform pg_catalog.pg_sleep(0.02);
  end loop;
  return v_waiting;
end;
$$;

select dblink_connect(
  'feedback_decision_blocker',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=feedback_decision_blocker'
);
select dblink_connect(
  'feedback_decision_a',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=feedback_decision_a'
);
select dblink_connect(
  'feedback_decision_b',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=feedback_decision_b'
);
select dblink_exec('feedback_decision_blocker', 'begin');
select dblink_exec('feedback_decision_blocker', $remote$
  do $blocker$
  begin
    perform track.id
    from public.ops_registration_subject_tracks track
    where track.id = '99200000-0000-4000-8000-000000000106'
    for update;
    if not found then
      raise exception 'feedback_decision_blocker_target_missing';
    end if;
  end;
  $blocker$;
$remote$);
select dblink_exec(connection_name, $remote$
  create or replace function pg_temp.registration_observation_decision_capture(
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
      '99200000-0000-4000-8000-000000000004',
      false
    );
    perform pg_catalog.set_config(
      'request.jwt.claim.role', 'authenticated', false
    );
  end;
  $actor$;
  set role authenticated;
$remote$)
from (values ('feedback_decision_a'), ('feedback_decision_b'))
  connection(connection_name);

select dblink_send_query(
  'feedback_decision_a',
  $query$select * from pg_temp.registration_observation_decision_capture(
    $statement$select public.decide_registration_observation_v1(
      '99200000-0000-4000-8000-000000000108',
      'waiting_new_class', null, 2, 1, 2,
      'feedback-decision-concurrent-a'
    )$statement$
  )$query$
);
select dblink_send_query(
  'feedback_decision_b',
  $query$select * from pg_temp.registration_observation_decision_capture(
    $statement$select public.decide_registration_observation_v1(
      '99200000-0000-4000-8000-000000000108',
      'not_registered', null, 2, 1, 2,
      'feedback-decision-concurrent-b'
    )$statement$
  )$query$
);
select is(
  pg_temp.registration_observation_decision_waiting_workers(),
  2::bigint,
  'both decision workers overlap while waiting for the contested track lock'
);
select dblink_exec('feedback_decision_blocker', 'rollback');
insert into registration_observation_decision_concurrency_results
select 'a', result.*
from dblink_get_result('feedback_decision_a')
  as result(sqlstate text, response jsonb, message text);
insert into registration_observation_decision_concurrency_results
select 'b', result.*
from dblink_get_result('feedback_decision_b')
  as result(sqlstate text, response jsonb, message text);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'successes', count(*) filter (where sqlstate = '00000'),
      'stale', count(*) filter (where sqlstate = '40001')
    )
    from registration_observation_decision_concurrency_results
  ),
  '{"successes":1,"stale":1}'::jsonb,
  'one concurrent decision succeeds and one stale director loses'
);
select ok(
  (
    select observation.decision_kind in (
      'waiting_new_class', 'not_registered'
    )
      and track.workflow_status in (
        'waiting_new_class', 'not_registered'
      )
      and observation.revision = 3
      and observation.feedback_revision = 1
      and track.workflow_revision = 3
      and appointment.notification_revision = 3
      and track.observation_return_workflow_status is null
      and (
        select count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      ) = 1
      and (
        select count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.track_id = track.id
          and request.request_key in (
            'feedback-decision-concurrent-a',
            'feedback-decision-concurrent-b'
          )
      ) = 1
    from public.ops_registration_observations observation
    join public.ops_registration_subject_tracks track on track.id = observation.track_id
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    where observation.id = '99200000-0000-4000-8000-000000000108'
  ),
  'concurrent decision winner commits one revision matrix receipt and no transport fact'
);
select is(
  (
    select count(*)
    from public.ops_task_events event
    where event.task_id = '99200000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'event_type'
        = 'registration_observation_decided'
  ),
  1::bigint,
  'concurrent decision winner commits one audit event'
);

select dblink_disconnect('feedback_decision_a');
select dblink_disconnect('feedback_decision_b');
select dblink_disconnect('feedback_decision_blocker');

select * from finish();
rollback;
