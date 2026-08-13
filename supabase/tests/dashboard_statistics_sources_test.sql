begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_function(
  'public',
  'get_dashboard_statistics_sources_v1',
  array['text', 'text', 'text', 'date', 'date'],
  'statistics aggregate RPC exists'
);
select volatility_is(
  'public',
  'get_dashboard_statistics_sources_v1',
  array['text', 'text', 'text', 'date', 'date'],
  'stable',
  'statistics aggregate RPC is stable'
);

select ok(
  not (
    select function_row.prosecdef
    from pg_catalog.pg_proc function_row
    where function_row.oid =
      'public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::pg_catalog.regprocedure
  ),
  'statistics aggregate RPC is security invoker'
);
select is(
  (
    select function_row.proconfig
    from pg_catalog.pg_proc function_row
    where function_row.oid =
      'public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::pg_catalog.regprocedure
  ),
  array['search_path=']::text[],
  'statistics aggregate RPC has an empty search_path'
);

with expected(function_signature) as (
  values
    ('public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::text),
    ('public.list_dashboard_statistics_student_roster_v1(text,text,text,text,text,text,uuid,integer)'::text),
    ('public.list_dashboard_statistics_class_group_v1(text,text,text,text,text,uuid,integer)'::text),
    ('public.list_dashboard_statistics_class_roster_v1(uuid,text,uuid,integer)'::text)
)
select ok(
  pg_catalog.has_function_privilege('authenticated', function_signature, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(function_row.proacl, pg_catalog.acldefault('f', function_row.proowner))
      ) acl
      where function_row.oid = function_signature::pg_catalog.regprocedure
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ),
  function_signature || ' is authenticated-only'
)
from expected;

select is(
  (
    select namespace_row.nspname || '.' || collation_row.collname
    from pg_catalog.pg_collation collation_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = collation_row.collnamespace
    where namespace_row.nspname = 'dashboard_private'
      and collation_row.collname = 'ko_numeric'
      and collation_row.collprovider = 'i'
      and collation_row.collisdeterministic
      and coalesce(
        pg_catalog.to_jsonb(collation_row) ->> 'colllocale',
        pg_catalog.to_jsonb(collation_row) ->> 'colliculocale',
        pg_catalog.to_jsonb(collation_row) ->> 'collcollate'
      ) = 'ko-u-kn-true'
  ),
  'dashboard_private.ko_numeric',
  'Korean numeric collation is deterministic and exact'
);

select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('', null, null, null, null)$$,
  '22023',
  'dashboard_statistics_request_invalid',
  'empty tab is rejected'
);
select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('unknown', null, null, null, null)$$,
  '22023',
  'dashboard_statistics_request_invalid',
  'unknown tab is rejected'
);
select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('schedule_conflicts', 'all', null, current_date, current_date + 90)$$,
  '22023',
  'dashboard_statistics_request_invalid',
  'academy-wide conflicts reject subject filters'
);
select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('overview', 'all', 'all', current_date, current_date + 90)$$,
  '22023',
  'dashboard_statistics_request_invalid',
  'snapshot tabs reject date filters'
);
select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('textbooks', 'all', null, current_date - 30, current_date)$$,
  '22023',
  'dashboard_statistics_date_range_invalid',
  'textbook range outside the exact preset is rejected'
);

-- Real parity fixtures: 31 roster students, duplicate JSON ids, inferred grades,
-- weekly overlaps, two exam rules, and one class hidden by an authenticated RLS policy.
insert into public.academic_schools(id, name, category)
values ('86200000-0000-4000-8000-000000000601', '통계검증고', '고등학교');

insert into public.students(
  id, name, uid, school, grade, contact, parent_contact, status,
  class_ids, waitlist_class_ids
)
select
  ('86200000-0000-4000-8000-' || pg_catalog.lpad(series_value::text, 12, '0'))::uuid,
  '통계 학생 ' || series_value,
  'statistics-fixture-' || series_value,
  '통계검증고',
  '고3',
  '0108' || pg_catalog.lpad(series_value::text, 7, '0'),
  '0109' || pg_catalog.lpad(series_value::text, 7, '0'),
  '재원',
  pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000301'),
  '[]'::jsonb
from pg_catalog.generate_series(1, 31) series_value;

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_plan
)
select
  '86200000-0000-4000-8000-000000000301', '통계검증 고3', '정규',
  '과학', '고3', '통계검증 선생님', '월수 10:00-11:00', '통계 1강',
  40, 100000, '수업 진행 중',
  (select pg_catalog.jsonb_agg(student.id::text order by student.id)
   from public.students student where student.uid like 'statistics-fixture-%'),
  pg_catalog.jsonb_build_array(
    '86200000-0000-4000-8000-000000000031',
    '86200000-0000-4000-8000-000000000031'
  ),
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb
union all
select
  '86200000-0000-4000-8000-000000000302', '통계 RLS 숨김', '정규',
  '과학', '고3', '통계검증 선생님', '화 10:00-11:00', '통계 2강',
  10, 100000, '수업 진행 중',
  pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000001'),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb
union all
select
  '86200000-0000-4000-8000-000000000303', '주간 충돌 A', '정규',
  '수학', '고3', '충돌 선생님', '월 09:00-11:00', '충돌강의실',
  10, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb
union all
select
  '86200000-0000-4000-8000-000000000304', '주간 충돌 B', '정규',
  '수학', '고3', '충돌 선생님', '월 10:00-12:00', '충돌강의실',
  10, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb
union all
select
  '86200000-0000-4000-8000-000000000305', '시험 충돌 영어', '정규',
  '영어', null, '시험 선생님', '화 18:00-20:00', '시험강의실',
  10, 100000, '수업 진행 중',
  pg_catalog.jsonb_build_array(
    '86200000-0000-4000-8000-000000000001',
    '86200000-0000-4000-8000-000000000002',
    '86200000-0000-4000-8000-000000000002'
  ),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  pg_catalog.jsonb_build_object('sessions', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'date', (current_date + 10)::text,
      'sessionNumber', 1,
      'scheduleState', 'active'
    )
  ));

insert into public.academic_events(id, title, date, type, grade, note, school_id)
values (
  '86200000-0000-4000-8000-000000000501', '통계검증 시험기간',
  current_date + 10, '시험기간', '고3', 'statistics pgTAP',
  '86200000-0000-4000-8000-000000000601'
);

insert into public.academic_event_exam_details(
  id, academic_event_id, school_id, grade, subject, exam_date, exam_date_status, sort_order
)
values
  (
    '86200000-0000-4000-8000-000000000511',
    '86200000-0000-4000-8000-000000000501',
    '86200000-0000-4000-8000-000000000601',
    '고3', '영어', current_date + 10, 'exact', 1
  ),
  (
    '86200000-0000-4000-8000-000000000512',
    '86200000-0000-4000-8000-000000000501',
    '86200000-0000-4000-8000-000000000601',
    '고3', '수학', current_date + 11, 'exact', 2
  );

select is(
  dashboard_private.dashboard_statistics_weekly_minutes_v1('월수 10:00-11:00'),
  120,
  'weekly minutes expands one time range across multiple schedule days'
);
select is(
  dashboard_private.dashboard_statistics_weekly_minutes_v1('10:00-11:00'),
  60,
  'weekly minutes preserves the legacy dayless range fallback'
);
select is(
  dashboard_private.dashboard_statistics_distinct_jsonb_count_v1('["a", "a", "b"]'::jsonb),
  2,
  'student and waitlist JSON ids are deduplicated before counts'
);
select is(
  dashboard_private.dashboard_statistics_textbook_active_v1('사용중'), true,
  'legacy 사용중 is active'
);
select is(
  dashboard_private.dashboard_statistics_textbook_active_v1('미사용'), false,
  'legacy 미사용 is inactive'
);
select is(
  dashboard_private.dashboard_statistics_inferred_grade_labels_v1('고3', '중2 반', array['고1']),
  array['고3']::text[],
  'direct grade wins over class-name and student grades'
);
select is(
  dashboard_private.dashboard_statistics_inferred_grade_labels_v1(null, '중2 반', array['고1']),
  array['중2']::text[],
  'class-name grade wins over student grades'
);
select is(
  dashboard_private.dashboard_statistics_inferred_grade_labels_v1(null, '이름 미정', array['고1']),
  array['고1']::text[],
  'student grade is the final inference source'
);

select unlike(
  pg_catalog.pg_get_functiondef(
    'public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::pg_catalog.regprocedure
  ),
  '%list_dashboard_statistics_student_roster_v1%',
  'aggregate does not execute drilldown RPCs'
);
select unlike(
  pg_catalog.pg_get_functiondef(
    'public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::pg_catalog.regprocedure
  ),
  '%list_dashboard_statistics_class_group_v1%',
  'aggregate does not execute class drilldown RPCs'
);

do $fixture_policy$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'classes'
      and cmd in ('SELECT', 'ALL')
  loop
    execute pg_catalog.format('drop policy %I on public.classes', policy_row.policyname);
  end loop;
end;
$fixture_policy$;

alter table public.classes enable row level security;
create policy dashboard_statistics_fixture_classes_select
on public.classes for select to authenticated
using (id <> '86200000-0000-4000-8000-000000000302'::uuid);

set local role authenticated;

select is(
  pg_catalog.jsonb_array_length(
    public.list_dashboard_statistics_student_roster_v1(
      'science', 'high', 'grade', '고3', null, null, null, 30
    ) -> 'rows'
  ),
  30,
  '31 rows read and 30 returned'
);
select is(
  (
    public.list_dashboard_statistics_student_roster_v1(
      'science', 'high', 'grade', '고3', null, null, null, 30
    ) ->> 'hasMore'
  )::boolean,
  true,
  '31-row fixture reports hasMore'
);
select is(
  public.list_dashboard_statistics_student_roster_v1(
    'science', 'high', 'grade', '고3', null, null, null, 30
  ) #>> '{nextCursor,sortValue}',
  '통계 학생 30',
  'normalized-name cursor parity ends the first page at student 30'
);
with first_page as (
  select public.list_dashboard_statistics_student_roster_v1(
    'science', 'high', 'grade', '고3', null, null, null, 30
  ) as payload
), second_page as (
  select public.list_dashboard_statistics_student_roster_v1(
    'science', 'high', 'grade', '고3',
    first_page.payload #>> '{nextCursor,sortValue}',
    (first_page.payload #>> '{nextCursor,id}')::uuid,
    30
  ) as payload
  from first_page
)
select is(
  pg_catalog.jsonb_array_length(second_page.payload -> 'rows'),
  1,
  'cursor reads the remaining 31st row exactly once'
)
from second_page;

select is(
  pg_catalog.jsonb_array_length(
    public.list_dashboard_statistics_class_group_v1(
      'science', 'high', 'teacher', '통계검증 선생님', null, null, 30
    ) -> 'rows'
  ),
  1,
  'RLS-hidden statistics rows are excluded by the security-invoker class drilldown'
);

select ok(
  (
    select pg_catalog.octet_length(
      public.get_dashboard_statistics_sources_v1('overview', 'all', 'all', null, null)::text
    )
  ) <= 204800,
  'overview fixture payload stays under 200 KiB'
);
select ok(
  (
    select pg_catalog.octet_length(
      public.get_dashboard_statistics_sources_v1('students_classes', 'all', 'all', null, null)::text
    )
  ) <= 204800,
  'students/classes fixture payload stays under 200 KiB'
);
select ok(
  (
    select pg_catalog.octet_length(
      public.get_dashboard_statistics_sources_v1(
        'schedule_conflicts', null, null, current_date, current_date + 400
      )::text
    )
  ) <= 204800,
  '400-day academy-wide conflict parity payload stays under 200 KiB'
);
select ok(
  (
    select pg_catalog.octet_length(
      public.get_dashboard_statistics_sources_v1(
        'textbooks', 'all', null, current_date - 89, current_date
      )::text
    )
  ) <= 204800,
  'textbooks fixture payload stays under 200 KiB'
);

select ok(
  not (
    public.get_dashboard_statistics_sources_v1(
      'students_classes', 'all', 'all', null, null
    )::text ~ 'studentRoster|classSummaries|parent_contact|contact'
  ),
  'aggregate excludes rosters, class summaries, and contact fields'
);

select ok(
  public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) ?& array['range', 'teacherConflicts', 'classroomConflicts', 'examConflicts'],
  '400-day academy-wide conflict parity exposes the exact conflict branches'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select is(
  (
    select pg_catalog.count(*)
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'teacherConflicts') conflict(value)
    where conflict.value -> 'classIds' ? '86200000-0000-4000-8000-000000000303'
      and conflict.value -> 'classIds' ? '86200000-0000-4000-8000-000000000304'
      and conflict.value #>> '{source,overlapStart}' = '10:00'
      and conflict.value #>> '{source,overlapEnd}' = '11:00'
  ),
  1::bigint,
  '400-day academy-wide conflict parity returns the exact teacher overlap once'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select is(
  (
    select pg_catalog.count(*)
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'classroomConflicts') conflict(value)
    where conflict.value -> 'classIds' ? '86200000-0000-4000-8000-000000000303'
      and conflict.value -> 'classIds' ? '86200000-0000-4000-8000-000000000304'
  ),
  1::bigint,
  '400-day academy-wide conflict parity returns the exact classroom overlap once'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select is(
  (
    select pg_catalog.count(*)
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'examConflicts') conflict(value)
    where conflict.value #>> '{source,examRule}' in ('same-day-subject', 'day-before-other-subject')
      and conflict.value -> 'classIds' ? '86200000-0000-4000-8000-000000000305'
      and pg_catalog.jsonb_array_length(conflict.value -> 'affectedStudentIds') = 2
  ),
  2::bigint,
  '400-day exact parity returns both exam rules and merges affected students by stable key'
);

select * from finish();
rollback;
