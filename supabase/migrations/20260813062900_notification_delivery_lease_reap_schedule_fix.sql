begin;

set local lock_timeout = '5s';

-- A claimed delivery has not begun a provider attempt. Returning it to
-- pending must therefore clear next_attempt_at: that timestamp is reserved
-- for retry_wait by notification_deliveries_retry_schedule_check.
create or replace function public.reap_notification_leases_v1(
  p_worker_id text,
  p_batch_size integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fanout integer := 0;
  v_rule integer := 0;
  v_target integer := 0;
  v_claimed integer := 0;
  v_sending integer := 0;
begin
  if nullif(pg_catalog.btrim(p_worker_id), '') is null
    or p_batch_size is null
    or p_batch_size not between 1 and 100
  then
    raise exception 'notification_lease_reap_invalid' using errcode = '22023';
  end if;

  with expired as (
    select job.id
    from dashboard_private.notification_event_fanout_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at < pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_event_fanout_jobs job
    set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired', updated_at = pg_catalog.clock_timestamp()
    from expired where job.id = expired.id returning job.id
  ) select count(*) into v_fanout from reaped;

  with expired as (
    select job.id
    from dashboard_private.notification_rule_reconciliation_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at < pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_rule_reconciliation_jobs job
    set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired', updated_at = pg_catalog.clock_timestamp()
    from expired where job.id = expired.id returning job.id
  ) select count(*) into v_rule from reaped;

  with expired as (
    select job.id
    from dashboard_private.notification_target_reconciliation_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at < pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_target_reconciliation_jobs job
    set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired', updated_at = pg_catalog.clock_timestamp()
    from expired where job.id = expired.id returning job.id
  ) select count(*) into v_target from reaped;

  with expired as (
    select delivery.id
    from dashboard_private.notification_deliveries delivery
    where delivery.status = 'claimed'
      and delivery.lease_expires_at < pg_catalog.clock_timestamp()
    order by delivery.lease_expires_at, delivery.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_deliveries delivery
    set status = 'pending', status_reason = null,
        next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired',
        last_error_summary = 'worker lease expired before dispatch start',
        updated_at = pg_catalog.clock_timestamp()
    from expired where delivery.id = expired.id returning delivery.id
  ) select count(*) into v_claimed from reaped;

  with expired as (
    select delivery.id
    from dashboard_private.notification_deliveries delivery
    where delivery.status = 'sending'
      and delivery.lease_expires_at < pg_catalog.clock_timestamp()
    order by delivery.lease_expires_at, delivery.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_deliveries delivery
    set status = 'delivery_unknown',
        status_reason = 'worker_lost_after_send_start',
        next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lost_after_send_start',
        last_error_summary = 'worker lease expired after dispatch start',
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from expired where delivery.id = expired.id returning delivery.id
  ) select count(*) into v_sending from reaped;

  update dashboard_private.notification_dispatch_ownership_claims ownership
  set state = 'closed', updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_deliveries delivery,
       dashboard_private.notification_events event_row
  where delivery.event_id = event_row.id
    and delivery.status = 'delivery_unknown'
    and delivery.status_reason = 'worker_lost_after_send_start'
    and ownership.workflow_key = event_row.workflow_key
    and ownership.occurrence_key = event_row.occurrence_key
    and ownership.rule_id = delivery.rule_id
    and ownership.channel_key = delivery.channel_key
    and ownership.target_key = delivery.target_key
    and ownership.target_generation = delivery.target_generation
    and ownership.owner_kind = 'canonical'
    and ownership.state = 'dispatch_started';

  return pg_catalog.jsonb_build_object(
    'reaped_count', v_fanout + v_rule + v_target + v_claimed + v_sending,
    'fanout', v_fanout,
    'rule_reconciliation', v_rule,
    'target_reconciliation', v_target,
    'claimed_deliveries', v_claimed,
    'unknown_deliveries', v_sending,
    'worker_id', p_worker_id
  );
end;
$$;

alter function public.reap_notification_leases_v1(text, integer) owner to postgres;
revoke all on function public.reap_notification_leases_v1(text, integer)
from public, anon, authenticated;
grant execute on function public.reap_notification_leases_v1(text, integer)
to service_role;

commit;
