begin;
select no_plan();
select ok((select convalidated from pg_constraint where conrelid='public.classes'::regclass and conname='classes_textbook_usage_valid'),'textbook usage constraint is validated by the separate final migration');
set local timezone='Asia/Seoul';
set local statement_timeout='45s';
create function pg_temp.fid(n integer) returns uuid language sql immutable as $$
 select ('cc220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.filters(extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('periodId',null,'search','__schedule_only__','status',null,'subject',null,'grade',null,'teacher',null,'classroom',null,'viewMode','all')||extra
$$;
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(pg_temp.fid(900),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','schedule-only@example.invalid','{}','{}',now(),now()),
(pg_temp.fid(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','schedule-viewer@example.invalid','{}','{}',now(),now());
insert into public.profiles(id,role,name,email) values(pg_temp.fid(900),'admin','합성 일정 관리자','schedule-only@example.invalid'),(pg_temp.fid(901),'viewer','합성 조회자','schedule-viewer@example.invalid')
on conflict(id) do update set role=excluded.role;
select set_config('request.jwt.claim.sub',pg_temp.fid(900)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fid(900),'role','authenticated')::text,true);
set local role authenticated;
select lives_ok($$select public.create_class_with_group_memberships_v1(jsonb_build_object('id',pg_temp.fid(1),'name','__schedule_only__ legacy','status','수강','textbook_ids',jsonb_build_array(pg_temp.fid(700)),'textbook_usage',jsonb_build_object(pg_temp.fid(700)::text,jsonb_build_object('startDate','2028-02-29','endDate','2028-03-31','title','기존 교재'))),'{}'::uuid[])$$,'class creation accepts canonical textbook usage without a period');
select is(public.get_management_detail_v1('classes',pg_temp.fid(1))#>>array['record','textbookUsage',pg_temp.fid(700)::text,'startDate'],'2028-02-29','management reader round-trips book dates');
select throws_ok($$update public.classes set textbook_usage=jsonb_build_object(pg_temp.fid(700)::text,jsonb_build_object('startDate','2026-02-29')) where id=pg_temp.fid(1)$$,'23514',null,'impossible calendar date is a check violation');
select throws_ok($$update public.classes set textbook_usage=jsonb_build_object(pg_temp.fid(700)::text,jsonb_build_object('startDate','2026-10-01','endDate','2026-09-01')) where id=pg_temp.fid(1)$$,'23514',null,'reversed usage is a check violation');
select lives_ok($$update public.classes set textbook_usage=jsonb_build_object(pg_temp.fid(700)::text,jsonb_build_object('startDate','','endDate',null)) where id=pg_temp.fid(1)$$,'open dates remain optional');
select lives_ok($$update public.classes set textbook_ids='[]' where id=pg_temp.fid(1)$$,'old clients can remove a book without sending usage');
select is((select textbook_usage from public.classes where id=pg_temp.fid(1)),'{}'::jsonb,'removal prunes only obsolete usage');
reset role;
insert into public.classes(id,name,status,schedule_storage_mode,schedule_plan) values
(pg_temp.fid(2),'__schedule_only__ shadow','수강','shadow','{}'),
(pg_temp.fid(3),'__schedule_only__ normalized','수강','normalized','{}'),
(pg_temp.fid(4),'__schedule_only__ expired','수강','legacy','{}'),
(pg_temp.fid(5),'__schedule_only__ empty','수강','legacy','{}');
update public.classes set schedule_plan=jsonb_build_object('textbooks',jsonb_build_array(jsonb_build_object('textbookId',pg_temp.fid(700))),'sessions',jsonb_build_array(
 jsonb_build_object('id','legacy:future','sessionKey','legacy:future','date',(current_date+10)::text,'state','active'),
 jsonb_build_object('id','legacy:past','date',(current_date-10)::text,'state','active'),
 jsonb_build_object('id','legacy:invalid','date','2026-02-31','state','active')
)) where id in(pg_temp.fid(1),pg_temp.fid(2),pg_temp.fid(3));
update public.classes set schedule_plan=jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','past','date',(current_date-10)::text,'state','active'))) where id=pg_temp.fid(4);
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(class_id,session_key,session_date,schedule_state,origin) values
(pg_temp.fid(2),'ignored-shadow',current_date+2,'active','manual'),
(pg_temp.fid(3),'normalized-future',current_date+3,'active','manual'),
(pg_temp.fid(3),'skipped',current_date+2,'skipped','manual');
set local role authenticated;
create temporary table result as select public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),1,10,true) as data;
select is((select (r->>'totalSessions')::int from result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(1)::text),2,'legacy count comes from valid saved sessions');
select is((select (r->>'totalSessions')::int from result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(2)::text),2,'shadow does not double count normalized copies');
select is((select (r->>'totalSessions')::int from result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(3)::text),1,'normalized storage uses authoritative rows and excludes skipped sessions');
select is((select r#>>'{nextSession,sessionId}' from result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(1)::text),'legacy:future','legacy keys survive in next-session DTO');
select is((select r->>'stateLabel' from result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(1)::text),'일정 편성','book assignments do not determine schedule readiness');
select is((select r->>'stateLabel' from result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(4)::text),'일정 연장 필요','past-only active class needs a new schedule');
select is((select data#>>'{stats,noScheduleClassCount}' from result),'1','only truly empty class is unscheduled');
select is(public.get_academic_curriculum_numbered_page_v2(pg_temp.filters('{"viewMode":"update"}'),1,10,true)->>'totalCount','1','schedule queue filters on expired schedules');
select is(public.get_operations_class_lesson_design_detail_v1(pg_temp.fid(1))->'textbooks','[]'::jsonb,'scheduling detail does not load a textbook catalog');
reset role;
select ok(not has_function_privilege('anon','public.get_academic_curriculum_numbered_page_v2(jsonb,integer,integer,boolean)','execute'),'anonymous cannot read schedules');
select ok(not p.prosecdef and p.proconfig in(array['search_path='],array['search_path=""']),'final schedule reader stays security invoker with fixed search path') from pg_proc p where oid='public.get_academic_curriculum_numbered_page_v2(jsonb,integer,integer,boolean)'::regprocedure;
select set_config('request.jwt.claim.sub',pg_temp.fid(901)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fid(901),'role','authenticated')::text,true);
set local role authenticated;
select lives_ok($$update public.classes set textbook_ids=jsonb_build_array(pg_temp.fid(701)) where id=pg_temp.fid(1)$$,'viewer update is filtered by RLS');
reset role;
select is((select textbook_ids from public.classes where id=pg_temp.fid(1)),'[]'::jsonb,'viewer cannot change class textbook data');
reset role;
select * from finish();
rollback;
