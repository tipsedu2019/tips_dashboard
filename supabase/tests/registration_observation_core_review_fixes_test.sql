begin;
select plan(10);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  deleted_at, banned_until, created_at, updated_at
)
values
  ('99010000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'core-review-active-admin@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', null, null, now(), now()),
  ('99010000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'core-review-active-staff@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', null, null, now(), now()),
  ('99010000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'core-review-deleted-admin@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', now(), null, now(), now()),
  ('99010000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'core-review-deleted-staff@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', now(), null, now(), now()),
  ('99010000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'core-review-banned-admin@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', null, now() + interval '1 day', now(), now()),
  ('99010000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'core-review-banned-staff@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', null, now() + interval '1 day', now(), now()),
  ('99010000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'core-review-expired-staff@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', null, now() - interval '1 day', now(), now()),
  ('99010000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'core-review-director@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', null, null, now(), now());

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('99010000-0000-4000-8000-000000000001', 'admin', '활성 관리자', 'core-review-active-admin@example.invalid', now(), now()),
  ('99010000-0000-4000-8000-000000000002', 'staff', '활성 운영자', 'core-review-active-staff@example.invalid', now(), now()),
  ('99010000-0000-4000-8000-000000000003', 'admin', '삭제 관리자', 'core-review-deleted-admin@example.invalid', now(), now()),
  ('99010000-0000-4000-8000-000000000004', 'staff', '삭제 운영자', 'core-review-deleted-staff@example.invalid', now(), now()),
  ('99010000-0000-4000-8000-000000000005', 'admin', '차단 관리자', 'core-review-banned-admin@example.invalid', now(), now()),
  ('99010000-0000-4000-8000-000000000006', 'staff', '차단 운영자', 'core-review-banned-staff@example.invalid', now(), now()),
  ('99010000-0000-4000-8000-000000000007', 'staff', '차단 만료 운영자', 'core-review-expired-staff@example.invalid', now(), now()),
  ('99010000-0000-4000-8000-000000000008', 'teacher', '담당 원장', 'core-review-director@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id in (
  '99010000-0000-4000-8000-000000000001',
  '99010000-0000-4000-8000-000000000002',
  '99010000-0000-4000-8000-000000000003',
  '99010000-0000-4000-8000-000000000004',
  '99010000-0000-4000-8000-000000000005',
  '99010000-0000-4000-8000-000000000006',
  '99010000-0000-4000-8000-000000000007',
  '99010000-0000-4000-8000-000000000008'
);

insert into public.teacher_catalogs(id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role)
values ('99010000-0000-4000-8000-000000000101', '담당 원장', array['영어']::text[], true, 9901, '99010000-0000-4000-8000-000000000008', 'core-review-director@example.invalid', 'teacher');
update public.profiles set teacher_catalog_id = '99010000-0000-4000-8000-000000000101' where id = '99010000-0000-4000-8000-000000000008';
insert into public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)
values ('99010000-0000-4000-8000-000000000102', '코어 리뷰실', array['영어']::text[], true, 9901, '본관');
insert into public.classes(id, name, subject, status, schedule_storage_mode, schedule_plan)
values ('99010000-0000-4000-8000-000000000103', '코어 리뷰반', '영어', '수업 진행 중', 'legacy', '{}'::jsonb);
insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, secondary_assignee_id, student_name
)
values (
  '99010000-0000-4000-8000-000000000104', '코어 리뷰 권한', 'registration',
  'requested', 'normal', '99010000-0000-4000-8000-000000000001',
  '99010000-0000-4000-8000-000000000008', '테스트 학생'
);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values (
  '99010000-0000-4000-8000-000000000105', '99010000-0000-4000-8000-000000000104',
  '영어', 'consultation_waiting', '99010000-0000-4000-8000-000000000008',
  'manual', now(), false, 'observation_requested', 4, now(), 'consultation_completed', 1
);
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
)
values (
  '99010000-0000-4000-8000-000000000106', '99010000-0000-4000-8000-000000000104',
  'observation_class', now() + interval '7 days', '본관', 'scheduled', 3,
  '99010000-0000-4000-8000-000000000001'
);
insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, revision, feedback_revision, created_by, updated_by
)
values (
  '99010000-0000-4000-8000-000000000107', '99010000-0000-4000-8000-000000000104',
  '99010000-0000-4000-8000-000000000105', '99010000-0000-4000-8000-000000000106',
  '99010000-0000-4000-8000-000000000103', 'legacy', null, 'review-session',
  current_date + 7, now() + interval '7 days', now() + interval '7 days 1 hour', 'active',
  null, 'review-content-hash',
  '{"authority":"legacy","sessionKey":"review-session","contentHash":"review-content-hash"}'::jsonb,
  'review-booking-fact-hash', '99010000-0000-4000-8000-000000000101',
  '99010000-0000-4000-8000-000000000008', '99010000-0000-4000-8000-000000000102',
  '영어', '코어 리뷰반', '담당 원장', '코어 리뷰실', '본관', 5, 2,
  '99010000-0000-4000-8000-000000000001', '99010000-0000-4000-8000-000000000001'
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, created_by, created_at, updated_at
)
values (
  '99010000-0000-4000-8000-000000000108',
  '99010000-0000-4000-8000-000000000104',
  'observation_class', now() - interval '30 days', '본관', 'completed', 1,
  '99010000-0000-4000-8000-000000000001',
  now() - interval '30 days', now() - interval '30 days'
);
insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, legacy_session_key, session_date, starts_at, ends_at,
  session_schedule_state, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, status, attendance,
  attendance_recorded_by, attendance_recorded_at, suitability_result,
  feedback_reason, feedback_submitted_by, feedback_submitted_at,
  feedback_revision, decision_kind, decided_by, decided_at, revision,
  created_by, updated_by, created_at, updated_at
)
values (
  '99010000-0000-4000-8000-000000000109',
  '99010000-0000-4000-8000-000000000104',
  '99010000-0000-4000-8000-000000000105',
  '99010000-0000-4000-8000-000000000108',
  '99010000-0000-4000-8000-000000000103',
  'legacy', 'review-decision-session', current_date - 30,
  now() - interval '30 days', now() - interval '30 days' + interval '1 hour',
  'active', 'review-decision-content-hash',
  '{"authority":"legacy","sessionKey":"review-decision-session","contentHash":"review-decision-content-hash"}'::jsonb,
  'review-decision-booking-fact-hash',
  '99010000-0000-4000-8000-000000000101',
  '99010000-0000-4000-8000-000000000008',
  '99010000-0000-4000-8000-000000000102',
  '영어', '코어 리뷰반', '담당 원장', '코어 리뷰실', '본관',
  'completed', 'attended', '99010000-0000-4000-8000-000000000001',
  now() - interval '30 days', 'fit', '한 번 더 청강',
  '99010000-0000-4000-8000-000000000008', now() - interval '30 days',
  2, 're_observation', '99010000-0000-4000-8000-000000000008',
  now() - interval '30 days', 6,
  '99010000-0000-4000-8000-000000000001',
  '99010000-0000-4000-8000-000000000001',
  now() - interval '30 days', now() - interval '30 days'
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, created_by, created_at, updated_at
)
select
  ('99010000-0000-4000-8000-' || pg_catalog.lpad((200 + sequence_no)::text, 12, '0'))::uuid,
  '99010000-0000-4000-8000-000000000104'::uuid,
  'observation_class', now() - pg_catalog.make_interval(mins => sequence_no),
  '본관', 'canceled', 1, '99010000-0000-4000-8000-000000000001'::uuid,
  now() - pg_catalog.make_interval(mins => sequence_no),
  now() - pg_catalog.make_interval(mins => sequence_no)
from pg_catalog.generate_series(1, 21) sequence_no;

insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, legacy_session_key, session_date, starts_at, ends_at,
  session_schedule_state, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, status, revision, feedback_revision,
  created_by, updated_by, created_at, updated_at
)
select
  ('99010000-0000-4000-8000-' || pg_catalog.lpad((300 + sequence_no)::text, 12, '0'))::uuid,
  '99010000-0000-4000-8000-000000000104'::uuid,
  '99010000-0000-4000-8000-000000000105'::uuid,
  ('99010000-0000-4000-8000-' || pg_catalog.lpad((200 + sequence_no)::text, 12, '0'))::uuid,
  '99010000-0000-4000-8000-000000000103'::uuid,
  'legacy', 'review-canceled-' || sequence_no,
  current_date - 1,
  now() - pg_catalog.make_interval(mins => sequence_no),
  now() - pg_catalog.make_interval(mins => sequence_no) + interval '1 hour',
  'canceled', 'review-canceled-content-' || sequence_no,
  pg_catalog.jsonb_build_object(
    'authority', 'legacy',
    'sessionKey', 'review-canceled-' || sequence_no,
    'contentHash', 'review-canceled-content-' || sequence_no
  ),
  'review-canceled-booking-' || sequence_no,
  '99010000-0000-4000-8000-000000000101'::uuid,
  '99010000-0000-4000-8000-000000000008'::uuid,
  '99010000-0000-4000-8000-000000000102'::uuid,
  '영어', '코어 리뷰반', '담당 원장', '코어 리뷰실', '본관',
  'canceled', 1, 0,
  '99010000-0000-4000-8000-000000000001'::uuid,
  '99010000-0000-4000-8000-000000000001'::uuid,
  now() - pg_catalog.make_interval(mins => sequence_no),
  now() - pg_catalog.make_interval(mins => sequence_no)
from pg_catalog.generate_series(1, 21) sequence_no;

update public.ops_registration_subject_tracks
set observation_attempt_count = 23
where id = '99010000-0000-4000-8000-000000000105';

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '99010000-0000-4000-8000-000000000400',
    '99010000-0000-4000-8000-000000000001',
    'registration_observation_core_review_10k_fixture'
  );
end;
$$;

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
select
  '99010000-0000-4000-8000-000000000400'::uuid,
  '코어 리뷰 10k 반',
  '영어',
  '수업 진행 중',
  'legacy',
  pg_catalog.jsonb_build_object(
    'textbooks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'textbookId', '99010000-0000-4000-8000-000000000410',
      'title', '코어 리뷰 교재'
    )),
    'sessions', (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'sessionKey', 'bulk-' || pg_catalog.lpad(sequence_no::text, 5, '0'),
          'date', pg_catalog.to_char(
            current_date + 1 + ((sequence_no - 1) % 100),
            'YYYY-MM-DD'
          ),
          'scheduleState', case when sequence_no % 17 = 0 then 'makeup' else 'normal' end,
          'teacherCatalogId', '99010000-0000-4000-8000-000000000101',
          'classroomCatalogId', '99010000-0000-4000-8000-000000000102',
          'textbookEntries', case when sequence_no = 1
            then pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'textbookId', '99010000-0000-4000-8000-000000000410',
              'plan', pg_catalog.jsonb_build_object('label', '1단원', 'memo', '복습')
            ))
            else '[]'::jsonb
          end,
          'publicNote', case when sequence_no = 1 then '10k 대표 진도' else '' end
        )
        order by sequence_no
      )
      from pg_catalog.generate_series(1, 10000) sequence_no
    )
  );

insert into public.class_schedule_slots(
  id, class_id, weekday, start_time, end_time,
  teacher_catalog_id, teacher_name, classroom_catalog_id, classroom_name,
  sort_order
)
select
  ('99010000-0000-4000-8000-' || pg_catalog.lpad((400 + weekday)::text, 12, '0'))::uuid,
  '99010000-0000-4000-8000-000000000400'::uuid,
  weekday::smallint,
  '18:00'::time,
  '20:00'::time,
  '99010000-0000-4000-8000-000000000101'::uuid,
  '담당 원장',
  '99010000-0000-4000-8000-000000000102'::uuid,
  '코어 리뷰실',
  weekday
from pg_catalog.generate_series(0, 6) weekday;

create or replace function pg_temp.core_review_set_actor(p_actor uuid)
returns void language plpgsql as $$
begin
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.core_review_observation_count(p_actor uuid)
returns bigint language plpgsql security invoker as $$
declare v_count bigint;
begin
  perform pg_temp.core_review_set_actor(p_actor);
  execute 'set local role authenticated';
  select count(*) into v_count from public.ops_registration_observations where id = '99010000-0000-4000-8000-000000000107';
  execute 'reset role';
  return v_count;
exception when others then execute 'reset role'; raise;
end;
$$;

create or replace function pg_temp.core_review_summary_scalars(p_actor uuid)
returns jsonb language plpgsql security invoker as $$
declare v_result jsonb;
begin
  perform pg_temp.core_review_set_actor(p_actor);
  execute 'set local role authenticated';
  select pg_catalog.jsonb_build_array(
    observation_attempt_count, observation_current_id, observation_current_status,
    observation_current_appointment_id, observation_nearest_scheduled_at is not null,
    observation_nearest_place, observation_notification_revision,
    observation_revision, observation_feedback_revision
  ) into v_result
  from public.ops_registration_subject_track_summaries
  where id = '99010000-0000-4000-8000-000000000105';
  execute 'reset role';
  return v_result;
exception when others then execute 'reset role'; raise;
end;
$$;

create or replace function pg_temp.core_review_manager_detail(p_actor uuid)
returns jsonb language plpgsql security invoker as $$
declare v_result jsonb;
begin
  perform pg_temp.core_review_set_actor(p_actor);
  execute 'set local role authenticated';
  select public.get_registration_observation_manager_detail_v1(
    '99010000-0000-4000-8000-000000000105',
    20
  ) into v_result;
  execute 'reset role';
  return v_result;
exception when others then execute 'reset role'; raise;
end;
$$;

create or replace function pg_temp.core_review_session_list(
  p_class_id uuid,
  p_date_from date,
  p_date_to date
)
returns jsonb language plpgsql security invoker as $$
declare v_result jsonb;
begin
  perform pg_temp.core_review_set_actor('99010000-0000-4000-8000-000000000001');
  execute 'set local role authenticated';
  select public.list_registration_observation_sessions_v1(
    '99010000-0000-4000-8000-000000000105',
    p_class_id,
    p_date_from,
    p_date_to
  ) into v_result;
  execute 'reset role';
  return v_result;
exception when others then execute 'reset role'; raise;
end;
$$;

select has_function(
  'dashboard_private',
  'registration_observation_current_actor_is_active_manager_v1',
  array[]::text[],
  'private active-manager predicate exists'
);
select ok(
  case when pg_catalog.to_regprocedure('dashboard_private.registration_observation_current_actor_is_active_manager_v1()') is null
    then false
    else has_function_privilege('authenticated', 'dashboard_private.registration_observation_current_actor_is_active_manager_v1()', 'EXECUTE')
      and not has_function_privilege('anon', 'dashboard_private.registration_observation_current_actor_is_active_manager_v1()', 'EXECUTE')
  end,
  'only authenticated can execute the private active-manager predicate'
);
select is(
  pg_catalog.jsonb_build_object(
    'activeAdmin', pg_temp.core_review_observation_count('99010000-0000-4000-8000-000000000001'),
    'activeStaff', pg_temp.core_review_observation_count('99010000-0000-4000-8000-000000000002'),
    'expiredStaff', pg_temp.core_review_observation_count('99010000-0000-4000-8000-000000000007'),
    'director', pg_temp.core_review_observation_count('99010000-0000-4000-8000-000000000008')
  ),
  '{"activeAdmin":1,"activeStaff":1,"expiredStaff":1,"director":1}'::jsonb,
  'active admin staff expired-ban staff and assigned active director read the observation table'
);
select is(
  pg_catalog.jsonb_build_object(
    'deletedAdmin', pg_temp.core_review_observation_count('99010000-0000-4000-8000-000000000003'),
    'deletedStaff', pg_temp.core_review_observation_count('99010000-0000-4000-8000-000000000004'),
    'bannedAdmin', pg_temp.core_review_observation_count('99010000-0000-4000-8000-000000000005'),
    'bannedStaff', pg_temp.core_review_observation_count('99010000-0000-4000-8000-000000000006')
  ),
  '{"deletedAdmin":0,"deletedStaff":0,"bannedAdmin":0,"bannedStaff":0}'::jsonb,
  'deleted and currently banned admin staff cannot read the observation table'
);
select is(
  pg_catalog.jsonb_build_object(
    'activeAdmin', pg_temp.core_review_summary_scalars('99010000-0000-4000-8000-000000000001'),
    'activeStaff', pg_temp.core_review_summary_scalars('99010000-0000-4000-8000-000000000002'),
    'expiredStaff', pg_temp.core_review_summary_scalars('99010000-0000-4000-8000-000000000007'),
    'director', pg_temp.core_review_summary_scalars('99010000-0000-4000-8000-000000000008')
  ),
  pg_catalog.jsonb_build_object(
    'activeAdmin', pg_catalog.jsonb_build_array(23, '99010000-0000-4000-8000-000000000107', 'scheduled', '99010000-0000-4000-8000-000000000106', true, '본관', 3, 5, 2),
    'activeStaff', pg_catalog.jsonb_build_array(23, '99010000-0000-4000-8000-000000000107', 'scheduled', '99010000-0000-4000-8000-000000000106', true, '본관', 3, 5, 2),
    'expiredStaff', pg_catalog.jsonb_build_array(23, '99010000-0000-4000-8000-000000000107', 'scheduled', '99010000-0000-4000-8000-000000000106', true, '본관', 3, 5, 2),
    'director', pg_catalog.jsonb_build_array(23, '99010000-0000-4000-8000-000000000107', 'scheduled', '99010000-0000-4000-8000-000000000106', true, '본관', 3, 5, 2)
  ),
  'all nine summary scalars are visible to active managers expired bans and assigned director'
);
select is(
  pg_catalog.jsonb_build_object(
    'deletedAdmin', pg_temp.core_review_summary_scalars('99010000-0000-4000-8000-000000000003'),
    'deletedStaff', pg_temp.core_review_summary_scalars('99010000-0000-4000-8000-000000000004'),
    'bannedAdmin', pg_temp.core_review_summary_scalars('99010000-0000-4000-8000-000000000005'),
    'bannedStaff', pg_temp.core_review_summary_scalars('99010000-0000-4000-8000-000000000006')
  ),
  pg_catalog.jsonb_build_object(
    'deletedAdmin', pg_catalog.jsonb_build_array(null, null, null, null, false, null, null, null, null),
    'deletedStaff', pg_catalog.jsonb_build_array(null, null, null, null, false, null, null, null, null),
    'bannedAdmin', pg_catalog.jsonb_build_array(null, null, null, null, false, null, null, null, null),
    'bannedStaff', pg_catalog.jsonb_build_array(null, null, null, null, false, null, null, null, null)
  ),
  'all nine summary scalars are concealed from deleted and currently banned managers'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'attemptCount', pg_catalog.jsonb_array_length(detail -> 'attempts'),
      'decisionInsideAttempts', exists (
        select 1
        from pg_catalog.jsonb_array_elements(detail -> 'attempts') attempt
        where attempt ->> 'observationId' = '99010000-0000-4000-8000-000000000109'
      ),
      'latestDecisionObservation', detail -> 'latestDecisionObservation'
    )
    from (select pg_temp.core_review_manager_detail(
      '99010000-0000-4000-8000-000000000001'
    ) detail) manager_detail
  ),
  pg_catalog.jsonb_build_object(
    'attemptCount', 20,
    'decisionInsideAttempts', false,
    'latestDecisionObservation', pg_catalog.jsonb_build_object(
      'observationId', '99010000-0000-4000-8000-000000000109',
      'decisionKind', 're_observation',
      'observationRevision', 6,
      'feedbackRevision', 2
    )
  ),
  'latest decision is exact and independent from the bounded attempts array'
);

set local statement_timeout = '8s';
select lives_ok(
  $statement$
    do $body$
    declare
      v_result jsonb;
      v_representative jsonb;
      v_expected_content_hash text;
      v_expected_booking_hash text;
      v_session_date date := current_date + 1;
      v_starts_at timestamptz := (current_date + 1 + '18:00'::time) at time zone 'Asia/Seoul';
      v_ends_at timestamptz := (current_date + 1 + '20:00'::time) at time zone 'Asia/Seoul';
      v_started_at timestamptz := pg_catalog.clock_timestamp();
    begin
      v_result := pg_temp.core_review_session_list(
        '99010000-0000-4000-8000-000000000400',
        current_date + 1,
        current_date + 100
      );
      if pg_catalog.clock_timestamp() - v_started_at > interval '8 seconds' then
        raise exception '10k legacy list exceeded conservative 8 second bound';
      end if;
      if pg_catalog.jsonb_array_length(v_result) <> 240 then
        raise exception 'unexpected bounded result length: %', pg_catalog.jsonb_array_length(v_result);
      end if;
      select item into v_representative
      from pg_catalog.jsonb_array_elements(v_result) item
      where item ->> 'sessionKey' = 'bulk-00001';
      if v_representative is null then
        raise exception 'representative session missing';
      end if;
      v_expected_content_hash := dashboard_private.continuous_class_schedule_content_hash_v1(
        pg_catalog.jsonb_build_object(
          'textbooks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'textbookId', '99010000-0000-4000-8000-000000000410',
            'title', '코어 리뷰 교재'
          )),
          'sessions', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'sessionKey', 'bulk-00001',
            'textbookEntries', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'textbookId', '99010000-0000-4000-8000-000000000410',
              'plan', pg_catalog.jsonb_build_object('label', '1단원', 'memo', '복습')
            ))
          ))
        )
      );
      v_expected_booking_hash := dashboard_private.registration_observation_booking_fact_hash_v1(
        pg_catalog.jsonb_build_object(
          'classId', '99010000-0000-4000-8000-000000000400'::uuid,
          'subject', '영어',
          'sessionAuthority', 'legacy',
          'classLessonSessionId', null,
          'legacySessionKey', 'bulk-00001',
          'sessionKey', 'bulk-00001',
          'scheduleState', 'active',
          'sessionDate', v_session_date,
          'startsAt', v_starts_at,
          'endsAt', v_ends_at,
          'teacherCatalogId', '99010000-0000-4000-8000-000000000101'::uuid,
          'teacherProfileId', '99010000-0000-4000-8000-000000000008'::uuid,
          'teacherName', '담당 원장',
          'classroomCatalogId', '99010000-0000-4000-8000-000000000102'::uuid,
          'classroomName', '코어 리뷰실',
          'campus', '본관'
        )
      );
      if pg_catalog.jsonb_build_object(
        'classId', v_representative -> 'classId',
        'subject', v_representative -> 'subject',
        'sessionAuthority', v_representative -> 'sessionAuthority',
        'classLessonSessionId', v_representative -> 'classLessonSessionId',
        'legacySessionKey', v_representative -> 'legacySessionKey',
        'sessionKey', v_representative -> 'sessionKey',
        'scheduleState', v_representative -> 'scheduleState',
        'sessionDate', v_representative -> 'sessionDate',
        'teacherCatalogId', v_representative -> 'teacherCatalogId',
        'teacherProfileId', v_representative -> 'teacherProfileId',
        'teacherName', v_representative -> 'teacherName',
        'classroomCatalogId', v_representative -> 'classroomCatalogId',
        'classroomName', v_representative -> 'classroomName',
        'campus', v_representative -> 'campus',
        'className', v_representative -> 'className',
        'textbooks', v_representative -> 'textbooks',
        'progress', v_representative -> 'progress',
        'legacySessionSourceHash', v_representative -> 'legacySessionSourceHash',
        'sourceRevision', v_representative -> 'sourceRevision',
        'bookingFactHash', v_representative -> 'bookingFactHash'
      ) <> pg_catalog.jsonb_build_object(
        'classId', '99010000-0000-4000-8000-000000000400',
        'subject', '영어',
        'sessionAuthority', 'legacy',
        'classLessonSessionId', null,
        'legacySessionKey', 'bulk-00001',
        'sessionKey', 'bulk-00001',
        'scheduleState', 'active',
        'sessionDate', pg_catalog.to_char(v_session_date, 'YYYY-MM-DD'),
        'teacherCatalogId', '99010000-0000-4000-8000-000000000101',
        'teacherProfileId', '99010000-0000-4000-8000-000000000008',
        'teacherName', '담당 원장',
        'classroomCatalogId', '99010000-0000-4000-8000-000000000102',
        'classroomName', '코어 리뷰실',
        'campus', '본관',
        'className', '코어 리뷰 10k 반',
        'textbooks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'textbookId', '99010000-0000-4000-8000-000000000410',
          'title', '코어 리뷰 교재',
          'planLabel', '1단원',
          'memo', '복습'
        )),
        'progress', '진도: 10k 대표 진도',
        'legacySessionSourceHash', v_expected_content_hash,
        'sourceRevision', pg_catalog.jsonb_build_object(
          'authority', 'legacy',
          'sessionKey', 'bulk-00001',
          'contentHash', v_expected_content_hash
        ),
        'bookingFactHash', v_expected_booking_hash
      ) then
        raise exception 'representative session parity mismatch: %', v_representative;
      end if;
    end
    $body$
  $statement$,
  '10k legacy source returns 240 exact selected rows within the conservative statement bound'
);
set local statement_timeout = '120s';

update public.classes
set schedule_plan = '{"sessions":[{"sessionKey":"duplicate","date":"2099-01-01"},{"session_key":"duplicate","date":"2099-01-02"}]}'::jsonb
where id = '99010000-0000-4000-8000-000000000400';
select throws_ok(
  $$select pg_temp.core_review_session_list('99010000-0000-4000-8000-000000000400', current_date + 1, current_date + 100)$$,
  '22023',
  'registration_observation_legacy_session_invalid',
  'set-wise legacy list rejects duplicate canonical keys before bounding candidates'
);

update public.classes
set schedule_plan = '{"sessions":[{"date":"2099-01-01"}]}'::jsonb
where id = '99010000-0000-4000-8000-000000000400';
select throws_ok(
  $$select pg_temp.core_review_session_list('99010000-0000-4000-8000-000000000400', current_date + 1, current_date + 100)$$,
  '22023',
  'registration_observation_legacy_session_invalid',
  'set-wise legacy list rejects a null canonical key before bounding candidates'
);

select * from finish();
rollback;
