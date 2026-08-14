begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

create function pg_temp.dashboard_explain_v1(p_sql text)
returns jsonb language plpgsql as $probe$
declare v_plan jsonb;
begin
  execute 'explain (analyze, buffers, format json) ' || p_sql into v_plan;
  return v_plan;
end
$probe$;

select has_function('public','list_management_page_v1',array['text','jsonb','text','uuid','integer'],'management page RPC exists');
select has_function('public','get_management_default_class_period_v1',array[]::text[],'management default class period RPC exists');
select has_function('public','get_management_stats_v1',array['text','jsonb'],'management stats RPC exists');
select has_function('public','list_management_filter_options_v1',array['text','jsonb'],'management filter option RPC exists');
select has_function('public','get_management_detail_v1',array['text','uuid'],'management detail RPC exists');
select has_function('public','list_management_detail_relation_page_v1',array['text','uuid','text','text','uuid','integer'],'management relation page RPC exists');
select has_function('public','list_management_class_textbook_candidates_v1',array['uuid','text','jsonb','text','uuid','integer'],'management class textbook candidate RPC exists');

with expected(signature) as (
  values
    ('public.list_management_page_v1(text,jsonb,text,uuid,integer)'::text),
    ('public.get_management_default_class_period_v1()'::text),
    ('public.get_management_stats_v1(text,jsonb)'::text),
    ('public.list_management_filter_options_v1(text,jsonb)'::text),
    ('public.get_management_detail_v1(text,uuid)'::text),
    ('public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)'::text),
    ('public.list_management_class_textbook_candidates_v1(uuid,text,jsonb,text,uuid,integer)'::text)
)
select ok(
  not (select proc.prosecdef from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
  and (select proc.proconfig in (array['search_path=']::text[], array['search_path=""']::text[]) from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
  and pg_catalog.has_function_privilege('authenticated',signature,'EXECUTE')
  and not pg_catalog.has_function_privilege('anon',signature,'EXECUTE')
  and not pg_catalog.has_function_privilege('public',signature,'EXECUTE'),
  signature || ' is fixed-search-path security-invoker and authenticated-only'
) from expected;

set local role authenticated;
select lives_ok(
  $$select * from public.list_management_page_v1(
    'students',
    jsonb_build_object('kind','students','search','__authenticated_invoker_probe__','status',null,'schoolCategory',null,'school',null,'grade',null),
    null,null,30
  )$$,
  'authenticated invoker can execute inline-validated management list RPC'
);
reset role;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
values (
  '91000000-0000-4000-8000-000000000900','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','management-page-authenticated@example.invalid',crypt('local-only',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);
insert into public.profiles(id,role,name,email,created_at,updated_at)
values ('91000000-0000-4000-8000-000000000900','admin','관리 페이지 검증자','management-page-authenticated@example.invalid',now(),now())
on conflict (id) do update set role='admin',updated_at=now();

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

insert into public.textbooks(
  id,title,name,subject,school_level,grade_level,school_levels,grade_levels,
  sub_subject,publisher,price,tags,lessons,status
)
values (
  '91000000-0000-4000-8000-000000000801','__management_detail_textbook__','__management_detail_textbook__',
  'english','middle','m2',array['middle']::text[],array['m2']::text[],'기타','검증 출판사',10000,'{}'::jsonb,'[]'::jsonb,'active'
);
insert into public.classes(
  id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,
  student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan
)
values (
  '91000000-0000-4000-8000-000000000701','__management_detail_class__','정규','영어','중2','검증 교사','월 18:00','검증실',12,320000,'수강',
  '[]'::jsonb,'[]'::jsonb,jsonb_build_array('91000000-0000-4000-8000-000000000801','91000000-0000-4000-8000-000000000899'),'[]'::jsonb,'{}'::jsonb
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000900',true);
select lives_ok(
  $$select public.get_management_detail_v1('students','91000000-0000-4000-8000-000000000032')$$,
  'authenticated invoker can read selected student detail'
);
select lives_ok(
  $$select public.get_management_detail_v1('classes','91000000-0000-4000-8000-000000000701')$$,
  'authenticated invoker class detail uses approved science-area interface'
);
select lives_ok(
  $$select public.get_management_detail_v1('textbooks','91000000-0000-4000-8000-000000000801')$$,
  'authenticated invoker can read selected textbook detail'
);
reset role;

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

with evidence as (
  select
    pg_temp.dashboard_explain_v1($sql$
      select * from public.list_management_page_v1(
        'students',jsonb_build_object('kind','students','search','__management_page_fixture__','status',null,'schoolCategory',null,'school',null,'grade',null),null,null,30
      )
    $sql$) as first_plan,
    pg_temp.dashboard_explain_v1($sql$
      with boundary as (
        select sort_key,id from management_first_page
        order by sort_key collate dashboard_private.ko_numeric,id offset 29 limit 1
      )
      select page.* from boundary cross join lateral public.list_management_page_v1(
        'students',jsonb_build_object('kind','students','search','__management_page_fixture__','status',null,'schoolCategory',null,'school',null,'grade',null),boundary.sort_key,boundary.id,30
      ) page
    $sql$) as next_plan,
    pg_temp.dashboard_explain_v1($sql$
      select public.get_management_detail_v1('students','91000000-0000-4000-8000-000000000032'::uuid)
    $sql$) as detail_plan,
    pg_catalog.octet_length((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page)) from public.list_management_page_v1(
      'students',jsonb_build_object('kind','students','search','__management_page_fixture__','status',null,'schoolCategory',null,'school',null,'grade',null),null,null,30
    ) page)::text) as first_bytes
)
select ok(
  first_plan #>> '{0,Execution Time}' is not null
  and next_plan #>> '{0,Execution Time}' is not null
  and detail_plan #>> '{0,Execution Time}' is not null
  and first_bytes between 1 and 262144,
  'management first page, continuation, and exact detail emit ANALYZE/BUFFERS plans with a bounded response'
) from evidence;

select finish();
rollback;
