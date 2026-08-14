begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';

select has_function('public','get_operations_calendar_range_v1',array['date','date'],'operations calendar range RPC exists');
select has_function('public','get_operations_annual_board_v1',array['integer'],'operations annual board RPC exists');
select has_function('public','get_operations_class_schedule_page_v1',array['jsonb','text','uuid','integer'],'operations class page RPC exists');
select has_function('public','get_academic_event_detail_v1',array['uuid'],'operations event detail RPC exists');
select has_function('public','get_operations_class_lesson_design_detail_v1',array['uuid'],'operations class lesson design detail RPC exists');
select has_function('public','list_operations_catalogs_v1',array[]::text[],'operations catalog RPC exists');

with expected(signature) as (
  values
    ('public.get_operations_calendar_range_v1(date,date)'::text),
    ('public.get_operations_annual_board_v1(integer)'::text),
    ('public.get_operations_class_schedule_page_v1(jsonb,text,uuid,integer)'::text),
    ('public.get_academic_event_detail_v1(uuid)'::text),
    ('public.get_operations_class_lesson_design_detail_v1(uuid)'::text),
    ('public.list_operations_catalogs_v1()'::text)
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
  $$select public.get_operations_calendar_range_v1('2026-01-01','2026-02-12')$$,
  '22023','operations_visible_range_invalid','calendar rejects more than 42 inclusive days'
);
select throws_ok(
  $$select public.get_operations_annual_board_v1(1999)$$,
  '22023','operations_academic_year_invalid','annual board rejects an invalid year'
);
select throws_ok(
  $$select public.get_operations_class_schedule_page_v1('{}'::jsonb,null,null,30)$$,
  '22023','operations_class_schedule_filters_invalid','class list rejects missing filter keys'
);
select throws_ok(
  $$select public.get_operations_class_schedule_page_v1(jsonb_build_object('termId',null,'search','','subject',null,'grade',null,'teacher',null,'syncGroupId',null),null,null,31)$$,
  '22023','operations_class_schedule_limit_invalid','class list requires a 30-row client page'
);

insert into public.academic_schools(id,name,category)
values
  ('92000000-0000-4000-8000-000000000001','__operations_dense_school__','high'),
  ('92000000-0000-4000-8000-000000000002','__operations_annual_school__','middle');

insert into public.academic_events(id,title,school_id,school,type,start,"end",grade,note)
select
  ('92010000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__operations_calendar_dense__ ' || ordinal,
  '92000000-0000-4000-8000-000000000001',
  '__operations_dense_school__','팁스','2199-01-15','2199-01-15','고1','bounded fixture'
from pg_catalog.generate_series(1,2001) ordinal;

select is(
  public.get_operations_calendar_range_v1('2199-01-01','2199-02-11') ->> 'code',
  'visible_range_too_dense',
  'calendar returns an explicit density error'
);
select is(
  pg_catalog.jsonb_array_length(public.get_operations_calendar_range_v1('2199-01-01','2199-02-11') -> 'rows'),
  0,
  'calendar density error never leaks a partial grid'
);
select is(
  (public.get_operations_calendar_range_v1('2199-01-01','2199-02-11') ->> 'suggestedDays')::integer,
  7,
  'calendar density error suggests a seven-day range'
);

insert into public.academic_events(id,title,school_id,school,type,start,"end",grade,note)
select
  ('92020000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__operations_annual_dense__ ' || ordinal,
  '92000000-0000-4000-8000-000000000002',
  '__operations_annual_school__','방학·휴일·기타','2198-06-01','2198-06-01','중2','bounded fixture'
from pg_catalog.generate_series(1,4001) ordinal;

select is(
  public.get_operations_annual_board_v1(2198) ->> 'code',
  'annual_board_too_dense',
  'annual board returns no partial board above 4000 entries'
);

insert into public.academic_events(id,title,school_id,school,type,start,"end",grade,note)
values (
  '92021000-0000-4000-8000-000000000001','__operations_annual_meta__ 중간',
  '92000000-0000-4000-8000-000000000002','__operations_annual_school__',
  '시험기간','2197-04-10','2197-04-10','고1, 고2',
  E'보이는 메모\n\n[[TIPS_META]] {"examTerm":"1학기 중간","scienceAreaKey":"physics","legacyFlag":"keep"}'
);

insert into public.academic_event_exam_details(
  id,academic_event_id,school_id,grade,subject,exam_date,exam_date_status,textbook_scope,sort_order
)
values (
  '92022000-0000-4000-8000-000000000001','92021000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000002','고1, 고2','수학','2197-04-10','exact','10~30쪽',0
);

create temporary table operations_annual_meta_entries on commit drop as
select entry
from pg_catalog.jsonb_array_elements(public.get_operations_annual_board_v1(2197) #> '{data,rows}') as grade_row(value)
cross join lateral pg_catalog.jsonb_each(grade_row.value -> 'typeBuckets') as type_bucket(key,value)
cross join lateral pg_catalog.jsonb_array_elements(type_bucket.value) as entry;

select is(
  (select pg_catalog.count(*)::integer from operations_annual_meta_entries where entry ->> 'id' = '92021000-0000-4000-8000-000000000001'),
  2,
  'annual board expands a comma-delimited base event into two grade rows'
);
select is(
  pg_catalog.jsonb_array_length(public.get_operations_annual_board_v1(2197) #> '{data,rows}'),
  2,
  'annual comma-grade rows keep distinct renderer row identities'
);
select is(
  (select pg_catalog.count(*)::integer from operations_annual_meta_entries where entry ->> 'id' = 'exam-detail:92022000-0000-4000-8000-000000000001'),
  2,
  'annual board expands a comma-delimited derived exam entry into two grade rows'
);
select is(
  (select entry ->> 'parentEventId' from operations_annual_meta_entries where entry ->> 'id' like 'exam-detail:%' limit 1),
  '92021000-0000-4000-8000-000000000001',
  'derived annual exam rows carry their editable parent event id'
);
select is(
  (select entry ->> 'examTerm' from operations_annual_meta_entries limit 1),
  '1학기 중간',
  'annual entries include renderer-ready exam term metadata'
);
select is(
  public.get_academic_event_detail_v1('92021000-0000-4000-8000-000000000001') ->> 'storedNote',
  E'보이는 메모\n\n[[TIPS_META]] {"examTerm":"1학기 중간","scienceAreaKey":"physics","legacyFlag":"keep"}',
  'event exact detail returns the lossless stored note payload'
);

insert into public.classes(
  id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,
  student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan
)
select
  ('92030000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__operations_class__ ' || pg_catalog.lpad(ordinal::text,2,'0'),
  '정규',
  case when ordinal = 31 then '과학' else '수학' end,
  '고2','검증 교사','월 18:00','검증실',12,320000,
  case when ordinal <= 20 then '수강' else '개강 예정' end,
  '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb
from pg_catalog.generate_series(1,32) ordinal;

create temporary table operations_class_first_page on commit drop as
select value as row
from pg_catalog.jsonb_array_elements(
  public.get_operations_class_schedule_page_v1(
    pg_catalog.jsonb_build_object('termId',null,'search','__operations_class__','subject',null,'grade','고2','teacher','검증 교사','syncGroupId',null),
    null,null,30
  ) -> 'rows'
) as value;

select is((select pg_catalog.count(*)::integer from operations_class_first_page),31,'class page reads 30 plus one boundary row');
select is(
  (public.get_operations_class_schedule_page_v1(
    pg_catalog.jsonb_build_object('termId',null,'search','__operations_class__','subject','과학','grade','고2','teacher','검증 교사','syncGroupId',null),
    null,null,30
  ) #>> '{stats,total}')::integer,
  1,
  'class stats use the same full server filter as the page'
);
select is(
  pg_catalog.jsonb_array_length(public.get_operations_class_schedule_page_v1(
    pg_catalog.jsonb_build_object('termId',null,'search','__operations_class__','subject','과학','grade','고2','teacher','검증 교사','syncGroupId',null),
    null,null,30
  ) -> 'rows'),
  1,
  'a matching row at the unfiltered 31st boundary is found by the server filter'
);

select ok(
  (select pg_catalog.count(*) from pg_catalog.pg_get_functiondef('public.get_operations_class_schedule_page_v1(jsonb,text,uuid,integer)'::pg_catalog.regprocedure)::text source
   where source !~* 'schedule_plan') = 1,
  'class list function does not read the schedule plan detail payload'
);

select is(
  public.get_operations_class_lesson_design_detail_v1('92030000-0000-4000-8000-000000000001') #>> '{classItem,schedulePlan}',
  '{}',
  'class lesson design exact detail hydrates the stored legacy schedule plan'
);

select finish();
rollback;
