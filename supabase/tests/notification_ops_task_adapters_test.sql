begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_column('public', 'ops_task_events', 'request_id', '업무 원본 이벤트에 요청 ID가 있다');
select has_column('public', 'ops_task_events', 'payload', '업무 원본 이벤트에 고정 payload가 있다');
select has_column('public', 'ops_word_retests', 'retry_of_task_id', '후속 재시험이 이전 업무를 가리킨다');
select has_column('public', 'ops_word_retests', 'retry_task_id', '이전 재시험이 후속 업무를 가리킨다');

select has_function('public', 'create_ops_task_v2', array['jsonb', 'uuid']);
select has_function('public', 'update_ops_task_v2', array['uuid', 'jsonb', 'timestamp with time zone', 'uuid']);
select has_function('public', 'transition_ops_task_status_v2', array['uuid', 'text', 'timestamp with time zone', 'uuid']);
select has_function('public', 'add_ops_task_comment_v2', array['uuid', 'text', 'uuid']);
select has_function('public', 'record_ops_task_activity_event_v1', array['uuid', 'text', 'text', 'text', 'text', 'uuid']);
select has_function('public', 'retry_word_retest_v1', array['uuid', 'jsonb', 'uuid']);
select has_function('public', 'report_word_retest_result_v1', array['uuid', 'jsonb', 'uuid']);
select has_function('public', 'report_word_retest_absent_v1', array['uuid', 'text', 'uuid']);
select has_function('public', 'request_word_retest_revision_v1', array['uuid', 'text', 'uuid']);

select is_empty($$
  select rule.id
  from dashboard_private.notification_rules rule
  where rule.scope_key = 'global'
    and rule.workflow_key in ('tasks', 'word_retests')
    and rule.enabled
$$, '일반 업무와 단어 재시험 규칙은 모두 꺼져 있다');

insert into public.profiles(id, role)
values
  ('71000000-0000-4000-8000-000000000001'::uuid, 'admin'),
  ('71000000-0000-4000-8000-000000000002'::uuid, 'teacher'),
  ('71000000-0000-4000-8000-000000000003'::uuid, 'assistant'),
  ('71000000-0000-4000-8000-000000000004'::uuid, 'teacher')
on conflict (id) do update set role = excluded.role;

insert into public.teacher_catalogs(id, name, profile_id)
values
  (
    '71000000-0000-4000-8000-000000000005'::uuid,
    'Task 15 연결 선생님',
    '71000000-0000-4000-8000-000000000004'::uuid
  ),
  (
    '71000000-0000-4000-8000-000000000006'::uuid,
    'Task 15 다른 선생님',
    '71000000-0000-4000-8000-000000000002'::uuid
  )
on conflict (id) do update set
  name = excluded.name,
  profile_id = excluded.profile_id;

select ok(
  has_function_privilege('authenticated', 'public.create_ops_task_v2(jsonb,uuid)', 'EXECUTE'),
  '인증 사용자는 고정 목적 생성 RPC를 실행할 수 있다'
);
select ok(
  not has_function_privilege('anon', 'public.create_ops_task_v2(jsonb,uuid)', 'EXECUTE'),
  '익명 사용자는 고정 목적 생성 RPC를 실행할 수 없다'
);

create or replace function pg_temp.reject_ops_task_canonical_fixture()
returns trigger language plpgsql as $$
begin
  if new.payload ->> 'task_title' = '강제 롤백' then
    raise exception 'forced_canonical_failure';
  end if;
  return new;
end;
$$;

create trigger reject_ops_task_canonical_fixture
before insert on dashboard_private.notification_events
for each row execute function pg_temp.reject_ops_task_canonical_fixture();

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select throws_ok($$
  select public.record_ops_task_activity_event_v1(
    '71000000-0000-4000-8000-000000000099'::uuid,
    'status_changed',
    'status',
    'requested',
    'done',
    '71000000-0000-4000-8000-000000000098'::uuid
  )
$$, '22023', 'ops_task_activity_event_invalid',
  '인증 사용자도 공개 activity RPC로 파생 상태 이벤트를 만들 수 없다');

select lives_ok($$
  select public.create_ops_task_v2(
    '{"type":"general","title":"원장 확인","status":"requested"}'::jsonb,
    '71000000-0000-4000-8000-000000000011'::uuid
  )
$$, '일반 업무와 원본·canonical 이벤트를 한 트랜잭션에서 만든다');

select is(
  (
    public.create_ops_task_v2(
      '{"type":"general","title":"원장 확인","status":"requested"}'::jsonb,
      '71000000-0000-4000-8000-000000000011'::uuid
    ) -> 'sourceEventIds' ->> 0
  ),
  (
    select event.id::text
    from public.ops_task_events event
    join public.ops_tasks task on task.id = event.task_id
    where task.title = '원장 확인'
      and event.request_id = '71000000-0000-4000-8000-000000000011'::uuid
  ),
  '같은 요청 재실행은 최초 원본 UUID를 그대로 반환한다'
);

select throws_ok($$
  select public.create_ops_task_v2(
    '{"type":"general","title":"바뀐 요청 본문","status":"requested"}'::jsonb,
    '71000000-0000-4000-8000-000000000011'::uuid
  )
$$, '22023', 'idempotency_key_reused', '같은 요청 ID의 다른 지문은 거부한다');

reset role;
select is(
  (
    select count(*) from dashboard_private.notification_events event
    where event.workflow_key = 'tasks'
      and event.payload ->> 'task_title' = '원장 확인'
  ),
  1::bigint,
  '일반 업무는 tasks canonical 이벤트 하나만 만든다'
);
select is(
  (
    select count(*) from dashboard_private.notification_events event
    where event.workflow_key = 'word_retests'
      and event.payload ->> 'task_title' = '원장 확인'
  ),
  0::bigint,
  '일반 업무는 word_retests 이벤트를 만들지 않는다'
);
set local role authenticated;

select throws_ok($$
  select public.create_ops_task_v2(
    '{"type":"general","title":"강제 롤백","status":"requested"}'::jsonb,
    '71000000-0000-4000-8000-000000000012'::uuid
  )
$$, 'P0001', 'forced_canonical_failure', 'canonical 기록 실패 시 전체 생성이 롤백된다');

select is(
  (select count(*) from public.ops_tasks task where task.title = '강제 롤백'),
  0::bigint,
  'canonical 실패 뒤 업무 행이 남지 않는다'
);
select is(
  (
    select count(*) from public.ops_task_events event
    where event.request_id = '71000000-0000-4000-8000-000000000012'::uuid
  ),
  0::bigint,
  'canonical 실패 뒤 원본 이벤트도 남지 않는다'
);

select throws_ok($$
  select public.create_ops_task_v2(
    '{"type":"registration","title":"등록 우회"}'::jsonb,
    '71000000-0000-4000-8000-000000000013'::uuid
  )
$$, '22023', 'registration_dedicated_service_required', '등록 업무는 전용 서비스를 우회하지 못한다');

select lives_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'word_retest', 'title', '단어 재시험', 'status', 'requested'
      ),
      'word_retest', jsonb_build_object(
        'branch', '본관', 'student_name', '테스트 학생',
        'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
        'class_name', '테스트 수업',
        'test_at', '2026-07-20T01:00:00.000Z',
        'total_question_count', 10, 'cutoff_question_count', 8,
        'retest_status', 'not_started'
      )
    ),
    '71000000-0000-4000-8000-000000000014'::uuid
  )
$$, '단어 재시험 생성은 word_retests 원본만 만든다');

reset role;
select is(
  (
    select count(*) from dashboard_private.notification_events event
    where event.workflow_key = 'word_retests'
      and event.payload ->> 'task_title' = '단어 재시험'
  ),
  1::bigint,
  '단어 재시험은 word_retests canonical 이벤트 하나를 만든다'
);
set local role authenticated;

select throws_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'word_retest', 'title', '잘못된 최초 상태', 'status', 'review_requested'
      ),
      'word_retest', jsonb_build_object('retest_status', 'done', 'first_score', 5)
    ),
    '71000000-0000-4000-8000-000000000020'::uuid
  )
$$, '22023', 'word_retest_initial_state_invalid', '단어 재시험은 임의 완료 상태로 생성할 수 없다');

select throws_ok($$
  select public.create_ops_task_v2(
    jsonb_build_object(
      'task', jsonb_build_object('type', 'word_retest', 'title', '맥락 없는 재시험'),
      'word_retest', jsonb_build_object('retest_status', 'not_started')
    ),
    '71000000-0000-4000-8000-000000000024'::uuid
  )
$$, '22023', 'word_retest_context_required', '학생·교사·수업·본시험일 없는 재시험은 생성할 수 없다');

create temporary table ops_task_adapter_fixtures (
  fixture_key text primary key,
  task_id uuid not null,
  original_updated_at timestamptz not null
) on commit drop;

insert into ops_task_adapter_fixtures(fixture_key, task_id, original_updated_at)
select 'general', task.id, task.updated_at
from public.ops_tasks task where task.title = '원장 확인'
union all
select 'word', task.id, task.updated_at
from public.ops_tasks task where task.title = '단어 재시험';

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000002',
  true
);

select throws_ok($$
  select public.update_ops_task_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general'),
    '{"title":"권한 탈취"}'::jsonb,
    (select fixture.original_updated_at from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general'),
    '71000000-0000-4000-8000-000000000015'::uuid
  )
$$, '42501', 'ops_task_access_denied', '소유자나 담당자가 아닌 인증 사용자는 타인 업무를 수정할 수 없다');

select lives_ok($$
  select public.create_ops_task_v2(
    '{"type":"general","title":"자기 연계 제거 방지","status":"requested"}'::jsonb,
    '71000000-0000-4000-8000-000000000025'::uuid
  )
$$, '일반 사용자는 자신이 요청자인 업무를 만들 수 있다');

select throws_ok($$
  select public.update_ops_task_v2(
    (select task.id from public.ops_tasks task where task.title = '자기 연계 제거 방지'),
    '{"requested_by":"71000000-0000-4000-8000-000000000001"}'::jsonb,
    (select task.updated_at from public.ops_tasks task where task.title = '자기 연계 제거 방지'),
    '71000000-0000-4000-8000-000000000026'::uuid
  )
$$, '42501', 'ops_task_access_denied', '요청자는 수정 후 자기 소유권을 모두 제거할 수 없다');

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

select lives_ok($$
  select public.update_ops_task_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general'),
    '{"priority":"high"}'::jsonb,
    (select fixture.original_updated_at from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general'),
    '71000000-0000-4000-8000-000000000016'::uuid
  )
$$, '조교는 기존 운영 권한과 동일하게 일반 업무를 수정할 수 있다');

select throws_ok($$
  select public.update_ops_task_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general'),
    '{"priority":"urgent"}'::jsonb,
    (
      select fixture.original_updated_at - interval '1 second'
      from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general'
    ),
    '71000000-0000-4000-8000-000000000017'::uuid
  )
$$, '40001', 'ops_task_stale_write', '오래된 갱신 시각으로는 덮어쓸 수 없다');

select lives_ok($$
  select public.update_ops_task_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general'),
    jsonb_build_object('assignee_id', '71000000-0000-4000-8000-000000000004', 'assignee_team', '교무팀'),
    (
      select task.updated_at from public.ops_tasks task
      where task.id = (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general')
    ),
    '71000000-0000-4000-8000-000000000022'::uuid
  )
$$, '조교가 주 담당자와 담당팀을 지정할 수 있다');

select lives_ok($$
  select public.update_ops_task_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general'),
    jsonb_build_object(
      'assignee_id', null,
      'secondary_assignee_id', '71000000-0000-4000-8000-000000000004',
      'assignee_team', '교무팀'
    ),
    (
      select task.updated_at from public.ops_tasks task
      where task.id = (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'general')
    ),
    '71000000-0000-4000-8000-000000000023'::uuid
  )
$$, '같은 사람을 주 담당자에서 보조 담당자로 옮겨도 위치가 보존된다');

select is(
  (
    select event.payload -> 'before_assignee' ->> 'primary_profile_id'
    from public.ops_task_events event
    where event.request_id = '71000000-0000-4000-8000-000000000023'::uuid
      and event.event_type = 'task.assignee_changed'
  ),
  '71000000-0000-4000-8000-000000000004',
  '담당자 변경 전 주 담당자 위치가 정확히 남는다'
);
select is(
  (
    select event.payload -> 'after_assignee' ->> 'secondary_profile_id'
    from public.ops_task_events event
    where event.request_id = '71000000-0000-4000-8000-000000000023'::uuid
      and event.event_type = 'task.assignee_changed'
  ),
  '71000000-0000-4000-8000-000000000004',
  '담당자 변경 후 보조 담당자 위치가 정확히 남는다'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000004',
  true
);

select lives_ok($$
  select public.update_ops_task_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    '{"task":{"priority":"high"}}'::jsonb,
    (select fixture.original_updated_at from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    '71000000-0000-4000-8000-000000000028'::uuid
  )
$$, '단어 업무의 task 전용 수정은 기존 detail을 지우지 않는다');

select is(
  (
    select concat_ws('|', detail.teacher_catalog_id::text, detail.student_name, detail.class_name, detail.test_at::text)
    from public.ops_word_retests detail
    where detail.task_id = (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word')
  ),
  concat_ws(
    '|',
    '71000000-0000-4000-8000-000000000005',
    '테스트 학생',
    '테스트 수업',
    '2026-07-20 10:00:00+09'
  ),
  'task 전용 수정 뒤 교사·학생·수업·본시험일이 그대로 남는다'
);

select throws_ok($$
  select public.update_ops_task_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    '{"word_retest":{"test_at":null}}'::jsonb,
    (select fixture.original_updated_at from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    '71000000-0000-4000-8000-000000000029'::uuid
  )
$$, '22023', 'word_retest_context_required', '수정으로 단어 재시험 본시험일을 제거할 수 없다');

select throws_ok($$
  select public.update_ops_task_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    jsonb_build_object(
      'word_retest', jsonb_build_object(
        'teacher_catalog_id', '71000000-0000-4000-8000-000000000006',
        'teacher_name', 'Task 15 다른 선생님',
        'class_name', '테스트 수업',
        'student_name', '테스트 학생',
        'test_at', '2026-07-20T01:00:00.000Z',
        'total_question_count', 10,
        'cutoff_question_count', 8,
        'retest_status', 'not_started'
      )
    ),
    (select fixture.original_updated_at from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    '71000000-0000-4000-8000-000000000027'::uuid
  )
$$, '42501', 'ops_task_access_denied', '연결 교사는 수정 후 자기 교사 연결을 제거할 수 없다');

select lives_ok($$
  select public.transition_ops_task_status_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    'in_progress',
    (select fixture.original_updated_at from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    '71000000-0000-4000-8000-000000000018'::uuid
  )
$$, '연결된 단어 담당 선생님은 재시험을 시작할 수 있다');

select lives_ok($$
  select public.report_word_retest_result_v1(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    '{"first_score":5}'::jsonb,
    '71000000-0000-4000-8000-000000000019'::uuid
  )
$$, '결과 보고는 권위 상태와 원본 이벤트를 함께 기록한다');

select throws_ok($$
  select public.transition_ops_task_status_v2(
    (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
    'requested',
    (
      select task.updated_at from public.ops_tasks task
      where task.id = (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word')
    ),
    '71000000-0000-4000-8000-000000000021'::uuid
  )
$$, '22023', 'word_retest_revision_rpc_required', '검토 요청 상태는 일반 상태 RPC로 되돌릴 수 없다');

create temporary table word_retest_retry_results (
  attempt_key text primary key,
  response jsonb not null
) on commit drop;

insert into word_retest_retry_results(attempt_key, response)
select 'first', public.retry_word_retest_v1(
  (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest',
      'title', '단어 재시험 후속',
      'status', 'requested'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관',
      'student_name', '테스트 학생',
      'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
      'teacher_name', 'Task 15 선생님',
      'class_name', '테스트 수업',
      'test_at', '2026-07-27T01:00:00.000Z',
      'total_question_count', 10,
      'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '71000000-0000-4000-8000-000000000030'::uuid
);

insert into word_retest_retry_results(attempt_key, response)
select 'replay', public.retry_word_retest_v1(
  (select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest',
      'title', '단어 재시험 후속',
      'status', 'requested'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관',
      'student_name', '테스트 학생',
      'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
      'teacher_name', 'Task 15 선생님',
      'class_name', '테스트 수업',
      'test_at', '2026-07-27T01:00:00.000Z',
      'total_question_count', 10,
      'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '71000000-0000-4000-8000-000000000030'::uuid
);

select is(
  (select response -> 'previousTask' ->> 'status' from word_retest_retry_results where attempt_key = 'first'),
  'done',
  '불합격 재시험 생성은 이전 업무를 완료한다'
);

select is(
  (
    select detail.retry_task_id::text
    from public.ops_word_retests detail
    where detail.task_id = (
      select fixture.task_id from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'
    )
  ),
  (select response -> 'task' ->> 'id' from word_retest_retry_results where attempt_key = 'first'),
  '이전 재시험은 새 후속 업무를 가리킨다'
);

select is(
  (
    select detail.retry_of_task_id::text
    from public.ops_word_retests detail
    where detail.task_id = (
      select (response -> 'task' ->> 'id')::uuid
      from word_retest_retry_results where attempt_key = 'first'
    )
  ),
  (select fixture.task_id::text from ops_task_adapter_fixtures fixture where fixture.fixture_key = 'word'),
  '새 재시험은 이전 업무를 가리킨다'
);

select is(
  (
    select response -> 'task' ->> 'id'
    from word_retest_retry_results where attempt_key = 'replay'
  ),
  (
    select response -> 'task' ->> 'id'
    from word_retest_retry_results where attempt_key = 'first'
  ),
  '같은 요청 ID 재실행은 최초 생성 업무 UUID를 돌려준다'
);

select is(
  (
    select response -> 'sourceEventIds'
    from word_retest_retry_results where attempt_key = 'replay'
  ),
  (
    select response -> 'sourceEventIds'
    from word_retest_retry_results where attempt_key = 'first'
  ),
  '같은 요청 ID 재실행은 최초 원본 이벤트 UUID 두 개를 그대로 돌려준다'
);

select is(
  (
    select count(*)
    from public.ops_task_events event
    where event.request_id = '71000000-0000-4000-8000-000000000030'::uuid
      and event.event_type in ('word_retest.completed', 'word_retest.retry_created')
  ),
  2::bigint,
  '재시험 생성과 재실행 뒤에도 완료·후속 생성 원본 이벤트는 정확히 두 건이다'
);

reset role;
select is(
  (
    select count(*)
    from dashboard_private.notification_events event
    where event.workflow_key = 'word_retests'
      and event.source_type = 'ops_task_event'
      and event.source_id in (
        select jsonb_array_elements_text(result.response -> 'sourceEventIds')
        from word_retest_retry_results result
        where result.attempt_key = 'first'
      )
  ),
  2::bigint,
  '재시험 완료·후속 생성 원본은 canonical 이벤트 두 건으로 한 번씩만 정규화된다'
);
set local role authenticated;

reset role;

insert into public.ops_tasks(id, title, type, status, requested_by)
values
  (
    '72000000-0000-4000-8000-000000000101'::uuid,
    '재재시험 불합격 원본', 'word_retest', 'review_requested',
    '71000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '72000000-0000-4000-8000-000000000102'::uuid,
    '재재시험 미응시 원본', 'word_retest', 'review_requested',
    '71000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '72000000-0000-4000-8000-000000000103'::uuid,
    '재재시험 변경일 원본', 'word_retest', 'review_requested',
    '71000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '72000000-0000-4000-8000-000000000104'::uuid,
    '재재시험 연결 부모', 'word_retest', 'done',
    '71000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '72000000-0000-4000-8000-000000000105'::uuid,
    '재재시험 연결 자식', 'word_retest', 'requested',
    '71000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '72000000-0000-4000-8000-000000000106'::uuid,
    '재재시험 롤백 원본', 'word_retest', 'review_requested',
    '71000000-0000-4000-8000-000000000001'::uuid
  );

insert into public.ops_tasks(id, title, type, status, requested_by, completed_at)
values (
  '72000000-0000-4000-8000-000000000107'::uuid,
  '완료 미응시 복구 원본', 'word_retest', 'done',
  '71000000-0000-4000-8000-000000000001'::uuid,
  '2026-07-05T12:34:56.000Z'::timestamptz
);

insert into public.ops_word_retests(
  task_id, branch, teacher_catalog_id, teacher_name, class_name, student_name,
  test_at, total_question_count, cutoff_question_count,
  first_score, retest_status, retry_of_task_id, retry_task_id
)
values
  (
    '72000000-0000-4000-8000-000000000101'::uuid,
    '본관', '71000000-0000-4000-8000-000000000005'::uuid,
    'Task 15 연결 선생님', '재재시험 수업', '불합격 학생',
    '2026-07-01T01:00:00.000Z', 10, 8, 5, 'done', null, null
  ),
  (
    '72000000-0000-4000-8000-000000000102'::uuid,
    '본관', '71000000-0000-4000-8000-000000000005'::uuid,
    'Task 15 연결 선생님', '재재시험 수업', '미응시 학생',
    '2026-07-02T01:00:00.000Z', 10, 8, null, 'absent', null, null
  ),
  (
    '72000000-0000-4000-8000-000000000103'::uuid,
    '본관', '71000000-0000-4000-8000-000000000005'::uuid,
    'Task 15 연결 선생님', '재재시험 수업', '변경일 학생',
    '2026-07-03T01:00:00.000Z', 10, 8, null, 'absent', null, null
  ),
  (
    '72000000-0000-4000-8000-000000000104'::uuid,
    '본관', '71000000-0000-4000-8000-000000000005'::uuid,
    'Task 15 연결 선생님', '재재시험 수업', '연결 학생',
    '2026-01-01T01:00:00.000Z', 10, 8, null, 'absent',
    null, '72000000-0000-4000-8000-000000000105'::uuid
  ),
  (
    '72000000-0000-4000-8000-000000000105'::uuid,
    '본관', '71000000-0000-4000-8000-000000000005'::uuid,
    'Task 15 연결 선생님', '재재시험 수업', '연결 학생',
    '2026-01-01T01:00:00.000Z', 10, 8, null, 'not_started',
    '72000000-0000-4000-8000-000000000104'::uuid, null
  ),
  (
    '72000000-0000-4000-8000-000000000106'::uuid,
    '본관', '71000000-0000-4000-8000-000000000005'::uuid,
    'Task 15 연결 선생님', '재재시험 수업', '롤백 학생',
    '2026-07-04T01:00:00.000Z', 10, 8, 4, 'done', null, null
  );

insert into public.ops_word_retests(
  task_id, branch, teacher_catalog_id, teacher_name, class_name, student_name,
  test_at, total_question_count, cutoff_question_count,
  first_score, retest_status, retry_of_task_id, retry_task_id
)
values (
  '72000000-0000-4000-8000-000000000107'::uuid,
  '본관', '71000000-0000-4000-8000-000000000005'::uuid,
  'Task 15 연결 선생님', '재재시험 수업', '완료 미응시 학생',
  '2026-07-05T01:00:00.000Z', 10, 8, null, 'absent', null, null
);

insert into public.ops_task_events(
  id, task_id, actor_id, event_type, field_name,
  before_value, after_value, request_id, created_at
)
values (
  '72000000-0000-4000-8000-000000000299'::uuid,
  '72000000-0000-4000-8000-000000000107'::uuid,
  '71000000-0000-4000-8000-000000000004'::uuid,
  'word_retest.completed', 'status', 'review_requested', 'done',
  '72000000-0000-4000-8000-000000000299'::uuid,
  '2026-07-05T12:34:56.000Z'::timestamptz
);

set local role authenticated;

create temporary table word_retest_reretry_results (
  attempt_key text primary key,
  response jsonb not null
) on commit drop;

insert into word_retest_reretry_results(attempt_key, response)
select 'done-absent-recovery', public.retry_word_retest_v1(
  '72000000-0000-4000-8000-000000000107'::uuid,
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest', 'title', '완료 미응시 후속 재재시험', 'status', 'requested'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관', 'student_name', '완료 미응시 학생',
      'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
      'teacher_name', 'Task 15 연결 선생님', 'class_name', '재재시험 수업',
      'total_question_count', 10, 'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '72000000-0000-4000-8000-000000000210'::uuid
);

select results_eq(
  $$
    select task.status, task.completed_at, detail.retest_status,
      detail.retry_task_id::text
    from public.ops_tasks task
    join public.ops_word_retests detail on detail.task_id = task.id
    where task.id = '72000000-0000-4000-8000-000000000107'::uuid
  $$,
  $$
    values (
      'done'::text,
      '2026-07-05T12:34:56.000Z'::timestamptz,
      'absent'::text,
      (
        select response -> 'task' ->> 'id'
        from word_retest_reretry_results where attempt_key = 'done-absent-recovery'
      )
    )
  $$,
  '완료 미응시 원본의 상태·완료 시각·결과를 보존하고 후속을 연결한다'
);

select results_eq(
  $$
    select task.status, task.completed_at, detail.retest_status,
      detail.retry_of_task_id::text
    from public.ops_tasks task
    join public.ops_word_retests detail on detail.task_id = task.id
    where task.id = (
      select (response -> 'task' ->> 'id')::uuid
      from word_retest_reretry_results where attempt_key = 'done-absent-recovery'
    )
  $$,
  $$
    values (
      'requested'::text,
      null::timestamptz,
      'not_started'::text,
      '72000000-0000-4000-8000-000000000107'::text
    )
  $$,
  '완료 미응시 후속은 요청·시작 전 상태와 원본 링크를 가진다'
);

select results_eq(
  $$
    select event.event_type, count(*)
    from public.ops_task_events event
    where event.request_id = '72000000-0000-4000-8000-000000000210'::uuid
      and event.event_type in ('word_retest.completed', 'word_retest.retry_created')
    group by event.event_type
    order by event.event_type
  $$,
  $$ values ('word_retest.retry_created'::text, 1::bigint) $$,
  '이미 완료된 원본은 후속 생성 이벤트만 한 건 기록한다'
);

select is(
  (
    select count(*) from public.ops_task_events event
    where event.id = '72000000-0000-4000-8000-000000000299'::uuid
      and event.event_type = 'word_retest.completed'
  ),
  1::bigint,
  '완료 미응시 원본의 기존 완료 이력은 보존된다'
);

select throws_ok($$
  select public.retry_word_retest_v1(
    '72000000-0000-4000-8000-000000000107'::uuid,
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'word_retest', 'title', '완료 미응시 중복 후속', 'status', 'requested'
      ),
      'word_retest', jsonb_build_object(
        'branch', '본관', 'student_name', '완료 미응시 학생',
        'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
        'teacher_name', 'Task 15 연결 선생님', 'class_name', '재재시험 수업',
        'test_at', '2026-07-12T01:00:00.000Z',
        'total_question_count', 10, 'cutoff_question_count', 8,
        'retest_status', 'not_started'
      )
    ),
    '72000000-0000-4000-8000-000000000211'::uuid
  )
$$, '40001', 'word_retest_retry_conflict',
  '완료 미응시 원본의 다른 요청 ID 후속 생성은 충돌로 거부된다');

insert into word_retest_reretry_results(attempt_key, response)
select 'failed-first', public.retry_word_retest_v1(
  '72000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest', 'title', '불합격 후속 재재시험', 'status', 'requested'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관', 'student_name', '불합격 학생',
      'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
      'teacher_name', 'Task 15 연결 선생님', 'class_name', '재재시험 수업',
      'test_at', '2026-07-08T01:00:00.000Z',
      'total_question_count', 10, 'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '72000000-0000-4000-8000-000000000201'::uuid
);

insert into word_retest_reretry_results(attempt_key, response)
select 'failed-replay', public.retry_word_retest_v1(
  '72000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest', 'title', '불합격 후속 재재시험', 'status', 'requested'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관', 'student_name', '불합격 학생',
      'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
      'teacher_name', 'Task 15 연결 선생님', 'class_name', '재재시험 수업',
      'test_at', '2026-07-08T01:00:00.000Z',
      'total_question_count', 10, 'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '72000000-0000-4000-8000-000000000201'::uuid
);

select is(
  (select response -> 'task' ->> 'id' from word_retest_reretry_results where attempt_key = 'failed-replay'),
  (select response -> 'task' ->> 'id' from word_retest_reretry_results where attempt_key = 'failed-first'),
  '불합격 원본의 같은 요청 ID 재실행은 최초 후속 UUID를 돌려준다'
);

select is(
  (
    select detail.retest_status
    from public.ops_word_retests detail
    where detail.task_id = '72000000-0000-4000-8000-000000000101'::uuid
  ),
  'done',
  '불합격 원본의 완료 결과는 후속 생성 뒤에도 보존된다'
);

select throws_ok($$
  select public.retry_word_retest_v1(
    '72000000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'word_retest', 'title', '중복 후속 재재시험', 'status', 'requested'
      ),
      'word_retest', jsonb_build_object(
        'branch', '본관', 'student_name', '불합격 학생',
        'teacher_name', 'Task 15 연결 선생님', 'class_name', '재재시험 수업',
        'test_at', '2026-07-09T01:00:00.000Z', 'retest_status', 'not_started'
      )
    ),
    '72000000-0000-4000-8000-000000000202'::uuid
  )
$$, '40001', 'word_retest_retry_conflict',
  '같은 원본의 다른 요청 ID 후속 생성은 충돌로 거부된다');

insert into word_retest_reretry_results(attempt_key, response)
select 'absent-inherited-date', public.retry_word_retest_v1(
  '72000000-0000-4000-8000-000000000102'::uuid,
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest', 'title', '미응시 후속 재재시험', 'status', 'requested'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관', 'student_name', '미응시 학생',
      'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
      'teacher_name', 'Task 15 연결 선생님', 'class_name', '재재시험 수업',
      'total_question_count', 10, 'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '72000000-0000-4000-8000-000000000203'::uuid
);

select is(
  (
    select task.status
    from public.ops_tasks task
    where task.id = '72000000-0000-4000-8000-000000000102'::uuid
  ),
  'done',
  '미응시 원본의 업무 상태만 완료된다'
);

select is(
  (
    select detail.retest_status
    from public.ops_word_retests detail
    where detail.task_id = '72000000-0000-4000-8000-000000000102'::uuid
  ),
  'absent',
  '미응시 원본의 세부 결과는 완료로 덮어쓰지 않는다'
);

select is(
  (
    select detail.test_at
    from public.ops_word_retests detail
    where detail.task_id = (
      select (response -> 'task' ->> 'id')::uuid
      from word_retest_reretry_results where attempt_key = 'absent-inherited-date'
    )
  ),
  '2026-07-02T01:00:00.000Z'::timestamptz,
  '후속 본시험일을 생략하면 미응시 원본의 본시험일을 상속한다'
);

select is(
  (
    select detail.retry_task_id::text
    from public.ops_word_retests detail
    where detail.task_id = '72000000-0000-4000-8000-000000000102'::uuid
  ),
  (
    select response -> 'task' ->> 'id'
    from word_retest_reretry_results where attempt_key = 'absent-inherited-date'
  ),
  '미응시 원본은 후속 재재시험을 가리킨다'
);

select is(
  (
    select detail.retry_of_task_id::text
    from public.ops_word_retests detail
    where detail.task_id = (
      select (response -> 'task' ->> 'id')::uuid
      from word_retest_reretry_results where attempt_key = 'absent-inherited-date'
    )
  ),
  '72000000-0000-4000-8000-000000000102',
  '미응시 후속 재재시험은 원본을 가리킨다'
);

insert into word_retest_reretry_results(attempt_key, response)
select 'absent-changed-date', public.retry_word_retest_v1(
  '72000000-0000-4000-8000-000000000103'::uuid,
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest', 'title', '변경일 후속 재재시험', 'status', 'requested'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관', 'student_name', '변경일 학생',
      'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
      'teacher_name', 'Task 15 연결 선생님', 'class_name', '재재시험 수업',
      'test_at', '2026-08-05T01:00:00.000Z',
      'total_question_count', 10, 'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '72000000-0000-4000-8000-000000000204'::uuid
);

select is(
  (
    select detail.test_at
    from public.ops_word_retests detail
    where detail.task_id = (
      select (response -> 'task' ->> 'id')::uuid
      from word_retest_reretry_results where attempt_key = 'absent-changed-date'
    )
  ),
  '2026-08-05T01:00:00.000Z'::timestamptz,
  '명시적으로 바꾼 후속 본시험일은 원본 날짜로 덮어쓰지 않는다'
);

select throws_ok($$
  select public.report_word_retest_absent_v1(
    '72000000-0000-4000-8000-000000000105'::uuid,
    'deadline',
    '72000000-0000-4000-8000-000000000205'::uuid
  )
$$, '40001', 'word_retest_absent_deadline_not_allowed',
  '연결 자식은 기한 경과 미응시 자동 처리에서 제외된다');

select lives_ok($$
  select public.transition_ops_task_status_v2(
    '72000000-0000-4000-8000-000000000105'::uuid,
    'in_progress',
    (
      select task.updated_at from public.ops_tasks task
      where task.id = '72000000-0000-4000-8000-000000000105'::uuid
    ),
    '72000000-0000-4000-8000-000000000206'::uuid
  )
$$, '연결 자식도 일반 시험 시작 전이를 사용할 수 있다');

select lives_ok($$
  select public.report_word_retest_absent_v1(
    '72000000-0000-4000-8000-000000000105'::uuid,
    'manual',
    '72000000-0000-4000-8000-000000000207'::uuid
  )
$$, '시작한 연결 자식의 수동 미응시 처리는 유지된다');

insert into word_retest_reretry_results(attempt_key, response)
select 'middle-outgoing', public.retry_word_retest_v1(
  '72000000-0000-4000-8000-000000000105'::uuid,
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest', 'title', '연결 자식의 후속 재재시험', 'status', 'requested'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관', 'student_name', '연결 학생',
      'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
      'teacher_name', 'Task 15 연결 선생님', 'class_name', '재재시험 수업',
      'test_at', '2026-08-06T01:00:00.000Z',
      'total_question_count', 10, 'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '72000000-0000-4000-8000-000000000208'::uuid
);

select results_eq(
  $$
    select detail.retry_of_task_id::text, detail.retry_task_id::text
    from public.ops_word_retests detail
    where detail.task_id = '72000000-0000-4000-8000-000000000105'::uuid
  $$,
  $$
    values (
      '72000000-0000-4000-8000-000000000104'::text,
      (
        select response -> 'task' ->> 'id'
        from word_retest_reretry_results where attempt_key = 'middle-outgoing'
      )
    )
  $$,
  '중간 연결 자식은 들어오는 링크와 나가는 링크를 함께 가진다'
);

reset role;
create or replace function pg_temp.reject_word_retest_retry_created_fixture()
returns trigger language plpgsql as $$
begin
  if new.event_type = 'word_retest.retry_created'
    and new.payload ->> 'task_title' = '재재시험 원자성 실패'
  then
    raise exception 'forced_word_retest_retry_created_failure';
  end if;
  return new;
end;
$$;

create trigger reject_word_retest_retry_created_fixture
before insert on public.ops_task_events
for each row execute function pg_temp.reject_word_retest_retry_created_fixture();
set local role authenticated;

select throws_ok($$
  select public.retry_word_retest_v1(
    '72000000-0000-4000-8000-000000000106'::uuid,
    jsonb_build_object(
      'task', jsonb_build_object(
        'type', 'word_retest', 'title', '재재시험 원자성 실패', 'status', 'requested'
      ),
      'word_retest', jsonb_build_object(
        'branch', '본관', 'student_name', '롤백 학생',
        'teacher_catalog_id', '71000000-0000-4000-8000-000000000005',
        'teacher_name', 'Task 15 연결 선생님', 'class_name', '재재시험 수업',
        'test_at', '2026-08-07T01:00:00.000Z',
        'total_question_count', 10, 'cutoff_question_count', 8,
        'retest_status', 'not_started'
      )
    ),
    '72000000-0000-4000-8000-000000000209'::uuid
  )
$$, 'P0001', 'forced_word_retest_retry_created_failure',
  '후속 생성 이벤트 실패는 재재시험 RPC 전체를 롤백한다');

select results_eq(
  $$
    select task.status, detail.retest_status, detail.retry_task_id::text
    from public.ops_tasks task
    join public.ops_word_retests detail on detail.task_id = task.id
    where task.id = '72000000-0000-4000-8000-000000000106'::uuid
  $$,
  $$ values ('review_requested'::text, 'done'::text, null::text) $$,
  '실패 뒤 원본 업무 상태·결과·링크가 모두 복구된다'
);

select is(
  (
    select count(*) from public.ops_tasks task
    where task.title = '재재시험 원자성 실패'
  ),
  0::bigint,
  '실패 뒤 생성한 후속 업무가 남지 않는다'
);

select is(
  (
    select count(*) from public.ops_task_events event
    where event.request_id = '72000000-0000-4000-8000-000000000209'::uuid
  ),
  0::bigint,
  '후속 생성 이벤트 실패 뒤 앞선 완료 이벤트도 남지 않는다'
);

reset role;
select * from finish();
rollback;
