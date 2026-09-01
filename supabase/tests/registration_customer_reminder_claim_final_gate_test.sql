begin;

select no_plan();

select has_function(
  'public', 'claim_registration_customer_reminder_job_v1', array[]::text[],
  'retired reminder claim compatibility function exists'
);
select has_function(
  'public', 'has_registration_customer_reminder_backlog_v1', array[]::text[],
  'retired reminder backlog compatibility function exists'
);
select has_function(
  'public', 'manage_registration_customer_reminder_schedule_v1', array['text'],
  'retired reminder schedule compatibility function exists'
);
select has_function(
  'public', 'set_registration_customer_reminder_settings_v1',
  array['uuid', 'boolean', 'smallint', 'bigint', 'jsonb'],
  'retired reminder settings compatibility function exists'
);
select function_privs_are(
  'public', 'claim_registration_customer_reminder_job_v1', array[]::text[],
  'service_role', array['EXECUTE'], 'claim remains service-only'
);
select function_privs_are(
  'public', 'claim_registration_customer_reminder_job_v1', array[]::text[],
  'authenticated', array[]::text[], 'browser roles cannot claim reminder work'
);
select function_privs_are(
  'public', 'has_registration_customer_reminder_backlog_v1', array[]::text[],
  'service_role', array['EXECUTE'], 'backlog check remains service-only'
);
select function_privs_are(
  'public', 'has_registration_customer_reminder_backlog_v1', array[]::text[],
  'authenticated', array[]::text[], 'browser roles cannot inspect reminder backlog'
);
select is(
  (
    select pg_catalog.jsonb_object_agg(
      expected.function_key,
      pg_catalog.jsonb_build_object(
        'PUBLIC', pg_catalog.has_function_privilege(
          'public', procedure.oid, 'EXECUTE'
        ),
        'anon', pg_catalog.has_function_privilege(
          'anon', procedure.oid, 'EXECUTE'
        ),
        'authenticated', pg_catalog.has_function_privilege(
          'authenticated', procedure.oid, 'EXECUTE'
        ),
        'service_role', pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        )
      )
      order by expected.function_key
    )
    from (
      values
        (
          'backlog',
          'public.has_registration_customer_reminder_backlog_v1()'
        ),
        (
          'claim',
          'public.claim_registration_customer_reminder_job_v1()'
        ),
        (
          'manage',
          'public.manage_registration_customer_reminder_schedule_v1(text)'
        ),
        (
          'set',
          'public.set_registration_customer_reminder_settings_v1(uuid,boolean,smallint,bigint,jsonb)'
        )
    ) expected(function_key, signature)
    left join pg_catalog.pg_proc procedure
      on procedure.oid = pg_catalog.to_regprocedure(expected.signature)
  ),
  '{
    "backlog": {"PUBLIC": false, "anon": false, "authenticated": false, "service_role": true},
    "claim": {"PUBLIC": false, "anon": false, "authenticated": false, "service_role": true},
    "manage": {"PUBLIC": false, "anon": false, "authenticated": false, "service_role": true},
    "set": {"PUBLIC": false, "anon": false, "authenticated": false, "service_role": true}
  }'::jsonb,
  'retired reminder entrypoints expose EXECUTE only to service_role'
);

select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.claim_registration_customer_reminder_job_v1()'::regprocedure
    )) ~ 'registration_customer_reminder_worker_unauthorized'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.claim_registration_customer_reminder_job_v1()'::regprocedure
      )) ~ 'return null;'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.claim_registration_customer_reminder_job_v1()'::regprocedure
      )) !~ 'registration_customer_reminder_jobs|ops_registration_customer_messages|resolve_registration_customer_message'
  ),
  'retired claim authorizes service_role and returns no work without reading delivery state'
);
select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.has_registration_customer_reminder_backlog_v1()'::regprocedure
    )) ~ 'registration_customer_reminder_worker_unauthorized'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.has_registration_customer_reminder_backlog_v1()'::regprocedure
      )) ~ 'return false;'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.has_registration_customer_reminder_backlog_v1()'::regprocedure
      )) !~ 'registration_customer_reminder_jobs|registration_customer_solapi'
  ),
  'retired backlog authorizes service_role and reports no automatic work'
);
select is(
  (
    select proc.proowner = 'postgres'::regrole
      and proc.prosecdef
      and proc.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc proc
    where proc.oid = 'public.claim_registration_customer_reminder_job_v1()'::regprocedure
  ),
  true,
  'claim keeps postgres ownership, SECURITY DEFINER, and an empty search path'
);
select is(
  (
    select proc.proowner = 'postgres'::regrole
      and proc.prosecdef
      and proc.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc proc
    where proc.oid = 'public.has_registration_customer_reminder_backlog_v1()'::regprocedure
  ),
  true,
  'backlog keeps postgres ownership, SECURITY DEFINER, and an empty search path'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_trigger trigger
    join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'dashboard_private'
      and relation.relname = 'registration_customer_reminder_settings'
      and trigger.tgname = 'sync_registration_customer_reminder_cron_active'
      and not trigger.tgisinternal
  ),
  0,
  'automatic reminder cron trigger is absent'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from cron.job job
    where job.jobname = 'tips-registration-customer-reminder-v1'
  ),
  0,
  'automatic reminder cron job is absent'
);
select is(
  coalesce((
    select settings.enabled
    from dashboard_private.registration_customer_reminder_settings settings
    where settings.singleton
  ), true),
  false,
  'automatic reminder settings singleton exists disabled'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from dashboard_private.registration_customer_reminder_jobs job
    where job.status in ('pending', 'claimed')
  ),
  0,
  'no automatic reminder job remains claimable'
);
select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.manage_registration_customer_reminder_schedule_v1(text)'::regprocedure
    )) ~ 'registration_customer_reminder_schedule_retired''[[:space:]]+using errcode = ''55000'''
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.manage_registration_customer_reminder_schedule_v1(text)'::regprocedure
      )) ~ 'cron.unschedule\(''tips-registration-customer-reminder-v1''\)'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.manage_registration_customer_reminder_schedule_v1(text)'::regprocedure
      )) !~ 'cron.schedule'
  ),
  'schedule management rejects installation and removes only the exact retired job name'
);
select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.set_registration_customer_reminder_settings_v1(uuid,boolean,smallint,bigint,jsonb)'::regprocedure
    )) ~ 'p_enabled is distinct from false'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.set_registration_customer_reminder_settings_v1(uuid,boolean,smallint,bigint,jsonb)'::regprocedure
      )) ~ 'registration_customer_reminder_automatic_delivery_retired''[[:space:]]+using errcode = ''55000'''
  ),
  'settings mutation cannot re-enable automatic delivery'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.create_registration_customer_message_preview_v1(uuid,text,uuid,jsonb)'
  ) is not null
    and pg_catalog.to_regprocedure(
      'public.claim_registration_customer_message_v1(uuid,uuid,text,jsonb)'
    ) is not null,
  'explicit preview and claim APIs remain available separately'
);

insert into auth.users(
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '99800000-0000-4000-8000-000000000101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'retired-reminder-admin@registration-runtime.invalid',
  '',
  pg_catalog.now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"retired-reminder-final-gate"}'::jsonb,
  pg_catalog.now(),
  pg_catalog.now()
);

insert into public.profiles(id, role, created_at, updated_at)
values (
  '99800000-0000-4000-8000-000000000101',
  'admin',
  pg_catalog.now(),
  pg_catalog.now()
)
on conflict (id) do update
set role = excluded.role,
    updated_at = excluded.updated_at;

create or replace function pg_temp.registration_customer_reminder_retirement_snapshot_v1()
returns jsonb
language sql
stable
set search_path = ''
as $snapshot$
  select pg_catalog.jsonb_build_object(
    'cronJobs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(job)
        order by job.jobid
      )
      from cron.job job
      where job.jobname = 'tips-registration-customer-reminder-v1'
    ), '[]'::jsonb),
    'settings', coalesce((
      select pg_catalog.to_jsonb(settings)
      from dashboard_private.registration_customer_reminder_settings settings
      where settings.singleton
    ), 'null'::jsonb),
    'workerHeartbeats', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(heartbeat)
        order by heartbeat.singleton
      )
      from dashboard_private.registration_customer_reminder_worker_heartbeats heartbeat
    ), '[]'::jsonb),
    'reminderJobs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(job)
        order by job.job_id
      )
      from dashboard_private.registration_customer_reminder_jobs job
    ), '[]'::jsonb),
    'observationConsumptions', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(consumption)
        order by consumption.event_id
      )
      from dashboard_private.registration_observation_solapi_event_consumptions consumption
    ), '[]'::jsonb),
    'scheduledMessages', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(message)
        order by message.id
      )
      from public.ops_registration_customer_messages message
      where message.delivery_origin = 'scheduled'
        and message.message_kind in (
          'appointment_reminder',
          'observation_reminder'
        )
    ), '[]'::jsonb),
    'reminderNotificationEvents', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(event)
        order by event.id
      )
      from dashboard_private.notification_events event
      where event.workflow_key = 'registration'
        and event.event_key in (
          'registration.appointment_reminder_due',
          'registration.observation_reminder_due',
          'registration.observation_feedback_due'
        )
    ), '[]'::jsonb),
    'reminderNotificationDeliveries', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(delivery)
        order by delivery.id
      )
      from dashboard_private.notification_deliveries delivery
      join dashboard_private.notification_events event
        on event.id = delivery.event_id
      where event.workflow_key = 'registration'
        and event.event_key in (
          'registration.appointment_reminder_due',
          'registration.observation_reminder_due',
          'registration.observation_feedback_due'
        )
    ), '[]'::jsonb),
    'reminderChatJobs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(job)
        order by job.job_id
      )
      from dashboard_private.registration_observation_chat_jobs job
      where job.event_key in (
        'registration.observation_reminder_due',
        'registration.observation_feedback_due'
      )
    ), '[]'::jsonb)
  );
$snapshot$;

create temporary table retired_reminder_runtime_baseline on commit drop as
select pg_temp.registration_customer_reminder_retirement_snapshot_v1() as snapshot;

create temporary table retired_reminder_settings_call on commit drop as
select settings.lead_hours, settings.revision
from dashboard_private.registration_customer_reminder_settings settings
where settings.singleton;
grant select on retired_reminder_settings_call to service_role;

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$select public.manage_registration_customer_reminder_schedule_v1('install')$$,
  '55000',
  'registration_customer_reminder_schedule_retired',
  'service worker cannot install the retired automatic reminder schedule'
);
select throws_ok(
  $$
    select public.set_registration_customer_reminder_settings_v1(
      '99800000-0000-4000-8000-000000000101',
      true,
      (select settings.lead_hours from retired_reminder_settings_call settings),
      (select settings.revision from retired_reminder_settings_call settings),
      '{}'::jsonb
    )
  $$,
  '55000',
  'registration_customer_reminder_automatic_delivery_retired',
  'service worker cannot re-enable retired automatic reminder delivery'
);
select is(
  public.claim_registration_customer_reminder_job_v1(),
  null::jsonb,
  'service worker receives no automatic claim'
);
select is(
  public.has_registration_customer_reminder_backlog_v1(),
  false,
  'service worker sees no automatic backlog'
);
reset role;

select is(
  pg_temp.registration_customer_reminder_retirement_snapshot_v1(),
  (select baseline.snapshot from retired_reminder_runtime_baseline baseline),
  'retired schedule, settings, claim, and backlog calls leave automatic reminder artifacts unchanged'
);

grant execute on function public.claim_registration_customer_reminder_job_v1()
  to authenticated;
grant execute on function public.has_registration_customer_reminder_backlog_v1()
  to authenticated;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.claim_registration_customer_reminder_job_v1()$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'claim rejects browser roles before protected reads'
);
select throws_ok(
  $$select public.has_registration_customer_reminder_backlog_v1()$$,
  '42501', 'registration_customer_reminder_worker_unauthorized',
  'backlog rejects browser roles before protected reads'
);
reset role;
revoke all on function public.claim_registration_customer_reminder_job_v1()
  from authenticated;
revoke all on function public.has_registration_customer_reminder_backlog_v1()
  from authenticated;

select * from finish();
rollback;
