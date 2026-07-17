begin;

select plan(40);

select is(
  (select count(*) from dashboard_private.notification_runtime_flags),
  12::bigint,
  '알림 runtime flag registry는 정확히 12개다'
);
select is(
  (select count(*) from dashboard_private.notification_runtime_flags where enabled),
  0::bigint,
  'closure 적용 시 열두 flag는 모두 false다'
);
select is(
  (select count(*) from dashboard_private.notification_runtime_flags
   where flag_key in (
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
   )),
  12::bigint,
  'runtime flag key 집합은 승인된 열두 개와 정확히 같다'
);
select is(
  (select count(*) from dashboard_private.notification_rules
   where workflow_key in ('tasks', 'word_retests', 'approvals') and enabled),
  0::bigint,
  '신규 세 workflow는 모두 disabled다'
);
select is(
  (select count(*) from dashboard_private.notification_rules
   where audience_key in ('applicant', 'operations')),
  0::bigint,
  'phantom audience는 없다'
);
select is(
  (select count(*) from dashboard_private.notification_rules rule_row
   left join dashboard_private.notification_templates template_row
     on template_row.id = rule_row.active_template_id
   where template_row.id is null),
  0::bigint,
  '모든 rule은 active template을 가진다'
);
select is(
  (select count(*) from dashboard_private.notification_source_type_registry),
  12::bigint,
  '닫힌 workflow/source type 조합은 정확히 12개다'
);
select is(public.notification_workflow_legacy_closure_version(), 1, 'closure marker는 1이다');

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_contract_closures closure
    where closure.build_revision_hash ~ '^[0-9a-f]{64}$'
      and closure.evidence_window_end - closure.evidence_window_start >= interval '24 hours'
      and closure.evidence_receipt_count > 0
      and closure.ops_task_route_successes > 0
      and closure.makeup_route_successes > 0
  ),
  1::bigint,
  '폐쇄 marker는 단일 build와 24시간 증거 구간을 불변으로 보관한다'
);
select is_empty($$
  select closure.closure_key
  from dashboard_private.notification_contract_closures closure
  left join dashboard_private.notification_contract_deployment_receipts first_receipt
    on first_receipt.id = closure.evidence_first_receipt_id
  left join dashboard_private.notification_contract_deployment_receipts last_receipt
    on last_receipt.id = closure.evidence_last_receipt_id
  where first_receipt.id is null
    or last_receipt.id is null
    or first_receipt.build_revision_hash <> closure.build_revision_hash
    or last_receipt.build_revision_hash <> closure.build_revision_hash
    or first_receipt.observed_at > closure.evidence_window_start + interval '5 minutes'
    or last_receipt.observed_at < closure.evidence_window_end - interval '5 minutes'
$$, '폐쇄 marker의 첫·마지막 영수증은 같은 build로 증거 구간을 덮는다');
select ok(exists (
  select 1
  from dashboard_private.notification_contract_closures closure
  join dashboard_private.notification_contract_traffic traffic
    on traffic.build_revision_hash = closure.build_revision_hash
  join dashboard_private.notification_contract_route_outcomes outcome
    on outcome.request_id = traffic.request_id
   and outcome.build_revision_hash = traffic.build_revision_hash
  where outcome.outcome = 'succeeded'
    and outcome.fixed_route = '/api/notifications/legacy/ops-task'
    and traffic.created_at >= closure.evidence_window_start
    and traffic.created_at < closure.evidence_window_end
), 'ops-task 성공 증거는 폐쇄 marker와 같은 build에서 발생했다');
select ok(exists (
  select 1
  from dashboard_private.notification_contract_closures closure
  join dashboard_private.notification_contract_traffic traffic
    on traffic.build_revision_hash = closure.build_revision_hash
  join dashboard_private.notification_contract_route_outcomes outcome
    on outcome.request_id = traffic.request_id
   and outcome.build_revision_hash = traffic.build_revision_hash
  where outcome.outcome = 'succeeded'
    and outcome.fixed_route = '/api/notifications/legacy/makeup'
    and traffic.created_at >= closure.evidence_window_start
    and traffic.created_at < closure.evidence_window_end
), '휴보강 성공 증거는 폐쇄 marker와 같은 build에서 발생했다');
select ok(
  not has_table_privilege('service_role', 'dashboard_private.notification_audit_logs', 'INSERT')
  and not has_table_privilege('service_role', 'dashboard_private.notification_audit_logs', 'UPDATE')
  and not has_table_privilege('service_role', 'dashboard_private.notification_audit_logs', 'DELETE')
  and not has_table_privilege('service_role', 'dashboard_private.notification_audit_logs', 'TRUNCATE'),
  'service role은 외부시도 중복 원장을 직접 변조할 수 없다'
);
select ok(
  has_table_privilege('service_role', 'dashboard_private.notification_audit_logs', 'SELECT'),
  'service role은 외부시도 중복 원장을 읽을 수 있다'
);
select ok(
  not has_table_privilege('service_role', 'dashboard_private.notification_contract_closures', 'INSERT')
  and not has_table_privilege('service_role', 'dashboard_private.notification_contract_closures', 'UPDATE')
  and not has_table_privilege('service_role', 'dashboard_private.notification_contract_closures', 'DELETE')
  and not has_table_privilege('service_role', 'dashboard_private.notification_contract_closures', 'TRUNCATE'),
  'service role은 폐쇄 marker를 직접 변조할 수 없다'
);
select ok(
  has_table_privilege('service_role', 'dashboard_private.notification_contract_closures', 'SELECT'),
  'service role은 폐쇄 marker를 읽을 수 있다'
);

select ok(not has_table_privilege('authenticated', 'public.dashboard_notifications', 'INSERT'), 'inbox 직접 insert가 회수된다');
select ok(not has_table_privilege('authenticated', 'public.dashboard_notifications', 'UPDATE'), 'inbox 직접 update가 회수된다');
select ok(not has_table_privilege('authenticated', 'public.dashboard_notifications', 'DELETE'), 'inbox 직접 delete가 회수된다');
select ok(not has_table_privilege('authenticated', 'public.ops_task_events', 'INSERT'), 'ops task event 직접 insert가 회수된다');
select ok(not has_table_privilege('authenticated', 'public.ops_task_comments', 'INSERT'), 'ops task comment 직접 insert가 회수된다');
select ok(not has_table_privilege('authenticated', 'public.makeup_request_events', 'INSERT'), '휴보강 event 직접 insert가 회수된다');
select ok(not has_table_privilege('authenticated', 'public.makeup_notification_deliveries', 'INSERT'), '휴보강 delivery 직접 insert가 회수된다');
select ok(not has_table_privilege('authenticated', 'public.approval_events', 'INSERT'), '결재 event 직접 insert가 회수된다');
select ok(not has_table_privilege('authenticated', 'public.approval_comments', 'INSERT'), '결재 comment 직접 insert가 회수된다');
select ok(not has_table_privilege('anon', 'public.dashboard_notifications', 'INSERT'), 'anon inbox 직접 insert가 회수된다');
select ok(not exists (
  select 1
  from pg_catalog.pg_class relation
  cross join lateral pg_catalog.aclexplode(
    coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
  ) privilege
  where relation.oid = 'public.dashboard_notifications'::regclass
    and privilege.grantee = 0
    and privilege.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
), 'PUBLIC inbox 직접 쓰기 권한이 회수된다');

select ok(has_table_privilege('authenticated', 'public.dashboard_notifications', 'SELECT'), 'inbox 보존기간 read는 유지된다');
select ok(has_table_privilege('authenticated', 'public.ops_task_events', 'SELECT'), 'ops task event read는 유지된다');
select ok(has_table_privilege('authenticated', 'public.ops_task_comments', 'SELECT'), 'ops task comment read는 유지된다');
select ok(has_table_privilege('authenticated', 'public.makeup_request_events', 'SELECT'), '휴보강 event read는 유지된다');
select ok(has_table_privilege('authenticated', 'public.approval_events', 'SELECT'), '결재 event read는 유지된다');
select ok(has_function_privilege('service_role', 'public.revalidate_immediate_notification_delivery_v1(text,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)', 'EXECUTE'), 'service role만 revalidation RPC를 실행한다');
select ok(has_function_privilege('service_role', 'public.record_legacy_notification_intent_v1(text,text,uuid,text,text,bigint,text,uuid)', 'EXECUTE'), 'service role은 legacy intent 기록 RPC를 실행한다');
select ok(not has_function_privilege('authenticated', 'public.record_legacy_notification_intent_v1(text,text,uuid,text,text,bigint,text,uuid)', 'EXECUTE'), 'authenticated는 legacy intent 기록 RPC를 직접 실행할 수 없다');
select ok(has_function_privilege('service_role', 'public.record_legacy_notification_intent_v1(text,text,uuid,text,text,bigint,text,text,uuid)', 'EXECUTE'), 'service role은 legacy template checksum 분리 intent RPC를 실행한다');
select ok(not has_function_privilege('authenticated', 'public.record_legacy_notification_intent_v1(text,text,uuid,text,text,bigint,text,text,uuid)', 'EXECUTE'), 'authenticated는 legacy template checksum 분리 intent RPC를 직접 실행할 수 없다');

select is(
  (
    dashboard_private.notification_assert_makeup_retained_import_complete_v1()
      ->> 'unimported_count'
  )::bigint,
  0::bigint,
  'writer revoke 뒤 최종 휴보강 보관 import의 미수입 건수는 0이다'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_makeup_retention_observations observation
    where observation.observation_kind = 'legacy_writer_closed'
  ),
  'writer revoke 뒤 최종 보관 검증을 append-only 관측으로 남긴다'
);
select is_empty($$
  select observation.id
  from dashboard_private.notification_makeup_retention_observations observation
  where observation.observation_kind = 'legacy_writer_closed'
    and (
      observation.unimported_count <> 0
      or observation.retained_count <> observation.imported_count
      or observation.retained_checksum <> observation.imported_checksum
    )
$$, '최종 보관 관측의 원본/영수증 개수와 checksum parity가 일치한다');

select * from finish();
rollback;
