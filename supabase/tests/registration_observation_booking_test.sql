begin;
select plan(39);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

create extension if not exists dblink;

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
values (
  '99100000-0000-4000-8000-000000000103', '청강 예약 영어반',
  '영어', '수업 진행 중', 'normalized', '{"sessions":[]}'::jsonb
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
  ('99100000-0000-4000-8000-000000000155', '청강 rollback fixture', 'registration', 'requested', 'normal', '99100000-0000-4000-8000-000000000001', '합성 롤백학생');

insert into public.ops_registration_details(task_id)
values
  ('99100000-0000-4000-8000-000000000105'),
  ('99100000-0000-4000-8000-000000000115'),
  ('99100000-0000-4000-8000-000000000125'),
  ('99100000-0000-4000-8000-000000000135'),
  ('99100000-0000-4000-8000-000000000145'),
  ('99100000-0000-4000-8000-000000000155');

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
  ('99100000-0000-4000-8000-000000000156', '99100000-0000-4000-8000-000000000155', '영어', 'consultation_waiting', '99100000-0000-4000-8000-000000000003', 'manual', now(), false, 'observation_requested', 1, now(), 'consultation_completed', 0);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision,
  created_by, created_at, updated_at
)
values
  ('99100000-0000-4000-8000-000000000137', '99100000-0000-4000-8000-000000000135', 'observation_class', ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'canceled', 2, '99100000-0000-4000-8000-000000000001', now() - interval '3 days', now() - interval '3 days'),
  ('99100000-0000-4000-8000-000000000147', '99100000-0000-4000-8000-000000000145', 'observation_class', ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'completed', 4, '99100000-0000-4000-8000-000000000001', now() - interval '4 days', now() - interval '4 days'),
  ('99100000-0000-4000-8000-000000000157', '99100000-0000-4000-8000-000000000145', 'observation_class', ((current_date + 14 + time '19:00') at time zone 'Asia/Seoul'), '본관', 'canceled', 2, '99100000-0000-4000-8000-000000000001', now() - interval '2 days', now() - interval '2 days');

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

create temporary table registration_observation_booking_results(
  result_key text primary key,
  response jsonb not null
) on commit drop;
grant all on registration_observation_booking_results to authenticated;

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1,
    updated_at = now(),
    updated_by = '99100000-0000-4000-8000-000000000001'
where singleton = true;

select function_returns('public', 'enter_registration_observation_v1', array['uuid','integer','text'], 'jsonb');
select function_returns('public', 'save_registration_observation_booking_v1', array['uuid','uuid','uuid','text','uuid','text','integer','integer','bigint','text'], 'jsonb');
select function_returns('public', 'cancel_registration_observation_v1', array['uuid','integer','bigint','text'], 'jsonb');
select function_returns('public', 'withdraw_registration_observation_v1', array['uuid','text','text','uuid','integer','bigint','bigint','text','text'], 'jsonb');
select ok(
  has_function_privilege('authenticated', 'public.enter_registration_observation_v1(uuid,integer,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_registration_observation_v1(uuid,integer,bigint,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)', 'EXECUTE'),
  'authenticated can execute only the public booking lifecycle surface'
);
select ok(
  not has_function_privilege('anon', 'public.enter_registration_observation_v1(uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.ops_registration_observations', 'INSERT')
  and not has_table_privilege('authenticated', 'dashboard_private.registration_observation_mutation_requests', 'SELECT'),
  'anon service and direct-write surfaces remain closed'
);

select pg_temp.registration_observation_booking_set_actor('99100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.enter_registration_observation_v1('99100000-0000-4000-8000-000000000106', 1, 'unrelated-enter')$$,
  'P0002', 'registration_observation_not_found',
  'unrelated actor cannot enter an existing observation track'
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

insert into registration_observation_booking_results(result_key, response)
select 'enter', public.enter_registration_observation_v1(
  '99100000-0000-4000-8000-000000000106', 1, 'enter-once'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', track.workflow_status,
      'revision', track.workflow_revision,
      'returnStatus', track.observation_return_workflow_status,
      'attempts', track.observation_attempt_count,
      'response', result.response,
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
  '{"status":"observation_requested","revision":2,"returnStatus":"consultation_completed","attempts":0,"response":{"operation":"enter","requestKey":"enter-once","trackId":"99100000-0000-4000-8000-000000000106","workflowStatus":"observation_requested","workflowRevision":2,"observation":null,"appointment":null,"changed":true},"observationCount":0}'::jsonb,
  'enter changes only workflow revision and return status'
);
reset role;

update dashboard_private.registration_observation_runtime_settings
set activation_version = 0
where singleton = true;
set local role authenticated;
select is(
  public.enter_registration_observation_v1(
    '99100000-0000-4000-8000-000000000106', 1, 'enter-once'
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
      on observation.id = (result.response -> 'observation' ->> 'id')::uuid
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
        where event.observation_id = (original.response -> 'observation' ->> 'id')::uuid
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
    (select (response -> 'observation' ->> 'id')::uuid from registration_observation_booking_results where result_key = 'book-1'),
    1, 1, 'book-once'
  )$$,
  '23505', 'registration_observation_request_key_conflict',
  'same actor key cannot cross from book to cancel operation'
);

insert into registration_observation_booking_results(result_key, response)
select 'reschedule-noop', public.save_registration_observation_booking_v1(
  '99100000-0000-4000-8000-000000000116',
  (select (response -> 'observation' ->> 'id')::uuid from registration_observation_booking_results where result_key = 'book-1'),
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
      on observation.id = (result.response -> 'observation' ->> 'id')::uuid
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    where result.result_key = 'reschedule-noop'
  ),
  '{"changed":false,"observationRevision":1,"notificationRevision":1,"eventCount":1}'::jsonb,
  'same booking hash stores only its receipt and preserves customer revisions'
);

insert into registration_observation_booking_results(result_key, response)
select 'reschedule-changed', public.save_registration_observation_booking_v1(
  '99100000-0000-4000-8000-000000000116',
  (select (response -> 'observation' ->> 'id')::uuid from registration_observation_booking_results where result_key = 'book-1'),
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
      on observation.id = (result.response -> 'observation' ->> 'id')::uuid
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
    (select (response -> 'observation' ->> 'id')::uuid from registration_observation_booking_results where result_key = 'book-1'),
    '99100000-0000-4000-8000-000000000103', 'normalized',
    '99100000-0000-4000-8000-000000000104', null,
    null, 1, 1, 'reschedule-stale'
  )$$,
  '40001', null,
  'stale reschedule revisions close with SQLSTATE 40001'
);

insert into registration_observation_booking_results(result_key, response)
select 'cancel-1', public.cancel_registration_observation_v1(
  (select (response -> 'observation' ->> 'id')::uuid from registration_observation_booking_results where result_key = 'book-1'),
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
      on observation.id = (result.response -> 'observation' ->> 'id')::uuid
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track on track.id = observation.track_id
    where result.result_key = 'cancel-1'
  ),
  '{"observationStatus":"canceled","appointmentStatus":"canceled","observationRevision":3,"feedbackRevision":0,"notificationRevision":3,"workflowStatus":"observation_requested","workflowRevision":2,"attempts":1,"eventCount":1}'::jsonb,
  'cancel updates both lifecycle rows and leaves track and counter unchanged'
);
select is(
  public.cancel_registration_observation_v1(
    (select (response -> 'observation' ->> 'id')::uuid from registration_observation_booking_results where result_key = 'book-1'),
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
      'newId', first.response -> 'observation' ->> 'id'
        <> second.response -> 'observation' ->> 'id',
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
  (select (response -> 'observation' ->> 'id')::uuid from registration_observation_booking_results where result_key = 'book-2'),
  1, 1, 'cancel-second'
);

insert into registration_observation_booking_results(result_key, response)
select 'withdraw-return', public.withdraw_registration_observation_v1(
  '99100000-0000-4000-8000-000000000116', 'return_to_previous',
  'consultation_completed', null, 2, null, null, null, 'withdraw-return'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', track.workflow_status,
      'revision', track.workflow_revision,
      'returnStatus', track.observation_return_workflow_status,
      'attempts', track.observation_attempt_count,
      'observation', result.response -> 'observation',
      'appointment', result.response -> 'appointment'
    )
    from public.ops_registration_subject_tracks track
    join registration_observation_booking_results result on result.result_key = 'withdraw-return'
    where track.id = '99100000-0000-4000-8000-000000000116'
  ),
  '{"status":"consultation_completed","revision":3,"returnStatus":null,"attempts":2,"observation":null,"appointment":null}'::jsonb,
  'return withdrawal changes only track workflow and clears return status'
);

select throws_ok(
  $$select public.set_registration_workflow_status_v1(
    '99100000-0000-4000-8000-000000000126', 'observation_requested', 1,
    'generic-target-observation'
  )$$,
  '55000', 'registration_observation_transition_requires_action',
  'generic RPC rejects an observation target with the action error'
);
select throws_ok(
  $$select public.set_registration_workflow_status_v1(
    '99100000-0000-4000-8000-000000000136', 'enrollment_requested', 1,
    'generic-source-observation'
  )$$,
  '55000', 'registration_observation_transition_requires_action',
  'generic RPC rejects an observation source even with canceled-only history'
);
select lives_ok(
  $$select public.set_registration_workflow_status_v1(
    '99100000-0000-4000-8000-000000000126', 'enrollment_requested', 1,
    'generic-plain-enrollment'
  )$$,
  'generic consultation to enrollment remains compatible without observations'
);

insert into registration_observation_booking_results(result_key, response)
select 'withdraw-general', public.withdraw_registration_observation_v1(
  '99100000-0000-4000-8000-000000000136', 'director_decision',
  'enrollment_requested', null, 1, null, null, null, 'withdraw-general'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', track.workflow_status,
      'revision', track.workflow_revision,
      'attempts', track.observation_attempt_count,
      'decision', observation.decision_kind,
      'observationRevision', observation.revision,
      'notificationRevision', appointment.notification_revision
    )
    from public.ops_registration_subject_tracks track
    join public.ops_registration_observations observation on observation.track_id = track.id
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    where track.id = '99100000-0000-4000-8000-000000000136'
  ),
  '{"status":"enrollment_requested","revision":2,"attempts":1,"decision":null,"observationRevision":2,"notificationRevision":2}'::jsonb,
  'general director withdrawal can choose enrollment after canceled-only history without an observation decision'
);

select throws_ok(
  $$select public.withdraw_registration_observation_v1(
    '99100000-0000-4000-8000-000000000146', 'director_decision',
    'enrollment_requested', '99100000-0000-4000-8000-000000000148',
    4, 7, 2, '사유', 'withdraw-correction-stale'
  )$$,
  '40001', null,
  'stale correction feedback revision closes with SQLSTATE 40001'
);
select throws_ok(
  $$select public.withdraw_registration_observation_v1(
    '99100000-0000-4000-8000-000000000146', 'director_decision',
    'enrollment_requested', '99100000-0000-4000-8000-000000000148',
    4, 7, 3, null, 'withdraw-correction-no-reason'
  )$$,
  '22023', 'registration_observation_correction_reason_required',
  're-observation correction requires a nonblank reason'
);
insert into registration_observation_booking_results(result_key, response)
select 'withdraw-correction', public.withdraw_registration_observation_v1(
  '99100000-0000-4000-8000-000000000146', 'director_decision',
  'enrollment_requested', '99100000-0000-4000-8000-000000000148',
  4, 7, 3, '원장 재검토로 등록 결정', 'withdraw-correction'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'attempts', track.observation_attempt_count,
      'decision', observation.decision_kind,
      'suitability', observation.suitability_result,
      'observationRevision', observation.revision,
      'feedbackRevision', observation.feedback_revision,
      'notificationRevision', appointment.notification_revision,
      'laterCanceledDecision', later_observation.decision_kind
    )
    from public.ops_registration_subject_tracks track
    join public.ops_registration_observations observation
      on observation.id = '99100000-0000-4000-8000-000000000148'
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    join public.ops_registration_observations later_observation
      on later_observation.id = '99100000-0000-4000-8000-000000000158'
    where track.id = observation.track_id
  ),
  '{"status":"enrollment_requested","workflowRevision":5,"attempts":2,"decision":"enrollment","suitability":"unfit","observationRevision":8,"feedbackRevision":3,"notificationRevision":4,"laterCanceledDecision":null}'::jsonb,
  're-observation correction permits enrollment independent of suitability and changes only exact revisions'
);
select ok(
  exists (
    select 1
    from public.ops_task_events event
    where event.task_id = '99100000-0000-4000-8000-000000000145'
      and event.event_type = 'registration_track_event'
      and (event.after_value::jsonb ->> 'event_type') = 'registration_observation_withdrawn'
      and event.after_value::jsonb -> 'metadata' @> '{"beforeDecision":"re_observation","afterDecision":"enrollment","reason":"원장 재검토로 등록 결정"}'::jsonb
  ),
  'correction audit contains exact before after decision and required reason'
);

select is(
  (
    select count(*)
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id in (
      '99100000-0000-4000-8000-000000000116',
      '99100000-0000-4000-8000-000000000136',
      '99100000-0000-4000-8000-000000000146'
    )
  ),
  0::bigint,
  'booking and withdrawal lifecycle creates no enrollment rows'
);

create temporary table registration_observation_concurrency_results(
  scenario text not null,
  worker text not null,
  sqlstate text not null,
  response jsonb,
  message text
) on commit drop;

select dblink_connect('booking_withdraw_book', 'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr()) || ' port=5432 dbname=' || current_database() || ' user=postgres password=postgres');
select dblink_connect('booking_withdraw_exit', 'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr()) || ' port=5432 dbname=' || current_database() || ' user=postgres password=postgres');
select dblink_connect('reschedule_cancel_reschedule', 'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr()) || ' port=5432 dbname=' || current_database() || ' user=postgres password=postgres');
select dblink_connect('reschedule_cancel_cancel', 'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr()) || ' port=5432 dbname=' || current_database() || ' user=postgres password=postgres');

select dblink_exec(connection_name, $remote$
  create or replace function pg_temp.registration_observation_capture(p_sql text)
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
        get stacked diagnostics result_sqlstate = returned_sqlstate, message = message_text;
        response := null;
        return next;
    end;
  end;
  $capture$;
  do $actor$
  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', '99000000-0000-4000-8000-000000000001', false);
    perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', false);
  end;
  $actor$;
  set role authenticated;
$remote$)
from (values
  ('booking_withdraw_book'),
  ('booking_withdraw_exit'),
  ('reschedule_cancel_reschedule'),
  ('reschedule_cancel_cancel')
) connection(connection_name);

select dblink_send_query(
  'booking_withdraw_book',
  $query$select * from pg_temp.registration_observation_capture($statement$
    with delay as materialized (select pg_catalog.pg_sleep(0.35))
    select public.save_registration_observation_booking_v1(
      '99000000-0000-4000-8000-000000000106', null,
      '99000000-0000-4000-8000-000000000103', 'normalized',
      '99000000-0000-4000-8000-000000000104', null,
      1, null, null, 'runner-book-race'
    ) from delay
  $statement$)$query$
);
select dblink_send_query(
  'booking_withdraw_exit',
  $query$select * from pg_temp.registration_observation_capture($statement$
    select public.withdraw_registration_observation_v1(
      '99000000-0000-4000-8000-000000000106', 'return_to_previous',
      'consultation_completed', null, 1, null, null, null,
      'runner-withdraw-race'
    )
  $statement$)$query$
);
insert into registration_observation_concurrency_results
select 'book-withdraw', 'book', result.*
from dblink_get_result('booking_withdraw_book')
  as result(sqlstate text, response jsonb, message text);
insert into registration_observation_concurrency_results
select 'book-withdraw', 'withdraw', result.*
from dblink_get_result('booking_withdraw_exit')
  as result(sqlstate text, response jsonb, message text);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'successes', count(*) filter (where sqlstate = '00000'),
      'stale', count(*) filter (where sqlstate = '40001'),
      'attempts', (
        select observation_attempt_count
        from public.ops_registration_subject_tracks
        where id = '99000000-0000-4000-8000-000000000106'
      ),
      'observations', (
        select count(*) from public.ops_registration_observations
        where track_id = '99000000-0000-4000-8000-000000000106'
      )
    )
    from registration_observation_concurrency_results
    where scenario = 'book-withdraw'
  ),
  '{"successes":1,"stale":1,"attempts":0,"observations":0}'::jsonb,
  'book versus withdraw finishes without deadlock and failed insert increments nothing'
);

select dblink_send_query(
  'reschedule_cancel_reschedule',
  $query$select * from pg_temp.registration_observation_capture($statement$
    select public.save_registration_observation_booking_v1(
      '99000000-0000-4000-8000-000000000116',
      '99000000-0000-4000-8000-000000000118',
      '99000000-0000-4000-8000-000000000103', 'normalized',
      '99000000-0000-4000-8000-000000000114', null,
      null, 1, 1, 'runner-reschedule-race'
    )
  $statement$)$query$
);
select dblink_send_query(
  'reschedule_cancel_cancel',
  $query$select * from pg_temp.registration_observation_capture($statement$
    select public.cancel_registration_observation_v1(
      '99000000-0000-4000-8000-000000000118', 1, 1,
      'runner-cancel-race'
    )
  $statement$)$query$
);
insert into registration_observation_concurrency_results
select 'reschedule-cancel', 'reschedule', result.*
from dblink_get_result('reschedule_cancel_reschedule')
  as result(sqlstate text, response jsonb, message text);
insert into registration_observation_concurrency_results
select 'reschedule-cancel', 'cancel', result.*
from dblink_get_result('reschedule_cancel_cancel')
  as result(sqlstate text, response jsonb, message text);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'successes', count(*) filter (where sqlstate = '00000'),
      'stale', count(*) filter (where sqlstate = '40001'),
      'observationRevision', (
        select revision from public.ops_registration_observations
        where id = '99000000-0000-4000-8000-000000000118'
      ),
      'notificationRevision', (
        select notification_revision from public.ops_registration_appointments
        where id = '99000000-0000-4000-8000-000000000117'
      ),
      'events', (
        select count(*) from dashboard_private.registration_observation_domain_events
        where observation_id = '99000000-0000-4000-8000-000000000118'
      )
    )
    from registration_observation_concurrency_results
    where scenario = 'reschedule-cancel'
  ),
  '{"successes":1,"stale":1,"observationRevision":2,"notificationRevision":2,"events":1}'::jsonb,
  'reschedule versus cancel serializes with one success one stale and one event'
);

select dblink_disconnect('booking_withdraw_book');
select dblink_disconnect('booking_withdraw_exit');
select dblink_disconnect('reschedule_cancel_reschedule');
select dblink_disconnect('reschedule_cancel_cancel');

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
