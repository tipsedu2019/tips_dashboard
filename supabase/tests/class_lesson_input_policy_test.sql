begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Synthetic fixture only. No live class, student, or staff data is used.
create function pg_temp.input_id(n integer) returns uuid language sql immutable as $$
 select ('ac510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version)
values(true,1) on conflict(singleton) do update set version=excluded.version;
insert into auth.users(id,instance_id,aud,role,email) values
(pg_temp.input_id(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lesson-input-admin@test.invalid'),
(pg_temp.input_id(902),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lesson-input-teacher@test.invalid');
insert into public.profiles(id,role,name) values
(pg_temp.input_id(901),'admin','Synthetic lesson input admin'),
(pg_temp.input_id(902),'teacher','Synthetic lesson input teacher')
on conflict(id) do update set role=excluded.role;
insert into public.teacher_catalogs(id,name,subjects) values
(pg_temp.input_id(101),'Synthetic input teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values
(pg_temp.input_id(201),'Synthetic input room',array['영어']);

create temp table input_dates as
with historical as (
 select date '2025-01-01'+n d from generate_series(0,211) n
 where extract(dow from date '2025-01-01'+n) in(2,4) order by n limit 54
)
select d from historical union all
select d from unnest(array[
 '2026-11-03'::date,'2026-11-05','2026-11-10','2026-11-12',
 '2026-11-17','2026-11-19','2026-11-24','2026-11-26',
 '2026-12-01','2026-12-03','2026-12-08','2026-12-10',
 '2026-12-15','2026-12-17','2026-12-22','2026-12-24'
]) dates(d);
create temp table input_plans as
with old_sessions as (
 select jsonb_agg(jsonb_build_object(
  'id','old-'||d,'sessionKey','old-'||d,'date',d,
  'billingId','period:'||to_char(d,'YYYY-MM'),'billingLabel',extract(month from d)::int||'월',
  'state','active','scheduleState','active','sessionNumber',i,
  'memo',E'  unchanged memo\n','teacherNote','unchanged learning '||i,
  'textbookEntries',jsonb_build_array(jsonb_build_object('textbookId','synthetic-book','progress',i)),
  'rawHistoryMarker',jsonb_build_object('preserve',i)
 ) order by i) rows from (select d,row_number() over(order by d desc) i from input_dates) ordered
), old_periods as (
 select jsonb_agg(jsonb_build_object('id','period:'||m,'label',month_no||'월',
  'startDate',first_date,'endDate',last_date,'sessionCount',n) order by m desc) rows
 from (select to_char(d,'YYYY-MM') m,extract(month from d)::int month_no,
 min(d) first_date,max(d) last_date,count(*) n from input_dates group by 1,2) periods
), october as (
 select jsonb_agg(jsonb_build_object(
  'id','oct-'||d,'sessionKey','oct-'||d,'date',d,
  'billingId','period:2026-10','billingLabel','10월','sessionNumber',i,
  'state','active','scheduleState','active','startTime','19:30','endTime','21:30',
  'teacherCatalogId',pg_temp.input_id(101),'classroomCatalogId',pg_temp.input_id(201),
  'memo',E'  October memo\n','teacherNote','October learning '||i
 ) order by i) rows from unnest(array[
 '2026-10-01'::date,'2026-10-06','2026-10-08','2026-10-13','2026-10-15',
 '2026-10-20','2026-10-22','2026-10-27','2026-10-29']) with ordinality dates(d,i)
), original as (
 select jsonb_build_object('version',2,'subject','영어','selectedDays','[2,4]'::jsonb,
 'history',jsonb_build_object('preserve','raw metadata'),'billingPeriods',old_periods.rows,
 'sessions',old_sessions.rows) plan from old_sessions,old_periods
)
select plan old_plan,
 jsonb_set(jsonb_set(plan,'{sessions}',plan->'sessions'||october.rows),'{billingPeriods}',
 plan->'billingPeriods'||jsonb_build_array(jsonb_build_object('id','period:2026-10','label','10월',
 'startDate','2026-10-01','endDate','2026-10-29','sessionCount',9))) new_plan
from original,october;

insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan) values
(pg_temp.input_id(301),'Synthetic legacy input target','영어','수강','legacy','화 19:30-21:30; 목 19:30-21:30','Synthetic input teacher','Synthetic input room',(select old_plan from input_plans)),
(pg_temp.input_id(302),'Synthetic overlapping peer','영어','수강','legacy','화 19:30-21:30; 목 19:30-21:30','Synthetic input teacher','Synthetic input room','{}'),
(pg_temp.input_id(303),'Synthetic strict edit target','영어','수강','legacy','일 06:00-07:00','Synthetic input teacher','Synthetic input room','{}'),
(pg_temp.input_id(304),'Synthetic incomplete history','영어','개강 준비','legacy','','','',
 '{"sessions":[{"id":"historical-partial","date":"2025-01-02","memo":"  retained  ","teacherNote":"learning stays"}]}'),
(pg_temp.input_id(305),'Synthetic normalized input','영어','수강','normalized','화 19:30-21:30','Synthetic input teacher','Synthetic input room',
 '{"billingPeriods":[{"id":"normalized-period","label":"10월","keep":true}],"history":{"keep":true},"sessions":[{"id":"normalized-peer","date":"2026-09-22","memo":"  peer original  ","teacherNote":"peer learning","unknown":{"retain":true}},{"id":"normalized-edit","date":"2026-09-15","billingId":"normalized-period","billingLabel":"10월","textbookEntries":[{"textbookId":"synthetic-book","progress":"keep"}],"teacherNote":"old learning"}]}');
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name,sort_order)
values(pg_temp.input_id(401),pg_temp.input_id(305),2,'19:30','21:30',pg_temp.input_id(101),'Synthetic input teacher',pg_temp.input_id(201),'Synthetic input room',0);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,classroom_name_snapshot,origin,legacy_billing_id,legacy_billing_label,memo,teacher_note) values
(pg_temp.input_id(501),pg_temp.input_id(305),'normalized-edit','2026-09-15','active','19:30','21:30',pg_temp.input_id(101),'Synthetic input teacher',pg_temp.input_id(201),'Synthetic input room','manual','normalized-period','10월','old memo','old learning'),
(pg_temp.input_id(502),pg_temp.input_id(305),'normalized-peer','2026-09-22','active','19:30','21:30',pg_temp.input_id(101),'Synthetic input teacher',pg_temp.input_id(201),'Synthetic input room','manual','normalized-period','10월','DB peer memo','DB peer learning');
select set_config('app.class_schedule_mutation','',true);

-- Seal only synthetic pre-existing overlap/incomplete-history setup. Every
-- operation below uses the real public RPC and all installed guards.
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1()
where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
create temp table input_before as select
 (select to_jsonb(c)-'updated_at'-'schedule_plan' from public.classes c where id=pg_temp.input_id(301)) class_fields,
 (select schedule_plan from public.classes where id=pg_temp.input_id(304)) partial_plan,
 (select schedule_plan from public.classes where id=pg_temp.input_id(305)) normalized_plan,
 (select to_jsonb(s) from public.class_lesson_sessions s where id=pg_temp.input_id(502)) normalized_peer,
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
grant select on input_plans,input_before to authenticated;
select set_config('request.jwt.claim.sub',pg_temp.input_id(901)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.input_id(901),'role','authenticated')::text,true);

create function pg_temp.save_input(plan jsonb,key_number integer,expected jsonb) returns jsonb language sql as $$
 select public.update_class_operational_v1(pg_temp.input_id(301),jsonb_build_object('schedule_plan',plan),pg_temp.input_id(key_number),expected)
$$;
create temp table input_results(name text primary key,payload jsonb);
grant select,insert on input_results to authenticated;
set local role authenticated;
select lives_ok($$insert into input_results values('legacy',pg_temp.save_input((select new_plan from input_plans),601,(select old_plan from input_plans)))$$,
 'real authenticated legacy RPC appends October despite same room and teacher overlap');
select is((select schedule_plan from public.classes where id=pg_temp.input_id(301)),(select new_plan from input_plans),
 'persisted JSON exactly equals submitted plan including array order, IDs, learning, billing and whitespace');
select is(public.get_operations_class_lesson_design_detail_v1(pg_temp.input_id(301))#>'{classItem,schedulePlan}',(select new_plan from input_plans),
 'lesson detail reads back the exact input through the normal producer');
select is((select jsonb_array_length(schedule_plan->'sessions') from public.classes where id=pg_temp.input_id(301)),79,'70 original sessions plus nine October sessions gives 79');
select is((select jsonb_agg(s order by ord) from public.classes c,jsonb_array_elements(c.schedule_plan->'sessions') with ordinality a(s,ord) where c.id=pg_temp.input_id(301) and ord<=70),
 (select old_plan->'sessions' from input_plans),'all 70 originals retain their original descending order and full content');
select is((select jsonb_build_object('10',count(*) filter(where s->>'date' like '2026-10-%'),
 '11',count(*) filter(where s->>'date' like '2026-11-%'),'12',count(*) filter(where s->>'date' like '2026-12-%'))
 from public.classes c,jsonb_array_elements(c.schedule_plan->'sessions') s where c.id=pg_temp.input_id(301)),
 '{"10":9,"11":8,"12":8}'::jsonb,'requested monthly counts are 9/8/8');
select ok((select bool_and(s->>'billingId'='period:2026-10' and s->>'billingLabel'='10월')
 from public.classes c,jsonb_array_elements(c.schedule_plan->'sessions') s where c.id=pg_temp.input_id(301) and s->>'date' like '2026-10-%'),
 'every new October lesson retains October settlement ownership');
select is(pg_temp.save_input((select new_plan from input_plans),601,(select old_plan from input_plans)),
 (select payload from input_results where name='legacy'),'same request replays the original response without creating sessions');
select throws_ok($$select pg_temp.save_input((select old_plan from input_plans),602,(select old_plan from input_plans))$$,
 'P0001','class_schedule_stale','whole-plan CAS rejects a stale editor');
select throws_ok($$select pg_temp.save_input((select new_plan||'{"memo":"changed"}'::jsonb from input_plans),601,(select old_plan from input_plans))$$,
 '22023','idempotency_key_reused','one request key cannot be reused for different input');
reset role;
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=pg_temp.input_id(901) and request_key=pg_temp.input_id(601)),1::bigint,'append and replay leave exactly one receipt');
select is((select to_jsonb(c)-'updated_at'-'schedule_plan' from public.classes c where id=pg_temp.input_id(301)),
 (select class_fields from input_before),'lesson-only save preserves every other class field');
select is((select count(*) from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current()),0::bigint,'successful legacy write leaves no reusable private scope');

set local role authenticated;
select lives_ok($$select public.update_class_operational_v1(pg_temp.input_id(304),jsonb_build_object('schedule_plan',
 (select partial_plan from input_before)||jsonb_build_object('sessions',(select partial_plan->'sessions' from input_before)||
 jsonb_build_array(jsonb_build_object('id','second-identity','date','2025-01-02','memo',E'  new partial\n')))),
 pg_temp.input_id(603),(select partial_plan from input_before))$$,
 'missing historical time/resources and a distinct lesson on the same past date do not block input');
select is((select schedule_plan#>'{sessions,0}' from public.classes where id=pg_temp.input_id(304)),
 (select partial_plan#>'{sessions,0}' from input_before),'incomplete historical row remains exactly intact');
select is((select jsonb_array_length(schedule_plan->'sessions') from public.classes where id=pg_temp.input_id(304)),2,
 'distinct identities on the same date are retained');
select lives_ok($$select public.update_class_operational_v1(pg_temp.input_id(304),
 jsonb_build_object('schedule_plan',jsonb_set(schedule_plan,'{sessions}',jsonb_build_array(schedule_plan#>'{sessions,1}'))),
 pg_temp.input_id(611),schedule_plan) from public.classes where id=pg_temp.input_id(304)$$,
 'explicit removal with current whole-plan CAS is not prevented by a permanent old-ID subset rule');
select is((select schedule_plan#>>'{sessions,0,id}' from public.classes where id=pg_temp.input_id(304)),'second-identity',
 'explicit removal preserves the remaining submitted identity instead of regenerating it');
select throws_ok($$select pg_temp.save_input(jsonb_set((select new_plan from input_plans),'{sessions,70,date}','42'::jsonb),604,(select new_plan from input_plans))$$,
 '22023','class_schedule_validation','new invalid date type is rejected');
select throws_ok($$select pg_temp.save_input(jsonb_set((select new_plan from input_plans),'{sessions,70,date}','"2026-02-30"'::jsonb),605,(select new_plan from input_plans))$$,
 '22023','class_schedule_validation','invalid calendar date is rejected');
select throws_ok($$select pg_temp.save_input(jsonb_set((select new_plan from input_plans),'{sessions,70,teacherCatalogId}','"not-a-uuid"'::jsonb),606,(select new_plan from input_plans))$$,
 '22023','class_schedule_validation','malformed UUID reference is rejected');
select throws_ok($$select pg_temp.save_input(jsonb_set((select new_plan from input_plans),'{sessions,70,classroomCatalogId}',to_jsonb(pg_temp.input_id(999))),607,(select new_plan from input_plans))$$,
 '22023','class_schedule_catalog_invalid','well-formed nonexistent classroom reference is rejected');
select throws_ok($$select pg_temp.save_input(jsonb_set((select new_plan from input_plans),'{sessions}',(select new_plan->'sessions'||jsonb_build_array(new_plan#>'{sessions,70}') from input_plans)),608,(select new_plan from input_plans))$$,
 '22023','class_schedule_validation','a repeated lesson identity is rejected without confusing distinct same-date lessons');
select throws_ok($$select pg_temp.save_input(jsonb_set((select new_plan from input_plans),'{sessions,70,endTime}','"18:30"'::jsonb),609,(select new_plan from input_plans))$$,
 '22023','class_schedule_validation','invalid time ordering still rejects the input');
select set_config('request.jwt.claim.sub',pg_temp.input_id(902)::text,true);
select throws_ok($$select pg_temp.save_input((select new_plan from input_plans),610,(select new_plan from input_plans))$$,
 '42501','class_schedule_forbidden','teacher cannot obtain the admin/staff lesson mutation capability');
select set_config('request.jwt.claim.sub',pg_temp.input_id(901)::text,true);
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.input_id(301)),(select new_plan from input_plans),
 'all validation and permission failures preserve the complete 79-session source');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where request_key=any(array[
 pg_temp.input_id(602),pg_temp.input_id(604),pg_temp.input_id(605),pg_temp.input_id(606),pg_temp.input_id(607),pg_temp.input_id(608),pg_temp.input_id(609),pg_temp.input_id(610)])),0::bigint,
 'failed requests create no success receipt');

-- A client-controlled GUC is not a capability. Basic-info-only edits now use
-- authored input policy through the real RPC; mixed plan commands stay separate.
set local role authenticated;
select throws_ok($$select dashboard_private.begin_class_lesson_input_scope_v1(pg_temp.input_id(301),pg_temp.input_id(620),'update_class_operational_v1','public.classes'::regclass,'UPDATE','{}'::jsonb)$$,
 '42501',null::text,'authenticated cannot invoke the private scope issuer');
select throws_ok($$select * from dashboard_private.class_lesson_input_scopes$$,'42501',null::text,
 'authenticated cannot inspect or reuse scope rows');
select set_config('app.class_lesson_input_scope','true',true);
select set_config('app.class_schedule_mutation','release2-rpc',true);
select lives_ok($$select public.update_class_operational_v1(pg_temp.input_id(303),'{"schedule":"화 19:30-21:30"}'::jsonb,pg_temp.input_id(621),null)$$,
 'ordinary basic schedule input is accepted by the public RPC, independently of unrelated GUC values');
select lives_ok($$select public.update_class_operational_v1(pg_temp.input_id(303),'{"schedule":"일 06:00-07:00"}'::jsonb,pg_temp.input_id(627),null)$$,
 'restore the synthetic boundary target for subsequent direct-write guards');
select throws_ok($$select public.update_class_operational_v1(pg_temp.input_id(303),'{"schedule":"화 19:30-21:30","schedule_plan":{"sessions":[]}}'::jsonb,pg_temp.input_id(622),'{}'::jsonb)$$,
 '23P01','timetable_resource_conflict','mixed schedule plus plan patch remains on the separate strict path');
select throws_ok($$select public.save_class_schedule_defaults_v1(pg_temp.input_id(305),0,
 jsonb_build_array(jsonb_build_object('id',pg_temp.input_id(401),'weekday',4,'startTime','19:30','endTime','21:30',
 'teacherCatalogId',pg_temp.input_id(101),'classroomCatalogId',pg_temp.input_id(201),'sortOrder',0)),pg_temp.input_id(626),null)$$,
 '23P01','timetable_resource_conflict','normalized weekly defaults still reject a newly introduced resource collision');
select set_config('app.class_lesson_input_scope','',true);
select set_config('app.class_schedule_mutation','',true);
reset role;

create function pg_temp.strict_before_lesson() returns void language plpgsql as $$
begin
 update public.classes set schedule='화 19:30-21:30' where id=pg_temp.input_id(303);
 perform pg_temp.save_input((select new_plan||'{"memo":"must roll back"}'::jsonb from input_plans),623,(select new_plan from input_plans));
end$$;
create function pg_temp.valid_strict_before_lesson() returns void language plpgsql as $$
begin
 update public.classes set schedule='일 06:30-07:30' where id=pg_temp.input_id(303);
 perform pg_temp.save_input((select new_plan||'{"memo":"valid boundary"}'::jsonb from input_plans),624,(select new_plan from input_plans));
 set constraints all immediate;
 set constraints all deferred;
end$$;
set local role authenticated;
select throws_ok('select pg_temp.strict_before_lesson()','23P01','timetable_resource_conflict',
 'entering the lesson policy cannot discard an earlier invalid strict segment');
select lives_ok('select pg_temp.valid_strict_before_lesson()',
 'valid preceding strict segment completes before the lesson input scope');
reset role;
create temp table input_atomic_before as select
 (select schedule_plan from public.classes where id=pg_temp.input_id(301)) plan,
 (select change_sequence from public.timetable_invalidation_signals where id='operating') sequence;
grant select on input_atomic_before to authenticated;
create function pg_temp.lesson_before_strict_failure() returns void language plpgsql as $$
begin
 perform pg_temp.save_input((select plan||'{"memo":"atomic rollback"}'::jsonb from input_atomic_before),625,(select plan from input_atomic_before));
 update public.classes set schedule='화 19:30-21:30' where id=pg_temp.input_id(303);
 set constraints all immediate;
 set constraints all deferred;
end$$;
set local role authenticated;
select throws_ok('select pg_temp.lesson_before_strict_failure()','23P01','timetable_resource_conflict',
 'strict write after a successful lesson scope still checks conflicts and rolls back the statement group');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.input_id(301)),(select plan from input_atomic_before),
 'later strict failure rolls back the earlier lesson JSON in the same subtransaction');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where request_key=pg_temp.input_id(625)),0::bigint,
 'later strict failure also rolls back the lesson receipt');
select is((select change_sequence from public.timetable_invalidation_signals where id='operating'),(select sequence from input_atomic_before),
 'failed compound write does not leak an invalidation signal');
select is((select count(*) from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current()),0::bigint,
 'failed compound write leaves no scope behind');

-- Normalized APIs keep their real revision, FK and request identity contracts.
set local role authenticated;
select lives_ok($$insert into input_results values('normalized-save',public.save_class_lesson_session_v1(
 pg_temp.input_id(501),0,'active','2026-10-06','19:30','21:30',pg_temp.input_id(101),pg_temp.input_id(201),
 E'  edited memo\n',E' public note ',E' changed learning ',pg_temp.input_id(630),null))$$,
 'normalized edit allows the explicitly entered same-time room and teacher overlap');
select is((select jsonb_build_object('id',id,'date',session_date,'start',start_time,'end',end_time,'teacher',teacher_catalog_id,
 'room',classroom_catalog_id,'memo',memo,'publicNote',public_note,'teacherNote',teacher_note,'revision',revision)
 from public.class_lesson_sessions where id=pg_temp.input_id(501)),jsonb_build_object('id',pg_temp.input_id(501),
 'date','2026-10-06'::date,'start','19:30'::time,'end','21:30'::time,'teacher',pg_temp.input_id(101),
 'room',pg_temp.input_id(201),'memo',E'  edited memo\n','publicNote',E' public note ','teacherNote',E' changed learning ','revision',1),
 'normalized edit preserves identity and exact submitted date/time/resources/notes while advancing revision');
select is(public.save_class_lesson_session_v1(pg_temp.input_id(501),0,'active','2026-10-06','19:30','21:30',
 pg_temp.input_id(101),pg_temp.input_id(201),E'  edited memo\n',E' public note ',E' changed learning ',pg_temp.input_id(630),null),
 (select payload from input_results where name='normalized-save'),'normalized request replay returns the original row');
select throws_ok($$select public.save_class_lesson_session_v1(pg_temp.input_id(501),0,'active','2026-10-08','19:30','21:30',
 pg_temp.input_id(101),pg_temp.input_id(201),'','','',pg_temp.input_id(631),null)$$,
 'P0001','class_schedule_stale','normalized stale revision still fails');
select throws_ok($$select public.save_class_lesson_session_v1(pg_temp.input_id(501),1,'active','2026-10-08','19:30',null,
 pg_temp.input_id(101),pg_temp.input_id(201),'','','',pg_temp.input_id(632),null)$$,
 '22023','class_schedule_validation','normalized invalid time pair still fails');
select lives_ok($$insert into input_results values('normalized-generate',public.generate_class_lesson_sessions_v1(
 pg_temp.input_id(305),0,'2026-10-06','2026-10-06',pg_temp.input_id(633),null))$$,
 'normalized generation allows overlapping occupancy through the ordinary RPC');
select is(public.generate_class_lesson_sessions_v1(pg_temp.input_id(305),0,'2026-10-06','2026-10-06',pg_temp.input_id(633),null),
 (select payload from input_results where name='normalized-generate'),'generation replay does not generate another row');
select lives_ok($$select public.generate_class_lesson_sessions_v1(pg_temp.input_id(305),0,'2026-10-06','2026-10-06',pg_temp.input_id(634),null)$$,
 'new generation request for the existing source identity is a safe no-op');
reset role;
select is((select count(*) from public.class_lesson_sessions where class_id=pg_temp.input_id(305) and session_date='2026-10-06'),2::bigint,
 'manual and generated distinct identities can share a date without duplicate request rows');
select is((select count(*) from public.class_lesson_sessions where class_id=pg_temp.input_id(305) and source_schedule_slot_id=pg_temp.input_id(401)),1::bigint,
 'generation retains the existing per-source identity uniqueness');
select is((select to_jsonb(s) from public.class_lesson_sessions s where id=pg_temp.input_id(502)),(select normalized_peer from input_before),
 'normalized peer database row is completely unchanged');
select is((select schedule_plan#>'{sessions,0}' from public.classes where id=pg_temp.input_id(305)),
 (select normalized_plan#>'{sessions,0}' from input_before),'projection does not regenerate or normalize a peer JSON row');
select is((select schedule_plan#>'{sessions,1,textbookEntries}' from public.classes where id=pg_temp.input_id(305)),
 (select normalized_plan#>'{sessions,1,textbookEntries}' from input_before),'changed session projection preserves learning content');
select is((select schedule_plan-'sessions' from public.classes where id=pg_temp.input_id(305)),
 (select normalized_plan-'sessions' from input_before),'normalized projection preserves billing periods and top-level metadata');
select is((select schedule_plan#>>'{sessions,1,billingId}' from public.classes where id=pg_temp.input_id(305)),
 'normalized-period','edited session billing ownership stays intact');
select is((select jsonb_array_length(schedule_plan->'sessions') from public.classes where id=pg_temp.input_id(305)),3,
 'projection appends one generated row without replacing the original two');
select is((select count(*) from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current()),0::bigint,
 'normalized save, generate and replay all leave scope cleanup complete');

-- Exercise actual data-safety outcomes under triggers; these test-only objects
-- roll back with this fixture and never grant an API caller scope privileges.
set constraints all immediate;
set local role authenticated;
select lives_ok($$select public.update_class_operational_v1(pg_temp.input_id(301),
 jsonb_build_object('schedule_plan',schedule_plan||'{"memo":"immediate input"}'::jsonb),
 pg_temp.input_id(640),schedule_plan) from public.classes where id=pg_temp.input_id(301)$$,
 'pure lesson input succeeds while the caller has constraints in immediate mode');
reset role;
select is((select count(*) from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current()),0::bigint,
 'immediate-mode input consumes and closes its scope');
set constraints all deferred;
create temp table input_guard_before as select
 (select schedule_plan from public.classes where id=pg_temp.input_id(301)) plan,
 (select jsonb_agg(to_jsonb(c) order by id) from public.classes c where id in(pg_temp.input_id(301),pg_temp.input_id(303))) rows;
grant select on input_guard_before to authenticated;
create function pg_temp.input_trigger_drift() returns trigger language plpgsql as $$
begin
 if new.id<>pg_temp.input_id(301) then return new;end if;
 case current_setting('test.lesson_input_drift',true)
  when 'column' then new.capacity:=coalesce(new.capacity,0)+1;
  when 'suppress' then return null;
  when 'nested' then
   -- name is intentionally outside the existing occupancy UPDATE column list.
   update public.classes set name=name||' unexpected' where id=pg_temp.input_id(303);
  else null;
 end case;
 return new;
end$$;
create trigger zz_input_test_mutation before update of schedule_plan on public.classes
 for each row execute function pg_temp.input_trigger_drift();
set local role authenticated;
select set_config('test.lesson_input_drift','column',true);
select throws_ok($$select pg_temp.save_input((select plan||'{"memo":"column attempt"}'::jsonb from input_guard_before),641,
 (select plan from input_guard_before))$$,'42501','class_lesson_input_scope_invalid',
 'a BEFORE trigger cannot change another class column during lesson input');
select set_config('test.lesson_input_drift','suppress',true);
select throws_ok($$select pg_temp.save_input((select plan||'{"memo":"suppressed attempt"}'::jsonb from input_guard_before),642,
 (select plan from input_guard_before))$$,'42501','class_lesson_input_scope_invalid',
 'a BEFORE trigger cannot silently suppress an expected lesson write and create a success receipt');
select set_config('test.lesson_input_drift','nested',true);
select throws_ok($$select pg_temp.save_input((select plan||'{"memo":"nested attempt"}'::jsonb from input_guard_before),643,
 (select plan from input_guard_before))$$,'42501','class_lesson_input_scope_invalid',
 'a trigger cannot use the input scope for a nested write to another row or an unwatched column');
select set_config('test.lesson_input_drift','',true);
reset role;
drop trigger zz_input_test_mutation on public.classes;
create function pg_temp.input_wrong_target() returns void language plpgsql as $$
declare expected_row public.classes;
begin
 select * into expected_row from public.classes where id=pg_temp.input_id(301);
 -- Privileged harness models an implementation drift after a trusted issuer.
 -- Real API callers remain unable to call the issuer (asserted above).
 perform dashboard_private.begin_class_lesson_input_scope_v1(pg_temp.input_id(301),pg_temp.input_id(644),
  'update_class_operational_v1','public.classes'::regclass,'UPDATE',
  jsonb_build_object(expected_row.id::text,jsonb_build_object('before',to_jsonb(expected_row)-'updated_at',
   'after',to_jsonb(expected_row)-'updated_at')));
 update public.classes set schedule_plan=schedule_plan||'{"unexpectedTarget":true}'::jsonb where id=pg_temp.input_id(303);
 perform dashboard_private.end_class_lesson_input_scope_v1();
end$$;
select throws_ok('select pg_temp.input_wrong_target()','42501','class_lesson_input_scope_invalid',
 'even a trusted issuer cannot write a row outside its exact expected target set');
select is((select jsonb_agg(to_jsonb(c) order by id) from public.classes c where id in(pg_temp.input_id(301),pg_temp.input_id(303))),
 (select rows from input_guard_before),'column, suppressed, nested and wrong-target failures leave both entire class rows unchanged');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where request_key=any(array[
 pg_temp.input_id(641),pg_temp.input_id(642),pg_temp.input_id(643),pg_temp.input_id(644)])),0::bigint,
 'guard failures cannot leave a successful request receipt');
select is((select count(*) from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current()),0::bigint,
 'guard failures roll back their private scope and consumed-row state');
set local role authenticated;
select lives_ok($$select pg_temp.save_input((select plan||'{"memo":"after failed writes"}'::jsonb from input_guard_before),645,
 (select plan from input_guard_before))$$,'a normal save remains possible after failed scope attempts');
reset role;
select is((select count(*) from dashboard_private.class_lesson_input_scopes where transaction_id=txid_current()),0::bigint,
 'the subsequent successful save also closes its scope');

create function pg_temp.input_between_strict_segments(invalid_later boolean) returns void language plpgsql as $$
declare original_plan jsonb;
begin
 update public.classes set schedule='일 07:00-08:00' where id=pg_temp.input_id(303);
 select schedule_plan into original_plan from public.classes where id=pg_temp.input_id(301);
 perform pg_temp.save_input(original_plan||jsonb_build_object('memo',case when invalid_later then 'rollback later segment' else 'two strict segments' end),
  case when invalid_later then 647 else 646 end,original_plan);
 update public.classes set schedule=case when invalid_later then '화 19:30-21:30' else '일 07:30-08:30' end
  where id=pg_temp.input_id(303);
 set constraints all immediate;
 set constraints all deferred;
end$$;
set local role authenticated;
select lives_ok('select pg_temp.input_between_strict_segments(false)',
 'old deferred events finish only the fresh later strict segment after the input boundary');
reset role;
select is((select count(*) from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),0::bigint,
 'successful strict-input-strict finalization consumes the later baseline');
create temp table input_two_segments_before as select jsonb_agg(to_jsonb(c) order by id) rows
 from public.classes c where id in(pg_temp.input_id(301),pg_temp.input_id(303));
set local role authenticated;
select throws_ok('select pg_temp.input_between_strict_segments(true)','23P01','timetable_resource_conflict',
 'an old queued event cannot hide an invalid later strict segment');
reset role;
select is((select jsonb_agg(to_jsonb(c) order by id) from public.classes c where id in(pg_temp.input_id(301),pg_temp.input_id(303))),
 (select rows from input_two_segments_before),'invalid later strict segment rolls back the preceding strict and input writes together');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where request_key=pg_temp.input_id(647)),0::bigint,
 'failed three-segment transaction leaves no lesson receipt');

select ok(not has_function_privilege('authenticated','dashboard_private.begin_class_lesson_input_scope_v1(uuid,uuid,text,regclass,text,jsonb)','execute')
 and not has_function_privilege('authenticated','dashboard_private.end_class_lesson_input_scope_v1()','execute'),
 'scope issuer and finalizer stay private');
select ok(not has_function_privilege('anon','public.update_class_operational_v1(uuid,jsonb,uuid,jsonb)','execute')
 and not has_function_privilege('anon','public.generate_class_lesson_sessions_v1(uuid,bigint,date,date,uuid,text)','execute')
 and not has_function_privilege('anon','public.save_class_lesson_session_v1(uuid,bigint,text,date,time,time,uuid,uuid,text,text,text,uuid,text)','execute'),
 'all three lesson mutation entrypoints retain anonymous denial');
select lives_ok('set constraints all immediate','deferred guards finalize after permitted lesson saves');
select is((select count(*) from dashboard_private.notification_events),(select events from input_before),'lesson input creates no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from input_before),'lesson input sends no notification delivery');
-- ID-addressed authored values must survive both actual operating readers.
-- The same-date peer and shared name resources are deliberate, not conflicts.
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.input_id(102),'Synthetic mapped teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.input_id(202),'Synthetic mapped room',array['영어']);
create temp table authored_reader_cases(label text,plan jsonb,expected jsonb);
insert into authored_reader_cases values
('same-date',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','authored-a','date','2026-10-08','startTime','14:00','endTime','15:30','teacherCatalogId',pg_temp.input_id(101),'classroomCatalogId',pg_temp.input_id(201),'memo','  original memo  '),
 jsonb_build_object('id','authored-peer','date','2026-10-08','startTime','16:00','endTime','17:00','teacherCatalogId',pg_temp.input_id(101),'classroomCatalogId',pg_temp.input_id(201),'teacherNote','peer learning')),
 'sessionSchedules',jsonb_build_object('2026-10-08',jsonb_build_object('startTime','12:00','endTime','13:00','teacherCatalogId',pg_temp.input_id(101),'classroomCatalogId',pg_temp.input_id(201),'opaque',true))),
 jsonb_build_array(jsonb_build_object('startMinute',840,'endMinute',930,'teacherId',pg_temp.input_id(101),'classroomId',pg_temp.input_id(201)),jsonb_build_object('startMinute',960,'endMinute',1020,'teacherId',pg_temp.input_id(101),'classroomId',pg_temp.input_id(201)))),
('name-only',jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','authored-a','date','2026-10-08','startTime','09:00','endTime','13:30','teacherName','Synthetic input teacher','classroomName','Synthetic input room','memo','  original memo  ')),
 'sessionSchedules',jsonb_build_object('2026-10-08',jsonb_build_object('startTime','09:00','endTime','13:30','teacherName','Synthetic mapped teacher','classroomName','Synthetic mapped room','opaque',true))),
 jsonb_build_array(jsonb_build_object('startMinute',540,'endMinute',810,'teacherId',pg_temp.input_id(102),'classroomId',pg_temp.input_id(202))));
create function pg_temp.assert_authored_reader_case(n int,label_arg text) returns setof text language plpgsql as $$
declare target uuid:=pg_temp.input_id(303); before_plan jsonb; candidate jsonb; expected jsonb; ref jsonb; found jsonb;
begin
 select schedule_plan into before_plan from public.classes where id=target;
 select c.plan,c.expected into candidate,expected from authored_reader_cases c where c.label=label_arg;
 perform set_config('role','authenticated',true);
 perform public.update_class_operational_v1(target,jsonb_build_object('schedule_plan',candidate),pg_temp.input_id(n),before_plan);
 perform set_config('role','postgres',true);
 return next is((select schedule_plan from public.classes where id=target),candidate,label_arg||': official save retains exact raw rows, metadata, names, memo and order');
 foreach ref in array array[dashboard_private.read_timetable_operating_reference_v1(),dashboard_private.read_makeup_operating_reference_v1('2026-10-08','2026-10-08')] loop
  select coalesce(jsonb_agg(jsonb_build_object('startMinute',x->'startMinute','endMinute',x->'endMinute','teacherId',x->'teacherId','classroomId',x->'classroomId') order by x->>'id'),'[]') into found
  from jsonb_array_elements(ref->'datedSessions') x where x->>'classId'=target::text;
  return next is(found,expected,label_arg||': actual operating/makeup reader preserves authored fields and peer');
  return next is((select count(*)::int from jsonb_array_elements(ref->'datedUnresolvedOccupancies') x where x->>'classId'=target::text),0,label_arg||': no date-count ambiguity drops the saved row');
 end loop;
end $$;
select * from pg_temp.assert_authored_reader_case(651,'same-date');
select * from pg_temp.assert_authored_reader_case(652,'name-only');
select lives_ok('set constraints all immediate','authored reader fixtures finalize with real guards');
select is((select count(*) from dashboard_private.notification_events),(select events from input_before),'authored reader fixtures create no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from input_before),'authored reader fixtures create no notification delivery');

-- PR161: the official writer and effective readers share minute-precision
-- start/end boundaries. PostgreSQL time alone also accepts 24:00 and seconds.
create temp table time_input_before as select
 (select schedule_plan from public.classes where id=pg_temp.input_id(301)) plan,
 (select count(*) from dashboard_private.class_schedule_mutation_receipts) receipts;
create function pg_temp.save_time_input(start_arg text,end_arg jsonb,include_end boolean,key_no int) returns jsonb language plpgsql as $$
declare before_plan jsonb; candidate jsonb; row_data jsonb; result jsonb;
begin
 select schedule_plan into before_plan from public.classes where id=pg_temp.input_id(301);
 row_data:=jsonb_build_object('id','time-edge','date','2026-10-30','startTime',start_arg,
  'teacherCatalogId',pg_temp.input_id(101),'classroomCatalogId',pg_temp.input_id(201));
 if include_end then row_data:=row_data||jsonb_build_object('endTime',end_arg);end if;
 candidate:=jsonb_set(before_plan,'{sessions}',before_plan->'sessions'||jsonb_build_array(row_data));
 result:=public.update_class_operational_v1(pg_temp.input_id(301),jsonb_build_object('schedule_plan',candidate),pg_temp.input_id(key_no),before_plan);
 -- Unexpected success must roll back this case so later cases stay independent.
 if key_no<707 then raise exception using errcode='PZ001',message='unexpected_time_acceptance';end if;
 return result;
end $$;
set local role authenticated;
select throws_ok($$select pg_temp.save_time_input('24:00',null,false,701)$$,'22023','class_schedule_validation','PR161: start 24:00 with no end is rejected');
select throws_ok($$select pg_temp.save_time_input('24:00','null',true,702)$$,'22023','class_schedule_validation','PR161: start 24:00 with null end is rejected');
select throws_ok($$select pg_temp.save_time_input('24:00','""',true,703)$$,'22023','class_schedule_validation','PR161: start 24:00 with empty end is rejected');
select throws_ok($$select pg_temp.save_time_input('23:00','"24:01"',true,704)$$,'22023','class_schedule_validation','PR161: end beyond 24:00 is rejected');
select throws_ok($$select pg_temp.save_time_input('23:00:01','"24:00"',true,705)$$,'22023','class_schedule_validation','PR161: sub-minute start is not silently truncated');
select throws_ok($$select pg_temp.save_time_input('23:00','"24:00:00.1"',true,706)$$,'22023','class_schedule_validation','PR161: fractional end beyond midnight is rejected');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.input_id(301)),(select plan from time_input_before),'PR161: rejected input preserves the complete prior plan');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts),(select receipts from time_input_before),'PR161: rejected input leaves no receipt');
set local role authenticated;
select lives_ok($$select pg_temp.save_time_input('23:00','"24:00"',true,707)$$,'PR161: valid end 24:00 saves through the authenticated RPC');
select is(public.get_operations_class_lesson_design_detail_v1(pg_temp.input_id(301))#>>'{classItem,schedulePlan,sessions,-1,endTime}','24:00','PR161: official detail retains authored end 24:00');
reset role;
select is((select jsonb_array_length(schedule_plan->'sessions') from public.classes where id=pg_temp.input_id(301)),80,'PR161: valid time adds exactly one row to the existing 79');
select is((select (schedule_plan->'sessions') - 79 from public.classes where id=pg_temp.input_id(301)),(select plan->'sessions' from time_input_before),'PR161: valid time save preserves every previous row');
select is(dashboard_private.resolve_legacy_effective_schedule_v1(jsonb_build_object('session',jsonb_build_object('id','edge','date','2026-10-30','startTime','23:00','endTime','24:00')))#>>'{values,endTime}','24:00','PR161: final SQL resolver preserves end boundary');
create function pg_temp.assert_time_boundary_readers() returns setof text language plpgsql as $$
declare ref jsonb; target text:=pg_temp.input_id(301)::text;
begin
 foreach ref in array array[dashboard_private.read_timetable_operating_reference_v1(),dashboard_private.read_makeup_operating_reference_v1('2026-10-30','2026-10-30')] loop
  return next is((select jsonb_build_object('startMinute',x->'startMinute','endMinute',x->'endMinute')
   from jsonb_array_elements(ref->'datedSessions') x where x->>'classId'=target and x->>'date'='2026-10-30'),
   '{"startMinute":1380,"endMinute":1440}'::jsonb,'PR161: actual operating/makeup reader preserves midnight end');
  return next is((select count(*)::int from jsonb_array_elements(ref->'datedUnresolvedOccupancies') x
   where x->>'classId'=target and x->>'date'='2026-10-30'),0,'PR161: midnight end does not become unresolved');
 end loop;
end $$;
select * from pg_temp.assert_time_boundary_readers();
select is((select count(*) from dashboard_private.class_lesson_input_scopes),0::bigint,'PR161: successful and rejected time saves leave no scope');
select lives_ok('set constraints all immediate','PR161: time-boundary saves finalize with actual guards');
select * from finish();
rollback;
