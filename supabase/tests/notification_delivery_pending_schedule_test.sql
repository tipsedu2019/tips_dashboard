begin;
select plan(4);

create temp table notification_delivery_pending_schedule_fixture(
  delivery_id uuid primary key
) on commit drop;

update dashboard_private.notification_runtime_flags
set enabled = true,
    revision = revision + 1,
    updated_at = pg_catalog.clock_timestamp()
where flag_key = 'notification_control_plane_dispatch_registration_enabled';

update dashboard_private.notification_rules
set enabled = true,
    updated_at = pg_catalog.clock_timestamp()
where id = '81000000-0000-4000-8000-000000000001'::uuid;

do $$
declare
  v_rule dashboard_private.notification_rules%rowtype;
  v_event_id uuid;
  v_delivery_id uuid;
begin
  select rule_row.*
  into strict v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = '81000000-0000-4000-8000-000000000001'::uuid;

  insert into dashboard_private.notification_events(
    scope_key,
    workflow_key,
    event_key,
    source_type,
    source_id,
    source_revision,
    occurrence_key,
    occurred_at,
    payload_schema_version,
    payload,
    rule_snapshot
  ) values (
    'global',
    'registration',
    'registration.observation_scheduled',
    'notification_delivery_pending_schedule_regression',
    'pending-delivery-source',
    1,
    'pending-delivery-occurrence',
    pg_catalog.clock_timestamp() - interval '1 minute',
    3,
    '{}'::jsonb,
    '[]'::jsonb
  ) returning id into v_event_id;

  v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
    v_event_id,
    v_rule.id,
    v_rule.revision,
    v_rule.active_template_id,
    0,
    'pending-delivery-target-set',
    'connection',
    'connection:pending-delivery-regression',
    null,
    'google_chat.subject',
    '{"connection_key":"google_chat.subject"}'::jsonb,
    'Pending delivery regression',
    'A pending delivery must use scheduled_for, not a retry timestamp.',
    '/admin/registration/pending-delivery-regression',
    pg_catalog.clock_timestamp() - interval '1 minute',
    null
  );

  insert into notification_delivery_pending_schedule_fixture(delivery_id)
  values (v_delivery_id);
end;
$$;

select is(
  (
    select delivery.status
    from dashboard_private.notification_deliveries delivery
    join notification_delivery_pending_schedule_fixture fixture
      on fixture.delivery_id = delivery.id
  ),
  'pending',
  'an enabled rule materializes a pending delivery'
);

select ok(
  (
    select delivery.next_attempt_at is null
    from dashboard_private.notification_deliveries delivery
    join notification_delivery_pending_schedule_fixture fixture
      on fixture.delivery_id = delivery.id
  ),
  'a first pending delivery has no retry schedule'
);

select is(
  (
    select pg_catalog.count(*)
    from public.claim_notification_deliveries_v1(
      'pending-delivery-regression-worker',
      1,
      60
    ) claim
    join notification_delivery_pending_schedule_fixture fixture
      on fixture.delivery_id = (claim ->> 'delivery_id')::uuid
  ),
  1::bigint,
  'the pending delivery is immediately claimable from scheduled_for'
);

select is(
  (
    select delivery.status
    from dashboard_private.notification_deliveries delivery
    join notification_delivery_pending_schedule_fixture fixture
      on fixture.delivery_id = delivery.id
  ),
  'claimed',
  'claiming the pending delivery preserves the retry-schedule constraint'
);

select * from finish();
rollback;
