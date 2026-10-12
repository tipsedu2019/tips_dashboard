-- Final ordered runtime only, fictional identities, no external providers.
-- Historical pending snapshots are inserted explicitly; no new completion may
-- create a reservation. All data and cron metadata roll back with this file.
begin;
select no_plan();
set local statement_timeout='30s';
set local lock_timeout='5s';
-- Keep one timezone throughout the transaction: existing audit-chain hashes
-- include timestamptz text. This ahead-of-Seoul session still uses KST cutoffs.
set local timezone='Pacific/Kiritimati';
insert into auth.users(id,email) values('a1200000-0000-4000-8000-000000000001','withdrawal-immediate@example.invalid');
insert into public.profiles(id,role,name) values('a1200000-0000-4000-8000-000000000001','admin','즉시 완료 합성 관리자')
on conflict(id) do update set role=excluded.role,name=excluded.name;
select set_config('request.jwt.claims','{"sub":"a1200000-0000-4000-8000-000000000001","role":"authenticated"}',true),
set_config('request.jwt.claim.sub','a1200000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);

create temp table immediate_cases(label text primary key,task_id uuid,student_id uuid,class_id uuid,request_id uuid,last_date date,response jsonb);
create function pg_temp.immediate_case(p_label text,p_offset integer,p_removed boolean default false,p_status text default '재원',p_round text default '3회차')
returns void language plpgsql as $$
declare t uuid:=gen_random_uuid();s uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d date:=(clock_timestamp() at time zone 'Asia/Seoul')::date+p_offset;
begin
 insert into public.classes(id,name,status,subject,student_ids,waitlist_ids)
 values(c,'즉시 합성 수업 '||p_label,'진행중','영어',case when p_removed then '[]'::jsonb else jsonb_build_array(s) end,'[]');
 insert into public.students(id,name,status,parent_contact,class_ids,waitlist_class_ids)
 values(s,'즉시 합성 학생 '||p_label,p_status,'00000000000',case when p_removed then '[]'::jsonb else jsonb_build_array(c) end,'[]');
 insert into public.ops_tasks(id,type,status,title,student_id,class_id,requested_by,subject,student_name,class_name)
 values(t,'withdrawal','requested','즉시 합성 퇴원 '||p_label,s,c,'a1200000-0000-4000-8000-000000000001','영어','즉시 합성 학생 '||p_label,'즉시 합성 수업 '||p_label);
 insert into public.ops_withdrawal_details(task_id,withdrawal_date,withdrawal_session,makeedu_withdrawal_done,fee_processed,textbook_fee_processed)
 values(t,d,p_round,true,false,false);
 insert into immediate_cases values(p_label,t,s,c,gen_random_uuid(),d,null);
end;$$;
create function pg_temp.immediate_state() returns jsonb language sql as $$
 select jsonb_build_object(
 'tasks',(select jsonb_agg(to_jsonb(r) order by id) from public.ops_tasks r),
 'details',(select jsonb_agg(to_jsonb(r) order by task_id) from public.ops_withdrawal_details r),
 'students',(select jsonb_agg(to_jsonb(r) order by id) from public.students r),
 'classes',(select jsonb_agg(to_jsonb(r) order by id) from public.classes r),
 'claims',(select jsonb_agg(to_jsonb(r) order by id) from public.ops_registration_enrollments r),
 'history',(select jsonb_agg(to_jsonb(r) order by id) from public.student_class_enrollment_history r),
 'queue',(select jsonb_agg(to_jsonb(r) order by task_id) from dashboard_private.withdrawal_roster_release_queue_v1 r),
 'mutations',(select jsonb_agg(to_jsonb(r) order by actor_id,request_key) from dashboard_private.ops_registration_mutations r),
 'receipts',(select jsonb_agg(to_jsonb(r) order by request_id) from dashboard_private.notification_request_ledger r),
 'sources',(select jsonb_agg(to_jsonb(r) order by id) from public.ops_task_events r),
 'notifications',(select jsonb_agg(to_jsonb(r) order by id) from dashboard_private.notification_events r),
 'fanout',(select jsonb_agg(to_jsonb(r) order by id) from dashboard_private.notification_event_fanout_jobs r),
 'deliveries',(select jsonb_agg(to_jsonb(r) order by id) from dashboard_private.notification_deliveries r));
$$;

select is(public.withdrawal_last_lesson_release_runtime_version(),'withdrawal_immediate_completion_v3','capability advertises immediate completion');
select throws_ok($$insert into dashboard_private.withdrawal_roster_release_queue_v1(task_id,student_id,class_id,expected_history_count,last_lesson_date)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),0,(clock_timestamp() at time zone 'Asia/Seoul')::date)$$,
'23514','withdrawal_release_new_reservation_retired','cached old runtimes cannot insert a new reservation');
select public.manage_withdrawal_roster_release_scheduler_v1('remove');
select pg_temp.immediate_case('today',0);
select pg_temp.immediate_case('past',-3);
select pg_temp.immediate_case('removed_today',0,true);
select pg_temp.immediate_case('removed_past',-3,true,'퇴원');
select pg_temp.immediate_case('future',3);
select pg_temp.immediate_case('removed_future',3,true,'퇴원');
select pg_temp.immediate_case('canceled',0);
select pg_temp.immediate_case('late_failure',0,false,'재원',null);
select pg_temp.immediate_case('rollback',0);
update public.ops_tasks set status='canceled' where id=(select task_id from immediate_cases where label='canceled');
grant select,update on immediate_cases to authenticated;
set local role authenticated;
update immediate_cases set response=public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id)
where label in('today','past','removed_today','removed_past');
reset role;
select ok(t.status='done' and t.completed_at is not null and d.timetable_roster_updated,c.label||' finishes the actual task and checklist')
from immediate_cases c join public.ops_tasks t on t.id=c.task_id join public.ops_withdrawal_details d on d.task_id=c.task_id where c.response is not null;
select ok(not(s.class_ids?c.class_id::text) and not(cl.student_ids?c.student_id::text) and s.status='퇴원',c.label||' final roster is immediately excluded')
from immediate_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where c.response is not null;
select ok(not d.fee_processed and not d.textbook_fee_processed,c.label||' preserves independent unpaid checks')
from immediate_cases c join public.ops_withdrawal_details d on d.task_id=c.task_id where c.response is not null;
select is((select count(*) from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.class_id),
case when c.label like 'removed_%' then 0 else 1 end::bigint,c.label||' never fabricates a re-add or duplicate removal') from immediate_cases c where c.response is not null;
select is(c.response->>'rosterAlreadyRemoved',(c.label like 'removed_%')::text,c.label||' reports whether roster was already absent') from immediate_cases c where c.response is not null;
select is((select count(*) from dashboard_private.withdrawal_roster_release_queue_v1),0::bigint,'all new completions create zero reservations');
select is((select count(*) from cron.job where jobname='tips-withdrawal-roster-release-v1'),0::bigint,'completion needs no scheduler');
set local role authenticated;
select is(public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id),response,c.label||' exact completion replay is stable') from immediate_cases c where response is not null;
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,gen_random_uuid())',task_id),'23514','ops_withdrawal_completion_state_conflict','different request cannot complete twice') from immediate_cases where label='today';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','ops_withdrawal_completion_state_conflict','canceled request cannot complete') from immediate_cases where label='canceled';
reset role;
select throws_ok(format('update public.ops_tasks set status=''canceled'' where id=%L',task_id),'P0001','완료된 운영 업무는 관리 데이터가 반영되어 상태만 되돌릴 수 없습니다.','completed withdrawal cannot be canceled to restore a removed roster') from immediate_cases where label='today';
select is((select count(*) from public.ops_task_events e where e.task_id=c.task_id and e.event_type='withdrawal.completed'),1::bigint,c.label||' has one canonical completion source') from immediate_cases c where c.response is not null;
create temp table immediate_before_failure as select pg_temp.immediate_state() state;
set local role authenticated;
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','withdrawal_last_lesson_date_in_future',c.label||' future completion is refused regardless of roster presence') from immediate_cases c where label in('future','removed_future');
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','ops_withdrawal_applied_snapshot_required','late source-validation failure rolls back earlier physical removal') from immediate_cases where label='late_failure';
reset role;
select is(pg_temp.immediate_state(),state,'future and late failures leave task, roster, queue, history, receipts and notifications byte-for-byte unchanged') from immediate_before_failure;

create temp table immediate_before_rollback as select pg_temp.immediate_state() state;
savepoint completion_rollback;
do $test$ declare c immediate_cases%rowtype; begin
 select * into strict c from immediate_cases where label='rollback';
 perform public.complete_ops_withdrawal_roster_transition_v3(c.task_id,c.request_id);
 if exists(select 1 from public.students where id=c.student_id and class_ids?c.class_id::text)
   or not exists(select 1 from public.ops_tasks where id=c.task_id and status='done') then
   raise exception 'synthetic_completion_rollback_probe_failed';
 end if;
end; $test$;
rollback to savepoint completion_rollback;
select is(pg_temp.immediate_state(),state,'transaction rollback restores every completion effect') from immediate_before_rollback;
select lives_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'same Seoul date completes even when session date is ahead') from immediate_cases where label='rollback';

-- Drain only historical due snapshots. Future and failed pending rows remain
-- intact and keep the scheduler until an explicit safe transition resolves them.
select ok(not has_function_privilege('authenticated','dashboard_private.retire_withdrawal_roster_release_scheduler_v1()','EXECUTE'),'browser cannot retire scheduler');
select ok(not has_function_privilege('service_role','dashboard_private.retire_withdrawal_roster_release_scheduler_v1()','EXECUTE'),'service API receives no new retire permission');
select cron.schedule('synthetic-withdrawal-unrelated','* * * * *','select 1;');
create temp table unrelated_cron_before as select to_jsonb(j) state from cron.job j where jobname='synthetic-withdrawal-unrelated';
select public.manage_withdrawal_roster_release_scheduler_v1('install');
select pg_temp.immediate_case('legacy_due',-3);
select pg_temp.immediate_case('legacy_future',3);
select pg_temp.immediate_case('legacy_failure',-3);
select set_config('app.ops_transition_completion_authorized','true',true);
update public.ops_withdrawal_details set timetable_roster_updated=true where task_id in(select task_id from immediate_cases where label like 'legacy_%');
update public.ops_tasks set status='done',completed_at=now() where id in(select task_id from immediate_cases where label like 'legacy_%');
select set_config('app.ops_transition_completion_authorized','false',true);
-- Only this retired-insert fence is relaxed to seed historical synthetic rows.
alter table dashboard_private.withdrawal_roster_release_queue_v1 disable trigger reject_new_withdrawal_roster_release_v1;
insert into dashboard_private.withdrawal_roster_release_queue_v1(task_id,student_id,class_id,expected_history_count,last_lesson_date,actor_id)
select c.task_id,c.student_id,c.class_id,(select count(*) from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.class_id),c.last_date,'a1200000-0000-4000-8000-000000000001'
from immediate_cases c where label like 'legacy_%';
alter table dashboard_private.withdrawal_roster_release_queue_v1 enable trigger reject_new_withdrawal_roster_release_v1;
create temp table legacy_queue_snapshots as select task_id,to_jsonb(q)-array['status','claim_source_task_id','applied_at','resolved_at','attempt_count','last_error_code','next_attempt_at']::text[] snapshot
from dashboard_private.withdrawal_roster_release_queue_v1 q;
select is(dashboard_private.retire_withdrawal_roster_release_scheduler_v1(),'pending','retirement preserves unresolved pending');
select is(dashboard_private.apply_scheduled_withdrawal_roster_release_v1(task_id),'not_due','legacy future does not release early') from immediate_cases where label='legacy_future';
update public.students set status='퇴원' where id=(select student_id from immediate_cases where label='legacy_failure');
create temp table legacy_notifications_before as select (select count(*) from dashboard_private.notification_events) events,
(select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,(select count(*) from dashboard_private.notification_deliveries) deliveries;
create temp table legacy_batch_result as select dashboard_private.process_due_withdrawal_roster_releases_v1(100) result;
select is(result->>'applied','1','only legacy due row applies') from legacy_batch_result;
select is(result->>'failed','1','failing legacy row retains retry evidence') from legacy_batch_result;
select ok(q.status='pending' and q.attempt_count=1 and q.last_error_code='23514', 'failure remains pending without physical release')
from immediate_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label='legacy_failure';
select ok(q.status='pending' and s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text,'legacy future remains enrolled with original pending')
from immediate_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label='legacy_future';
select ok(dashboard_private.withdrawal_roster_release_scheduler_ready_v1(),'unresolved legacy pending retains exact cron');
select is((select count(*) from dashboard_private.notification_events),events,'legacy worker sends no new canonical notification') from legacy_notifications_before;
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),jobs,'legacy worker creates no fanout') from legacy_notifications_before;
select is((select count(*) from dashboard_private.notification_deliveries),deliveries,'legacy worker creates no delivery') from legacy_notifications_before;

-- A later explicit completed request owns the restored relationship. It safely
-- supersedes the old future generation, rather than releasing that snapshot early.
select dashboard_private.apply_student_class_roster_mode(student_id,class_id,'removed','enrolled',null,'synthetic_remove','a1200000-0000-4000-8000-000000000001') from immediate_cases where label='legacy_future';
select dashboard_private.apply_student_class_roster_mode(student_id,class_id,'enrolled','removed',null,'synthetic_restore','a1200000-0000-4000-8000-000000000001') from immediate_cases where label='legacy_future';
insert into public.ops_tasks(id,type,status,title,student_id,class_id,requested_by,subject)
select 'a1200000-0000-4000-8000-000000000002','withdrawal','requested','복구 관계 새 합성 요청',student_id,class_id,'a1200000-0000-4000-8000-000000000001','영어' from immediate_cases where label='legacy_future';
insert into public.ops_withdrawal_details(task_id,withdrawal_date,withdrawal_session,makeedu_withdrawal_done,fee_processed,textbook_fee_processed)
values('a1200000-0000-4000-8000-000000000002',(clock_timestamp() at time zone 'Asia/Seoul')::date,'3회차',true,false,false);
select lives_ok($$select public.complete_ops_withdrawal_roster_transition_v3('a1200000-0000-4000-8000-000000000002',gen_random_uuid())$$,'explicit same-day new generation completes without old future reservation');
select is(q.status,'superseded','old future becomes preserved terminal history') from immediate_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label='legacy_future';
update public.students set status='재원' where id=(select student_id from immediate_cases where label='legacy_failure');
update dashboard_private.withdrawal_roster_release_queue_v1 set next_attempt_at=now() where task_id=(select task_id from immediate_cases where label='legacy_failure');
savepoint retirement_rollback;
do $test$ begin
 perform dashboard_private.process_due_withdrawal_roster_releases_v1(100);
 if exists(select 1 from dashboard_private.withdrawal_roster_release_queue_v1 where status='pending')
   or exists(select 1 from cron.job where jobname='tips-withdrawal-roster-release-v1') then
   raise exception 'synthetic_retirement_rollback_probe_failed';
 end if;
end; $test$;
rollback to savepoint retirement_rollback;
select ok(exists(select 1 from dashboard_private.withdrawal_roster_release_queue_v1 where status='pending') and dashboard_private.withdrawal_roster_release_scheduler_ready_v1(),'rollback restores last pending and its scheduler');
select is(dashboard_private.process_due_withdrawal_roster_releases_v1(100)->>'applied','1','restored last pending drains through original worker');
select is((select count(*) from cron.job where jobname='tips-withdrawal-roster-release-v1'),0::bigint,'last legacy pending automatically retires only withdrawal cron');
select is((select count(*) from dashboard_private.withdrawal_roster_release_queue_v1),3::bigint,'all three historical reservations remain stored');
select ok((select tgenabled='O' from pg_trigger where tgrelid='dashboard_private.withdrawal_roster_release_queue_v1'::regclass and tgname='reject_new_withdrawal_roster_release_v1'),'legacy fixtures restore only the new-insert fence');
select ok(not exists(select 1 from legacy_queue_snapshots b join dashboard_private.withdrawal_roster_release_queue_v1 q using(task_id)
where to_jsonb(q)-array['status','claim_source_task_id','applied_at','resolved_at','attempt_count','last_error_code','next_attempt_at']::text[] is distinct from b.snapshot),'immutable legacy queue snapshots remain byte-for-byte preserved');
select is(dashboard_private.retire_withdrawal_roster_release_scheduler_v1(),'absent','retirement is idempotent after cron removal');
select cron.schedule('tips-withdrawal-roster-release-v1','* * * * *','select 1;');
select is(dashboard_private.retire_withdrawal_roster_release_scheduler_v1(),'drifted','different command is preserved for explicit review');
select is((select command from cron.job where jobname='tips-withdrawal-roster-release-v1'),'select 1;','drifted command is never deleted');
select cron.schedule('tips-withdrawal-roster-release-v1','*/2 * * * *','set transaction_timeout = ''0''; set transaction_timeout = ''30s''; set statement_timeout = ''30s''; select dashboard_private.process_due_withdrawal_roster_releases_v1();');
select is(dashboard_private.retire_withdrawal_roster_release_scheduler_v1(),'drifted','different schedule with the exact worker command is preserved for review');
select is((select schedule from cron.job where jobname='tips-withdrawal-roster-release-v1'),'*/2 * * * *','drifted schedule is never deleted');
select is((select to_jsonb(j) from cron.job j where jobname='synthetic-withdrawal-unrelated'),state,'unrelated cron is byte-for-byte untouched') from unrelated_cron_before;
select ok(to_regclass('dashboard_private.withdrawal_roster_release_queue_v1') is not null,'retirement preserves queue table');
select is((select count(*) from dashboard_private.notification_deliveries),0::bigint,'synthetic suite makes no external delivery');
select * from finish();
rollback;
