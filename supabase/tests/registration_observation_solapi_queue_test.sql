begin;

select plan(18);

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

select * from finish();
rollback;
