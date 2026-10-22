begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Synthetic basic-info save: incomplete history and overlapping dated rows
-- are already present. No production rows or staff/student identities.
create function pg_temp.basic_id(n integer) returns uuid language sql immutable as $$
 select ('bc220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version)
values(true,1) on conflict(singleton) do update set version=excluded.version;
insert into auth.users(id,instance_id,aud,role,email) values
(pg_temp.basic_id(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','basic-admin@test.invalid'),
(pg_temp.basic_id(902),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','basic-teacher@test.invalid');
insert into public.profiles(id,role,name) values
(pg_temp.basic_id(901),'admin','Synthetic basic admin'),(pg_temp.basic_id(902),'teacher','Synthetic basic teacher')
on conflict(id) do update set role=excluded.role;
insert into public.teacher_catalogs(id,name,subjects) values
(pg_temp.basic_id(101),'Synthetic basic teacher',array['수학']);
insert into public.classroom_catalogs(id,name,subjects) values
(pg_temp.basic_id(201),'Synthetic room five',array['수학']),
(pg_temp.basic_id(202),'Synthetic room seven',array['수학']);
insert into public.classes(id,name,subject,grade,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,lessons) values
(pg_temp.basic_id(301),'Synthetic basic target','수학','고2','수강','legacy',E'화 19:30-21:30\n토 16:30-18:00','Synthetic basic teacher','강의실 미정',
 jsonb_build_object('sessions',(select jsonb_agg(jsonb_build_object('id','legacy-'||n,'date',case when n=1 then '2025-08-03' else '2026-10-27' end,'state',case when n=80 then 'makeup' else 'active' end,'sessionNumber',n,'billingLabel','10월','memo','  memo '||n||'  ','textbookEntries',jsonb_build_array(jsonb_build_object('progress','learned '||n))) order by n) from generate_series(1,80) n),
 'billingPeriods',jsonb_build_array(jsonb_build_object('id','old-period','label','10월','month',10)),
 'history',jsonb_build_object('keep',true)), '{"opaqueLearning":"unchanged"}'),
(pg_temp.basic_id(302),'Synthetic other class','수학','고1','수강','legacy','토 16:30-18:00','Synthetic basic teacher','Synthetic room seven','{}','{}');
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
create temp table basic_before as select
 (select schedule_plan from public.classes where id=pg_temp.basic_id(301)) plan,
 (select lessons from public.classes where id=pg_temp.basic_id(301)) lessons,
 (select to_jsonb(c) from public.classes c where id=pg_temp.basic_id(302)) peer,
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
create temp table basic_results(name text primary key,payload jsonb);
grant select on basic_before to authenticated;
grant select,insert on basic_results to authenticated;
select set_config('request.jwt.claim.sub',pg_temp.basic_id(901)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.basic_id(901),'role','authenticated')::text,true);
set local role authenticated;
-- This matches management-service's full basic payload; it has no lessonPlan.
select lives_ok($$insert into basic_results values('save',public.update_class_operational_v1(pg_temp.basic_id(301),
 '{"name":"Synthetic basic target","class_type":"regular","subject":"수학","subject_area_key":null,"grade":"고2","teacher":"Synthetic basic teacher","schedule":"화 19:30-21:30\n토 16:30-18:00","room":"Synthetic room five","capacity":0,"fee":0,"status":"수강","textbook_ids":[]}',pg_temp.basic_id(601),null))$$,
 'full basic-info room save succeeds despite incomplete and overlapping dated history');
select is((select room from public.classes where id=pg_temp.basic_id(301)),'Synthetic room five','selected room is actually persisted');
select is((select schedule_plan from public.classes where id=pg_temp.basic_id(301)),(select plan from basic_before),'all eighty raw IDs, dates, billing, memo and learning JSON stay byte-equivalent');
select is((select lessons from public.classes where id=pg_temp.basic_id(301)),(select lessons from basic_before),'separate learning JSON remains unchanged');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"name":"Renamed independently"}',pg_temp.basic_id(602),null)$$,
 'metadata-only rename does not revalidate historical schedule');
select is((select name from public.classes where id=pg_temp.basic_id(301)),'Renamed independently','metadata-only change persists');
reset role;
select is((select to_jsonb(c) from public.classes c where id=pg_temp.basic_id(302)),(select peer from basic_before),'other class and its room seven are unchanged');
select is((select count(*) from dashboard_private.notification_events),(select events from basic_before),'no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from basic_before),'no notification delivery');
select is((select count(*) from dashboard_private.class_lesson_input_scopes),0::bigint,'no reusable input scope remains');

set local role authenticated;
select is(public.update_class_operational_v1(pg_temp.basic_id(301),
 '{"name":"Synthetic basic target","class_type":"regular","subject":"수학","subject_area_key":null,"grade":"고2","teacher":"Synthetic basic teacher","schedule":"화 19:30-21:30\n토 16:30-18:00","room":"Synthetic room five","capacity":0,"fee":0,"status":"수강","textbook_ids":[]}',pg_temp.basic_id(601),null),
 (select payload from basic_results where name='save'),'same request returns its exact receipt');
select is((select name from public.classes where id=pg_temp.basic_id(301)),'Renamed independently','replayed old payload does not undo a later edit');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"room":"Synthetic room seven"}',pg_temp.basic_id(601),null)$$,
 '22023','idempotency_key_reused','request key cannot carry a different payload');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"room":"No such room"}',pg_temp.basic_id(603),null)$$,
 '22023','class_schedule_catalog_invalid','changed nonexistent classroom reference is rejected');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"teacher":"No such teacher"}',pg_temp.basic_id(604),null)$$,
 '22023','class_schedule_catalog_invalid','changed nonexistent teacher reference is rejected');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"room":42}',pg_temp.basic_id(605),null)$$,
 '22023','class_schedule_validation','non-string classroom is not silently coerced');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"schedule":"화 24:00-24:00"}',pg_temp.basic_id(606),null)$$,
 '22023','class_schedule_validation','start 24:00 and invalid interval remain invalid');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"schedule":"화 19:60-21:30"}',pg_temp.basic_id(607),null)$$,
 '22023','class_schedule_validation','malformed minute remains invalid');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"schedule":"화 19:30-24:00\n토 16:30-18:00"}',pg_temp.basic_id(608),null)$$,
 'valid weekly input with midnight end does not revalidate eighty old dated lessons');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"room":""}',pg_temp.basic_id(609),null)$$,
 'explicit unassigned classroom is accepted');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"schedule":"화 19:30-21:30 (Synthetic basic teacher, Synthetic room five)\n토 16:30-18:00 (Synthetic basic teacher, Synthetic room seven)","room":"Synthetic room five(화), Synthetic room seven(토)"}',pg_temp.basic_id(610),null)$$,
 'normal per-day teacher and classroom UI serialization is accepted');
select is((select schedule_plan from public.classes where id=pg_temp.basic_id(301)),(select plan from basic_before),'weekly basic changes never regenerate stored dated input');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"room":"Synthetic room five","schedule_plan":{}}',pg_temp.basic_id(611),'{}')$$,
 'P0001','class_schedule_stale','mixed basic plus lesson edit still requires exact plan CAS');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),
 jsonb_build_object('room','Synthetic room five','schedule_plan',jsonb_set((select plan from basic_before),'{sessions}',(select plan->'sessions' from basic_before)||jsonb_build_array(jsonb_build_object('id','new-mixed-conflict','date','2026-10-31','scheduleState','active','startTime','16:30','endTime','18:00','teacherName','Synthetic basic teacher','classroomName','Synthetic room seven')))),pg_temp.basic_id(612),(select plan from basic_before))$$,
 '23P01','timetable_resource_conflict','separate mixed-plan writer policy is not broadened by a basic-info-only change');
select is((select schedule_plan->'sessions' from public.classes where id=pg_temp.basic_id(301)),(select plan->'sessions' from basic_before),'rejected mixed save preserves all eighty session objects');
select set_config('request.jwt.claim.sub',pg_temp.basic_id(902)::text,true);
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"room":"Synthetic room five"}',pg_temp.basic_id(613),null)$$,
 '42501','class_schedule_forbidden','teacher cannot acquire basic-info write permission');
select set_config('request.jwt.claim.sub',pg_temp.basic_id(901)::text,true);
reset role;
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where request_key=any(array[pg_temp.basic_id(603),pg_temp.basic_id(604),pg_temp.basic_id(605),pg_temp.basic_id(606),pg_temp.basic_id(607),pg_temp.basic_id(611),pg_temp.basic_id(613)])),0::bigint,'rejected edits leave no success receipt');

-- The prior basic payload can retire a textbook. Its existing BEFORE trigger
-- projection is part of the expected row; no broader trigger tolerance is added.
set local role authenticated;
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"textbook_ids":["synthetic-book"],"textbook_usage":{"synthetic-book":{"title":"Synthetic title","startDate":null,"endDate":null}}}',pg_temp.basic_id(614),null)$$,'existing textbook usage can be entered');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"room":"Synthetic room seven","textbook_ids":[]}',pg_temp.basic_id(615),null)$$,'room edit plus normal textbook retirement preserves trigger behavior');
select is((select textbook_usage from public.classes where id=pg_temp.basic_id(301)),'{}'::jsonb,'retired textbook usage is pruned by existing contract');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"textbook_ids":["kept"],"textbook_usage":{"kept":{"title":"Kept title","startDate":null,"endDate":null},"retired":{"title":"Retired title","startDate":null,"endDate":null}}}',pg_temp.basic_id(619),null)$$,
 'explicit usage and IDs preserve the existing deterministic retirement projection');
select is((select textbook_usage from public.classes where id=pg_temp.basic_id(301)),
 '{"kept":{"title":"Kept title","startDate":null,"endDate":null}}'::jsonb,'explicit usage retains only the current textbook');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"textbook_ids":[]}',pg_temp.basic_id(620),null)$$,'retiring the remaining textbook still succeeds');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"textbook_usage":{"retired":{"title":"Retired title","startDate":null,"endDate":null}}}',pg_temp.basic_id(621),null)$$,
 'usage-only input is pruned against unchanged IDs exactly as before');
select is((select textbook_usage from public.classes where id=pg_temp.basic_id(301)),'{}'::jsonb,'usage-only orphan entries do not persist');

-- Both ordinary status directions are basic information. Closing and reopening
-- a closed class retain their separate atomic roster guard.
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"status":"개강 준비"}',pg_temp.basic_id(622),null)$$,
 'changing active to preparation does not inspect incomplete historical lessons');
select is((select status from public.classes where id=pg_temp.basic_id(301)),'개강 준비','preparation status is actually persisted');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"status":"수강"}',pg_temp.basic_id(623),null)$$,
 'status-only activation does not inspect incomplete historical lessons');
select is((select status from public.classes where id=pg_temp.basic_id(301)),'수강','active status is actually persisted');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"status":"개강 준비","room":"강의실 미정"}',pg_temp.basic_id(624),null)$$,
 'preparation and classroom can be changed together without rewriting history');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),
 '{"name":"Synthetic basic target","class_type":"regular","subject":"수학","subject_area_key":null,"grade":"고2","teacher":"Synthetic basic teacher","schedule":"화 19:30-21:30\n토 16:30-18:00","room":"Synthetic room five","capacity":0,"fee":0,"status":"수강","textbook_ids":[]}',pg_temp.basic_id(625),null)$$,
 'full management payload activates and changes classroom despite eighty historical lessons');
select is((select jsonb_build_object('status',status,'room',room) from public.classes where id=pg_temp.basic_id(301)),
 '{"status":"수강","room":"Synthetic room five"}'::jsonb,'activation and selected classroom both persist');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"status":"unknown"}',pg_temp.basic_id(626),null)$$,
 '22023','class_schedule_validation','ordinary status still requires a valid status value');
select is((select schedule_plan from public.classes where id=pg_temp.basic_id(301)),(select plan from basic_before),'status edits preserve all eighty original lesson objects and metadata');
select is((select lessons from public.classes where id=pg_temp.basic_id(301)),(select lessons from basic_before),'status edits preserve separate learning data');
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from basic_before),'ordinary status and usage edits do not emit notifications');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from basic_before),'ordinary status and usage edits do not send notifications');

create function pg_temp.basic_trigger_drift() returns trigger language plpgsql as $$begin new.schedule_plan:='{}';return new;end$$;
create trigger zz_basic_test_mutation before update of room,name on public.classes for each row execute function pg_temp.basic_trigger_drift();
set local role authenticated;
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"room":"Synthetic room five"}',pg_temp.basic_id(616),null)$$,
 '42501','class_lesson_input_scope_invalid','a room update cannot silently erase a plan through another trigger');
select throws_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"name":"Another rename"}',pg_temp.basic_id(618),null)$$,
 '42501','class_lesson_input_scope_invalid','metadata-only updates also reject unexpected plan changes by another trigger');
reset role;
drop trigger zz_basic_test_mutation on public.classes;
select is((select schedule_plan->'sessions' from public.classes where id=pg_temp.basic_id(301)),(select plan->'sessions' from basic_before),'unexpected trigger drift rolls back without losing history');
select is((select count(*) from dashboard_private.class_lesson_input_scopes),0::bigint,'all success and failure paths clean their private scope');
select ok(not has_function_privilege('authenticated','dashboard_private.begin_class_lesson_input_scope_v1(uuid,uuid,text,regclass,text,jsonb)','execute'),'scope issuer remains private');

-- Test-only reader tripwire proves no full operating reader is invoked by this
-- isolated normal basic save. ROLLBACK restores the real shared function.
create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $$begin raise exception 'unexpected_operating_reader';end$$;
set local role authenticated;
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"room":"Synthetic room five","status":"수강"}',pg_temp.basic_id(617),null)$$,
 'ordinary room save does not build any operating weekly or dated comparison set');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"status":"개강 준비"}',pg_temp.basic_id(627),null)$$,
 'preparation transition does not call the historical operating reader');
select lives_ok($$select public.update_class_operational_v1(pg_temp.basic_id(301),'{"status":"수강"}',pg_temp.basic_id(628),null)$$,
 'activation transition does not call the historical operating reader');
set constraints all immediate;
reset role;
select is((select to_jsonb(c) from public.classes c where id=pg_temp.basic_id(302)),(select peer from basic_before),'other class remains identical after all edits');
select * from finish();
rollback;
