begin;

set local lock_timeout = '5s';

create schema if not exists dashboard_private;

create table dashboard_private.notification_contract_bridge_state (
  state_key text primary key,
  installed_at timestamp with time zone not null,
  closed_at timestamp with time zone,
  constraint notification_contract_bridge_state_key_check
    check (state_key = 'legacy_contract_bridge_v1')
);

insert into dashboard_private.notification_contract_bridge_state(
  state_key, installed_at
) values (
  'legacy_contract_bridge_v1', pg_catalog.clock_timestamp()
) on conflict (state_key) do nothing;

-- 호환 요청의 시작 사실만 보관한다. 브라우저 문구, 대상, URL, 구독 주소는 없다.
create table dashboard_private.notification_contract_traffic (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  entry_point text not null,
  contract_kind text not null,
  outcome text not null,
  source_event_id uuid,
  fixed_route text,
  build_revision_hash text,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamp with time zone not null default pg_catalog.clock_timestamp(),
  constraint notification_contract_traffic_entry_point_check
    check (entry_point in ('google_chat', 'web_push')),
  constraint notification_contract_traffic_contract_kind_check
    check (contract_kind in ('v2_source', 'legacy_untranslatable')),
  constraint notification_contract_traffic_outcome_check
    check (outcome in ('route_started', 'translator_failed', 'observed', 'rejected')),
  constraint notification_contract_traffic_shape_check
    check (
      (
        contract_kind = 'legacy_untranslatable'
        and source_event_id is null
        and fixed_route is null
        and build_revision_hash is null
        and outcome in ('observed', 'rejected')
      )
      or (
        contract_kind = 'v2_source'
        and entry_point = 'google_chat'
        and source_event_id is not null
        and build_revision_hash ~ '^[0-9a-f]{64}$'
        and (
          (
            outcome = 'route_started'
            and fixed_route in (
              '/api/notifications/legacy/ops-task',
              '/api/notifications/legacy/makeup'
            )
          )
          or (outcome = 'translator_failed' and fixed_route is null)
        )
      )
    )
);

-- v2 고정 경로가 실제로 반환한 성공/실패만 시작 행과 분리해 append-only로 남긴다.
create table dashboard_private.notification_contract_route_outcomes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique
    references dashboard_private.notification_contract_traffic(request_id) on delete restrict,
  source_event_id uuid not null,
  fixed_route text not null,
  build_revision_hash text not null,
  outcome text not null,
  response_status integer not null,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamp with time zone not null default pg_catalog.clock_timestamp(),
  constraint notification_contract_route_outcomes_route_check
    check (fixed_route in (
      '/api/notifications/legacy/ops-task',
      '/api/notifications/legacy/makeup'
    )),
  constraint notification_contract_route_outcomes_build_check
    check (build_revision_hash ~ '^[0-9a-f]{64}$'),
  constraint notification_contract_route_outcomes_outcome_check
    check (outcome in ('succeeded', 'failed')),
  constraint notification_contract_route_outcomes_status_check
    check (
      response_status between 100 and 599
      and (
        (outcome = 'succeeded' and response_status between 200 and 299)
        or outcome = 'failed'
      )
    )
);

-- 배포 제어면이 5분마다 남기는 불변 inventory 영수증이다.
-- deployment 식별자는 원문 대신 소문자 SHA-256만 저장한다.
create table dashboard_private.notification_contract_deployment_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  inventory_source text not null,
  project_key_hash text not null,
  build_revision_hash text not null,
  inventory_observation_hash text not null unique,
  contract_version integer not null,
  active_server_deployment_hashes text[] not null,
  bridge_aware_server_deployment_hashes text[] not null,
  pre_bridge_server_deployment_hashes text[] not null,
  total_server_instances integer generated always as (
    pg_catalog.cardinality(active_server_deployment_hashes)
  ) stored,
  bridge_aware_server_instances integer generated always as (
    pg_catalog.cardinality(bridge_aware_server_deployment_hashes)
  ) stored,
  pre_bridge_server_instances integer generated always as (
    pg_catalog.cardinality(pre_bridge_server_deployment_hashes)
  ) stored,
  observed_at timestamp with time zone not null default pg_catalog.clock_timestamp(),
  constraint notification_contract_deployment_receipts_source_check
    check (inventory_source = 'vercel_production_alias_v1'),
  constraint notification_contract_deployment_receipts_hash_check
    check (
      project_key_hash ~ '^[0-9a-f]{64}$'
      and build_revision_hash ~ '^[0-9a-f]{64}$'
      and inventory_observation_hash ~ '^[0-9a-f]{64}$'
      and pg_catalog.array_to_string(active_server_deployment_hashes, ',')
        ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'
      and (
        pg_catalog.cardinality(bridge_aware_server_deployment_hashes) = 0
        or pg_catalog.array_to_string(bridge_aware_server_deployment_hashes, ',')
          ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'
      )
      and (
        pg_catalog.cardinality(pre_bridge_server_deployment_hashes) = 0
        or pg_catalog.array_to_string(pre_bridge_server_deployment_hashes, ',')
          ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'
      )
    ),
  constraint notification_contract_deployment_receipts_version_check
    check (contract_version = 2),
  constraint notification_contract_deployment_receipts_server_check
    check (
      total_server_instances > 0
      and bridge_aware_server_instances >= 0
      and pre_bridge_server_instances >= 0
      and bridge_aware_server_instances + pre_bridge_server_instances = total_server_instances
    )
);

create index notification_contract_traffic_drain_idx
  on dashboard_private.notification_contract_traffic(
    contract_kind, outcome, created_at, entry_point
  );
create index notification_contract_route_outcomes_drain_idx
  on dashboard_private.notification_contract_route_outcomes(created_at, outcome);
create index notification_contract_deployment_receipts_drain_idx
  on dashboard_private.notification_contract_deployment_receipts(observed_at);

alter table dashboard_private.notification_contract_bridge_state enable row level security;
alter table dashboard_private.notification_contract_traffic enable row level security;
alter table dashboard_private.notification_contract_route_outcomes enable row level security;
alter table dashboard_private.notification_contract_deployment_receipts enable row level security;

-- service_role도 증거표를 직접 고칠 수 없다. 아래 SECURITY DEFINER RPC만 쓴다.
revoke all on table dashboard_private.notification_contract_bridge_state
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_contract_traffic
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_contract_route_outcomes
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_contract_deployment_receipts
  from public, anon, authenticated, service_role;

-- 외부시도 중복 원장도 1945 bridge 관찰 시작 전부터 직접 변조를 닫는다.
-- 이후 쓰기는 postgres 소유 SECURITY DEFINER RPC만 수행한다.
revoke all on table dashboard_private.notification_audit_logs from service_role;
grant select on table dashboard_private.notification_audit_logs to service_role;

-- 194500 직후 배포되는 최종 앱 번들은 휴보강 고정 경로에서 이 RPC를
-- 이미 호출한다. 그림자 비교 구현은 195900에서 같은 서명을 교체하므로,
-- 관찰 단계에는 검증된 무기록 응답만 제공해 PostgREST 계약 공백을 없앤다.
create or replace function public.record_legacy_notification_delivery_intent_v1(
  p_delivery_id uuid,
  p_legacy_template_checksum text,
  p_normalized_rendered_hash text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role'
    or p_delivery_id is null
    or p_legacy_template_checksum is null
    or p_legacy_template_checksum !~ '^[a-f0-9]{64}$'
    or p_normalized_rendered_hash is null
    or p_normalized_rendered_hash !~ '^[a-f0-9]{64}$'
    or p_request_id is null
  then
    raise exception 'notification_legacy_delivery_intent_invalid'
      using errcode = '22023';
  end if;
  return pg_catalog.jsonb_build_object(
    'recorded', false,
    'shadow', false,
    'reason', 'shadow_contract_pending'
  );
end;
$$;

create or replace function public.get_notification_contract_closure_state_v1()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'allowed', (select auth.role()) = 'service_role',
    'closed', (select auth.role()) <> 'service_role' or state.closed_at is not null,
    'closedAt', state.closed_at
  )
  from dashboard_private.notification_contract_bridge_state state
  where state.state_key = 'legacy_contract_bridge_v1'
  for share of state;
$$;

-- 구형 임의 envelope는 공급자 호출 전에 이 RPC로 관찰·폐쇄 판정을 직렬화한다.
create or replace function public.record_notification_contract_traffic_v1(
  p_entry_point text,
  p_contract_kind text,
  p_outcome text,
  p_actor_profile_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row dashboard_private.notification_contract_traffic%rowtype;
  v_closed_at timestamp with time zone;
  v_effective_outcome text;
begin
  if (select auth.role()) <> 'service_role'
    or p_entry_point not in ('google_chat', 'web_push')
    or p_contract_kind <> 'legacy_untranslatable'
    or p_outcome not in ('observed', 'rejected')
    or p_actor_profile_id is null
    or p_request_id is null
    or not exists (
      select 1 from public.profiles profile where profile.id = p_actor_profile_id
    )
  then
    raise exception 'notification_contract_traffic_invalid' using errcode = '22023';
  end if;

  select state.closed_at into v_closed_at
  from dashboard_private.notification_contract_bridge_state state
  where state.state_key = 'legacy_contract_bridge_v1'
  for share;
  if not found then
    raise exception 'notification_contract_bridge_state_missing' using errcode = '55000';
  end if;

  v_effective_outcome := case
    when v_closed_at is not null then 'rejected'
    else p_outcome
  end;

  insert into dashboard_private.notification_contract_traffic(
    request_id, entry_point, contract_kind, outcome, actor_profile_id
  ) values (
    p_request_id, p_entry_point, p_contract_kind, v_effective_outcome, p_actor_profile_id
  ) on conflict (request_id) do nothing
  returning * into v_row;

  if not found then
    select traffic.* into strict v_row
    from dashboard_private.notification_contract_traffic traffic
    where traffic.request_id = p_request_id;
    if v_row.entry_point <> p_entry_point
      or v_row.contract_kind <> p_contract_kind
      or v_row.actor_profile_id <> p_actor_profile_id
      or v_row.source_event_id is not null
      or v_row.fixed_route is not null
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'recorded', true,
    'requestId', v_row.request_id,
    'entryPoint', v_row.entry_point,
    'contractKind', v_row.contract_kind,
    'outcome', v_row.outcome,
    'closed', v_closed_at is not null,
    'closedAt', v_closed_at
  );
end;
$$;

create or replace function dashboard_private.notification_contract_fixed_route_v1(
  p_source_event_id uuid
) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when pg_catalog.count(distinct candidate.route) = 1
    then pg_catalog.min(candidate.route)
    else null
  end
  from (
    select case
      when event_row.workflow_key in (
        'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal'
      ) and event_row.source_type in ('ops_task_event', 'ops_task_comment')
        then '/api/notifications/legacy/ops-task'
      when event_row.workflow_key = 'makeup_requests'
        and event_row.source_type = 'makeup_request_event'
        then '/api/notifications/legacy/makeup'
      else null
    end as route
    from dashboard_private.notification_events event_row
    where (
      (
        event_row.source_id = p_source_event_id::text
        and event_row.occurrence_key = p_source_event_id::text
      )
      or event_row.payload ->> 'source_event_id' = p_source_event_id::text
    )
  ) candidate
  where candidate.route is not null;
$$;

-- source가 실제로 존재하고 이 행위자가 기존 고정 계획을 읽을 권한이 있을 때만
-- translator 관찰을 허용한다. 무관 UUID나 미인가 호출은 drain 실패를 만들지 못한다.
create or replace function dashboard_private.assert_notification_contract_source_access_v1(
  p_source_event_id uuid,
  p_actor_profile_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_known boolean := false;
  v_allowed boolean := false;
begin
  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;
  if not found then
    raise exception 'notification_contract_source_access_denied' using errcode = '42501';
  end if;

  select true,
    coalesce(
      source_row.actor_id = p_actor_profile_id
      or task.requested_by = p_actor_profile_id
      or task.assignee_id = p_actor_profile_id
      or task.secondary_assignee_id = p_actor_profile_id
      or v_actor_role in ('admin', 'staff'),
      false
    )
  into v_known, v_allowed
  from public.ops_task_events source_row
  join public.ops_tasks task on task.id = source_row.task_id
  where source_row.id = p_source_event_id;

  if not coalesce(v_known, false) then
    select true,
      coalesce(
        source_row.actor_id = p_actor_profile_id
        or request_row.requester_id = p_actor_profile_id
        or request_row.approver_profile_id = p_actor_profile_id
        or v_actor_role in ('admin', 'staff'),
        false
      )
    into v_known, v_allowed
    from public.makeup_request_events source_row
    join public.makeup_requests request_row on request_row.id = source_row.request_id
    where source_row.id = p_source_event_id;
  end if;

  if not coalesce(v_known, false) then
    select true,
      coalesce(
        event_row.actor_profile_id = p_actor_profile_id
        or v_actor_role in ('admin', 'staff'),
        false
      )
    into v_known, v_allowed
    from dashboard_private.notification_events event_row
    where event_row.workflow_key = 'makeup_requests'
      and event_row.event_key = 'makeup.deleted'
      and event_row.source_type = 'makeup_request_event'
      and event_row.source_id = p_source_event_id::text
      and event_row.occurrence_key = p_source_event_id::text;
  end if;

  if not coalesce(v_known, false) then
    raise exception 'notification_contract_source_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(v_allowed, false) then
    raise exception 'notification_contract_source_access_denied' using errcode = '42501';
  end if;
end;
$$;

-- rolling deploy 중의 구 서버가 참조할 수 있는 읽기 전용 호환 resolver다.
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

  v_route := dashboard_private.notification_contract_fixed_route_v1(p_source_event_id);

  if v_route is null then
    return pg_catalog.jsonb_build_object('translatable', false, 'contractVersion', 2);
  end if;
  return pg_catalog.jsonb_build_object(
    'translatable', true,
    'route', v_route,
    'contractVersion', 2
  );
end;
$$;

-- 신규 bundle은 resolver 성공을 성공 증거로 쓰지 않는다. 이 RPC는 고정 경로 시작 또는
-- translator 실패를 먼저 append-only로 기록하고, 실제 응답은 별도 outcome RPC가 기록한다.
create or replace function public.begin_notification_contract_v2_route_v1(
  p_source_event_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_build_revision_hash text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row dashboard_private.notification_contract_traffic%rowtype;
  v_route text;
  v_closed_at timestamp with time zone;
begin
  if (select auth.role()) <> 'service_role'
    or p_source_event_id is null
    or p_actor_profile_id is null
    or p_request_id is null
    or p_build_revision_hash is null
    or p_build_revision_hash !~ '^[0-9a-f]{64}$'
    or not exists (
      select 1 from public.profiles profile where profile.id = p_actor_profile_id
    )
  then
    raise exception 'notification_contract_v2_route_invalid' using errcode = '22023';
  end if;

  select state.closed_at into v_closed_at
  from dashboard_private.notification_contract_bridge_state state
  where state.state_key = 'legacy_contract_bridge_v1'
  for share;
  if not found then
    raise exception 'notification_contract_bridge_state_missing' using errcode = '55000';
  end if;

  perform dashboard_private.assert_notification_contract_source_access_v1(
    p_source_event_id, p_actor_profile_id
  );
  v_route := dashboard_private.notification_contract_fixed_route_v1(p_source_event_id);

  insert into dashboard_private.notification_contract_traffic(
    request_id,
    entry_point,
    contract_kind,
    outcome,
    source_event_id,
    fixed_route,
    build_revision_hash,
    actor_profile_id
  ) values (
    p_request_id,
    'google_chat',
    'v2_source',
    case when v_route is null then 'translator_failed' else 'route_started' end,
    p_source_event_id,
    v_route,
    p_build_revision_hash,
    p_actor_profile_id
  ) on conflict (request_id) do nothing
  returning * into v_row;

  if not found then
    select traffic.* into strict v_row
    from dashboard_private.notification_contract_traffic traffic
    where traffic.request_id = p_request_id;
    if v_row.entry_point <> 'google_chat'
      or v_row.contract_kind <> 'v2_source'
      or v_row.source_event_id <> p_source_event_id
      or v_row.build_revision_hash <> p_build_revision_hash
      or v_row.actor_profile_id <> p_actor_profile_id
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'recorded', true,
    'requestId', v_row.request_id,
    'translatable', v_row.outcome = 'route_started',
    'route', v_row.fixed_route,
    'buildRevisionHash', v_row.build_revision_hash,
    'outcome', v_row.outcome,
    'closed', v_closed_at is not null,
    'contractVersion', 2
  );
end;
$$;

create or replace function public.record_notification_contract_route_outcome_v1(
  p_request_id uuid,
  p_fixed_route text,
  p_outcome text,
  p_response_status integer,
  p_build_revision_hash text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_traffic dashboard_private.notification_contract_traffic%rowtype;
  v_row dashboard_private.notification_contract_route_outcomes%rowtype;
begin
  if (select auth.role()) <> 'service_role'
    or p_request_id is null
    or p_fixed_route not in (
      '/api/notifications/legacy/ops-task',
      '/api/notifications/legacy/makeup'
    )
    or p_outcome not in ('succeeded', 'failed')
    or p_response_status is null
    or p_response_status < 100
    or p_response_status > 599
    or p_build_revision_hash is null
    or p_build_revision_hash !~ '^[0-9a-f]{64}$'
    or (p_outcome = 'succeeded' and p_response_status not between 200 and 299)
  then
    raise exception 'notification_contract_route_outcome_invalid' using errcode = '22023';
  end if;

  select traffic.* into strict v_traffic
  from dashboard_private.notification_contract_traffic traffic
  where traffic.request_id = p_request_id
  for share;

  if v_traffic.contract_kind <> 'v2_source'
    or v_traffic.outcome <> 'route_started'
    or v_traffic.source_event_id is null
    or v_traffic.fixed_route <> p_fixed_route
    or v_traffic.build_revision_hash <> p_build_revision_hash
  then
    raise exception 'notification_contract_route_outcome_invalid' using errcode = '22023';
  end if;

  insert into dashboard_private.notification_contract_route_outcomes(
    request_id,
    source_event_id,
    fixed_route,
    build_revision_hash,
    outcome,
    response_status,
    actor_profile_id
  ) values (
    v_traffic.request_id,
    v_traffic.source_event_id,
    v_traffic.fixed_route,
    v_traffic.build_revision_hash,
    p_outcome,
    p_response_status,
    v_traffic.actor_profile_id
  ) on conflict (request_id) do nothing
  returning * into v_row;

  if not found then
    select route_outcome.* into strict v_row
    from dashboard_private.notification_contract_route_outcomes route_outcome
    where route_outcome.request_id = p_request_id;
    if v_row.source_event_id <> v_traffic.source_event_id
      or v_row.fixed_route <> p_fixed_route
      or v_row.build_revision_hash <> p_build_revision_hash
      or v_row.outcome <> p_outcome
      or v_row.response_status <> p_response_status
      or v_row.actor_profile_id <> v_traffic.actor_profile_id
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'recorded', true,
    'requestId', v_row.request_id,
    'sourceEventId', v_row.source_event_id,
    'fixedRoute', v_row.fixed_route,
    'buildRevisionHash', v_row.build_revision_hash,
    'outcome', v_row.outcome,
    'responseStatus', v_row.response_status,
    'recordedAt', v_row.created_at
  );
end;
$$;

-- 1945 bridge bundle의 fixed route가 provider 직전 공통 경계를 사용할 수 있도록
-- 1955/1959보다 먼저 필요한 SHA-256 및 외부시도 RPC를 additive로 제공한다.
create or replace function dashboard_private.notification_sha256_hex_v1(
  p_value text
) returns text
language plpgsql
stable
strict
security definer
set search_path = ''
as $$
declare
  v_schema text;
  v_hash text;
begin
  select namespace.nspname into v_schema
  from pg_catalog.pg_extension extension_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension_row.extnamespace
  where extension_row.extname = 'pgcrypto';
  if v_schema is null then
    raise exception 'notification_pgcrypto_unavailable' using errcode = '55000';
  end if;
  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest($1, ''sha256''), ''hex'')',
    v_schema
  ) into v_hash using p_value;
  if v_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'notification_sha256_invalid' using errcode = '55000';
  end if;
  return v_hash;
end;
$$;

create or replace function public.register_notification_external_attempt_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_claim_token uuid,
  p_dispatch_token uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_derived_claim_id uuid;
  v_attempt_id uuid;
  v_entity_id text;
  v_reason text;
begin
  if (select auth.role()) <> 'service_role'
    or p_dispatch_token is null
    or p_request_id is null
    or p_request_id <> p_dispatch_token
    or (p_delivery_id is null and p_claim_id is null)
    or (p_delivery_id is null and p_claim_token is not null)
    or (p_delivery_id is null and p_owner_generation is null)
    or (p_delivery_id is not null and p_claim_token is null)
    or (p_owner_generation is not null and p_owner_generation < 0)
  then
    raise exception 'notification_external_attempt_invalid' using errcode = '22023';
  end if;

  if p_delivery_id is not null then
    select delivery.* into v_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.id = p_delivery_id
    for update of delivery;
    if not found
      or v_delivery.status <> 'sending'
      or v_delivery.claim_token <> p_claim_token
      or v_delivery.channel_key not in ('google_chat', 'web_push', 'customer_message')
    then
      return pg_catalog.jsonb_build_object(
        'allowed', false, 'reason', 'delivery_dispatch_identity_mismatch'
      );
    end if;

    select event_row.* into strict v_event
    from dashboard_private.notification_events event_row
    where event_row.id = v_delivery.event_id;
    select ownership.id into v_derived_claim_id
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = v_event.workflow_key
      and ownership.occurrence_key = v_event.occurrence_key
      and ownership.rule_id = v_delivery.rule_id
      and ownership.channel_key = v_delivery.channel_key
      and ownership.target_key = v_delivery.target_key
      and ownership.target_generation = v_delivery.target_generation;
  else
    v_derived_claim_id := p_claim_id;
  end if;

  if v_derived_claim_id is null then
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'reason', 'dispatch_ownership_missing'
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-external-attempt:' || v_derived_claim_id::text, 0
  ));

  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = v_derived_claim_id
  for update of ownership;
  if not found then
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'reason', 'dispatch_ownership_missing'
    );
  end if;

  v_entity_id := v_claim.id::text || ':'
    || dashboard_private.notification_sha256_hex_v1(p_dispatch_token::text);
  if (p_claim_id is not null and p_claim_id <> v_claim.id)
    or (p_owner_generation is not null
      and p_owner_generation <> v_claim.owner_generation)
    or (p_owner_generation is null and (
      p_delivery_id is null or v_claim.owner_kind <> 'canonical'
    ))
    or v_claim.state <> 'dispatch_started'
    or v_claim.dispatch_token <> p_dispatch_token
    or (
      p_delivery_id is not null
      and (
        v_claim.workflow_key <> v_event.workflow_key
        or v_claim.occurrence_key <> v_event.occurrence_key
        or v_claim.rule_id <> v_delivery.rule_id
        or v_claim.channel_key <> v_delivery.channel_key
        or v_claim.target_key <> v_delivery.target_key
        or v_claim.target_generation <> v_delivery.target_generation
      )
    )
  then
    v_reason := 'dispatch_identity_mismatch';
  elsif exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'notification_external_attempt'
      and audit.entity_id = v_entity_id
      and audit.action = 'external_attempt_registered'
  ) then
    v_reason := 'attempt_already_registered';
  end if;

  if v_reason is not null then
    insert into dashboard_private.notification_audit_logs(
      entity_kind, entity_id, action, actor_profile_id, actor_kind,
      request_id, after_summary, reason_code
    ) values (
      'notification_external_attempt', v_entity_id,
      'duplicate_external_attempt', null, 'system', p_request_id,
      pg_catalog.jsonb_build_object(
        'workflow_key', v_claim.workflow_key,
        'channel_key', v_claim.channel_key,
        'owner_kind', v_claim.owner_kind,
        'owner_generation', v_claim.owner_generation::text,
        'dispatch_token_hash', dashboard_private.notification_sha256_hex_v1(
          p_dispatch_token::text
        )
      ),
      v_reason
    );
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', v_reason);
  end if;

  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind,
    request_id, after_summary, reason_code
  ) values (
    'notification_external_attempt', v_entity_id,
    'external_attempt_registered', null, 'system', p_request_id,
    pg_catalog.jsonb_build_object(
      'workflow_key', v_claim.workflow_key,
      'channel_key', v_claim.channel_key,
      'owner_kind', v_claim.owner_kind,
      'owner_generation', v_claim.owner_generation::text,
      'dispatch_token_hash', dashboard_private.notification_sha256_hex_v1(
        p_dispatch_token::text
      )
    ),
    'provider_boundary'
  ) returning id into v_attempt_id;

  return pg_catalog.jsonb_build_object(
    'allowed', true, 'attempt_id', v_attempt_id
  );
end;
$$;

create or replace function public.record_notification_contract_deployment_receipt_v1(
  p_request_id uuid,
  p_project_key_hash text,
  p_build_revision_hash text,
  p_contract_version integer,
  p_observation_bucket bigint,
  p_active_server_deployment_hashes text[],
  p_bridge_aware_server_deployment_hashes text[],
  p_pre_bridge_server_deployment_hashes text[]
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row dashboard_private.notification_contract_deployment_receipts%rowtype;
  v_closed_at timestamp with time zone;
  v_now timestamp with time zone;
  v_current_bucket bigint;
  v_inventory_observation_hash text;
begin
  if (select auth.role()) <> 'service_role'
    or p_request_id is null
    or p_project_key_hash is null
    or p_project_key_hash !~ '^[0-9a-f]{64}$'
    or p_build_revision_hash is null
    or p_build_revision_hash !~ '^[0-9a-f]{64}$'
    or p_contract_version <> 2
    or p_observation_bucket is null
    or p_active_server_deployment_hashes is null
    or p_bridge_aware_server_deployment_hashes is null
    or p_pre_bridge_server_deployment_hashes is null
    or pg_catalog.cardinality(p_active_server_deployment_hashes) = 0
    or exists (
      select 1
      from pg_catalog.unnest(
        p_active_server_deployment_hashes
        || p_bridge_aware_server_deployment_hashes
        || p_pre_bridge_server_deployment_hashes
      ) identity_hash
      where identity_hash !~ '^[0-9a-f]{64}$'
    )
    or pg_catalog.cardinality(p_active_server_deployment_hashes) <> (
      select pg_catalog.count(distinct identity_hash)
      from pg_catalog.unnest(p_active_server_deployment_hashes) identity_hash
    )
    or pg_catalog.cardinality(p_bridge_aware_server_deployment_hashes) <> (
      select pg_catalog.count(distinct identity_hash)
      from pg_catalog.unnest(p_bridge_aware_server_deployment_hashes) identity_hash
    )
    or pg_catalog.cardinality(p_pre_bridge_server_deployment_hashes) <> (
      select pg_catalog.count(distinct identity_hash)
      from pg_catalog.unnest(p_pre_bridge_server_deployment_hashes) identity_hash
    )
    or not p_bridge_aware_server_deployment_hashes <@ p_active_server_deployment_hashes
    or not p_pre_bridge_server_deployment_hashes <@ p_active_server_deployment_hashes
    or p_bridge_aware_server_deployment_hashes && p_pre_bridge_server_deployment_hashes
    or pg_catalog.cardinality(p_bridge_aware_server_deployment_hashes)
      + pg_catalog.cardinality(p_pre_bridge_server_deployment_hashes)
      <> pg_catalog.cardinality(p_active_server_deployment_hashes)
  then
    raise exception 'notification_contract_deployment_receipt_invalid' using errcode = '22023';
  end if;

  v_inventory_observation_hash := dashboard_private.notification_sha256_hex_v1(
    pg_catalog.jsonb_build_object(
      'inventory_source', 'vercel_production_alias_v1',
      'project_key_hash', p_project_key_hash,
      'build_revision_hash', p_build_revision_hash,
      'contract_version', p_contract_version,
      'observation_bucket', p_observation_bucket,
      'active_server_deployment_hashes', pg_catalog.to_jsonb(p_active_server_deployment_hashes),
      'bridge_aware_server_deployment_hashes', pg_catalog.to_jsonb(p_bridge_aware_server_deployment_hashes),
      'pre_bridge_server_deployment_hashes', pg_catalog.to_jsonb(p_pre_bridge_server_deployment_hashes)
    )::text
  );

  -- closure의 FOR UPDATE와 직렬화하여 검사 직후 불량 영수증이 끼어들 수 없게 한다.
  select state.closed_at into v_closed_at
  from dashboard_private.notification_contract_bridge_state state
  where state.state_key = 'legacy_contract_bridge_v1'
  for share;
  if not found then
    raise exception 'notification_contract_bridge_state_missing' using errcode = '55000';
  end if;

  -- closure/activation 잠금 대기 뒤의 실제 시각으로 영수증을 귀속한다. 호출
  -- 시작 시각을 쓰면 이미 닫힌 evidence 구간에 사후 영수증이 역기록될 수 있다.
  v_now := pg_catalog.clock_timestamp();
  v_current_bucket := pg_catalog.floor(
    pg_catalog.extract(epoch from v_now) / 300
  )::bigint;
  if p_observation_bucket not in (v_current_bucket, v_current_bucket - 1) then
    raise exception 'notification_contract_deployment_receipt_invalid' using errcode = '22023';
  end if;

  insert into dashboard_private.notification_contract_deployment_receipts(
    request_id,
    inventory_source,
    project_key_hash,
    build_revision_hash,
    inventory_observation_hash,
    contract_version,
    active_server_deployment_hashes,
    bridge_aware_server_deployment_hashes,
    pre_bridge_server_deployment_hashes,
    observed_at
  ) values (
    p_request_id,
    'vercel_production_alias_v1',
    p_project_key_hash,
    p_build_revision_hash,
    v_inventory_observation_hash,
    p_contract_version,
    p_active_server_deployment_hashes,
    p_bridge_aware_server_deployment_hashes,
    p_pre_bridge_server_deployment_hashes,
    v_now
  ) on conflict do nothing
  returning * into v_row;

  if not found then
    select receipt.* into v_row
    from dashboard_private.notification_contract_deployment_receipts receipt
    where receipt.request_id = p_request_id;
    if not found then
      select receipt.* into strict v_row
      from dashboard_private.notification_contract_deployment_receipts receipt
      where receipt.inventory_observation_hash = v_inventory_observation_hash;
    end if;
    if v_row.inventory_source <> 'vercel_production_alias_v1'
      or v_row.project_key_hash <> p_project_key_hash
      or v_row.build_revision_hash <> p_build_revision_hash
      or v_row.inventory_observation_hash <> v_inventory_observation_hash
      or v_row.contract_version <> p_contract_version
      or v_row.active_server_deployment_hashes <> p_active_server_deployment_hashes
      or v_row.bridge_aware_server_deployment_hashes <> p_bridge_aware_server_deployment_hashes
      or v_row.pre_bridge_server_deployment_hashes <> p_pre_bridge_server_deployment_hashes
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'recorded', true,
    'requestId', v_row.request_id,
    'inventorySource', v_row.inventory_source,
    'inventoryObservationHash', v_row.inventory_observation_hash,
    'buildRevisionHash', v_row.build_revision_hash,
    'contractVersion', v_row.contract_version,
    'totalServerInstances', v_row.total_server_instances,
    'bridgeAwareServerInstances', v_row.bridge_aware_server_instances,
    'preBridgeServerInstances', v_row.pre_bridge_server_instances,
    'recordedAt', v_row.observed_at,
    'closed', v_closed_at is not null
  );
end;
$$;

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
    pg_catalog.coalesce(pg_catalog.max(
      pg_catalog.extract(epoch from (receipt_rows.observed_at - receipt_rows.previous_at))
    ), 0),
    pg_catalog.coalesce(pg_catalog.sum(receipt_rows.pre_bridge_server_instances), 0),
    pg_catalog.coalesce(pg_catalog.sum(receipt_rows.total_server_instances), 0),
    pg_catalog.coalesce(pg_catalog.sum(receipt_rows.bridge_aware_server_instances), 0),
    pg_catalog.coalesce(pg_catalog.bool_and(
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
    'continuousHours', pg_catalog.extract(epoch from (p_window_end - p_window_start)) / 3600,
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

alter function public.get_notification_contract_closure_state_v1() owner to postgres;
alter function public.record_legacy_notification_delivery_intent_v1(
  uuid, text, text, uuid
) owner to postgres;
alter function public.record_notification_contract_traffic_v1(
  text, text, text, uuid, uuid
) owner to postgres;
alter function dashboard_private.notification_contract_fixed_route_v1(uuid)
  owner to postgres;
alter function dashboard_private.assert_notification_contract_source_access_v1(uuid, uuid)
  owner to postgres;
alter function public.resolve_legacy_notification_source_route_v1(uuid) owner to postgres;
alter function public.begin_notification_contract_v2_route_v1(uuid, uuid, uuid, text) owner to postgres;
alter function public.record_notification_contract_route_outcome_v1(
  uuid, text, text, integer, text
) owner to postgres;
alter function dashboard_private.notification_sha256_hex_v1(text) owner to postgres;
alter function public.register_notification_external_attempt_v1(
  uuid, uuid, bigint, uuid, uuid, uuid
) owner to postgres;
alter function public.record_notification_contract_deployment_receipt_v1(
  uuid, text, text, integer, bigint, text[], text[], text[]
) owner to postgres;
alter function public.get_notification_contract_drain_evidence_v1(
  timestamp with time zone, timestamp with time zone
) owner to postgres;

revoke all on function public.get_notification_contract_closure_state_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.record_legacy_notification_delivery_intent_v1(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.record_notification_contract_traffic_v1(
  text, text, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_contract_fixed_route_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_notification_contract_source_access_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_legacy_notification_source_route_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_notification_contract_v2_route_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_notification_contract_route_outcome_v1(
  uuid, text, text, integer, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_sha256_hex_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.register_notification_external_attempt_v1(
  uuid, uuid, bigint, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.record_notification_contract_deployment_receipt_v1(
  uuid, text, text, integer, bigint, text[], text[], text[]
) from public, anon, authenticated, service_role;
revoke all on function public.get_notification_contract_drain_evidence_v1(
  timestamp with time zone, timestamp with time zone
) from public, anon, authenticated, service_role;

grant execute on function public.get_notification_contract_closure_state_v1()
  to service_role;
grant execute on function public.record_legacy_notification_delivery_intent_v1(
  uuid, text, text, uuid
) to service_role;
grant execute on function public.record_notification_contract_traffic_v1(
  text, text, text, uuid, uuid
) to service_role;
grant execute on function public.resolve_legacy_notification_source_route_v1(uuid)
  to service_role;
grant execute on function public.begin_notification_contract_v2_route_v1(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.record_notification_contract_route_outcome_v1(
  uuid, text, text, integer, text
) to service_role;
grant execute on function public.register_notification_external_attempt_v1(
  uuid, uuid, bigint, uuid, uuid, uuid
) to service_role;
grant execute on function public.record_notification_contract_deployment_receipt_v1(
  uuid, text, text, integer, bigint, text[], text[], text[]
) to service_role;
grant execute on function public.get_notification_contract_drain_evidence_v1(
  timestamp with time zone, timestamp with time zone
) to service_role;

commit;
