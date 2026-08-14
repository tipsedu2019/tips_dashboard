begin;
select plan(24);

select has_table(
  'dashboard_private',
  'lightweight_registration_alert_states',
  'durable lightweight alert states exist'
);
select has_table(
  'dashboard_private',
  'lightweight_registration_alert_runtime_settings',
  'passive runtime gate exists'
);
select is(
  (select settings.enabled
   from dashboard_private.lightweight_registration_alert_runtime_settings settings
   where settings.singleton),
  false,
  'migration installs the lightweight path provider-off'
);
select has_table(
  'dashboard_private',
  'lightweight_registration_alert_deliveries',
  'seven-day lightweight alert receipts exist'
);
select has_table(
  'dashboard_private',
  'lightweight_registration_alert_daily_runs',
  'daily run ledger exists'
);
select ok(
  (select pg_catalog.bool_and(class_row.relrowsecurity)
   from pg_catalog.pg_class class_row
   where class_row.oid in (
     'dashboard_private.lightweight_registration_alert_states'::regclass,
     'dashboard_private.lightweight_registration_alert_deliveries'::regclass,
     'dashboard_private.lightweight_registration_alert_daily_runs'::regclass
   ))
  and not has_table_privilege(
    'authenticated',
    'dashboard_private.lightweight_registration_alert_states',
    'select'
  ),
  'private alert storage is fail-closed'
);

update dashboard_private.lightweight_registration_alert_runtime_settings
set enabled = true,
    updated_at = statement_timestamp()
where singleton;

create or replace function dashboard_private.lightweight_registration_alert_now_v1()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '10:01') at time zone 'Asia/Seoul')
$$;

insert into public.ops_tasks(id, title, type, status)
select
  ('b1000000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text, 12, '0'))::uuid,
  'lightweight alert fixture ' || ordinal,
  'registration',
  'requested'
from pg_catalog.generate_series(1, 5) ordinal;

insert into public.ops_registration_appointments(
  id,
  task_id,
  kind,
  scheduled_at,
  place,
  status,
  notification_revision,
  created_at
) values
  (
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'level_test',
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '14:00') at time zone 'Asia/Seoul'),
    '본관',
    'scheduled',
    1,
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '09:00') at time zone 'Asia/Seoul')
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000002',
    'visit_consultation',
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '15:00') at time zone 'Asia/Seoul'),
    '본관',
    'scheduled',
    2,
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '09:30') at time zone 'Asia/Seoul')
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    'b1000000-0000-4000-8000-000000000003',
    'observation_class',
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '16:00') at time zone 'Asia/Seoul'),
    '별관',
    'scheduled',
    1,
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '09:45') at time zone 'Asia/Seoul')
  ),
  (
    'a1000000-0000-4000-8000-000000000004',
    'b1000000-0000-4000-8000-000000000004',
    'visit_consultation',
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '17:00') at time zone 'Asia/Seoul'),
    '본관',
    'scheduled',
    1,
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '10:05') at time zone 'Asia/Seoul')
  ),
  (
    'a1000000-0000-4000-8000-000000000005',
    'b1000000-0000-4000-8000-000000000005',
    'level_test',
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '18:00') at time zone 'Asia/Seoul'),
    '본관',
    'canceled',
    1,
    (((statement_timestamp() at time zone 'Asia/Seoul')::date + time '09:00') at time zone 'Asia/Seoul')
  );

select is(
  (select pg_catalog.count(*)
   from dashboard_private.lightweight_registration_alert_states state
   where state.event_kind = 'booking_confirmed'),
  7::bigint,
  'booking insert creates one customer row for level and two external rows for visit and observation'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.lightweight_registration_alert_states state
   where state.source_id = 'a1000000-0000-4000-8000-000000000001'
     and state.channel = 'google_chat'),
  0::bigint,
  'level test never creates Google Chat work'
);
select is(
  public.enqueue_lightweight_registration_booking_alerts_v1(
    'visit_consultation',
    'a1000000-0000-4000-8000-000000000002',
    2
  ),
  0,
  'booking replay is idempotent'
);

insert into dashboard_private.lightweight_registration_alert_daily_runs(
  kst_date,
  cutoff_at,
  status,
  finished_at,
  error_code
) values (
  (statement_timestamp() at time zone 'Asia/Seoul')::date,
  ((((statement_timestamp() at time zone 'Asia/Seoul')::date + time '10:00') at time zone 'Asia/Seoul')),
  'failed',
  statement_timestamp(),
  'transient_failure'
);

select is(
  public.enqueue_due_lightweight_registration_reminders_v1() ->> 'status',
  'completed',
  'a failed same-day run can resume and complete'
);
select is(
  (select run.candidate_count
   from dashboard_private.lightweight_registration_alert_daily_runs run),
  3,
  'daily run includes only pre-cutoff scheduled same-day sources'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.lightweight_registration_alert_states state
   where state.event_kind = 'same_day_reminder'),
  5::bigint,
  'daily run creates the exact customer and Chat reminder matrix'
);
select is(
  public.enqueue_due_lightweight_registration_reminders_v1() ->> 'status',
  'already_processed',
  'same local date run is processed only once'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.lightweight_registration_alert_states state
   where state.event_kind = 'same_day_reminder'),
  5::bigint,
  'daily replay creates no duplicate state'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.lightweight_registration_alert_states state
   where state.source_id = 'a1000000-0000-4000-8000-000000000004'
     and state.event_kind = 'same_day_reminder'),
  0::bigint,
  'post-cutoff same-day booking receives no catch-up reminder'
);

update dashboard_private.lightweight_registration_alert_deliveries delivery
set status = 'accepted',
    terminalized_at = statement_timestamp() - interval '8 days',
    updated_at = statement_timestamp() - interval '8 days'
where delivery.state_id = (
  select state.id
  from dashboard_private.lightweight_registration_alert_states state
  where state.source_id = 'a1000000-0000-4000-8000-000000000001'
    and state.event_kind = 'booking_confirmed'
);

select is(
  public.prune_lightweight_registration_alert_history_v1(500)
    ->> 'deliveryReceiptsDeleted',
  '1',
  'seven-day cleanup deletes an expired terminal receipt'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.lightweight_registration_alert_deliveries delivery
   join dashboard_private.lightweight_registration_alert_states state
     on state.id = delivery.state_id
   where state.source_id = 'a1000000-0000-4000-8000-000000000001'
     and state.event_kind = 'booking_confirmed'),
  0::bigint,
  'expired receipt is gone'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.lightweight_registration_alert_states state
   where state.source_id = 'a1000000-0000-4000-8000-000000000001'
     and state.event_kind = 'booking_confirmed'),
  1::bigint,
  'durable state remains after receipt cleanup'
);

with states as (
  insert into dashboard_private.lightweight_registration_alert_states(
    source_kind,
    source_id,
    source_revision,
    event_kind,
    channel,
    event_key,
    result,
    last_processed_at
  )
  select
    'level_test',
    gen_random_uuid(),
    1,
    'booking_confirmed',
    'customer_alimtalk',
    'bulk-' || series.value::text,
    'accepted',
    statement_timestamp() - interval '8 days'
  from pg_catalog.generate_series(1, 101) series(value)
  returning id
)
insert into dashboard_private.lightweight_registration_alert_deliveries(
  state_id,
  source_revision,
  status,
  terminalized_at,
  created_at,
  updated_at
)
select
  states.id,
  1,
  'accepted',
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '8 days',
  statement_timestamp() - interval '8 days'
from states;

select is(
  public.prune_lightweight_registration_alert_history_v1(10)
    ->> 'deliveryReceiptsDeleted',
  '101',
  'bounded batches drain the full seven-day receipt backlog'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.lightweight_registration_alert_deliveries delivery
   where delivery.terminalized_at <= statement_timestamp() - interval '7 days'),
  0::bigint,
  'no receipt remains beyond seven days after cleanup'
);

select is(
  public.manage_lightweight_registration_alert_schedule_v1('install_inactive')
    ->> 'active',
  'false',
  'schedule install is inactive by default'
);
select is(
  (select pg_catalog.jsonb_build_object(
     'count', pg_catalog.count(*),
     'active', pg_catalog.count(*) filter (where job.active),
     'schedule', pg_catalog.min(job.schedule)
   )
   from cron.job job
   where job.jobname = 'tips-lightweight-registration-reminder-v1'),
  '{"count":1,"active":0,"schedule":"0 1 * * *"}'::jsonb,
  'only one exact 10:00 KST inactive job exists'
);
select is(
  public.manage_lightweight_registration_alert_schedule_v1('remove')
    ->> 'active',
  'false',
  'test schedule is removed without activation'
);
select is(
  (select pg_catalog.count(*)
   from cron.job job
   where job.jobname = 'tips-lightweight-registration-reminder-v1'),
  0::bigint,
  'no schedule remains after the test'
);

select * from finish();
rollback;
