begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';

create function pg_temp.dashboard_explain_v1(p_sql text)
returns jsonb language plpgsql as $probe$
declare v_plan jsonb;
begin
  execute 'explain (analyze, buffers, format json) ' || p_sql into v_plan;
  return v_plan;
end
$probe$;

select has_function('public','get_academic_timetable_range_v1',array['date','date','text','text','text'],'academic timetable range RPC exists');
select has_function('public','get_academic_curriculum_page_v1',array['jsonb','text','uuid','integer','boolean'],'academic curriculum page RPC exists');
select has_function('public','get_academic_curriculum_detail_v1',array['uuid'],'academic curriculum detail RPC exists');
select has_function('dashboard_private','is_canonical_class_date_v1',array['text'],'canonical class date validator exists');
select ok(dashboard_private.is_canonical_class_date_v1(null),'canonical class date validator permits null');
select ok(dashboard_private.is_canonical_class_date_v1(''),'canonical class date validator permits blank');
select ok(dashboard_private.is_canonical_class_date_v1('2024-02-29'),'canonical class date validator permits a real leap day');
select ok(not dashboard_private.is_canonical_class_date_v1('2026-02-30'),'canonical class date validator rejects an impossible date');
select ok(not dashboard_private.is_canonical_class_date_v1(' 2026-03-01 '),'canonical class date validator rejects padded storage');

with expected(signature) as (
  values
    ('public.get_academic_timetable_range_v1(date,date,text,text,text)'::text),
    ('public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer,boolean)'::text),
    ('public.get_academic_curriculum_detail_v1(uuid)'::text)
)
select ok(
  not (select proc.prosecdef from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
  and (select proc.proconfig in (array['search_path=']::text[], array['search_path=""']::text[]) from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
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

insert into public.class_schedule_sync_groups(id,name,subject,color,is_default,sort_order)
values ('93000000-0000-4000-8000-000000000950','__academic_scope_group__','수학','#3182f6',false,950);

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
insert into public.class_schedule_sync_group_members(group_id,class_id,sort_order)
select '93000000-0000-4000-8000-000000000950',id,0
from public.classes where subject='__academic_range__';

select is(
  public.get_academic_timetable_range_v1('2199-01-01','2199-01-14','93000000-0000-4000-8000-000000000950',null,'__academic_range__') ->> 'code',
  'visible_range_too_dense',
  'timetable returns an explicit row-density error'
);
select is(
  pg_catalog.jsonb_array_length(public.get_academic_timetable_range_v1('2199-01-01','2199-01-14','93000000-0000-4000-8000-000000000950',null,'__academic_range__') -> 'rows'),
  0,
  'timetable density error never leaks a partial grid'
);
select is(
  (public.get_academic_timetable_range_v1('2199-01-01','2199-01-14','93000000-0000-4000-8000-000000000950',null,'__academic_range__') ->> 'suggestedDays')::integer,
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
insert into public.class_schedule_sync_group_members(group_id,class_id,sort_order)
select '93000000-0000-4000-8000-000000000950',id,0
from public.classes where subject='__academic_collection__';

select is(
  public.get_academic_timetable_range_v1('2199-01-01','2199-01-14','93000000-0000-4000-8000-000000000950',null,'__academic_collection__') ->> 'code',
  'timetable_collection_too_dense',
  'timetable distinguishes support-collection density from row density'
);
select is(
  public.get_academic_timetable_range_v1('2199-01-01','2199-01-14','93000000-0000-4000-8000-000000000950',null,'__academic_collection__') ->> 'collection',
  'class_summaries',
  'timetable reports the exact overflowing collection'
);
select is(
  (public.get_academic_timetable_range_v1('2199-01-01','2199-01-14','93000000-0000-4000-8000-000000000950',null,'__academic_collection__') ->> 'observedItemsAtLeast')::integer,
  501,
  'support-collection density reports its own 501-item bound'
);

insert into public.academic_subject_settings(subject,is_active,registration_create_enabled,grade_levels,sort_order)
values ('과학',true,true,array['고1','고2','고3'],30)
on conflict (subject) do update set is_active=true;
insert into public.academic_subject_areas(subject,area_key,label,sort_order,is_active)
values ('과학','physics','물리학',20,true)
on conflict (subject,area_key) do update set is_active=true,label=excluded.label,sort_order=excluded.sort_order;

insert into public.classes(
  id,name,class_type,subject,subject_area_key,grade,teacher,schedule,room,capacity,fee,status,
  student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan
)
select
  ('93030000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__academic_curriculum__ ' || pg_catalog.lpad(ordinal::text,2,'0'),'정규',
  case when ordinal = 31 then '과학' else '수학' end,
  case when ordinal = 31 then 'physics' else null end,
  '고2','검증 교사','월 18:00-19:00',case when ordinal = 31 then '본3' else '검증실' end,12,320000,
  case when ordinal <= 20 then '수강' else '개강 예정' end,
  '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb
from pg_catalog.generate_series(1,32) ordinal;
insert into public.class_schedule_sync_group_members(group_id,class_id,sort_order)
select '93000000-0000-4000-8000-000000000950',id,0
from public.classes where name like '__academic_curriculum__%';

select throws_ok(
  $$update public.classes set start_date='20260101' where id='93030000-0000-4000-8000-000000000032'$$,
  '23514',
  'new row for relation "classes" violates check constraint "classes_start_date_canonical_check"',
  'compact class start dates are rejected'
);
select throws_ok(
  $$update public.classes set start_date='2024년 01월 31일' where id='93030000-0000-4000-8000-000000000032'$$,
  '23514',
  'new row for relation "classes" violates check constraint "classes_start_date_canonical_check"',
  'localized class start dates are rejected'
);
select throws_ok(
  $$update public.classes set end_date='2026/03/01' where id='93030000-0000-4000-8000-000000000032'$$,
  '23514',
  'new row for relation "classes" violates check constraint "classes_end_date_canonical_check"',
  'slash-separated class end dates are rejected'
);
select throws_ok(
  $$update public.classes set end_date='2026-02-30' where id='93030000-0000-4000-8000-000000000032'$$,
  '23514',
  'new row for relation "classes" violates check constraint "classes_end_date_canonical_check"',
  'impossible canonical-looking class end dates are rejected'
);
select lives_ok(
  $$update public.classes set start_date=null,end_date='' where id='93030000-0000-4000-8000-000000000032'$$,
  'null and blank class dates remain valid empty values'
);
select lives_ok(
  $$update public.classes set start_date='2024-02-29',end_date='2024-03-01' where id='93030000-0000-4000-8000-000000000032'$$,
  'valid leap-day and canonical class dates are accepted'
);
update public.classes
set start_date='2198-12-31',end_date='2199-12-31'
where id='93030000-0000-4000-8000-000000000031';

select pg_catalog.set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(
  id,class_id,session_key,session_date,schedule_state,start_time,end_time,
  teacher_name_snapshot,classroom_name_snapshot,origin,revision
)
values
  ('93040000-0000-4000-8000-000000000001','93030000-0000-4000-8000-000000000031','__academic_planned__','2199-01-05','active','18:00','19:00','검증 교사','검증실','manual',1),
  ('93040000-0000-4000-8000-000000000002','93030000-0000-4000-8000-000000000031','__academic_unplanned__','2199-01-06','active','18:00','19:00','검증 교사','검증실','manual',1);
select pg_catalog.set_config('app.class_schedule_mutation','',true);
insert into public.progress_logs(id,class_id,textbook_id,session_id,progress_key,status,content,date,updated_at)
values ('93040000-0000-4000-8000-000000000010','93030000-0000-4000-8000-000000000031',null,null,'__academic_planned__','done','완료','2199-01-05',now());

select ok(
  exists (
    select 1
    from pg_catalog.jsonb_array_elements(public.get_academic_timetable_range_v1(
      '2199-01-01','2199-01-14','93000000-0000-4000-8000-000000000950',null,'과학'
    ) -> 'rows') row
    where row ->> 'classId'='93030000-0000-4000-8000-000000000031'
  ),
  'timetable reads a class with canonical historical text dates without cast errors'
);
select ok(
  exists (
    select 1
    from pg_catalog.jsonb_array_elements(public.get_academic_curriculum_page_v1(
      pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__ 31','status',null,'subject','과학','grade','고2','teacher','검증 교사','classroom','본3','viewMode','all'),
      null,null,30,true
    ) -> 'rows') row
    where row ->> 'id'='93030000-0000-4000-8000-000000000031'
  ),
  'curriculum reads a class with canonical historical text dates without cast errors'
);

create temporary table academic_curriculum_first_page on commit drop as
select value as row
from pg_catalog.jsonb_array_elements(public.get_academic_curriculum_page_v1(
  pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom',null,'viewMode','all'),
  null,null,30
) -> 'rows') value;

select is((select pg_catalog.count(*)::integer from academic_curriculum_first_page),31,'curriculum reads 30 plus one boundary row');
select is(
  (public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__','status',null,'subject','과학','grade','고2','teacher','검증 교사','classroom','본관 3강','viewMode','all'),
    null,null,30
  ) #>> '{stats,total}')::integer,
  1,
  'curriculum stats use the same full server filter as the page'
);
select is(
  pg_catalog.jsonb_array_length(public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__','status',null,'subject','과학','grade','고2','teacher','검증 교사','classroom','본관 3강','viewMode','all'),
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
    pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom',null,'viewMode','all'),
    boundary.sort_key,boundary.id,30,false
  ) as response from boundary
)
select ok(
  pg_catalog.jsonb_array_length(response -> 'rows')=2
  and response -> 'stats' = 'null'::jsonb
  and response -> 'filterOptions' = 'null'::jsonb,
  'keyset continuation keeps rows while skipping cached stats and facets'
) from second_page;

select is(
  public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__ 31','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom','본3','viewMode','all'),
    null,null,30,true
  ) #>> '{rows,0,row_data,nextSession,sessionId}',
  '93040000-0000-4000-8000-000000000002',
  'curriculum returns the exact earliest unplanned normalized session id'
);
select is(
  public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__ 32','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom','검증실','viewMode','all'),
    null,null,30,true
  ) #>> '{rows,0,row_data,stateLabel}',
  '회차 미생성',
  'canonical classification reports no-session before no-textbook'
);
select is(
  (public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__ 32','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom','검증실','viewMode','all'),
    null,null,30,true
  ) #>> '{stats,unlinkedClassCount}')::integer,
  1,
  'textbook-unlinked count remains independent when the class also has no sessions'
);

select ok(
  pg_catalog.jsonb_array_length(public.get_academic_curriculum_page_v1(
    pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom',null,'viewMode','all'),
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
  pg_catalog.pg_get_functiondef('public.get_academic_timetable_range_v1(date,date,text,text,text)'::pg_catalog.regprocedure) !~* 'to_jsonb\s*\(',
  'timetable support collections use explicit scalar projections instead of whole-row conversion'
);
select ok(
  pg_catalog.pg_get_functiondef('public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer,boolean)'::pg_catalog.regprocedure) !~* '(schedule_plan|lessons)',
  'curriculum list never reads large class detail payloads'
);

with evidence as (
  select
    pg_temp.dashboard_explain_v1($sql$
      select public.get_academic_curriculum_page_v1(
        jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom',null,'viewMode','all'),null,null,30,true
      )
    $sql$) as first_plan,
    pg_temp.dashboard_explain_v1($sql$
      with boundary as (
        select row ->> 'sort_key' sort_key,(row ->> 'id')::uuid id
        from academic_curriculum_first_page
        order by row ->> 'sort_key' collate dashboard_private.ko_numeric,(row ->> 'id')::uuid offset 29 limit 1
      )
      select public.get_academic_curriculum_page_v1(
        jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom',null,'viewMode','all'),boundary.sort_key,boundary.id,30,false
      ) from boundary
    $sql$) as next_plan,
    pg_temp.dashboard_explain_v1($sql$
      select public.get_academic_curriculum_detail_v1('93030000-0000-4000-8000-000000000031'::uuid)
    $sql$) as detail_plan,
    pg_catalog.octet_length(public.get_academic_curriculum_page_v1(
      pg_catalog.jsonb_build_object('periodId','93000000-0000-4000-8000-000000000950','search','__academic_curriculum__','status',null,'subject',null,'grade','고2','teacher','검증 교사','classroom',null,'viewMode','all'),null,null,30,true
    )::text) as first_bytes
)
select ok(
  first_plan #>> '{0,Execution Time}' is not null
  and next_plan #>> '{0,Execution Time}' is not null
  and detail_plan #>> '{0,Execution Time}' is not null
  and first_bytes between 1 and 262144,
  'academic first page, continuation, and exact detail emit ANALYZE/BUFFERS plans with a bounded response'
) from evidence;

select finish();
rollback;
