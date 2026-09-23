begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local statement_timeout = '60s';
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1)
on conflict(singleton) do update set version=excluded.version;

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('ac230000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000000','authenticated','authenticated','schedule-save-admin@test.invalid','{}','{}',now(),now()),
('ac230000-0000-4000-8000-000000000902','00000000-0000-0000-0000-000000000000','authenticated','authenticated','schedule-save-staff@test.invalid','{}','{}',now(),now()),
('ac230000-0000-4000-8000-000000000903','00000000-0000-0000-0000-000000000000','authenticated','authenticated','schedule-save-teacher@test.invalid','{}','{}',now(),now());
insert into public.profiles(id, role, name, email) values
('ac230000-0000-4000-8000-000000000901','admin','일정 저장 관리자','schedule-save-admin@test.invalid'),
('ac230000-0000-4000-8000-000000000902','staff','일정 저장 직원','schedule-save-staff@test.invalid'),
('ac230000-0000-4000-8000-000000000903','teacher','일정 저장 비인가','schedule-save-teacher@test.invalid')
on conflict (id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
insert into public.teacher_catalogs(id,name,subjects,is_visible,sort_order) values
('ac230000-0000-4000-8000-000000000101','교사 A',array['영어'],true,901),
('ac230000-0000-4000-8000-000000000102','교사 B',array['영어'],true,902);
insert into public.classroom_catalogs(id,name,subjects,is_visible,sort_order,campus) values
('ac230000-0000-4000-8000-000000000201','강의실 1',array['영어'],true,901,'본관'),
('ac230000-0000-4000-8000-000000000202','강의실 2',array['영어'],true,902,'본관');
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan,schedule_storage_mode) values
('ac230000-0000-4000-8000-000000000301','저장 대상 A','정규','영어','고1','교사 A, 교사 B','월 09:00-10:00, 수 14:00-15:00','강의실 1(월), 강의실 2(수)',12,100000,'수업 진행 중','[]','[]','[]','[]','{}','normalized'),
('ac230000-0000-4000-8000-000000000302','비대상 B','정규','영어','고2','교사 B','화 11:00-12:00','강의실 2',12,100000,'수업 진행 중','[]','[]','[]','[]','{}','normalized');
select pg_catalog.set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name,sort_order) values
('ac230000-0000-4000-8000-000000000401','ac230000-0000-4000-8000-000000000301',1,'09:00','10:00','ac230000-0000-4000-8000-000000000101','교사 A','ac230000-0000-4000-8000-000000000201','강의실 1',0),
('ac230000-0000-4000-8000-000000000402','ac230000-0000-4000-8000-000000000301',1,'10:00','11:00','ac230000-0000-4000-8000-000000000101','교사 A','ac230000-0000-4000-8000-000000000201','강의실 1',1),
('ac230000-0000-4000-8000-000000000403','ac230000-0000-4000-8000-000000000301',3,'14:00','15:00','ac230000-0000-4000-8000-000000000102','교사 B','ac230000-0000-4000-8000-000000000202','강의실 2',2),
('ac230000-0000-4000-8000-000000000404','ac230000-0000-4000-8000-000000000302',2,'11:00','12:00','ac230000-0000-4000-8000-000000000102','교사 B','ac230000-0000-4000-8000-000000000202','강의실 2',0);
insert into public.class_lesson_sessions(class_id,session_key,source_schedule_slot_id,session_date,schedule_state,start_time,end_time,teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,classroom_name_snapshot,origin) values
('ac230000-0000-4000-8000-000000000301','past-a','ac230000-0000-4000-8000-000000000401','2026-09-21','active','09:00','10:00','ac230000-0000-4000-8000-000000000101','교사 A','ac230000-0000-4000-8000-000000000201','강의실 1','default');
create temporary table schedule_safety_before as select
 (select jsonb_build_object('schedule',schedule,'teacher',teacher,'room',room,'revision',schedule_revision) from public.classes where id='ac230000-0000-4000-8000-000000000302') as class_b,
 (select to_jsonb(s) from public.class_lesson_sessions s where session_key='past-a' and class_id='ac230000-0000-4000-8000-000000000301') as past_session;

select ok((select condeferrable from pg_catalog.pg_constraint where conrelid='public.class_schedule_slots'::regclass and conname='class_schedule_slots_class_time_key'),'slot time uniqueness is deferrable for ID-preserving swaps');
select pg_catalog.set_config('request.jwt.claim.sub','ac230000-0000-4000-8000-000000000901',true);
create temporary table schedule_safety_save as select public.save_class_schedule_defaults_v1(
 'ac230000-0000-4000-8000-000000000301',0,
 '[{"id":"ac230000-0000-4000-8000-000000000401","weekday":1,"startTime":"09:00","endTime":"10:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":0},{"id":"ac230000-0000-4000-8000-000000000402","weekday":1,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":1},{"id":"ac230000-0000-4000-8000-000000000403","weekday":3,"startTime":"14:00","endTime":"15:30","teacherCatalogId":"ac230000-0000-4000-8000-000000000102","classroomCatalogId":"ac230000-0000-4000-8000-000000000202","sortOrder":2}]'::jsonb,
 'ac230000-0000-4000-8000-000000000501',null) as payload;
select is((select jsonb_build_object('schedule',schedule,'teacher',teacher,'room',room,'revision',schedule_revision) from public.classes where id='ac230000-0000-4000-8000-000000000302'),(select class_b from schedule_safety_before),'saving A preserves B schedule metadata and revision');
select is((select schedule_revision from public.classes where id='ac230000-0000-4000-8000-000000000301'),1::bigint,'only A revision increments');
select is((select schedule from public.classes where id='ac230000-0000-4000-8000-000000000301'),E'월 09:00-10:00 (교사 A, 강의실 1)\n월 10:00-11:00 (교사 A, 강의실 1)\n수 14:00-15:30 (교사 B, 강의실 2)'::text,'legacy schedule keeps per-slot teacher and room details');
select is((select teacher from public.classes where id='ac230000-0000-4000-8000-000000000301'),'교사 A, 교사 B','legacy teacher projection keeps both resources');
select is((select room from public.classes where id='ac230000-0000-4000-8000-000000000301'),'강의실 1(월), 강의실 1(월), 강의실 2(수)','legacy room projection keeps weekday assignments');
select is((select to_jsonb(s) from public.class_lesson_sessions s where session_key='past-a' and class_id='ac230000-0000-4000-8000-000000000301'),(select past_session from schedule_safety_before),'past session snapshot and slot FK remain unchanged');
select is((select payload from schedule_safety_save),public.save_class_schedule_defaults_v1('ac230000-0000-4000-8000-000000000301',0,'[{"id":"ac230000-0000-4000-8000-000000000401","weekday":1,"startTime":"09:00","endTime":"10:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":0},{"id":"ac230000-0000-4000-8000-000000000402","weekday":1,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":1},{"id":"ac230000-0000-4000-8000-000000000403","weekday":3,"startTime":"14:00","endTime":"15:30","teacherCatalogId":"ac230000-0000-4000-8000-000000000102","classroomCatalogId":"ac230000-0000-4000-8000-000000000202","sortOrder":2}]'::jsonb,'ac230000-0000-4000-8000-000000000501',null),'same request key replays exact receipt');
select throws_ok($$select public.save_class_schedule_defaults_v1('ac230000-0000-4000-8000-000000000301',0,'[]'::jsonb,'ac230000-0000-4000-8000-000000000502',null)$$,'P0001','class_schedule_stale','stale revision has domain SQLSTATE');
select throws_ok($$select public.save_class_schedule_defaults_v1('ac230000-0000-4000-8000-000000000301',1,'[{"id":"ac230000-0000-4000-8000-000000000404","weekday":2,"startTime":"11:00","endTime":"12:00","teacherCatalogId":null,"classroomCatalogId":null,"sortOrder":0}]'::jsonb,'ac230000-0000-4000-8000-000000000503',null)$$,'22023','class_schedule_slot_not_owned','B slot cannot be transferred through A save');
select throws_ok($$select public.save_class_schedule_defaults_v1('ac230000-0000-4000-8000-000000000301',1,'[{"id":"ac230000-0000-4000-8000-000000000401","weekday":1,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":0},{"id":"ac230000-0000-4000-8000-000000000402","weekday":1,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":1}]'::jsonb,'ac230000-0000-4000-8000-000000000508',null)$$,'22023','class_schedule_validation','duplicate final time tuple is rejected before commit');
select lives_ok($$select public.save_class_schedule_defaults_v1('ac230000-0000-4000-8000-000000000301',1,'[{"id":"ac230000-0000-4000-8000-000000000401","weekday":1,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":0},{"id":"ac230000-0000-4000-8000-000000000402","weekday":1,"startTime":"09:00","endTime":"10:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":1},{"id":"ac230000-0000-4000-8000-000000000403","weekday":3,"startTime":"14:00","endTime":"15:30","teacherCatalogId":"ac230000-0000-4000-8000-000000000102","classroomCatalogId":"ac230000-0000-4000-8000-000000000202","sortOrder":2}]'::jsonb,'ac230000-0000-4000-8000-000000000504',null)$$,'valid final time swap preserves existing slot IDs');
select is((select start_time from public.class_schedule_slots where id='ac230000-0000-4000-8000-000000000401'),'10:00'::time,'first slot ID keeps its row after swap');
select is((select start_time from public.class_schedule_slots where id='ac230000-0000-4000-8000-000000000402'),'09:00'::time,'second slot ID keeps its row after swap');
select is((select source_schedule_slot_id from public.class_lesson_sessions where session_key='past-a'),'ac230000-0000-4000-8000-000000000401'::uuid,'past session FK still targets original slot ID');
select pg_catalog.set_config('request.jwt.claim.sub','ac230000-0000-4000-8000-000000000903',true);
select throws_ok($$select public.save_class_schedule_defaults_v1('ac230000-0000-4000-8000-000000000301',2,'[]'::jsonb,'ac230000-0000-4000-8000-000000000505',null)$$,'42501','class_schedule_forbidden','teacher role cannot save defaults');
select pg_catalog.set_config('request.jwt.claim.sub','ac230000-0000-4000-8000-000000000902',true);
select lives_ok($$select public.save_class_schedule_defaults_v1(
 'ac230000-0000-4000-8000-000000000301',2,
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'weekday',weekday,'startTime',to_char(start_time,'HH24:MI'),'endTime',to_char(end_time,'HH24:MI'),'teacherCatalogId',teacher_catalog_id,'classroomCatalogId',classroom_catalog_id,'sortOrder',sort_order) order by sort_order),'[]'::jsonb) from public.class_schedule_slots where class_id='ac230000-0000-4000-8000-000000000301'),
 'ac230000-0000-4000-8000-000000000506',null)$$,'staff can idempotently save unchanged defaults');
create temporary table schedule_partial_save as select public.save_class_schedule_defaults_v1(
 'ac230000-0000-4000-8000-000000000301',2,
 '[{"id":"ac230000-0000-4000-8000-000000000401","weekday":1,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":0},{"id":"ac230000-0000-4000-8000-000000000402","weekday":2,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":null,"sortOrder":1},{"id":"ac230000-0000-4000-8000-000000000403","weekday":3,"startTime":"14:00","endTime":"15:30","teacherCatalogId":null,"classroomCatalogId":"ac230000-0000-4000-8000-000000000202","sortOrder":2},{"id":null,"weekday":5,"startTime":"16:00","endTime":"17:00","teacherCatalogId":null,"classroomCatalogId":null,"sortOrder":3}]'::jsonb,
 'ac230000-0000-4000-8000-000000000509',null) as payload;
select is((select schedule from public.classes where id='ac230000-0000-4000-8000-000000000301'),E'월 10:00-11:00 (교사 A, 강의실 1)\n화 10:00-11:00 (교사 A, )\n수 14:00-15:30 (, 강의실 2)\n금 16:00-17:00 (, )','mixed slots project explicit unassigned resources');
select is((select teacher from public.classes where id='ac230000-0000-4000-8000-000000000301'),'교사 A','teacher summary only names assigned teachers');
select is((select room from public.classes where id='ac230000-0000-4000-8000-000000000301'),'강의실 1(월), 강의실 2(수)','room summary only names assigned rooms');
select is((select jsonb_build_object('teacher',teacher_name,'room',classroom_name) from public.class_schedule_slots where class_id='ac230000-0000-4000-8000-000000000301' and weekday=5),'{"teacher": "", "room": ""}'::jsonb,'both-unassigned normalized slot stays empty');
create temporary table schedule_partial_timetable as
select row.value as payload from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value)
where row.value->>'classId'='ac230000-0000-4000-8000-000000000301';
select is((select count(*)::integer from schedule_partial_timetable),4,'legacy timetable returns all four mixed slots');
select is((select payload->>'teacher' from schedule_partial_timetable where payload->>'day'='월'),'교사 A','legacy timetable keeps fully assigned teacher');
select is((select payload->>'classroom' from schedule_partial_timetable where payload->>'day'='월'),'강의실 1','legacy timetable keeps fully assigned classroom');
select is((select payload->>'teacher' from schedule_partial_timetable where payload->>'day'='화'),'교사 A','legacy timetable keeps teacher-only teacher');
select is((select payload->>'classroom' from schedule_partial_timetable where payload->>'day'='화'),'','legacy timetable does not borrow a room for teacher-only slot');
select is((select payload->>'teacher' from schedule_partial_timetable where payload->>'day'='수'),'','legacy timetable does not borrow a teacher for room-only slot');
select is((select payload->>'classroom' from schedule_partial_timetable where payload->>'day'='수'),'강의실 2','legacy timetable keeps room-only classroom');
select is((select payload->>'teacher' from schedule_partial_timetable where payload->>'day'='금'),'','legacy timetable does not borrow a teacher for unassigned slot');
select is((select payload->>'classroom' from schedule_partial_timetable where payload->>'day'='금'),'','legacy timetable does not borrow a room for unassigned slot');
insert into public.teacher_catalogs(id,name,subjects,is_visible,sort_order) values
('ac230000-0000-4000-8000-000000000103','교사 미지정',array['영어'],true,903),
('ac230000-0000-4000-8000-000000000104','~v1:41~',array['영어'],true,904);
insert into public.classroom_catalogs(id,name,subjects,is_visible,sort_order,campus) values
('ac230000-0000-4000-8000-000000000203','강의실 미지정',array['영어'],true,903,'본관'),
('ac230000-0000-4000-8000-000000000204','~41',array['영어'],true,904,'본관');
create temporary table schedule_literal_save as select public.save_class_schedule_defaults_v1(
 'ac230000-0000-4000-8000-000000000301',3,
 '[{"id":"ac230000-0000-4000-8000-000000000401","weekday":1,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000103","classroomCatalogId":"ac230000-0000-4000-8000-000000000203","sortOrder":0},{"id":"ac230000-0000-4000-8000-000000000402","weekday":2,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000104","classroomCatalogId":"ac230000-0000-4000-8000-000000000204","sortOrder":1},{"id":"ac230000-0000-4000-8000-000000000403","weekday":3,"startTime":"14:00","endTime":"15:30","teacherCatalogId":null,"classroomCatalogId":null,"sortOrder":2}]'::jsonb,
 'ac230000-0000-4000-8000-000000000510',null) as payload;
select is((select schedule from public.classes where id='ac230000-0000-4000-8000-000000000301'),
 E'월 10:00-11:00 (교사 미지정, 강의실 미지정)\n화 10:00-11:00 (~v1:41~, ~41)\n수 14:00-15:30 (, )',
 'literal placeholder names and escape-prefix names have unambiguous projected details');
create temporary table schedule_literal_timetable as
select row.value as payload from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value)
where row.value->>'classId'='ac230000-0000-4000-8000-000000000301';
select is((select payload->>'teacher' from schedule_literal_timetable where payload->>'day'='월'),'교사 미지정','timetable preserves assigned teacher whose name matches absence marker');
select is((select payload->>'classroom' from schedule_literal_timetable where payload->>'day'='월'),'강의실 미지정','timetable preserves assigned room whose name matches absence marker');
select is((select payload->>'teacher' from schedule_literal_timetable where payload->>'day'='화'),'~v1:41~','timetable preserves literal former encoding token teacher');
select is((select payload->>'classroom' from schedule_literal_timetable where payload->>'day'='화'),'~41','timetable preserves literal tilde room');
select is((select payload->>'teacher' from schedule_literal_timetable where payload->>'day'='수'),'','timetable keeps a truly unassigned teacher empty');
select is((select payload->>'classroom' from schedule_literal_timetable where payload->>'day'='수'),'','timetable keeps a truly unassigned room empty');
set local role authenticated;
select is((select row.value->>'teacher' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000301' and row.value->>'day'='월'),'교사 미지정','authenticated timetable RPC preserves literal marker name under invoker ACL and RLS');
select is((select row.value->>'classroom' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000301' and row.value->>'day'='화'),'~41','authenticated timetable RPC preserves literal tilde room under invoker ACL and RLS');
reset role;
insert into public.teacher_catalogs(id,name,subjects,is_visible,sort_order) values
('ac230000-0000-4000-8000-000000000105','김, 민',array['영어'],true,905);
insert into public.classroom_catalogs(id,name,subjects,is_visible,sort_order,campus) values
('ac230000-0000-4000-8000-000000000205','강의실 1, 별관',array['영어'],true,905,'본관');
create temporary table schedule_comma_save as select public.save_class_schedule_defaults_v1(
 'ac230000-0000-4000-8000-000000000301',4,
 '[{"id":"ac230000-0000-4000-8000-000000000401","weekday":1,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000105","classroomCatalogId":"ac230000-0000-4000-8000-000000000201","sortOrder":0},{"id":"ac230000-0000-4000-8000-000000000402","weekday":2,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ac230000-0000-4000-8000-000000000101","classroomCatalogId":"ac230000-0000-4000-8000-000000000205","sortOrder":1},{"id":"ac230000-0000-4000-8000-000000000403","weekday":3,"startTime":"14:00","endTime":"15:30","teacherCatalogId":null,"classroomCatalogId":null,"sortOrder":2}]'::jsonb,
 'ac230000-0000-4000-8000-000000000511',null) as payload;
select is((select schedule from public.classes where id='ac230000-0000-4000-8000-000000000301'),E'월 10:00-11:00 (김, 민, 강의실 1)\n화 10:00-11:00 (교사 A, 강의실 1, 별관)\n수 14:00-15:30 (, )','comma catalog names remain literal in the compatibility projection');
select is((select jsonb_build_object('teacher',teacher_name,'room',classroom_name) from public.class_schedule_slots where class_id='ac230000-0000-4000-8000-000000000301' and weekday=1),'{"teacher": "김, 민", "room": "강의실 1"}'::jsonb,'normalized Monday slot retains comma teacher');
select is((select jsonb_build_object('teacher',teacher_name,'room',classroom_name) from public.class_schedule_slots where class_id='ac230000-0000-4000-8000-000000000301' and weekday=2),'{"teacher": "교사 A", "room": "강의실 1, 별관"}'::jsonb,'normalized Tuesday slot retains comma room');
set local role authenticated;
select is((select row.value->>'teacher' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000301' and row.value->>'day'='월'),'김, 민','authenticated normalized timetable uses full comma teacher from slot');
select is((select row.value->>'classroom' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000301' and row.value->>'day'='월'),'강의실 1','authenticated normalized timetable keeps Monday room');
select is((select row.value->>'teacher' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000301' and row.value->>'day'='화'),'교사 A','authenticated normalized timetable keeps Tuesday teacher');
select is((select row.value->>'classroom' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000301' and row.value->>'day'='화'),'강의실 1, 별관','authenticated normalized timetable uses full comma room from slot');
select is((select row.value->>'teacher' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000301' and row.value->>'day'='수'),'','authenticated normalized timetable keeps explicit empty teacher');
select is((select row.value->>'classroom' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000301' and row.value->>'day'='수'),'','authenticated normalized timetable keeps explicit empty room');
reset role;
update public.classes set schedule_storage_mode='legacy' where id='ac230000-0000-4000-8000-000000000302';
update public.classes set schedule='화 11:00-12:00 (~41, ~42)', teacher='~41', room='~42' where id='ac230000-0000-4000-8000-000000000302';
select is((select row.value->>'teacher' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000302'),'~41','pre-existing raw tilde teacher detail is not decoded');
select is((select row.value->>'classroom' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000302'),'~42','pre-existing raw tilde room detail is not decoded');
update public.classes set schedule='화 11:00-12:00 (김, 민, 강의실 1)', teacher='김, 민', room='강의실 1' where id='ac230000-0000-4000-8000-000000000302';
select is((select row.value->>'classroom' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000302'),'강의실 1','legacy ambiguous comma teacher keeps original room classifier');
update public.classes set schedule='화 11:00-12:00 (, )', teacher='교사 A', room='강의실 1' where id='ac230000-0000-4000-8000-000000000302';
select is((select jsonb_build_object('teacher',row.value->>'teacher','room',row.value->>'classroom') from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000302'),'{"teacher": "", "room": ""}'::jsonb,'legacy exact two-position empty resources suppress fallback');
update public.classes set schedule='화 11:00-12:00 (교사 미지정, 강의실 미지정)', teacher='교사 미지정', room='강의실 미지정' where id='ac230000-0000-4000-8000-000000000302';
select is((select jsonb_build_object('teacher',row.value->>'teacher','room',row.value->>'classroom') from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000302'),'{"teacher": "교사 미지정", "room": "강의실 미지정"}'::jsonb,'legacy exact two-position literal markers remain assigned');
update public.classes set schedule='화 11:00-12:00 (김, 민, 강의실 1)', teacher='김, 민', room='강의실 1' where id='ac230000-0000-4000-8000-000000000302';
update public.classes set schedule_storage_mode='shadow' where id='ac230000-0000-4000-8000-000000000302';
select is((select row.value->>'classroom' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000302'),'강의실 1','shadow ambiguous comma teacher keeps original room classifier');
update public.classes set schedule_storage_mode='legacy' where id='ac230000-0000-4000-8000-000000000302';
update public.classes set schedule='화 11:00-12:00 (교사 미지정)', teacher='교사 미지정', room='강의실 1' where id='ac230000-0000-4000-8000-000000000302';
select is((select row.value->>'teacher' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000302'),'교사 미지정','legacy single-detail literal marker teacher stays assigned');
update public.classes set schedule_storage_mode='shadow' where id='ac230000-0000-4000-8000-000000000302';
select is((select row.value->>'teacher' from jsonb_array_elements(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') row(value) where row.value->>'classId'='ac230000-0000-4000-8000-000000000302'),'교사 미지정','shadow mode keeps previous single-detail literal parsing');
select dashboard_private.reconcile_continuous_schedule_shadow_slots_v1(
 'ac230000-0000-4000-8000-000000000302',
 '[{"weekday":2,"startTime":"11:00","endTime":"12:00","teacherName":"교사 B 보정","classroomName":"강의실 2","sortOrder":0}]'::jsonb);
select is((select teacher_name from public.class_schedule_slots where id='ac230000-0000-4000-8000-000000000404'),'교사 B 보정','shadow reconciliation updates an existing tuple without changing slot ID');
select is((select count(*)::integer from public.class_schedule_slots where class_id='ac230000-0000-4000-8000-000000000302'),1,'shadow reconciliation does not insert a duplicate tuple');
select pg_catalog.set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.save_class_schedule_defaults_v1('ac230000-0000-4000-8000-000000000301',2,'[]'::jsonb,'ac230000-0000-4000-8000-000000000507',null)$$,'42501','class_schedule_forbidden','unauthenticated caller cannot save defaults');
select ok(not has_function_privilege('anon','public.save_class_schedule_defaults_v1(uuid,bigint,jsonb,uuid,text)','EXECUTE'),'anon retains no public save grant');
select * from finish();
rollback;
