begin;
select no_plan();

select has_column(
  'public', 'approval_events', 'request_id',
  '전자결재 이벤트는 request_id를 보관한다'
);
select has_column(
  'public', 'approval_events', 'payload',
  '전자결재 이벤트는 권위 payload를 보관한다'
);
select has_column(
  'public', 'approval_comments', 'request_id',
  '전자결재 댓글은 request_id를 보관한다'
);
select has_column(
  'public', 'approval_comments', 'payload',
  '전자결재 댓글은 권위 payload를 보관한다'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.create_approval_request_v2(jsonb,text,uuid)'
  ) is not null,
  '전자결재 생성 RPC가 존재한다'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.update_approval_request_v2(uuid,jsonb,text,timestamptz,uuid)'
  ) is not null,
  '전자결재 수정 RPC가 존재한다'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.transition_approval_request_v2(uuid,text,timestamptz,uuid)'
  ) is not null,
  '전자결재 상태 RPC가 존재한다'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.add_approval_comment_v2(uuid,text,uuid)'
  ) is not null,
  '전자결재 댓글 RPC가 존재한다'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.delete_approval_request_v2(uuid,uuid)'
  ) is not null,
  '전자결재 삭제 RPC가 존재한다'
);

select ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.approval_requests', 'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.approval_requests', 'UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.approval_requests', 'DELETE'
  ),
  'Task 20 closure 뒤 전자결재 요청 직접 writer는 닫힌다'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.approval_events', 'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.approval_comments', 'INSERT'
  ),
  'Task 20 closure 뒤 전자결재 원본·댓글 직접 writer도 닫힌다'
);

create or replace function pg_temp.approval_set_actor(p_actor uuid)
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
        select profile.email
        from public.profiles profile
        where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.approval_throws(
  p_sql text,
  p_message_pattern text
)
returns boolean
language plpgsql
volatile
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm ~ p_message_pattern;
end;
$$;

grant execute on function pg_temp.approval_throws(text, text) to authenticated;

insert into auth.users(
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '98000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'approval-requester@test.invalid',
    crypt('approval-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"approval-producer"}'::jsonb, now(), now()
  ),
  (
    '98000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'approval-first@test.invalid',
    crypt('approval-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"approval-producer"}'::jsonb, now(), now()
  ),
  (
    '98000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'approval-second@test.invalid',
    crypt('approval-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"approval-producer"}'::jsonb, now(), now()
  ),
  (
    '98000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'approval-admin@test.invalid',
    crypt('approval-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"approval-producer"}'::jsonb, now(), now()
  ),
  (
    '98000000-0000-4000-8000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'approval-staff@test.invalid',
    crypt('approval-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"approval-producer"}'::jsonb, now(), now()
  )
on conflict (id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '98000000-0000-4000-8000-000000000001', 'teacher',
    '전자결재 요청자', 'approval-requester@test.invalid', now(), now()
  ),
  (
    '98000000-0000-4000-8000-000000000002', 'teacher',
    '첫 결재자', 'approval-first@test.invalid', now(), now()
  ),
  (
    '98000000-0000-4000-8000-000000000003', 'teacher',
    '새 결재자', 'approval-second@test.invalid', now(), now()
  ),
  (
    '98000000-0000-4000-8000-000000000004', 'admin',
    '전자결재 관리자', 'approval-admin@test.invalid', now(), now()
  ),
  (
    '98000000-0000-4000-8000-000000000005', 'staff',
    '전자결재 스태프', 'approval-staff@test.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

create temporary table approval_runtime_results(
  result_key text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update on approval_runtime_results to authenticated;

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.approval_throws(
    $sql$
      insert into public.approval_requests(
        request_type, status, title, requester_id, approver_id,
        subject, template_key, report_month, body, checklist_items
      ) values (
        'monthly_report', 'draft', '닫혀야 하는 직접 요청',
        '98000000-0000-4000-8000-000000000001',
        '98000000-0000-4000-8000-000000000002',
        'english', 'english_monthly', '2026-07', '직접 본문', '[]'::jsonb
      )
    $sql$,
    'permission denied'
  ),
  'authenticated 사용자는 전자결재 요청을 직접 만들 수 없다'
);
select ok(
  pg_temp.approval_throws(
    $sql$
      update public.approval_requests
      set title = '닫혀야 하는 직접 수정'
      where false
    $sql$,
    'permission denied'
  ),
  'authenticated 사용자는 전자결재 요청을 직접 수정할 수 없다'
);
select ok(
  pg_temp.approval_throws(
    $sql$
      insert into public.approval_comments(approval_id, author_id, body)
      values (
        '98000000-0000-4000-8000-000000000099',
        '98000000-0000-4000-8000-000000000001',
        '닫혀야 하는 직접 댓글'
      )
    $sql$,
    'permission denied'
  ),
  'authenticated 사용자는 전자결재 댓글을 직접 만들 수 없다'
);

insert into approval_runtime_results(result_key, payload)
select 'created', public.create_approval_request_v2(
  '{
    "request_type":"monthly_report",
    "title":"7월 영어 월간 보고",
    "approver_id":"98000000-0000-4000-8000-000000000002",
    "subject":"english",
    "template_key":"english_monthly",
    "report_month":"2026-07",
    "body":"월간 보고 본문",
    "checklist_items":[]
  }'::jsonb,
  'draft',
  '98000000-0000-4000-8000-000000000101'
);

insert into approval_runtime_results(result_key, payload)
select 'created_replay', public.create_approval_request_v2(
  '{
    "request_type":"monthly_report",
    "title":"7월 영어 월간 보고",
    "approver_id":"98000000-0000-4000-8000-000000000002",
    "subject":"english",
    "template_key":"english_monthly",
    "report_month":"2026-07",
    "body":"월간 보고 본문",
    "checklist_items":[]
  }'::jsonb,
  'draft',
  '98000000-0000-4000-8000-000000000101'
);
reset role;

select is(
  (select payload ->> 'source_event_id'
   from approval_runtime_results where result_key = 'created_replay'),
  (select payload ->> 'source_event_id'
   from approval_runtime_results where result_key = 'created'),
  '같은 생성 요청은 원본 source UUID를 재사용한다'
);
select is(
  (
    select pg_catalog.count(*)
    from public.approval_events event_row
    where event_row.request_id =
      '98000000-0000-4000-8000-000000000101'
  ),
  1::bigint,
  '같은 생성 요청은 raw source를 한 번만 만든다'
);
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_events event_row
    where event_row.source_id = (
      select payload ->> 'source_event_id'
      from approval_runtime_results where result_key = 'created'
    )
  ),
  1::bigint,
  '같은 생성 요청은 canonical occurrence를 한 번만 만든다'
);
select is(
  (
    select event_row.event_key
    from dashboard_private.notification_events event_row
    where event_row.source_id = (
      select payload ->> 'source_event_id'
      from approval_runtime_results where result_key = 'created'
    )
  ),
  'approval.created'::text,
  '요청 insert는 approval.created로 기록된다'
);
select ok(
  (
    select event_row.source_revision is null
      and event_row.occurrence_key = event_row.source_id
    from dashboard_private.notification_events event_row
    where event_row.source_id = (
      select payload ->> 'source_event_id'
      from approval_runtime_results where result_key = 'created'
    )
  ),
  '전자결재 UUID source는 revision 없이 source UUID를 occurrence로 쓴다'
);
select ok(
  (
    select event_row.payload ->> 'requester_profile_id' =
        '98000000-0000-4000-8000-000000000001'
      and event_row.payload ->> 'approver_profile_id' =
        '98000000-0000-4000-8000-000000000002'
      and event_row.payload -> 'management_profile_ids'
        @> '["98000000-0000-4000-8000-000000000004"]'::jsonb
      and event_row.payload -> 'management_profile_ids'
        @> '["98000000-0000-4000-8000-000000000005"]'::jsonb
    from dashboard_private.notification_events event_row
    where event_row.source_id = (
      select payload ->> 'source_event_id'
      from approval_runtime_results where result_key = 'created'
    )
  ),
  '수신자는 권위 요청자·현재 결재자·활성 관리 프로필에서만 계산된다'
);

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'submitted', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'created'),
  'submitted',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'created'),
  '98000000-0000-4000-8000-000000000102'
);
reset role;

select is(
  (
    select event_row.event_key
    from dashboard_private.notification_events event_row
    join public.approval_events source
      on source.id::text = event_row.source_id
    where source.request_id =
      '98000000-0000-4000-8000-000000000102'
  ),
  'approval.submitted'::text,
  'draft에서 첫 상신은 approval.submitted다'
);

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000002'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'reviewing_1', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'submitted'),
  'reviewing',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'submitted'),
  '98000000-0000-4000-8000-000000000103'
);

insert into approval_runtime_results(result_key, payload)
select 'returned', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'reviewing_1'),
  'returned',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'reviewing_1'),
  '98000000-0000-4000-8000-000000000104'
);
reset role;

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'resubmitted', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'returned'),
  'submitted',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'returned'),
  '98000000-0000-4000-8000-000000000105'
);
reset role;

select is(
  (
    select event_row.event_key
    from dashboard_private.notification_events event_row
    join public.approval_events source
      on source.id::text = event_row.source_id
    where source.request_id =
      '98000000-0000-4000-8000-000000000105'
  ),
  'approval.resubmitted'::text,
  'returned 뒤 상신은 새 approval.resubmitted occurrence다'
);

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000002'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'reviewing_2', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'resubmitted'),
  'reviewing',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'resubmitted'),
  '98000000-0000-4000-8000-000000000106'
);
reset role;

insert into dashboard_private.notification_deliveries(
  id, event_id, rule_id, rule_revision, template_id,
  channel_key, audience_key, target_generation, target_set_hash,
  target_kind, target_key, target_profile_id, connection_key,
  target_snapshot, status, status_reason, dedupe_key,
  rendered_title, rendered_body, href, scheduled_for,
  attempt_count, max_attempts, next_attempt_at, sent_at
)
select
  fixture.delivery_id,
  event_row.id,
  rule.id,
  rule.revision,
  rule.active_template_id,
  'in_app',
  'approver_profile',
  0,
  repeat('a', 64),
  'profile',
  'profile:98000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000002',
  null,
  '{"profile_id":"98000000-0000-4000-8000-000000000002"}'::jsonb,
  fixture.status,
  fixture.status_reason,
  fixture.dedupe_key,
  '전자결재 테스트',
  '전자결재 테스트',
  '/admin/approvals',
  now(),
  fixture.attempt_count,
  3,
  fixture.next_attempt_at,
  fixture.sent_at
from dashboard_private.notification_rules rule
join dashboard_private.notification_events event_row
  on event_row.source_id = (
    select payload ->> 'source_event_id'
    from approval_runtime_results where result_key = 'submitted'
  )
cross join (
  values
    (
      '98000000-0000-4000-8000-000000000201'::uuid,
      'pending'::text, null::text, 'approval-pending'::text,
      0, null::timestamptz, null::timestamptz
    ),
    (
      '98000000-0000-4000-8000-000000000202'::uuid,
      'sent'::text, null::text, 'approval-sent'::text,
      1, null::timestamptz, now()
    ),
    (
      '98000000-0000-4000-8000-000000000203'::uuid,
      'delivery_unknown'::text, 'provider_timeout_after_dispatch'::text,
      'approval-unknown'::text, 1, null::timestamptz, null::timestamptz
    )
) fixture(
  delivery_id, status, status_reason, dedupe_key,
  attempt_count, next_attempt_at, sent_at
)
where rule.workflow_key = 'approvals'
  and rule.event_key = 'approval.submitted'
  and rule.audience_key = 'approver_profile'
  and rule.channel_key = 'in_app';

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'approver_changed', public.update_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'reviewing_2'),
  '{
    "request_type":"monthly_report",
    "title":"7월 영어 월간 보고",
    "approver_id":"98000000-0000-4000-8000-000000000003",
    "subject":"english",
    "template_key":"english_monthly",
    "report_month":"2026-07",
    "body":"월간 보고 본문",
    "checklist_items":[]
  }'::jsonb,
  'reviewing',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'reviewing_2'),
  '98000000-0000-4000-8000-000000000107'
);
reset role;

select is(
  (
    select event_row.event_key
    from dashboard_private.notification_events event_row
    join public.approval_events source
      on source.id::text = event_row.source_id
    where source.request_id =
      '98000000-0000-4000-8000-000000000107'
  ),
  'approval.approver_changed'::text,
  '결재자 교체는 하나의 explicit occurrence를 만든다'
);
select is(
  (select status from dashboard_private.notification_deliveries
   where id = '98000000-0000-4000-8000-000000000201'),
  'canceled'::text,
  '이전 결재자의 pending delivery를 취소한다'
);
select is(
  (select status_reason from dashboard_private.notification_deliveries
   where id = '98000000-0000-4000-8000-000000000201'),
  'recipient_revoked'::text,
  '이전 결재자 취소 사유는 recipient_revoked다'
);
select is(
  (select status from dashboard_private.notification_deliveries
   where id = '98000000-0000-4000-8000-000000000202'),
  'sent'::text,
  '이미 발송된 이전 결재자 이력은 보존한다'
);
select is(
  (select status from dashboard_private.notification_deliveries
   where id = '98000000-0000-4000-8000-000000000203'),
  'delivery_unknown'::text,
  '발송 불명인 이전 결재자 이력은 보존한다'
);

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000003'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'approved', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'approver_changed'),
  'approved',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'approver_changed'),
  '98000000-0000-4000-8000-000000000108'
);
reset role;

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'commented', public.add_approval_comment_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'approved'),
  '확인했습니다.',
  '98000000-0000-4000-8000-000000000109'
);
reset role;

select ok(
  (
    select event_row.source_type = 'approval_comment'
      and event_row.source_id = event_row.occurrence_key
      and event_row.source_revision is null
    from dashboard_private.notification_events event_row
    where event_row.source_id = (
      select payload ->> 'source_event_id'
      from approval_runtime_results where result_key = 'commented'
    )
  ),
  '댓글 UUID가 comment_added source와 occurrence다'
);

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000004'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'deleted', public.delete_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'approved'),
  '98000000-0000-4000-8000-000000000110'
);
reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.approval_requests request_row
    where request_row.id = (
      select (payload ->> 'approval_id')::uuid
      from approval_runtime_results where result_key = 'deleted'
    )
  ),
  0::bigint,
  '닫힌 전자결재 원문은 삭제된다'
);
select is(
  (
    select event_row.event_key
    from dashboard_private.notification_events event_row
    where event_row.source_id = (
      select payload ->> 'source_event_id'
      from approval_runtime_results where result_key = 'deleted'
    )
  ),
  'approval.deleted'::text,
  '삭제 전 canonical audit은 남는다'
);
select is(
  (
    select pg_catalog.count(*)
    from public.approval_events source
    where source.approval_id = (
      select (payload ->> 'approval_id')::uuid
      from approval_runtime_results where result_key = 'deleted'
    )
  ) > 0,
  true,
  '삭제 뒤 raw approval event 감사도 보존한다'
);
select is(
  (
    select pg_catalog.count(*)
    from public.approval_comments source
    where source.approval_id = (
      select (payload ->> 'approval_id')::uuid
      from approval_runtime_results where result_key = 'deleted'
    )
  ),
  1::bigint,
  '삭제 뒤 raw approval comment source도 보존한다'
);

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000004'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'deleted_replay', public.delete_approval_request_v2(
  (select (payload ->> 'approval_id')::uuid
   from approval_runtime_results where result_key = 'deleted'),
  '98000000-0000-4000-8000-000000000110'
);
reset role;

select ok(
  (
    select original.payload = replay.payload
      and original.payload ->> 'deleted' = 'true'
      and original.payload ? 'approval_id'
      and original.payload ? 'source_event_id'
      and not original.payload ? 'request'
      and not original.payload ? 'body'
      and not original.payload ? 'memo'
      and not original.payload ? 'checklist_items'
      and not original.payload ? 'attachments'
    from approval_runtime_results original
    cross join approval_runtime_results replay
    where original.result_key = 'deleted'
      and replay.result_key = 'deleted_replay'
  ),
  '삭제 replay 영수증에는 원문이 남지 않는다'
);

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'cancel_created', public.create_approval_request_v2(
  '{
    "request_type":"general",
    "title":"취소 경계 확인",
    "approver_id":"98000000-0000-4000-8000-000000000002",
    "subject":"general",
    "template_key":"free",
    "body":"취소 경계 확인",
    "checklist_items":[]
  }'::jsonb,
  'draft',
  '98000000-0000-4000-8000-000000000113'
);
insert into approval_runtime_results(result_key, payload)
select 'cancel_submitted', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'cancel_created'),
  'submitted',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'cancel_created'),
  '98000000-0000-4000-8000-000000000114'
);
reset role;

insert into dashboard_private.notification_deliveries(
  id, event_id, rule_id, rule_revision, template_id,
  channel_key, audience_key, target_generation, target_set_hash,
  target_kind, target_key, target_profile_id, connection_key,
  target_snapshot, status, status_reason, dedupe_key,
  rendered_title, rendered_body, href, scheduled_for,
  attempt_count, max_attempts, next_attempt_at, sent_at
)
select
  fixture.delivery_id,
  event_row.id,
  rule.id,
  rule.revision,
  rule.active_template_id,
  'in_app', 'approver_profile', 0, repeat('b', 64),
  'profile',
  'profile:98000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000002',
  null,
  '{"profile_id":"98000000-0000-4000-8000-000000000002"}'::jsonb,
  fixture.status,
  fixture.status_reason,
  fixture.dedupe_key,
  '전자결재 취소 테스트', '전자결재 취소 테스트',
  '/admin/approvals', now(), fixture.attempt_count, 3, null,
  fixture.sent_at
from dashboard_private.notification_rules rule
join dashboard_private.notification_events event_row
  on event_row.source_id = (
    select payload ->> 'source_event_id'
    from approval_runtime_results where result_key = 'cancel_submitted'
  )
cross join (
  values
    (
      '98000000-0000-4000-8000-000000000211'::uuid,
      'pending'::text, null::text, 'approval-cancel-pending'::text,
      0, null::timestamptz
    ),
    (
      '98000000-0000-4000-8000-000000000212'::uuid,
      'sent'::text, null::text, 'approval-cancel-sent'::text,
      1, now()
    ),
    (
      '98000000-0000-4000-8000-000000000213'::uuid,
      'delivery_unknown'::text, 'provider_timeout_after_dispatch'::text,
      'approval-cancel-unknown'::text, 1, null::timestamptz
    )
) fixture(
  delivery_id, status, status_reason, dedupe_key, attempt_count, sent_at
)
where rule.workflow_key = 'approvals'
  and rule.event_key = 'approval.submitted'
  and rule.audience_key = 'approver_profile'
  and rule.channel_key = 'in_app';

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'canceled', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'cancel_submitted'),
  'canceled',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'cancel_submitted'),
  '98000000-0000-4000-8000-000000000115'
);
reset role;

select is(
  (
    select event_row.event_key
    from dashboard_private.notification_events event_row
    join public.approval_events source
      on source.id::text = event_row.source_id
    where source.request_id =
      '98000000-0000-4000-8000-000000000115'
  ),
  'approval.canceled'::text,
  '전자결재 철회는 별도 withdrawn 상태 없이 approval.canceled다'
);
select is(
  (select status from dashboard_private.notification_deliveries
   where id = '98000000-0000-4000-8000-000000000211'),
  'canceled'::text,
  '철회 시 결재자 pending delivery만 취소한다'
);
select is(
  (select status_reason from dashboard_private.notification_deliveries
   where id = '98000000-0000-4000-8000-000000000211'),
  'source_status_changed'::text,
  '철회 취소 사유는 source_status_changed다'
);
select is(
  (select status from dashboard_private.notification_deliveries
   where id = '98000000-0000-4000-8000-000000000212'),
  'sent'::text,
  '철회 후에도 sent 이력을 보존한다'
);
select is(
  (select status from dashboard_private.notification_deliveries
   where id = '98000000-0000-4000-8000-000000000213'),
  'delivery_unknown'::text,
  '철회 후에도 delivery_unknown 이력을 보존한다'
);

select ok(
  not exists (
    select 1
    from dashboard_private.notification_rules rule
    where rule.workflow_key = 'approvals'
      and rule.enabled
  ),
  '전자결재 규칙은 전부 비활성이다'
);

-- A direct mutation cannot bypass the trigger-owned source boundary; the row
-- change is rolled back with the trigger failure.
select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into approval_runtime_results(result_key, payload)
select 'rollback_fixture', public.create_approval_request_v2(
  '{
    "request_type":"general",
    "title":"롤백 확인",
    "approver_id":"98000000-0000-4000-8000-000000000002",
    "subject":"general",
    "template_key":"free",
    "body":"롤백 확인",
    "checklist_items":[]
  }'::jsonb,
  'draft',
  '98000000-0000-4000-8000-000000000111'
);
reset role;

select pg_catalog.set_config('app.approval_request_id', '', true);
select ok(
  pg_temp.approval_throws(
    pg_catalog.format(
      'update public.approval_requests set title = %L where id = %L::uuid',
      '우회 수정',
      (
        select payload -> 'request' ->> 'id'
        from approval_runtime_results where result_key = 'rollback_fixture'
      )
    ),
    'approval_mutation_context_missing'
  ),
  'source context가 없으면 업무 변이 전체가 롤백된다'
);
select is(
  (
    select request_row.title
    from public.approval_requests request_row
    where request_row.id = (
      select (payload -> 'request' ->> 'id')::uuid
      from approval_runtime_results where result_key = 'rollback_fixture'
    )
  ),
  '롤백 확인'::text,
  'trigger 실패 뒤 원문은 바뀌지 않는다'
);

select pg_catalog.set_config(
  'app.approval_request_id',
  '98000000-0000-4000-8000-000000000111',
  true
);
select ok(
  pg_temp.approval_throws(
    pg_catalog.format(
      'update public.approval_requests set approver_id = %L::uuid where id = %L::uuid',
      '98000000-0000-4000-8000-000000000003',
      (
        select payload -> 'request' ->> 'id'
        from approval_runtime_results where result_key = 'rollback_fixture'
      )
    ),
    'duplicate key|approval_events_request_id_uidx'
  ),
  '원본 source 기록 실패도 업무 변이와 함께 롤백된다'
);
select is(
  (
    select request_row.approver_id
    from public.approval_requests request_row
    where request_row.id = (
      select (payload -> 'request' ->> 'id')::uuid
      from approval_runtime_results where result_key = 'rollback_fixture'
    )
  ),
  '98000000-0000-4000-8000-000000000002'::uuid,
  'source 기록 실패 뒤 결재자도 바뀌지 않는다'
);
select pg_catalog.set_config('app.approval_request_id', '', true);

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.approval_throws(
    $sql$
      select public.create_approval_request_v2(
        '{
          "request_type":"general",
          "title":"브라우저 수신자 위조",
          "approver_id":"98000000-0000-4000-8000-000000000002",
          "subject":"general",
          "template_key":"free",
          "body":"위조",
          "checklist_items":[],
          "management_profile_ids":["98000000-0000-4000-8000-000000000001"]
        }'::jsonb,
        'draft',
        '98000000-0000-4000-8000-000000000112'
      )
    $sql$,
    'approval_input_invalid'
  ),
  '브라우저가 수신자 목록을 주입할 수 없다'
);
select ok(
  pg_temp.approval_throws(
    $sql$
      select public.create_approval_request_v2(
        '{
          "request_type":"general",
          "title":"다른 payload",
          "approver_id":"98000000-0000-4000-8000-000000000002",
          "subject":"general",
          "template_key":"free",
          "body":"다른 payload",
          "checklist_items":[]
        }'::jsonb,
        'draft',
        '98000000-0000-4000-8000-000000000111'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  '같은 request_id의 다른 payload는 거부한다'
);
reset role;

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.approval_throws(
    $sql$
      select public.create_approval_request_v2(
        '{
          "request_type":"general",
          "title":"직접 상신 우회",
          "approver_id":"98000000-0000-4000-8000-000000000002",
          "subject":"general",
          "template_key":"free",
          "body":"직접 상신 우회",
          "checklist_items":[]
        }'::jsonb,
        'submitted',
        '98000000-0000-4000-8000-000000000120'
      )
    $sql$,
    'approval_request_invalid'
  ),
  '직접 submitted 생성은 거부된다'
);
select ok(
  pg_temp.approval_throws(
    $sql$
      select public.create_approval_request_v2(
        '{
          "request_type":"general",
          "title":"NULL 상태 생성",
          "approver_id":"98000000-0000-4000-8000-000000000002",
          "subject":"general",
          "template_key":"free",
          "body":"NULL 상태 생성",
          "checklist_items":[]
        }'::jsonb,
        null::text,
        '98000000-0000-4000-8000-000000000121'
      )
    $sql$,
    'approval_request_invalid'
  ),
  'NULL 상태 생성은 고정 오류로 거부된다'
);
insert into approval_runtime_results(result_key, payload)
select 'guard_created', public.create_approval_request_v2(
  '{
    "request_type":"general",
    "title":"불변성 경계 확인",
    "approver_id":"98000000-0000-4000-8000-000000000002",
    "subject":"general",
    "template_key":"free",
    "body":"원본 본문",
    "checklist_items":[]
  }'::jsonb,
  'draft',
  '98000000-0000-4000-8000-000000000122'
);
insert into approval_runtime_results(result_key, payload)
select 'guard_submitted', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'guard_created'),
  'submitted',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'guard_created'),
  '98000000-0000-4000-8000-000000000123'
);
select ok(
  pg_temp.approval_throws(
    $sql$
      select public.update_approval_request_v2(
        (select (payload -> 'request' ->> 'id')::uuid
         from approval_runtime_results where result_key = 'guard_submitted'),
        '{
          "request_type":"general",
          "title":"불변성 경계 확인",
          "approver_id":null,
          "subject":"general",
          "template_key":"free",
          "body":"원본 본문",
          "checklist_items":[]
        }'::jsonb,
        'submitted',
        (select (payload -> 'request' ->> 'updated_at')::timestamptz
         from approval_runtime_results where result_key = 'guard_submitted'),
        '98000000-0000-4000-8000-000000000124'
      )
    $sql$,
    'approval_approver_required'
  ),
  '진행 중 문서의 결재자를 제거할 수 없다'
);
select ok(
  pg_temp.approval_throws(
    $sql$
      select public.transition_approval_request_v2(
        (select (payload -> 'request' ->> 'id')::uuid
         from approval_runtime_results where result_key = 'guard_submitted'),
        null::text,
        (select (payload -> 'request' ->> 'updated_at')::timestamptz
         from approval_runtime_results where result_key = 'guard_submitted'),
        '98000000-0000-4000-8000-000000000125'
      )
    $sql$,
    'approval_request_invalid'
  ),
  'NULL 상태 전이는 고정 오류로 거부된다'
);
reset role;

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000002'
);
set local role authenticated;
select ok(
  pg_temp.approval_throws(
    $sql$
      select public.update_approval_request_v2(
        (select (payload -> 'request' ->> 'id')::uuid
         from approval_runtime_results where result_key = 'guard_submitted'),
        '{
          "request_type":"general",
          "title":"결재자가 바꾼 제목",
          "approver_id":"98000000-0000-4000-8000-000000000002",
          "subject":"general",
          "template_key":"free",
          "body":"결재자가 바꾼 본문",
          "checklist_items":[]
        }'::jsonb,
        'submitted',
        (select (payload -> 'request' ->> 'updated_at')::timestamptz
         from approval_runtime_results where result_key = 'guard_submitted'),
        '98000000-0000-4000-8000-000000000126'
      )
    $sql$,
    'approval_access_denied'
  ),
  '결재자는 문서 본문을 수정할 수 없다'
);
insert into approval_runtime_results(result_key, payload)
select 'guard_reviewing', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'guard_submitted'),
  'reviewing',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'guard_submitted'),
  '98000000-0000-4000-8000-000000000127'
);
insert into approval_runtime_results(result_key, payload)
select 'guard_approved', public.transition_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'guard_reviewing'),
  'approved',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'guard_reviewing'),
  '98000000-0000-4000-8000-000000000128'
);
reset role;

select pg_temp.approval_set_actor(
  '98000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.approval_throws(
    $sql$
      select public.update_approval_request_v2(
        (select (payload -> 'request' ->> 'id')::uuid
         from approval_runtime_results where result_key = 'guard_approved'),
        '{
          "request_type":"general",
          "title":"닫힌 문서 수정",
          "approver_id":"98000000-0000-4000-8000-000000000002",
          "subject":"general",
          "template_key":"free",
          "body":"닫힌 문서 수정",
          "checklist_items":[]
        }'::jsonb,
        'approved',
        (select (payload -> 'request' ->> 'updated_at')::timestamptz
         from approval_runtime_results where result_key = 'guard_approved'),
        '98000000-0000-4000-8000-000000000129'
      )
    $sql$,
    'approval_closed_immutable'
  ),
  '닫힌 문서는 수정할 수 없다'
);

insert into approval_runtime_results(result_key, payload)
select 'body_only_created', public.create_approval_request_v2(
  '{
    "request_type":"general",
    "title":"본문 수정 재실행",
    "approver_id":"98000000-0000-4000-8000-000000000002",
    "subject":"general",
    "template_key":"free",
    "body":"수정 전 본문",
    "checklist_items":[]
  }'::jsonb,
  'draft',
  '98000000-0000-4000-8000-000000000130'
);
insert into approval_runtime_results(result_key, payload)
select 'body_only_updated', public.update_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'body_only_created'),
  '{
    "request_type":"general",
    "title":"본문 수정 재실행",
    "approver_id":"98000000-0000-4000-8000-000000000002",
    "subject":"general",
    "template_key":"free",
    "body":"수정 후 본문",
    "checklist_items":[]
  }'::jsonb,
  'draft',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'body_only_created'),
  '98000000-0000-4000-8000-000000000131'
);
insert into approval_runtime_results(result_key, payload)
select 'body_only_updated_replay', public.update_approval_request_v2(
  (select (payload -> 'request' ->> 'id')::uuid
   from approval_runtime_results where result_key = 'body_only_created'),
  '{
    "request_type":"general",
    "title":"본문 수정 재실행",
    "approver_id":"98000000-0000-4000-8000-000000000002",
    "subject":"general",
    "template_key":"free",
    "body":"수정 후 본문",
    "checklist_items":[]
  }'::jsonb,
  'draft',
  (select (payload -> 'request' ->> 'updated_at')::timestamptz
   from approval_runtime_results where result_key = 'body_only_created'),
  '98000000-0000-4000-8000-000000000131'
);

select is(
  (select payload -> 'request' ->> 'body'
   from approval_runtime_results where result_key = 'body_only_updated'),
  '수정 후 본문',
  '본문만 수정해도 고정 RPC가 저장 결과를 돌려준다'
);
select is(
  (select payload
   from approval_runtime_results where result_key = 'body_only_updated_replay'),
  (select payload
   from approval_runtime_results where result_key = 'body_only_updated'),
  '본문만 수정한 동일 요청은 최초 응답을 그대로 재실행한다'
);
select is(
  (
    select count(*)
    from public.approval_events event_row
    where event_row.request_id = '98000000-0000-4000-8000-000000000131'::uuid
  ),
  0::bigint,
  '본문만 수정하면 의미 없는 알림 원본 이벤트를 만들지 않는다'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_request_ledger ledger
    where ledger.request_id = '98000000-0000-4000-8000-000000000131'::uuid
      and ledger.request_kind = 'approval_update'
  ),
  1::bigint,
  '본문 수정 재실행 영수증은 정확히 한 건만 남는다'
);
reset role;

select * from finish();
rollback;
