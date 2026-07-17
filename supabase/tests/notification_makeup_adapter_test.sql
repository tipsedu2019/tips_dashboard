begin;

select plan(56);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

select has_function(
  'dashboard_private',
  'notification_reconcile_makeup_settings_v1',
  array[]::text[],
  'Task 8 기준 뒤 변경된 휴보강 설정만 조정하는 함수가 있다'
);
select has_function(
  'dashboard_private',
  'notification_import_makeup_retained_state_v1',
  array[]::text[],
  '보관 휴보강 이력을 한 번만 가져오는 함수가 있다'
);
select has_table(
  'dashboard_private',
  'notification_makeup_legacy_imports',
  '레거시 delivery별 import 영수증이 있다'
);
select has_table(
  'dashboard_private',
  'notification_makeup_retention_observations',
  '보관 이력 관측값을 덮어쓰지 않는 append-only 감사표가 있다'
);
select has_function(
  'dashboard_private',
  'notification_assert_makeup_retained_import_complete_v1',
  array[]::text[],
  '레거시 원본과 import 영수증의 개수·checksum parity를 검증한다'
);
select has_table(
  'dashboard_private',
  'notification_makeup_reconcile_audits',
  'Task 8 직후 상태와 Task 17 조정 결과를 같은 규칙 단위로 보존한다'
);
select has_function(
  'public',
  'create_makeup_request_v2',
  array['jsonb', 'uuid'],
  '원자적 휴보강 생성 RPC가 있다'
);
select has_function(
  'public',
  'transition_makeup_request_v2',
  array['uuid', 'text', 'jsonb', 'text', 'uuid'],
  '원자적 휴보강 전이 RPC가 있다'
);
select has_function(
  'dashboard_private',
  'notification_assert_makeup_room_available_v1',
  array['uuid'],
  '동일 강의실 승인 점유를 트랜잭션 안에서 다시 검사한다'
);
select has_function(
  'public',
  'delete_makeup_request_v2',
  array['uuid', 'uuid'],
  '원자적 휴보강 삭제 RPC가 있다'
);
select has_function(
  'public',
  'materialize_makeup_legacy_google_chat_v1',
  array['uuid', 'uuid', 'text', 'bigint', 'uuid', 'uuid'],
  '구글챗 레거시 브리지도 canonical delivery를 만든다'
);
select has_function(
  'public',
  'finalize_makeup_legacy_google_chat_v1',
  array['uuid', 'uuid', 'bigint', 'uuid', 'text', 'text'],
  '구글챗 결과를 소유권과 canonical delivery에 함께 확정한다'
);
select has_trigger(
  'public',
  'makeup_notification_settings',
  'reconcile_makeup_notification_settings_after_write_v1',
  '레거시 설정 변경은 같은 트랜잭션에서 Task 8 기준과 조정된다'
);

create temporary table makeup_adapter_before as
select
  rule_row.id as rule_id,
  rule_row.revision,
  rule_row.enabled,
  rule_row.active_template_id,
  template_row.checksum
from dashboard_private.notification_rules rule_row
join dashboard_private.notification_templates template_row
  on template_row.id = rule_row.active_template_id
where rule_row.workflow_key = 'makeup_requests';

select lives_ok(
  $$select dashboard_private.notification_reconcile_makeup_settings_v1()$$,
  '변경이 없으면 설정 조정은 안전한 no-op이다'
);
select lives_ok(
  $$select dashboard_private.notification_reconcile_makeup_settings_v1()$$,
  '설정 조정 두 번째 실행도 안전한 no-op이다'
);
select is_empty($$
  select before.rule_id
  from makeup_adapter_before before
  join dashboard_private.notification_rules rule_row on rule_row.id = before.rule_id
  join dashboard_private.notification_templates template_row
    on template_row.id = rule_row.active_template_id
  where row(before.revision, before.enabled, before.active_template_id, before.checksum)
    is distinct from row(
      rule_row.revision,
      rule_row.enabled,
      rule_row.active_template_id,
      template_row.checksum
    )
$$, '변경 없는 재실행은 rule ID/revision/enabled/template checksum을 보존한다');
select is_empty($$
  select audit.rule_id
  from dashboard_private.notification_makeup_reconcile_audits audit
  where audit.audit_key = 'task17-install-v1'
    and not audit.source_changed
    and row(
      audit.before_revision,
      audit.before_enabled,
      audit.before_template_id,
      audit.before_template_checksum,
      audit.before_updated_by,
      audit.before_updated_actor_kind
    ) is distinct from row(
      audit.after_revision,
      audit.after_enabled,
      audit.after_template_id,
      audit.after_template_checksum,
      audit.after_updated_by,
      audit.after_updated_actor_kind
    )
$$, 'Task 8 뒤 원본이 그대로인 규칙은 Task 17 설치 전후 ID·revision·enabled·checksum·운영자 소유권이 같다');

insert into public.profiles(id, role)
values ('6ec17167-a617-4ee7-81e8-e6977a309abc'::uuid, 'viewer')
on conflict (id) do nothing;

create temporary table makeup_adapter_operator_case as
select
  metadata.source_key,
  metadata.source_checksum,
  legacy_setting.trigger_kind,
  legacy_setting.channel,
  (metadata.mapped_rule_ids ->> 0)::uuid as rule_id
from dashboard_private.notification_settings_import_metadata metadata
join public.makeup_notification_settings legacy_setting
  on metadata.source_key = 'makeup_notification_settings:'
    || legacy_setting.trigger_kind || ':' || legacy_setting.channel
where metadata.source_table = 'public.makeup_notification_settings'
  and pg_catalog.jsonb_array_length(metadata.mapped_rule_ids) > 0
order by metadata.source_key
limit 1;

update dashboard_private.notification_rules rule_row
set enabled = not rule_row.enabled,
    revision = rule_row.revision + 1,
    updated_by = '6ec17167-a617-4ee7-81e8-e6977a309abc'::uuid,
    updated_actor_kind = 'user',
    updated_at = pg_catalog.clock_timestamp()
where rule_row.id = (select rule_id from makeup_adapter_operator_case);

create temporary table makeup_adapter_operator_rule_before as
select rule_row.id, rule_row.revision, rule_row.enabled, rule_row.active_template_id,
       rule_row.updated_by, rule_row.updated_actor_kind
from dashboard_private.notification_rules rule_row
where rule_row.id = (select rule_id from makeup_adapter_operator_case);

select lives_ok(
  $$select dashboard_private.notification_reconcile_makeup_settings_v1()$$,
  '레거시 원본이 그대로면 공통 UI 운영자 수정은 조정 대상이 아니다'
);
select is_empty($$
  select before.id
  from makeup_adapter_operator_rule_before before
  join dashboard_private.notification_rules rule_row on rule_row.id = before.id
  where row(
    rule_row.revision,
    rule_row.enabled,
    rule_row.active_template_id,
    rule_row.updated_by,
    rule_row.updated_actor_kind
  ) is distinct from row(
    before.revision,
    before.enabled,
    before.active_template_id,
    before.updated_by,
    before.updated_actor_kind
  )
$$, '레거시 변경이 없으면 운영자 rule revision/enabled를 그대로 보존한다');

select throws_ok(
  $$
    update public.makeup_notification_settings legacy_setting
    set enabled = not legacy_setting.enabled
    where (legacy_setting.trigger_kind, legacy_setting.channel) = (
      select trigger_kind, channel from makeup_adapter_operator_case
    )
  $$,
  '55000',
  'notification_makeup_operator_edit_conflict',
  '운영자 수정 규칙과 변경된 레거시 설정이 충돌하면 저장 트랜잭션을 중단한다'
);
select is_empty($$
  select before.id
  from makeup_adapter_operator_rule_before before
  join dashboard_private.notification_rules rule_row on rule_row.id = before.id
  where row(
    rule_row.revision,
    rule_row.enabled,
    rule_row.active_template_id,
    rule_row.updated_by,
    rule_row.updated_actor_kind
  ) is distinct from row(
    before.revision,
    before.enabled,
    before.active_template_id,
    before.updated_by,
    before.updated_actor_kind
  )
  union all
  select null::uuid
  from makeup_adapter_operator_case operator_case
  join dashboard_private.notification_settings_import_metadata metadata
    on metadata.source_key = operator_case.source_key
  where metadata.source_checksum is distinct from operator_case.source_checksum
$$, '충돌 시 운영자 규칙과 Task 8 기준 checksum을 그대로 보존한다');

insert into public.makeup_requests(
  id,
  status,
  request_kind,
  subject,
  approval_group,
  class_name,
  reason,
  makeup_slots,
  created_at,
  updated_at
) values (
  '91000000-0000-4000-8000-000000000101',
  'approval_pending',
  'cancel_only',
  'english',
  'english',
  '보관 이력 원본 계보 fixture',
  '실제 원본 occurrence 매핑 검증',
  '[]'::jsonb,
  '2026-07-16 09:00:00+09'::timestamptz,
  '2026-07-16 09:00:00+09'::timestamptz
);

insert into public.makeup_requests(
  id, status, request_kind, subject, approval_group, class_name, reason,
  makeup_start_at, makeup_end_at, makeup_classroom, makeup_slots,
  created_at, updated_at
) values
  (
    '91000000-0000-4000-8000-000000000401',
    'approval_pending', 'makeup_only', 'english', 'english',
    '강의실 직렬화 첫 요청', '동시 승인 fixture',
    '2026-07-18 19:00:00+09', '2026-07-18 21:00:00+09', '본2',
    '[{"id":"slot-1","startAt":"2026-07-18T19:00:00+09:00","endAt":"2026-07-18T21:00:00+09:00","classroom":"본2"}]'::jsonb,
    now(), now()
  ),
  (
    '91000000-0000-4000-8000-000000000402',
    'approval_pending', 'makeup_only', 'english', 'english',
    '강의실 직렬화 두 번째 요청', '동시 승인 fixture',
    '2026-07-18 20:00:00+09', '2026-07-18 22:00:00+09', '본관 2강',
    '[{"id":"slot-1","startAt":"2026-07-18T20:00:00+09:00","endAt":"2026-07-18T22:00:00+09:00","classroom":"본관 2강"}]'::jsonb,
    now(), now()
  );

select lives_ok(
  $$select dashboard_private.notification_assert_makeup_room_available_v1(
    '91000000-0000-4000-8000-000000000401'
  )$$,
  '아직 승인되지 않은 요청끼리는 첫 승인 후보를 선택할 수 있다'
);
update public.makeup_requests
set status = 'completed'
where id = '91000000-0000-4000-8000-000000000401';
select throws_ok(
  $$select dashboard_private.notification_assert_makeup_room_available_v1(
    '91000000-0000-4000-8000-000000000402'
  )$$,
  '40001',
  'makeup_room_collision',
  '먼저 승인된 일정과 겹치는 두 번째 승인을 거절한다'
);

insert into public.makeup_request_events(
  id, request_id, event_type, note, created_at
) values
  (
    '91000000-0000-4000-8000-000000000201',
    '91000000-0000-4000-8000-000000000101',
    'submitted',
    '첫 제출',
    '2026-07-16 09:01:00+09'::timestamptz
  ),
  (
    '91000000-0000-4000-8000-000000000202',
    '91000000-0000-4000-8000-000000000101',
    'resubmitted',
    '최종 재제출',
    '2026-07-16 09:01:02+09'::timestamptz
  );

insert into public.makeup_notification_deliveries(
  id,
  request_id,
  trigger_kind,
  channel,
  target_type,
  target_label,
  recipient_team,
  status,
  dedupe_key,
  title,
  body,
  metadata,
  created_at
) values (
  '91000000-0000-4000-8000-000000000301',
  '91000000-0000-4000-8000-000000000101',
  'submitted',
  'dashboard_management',
  'team',
  '관리팀',
  'management',
  'sent',
  'makeup-retained-lineage-fixture-v1',
  '보관 이력 제목',
  '보관 이력 본문',
  '{"fixture":"retained-lineage"}'::jsonb,
  '2026-07-16 09:01:04+09'::timestamptz
);

select lives_ok(
  $$select dashboard_private.notification_import_makeup_retained_state_v1()$$,
  '보관 delivery/history/occurrence를 가져온다'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_makeup_legacy_imports receipt
    join dashboard_private.notification_events canonical_event
      on canonical_event.id = receipt.event_id
    where receipt.legacy_delivery_id = '91000000-0000-4000-8000-000000000301'
      and receipt.source_event_id = '91000000-0000-4000-8000-000000000202'
      and canonical_event.source_type = 'makeup_request_event'
      and canonical_event.source_id = receipt.source_event_id::text
      and canonical_event.occurrence_key = receipt.source_event_id::text
      and canonical_event.occurred_at = '2026-07-16 09:01:02+09'::timestamptz
  ),
  'delivery 시각 +5초 안의 허용 원본 중 가장 최신 재제출 이벤트를 occurrence로 사용한다'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_makeup_legacy_imports receipt
    where receipt.legacy_delivery_id = '91000000-0000-4000-8000-000000000301'
      and receipt.legacy_snapshot ->> 'legacyDeliveryId'
        = '91000000-0000-4000-8000-000000000301'
      and receipt.legacy_snapshot ->> 'dedupeKey'
        = 'makeup-retained-lineage-fixture-v1'
      and receipt.legacy_snapshot ->> 'title' = '보관 이력 제목'
      and receipt.legacy_snapshot ->> 'body' = '보관 이력 본문'
      and receipt.legacy_snapshot ->> 'status' = 'sent'
      and receipt.legacy_snapshot -> 'target' ->> 'label' = '관리팀'
      and receipt.legacy_snapshot -> 'target' ->> 'recipientTeam' = 'management'
      and receipt.legacy_snapshot ? 'createdAt'
      and receipt.source_checksum = pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(receipt.legacy_snapshot::text, 'UTF8')
        ),
        'hex'
      )
  ),
  '영수증은 안전한 legacy ID·dedupe·렌더링·대상·상태·시각 스냅샷과 그 checksum을 보존한다'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_makeup_legacy_imports receipt
    join dashboard_private.notification_deliveries canonical_delivery
      on canonical_delivery.id = receipt.canonical_delivery_id
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on ownership.id = receipt.ownership_claim_id
    where receipt.legacy_delivery_id = '91000000-0000-4000-8000-000000000301'
      and canonical_delivery.event_id = receipt.event_id
      and ownership.occurrence_key = receipt.source_event_id::text
      and ownership.rule_id = canonical_delivery.rule_id
      and ownership.channel_key = canonical_delivery.channel_key
      and ownership.target_key = canonical_delivery.target_key
  ),
  'canonical delivery와 legacy 소유권도 실제 원본 이벤트 occurrence를 공유한다'
);
select ok(
  (
    select pg_catalog.count(distinct receipt.event_id) = 1
    from dashboard_private.notification_makeup_legacy_imports receipt
    where receipt.source_event_id = '91000000-0000-4000-8000-000000000202'
  )
  and not exists (
    select 1
    from dashboard_private.notification_makeup_legacy_imports receipt
    join dashboard_private.notification_event_fanout_jobs fanout
      on fanout.event_id = receipt.event_id
    where receipt.source_event_id = '91000000-0000-4000-8000-000000000202'
  ),
  '보관 history event는 원본 occurrence당 하나이며 재전송 fanout job을 만들지 않는다'
);
select ok(
  (
    dashboard_private.notification_assert_makeup_retained_import_complete_v1()
      ->> 'unimported_count'
  ) = '0',
  '보관 이력 전체 원본과 import 영수증의 최종 개수·checksum parity가 맞는다'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_makeup_retention_observations observation
    where observation.observation_kind = 'post_import'
      and observation.unimported_count = 0
      and observation.retained_count = observation.imported_count
      and observation.retained_checksum = observation.imported_checksum
  ),
  'post-import 보관 관측은 append-only 행으로 미수입 0과 checksum parity를 남긴다'
);
create temporary table makeup_adapter_import_count as
select count(*)::bigint as value
from dashboard_private.notification_makeup_legacy_imports;
select lives_ok(
  $$select dashboard_private.notification_import_makeup_retained_state_v1()$$,
  '보관 이력 두 번째 import는 안전한 no-op이다'
);
select is(
  (select count(*)::bigint from dashboard_private.notification_makeup_legacy_imports),
  (select value from makeup_adapter_import_count),
  '같은 legacy_delivery_id는 정확히 한 번만 import된다'
);
select is_empty($$
  select legacy_delivery_id
  from dashboard_private.notification_makeup_legacy_imports
  group by legacy_delivery_id
  having count(*) <> 1
$$, '모든 레거시 import 영수증은 delivery ID당 하나다');
select is_empty($$
  select flag_key
  from dashboard_private.notification_runtime_flags
  where flag_key = 'notification_control_plane_dispatch_makeup_requests_enabled'
    and enabled
$$, '휴보강 canonical dispatch 플래그는 import 뒤에도 꺼져 있다');

create or replace function pg_temp.makeup_set_actor(p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (
        select profile.email from public.profiles profile where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.makeup_set_service_actor(p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'service_role',
      'email', (
        select profile.email from public.profiles profile where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
end;
$$;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '92000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'makeup-requester@test.invalid',
    crypt('makeup-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"makeup-producer"}'::jsonb, now(), now()
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'makeup-approver@test.invalid',
    crypt('makeup-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"makeup-producer"}'::jsonb, now(), now()
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'makeup-viewer@test.invalid',
    crypt('makeup-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"makeup-producer"}'::jsonb, now(), now()
  )
on conflict (id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '92000000-0000-4000-8000-000000000001', 'teacher',
    '휴보강 요청자', 'makeup-requester@test.invalid', now(), now()
  ),
  (
    '92000000-0000-4000-8000-000000000002', 'teacher',
    '휴보강 결재자', 'makeup-approver@test.invalid', now(), now()
  ),
  (
    '92000000-0000-4000-8000-000000000003', 'teacher',
    '휴보강 비참여자', 'makeup-viewer@test.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.teacher_catalogs(id, name, subjects, profile_id)
values
  (
    '92000000-0000-4000-8000-000000000901',
    '휴보강 생산자 담당', array['english'],
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '92000000-0000-4000-8000-000000000902',
    '휴보강 생산자 결재', array['english'],
    '92000000-0000-4000-8000-000000000002'
  );

insert into public.makeup_requests(
  id, status, request_kind, subject, approval_group, requester_id,
  teacher_catalog_id, teacher_profile_id,
  approver_teacher_catalog_id, approver_profile_id, class_name, reason, makeup_slots
) values (
  '92000000-0000-4000-8000-000000000101',
  'approval_pending', 'cancel_only', 'english', 'english',
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000901',
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000902',
  '92000000-0000-4000-8000-000000000002',
  '휴보강 생산자 실행 fixture', '보완 요청 원자성 검증', '[]'::jsonb
);

create temporary table makeup_adapter_transition_results(
  result_key text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on makeup_adapter_transition_results to authenticated;

select pg_temp.makeup_set_actor('92000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$
  select public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000101',
    null,
    '{}'::jsonb,
    'approval_pending',
    '92000000-0000-4000-8000-000000000200'
  )
$$, '22023', 'makeup_request_transition_invalid', 'NULL 전이 명령은 승인 취소로 해석하지 않고 거절한다');
reset role;
select is(
  (
    select status from public.makeup_requests
    where id = '92000000-0000-4000-8000-000000000101'
  ),
  'approval_pending',
  'NULL 전이 명령 실패 뒤 업무 상태는 바뀌지 않는다'
);

set local role authenticated;
select lives_ok($$
  insert into makeup_adapter_transition_results(result_key, payload)
  select 'first', public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000101',
    'revision_requested',
    '{"note":"수업 정보 보완이 필요합니다."}'::jsonb,
    'approval_pending',
    '92000000-0000-4000-8000-000000000201'
  )
$$, '보완 요청 전이는 업무·원본·canonical 이벤트를 한 트랜잭션으로 실행한다');
reset role;
select is(
  (
    select status from public.makeup_requests
    where id = '92000000-0000-4000-8000-000000000101'
  ),
  'revision_requested',
  '실행된 전이는 업무 상태를 보완 요청으로 바꾼다'
);
select ok(
  (
    select pg_catalog.count(*) = 1
    from public.makeup_request_events source_event
    join dashboard_private.notification_events canonical
      on canonical.source_type = 'makeup_request_event'
     and canonical.source_id = source_event.id::text
     and canonical.occurrence_key = source_event.id::text
    where source_event.request_id = '92000000-0000-4000-8000-000000000101'
      and source_event.event_type = 'revision_requested'
      and canonical.event_key = 'makeup.revision_requested'
  ),
  '실행된 전이는 원본 하나와 canonical 이벤트 하나를 정확히 연결한다'
);
set local role authenticated;
select lives_ok($$
  insert into makeup_adapter_transition_results(result_key, payload)
  select 'replay', public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000101',
    'revision_requested',
    '{"note":"수업 정보 보완이 필요합니다."}'::jsonb,
    'approval_pending',
    '92000000-0000-4000-8000-000000000201'
  )
$$, '같은 요청 ID 재실행은 첫 전이 영수증을 그대로 반환한다');
reset role;
select ok(
  (
    select first.payload ->> 'sourceEventId' = replay.payload ->> 'sourceEventId'
    from makeup_adapter_transition_results first
    cross join makeup_adapter_transition_results replay
    where first.result_key = 'first' and replay.result_key = 'replay'
  )
  and (
    select pg_catalog.count(*) = 1
    from public.makeup_request_events source_event
    where source_event.request_id = '92000000-0000-4000-8000-000000000101'
      and source_event.event_type = 'revision_requested'
  ),
  '같은 전이 요청 재실행은 원본 이벤트를 중복 생성하지 않는다'
);

insert into public.makeup_requests(
  id, status, request_kind, subject, approval_group,
  requester_id, approver_profile_id, class_name, reason, makeup_slots
)
values
  (
    '92000000-0000-4000-8000-000000000102',
    'makeup_pending', 'cancel_only', 'english', 'english',
    null, null, '삭제된 신청자 fixture', 'NULL 권한 검증', '[]'::jsonb
  ),
  (
    '92000000-0000-4000-8000-000000000103',
    'makeup_pending', 'cancel_only', 'english', 'english',
    null, null, '삭제된 결재자 fixture', 'NULL 권한 검증', '[]'::jsonb
  );

select pg_temp.makeup_set_actor('92000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$
  select public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000102',
    'refund_requested',
    '{"note":"권한 없는 환불"}'::jsonb,
    'makeup_pending',
    '92000000-0000-4000-8000-000000000211'
  )
$$, '42501', 'makeup_request_transition_forbidden', '신청자 FK가 NULL이어도 비참여자 환불 전이는 거절한다');
select throws_ok($$
  select public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000103',
    'approval_canceled',
    '{"note":"권한 없는 승인 취소"}'::jsonb,
    'makeup_pending',
    '92000000-0000-4000-8000-000000000212'
  )
$$, '42501', 'makeup_request_transition_forbidden', '결재자 FK가 NULL이어도 비참여자 승인 취소는 거절한다');
reset role;

update public.makeup_request_events event_row
set actor_id = null
where event_row.request_id = '92000000-0000-4000-8000-000000000101';
update public.makeup_requests request
set requester_id = null,
    approver_profile_id = null
where request.id = '92000000-0000-4000-8000-000000000101';
set local role service_role;
select throws_ok($$
  select public.get_makeup_legacy_dispatch_plan_v1(
    (
      select event_row.id
      from public.makeup_request_events event_row
      where event_row.request_id = '92000000-0000-4000-8000-000000000101'
      order by event_row.created_at desc, event_row.id desc
      limit 1
    ),
    '92000000-0000-4000-8000-000000000003'
  )
$$, '42501', 'makeup_legacy_dispatch_forbidden', '원본 actor와 참여자 FK가 NULL이어도 비참여자 발송 계획은 거절한다');
reset role;

insert into public.classes(id, name, subject, teacher, schedule_plan)
values
  (
    '92000000-0000-4000-8000-000000000301',
    '휴보강 원자 승인 수업',
    'english',
    '휴보강 생산자 담당',
    '{"sessions":[{"day":"월","startTime":"17:00"}]}'::jsonb
  ),
  (
    '92000000-0000-4000-8000-000000000302',
    '휴보강 롤백 수업',
    'english',
    '휴보강 생산자 담당',
    '{"sessions":[{"day":"화","startTime":"18:00"}]}'::jsonb
  );
insert into public.makeup_requests(
  id, status, request_kind, subject, approval_group, requester_id,
  teacher_catalog_id, teacher_profile_id,
  approver_teacher_catalog_id, approver_profile_id,
  class_id, class_name, reason, cancel_date, makeup_slots
)
values
  (
    '92000000-0000-4000-8000-000000000401',
    'approval_pending', 'cancel_only', 'english', 'english',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000901',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000902',
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000301',
    '휴보강 원자 승인 수업', '원자 승인 검증', '2026-07-24', '[]'::jsonb
  ),
  (
    '92000000-0000-4000-8000-000000000402',
    'approval_pending', 'cancel_only', 'english', 'english',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000901',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000902',
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000302',
    '휴보강 롤백 수업', 'canonical 실패 롤백 검증', '2026-07-25', '[]'::jsonb
  );

insert into public.makeup_requests(
  id, status, request_kind, subject, approval_group, requester_id,
  teacher_catalog_id, teacher_profile_id,
  approver_teacher_catalog_id, approver_profile_id,
  class_id, class_name, reason, cancel_date, makeup_slots,
  schedule_plan_before, schedule_plan_after,
  cancel_academic_event_id, makeup_academic_event_id, makeup_academic_event_ids
) values (
  '92000000-0000-4000-8000-000000000403',
  'makeup_pending', 'cancel_makeup', 'english', 'english',
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000901',
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000902',
  '92000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000301',
  '휴보강 환불 재승인 수업', '환불 스냅샷 보존', '2026-07-26', '[]'::jsonb,
  '{"sessions":[{"day":"수","startTime":"19:00"}]}'::jsonb,
  '{"sessions":[]}'::jsonb,
  '92000000-0000-4000-8000-000000000503',
  '92000000-0000-4000-8000-000000000504',
  '["92000000-0000-4000-8000-000000000504","92000000-0000-4000-8000-000000000505"]'::jsonb
);

select pg_temp.makeup_set_actor('92000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$
  select public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000401',
    'approve',
    '{"actor_profile_id":"92000000-0000-4000-8000-000000000002","final_note":"브라우저 우회"}'::jsonb,
    'approval_pending',
    '92000000-0000-4000-8000-000000000600'
  )
$$, '42501', 'makeup_approval_server_required', '브라우저의 공개 RPC approve 직접 호출은 거절한다');
reset role;

select pg_temp.makeup_set_service_actor('92000000-0000-4000-8000-000000000002');
set local role service_role;
select lives_ok($$
  select public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000401',
    'approve',
    '{
      "actor_profile_id":"92000000-0000-4000-8000-000000000002",
      "final_note":"승인 완료",
      "schedule_plan_before":{"sessions":[{"day":"월","startTime":"17:00"}]},
      "schedule_plan_after":{"sessions":[]},
      "cancel_academic_event_id":"92000000-0000-4000-8000-000000000501",
      "makeup_academic_event_id":"",
      "makeup_academic_event_ids":[],
      "calendar_events":[{
        "id":"92000000-0000-4000-8000-000000000501",
        "title":"[휴강] 휴보강 원자 승인 수업",
        "date":"2026-07-24",
        "type":"팁스",
        "grade":"all",
        "note":"원자 승인 검증\n[[TIPS_MAKEUP]] {\"kind\":\"cancel\",\"requestId\":\"92000000-0000-4000-8000-000000000401\"}"
      }]
    }'::jsonb,
    'approval_pending',
    '92000000-0000-4000-8000-000000000601'
  )
$$, '승인은 수업 일정·학사 캘린더·업무·알림 원본을 한 RPC로 확정한다');
reset role;
select pg_temp.makeup_set_actor('92000000-0000-4000-8000-000000000002');
select ok(
  (
    select request.status = 'makeup_pending'
      and request.schedule_plan_before = '{"sessions":[{"day":"월","startTime":"17:00"}]}'::jsonb
      and request.schedule_plan_after = '{"sessions":[]}'::jsonb
    from public.makeup_requests request
    where request.id = '92000000-0000-4000-8000-000000000401'
  )
  and (
    select class_row.schedule_plan = '{"sessions":[]}'::jsonb
    from public.classes class_row
    where class_row.id = '92000000-0000-4000-8000-000000000301'
  )
  and exists (
    select 1 from public.academic_events event_row
    where event_row.id = '92000000-0000-4000-8000-000000000501'
      and event_row.date = '2026-07-24'
  )
  and exists (
    select 1
    from public.makeup_request_events source_event
    join dashboard_private.notification_events canonical
      on canonical.source_id = source_event.id::text
     and canonical.source_type = 'makeup_request_event'
    where source_event.request_id = '92000000-0000-4000-8000-000000000401'
      and source_event.event_type = 'approved'
      and canonical.event_key = 'makeup.approved'
  ),
  '승인 성공 뒤 수업·캘린더·업무·canonical 상태가 모두 함께 보인다'
);

select pg_temp.makeup_set_actor('92000000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$
  select public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000403',
    'refund_requested',
    '{"note":"환불 재승인 요청"}'::jsonb,
    'makeup_pending',
    '92000000-0000-4000-8000-000000000604'
  )
$$, '환불 요청은 기존 승인 일정·캘린더 스냅샷을 유지한 채 재승인 대기로 전환한다');
reset role;

select pg_temp.makeup_set_service_actor('92000000-0000-4000-8000-000000000002');
set local role service_role;
select lives_ok($$
  select public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000403',
    'approve',
    '{
      "actor_profile_id":"92000000-0000-4000-8000-000000000002",
      "final_note":"환불 재승인 완료"
    }'::jsonb,
    'approval_pending',
    '92000000-0000-4000-8000-000000000605'
  )
$$, '환불 재승인은 새 일정 효과 없이 기존 승인 스냅샷을 그대로 사용한다');
reset role;
select pg_temp.makeup_set_actor('92000000-0000-4000-8000-000000000002');
select ok(
  (
    select request.status = 'refund_pending'
      and request.schedule_plan_before = '{"sessions":[{"day":"수","startTime":"19:00"}]}'::jsonb
      and request.schedule_plan_after = '{"sessions":[]}'::jsonb
      and request.cancel_academic_event_id = '92000000-0000-4000-8000-000000000503'
      and request.makeup_academic_event_id = '92000000-0000-4000-8000-000000000504'
      and request.makeup_academic_event_ids = '["92000000-0000-4000-8000-000000000504","92000000-0000-4000-8000-000000000505"]'::jsonb
    from public.makeup_requests request
    where request.id = '92000000-0000-4000-8000-000000000403'
  )
  and exists (
    select 1
    from public.makeup_request_events source_event
    join dashboard_private.notification_events canonical
      on canonical.source_type = 'makeup_request_event'
     and canonical.source_id = source_event.id::text
    where source_event.request_id = '92000000-0000-4000-8000-000000000403'
      and source_event.event_type = 'approved'
      and canonical.event_key = 'makeup.approved'
  ),
  '환불 재승인 뒤 상태·일정·캘린더 ID 스냅샷과 canonical 이벤트가 모두 보존된다'
);

create or replace function pg_temp.reject_makeup_canonical_fixture()
returns trigger
language plpgsql
as $$
begin
  if new.payload ->> 'makeup_request_id' = '92000000-0000-4000-8000-000000000402' then
    raise exception 'forced_makeup_canonical_failure';
  end if;
  return new;
end;
$$;
create trigger reject_makeup_canonical_fixture
before insert on dashboard_private.notification_events
for each row execute function pg_temp.reject_makeup_canonical_fixture();

select pg_temp.makeup_set_service_actor('92000000-0000-4000-8000-000000000002');
set local role service_role;
select throws_ok($$
  select public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000402',
    'approve',
    '{
      "actor_profile_id":"92000000-0000-4000-8000-000000000002",
      "final_note":"롤백되어야 함",
      "schedule_plan_before":{"sessions":[{"day":"화","startTime":"18:00"}]},
      "schedule_plan_after":{"sessions":[]},
      "cancel_academic_event_id":"92000000-0000-4000-8000-000000000502",
      "makeup_academic_event_id":"",
      "makeup_academic_event_ids":[],
      "calendar_events":[{
        "id":"92000000-0000-4000-8000-000000000502",
        "title":"[휴강] 휴보강 롤백 수업",
        "date":"2026-07-25",
        "type":"팁스",
        "grade":"all",
        "note":"롤백 검증\n[[TIPS_MAKEUP]] {\"kind\":\"cancel\",\"requestId\":\"92000000-0000-4000-8000-000000000402\"}"
      }]
    }'::jsonb,
    'approval_pending',
    '92000000-0000-4000-8000-000000000602'
  )
$$, 'P0001', 'forced_makeup_canonical_failure', 'canonical 기록 실패는 승인 전체를 실패시킨다');
reset role;
select pg_temp.makeup_set_actor('92000000-0000-4000-8000-000000000002');
select ok(
  (
    select request.status = 'approval_pending'
    from public.makeup_requests request
    where request.id = '92000000-0000-4000-8000-000000000402'
  )
  and (
    select class_row.schedule_plan = '{"sessions":[{"day":"화","startTime":"18:00"}]}'::jsonb
    from public.classes class_row
    where class_row.id = '92000000-0000-4000-8000-000000000302'
  )
  and not exists (
    select 1 from public.academic_events event_row
    where event_row.id = '92000000-0000-4000-8000-000000000502'
  )
  and not exists (
    select 1 from public.makeup_request_events source_event
    where source_event.request_id = '92000000-0000-4000-8000-000000000402'
  ),
  'canonical 실패 시 수업·캘린더·업무·원본 변경이 모두 롤백된다'
);

set local role authenticated;
select lives_ok($$
  select public.transition_makeup_request_v2(
    '92000000-0000-4000-8000-000000000401',
    'approval_canceled',
    '{"note":"승인 취소"}'::jsonb,
    'makeup_pending',
    '92000000-0000-4000-8000-000000000603'
  )
$$, '승인 취소는 일정 복구·캘린더 삭제·업무·canonical 이벤트를 한 RPC로 확정한다');
reset role;
select ok(
  (
    select request.status = 'canceled'
    from public.makeup_requests request
    where request.id = '92000000-0000-4000-8000-000000000401'
  )
  and (
    select class_row.schedule_plan = '{"sessions":[{"day":"월","startTime":"17:00"}]}'::jsonb
    from public.classes class_row
    where class_row.id = '92000000-0000-4000-8000-000000000301'
  )
  and not exists (
    select 1 from public.academic_events event_row
    where event_row.id = '92000000-0000-4000-8000-000000000501'
  )
  and exists (
    select 1
    from public.makeup_request_events source_event
    join dashboard_private.notification_events canonical
      on canonical.source_id = source_event.id::text
     and canonical.source_type = 'makeup_request_event'
    where source_event.request_id = '92000000-0000-4000-8000-000000000401'
      and source_event.event_type = 'approval_canceled'
      and canonical.event_key = 'makeup.approval_canceled'
  ),
  '승인 취소 성공 뒤 일정·캘린더·업무·canonical 상태가 모두 함께 복구된다'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_makeup_request_v2(jsonb,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.transition_makeup_request_v2(uuid,text,jsonb,text,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.delete_makeup_request_v2(uuid,uuid)',
    'EXECUTE'
  ),
  '업무 RPC만 인증 사용자에게 열리고 내부 import 함수는 비공개다'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.makeup_requests', 'INSERT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.makeup_requests', 'UPDATE')
  and not pg_catalog.has_table_privilege('authenticated', 'public.makeup_requests', 'DELETE'),
  '인증 사용자는 휴보강 원본을 직접 쓰지 못하고 고정 목적 RPC만 사용한다'
);

select * from finish();

rollback;
