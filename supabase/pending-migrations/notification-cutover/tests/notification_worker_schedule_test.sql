begin;

select plan(76);

select ok(
  dashboard_private.notification_sha256_hex_v1('worker-schedule-fixture')
    ~ '^[a-f0-9]{64}$',
  'pgcrypto 설치 스키마와 무관하게 SHA-256 감사 해시를 계산한다'
);

select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    'https://example.com/api/notifications/worker', '0123456789abcdef0123456789abcdef', 'example.com'
  ) ->> 'ok',
  'true',
  '정확한 https 기본 포트 URL이 허용된다'
);
select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    'https://example.com:443/api/notifications/worker', '0123456789abcdef0123456789abcdef', 'example.com'
  ) ->> 'ok',
  'true',
  '명시적 443 URL이 허용된다'
);
select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    'https://example.com:444/api/notifications/worker', '0123456789abcdef0123456789abcdef', 'example.com'
  ) ->> 'ok',
  'false',
  '443 이외 포트는 거절된다'
);
select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    'https://user@example.com/api/notifications/worker', '0123456789abcdef0123456789abcdef', 'example.com'
  ) ->> 'ok',
  'false',
  'userinfo URL은 거절된다'
);
select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    'https://example.com/api/notifications/worker?secret=x', '0123456789abcdef0123456789abcdef', 'example.com'
  ) ->> 'ok',
  'false',
  'query URL은 거절된다'
);
select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    'https://example.com/api/notifications/worker#x', '0123456789abcdef0123456789abcdef', 'example.com'
  ) ->> 'ok',
  'false',
  'fragment URL은 거절된다'
);
select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    null, null, 'example.com'
  ) ->> 'ok',
  'false',
  'Vault 값 누락은 fail-closed다'
);
select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    'https://example.com/api/notifications/worker', E'0123456789abcdef\n0123456789abcdef', 'example.com'
  ) ->> 'ok',
  'false',
  '인증값의 제어문자는 헤더 조작을 막기 위해 거절된다'
);
select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    'https://example.com/api/notifications/worker', 'too-short', 'example.com'
  ) ->> 'ok',
  'false',
  '32바이트보다 짧은 작업자 인증값은 거절된다'
);
select is(
  dashboard_private.validate_notification_worker_vault_values_v1(
    'https://example.com/api/notifications/worker', ' 0123456789abcdef0123456789abcdef ', 'example.com'
  ) ->> 'ok',
  'false',
  '실행 환경과 달라질 수 있는 인증값 앞뒤 공백은 거절된다'
);

create temporary table notification_worker_request_fixture (
  request_id bigint primary key
) on commit drop;

delete from vault.secrets
where name in ('notification_worker_url', 'notification_worker_bearer_secret');
delete from net._http_request;

select throws_ok(
  $$select dashboard_private.invoke_notification_worker_v1()$$,
  '55000',
  'notification_worker_vault_value_ambiguous',
  'Vault 값이 없으면 worker 호출은 fail-closed다'
);
select is(
  (select pg_catalog.count(*)::integer from net._http_request),
  0,
  'Vault 값 누락 시 pg_net 요청은 0건이다'
);

update dashboard_private.notification_schedule_configuration
set approved_worker_host = 'worker.test.invalid'
where config_key = 'global';

do $$
begin
  perform vault.create_secret(
    'https://worker.test.invalid/api/notifications/worker',
    'notification_worker_url'
  );
  perform vault.create_secret(
    pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'),
    'notification_worker_bearer_secret'
  );
end;
$$;

insert into notification_worker_request_fixture(request_id)
select dashboard_private.invoke_notification_worker_v1();

select is(
  (select pg_catalog.count(*)::integer from net._http_request),
  1,
  '유효한 fixture는 커밋 전 pg_net 큐에 요청을 정확히 1건만 만든다'
);
select is(
  (select request.method::text
   from net._http_request request
   join notification_worker_request_fixture fixture on fixture.request_id = request.id),
  'POST',
  'worker 요청 method는 POST다'
);
select is(
  (select request.url
   from net._http_request request
   join notification_worker_request_fixture fixture on fixture.request_id = request.id),
  'https://worker.test.invalid/api/notifications/worker',
  'worker 요청 URL은 검증한 고정 경로와 일치한다'
);
select ok(
  (select
     request.headers ? 'Authorization'
     and request.headers ->> 'Content-Type' = 'application/json'
     and request.headers ->> 'X-Notification-Contract-Version' = '2'
   from net._http_request request
   join notification_worker_request_fixture fixture on fixture.request_id = request.id),
  'worker 요청 header는 인증값을 노출하지 않고 고정 계약만 확인한다'
);
select is(
  (select pg_catalog.convert_from(request.body, 'UTF8')::jsonb
   from net._http_request request
   join notification_worker_request_fixture fixture on fixture.request_id = request.id),
  '{"batch_size":50,"lease_seconds":60}'::jsonb,
  'worker 요청 body는 고정 batch 계약이다'
);
select is(
  (select request.timeout_milliseconds
   from net._http_request request
   join notification_worker_request_fixture fixture on fixture.request_id = request.id),
  25000,
  'worker 요청 timeout은 고정값이다'
);

select lives_ok($$select dashboard_private.manage_notification_schedules_v1('remove')$$, 'schedule remove는 멱등이다');
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'worker_count')::integer, 0, '초기 worker schedule은 0개다');
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'watchdog_count')::integer, 0, '초기 watchdog schedule은 0개다');
select lives_ok($$select dashboard_private.manage_notification_schedules_v1('install')$$, '두 schedule을 설치한다');
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'worker_count')::integer, 1, 'worker schedule은 정확히 1개다');
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'watchdog_count')::integer, 1, 'watchdog schedule은 정확히 1개다');
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'worker_contract_count')::integer, 1, 'worker schedule의 분 단위 명령이 정확하다');
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'watchdog_contract_count')::integer, 1, 'watchdog schedule의 분 단위 명령이 정확하다');
select lives_ok($$select dashboard_private.manage_notification_schedules_v1('install')$$, '중복 install은 멱등이다');
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'worker_count')::integer, 1, '중복 install 뒤 worker는 1개다');
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'watchdog_count')::integer, 1, '중복 install 뒤 watchdog은 1개다');
create temporary table notification_worker_gate_fixture (
  response jsonb not null
) on commit drop;
update dashboard_private.notification_worker_stop_latch
set stopped = true,
    revision = revision + 1,
    reason_code = 'test_recovery_probe',
    updated_at = pg_catalog.clock_timestamp()
where latch_key = 'global';
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
insert into notification_worker_gate_fixture(response)
select public.assert_notification_worker_run_allowed_v1('notification-worker-route-v1');
select is(
  (select response ->> 'allowed' from notification_worker_gate_fixture),
  'false',
  '중단 래치는 claim을 막으면서 worker health probe만 기록한다'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_worker_health_probes probe
    where probe.worker_id = 'notification-worker-route-v1'
  ),
  '중단 중에도 복구 승인에 필요한 전용 worker health probe를 만들 수 있다'
);
select ok(
  not exists (
    select 1
    from dashboard_private.notification_worker_heartbeats heartbeat
    where heartbeat.worker_id = 'notification-worker-route-v1'
  ),
  'health probe는 실제 worker batch 성공 heartbeat로 위장하지 않는다'
);
insert into dashboard_private.notification_watchdog_heartbeats(
  run_id, phase, faults_detected, rollbacks_applied, error_code
) values
  ('22222222-2222-4222-8222-222222222222', 'started', 0, 0, null),
  ('22222222-2222-4222-8222-222222222222', 'succeeded', 0, 0, null);
select lives_ok(
  $$select public.clear_notification_worker_stop_latch_v1(
    (select revision from dashboard_private.notification_worker_stop_latch where latch_key = 'global'),
    '33333333-3333-4333-8333-333333333333',
    'test_recovery_authorized'
  )$$,
  '전용 health probe와 watchdog 증거로 중단 래치를 복구할 수 있다'
);
select is(
  (select stopped from dashboard_private.notification_worker_stop_latch where latch_key = 'global'),
  false,
  '복구 RPC는 중단 래치를 해제한다'
);
select is(
  dashboard_private.notification_recent_runtime_heartbeats_v1(),
  false,
  '래치 해제 직후에는 health probe만으로 활성화 준비가 되지 않는다'
);
do $$
declare
  v_counts jsonb := '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb;
begin
  perform public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1', '44444444-4444-4444-8444-444444444444',
    'started', v_counts, null
  );
  perform public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1', '44444444-4444-4444-8444-444444444444',
    'succeeded', v_counts, null
  );
end;
$$;
insert into dashboard_private.notification_watchdog_heartbeats(
  run_id, phase, faults_detected, rollbacks_applied, error_code
) values
  ('55555555-5555-4555-8555-555555555555', 'started', 0, 0, null),
  ('55555555-5555-4555-8555-555555555555', 'succeeded', 0, 0, null);
select is(
  dashboard_private.notification_recent_runtime_heartbeats_v1(),
  true,
  '래치 해제 뒤 고정 worker와 watchdog의 실제 성공이 있어야 활성화 준비가 된다'
);
select pg_catalog.set_config('request.jwt.claim.role', '', true);
update dashboard_private.notification_runtime_flags
set enabled = true
where flag_key = 'notification_control_plane_shadow_write_enabled';
select throws_ok(
  $$select dashboard_private.manage_notification_schedules_v1('disable')$$,
  '55000',
  'notification_schedule_shutdown_requires_containment',
  '활성 shadow 중에는 worker와 watchdog을 끌 수 없다'
);
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'active_count')::integer, 2, '거절된 중단 뒤 두 schedule은 계속 활성이다');
update dashboard_private.notification_runtime_flags
set enabled = false
where flag_key = 'notification_control_plane_shadow_write_enabled';
select lives_ok($$select dashboard_private.manage_notification_schedules_v1('disable')$$, '두 schedule을 disable한다');
select is((dashboard_private.inspect_notification_schedules_v1() ->> 'active_count')::integer, 0, 'disable 뒤 활성 schedule은 0개다');

select ok(not has_function_privilege('authenticated', 'dashboard_private.activate_notification_dispatch_cutover_v1_impl(text,text,jsonb,uuid)', 'EXECUTE'), 'authenticated는 private activation 구현을 직접 실행할 수 없다');
select ok(not has_function_privilege('authenticated', 'dashboard_private.abort_notification_shadow_v1_impl(jsonb,uuid,text)', 'EXECUTE'), 'authenticated는 private shadow abort 구현을 직접 실행할 수 없다');
select ok(not has_function_privilege('authenticated', 'dashboard_private.rollback_notification_dispatch_cutover_v1_impl(text,text[],jsonb,boolean,uuid,text)', 'EXECUTE'), 'authenticated는 private rollback 구현을 직접 실행할 수 없다');
select ok(not has_function_privilege('authenticated', 'dashboard_private.clear_notification_worker_stop_latch_v1_impl(bigint,uuid,text)', 'EXECUTE'), 'authenticated는 private latch clear 구현을 직접 실행할 수 없다');
select ok(not has_function_privilege('authenticated', 'dashboard_private.raise_notification_worker_stop_latch_v1(text)', 'EXECUTE'), 'authenticated는 private latch 설정을 직접 실행할 수 없다');
select ok(has_function_privilege('service_role', 'public.manage_notification_worker_schedule_v1(text,uuid)', 'EXECUTE'), 'service role은 승인된 schedule 관리 RPC만 실행한다');
select ok(has_function_privilege('service_role', 'public.record_notification_shadow_fixture_evidence_v1(text,uuid)', 'EXECUTE'), 'service role은 DB 계산형 범위 증거 RPC만 실행할 수 있다');
select ok(not has_function_privilege('authenticated', 'public.record_notification_shadow_fixture_evidence_v1(text,uuid)', 'EXECUTE'), 'authenticated는 shadow 범위 증거를 기록할 수 없다');
select ok(to_regprocedure('public.record_notification_shadow_fixture_evidence_v1(text,text,integer,integer,integer,integer,uuid)') is null, '호출자 digest와 count를 받던 구 fixture 계약은 제거됐다');
select ok(not has_table_privilege('service_role', 'dashboard_private.notification_shadow_no_active_rule_evidence', 'INSERT'), 'service role은 무활성 규칙 증거를 직접 위조할 수 없다');
select ok(not has_table_privilege('service_role', 'dashboard_private.notification_shadow_no_active_rule_evidence', 'UPDATE'), 'service role은 무활성 규칙 증거를 수정할 수 없다');
select ok(
  pg_catalog.pg_get_functiondef(
    'public.record_notification_shadow_fixture_evidence_v1(text,uuid)'::pg_catalog.regprocedure
  ) not like '%materialize_notification_delivery_v1%',
  '범위 증거 RPC는 합성 canonical delivery를 만들지 않는다'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.record_notification_shadow_fixture_evidence_v1(text,uuid)'::pg_catalog.regprocedure
  ) not like '%record_legacy_notification_intent_v1%',
  '범위 증거 RPC는 동일 입력으로 legacy 비교를 자가 생성하지 않는다'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.record_notification_shadow_fixture_evidence_v1(text,uuid)'::pg_catalog.regprocedure
  ) like '%notification_shadow_natural_comparison_required%',
  '활성 규칙 범위는 자연 발생 운영 비교가 없으면 fail-closed다'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'dashboard_private.notification_shadow_comparison_current_v1(text,text,timestamp with time zone)'::pg_catalog.regprocedure
  ) not like '%fixture_no_external_side_effect%',
  '현재성 검증기는 self-parity fixture 예외를 인정하지 않는다'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'dashboard_private.notification_shadow_comparison_current_v1(text,text,timestamp with time zone)'::pg_catalog.regprocedure
  ) like '%event_row.source_type <> ''notification_shadow_fixture_v1''%',
  '현재성 검증기는 fixture source를 명시적으로 제외한다'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'dashboard_private.notification_no_active_rule_evidence_current_v1(text,uuid,timestamp with time zone)'::pg_catalog.regprocedure
  ) like '%notification_shadow_scope_config_digest_v1(p_scope_key)%'
  and pg_catalog.pg_get_functiondef(
    'dashboard_private.notification_no_active_rule_evidence_current_v1(text,uuid,timestamp with time zone)'::pg_catalog.regprocedure
  ) like '%evidence.shadow_revision = shadow_flag.revision%'
  and pg_catalog.pg_get_functiondef(
    'dashboard_private.notification_no_active_rule_evidence_current_v1(text,uuid,timestamp with time zone)'::pg_catalog.regprocedure
  ) like '%rule_row.enabled%',
  '무활성 규칙 증거는 현재 digest와 shadow revision 및 활성 규칙 0건을 다시 확인한다'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'dashboard_private.notification_shadow_no_active_rule_evidence'::pg_catalog.regclass),
  '무활성 규칙 증거표는 RLS로 직접 접근을 닫는다'
);
select ok(not has_function_privilege('service_role', 'dashboard_private.notification_shadow_comparison_current_v1(text,text,timestamp with time zone)', 'EXECUTE'), 'service role은 현재 comparison 검증기를 직접 우회 호출할 수 없다');
select ok(not has_function_privilege('service_role', 'dashboard_private.notification_no_active_rule_evidence_current_v1(text,uuid,timestamp with time zone)', 'EXECUTE'), 'service role은 무활성 규칙 현재성 검증기를 직접 우회 호출할 수 없다');
select ok(not has_function_privilege('service_role', 'dashboard_private.notification_current_contract_build_revision_hash_v1(timestamp with time zone)', 'EXECUTE'), 'service role은 현재 운영 build 검증기를 직접 우회 호출할 수 없다');
select ok(not has_table_privilege('service_role', 'dashboard_private.notification_audit_logs', 'INSERT'), 'service role은 shadow 증거 audit을 직접 위조할 수 없다');
select ok(has_table_privilege('service_role', 'dashboard_private.notification_audit_logs', 'SELECT'), 'service role은 고정 운영 조회를 위해 audit을 읽을 수 있다');

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$select public.configure_notification_worker_schedule_v1(
    null,
    (select revision from dashboard_private.notification_schedule_configuration where config_key = 'global'),
    '66666666-6666-4666-8666-666666666666'
  )$$,
  '22023',
  'notification_schedule_configuration_invalid',
  '승인 host NULL은 fail-closed로 거절한다'
);
select throws_ok(
  $$select public.manage_notification_worker_schedule_v1(
    null,
    '77777777-7777-4777-8777-777777777777'
  )$$,
  '22023',
  'notification_schedule_management_invalid',
  'schedule action NULL은 fail-closed로 거절한다'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.reap_notification_leases_v1(text,integer)'::pg_catalog.regprocedure
  ) like '%complete_registration_admission_delivery_v1%',
  '만료된 SOLAPI sending은 등록 업무와 delivery를 원자 완료한다'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.reap_notification_leases_v1(text,integer)'::pg_catalog.regprocedure
  ) like '%delivery.channel_key <> ''customer_message''%',
  '일반 sending reaper는 SOLAPI 전용 customer_message를 건드리지 않는다'
);
select is(
  public.notification_control_plane_forward_compat_runtime_version(),
  1,
  '최종 순방향 호환 런타임 마커가 준비되어 있다'
);
select is(
  dashboard_private.notification_runtime_dependency_ready_v1('forward_compat'),
  true,
  '최종 순방향 호환 마커가 없으면 활성화 준비가 닫힌다'
);
select is(
  dashboard_private.notification_runtime_dependency_ready_v1('registration_handoffs'),
  true,
  '등록 특화 인수인계 마커도 활성화 준비에 포함된다'
);
select is(
  dashboard_private.notification_cutover_scope_order_v1(),
  array[
    'tasks', 'word_retests', 'approvals', 'transfer', 'withdrawal',
    'makeup_requests', 'registration', 'registration_phone',
    'registration_visit', 'registration_solapi'
  ]::text[],
  'DB 활성화 순서는 승인된 열 개 owner 순서와 정확히 일치한다'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'dashboard_private.notification_operations_metrics_v1()'::pg_catalog.regprocedure
  ) like '%audit.reason_code = ''canonical_inbox_in_shadow''%',
  'shadow inbox 중단 지표는 삽입 시점의 audit 사유를 집계한다'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.audit_notification_inbox_projection_v1()'::pg_catalog.regprocedure
    ),
    'for share of flag_row'
  ) > 0,
  'shadow inbox audit은 flag SHARE lock으로 activation과 직렬화한다'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.audit_notification_inbox_projection_v1()'::pg_catalog.regprocedure
    ),
    'and v_ownership.owner_kind is distinct from ''legacy'''
  ) = 0,
  'shadow의 canonical source delivery inbox는 owner 종류와 무관하게 중단 사유를 남긴다'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'dashboard_private.notification_operations_metrics_v1()'::pg_catalog.regprocedure
  ) like '%not dispatch_flag.enabled and ownership.owner_kind <> ''legacy''%',
  'shadow의 dispatch 비활성 scope에서는 legacy ownership을 정상으로 인정한다'
);

select * from finish();
rollback;
