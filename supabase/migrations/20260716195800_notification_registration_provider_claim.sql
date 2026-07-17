begin;

set local lock_timeout = '5s';

-- customer_message delivery is owned by the registration SOLAPI executor.
-- Replacing the already-deployed worker RPC in a forward migration prevents
-- the generic worker and the specialized provider route from claiming the
-- same canonical delivery.
create or replace function public.claim_notification_deliveries_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
begin
  if not dashboard_private.notification_worker_bounds_valid_v1(
    p_worker_id, p_batch_size, p_lease_seconds
  ) then
    raise exception 'notification_worker_claim_invalid' using errcode = '22023';
  end if;

  for v_delivery in
    with candidates as (
      select delivery.id
      from dashboard_private.notification_deliveries delivery
      join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
      join dashboard_private.notification_dispatch_ownership_claims ownership
        on ownership.workflow_key = event_row.workflow_key
       and ownership.occurrence_key = event_row.occurrence_key
       and ownership.rule_id = delivery.rule_id
       and ownership.channel_key = delivery.channel_key
       and ownership.target_key = delivery.target_key
       and ownership.target_generation = delivery.target_generation
       and ownership.owner_kind = 'canonical'
       and ownership.state = 'reserved'
      where delivery.status in ('pending', 'retry_wait')
        and delivery.channel_key <> 'customer_message'
        and delivery.scheduled_for <= pg_catalog.clock_timestamp()
        and coalesce(delivery.next_attempt_at, delivery.scheduled_for) <= pg_catalog.clock_timestamp()
        and delivery.attempt_count < delivery.max_attempts
      order by coalesce(delivery.next_attempt_at, delivery.scheduled_for), delivery.created_at, delivery.id
      for update skip locked
      limit p_batch_size
    )
    update dashboard_private.notification_deliveries delivery
    set status = 'claimed',
        status_reason = null,
        claimed_by = p_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
        next_attempt_at = null,
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  loop
    return next (
      select pg_catalog.jsonb_build_object(
        'delivery_id', v_delivery.id,
        'claim_token', v_delivery.claim_token,
        'event_id', event_row.id,
        'workflow_key', event_row.workflow_key,
        'event_key', event_row.event_key,
        'source_type', event_row.source_type,
        'source_id', event_row.source_id,
        'source_revision', case when event_row.source_revision is null then null else event_row.source_revision::text end,
        'rule_id', v_delivery.rule_id,
        'rule_revision', v_delivery.rule_revision::text,
        'attempt_count', v_delivery.attempt_count,
        'max_attempts', v_delivery.max_attempts,
        'target_generation', v_delivery.target_generation::text,
        'scheduled_for', v_delivery.scheduled_for,
        'retry_window_ends_at', case
          when event_row.workflow_key = 'registration'
            and event_row.event_key = 'registration.appointment_reminder_due'
            then event_row.payload #>> '{appointment,scheduled_at}'
          else null
        end,
        'channel_key', v_delivery.channel_key,
        'target', pg_catalog.jsonb_build_object(
          'target_kind', v_delivery.target_kind,
          'target_key', v_delivery.target_key,
          'target_profile_id', v_delivery.target_profile_id,
          'connection_key', v_delivery.connection_key,
          'target_snapshot', v_delivery.target_snapshot
        )
      )
      from dashboard_private.notification_events event_row
      where event_row.id = v_delivery.event_id
    );
  end loop;
  return;
end;
$$;

-- Customer-message delivery state must be reconciled together with the
-- registration business message. The generic operator RPC cannot preserve
-- that cross-ledger invariant, so route it to the specialized workflow.
create or replace function public.reconcile_notification_delivery_v1(
  p_delivery_id uuid,
  p_resolution text,
  p_reason text,
  p_request_id uuid,
  p_duplicate_risk_accepted boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_response jsonb;
begin
  v_role := public.current_dashboard_role();
  if (select auth.uid()) is null or v_role not in ('admin', 'staff') then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_delivery_id is null
    or p_resolution is null
    or p_resolution not in ('mark_sent', 'mark_failed', 'approve_retry')
    or nullif(pg_catalog.btrim(p_reason), '') is null
    or pg_catalog.octet_length(p_reason) > 96
    or p_request_id is null
    or p_duplicate_risk_accepted is null
  then
    raise exception 'notification_delivery_reconciliation_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'delivery_id', p_delivery_id,
    'resolution', p_resolution, 'reason', p_reason,
    'duplicate_risk_accepted', p_duplicate_risk_accepted
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if found then
    if v_ledger.request_kind <> 'delivery_reconciliation'
      or v_ledger.request_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger.response_payload;
  end if;

  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found then
    raise exception 'notification_delivery_not_found' using errcode = 'P0002';
  end if;
  if v_delivery.channel_key = 'customer_message' then
    raise exception 'notification_customer_message_specialized_executor_required'
      using errcode = '55000';
  end if;

  if v_delivery.status = 'delivery_unknown' then
    if v_role <> 'admin' or not p_duplicate_risk_accepted then
      raise exception 'notification_duplicate_risk_confirmation_required' using errcode = '42501';
    end if;
  elsif p_resolution = 'approve_retry' then
    if v_delivery.status <> 'failed'
      or v_delivery.status_reason not in (
        'connection_missing', 'provider_definite_rejection', 'retry_window_closed'
      )
    then
      raise exception 'notification_delivery_retry_not_allowed' using errcode = '55000';
    end if;
  else
    raise exception 'notification_delivery_reconciliation_not_allowed' using errcode = '55000';
  end if;

  if p_resolution = 'approve_retry' then
    select event_row.* into strict v_event
    from dashboard_private.notification_events event_row
    where event_row.id = v_delivery.event_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_event.workflow_key || ':' || v_event.occurrence_key || ':' ||
      v_delivery.rule_id::text || ':' || v_delivery.channel_key || ':' ||
      v_delivery.target_key || ':' || v_delivery.target_generation::text,
      0
    ));
    select ownership.* into v_ownership
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = v_event.workflow_key
      and ownership.occurrence_key = v_event.occurrence_key
      and ownership.rule_id = v_delivery.rule_id
      and ownership.channel_key = v_delivery.channel_key
      and ownership.target_key = v_delivery.target_key
      and ownership.target_generation = v_delivery.target_generation
    for update of ownership;
    if not found
      or v_ownership.owner_kind <> 'canonical'
      or v_ownership.state <> 'closed'
    then
      raise exception 'notification_delivery_retry_ownership_conflict' using errcode = '40001';
    end if;

    update dashboard_private.notification_dispatch_ownership_claims ownership
    set owner_generation = ownership.owner_generation + 1,
        state = 'reserved',
        dispatch_started_at = null,
        dispatch_token = null,
        provider_reference = null,
        terminal_outcome = null,
        updated_at = pg_catalog.clock_timestamp()
    where ownership.id = v_ownership.id;
  end if;

  update dashboard_private.notification_deliveries delivery
  set status = case p_resolution when 'mark_sent' then 'sent'
      when 'mark_failed' then 'failed' else 'retry_wait' end,
      status_reason = case p_resolution when 'mark_sent' then null
        when 'mark_failed' then 'provider_definite_rejection'
        else 'manual_retry_approved' end,
      next_attempt_at = case when p_resolution = 'approve_retry'
        then pg_catalog.clock_timestamp() else null end,
      max_attempts = case when p_resolution = 'approve_retry'
        then greatest(delivery.max_attempts, delivery.attempt_count + 1)
        else delivery.max_attempts end,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      cancel_requested_at = case when p_resolution = 'approve_retry'
        then null else delivery.cancel_requested_at end,
      cancel_reason = case when p_resolution = 'approve_retry'
        then null else delivery.cancel_reason end,
      provider_message_id = case when p_resolution = 'approve_retry'
        then null else delivery.provider_message_id end,
      provider_response_code = case when p_resolution = 'approve_retry'
        then null else delivery.provider_response_code end,
      sent_at = case when p_resolution = 'mark_sent'
        then pg_catalog.clock_timestamp()
        when p_resolution = 'approve_retry' then null
        else delivery.sent_at end,
      resolved_at = case when p_resolution in ('mark_sent', 'mark_failed')
        then pg_catalog.clock_timestamp() else null end,
      last_error_code = case when p_resolution = 'mark_sent' then null else p_reason end,
      last_error_summary = case when p_resolution = 'mark_sent' then null
        else 'manually reconciled delivery' end,
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = v_delivery.id
  returning pg_catalog.jsonb_build_object(
    'delivery_id', delivery.id,
    'status', delivery.status,
    'status_reason', delivery.status_reason,
    'attempt_count', delivery.attempt_count,
    'next_attempt_at', delivery.next_attempt_at
  ) into v_response;

  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'delivery_reconciliation', v_fingerprint, v_response);
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    before_summary, after_summary, reason_code
  ) values (
    'notification_delivery', p_delivery_id::text, 'delivery_manually_reconciled',
    (select auth.uid()), 'user', p_request_id,
    pg_catalog.jsonb_build_object('status', v_delivery.status, 'attempt_count', v_delivery.attempt_count),
    pg_catalog.jsonb_build_object(
      'status', v_response ->> 'status', 'attempt_count', v_delivery.attempt_count
    ),
    p_reason
  );
  return v_response;
end;
$$;

alter function public.claim_notification_deliveries_v1(text, integer, integer)
  owner to postgres;
revoke all on function public.claim_notification_deliveries_v1(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_notification_deliveries_v1(text, integer, integer)
  to service_role;

alter function public.reconcile_notification_delivery_v1(uuid, text, text, uuid, boolean)
  owner to postgres;
revoke all on function public.reconcile_notification_delivery_v1(uuid, text, text, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_notification_delivery_v1(uuid, text, text, uuid, boolean)
  to authenticated;

commit;
