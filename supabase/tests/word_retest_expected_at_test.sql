begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_column(
  'public',
  'ops_word_retests',
  'expected_retest_at',
  '단어 재시험에 응시예정일시 컬럼이 있다'
);
select has_column(
  'dashboard_private',
  'word_retest_expected_update_markers',
  'update_scope',
  '내부 저장 marker는 예상일시 전용과 일반 detail 저장을 구분한다'
);
select col_type_is(
  'public',
  'ops_word_retests',
  'expected_retest_at',
  'timestamp with time zone',
  '응시예정일시는 timestamptz다'
);
select is(
  (
    select column_info.is_nullable
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'ops_word_retests'
      and column_info.column_name = 'expected_retest_at'
  ),
  'YES',
  '응시예정일시는 nullable이다'
);
select has_function(
  'public',
  'update_word_retest_expected_at_v1',
  array['uuid', 'timestamp with time zone', 'timestamp with time zone', 'uuid']
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_word_retest_expected_at_v1(uuid,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  '인증 사용자만 응시예정일시 전용 RPC를 실행할 수 있다'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.update_word_retest_expected_at_v1(uuid,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  '익명 사용자는 응시예정일시 전용 RPC를 실행할 수 없다'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'dashboard_private.word_retest_expected_update_markers',
    'INSERT'
  ),
  '인증 사용자는 전용 변경 marker를 직접 만들 수 없다'
);

insert into public.profiles(id, role)
values
  ('82000000-0000-4000-8000-000000000001'::uuid, 'admin'),
  ('82000000-0000-4000-8000-000000000002'::uuid, 'staff'),
  ('82000000-0000-4000-8000-000000000003'::uuid, 'assistant'),
  ('82000000-0000-4000-8000-000000000004'::uuid, 'teacher'),
  ('82000000-0000-4000-8000-000000000005'::uuid, 'teacher'),
  ('82000000-0000-4000-8000-000000000006'::uuid, 'assistant'),
  ('82000000-0000-4000-8000-000000000007'::uuid, 'teacher')
on conflict (id) do update set role = excluded.role;

insert into public.teacher_catalogs(id, name, profile_id)
values
  (
    '82000000-0000-4000-8000-000000000011'::uuid,
    'Expected At 연결 교사',
    '82000000-0000-4000-8000-000000000004'::uuid
  ),
  (
    '82000000-0000-4000-8000-000000000012'::uuid,
    'Expected At 조교 연결',
    '82000000-0000-4000-8000-000000000006'::uuid
  ),
  (
    '82000000-0000-4000-8000-000000000013'::uuid,
    'Expected At 이름만 같은 교사',
    '82000000-0000-4000-8000-000000000007'::uuid
  )
on conflict (id) do update set
  name = excluded.name,
  profile_id = excluded.profile_id;

create temporary table expected_at_fixtures (
  fixture_key text primary key,
  task_id uuid not null default pg_catalog.gen_random_uuid(),
  status text not null,
  teacher_catalog_id uuid,
  teacher_name text not null,
  fixture_group text not null
) on commit drop;

insert into expected_at_fixtures(
  fixture_key, status, teacher_catalog_id, teacher_name, fixture_group
) values
  (
    'matrix_requested', 'requested',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'matrix'
  ),
  (
    'matrix_confirmed', 'confirmed',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'matrix'
  ),
  (
    'matrix_in_progress', 'in_progress',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'matrix'
  ),
  (
    'matrix_review_requested', 'review_requested',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'matrix'
  ),
  (
    'matrix_on_hold', 'on_hold',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'matrix'
  ),
  (
    'closed_done', 'done',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'closed'
  ),
  (
    'closed_canceled', 'canceled',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'closed'
  ),
  (
    'assistant_linked_review', 'review_requested',
    '82000000-0000-4000-8000-000000000012', 'Expected At 조교 연결', 'assistant_link'
  ),
  (
    'name_only_requested', 'requested',
    null, 'Expected At 이름만 같은 교사', 'name_only'
  ),
  (
    'assistant_absence', 'in_progress',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'assistant_action'
  ),
  (
    'semantic', 'requested',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'semantic'
  ),
  (
    'retry_previous', 'review_requested',
    '82000000-0000-4000-8000-000000000011', 'Expected At 연결 교사', 'retry'
  );

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id,
  student_name, class_name, campus, subject, due_at, memo
)
select
  fixture.task_id,
  'expected-at ' || fixture.fixture_key,
  'word_retest',
  fixture.status,
  'normal',
  '82000000-0000-4000-8000-000000000001'::uuid,
  '82000000-0000-4000-8000-000000000003'::uuid,
  'Expected At 학생',
  'Expected At 수업',
  '본관',
  '영어',
  '2026-08-01T01:00:00.000Z'::timestamptz,
  '원본 메모 ' || fixture.fixture_key
from expected_at_fixtures fixture;

insert into public.ops_word_retests(
  task_id, branch, teacher_catalog_id, teacher_name, class_name, student_name,
  test_at, expected_retest_at, textbook_name, unit, request_note,
  total_question_count, cutoff_question_count, first_score, retest_status
)
select
  fixture.task_id,
  '본관',
  fixture.teacher_catalog_id,
  fixture.teacher_name,
  'Expected At 수업',
  'Expected At 학생',
  '2026-07-24T01:00:00.000Z'::timestamptz,
  case when fixture.fixture_key = 'retry_previous'
    then '2026-07-25T10:00:00.000Z'::timestamptz
    else null
  end,
  'Expected At 교재',
  '1-10',
  '원본 노트 ' || fixture.fixture_key,
  10,
  8,
  case when fixture.fixture_key = 'retry_previous' then 5 else null end,
  case
    when fixture.fixture_key = 'retry_previous' then 'done'
    when fixture.status = 'in_progress' then 'in_progress'
    when fixture.status = 'review_requested' then 'done'
    when fixture.status in ('done', 'canceled') then 'done'
    else 'not_started'
  end
from expected_at_fixtures fixture;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select throws_ok(
  format(
    'update public.ops_word_retests set expected_retest_at = %L::timestamptz where task_id = %L::uuid',
    '2026-07-27T01:00:00.000Z',
    fixture.task_id
  ),
  '42501',
  'word_retest_expected_only_required',
  'admin도 전용 RPC를 우회해 응시예정일시를 직접 수정할 수 없다'
)
from expected_at_fixtures fixture
where fixture.fixture_key = 'matrix_requested';

select lives_ok(
  format(
    'select public.update_word_retest_expected_at_v1(%L::uuid,%L::timestamptz,(select updated_at from public.ops_tasks where id = %L::uuid),pg_catalog.gen_random_uuid())',
    fixture.task_id,
    '2026-07-26T01:00:00.000Z',
    fixture.task_id
  ),
  'admin은 열린 ' || fixture.status || ' 상태의 예정일시를 수정한다'
)
from expected_at_fixtures fixture
where fixture.fixture_group = 'matrix';

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  format(
    'update public.ops_word_retests set expected_retest_at = %L::timestamptz where task_id = %L::uuid',
    '2026-07-27T02:00:00.000Z',
    fixture.task_id
  ),
  '42501',
  'word_retest_expected_only_required',
  'staff도 전용 RPC를 우회해 응시예정일시를 직접 수정할 수 없다'
)
from expected_at_fixtures fixture
where fixture.fixture_key = 'matrix_requested';

select lives_ok(
  format(
    'select public.update_word_retest_expected_at_v1(%L::uuid,%L::timestamptz,(select updated_at from public.ops_tasks where id = %L::uuid),pg_catalog.gen_random_uuid())',
    fixture.task_id,
    '2026-07-26T02:00:00.000Z',
    fixture.task_id
  ),
  'staff는 열린 ' || fixture.status || ' 상태의 예정일시를 수정한다'
)
from expected_at_fixtures fixture
where fixture.fixture_group = 'matrix';

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000003',
  true
);

select throws_ok(
  format(
    'update public.ops_word_retests set expected_retest_at = %L::timestamptz where task_id = %L::uuid',
    '2026-07-27T03:00:00.000Z',
    fixture.task_id
  ),
  '42501',
  'word_retest_expected_only_required',
  'assistant도 전용 RPC를 우회해 응시예정일시를 직접 수정할 수 없다'
)
from expected_at_fixtures fixture
where fixture.fixture_key = 'matrix_requested';

select lives_ok(
  format(
    'select public.update_word_retest_expected_at_v1(%L::uuid,%L::timestamptz,(select updated_at from public.ops_tasks where id = %L::uuid),pg_catalog.gen_random_uuid())',
    fixture.task_id,
    '2026-07-26T03:00:00.000Z',
    fixture.task_id
  ),
  'assistant는 허용된 ' || fixture.status || ' 상태의 예정일시를 수정한다'
)
from expected_at_fixtures fixture
where fixture.fixture_key in (
  'matrix_requested', 'matrix_confirmed', 'matrix_in_progress', 'matrix_on_hold'
);

select throws_ok(
  format(
    'select public.update_word_retest_expected_at_v1(%L::uuid,%L::timestamptz,(select updated_at from public.ops_tasks where id = %L::uuid),pg_catalog.gen_random_uuid())',
    fixture.task_id,
    '2026-07-26T03:30:00.000Z',
    fixture.task_id
  ),
  '42501',
  'word_retest_expected_access_denied',
  'assistant는 review_requested 예정일시를 수정할 수 없다'
)
from expected_at_fixtures fixture
where fixture.fixture_key = 'matrix_review_requested';

select throws_ok(
  format(
    'select public.update_word_retest_expected_at_v1(%L::uuid,%L::timestamptz,(select updated_at from public.ops_tasks where id = %L::uuid),pg_catalog.gen_random_uuid())',
    fixture.task_id,
    '2026-07-26T03:30:00.000Z',
    fixture.task_id
  ),
  '40001',
  'word_retest_expected_closed',
  'assistant를 포함해 누구도 닫힌 ' || fixture.status || ' 상태를 수정할 수 없다'
)
from expected_at_fixtures fixture
where fixture.fixture_group = 'closed';

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000006","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000006',
  true
);

select throws_ok(
  format(
    'select public.update_word_retest_expected_at_v1(%L::uuid,%L::timestamptz,(select updated_at from public.ops_tasks where id = %L::uuid),pg_catalog.gen_random_uuid())',
    fixture.task_id,
    '2026-07-26T04:00:00.000Z',
    fixture.task_id
  ),
  '42501',
  'word_retest_expected_access_denied',
  '교사 catalog에 연결된 assistant도 teacher 분기로 승격되지 않는다'
)
from expected_at_fixtures fixture
where fixture.fixture_key = 'assistant_linked_review';

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000004',
  true
);

select throws_ok(
  format(
    'update public.ops_word_retests set expected_retest_at = %L::timestamptz where task_id = %L::uuid',
    '2026-07-27T05:30:00.000Z',
    fixture.task_id
  ),
  '42501',
  'word_retest_expected_only_required',
  '연결 teacher도 전용 RPC를 우회해 응시예정일시를 직접 수정할 수 없다'
)
from expected_at_fixtures fixture
where fixture.fixture_key = 'matrix_requested';

select lives_ok(
  format(
    'select public.update_word_retest_expected_at_v1(%L::uuid,%L::timestamptz,(select updated_at from public.ops_tasks where id = %L::uuid),pg_catalog.gen_random_uuid())',
    fixture.task_id,
    '2026-07-26T05:00:00.000Z',
    fixture.task_id
  ),
  '정확히 연결된 teacher는 열린 ' || fixture.status || ' 상태의 예정일시를 수정한다'
)
from expected_at_fixtures fixture
where fixture.fixture_group = 'matrix';

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000005","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000005',
  true
);

select throws_ok(
  format(
    'select public.update_word_retest_expected_at_v1(%L::uuid,%L::timestamptz,(select updated_at from public.ops_tasks where id = %L::uuid),pg_catalog.gen_random_uuid())',
    fixture.task_id,
    '2026-07-26T06:00:00.000Z',
    fixture.task_id
  ),
  '42501',
  'word_retest_expected_access_denied',
  '연결되지 않은 teacher는 예정일시를 수정할 수 없다'
)
from expected_at_fixtures fixture
where fixture.fixture_key = 'matrix_requested';

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000007","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000007',
  true
);

select throws_ok(
  format(
    'select public.update_word_retest_expected_at_v1(%L::uuid,%L::timestamptz,(select updated_at from public.ops_tasks where id = %L::uuid),pg_catalog.gen_random_uuid())',
    fixture.task_id,
    '2026-07-26T06:30:00.000Z',
    fixture.task_id
  ),
  '42501',
  'word_retest_expected_access_denied',
  '표시 이름만 같은 teacher는 예정일시를 수정할 수 없다'
)
from expected_at_fixtures fixture
where fixture.fixture_key = 'name_only_requested';

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000004',
  true
);

select throws_ok($$
  select public.update_ops_task_v2(
    (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested'),
    '{"task":{"memo":"우회 메모"}}'::jsonb,
    (
      select task.updated_at
      from public.ops_tasks task
      where task.id = (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested')
    ),
    '82000000-0000-4000-8000-000000000101'::uuid
  )
$$, '42501', 'word_retest_expected_only_required',
  '연결 teacher는 조교 단계에서 메모를 범용 수정할 수 없다');

select throws_ok($$
  select public.update_ops_task_v2(
    (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested'),
    '{"word_retest":{"test_at":"2026-07-25T01:00:00.000Z"}}'::jsonb,
    (
      select task.updated_at
      from public.ops_tasks task
      where task.id = (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested')
    ),
    '82000000-0000-4000-8000-000000000102'::uuid
  )
$$, '42501', 'word_retest_expected_only_required',
  '연결 teacher는 조교 단계에서 본시험일을 범용 수정할 수 없다');

select throws_ok($$
  select public.update_ops_task_v2(
    (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested'),
    '{"word_retest":{"expected_retest_at":"2026-07-28T01:00:00.000Z"}}'::jsonb,
    (
      select task.updated_at
      from public.ops_tasks task
      where task.id = (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested')
    ),
    '82000000-0000-4000-8000-000000000120'::uuid
  )
$$, '42501', 'word_retest_expected_only_required',
  '연결 teacher는 범용 producer로 예정일시 전용 RPC를 우회할 수 없다');

select throws_ok($$
  select public.update_ops_task_v2(
    (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested'),
    '{"task":{"assignee_id":"82000000-0000-4000-8000-000000000004"}}'::jsonb,
    (
      select task.updated_at
      from public.ops_tasks task
      where task.id = (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested')
    ),
    '82000000-0000-4000-8000-000000000103'::uuid
  )
$$, '42501', 'word_retest_expected_only_required',
  '연결 teacher는 조교 단계에서 담당자를 범용 수정할 수 없다');

select throws_ok($$
  select public.update_ops_task_v2(
    (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested'),
    '{"task":{"status":"confirmed"}}'::jsonb,
    (
      select task.updated_at
      from public.ops_tasks task
      where task.id = (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested')
    ),
    '82000000-0000-4000-8000-000000000104'::uuid
  )
$$, '42501', 'word_retest_expected_only_required',
  '연결 teacher는 조교 단계에서 상태를 범용 수정할 수 없다');

select throws_ok($$
  select public.update_ops_task_v2(
    (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested'),
    '{"word_retest":{"request_note":"다른 detail"}}'::jsonb,
    (
      select task.updated_at
      from public.ops_tasks task
      where task.id = (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested')
    ),
    '82000000-0000-4000-8000-000000000105'::uuid
  )
$$, '42501', 'word_retest_expected_only_required',
  '연결 teacher는 조교 단계에서 다른 detail을 범용 수정할 수 없다');

select throws_ok($$
  select public.delete_ops_task_v1(
    (select task_id from expected_at_fixtures where fixture_key = 'matrix_requested'),
    '82000000-0000-4000-8000-000000000106'::uuid
  )
$$, '42501', 'word_retest_expected_only_required',
  '연결 teacher는 조교 단계의 단어 재시험을 삭제할 수 없다');

select lives_ok($$
  select public.update_ops_task_v2(
    (select task_id from expected_at_fixtures where fixture_key = 'matrix_review_requested'),
    '{"word_retest":{"expected_retest_at":"2026-07-29T01:30:00.000Z","request_note":"담당 교사 전체 저장"}}'::jsonb,
    (
      select task.updated_at
      from public.ops_tasks task
      where task.id = (select task_id from expected_at_fixtures where fixture_key = 'matrix_review_requested')
    ),
    '82000000-0000-4000-8000-000000000125'::uuid
  )
$$, '검토 요청 상태의 연결 teacher는 예정일시와 다른 detail을 전체 저장할 수 있다');
select is(
  (
    select detail.expected_retest_at
    from public.ops_word_retests detail
    where detail.task_id = (
      select task_id from expected_at_fixtures where fixture_key = 'matrix_review_requested'
    )
  ),
  '2026-07-29T01:30:00.000Z'::timestamptz,
  '검토 요청 상태의 연결 teacher 전체 저장은 예정일시를 보존한다'
);
select is(
  (
    select detail.request_note
    from public.ops_word_retests detail
    where detail.task_id = (
      select task_id from expected_at_fixtures where fixture_key = 'matrix_review_requested'
    )
  ),
  '담당 교사 전체 저장',
  '검토 요청 상태의 연결 teacher 전체 저장은 다른 detail도 보존한다'
);

select lives_ok($$
  select public.request_word_retest_revision_v1(
    (select task_id from expected_at_fixtures where fixture_key = 'matrix_review_requested'),
    '기존 teacher 검토 동작',
    '82000000-0000-4000-8000-000000000107'::uuid
  )
$$, '연결 teacher의 기존 review_requested 수정 요청 동작은 유지된다');

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000003',
  true
);

select lives_ok($$
  select public.report_word_retest_absent_v1(
    (select task_id from expected_at_fixtures where fixture_key = 'assistant_absence'),
    'manual',
    '82000000-0000-4000-8000-000000000108'::uuid
  )
$$, '실제 assistant의 기존 미응시 보고 동작은 유지된다');

reset role;

create temporary table expected_semantic_snapshot on commit drop as
select
  task.id as task_id,
  task.updated_at as original_updated_at,
  pg_catalog.to_jsonb(task) - 'updated_at' as parent_without_revision,
  pg_catalog.to_jsonb(detail) - 'expected_retest_at' - 'updated_at' as detail_without_expected
from public.ops_tasks task
join public.ops_word_retests detail on detail.task_id = task.id
where task.id = (select task_id from expected_at_fixtures where fixture_key = 'semantic');

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '82000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

create temporary table expected_semantic_responses (
  response_key text primary key,
  response jsonb not null
) on commit drop;

insert into expected_semantic_responses(response_key, response)
select 'first', public.update_word_retest_expected_at_v1(
  snapshot.task_id,
  '2026-07-27T10:30:00.000Z'::timestamptz,
  snapshot.original_updated_at,
  '82000000-0000-4000-8000-000000000111'::uuid
)
from expected_semantic_snapshot snapshot;

select is(
  (
    select detail.expected_retest_at
    from public.ops_word_retests detail
    where detail.task_id = (select task_id from expected_semantic_snapshot)
  ),
  '2026-07-27T10:30:00.000Z'::timestamptz,
  '첫 실제 변경은 child 예정일시를 저장한다'
);
select isnt(
  (
    select task.updated_at
    from public.ops_tasks task
    where task.id = (select task_id from expected_semantic_snapshot)
  ),
  (select original_updated_at from expected_semantic_snapshot),
  '첫 실제 변경은 parent revision을 올린다'
);
select is(
  (
    select pg_catalog.to_jsonb(task) - 'updated_at'
    from public.ops_tasks task
    where task.id = (select task_id from expected_semantic_snapshot)
  ),
  (select parent_without_revision from expected_semantic_snapshot),
  '예정일시 변경은 다른 parent 필드를 보존한다'
);
select is(
  (
    select pg_catalog.to_jsonb(detail) - 'expected_retest_at' - 'updated_at'
    from public.ops_word_retests detail
    where detail.task_id = (select task_id from expected_semantic_snapshot)
  ),
  (select detail_without_expected from expected_semantic_snapshot),
  '예정일시 변경은 다른 child 필드를 보존한다'
);

select is(
  public.update_word_retest_expected_at_v1(
    (select task_id from expected_semantic_snapshot),
    '2026-07-27T10:30:00.000Z'::timestamptz,
    (select original_updated_at from expected_semantic_snapshot),
    '82000000-0000-4000-8000-000000000111'::uuid
  ),
  (select response from expected_semantic_responses where response_key = 'first'),
  '같은 request ID와 지문은 최초 응답을 replay한다'
);

select throws_ok($$
  select public.update_word_retest_expected_at_v1(
    (select task_id from expected_semantic_snapshot),
    '2026-07-27T11:00:00.000Z'::timestamptz,
    (select original_updated_at from expected_semantic_snapshot),
    '82000000-0000-4000-8000-000000000111'::uuid
  )
$$, '22023', 'idempotency_key_reused',
  '같은 request ID의 다른 예정값은 거부한다');

create temporary table expected_noop_before on commit drop as
select task.updated_at
from public.ops_tasks task
where task.id = (select task_id from expected_semantic_snapshot);

insert into expected_semantic_responses(response_key, response)
select 'noop', public.update_word_retest_expected_at_v1(
  (select task_id from expected_semantic_snapshot),
  '2026-07-27T10:30:00.000Z'::timestamptz,
  (select updated_at from expected_noop_before),
  '82000000-0000-4000-8000-000000000112'::uuid
);

select is(
  (
    select task.updated_at
    from public.ops_tasks task
    where task.id = (select task_id from expected_semantic_snapshot)
  ),
  (select updated_at from expected_noop_before),
  '동일값 no-op은 parent revision을 유지한다'
);
select is(
  (select response ->> 'updatedAt' from expected_semantic_responses where response_key = 'noop')::timestamptz,
  (select updated_at from expected_noop_before),
  '동일값 no-op 응답도 유지된 revision을 반환한다'
);

select throws_ok($$
  select public.update_word_retest_expected_at_v1(
    (select task_id from expected_semantic_snapshot),
    '2026-07-27T12:00:00.000Z'::timestamptz,
    (select original_updated_at from expected_semantic_snapshot),
    '82000000-0000-4000-8000-000000000113'::uuid
  )
$$, '40001', 'word_retest_expected_stale_write',
  '다른 request ID도 오래된 revision이면 stale_write다');

insert into expected_semantic_responses(response_key, response)
select 'clear', public.update_word_retest_expected_at_v1(
  (select task_id from expected_semantic_snapshot),
  null,
  (
    select task.updated_at
    from public.ops_tasks task
    where task.id = (select task_id from expected_semantic_snapshot)
  ),
  '82000000-0000-4000-8000-000000000114'::uuid
);

select is(
  (select response -> 'expectedRetestAt' from expected_semantic_responses where response_key = 'clear'),
  'null'::jsonb,
  '예정일시 clear 응답은 JSON null이다'
);

select is(
  (
    select count(*)
    from public.ops_task_events event
    where event.request_id in (
      '82000000-0000-4000-8000-000000000111'::uuid,
      '82000000-0000-4000-8000-000000000112'::uuid,
      '82000000-0000-4000-8000-000000000113'::uuid,
      '82000000-0000-4000-8000-000000000114'::uuid
    )
  ),
  0::bigint,
  '예정일시 전용 request는 notification source를 만들지 않는다'
);

reset role;
select is(
  (
    select count(*)
    from dashboard_private.notification_events canonical
    where canonical.source_type = 'ops_task_event'
      and canonical.source_id in (
        select event.id::text
        from public.ops_task_events event
        where event.request_id in (
          '82000000-0000-4000-8000-000000000111'::uuid,
          '82000000-0000-4000-8000-000000000112'::uuid,
          '82000000-0000-4000-8000-000000000113'::uuid,
          '82000000-0000-4000-8000-000000000114'::uuid
        )
      )
  ),
  0::bigint,
  '예정일시 전용 request는 canonical event를 만들지 않는다'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_event_fanout_jobs job
    join dashboard_private.notification_events canonical on canonical.id = job.event_id
    where canonical.source_id in (
      select event.id::text
      from public.ops_task_events event
      where event.request_id in (
        '82000000-0000-4000-8000-000000000111'::uuid,
        '82000000-0000-4000-8000-000000000112'::uuid,
        '82000000-0000-4000-8000-000000000113'::uuid,
        '82000000-0000-4000-8000-000000000114'::uuid
      )
    )
  ),
  0::bigint,
  '예정일시 전용 request는 fanout job을 만들지 않는다'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events canonical on canonical.id = delivery.event_id
    where canonical.source_id in (
      select event.id::text
      from public.ops_task_events event
      where event.request_id in (
        '82000000-0000-4000-8000-000000000111'::uuid,
        '82000000-0000-4000-8000-000000000112'::uuid,
        '82000000-0000-4000-8000-000000000113'::uuid,
        '82000000-0000-4000-8000-000000000114'::uuid
      )
    )
  ),
  0::bigint,
  '예정일시 전용 request는 delivery를 만들지 않는다'
);

set local role authenticated;

create temporary table expected_producer_results (
  result_key text primary key,
  response jsonb not null
) on commit drop;

insert into expected_producer_results(result_key, response)
select 'create', public.create_ops_task_v2(
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest',
      'title', 'expected-at producer preserve',
      'status', 'requested',
      'student_name', 'Expected At 학생',
      'class_name', 'Expected At 수업'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관',
      'teacher_catalog_id', '82000000-0000-4000-8000-000000000011',
      'teacher_name', 'Expected At 연결 교사',
      'class_name', 'Expected At 수업',
      'student_name', 'Expected At 학생',
      'test_at', '2026-07-24T01:00:00.000Z',
      'expected_retest_at', '2026-07-28T10:00:00.000Z',
      'total_question_count', 10,
      'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '82000000-0000-4000-8000-000000000121'::uuid
);

select is(
  (
    select detail.expected_retest_at
    from public.ops_word_retests detail
    where detail.task_id = (
      select (response -> 'task' ->> 'id')::uuid
      from expected_producer_results where result_key = 'create'
    )
  ),
  '2026-07-28T10:00:00.000Z'::timestamptz,
  '일반 create producer가 전달된 예정일시를 보존한다'
);

select lives_ok($$
  select public.update_ops_task_v2(
    (
      select (response -> 'task' ->> 'id')::uuid
      from expected_producer_results where result_key = 'create'
    ),
    '{"word_retest":{"expected_retest_at":"2026-07-28T11:00:00.000Z","request_note":"전체 모달 저장"}}'::jsonb,
    (
      select task.updated_at
      from public.ops_tasks task
      where task.id = (
        select (response -> 'task' ->> 'id')::uuid
        from expected_producer_results where result_key = 'create'
      )
    ),
    '82000000-0000-4000-8000-000000000122'::uuid
  )
$$, '일반 update producer가 전달된 예정일시를 보존한다');

select is(
  (
    select detail.expected_retest_at
    from public.ops_word_retests detail
    where detail.task_id = (
      select (response -> 'task' ->> 'id')::uuid
      from expected_producer_results where result_key = 'create'
    )
  ),
  '2026-07-28T11:00:00.000Z'::timestamptz,
  '일반 update producer의 예정일시가 저장된다'
);
select is(
  (
    select detail.request_note
    from public.ops_word_retests detail
    where detail.task_id = (
      select (response -> 'task' ->> 'id')::uuid
      from expected_producer_results where result_key = 'create'
    )
  ),
  '전체 모달 저장',
  '관리자 일반 update producer는 예정일시와 다른 detail을 함께 저장한다'
);

insert into expected_producer_results(result_key, response)
select 'retry', public.retry_word_retest_v1(
  (select task_id from expected_at_fixtures where fixture_key = 'retry_previous'),
  jsonb_build_object(
    'task', jsonb_build_object(
      'type', 'word_retest',
      'title', 'expected-at retry child',
      'status', 'requested',
      'student_name', 'Expected At 학생',
      'class_name', 'Expected At 수업'
    ),
    'word_retest', jsonb_build_object(
      'branch', '본관',
      'teacher_catalog_id', '82000000-0000-4000-8000-000000000011',
      'teacher_name', 'Expected At 연결 교사',
      'class_name', 'Expected At 수업',
      'student_name', 'Expected At 학생',
      'test_at', '2026-07-31T01:00:00.000Z',
      'expected_retest_at', '2026-08-01T10:00:00.000Z',
      'total_question_count', 10,
      'cutoff_question_count', 8,
      'retest_status', 'not_started'
    )
  ),
  '82000000-0000-4000-8000-000000000123'::uuid
);

select is(
  (
    select detail.expected_retest_at
    from public.ops_word_retests detail
    where detail.task_id = (
      select (response -> 'task' ->> 'id')::uuid
      from expected_producer_results where result_key = 'retry'
    )
  ),
  null::timestamptz,
  'raw retry payload에 이전 값이 있어도 새 재시험 예정일시는 null로 시작한다'
);

select lives_ok($$
  select public.update_word_retest_expected_at_v1(
    (
      select (response -> 'task' ->> 'id')::uuid
      from expected_producer_results where result_key = 'retry'
    ),
    '2026-08-01T11:00:00.000Z'::timestamptz,
    (
      select task.updated_at
      from public.ops_tasks task
      where task.id = (
        select (response -> 'task' ->> 'id')::uuid
        from expected_producer_results where result_key = 'retry'
      )
    ),
    '82000000-0000-4000-8000-000000000124'::uuid
  )
$$, 'retry link가 만들어진 뒤에는 예정일시를 다시 입력할 수 있다');

select is(
  (
    select detail.expected_retest_at
    from public.ops_word_retests detail
    where detail.task_id = (
      select (response -> 'task' ->> 'id')::uuid
      from expected_producer_results where result_key = 'retry'
    )
  ),
  '2026-08-01T11:00:00.000Z'::timestamptz,
  'retry child의 후속 예정일시 입력이 보존된다'
);

reset role;
select * from finish();
rollback;
