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
select ok(
  (
    select function_row.proconfig in (array['search_path=']::text[], array['search_path=""']::text[])
    from pg_catalog.pg_proc function_row
    where function_row.oid =
      'public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::pg_catalog.regprocedure
  ),
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
      ) in ('ko-u-kn', 'ko-u-kn-true')
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
values
  ('86200000-0000-4000-8000-000000000601', '통계검증고', 'high'),
  ('86200000-0000-4000-8000-000000000602', '통계검증중', 'middle');

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

insert into public.students(
  id, name, uid, school, grade, contact, parent_contact, status,
  class_ids, waitlist_class_ids
)
values
  (
    '86200000-0000-4000-8000-000000000041', '추론 고등학생',
    'statistics-inferred-high', '통계검증고', '고1', '01080000041', '01090000041', '재원',
    pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000306'), '[]'::jsonb
  ),
  (
    '86200000-0000-4000-8000-000000000042', '추론 중학생',
    'statistics-inferred-middle', '통계검증중', '중3', '01080000042', '01090000042', '재원',
    pg_catalog.jsonb_build_array(
      '86200000-0000-4000-8000-000000000306',
      '86200000-0000-4000-8000-000000000307'
    ),
    '[]'::jsonb
  ),
  (
    '86200000-0000-4000-8000-000000000043', '다른 학년 학생',
    'statistics-other-grade', '통계검증고', '고2', '01080000043', '01090000043', '재원',
    pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000305'), '[]'::jsonb
  ),
  (
    '86200000-0000-4000-8000-000000000044', '학년 미정 학생',
    'statistics-missing-grade', '통계검증고', '', '01080000044', '01090000044', '재원',
    pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000305'), '[]'::jsonb
  );

insert into public.academic_subject_settings(subject,is_active,registration_create_enabled,grade_levels,sort_order)
values ('과학',true,true,array['고1','고2','고3'],30)
on conflict (subject) do update set is_active=true;
insert into public.academic_subject_areas(subject,area_key,label,sort_order,is_active)
values ('과학','physics','물리학',20,true)
on conflict (subject,area_key) do update set is_active=true,label=excluded.label,sort_order=excluded.sort_order;

-- Production can contain legacy science rows created before the taxonomy check
-- was added NOT VALID; drop it only inside this rolled-back fixture to preserve
-- that parity case without weakening the candidate migration.
alter table public.classes drop constraint classes_science_taxonomy_check;

insert into public.classes(
  id, name, class_type, subject, subject_area_key, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_plan
)
select
  '86200000-0000-4000-8000-000000000301'::uuid, '통계검증 고3', '정규',
  '과학', 'physics', '고3', '통계검증 선생님', '월수 10:00-11:00', '통계 1강',
  40, 100000, '수업 진행 중',
  (select pg_catalog.jsonb_agg(student.id::text order by student.id)
   from public.students student where student.uid like 'statistics-fixture-%')
    || pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000001'),
  pg_catalog.jsonb_build_array(
    '86200000-0000-4000-8000-000000000031',
    '86200000-0000-4000-8000-000000000031'
  ),
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb
union all
select
  '86200000-0000-4000-8000-000000000302', '통계 RLS 숨김', '정규',
  '과학', 'physics', '고3', '통계검증 선생님', '화 10:00-11:00', '통계 2강',
  10, 100000, '수업 진행 중',
  pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000001'),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb
union all
select
  '86200000-0000-4000-8000-000000000303', '주간 충돌 A', '정규',
  '수학', null, '고3', '충돌 선생님', '월 09:00-11:00', '충돌강의실',
  10, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb
union all
select
  '86200000-0000-4000-8000-000000000304', '주간 충돌 B', '정규',
  '수학', null, '고3', '충돌 선생님', '월 10:00-12:00', '충돌강의실',
  10, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb
union all
select
  '86200000-0000-4000-8000-000000000305', '시험 충돌 영어', '정규',
  '영어', null, null, '시험 선생님', '화 18:00-20:00', '시험강의실',
  10, 100000, '수업 진행 중',
  pg_catalog.jsonb_build_array(
    '86200000-0000-4000-8000-000000000001',
    '86200000-0000-4000-8000-000000000002',
    '86200000-0000-4000-8000-000000000002',
    '86200000-0000-4000-8000-000000000043',
    '86200000-0000-4000-8000-000000000044'
  ),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  pg_catalog.jsonb_build_object('sessions', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'date', (current_date + 10)::text,
      'sessionNumber', 1,
      'scheduleState', 'active'
    ),
    pg_catalog.jsonb_build_object(
      'date', (current_date + 30)::text,
      'sessionNumber', 2,
      'scheduleState', 'active'
    ),
    pg_catalog.jsonb_build_object(
      'date', (current_date + 39)::text,
      'sessionNumber', 3,
      'scheduleState', 'active'
    )
  ))
union all
select
  '86200000-0000-4000-8000-000000000306', '통계 추론 중2', '정규',
  '과학', 'physics', null, '추론 선생님', '목 17:00-18:00', '통계 3강',
  10, 100000, '수업 진행 중',
  pg_catalog.jsonb_build_array(
    '86200000-0000-4000-8000-000000000041',
    '86200000-0000-4000-8000-000000000042'
  ),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb
union all
select
  '86200000-0000-4000-8000-000000000307', '직접 학사 과학', '정규',
  '과학', 'physics', '중3', '학사 선생님', '금 17:00-18:00', '통계 4강',
  10, 100000, '수업 진행 중',
  pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000042'),
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  pg_catalog.jsonb_build_object('sessions', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'date', (current_date + 20)::text,
      'sessionNumber', 1,
      'scheduleState', 'active'
    )
  ));

insert into public.academic_events(id, title, date, type, grade, note, school_id)
values
  (
    '86200000-0000-4000-8000-000000000501', '통계검증 시험기간',
    current_date + 10, '시험기간', '고3', 'statistics pgTAP',
    '86200000-0000-4000-8000-000000000601'
  ),
  (
    '86200000-0000-4000-8000-000000000502', '통계검증 과학 시험일',
    current_date + 20, '과학시험일', '중2, 중3', 'subject event parity',
    '86200000-0000-4000-8000-000000000602'
  ),
  (
    '86200000-0000-4000-8000-000000000503', '통계검증 비시험 상세',
    current_date + 40, '체험학습', '고3', 'detail rows do not type-filter',
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
    null, '영어', current_date + 10, 'exact', 1
  ),
  (
    '86200000-0000-4000-8000-000000000512',
    '86200000-0000-4000-8000-000000000501',
    '86200000-0000-4000-8000-000000000601',
    '고2, 고3', '수학', current_date + 11, 'exact', 2
  ),
  (
    '86200000-0000-4000-8000-000000000513',
    '86200000-0000-4000-8000-000000000503',
    '86200000-0000-4000-8000-000000000601',
    '고3', '영어', current_date + 40, 'exact', 3
  );

insert into public.academic_exam_days(
  id, school_id, grade, subject, exam_date, label, note, sort_order
)
values
  (
    '86200000-0000-4000-8000-000000000521',
    '86200000-0000-4000-8000-000000000601', '고2, 고3', '수학',
    current_date + 31, 'legacy 수학 시험', 'fallback parity', 1
  ),
  (
    '86200000-0000-4000-8000-000000000522',
    '86200000-0000-4000-8000-000000000601', '고3', '수학',
    current_date + 40, 'legacy suppressed by modern detail date', 'fallback date precedence', 2
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
  array['고1', '중2']::text[],
  'name and enrolled grades are combined when direct grade is absent'
);
select is(
  dashboard_private.dashboard_statistics_inferred_grade_labels_v1(null, '이름 미정', array['고1']),
  array['고1']::text[],
  'student grade is the final inference source'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::pg_catalog.regprocedure),
    'list_dashboard_statistics_student_roster_v1'
  ) = 0,
  'aggregate does not execute drilldown RPCs'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::pg_catalog.regprocedure),
    'list_dashboard_statistics_class_group_v1'
  ) = 0,
  'aggregate does not execute class drilldown RPCs'
);

set constraints all immediate;

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
    null,
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

select is(
  (
    select pg_catalog.jsonb_array_length(class.student_ids)
      - pg_catalog.count(distinct enrolled.student_id)
    from public.classes class
    cross join lateral pg_catalog.jsonb_array_elements_text(class.student_ids) enrolled(student_id)
    where class.id = '86200000-0000-4000-8000-000000000301'
    group by class.student_ids
  ),
  1::bigint,
  'registered duplicate id is present in class 301 source'
);

select is(
  public.get_dashboard_statistics_sources_v1(
    'students_classes', 'science', 'high', null, null
  ) #>> '{summary,registeredEnrollmentCount}',
  '33',
  'registered aggregate count deduplicates class 301 source'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'students_classes', 'science', 'high', null, null
  ) as value
)
select is(
  (
    select group_row.value ->> 'enrollmentCount'
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(
      payload.value #> '{classGroups,byTeacher}'
    ) group_row(value)
    where group_row.value ->> 'key' = '통계검증 선생님'
  ),
  '31',
  'class group count matches deduplicated class 301 source'
);

with first_page as (
  select public.list_dashboard_statistics_class_roster_v1(
    '86200000-0000-4000-8000-000000000301', null, null, 30
  ) as payload
), second_page as (
  select public.list_dashboard_statistics_class_roster_v1(
    '86200000-0000-4000-8000-000000000301',
    first_page.payload #>> '{nextCursor,sortValue}',
    (first_page.payload #>> '{nextCursor,id}')::uuid,
    30
  ) as payload
  from first_page
), roster_ids as (
  select row_value ->> 'id' as student_id
  from first_page
  cross join lateral pg_catalog.jsonb_array_elements(first_page.payload -> 'rows') row_value
  union all
  select row_value ->> 'id'
  from second_page
  cross join lateral pg_catalog.jsonb_array_elements(second_page.payload -> 'rows') row_value
)
select ok(
  (select pg_catalog.count(*) = 31 and pg_catalog.count(distinct student_id) = 31 from roster_ids),
  'class roster drilldown deduplicates class 301 source'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'students_classes', 'science', 'all', null, null
  ) as value
), aggregate_grade as (
  select group_row.value
  from payload
  cross join lateral pg_catalog.jsonb_array_elements(
    payload.value #> '{classGroups,byGrade}'
  ) group_row(value)
  where group_row.value ->> 'key' = '중2'
), drilldown as (
  select public.list_dashboard_statistics_class_group_v1(
    'science', 'all', 'grade', '중2', null, null, 30
  ) as value
)
select ok(
  (select value ->> 'classCount' = '1' from aggregate_grade)
    and (select pg_catalog.jsonb_array_length(value -> 'rows') = 1 from drilldown)
    and (select value #>> '{rows,0,id}' = '86200000-0000-4000-8000-000000000306' from drilldown),
  'inferred grade aggregate and drilldown stay in parity'
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
  ),
  3::bigint,
  '400-day exact parity preserves stable conflict grouping and merges affected students by key'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select ok(
  exists (
    select 1
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'examConflicts') conflict(value)
    where conflict.value ->> 'key' = 'exam:v1:86200000-0000-4000-8000-000000000305:'
        || (current_date + 10)::text || ':same-day-subject'
      and conflict.value #> '{source,examDetailIds}'
        = pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000511')
      and conflict.value -> 'affectedStudentIds' ? '86200000-0000-4000-8000-000000000001'
  ),
  'null detail inherits its parent academic event grade'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select ok(
  exists (
    select 1
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'examConflicts') conflict(value)
    where conflict.value ->> 'key' = 'exam:v1:86200000-0000-4000-8000-000000000305:'
        || (current_date + 11)::text || ':day-before-other-subject'
      and conflict.value -> 'affectedStudentIds' ?& array[
        '86200000-0000-4000-8000-000000000001',
        '86200000-0000-4000-8000-000000000002',
        '86200000-0000-4000-8000-000000000043',
        '86200000-0000-4000-8000-000000000044'
      ]
  ),
  'comma-separated detail grades match every listed grade'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select ok(
  exists (
    select 1
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'examConflicts') conflict(value)
    where conflict.value ->> 'key' = 'exam:v1:86200000-0000-4000-8000-000000000305:'
        || (current_date + 10)::text || ':same-day-subject'
      and conflict.value -> 'affectedStudentIds' ? '86200000-0000-4000-8000-000000000044'
  ),
  'student without a grade matches an inherited parent grade'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select ok(
  not exists (
    select 1
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'examConflicts') conflict(value)
    where conflict.value ->> 'key' = 'exam:v1:86200000-0000-4000-8000-000000000305:'
        || (current_date + 10)::text || ':same-day-subject'
      and conflict.value -> 'affectedStudentIds' ? '86200000-0000-4000-8000-000000000043'
  ),
  'parent high-school grade excludes a different student grade'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select ok(
  exists (
    select 1
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'examConflicts') conflict(value)
    where conflict.value ->> 'key' = 'exam:v1:86200000-0000-4000-8000-000000000307:'
        || (current_date + 20)::text || ':same-day-subject'
      and conflict.value #> '{source,examEventIds}'
        = pg_catalog.jsonb_build_array('86200000-0000-4000-8000-000000000502')
      and conflict.value #> '{source,examDetailIds}' = '[]'::jsonb
  ),
  'comma-separated subject event grades use the shared matcher'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select ok(
  exists (
    select 1
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'examConflicts') conflict(value)
    where conflict.value ->> 'key' = 'exam:v1:86200000-0000-4000-8000-000000000305:'
        || (current_date + 31)::text || ':day-before-other-subject'
      and conflict.value #> '{source,examEventIds}' = '[]'::jsonb
      and conflict.value #> '{source,examDetailIds}' = '[]'::jsonb
      and conflict.value -> 'affectedStudentIds' ? '86200000-0000-4000-8000-000000000043'
  ),
  'comma-separated fallback grades use the shared matcher'
);

with payload as (
  select public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) as value
)
select ok(
  not exists (
    select 1
    from payload
    cross join lateral pg_catalog.jsonb_array_elements(payload.value -> 'examConflicts') conflict(value)
    where conflict.value ->> 'key' = 'exam:v1:86200000-0000-4000-8000-000000000305:'
        || (current_date + 40)::text || ':day-before-other-subject'
  ),
  'non-exam parent event detail keeps legacy no-type-filter date precedence'
);

select * from finish();
rollback;
