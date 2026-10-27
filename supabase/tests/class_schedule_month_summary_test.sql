begin;
select no_plan();
set local statement_timeout = '30s';
create function pg_temp.mid(n integer) returns uuid language sql immutable as $$
  select ('bd200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.mid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'month-summary-'||n||'@example.invalid','{}','{}',now(),now() from generate_series(1,5) n;
insert into public.profiles(id,role,name,email)
select pg_temp.mid(n),r,'SYNTHETIC','month-summary-'||n||'@example.invalid'
from (values(1,'admin'),(2,'staff'),(3,'teacher'),(4,'assistant'),(5,'viewer')) x(n,r)
on conflict(id) do update set role=excluded.role;
select set_config('request.jwt.claim.sub',pg_temp.mid(1)::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('app.class_close_mutation','v1',true);
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan,schedule_storage_mode)
select pg_temp.mid(n),'SYNTHETIC','정규','수학','중3','','','',12,0,'수강','[]','[]','[]','[]','{}',mode
from (values(100,'normalized'),(101,'normalized'),(102,'legacy')) x(n,mode);
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1)
on conflict(singleton) do update set version=1;
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,origin,start_time,end_time)
select pg_temp.mid(n),pg_temp.mid(100),'synthetic-'||n,d::date,state,'manual','18:00','19:00'
from (values
 (201,'2026-01-01','active'),(202,'2026-10-02','active'),(203,'2026-10-02','makeup'),
 (204,'2026-10-03','exception'),(205,'2026-10-04','skipped'),(206,'2026-10-05','tbd'),
 (207,'2026-12-31','active'),(208,'2027-01-01','active'),(209,'2025-12-31','active'),(210,'2028-02-29','active')
) x(n,d,state);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,origin)
values(pg_temp.mid(211),pg_temp.mid(101),'other-class','2026-10-02','active','manual');
select set_config('app.class_schedule_mutation','',true);
select set_config('app.class_close_mutation','',true);
select ok(not has_function_privilege('anon','public.get_class_schedule_month_summary_v1(uuid,integer)','execute'),'anonymous has no execute');
select ok(not has_function_privilege('service_role','public.get_class_schedule_month_summary_v1(uuid,integer)','execute'),'no new service role surface');
select ok(has_function_privilege('authenticated','public.get_class_schedule_month_summary_v1(uuid,integer)','execute'),'authenticated RPC with internal actor guard');
set local role authenticated;
select is(jsonb_array_length(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)->'months'),12,'exact twelve rows');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)#>>'{months,9,count}','2','same-date active and makeup both count; other states excluded');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)#>>'{months,1,count}','0','authoritative empty month is zero');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)#>>'{months,0,count}','1','Jan1 included, previous year excluded');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)#>>'{months,11,count}','1','Dec31 included, next year excluded');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2028)#>>'{months,1,count}','1','leap February supported');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(101),2026)#>>'{months,9,count}','1','class scope isolated');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)->>'classId',pg_temp.mid(100)::text,'response binds class UUID');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)->>'year','2026','response binds year');
select is((select sum((m->>'count')::int)::int from jsonb_array_elements(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)->'months') m),4,'all returned counts match actual rows');
select throws_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(100),0)$$,'22023','class_schedule_validation','invalid year rejected');
select throws_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(100),9999)$$,'22023','class_schedule_validation','upper year boundary rejected');
select throws_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(100),null)$$,'22023','class_schedule_validation','missing year rejected');
select throws_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(999),2026)$$,'P0002','class_schedule_not_found','authorized missing class rejected');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(102),2026)->>'authoritativeSource','legacy','legacy not counted as empty normalized data');
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(102),2026)->'months','[]'::jsonb,'legacy has no fabricated zeros');
select set_config('request.jwt.claim.sub',pg_temp.mid(2)::text,true);
select lives_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)$$,'existing staff scope preserved');
select set_config('request.jwt.claim.sub',pg_temp.mid(3)::text,true);
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)#>>'{months,9,count}','2','active teacher same common schedule read scope');
select ok(not (public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)::text ~ 'student|teacher_name|memo|session_key'),'response contains no session or person fields');
select 'MONTH_SUMMARY_CAPTURE:'||jsonb_build_array(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026),public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2028),public.get_class_schedule_month_summary_v1(pg_temp.mid(102),2026))::text;
reset role;
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.mid(3);
set local role authenticated;
select throws_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)$$,'42501','operational_common_read_forbidden','banned teacher rejected');
reset role;
update auth.users set banned_until=null,deleted_at=now() where id=pg_temp.mid(3);
set local role authenticated;
select throws_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)$$,'42501','operational_common_read_forbidden','deleted teacher rejected');
select set_config('request.jwt.claim.sub',pg_temp.mid(4)::text,true);
select throws_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(999),2026)$$,'42501','class_schedule_forbidden','assistant denied before class existence');
select set_config('request.jwt.claim.sub',pg_temp.mid(5)::text,true);
select throws_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)$$,'42501','class_schedule_forbidden','viewer denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)$$,'42501','class_schedule_forbidden','missing actor denied');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.mid(1)::text,true);
update dashboard_private.continuous_class_schedule_runtime set version=0 where singleton;
set local role authenticated;
select is(public.get_class_schedule_month_summary_v1(pg_temp.mid(100),2026)->'months','[]'::jsonb,'inactive runtime never invents normalized zero counts');
reset role;
select is((select count(*)::int from public.class_lesson_sessions where class_id in(pg_temp.mid(100),pg_temp.mid(101))),11,'reads changed no source rows');
select * from finish();
rollback;
