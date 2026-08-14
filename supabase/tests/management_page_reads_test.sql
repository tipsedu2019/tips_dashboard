begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_function('public','list_management_page_v1',array['text','jsonb','text','uuid','integer'],'management page RPC exists');
select has_function('public','get_management_stats_v1',array['text','jsonb'],'management stats RPC exists');
select has_function('public','list_management_filter_options_v1',array['text','jsonb'],'management filter option RPC exists');
select has_function('public','get_management_detail_v1',array['text','uuid'],'management detail RPC exists');
select has_function('public','list_management_detail_relation_page_v1',array['text','uuid','text','text','uuid','integer'],'management relation page RPC exists');

with expected(signature) as (
  values
    ('public.list_management_page_v1(text,jsonb,text,uuid,integer)'::text),
    ('public.get_management_stats_v1(text,jsonb)'::text),
    ('public.list_management_filter_options_v1(text,jsonb)'::text),
    ('public.get_management_detail_v1(text,uuid)'::text),
    ('public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)'::text)
)
select ok(
  not (select proc.prosecdef from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
  and (select proc.proconfig = array['search_path=']::text[] from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
  and pg_catalog.has_function_privilege('authenticated',signature,'EXECUTE')
  and not pg_catalog.has_function_privilege('anon',signature,'EXECUTE')
  and not pg_catalog.has_function_privilege('public',signature,'EXECUTE'),
  signature || ' is fixed-search-path security-invoker and authenticated-only'
) from expected;

select throws_ok(
  $$select public.list_management_page_v1('students','{}'::jsonb,null,null,30)$$,
  '22023','management_filters_invalid','missing filter keys are rejected'
);
select throws_ok(
  $$select public.list_management_page_v1('students',jsonb_build_object(
    'kind','students','search','','status',null,'schoolCategory',null,'school',null,'grade',null,'unknown',true
  ),null,null,30)$$,
  '22023','management_filters_invalid','unknown filter keys are rejected'
);
select throws_ok(
  $$select public.list_management_page_v1('classes',jsonb_build_object(
    'kind','students','search','','status',null,'schoolCategory',null,'school',null,'grade',null
  ),null,null,30)$$,
  '22023','management_filters_invalid','cross-kind filters are rejected'
);
select throws_ok(
  $$select public.list_management_page_v1('students',jsonb_build_object(
    'kind','students','search','','status',null,'schoolCategory',null,'school',null,'grade',null
  ),null,null,31)$$,
  '22023','management_page_limit_invalid','list page is capped at 30'
);
select throws_ok(
  $$select public.list_management_page_v1('students',jsonb_build_object(
    'kind','students','search','','status',null,'schoolCategory',null,'school',null,'grade',null
  ),'관리 학생 1',null,30)$$,
  '22023','management_cursor_invalid','partial cursor is rejected'
);
select throws_ok(
  $$select public.list_management_detail_relation_page_v1('students','91000000-0000-4000-8000-000000000001','registered_students')$$,
  '22023','management_relation_invalid','cross-kind relation is rejected'
);

insert into public.students(
  id,name,uid,school,grade,contact,parent_contact,status,class_ids,waitlist_class_ids
)
select
  ('91000000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__management_page_fixture__ 수학 ' || ordinal,
  'management-page-' || ordinal,
  case when ordinal = 32 then '경계중' else '관리중' end,
  case when ordinal = 32 then '중3' else '중2' end,
  '0107' || pg_catalog.lpad(ordinal::text,7,'0'),
  '0108' || pg_catalog.lpad(ordinal::text,7,'0'),
  case when ordinal = 31 then '퇴원' else '재원' end,
  '[]'::jsonb,
  '[]'::jsonb
from pg_catalog.generate_series(1,32) ordinal;

create temporary table management_first_page on commit drop as
select * from public.list_management_page_v1(
  'students',
  jsonb_build_object('kind','students','search','__management_page_fixture__','status',null,'schoolCategory',null,'school',null,'grade',null),
  null,null,30
);

select is((select pg_catalog.count(*)::integer from management_first_page),31,'server reads 30 plus one boundary row');
select is(
  (select (pg_catalog.array_agg(sort_key order by sort_key collate dashboard_private.ko_numeric,id))[1:2] from management_first_page),
  array['__management_page_fixture__ 수학 1','__management_page_fixture__ 수학 2'],
  'Korean numeric collation sorts 2 before 10'
);

with boundary as (
  select sort_key,id from management_first_page order by sort_key collate dashboard_private.ko_numeric,id offset 29 limit 1
), second_page as (
  select page.* from boundary cross join lateral public.list_management_page_v1(
    'students',
    jsonb_build_object('kind','students','search','__management_page_fixture__','status',null,'schoolCategory',null,'school',null,'grade',null),
    boundary.sort_key,boundary.id,30
  ) page
)
select is((select pg_catalog.count(*)::integer from second_page),2,'31st and 32nd rows remain after the client boundary cursor');

select is(
  (public.get_management_stats_v1(
    'students',jsonb_build_object('kind','students','search','__management_page_fixture__','status',null,'schoolCategory',null,'school',null,'grade',null)
  ) ->> 'total')::integer,
  32,
  'stats uses the same full filtered set rather than first-page length'
);
select is(
  (public.get_management_stats_v1(
    'students',jsonb_build_object('kind','students','search','__management_page_fixture__','status','퇴원','schoolCategory',null,'school',null,'grade',null)
  ) ->> 'total')::integer,
  1,
  'student status filter is applied by the aggregate'
);
select ok(
  (public.list_management_filter_options_v1(
    'students',jsonb_build_object('kind','students','search','__management_page_fixture__','status',null,'schoolCategory',null,'school',null,'grade',null)
  ) -> 'school') ? '경계중',
  'filter options are built from the full filtered collection beyond row 30'
);
select ok(
  pg_catalog.jsonb_array_length(public.list_management_filter_options_v1(
    'students',jsonb_build_object('kind','students','search','__management_page_fixture__','status',null,'schoolCategory',null,'school',null,'grade',null)
  ) -> 'school') <= 500,
  'each filter option collection is hard-capped at 500'
);

select is(
  public.get_management_detail_v1('students','91000000-0000-4000-8000-000000000032') #>> '{record,name}',
  '__management_page_fixture__ 수학 32',
  'detail reads the exact selected record even when it is outside page one'
);
select ok(
  pg_catalog.jsonb_typeof(public.get_management_detail_v1('students','91000000-0000-4000-8000-000000000032') -> 'enrollments') = 'object'
  and pg_catalog.jsonb_typeof(public.get_management_detail_v1('students','91000000-0000-4000-8000-000000000032') -> 'lifecycleHistory') = 'object'
  and pg_catalog.jsonb_typeof(public.get_management_detail_v1('students','91000000-0000-4000-8000-000000000032') -> 'classPicker') = 'object',
  'student detail returns only its three paged relation branches'
);

select finish();
rollback;
