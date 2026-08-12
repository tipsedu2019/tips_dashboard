begin;

select plan(90);

select has_column('dashboard_private', 'registration_customer_reminder_jobs', 'job_id', 'queue uses a UUID job identity');
select has_column('dashboard_private', 'registration_customer_reminder_jobs', 'message_kind', 'queue distinguishes reminder kinds');
select has_column('dashboard_private', 'registration_customer_reminder_jobs', 'observation_id', 'observation source is durable');
select has_column('dashboard_private', 'registration_customer_reminder_jobs', 'source_refresh_count', 'source refresh is durable');
select has_column('public', 'ops_registration_customer_messages', 'scheduled_source_identity', 'scheduled messages carry the source identity');
select has_table('dashboard_private', 'registration_observation_solapi_event_consumptions', 'event consumption ledger exists');

select col_is_pk('dashboard_private', 'registration_customer_reminder_jobs', 'job_id', 'UUID job id is primary');
select has_fk('public', 'ops_registration_customer_messages', 'scheduled messages have a queue foreign key');
select ok(
  exists(
    select 1 from pg_catalog.pg_constraint c
    where c.conname = 'ops_registration_customer_messages_scheduled_job_source_fkey'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%scheduled_source_identity%'
  ),
  'scheduled message FK is composite'
);

select has_function('dashboard_private', 'materialize_registration_observation_solapi_events_v1', array['integer'], 'materializer exists');
select function_privs_are('dashboard_private', 'materialize_registration_observation_solapi_events_v1', array['integer'], 'service_role', array['EXECUTE'], 'materializer is service-only');
select function_privs_are('dashboard_private', 'sync_registration_customer_reminder_jobs_v1', array[]::text[], 'service_role', array[]::text[], 'private sync stays ungranted to the service role');
select function_privs_are('public', 'claim_registration_customer_reminder_job_v1', array[]::text[], 'service_role', array['EXECUTE'], 'claim remains service-only');
select function_privs_are('public', 'read_registration_customer_reminder_source_v1', array['uuid', 'uuid'], 'service_role', array['EXECUTE'], 'read remains service-only');
select function_privs_are('public', 'release_registration_customer_reminder_job_v1', array['uuid', 'uuid', 'text'], 'service_role', array['EXECUTE'], 'release remains service-only');
select function_privs_are('public', 'begin_registration_customer_reminder_dispatch_v1', array['uuid', 'uuid', 'jsonb', 'jsonb'], 'service_role', array['EXECUTE'], 'begin remains service-only');
select function_privs_are('public', 'finalize_registration_customer_reminder_dispatch_v1', array['uuid', 'uuid', 'text', 'jsonb'], 'service_role', array['EXECUTE'], 'finalize remains service-only');

select is_empty(
  $$select 1 from dashboard_private.registration_customer_reminder_jobs where message_kind = 'observation_reminder' and status = 'claimed'$$,
  'Task 2 does not make observation jobs claimable'
);
select is_empty(
  $$select 1 from dashboard_private.registration_observation_solapi_event_consumptions$$,
  'queue migration does not consume or send historic events'
);

select ok(
  not exists(
    select 1 from pg_catalog.pg_proc proc
    where proc.oid in (
      'dashboard_private.sync_registration_customer_reminder_jobs_v1()'::regprocedure,
      'dashboard_private.materialize_registration_observation_solapi_events_v1(integer)'::regprocedure,
      'public.claim_registration_customer_reminder_job_v1()'::regprocedure,
      'public.read_registration_customer_reminder_source_v1(uuid,uuid)'::regprocedure,
      'public.release_registration_customer_reminder_job_v1(uuid,uuid,text)'::regprocedure,
      'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::regprocedure,
      'public.finalize_registration_customer_reminder_dispatch_v1(uuid,uuid,text,jsonb)'::regprocedure
    ) and (not proc.prosecdef or not exists(
      select 1 from pg_catalog.unnest(coalesce(proc.proconfig, '{}'::text[])) setting
      where setting in ('search_path=', 'search_path=""')
    ))
  ),
  'all queue worker definers use an empty search path'
);

select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select dashboard_private.sync_registration_customer_reminder_jobs_v1()$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'wrong-role JWT cannot cross the private sync fence'
);
select throws_ok(
  $$select public.claim_registration_customer_reminder_job_v1()$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'wrong-role JWT cannot cross the legacy claim fence'
);
select throws_ok(
  $$select public.read_registration_customer_reminder_source_v1(
    gen_random_uuid(), gen_random_uuid()
  )$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'wrong-role JWT cannot cross the source-read fence'
);
select throws_ok(
  $$select public.release_registration_customer_reminder_job_v1(
    gen_random_uuid(), gen_random_uuid(), 'source_read_failed'
  )$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'wrong-role JWT cannot cross the release fence'
);
select throws_ok(
  $$select public.begin_registration_customer_reminder_dispatch_v1(
    gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, '{}'::jsonb
  )$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'wrong-role JWT cannot cross the begin-dispatch fence'
);
select throws_ok(
  $$select public.finalize_registration_customer_reminder_dispatch_v1(
    gen_random_uuid(), gen_random_uuid(), 'accepted', '{}'::jsonb
  )$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'wrong-role JWT cannot cross the finalize fence'
);
select throws_ok(
  $$select dashboard_private.materialize_registration_observation_solapi_events_v1(1)$$,
  '42501', 'registration_observation_solapi_worker_unauthorized',
  'wrong-role JWT cannot cross the observation materializer fence'
);
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'f6000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'solapi-queue@example.invalid',
  crypt('solapi-queue-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);
insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  'f6000000-0000-4000-8000-000000000001', 'admin',
  'SOLAPI queue fixture', 'solapi-queue@example.invalid', now(), now()
)
on conflict (id) do update set
  role = excluded.role,
  name = excluded.name,
  email = excluded.email,
  updated_at = excluded.updated_at;
insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id, student_name
) values (
  'f6000000-0000-4000-8000-000000000010', 'SOLAPI legacy queue fixture',
  'registration', 'requested', 'normal',
  'f6000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001', '큐 학생'
);
insert into public.ops_registration_details(task_id, parent_phone)
values ('f6000000-0000-4000-8000-000000000010', '010-1234-5678');
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at
) values (
  'f6000000-0000-4000-8000-000000000011',
  'f6000000-0000-4000-8000-000000000010', '영어', 'level_test_scheduled',
  'f6000000-0000-4000-8000-000000000001', 'manual', now(), false,
  'level_test_requested', 1, now()
);
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
) values (
  'f6000000-0000-4000-8000-000000000012',
  'f6000000-0000-4000-8000-000000000010', 'level_test',
  pg_catalog.clock_timestamp() + interval '2 days', '본관', 'scheduled', 1,
  'f6000000-0000-4000-8000-000000000001'
);
insert into public.ops_registration_level_tests(
  id, track_id, appointment_id, attempt_number, status
) values (
  'f6000000-0000-4000-8000-000000000013',
  'f6000000-0000-4000-8000-000000000011',
  'f6000000-0000-4000-8000-000000000012', 1, 'scheduled'
);

create temporary table queue_legacy_fixture as
select appointment.id as appointment_id, appointment.task_id
from public.ops_registration_appointments appointment
where appointment.id = 'f6000000-0000-4000-8000-000000000012';

select ok(exists(select 1 from queue_legacy_fixture), 'local fixture has an appointment');

select throws_ok(
  $$
    insert into dashboard_private.registration_customer_reminder_jobs(
      job_id, appointment_id, task_id, message_kind, source_revision,
      scheduled_for, due_at, available_at, request_key, status
    ) select gen_random_uuid(), appointment_id, task_id, 'appointment_reminder',
      987654321, pg_catalog.clock_timestamp() + interval '1 day',
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), gen_random_uuid(), 'claimed'
    from queue_legacy_fixture
  $$,
  '23514', null, 'claimed job without lease is rejected by the database'
);

select throws_ok(
  $$
    insert into dashboard_private.registration_customer_reminder_jobs(
      job_id, appointment_id, task_id, message_kind, source_revision,
      scheduled_for, due_at, available_at, request_key, status, last_error_code
    ) select gen_random_uuid(), appointment_id, task_id, 'appointment_reminder',
      987654322, pg_catalog.clock_timestamp() + interval '1 day',
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), gen_random_uuid(), 'completed', 'provider_dispatch_uncertain'
    from queue_legacy_fixture
  $$,
  '23514', null, 'completed job cannot carry an uncertain-delivery error'
);

select throws_ok(
  $$
    insert into dashboard_private.registration_customer_reminder_jobs(
      job_id, appointment_id, task_id, message_kind, source_revision,
      scheduled_for, due_at, available_at, request_key, status,
      observation_id, source_event_id, booking_fact_hash, session_source_revision,
      activation_mode_snapshot, verification_started_at, verification_recipient_hash
    ) select gen_random_uuid(), appointment_id, task_id, 'appointment_reminder',
      987654323, pg_catalog.clock_timestamp() + interval '1 day',
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), gen_random_uuid(), 'pending',
      null, null, null, '{"authority":"legacy","sessionKey":"s","contentHash":"h","extra":"x"}'::jsonb,
      null, null, null
    from queue_legacy_fixture
  $$,
  '23514', null, 'legacy session source revision rejects extra keys'
);

delete from public.teacher_catalogs
where profile_id = 'f6000000-0000-4000-8000-000000000001';
insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role
) values (
  'f6000000-0000-4000-8000-000000000020', 'SOLAPI queue teacher',
  array['영어']::text[], true, 9960,
  'f6000000-0000-4000-8000-000000000001',
  'solapi-queue@example.invalid', 'teacher'
);
update public.profiles
set teacher_catalog_id = 'f6000000-0000-4000-8000-000000000020'
where id = 'f6000000-0000-4000-8000-000000000001';
insert into public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)
values (
  'f6000000-0000-4000-8000-000000000021', 'SOLAPI queue room',
  array['영어']::text[], true, 9960, '본관'
);
insert into public.classes(id, name, subject, status, schedule_storage_mode, schedule_plan)
values (
  'f6000000-0000-4000-8000-000000000022', 'SOLAPI queue class',
  '영어', '수업 진행 중', 'normalized', '{}'::jsonb
);
do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    'f6000000-0000-4000-8000-000000000022',
    'f6000000-0000-4000-8000-000000000099',
    'registration_observation_solapi_queue_test'
  );
end;
$$;
create temporary table queue_observation_clock as
select
  (current_date + 4) as session_date,
  '18:00'::time as start_time,
  '20:00'::time as end_time,
  ((current_date + 4) + '18:00'::time) at time zone 'Asia/Seoul' as starts_at,
  ((current_date + 4) + '20:00'::time) at time zone 'Asia/Seoul' as ends_at;
insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state, start_time, end_time,
  teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id,
  classroom_name_snapshot, origin, revision
)
select
  'f6000000-0000-4000-8000-000000000023',
  'f6000000-0000-4000-8000-000000000022',
  pg_catalog.to_char(clock.session_date, 'YYYY-MM-DD') || ':solapi-queue',
  clock.session_date, 'active', clock.start_time, clock.end_time,
  'f6000000-0000-4000-8000-000000000020', 'SOLAPI queue teacher',
  'f6000000-0000-4000-8000-000000000021', 'SOLAPI queue room', 'manual', 1
from queue_observation_clock clock;
insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id, student_name
) values (
  'f6000000-0000-4000-8000-000000000030', 'SOLAPI observation queue fixture',
  'registration', 'requested', 'normal',
  'f6000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001', '청강 큐 학생'
);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
) values (
  'f6000000-0000-4000-8000-000000000031',
  'f6000000-0000-4000-8000-000000000030', '영어', 'consultation_waiting',
  'f6000000-0000-4000-8000-000000000001', 'manual', now(), false,
  'observation_requested', 1, now(), 'consultation_completed', 0
);
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
)
select
  'f6000000-0000-4000-8000-000000000032',
  'f6000000-0000-4000-8000-000000000030', 'observation_class',
  clock.starts_at, '본관', 'scheduled', 1,
  'f6000000-0000-4000-8000-000000000001'
from queue_observation_clock clock;
insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, textbook_snapshot, progress_snapshot,
  created_by, updated_by
)
select
  'f6000000-0000-4000-8000-000000000033',
  'f6000000-0000-4000-8000-000000000030',
  'f6000000-0000-4000-8000-000000000031',
  'f6000000-0000-4000-8000-000000000032',
  'f6000000-0000-4000-8000-000000000022',
  'normalized', 'f6000000-0000-4000-8000-000000000023', null,
  clock.session_date, clock.starts_at, clock.ends_at, 'active', 1, null,
  '{"authority":"normalized","sessionId":"f6000000-0000-4000-8000-000000000023","revision":1}'::jsonb,
  dashboard_private.registration_observation_booking_fact_hash_v1(
    pg_catalog.jsonb_build_object(
      'classId', 'f6000000-0000-4000-8000-000000000022'::uuid,
      'subject', '영어', 'sessionAuthority', 'normalized',
      'classLessonSessionId', 'f6000000-0000-4000-8000-000000000023'::uuid,
      'legacySessionKey', null,
      'sessionKey', pg_catalog.to_char(clock.session_date, 'YYYY-MM-DD') || ':solapi-queue',
      'scheduleState', 'active', 'sessionDate', clock.session_date,
      'startsAt', clock.starts_at, 'endsAt', clock.ends_at,
      'teacherCatalogId', 'f6000000-0000-4000-8000-000000000020'::uuid,
      'teacherProfileId', 'f6000000-0000-4000-8000-000000000001'::uuid,
      'teacherName', 'SOLAPI queue teacher',
      'classroomCatalogId', 'f6000000-0000-4000-8000-000000000021'::uuid,
      'classroomName', 'SOLAPI queue room', 'campus', '본관'
    )
  ),
  'f6000000-0000-4000-8000-000000000020',
  'f6000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000021',
  '영어', 'SOLAPI queue class', 'SOLAPI queue teacher', 'SOLAPI queue room',
  '본관', '[]'::jsonb, '',
  'f6000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001'
from queue_observation_clock clock;

alter table dashboard_private.registration_customer_reminder_settings
  disable trigger sync_registration_customer_reminder_cron_active;
update dashboard_private.registration_customer_reminder_settings
set enabled = true, lead_hours = 3, revision = revision + 1,
    updated_by = 'f6000000-0000-4000-8000-000000000001'
where singleton;
alter table dashboard_private.registration_customer_reminder_settings
  enable trigger sync_registration_customer_reminder_cron_active;
update dashboard_private.registration_customer_solapi_activation
set mode = 'verification',
    verification_task_id = 'f6000000-0000-4000-8000-000000000030',
    verification_recipient_hash = repeat('b', 64),
    updated_by = 'f6000000-0000-4000-8000-000000000001'
where message_kind = 'observation_reminder';
alter table dashboard_private.registration_observation_domain_events
  disable trigger registration_observation_google_chat_materializer;
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  ('f6000000-0000-4000-8000-' || pg_catalog.lpad(kind.ordinal::text, 12, '0'))::uuid,
  observation.id, observation.appointment_id, 1, kind.event_kind,
  observation.booking_fact_hash, observation.source_revision,
  pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => kind.ordinal::double precision / 1000)
from (values
  (40, 'observation_scheduled'),
  (41, 'observation_rescheduled'),
  (42, 'observation_canceled'),
  (43, 'observation_attendance_recorded'),
  (44, 'observation_no_show'),
  (45, 'observation_feedback_submitted')
) kind(ordinal, event_kind)
cross join public.ops_registration_observations observation
where observation.id = 'f6000000-0000-4000-8000-000000000033';

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$select dashboard_private.materialize_registration_observation_solapi_events_v1(0)$$,
  '22023', 'registration_observation_solapi_limit_invalid',
  'materializer rejects a zero bound'
);
select throws_ok(
  $$select dashboard_private.materialize_registration_observation_solapi_events_v1(101)$$,
  '22023', 'registration_observation_solapi_limit_invalid',
  'materializer rejects a bound above one hundred'
);
select is(
  dashboard_private.materialize_registration_observation_solapi_events_v1(100),
  6,
  'all six observation domain event kinds are consumed exactly once'
);
select is(
  dashboard_private.materialize_registration_observation_solapi_events_v1(100),
  0,
  'materializer replay consumes no event twice'
);
reset role;
select is(
  (select pg_catalog.count(*)
   from dashboard_private.registration_observation_solapi_event_consumptions
   where event_id between 'f6000000-0000-4000-8000-000000000040'
     and 'f6000000-0000-4000-8000-000000000045'),
  6::bigint,
  'every real domain event has one durable consumption row'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.registration_customer_reminder_jobs
   where observation_id = 'f6000000-0000-4000-8000-000000000033'),
  1::bigint,
  'the six-event stream leaves only one observation revision job identity'
);
select ok(
  exists(
    select 1
    from dashboard_private.registration_customer_reminder_jobs job
    where job.observation_id = 'f6000000-0000-4000-8000-000000000033'
      and job.activation_mode_snapshot = 'verification'
      and job.verification_started_at is not null
      and job.verification_recipient_hash = repeat('b', 64)
  ),
  'eligible verification jobs retain the exact activation time and recipient hash snapshots'
);

update dashboard_private.registration_customer_solapi_activation
set mode = 'off', verification_task_id = null,
    verification_recipient_hash = null,
    updated_by = 'f6000000-0000-4000-8000-000000000001'
where message_kind = 'observation_reminder';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'f6000000-0000-4000-8000-000000000050', observation.id,
  observation.appointment_id, 50, 'observation_scheduled',
  observation.booking_fact_hash, observation.source_revision,
  pg_catalog.clock_timestamp()
from public.ops_registration_observations observation
where observation.id = 'f6000000-0000-4000-8000-000000000033';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select is(
  dashboard_private.materialize_registration_observation_solapi_events_v1(100),
  1,
  'OFF consumes the event without creating a job'
);
reset role;
select is(
  (select action from dashboard_private.registration_observation_solapi_event_consumptions
   where event_id = 'f6000000-0000-4000-8000-000000000050'),
  'skipped_off',
  'OFF records the durable skipped-off action'
);

update dashboard_private.registration_customer_solapi_activation
set mode = 'verification',
    verification_task_id = 'f6000000-0000-4000-8000-000000000010',
    verification_recipient_hash = repeat('c', 64),
    updated_by = 'f6000000-0000-4000-8000-000000000001'
where message_kind = 'observation_reminder';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'f6000000-0000-4000-8000-000000000051', observation.id,
  observation.appointment_id, 51, 'observation_scheduled',
  observation.booking_fact_hash, observation.source_revision,
  pg_catalog.clock_timestamp()
from public.ops_registration_observations observation
where observation.id = 'f6000000-0000-4000-8000-000000000033';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select is(
  dashboard_private.materialize_registration_observation_solapi_events_v1(100),
  1,
  'verification consumes an out-of-scope task event'
);
reset role;
select is(
  (select action from dashboard_private.registration_observation_solapi_event_consumptions
   where event_id = 'f6000000-0000-4000-8000-000000000051'),
  'skipped_scope',
  'verification rejects a different task scope'
);

update dashboard_private.registration_customer_solapi_activation
set verification_task_id = 'f6000000-0000-4000-8000-000000000030',
    verification_recipient_hash = repeat('d', 64),
    updated_by = 'f6000000-0000-4000-8000-000000000001'
where message_kind = 'observation_reminder';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'f6000000-0000-4000-8000-000000000052', observation.id,
  observation.appointment_id, 52, 'observation_scheduled',
  observation.booking_fact_hash, observation.source_revision,
  activation.updated_at - interval '1 second'
from public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'f6000000-0000-4000-8000-000000000033'
  and activation.message_kind = 'observation_reminder';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select is(
  dashboard_private.materialize_registration_observation_solapi_events_v1(100),
  1,
  'verification consumes an event predating the current hash scope'
);
reset role;
select is(
  (select action from dashboard_private.registration_observation_solapi_event_consumptions
   where event_id = 'f6000000-0000-4000-8000-000000000052'),
  'skipped_scope',
  'a changed verification hash invalidates older events by activation time'
);
select is_empty(
  $$select 1 from dashboard_private.registration_customer_reminder_jobs
    where source_event_id = 'f6000000-0000-4000-8000-000000000052'$$,
  'predating verification events produce no job snapshot'
);

update public.ops_registration_observations
set starts_at = pg_catalog.clock_timestamp() + interval '2 hours',
    ends_at = pg_catalog.clock_timestamp() + interval '3 hours'
where id = 'f6000000-0000-4000-8000-000000000033';
update dashboard_private.registration_customer_solapi_activation
set verification_recipient_hash = repeat('e', 64),
    updated_by = 'f6000000-0000-4000-8000-000000000001'
where message_kind = 'observation_reminder';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'f6000000-0000-4000-8000-000000000053', observation.id,
  observation.appointment_id, 53, 'observation_scheduled',
  observation.booking_fact_hash, observation.source_revision,
  pg_catalog.clock_timestamp()
from public.ops_registration_observations observation
where observation.id = 'f6000000-0000-4000-8000-000000000033';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select is(
  dashboard_private.materialize_registration_observation_solapi_events_v1(100),
  1,
  'materializer consumes a short-lead event'
);
reset role;
select is(
  (select action from dashboard_private.registration_observation_solapi_event_consumptions
   where event_id = 'f6000000-0000-4000-8000-000000000053'),
  'skipped_lead_time',
  'less than three hours of lead time creates no reminder job'
);
update public.ops_registration_observations observation
set starts_at = clock.starts_at, ends_at = clock.ends_at
from queue_observation_clock clock
where observation.id = 'f6000000-0000-4000-8000-000000000033';

update dashboard_private.registration_customer_solapi_activation
set verification_recipient_hash = repeat('f', 64),
    updated_by = 'f6000000-0000-4000-8000-000000000001'
where message_kind = 'observation_reminder';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'f6000000-0000-4000-8000-000000000054', observation.id,
  observation.appointment_id, 54, 'observation_scheduled',
  observation.booking_fact_hash, observation.source_revision,
  pg_catalog.clock_timestamp()
from public.ops_registration_observations observation
where observation.id = 'f6000000-0000-4000-8000-000000000033';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select is(
  dashboard_private.materialize_registration_observation_solapi_events_v1(100),
  1,
  'eligible schedule creates the revision selected for replacement'
);
reset role;
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'f6000000-0000-4000-8000-000000000055', observation.id,
  observation.appointment_id, 55, 'observation_rescheduled',
  observation.booking_fact_hash, observation.source_revision,
  pg_catalog.clock_timestamp()
from public.ops_registration_observations observation
where observation.id = 'f6000000-0000-4000-8000-000000000033';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select is(
  dashboard_private.materialize_registration_observation_solapi_events_v1(100),
  1,
  'eligible reschedule consumes its replacement event'
);
reset role;
select is(
  (select pg_catalog.jsonb_object_agg(job.source_revision,
     pg_catalog.jsonb_build_object('status', job.status, 'error', job.last_error_code))
   from dashboard_private.registration_customer_reminder_jobs job
   where job.observation_id = 'f6000000-0000-4000-8000-000000000033'
     and job.source_revision in (54, 55)),
  '{"54":{"status":"canceled","error":"observation_rescheduled"},"55":{"status":"pending","error":null}}'::jsonb,
  'reschedule cancels the prior revision and leaves only the replacement pending'
);

create or replace function pg_temp.exercise_solapi_terminal_branch_v1(p_event_kind text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_revision bigint := case p_event_kind
    when 'observation_canceled' then 80
    when 'observation_attendance_recorded' then 81
    when 'observation_no_show' then 82
    when 'observation_feedback_submitted' then 83
    else null
  end;
  v_result jsonb;
begin
  if v_revision is null then
    raise exception 'solapi_terminal_fixture_invalid' using errcode = '22023';
  end if;
  begin
    insert into dashboard_private.registration_observation_domain_events(
      event_id, observation_id, appointment_id, notification_revision,
      event_kind, booking_fact_hash, source_revision, occurred_at
    )
    select gen_random_uuid(), observation.id, observation.appointment_id,
      v_revision, 'observation_scheduled', observation.booking_fact_hash,
      observation.source_revision, pg_catalog.clock_timestamp()
    from public.ops_registration_observations observation
    where observation.id = 'f6000000-0000-4000-8000-000000000033';
    perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
    perform dashboard_private.materialize_registration_observation_solapi_events_v1(100);
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'claimed', claim_token = gen_random_uuid(),
        claim_expires_at = pg_catalog.clock_timestamp() + interval '2 minutes'
    where job.observation_id = 'f6000000-0000-4000-8000-000000000033'
      and job.source_revision = v_revision;
    insert into dashboard_private.registration_observation_domain_events(
      event_id, observation_id, appointment_id, notification_revision,
      event_kind, booking_fact_hash, source_revision, occurred_at
    )
    select gen_random_uuid(), observation.id, observation.appointment_id,
      v_revision, p_event_kind, observation.booking_fact_hash,
      observation.source_revision, pg_catalog.clock_timestamp()
    from public.ops_registration_observations observation
    where observation.id = 'f6000000-0000-4000-8000-000000000033';
    perform dashboard_private.materialize_registration_observation_solapi_events_v1(100);
    select pg_catalog.jsonb_build_object(
      'action', consumption.action,
      'status', job.status,
      'error', job.last_error_code,
      'claimToken', job.claim_token,
      'claimExpiresAt', job.claim_expires_at
    ) into v_result
    from dashboard_private.registration_observation_domain_events event
    join dashboard_private.registration_observation_solapi_event_consumptions consumption
      on consumption.event_id = event.event_id
    join dashboard_private.registration_customer_reminder_jobs job
      on job.observation_id = event.observation_id
     and job.source_revision = v_revision
    where event.event_kind = p_event_kind
      and event.notification_revision = v_revision;
    raise exception 'solapi_terminal_fixture_rollback' using errcode = 'P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;
select is(
  pg_temp.exercise_solapi_terminal_branch_v1('observation_canceled'),
  '{"action":"canceled","status":"canceled","error":"observation_terminal","claimToken":null,"claimExpiresAt":null}'::jsonb,
  'cancellation event closes a claimed reminder and clears its lease'
);
select is(
  pg_temp.exercise_solapi_terminal_branch_v1('observation_attendance_recorded'),
  '{"action":"canceled","status":"canceled","error":"observation_terminal","claimToken":null,"claimExpiresAt":null}'::jsonb,
  'attendance event closes a claimed reminder and clears its lease'
);
select is(
  pg_temp.exercise_solapi_terminal_branch_v1('observation_no_show'),
  '{"action":"canceled","status":"canceled","error":"observation_terminal","claimToken":null,"claimExpiresAt":null}'::jsonb,
  'no-show event closes a claimed reminder and clears its lease'
);
select is(
  pg_temp.exercise_solapi_terminal_branch_v1('observation_feedback_submitted'),
  '{"action":"canceled","status":"canceled","error":"observation_terminal","claimToken":null,"claimExpiresAt":null}'::jsonb,
  'feedback-submitted event closes a claimed reminder and clears its lease'
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id, student_name
) values (
  'f6000000-0000-4000-8000-000000000060', 'SOLAPI wrong-source fixture',
  'registration', 'requested', 'normal',
  'f6000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001', '다른 청강 학생'
);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
) values (
  'f6000000-0000-4000-8000-000000000061',
  'f6000000-0000-4000-8000-000000000060', '영어', 'consultation_waiting',
  'f6000000-0000-4000-8000-000000000001', 'manual', now(), false,
  'observation_requested', 1, now(), 'consultation_completed', 0
);
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
)
select
  'f6000000-0000-4000-8000-000000000062',
  'f6000000-0000-4000-8000-000000000060', 'observation_class',
  clock.starts_at, '본관', 'scheduled', 1,
  'f6000000-0000-4000-8000-000000000001'
from queue_observation_clock clock;
insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, textbook_snapshot, progress_snapshot,
  created_by, updated_by
)
select
  'f6000000-0000-4000-8000-000000000063',
  'f6000000-0000-4000-8000-000000000060',
  'f6000000-0000-4000-8000-000000000061',
  'f6000000-0000-4000-8000-000000000062',
  observation.class_id, observation.session_authority,
  observation.class_lesson_session_id, observation.legacy_session_key,
  observation.session_date, observation.starts_at, observation.ends_at,
  observation.session_schedule_state, observation.session_source_revision,
  observation.legacy_session_source_hash, observation.source_revision,
  observation.booking_fact_hash, observation.teacher_catalog_id,
  observation.teacher_profile_id, observation.classroom_catalog_id,
  observation.subject, observation.class_name_snapshot,
  observation.teacher_name_snapshot, observation.classroom_name_snapshot,
  observation.campus, observation.textbook_snapshot, observation.progress_snapshot,
  'f6000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001'
from public.ops_registration_observations observation
where observation.id = 'f6000000-0000-4000-8000-000000000033';

insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, task_id, message_kind, source_revision,
  scheduled_for, due_at, available_at, request_key, status
) values (
  'f6000000-0000-4000-8000-000000000090',
  'f6000000-0000-4000-8000-000000000012',
  'f6000000-0000-4000-8000-000000000010', 'appointment_reminder', 900,
  pg_catalog.clock_timestamp() + interval '2 days',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), gen_random_uuid(), 'pending'
);
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id, message_kind,
  source_revision, session_source_revision, booking_fact_hash,
  activation_mode_snapshot, verification_started_at, verification_recipient_hash,
  scheduled_for, due_at, available_at, request_key, status
)
select
  'f6000000-0000-4000-8000-000000000091', observation.appointment_id,
  observation.id, 'f6000000-0000-4000-8000-000000000040', observation.task_id,
  'observation_reminder', 901, observation.source_revision,
  observation.booking_fact_hash, 'verification', activation.updated_at,
  activation.verification_recipient_hash, observation.starts_at,
  observation.starts_at - interval '3 hours', pg_catalog.clock_timestamp(),
  gen_random_uuid(), 'pending'
from public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'f6000000-0000-4000-8000-000000000033'
  and activation.message_kind = 'observation_reminder';

create or replace function pg_temp.insert_solapi_scheduled_message_v1(p_case text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_job_id uuid := 'f6000000-0000-4000-8000-000000000091';
  v_appointment_id uuid := 'f6000000-0000-4000-8000-000000000032';
  v_observation_id uuid := 'f6000000-0000-4000-8000-000000000033';
  v_track_id uuid := 'f6000000-0000-4000-8000-000000000031';
  v_task_id uuid := 'f6000000-0000-4000-8000-000000000030';
  v_message_kind text := 'observation_reminder';
  v_source_revision bigint := 901;
begin
  if p_case = 'correct_legacy' then
    v_job_id := 'f6000000-0000-4000-8000-000000000090';
    v_appointment_id := 'f6000000-0000-4000-8000-000000000012';
    v_observation_id := null;
    v_track_id := null;
    v_task_id := 'f6000000-0000-4000-8000-000000000010';
    v_message_kind := 'appointment_reminder';
    v_source_revision := 900;
  elsif p_case = 'wrong_job' then
    v_job_id := gen_random_uuid();
  elsif p_case = 'wrong_appointment' then
    v_appointment_id := 'f6000000-0000-4000-8000-000000000012';
  elsif p_case = 'wrong_kind' then
    v_observation_id := null;
    v_track_id := null;
    v_message_kind := 'appointment_reminder';
  elsif p_case = 'wrong_revision' then
    v_source_revision := 902;
  elsif p_case = 'wrong_source_identity' then
    v_observation_id := 'f6000000-0000-4000-8000-000000000063';
  elsif p_case <> 'correct_observation' then
    raise exception 'solapi_scheduled_message_fixture_invalid' using errcode = '22023';
  end if;

  insert into public.ops_registration_customer_messages(
    id, preview_id, task_id, track_id, appointment_id, observation_id,
    message_kind, source_fingerprint, source_facts_checksum, source_revision,
    recipient_hash, recipient_last4, template_key, template_revision,
    template_checksum, rendered_variables_checksum, rendered_body_checksum,
    rendered_buttons_checksum, dedupe_key, request_key, status, claim_active,
    dispatch_token, provider_attempt_started_at, provider_attempt_count,
    confirmed_by, confirmed_at, delivery_origin, scheduled_job_id, scheduled_for
  ) values (
    v_id, null, v_task_id, v_track_id, v_appointment_id, v_observation_id,
    v_message_kind, repeat('1', 64), repeat('2', 64), v_source_revision,
    repeat('3', 64), '5678', v_message_kind, 1,
    repeat('4', 64), repeat('5', 64), repeat('6', 64), repeat('7', 64),
    dashboard_private.notification_sha256_hex_v1(gen_random_uuid()::text),
    gen_random_uuid()::text, 'pending', false, gen_random_uuid(),
    pg_catalog.clock_timestamp(), 1, null, pg_catalog.clock_timestamp(),
    'scheduled', v_job_id, pg_catalog.clock_timestamp() + interval '2 days'
  );
  return v_id;
end;
$$;

alter table public.ops_registration_customer_messages
  disable trigger enforce_registration_customer_solapi_delivery_gate_v1;
select lives_ok(
  $$select pg_temp.insert_solapi_scheduled_message_v1('correct_legacy')$$,
  'a correct legacy scheduled tuple commits through the composite FK'
);
select throws_ok(
  $$select pg_temp.insert_solapi_scheduled_message_v1('wrong_job')$$,
  '23503', null, 'an unrelated scheduled job id is rejected by the composite FK'
);
select throws_ok(
  $$select pg_temp.insert_solapi_scheduled_message_v1('wrong_appointment')$$,
  '23503', null, 'a valid job with the wrong appointment is rejected by the composite FK'
);
select throws_ok(
  $$select pg_temp.insert_solapi_scheduled_message_v1('wrong_kind')$$,
  '23503', null, 'a valid job with the wrong reminder kind is rejected by the composite FK'
);
select throws_ok(
  $$select pg_temp.insert_solapi_scheduled_message_v1('wrong_revision')$$,
  '23503', null, 'a valid job with the wrong source revision is rejected by the composite FK'
);
select throws_ok(
  $$select pg_temp.insert_solapi_scheduled_message_v1('wrong_source_identity')$$,
  '23503', null, 'a valid job with the wrong observation identity is rejected by the composite FK'
);
select lives_ok(
  $$select pg_temp.insert_solapi_scheduled_message_v1('correct_observation')$$,
  'a correct observation scheduled tuple commits through the composite FK'
);
alter table public.ops_registration_customer_messages
  enable trigger enforce_registration_customer_solapi_delivery_gate_v1;

select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set claim_token = gen_random_uuid(),
        claim_expires_at = pg_catalog.clock_timestamp() + interval '1 minute'
    where job_id = 'f6000000-0000-4000-8000-000000000090'$$,
  '23514', null, 'pending jobs reject stale claim fields'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set status = 'dispatching'
    where job_id = 'f6000000-0000-4000-8000-000000000090'$$,
  '23514', null, 'dispatching jobs require a message id'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set status = 'completed'
    where job_id = 'f6000000-0000-4000-8000-000000000090'$$,
  '23514', null, 'completed jobs require a message id'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set status = 'delivery_unknown', last_error_code = 'provider_dispatch_uncertain'
    where job_id = 'f6000000-0000-4000-8000-000000000090'$$,
  '23514', null, 'delivery-unknown jobs require a message id'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs job
    set status = 'canceled', last_error_code = 'test_cancel',
        message_id = message.id
    from public.ops_registration_customer_messages message
    where job.job_id = 'f6000000-0000-4000-8000-000000000090'
      and message.scheduled_job_id = job.job_id$$,
  '23514', null, 'canceled jobs reject a stale message id'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set source_event_id = null
    where job_id = 'f6000000-0000-4000-8000-000000000091'$$,
  '23514', null, 'observation jobs require the source event snapshot'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set booking_fact_hash = null
    where job_id = 'f6000000-0000-4000-8000-000000000091'$$,
  '23514', null, 'observation jobs require the booking fact hash snapshot'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set verification_started_at = null
    where job_id = 'f6000000-0000-4000-8000-000000000091'$$,
  '23514', null, 'verification jobs require the activation start snapshot'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set verification_recipient_hash = repeat('x', 64)
    where job_id = 'f6000000-0000-4000-8000-000000000091'$$,
  '23514', null, 'verification jobs require a lowercase hexadecimal recipient hash'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set source_refresh_count = -1
    where job_id = 'f6000000-0000-4000-8000-000000000091'$$,
  '23514', null, 'observation source refresh count rejects values below zero'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set source_refresh_count = 2
    where job_id = 'f6000000-0000-4000-8000-000000000091'$$,
  '23514', null, 'observation source refresh count rejects values above one'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set status = 'canceled', last_error_code = ''
    where job_id = 'f6000000-0000-4000-8000-000000000090'$$,
  '23514', null, 'canceled jobs require a nonblank terminal error'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set status = 'source_dirty', last_error_code = 'wrong_error'
    where job_id = 'f6000000-0000-4000-8000-000000000090'$$,
  '23514', null, 'source-dirty jobs reject unrelated errors'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs job
    set status = 'delivery_unknown', last_error_code = 'wrong_error',
        message_id = message.id
    from public.ops_registration_customer_messages message
    where job.job_id = 'f6000000-0000-4000-8000-000000000090'
      and message.scheduled_job_id = job.job_id$$,
  '23514', null, 'delivery-unknown jobs require the uncertain-dispatch error'
);
select throws_ok(
  $$update dashboard_private.registration_customer_reminder_jobs
    set status = 'claimed', claim_token = gen_random_uuid(),
        claim_expires_at = pg_catalog.clock_timestamp() + interval '1 minute',
        last_error_code = 'source_read_failed'
    where job_id = 'f6000000-0000-4000-8000-000000000090'$$,
  '23514', null, 'claimed jobs reject stale retry errors'
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id, student_name
) values (
  'f6000000-0000-4000-8000-000000000100', 'SOLAPI worker lifecycle fixture',
  'registration', 'requested', 'normal',
  'f6000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001', '수명주기 학생'
);
insert into public.ops_registration_details(task_id, parent_phone)
values ('f6000000-0000-4000-8000-000000000100', '010-9876-5432');
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at
) values (
  'f6000000-0000-4000-8000-000000000101',
  'f6000000-0000-4000-8000-000000000100', '영어', 'level_test_scheduled',
  'f6000000-0000-4000-8000-000000000001', 'manual', now(), false,
  'level_test_requested', 1, now()
);
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
) values
  (
    'f6000000-0000-4000-8000-000000000102',
    'f6000000-0000-4000-8000-000000000100', 'level_test',
    pg_catalog.clock_timestamp() + interval '2 hours', '본관', 'scheduled', 1,
    'f6000000-0000-4000-8000-000000000001'
  ),
  (
    'f6000000-0000-4000-8000-000000000104',
    'f6000000-0000-4000-8000-000000000100', 'level_test',
    pg_catalog.clock_timestamp() + interval '2 hours 30 minutes', '본관', 'scheduled', 1,
    'f6000000-0000-4000-8000-000000000001'
  );
insert into public.ops_registration_level_tests(
  id, track_id, appointment_id, attempt_number, status
) values (
  'f6000000-0000-4000-8000-000000000103',
  'f6000000-0000-4000-8000-000000000101',
  'f6000000-0000-4000-8000-000000000102', 1, 'scheduled'
);

alter table dashboard_private.registration_customer_reminder_settings
  disable trigger sync_registration_customer_reminder_cron_active;
update dashboard_private.registration_customer_reminder_settings
set enabled = false
where singleton;
alter table dashboard_private.registration_customer_reminder_settings
  enable trigger sync_registration_customer_reminder_cron_active;

create temporary table queue_off_heartbeat_snapshot as
select * from dashboard_private.registration_customer_reminder_worker_heartbeats;
create temporary table queue_off_job_snapshot as
select * from dashboard_private.registration_customer_reminder_jobs;
create temporary table queue_off_message_snapshot as
select * from public.ops_registration_customer_messages;
create temporary table queue_off_claim_result(payload jsonb) on commit drop;
grant insert, select on table queue_off_claim_result to service_role;

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into queue_off_claim_result(payload)
select public.claim_registration_customer_reminder_job_v1();
reset role;

select is(
  pg_catalog.jsonb_build_object(
    'claimResult', (select payload from queue_off_claim_result),
    'heartbeatDelta', (
      select pg_catalog.count(*)
      from (
        (select * from dashboard_private.registration_customer_reminder_worker_heartbeats
         except all select * from queue_off_heartbeat_snapshot)
        union all
        (select * from queue_off_heartbeat_snapshot
         except all select * from dashboard_private.registration_customer_reminder_worker_heartbeats)
      ) delta
    ),
    'jobDelta', (
      select pg_catalog.count(*)
      from (
        (select * from dashboard_private.registration_customer_reminder_jobs
         except all select * from queue_off_job_snapshot)
        union all
        (select * from queue_off_job_snapshot
         except all select * from dashboard_private.registration_customer_reminder_jobs)
      ) delta
    ),
    'messageDelta', (
      select pg_catalog.count(*)
      from (
        (select * from public.ops_registration_customer_messages
         except all select * from queue_off_message_snapshot)
        union all
        (select * from queue_off_message_snapshot
         except all select * from public.ops_registration_customer_messages)
      ) delta
    )
  ),
  '{"claimResult":null,"heartbeatDelta":0,"jobDelta":0,"messageDelta":0}'::jsonb,
  'OFF claim returns no job without heartbeat, queue, or message mutation'
);

alter table dashboard_private.registration_customer_reminder_settings
  disable trigger sync_registration_customer_reminder_cron_active;
update dashboard_private.registration_customer_reminder_settings
set enabled = true
where singleton;
alter table dashboard_private.registration_customer_reminder_settings
  enable trigger sync_registration_customer_reminder_cron_active;

create temporary table queue_worker_results(
  label text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update on table queue_worker_results to service_role;
update dashboard_private.registration_customer_reminder_jobs
set due_at = pg_catalog.clock_timestamp() - interval '1 minute',
    available_at = pg_catalog.clock_timestamp() - interval '1 minute'
where job_id = 'f6000000-0000-4000-8000-000000000091';

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into queue_worker_results(label, payload)
values ('claim-1', public.claim_registration_customer_reminder_job_v1());
reset role;
select is(
  (select pg_catalog.jsonb_agg(key order by key)
   from pg_catalog.jsonb_object_keys(
     (select payload from queue_worker_results where label = 'claim-1')
   ) key),
  '["appointmentId","claimToken","jobId","requestKey","scheduledFor","sourceRevision"]'::jsonb,
  'legacy claim returns exactly the raw six-key worker contract'
);
select ok(
  (select (payload ->> 'jobId')::uuid <> (payload ->> 'appointmentId')::uuid
   from queue_worker_results where label = 'claim-1'),
  'sync creates a UUID job identity independent of the appointment identity'
);
select is(
  (select pg_catalog.jsonb_build_object(
     'appointmentId', payload ->> 'appointmentId',
     'observationClaims', (
       select pg_catalog.count(*)
       from dashboard_private.registration_customer_reminder_jobs job
       where job.message_kind = 'observation_reminder'
         and job.status = 'claimed'
     )
   ) from queue_worker_results where label = 'claim-1'),
  '{"appointmentId":"f6000000-0000-4000-8000-000000000102","observationClaims":0}'::jsonb,
  'compatibility claim selects the due legacy appointment and excludes observation jobs'
);

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into queue_worker_results(label, payload)
select 'read-1', public.read_registration_customer_reminder_source_v1(
  (select (payload ->> 'jobId')::uuid from queue_worker_results where label = 'claim-1'),
  (select (payload ->> 'claimToken')::uuid from queue_worker_results where label = 'claim-1')
);
reset role;
select is(
  (select pg_catalog.jsonb_build_object(
     'messageKind', payload ->> 'messageKind',
     'appointmentId', payload ->> 'appointmentId',
     'phone', payload ->> 'parentPhoneDigits',
     'subjects', payload -> 'subjects'
   ) from queue_worker_results where label = 'read-1'),
  '{"messageKind":"appointment_reminder","appointmentId":"f6000000-0000-4000-8000-000000000102","phone":"01098765432","subjects":["영어"]}'::jsonb,
  'read resolves the exact claimed job source from current registration facts'
);
insert into queue_worker_results(label, payload)
select 'source-checksum', pg_catalog.jsonb_build_object(
  'value', dashboard_private.registration_customer_message_source_facts_checksum_v1(payload)
)
from queue_worker_results
where label = 'read-1';

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into queue_worker_results(label, payload)
select 'release-1', public.release_registration_customer_reminder_job_v1(
  (select (payload ->> 'jobId')::uuid from queue_worker_results where label = 'claim-1'),
  (select (payload ->> 'claimToken')::uuid from queue_worker_results where label = 'claim-1'),
  'source_read_failed'
);
reset role;
select is(
  (select job.status || ':' || job.last_error_code || ':' ||
     case when job.available_at is null then 'no_retry' else 'retry' end
   from dashboard_private.registration_customer_reminder_jobs job
   where job.job_id = (
     select (payload ->> 'jobId')::uuid
     from queue_worker_results where label = 'claim-1'
   )),
  'pending:source_read_failed:retry',
  'retryable release preserves the bounded delayed retry state'
);
update dashboard_private.registration_customer_reminder_jobs job
set available_at = pg_catalog.clock_timestamp() - interval '1 second'
where job.job_id = (
  select (payload ->> 'jobId')::uuid
  from queue_worker_results where label = 'claim-1'
);
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into queue_worker_results(label, payload)
values ('claim-2', public.claim_registration_customer_reminder_job_v1());
reset role;
select is(
  (select pg_catalog.jsonb_build_object(
     'sameJob', first.payload ->> 'jobId' = second.payload ->> 'jobId',
     'error', job.last_error_code,
     'status', job.status
   )
   from queue_worker_results first
   join queue_worker_results second on second.label = 'claim-2'
   join dashboard_private.registration_customer_reminder_jobs job
     on job.job_id = (second.payload ->> 'jobId')::uuid
   where first.label = 'claim-1'),
  '{"sameJob":true,"error":null,"status":"claimed"}'::jsonb,
  'reclaim targets the same UUID job and clears the retry error'
);

update public.ops_registration_customer_messages message
set status = 'accepted',
    provider_message_id = 'synthetic-live-message',
    provider_group_id = 'synthetic-live-group',
    provider_status_code = '202',
    provider_status_message = 'accepted',
    provider_evidence = '{"providerMessageId":"synthetic-live-message","providerGroupId":"synthetic-live-group","statusCode":"202","statusMessage":"accepted","observedAt":"2026-08-12T06:00:00Z","requestKeyMatched":true}'::jsonb,
    resolution_source = 'scheduled_provider_send',
    resolved_at = pg_catalog.clock_timestamp()
where message.scheduled_job_id = 'f6000000-0000-4000-8000-000000000090';
insert into dashboard_private.registration_customer_solapi_template_receipts(
  message_kind, template_id, pf_id, catalog_checksum,
  provider_checksum, provider_status, verified_by
) values (
  'appointment_reminder', 'queue-template', 'queue-pf', repeat('4', 64),
  repeat('4', 64), 'sendable', 'f6000000-0000-4000-8000-000000000001'
)
on conflict (message_kind) do update set
  template_id = excluded.template_id,
  pf_id = excluded.pf_id,
  catalog_checksum = excluded.catalog_checksum,
  provider_checksum = excluded.provider_checksum,
  provider_status = excluded.provider_status,
  verified_by = excluded.verified_by;
update dashboard_private.registration_customer_solapi_activation activation
set mode = 'live',
    verification_task_id = 'f6000000-0000-4000-8000-000000000010',
    verification_recipient_hash = repeat('3', 64),
    live_test_message_id = message.id,
    live_test_confirmed_at = pg_catalog.clock_timestamp(),
    updated_by = 'f6000000-0000-4000-8000-000000000001'
from public.ops_registration_customer_messages message
where activation.message_kind = 'appointment_reminder'
  and message.scheduled_job_id = 'f6000000-0000-4000-8000-000000000090';

create or replace function dashboard_private.registration_customer_reminder_schedule_ready_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select true $$;

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into queue_worker_results(label, payload)
select 'begin-1', public.begin_registration_customer_reminder_dispatch_v1(
  (select (payload ->> 'jobId')::uuid from queue_worker_results where label = 'claim-2'),
  (select (payload ->> 'claimToken')::uuid from queue_worker_results where label = 'claim-2'),
  pg_catalog.jsonb_build_object(
    'parentPhoneDigits', source.payload ->> 'parentPhoneDigits',
    'sourceFingerprint', repeat('8', 64),
    'recipientHash', repeat('3', 64),
    'templateKey', 'appointment_reminder',
    'templateRevision', 1,
    'templateChecksum', repeat('4', 64),
    'renderedVariablesChecksum', repeat('5', 64),
    'renderedBodyChecksum', repeat('6', 64),
    'renderedButtonsChecksum', repeat('7', 64)
  ),
  pg_catalog.jsonb_build_object(
    'credentialsConfigured', true,
    'pfId', 'queue-pf',
    'templateId', 'queue-template',
    'catalogChecksum', repeat('4', 64),
    'recipientHash', repeat('3', 64),
    'sourceFingerprint', repeat('8', 64),
    'sourceFactsChecksum', (
      select payload ->> 'value'
      from queue_worker_results
      where label = 'source-checksum'
    )
  )
)
from queue_worker_results source
where source.label = 'read-1';
reset role;
select is(
  (select pg_catalog.jsonb_build_object(
     'allowed', result.payload -> 'allowed',
     'status', job.status,
     'messageMatch', job.message_id = (result.payload ->> 'messageId')::uuid,
     'claimToken', job.claim_token,
     'claimExpiresAt', job.claim_expires_at
   )
   from queue_worker_results result
   join queue_worker_results claim on claim.label = 'claim-2'
   join dashboard_private.registration_customer_reminder_jobs job
     on job.job_id = (claim.payload ->> 'jobId')::uuid
   where result.label = 'begin-1'),
  '{"allowed":true,"status":"dispatching","messageMatch":true,"claimToken":null,"claimExpiresAt":null}'::jsonb,
  'begin locks one message and moves only its exact UUID job to dispatching'
);

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into queue_worker_results(label, payload)
select 'finalize-1', public.finalize_registration_customer_reminder_dispatch_v1(
  p_message_id => (payload ->> 'messageId')::uuid,
  p_dispatch_token => (payload ->> 'dispatchToken')::uuid,
  p_result => 'accepted',
  p_provider_result => '{"providerMessageId":"queue-provider-message","providerGroupId":"queue-provider-group","statusCode":"202","statusMessage":"accepted","observedAt":"2026-08-12T06:30:00Z","requestKeyMatched":true}'::jsonb
)
from queue_worker_results
where label = 'begin-1';
reset role;
select is(
  (select pg_catalog.jsonb_build_object(
     'ok', payload -> 'ok',
     'currentStatus', payload ->> 'currentStatus',
     'idempotent', payload -> 'idempotent'
   ) from queue_worker_results where label = 'finalize-1'),
  '{"ok":true,"currentStatus":"accepted","idempotent":false}'::jsonb,
  'named finalize accepts the provider result exactly once'
);
select is(
  (select pg_catalog.jsonb_build_object(
     'jobStatus', job.status,
     'jobError', job.last_error_code,
     'messageStatus', message.status,
     'providerMessageId', message.provider_message_id,
     'providerGroupId', message.provider_group_id,
     'providerCode', message.provider_status_code,
     'requestKeyMatched', message.provider_evidence -> 'requestKeyMatched'
   )
   from queue_worker_results claim
   join dashboard_private.registration_customer_reminder_jobs job
     on job.job_id = (claim.payload ->> 'jobId')::uuid
   join public.ops_registration_customer_messages message on message.id = job.message_id
   where claim.label = 'claim-2'),
  '{"jobStatus":"completed","jobError":null,"messageStatus":"accepted","providerMessageId":"queue-provider-message","providerGroupId":"queue-provider-group","providerCode":"202","requestKeyMatched":true}'::jsonb,
  'finalize persists the durable provider receipt and terminal job state'
);

update public.ops_registration_appointments
set notification_revision = 2,
    scheduled_at = scheduled_at + interval '1 day'
where id = 'f6000000-0000-4000-8000-000000000104';
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select is(
  dashboard_private.sync_registration_customer_reminder_jobs_v1(),
  1,
  'legacy sync inserts only the current rescheduled revision'
);
select is(
  (select pg_catalog.jsonb_object_agg(job.source_revision,
     pg_catalog.jsonb_build_object('status', job.status, 'error', job.last_error_code))
   from dashboard_private.registration_customer_reminder_jobs job
   where job.appointment_id = 'f6000000-0000-4000-8000-000000000104'),
  '{"1":{"status":"canceled","error":"appointment_revision_replaced"},"2":{"status":"pending","error":null}}'::jsonb,
  'reschedule cancels the older legacy revision before retaining the new one'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.registration_customer_reminder_jobs job
   join queue_worker_results claim on claim.label = 'claim-2'
   where job.job_id = (claim.payload ->> 'jobId')::uuid
     and job.status = 'completed'
     and job.message_id = (
       select (payload ->> 'messageId')::uuid
       from queue_worker_results where label = 'begin-1'
     )),
  1::bigint,
  'reschedule sync does not update the finalized job or multiple revisions'
);

alter table dashboard_private.registration_observation_domain_events
  enable trigger registration_observation_google_chat_materializer;

select ok(
  not exists(
    select 1 from information_schema.routine_privileges privilege
    where privilege.routine_name in (
      'sync_registration_customer_reminder_jobs_v1',
      'materialize_registration_observation_solapi_events_v1',
      'claim_registration_customer_reminder_job_v1',
      'read_registration_customer_reminder_source_v1',
      'release_registration_customer_reminder_job_v1',
      'begin_registration_customer_reminder_dispatch_v1',
      'finalize_registration_customer_reminder_dispatch_v1'
    ) and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
  ),
  'worker RPCs have no browser execute grant'
);

select * from finish();
rollback;
