begin;
select no_plan();
select has_function('public','get_academic_curriculum_numbered_page_v1',array['jsonb','integer','integer','boolean'],'numbered academic API exists');
select has_function('public','get_operations_class_schedule_numbered_page_v1',array['jsonb','integer','integer'],'numbered planning API exists');
set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';

create function pg_temp.fid(n integer) returns uuid language sql immutable as $$
  select ('ab000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.af(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('periodId',pg_temp.fid(901),'search','__numbered__ 수업','status',null,'subject',null,'grade',null,'teacher',null,'classroom',null,'viewMode','all') || extra
$$;
create function pg_temp.of(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('termId',null,'search','__numbered__ 수업','subject',null,'grade',null,'teacher',null,'syncGroupId',null) || extra
$$;
-- The fixture writers never call intake, scheduling, notification or provider RPCs.
create temp table no_send_before as select
  (select count(*) from dashboard_private.notification_deliveries) deliveries,
  (select count(*) from public.ops_tasks) tasks;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values (pg_temp.fid(900),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','secondary-numbered@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.profiles(id,role,name,email,created_at,updated_at)
values (pg_temp.fid(900),'admin','번호 목록 검증자','secondary-numbered@example.invalid',now(),now())
on conflict(id) do update set role='admin',name=excluded.name;
select set_config('request.jwt.claim.sub',pg_temp.fid(900)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fid(900),'role','authenticated')::text,true);

update public.class_schedule_sync_groups set is_default=false where is_default;
insert into public.class_schedule_sync_groups(id,name,subject,color,is_default,sort_order) values
  (pg_temp.fid(901),'__numbered_period_A__','수학','#3182f6',true,-1001),
  (pg_temp.fid(902),'__numbered_period_B__','수학','#3182f6',false,-1002);
insert into public.class_terms(id,academic_year,name,status,sort_order) values
  (pg_temp.fid(911),2199,'__numbered_term_Z__','수업 진행 중',1),
  (pg_temp.fid(912),2199,'__numbered_term_A__','개강 준비 중',0);
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,term_id,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan,created_at)
select pg_temp.fid(n),'__numbered__ 수업 ' || case when n=11 then 10 else n end,'정규','수학','고1',
  case when n=1 then '검증 교사 / 보조 교사' when n=2 then '검증 교사님' when n=3 then E'검증 교사\n보조 교사' else '검증 교사' end,
  '월 18:00-19:00',case when n=2 then '별4' else '본3' end,12,320000,
  case when n=111 then '개강 준비 중' else '수강' end,
  case when n=11 then pg_temp.fid(912) else pg_temp.fid(911) end,'[]','[]','[]','[]','{}',null
from generate_series(1,111) n;
insert into public.class_schedule_sync_group_members(group_id,class_id,sort_order)
select pg_temp.fid(901),pg_temp.fid(n),0 from generate_series(1,111) n;
insert into public.class_schedule_sync_group_members(group_id,class_id,sort_order) values
  (pg_temp.fid(902),pg_temp.fid(1),1),(pg_temp.fid(902),pg_temp.fid(111),-1);

insert into public.textbooks(id,title,name,subject,school_level,grade_level,school_levels,grade_levels,sub_subject,publisher,price,tags,lessons,status)
values(pg_temp.fid(920),'번호 검증 교재','번호 검증 교재','math','high','h3',array['high'],array['h3'],'math','검증 출판',10000,'{}','[]','active');
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,term_id,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
select pg_temp.fid(n),'__states__ ' || n,'정규','수학',case when n=201 then '고2' else '고3' end,'상태 교사','','별4',12,320000,'수강',pg_temp.fid(911),
  '[]','[]',case when n>=203 then jsonb_build_array(pg_temp.fid(920)) else '[]'::jsonb end,'[]','{}'
from generate_series(201,204) n;
insert into public.class_schedule_sync_group_members(group_id,class_id,sort_order)
select pg_temp.fid(901),pg_temp.fid(n),0 from generate_series(201,204) n;
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
values
 (pg_temp.fid(301),'[가] 수업 10','정규','__order__','고1','정렬 교사','','본3',12,320000,'수강','[]','[]','[]','[]','{}'),
 (pg_temp.fid(302),'[나] 수업 2','정규','__order__','고1','정렬 교사','','본3',12,320000,'수강','[]','[]','[]','[]','{}');
insert into public.class_schedule_sync_group_members(group_id,class_id,sort_order) values
 (pg_temp.fid(901),pg_temp.fid(301),0),(pg_temp.fid(901),pg_temp.fid(302),0);
set constraints all immediate;

select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_name_snapshot,classroom_name_snapshot,origin,revision) values
 (pg_temp.fid(401),pg_temp.fid(201),'numbered-skipped','2199-01-01','skipped',null,null,'상태 교사','별4','manual',1),
 (pg_temp.fid(402),pg_temp.fid(202),'numbered-unlinked','2199-01-02','active',null,null,'상태 교사','별4','manual',1),
 (pg_temp.fid(403),pg_temp.fid(203),'numbered-planned','2199-01-03','active',null,null,'상태 교사','별4','manual',1),
 (pg_temp.fid(404),pg_temp.fid(203),'numbered-next','2199-01-04','active',null,null,'상태 교사','별4','manual',1),
 (pg_temp.fid(405),pg_temp.fid(204),'numbered-done','2199-01-05','active',null,null,'상태 교사','별4','manual',1);
select set_config('app.class_schedule_mutation','',true);
insert into public.progress_logs(id,class_id,textbook_id,session_id,progress_key,status,content,date,updated_at) values
 (pg_temp.fid(501),pg_temp.fid(203),pg_temp.fid(920),null,'numbered-planned','partial','','2199-01-03',now()),
 (pg_temp.fid(502),pg_temp.fid(203),pg_temp.fid(920),null,'numbered-pending','pending','','2199-01-04',now()),
 (pg_temp.fid(503),pg_temp.fid(204),pg_temp.fid(920),pg_temp.fid(405)::text,'numbered-done-a','done','','2199-01-05',now()),
 (pg_temp.fid(504),pg_temp.fid(204),pg_temp.fid(920),pg_temp.fid(405)::text,'numbered-done-b','partial','','2199-01-05',now()),
 (pg_temp.fid(505),pg_temp.fid(204),pg_temp.fid(920),null,null,'done','','2199-01-05',now());

with signatures(signature) as (values
 ('public.get_academic_curriculum_numbered_page_v1(jsonb,integer,integer,boolean)'),
 ('public.get_operations_class_schedule_numbered_page_v1(jsonb,integer,integer)'))
select ok(not p.prosecdef and p.proconfig in (array['search_path='],array['search_path=""'])
  and has_function_privilege('authenticated',signature,'EXECUTE') and not has_function_privilege('anon',signature,'EXECUTE') and not has_function_privilege('public',signature,'EXECUTE'),
  signature || ' preserves invoker fixed path and exact ACL')
from signatures join pg_proc p on p.oid=signature::regprocedure;
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='classes' and policyname='classes_authenticated_select_v2' and qual='true'),'final classes authenticated visibility is not invented owner-only');

set local role authenticated;
create temp table academic_first as select public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),1,10) data;
create temp table academic_eleven as select public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),11,10) data;
create temp table planning_first as select public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),1,10) data;
create temp table planning_eleven as select public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),11,10) data;
select is((data->>'totalCount')::integer,111,'academic all-filter count is 111, not page length') from academic_eleven;
select is((data->>'totalCount')::integer,111,'planning all-filter count is 111') from planning_eleven;
select is(data#>>'{rows,0,id}',pg_temp.fid(101)::text,'academic direct page11 starts at literal numeric class101') from academic_eleven;
select is(data#>>'{rows,0,id}',pg_temp.fid(101)::text,'planning direct page11 starts at literal numeric class101') from planning_eleven;
select is(data#>>'{rows,1,fullTitle}','__numbered__ 수업 2','academic numeric 2 precedes10') from academic_first;
select is(data#>>'{rows,1,name}','__numbered__ 수업 2','planning numeric 2 precedes10') from planning_first;
select is(data#>>'{rows,9,id}',pg_temp.fid(10)::text,'academic tie first ID ends page1') from academic_first;
select is(data#>>'{rows,9,id}',pg_temp.fid(10)::text,'planning tie first ID ends page1') from planning_first;
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),2,10)#>>'{rows,0,id}',pg_temp.fid(11)::text,'academic equal name/different term tie continues with id11');
select is(public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),2,10)#>>'{rows,0,id}',pg_temp.fid(11)::text,'planning equal name/different term tie continues with id11');
select is(jsonb_array_length(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),12,10)->'rows'),1,'academic partial final page');
select is(jsonb_array_length(public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),12,10)->'rows'),1,'planning partial final page');
select is(jsonb_array_length(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),13,10)->'rows'),0,'academic out-of-range empty');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),13,10)->>'totalCount')::integer,111,'planning out-of-range keeps count');
select is((public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"search":"no-fixture-match"}'),1,10)->>'totalCount')::integer,0,'academic empty search count');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of('{"search":"no-fixture-match"}'),1,10)->>'totalCount')::integer,0,'planning empty search count');
select is(jsonb_array_length(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),1,size)->'rows'),size,'academic size '||size) from unnest(array[10,15,20]) size;
select is(jsonb_array_length(public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),1,size)->'rows'),size,'planning size '||size) from unnest(array[10,15,20]) size;
select ok(not (row ?| array['row_data','sort_key','schedule_plan','schedulePlan','progressRows','scheduleRows']), 'academic row is flat without histories') from academic_first cross join lateral jsonb_array_elements(data->'rows') row;
select ok(not (row ?| array['row_data','sort_key','schedule_plan','schedulePlan','progressRows','scheduleRows']), 'planning row is flat without histories') from planning_first cross join lateral jsonb_array_elements(data->'rows') row;
select is(data#>'{rows,0,updatedAt}','null'::jsonb,'planning nullable created_at remains null') from planning_first;

-- Each class credits only its chosen group, but catalog order remains B then A.
select is(data#>>'{syncGroupCounts,0,groupId}',pg_temp.fid(902)::text,'group facet preserves catalog order B first') from planning_eleven;
select is(data#>>'{syncGroupCounts,0,memberCount}','1','B credits class111 only without selected group') from planning_eleven;
select is(data#>>'{syncGroupCounts,0,representativeClassId}',pg_temp.fid(111)::text,'representative may be outside current page') from planning_eleven;
select is(data#>>'{syncGroupCounts,1,memberCount}','110','A credits110 classes, not all memberships') from planning_eleven;
select is(data#>>'{syncGroupCounts,1,representativeClassId}',pg_temp.fid(1)::text,'A representative is first in full SQL order') from planning_eleven;
select is((select data->'syncGroupCounts' from planning_first),(select data->'syncGroupCounts' from planning_eleven),'facets unchanged between pages1 and11');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(jsonb_build_object('syncGroupId',pg_temp.fid(902))),1,10)#>>'{syncGroupCounts,0,memberCount}')::integer,2,'selected B prefers B for both classes');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(jsonb_build_object('syncGroupId',pg_temp.fid(902),'search','수업 111','teacher','검증 교사','subject','수학','grade','고1','termId',pg_temp.fid(911))),1,10)->>'totalCount')::integer,1,'all six planning filters intersect');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(jsonb_build_object('syncGroupId',pg_temp.fid(902),'search','수업 111','teacher','검증 교사')),1,10)#>>'{syncGroupCounts,0,memberCount}')::integer,1,'group counts keep search/teacher/selected group filters');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(jsonb_build_object('termId',pg_temp.fid(912))),1,10)->>'totalCount')::integer,1,'planning term filter selects one equal-name class');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of('{"teacher":"검증 교사"}'),1,10)->>'totalCount')::integer,110,'planning exact split-token teacher includes newline but excludes suffix');
select is((public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"teacher":"교사"}'),1,10)->>'totalCount')::integer,111,'academic substring teacher includes suffix');
select is((public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"classroom":"본관 3강"}'),1,10)->>'totalCount')::integer,110,'academic classroom aliases include 본3 but exclude 별4');
select is((public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"status":"개강 준비"}'),1,10)->>'totalCount')::integer,1,'academic status normalization');
select is((public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"search":"수업 111","status":"개강 준비","subject":"수학","grade":"고1","teacher":"검증 교사","classroom":"본관 3강","viewMode":"unscheduled"}'),1,10)->>'totalCount')::integer,1,'all eight academic filters intersect');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of('{"subject":"영어"}'),1,10)->>'totalCount')::integer,0,'planning negative subject');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of('{"grade":"고2"}'),1,10)->>'totalCount')::integer,0,'planning negative grade');
select is((public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"subject":"영어"}'),1,10)->>'totalCount')::integer,0,'academic negative subject');
select is((public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"grade":"고2"}'),1,10)->>'totalCount')::integer,0,'academic negative grade');
select is((public.get_operations_class_schedule_numbered_page_v1(pg_temp.of('{"search":"__numbered_term_Z__"}'),1,10)->>'totalCount')::integer,114,'planning search includes term label');
select is((public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"search":"__numbered_term_Z__"}'),1,10)->>'totalCount')::integer,0,'academic search does not add term label');
select is(data#>>'{stats,active}','110','planning raw active status count') from planning_first;
select is(data#>>'{stats,draft}','1','planning raw draft status count') from planning_first;
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"search":"","subject":"__order__"}'),1,10)#>>'{rows,0,title}','수업 10','academic preserves full bracket-prefix order, not display-title order');
select is(public.get_operations_class_schedule_numbered_page_v1(pg_temp.of('{"search":"","subject":"__order__"}'),1,10)#>>'{rows,0,id}',pg_temp.fid(301)::text,'planning preserves full bracket-prefix order');

create temp table states as select public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"search":"__states__"}'),1,10) data;
select is(data#>>'{stats,viewModeCounts,all}','4','all four classified candidates counted') from states;
select is(data#>>'{stats,viewModeCounts,unscheduled}','1','skipped-only class is unscheduled before unlinked') from states;
select is(data#>>'{stats,viewModeCounts,unlinked}','1','scheduled class without books is unlinked') from states;
select is(data#>>'{stats,viewModeCounts,update}','1','partial planned vs2 sessions needs update') from states;
select is(data#>>'{stats,viewModeCounts,done}','1','distinct completed class is done') from states;
select is(data#>>'{rows,2,nextSession,sessionId}',pg_temp.fid(404)::text,'selected-page next session skips session-key match') from states;
select is(data#>>'{rows,2,nextSession,sessionKey}','numbered-next','next session key is retained') from states;
select is(data#>>'{rows,2,nextSession,periodLabel}','','nullable session times produce empty period label') from states;
select is(data#>>'{rows,2,plannedSessions}','1','pending logs excluded from planned count') from states;
select is(data#>>'{rows,3,plannedSessions}','2','same session_id dedupes and null key falls back to log ID') from states;
select is(data#>>'{rows,3,progressPercent}','200','legacy planned aggregate may exceed100 percent') from states;
select is(data#>'{rows,3,nextSession}','null'::jsonb,'UUID-text session match leaves no next session') from states;
create temp table update_view as select public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"search":"__states__","viewMode":"update"}'),1,10) data;
select is(data->>'totalCount','1','selected view total is filtered') from update_view;
select is(data#>>'{stats,totalSessions}','2','selected-view stats use filtered candidates') from update_view;
select is(data#>>'{stats,viewModeCounts,all}','4','view counts remain pre-view') from update_view;
select is(data#>'{filterOptions,grades}','["고2","고3"]'::jsonb,'options use base before view selection') from update_view;
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"periodId":"__numbered_period_A__"}'),11,10)->>'resolvedPeriodId','__numbered_period_A__','explicit period name alias remains selector');
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"periodId":null}'),11,10)->>'resolvedPeriodId',pg_temp.fid(901)::text,'absent period resolves deterministic default UUID');
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),11,10,false)->'stats','null'::jsonb,'metadata false stats explicit null');
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),11,10,false)->'filterOptions','null'::jsonb,'metadata false options explicit null');
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),11,10,false)->>'totalCount','111','metadata false count still fresh');
reset role;
update public.class_schedule_sync_groups set is_default=false where is_default;
update public.class_schedule_sync_groups set is_default=true where id=pg_temp.fid(902);
set local role authenticated;
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),11,10,false)->>'resolvedPeriodId',pg_temp.fid(901)::text,'pinned period unchanged after default mutation');
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"periodId":null}'),1,10)->>'totalCount','2','new absent scope follows new default');

-- Guard validation before object expansion and offset arithmetic; exact SQLSTATE.
select throws_ok(format('select public.get_academic_curriculum_numbered_page_v1(%L::jsonb,1,10)',bad),'22023',null,'academic rejects invalid JSON/filter shape')
from unnest(array['null','[]','1','{}','{"search":true}']) bad;
select throws_ok(format('select public.get_operations_class_schedule_numbered_page_v1(%L::jsonb,1,10)',bad),'22023',null,'planning rejects invalid JSON/filter shape')
from unnest(array['null','[]','1','{}','{"search":true}']) bad;
select throws_ok($$select public.get_academic_curriculum_numbered_page_v1(null,1,10)$$,'22023',null,'academic SQL-null filters');
select throws_ok($$select public.get_operations_class_schedule_numbered_page_v1(null,1,10)$$,'22023',null,'planning SQL-null filters');
select throws_ok(format('select public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),%s,10)',coalesce(p::text,'null')),'22023',null,'academic invalid page') from unnest(array[null,0,-1]) p;
select throws_ok(format('select public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),%s,10)',coalesce(p::text,'null')),'22023',null,'planning invalid page') from unnest(array[null,0,-1]) p;
select throws_ok(format('select public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),1,%s)',coalesce(s::text,'null')),'22023',null,'academic invalid page size') from unnest(array[null,5,30]) s;
select throws_ok(format('select public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),1,%s)',coalesce(s::text,'null')),'22023',null,'planning invalid page size') from unnest(array[null,5,30]) s;
select throws_ok($$select public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),1,10,null)$$,'22023',null,'metadata flag cannot be null');
select throws_ok($$select public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"viewMode":"invalid"}'),1,10)$$,'22023',null,'invalid view enum');
select throws_ok($$select public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"status":"invalid"}'),1,10)$$,'22023',null,'invalid status enum');
select throws_ok($$select public.get_academic_curriculum_numbered_page_v1(pg_temp.af('{"extra":"asc"}'),1,10)$$,'22023',null,'academic unknown filters rejected');
select throws_ok($$select public.get_operations_class_schedule_numbered_page_v1(pg_temp.of('{"extra":"asc"}'),1,10)$$,'22023',null,'planning unknown filters rejected');
select throws_ok($$select public.get_operations_class_schedule_numbered_page_v1(pg_temp.of('{"termId":"not-uuid"}'),1,10)$$,'22023',null,'planning invalid term selector');
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),2147483647,20)->>'totalCount','111','bigint offset avoids integer overflow for maximum input');
select is(public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),2147483647,20)->>'totalCount','111','planning bigint offset avoids overflow');

-- Same read under a non-owner teacher actor/profile role, consistent with final RLS.
reset role;
update public.profiles set role='teacher' where id=pg_temp.fid(900);
set local role authenticated;
select is(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),11,10)->>'totalCount','111','teacher sees classes under final authenticated SELECT policy');
select is(public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),11,10)->>'totalCount','111','planning teacher RLS parity');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok($$select public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),1,10)$$,'42501',null,'anonymous academic execute denied');
select throws_ok($$select public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),1,10)$$,'42501',null,'anonymous planning execute denied');
reset role;
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send_before),'no notification deliveries from seeds or reads');
select is((select count(*) from public.ops_tasks),(select tasks from no_send_before),'no operational tasks from seeds or reads');
select * from finish();
rollback;
