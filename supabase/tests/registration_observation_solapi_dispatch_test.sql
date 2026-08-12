begin;

select plan(59);

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
update dashboard_private.registration_customer_reminder_worker_heartbeats
set succeeded_at = pg_catalog.clock_timestamp() - interval '4 minutes 59 seconds',
    updated_at = pg_catalog.clock_timestamp()
where singleton;
select is(
  public.inspect_registration_observation_solapi_readiness_v1()
    -> 'schedule' ->> 'heartbeatCurrent',
  'true',
  'heartbeat at the five-minute boundary remains current'
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
grant execute on function pg_temp.dispatch_contract(jsonb, text, text) to service_role;
grant execute on function pg_temp.dispatch_readiness_contract(jsonb, text, text) to service_role;
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
insert into dispatch_rpc_results(label, response)
select 'booking finalized', public.finalize_registration_customer_message_v1(
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
      'observationId', history.response -> 'items' -> 0 ->> 'observationId'
    )
    from dispatch_rpc_results marker
    join dispatch_rpc_results finalized on finalized.label = 'booking finalized'
    join dispatch_rpc_results history on history.label = 'booking history'
    where marker.label = 'booking marker'
  ),
  '{"finalStatus":"accepted","markerAllowed":true,"observationId":"d6200000-0000-4000-8000-000000000013","sourceId":"d6200000-0000-4000-8000-000000000013"}'::jsonb,
  'manual marker, finalize, and history retain canonical observation identity'
);

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
alter table dashboard_private.registration_customer_reminder_settings
  disable trigger sync_registration_customer_reminder_cron_active;
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

select * from finish();
rollback;
