-- Run ONLY in tips_timetable_20260923 (network none, no ports), after local migrations.
-- Synthetic fixture names match the existing annual/timetable browser reference.
begin;
create function pg_temp.qid(n int) returns uuid language sql immutable as $$select ('ae260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000000099','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fixture@example.invalid','{}','{}',now(),now()) on conflict(id) do nothing;
insert into public.profiles(id,role,name,email) values('00000000-0000-4000-8000-000000000099','admin','합성 관리자','fixture@example.invalid') on conflict(id) do update set role='admin',name='합성 관리자';
insert into public.teacher_catalogs(id,name,subjects,sort_order) values(pg_temp.qid(101),'김선생',array['수학팀','영어팀'],1),(pg_temp.qid(102),'이선생',array['영어팀','수학팀'],2),(pg_temp.qid(103),'박선생',array['과학팀','영어팀','수학팀'],3) on conflict(id) do nothing;
insert into public.classroom_catalogs(id,name,subjects,sort_order) values(pg_temp.qid(201),'본관 1강',array['영어','수학','과학'],1),(pg_temp.qid(202),'별관 2강',array['영어','수학','과학'],2),(pg_temp.qid(203),'본관 3강',array['영어','수학','과학'],3) on conflict(id) do nothing;
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.classes(id,name,subject,grade,status,schedule_storage_mode,schedule_revision) values
(pg_temp.qid(301),'고2 심화수학','수학','고2','수강','normalized',0),
(pg_temp.qid(302),'고1 영어 독해와 문법','영어','고1','수강','normalized',0),
(pg_temp.qid(303),'중3 수학','수학','중3','수강','normalized',0),
(pg_temp.qid(304),'고2 영어 심화 긴 수업명 확인','영어','고2','수강','normalized',0) on conflict(id) do nothing;
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name)
select pg_temp.qid(400+row_number()over()::int),pg_temp.qid(classnum),day,startat::time,endat::time,pg_temp.qid(teacher),teachername,pg_temp.qid(room),roomname from (values
(301,1,'15:00','17:00',101,'김선생',201,'본관 1강'),(301,3,'15:00','17:00',101,'김선생',201,'본관 1강'),(301,5,'15:00','17:00',101,'김선생',201,'본관 1강'),
(302,2,'16:00','18:00',102,'이선생',202,'별관 2강'),(302,4,'16:00','18:00',102,'이선생',202,'별관 2강'),
(303,2,'18:00','20:00',101,'김선생',201,'본관 1강'),(303,4,'18:00','20:00',101,'김선생',201,'본관 1강'),
(304,1,'19:00','21:00',102,'이선생',202,'별관 2강'),(304,3,'19:00','21:00',102,'이선생',202,'별관 2강'))v(classnum,day,startat,endat,teacher,teachername,room,roomname) on conflict(id) do nothing;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';
select public.mutate_timetable_plan_v1(jsonb_build_object('operation','create','planId',pg_temp.qid(1),'name','2027 1학기 검토안','requestKey','task6-fixture-plan'));
select public.mutate_timetable_plan_v1(jsonb_build_object('operation','create','planId',pg_temp.qid(2),'name','빈 프리셋','requestKey','task6-fixture-empty'));
select public.mutate_timetable_plan_item_v1(jsonb_build_object('operation','save','planId',pg_temp.qid(1),'expectedMetaRevision',0,'expectedItemRevision',null,'expectedShadowFingerprint',public.get_timetable_plan_revision_v1(pg_temp.qid(1))->>'shadowFingerprint','requestKey','task6-fixture-item','item',jsonb_build_object('id',pg_temp.qid(501),'planId',pg_temp.qid(1),'name','중2 영어 새 수업','subject','영어','subjectAreaKey',null,'grade','중2','capacity',12,'tuition',100000,'defaultTeacherId',pg_temp.qid(101),'defaultClassroomId',pg_temp.qid(201),'durationMinutes',60,'pendingSlots','[]'::jsonb),'slots',jsonb_build_array(jsonb_build_object('id',pg_temp.qid(601),'itemId',pg_temp.qid(501),'planId',pg_temp.qid(1),'weekday',1,'startMinute',1033,'endMinute',1093,'teacherId',pg_temp.qid(101),'classroomId',pg_temp.qid(201),'sourceSlotId',null),jsonb_build_object('id',pg_temp.qid(602),'itemId',pg_temp.qid(501),'planId',pg_temp.qid(1),'weekday',3,'startMinute',1033,'endMinute',1093,'teacherId',pg_temp.qid(101),'classroomId',pg_temp.qid(201),'sourceSlotId',null))));
commit;
