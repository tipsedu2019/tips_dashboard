begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local statement_timeout = '60s';
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('ac234000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000000','authenticated','authenticated','timetable-time@test.invalid','{}','{}',now(),now());
insert into public.profiles(id,role,name,email) values
('ac234000-0000-4000-8000-000000000901','staff','시각 회귀 검증','timetable-time@test.invalid')
on conflict(id) do update set role=excluded.role;
-- Model the retained legacy text after activation, which changes only storage mode.
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan,schedule_storage_mode) values
('ac234000-0000-4000-8000-000000000301','시각 매칭 회귀','정규','영어','고1','요약 교사',
E'월 9:00-10:00 (원문 교사, 원문 강의실)\n화 8:00-9:00\n수 17:13-18:07\n목 23:30-24:00\n금 0:00-0:30\n토 9:00-10:00\n월 9:01-10:00\n월 9:00-10:01\n일 9:00-10:00\n월 8:60-10:00\n월 9:00-9:60\n목 23:30-24:01\n월 24:00-24:00\n월 10:00-9:00\n월 99:00-99:59',
'요약 강의실',12,100000,'수업 진행 중','[]','[]','[]','[]','{}','shadow');
select pg_catalog.set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_name,classroom_name,sort_order) values
('ac234000-0000-4000-8000-000000000401','ac234000-0000-4000-8000-000000000301',1,'09:00','10:00','김, 민','강의실 1, 별관',0),
('ac234000-0000-4000-8000-000000000402','ac234000-0000-4000-8000-000000000301',2,'08:00','09:00','아침 교사','아침 강의실',1),
('ac234000-0000-4000-8000-000000000403','ac234000-0000-4000-8000-000000000301',3,'17:13','18:07','분 단위 교사','분 단위 강의실',2),
('ac234000-0000-4000-8000-000000000404','ac234000-0000-4000-8000-000000000301',4,'23:30','24:00','자정 교사','자정 강의실',3),
('ac234000-0000-4000-8000-000000000405','ac234000-0000-4000-8000-000000000301',5,'00:00','00:30','영시 교사','영시 강의실',4),
('ac234000-0000-4000-8000-000000000406','ac234000-0000-4000-8000-000000000301',6,'09:00','10:00','','',5);
update public.classes set schedule_storage_mode='normalized' where id='ac234000-0000-4000-8000-000000000301';
insert into public.class_lesson_sessions(class_id,session_key,source_schedule_slot_id,session_date,schedule_state,start_time,end_time,teacher_name_snapshot,classroom_name_snapshot,origin) values
('ac234000-0000-4000-8000-000000000301','past-time','ac234000-0000-4000-8000-000000000401','2026-09-21','active','09:00','10:00','과거 교사','과거 강의실','default');
create temporary table time_before as select
(select to_jsonb(c) from public.classes c where id='ac234000-0000-4000-8000-000000000301') as class_row,
(select jsonb_agg(to_jsonb(s) order by id) from public.class_schedule_slots s where class_id='ac234000-0000-4000-8000-000000000301') as slots,
(select to_jsonb(s) from public.class_lesson_sessions s where session_key='past-time') as past_session;
select pg_catalog.set_config('request.jwt.claim.sub','ac234000-0000-4000-8000-000000000901',true);
set local role authenticated;
create temporary table time_rows as select r.value as payload from jsonb_array_elements(
public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'영어')->'rows') r(value)
where r.value->>'classId'='ac234000-0000-4000-8000-000000000301';
select is((select count(*)::integer from time_rows),15,'authenticated RPC preserves parsed rows without errors or duplicate matches');
select is((select jsonb_build_array(payload->>'teacher',payload->>'classroom') from time_rows where payload->>'day'=day and payload->>'start'=start_text and payload->>'end'=end_text),expected,description)
from (values
('월','9:00','10:00','["김, 민","강의실 1, 별관"]'::jsonb,'retained single-digit start matches normalized comma resources'),
('화','8:00','9:00','["아침 교사","아침 강의실"]'::jsonb,'single-digit start and end match normalized resources'),
('수','17:13','18:07','["분 단위 교사","분 단위 강의실"]'::jsonb,'exact minutes match without rounding'),
('목','23:30','24:00','["자정 교사","자정 강의실"]'::jsonb,'24:00 end matches without wrapping to midnight'),
('금','0:00','0:30','["영시 교사","영시 강의실"]'::jsonb,'zero-hour single-digit times match'),
('토','9:00','10:00','["",""]'::jsonb,'normalized explicit empty resources suppress text and summary fallback'),
('월','9:01','10:00','["",""]'::jsonb,'different valid start cannot borrow slot resources'),
('월','9:00','10:01','["",""]'::jsonb,'different valid end cannot borrow slot resources'),
('일','9:00','10:00','["",""]'::jsonb,'different weekday cannot borrow slot resources'),
('월','8:60','10:00','["",""]'::jsonb,'invalid start minutes cannot normalize into a valid tuple'),
('월','9:00','9:60','["",""]'::jsonb,'invalid end minutes cannot normalize into a valid tuple'),
('목','23:30','24:01','["",""]'::jsonb,'end past 1440 cannot borrow midnight slot resources'),
('월','24:00','24:00','["",""]'::jsonb,'zero-length interval at 1440 has no slot match'),
('월','10:00','9:00','["",""]'::jsonb,'reversed interval has no slot match'),
('월','99:00','99:59','["",""]'::jsonb,'invalid hours do not throw or acquire resources')
) cases(day,start_text,end_text,expected,description);
select is((select payload->>'start' from time_rows where payload->>'day'='화'),'8:00','RPC retains source time spelling');
select is((select (payload->>'startMinutes')::integer from time_rows where payload->>'day'='수'),1033,'17:13 remains exact minute 1033');
select is((select (payload->>'endMinutes')::integer from time_rows where payload->>'day'='목' and payload->>'end'='24:00'),1440,'24:00 remains exact minute 1440');
reset role;
select is((select to_jsonb(c) from public.classes c where id='ac234000-0000-4000-8000-000000000301'),(select class_row from time_before),'consumer preserves original schedule, summaries, storage mode and revision');
select is((select jsonb_agg(to_jsonb(s) order by id) from public.class_schedule_slots s where class_id='ac234000-0000-4000-8000-000000000301'),(select slots from time_before),'consumer preserves slot IDs and resource authority');
select is((select to_jsonb(s) from public.class_lesson_sessions s where session_key='past-time'),(select past_session from time_before),'consumer preserves historical session snapshot and FK');
select * from finish();
rollback;
