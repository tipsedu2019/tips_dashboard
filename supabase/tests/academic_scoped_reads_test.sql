begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';

select has_function('public','get_academic_timetable_range_v1',array['date','date','text','text','text'],'academic timetable range RPC exists');
select has_function('public','get_academic_curriculum_page_v1',array['jsonb','text','uuid','integer'],'academic curriculum page RPC exists');
select has_function('public','get_academic_curriculum_detail_v1',array['uuid'],'academic curriculum detail RPC exists');

with expected(signature) as (
  values
    ('public.get_academic_timetable_range_v1(date,date,text,text,text)'::text),
    ('public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer)'::text),
    ('public.get_academic_curriculum_detail_v1(uuid)'::text)
)
select ok(
  not (select proc.prosecdef from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
  and (select proc.proconfig = array['search_path=']::text[] from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
  and pg_catalog.has_function_privilege('authenticated',signature,'EXECUTE')
  and not pg_catalog.has_function_privilege('anon',signature,'EXECUTE')
  and not pg_catalog.has_function_privilege('public',signature,'EXECUTE'),
  signature || ' is fixed-search-path security-invoker and authenticated-only'
) from expected;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
values (
  '93000000-0000-4000-8000-000000000900','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','academic-scoped-reads@example.invalid',crypt('local-only',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);
insert into public.profiles(id,role,name,email,created_at,updated_at)
values ('93000000-0000-4000-8000-000000000900','admin','학사 범위 읽기 검증자','academic-scoped-reads@example.invalid',now(),now())
on conflict (id) do update set role='admin',updated_at=now();
select pg_catalog.set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000900',true);

select throws_ok(
  $$select public.get_academic_timetable_range_v1('2199-01-01','2199-01-15',null,null,null)$$,
  '22023','academic_timetable_range_invalid','timetable rejects more than 14 inclusive days'
);
select throws_ok(
  $$select public.get_academic_curriculum_page_v1('{}'::jsonb,null,null,31)$$,
  '22023','academic_curriculum_page_limit_invalid','curriculum requires a 30-row client page'
);
select throws_ok(
  $$select public.get_academic_curriculum_page_v1(jsonb_build_object('periodId',null,'search','','status',null,'subject',null,'grade',null,'teacher',null,'classroom',null,'viewMode','all','unknown',true),null,null,30)$$,
  '22023','academic_curriculum_filters_invalid','curriculum rejects unknown filter keys'
);
select throws_ok(
  $$select public.get_academic_curriculum_page_v1(jsonb_build_object('periodId',null,'search','','status',null,'subject',null,'grade',null,'teacher',null,'classroom',null,'viewMode','all'),'partial cursor',null,30)$$,
  '22023','academic_curriculum_cursor_invalid','curriculum rejects a partial keyset cursor'
);

insert into public.classes(
  id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,
  student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan
)
select
  ('93010000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__academic_range__ ' || ordinal,'정규','__academic_range__','고2','검증 교사',
  '월 18:00-19:00','검증실',12,320000,'수강',
  '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb
from pg_catalog.generate_series(1,2001) ordinal;

select is(
  public.get_academic_timetable_range_v1('2199-01-01','2199-01-14',null,null,'__academic_range__') ->> 'code',
  'visible_range_too_dense',
  'timetable returns an explicit row-density error'
);
select is(
  pg_catalog.jsonb_array_length(public.get_academic_timetable_range_v1('2199-01-01','2199-01-14',null,null,'__academic_range__') -> 'rows'),
  0,
  'timetable density error never leaks a partial grid'
);
select is(
  (public.get_academic_timetable_range_v1('2199-01-01','2199-01-14',null,null,'__academic_range__') ->> 'suggestedDays')::integer,
  7,
  'timetable row-density error suggests a seven-day range'
);

insert into public.classes(
  id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,
  student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan
)
select
  ('93020000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__academic_collection__ ' || ordinal,'정규','__academic_collection__','고2','검증 교사',
  '','검증실',12,320000,'수강',
  '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb
from pg_catalog.generate_series(1,501) ordinal;

select is(
  public.get_academic_timetable_range_v1('2199-01-01','2199-01-14',null,null,'__academic_collection__') ->> 'code',
  'timetable_collection_too_dense',
  'timetable distinguishes support-collection density from row density'
);
select is(
  public.get_academic_timetable_range_v1('2199-01-01','2199-01-14',null,null,'__academic_collection__') ->> 'collection',
  'class_summaries',
  'timetable reports the exact overflowing collection'
);
select is(
  (public.get_academic_timetable_range_v1('2199-01-01','2199-01-14',null,null,'__academic_collection__') ->> 'observedItemsAtLeast')::integer,
  501,
  'support-collection density reports its own 501-item bound'
);

insert into public.classes(
  id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,
  student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan
)
select
  ('93030000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__academic_curriculum__ ' || pg_catalog.lpad(ordinal::text,2,'0'),'정규',
  case when ordinal = 31 then '과학' else '수학' end,
  '고2','검증 교사','월 18:00-19:00','검증실',12,320000,
  case when ordinal <= 20 then '수강' else '개강 예정' end,
  '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb
from pg_catalog.generate_series(1,32) ordinal;

create temporary table academic_curriculum_first_page on commit drop as
select value as row
from pg_catalog.jsonb_array_elements(public.get_academic_curriculum_page_v1(
  pg_catalog.jsonb_build_object('periodId',null,'search','__academic_curriculum__','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom','검증실','viewMode','all'),
  null,null,30
) -> 'rows') value;

select is((select pg_catalog.count(*)::integer from academic_curriculum_first_page),31,'curriculum reads 30 plus one boundary row');
select is(
  (public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId',null,'search','__academic_curriculum__','status',null,'subject','과학','grade','고2','teacher','검증 교사','classroom','검증실','viewMode','all'),
    null,null,30
  ) #>> '{stats,total}')::integer,
  1,
  'curriculum stats use the same full server filter as the page'
);
select is(
  pg_catalog.jsonb_array_length(public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId',null,'search','__academic_curriculum__','status',null,'subject','과학','grade','고2','teacher','검증 교사','classroom','검증실','viewMode','all'),
    null,null,30
  ) -> 'rows'),
  1,
  'a matching row at the unfiltered 31st boundary survives server filtering'
);

with boundary as (
  select row ->> 'sort_key' as sort_key,(row ->> 'id')::uuid as id
  from academic_curriculum_first_page
  order by row ->> 'sort_key' collate dashboard_private.ko_numeric,(row ->> 'id')::uuid
  offset 29 limit 1
), second_page as (
  select public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId',null,'search','__academic_curriculum__','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom','검증실','viewMode','all'),
    boundary.sort_key,boundary.id,30
  ) as response from boundary
)
select is(pg_catalog.jsonb_array_length(response -> 'rows'),2,'keyset continuation retains rows after the client boundary') from second_page;

select ok(
  pg_catalog.jsonb_array_length(public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId',null,'search','__academic_curriculum__','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom','검증실','viewMode','all'),
    null,null,30
  ) #> '{filterOptions,subjects}') <= 500,
  'curriculum distinct filter options are bounded at 500'
);
select is(
  public.get_academic_curriculum_detail_v1('93030000-0000-4000-8000-000000000031') ->> 'id',
  '93030000-0000-4000-8000-000000000031',
  'curriculum detail reads only the exact selected class'
);
select ok(
  pg_catalog.jsonb_array_length(public.get_academic_curriculum_detail_v1('93030000-0000-4000-8000-000000000031') -> 'scheduleRows') <= 500
  and pg_catalog.jsonb_array_length(public.get_academic_curriculum_detail_v1('93030000-0000-4000-8000-000000000031') -> 'progressRows') <= 500
  and pg_catalog.jsonb_array_length(public.get_academic_curriculum_detail_v1('93030000-0000-4000-8000-000000000031') -> 'textbookRows') <= 500,
  'curriculum exact detail bounds every large child collection'
);

select ok(
  pg_catalog.pg_get_functiondef('public.get_academic_timetable_range_v1(date,date,text,text,text)'::pg_catalog.regprocedure) !~* '(progress_logs|textbooks)',
  'timetable never reads curriculum progress or textbook sources'
);
select ok(
  pg_catalog.pg_get_functiondef('public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer)'::pg_catalog.regprocedure) !~* '(schedule_plan|lessons)',
  'curriculum list never reads large class detail payloads'
);

select finish();
rollback;
