begin;
select no_plan();
create function pg_temp.sid(n int) returns uuid language sql immutable as $$select ('ac270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.next_day(n int) returns date language sql stable as $$select (now() at time zone 'Asia/Seoul')::date+7+((n-extract(dow from (now() at time zone 'Asia/Seoul')::date)::int+7)%7)$$;
insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.sid(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','scoped@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.sid(901),'admin','scoped fixture') on conflict(id) do update set role='admin';
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.sid(101),'scoped teacher',array['영어']), (pg_temp.sid(102),'other scoped teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.sid(201),'scoped room',array['영어']), (pg_temp.sid(202),'other scoped room',array['영어']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan) values
(pg_temp.sid(301),'retained labels','영어','수강','normalized','월 19:30-21:30','scoped teacher','scoped room','{}'),
(pg_temp.sid(302),'room undecided','영어','수강','legacy','화 19:30-21:30','other scoped teacher','미정','{}'),
(pg_temp.sid(303),'legacy regular','영어','수강','legacy','수 10:00-11:00; 수 12:00-13:00','scoped teacher','scoped room',jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','regular','sessionKey','regular','date',pg_temp.next_day(3),'scheduleState','active','state','active','isForced',false,'originalDate','','makeupDate','','textbookEntries','[]'::jsonb,'progressStatus','대기'))));
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_name,classroom_name)
values(pg_temp.sid(401),pg_temp.sid(301),1,'19:30','21:30','scoped teacher','scoped room');
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_name_snapshot,classroom_name_snapshot,source_schedule_slot_id,origin) values(pg_temp.sid(501),pg_temp.sid(301),'retained-session',pg_temp.next_day(1),'active','19:30','21:30','scoped teacher','scoped room',pg_temp.sid(401),'legacy');
-- Seed historical shapes in an isolated owner fixture; all tested operations run
-- the real public RPC, authorization, lock and deferred checks after this baseline.
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
create temp table originals as select id,to_jsonb(c) row from public.classes c where id in(pg_temp.sid(301),pg_temp.sid(302),pg_temp.sid(303));
create temp table original_slots as select to_jsonb(s) row from public.class_schedule_slots s where class_id=pg_temp.sid(301);
create temp table no_send as select (select count(*) from dashboard_private.notification_events) events,(select count(*) from dashboard_private.notification_deliveries) deliveries;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
set local role authenticated;
select lives_ok($q$select public.mutate_timetable_plan_v1(jsonb_build_object('operation','create','planId',pg_temp.sid(1),'name','scoped future','requestKey','scoped-create'))$q$,'create future preset with existing unresolved occupancy');
select is((public.get_timetable_plan_v1(pg_temp.sid(1))->>'occupancyValidationVersion')::int,2,'snapshot advertises scoped validation, not global lock');
select is((select count(*)::int from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'shadowSlots') s where s->>'classId'=pg_temp.sid(301)::text and s->>'teacherId'=pg_temp.sid(101)::text and s->>'classroomId'=pg_temp.sid(201)::text),1,'normalized labels resolve without writing missing UUIDs');
select is((select b->>'weekday' from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'unresolvedOccupancies') b where b->>'classId'=pg_temp.sid(302)::text),'2','undecided room keeps exact weekday');
select is((select b->>'startMinute' from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'unresolvedOccupancies') b where b->>'classId'=pg_temp.sid(302)::text),'1170','undecided room keeps exact interval');
select is((select count(*)::int from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'datedSessions') s where s->>'classId'=pg_temp.sid(303)::text),2,'real legacy regular producer shape inherits every default interval');
select ok((select bool_and(s->>'sourceSlotId' is null and s->>'inheritedWeeklySlotId' is not null) from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'datedSessions') s where s->>'classId'=pg_temp.sid(303)::text),'inherited legacy rows never invent normalized source authority');
select is((select s->>'teacherId' from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'datedSessions') s where s->>'id'='session:'||pg_temp.sid(501)::text),pg_temp.sid(101)::text,'normalized dated retained labels resolve read-only');
reset role;
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),pg_temp.next_day(3)) s where s->>'classId'=pg_temp.sid(303)::text),2,'legacy default provenance is not double counted as a second reservation');
create function pg_temp.command(i int,d int,a int,b int) returns jsonb language sql as $$select jsonb_build_object('operation','save','planId',pg_temp.sid(1),'expectedMetaRevision',(public.get_timetable_plan_revision_v1(pg_temp.sid(1))->>'metaRevision')::int,'expectedShadowFingerprint',public.get_timetable_plan_revision_v1(pg_temp.sid(1))->>'shadowFingerprint','expectedItemRevision',null,'requestKey','scoped-'||i::text||'-'||d::text||'-'||a::text,'item',jsonb_build_object('id',pg_temp.sid(i),'planId',pg_temp.sid(1),'name','새 수업','subject','영어','subjectAreaKey',null,'grade','중2','capacity',12,'tuition',100000,'defaultTeacherId',pg_temp.sid(101),'defaultClassroomId',pg_temp.sid(201),'durationMinutes',60,'pendingSlots','[]'::jsonb),'slots',jsonb_build_array(jsonb_build_object('id',pg_temp.sid(i+100),'itemId',pg_temp.sid(i),'planId',pg_temp.sid(1),'weekday',d,'startMinute',a,'endMinute',b,'teacherId',pg_temp.sid(101),'classroomId',pg_temp.sid(201),'sourceSlotId',null)))$$;
set local role authenticated;
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.command(11,1,600,660))$q$,'unrelated Monday saves despite unresolved Tuesday');
select throws_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.command(12,1,1200,1230))$q$,'23P01','timetable_resource_conflict','resolved normalized shadow still prevents teacher and room overlap');
select throws_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.command(12,2,1170,1230))$q$,'23P01','timetable_resource_conflict','only the undecided room interval blocks new placement');
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.command(12,2,1290,1350))$q$,'half-open interval immediately after uncertainty saves');
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.command(13,4,600,660)||jsonb_build_object('slots','[]'::jsonb))$q$,'unplaced draft saves regardless of uncertainty');
select lives_ok($q$select public.mutate_timetable_plan_v1(jsonb_build_object('operation','rename','planId',pg_temp.sid(1),'expectedMetaRevision',0,'name','dated review','targetStartDate',pg_temp.next_day(0),'targetEndDate',pg_temp.next_day(0)+14,'requestKey','scope-period'))$q$,'dated period can be selected without locking unrelated draft editing');
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.command(14,4,600,660))$q$,'unrelated placement saves with dated review period');
create temp table promotion_request as select jsonb_build_object('source',jsonb_build_object('kind','plan','planId',pg_temp.sid(1)),'target',jsonb_build_object('kind','operational'),'mode','copy','itemIds',jsonb_build_array(pg_temp.sid(14)),'onConflict','reject') r;
select is((select public.preview_timetable_plan_transfer_v1(r)->'blockers' from promotion_request),'[]'::jsonb,'promotion preview checks selected placements only');
select lives_ok($q$select public.commit_timetable_plan_transfer_v1(jsonb_build_object('request',r,'previewFingerprint',public.preview_timetable_plan_transfer_v1(r)->>'fingerprint','requestKey','scope-promotion')) from promotion_request$q$,'actual isolated promotion succeeds despite unrelated incomplete room');
reset role;
set constraints all immediate;set constraints all deferred;
select ok(not exists(select 1 from originals o join public.classes c on c.id=o.id where o.row<>to_jsonb(c)),'planning and isolated promotion preserve every original class field');
select is((select to_jsonb(s) from public.class_schedule_slots s where id=pg_temp.sid(401)),(select row from original_slots),'null source UUIDs and retained labels remain byte-for-byte unchanged');
select is((select count(*) from dashboard_private.notification_events),(select events from no_send),'no notification event from presets or promotion');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send),'no notification delivery');
select ok(not has_function_privilege('authenticated','dashboard_private.read_timetable_class_weekly_v2(public.classes)','execute'),'new private reader inaccessible to authenticated callers');
select ok(not has_function_privilege('anon','dashboard_private.timetable_blocker_intersects_v2(jsonb,jsonb)','execute'),'new private matcher inaccessible to anon');
select ok((select teacher_catalog_id is null and classroom_catalog_id is null from public.class_lesson_sessions where id=pg_temp.sid(501)),'normalized dated source UUIDs remain null');
-- Forced, makeup, explicit overrides, missing producer marker and duplicate
-- identities cannot acquire regular-default authority from date similarity.
update public.classes set schedule_plan=jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','forced','date',pg_temp.next_day(3),'scheduleState','active','isForced',true),
 jsonb_build_object('id','unmarked','date',pg_temp.next_day(3),'scheduleState','active'),
 jsonb_build_object('id','makeup','date',pg_temp.next_day(3),'scheduleState','makeup','isForced',false),
 jsonb_build_object('id','override','date',pg_temp.next_day(3),'scheduleState','active','isForced',false,'startTime',null),
 jsonb_build_object('id','duplicate','date',pg_temp.next_day(3),'scheduleState','active','isForced',false),
 jsonb_build_object('id','duplicate','date',pg_temp.next_day(3),'scheduleState','active','isForced',false),
 jsonb_build_object('id','past','date',pg_temp.next_day(3)-21,'scheduleState','active','isForced',false)
)) where id=pg_temp.sid(303);
select is((select count(*)::int from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'datedUnresolvedOccupancies') s where s->>'classId'=pg_temp.sid(303)::text),7,'non-default and past records remain explicit uncertainty');
-- Duplicate names must never choose a catalog arbitrarily.
drop index public.teacher_catalogs_name_key;
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.sid(103),'scoped teacher',array['영어']);
select is((select count(*)::int from jsonb_array_elements(dashboard_private.read_timetable_weekly_reference_v1()->'shadowSlots') s where s->>'classId'=pg_temp.sid(301)::text),0,'duplicate label does not guess a teacher UUID');
select is((select b->>'weekday' from jsonb_array_elements(dashboard_private.read_timetable_weekly_reference_v1()->'unresolvedOccupancies') b where b->>'classId'=pg_temp.sid(301)::text),'1','ambiguous retained name remains a scoped blocker');
select * from finish();
rollback;
