begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- COALESCE is PostgreSQL SQL syntax, not a schema-qualified function.
-- Recreate the evidence RPC without the invalid schema-qualified calls.
create or replace function public.get_notification_contract_drain_evidence_v1(
  p_window_start timestamp with time zone,
  p_window_end timestamp with time zone
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamp with time zone := pg_catalog.clock_timestamp();
  v_installed_at timestamp with time zone;
  v_local_start timestamp without time zone;
  v_full_day_start_local timestamp without time zone;
  v_full_day_start timestamp with time zone;
  v_full_day_covered boolean;
  v_untranslatable bigint;
  v_v2 bigint;
  v_translator_failures bigint;
  v_pending_outcomes bigint;
  v_failed_outcomes bigint;
  v_successful_outcomes bigint;
  v_ops_task_route_successes bigint;
  v_makeup_route_successes bigint;
  v_receipt_count bigint;
  v_earliest_receipt_at timestamp with time zone;
  v_latest_receipt_at timestamp with time zone;
  v_deployment_build_revision_count bigint;
  v_latest_compliant_build_revision_hash text;
  v_maximum_gap_seconds numeric;
  v_pre_bridge_servers bigint;
  v_total_servers bigint;
  v_bridge_servers bigint;
  v_all_receipts_compliant boolean;
  v_deployment_covers_window boolean;
  v_server_ratio numeric;
  v_closure_ready boolean;
begin
  if (select auth.role()) <> 'service_role'
    or p_window_start is null
    or p_window_end is null
    or p_window_end <= p_window_start
    or p_window_end - p_window_start < interval '24 hours'
    or p_window_end > v_now + interval '1 minute'
    or p_window_end < v_now - interval '5 minutes'
  then
    raise exception 'notification_contract_drain_window_invalid' using errcode = '22023';
  end if;

  select state.installed_at into strict v_installed_at
  from dashboard_private.notification_contract_bridge_state state
  where state.state_key = 'legacy_contract_bridge_v1';
  if p_window_start < v_installed_at then
    raise exception 'notification_contract_drain_window_before_bridge'
      using errcode = '22023';
  end if;

  v_local_start := p_window_start at time zone 'Asia/Seoul';
  v_full_day_start_local := pg_catalog.date_trunc('day', v_local_start);
  if v_local_start <> v_full_day_start_local then
    v_full_day_start_local := v_full_day_start_local + interval '1 day';
  end if;
  v_full_day_start := v_full_day_start_local at time zone 'Asia/Seoul';
  v_full_day_covered := p_window_end >= v_full_day_start + interval '1 day';

  select pg_catalog.count(*) into v_untranslatable
  from dashboard_private.notification_contract_traffic traffic
  where traffic.contract_kind = 'legacy_untranslatable'
    and traffic.created_at >= p_window_start
    and traffic.created_at < p_window_end;

  select pg_catalog.count(*) into v_v2
  from dashboard_private.notification_contract_traffic traffic
  where traffic.contract_kind = 'v2_source'
    and traffic.created_at >= p_window_start
    and traffic.created_at < p_window_end;

  select pg_catalog.count(*) into v_translator_failures
  from dashboard_private.notification_contract_traffic traffic
  where traffic.contract_kind = 'v2_source'
    and traffic.outcome = 'translator_failed'
    and traffic.created_at >= p_window_start
    and traffic.created_at < p_window_end;

  select pg_catalog.count(*) into v_pending_outcomes
  from dashboard_private.notification_contract_traffic traffic
  left join dashboard_private.notification_contract_route_outcomes route_outcome
    on route_outcome.request_id = traffic.request_id
  where traffic.contract_kind = 'v2_source'
    and traffic.outcome = 'route_started'
    and traffic.created_at >= p_window_start
    and traffic.created_at < p_window_end
    and route_outcome.request_id is null;

  with receipt_rows as (
    select
      receipt.*,
      pg_catalog.lag(receipt.observed_at) over (order by receipt.observed_at, receipt.id) as previous_at
    from dashboard_private.notification_contract_deployment_receipts receipt
    where receipt.observed_at >= p_window_start - interval '10 minutes'
      and receipt.observed_at <= p_window_end
  )
  select
    pg_catalog.count(*),
    pg_catalog.min(receipt_rows.observed_at),
    pg_catalog.max(receipt_rows.observed_at),
    pg_catalog.count(distinct receipt_rows.build_revision_hash),
    case
      when pg_catalog.count(distinct receipt_rows.build_revision_hash) = 1
        then pg_catalog.min(receipt_rows.build_revision_hash)
      else null
    end,
    coalesce(pg_catalog.max(
      (pg_catalog.date_part(
        'epoch', (receipt_rows.observed_at - receipt_rows.previous_at)
      ))::numeric
    ), 0),
    coalesce(pg_catalog.sum(receipt_rows.pre_bridge_server_instances), 0),
    coalesce(pg_catalog.sum(receipt_rows.total_server_instances), 0),
    coalesce(pg_catalog.sum(receipt_rows.bridge_aware_server_instances), 0),
    coalesce(pg_catalog.bool_and(
      receipt_rows.contract_version = 2
      and receipt_rows.pre_bridge_server_instances = 0
      and receipt_rows.bridge_aware_server_instances = receipt_rows.total_server_instances
    ), false)
  into
    v_receipt_count,
    v_earliest_receipt_at,
    v_latest_receipt_at,
    v_deployment_build_revision_count,
    v_latest_compliant_build_revision_hash,
    v_maximum_gap_seconds,
    v_pre_bridge_servers,
    v_total_servers,
    v_bridge_servers,
    v_all_receipts_compliant
  from receipt_rows;

  -- 성공 증거는 위 배포 영수증 전체가 가리키는 단일 build에서 나온 것만 인정한다.
  select
    pg_catalog.count(*) filter (where route_outcome.outcome = 'failed'),
    pg_catalog.count(*) filter (
      where route_outcome.outcome = 'succeeded'
        and traffic.build_revision_hash = v_latest_compliant_build_revision_hash
    ),
    pg_catalog.count(*) filter (
      where route_outcome.outcome = 'succeeded'
        and traffic.build_revision_hash = v_latest_compliant_build_revision_hash
        and route_outcome.fixed_route = '/api/notifications/legacy/ops-task'
    ),
    pg_catalog.count(*) filter (
      where route_outcome.outcome = 'succeeded'
        and traffic.build_revision_hash = v_latest_compliant_build_revision_hash
        and route_outcome.fixed_route = '/api/notifications/legacy/makeup'
    )
  into
    v_failed_outcomes,
    v_successful_outcomes,
    v_ops_task_route_successes,
    v_makeup_route_successes
  from dashboard_private.notification_contract_traffic traffic
  join dashboard_private.notification_contract_route_outcomes route_outcome
    on route_outcome.request_id = traffic.request_id
   and route_outcome.build_revision_hash = traffic.build_revision_hash
  where traffic.contract_kind = 'v2_source'
    and traffic.created_at >= p_window_start
    and traffic.created_at < p_window_end;

  v_server_ratio := case
    when v_total_servers > 0 then v_bridge_servers::numeric / v_total_servers::numeric
    else 0::numeric
  end;
  v_deployment_covers_window := v_receipt_count > 0
    and v_earliest_receipt_at <= p_window_start + interval '5 minutes'
    and v_latest_receipt_at >= p_window_end - interval '5 minutes'
    and v_deployment_build_revision_count = 1
    and v_maximum_gap_seconds <= 600
    and v_all_receipts_compliant
    and v_latest_compliant_build_revision_hash is not null;

  v_closure_ready := v_full_day_covered
    and v_untranslatable = 0
    and v_translator_failures = 0
    and v_pending_outcomes = 0
    and v_failed_outcomes = 0
    and v_ops_task_route_successes > 0
    and v_makeup_route_successes > 0
    and v_deployment_covers_window
    and v_pre_bridge_servers = 0
    and v_server_ratio = 1;

  return pg_catalog.jsonb_build_object(
    'evidenceVersion', 2,
    'evidenceSource', 'get_notification_contract_drain_evidence_v1',
    'generatedAt', v_now,
    'windowStart', p_window_start,
    'windowEnd', p_window_end,
    'bridgeInstalledAt', v_installed_at,
    'continuousHours', (
      pg_catalog.date_part('epoch', (p_window_end - p_window_start))
    )::numeric / 3600,
    'fullOperatingDayCovered', v_full_day_covered,
    'fullOperatingDayStart', v_full_day_start,
    'untranslatableOldContractTraffic', v_untranslatable,
    'v2SourceTraffic', v_v2,
    'sourceIdTranslatorFailures', v_translator_failures,
    'pendingV2RouteOutcomes', v_pending_outcomes,
    'failedV2RouteOutcomes', v_failed_outcomes,
    'successfulV2RouteOutcomes', v_successful_outcomes,
    'opsTaskRouteSuccesses', v_ops_task_route_successes,
    'makeupRouteSuccesses', v_makeup_route_successes,
    'deploymentReceiptCount', v_receipt_count,
    'earliestDeploymentReceiptAt', v_earliest_receipt_at,
    'latestDeploymentReceiptAt', v_latest_receipt_at,
    'deploymentBuildRevisionCount', v_deployment_build_revision_count,
    'latestCompliantBuildRevisionHash', v_latest_compliant_build_revision_hash,
    'maximumDeploymentReceiptGapSeconds', v_maximum_gap_seconds,
    'deploymentEvidenceCoversWindow', v_deployment_covers_window,
    'preBridgeServerInstances', v_pre_bridge_servers,
    'bridgeAwareServerRatio', v_server_ratio,
    'closureReady', v_closure_ready
  );
end;
$$;

alter function public.get_notification_contract_drain_evidence_v1(
  timestamp with time zone, timestamp with time zone
) owner to postgres;

revoke all on function public.get_notification_contract_drain_evidence_v1(
  timestamp with time zone, timestamp with time zone
) from public, anon, authenticated, service_role;

grant execute on function public.get_notification_contract_drain_evidence_v1(
  timestamp with time zone, timestamp with time zone
) to service_role;

-- This private pre-observation helper became unreachable when the public
-- activation RPC was replaced by the live-evidence contract.
drop function dashboard_private.set_registration_customer_solapi_activation_pre_observation_v1(
  uuid, text, text, jsonb
);

commit;
