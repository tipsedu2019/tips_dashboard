begin;

set local lock_timeout = '5s';

create schema if not exists dashboard_private;

-- 폐쇄 트랜잭션이 직접 검산한 단일 build와 증거 구간을 불변 marker에 고정한다.
create table dashboard_private.notification_contract_closures (
  closure_key text primary key,
  contract_version integer not null,
  required_zero_traffic_hours integer not null,
  required_full_operating_day boolean not null,
  bridge_aware_bundle_required boolean not null,
  old_server_drain_required boolean not null,
  build_revision_hash text not null,
  evidence_window_start timestamp with time zone not null,
  evidence_window_end timestamp with time zone not null,
  evidence_first_receipt_id uuid not null
    references dashboard_private.notification_contract_deployment_receipts(id) on delete restrict,
  evidence_last_receipt_id uuid not null
    references dashboard_private.notification_contract_deployment_receipts(id) on delete restrict,
  evidence_receipt_count bigint not null,
  ops_task_route_successes bigint not null,
  makeup_route_successes bigint not null,
  applied_at timestamp with time zone not null default pg_catalog.clock_timestamp(),
  constraint notification_contract_closures_key_check
    check (closure_key = 'legacy_arbitrary_notification_payload_v1'),
  constraint notification_contract_closures_version_check
    check (contract_version = 2),
  constraint notification_contract_closures_build_check
    check (build_revision_hash ~ '^[0-9a-f]{64}$'),
  constraint notification_contract_closures_evidence_check
    check (
      evidence_window_end - evidence_window_start >= interval '24 hours'
      and evidence_receipt_count > 0
      and ops_task_route_successes > 0
      and makeup_route_successes > 0
    ),
  constraint notification_contract_closures_drain_check
    check (
      required_zero_traffic_hours >= 24
      and required_full_operating_day
      and bridge_aware_bundle_required
      and old_server_drain_required
    )
);

do $$
declare
  v_common_version integer;
  v_registration_version integer;
  v_ops_task_version integer;
  v_transfer_withdrawal_version integer;
  v_registration_handoffs_version integer;
  v_bridge_installed_at timestamp with time zone;
  v_bridge_closed_at timestamp with time zone;
  v_drain_window_end timestamp with time zone;
  v_drain_window_start timestamp with time zone;
  v_full_operating_day_covered boolean;
  v_translator_failures bigint;
  v_pending_route_outcomes bigint;
  v_failed_route_outcomes bigint;
  v_ops_task_route_successes bigint;
  v_makeup_route_successes bigint;
  v_receipt_count bigint;
  v_earliest_receipt_at timestamp with time zone;
  v_latest_receipt_at timestamp with time zone;
  v_first_receipt_id uuid;
  v_last_receipt_id uuid;
  v_deployment_build_revision_count bigint;
  v_closure_build_revision_hash text;
  v_maximum_receipt_gap_seconds numeric;
  v_pre_bridge_server_instances bigint;
  v_total_server_instances bigint;
  v_bridge_aware_server_instances bigint;
  v_all_receipts_compliant boolean;
  v_expected_flags text[] := array[
    'notification_control_plane_settings_ui_enabled',
    'notification_control_plane_shadow_write_enabled',
    'notification_control_plane_dispatch_tasks_enabled',
    'notification_control_plane_dispatch_word_retests_enabled',
    'notification_control_plane_dispatch_registration_enabled',
    'notification_control_plane_registration_phone_adapter_enabled',
    'notification_control_plane_registration_visit_adapter_enabled',
    'notification_control_plane_registration_solapi_adapter_enabled',
    'notification_control_plane_dispatch_transfer_enabled',
    'notification_control_plane_dispatch_withdrawal_enabled',
    'notification_control_plane_dispatch_makeup_requests_enabled',
    'notification_control_plane_dispatch_approvals_enabled'
  ]::text[];
begin
  select state.installed_at, state.closed_at
  into strict v_bridge_installed_at, v_bridge_closed_at
  from dashboard_private.notification_contract_bridge_state state
  where state.state_key = 'legacy_contract_bridge_v1'
  for update;

  -- 먼저 시작한 호환 호출·영수증 기록이 끝난 뒤 배타 잠금을 얻는다. 그 직후
  -- 경계 시각을 잡아 잠금 대기 중 커밋된 증거도 폐쇄 검산에 반드시 포함한다.
  v_drain_window_end := pg_catalog.clock_timestamp();
  -- 직전 Asia/Seoul 달력일 전체와 현재까지를 한 폐쇄 구간으로 고정한다.
  -- 어느 시각에 실행해도 24시간 이상이며 완결된 운영일 하나를 반드시 포함한다.
  v_drain_window_start := (
    pg_catalog.date_trunc('day', v_drain_window_end at time zone 'Asia/Seoul')
    - interval '1 day'
  ) at time zone 'Asia/Seoul';
  v_full_operating_day_covered :=
    v_drain_window_end - v_drain_window_start >= interval '24 hours'
    and (v_drain_window_start at time zone 'Asia/Seoul')
      = pg_catalog.date_trunc('day', v_drain_window_start at time zone 'Asia/Seoul');

  select pg_catalog.count(*) into v_translator_failures
  from dashboard_private.notification_contract_traffic traffic
  where traffic.contract_kind = 'v2_source'
    and traffic.outcome = 'translator_failed'
    and traffic.created_at >= v_drain_window_start
    and traffic.created_at < v_drain_window_end;

  select pg_catalog.count(*) into v_pending_route_outcomes
  from dashboard_private.notification_contract_traffic traffic
  left join dashboard_private.notification_contract_route_outcomes route_outcome
    on route_outcome.request_id = traffic.request_id
  where traffic.contract_kind = 'v2_source'
    and traffic.outcome = 'route_started'
    and traffic.created_at >= v_drain_window_start
    and traffic.created_at < v_drain_window_end
    and route_outcome.request_id is null;

  select pg_catalog.count(*) into v_failed_route_outcomes
  from dashboard_private.notification_contract_traffic traffic
  join dashboard_private.notification_contract_route_outcomes route_outcome
    on route_outcome.request_id = traffic.request_id
  where traffic.contract_kind = 'v2_source'
    and traffic.created_at >= v_drain_window_start
    and traffic.created_at < v_drain_window_end
    and route_outcome.outcome = 'failed';

  with receipt_rows as (
    select
      receipt.*,
      pg_catalog.lag(receipt.observed_at) over (order by receipt.observed_at, receipt.id) as previous_at
    from dashboard_private.notification_contract_deployment_receipts receipt
    where receipt.observed_at >= v_drain_window_start - interval '10 minutes'
      and receipt.observed_at <= v_drain_window_end
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
    v_closure_build_revision_hash,
    v_maximum_receipt_gap_seconds,
    v_pre_bridge_server_instances,
    v_total_server_instances,
    v_bridge_aware_server_instances,
    v_all_receipts_compliant
  from receipt_rows;

  select receipt.id into v_first_receipt_id
  from dashboard_private.notification_contract_deployment_receipts receipt
  where receipt.observed_at >= v_drain_window_start - interval '10 minutes'
    and receipt.observed_at <= v_drain_window_end
  order by receipt.observed_at, receipt.id
  limit 1;

  select receipt.id into v_last_receipt_id
  from dashboard_private.notification_contract_deployment_receipts receipt
  where receipt.observed_at >= v_drain_window_start - interval '10 minutes'
    and receipt.observed_at <= v_drain_window_end
  order by receipt.observed_at desc, receipt.id desc
  limit 1;

  -- 두 고정 경로의 성공은 영수증 전체가 가리키는 동일 단일 build에서 나와야 한다.
  select
    pg_catalog.count(*) filter (
      where route_outcome.outcome = 'succeeded'
        and traffic.build_revision_hash = v_closure_build_revision_hash
        and route_outcome.fixed_route = '/api/notifications/legacy/ops-task'
    ),
    pg_catalog.count(*) filter (
      where route_outcome.outcome = 'succeeded'
        and traffic.build_revision_hash = v_closure_build_revision_hash
        and route_outcome.fixed_route = '/api/notifications/legacy/makeup'
    )
  into v_ops_task_route_successes, v_makeup_route_successes
  from dashboard_private.notification_contract_traffic traffic
  join dashboard_private.notification_contract_route_outcomes route_outcome
    on route_outcome.request_id = traffic.request_id
   and route_outcome.build_revision_hash = traffic.build_revision_hash
  where traffic.contract_kind = 'v2_source'
    and traffic.created_at >= v_drain_window_start
    and traffic.created_at < v_drain_window_end;

  if v_bridge_closed_at is not null
    or not v_full_operating_day_covered
    or v_bridge_installed_at > v_drain_window_start
    or exists (
      select 1
      from dashboard_private.notification_contract_traffic traffic
      where traffic.contract_kind = 'legacy_untranslatable'
        and traffic.created_at >= v_drain_window_start
        and traffic.created_at < v_drain_window_end
    )
    or v_translator_failures <> 0
    or v_pending_route_outcomes <> 0
    or v_failed_route_outcomes <> 0
    or v_ops_task_route_successes = 0
    or v_makeup_route_successes = 0
    or v_receipt_count = 0
    or v_deployment_build_revision_count <> 1
    or v_closure_build_revision_hash is null
    or v_first_receipt_id is null
    or v_last_receipt_id is null
    or v_earliest_receipt_at > v_drain_window_start + interval '5 minutes'
    or v_latest_receipt_at < v_drain_window_end - interval '5 minutes'
    or v_maximum_receipt_gap_seconds > 600
    or not v_all_receipts_compliant
    or v_pre_bridge_server_instances <> 0
    or v_total_server_instances = 0
    or v_bridge_aware_server_instances <> v_total_server_instances
  then
    raise exception 'notification_contract_drain_not_complete' using errcode = '55000';
  end if;

  -- 이 행 잠금은 migration commit까지 호환 요청·배포 영수증 RPC와 직렬화된다.
  -- 폐쇄 여부는 외부 JSON이 아니라 위 DB 불변 증거만으로 결정한다.
  update dashboard_private.notification_contract_bridge_state
  set closed_at = v_drain_window_end
  where state_key = 'legacy_contract_bridge_v1';

  insert into dashboard_private.notification_contract_closures(
    closure_key,
    contract_version,
    required_zero_traffic_hours,
    required_full_operating_day,
    bridge_aware_bundle_required,
    old_server_drain_required,
    build_revision_hash,
    evidence_window_start,
    evidence_window_end,
    evidence_first_receipt_id,
    evidence_last_receipt_id,
    evidence_receipt_count,
    ops_task_route_successes,
    makeup_route_successes
  ) values (
    'legacy_arbitrary_notification_payload_v1',
    2,
    24,
    true,
    true,
    true,
    v_closure_build_revision_hash,
    v_drain_window_start,
    v_drain_window_end,
    v_first_receipt_id,
    v_last_receipt_id,
    v_receipt_count,
    v_ops_task_route_successes,
    v_makeup_route_successes
  );

  if (select pg_catalog.count(*) from dashboard_private.notification_runtime_flags) <> 12
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.enabled
    )
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where not flag_row.flag_key = any(v_expected_flags)
    )
    or exists (
      select 1
      from pg_catalog.unnest(v_expected_flags) expected(flag_key)
      where not exists (
        select 1
        from dashboard_private.notification_runtime_flags flag_row
        where flag_row.flag_key = expected.flag_key
      )
    )
  then
    raise exception 'notification_closure_flag_registry_not_safe' using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure('public.common_notification_control_plane_runtime_version()') is null
    or pg_catalog.to_regprocedure('public.registration_appointment_reminders_runtime_version()') is null
    or pg_catalog.to_regprocedure('public.ops_task_notification_producers_runtime_version()') is null
    or pg_catalog.to_regprocedure('public.transfer_withdrawal_notification_producers_runtime_version()') is null
    or pg_catalog.to_regprocedure('public.registration_notification_handoffs_runtime_version()') is null
  then
    raise exception 'notification_closure_runtime_dependency_missing' using errcode = '55000';
  end if;

  execute 'select public.common_notification_control_plane_runtime_version()'
    into v_common_version;
  execute 'select public.registration_appointment_reminders_runtime_version()'
    into v_registration_version;
  execute 'select public.ops_task_notification_producers_runtime_version()'
    into v_ops_task_version;
  execute 'select public.transfer_withdrawal_notification_producers_runtime_version()'
    into v_transfer_withdrawal_version;
  execute 'select public.registration_notification_handoffs_runtime_version()'
    into v_registration_handoffs_version;
  if v_common_version <> 1
    or v_registration_version <> 1
    or v_ops_task_version <> 1
    or v_transfer_withdrawal_version <> 1
    or v_registration_handoffs_version <> 1
  then
    raise exception 'notification_closure_runtime_dependency_mismatch' using errcode = '55000';
  end if;
end;
$$;

create table dashboard_private.notification_source_type_registry (
  workflow_key text not null,
  source_type text not null,
  source_id_kind text not null,
  compatibility_route text,
  contract_version integer not null default 2,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  primary key (workflow_key, source_type),
  constraint notification_source_type_registry_workflow_check
    check (workflow_key in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )),
  constraint notification_source_type_registry_source_check
    check (source_type in (
      'ops_task_event', 'ops_task_comment', 'registration_appointment',
      'ops_registration_message', 'makeup_request_event',
      'approval_event', 'approval_comment'
    )),
  constraint notification_source_type_registry_id_kind_check
    check (source_id_kind in ('uuid', 'stable_text')),
  constraint notification_source_type_registry_route_check
    check (
      compatibility_route is null
      or compatibility_route in (
        '/api/notifications/legacy/ops-task',
        '/api/notifications/legacy/makeup'
      )
    ),
  constraint notification_source_type_registry_contract_check
    check (contract_version = 2)
);

insert into dashboard_private.notification_source_type_registry(
  workflow_key, source_type, source_id_kind, compatibility_route, contract_version
)
values
  ('tasks', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('tasks', 'ops_task_comment', 'uuid', null, 2),
  ('word_retests', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('word_retests', 'ops_task_comment', 'uuid', null, 2),
  ('registration', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('registration', 'registration_appointment', 'uuid', null, 2),
  ('registration', 'ops_registration_message', 'uuid', null, 2),
  ('transfer', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('withdrawal', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('makeup_requests', 'makeup_request_event', 'uuid', '/api/notifications/legacy/makeup', 2),
  ('approvals', 'approval_event', 'uuid', null, 2),
  ('approvals', 'approval_comment', 'uuid', null, 2);

alter table dashboard_private.notification_source_type_registry enable row level security;
alter table dashboard_private.notification_contract_closures enable row level security;
revoke all on table dashboard_private.notification_source_type_registry
  from public, anon, authenticated;
revoke all on table dashboard_private.notification_contract_closures
  from public, anon, authenticated, service_role;
grant select on table dashboard_private.notification_source_type_registry to service_role;
grant select on table dashboard_private.notification_contract_closures to service_role;

-- 고정 목적 SECURITY DEFINER RPC는 postgres 소유자로 계속 기록한다.
-- 임의 브라우저 쓰기만 닫고, 보존 기간에 필요한 읽기는 유지한다.
revoke insert, update, delete on table public.dashboard_notifications from authenticated;
revoke insert, update, delete on table public.ops_task_events from authenticated;
revoke insert, update, delete on table public.ops_task_comments from authenticated;
revoke insert, update, delete on table public.makeup_requests from authenticated;
revoke insert, update, delete on table public.makeup_request_events from authenticated;
revoke insert, update, delete on table public.makeup_notification_deliveries from authenticated;
revoke insert, update, delete on table public.approval_events from authenticated;
revoke insert, update, delete on table public.approval_comments from authenticated;
revoke insert, update, delete on table public.approval_requests from authenticated;
revoke insert, update, delete on table public.dashboard_notifications from public, anon;
revoke insert, update, delete on table public.ops_task_events from public, anon;
revoke insert, update, delete on table public.ops_task_comments from public, anon;
revoke insert, update, delete on table public.makeup_requests from public, anon;
revoke insert, update, delete on table public.makeup_request_events from public, anon;
revoke insert, update, delete on table public.makeup_notification_deliveries from public, anon;
revoke insert, update, delete on table public.approval_events from public, anon;
revoke insert, update, delete on table public.approval_comments from public, anon;
revoke insert, update, delete on table public.approval_requests from public, anon;

-- 레거시 writer를 닫은 뒤 마지막 보관분을 가져오고 원본/영수증 checksum parity를 고정한다.
-- 선행 INSERT가 끝날 때까지 기다리고 migration commit 전까지 새 INSERT를 차단한다.
lock table public.makeup_notification_deliveries in share row exclusive mode;

do $$
declare
  v_validation jsonb;
begin
  perform dashboard_private.notification_import_makeup_retained_state_v1();
  v_validation := dashboard_private.notification_assert_makeup_retained_import_complete_v1();
  if (v_validation ->> 'unimported_count')::bigint <> 0
    or (v_validation ->> 'retained_count')::bigint
      <> (v_validation ->> 'imported_count')::bigint
    or v_validation ->> 'retained_checksum'
      is distinct from v_validation ->> 'imported_checksum'
  then
    raise exception 'notification_makeup_legacy_final_parity_failed'
      using errcode = '55000';
  end if;
  perform dashboard_private.notification_record_makeup_retention_observation_v1(
    'legacy_writer_closed'
  );
end;
$$;

grant select on table public.dashboard_notifications to authenticated;
grant select on table public.ops_task_events to authenticated;
grant select on table public.ops_task_comments to authenticated;
grant select on table public.makeup_requests to authenticated;
grant select on table public.makeup_request_events to authenticated;
grant select on table public.makeup_notification_deliveries to authenticated;
grant select on table public.approval_events to authenticated;
grant select on table public.approval_comments to authenticated;
grant select on table public.approval_requests to authenticated;

create or replace function public.resolve_legacy_notification_source_route_v1(
  p_source_event_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_route text;
begin
  if (select auth.role()) <> 'service_role' or p_source_event_id is null then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;

  -- 194500의 공통 고정 변환기를 그대로 사용한다. 특히 comment_added는
  -- 브라우저의 ops_task_events.id와 정규 comment id를 모두 같은 경로로 해석한다.
  v_route := dashboard_private.notification_contract_fixed_route_v1(p_source_event_id);

  if v_route is null then
    return pg_catalog.jsonb_build_object(
      'translatable', false,
      'contract_version', 2
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'translatable', true,
    'route', v_route,
    'contract_version', 2
  );
end;
$$;

alter function public.resolve_legacy_notification_source_route_v1(uuid) owner to postgres;
revoke all on function public.resolve_legacy_notification_source_route_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_legacy_notification_source_route_v1(uuid)
  to service_role;

create or replace function public.notification_workflow_legacy_closure_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 1; $$;

alter function public.notification_workflow_legacy_closure_version() owner to postgres;
revoke all on function public.notification_workflow_legacy_closure_version()
  from public, anon;
grant execute on function public.notification_workflow_legacy_closure_version()
  to authenticated, service_role;

commit;
