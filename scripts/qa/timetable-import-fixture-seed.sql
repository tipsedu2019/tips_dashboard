-- Run ONLY in isolated tips_timetable_20260923; unique Task9 synthetic rows.
begin;
create function pg_temp.i(n int) returns uuid language sql immutable as $$select ('af249000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values(pg_temp.i(901),'authenticated','authenticated','task9-admin@test.invalid','{}','{}'),(pg_temp.i(902),'authenticated','authenticated','task9-teacher@test.invalid','{}','{}');
insert into public.profiles(id,name,role) values(pg_temp.i(901),'Task9 admin','admin'),(pg_temp.i(902),'Task9 teacher','teacher') on conflict(id) do update set role=excluded.role;
delete from public.teacher_catalogs where profile_id=pg_temp.i(902);
insert into public.teacher_catalogs(id,name,subjects,profile_id) values(pg_temp.i(101),'Task9 교사',array['영어'],pg_temp.i(902));
update public.profiles set teacher_catalog_id=pg_temp.i(101) where id=pg_temp.i(902);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.i(201),'Task9 강의실',array['영어']);
insert into public.classes(id,name,subject,grade,status,schedule_storage_mode,capacity,fee) values(pg_temp.i(301),'Task9 준비 A','영어','중2','개강 준비','normalized',12,100000),(pg_temp.i(302),'Task9 준비 B','영어','중3','개강 준비','normalized',8,90000);
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name) values(pg_temp.i(401),pg_temp.i(301),2,'03:13','04:43',pg_temp.i(101),pg_temp.i(201),'Task9 교사','Task9 강의실'),(pg_temp.i(402),pg_temp.i(302),2,'03:13','04:43',pg_temp.i(101),pg_temp.i(201),'Task9 교사','Task9 강의실');
insert into public.app_preferences(key,value) select 'planner:term:task9:영어:'||surface,
jsonb_build_object('entries',jsonb_build_object('private-old-key',jsonb_build_object('classId',pg_temp.i(301),'className','Task9 옛 수업','subject','영어','studentIds',jsonb_build_array('PRIVATE-STUDENT'),'status','PRIVATE-STATUS','unknown',jsonb_build_object('secret','PRIVATE-NESTED'),'scheduleLines',jsonb_build_array(
jsonb_build_object('day','금','start','23:30','end','24:00','teacher','Task9 교사','classroom','Task9 강의실','studentIds','PRIVATE-LINE'),
jsonb_build_object('day','수','start','17:13','end','18:43','teacher','없는 교사','classroom','Task9 강의실','raw',jsonb_build_object('private','PRIVATE-RAW')),
jsonb_build_object('day','unknown','start',jsonb_build_object('student','PRIVATE-TIME'),'teacher',jsonb_build_object('private','PRIVATE-TEACHER'),'status','PRIVATE-NESTED-STATUS'))))) from unnest(array['teacher-weekly','classroom-weekly','daily-teacher','daily-classroom']) surface;
insert into public.classes(id,name,subject,grade,status,schedule,teacher,room) values(pg_temp.i(303),'Task9 운영 읽기','영어','중2','수강','일 05:00-06:00','Task9 교사','Task9 강의실');
commit;
