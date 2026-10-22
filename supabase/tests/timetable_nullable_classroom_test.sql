begin;
select no_plan();
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1)
on conflict(singleton) do update set version=1;
create function pg_temp.room_id(n int) returns uuid language sql immutable as $$
 select ('a2200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.room_day(n int) returns date language sql stable as $$
 select (now() at time zone 'Asia/Seoul')::date+7+((n-extract(dow from (now() at time zone 'Asia/Seoul')::date)::int+7)%7)
$$;
insert into auth.users(id,instance_id,aud,role,email)
values(pg_temp.room_id(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','nullable-room@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.room_id(901),'admin','Nullable room fixture')
on conflict(id) do update set role='admin';
insert into public.teacher_catalogs(id,name,subjects) values
(pg_temp.room_id(101),'Nullable teacher A',array['영어']),
(pg_temp.room_id(102),'Nullable teacher B',array['영어']),
(pg_temp.room_id(103),'Nullable teacher C',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values
(pg_temp.room_id(201),'Nullable room A',array['영어']),
(pg_temp.room_id(202),'Nullable room B',array['영어']),
(pg_temp.room_id(203),'Nullable room C',array['영어']);
-- Synthetic legacy baseline only. All assertions below use real writers and
-- their existing authorization, optimistic plan check and deferred validator.
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan) values
(pg_temp.room_id(301),'Nullable Tuesday Saturday','영어','수강','legacy',E'화 19:30-21:30\n토 16:30-18:00','Nullable teacher A','','{}'),
(pg_temp.room_id(302),'Assigned other class','영어','수강','legacy','화 19:30-21:30','Nullable teacher B','Nullable room A','{}'),
(pg_temp.room_id(303),'New nullable lessons','영어','수강','legacy','화 19:30-21:30','Nullable teacher C','강의실 미정','{}'),
(pg_temp.room_id(304),'Malformed room label','영어','수강','legacy','목 09:00-10:00','Nullable teacher A','Unknown nonempty room','{}');
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
create temp table nullable_originals as select id,to_jsonb(c) row from public.classes c
where id in(pg_temp.room_id(302),pg_temp.room_id(304));
create temp table nullable_no_send as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
select set_config('request.jwt.claim.sub',pg_temp.room_id(901)::text,true);
set local role authenticated;

select lives_ok($q$select public.create_class_with_group_memberships_v1(
 jsonb_build_object('id',pg_temp.room_id(305),'name','Unplaced class','subject','영어'), '{}')$q$,
 'a class without any weekly placement can be created without reserving all resources');
select is((select count(*)::int from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'unresolvedOccupancies') b
 where b->>'classId'=pg_temp.room_id(305)::text),0,'an unplaced class does not block unrelated schedules');
select is((select count(*)::int from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'shadowSlots') s
 where s->>'classId'=pg_temp.room_id(301)::text and s->>'teacherId'=pg_temp.room_id(101)::text and s->>'classroomId' is null),
 2,'unassigned rooms retain both known weekly teacher occupancies');
select is((select count(*)::int from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'unresolvedOccupancies') b
 where b->>'classId'=pg_temp.room_id(304)::text),1,'unknown nonempty room labels remain unresolved');

select lives_ok($q$select public.update_class_operational_v1(pg_temp.room_id(301),
 jsonb_build_object('schedule',E'화 19:30-21:30 (Nullable teacher A, Nullable room B)\n토 16:30-18:00 (Nullable teacher A, 강의실 미정)',
 'room','Nullable room B(화), 강의실 미정(토)'),pg_temp.room_id(601),null)$q$,
 'assigning only Tuesday room succeeds while Saturday stays unassigned');
select is((select schedule from public.classes where id=pg_temp.room_id(301)),
 E'화 19:30-21:30 (Nullable teacher A, Nullable room B)\n토 16:30-18:00 (Nullable teacher A, 강의실 미정)',
 'Tuesday assignment persists through the ordinary class read');
select lives_ok($q$select public.update_class_operational_v1(pg_temp.room_id(301),
 jsonb_build_object('schedule',E'화 19:30-21:30 (Nullable teacher A, Nullable room A)\n토 16:30-18:00 (Nullable teacher A, 강의실 미정)',
 'room','Nullable room A(화), 강의실 미정(토)'),pg_temp.room_id(602),null)$q$,
 'basic room input may select an occupied actual room without rewriting other classes');
select is((select schedule from public.classes where id=pg_temp.room_id(301)),
 E'화 19:30-21:30 (Nullable teacher A, Nullable room A)\n토 16:30-18:00 (Nullable teacher A, 강의실 미정)',
 'accepted room input preserves exact per-day weekly values');
select lives_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('teacher','Nullable teacher A'),pg_temp.room_id(603),null)$q$,
 'basic teacher input is not blocked by other dated or weekly occupancy');
select is((select teacher from public.classes where id=pg_temp.room_id(303)),'Nullable teacher A','selected teacher persists');
select lives_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('teacher','Nullable teacher C'),pg_temp.room_id(620),null)$q$,
 'restore the synthetic teacher before independent nullable lesson reader cases');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('room','Unknown nonempty room'),pg_temp.room_id(604),null)$q$,
 '22023','class_schedule_catalog_invalid','a bad room label is not converted to optional null');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('teacher',''),pg_temp.room_id(605),null)$q$,
 '22023','class_schedule_catalog_invalid','a placed class still requires its teacher');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('schedule','화 21:30-19:30'),pg_temp.room_id(606),null)$q$,
 '22023','class_schedule_validation','invalid time ranges remain rejected');

select lives_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('schedule_plan',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','nullable-one','date',pg_temp.room_day(2),'scheduleState','active','isForced',false)))),
 pg_temp.room_id(607),'{}')$q$,'adding a dated lesson with only its room unassigned succeeds');
select is((select count(*)::int from jsonb_array_elements(public.get_timetable_operational_reference_v1()->'datedSessions') s
 where s->>'classId'=pg_temp.room_id(303)::text and s->>'teacherId'=pg_temp.room_id(103)::text and s->>'classroomId' is null),
 1,'saved nullable lesson has known teacher occupancy after fresh projection');
select lives_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('schedule_plan',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','nullable-one','date',pg_temp.room_day(2),'scheduleState','active','isForced',false,'classroomCatalogId',pg_temp.room_id(201))))),
 pg_temp.room_id(608),(select schedule_plan from public.classes where id=pg_temp.room_id(303)))$q$,
 'dated lesson input accepts the selected room even when another class occupies it');
select is((select schedule_plan#>>'{sessions,0,classroomCatalogId}' from public.classes where id=pg_temp.room_id(303)),
 pg_temp.room_id(201)::text,'fresh dated lesson read preserves the selected occupied room');
select lives_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('schedule_plan',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','nullable-one','date',pg_temp.room_day(2),'scheduleState','active','isForced',false,'classroomCatalogId',pg_temp.room_id(203))))),
 pg_temp.room_id(611),(select schedule_plan from public.classes where id=pg_temp.room_id(303)))$q$,
 'later assignment to a free actual room succeeds');
select is((select schedule_plan#>>'{sessions,0,classroomCatalogId}' from public.classes where id=pg_temp.room_id(303)),
 pg_temp.room_id(203)::text,'fresh read confirms the actual dated room assignment');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('schedule_plan',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','nullable-one','date',pg_temp.room_day(2),'scheduleState','active','classroomCatalogId',pg_temp.room_id(999))))),
 pg_temp.room_id(609),(select schedule_plan from public.classes where id=pg_temp.room_id(303)))$q$,
 '22023','class_schedule_catalog_invalid','a nonexistent dated room ID remains invalid');
select lives_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('schedule_plan',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','nullable-one','date',pg_temp.room_day(2),'scheduleState','active'),
 jsonb_build_object('id','nullable-two','date',pg_temp.room_day(2),'scheduleState','active')))),
 pg_temp.room_id(610),(select schedule_plan from public.classes where id=pg_temp.room_id(303)))$q$,
 'distinct same-class lesson identities may occupy the same date with null rooms');
select is((select schedule_plan->'sessions' from public.classes where id=pg_temp.room_id(303)),
 jsonb_build_array(
 jsonb_build_object('id','nullable-one','date',pg_temp.room_day(2),'scheduleState','active'),
 jsonb_build_object('id','nullable-two','date',pg_temp.room_day(2),'scheduleState','active')),
 'both intended same-date lessons retain their exact identities and order');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.room_id(303),
 jsonb_build_object('schedule_plan',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','nullable-one','date',pg_temp.room_day(2),'scheduleState','active'),
 jsonb_build_object('id','nullable-one','date',pg_temp.room_day(2),'scheduleState','active')))),
 pg_temp.room_id(612),(select schedule_plan from public.classes where id=pg_temp.room_id(303)))$q$,
 '22023','class_schedule_validation','duplicate lesson identity remains rejected with unassigned rooms');

-- A second actual writer covers normalized creation, generation, edits and the
-- bounded makeup availability DTO. Known teacher occupancy is retained throughout.
select lives_ok($q$select public.create_class_with_group_memberships_v1(
 jsonb_build_object('id',pg_temp.room_id(306),'name','Normalized nullable class','subject','영어'), '{}')$q$,
 'create an unplaced normalized-workflow class');
select lives_ok($q$select public.initialize_new_class_schedule_v1(pg_temp.room_id(306),
 (public.get_class_schedule_defaults_v1(pg_temp.room_id(306))->>'scheduleRevision')::bigint,
 public.get_class_schedule_defaults_v1(pg_temp.room_id(306))->>'schedulePlanHash',
 jsonb_build_array(jsonb_build_object('id',null,'weekday',4,'startTime','15:00','endTime','16:00',
 'teacherCatalogId',pg_temp.room_id(101),'classroomCatalogId',null,'sortOrder',0)),pg_temp.room_id(620))$q$,
 'initialize a real weekly slot with known teacher and no room');
select lives_ok($q$select public.create_class_with_group_memberships_v1(
 jsonb_build_object('id',pg_temp.room_id(307),'name','Known room next to nullable slot','subject','영어',
 'schedule','목 15:00-16:00','teacher','Nullable teacher B','room','Nullable room A'), '{}')$q$,
 'known room beside a different-teacher null room is allowed');
create temp table nullable_generation as select (public.get_class_schedule_defaults_v1(pg_temp.room_id(306))->>'scheduleRevision')::bigint revision;
select lives_ok($q$select public.generate_class_lesson_sessions_v1(pg_temp.room_id(306),
 (select revision from nullable_generation),pg_temp.room_day(4),pg_temp.room_day(4),pg_temp.room_id(621),null)$q$,
 'generate a normalized dated session with an unassigned room');
select lives_ok($q$select public.generate_class_lesson_sessions_v1(pg_temp.room_id(306),
 (select revision from nullable_generation),pg_temp.room_day(4),pg_temp.room_day(4),pg_temp.room_id(621),null)$q$,
 'replay of the same nullable generation request is idempotent');
select is((select count(*)::int from public.class_lesson_sessions where class_id=pg_temp.room_id(306)),1,
 'replay does not duplicate the generated session');
select ok((select bool_and(x->>'classroom' is null and x->'uncertain'='false'::jsonb and x->'allRooms'='false'::jsonb)
 from jsonb_array_elements(public.get_makeup_effective_occupancy_v1(jsonb_build_array(jsonb_build_object(
 'startAt',pg_temp.room_day(4)::text||'T06:00:00.000Z','endAt',pg_temp.room_day(4)::text||'T07:00:00.000Z')))->'occupancies') x
 where x->>'classId'=pg_temp.room_id(306)::text),'bounded availability does not reserve all rooms for a normalized unassigned room');
create function pg_temp.save_nullable_session(room_number int,teacher_number int,key_number int) returns jsonb language sql as $f$
 select public.save_class_lesson_session_v1(id,revision,schedule_state,session_date,start_time,end_time,
 pg_temp.room_id(teacher_number),case when room_number is null then null else pg_temp.room_id(room_number) end,
 memo,public_note,teacher_note,pg_temp.room_id(key_number),null)
 from public.class_lesson_sessions where class_id=pg_temp.room_id(306)
$f$;
select lives_ok($q$select pg_temp.save_nullable_session(201,101,622)$q$,
 'normalized dated input accepts the actual room already occupied by another teacher');
select is((select classroom_catalog_id from public.class_lesson_sessions where class_id=pg_temp.room_id(306)),pg_temp.room_id(201),
 'normalized read preserves the explicitly selected occupied room');
select lives_ok($q$select pg_temp.save_nullable_session(null,102,623)$q$,
 'normalized null-room input accepts the selected teacher despite a dated conflict');
select ok((select classroom_catalog_id is null and teacher_catalog_id=pg_temp.room_id(102)
 from public.class_lesson_sessions where class_id=pg_temp.room_id(306)),
 'normalized read preserves the explicit room clear and selected teacher');
select lives_ok($q$select pg_temp.save_nullable_session(202,101,624)$q$,
 'normalized later assignment to a free actual room succeeds');
select is((select classroom_catalog_id from public.class_lesson_sessions where class_id=pg_temp.room_id(306)),
 pg_temp.room_id(202),'fresh normalized read confirms actual room');
select lives_ok($q$select pg_temp.save_nullable_session(null,101,625)$q$,'explicit normalized room clear is allowed');
select throws_ok($q$select public.save_class_lesson_session_v1(id,999,schedule_state,session_date,start_time,end_time,
 teacher_catalog_id,classroom_catalog_id,memo,public_note,teacher_note,pg_temp.room_id(626),null)
 from public.class_lesson_sessions where class_id=pg_temp.room_id(306)$q$,'P0001','class_schedule_stale',
 'nullable room does not disable stale revision protection');

reset role;
set constraints all immediate;
select ok(not exists(select 1 from nullable_originals o join public.classes c on c.id=o.id where o.row<>to_jsonb(c)),
 'unrelated assigned and malformed classes remain unchanged');
select is((select count(*) from dashboard_private.notification_events),(select events from nullable_no_send),'no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from nullable_no_send),'no notification delivery');
select ok(not has_function_privilege('authenticated','dashboard_private.read_timetable_class_weekly_v2(public.classes)','execute'),
 'private reader access remains private');
select * from finish();
rollback;
