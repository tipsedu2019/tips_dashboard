begin;

select plan(27);

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

set local role anon;
select throws_ok(
  $$select public.claim_registration_customer_reminder_job_v1()$$,
  '42501', null, 'anon cannot invoke the legacy queue claim'
);
reset role;

create temporary table queue_legacy_fixture as
select appointment.id as appointment_id, appointment.task_id
from public.ops_registration_appointments appointment
limit 1;

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

select ok(
  not exists(
    select 1 from information_schema.routine_privileges privilege
    where privilege.routine_name in (
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
