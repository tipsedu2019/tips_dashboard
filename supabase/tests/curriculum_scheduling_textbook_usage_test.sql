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
-- Reproduce a class with a valid audit predecessor from before the new column.
insert into public.classes(id,name,status) values(pg_temp.fid(801),'__schema_event_fixture__','개강 준비');
update public.dashboard_audit_logs set
  after_record=after_record-'textbook_usage',
  after_hash=encode(extensions.digest((after_record-'textbook_usage')::text,'sha256'),'hex')
where entity_table='classes' and entity_id=pg_temp.fid(801)::text;
create temporary table schema_predecessor as select * from public.dashboard_audit_logs where entity_table='classes' and entity_id=pg_temp.fid(801)::text;
select lives_ok($$select dashboard_private.append_class_textbook_usage_schema_event_v1(pg_temp.fid(801))$$,'new column appends a schema event without resetting the audit chain');
create temporary table schema_event as select * from public.dashboard_audit_logs where entity_table='classes' and entity_id=pg_temp.fid(801)::text order by event_sequence desc limit 1;
select is((select audit_chain_id from schema_event),(select audit_chain_id from schema_predecessor),'schema event retains original chain identity');
select is((select predecessor_event_id from schema_event),(select id from schema_predecessor),'schema event points to the actual predecessor');
select is((select before_hash from schema_event),(select after_hash from schema_predecessor),'schema event retains hash continuity');
select is((select chain_ordinal from schema_event),(select chain_ordinal+1 from schema_predecessor),'schema event advances one ordinal');
select is((select after_record from public.dashboard_audit_logs where id=(select id from schema_predecessor)),(select after_record from schema_predecessor),'schema transition leaves original audit row unchanged');
select is((select dashboard_private.dashboard_audit_forward_patch_v2(p.after_record,e.change_patch) from schema_predecessor p,schema_event e),(select to_jsonb(c) from public.classes c where id=pg_temp.fid(801)),'forward schema patch reconstructs the complete new row');
select is((select dashboard_private.dashboard_audit_reverse_patch_v2(to_jsonb(c),e.change_patch) from public.classes c,schema_event e where c.id=pg_temp.fid(801)),(select after_record from schema_predecessor),'reverse schema patch removes the formerly absent key');
select lives_ok($$select dashboard_private.append_class_textbook_usage_schema_event_v1(pg_temp.fid(801))$$,'repeating an already-recorded transition is idempotent');
select is((select count(*)::int from public.dashboard_audit_logs where entity_table='classes' and entity_id=pg_temp.fid(801)::text),2,'idempotent transition writes no duplicate event');
select lives_ok($$update public.classes set name='__schema_event_fixture_updated__' where id=pg_temp.fid(801)$$,'ordinary class mutation continues through the unchanged strict audit trigger');
select is(dashboard_private.dashboard_audit_reverse_patch_v2('{"a":2}'::jsonb,'{"a":{"before":null,"after":2}}'::jsonb),'{"a":null}'::jsonb,'ordinary historical patches still distinguish SQL-key absence from JSON null');
update public.dashboard_audit_logs set after_hash='corrupt-fixture' where entity_table='classes' and entity_id=pg_temp.fid(801)::text and event_sequence=(select max(event_sequence) from public.dashboard_audit_logs where entity_table='classes' and entity_id=pg_temp.fid(801)::text);
select throws_ok($$select dashboard_private.append_class_textbook_usage_schema_event_v1(pg_temp.fid(801))$$,'55000','audit_chain_continuity_invalid','schema transition refuses unrelated corrupt history');
select throws_ok($$update public.classes set name='should-not-save' where id=pg_temp.fid(801)$$,'55000','audit_chain_continuity_invalid','normal class writes still fail closed on audit corruption');
select ok(not has_function_privilege('authenticated','dashboard_private.append_class_textbook_usage_schema_event_v1(uuid)','execute'),'authenticated users cannot invoke the migration-only schema event');
select ok(not has_function_privilege('service_role','dashboard_private.append_class_textbook_usage_schema_event_v1(uuid)','execute'),'service role cannot invoke the migration-only schema event');

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

-- Reader optimization must preserve saved-date validation, storage precedence,
-- state normalization, next-session identity and the exact last-update value.
select set_config('request.jwt.claim.sub',pg_temp.fid(900)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fid(900),'role','authenticated')::text,true);
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}',schedule_plan->'sessions'||jsonb_build_array(
 jsonb_build_object('id','bad-empty','date',''),
 jsonb_build_object('id','bad-null','date',null),
 jsonb_build_object('id','bad-format','date','2028-2-1'),
 jsonb_build_object('id','bad-number','date',123),
 jsonb_build_object('id','ignored-skipped','date',(current_date+1)::text,'state','skipped'),
 jsonb_build_object('id','legacy:force','date',(current_date+2)::text,'state','force_active'),
 jsonb_build_object('id','legacy:makeup','date',(current_date-5)::text,'state','makeup'),
 jsonb_build_object('id','legacy:exception','date',(current_date+4)::text,'scheduleState','exception','state','skipped'),
 jsonb_build_object('sessionKey','legacy:tbd','date',(current_date+3)::text,'state','tbd'),
 jsonb_build_object('id','legacy:default','date',(current_date+6)::text)
)) where id=pg_temp.fid(1);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,origin,updated_at) values
(pg_temp.fid(950),pg_temp.fid(3),'newer-active',current_date+5,'active','manual','2098-01-01T00:00:00Z'),
(pg_temp.fid(951),pg_temp.fid(3),'newest-skipped',current_date+1,'skipped','manual','2099-01-01T00:00:00Z');
set local role authenticated;
create temporary table optimized_result as select public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),1,10,true) data;
select is((select (r->>'totalSessions')::int from optimized_result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(1)::text),7,'saved invalid/empty/non-string dates and skipped states remain excluded');
select is((select (r->>'plannedSessions')::int from optimized_result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(1)::text),2,'past active and makeup sessions retain planned count');
select is((select r#>>'{nextSession,sessionId}' from optimized_result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(1)::text),'legacy:force','next session excludes skipped dates and preserves saved identity');
select is((select r#>>'{nextSession,scheduleState}' from optimized_result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(1)::text),'active','force-active saved state is normalized exactly once');
select is((select r->>'lastUpdatedAt' from optimized_result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(1)::text),'','saved sessions retain empty last-update value');
select is((select (r->>'totalSessions')::int from optimized_result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(3)::text),2,'normalized storage ignores saved copies and skipped rows');
select is((select r->>'lastUpdatedAt' from optimized_result,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(3)::text),(select max(updated_at::text) from public.class_lesson_sessions where class_id=pg_temp.fid(3) and schedule_state<>'skipped'),'last-update aggregate retains text ordering and excludes skipped sessions');
select is(public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),1,10,false)->'rows',(select data->'rows' from optimized_result),'metadata-free page has identical rows');
select is(public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),1,10,false)->'stats','null'::jsonb,'metadata-free page omits statistics');
select is(public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),2147483647,20,false)->'rows','[]'::jsonb,'oversized page preserves safe bigint offset and empty rows');
select throws_ok($$select public.get_academic_curriculum_numbered_page_v2('[]',1,10,true)$$,'22023','academic_numbered_filters_invalid','final optimized function preserves exact invalid-filter SQLSTATE');
select throws_ok($$select public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),1,11,true)$$,'22023','academic_numbered_request_invalid','final optimized function preserves exact invalid-page SQLSTATE');
reset role;
create policy curriculum_perf_hidden_class on public.classes as restrictive for select to authenticated using (id<>pg_temp.fid(1));
create policy curriculum_perf_hidden_session on public.class_lesson_sessions as restrictive for select to authenticated using (id<>pg_temp.fid(950));
set local role authenticated;
select ok(not exists(select 1 from jsonb_array_elements(public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),1,10,true)->'rows') r where r->>'id'=pg_temp.fid(1)::text),'materialized schedules do not reveal a hidden class');
select is((select (r->>'totalSessions')::int from jsonb_array_elements(public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),1,10,true)->'rows') r where r->>'id'=pg_temp.fid(3)::text),1,'materialized schedules retain session RLS');
select is((select r->>'lastUpdatedAt' from jsonb_array_elements(public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),1,10,true)->'rows') r where r->>'id'=pg_temp.fid(3)::text),(select max(updated_at::text) from public.class_lesson_sessions where class_id=pg_temp.fid(3) and schedule_state<>'skipped'),'hidden session cannot affect last-update metadata');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select throws_ok($$select public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(),1,10,true)$$,'42501','authentication_required','missing actor is still rejected by final function');
reset role;

-- Page-first session work must retain the full eligible total, numeric ordering,
-- and selected-class data on middle/final/empty pages at every supported size.
select set_config('request.jwt.claim.sub',pg_temp.fid(900)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fid(900),'role','authenticated')::text,true);
insert into public.classes(id,name,status,subject,schedule_storage_mode,schedule_plan)
select pg_temp.fid(1000+n),'__curriculum_pages__ '||n,'수강',case when n%2=0 then '수학' else '영어' end,'legacy',
 jsonb_build_object('sessions',case when n%5=0 then '[]'::jsonb else
   (select jsonb_agg(jsonb_build_object('id','page-'||n||'-'||d,'date',
     (current_date+case when n%3=0 then -d else d end)::text,'state','active')) from generate_series(1,n) d) end)
from generate_series(1,25) n;
set local role authenticated;
create temporary table middle_page as select public.get_academic_curriculum_numbered_page_v2(
 pg_temp.filters('{"search":"__curriculum_pages__"}'),2,10,false) data;
select is((select data->>'totalCount' from middle_page),'25','middle page retains all eligible classes in total');
select is((select jsonb_agg(r->>'id' order by ord) from middle_page,jsonb_array_elements(data->'rows') with ordinality rows(r,ord)),
 (select jsonb_agg(pg_temp.fid(1000+n)::text order by n) from generate_series(11,20) n),'middle page retains natural numeric class order');
select is((select (r->>'totalSessions')::int from middle_page,jsonb_array_elements(data->'rows') r where r->>'id'=pg_temp.fid(1011)::text),11,'middle page calculates the selected class sessions');
select is(public.get_academic_curriculum_numbered_page_v2(pg_temp.filters('{"search":"__curriculum_pages__"}'),3,10,false)->>'page','3','last partial page retains requested page number');
select is(jsonb_array_length(public.get_academic_curriculum_numbered_page_v2(pg_temp.filters('{"search":"__curriculum_pages__"}'),3,10,false)->'rows'),5,'last partial page contains five rows');
select is(
 public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(jsonb_build_object('search','__curriculum_pages__','viewMode',mode)),page,size,false)->'rows',
 public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(jsonb_build_object('search','__curriculum_pages__','viewMode',mode)),page,size,true)->'rows',
 format('metadata-free %s page %s size %s matches complete-scope rows',mode,page,size))
from unnest(array['all','unlinked','unscheduled','update','done']) mode
cross join generate_series(1,4) page cross join unnest(array[10,15,20]) size;
select is(
 public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(jsonb_build_object('search','__curriculum_pages__','viewMode',mode)),1,10,false)->'totalCount',
 public.get_academic_curriculum_numbered_page_v2(pg_temp.filters(jsonb_build_object('search','__curriculum_pages__','viewMode',mode)),1,10,true)->'totalCount',
 format('%s view retains complete-scope total',mode))
from unnest(array['all','unlinked','unscheduled','update','done']) mode;
reset role;
select * from finish();
rollback;
