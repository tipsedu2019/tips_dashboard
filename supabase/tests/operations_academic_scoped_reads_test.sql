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

select has_function('public','get_operations_calendar_range_v1',array['date','date'],'operations calendar range RPC exists');
select has_function('public','get_operations_annual_board_v1',array['integer'],'operations annual board RPC exists');
select has_function('public','get_operations_class_schedule_page_v1',array['jsonb','text','uuid','integer'],'operations class page RPC exists');
select has_function('public','get_academic_event_detail_v1',array['uuid'],'operations event detail RPC exists');
select has_function('public','get_operations_class_lesson_design_detail_v1',array['uuid'],'operations class lesson design detail RPC exists');
select has_function('public','get_operations_lesson_textbook_candidate_page_v1',array['uuid','text','text','uuid','integer'],'operations textbook candidate page RPC exists');
select has_function('public','list_operations_catalogs_v1',array[]::text[],'operations catalog RPC exists');
select has_function('dashboard_private','normalize_academic_exam_period_key_v1',array['text'],'operations exam-period normalizer exists');

select is(
  dashboard_private.normalize_academic_exam_period_key_v1('semester_1_midterm'),
  '1mid',
  'exam-period normalizer maps the stored first-semester midterm code'
);
select is(
  dashboard_private.normalize_academic_exam_period_key_v1('1학기 기말'),
  '1final',
  'exam-period normalizer maps the renderer first-semester final label'
);

with expected(signature) as (
  values
    ('public.get_operations_calendar_range_v1(date,date)'::text),
    ('public.get_operations_annual_board_v1(integer)'::text),
    ('public.get_operations_class_schedule_page_v1(jsonb,text,uuid,integer)'::text),
    ('public.get_academic_event_detail_v1(uuid)'::text),
    ('public.get_operations_class_lesson_design_detail_v1(uuid)'::text),
    ('public.get_operations_lesson_textbook_candidate_page_v1(uuid,text,text,uuid,integer)'::text),
    ('public.list_operations_catalogs_v1()'::text)
)
select ok(
  not (select proc.prosecdef from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
  and (select proc.proconfig in (array['search_path=']::text[], array['search_path=""']::text[]) from pg_catalog.pg_proc proc where proc.oid = signature::pg_catalog.regprocedure)
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
select throws_ok(
  $$select public.get_operations_lesson_textbook_candidate_page_v1('92030000-0000-4000-8000-000000000001','','',null,31)$$,
  '22023','operations_textbook_candidate_request_invalid','textbook candidate page requires a 30-row client page'
);

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
values (
  '92000000-0000-4000-8000-000000000900','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','operations-scoped-reads@example.invalid',crypt('local-only',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);
update public.profiles set role = 'admin' where id = '92000000-0000-4000-8000-000000000900';
select pg_catalog.set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000900',true);

insert into public.academic_schools(id,name,category)
values
  ('92000000-0000-4000-8000-000000000001','__operations_dense_school__','high'),
  ('92000000-0000-4000-8000-000000000002','__operations_annual_school__','middle');

insert into public.academic_events(id,title,school_id,type,date,grade,note)
select
  ('92010000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__operations_calendar_dense__ ' || ordinal,
  '92000000-0000-4000-8000-000000000001',
  '팁스','2199-01-15','고1','bounded fixture'
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

insert into public.academic_events(id,title,school_id,type,date,grade,note)
select
  ('92020000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__operations_annual_dense__ ' || ordinal,
  '92000000-0000-4000-8000-000000000002',
  '방학·휴일·기타','2198-06-01','중2','bounded fixture'
from pg_catalog.generate_series(1,4001) ordinal;

select is(
  public.get_operations_annual_board_v1(2198) ->> 'code',
  'annual_board_too_dense',
  'annual board returns no partial board above 4000 entries'
);

insert into public.academic_events(id,title,school_id,type,date,grade,note)
values (
  '92021000-0000-4000-8000-000000000001','__operations_annual_meta__ 중간',
  '92000000-0000-4000-8000-000000000002',
  '시험기간','2197-04-10','고1, 고2',
  E'보이는 메모\n\n[[TIPS_META]] {"examTerm":"1학기 중간","scienceAreaKey":"physics","legacyFlag":"keep"}'
), (
  '92021000-0000-4000-8000-000000000002','2학기 기말고사',
  '92000000-0000-4000-8000-000000000002',
  '시험기간','2197-09-20','고3','legacy title only'
);

insert into public.academic_event_exam_details(
  id,academic_event_id,school_id,grade,subject,exam_date,exam_date_status,textbook_scope,sort_order
)
values (
  '92022000-0000-4000-8000-000000000001','92021000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000002','고1, 고2','수학','2197-04-10','exact','10~30쪽',0
), (
  '92022000-0000-4000-8000-000000000002','92021000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000002','고3','수학','2197-09-20','exact','40~60쪽',0
);

insert into public.textbooks(
  id,title,name,subject,school_level,grade_level,school_levels,grade_levels,
  sub_subject,publisher,price,tags,lessons,status
)
values (
  '92023000-0000-4000-8000-000000000001','영어 본교재','영어 본교재',
  'english','high','h1',array['high']::text[],array['h1']::text[],
  'english','본교재 출판',10000,'{}'::jsonb,'[]'::jsonb,'active'
), (
  '92023000-0000-4000-8000-000000000002','섞이면 안 되는 고1 수학 교재','섞이면 안 되는 고1 수학 교재',
  'math','high','h1',array['high']::text[],array['h1']::text[],
  'math','오연결 출판',10000,'{}'::jsonb,'[]'::jsonb,'active'
), (
  '92023000-0000-4000-8000-000000000003','섞이면 안 되는 고3 수학 교재','섞이면 안 되는 고3 수학 교재',
  'math','high','h3',array['high']::text[],array['h3']::text[],
  'math','오연결 출판',10000,'{}'::jsonb,'[]'::jsonb,'active'
), (
  '92023000-0000-4000-8000-000000000004','명시 연결 고3 수학 교재','명시 연결 고3 수학 교재',
  'math','high','h3',array['high']::text[],array['h3']::text[],
  'math','정확한 출판',10000,'{}'::jsonb,'[]'::jsonb,'active'
);

insert into public.academy_curriculum_plans(
  id,academic_year,academy_grade,subject,main_textbook_id,note,sort_order
)
values (
  '92024000-0000-4000-8000-000000000001',2197,'고1','영어',
  '92023000-0000-4000-8000-000000000001','본교재 계획 범위',0
), (
  '92024000-0000-4000-8000-000000000002',2197,'고1','수학',
  '92023000-0000-4000-8000-000000000002','섞이면 안 되는 고1 계획',0
), (
  '92024000-0000-4000-8000-000000000003',2197,'고3','수학',
  '92023000-0000-4000-8000-000000000003','섞이면 안 되는 고3 계획',0
), (
  '92024000-0000-4000-8000-000000000004',2197,'고3','수학',
  '92023000-0000-4000-8000-000000000004','명시 연결 고3 계획',1
);

insert into public.academic_curriculum_profiles(
  id,academic_year,school_id,grade,subject,main_textbook_title,main_textbook_publisher,note
)
values (
  '92025000-0000-4000-8000-000000000001',2197,
  '92000000-0000-4000-8000-000000000002','고1','수학','수학 프로필 본교재','프로필 출판','프로필 범위'
);

insert into public.academic_supplement_materials(
  id,profile_id,title,publisher,note,sort_order
)
values (
  '92026000-0000-4000-8000-000000000001',
  '92025000-0000-4000-8000-000000000001','수학 프로필 부교재','부교재 출판','부교재 범위',0
);

update public.academic_event_exam_details
set curriculum_profile_id = '92025000-0000-4000-8000-000000000001',
    supplement_scope = '부교재 3단원'
where id = '92022000-0000-4000-8000-000000000001';

update public.academic_event_exam_details
set academy_curriculum_plan_id = '92024000-0000-4000-8000-000000000004',
    supplement_scope = '부교재 5단원'
where id = '92022000-0000-4000-8000-000000000002';

insert into public.academic_exam_material_plans(
  id,academic_year,subject,school_id,grade,exam_period_code,note,sort_order
)
values
  (
    '92027000-0000-4000-8000-000000000001',2197,'영어',
    '92000000-0000-4000-8000-000000000002','고1','semester_1_midterm','중간 계획',0
  ),
  (
    '92027000-0000-4000-8000-000000000002',2197,'영어',
    '92000000-0000-4000-8000-000000000002','고1','semester_1_final','기말 계획',0
  );

insert into public.academic_exam_material_items(
  id,plan_id,material_category,title,publisher,scope_detail,note,sort_order
)
values
  (
    '92028000-0000-4000-8000-000000000001','92027000-0000-4000-8000-000000000001',
    'supplement','중간 전용 자료','기간 출판','1~20쪽','중간만',0
  ),
  (
    '92028000-0000-4000-8000-000000000002','92027000-0000-4000-8000-000000000002',
    'supplement','기말 전용 자료','기간 출판','21~40쪽','기말만',0
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
  3,
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
  (select entry ->> 'examTerm' from operations_annual_meta_entries where entry ->> 'id' = 'exam-detail:92022000-0000-4000-8000-000000000002' limit 1),
  '2학기 기말',
  'derived subject rows infer renderer-ready term from the original parent event title'
);
select ok(
  (select (entry -> 'materialSections')::text like '%중간 전용 자료%'
      and (entry -> 'materialSections')::text not like '%기말 전용 자료%'
      and (entry -> 'materialSections')::text like '%영어 본교재%'
   from operations_annual_meta_entries
   where entry ->> 'parentEventId' = '92021000-0000-4000-8000-000000000001'
     and entry ->> 'type' = '영어시험일'
     and entry ->> 'grade' = '고1'
   limit 1),
  'annual fallback maps only the matching exam period and includes a main textbook without child materials'
);
select ok(
  (select (entry -> 'materialSections')::text like '%수학 프로필 본교재%'
      and (entry -> 'materialSections')::text like '%수학 프로필 부교재%'
      and (entry -> 'materialSections')::text like '%10~30쪽%'
      and (entry -> 'materialSections')::text not like '%섞이면 안 되는 고1 수학 교재%'
      and entry ->> 'curriculumProfileId' = '92025000-0000-4000-8000-000000000001'
      and entry ->> 'textbookScope' = '10~30쪽'
      and entry ->> 'subtextbookScope' = '부교재 3단원'
      and entry #>> '{textbookScopes,0,name}' = '수학 프로필 본교재'
      and entry #>> '{textbookScopes,0,scope}' = '10~30쪽'
      and entry #>> '{subtextbookScopes,0,name}' = '수학 프로필 부교재'
      and entry #>> '{subtextbookScopes,0,scope}' = '부교재 3단원'
   from operations_annual_meta_entries
   where entry ->> 'parentEventId' = '92021000-0000-4000-8000-000000000001'
     and entry ->> 'type' = '수학시험일'
     and entry ->> 'grade' = '고1'
   limit 1),
  'annual subject rows preserve detail scopes plus profile textbook and supplement renderer sources'
);
select ok(
  (select (entry -> 'materialSections')::text like '%명시 연결 고3 수학 교재%'
      and (entry -> 'materialSections')::text not like '%섞이면 안 되는 고3 수학 교재%'
      and entry ->> 'academyCurriculumPlanId' = '92024000-0000-4000-8000-000000000004'
      and entry #>> '{textbookScopes,0,name}' = '명시 연결 고3 수학 교재'
      and entry #>> '{textbookScopes,0,scope}' = '40~60쪽'
   from operations_annual_meta_entries
   where entry ->> 'parentEventId' = '92021000-0000-4000-8000-000000000002'
     and entry ->> 'type' = '수학시험일'
     and entry ->> 'grade' = '고3'
   limit 1),
  'annual subject rows prefer an explicit academy plan over the first generic grade-subject plan'
);
select is(
  public.get_academic_event_detail_v1('92021000-0000-4000-8000-000000000001') ->> 'storedNote',
  E'보이는 메모\n\n[[TIPS_META]] {"examTerm":"1학기 중간","scienceAreaKey":"physics","legacyFlag":"keep"}',
  'event exact detail returns the lossless stored note payload'
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
  ('92030000-0000-4000-8000-' || pg_catalog.lpad(ordinal::text,12,'0'))::uuid,
  '__operations_class__ ' || pg_catalog.lpad(ordinal::text,2,'0'),
  '정규',
  case when ordinal = 31 then '과학' else '수학' end,
  case when ordinal = 31 then 'physics' else null end,
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
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.get_operations_class_schedule_page_v1(jsonb,text,uuid,integer)'::pg_catalog.regprocedure),
    'schedule_plan'
  ) = 0,
  'class list function does not read the schedule plan detail payload'
);

select is(
  public.get_operations_class_lesson_design_detail_v1('92030000-0000-4000-8000-000000000001') #>> '{classItem,schedulePlan}',
  '{}',
  'class lesson design exact detail hydrates the stored legacy schedule plan'
);

with evidence as (
  select
    pg_temp.dashboard_explain_v1($sql$
      select public.get_operations_class_schedule_page_v1(
        jsonb_build_object('termId',null,'search','__operations_class__','subject',null,'grade','고2','teacher','검증 교사','syncGroupId',null),null,null,30
      )
    $sql$) as first_plan,
    pg_temp.dashboard_explain_v1($sql$
      with boundary as (
        select row ->> 'sort_key' sort_key,(row ->> 'id')::uuid id
        from operations_class_first_page
        order by row ->> 'sort_key' collate dashboard_private.ko_numeric,(row ->> 'id')::uuid offset 29 limit 1
      )
      select public.get_operations_class_schedule_page_v1(
        jsonb_build_object('termId',null,'search','__operations_class__','subject',null,'grade','고2','teacher','검증 교사','syncGroupId',null),boundary.sort_key,boundary.id,30
      ) from boundary
    $sql$) as next_plan,
    pg_temp.dashboard_explain_v1($sql$
      select public.get_operations_class_lesson_design_detail_v1('92030000-0000-4000-8000-000000000001'::uuid)
    $sql$) as detail_plan,
    pg_catalog.octet_length(public.get_operations_class_schedule_page_v1(
      pg_catalog.jsonb_build_object('termId',null,'search','__operations_class__','subject',null,'grade','고2','teacher','검증 교사','syncGroupId',null),null,null,30
    )::text) as first_bytes
)
select ok(
  first_plan #>> '{0,Execution Time}' is not null
  and next_plan #>> '{0,Execution Time}' is not null
  and detail_plan #>> '{0,Execution Time}' is not null
  and first_bytes between 1 and 262144,
  'operations first page, continuation, and exact detail emit ANALYZE/BUFFERS plans with a bounded response'
) from evidence;

select finish();
rollback;
