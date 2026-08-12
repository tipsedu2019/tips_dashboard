begin;

create extension if not exists dblink;

select plan(99);

select has_function('public', 'resolve_registration_customer_message_source_v1', array['uuid','text','uuid'], 'public source resolver exists');
select has_function('public', 'inspect_registration_observation_solapi_readiness_v1', array[]::text[], 'operational readiness exists');
select has_function('public', 'claim_registration_customer_reminder_job_v1', array[]::text[], 'generalized claim exists');
select has_function('public', 'read_registration_customer_reminder_source_v1', array['uuid','uuid'], 'job-locked read exists');
select has_function('public', 'begin_registration_customer_reminder_dispatch_v1', array['uuid','uuid','jsonb','jsonb'], 'generalized begin exists');
select has_function('public', 'finalize_registration_customer_reminder_dispatch_v1', array['uuid','uuid','text','jsonb'], 'message-id finalize exists');

select ok(
  pg_catalog.to_regprocedure(
    'dashboard_private.registration_customer_message_result_v1(uuid,boolean,boolean,boolean)'
  ) is not null,
  'result capability keeps its exact signature'
);
select is(
  (
    select pg_catalog.oidvectortypes(proc.proargtypes)
    from pg_catalog.pg_proc proc
    where proc.oid = 'dashboard_private.registration_customer_message_result_v1(uuid,boolean,boolean,boolean)'::regprocedure
  ),
  'uuid, boolean, boolean, boolean',
  'result capability argument identity is exact'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'dashboard_private'
      and proc.proname = 'registration_customer_message_result_v1'
  ),
  1::bigint,
  'result capability has no overload'
);
select function_privs_are(
  'dashboard_private', 'registration_customer_message_result_v1',
  array['uuid','boolean','boolean','boolean'], 'service_role', array[]::text[],
  'result capability is not directly executable by service role'
);
select has_function(
  'dashboard_private', 'registration_customer_message_assert_stored_observation_v1',
  array['public.ops_registration_customer_messages'],
  'stored observation identity capability exists'
);
select function_privs_are(
  'dashboard_private', 'registration_customer_message_assert_stored_observation_v1',
  array['public.ops_registration_customer_messages'], 'service_role', array[]::text[],
  'stored observation identity capability is not directly executable by service role'
);
select is(
  (
    select proc.prosecdef
      and proc.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc proc
    where proc.oid = pg_catalog.to_regprocedure(
      'dashboard_private.registration_customer_message_assert_stored_observation_v1(public.ops_registration_customer_messages)'
    )
  ),
  true,
  'stored observation identity capability is a definer with an empty search path'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'dashboard_private'
      and proc.proname = 'registration_customer_message_assert_stored_observation_v1'
  ),
  1::bigint,
  'stored observation identity capability has no overload'
);
select function_privs_are(
  'public', 'resolve_registration_customer_message_source_v1',
  array['uuid','text','uuid'], 'service_role', array['EXECUTE'],
  'public resolver is service-only'
);
select function_privs_are(
  'public', 'inspect_registration_observation_solapi_readiness_v1',
  array[]::text[], 'service_role', array['EXECUTE'],
  'readiness is service-only'
);
select function_privs_are(
  'public', 'resolve_registration_customer_message_source_v1',
  array['uuid','text','uuid'], 'anon', array[]::text[],
  'anon cannot execute the source resolver'
);

select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1(
    gen_random_uuid(), 'observation_booking', gen_random_uuid()
  )$$,
  '42501', 'registration_customer_message_access_denied',
  'role fence precedes protected source reads'
);
select throws_ok(
  $$select public.claim_registration_customer_reminder_job_v1()$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'wrong role cannot claim'
);
select throws_ok(
  $$select public.inspect_registration_observation_solapi_readiness_v1()$$,
  '42501', 'registration_observation_solapi_readiness_unauthorized',
  'wrong role cannot inspect readiness'
);
select throws_ok(
  $$select public.set_registration_customer_solapi_activation_v1(
      gen_random_uuid(), 'observation_reminder', 'off', '{}'::jsonb
    )$$,
  '42501', 'registration_customer_message_access_denied',
  'wrong role cannot mutate observation activation'
);

-- Authoritative blocked-order proof for the same singleton FOR SHARE design
-- used as begin's final pre-marker authorization. A committed 1 -> 0 updater
-- must remain blocked until the marker-owning transaction commits; therefore no
-- marker can be ordered after a committed rollback.
select dblink_connect(
  'solapi_gate_marker',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=solapi_gate_marker'
);
select dblink_connect(
  'solapi_gate_rollback',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=solapi_gate_rollback'
);
select dblink_exec('solapi_gate_marker', $remote$
  create table if not exists dashboard_private.registration_observation_solapi_gate_race_receipts(
    id boolean primary key,
    runtime_version integer not null,
    marker_at timestamptz not null
  );
  truncate dashboard_private.registration_observation_solapi_gate_race_receipts;
  update dashboard_private.registration_observation_runtime_settings
  set activation_version = 1, updated_at = pg_catalog.clock_timestamp()
  where singleton;
$remote$);
select dblink_exec('solapi_gate_marker', 'begin');
select is(
  (
    select activation_version
    from dblink('solapi_gate_marker', $remote$
      select runtime.activation_version
      from dashboard_private.registration_observation_runtime_settings runtime
      where runtime.singleton and runtime.activation_version = 1
      for share
    $remote$) result(activation_version integer)
  ),
  1,
  'Gate B-R marker transaction locks the authoritative runtime-one row'
);
select dblink_exec('solapi_gate_marker', $remote$
  insert into dashboard_private.registration_observation_solapi_gate_race_receipts(
    id, runtime_version, marker_at
  )
  select true, runtime.activation_version, pg_catalog.clock_timestamp()
  from dashboard_private.registration_observation_runtime_settings runtime
  where runtime.singleton;
$remote$);
select dblink_send_query('solapi_gate_rollback', $remote$
  update dashboard_private.registration_observation_runtime_settings
  set activation_version = 0, updated_at = pg_catalog.clock_timestamp()
  where singleton
  returning activation_version
$remote$);
select pg_catalog.pg_sleep(0.1);
select is(
  dblink_is_busy('solapi_gate_rollback'),
  1,
  'runtime 1-to-0 rollback remains blocked behind the marker authorization lock'
);
select dblink_exec('solapi_gate_marker', 'commit');
select activation_version
from dblink_get_result('solapi_gate_rollback') result(activation_version integer);
select is(
  (
    select ordered
    from dblink('solapi_gate_marker', $remote$
      select receipt.runtime_version = 1
        and receipt.marker_at <= runtime.updated_at
      from dashboard_private.registration_observation_solapi_gate_race_receipts receipt
      cross join dashboard_private.registration_observation_runtime_settings runtime
      where receipt.id and runtime.singleton
    $remote$) result(ordered boolean)
  ),
  true,
  'the marker precedes the committed runtime rollback and none can follow it'
);
select dblink_exec('solapi_gate_marker', $remote$
  drop table dashboard_private.registration_observation_solapi_gate_race_receipts;
$remote$);
select dblink_disconnect('solapi_gate_marker');
select dblink_disconnect('solapi_gate_rollback');

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
create temporary table dispatch_readiness_fixture as
select public.inspect_registration_observation_solapi_readiness_v1() as value;

select is(
  (select count(*) from pg_catalog.jsonb_object_keys((select value -> 'schedule' from dispatch_readiness_fixture))),
  6::bigint,
  'schedule readiness has exactly six keys'
);
select is((select value ->> 'runtimeReady' from dispatch_readiness_fixture), 'false', 'runtime stays OFF after install');
select is((select (value ->> 'providerAttemptMarkers')::bigint from dispatch_readiness_fixture), 0::bigint, 'provider marker count starts at zero');
select is((select (value ->> 'observationMessages')::bigint from dispatch_readiness_fixture), 0::bigint, 'observation messages start at zero');
select is((select (value ->> 'pending')::bigint from dispatch_readiness_fixture), 0::bigint, 'pending observation jobs start at zero');
select is((select (value ->> 'sourceDirty')::bigint from dispatch_readiness_fixture), 0::bigint, 'source-dirty jobs start at zero');
select is((select (value ->> 'deliveryUnknown')::bigint from dispatch_readiness_fixture), 0::bigint, 'delivery-unknown jobs start at zero');
select is((select value -> 'schedule' ->> 'heartbeatCurrent' from dispatch_readiness_fixture), 'false', 'missing heartbeat is not current');
select ok((select value -> 'schedule' -> 'lastSucceededAt' from dispatch_readiness_fixture) = 'null'::jsonb, 'missing heartbeat timestamp is null');

select is_empty(
  $$
    select namespace.nspname || '.' || proc.proname
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'dashboard_private'
      and proc.proname in (
        'registration_customer_message_source_task_v1',
        'resolve_registration_customer_message_source_v1_impl',
        'registration_customer_message_assert_current_v1',
        'registration_customer_message_result_v1'
      )
      and (
        not proc.prosecdef
        or not proc.proconfig @> array['search_path=""']
      )
  $$,
  'all four private source capabilities are definers with empty search paths'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'dashboard_private'
      and proc.proname in (
        'registration_customer_message_source_task_v1',
        'resolve_registration_customer_message_source_v1_impl',
        'registration_customer_message_assert_current_v1',
        'registration_customer_message_result_v1'
      )
  ),
  4::bigint,
  'private source capabilities have exactly one overload each'
);
select is_empty(
  $$
    select privilege.grantee || ':' || privilege.routine_name
    from information_schema.routine_privileges privilege
    where privilege.routine_schema = 'dashboard_private'
      and privilege.routine_name in (
        'registration_customer_message_source_task_v1',
        'resolve_registration_customer_message_source_v1_impl',
        'registration_customer_message_assert_current_v1',
        'registration_customer_message_result_v1'
      )
      and privilege.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  $$,
  'private source capabilities have no direct application-role execute grant'
);
select is_empty(
  $$
    select namespace.nspname || '.' || proc.proname
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in (
        'resolve_registration_customer_message_source_v1',
        'create_registration_customer_message_preview_v1',
        'claim_registration_customer_message_v1',
        'get_registration_customer_solapi_readiness_v1',
        'release_registration_customer_message_pre_send_claim_v1',
        'release_registration_customer_message_pre_send_claim_admin_v1',
        'mark_registration_customer_message_attempt_started_v1',
        'finalize_registration_customer_message_v1',
        'read_registration_customer_message_preview_target_v1',
        'list_registration_customer_messages_v1',
        'record_registration_customer_message_provider_check_v1',
        'reconcile_registration_customer_message_v1',
        'claim_registration_customer_reminder_job_v1',
        'read_registration_customer_reminder_source_v1',
        'release_registration_customer_reminder_job_v1',
        'begin_registration_customer_reminder_dispatch_v1',
        'finalize_registration_customer_reminder_dispatch_v1',
        'set_registration_customer_solapi_activation_v1',
        'get_registration_customer_reminder_settings_v1',
        'set_registration_customer_reminder_settings_v1',
        'inspect_registration_observation_solapi_readiness_v1'
      )
      and (
        not proc.prosecdef
        or not proc.proconfig @> array['search_path=""']
      )
  $$,
  'all replaced public capabilities are definers with empty search paths'
);
select is_empty(
  $$
    select privilege.grantee || ':' || privilege.routine_name
    from information_schema.routine_privileges privilege
    where privilege.routine_schema = 'public'
      and privilege.routine_name in (
        'resolve_registration_customer_message_source_v1',
        'create_registration_customer_message_preview_v1',
        'claim_registration_customer_message_v1',
        'get_registration_customer_solapi_readiness_v1',
        'release_registration_customer_message_pre_send_claim_v1',
        'release_registration_customer_message_pre_send_claim_admin_v1',
        'mark_registration_customer_message_attempt_started_v1',
        'finalize_registration_customer_message_v1',
        'read_registration_customer_message_preview_target_v1',
        'list_registration_customer_messages_v1',
        'record_registration_customer_message_provider_check_v1',
        'reconcile_registration_customer_message_v1',
        'claim_registration_customer_reminder_job_v1',
        'read_registration_customer_reminder_source_v1',
        'release_registration_customer_reminder_job_v1',
        'begin_registration_customer_reminder_dispatch_v1',
        'finalize_registration_customer_reminder_dispatch_v1',
        'set_registration_customer_solapi_activation_v1',
        'get_registration_customer_reminder_settings_v1',
        'set_registration_customer_reminder_settings_v1',
        'inspect_registration_observation_solapi_readiness_v1'
      )
      and privilege.grantee in ('PUBLIC', 'anon', 'authenticated')
  $$,
  'public capabilities expose no execute grant to PUBLIC, anon, or authenticated'
);

insert into dashboard_private.registration_customer_reminder_worker_heartbeats(
  singleton, succeeded_at, updated_at
) values (
  true,
  pg_catalog.clock_timestamp() - interval '5 minutes 1 second',
  pg_catalog.clock_timestamp()
)
on conflict (singleton) do update
set succeeded_at = excluded.succeeded_at,
    updated_at = excluded.updated_at;
select is(
  public.inspect_registration_observation_solapi_readiness_v1()
    -> 'schedule' ->> 'heartbeatCurrent',
  'false',
  'heartbeat older than five minutes is stale'
);
create temporary table dispatch_heartbeat_boundary_clock as
select pg_catalog.clock_timestamp() as observed_at;
update dashboard_private.registration_customer_reminder_worker_heartbeats heartbeat
set succeeded_at = boundary.observed_at - interval '5 minutes',
    updated_at = boundary.observed_at
from dispatch_heartbeat_boundary_clock boundary
where heartbeat.singleton;
select is(
  (
    select heartbeat.succeeded_at >= boundary.observed_at - interval '5 minutes'
    from dashboard_private.registration_customer_reminder_worker_heartbeats heartbeat
    cross join dispatch_heartbeat_boundary_clock boundary
    where heartbeat.singleton
  ),
  true,
  'heartbeat at the exact inclusive five-minute boundary remains current'
);
update dashboard_private.registration_customer_reminder_worker_heartbeats
set succeeded_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
where singleton;
select is(
  public.inspect_registration_observation_solapi_readiness_v1()
    -> 'schedule' ->> 'heartbeatCurrent',
  'true',
  'fresh heartbeat is current'
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1;
select is(
  public.inspect_registration_observation_solapi_readiness_v1() ->> 'runtimeReady',
  'true',
  'service-role readiness re-reads runtime one through the public runtime contract'
);
update dashboard_private.registration_observation_runtime_settings
set activation_version = 0;
select is(
  public.inspect_registration_observation_solapi_readiness_v1() ->> 'runtimeReady',
  'false',
  'service-role readiness re-reads a runtime rollback without a cached probe'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'd6200000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'solapi-dispatch@example.invalid',
  crypt('solapi-dispatch-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);
insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  'd6200000-0000-4000-8000-000000000001', 'admin',
  'SOLAPI dispatch fixture', 'solapi-dispatch@example.invalid', now(), now()
)
on conflict (id) do update set
  role = excluded.role,
  name = excluded.name,
  email = excluded.email,
  updated_at = excluded.updated_at;
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'd6200000-0000-4000-8000-000000000027',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'solapi-dispatch-staff@example.invalid',
  crypt('solapi-dispatch-staff-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);
insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  'd6200000-0000-4000-8000-000000000027', 'staff',
  'SOLAPI dispatch non-admin', 'solapi-dispatch-staff@example.invalid', now(), now()
)
on conflict (id) do update set
  role = excluded.role,
  name = excluded.name,
  email = excluded.email,
  updated_at = excluded.updated_at;
delete from public.teacher_catalogs
where profile_id = 'd6200000-0000-4000-8000-000000000001';
insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role
) values (
  'd6200000-0000-4000-8000-000000000002', '홍길동',
  array['영어']::text[], true, 9950,
  'd6200000-0000-4000-8000-000000000001',
  'solapi-dispatch@example.invalid', 'teacher'
);
update public.profiles
set teacher_catalog_id = 'd6200000-0000-4000-8000-000000000002'
where id = 'd6200000-0000-4000-8000-000000000001';
insert into public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)
values (
  'd6200000-0000-4000-8000-000000000003', '본관 301호',
  array['영어']::text[], true, 9950, '본관'
);
insert into public.classes(id, name, subject, status, schedule_storage_mode, schedule_plan)
values (
  'd6200000-0000-4000-8000-000000000004', '중2 영어 A반',
  '영어', '수업 진행 중', 'normalized', '{}'::jsonb
);
do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    'd6200000-0000-4000-8000-000000000004',
    'd6200000-0000-4000-8000-000000000099',
    'registration_observation_solapi_dispatch_test'
  );
end;
$$;
create temporary table dispatch_observation_clock as
select
  (current_date + 1) as session_date,
  '18:00'::time as start_time,
  '20:00'::time as end_time,
  ((current_date + 1) + '18:00'::time) at time zone 'Asia/Seoul' as starts_at,
  ((current_date + 1) + '20:00'::time) at time zone 'Asia/Seoul' as ends_at;
insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state, start_time, end_time,
  teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id,
  classroom_name_snapshot, origin, revision
)
select
  'd6200000-0000-4000-8000-000000000005',
  'd6200000-0000-4000-8000-000000000004',
  pg_catalog.to_char(clock.session_date, 'YYYY-MM-DD') || ':solapi-dispatch',
  clock.session_date, 'active', clock.start_time, clock.end_time,
  'd6200000-0000-4000-8000-000000000002', '홍길동',
  'd6200000-0000-4000-8000-000000000003', '본관 301호', 'manual', 1
from dispatch_observation_clock clock;
insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id, student_name
) values (
  'd6200000-0000-4000-8000-000000000010', 'SOLAPI observation dispatch fixture',
  'registration', 'requested', 'normal',
  'd6200000-0000-4000-8000-000000000001',
  'd6200000-0000-4000-8000-000000000001', 'SOLAPI 테스트'
);
insert into public.ops_registration_details(task_id, parent_phone)
values ('d6200000-0000-4000-8000-000000000010', '010-0000-0000');
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
) values (
  'd6200000-0000-4000-8000-000000000011',
  'd6200000-0000-4000-8000-000000000010', '영어', 'consultation_waiting',
  'd6200000-0000-4000-8000-000000000001', 'manual', now(), false,
  'observation_requested', 1, now(), 'consultation_completed', 0
);
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
)
select
  'd6200000-0000-4000-8000-000000000012',
  'd6200000-0000-4000-8000-000000000010', 'observation_class',
  clock.starts_at, '본관', 'scheduled', 4,
  'd6200000-0000-4000-8000-000000000001'
from dispatch_observation_clock clock;
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
  'd6200000-0000-4000-8000-000000000013',
  'd6200000-0000-4000-8000-000000000010',
  'd6200000-0000-4000-8000-000000000011',
  'd6200000-0000-4000-8000-000000000012',
  'd6200000-0000-4000-8000-000000000004',
  'normalized', 'd6200000-0000-4000-8000-000000000005', null,
  clock.session_date, clock.starts_at, clock.ends_at, 'active', 1, null,
  '{"authority":"normalized","sessionId":"d6200000-0000-4000-8000-000000000005","revision":1}'::jsonb,
  dashboard_private.registration_observation_booking_fact_hash_v1(
    pg_catalog.jsonb_build_object(
      'classId', 'd6200000-0000-4000-8000-000000000004'::uuid,
      'subject', '영어', 'sessionAuthority', 'normalized',
      'classLessonSessionId', 'd6200000-0000-4000-8000-000000000005'::uuid,
      'legacySessionKey', null,
      'sessionKey', pg_catalog.to_char(clock.session_date, 'YYYY-MM-DD') || ':solapi-dispatch',
      'scheduleState', 'active', 'sessionDate', clock.session_date,
      'startsAt', clock.starts_at, 'endsAt', clock.ends_at,
      'teacherCatalogId', 'd6200000-0000-4000-8000-000000000002'::uuid,
      'teacherProfileId', 'd6200000-0000-4000-8000-000000000001'::uuid,
      'teacherName', '홍길동',
      'classroomCatalogId', 'd6200000-0000-4000-8000-000000000003'::uuid,
      'classroomName', '본관 301호', 'campus', '본관'
    )
  ),
  'd6200000-0000-4000-8000-000000000002',
  'd6200000-0000-4000-8000-000000000001',
  'd6200000-0000-4000-8000-000000000003',
  '영어', '중2 영어 A반', '홍길동', '본관 301호',
  '본관', '[]'::jsonb, '',
  'd6200000-0000-4000-8000-000000000001',
  'd6200000-0000-4000-8000-000000000001'
from dispatch_observation_clock clock;

update dashboard_private.registration_customer_solapi_activation
set mode = 'verification',
    verification_task_id = 'd6200000-0000-4000-8000-000000000010',
    verification_recipient_hash = repeat('b', 64),
    updated_by = 'd6200000-0000-4000-8000-000000000001'
where message_kind in ('observation_booking', 'observation_reminder');
set local role service_role;
select throws_ok(
  $$select public.set_registration_customer_solapi_activation_v1(
      'd6200000-0000-4000-8000-000000000027',
      'observation_reminder', 'off',
      pg_catalog.jsonb_build_object(
        'requestKey', 'd6200000-0000-4000-8000-000000000027'
      )
    )$$,
  '42501', 'registration_customer_message_admin_required',
  'service-role non-admin cannot mutate observation activation'
);
reset role;
insert into dashboard_private.registration_customer_solapi_template_receipts(
  message_kind, template_id, pf_id, catalog_checksum,
  provider_checksum, provider_status, verified_by
) values
  (
    'observation_booking', 'dispatch-booking-template', 'dispatch-pf', repeat('c', 64),
    repeat('c', 64), 'sendable', 'd6200000-0000-4000-8000-000000000001'
  ),
  (
    'observation_reminder', 'dispatch-reminder-template', 'dispatch-pf', repeat('c', 64),
    repeat('c', 64), 'sendable', 'd6200000-0000-4000-8000-000000000001'
  );
alter table dashboard_private.registration_observation_domain_events
  disable trigger registration_observation_google_chat_materializer;
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'd6200000-0000-4000-8000-000000000014', observation.id,
  observation.appointment_id, 4, 'observation_scheduled',
  observation.booking_fact_hash, observation.source_revision,
  activation.updated_at + interval '1 second'
from public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'd6200000-0000-4000-8000-000000000013'
  and activation.message_kind = 'observation_reminder';

create function pg_temp.dispatch_contract(
  p_source jsonb,
  p_message_kind text,
  p_source_fingerprint text default repeat('a', 64)
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'parentPhoneDigits', p_source ->> 'parentPhoneDigits',
    'sourceFingerprint', p_source_fingerprint,
    'recipientHash', repeat('b', 64),
    'templateKey', p_message_kind,
    'templateRevision', 1,
    'templateChecksum', repeat('c', 64),
    'renderedVariablesChecksum', repeat('d', 64),
    'renderedBodyChecksum', repeat('e', 64),
    'renderedButtonsChecksum', repeat('f', 64)
  );
$$;
create function pg_temp.dispatch_readiness_contract(
  p_source jsonb,
  p_template_id text,
  p_source_fingerprint text default repeat('a', 64)
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'credentialsConfigured', true,
    'pfId', 'dispatch-pf',
    'templateId', p_template_id,
    'catalogChecksum', repeat('c', 64),
    'recipientHash', repeat('b', 64),
    'sourceFingerprint', p_source_fingerprint,
    'sourceFactsChecksum',
      dashboard_private.registration_customer_message_source_facts_checksum_v1(p_source)
  );
$$;
create function pg_temp.capture_automatic_begin(
  p_job_id uuid,
  p_claim_token uuid,
  p_contract jsonb,
  p_readiness_contract jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.begin_registration_customer_reminder_dispatch_v1(
    p_job_id, p_claim_token, p_contract, p_readiness_contract
  );
exception when others then
  return pg_catalog.jsonb_build_object(
    'caughtSqlstate', sqlstate,
    'caughtError', sqlerrm
  );
end;
$$;
create function pg_temp.capture_automatic_claim()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.claim_registration_customer_reminder_job_v1();
exception when others then
  return pg_catalog.jsonb_build_object(
    'caughtSqlstate', sqlstate,
    'caughtError', sqlerrm
  );
end;
$$;
create function pg_temp.capture_manual_finalize(
  p_message_id uuid,
  p_dispatch_token uuid,
  p_result text,
  p_provider_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.finalize_registration_customer_message_v1(
    p_message_id, p_dispatch_token, p_result, p_provider_result
  );
exception when others then
  return pg_catalog.jsonb_build_object(
    'caughtSqlstate', sqlstate,
    'caughtError', sqlerrm
  );
end;
$$;
create function pg_temp.capture_manual_release(
  p_message_id uuid,
  p_claim_token uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.release_registration_customer_message_pre_send_claim_v1(
    p_message_id, p_claim_token, p_error_code
  );
exception when others then
  return pg_catalog.jsonb_build_object(
    'caughtSqlstate', sqlstate,
    'caughtError', sqlerrm
  );
end;
$$;
create function pg_temp.capture_manual_provider_check(
  p_actor_profile_id uuid,
  p_message_id uuid,
  p_resolution text,
  p_provider_evidence jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.record_registration_customer_message_provider_check_v1(
    p_actor_profile_id, p_message_id, p_resolution,
    p_provider_evidence, p_request_key
  );
exception when others then
  return pg_catalog.jsonb_build_object(
    'caughtSqlstate', sqlstate,
    'caughtError', sqlerrm
  );
end;
$$;
create function pg_temp.capture_manual_reconcile(
  p_actor_profile_id uuid,
  p_message_id uuid,
  p_resolution text,
  p_provider_evidence jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.reconcile_registration_customer_message_v1(
    p_actor_profile_id, p_message_id, p_resolution,
    p_provider_evidence, p_reason, p_request_key
  );
exception when others then
  return pg_catalog.jsonb_build_object(
    'caughtSqlstate', sqlstate,
    'caughtError', sqlerrm
  );
end;
$$;
create function pg_temp.assert_stored_observation(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
begin
  select message.*
  into strict v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;
  perform dashboard_private.registration_customer_message_assert_stored_observation_v1(
    v_message
  );
end;
$$;
grant execute on function pg_temp.dispatch_contract(jsonb, text, text) to service_role;
grant execute on function pg_temp.dispatch_readiness_contract(jsonb, text, text) to service_role;
grant execute on function pg_temp.capture_automatic_begin(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function pg_temp.capture_automatic_claim() to service_role;
grant execute on function pg_temp.capture_manual_finalize(uuid, uuid, text, jsonb) to service_role;
grant execute on function pg_temp.capture_manual_release(uuid, uuid, text) to service_role;
grant execute on function pg_temp.capture_manual_provider_check(uuid, uuid, text, jsonb, text) to service_role;
grant execute on function pg_temp.capture_manual_reconcile(uuid, uuid, text, jsonb, text, text) to service_role;
grant execute on function pg_temp.assert_stored_observation(uuid) to service_role;
create temporary table dispatch_rpc_results(
  label text primary key,
  response jsonb not null
) on commit drop;
grant select, insert, update on table dispatch_rpc_results to service_role;

set local role service_role;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"d6200000-0000-4000-8000-000000000001"}',
  true
);
insert into dispatch_rpc_results(label, response) values
  (
    'booking source',
    public.resolve_registration_customer_message_source_v1(
      'd6200000-0000-4000-8000-000000000001',
      'observation_booking',
      'd6200000-0000-4000-8000-000000000013'
    )
  ),
  (
    'reminder source',
    public.resolve_registration_customer_message_source_v1(
      'd6200000-0000-4000-8000-000000000001',
      'observation_reminder',
      'd6200000-0000-4000-8000-000000000013'
    )
  );
reset role;

select is(
  (
    select pg_catalog.jsonb_agg(key order by key)
    from pg_catalog.jsonb_object_keys(
      (select response from dispatch_rpc_results where label = 'booking source')
    ) key
  ),
  '["appointmentId","bookingFactHash","campus","className","messageKind","observationId","parentPhoneDigits","place","scheduledAt","sessionSourceRevision","sourceId","sourceRevision","studentName","subject","taskId","teacherName","trackId"]'::jsonb,
  'observation source has exactly the canonical seventeen keys'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'messageKind', response ->> 'messageKind',
      'sourceId', response ->> 'sourceId',
      'observationId', response ->> 'observationId',
      'place', response ->> 'place',
      'campus', response ->> 'campus',
      'teacherName', response ->> 'teacherName',
      'phone', response ->> 'parentPhoneDigits'
    )
    from dispatch_rpc_results where label = 'booking source'
  ),
  '{"campus":"본관","messageKind":"observation_booking","observationId":"d6200000-0000-4000-8000-000000000013","phone":"01000000000","place":"본관 301호","sourceId":"d6200000-0000-4000-8000-000000000013","teacherName":"홍길동"}'::jsonb,
  'source keeps observation identity and separates classroom label from campus'
);
select is(
  (select response - 'messageKind' from dispatch_rpc_results where label = 'booking source'),
  (select response - 'messageKind' from dispatch_rpc_results where label = 'reminder source'),
  'booking and reminder resolve the same canonical observation facts'
);

set local role service_role;
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1(
      gen_random_uuid(), 'observation_booking',
      'd6200000-0000-4000-8000-000000000013'
    )$$,
  '42501', 'registration_customer_message_access_denied',
  'service-role caller still needs an authorized dashboard actor'
);
insert into dispatch_rpc_results(label, response)
select 'booking preview', public.create_registration_customer_message_preview_v1(
  'd6200000-0000-4000-8000-000000000001',
  'observation_booking',
  'd6200000-0000-4000-8000-000000000013',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source'),
    'observation_booking'
  )
);
insert into dispatch_rpc_results(label, response)
select 'reminder preview', public.create_registration_customer_message_preview_v1(
  'd6200000-0000-4000-8000-000000000001',
  'observation_reminder',
  'd6200000-0000-4000-8000-000000000013',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'reminder source'),
    'observation_reminder', repeat('9', 64)
  )
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'observationId', preview.observation_id,
      'appointmentId', preview.appointment_id,
      'trackId', preview.track_id
    )
    from public.ops_registration_customer_message_previews preview
    where preview.id = (
      select (response ->> 'previewId')::uuid
      from dispatch_rpc_results where label = 'booking preview'
    )
  ),
  '{"appointmentId":"d6200000-0000-4000-8000-000000000012","observationId":"d6200000-0000-4000-8000-000000000013","trackId":"d6200000-0000-4000-8000-000000000011"}'::jsonb,
  'preview persists observation, appointment, and track identity together'
);

set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking target', public.read_registration_customer_message_preview_target_v1(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'previewId')::uuid from dispatch_rpc_results where label = 'booking preview')
);
insert into dispatch_rpc_results(label, response)
select 'booking readiness off', public.get_registration_customer_solapi_readiness_v1(
  'd6200000-0000-4000-8000-000000000001',
  'observation_booking',
  'd6200000-0000-4000-8000-000000000013',
  pg_temp.dispatch_readiness_contract(
    (select response from dispatch_rpc_results where label = 'booking source'),
    'dispatch-booking-template'
  )
);
reset role;
select is(
  (select response ->> 'sourceId' from dispatch_rpc_results where label = 'booking target'),
  'd6200000-0000-4000-8000-000000000013',
  'preview target retains observation source identity'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'runtimeReady', response -> 'runtimeReady',
      'sendAllowed', response -> 'sendAllowed',
      'runtimeBlocker', response -> 'blockers' ? 'runtime_not_ready'
    )
    from dispatch_rpc_results where label = 'booking readiness off'
  ),
  '{"runtimeBlocker":true,"runtimeReady":false,"sendAllowed":false}'::jsonb,
  'manual observation readiness returns the supported runtime_not_ready blocker'
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1;
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking claim', public.claim_registration_customer_message_v1(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'previewId')::uuid from dispatch_rpc_results where label = 'booking preview'),
  'd6200000-0000-4000-8000-000000000020',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source'),
    'observation_booking'
  )
);
insert into dispatch_rpc_results(label, response)
select 'booking claim replay', public.claim_registration_customer_message_v1(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'previewId')::uuid from dispatch_rpc_results where label = 'booking preview'),
  'd6200000-0000-4000-8000-000000000020',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source'),
    'observation_booking'
  )
);
select throws_ok(
  $$select public.claim_registration_customer_message_v1(
      'd6200000-0000-4000-8000-000000000001',
      (select (response ->> 'previewId')::uuid from dispatch_rpc_results where label = 'reminder preview'),
      'd6200000-0000-4000-8000-000000000021',
      pg_temp.dispatch_contract(
        (select response from dispatch_rpc_results where label = 'reminder source'),
        'observation_reminder', repeat('9', 64)
      )
    )$$,
  '22023', 'registration_customer_message_delivery_origin_invalid',
  'manual observation reminder preview stays view-only'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'sameMessage', first.response ->> 'messageId' = replay.response ->> 'messageId',
      'sourceId', first.response ->> 'sourceId',
      'observationId', first.response ->> 'observationId',
      'replay', replay.response -> 'idempotent',
      'markers', message.provider_attempt_count
    )
    from dispatch_rpc_results first
    join dispatch_rpc_results replay on replay.label = 'booking claim replay'
    join public.ops_registration_customer_messages message
      on message.id = (first.response ->> 'messageId')::uuid
    where first.label = 'booking claim'
  ),
  '{"markers":0,"observationId":"d6200000-0000-4000-8000-000000000013","replay":true,"sameMessage":true,"sourceId":"d6200000-0000-4000-8000-000000000013"}'::jsonb,
  'manual claim replay keeps one observation-keyed row and no provider marker'
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 0;
set local role service_role;
select throws_ok(
  $$select public.mark_registration_customer_message_attempt_started_v1(
      (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim'),
      (select (response ->> 'claimToken')::uuid from dispatch_rpc_results where label = 'booking claim'),
      (select (response ->> 'dispatchToken')::uuid from dispatch_rpc_results where label = 'booking claim'),
      pg_temp.dispatch_contract(
        (select response from dispatch_rpc_results where label = 'booking source'),
        'observation_booking'
      )
    )$$,
  '55000', 'registration_observation_runtime_inactive',
  'manual Gate B-R rejects runtime rollback before marker mutation'
);
insert into dispatch_rpc_results(label, response)
select 'booking release', public.release_registration_customer_message_pre_send_claim_v1(
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim'),
  (select (response ->> 'claimToken')::uuid from dispatch_rpc_results where label = 'booking claim'),
  'runtime_not_ready'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'markerCount', message.provider_attempt_count,
      'claimActive', message.claim_active,
      'releaseReason', message.claim_release_reason
    )
    from public.ops_registration_customer_messages message
    where message.id = (
      select (response ->> 'messageId')::uuid
      from dispatch_rpc_results where label = 'booking claim'
    )
  ),
  '{"claimActive":false,"markerCount":0,"releaseReason":"pre_send:runtime_not_ready"}'::jsonb,
  'runtime rollback release leaves marker zero and clears the pre-send claim'
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1;
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking reacquired', public.claim_registration_customer_message_v1(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'previewId')::uuid from dispatch_rpc_results where label = 'booking preview'),
  'd6200000-0000-4000-8000-000000000020',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source'),
    'observation_booking'
  )
);
insert into dispatch_rpc_results(label, response)
select 'booking marker', public.mark_registration_customer_message_attempt_started_v1(
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking reacquired'),
  (select (response ->> 'claimToken')::uuid from dispatch_rpc_results where label = 'booking reacquired'),
  (select (response ->> 'dispatchToken')::uuid from dispatch_rpc_results where label = 'booking reacquired'),
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source'),
    'observation_booking'
  )
);
reset role;
update public.ops_registration_appointments
set notification_revision = 5
where id = 'd6200000-0000-4000-8000-000000000012';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'd6200000-0000-4000-8000-000000000120', observation.id,
  observation.appointment_id, 5, 'observation_rescheduled',
  observation.booking_fact_hash, observation.source_revision,
  (
    select coalesce(max(event.occurred_at), pg_catalog.clock_timestamp()) + interval '1 second'
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = observation.id
  )
from public.ops_registration_observations observation
where observation.id = 'd6200000-0000-4000-8000-000000000013';
update public.ops_registration_observations
set status = 'canceled'
where id = 'd6200000-0000-4000-8000-000000000013';
update public.ops_registration_appointments
set status = 'canceled'
where id = 'd6200000-0000-4000-8000-000000000012';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'd6200000-0000-4000-8000-000000000119', observation.id,
  observation.appointment_id, 5, 'observation_canceled',
  observation.booking_fact_hash, observation.source_revision,
  (
    select coalesce(max(event.occurred_at), pg_catalog.clock_timestamp()) + interval '1 second'
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = observation.id
  )
from public.ops_registration_observations observation
where observation.id = 'd6200000-0000-4000-8000-000000000013';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking finalized', pg_temp.capture_manual_finalize(
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking reacquired'),
  (select (response ->> 'dispatchToken')::uuid from dispatch_rpc_results where label = 'booking reacquired'),
  'accepted',
  pg_catalog.jsonb_build_object(
    'providerMessageId', 'synthetic-dispatch-booking',
    'providerGroupId', 'synthetic-dispatch-group',
    'statusCode', '202',
    'statusMessage', 'accepted',
    'observedAt', '2026-08-12T06:00:00Z',
    'requestKeyMatched', true
  )
);
insert into dispatch_rpc_results(label, response)
select 'booking history', pg_catalog.jsonb_build_object(
  'items', public.list_registration_customer_messages_v1(
    'd6200000-0000-4000-8000-000000000001',
    'observation_booking',
    'd6200000-0000-4000-8000-000000000013',
    10
  )
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'markerAllowed', marker.response -> 'allowed',
      'finalStatus', finalized.response ->> 'currentStatus',
      'sourceId', history.response -> 'items' -> 0 ->> 'sourceId',
      'observationId', history.response -> 'items' -> 0 ->> 'observationId',
      'providerMessageId', message.provider_evidence ->> 'providerMessageId',
      'resolutionSource', message.resolution_source
    )
    from dispatch_rpc_results marker
    join dispatch_rpc_results finalized on finalized.label = 'booking finalized'
    join dispatch_rpc_results history on history.label = 'booking history'
    join public.ops_registration_customer_messages message
      on message.id = (finalized.response ->> 'messageId')::uuid
    where marker.label = 'booking marker'
  ),
  '{"finalStatus":"accepted","markerAllowed":true,"observationId":"d6200000-0000-4000-8000-000000000013","providerMessageId":"synthetic-dispatch-booking","resolutionSource":"provider_send","sourceId":"d6200000-0000-4000-8000-000000000013"}'::jsonb,
  'manual accepted result and history survive reschedule and cancellation after the provider marker'
);

update public.ops_registration_observations
set status = 'scheduled'
where id = 'd6200000-0000-4000-8000-000000000013';
update public.ops_registration_appointments
set status = 'scheduled', notification_revision = 4
where id = 'd6200000-0000-4000-8000-000000000012';
delete from dashboard_private.registration_observation_domain_events
where event_id in (
  'd6200000-0000-4000-8000-000000000119',
  'd6200000-0000-4000-8000-000000000120'
);

-- A second manual revision reaches the provider marker while eligible. A
-- no-show committed during the provider request must not erase the durable
-- result seam or force a second provider path during the later provider check.
update public.ops_registration_appointments
set notification_revision = 5
where id = 'd6200000-0000-4000-8000-000000000012';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'd6200000-0000-4000-8000-000000000121', observation.id,
  observation.appointment_id, 5, 'observation_rescheduled',
  observation.booking_fact_hash, observation.source_revision,
  (
    select coalesce(max(event.occurred_at), pg_catalog.clock_timestamp()) + interval '1 second'
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = observation.id
  )
from public.ops_registration_observations observation
where observation.id = 'd6200000-0000-4000-8000-000000000013';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking source revision 5', public.resolve_registration_customer_message_source_v1(
  'd6200000-0000-4000-8000-000000000001',
  'observation_booking',
  'd6200000-0000-4000-8000-000000000013'
);
insert into dispatch_rpc_results(label, response)
select 'booking preview revision 5', public.create_registration_customer_message_preview_v1(
  'd6200000-0000-4000-8000-000000000001',
  'observation_booking',
  'd6200000-0000-4000-8000-000000000013',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source revision 5'),
    'observation_booking'
  )
);
insert into dispatch_rpc_results(label, response)
select 'booking claim revision 5', public.claim_registration_customer_message_v1(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'previewId')::uuid from dispatch_rpc_results where label = 'booking preview revision 5'),
  'd6200000-0000-4000-8000-000000000122',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source revision 5'),
    'observation_booking'
  )
);
insert into dispatch_rpc_results(label, response)
select 'booking marker revision 5', public.mark_registration_customer_message_attempt_started_v1(
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5'),
  (select (response ->> 'claimToken')::uuid from dispatch_rpc_results where label = 'booking claim revision 5'),
  (select (response ->> 'dispatchToken')::uuid from dispatch_rpc_results where label = 'booking claim revision 5'),
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source revision 5'),
    'observation_booking'
  )
);
reset role;
update public.ops_registration_observations
set status = 'no_show',
    attendance = 'no_show',
    attendance_recorded_by = 'd6200000-0000-4000-8000-000000000001',
    attendance_recorded_at = pg_catalog.clock_timestamp()
where id = 'd6200000-0000-4000-8000-000000000013';
update public.ops_registration_appointments
set status = 'completed'
where id = 'd6200000-0000-4000-8000-000000000012';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'd6200000-0000-4000-8000-000000000123', observation.id,
  observation.appointment_id, 5, 'observation_no_show',
  observation.booking_fact_hash, observation.source_revision,
  (
    select coalesce(max(event.occurred_at), pg_catalog.clock_timestamp()) + interval '1 second'
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = observation.id
  )
from public.ops_registration_observations observation
where observation.id = 'd6200000-0000-4000-8000-000000000013';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking unknown revision 5', pg_temp.capture_manual_finalize(
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5'),
  (select (response ->> 'dispatchToken')::uuid from dispatch_rpc_results where label = 'booking claim revision 5'),
  'unknown',
  pg_catalog.jsonb_build_object(
    'statusCode', 'provider_dispatch_uncertain',
    'statusMessage', 'outcome unknown',
    'observedAt', '2026-08-12T06:01:00Z',
    'requestKeyMatched', true
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'responseStatus', result.response ->> 'currentStatus',
      'storedStatus', message.status,
      'statusCode', message.provider_evidence ->> 'statusCode',
      'resolutionSource', message.resolution_source,
      'markers', message.provider_attempt_count
    )
    from dispatch_rpc_results result
    join public.ops_registration_customer_messages message
      on message.id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5')
    where result.label = 'booking unknown revision 5'
  ),
  '{"markers":1,"resolutionSource":"provider_send","responseStatus":"unknown","statusCode":"provider_dispatch_uncertain","storedStatus":"unknown"}'::jsonb,
  'manual unknown result persists exact provider evidence after no-show'
);
update public.ops_registration_customer_messages
set created_at = pg_catalog.clock_timestamp() - interval '20 minutes',
    provider_attempt_started_at = pg_catalog.clock_timestamp() - interval '16 minutes'
where id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5');
insert into dispatch_rpc_results(label, response)
select 'booking request key revision 5', pg_catalog.jsonb_build_object('requestKey', message.request_key)
from public.ops_registration_customer_messages message
where message.id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5');
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking provider lookup revision 5', pg_temp.capture_manual_provider_check(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5'),
  'lookup_context', '{}'::jsonb, null
);
insert into dispatch_rpc_results(label, response)
select 'booking provider repair revision 5', pg_temp.capture_manual_provider_check(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5'),
  'accepted',
  pg_catalog.jsonb_build_object(
    'providerMessageId', 'synthetic-provider-check-revision-5',
    'statusCode', '200',
    'statusMessage', 'accepted after lookup',
    'observedAt', '2026-08-12T06:20:00Z',
    'requestKeyMatched', true
  ),
  (select response ->> 'requestKey' from dispatch_rpc_results where label = 'booking request key revision 5')
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'lookupMessageId', lookup.response ->> 'messageId',
      'repairStatus', repair.response ->> 'currentStatus',
      'storedStatus', message.status,
      'providerMessageId', message.provider_evidence ->> 'providerMessageId',
      'resolutionSource', message.resolution_source,
      'markers', message.provider_attempt_count
    )
    from dispatch_rpc_results lookup
    join dispatch_rpc_results repair on repair.label = 'booking provider repair revision 5'
    join public.ops_registration_customer_messages message
      on message.id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5')
    where lookup.label = 'booking provider lookup revision 5'
  ),
  pg_catalog.jsonb_build_object(
    'lookupMessageId', (
      select response ->> 'messageId' from dispatch_rpc_results where label = 'booking claim revision 5'
    ),
    'markers', 1,
    'providerMessageId', 'synthetic-provider-check-revision-5',
    'repairStatus', 'accepted',
    'resolutionSource', 'provider_check',
    'storedStatus', 'accepted'
  ),
  'provider check repairs the stored unknown result after no-show without a second marker'
);

update public.ops_registration_observations
set status = 'scheduled',
    attendance = null,
    attendance_recorded_by = null,
    attendance_recorded_at = null
where id = 'd6200000-0000-4000-8000-000000000013';
update public.ops_registration_appointments
set status = 'scheduled'
where id = 'd6200000-0000-4000-8000-000000000012';
delete from dashboard_private.registration_observation_domain_events
where event_id = 'd6200000-0000-4000-8000-000000000123';

update public.ops_registration_customer_messages
set status = 'unknown'
where id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5');
update public.ops_registration_observations
set status = 'attended_feedback_pending',
    attendance = 'attended',
    attendance_recorded_by = 'd6200000-0000-4000-8000-000000000001',
    attendance_recorded_at = pg_catalog.clock_timestamp()
where id = 'd6200000-0000-4000-8000-000000000013';
update public.ops_registration_appointments
set status = 'completed'
where id = 'd6200000-0000-4000-8000-000000000012';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'd6200000-0000-4000-8000-000000000124', observation.id,
  observation.appointment_id, 5, 'observation_attendance_recorded',
  observation.booking_fact_hash, observation.source_revision,
  (
    select coalesce(max(event.occurred_at), pg_catalog.clock_timestamp()) + interval '1 second'
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = observation.id
  )
from public.ops_registration_observations observation
where observation.id = 'd6200000-0000-4000-8000-000000000013';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking reconcile after attendance', pg_temp.capture_manual_reconcile(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5'),
  'failed_hold',
  pg_catalog.jsonb_build_object(
    'statusCode', '404',
    'statusMessage', 'not accepted after admin review',
    'observedAt', '2026-08-12T06:30:00Z',
    'requestKeyMatched', true
  ),
  'provider dashboard reviewed after attendance',
  'd6200000-0000-4000-8000-000000000125'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'responseStatus', result.response ->> 'currentStatus',
      'storedStatus', message.status,
      'statusCode', message.provider_evidence ->> 'statusCode',
      'resolutionSource', message.resolution_source,
      'markers', message.provider_attempt_count
    )
    from dispatch_rpc_results result
    join public.ops_registration_customer_messages message
      on message.id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 5')
    where result.label = 'booking reconcile after attendance'
  ),
  '{"markers":1,"resolutionSource":"admin_reconcile","responseStatus":"failed_hold","statusCode":"404","storedStatus":"failed_hold"}'::jsonb,
  'admin reconcile persists exact evidence after attendance without a second marker'
);

update public.ops_registration_observations
set status = 'scheduled',
    attendance = null,
    attendance_recorded_by = null,
    attendance_recorded_at = null
where id = 'd6200000-0000-4000-8000-000000000013';
update public.ops_registration_appointments
set status = 'scheduled', notification_revision = 6
where id = 'd6200000-0000-4000-8000-000000000012';
delete from dashboard_private.registration_observation_domain_events
where event_id = 'd6200000-0000-4000-8000-000000000124';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'd6200000-0000-4000-8000-000000000126', observation.id,
  observation.appointment_id, 6, 'observation_rescheduled',
  observation.booking_fact_hash, observation.source_revision,
  (
    select coalesce(max(event.occurred_at), pg_catalog.clock_timestamp()) + interval '1 second'
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = observation.id
  )
from public.ops_registration_observations observation
where observation.id = 'd6200000-0000-4000-8000-000000000013';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking source revision 6', public.resolve_registration_customer_message_source_v1(
  'd6200000-0000-4000-8000-000000000001',
  'observation_booking',
  'd6200000-0000-4000-8000-000000000013'
);
insert into dispatch_rpc_results(label, response)
select 'booking preview revision 6', public.create_registration_customer_message_preview_v1(
  'd6200000-0000-4000-8000-000000000001',
  'observation_booking',
  'd6200000-0000-4000-8000-000000000013',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source revision 6'),
    'observation_booking'
  )
);
insert into dispatch_rpc_results(label, response)
select 'booking claim revision 6', public.claim_registration_customer_message_v1(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'previewId')::uuid from dispatch_rpc_results where label = 'booking preview revision 6'),
  'd6200000-0000-4000-8000-000000000127',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'booking source revision 6'),
    'observation_booking'
  )
);
reset role;
update public.ops_registration_observations
set status = 'canceled'
where id = 'd6200000-0000-4000-8000-000000000013';
update public.ops_registration_appointments
set status = 'canceled'
where id = 'd6200000-0000-4000-8000-000000000012';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  'd6200000-0000-4000-8000-000000000128', observation.id,
  observation.appointment_id, 6, 'observation_canceled',
  observation.booking_fact_hash, observation.source_revision,
  (
    select coalesce(max(event.occurred_at), pg_catalog.clock_timestamp()) + interval '1 second'
    from dashboard_private.registration_observation_domain_events event
    where event.observation_id = observation.id
  )
from public.ops_registration_observations observation
where observation.id = 'd6200000-0000-4000-8000-000000000013';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'booking release after cancellation', pg_temp.capture_manual_release(
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 6'),
  (select (response ->> 'claimToken')::uuid from dispatch_rpc_results where label = 'booking claim revision 6'),
  'source_ineligible'
);
insert into dispatch_rpc_results(label, response)
select 'booking history after cancellation', pg_catalog.jsonb_build_object(
  'items', public.list_registration_customer_messages_v1(
    'd6200000-0000-4000-8000-000000000001',
    'observation_booking',
    'd6200000-0000-4000-8000-000000000013',
    10
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'responseStatus', released.response ->> 'currentStatus',
      'claimActive', message.claim_active,
      'releaseReason', message.claim_release_reason,
      'markers', message.provider_attempt_count
    )
    from dispatch_rpc_results released
    join public.ops_registration_customer_messages message
      on message.id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 6')
    where released.label = 'booking release after cancellation'
  ),
  '{"claimActive":false,"markers":0,"releaseReason":"pre_send:source_ineligible","responseStatus":"pending"}'::jsonb,
  'pre-marker release cleans the exact stored message after cancellation'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'count', pg_catalog.jsonb_array_length(response -> 'items'),
      'sourceId', response -> 'items' -> 0 ->> 'sourceId',
      'observationId', response -> 'items' -> 0 ->> 'observationId',
      'hasPhone', (response -> 'items' -> 0) ? 'parentPhoneDigits',
      'hasFingerprint', (response -> 'items' -> 0) ? 'sourceFingerprint',
      'hasRecipientHash', (response -> 'items' -> 0) ? 'recipientHash'
    )
    from dispatch_rpc_results
    where label = 'booking history after cancellation'
  ),
  '{"count":3,"hasFingerprint":false,"hasPhone":false,"hasRecipientHash":false,"observationId":"d6200000-0000-4000-8000-000000000013","sourceId":"d6200000-0000-4000-8000-000000000013"}'::jsonb,
  'terminal observation history stays available and masked'
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id, student_name
) values (
  'd6200000-0000-4000-8000-000000000129', 'cross-message identity fixture',
  'registration', 'requested', 'normal',
  'd6200000-0000-4000-8000-000000000001',
  'd6200000-0000-4000-8000-000000000001', '다른 학생'
);
update public.ops_registration_customer_messages
set task_id = 'd6200000-0000-4000-8000-000000000129'
where id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 6');
set local role service_role;
select throws_ok(
  $$select pg_temp.assert_stored_observation(
      (select (response ->> 'messageId')::uuid
       from dispatch_rpc_results where label = 'booking claim revision 6')
    )$$,
  '40001', 'registration_customer_message_stored_identity_invalid',
  'stored observation validation rejects cross-task message repair'
);
reset role;
update public.ops_registration_customer_messages
set task_id = 'd6200000-0000-4000-8000-000000000010'
where id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim revision 6');

update public.ops_registration_observations
set status = 'scheduled'
where id = 'd6200000-0000-4000-8000-000000000013';
update public.ops_registration_appointments
set status = 'scheduled', notification_revision = 4
where id = 'd6200000-0000-4000-8000-000000000012';
delete from dashboard_private.registration_observation_domain_events
where event_id in (
  'd6200000-0000-4000-8000-000000000121',
  'd6200000-0000-4000-8000-000000000126',
  'd6200000-0000-4000-8000-000000000128'
);

-- Build the legacy appointment live-test evidence through the unchanged manual
-- pipeline. Runtime is deliberately zero: appointment compatibility must never
-- depend on the observation runtime.
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
) values (
  'd6200000-0000-4000-8000-000000000018',
  'd6200000-0000-4000-8000-000000000010', '수학', 'consultation_waiting',
  'd6200000-0000-4000-8000-000000000001', 'manual', now(), false,
  'consultation_requested', 1, now(), null, 0
);
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
) values (
  'd6200000-0000-4000-8000-000000000016',
  'd6200000-0000-4000-8000-000000000010', 'visit_consultation',
  pg_catalog.clock_timestamp() + interval '2 days', '별관', 'scheduled', 4,
  'd6200000-0000-4000-8000-000000000001'
);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
) values (
  'd6200000-0000-4000-8000-000000000024',
  'd6200000-0000-4000-8000-000000000010', '과학', 'consultation_waiting',
  'd6200000-0000-4000-8000-000000000001', 'manual', now(), false,
  'consultation_requested', 1, now(), null, 0
);
insert into public.ops_registration_consultations(
  id, track_id, appointment_id, mode, status, director_profile_id
) values (
  'd6200000-0000-4000-8000-000000000017',
  'd6200000-0000-4000-8000-000000000018',
  'd6200000-0000-4000-8000-000000000016', 'visit', 'scheduled',
  'd6200000-0000-4000-8000-000000000001'
);
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
) values (
  'd6200000-0000-4000-8000-000000000019',
  'd6200000-0000-4000-8000-000000000010', 'visit_consultation',
  pg_catalog.clock_timestamp() + interval '2 days', '별관', 'scheduled', 5,
  'd6200000-0000-4000-8000-000000000001'
);
insert into public.ops_registration_consultations(
  id, track_id, appointment_id, mode, status, director_profile_id
) values (
  'd6200000-0000-4000-8000-000000000023',
  'd6200000-0000-4000-8000-000000000024',
  'd6200000-0000-4000-8000-000000000019', 'visit', 'scheduled',
  'd6200000-0000-4000-8000-000000000001'
);
update dashboard_private.registration_observation_runtime_settings
set activation_version = 0;
insert into dashboard_private.registration_customer_solapi_template_receipts(
  message_kind, template_id, pf_id, catalog_checksum,
  provider_checksum, provider_status, verified_by
) values (
  'appointment_reminder', 'dispatch-appointment-template', 'dispatch-pf', repeat('c', 64),
  repeat('c', 64), 'sendable', 'd6200000-0000-4000-8000-000000000001'
) on conflict (message_kind) do update set
  template_id = excluded.template_id,
  pf_id = excluded.pf_id,
  catalog_checksum = excluded.catalog_checksum,
  provider_checksum = excluded.provider_checksum,
  provider_status = excluded.provider_status,
  verified_by = excluded.verified_by;
update dashboard_private.registration_customer_solapi_activation
set mode = 'verification',
    verification_task_id = 'd6200000-0000-4000-8000-000000000010',
    verification_recipient_hash = repeat('b', 64),
    live_test_message_id = null,
    live_test_confirmed_at = null,
    updated_by = 'd6200000-0000-4000-8000-000000000001'
where message_kind = 'appointment_reminder';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'appointment source', public.resolve_registration_customer_message_source_v1(
  'd6200000-0000-4000-8000-000000000001',
  'appointment_reminder',
  'd6200000-0000-4000-8000-000000000016'
);
insert into dispatch_rpc_results(label, response)
select 'appointment preview', public.create_registration_customer_message_preview_v1(
  'd6200000-0000-4000-8000-000000000001',
  'appointment_reminder',
  'd6200000-0000-4000-8000-000000000016',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'appointment source'),
    'appointment_reminder'
  )
);
insert into dispatch_rpc_results(label, response)
select 'appointment manual claim', public.claim_registration_customer_message_v1(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'previewId')::uuid from dispatch_rpc_results where label = 'appointment preview'),
  'd6200000-0000-4000-8000-000000000022',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'appointment source'),
    'appointment_reminder'
  )
);
insert into dispatch_rpc_results(label, response)
select 'appointment manual marker', public.mark_registration_customer_message_attempt_started_v1(
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'appointment manual claim'),
  (select (response ->> 'claimToken')::uuid from dispatch_rpc_results where label = 'appointment manual claim'),
  (select (response ->> 'dispatchToken')::uuid from dispatch_rpc_results where label = 'appointment manual claim'),
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'appointment source'),
    'appointment_reminder'
  )
);
insert into dispatch_rpc_results(label, response)
select 'appointment manual accepted', public.finalize_registration_customer_message_v1(
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'appointment manual claim'),
  (select (response ->> 'dispatchToken')::uuid from dispatch_rpc_results where label = 'appointment manual claim'),
  'accepted',
  pg_catalog.jsonb_build_object(
    'providerMessageId', 'synthetic-appointment-live-test',
    'providerGroupId', 'synthetic-appointment-group',
    'statusCode', '202',
    'statusMessage', 'accepted',
    'observedAt', '2026-08-12T06:00:00Z',
    'requestKeyMatched', true
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'runtime', public.registration_observation_runtime_version(),
      'markerAllowed', marker.response -> 'allowed',
      'status', accepted.response ->> 'currentStatus'
    )
    from dispatch_rpc_results marker
    join dispatch_rpc_results accepted on accepted.label = 'appointment manual accepted'
    where marker.label = 'appointment manual marker'
  ),
  '{"markerAllowed":true,"runtime":0,"status":"accepted"}'::jsonb,
  'legacy appointment manual pipeline remains compatible while observation runtime is zero'
);

create temporary table dispatch_appointment_claim_results(
  label text primary key,
  response jsonb
) on commit drop;
grant insert, select on table dispatch_appointment_claim_results to service_role;
insert into dashboard_private.registration_observation_solapi_event_consumptions(
  event_id, action, job_id
) values (
  'd6200000-0000-4000-8000-000000000014', 'skipped_off', null
);
alter table dashboard_private.registration_customer_reminder_settings
  disable trigger sync_registration_customer_reminder_cron_active;
update dashboard_private.registration_customer_reminder_settings
set enabled = true,
    lead_hours = 72
where singleton;
alter table dashboard_private.registration_customer_reminder_settings
  enable trigger sync_registration_customer_reminder_cron_active;
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, task_id, message_kind, source_revision,
  scheduled_for, due_at, available_at, request_key, status
) values (
  'd6200000-0000-4000-8000-000000000060',
  'd6200000-0000-4000-8000-000000000019',
  'd6200000-0000-4000-8000-000000000010',
  'appointment_reminder', 5,
  pg_catalog.clock_timestamp() + interval '2 days',
  pg_catalog.clock_timestamp() - interval '2 hours',
  pg_catalog.clock_timestamp() - interval '1 hour',
  'd6200000-0000-4000-8000-000000000060', 'pending'
) on conflict (appointment_id, source_revision, message_kind)
  where message_kind = 'appointment_reminder' do update set
    job_id = excluded.job_id,
    status = 'pending', claim_token = null, claim_expires_at = null,
    due_at = excluded.due_at, available_at = excluded.available_at,
    message_id = null, last_error_code = null;
create temporary table dispatch_appointment_marker_baseline as
select count(*) as marker_count
from public.ops_registration_customer_messages
where message_kind = 'appointment_reminder'
  and provider_attempt_count = 1;

-- OFF, verification, missing receipt, and missing accepted-test evidence are
-- all claim-ineligible and must leave the appointment row pending.
update dashboard_private.registration_customer_solapi_activation
set mode = 'off',
    verification_task_id = null,
    verification_recipient_hash = null,
    live_test_message_id = null,
    live_test_confirmed_at = null
where message_kind = 'appointment_reminder';
set local role service_role;
insert into dispatch_appointment_claim_results values
  ('appointment off', public.claim_registration_customer_reminder_job_v1());
reset role;
select is((select response from dispatch_appointment_claim_results where label = 'appointment off'), null::jsonb,
  'appointment OFF is raw-claim ineligible');
select is((select status from dashboard_private.registration_customer_reminder_jobs where job_id = 'd6200000-0000-4000-8000-000000000060'), 'pending',
  'appointment OFF leaves the job pending and unmutated');
update dashboard_private.registration_customer_reminder_jobs
set status = 'pending', claim_token = null, claim_expires_at = null,
    available_at = pg_catalog.clock_timestamp() - interval '1 hour', last_error_code = null
where job_id = 'd6200000-0000-4000-8000-000000000060';

update dashboard_private.registration_customer_solapi_activation
set mode = 'verification',
    verification_task_id = 'd6200000-0000-4000-8000-000000000010',
    verification_recipient_hash = repeat('b', 64)
where message_kind = 'appointment_reminder';
set local role service_role;
insert into dispatch_appointment_claim_results values
  ('appointment verification', public.claim_registration_customer_reminder_job_v1());
reset role;
select is((select response from dispatch_appointment_claim_results where label = 'appointment verification'), null::jsonb,
  'appointment verification is raw-claim ineligible');
update dashboard_private.registration_customer_reminder_jobs
set status = 'pending', claim_token = null, claim_expires_at = null,
    available_at = pg_catalog.clock_timestamp() - interval '1 hour', last_error_code = null
where job_id = 'd6200000-0000-4000-8000-000000000060';

update dashboard_private.registration_customer_solapi_activation
set mode = 'live',
    live_test_message_id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'appointment manual claim'),
    live_test_confirmed_at = pg_catalog.clock_timestamp()
where message_kind = 'appointment_reminder';
delete from dashboard_private.registration_customer_solapi_template_receipts
where message_kind = 'appointment_reminder';
set local role service_role;
insert into dispatch_appointment_claim_results values
  ('appointment no receipt', public.claim_registration_customer_reminder_job_v1());
reset role;
select is((select response from dispatch_appointment_claim_results where label = 'appointment no receipt'), null::jsonb,
  'appointment without a sendable matching receipt is raw-claim ineligible');
update dashboard_private.registration_customer_reminder_jobs
set status = 'pending', claim_token = null, claim_expires_at = null,
    available_at = pg_catalog.clock_timestamp() - interval '1 hour', last_error_code = null
where job_id = 'd6200000-0000-4000-8000-000000000060';

insert into dashboard_private.registration_customer_solapi_template_receipts(
  message_kind, template_id, pf_id, catalog_checksum,
  provider_checksum, provider_status, verified_by
) values (
  'appointment_reminder', 'dispatch-appointment-template', 'dispatch-pf', repeat('c', 64),
  repeat('c', 64), 'sendable', 'd6200000-0000-4000-8000-000000000001'
);
update dashboard_private.registration_customer_solapi_activation
set live_test_message_id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking reacquired'),
    live_test_confirmed_at = pg_catalog.clock_timestamp()
where message_kind = 'appointment_reminder';
set local role service_role;
insert into dispatch_appointment_claim_results values
  ('appointment no accepted test', public.claim_registration_customer_reminder_job_v1());
reset role;
select is((select response from dispatch_appointment_claim_results where label = 'appointment no accepted test'), null::jsonb,
  'appointment without accepted live-test evidence is raw-claim ineligible');
select is(
  (
    select count(*) - baseline.marker_count
    from public.ops_registration_customer_messages message
    cross join dispatch_appointment_marker_baseline baseline
    where message.message_kind = 'appointment_reminder'
      and message.provider_attempt_count = 1
    group by baseline.marker_count
  ),
  0::bigint,
  'all four appointment claim gate failures keep provider marker delta zero'
);
update dashboard_private.registration_customer_reminder_jobs
set status = 'pending', claim_token = null, claim_expires_at = null,
    available_at = pg_catalog.clock_timestamp() - interval '1 hour', last_error_code = null
where job_id = 'd6200000-0000-4000-8000-000000000060';

update dashboard_private.registration_customer_solapi_activation
set live_test_message_id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'appointment manual claim'),
    live_test_confirmed_at = pg_catalog.clock_timestamp()
where message_kind = 'appointment_reminder';

-- Preserve and temporarily replace the real runtime reader. A fully eligible
-- legacy claim must succeed without invoking this observation-only dependency.
create temporary table dispatch_runtime_reader_definition as
select pg_catalog.pg_get_functiondef(
  'public.registration_observation_runtime_version()'::pg_catalog.regprocedure
) as definition;
create or replace function public.registration_observation_runtime_version()
returns integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  raise exception 'registration_observation_runtime_reader_unavailable'
    using errcode = '55000';
end;
$$;
set local role service_role;
insert into dispatch_appointment_claim_results values
  ('appointment live', pg_temp.capture_automatic_claim());
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'jobId', result.response ->> 'jobId',
      'caughtError', result.response ->> 'caughtError',
      'observationJobs', (
        select count(*)
        from dashboard_private.registration_customer_reminder_jobs job
        where job.message_kind = 'observation_reminder'
      )
    )
    from dispatch_appointment_claim_results result
    where result.label = 'appointment live'
  ),
  '{"caughtError":null,"jobId":"d6200000-0000-4000-8000-000000000060","observationJobs":0}'::jsonb,
  'fully eligible appointment claim succeeds without invoking the observation runtime reader'
);
do $restore_runtime_reader$
begin
  execute (
    select definition
    from dispatch_runtime_reader_definition
  );
end;
$restore_runtime_reader$;
update dashboard_private.registration_customer_reminder_jobs
set status = 'pending', claim_token = null, claim_expires_at = null,
    available_at = pg_catalog.clock_timestamp() - interval '1 hour',
    message_id = null, last_error_code = null
where job_id = 'd6200000-0000-4000-8000-000000000060';

-- More than one bounded page of runtime-zero observation rows must not starve
-- the later due legacy appointment. The skipped observation rows are immutable.
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id,
  message_kind, source_revision, session_source_revision, booking_fact_hash,
  activation_mode_snapshot, verification_started_at, verification_recipient_hash,
  scheduled_for, due_at, available_at, request_key, status
)
select
  pg_catalog.md5('dispatch-starvation-job-' || page.n::text)::uuid,
  observation.appointment_id, observation.id,
  'd6200000-0000-4000-8000-000000000014', observation.task_id,
  'observation_reminder', 1000 + page.n, observation.source_revision,
  observation.booking_fact_hash, 'verification', activation.updated_at,
  activation.verification_recipient_hash, observation.starts_at,
  pg_catalog.clock_timestamp() - interval '48 hours',
  pg_catalog.clock_timestamp() - interval '48 hours',
  gen_random_uuid(), 'pending'
from pg_catalog.generate_series(1, 101) page(n)
cross join public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'd6200000-0000-4000-8000-000000000013'
  and activation.message_kind = 'observation_reminder';
set local role service_role;
insert into dispatch_appointment_claim_results values
  ('runtime-zero fallback', public.claim_registration_customer_reminder_job_v1());
reset role;
select is(
  (select response ->> 'jobId' from dispatch_appointment_claim_results where label = 'runtime-zero fallback'),
  'd6200000-0000-4000-8000-000000000060',
  'runtime-zero observation rows beyond one bounded page fall through to the due legacy appointment'
);
select is(
  (
    select count(*)
    from dashboard_private.registration_customer_reminder_jobs job
    where job.job_id in (
      select pg_catalog.md5('dispatch-starvation-job-' || page.n::text)::uuid
      from pg_catalog.generate_series(1, 101) page(n)
    )
      and job.status = 'pending'
      and job.claim_token is null
      and job.claim_expires_at is null
  ),
  101::bigint,
  'runtime-zero fallback mutates none of the skipped observation jobs'
);
delete from dashboard_private.registration_customer_reminder_jobs
where job_id in (
  select pg_catalog.md5('dispatch-starvation-job-' || page.n::text)::uuid
  from pg_catalog.generate_series(1, 101) page(n)
);
update dashboard_private.registration_customer_reminder_jobs
set status = 'completed', claim_token = null, claim_expires_at = null,
    message_id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'appointment manual claim'),
    last_error_code = 'duplicate_locked'
where job_id = 'd6200000-0000-4000-8000-000000000060';

create or replace function dashboard_private.registration_customer_reminder_schedule_ready_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select true $$;
alter table dashboard_private.registration_customer_reminder_settings
  disable trigger sync_registration_customer_reminder_cron_active;
update dashboard_private.registration_customer_reminder_settings
set enabled = true,
    lead_hours = 72,
    revision = revision + 1,
    updated_by = 'd6200000-0000-4000-8000-000000000001'
where singleton;
alter table dashboard_private.registration_customer_reminder_settings
  enable trigger sync_registration_customer_reminder_cron_active;

insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id,
  message_kind, source_revision, session_source_revision, booking_fact_hash,
  activation_mode_snapshot, verification_started_at, verification_recipient_hash,
  scheduled_for, due_at, available_at, request_key, status
)
select
  'd6200000-0000-4000-8000-000000000030',
  observation.appointment_id, observation.id,
  'd6200000-0000-4000-8000-000000000014', observation.task_id,
  'observation_reminder', 4, observation.source_revision,
  observation.booking_fact_hash, 'verification', activation.updated_at,
  activation.verification_recipient_hash, observation.starts_at,
  observation.starts_at - interval '72 hours',
  pg_catalog.clock_timestamp() - interval '1 second',
  'd6200000-0000-4000-8000-000000000030', 'pending'
from public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'd6200000-0000-4000-8000-000000000013'
  and activation.message_kind = 'observation_reminder';

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1;
set local role service_role;
insert into dispatch_rpc_results(label, response)
values ('automatic claim', public.claim_registration_customer_reminder_job_v1());
reset role;
select is(
  (
    select pg_catalog.jsonb_agg(key order by key)
    from pg_catalog.jsonb_object_keys(
      (select response from dispatch_rpc_results where label = 'automatic claim')
    ) key
  ),
  '["appointmentId","claimToken","jobId","messageKind","observationId","requestKey","scheduledFor","sourceRevision"]'::jsonb,
  'observation automatic claim returns exactly the eight-key worker contract'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'jobId', response ->> 'jobId',
      'messageKind', response ->> 'messageKind',
      'observationId', response ->> 'observationId'
    )
    from dispatch_rpc_results where label = 'automatic claim'
  ),
  '{"jobId":"d6200000-0000-4000-8000-000000000030","messageKind":"observation_reminder","observationId":"d6200000-0000-4000-8000-000000000013"}'::jsonb,
  'automatic claim keeps independent job and observation identities'
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 0;
set local role service_role;
select throws_ok(
  $$select public.read_registration_customer_reminder_source_v1(
      'd6200000-0000-4000-8000-000000000030',
      (select (response ->> 'claimToken')::uuid
       from dispatch_rpc_results where label = 'automatic claim')
    )$$,
  '55000', 'registration_observation_runtime_inactive',
  'runtime rollback after claim rejects the job-locked source read'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', job.status,
      'markers', count(message.id)
    )
    from dashboard_private.registration_customer_reminder_jobs job
    left join public.ops_registration_customer_messages message
      on message.scheduled_job_id = job.job_id
       and message.provider_attempt_count = 1
    where job.job_id = 'd6200000-0000-4000-8000-000000000030'
    group by job.status
  ),
  '{"markers":0,"status":"claimed"}'::jsonb,
  'runtime-rejected read mutates neither the claim nor provider marker state'
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1;
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic read', public.read_registration_customer_reminder_source_v1(
  'd6200000-0000-4000-8000-000000000030',
  (select (response ->> 'claimToken')::uuid
   from dispatch_rpc_results where label = 'automatic claim')
);
reset role;

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id, student_name
) values (
  'd6200000-0000-4000-8000-000000000015',
  'SOLAPI verification drift task', 'registration', 'requested', 'normal',
  'd6200000-0000-4000-8000-000000000001',
  'd6200000-0000-4000-8000-000000000001', '다른 학생'
);

-- A verification task drift is terminal before marker mutation.
update dashboard_private.registration_customer_solapi_activation
set verification_task_id = 'd6200000-0000-4000-8000-000000000015'
where message_kind = 'observation_reminder';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic verification task drift', pg_temp.capture_automatic_begin(
  'd6200000-0000-4000-8000-000000000030',
  (select (response ->> 'claimToken')::uuid from dispatch_rpc_results where label = 'automatic claim'),
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'automatic read'),
    'observation_reminder'
  ),
  pg_temp.dispatch_readiness_contract(
    (select response from dispatch_rpc_results where label = 'automatic read'),
    'dispatch-reminder-template'
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'result', result.response ->> 'currentStatus',
      'jobStatus', job.status,
      'error', job.last_error_code,
      'markers', count(message.id)
    )
    from dispatch_rpc_results result
    join dashboard_private.registration_customer_reminder_jobs job on job.job_id = 'd6200000-0000-4000-8000-000000000030'
    left join public.ops_registration_customer_messages message on message.scheduled_job_id = job.job_id and message.provider_attempt_count = 1
    where result.label = 'automatic verification task drift'
    group by result.response, job.status, job.last_error_code
  ),
  '{"error":"verification_scope_changed","jobStatus":"canceled","markers":0,"result":"canceled"}'::jsonb,
  'verification task drift cancels the claimed job before marker mutation'
);

-- Restore an exact claimed verification snapshot, then mutate only the
-- activation start timestamp to model a verification restart.
update dashboard_private.registration_customer_solapi_activation
set verification_task_id = 'd6200000-0000-4000-8000-000000000010',
    verification_recipient_hash = repeat('b', 64)
where message_kind = 'observation_reminder';
update dashboard_private.registration_customer_reminder_jobs job
set status = 'claimed', claim_token = 'd6200000-0000-4000-8000-000000000033',
    claim_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
    available_at = null, message_id = null, last_error_code = null,
    verification_started_at = activation.updated_at,
    verification_recipient_hash = activation.verification_recipient_hash
from dashboard_private.registration_customer_solapi_activation activation
where job.job_id = 'd6200000-0000-4000-8000-000000000030'
  and activation.message_kind = 'observation_reminder';
alter table dashboard_private.registration_customer_solapi_activation
  disable trigger set_updated_at_registration_customer_solapi_activation;
update dashboard_private.registration_customer_solapi_activation
set updated_at = pg_catalog.clock_timestamp() + interval '1 second'
where message_kind = 'observation_reminder';
alter table dashboard_private.registration_customer_solapi_activation
  enable trigger set_updated_at_registration_customer_solapi_activation;
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic verification restart', pg_temp.capture_automatic_begin(
  'd6200000-0000-4000-8000-000000000030',
  'd6200000-0000-4000-8000-000000000033',
  pg_temp.dispatch_contract((select response from dispatch_rpc_results where label = 'automatic read'), 'observation_reminder'),
  pg_temp.dispatch_readiness_contract((select response from dispatch_rpc_results where label = 'automatic read'), 'dispatch-reminder-template')
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object('result', result.response ->> 'currentStatus', 'jobStatus', job.status,
      'error', job.last_error_code, 'markers', count(message.id))
    from dispatch_rpc_results result
    join dashboard_private.registration_customer_reminder_jobs job on job.job_id = 'd6200000-0000-4000-8000-000000000030'
    left join public.ops_registration_customer_messages message on message.scheduled_job_id = job.job_id and message.provider_attempt_count = 1
    where result.label = 'automatic verification restart'
    group by result.response, job.status, job.last_error_code
  ),
  '{"error":"verification_scope_changed","jobStatus":"canceled","markers":0,"result":"canceled"}'::jsonb,
  'verification restart cancels the claimed job before marker mutation'
);

-- The pre-fix implementation may have written a marker for the failed restart
-- assertion. Normalize the fixture before exercising the independent hash case.
update dashboard_private.registration_customer_reminder_jobs
set status = 'canceled', claim_token = null, claim_expires_at = null,
    available_at = null, message_id = null,
    last_error_code = 'verification_scope_changed'
where job_id = 'd6200000-0000-4000-8000-000000000030';
delete from public.ops_registration_customer_messages
where scheduled_job_id = 'd6200000-0000-4000-8000-000000000030';

-- Restore again, then drift only the current recipient hash.
update dashboard_private.registration_customer_solapi_activation
set verification_recipient_hash = repeat('b', 64)
where message_kind = 'observation_reminder';
update dashboard_private.registration_customer_reminder_jobs job
set status = 'claimed', claim_token = 'd6200000-0000-4000-8000-000000000034',
    claim_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
    available_at = null, message_id = null, last_error_code = null,
    verification_started_at = activation.updated_at,
    verification_recipient_hash = activation.verification_recipient_hash
from dashboard_private.registration_customer_solapi_activation activation
where job.job_id = 'd6200000-0000-4000-8000-000000000030'
  and activation.message_kind = 'observation_reminder';
update dashboard_private.registration_customer_solapi_activation
set verification_recipient_hash = repeat('8', 64)
where message_kind = 'observation_reminder';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic verification recipient drift', pg_temp.capture_automatic_begin(
  'd6200000-0000-4000-8000-000000000030',
  'd6200000-0000-4000-8000-000000000034',
  pg_temp.dispatch_contract((select response from dispatch_rpc_results where label = 'automatic read'), 'observation_reminder'),
  pg_temp.dispatch_readiness_contract((select response from dispatch_rpc_results where label = 'automatic read'), 'dispatch-reminder-template')
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object('result', result.response ->> 'currentStatus', 'jobStatus', job.status,
      'error', job.last_error_code, 'markers', count(message.id))
    from dispatch_rpc_results result
    join dashboard_private.registration_customer_reminder_jobs job on job.job_id = 'd6200000-0000-4000-8000-000000000030'
    left join public.ops_registration_customer_messages message on message.scheduled_job_id = job.job_id and message.provider_attempt_count = 1
    where result.label = 'automatic verification recipient drift'
    group by result.response, job.status, job.last_error_code
  ),
  '{"error":"verification_scope_changed","jobStatus":"canceled","markers":0,"result":"canceled"}'::jsonb,
  'verification recipient-hash drift cancels the claimed job before marker mutation'
);

-- Restore the original verification scope for the runtime rollback case.
update dashboard_private.registration_customer_solapi_activation
set verification_recipient_hash = repeat('b', 64)
where message_kind = 'observation_reminder';
update dashboard_private.registration_customer_reminder_jobs job
set status = 'claimed',
    claim_token = (select (response ->> 'claimToken')::uuid from dispatch_rpc_results where label = 'automatic claim'),
    claim_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
    available_at = null, last_error_code = null,
    verification_started_at = activation.updated_at,
    verification_recipient_hash = activation.verification_recipient_hash
from dashboard_private.registration_customer_solapi_activation activation
where job.job_id = 'd6200000-0000-4000-8000-000000000030'
  and activation.message_kind = 'observation_reminder';
update dashboard_private.registration_observation_runtime_settings
set activation_version = 0;
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic begin runtime rollback', public.begin_registration_customer_reminder_dispatch_v1(
  'd6200000-0000-4000-8000-000000000030',
  (select (response ->> 'claimToken')::uuid
   from dispatch_rpc_results where label = 'automatic claim'),
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'automatic read'),
    'observation_reminder'
  ),
  pg_temp.dispatch_readiness_contract(
    (select response from dispatch_rpc_results where label = 'automatic read'),
    'dispatch-reminder-template'
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'result', result.response ->> 'currentStatus',
      'jobStatus', job.status,
      'error', job.last_error_code,
      'markers', count(message.id)
    )
    from dispatch_rpc_results result
    join dashboard_private.registration_customer_reminder_jobs job
      on job.job_id = 'd6200000-0000-4000-8000-000000000030'
    left join public.ops_registration_customer_messages message
      on message.scheduled_job_id = job.job_id
       and message.provider_attempt_count = 1
    where result.label = 'automatic begin runtime rollback'
    group by result.response, job.status, job.last_error_code
  ),
  '{"error":"runtime_inactive","jobStatus":"canceled","markers":0,"result":"runtime_inactive"}'::jsonb,
  'runtime rollback after read terminalizes provider-zero before begin marker'
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1;
update dashboard_private.registration_customer_reminder_jobs
set status = 'claimed',
    claim_token = 'd6200000-0000-4000-8000-000000000031',
    claim_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
    available_at = null,
    last_error_code = null
where job_id = 'd6200000-0000-4000-8000-000000000030';
update public.class_lesson_sessions
set revision = 2
where id = 'd6200000-0000-4000-8000-000000000005';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic reread revision two', public.read_registration_customer_reminder_source_v1(
  'd6200000-0000-4000-8000-000000000030',
  'd6200000-0000-4000-8000-000000000031'
);
insert into dispatch_rpc_results(label, response)
select 'automatic refresh required', public.begin_registration_customer_reminder_dispatch_v1(
  'd6200000-0000-4000-8000-000000000030',
  'd6200000-0000-4000-8000-000000000031',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'automatic reread revision two'),
    'observation_reminder'
  ),
  pg_temp.dispatch_readiness_contract(
    (select response from dispatch_rpc_results where label = 'automatic reread revision two'),
    'dispatch-reminder-template'
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'result', result.response ->> 'currentStatus',
      'refreshCount', job.source_refresh_count,
      'revision', job.session_source_revision -> 'revision',
      'markers', count(message.id)
    )
    from dispatch_rpc_results result
    join dashboard_private.registration_customer_reminder_jobs job
      on job.job_id = 'd6200000-0000-4000-8000-000000000030'
    left join public.ops_registration_customer_messages message
      on message.scheduled_job_id = job.job_id
       and message.provider_attempt_count = 1
    where result.label = 'automatic refresh required'
    group by result.response, job.source_refresh_count, job.session_source_revision
  ),
  '{"markers":0,"refreshCount":1,"result":"refresh_required","revision":2}'::jsonb,
  'revision-only drift performs one durable provider-zero refresh'
);

update public.class_lesson_sessions
set revision = 3
where id = 'd6200000-0000-4000-8000-000000000005';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic reread revision three', public.read_registration_customer_reminder_source_v1(
  'd6200000-0000-4000-8000-000000000030',
  'd6200000-0000-4000-8000-000000000031'
);
insert into dispatch_rpc_results(label, response)
select 'automatic revision unstable', public.begin_registration_customer_reminder_dispatch_v1(
  'd6200000-0000-4000-8000-000000000030',
  'd6200000-0000-4000-8000-000000000031',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'automatic reread revision three'),
    'observation_reminder'
  ),
  pg_temp.dispatch_readiness_contract(
    (select response from dispatch_rpc_results where label = 'automatic reread revision three'),
    'dispatch-reminder-template'
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'result', result.response ->> 'currentStatus',
      'jobStatus', job.status,
      'error', job.last_error_code,
      'markers', count(message.id)
    )
    from dispatch_rpc_results result
    join dashboard_private.registration_customer_reminder_jobs job
      on job.job_id = 'd6200000-0000-4000-8000-000000000030'
    left join public.ops_registration_customer_messages message
      on message.scheduled_job_id = job.job_id
       and message.provider_attempt_count = 1
    where result.label = 'automatic revision unstable'
    group by result.response, job.status, job.last_error_code
  ),
  '{"error":"source_revision_unstable","jobStatus":"source_dirty","markers":0,"result":"source_dirty"}'::jsonb,
  'a second revision drift becomes terminal source_dirty without a marker'
);

update dashboard_private.registration_customer_reminder_jobs
set status = 'claimed',
    claim_token = 'd6200000-0000-4000-8000-000000000032',
    claim_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
    available_at = null,
    last_error_code = null,
    session_source_revision = '{"authority":"normalized","sessionId":"d6200000-0000-4000-8000-000000000005","revision":3}'::jsonb,
    source_refresh_count = 0
where job_id = 'd6200000-0000-4000-8000-000000000030';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic final read', public.read_registration_customer_reminder_source_v1(
  'd6200000-0000-4000-8000-000000000030',
  'd6200000-0000-4000-8000-000000000032'
);
insert into dispatch_rpc_results(label, response)
select 'automatic begin marker', public.begin_registration_customer_reminder_dispatch_v1(
  'd6200000-0000-4000-8000-000000000030',
  'd6200000-0000-4000-8000-000000000032',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'automatic final read'),
    'observation_reminder'
  ),
  pg_temp.dispatch_readiness_contract(
    (select response from dispatch_rpc_results where label = 'automatic final read'),
    'dispatch-reminder-template'
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'allowed', result.response -> 'allowed',
      'currentStatus', result.response ->> 'currentStatus',
      'messageKind', message.message_kind,
      'deliveryOrigin', message.delivery_origin,
      'markers', message.provider_attempt_count
    )
    from dispatch_rpc_results result
    join public.ops_registration_customer_messages message
      on message.id = (result.response ->> 'messageId')::uuid
    where result.label = 'automatic begin marker'
  ),
  '{"allowed":true,"currentStatus":"pending","deliveryOrigin":"scheduled","markers":1,"messageKind":"observation_reminder"}'::jsonb,
  'automatic begin commits exactly one observation marker after all rechecks'
);

-- The durable queue uniqueness rule normally makes this race unreachable.
-- Remove only that index inside this rolled-back fixture to exercise the
-- defensive duplicate branch and prove its stable worker status contract.
drop index dashboard_private.registration_customer_reminder_jobs_observation_revision_once_idx;
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id,
  message_kind, source_revision, session_source_revision, source_refresh_count,
  booking_fact_hash, activation_mode_snapshot, verification_started_at,
  verification_recipient_hash, scheduled_for, due_at, available_at,
  request_key, status, claim_token, claim_expires_at
)
select
  'd6200000-0000-4000-8000-000000000035', job.appointment_id,
  job.observation_id, job.source_event_id, job.task_id, job.message_kind,
  job.source_revision, job.session_source_revision, job.source_refresh_count,
  job.booking_fact_hash, job.activation_mode_snapshot,
  job.verification_started_at, job.verification_recipient_hash,
  job.scheduled_for, job.due_at, null,
  'd6200000-0000-4000-8000-000000000035', 'claimed',
  'd6200000-0000-4000-8000-000000000036',
  pg_catalog.clock_timestamp() + interval '5 minutes'
from dashboard_private.registration_customer_reminder_jobs job
where job.job_id = 'd6200000-0000-4000-8000-000000000030';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic duplicate begin', public.begin_registration_customer_reminder_dispatch_v1(
  'd6200000-0000-4000-8000-000000000035',
  'd6200000-0000-4000-8000-000000000036',
  pg_temp.dispatch_contract(
    (select response from dispatch_rpc_results where label = 'automatic final read'),
    'observation_reminder'
  ),
  pg_temp.dispatch_readiness_contract(
    (select response from dispatch_rpc_results where label = 'automatic final read'),
    'dispatch-reminder-template'
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'allowed', result.response -> 'allowed',
      'currentStatus', result.response ->> 'currentStatus',
      'jobStatus', job.status,
      'jobError', job.last_error_code,
      'markers', (
        select count(*)
        from public.ops_registration_customer_messages message
        where message.observation_id = job.observation_id
          and message.message_kind = 'observation_reminder'
          and message.provider_attempt_count = 1
      )
    )
    from dispatch_rpc_results result
    join dashboard_private.registration_customer_reminder_jobs job
      on job.job_id = 'd6200000-0000-4000-8000-000000000035'
    where result.label = 'automatic duplicate begin'
  ),
  '{"allowed":false,"currentStatus":"duplicate_locked","jobError":"duplicate_locked","jobStatus":"completed","markers":1}'::jsonb,
  'automatic duplicate begin returns the stable duplicate_locked provider-zero result'
);
delete from dashboard_private.registration_customer_reminder_jobs
where job_id = 'd6200000-0000-4000-8000-000000000035';
create unique index registration_customer_reminder_jobs_observation_revision_once_idx
  on dashboard_private.registration_customer_reminder_jobs(
    observation_id, source_revision, message_kind
  )
  where message_kind = 'observation_reminder';

update public.ops_registration_customer_messages
set created_at = pg_catalog.clock_timestamp() - interval '20 minutes',
    confirmed_at = pg_catalog.clock_timestamp() - interval '20 minutes',
    provider_attempt_started_at = pg_catalog.clock_timestamp() - interval '16 minutes'
where id = (
  select (response ->> 'messageId')::uuid
  from dispatch_rpc_results where label = 'automatic begin marker'
);
create temporary table dispatch_nullable_results(
  label text primary key,
  response jsonb
) on commit drop;
grant insert, select on table dispatch_nullable_results to service_role;
set local role service_role;
insert into dispatch_nullable_results(label, response)
values ('recovery claim', public.claim_registration_customer_reminder_job_v1());
insert into dispatch_rpc_results(label, response)
select 'automatic unknown replay', public.finalize_registration_customer_reminder_dispatch_v1(
  (select (response ->> 'messageId')::uuid
   from dispatch_rpc_results where label = 'automatic begin marker'),
  (select (response ->> 'dispatchToken')::uuid
   from dispatch_rpc_results where label = 'automatic begin marker'),
  'unknown',
  pg_catalog.jsonb_build_object(
    'statusCode', 'timeout',
    'statusMessage', 'lookup required',
    'observedAt', '2026-08-12T06:00:00Z',
    'requestKeyMatched', true
  )
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'claimResult', nullable.response,
      'messageStatus', message.status,
      'jobStatus', job.status,
      'jobError', job.last_error_code,
      'finalizeIdempotent', replay.response -> 'idempotent'
    )
    from dispatch_nullable_results nullable
    join dashboard_private.registration_customer_reminder_jobs job
      on job.job_id = 'd6200000-0000-4000-8000-000000000030'
    join public.ops_registration_customer_messages message
      on message.id = job.message_id
    join dispatch_rpc_results replay on replay.label = 'automatic unknown replay'
    where nullable.label = 'recovery claim'
  ),
  '{"claimResult":null,"finalizeIdempotent":true,"jobError":"provider_dispatch_uncertain","jobStatus":"delivery_unknown","messageStatus":"unknown"}'::jsonb,
  'a marker older than fifteen minutes recovers once to delivery_unknown and never retries'
);

create temporary table dispatch_release_cases(
  label text primary key,
  job_id uuid not null,
  claim_token uuid not null,
  error_code text not null,
  expected text not null
) on commit drop;
insert into dispatch_release_cases(label, job_id, claim_token, error_code, expected) values
  ('source ineligible', 'd6200000-0000-4000-8000-000000000040', 'd6200000-0000-4000-8000-000000000050', 'source_ineligible', 'canceled:source_ineligible:no_retry'),
  ('runtime inactive', 'd6200000-0000-4000-8000-000000000041', 'd6200000-0000-4000-8000-000000000051', 'runtime_inactive', 'canceled:runtime_inactive:no_retry'),
  ('booking changed', 'd6200000-0000-4000-8000-000000000042', 'd6200000-0000-4000-8000-000000000052', 'booking_fact_changed', 'source_dirty:booking_fact_changed:no_retry'),
  ('revision unstable', 'd6200000-0000-4000-8000-000000000043', 'd6200000-0000-4000-8000-000000000053', 'source_revision_unstable', 'source_dirty:source_revision_unstable:no_retry'),
  ('retryable', 'd6200000-0000-4000-8000-000000000044', 'd6200000-0000-4000-8000-000000000054', 'source_read_failed', 'pending:source_read_failed:retry');
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, task_id, message_kind, source_revision,
  scheduled_for, due_at, available_at, request_key, status,
  claim_token, claim_expires_at
)
select
  release.job_id, 'd6200000-0000-4000-8000-000000000012',
  'd6200000-0000-4000-8000-000000000010', 'appointment_reminder',
  900 + row_number() over (order by release.job_id),
  pg_catalog.clock_timestamp() + interval '1 day',
  pg_catalog.clock_timestamp(), null, gen_random_uuid(), 'claimed',
  release.claim_token, pg_catalog.clock_timestamp() + interval '5 minutes'
from dispatch_release_cases release;
grant select on table dispatch_release_cases to service_role;
set local role service_role;
do $$
declare
  release record;
begin
  for release in select * from dispatch_release_cases loop
    perform public.release_registration_customer_reminder_job_v1(
      release.job_id, release.claim_token, release.error_code
    );
  end loop;
end;
$$;
reset role;
select is_empty(
  $$
    select release.label
    from dispatch_release_cases release
    join dashboard_private.registration_customer_reminder_jobs job
      on job.job_id = release.job_id
    where job.status || ':' || job.last_error_code || ':' ||
      case when job.available_at is null then 'no_retry' else 'retry' end
      is distinct from release.expected
  $$,
  'release terminalizes four stable observation errors and preserves legacy retry'
);

create temporary table dispatch_settings_revision as
select revision
from dashboard_private.registration_customer_reminder_settings
where singleton;
grant select on table dispatch_settings_revision to service_role;
update dashboard_private.registration_customer_solapi_activation
set mode = 'off',
    verification_task_id = null,
    verification_recipient_hash = null
where message_kind = 'appointment_reminder';
alter table dashboard_private.registration_customer_reminder_settings
  disable trigger sync_registration_customer_reminder_cron_active;
create temporary table dispatch_lead_settings_revision as
select revision
from dashboard_private.registration_customer_reminder_settings
where singleton;
grant select on table dispatch_lead_settings_revision to service_role;
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'expanded settings', public.set_registration_customer_reminder_settings_v1(
  'd6200000-0000-4000-8000-000000000001',
  true,
  72::smallint,
  (select revision from dispatch_settings_revision),
  pg_catalog.jsonb_build_object(
    'templates', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'messageKind', 'observation_reminder',
        'templateId', 'dispatch-reminder-template',
        'pfId', 'dispatch-pf',
        'catalogChecksum', repeat('c', 64)
      )
    )
  )
);
reset role;
alter table dashboard_private.registration_customer_reminder_settings
  enable trigger sync_registration_customer_reminder_cron_active;
select is(
  (select response -> 'activeKinds' from dispatch_rpc_results where label = 'expanded settings'),
  '["observation_reminder"]'::jsonb,
  'expanded settings validates only the active automatic observation kind'
);
update dispatch_lead_settings_revision snapshot
set revision = settings.revision
from dashboard_private.registration_customer_reminder_settings settings
where settings.singleton;

-- Lead-hour mutation covers a safe pending row, an insufficient pending row,
-- and two claimed rows that only begin may transition.
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id,
  message_kind, source_revision, session_source_revision, booking_fact_hash,
  activation_mode_snapshot, verification_started_at, verification_recipient_hash,
  scheduled_for, due_at, available_at, request_key, status,
  claim_token, claim_expires_at
)
select fixture.job_id, observation.appointment_id, observation.id,
  'd6200000-0000-4000-8000-000000000014', observation.task_id,
  'observation_reminder', fixture.source_revision, observation.source_revision,
  observation.booking_fact_hash, 'verification', activation.updated_at,
  activation.verification_recipient_hash, fixture.scheduled_for,
  fixture.scheduled_for - interval '72 hours',
  case when fixture.status = 'pending' then pg_catalog.clock_timestamp() else null end,
  fixture.request_key, fixture.status, fixture.claim_token,
  case when fixture.status = 'claimed' then pg_catalog.clock_timestamp() + interval '5 minutes' end
from (
  values
    ('d6200000-0000-4000-8000-000000000080'::uuid, 2101::bigint, pg_catalog.clock_timestamp() + interval '2 days', 'pending', null::uuid, 'd6200000-0000-4000-8000-000000000080'::uuid),
    ('d6200000-0000-4000-8000-000000000081'::uuid, 2102::bigint, pg_catalog.clock_timestamp() + interval '2 hours', 'pending', null::uuid, 'd6200000-0000-4000-8000-000000000081'::uuid),
    ('d6200000-0000-4000-8000-000000000082'::uuid, 2103::bigint, pg_catalog.clock_timestamp() + interval '2 days', 'claimed', 'd6200000-0000-4000-8000-000000000092'::uuid, 'd6200000-0000-4000-8000-000000000082'::uuid),
    ('d6200000-0000-4000-8000-000000000083'::uuid, 2104::bigint, pg_catalog.clock_timestamp() + interval '2 hours', 'claimed', 'd6200000-0000-4000-8000-000000000093'::uuid, 'd6200000-0000-4000-8000-000000000083'::uuid)
) fixture(job_id, source_revision, scheduled_for, status, claim_token, request_key)
cross join public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'd6200000-0000-4000-8000-000000000013'
  and activation.message_kind = 'observation_reminder';
alter table dashboard_private.registration_customer_reminder_settings
  disable trigger sync_registration_customer_reminder_cron_active;
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'lead settings six', public.set_registration_customer_reminder_settings_v1(
  'd6200000-0000-4000-8000-000000000001', true, 6::smallint,
  (select revision from dispatch_lead_settings_revision),
  pg_catalog.jsonb_build_object('templates', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'messageKind', 'observation_reminder',
      'templateId', 'dispatch-reminder-template', 'pfId', 'dispatch-pf',
      'catalogChecksum', repeat('c', 64)
    )
  ))
);
reset role;
alter table dashboard_private.registration_customer_reminder_settings
  enable trigger sync_registration_customer_reminder_cron_active;
select is(
  (
    select pg_catalog.jsonb_object_agg(job.job_id::text,
      pg_catalog.jsonb_build_object(
        'status', job.status, 'error', job.last_error_code,
        'claimed', job.claim_token is not null
      ) order by job.job_id)
    from dashboard_private.registration_customer_reminder_jobs job
    where job.job_id in (
      'd6200000-0000-4000-8000-000000000080',
      'd6200000-0000-4000-8000-000000000081',
      'd6200000-0000-4000-8000-000000000082',
      'd6200000-0000-4000-8000-000000000083'
    )
  ),
  '{"d6200000-0000-4000-8000-000000000080":{"claimed":false,"error":"settings_changed","status":"pending"},"d6200000-0000-4000-8000-000000000081":{"claimed":false,"error":"lead_time_changed_insufficient","status":"canceled"},"d6200000-0000-4000-8000-000000000082":{"claimed":true,"error":null,"status":"claimed"},"d6200000-0000-4000-8000-000000000083":{"claimed":true,"error":null,"status":"claimed"}}'::jsonb,
  'lead-hour settings mutation changes only safe pending rows and preserves claimed rows'
);
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'lead claimed pending', public.begin_registration_customer_reminder_dispatch_v1(
  'd6200000-0000-4000-8000-000000000082',
  'd6200000-0000-4000-8000-000000000092',
  pg_temp.dispatch_contract((select response from dispatch_rpc_results where label = 'automatic final read'), 'observation_reminder'),
  pg_temp.dispatch_readiness_contract((select response from dispatch_rpc_results where label = 'automatic final read'), 'dispatch-reminder-template')
);
insert into dispatch_rpc_results(label, response)
select 'lead claimed insufficient', public.begin_registration_customer_reminder_dispatch_v1(
  'd6200000-0000-4000-8000-000000000083',
  'd6200000-0000-4000-8000-000000000093',
  pg_temp.dispatch_contract((select response from dispatch_rpc_results where label = 'automatic final read'), 'observation_reminder'),
  pg_temp.dispatch_readiness_contract((select response from dispatch_rpc_results where label = 'automatic final read'), 'dispatch-reminder-template')
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'result', result.response ->> 'currentStatus', 'status', job.status,
      'error', job.last_error_code, 'markers', count(message.id)
    )
    from dispatch_rpc_results result
    join dashboard_private.registration_customer_reminder_jobs job on job.job_id = 'd6200000-0000-4000-8000-000000000082'
    left join public.ops_registration_customer_messages message on message.scheduled_job_id = job.job_id and message.provider_attempt_count = 1
    where result.label = 'lead claimed pending'
    group by result.response, job.status, job.last_error_code
  ),
  '{"error":"settings_changed","markers":0,"result":"settings_refresh_required","status":"pending"}'::jsonb,
  'claimed far-future lead drift returns provider-zero pending refresh'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'result', result.response ->> 'currentStatus', 'status', job.status,
      'error', job.last_error_code, 'markers', count(message.id)
    )
    from dispatch_rpc_results result
    join dashboard_private.registration_customer_reminder_jobs job on job.job_id = 'd6200000-0000-4000-8000-000000000083'
    left join public.ops_registration_customer_messages message on message.scheduled_job_id = job.job_id and message.provider_attempt_count = 1
    where result.label = 'lead claimed insufficient'
    group by result.response, job.status, job.last_error_code
  ),
  '{"error":"lead_time_changed_insufficient","markers":0,"result":"settings_refresh_required","status":"canceled"}'::jsonb,
  'claimed short-lead drift terminalizes provider-zero as insufficient'
);

-- Claim recomputes booking facts and terminalizes a stale hash without marker.
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id,
  message_kind, source_revision, session_source_revision, booking_fact_hash,
  activation_mode_snapshot, verification_started_at, verification_recipient_hash,
  scheduled_for, due_at, available_at, request_key, status
)
select 'd6200000-0000-4000-8000-000000000084', observation.appointment_id,
  observation.id, 'd6200000-0000-4000-8000-000000000014', observation.task_id,
  'observation_reminder', 2110, observation.source_revision, repeat('0', 64),
  'verification', activation.updated_at, activation.verification_recipient_hash,
  observation.starts_at, pg_catalog.clock_timestamp() - interval '1 hour',
  pg_catalog.clock_timestamp() - interval '1 hour',
  'd6200000-0000-4000-8000-000000000084', 'pending'
from public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'd6200000-0000-4000-8000-000000000013'
  and activation.message_kind = 'observation_reminder';
set local role service_role;
insert into dispatch_nullable_results(label, response)
values ('booking hash drift claim', public.claim_registration_customer_reminder_job_v1());
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'result', nullable.response, 'status', job.status,
      'error', job.last_error_code, 'markers', count(message.id)
    )
    from dispatch_nullable_results nullable
    join dashboard_private.registration_customer_reminder_jobs job on job.job_id = 'd6200000-0000-4000-8000-000000000084'
    left join public.ops_registration_customer_messages message on message.scheduled_job_id = job.job_id and message.provider_attempt_count = 1
    where nullable.label = 'booking hash drift claim'
    group by nullable.response, job.status, job.last_error_code
  ),
  '{"error":"booking_fact_changed","markers":0,"result":null,"status":"source_dirty"}'::jsonb,
  'claim booking-hash drift terminalizes source_dirty with provider delta zero'
);

-- A live job whose source event predates the cutoff is pre-marker backlog.
update public.ops_registration_customer_messages
set status = 'accepted'
where id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'automatic begin marker');
update dashboard_private.registration_customer_solapi_activation
set mode = 'live',
    live_test_message_id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'automatic begin marker'),
    live_test_confirmed_at = pg_catalog.clock_timestamp(),
    automatic_delivery_cutoff_at = pg_catalog.clock_timestamp() + interval '1 day'
where message_kind = 'observation_reminder';
insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select 'd6200000-0000-4000-8000-000000000026', observation.id,
  observation.appointment_id, 2111, 'observation_scheduled',
  observation.booking_fact_hash, observation.source_revision,
  activation.automatic_delivery_cutoff_at - interval '1 second'
from public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'd6200000-0000-4000-8000-000000000013'
  and activation.message_kind = 'observation_reminder';
insert into dashboard_private.registration_observation_solapi_event_consumptions(
  event_id, action, job_id
) values ('d6200000-0000-4000-8000-000000000026', 'skipped_off', null);
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id,
  message_kind, source_revision, session_source_revision, booking_fact_hash,
  activation_mode_snapshot, verification_started_at, verification_recipient_hash,
  scheduled_for, due_at, available_at, request_key, status
)
select 'd6200000-0000-4000-8000-000000000085', observation.appointment_id,
  observation.id, 'd6200000-0000-4000-8000-000000000026', observation.task_id,
  'observation_reminder', 2111, observation.source_revision, observation.booking_fact_hash,
  'live', null, null, observation.starts_at,
  pg_catalog.clock_timestamp() - interval '1 hour', pg_catalog.clock_timestamp() - interval '1 hour',
  'd6200000-0000-4000-8000-000000000085', 'pending'
from public.ops_registration_observations observation
where observation.id = 'd6200000-0000-4000-8000-000000000013';
set local role service_role;
insert into dispatch_nullable_results(label, response)
values ('cutoff backlog claim', public.claim_registration_customer_reminder_job_v1());
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'result', nullable.response, 'status', job.status,
      'error', job.last_error_code, 'markers', count(message.id)
    )
    from dispatch_nullable_results nullable
    join dashboard_private.registration_customer_reminder_jobs job on job.job_id = 'd6200000-0000-4000-8000-000000000085'
    left join public.ops_registration_customer_messages message on message.scheduled_job_id = job.job_id and message.provider_attempt_count = 1
    where nullable.label = 'cutoff backlog claim'
    group by nullable.response, job.status, job.last_error_code
  ),
  '{"error":"pre_cutoff_backlog","markers":0,"result":null,"status":"canceled"}'::jsonb,
  'live pre-cutoff backlog is canceled with provider delta zero'
);

-- Build three scheduled observation markers to exercise both terminal provider
-- outcomes and a composite job/message mismatch.
update dashboard_private.registration_customer_solapi_activation
set mode = 'verification',
    live_test_message_id = null,
    live_test_confirmed_at = null,
    automatic_delivery_cutoff_at = null
where message_kind = 'observation_reminder';
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id,
  message_kind, source_revision, session_source_revision, booking_fact_hash,
  activation_mode_snapshot, verification_started_at, verification_recipient_hash,
  scheduled_for, due_at, available_at, request_key, status,
  claim_token, claim_expires_at
)
select fixture.job_id, observation.appointment_id, observation.id,
  'd6200000-0000-4000-8000-000000000014', observation.task_id,
  'observation_reminder', fixture.source_revision, observation.source_revision,
  observation.booking_fact_hash, 'verification', activation.updated_at,
  activation.verification_recipient_hash, observation.starts_at,
  pg_catalog.clock_timestamp(), null, fixture.request_key, 'claimed',
  fixture.claim_token, pg_catalog.clock_timestamp() + interval '5 minutes'
from (
  values
    ('d6200000-0000-4000-8000-000000000086'::uuid, 2201::bigint, 'd6200000-0000-4000-8000-000000000086'::uuid, 'd6200000-0000-4000-8000-000000000096'::uuid),
    ('d6200000-0000-4000-8000-000000000087'::uuid, 2202::bigint, 'd6200000-0000-4000-8000-000000000087'::uuid, 'd6200000-0000-4000-8000-000000000097'::uuid),
    ('d6200000-0000-4000-8000-000000000088'::uuid, 2203::bigint, 'd6200000-0000-4000-8000-000000000088'::uuid, 'd6200000-0000-4000-8000-000000000098'::uuid)
) fixture(job_id, source_revision, request_key, claim_token)
cross join public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'd6200000-0000-4000-8000-000000000013'
  and activation.message_kind = 'observation_reminder';
alter table public.ops_registration_customer_messages
  disable trigger enforce_registration_customer_solapi_delivery_gate_v1;
insert into public.ops_registration_customer_messages(
  id, preview_id, task_id, track_id, appointment_id, observation_id,
  message_kind, source_fingerprint, source_facts_checksum, source_revision,
  recipient_hash, recipient_last4, template_key, template_revision,
  template_checksum, rendered_variables_checksum, rendered_body_checksum,
  rendered_buttons_checksum, dedupe_key, request_key, status, claim_active,
  dispatch_token, provider_attempt_started_at, provider_attempt_count,
  confirmed_by, confirmed_at, delivery_origin, scheduled_job_id, scheduled_for
)
select fixture.message_id, null, observation.task_id, observation.track_id,
  observation.appointment_id, observation.id, 'observation_reminder', repeat('a', 64),
  repeat('2', 64), fixture.source_revision, repeat('b', 64), '0000',
  'observation_reminder', 1, repeat('c', 64), repeat('d', 64), repeat('e', 64), repeat('f', 64),
  dashboard_private.notification_sha256_hex_v1(fixture.message_id::text),
  fixture.message_id::text, 'pending', false, fixture.dispatch_token,
  pg_catalog.clock_timestamp(), 1, null, pg_catalog.clock_timestamp(),
  'scheduled', fixture.job_id, observation.starts_at
from (
  values
    ('d6200000-0000-4000-8000-000000000086'::uuid, 'd6200000-0000-4000-8000-000000000076'::uuid, 'd6200000-0000-4000-8000-000000000066'::uuid, 2201::bigint),
    ('d6200000-0000-4000-8000-000000000087'::uuid, 'd6200000-0000-4000-8000-000000000077'::uuid, 'd6200000-0000-4000-8000-000000000067'::uuid, 2202::bigint),
    ('d6200000-0000-4000-8000-000000000088'::uuid, 'd6200000-0000-4000-8000-000000000078'::uuid, 'd6200000-0000-4000-8000-000000000068'::uuid, 2203::bigint)
) fixture(job_id, message_id, dispatch_token, source_revision)
cross join public.ops_registration_observations observation
where observation.id = 'd6200000-0000-4000-8000-000000000013';
alter table public.ops_registration_customer_messages
  enable trigger enforce_registration_customer_solapi_delivery_gate_v1;
update dashboard_private.registration_customer_reminder_jobs job
set status = 'dispatching', claim_token = null, claim_expires_at = null,
    message_id = fixture.message_id
from (values
  ('d6200000-0000-4000-8000-000000000086'::uuid, 'd6200000-0000-4000-8000-000000000076'::uuid),
  ('d6200000-0000-4000-8000-000000000087'::uuid, 'd6200000-0000-4000-8000-000000000077'::uuid),
  ('d6200000-0000-4000-8000-000000000088'::uuid, 'd6200000-0000-4000-8000-000000000078'::uuid)
) fixture(job_id, message_id)
where job.job_id = fixture.job_id;
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'automatic accepted', public.finalize_registration_customer_reminder_dispatch_v1(
  'd6200000-0000-4000-8000-000000000076', 'd6200000-0000-4000-8000-000000000066',
  'accepted', pg_catalog.jsonb_build_object(
    'providerMessageId', 'synthetic-accepted', 'statusCode', '202',
    'statusMessage', 'accepted', 'observedAt', '2026-08-12T06:00:00Z', 'requestKeyMatched', true
  )
);
insert into dispatch_rpc_results(label, response)
select 'automatic failed hold', public.finalize_registration_customer_reminder_dispatch_v1(
  'd6200000-0000-4000-8000-000000000077', 'd6200000-0000-4000-8000-000000000067',
  'failed_hold', pg_catalog.jsonb_build_object(
    'statusCode', '400', 'statusMessage', 'rejected',
    'observedAt', '2026-08-12T06:00:00Z', 'requestKeyMatched', true
  )
);
reset role;
select is(
  (select pg_catalog.jsonb_build_object('message', message.status, 'job', job.status, 'error', job.last_error_code)
   from public.ops_registration_customer_messages message join dashboard_private.registration_customer_reminder_jobs job on job.message_id = message.id
   where message.id = 'd6200000-0000-4000-8000-000000000076'),
  '{"error":null,"job":"completed","message":"accepted"}'::jsonb,
  'automatic accepted finalization completes the composite job identity'
);
select is(
  (select pg_catalog.jsonb_build_object('message', message.status, 'job', job.status, 'error', job.last_error_code)
   from public.ops_registration_customer_messages message join dashboard_private.registration_customer_reminder_jobs job on job.message_id = message.id
   where message.id = 'd6200000-0000-4000-8000-000000000077'),
  '{"error":"provider_rejected","job":"completed","message":"failed_hold"}'::jsonb,
  'automatic failed_hold finalization completes the job with provider rejection evidence'
);
update dashboard_private.registration_customer_reminder_jobs
set message_id = 'd6200000-0000-4000-8000-000000000076'
where job_id = 'd6200000-0000-4000-8000-000000000088';
set local role service_role;
select throws_ok(
  $$select public.finalize_registration_customer_reminder_dispatch_v1(
      'd6200000-0000-4000-8000-000000000078',
      'd6200000-0000-4000-8000-000000000068',
      'accepted',
      pg_catalog.jsonb_build_object(
        'providerMessageId', 'synthetic-mismatch', 'statusCode', '202',
        'statusMessage', 'accepted', 'observedAt', '2026-08-12T06:00:00Z',
        'requestKeyMatched', true
      )
    )$$,
  '40001', 'registration_customer_reminder_finalize_not_allowed',
  'automatic finalize rejects a composite job/message mismatch'
);
reset role;
select is(
  (select pg_catalog.jsonb_build_object('message', message.status, 'markers', message.provider_attempt_count, 'job', job.status)
   from public.ops_registration_customer_messages message
   join dashboard_private.registration_customer_reminder_jobs job on job.job_id = 'd6200000-0000-4000-8000-000000000088'
   where message.id = 'd6200000-0000-4000-8000-000000000078'),
  '{"job":"dispatching","markers":1,"message":"pending"}'::jsonb,
  'composite mismatch rolls back provider outcome mutation and preserves one marker'
);

-- Provider-check and admin reconcile retain observation identity through the
-- generalized wrappers.
update public.ops_registration_customer_messages
set status = 'unknown',
    provider_attempt_started_at = pg_catalog.clock_timestamp() - interval '16 minutes',
    created_at = pg_catalog.clock_timestamp() - interval '20 minutes',
    confirmed_at = pg_catalog.clock_timestamp() - interval '20 minutes'
where id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim');
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'observation provider check', public.record_registration_customer_message_provider_check_v1(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim'),
  'lookup_context', '{}'::jsonb, null
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'requestKeyPresent', nullif(result.response ->> 'requestKey', '') is not null,
      'observationId', message.observation_id,
      'markers', message.provider_attempt_count
    )
    from dispatch_rpc_results result
    join public.ops_registration_customer_messages message
      on message.id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim')
    where result.label = 'observation provider check'
  ),
  '{"markers":1,"observationId":"d6200000-0000-4000-8000-000000000013","requestKeyPresent":true}'::jsonb,
  'provider-check lookup retains observation identity without adding a marker'
);
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'observation reconciled', public.reconcile_registration_customer_message_v1(
  'd6200000-0000-4000-8000-000000000001',
  (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim'),
  'failed_hold',
  pg_catalog.jsonb_build_object(
    'statusCode', '404', 'statusMessage', 'not accepted',
    'observedAt', '2026-08-12T06:00:00Z', 'requestKeyMatched', true
  ),
  'provider dashboard reviewed', 'd6200000-0000-4000-8000-000000000099'
);
reset role;
select is(
  (select pg_catalog.jsonb_build_object('status', status, 'observationId', observation_id, 'markers', provider_attempt_count)
   from public.ops_registration_customer_messages
   where id = (select (response ->> 'messageId')::uuid from dispatch_rpc_results where label = 'booking claim')),
  '{"markers":1,"observationId":"d6200000-0000-4000-8000-000000000013","status":"failed_hold"}'::jsonb,
  'admin reconcile terminalizes the observation message without a second marker'
);

-- Observation activation OFF atomically cancels both pending and claimed jobs.
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id,
  message_kind, source_revision, session_source_revision, booking_fact_hash,
  activation_mode_snapshot, verification_started_at, verification_recipient_hash,
  scheduled_for, due_at, available_at, request_key, status,
  claim_token, claim_expires_at
)
select fixture.job_id, observation.appointment_id, observation.id,
  'd6200000-0000-4000-8000-000000000014', observation.task_id,
  'observation_reminder', fixture.source_revision, observation.source_revision,
  observation.booking_fact_hash, 'verification', activation.updated_at,
  activation.verification_recipient_hash, observation.starts_at,
  pg_catalog.clock_timestamp(), case when fixture.status = 'pending' then pg_catalog.clock_timestamp() end,
  fixture.request_key, fixture.status, fixture.claim_token,
  case when fixture.status = 'claimed' then pg_catalog.clock_timestamp() + interval '5 minutes' end
from (values
  ('d6200000-0000-4000-8000-000000000089'::uuid, 2401::bigint, 'pending', null::uuid, 'd6200000-0000-4000-8000-000000000089'::uuid),
  ('d6200000-0000-4000-8000-000000000090'::uuid, 2402::bigint, 'claimed', 'd6200000-0000-4000-8000-000000000095'::uuid, 'd6200000-0000-4000-8000-000000000094'::uuid)
) fixture(job_id, source_revision, status, claim_token, request_key)
cross join public.ops_registration_observations observation
cross join dashboard_private.registration_customer_solapi_activation activation
where observation.id = 'd6200000-0000-4000-8000-000000000013'
  and activation.message_kind = 'observation_reminder';
set local role service_role;
insert into dispatch_rpc_results(label, response)
select 'observation activation off', public.set_registration_customer_solapi_activation_v1(
  'd6200000-0000-4000-8000-000000000001', 'observation_reminder', 'off',
  pg_catalog.jsonb_build_object('requestKey', 'd6200000-0000-4000-8000-000000000090')
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'canceled', count(*) filter (where job.status = 'canceled' and job.last_error_code = 'activation_off'),
      'claims', count(*) filter (where job.claim_token is not null),
      'markers', count(message.id)
    )
    from dashboard_private.registration_customer_reminder_jobs job
    left join public.ops_registration_customer_messages message on message.scheduled_job_id = job.job_id and message.provider_attempt_count = 1
    where job.job_id in ('d6200000-0000-4000-8000-000000000089', 'd6200000-0000-4000-8000-000000000090')
  ),
  '{"canceled":2,"claims":0,"markers":0}'::jsonb,
  'observation activation OFF clears pending and claimed jobs with provider delta zero'
);

select * from finish();
rollback;
