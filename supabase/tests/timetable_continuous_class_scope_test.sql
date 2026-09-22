begin;
select no_plan();
set local statement_timeout = '45s';
create or replace function pg_temp.tid(n integer) returns uuid language sql immutable as $$
 select ('ac220000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(pg_temp.tid(900),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','timetable-renewal@example.invalid','{}','{}',now(),now());
insert into public.profiles(id,role,name,email) values(pg_temp.tid(900),'admin','시간표 검증','timetable-renewal@example.invalid')
on conflict(id) do update set role='admin';
select set_config('request.jwt.claim.sub',pg_temp.tid(900)::text,true);
update public.class_schedule_sync_groups set is_default=false where is_default;
insert into public.class_schedule_sync_groups(id,name,subject,is_default,sort_order)
values(pg_temp.tid(901),'__timetable_legacy_default__','__timetable_renewal__',true,0);
select set_config('app.class_close_mutation','v1',true);
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,start_date,end_date,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
values
(pg_temp.tid(1),'기본 그룹 수강','정규','__timetable_renewal__','고2','검증 교사','월 15:00-17:00','본관 1강',12,1,'수강',null,null,'[]','[]','[]','[]','{}'),
(pg_temp.tid(2),'그룹 없는 수강','정규','__timetable_renewal__','고2','검증 교사','화 15:00-17:00','본관 1강',12,1,'수강',null,null,'[]','[]','[]','[]','{}'),
(pg_temp.tid(3),'미래 개강','정규','__timetable_renewal__','고2','검증 교사','수 15:00-17:00','본관 1강',12,1,'개강 준비','2199-01-01',null,'[]','[]','[]','[]','{}'),
(pg_temp.tid(4),'과거 종강','정규','__timetable_renewal__','고2','검증 교사','목 15:00-17:00','본관 1강',12,1,'종강','2000-01-01','2000-12-31','[]','[]','[]','[]','{}');
insert into public.class_schedule_sync_group_members(group_id,class_id,sort_order) values(pg_temp.tid(901),pg_temp.tid(1),0);
select set_config('app.class_close_mutation','',true);
set local role authenticated;
select is(jsonb_array_length(public.get_academic_timetable_range_v1(current_date,current_date+6,null,'수강','__timetable_renewal__')->'rows'),2,'null group includes grouped and ungrouped active classes');
select is(jsonb_array_length(public.get_academic_timetable_range_v1(current_date,current_date+6,pg_temp.tid(901)::text,'수강','__timetable_renewal__')->'rows'),2,'stale explicit group is ignored');
select is(jsonb_array_length(public.get_academic_timetable_range_v1(current_date,current_date+6,null,'개강 준비','__timetable_renewal__')->'rows'),1,'future class appears in preparation status');
select is(jsonb_array_length(public.get_academic_timetable_range_v1(current_date,current_date+6,null,'종강','__timetable_renewal__')->'rows'),1,'historical class appears in ended status');
select is(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'__timetable_renewal__')->'statusOptions','["수강","개강 준비","종강"]'::jsonb,'exactly three status choices');
select is(public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,'__timetable_renewal__')->'classGroups','[]'::jsonb,'retired group catalog is not loaded');
select is(jsonb_array_length(public.get_academic_timetable_range_v1(current_date,current_date+6,null,'수강','__nonexistent__')->'rows'),0,'subject scope still applies');
select throws_ok($$select public.get_academic_timetable_range_v1(current_date,current_date+14,null,null,null)$$,'22023','academic_timetable_range_invalid','range guard keeps exact SQLSTATE');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.get_academic_timetable_range_v1(current_date,current_date+6,null,null,null)$$,'42501','authentication_required','missing actor rejected');
reset role;
select ok(not (select prosecdef from pg_proc where oid='public.get_academic_timetable_range_v1(date,date,text,text,text)'::regprocedure),'final function preserves invoker RLS');
select ok(not has_function_privilege('anon','public.get_academic_timetable_range_v1(date,date,text,text,text)','execute'),'anonymous execution remains denied');
select ok(pg_get_functiondef('public.get_academic_timetable_range_v1(date,date,text,text,text)'::regprocedure) !~ 'class_schedule_sync_group','final definition never queries retired membership tables');
select * from finish();
rollback;
