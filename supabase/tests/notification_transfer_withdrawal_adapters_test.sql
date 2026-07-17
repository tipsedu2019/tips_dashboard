begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_function('public', 'complete_ops_transfer_roster_transition_v2', array['uuid', 'uuid']);
select has_function('public', 'complete_ops_withdrawal_roster_transition_v2', array['uuid', 'uuid']);
select has_function('public', 'complete_ops_transfer_roster_transition', array['uuid', 'text']);
select has_function('public', 'complete_ops_withdrawal_roster_transition', array['uuid', 'text']);
select has_function('public', 'get_ops_task_legacy_dispatch_plan_v1', array['uuid', 'uuid']);
select has_function('public', 'transfer_withdrawal_notification_producers_runtime_version', array[]::text[]);

select ok(
  has_function_privilege(
    'authenticated',
    'public.complete_ops_transfer_roster_transition_v2(uuid,uuid)',
    'EXECUTE'
  ),
  '인증 사용자는 전반 완료 고정 RPC를 실행할 수 있다'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.complete_ops_transfer_roster_transition_v2(uuid,uuid)',
    'EXECUTE'
  ),
  '익명 사용자는 전반 완료 고정 RPC를 실행할 수 없다'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.complete_ops_transfer_roster_transition(uuid,text)',
    'EXECUTE'
  ),
  '순차 배포 중 구 화면은 공개 호환 완료 RPC를 실행할 수 있다'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)',
    'EXECUTE'
  ),
  '구 private 전반 완료 구현은 인증 사용자에게 직접 노출되지 않는다'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)',
    'EXECUTE'
  ),
  '구 private 퇴원 완료 구현은 인증 사용자에게 직접 노출되지 않는다'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid)',
    'EXECUTE'
  ),
  '서버 역할만 원본 기반 레거시 발송 계획을 조회할 수 있다'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid)',
    'EXECUTE'
  ),
  '브라우저 인증 사용자는 레거시 발송 계획을 직접 조회할 수 없다'
);

insert into public.profiles(id, role)
values
  ('72000000-0000-4000-8000-000000000001'::uuid, 'admin'),
  ('72000000-0000-4000-8000-000000000002'::uuid, 'teacher')
on conflict (id) do update set role = excluded.role;

-- 이 어댑터의 트랜잭션 경계를 독립 검증하도록 기존 명단 전이의 외부 도메인 작업은
-- 동일 서명의 최소 fixture로 바꾼다. 테스트 트랜잭션 롤백으로 원래 함수가 복원된다.
create or replace function dashboard_private.complete_ops_transfer_roster_transition_impl(
  p_task_id uuid,
  p_request_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(pg_catalog.btrim(p_request_key), '') is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  update public.ops_transfer_details detail
  set timetable_roster_updated = true
  where detail.task_id = p_task_id;
  if not found then raise exception 'ops_transfer_detail_required' using errcode = '23514'; end if;
  update public.ops_tasks task
  set status = 'done', completed_at = pg_catalog.clock_timestamp()
  where task.id = p_task_id and task.type = 'transfer';
  if not found then raise exception 'ops_transfer_not_found' using errcode = 'P0002'; end if;
  return pg_catalog.jsonb_build_object('taskId', p_task_id, 'rosterUpdated', true);
end;
$$;

create or replace function dashboard_private.complete_ops_withdrawal_roster_transition_impl(
  p_task_id uuid,
  p_request_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(pg_catalog.btrim(p_request_key), '') is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  update public.ops_withdrawal_details detail
  set timetable_roster_updated = true
  where detail.task_id = p_task_id;
  if not found then raise exception 'ops_withdrawal_detail_required' using errcode = '23514'; end if;
  update public.ops_tasks task
  set status = 'done', completed_at = pg_catalog.clock_timestamp()
  where task.id = p_task_id and task.type = 'withdrawal';
  if not found then raise exception 'ops_withdrawal_not_found' using errcode = 'P0002'; end if;
  return pg_catalog.jsonb_build_object('taskId', p_task_id, 'rosterUpdated', true);
end;
$$;

create or replace function pg_temp.reject_ops_transition_canonical_fixture()
returns trigger language plpgsql as $$
begin
  if (
    new.event_key = 'transfer.submitted'
    and new.payload ->> 'student_name' = '제출 롤백 학생'
  ) or (
    new.event_key = 'transfer.completed'
    and new.payload ->> 'student_name' = '완료 롤백 학생'
  ) then
    raise exception 'forced_ops_transition_canonical_failure';
  end if;
  return new;
end;
$$;

create trigger reject_ops_transition_canonical_fixture
before insert on dashboard_private.notification_events
for each row execute function pg_temp.reject_ops_transition_canonical_fixture();

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '72000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select throws_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'transfer', 'title', '초기 완료 금지', 'status', 'done',
        'student_name', '초기 완료 학생'
      ),
      'transfer', '{}'::jsonb
    ),
    '72000000-0000-4000-8000-000000000009'::uuid
  )
$$, '22023', 'ops_transition_initial_status_invalid', '전반은 완료 상태로 바로 생성할 수 없다');

select throws_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'withdrawal', 'title', '초기 취소 금지', 'status', 'canceled',
        'student_name', '초기 취소 학생'
      ),
      'withdrawal', '{}'::jsonb
    ),
    '72000000-0000-4000-8000-000000000010'::uuid
  )
$$, '22023', 'ops_transition_initial_status_invalid', '퇴원은 취소 상태로 바로 생성할 수 없다');

select lives_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'transfer', 'title', '전반 제출', 'status', 'requested',
        'student_name', '전반 학생'
      ),
      'transfer', jsonb_build_object(
        'from_teacher_name', '이전 선생님', 'to_teacher_name', '새 선생님',
        'from_class_name', '이전 수업', 'to_class_name', '새 수업'
      )
    ),
    '72000000-0000-4000-8000-000000000011'::uuid
  )
$$, '전반 제출은 업무·원본·canonical 이벤트를 함께 만든다');

select lives_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'withdrawal', 'title', '퇴원 제출', 'status', 'requested',
        'student_name', '퇴원 학생', 'class_name', '퇴원 수업'
      ),
      'withdrawal', jsonb_build_object(
        'teacher_name', '퇴원 선생님', 'withdrawal_date', '2026-07-31',
        'withdrawal_session', '4회차'
      )
    ),
    '72000000-0000-4000-8000-000000000012'::uuid
  )
$$, '퇴원 제출은 업무·원본·canonical 이벤트를 함께 만든다');

select lives_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'transfer', 'title', '완료 롤백 fixture', 'status', 'requested',
        'student_name', '완료 롤백 학생'
      ),
      'transfer', jsonb_build_object(
        'from_class_name', 'A 수업', 'to_class_name', 'B 수업'
      )
    ),
    '72000000-0000-4000-8000-000000000013'::uuid
  )
$$, '완료 롤백 fixture는 제출 이벤트까지 정상 생성한다');

select throws_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'transfer', 'title', '제출 롤백 fixture', 'status', 'requested',
        'student_name', '제출 롤백 학생'
      ),
      'transfer', '{}'::jsonb
    ),
    '72000000-0000-4000-8000-000000000014'::uuid
  )
$$, 'P0001', 'forced_ops_transition_canonical_failure', 'canonical 실패 시 제출 전체를 롤백한다');

select is(
  (select count(*) from public.ops_tasks task where task.title = '제출 롤백 fixture'),
  0::bigint,
  '제출 canonical 실패 뒤 업무가 남지 않는다'
);

select is(
  (
    select count(*) from dashboard_private.notification_events event_row
    where event_row.workflow_key = 'transfer'
      and event_row.event_key = 'transfer.submitted'
      and event_row.payload ->> 'student_name' = '전반 학생'
  ),
  1::bigint,
  '전반 제출은 전반 canonical 이벤트 하나만 만든다'
);
select is(
  (
    select count(*) from dashboard_private.notification_events event_row
    where event_row.workflow_key = 'withdrawal'
      and event_row.event_key = 'withdrawal.submitted'
      and event_row.payload ->> 'student_name' = '전반 학생'
  ),
  0::bigint,
  '전반 제출은 퇴원 이벤트를 만들지 않는다'
);

create temporary table ops_transition_fixtures (
  fixture_key text primary key,
  task_id uuid not null
) on commit drop;

insert into ops_transition_fixtures(fixture_key, task_id)
select 'transfer', task.id from public.ops_tasks task where task.title = '전반 제출'
union all
select 'withdrawal', task.id from public.ops_tasks task where task.title = '퇴원 제출'
union all
select 'rollback', task.id from public.ops_tasks task where task.title = '완료 롤백 fixture';

select is(
  pg_catalog.jsonb_array_length(
    public.transition_ops_task_status_v2(
      (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
      'in_progress',
      (
        select task.updated_at from public.ops_tasks task
        where task.id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer')
      ),
      '72000000-0000-4000-8000-000000000021'::uuid
    ) -> 'sourceEventIds'
  ),
  1,
  '처리 시작 전이는 processing_started 원본 하나를 반환한다'
);

select is(
  pg_catalog.jsonb_array_length(
    public.update_ops_task_v2(
      (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
      jsonb_build_object(
        'transfer', jsonb_build_object('transfer_reason', '수업 변경')
      ),
      (
        select task.updated_at from public.ops_tasks task
        where task.id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer')
      ),
      '72000000-0000-4000-8000-000000000022'::uuid
    ) -> 'sourceEventIds'
  ),
  1,
  '의미 있는 상세 수정은 details_changed 원본 하나를 반환한다'
);

select is(
  pg_catalog.jsonb_array_length(
    public.transition_ops_task_status_v2(
      (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
      'canceled',
      (
        select task.updated_at from public.ops_tasks task
        where task.id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer')
      ),
      '72000000-0000-4000-8000-000000000023'::uuid
    ) -> 'sourceEventIds'
  ),
  1,
  '취소 전이는 canceled 원본 하나를 반환한다'
);

select is(
  pg_catalog.jsonb_array_length(
    public.transition_ops_task_status_v2(
      (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
      'requested',
      (
        select task.updated_at from public.ops_tasks task
        where task.id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer')
      ),
      '72000000-0000-4000-8000-000000000024'::uuid
    ) -> 'sourceEventIds'
  ),
  1,
  '취소 뒤 재개는 reopened 원본 하나를 반환한다'
);

select throws_ok($$
  select public.transition_ops_task_status_v2(
    (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
    'done',
    (
      select task.updated_at from public.ops_tasks task
      where task.id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer')
    ),
    '72000000-0000-4000-8000-000000000025'::uuid
  )
$$, '22023', 'ops_transition_completion_rpc_required', '일반 상태 RPC로 명단 완료를 우회할 수 없다');

select throws_ok($$
  select public.update_ops_task_v2(
    (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
    jsonb_build_object('task', jsonb_build_object('status', 'done')),
    (
      select task.updated_at from public.ops_tasks task
      where task.id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer')
    ),
    '72000000-0000-4000-8000-000000000026'::uuid
  )
$$, '22023', 'ops_transition_completion_rpc_required', '일반 수정 RPC로 명단 완료를 우회할 수 없다');

select is(
  pg_catalog.jsonb_array_length(
    public.update_ops_task_v2(
      (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
      jsonb_build_object('transfer', jsonb_build_object('fee_processed', true)),
    (
      select task.updated_at from public.ops_tasks task
      where task.id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer')
      ),
      '72000000-0000-4000-8000-000000000015'::uuid
    ) -> 'sourceEventIds'
  ),
  0,
  '전반 체크리스트 저장은 원본 UUID를 반환하지 않는다'
);

select is(
  (
    select count(*) from public.ops_task_events event_row
    where event_row.task_id = (
      select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'
    ) and event_row.request_id = '72000000-0000-4000-8000-000000000015'::uuid
  ),
  0::bigint,
  '체크리스트 저장만으로 어떤 전반 원본도 만들지 않는다'
);

select lives_ok($$
  select public.complete_ops_transfer_roster_transition_v2(
    (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
    '72000000-0000-4000-8000-000000000016'::uuid
  )
$$, '전반 명단 전이와 완료 원본을 한 트랜잭션에서 기록한다');

select is(
  (
    public.complete_ops_transfer_roster_transition_v2(
      (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
      '72000000-0000-4000-8000-000000000016'::uuid
    ) -> 'sourceEventIds' ->> 0
  ),
  (
    select event_row.id::text from public.ops_task_events event_row
    where event_row.task_id = (
      select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'
    ) and event_row.event_type = 'transfer.completed'
  ),
  '같은 완료 요청 재실행은 최초 원본 UUID를 반환한다'
);

select lives_ok($$
  select public.complete_ops_withdrawal_roster_transition_v2(
    (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'withdrawal'),
    '72000000-0000-4000-8000-000000000017'::uuid
  )
$$, '퇴원 명단 전이와 완료 원본을 한 트랜잭션에서 기록한다');

select throws_ok($$
  select public.transition_ops_task_status_v2(
    (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'),
    'requested',
    (
      select task.updated_at from public.ops_tasks task
      where task.id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer')
    ),
    '72000000-0000-4000-8000-000000000027'::uuid
  )
$$, '40001', 'ops_transition_closed', '완료된 전반은 일반 상태 RPC로 다시 열 수 없다');

select lives_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'transfer', 'title', '구 화면 호환 완료', 'status', 'requested',
        'student_name', '호환 학생'
      ),
      'transfer', jsonb_build_object(
        'from_class_name', '호환 전 수업', 'to_class_name', '호환 후 수업'
      )
    ),
    '72000000-0000-4000-8000-000000000028'::uuid
  )
$$, '구 화면 호환 완료 fixture를 생성한다');

insert into ops_transition_fixtures(fixture_key, task_id)
select 'legacy_transfer', task.id
from public.ops_tasks task
where task.title = '구 화면 호환 완료';

select lives_ok($$
  select public.complete_ops_transfer_roster_transition(
    (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'legacy_transfer'),
    'legacy-screen-stable-request'
  )
$$, '구 화면 공개 RPC도 명단·완료 원본·canonical을 함께 기록한다');

select is(
  (
    public.complete_ops_transfer_roster_transition(
      (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'legacy_transfer'),
      'legacy-screen-stable-request'
    ) -> 'sourceEventIds' ->> 0
  ),
  (
    select event_row.id::text from public.ops_task_events event_row
    where event_row.task_id = (
      select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'legacy_transfer'
    ) and event_row.event_type = 'transfer.completed'
  ),
  '구 화면 공개 RPC 재실행은 최초 완료 원본 UUID를 그대로 반환한다'
);

select throws_ok($$
  select public.complete_ops_transfer_roster_transition_v2(
    (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'rollback'),
    '72000000-0000-4000-8000-000000000018'::uuid
  )
$$, 'P0001', 'forced_ops_transition_canonical_failure', '완료 canonical 실패 시 명단·상태·원본을 모두 롤백한다');

select is(
  (
    select task.status from public.ops_tasks task
    where task.id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'rollback')
  ),
  'requested',
  '완료 canonical 실패 뒤 업무 상태가 완료로 남지 않는다'
);
select is(
  (
    select detail.timetable_roster_updated from public.ops_transfer_details detail
    where detail.task_id = (select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'rollback')
  ),
  false,
  '완료 canonical 실패 뒤 명단 체크가 남지 않는다'
);
select is(
  (
    select count(*) from public.ops_task_events event_row
    where event_row.task_id = (
      select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'rollback'
    ) and event_row.event_type = 'transfer.completed'
  ),
  0::bigint,
  '완료 canonical 실패 뒤 완료 원본도 남지 않는다'
);

select is(
  (
    select count(*)
    from public.ops_task_events source_row
    join dashboard_private.notification_events canonical
      on canonical.source_type = 'ops_task_event'
     and canonical.source_id = source_row.id::text
     and canonical.occurrence_key = source_row.id::text
    where source_row.event_type like 'transfer.%'
       or source_row.event_type like 'withdrawal.%'
  ),
  (
    select count(*)
    from public.ops_task_events source_row
    where source_row.event_type like 'transfer.%'
       or source_row.event_type like 'withdrawal.%'
  ),
  '모든 성공 원본 UUID는 canonical source와 occurrence에 정확히 한 번 연결된다'
);

select ok(
  not exists (
    select source_row.id
    from public.ops_task_events source_row
    join dashboard_private.notification_events canonical
      on canonical.source_type = 'ops_task_event'
     and canonical.source_id = source_row.id::text
     and canonical.occurrence_key = source_row.id::text
    where source_row.event_type like 'transfer.%'
       or source_row.event_type like 'withdrawal.%'
    group by source_row.id
    having count(*) <> 1
  ),
  '각 전반·퇴원 원본은 canonical 이벤트 하나에만 연결된다'
);

reset role;
set local role service_role;

select is(
  pg_catalog.jsonb_array_length(
    public.get_ops_task_legacy_dispatch_plan_v1(
      (
        select event_row.id from public.ops_task_events event_row
        where event_row.task_id = (
          select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'
        ) and event_row.event_type = 'transfer.processing_started'
      ),
      '72000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items'
  ),
  0,
  '비전송 processing_started 원본은 정상 계획이지만 공급자 항목은 없다'
);

select is(
  (
    public.get_ops_task_legacy_dispatch_plan_v1(
      (
        select event_row.id from public.ops_task_events event_row
        where event_row.task_id = (
          select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'
        ) and event_row.event_type = 'transfer.submitted'
      ),
      '72000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items' -> 0 ->> 'href'
  ),
  '/admin/transfer?taskId=' || (
    select fixture.task_id::text from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'
  ),
  '전반 제출 계획은 실제 전반 화면 taskId 딥링크를 반환한다'
);

select throws_ok($$
  select public.get_ops_task_legacy_dispatch_plan_v1(
    (
      select event_row.id from public.ops_task_events event_row
      where event_row.task_id = (
        select fixture.task_id from ops_transition_fixtures fixture where fixture.fixture_key = 'transfer'
      ) and event_row.event_type = 'transfer.submitted'
    ),
    '72000000-0000-4000-8000-000000000002'::uuid
  )
$$, '42501', 'ops_task_legacy_dispatch_forbidden', '무관한 사용자의 원본으로 발송 계획을 조회할 수 없다');

reset role;
select * from finish();
rollback;
