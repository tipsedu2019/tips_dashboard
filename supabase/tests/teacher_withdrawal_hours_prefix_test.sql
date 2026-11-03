-- Synthetic rollback-only contract test. Run through the isolated PG17 runner
-- at base, committed read-only prefix, and after a rolled-back second migration.
-- This file must fail on the old unsafe ten-key prefix; final calculation uses
-- teacher_withdrawal_hours_snapshot_test.sql instead. Never use production.
begin;
select no_plan();
set local timezone='Asia/Seoul';
set local statement_timeout='30s';
set local lock_timeout='5s';

create function pg_temp.hours_id(n integer) returns uuid language sql immutable as $$
 select ('f2080000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.hours_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.hours_id(n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.hours_id(n),'role','authenticated')::text,true);
end $$;
insert into auth.users(id,instance_id,aud,role,email)
select pg_temp.hours_id(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'withdrawal-hours-'||n||'@synthetic.invalid' from generate_series(1,4)n;
insert into public.profiles(id,role,name,email)
select pg_temp.hours_id(n),case n when 1 then 'admin' when 2 then 'staff' else 'teacher' end,
 '가상 시수 사용자 '||n,'hours-'||n||'@synthetic.invalid' from generate_series(1,4)n
on conflict(id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
insert into public.classes(id,name,subject,grade,teacher,status,schedule_storage_mode,schedule_plan,student_ids)
values(pg_temp.hours_id(20),'가상 시수 수업','수학','중3','가상 시수 사용자 3','개강 준비','legacy','{}',jsonb_build_array(pg_temp.hours_id(30))),
 (pg_temp.hours_id(21),'가상 다른 수업','수학','중3','가상 시수 사용자 3','개강 준비','legacy','{}','[]');
update public.classes set schedule='월수 19:30~21:30',schedule_plan='{"selectedDays":[1,3],"sessions":[
 {"id":"first","date":"2026-11-02","sessionNumber":1,"state":"active","billingId":"cycle"},
 {"id":"second","date":"2026-11-04","sessionNumber":2,"state":"active","billingId":"cycle"},
 {"id":"canceled","date":"2026-11-06","sessionNumber":3,"state":"canceled","billingId":"cycle"},
 {"id":"third","date":"2026-11-09","sessionNumber":4,"state":"active","billingId":"cycle","hours":2.5}]}'
 where id=pg_temp.hours_id(20);
create temp table hours_class_original as select schedule,schedule_plan from public.classes where id=pg_temp.hours_id(20);
insert into public.students(id,name,grade,class_ids,contact,parent_contact)
values(pg_temp.hours_id(30),'가상 시수 학생','중3',jsonb_build_array(pg_temp.hours_id(20)),'PRIVATE_CONTACT_CANARY','PRIVATE_PARENT_CANARY');

create function pg_temp.hours_input() returns jsonb language sql as $$
 select jsonb_build_object('student_id',pg_temp.hours_id(30),'memo','가상 시수 신청','class_id',pg_temp.hours_id(20),
 'withdrawal_date','2026-11-04','withdrawal_session','2','customer_reason','가상 사유','teacher_opinion','가상 의견','undistributed_textbooks','없음') $$;
create temp table hours_results(name text primary key,input jsonb,payload jsonb,request_key uuid);
grant all on hours_results to authenticated;
create function pg_temp.hours_create(n text,p jsonb,k integer) returns void language plpgsql as $$begin
 insert into hours_results values(n,p,public.mutate_teacher_own_request_v1('withdrawal',null,'create',p,null,pg_temp.hours_id(k)),pg_temp.hours_id(k));
end $$;
create function pg_temp.hours_current(n text) returns jsonb language sql as $$
 select public.get_teacher_own_request_v1('withdrawal',(payload->>'id')::uuid) from hours_results where name=n $$;
create function pg_temp.hours_update(n text,p jsonb,k integer) returns void language plpgsql as $$declare x record;v jsonb;begin
 select * into x from hours_results where name=n;
 v:=public.mutate_teacher_own_request_v1('withdrawal',(x.payload->>'id')::uuid,'update',p,x.payload->>'revision',pg_temp.hours_id(k));
 update hours_results set payload=v where name=n;
end $$;
create temp table hours_effects_before as select
 (select count(*) from public.class_lesson_sessions) sessions,
 (select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s) students,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.textbook_stock_moves) stock;


-- The first migration is a read projection only. This contract runs in separate
-- sessions after real commits, so a rollback-only all-migrations test cannot hide
-- a temporarily writable ten-key interface.
select ok(to_regprocedure('dashboard_private.calculate_teacher_withdrawal_hours_v1(jsonb,date)') is null,
 'calculation helper is absent before the second transaction commits');
select ok(not has_function_privilege('authenticated','dashboard_private.teacher_request_ops_input_v1(text,jsonb,uuid)','EXECUTE'),
 'private input helper remains inaccessible');
select ok(not has_function_privilege('anon','public.mutate_teacher_own_request_v1(text,uuid,text,jsonb,text,uuid)','EXECUTE'),
 'anonymous public mutation remains inaccessible');
select pg_temp.hours_actor(3);set local role authenticated;
select lives_ok($q$select pg_temp.hours_create('normal',pg_temp.hours_input(),101)$q$,
 'legacy eight-key create remains available at the committed boundary');
select throws_ok($q$select pg_temp.hours_create('forged',pg_temp.hours_input()||'{"completed_lesson_hours":"999999.99","four_week_lesson_hours":"0.01"}'::jsonb,102)$q$,
 '22023','teacher_request_input_invalid','fresh forged ten-key create is rejected before any write');
select throws_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input()||'{"completed_lesson_hours":"4","four_week_lesson_hours":"16"}'::jsonb,103)$q$,
 '22023','teacher_request_input_invalid','fresh ten-key update is rejected even when quantities look plausible');
select lives_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input()||'{"memo":"boundary synthetic memo"}'::jsonb,104)$q$,
 'legacy eight-key note update remains available');
select is(pg_temp.hours_current('normal')->>'requesterId',pg_temp.hours_id(3)::text,'boundary cannot alter the requester');
select ok(not(pg_temp.hours_current('normal')->'input' ?| array['completed_lesson_hours','four_week_lesson_hours']),
 'no computed or caller-provided quantity is fabricated before server calculation exists');
reset role;
select is((select completed_lesson_hours from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='normal')),null::numeric,
 'stored completed hours remain NULL at the safe prefix');
select is((select four_week_lesson_hours from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='normal')),null::numeric,
 'stored four-week hours remain NULL at the safe prefix');
select is((select count(*) from dashboard_private.teacher_request_receipts_v1 where request_key in(pg_temp.hours_id(102),pg_temp.hours_id(103))),0::bigint,
 'rejected injected quantities create no replay receipt');
select is((select count(*) from hours_results where name='forged'),0::bigint,'rejected create leaves no fixture task reference');
select is((select count(*) from dashboard_private.teacher_request_history_v1 where request_id=(select(payload->>'id')::uuid from hours_results where name='normal')),2::bigint,
 'only successful create and note update produce history');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from hours_effects_before),'boundary sends no messages');
select is((select count(*) from public.textbook_stock_moves),(select stock from hours_effects_before),'boundary changes no stock ledger');
select * from finish();
rollback;
