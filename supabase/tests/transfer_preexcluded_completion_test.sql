-- Local synthetic cases only. Exercise the installed public RPC and real triggers.
begin;
select no_plan();
set local statement_timeout='30s';
set local lock_timeout='5s';
insert into auth.users(id,email) values
 ('a0900000-0000-4000-8000-000000000001','transfer-admin@example.invalid'),
 ('a0900000-0000-4000-8000-000000000002','transfer-staff@example.invalid'),
 ('a0900000-0000-4000-8000-000000000003','transfer-teacher@example.invalid') on conflict(id) do nothing;
insert into public.profiles(id,role,name) values
 ('a0900000-0000-4000-8000-000000000001','admin','합성 관리자'),
 ('a0900000-0000-4000-8000-000000000002','staff','합성 직원'),
 ('a0900000-0000-4000-8000-000000000003','teacher','합성 교사')
 on conflict(id) do update set role=excluded.role,name=excluded.name;
create function pg_temp.actor(n integer) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','a0900000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub','','true');
 perform set_config('request.jwt.claim.role','','true');
end; $$;
select pg_temp.actor(1);
create temp table transfer_cases(label text primary key,task_id uuid,student_id uuid,from_id uuid,to_id uuid,request_id uuid,response jsonb);
create function pg_temp.transfer_case(label text,source_present boolean default true,target_present boolean default false,student_status text default '재원')
returns void language plpgsql as $$
declare t uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); d uuid:=gen_random_uuid();
begin
 insert into public.classes(id,name,status,subject,student_ids,waitlist_ids,fee,schedule_plan) values
 (f,'최초 이전반 '||label,'진행중','영어',case when source_present then jsonb_build_array(s) else '[]'::jsonb end,'[]',100000,'{}'),
 (d,'최초 이후반 '||label,'진행중','영어',case when target_present then jsonb_build_array(s) else '[]'::jsonb end,'[]',200000,'{}');
 insert into public.students(id,name,status,parent_contact,class_ids,waitlist_class_ids) values
 (s,'합성 전반 '||label,student_status,'00000000000',
 (case when source_present then jsonb_build_array(f) else '[]'::jsonb end)||(case when target_present then jsonb_build_array(d) else '[]'::jsonb end),'[]');
 insert into public.ops_tasks(id,type,status,title,student_id,class_id,requested_by,subject,student_name,class_name) values
 (t,'transfer','requested','합성 전반 '||label,s,d,'a0900000-0000-4000-8000-000000000001','영어','합성 전반 '||label,'최초 이후반 '||label);
 insert into public.ops_transfer_details(task_id,from_class_id,to_class_id,from_class_name,to_class_name,from_teacher_name,to_teacher_name,
 from_class_end_date,from_class_end_session,to_class_start_date,to_class_start_session,makeedu_transfer_done,fee_processed,textbook_fee_processed)
 values(t,f,d,'최초 이전반 '||label,'최초 이후반 '||label,'최초 전 교사','최초 후 교사','2026-09-01','3회차','2026-09-02','4회차',true,true,true);
 insert into transfer_cases values(label,t,s,f,d,gen_random_uuid(),null);
end; $$;
select pg_temp.transfer_case('normal');
select pg_temp.transfer_case('removed',false);
select pg_temp.transfer_case('withdrawn',false,false,'퇴원');
select pg_temp.transfer_case('target_registered',true,true);
select pg_temp.transfer_case('both_done',false,true);
select pg_temp.transfer_case('target_withdrawn',false,true,'퇴원');
select pg_temp.transfer_case('source_claim');
select pg_temp.transfer_case('removed_claim',false);
select pg_temp.transfer_case('target_claim',false,true);
select pg_temp.transfer_case('missing_round',false);
select pg_temp.transfer_case('no_submitted',false);
select pg_temp.transfer_case('edited_request',false);
select pg_temp.transfer_case('legacy_request',false);
select pg_temp.transfer_case('rollback');
select pg_temp.transfer_case('mismatch',false);
select pg_temp.transfer_case('target_waitlist',false);
select pg_temp.transfer_case('source_waitlist',false);
select pg_temp.transfer_case('same_class');
select pg_temp.transfer_case('missing_target');
select pg_temp.transfer_case('unpaid',false);
select pg_temp.transfer_case('canceled',false);
select pg_temp.transfer_case('teacher',false);
select pg_temp.transfer_case('staff',false);
select pg_temp.transfer_case('missing_date',false);

create temp table transfer_claims(label text primary key,id uuid);
create function pg_temp.claim(p_label text,p_target boolean default false) returns void language plpgsql as $$
declare c transfer_cases%rowtype; p uuid:=gen_random_uuid(); tr uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); e uuid:=gen_random_uuid();
begin
 select * into c from transfer_cases where label=p_label;
 insert into public.ops_tasks(id,title,type,status,requested_by,student_id,student_name,subject)
 values(p,'합성 등록 '||p_label,'registration','done','a0900000-0000-4000-8000-000000000001',c.student_id,'합성 전반 '||p_label,'영어');
 insert into public.ops_registration_details(task_id,inquiry_at,school_grade,school_name,parent_phone,common_revision,admission_notice_sent)
 values(p,'2026-08-01','중1','합성중','00000000000',1,true);
 insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status) values(tr,p,'영어','registered');
 insert into public.ops_registration_admission_batches(id,task_id,revision_number,status,invoice_sent_at,payment_confirmed_at)
 values(b,p,1,'completed','2026-08-02','2026-08-03');
 update public.classes set lessons='[{"date":"2026-08-01","sessionKey":"2026-08-01:1","session":"1회차"}]',
 schedule_plan='{"sessions":[{"date":"2026-08-01","sessionNumber":1,"scheduleState":"active","durationMinutes":120}]}'
 where id=case when p_target then c.to_id else c.from_id end;
 insert into public.ops_registration_enrollments(id,track_id,student_id,admission_batch_id,class_id,class_start_date,class_start_session_key,class_start_session,status,makeedu_registered,roster_active,sort_order)
 values(e,tr,c.student_id,b,case when p_target then c.to_id else c.from_id end,'2026-08-01','2026-08-01:1','1회차','enrolled',true,true,0);
 insert into transfer_claims values(p_label,e);
end; $$;
select pg_temp.claim('source_claim');
select pg_temp.claim('removed_claim');
select pg_temp.claim('target_claim',true);
update public.ops_transfer_details set from_class_end_session=null,to_class_start_session=null where task_id=(select task_id from transfer_cases where label='missing_round');
-- Record a real initial request before editing detail; missing legacy snapshots
-- must remain absent rather than being reconstructed during completion.
select dashboard_private.record_ops_transition_notification_source_v1(t,'transfer.submitted',gen_random_uuid())
from transfer_cases c join public.ops_tasks t on t.id=c.task_id where c.label<>'no_submitted';
update public.ops_task_events set payload=payload-'before_class_end_session'-'after_class_start_session'-'before_class_end_date'-'after_class_start_date'
where task_id=(select task_id from transfer_cases where label='legacy_request') and event_type='transfer.submitted';
update public.ops_transfer_details set from_class_end_date='2026-09-10',to_class_start_date='2026-09-11',
 from_class_end_session='7회차',to_class_start_session='8회차',from_class_name='저장된 수정 이전반',to_class_name='저장된 수정 이후반'
where task_id=(select task_id from transfer_cases where label='edited_request');
delete from public.ops_task_events where task_id=(select task_id from transfer_cases where label='no_submitted') and event_type='transfer.submitted';
-- A later submitted source must not replace the earliest source snapshot.
select dashboard_private.record_ops_transition_notification_source_v1(t,'transfer.submitted',gen_random_uuid())
from transfer_cases c join public.ops_tasks t on t.id=c.task_id where c.label='edited_request';
update public.classes set name='현재 변경된 반 이름',fee=999999 where id in(select to_id from transfer_cases);
update public.classes set student_ids=jsonb_build_array((select student_id from transfer_cases where label='mismatch')) where id=(select from_id from transfer_cases where label='mismatch');
update public.students set waitlist_class_ids=jsonb_build_array(c.to_id) from transfer_cases c where students.id=c.student_id and c.label='target_waitlist';
update public.classes set waitlist_ids=jsonb_build_array(c.student_id) from transfer_cases c where classes.id=c.to_id and c.label='target_waitlist';
update public.students set waitlist_class_ids=jsonb_build_array(c.from_id) from transfer_cases c where students.id=c.student_id and c.label='source_waitlist';
update public.classes set waitlist_ids=jsonb_build_array(c.student_id) from transfer_cases c where classes.id=c.from_id and c.label='source_waitlist';
update public.ops_transfer_details set to_class_id=from_class_id where task_id=(select task_id from transfer_cases where label='same_class');
update public.ops_transfer_details set to_class_id=null where task_id=(select task_id from transfer_cases where label='missing_target');
update public.ops_transfer_details set fee_processed=false,textbook_fee_processed=false where task_id=(select task_id from transfer_cases where label='unpaid');
update public.ops_transfer_details set from_class_end_date=null where task_id=(select task_id from transfer_cases where label='missing_date');
update public.ops_tasks set status='canceled' where id=(select task_id from transfer_cases where label='canceled');
create temp table detail_before as select task_id,to_jsonb(d)-'updated_at'-'timetable_roster_updated' facts from public.ops_transfer_details d;
create temp table source_before as select id,to_jsonb(e) facts from public.ops_task_events e;
create temp table finance_before as select id,to_jsonb(b) facts from public.ops_registration_admission_batches b;
create temp table claims_before as select id,to_jsonb(e) facts from public.ops_registration_enrollments e;
create temp table class_before as select id,to_jsonb(c)-'student_ids'-'waitlist_ids' facts from public.classes c;
create temp table history_before as select id,to_jsonb(h) facts from public.student_class_enrollment_history h;
grant select,update on transfer_cases to authenticated;

-- COMPLETION_TESTS
set local role authenticated;
update transfer_cases set response=public.complete_ops_transfer_roster_transition_v2(task_id,request_id)
where label in('normal','removed','withdrawn','target_registered','both_done','target_withdrawn','source_claim','removed_claim','target_claim','missing_round','no_submitted','edited_request','legacy_request');
reset role;
select is(t.status,'done',c.label||' completes') from transfer_cases c join public.ops_tasks t on t.id=c.task_id where c.response is not null;
select ok(not(s.class_ids?c.from_id::text) and s.class_ids?c.to_id::text and not(f.student_ids?c.student_id::text) and d.student_ids?c.student_id::text,
 c.label||' source removed and destination enrolled') from transfer_cases c join public.students s on s.id=c.student_id
 join public.classes f on f.id=c.from_id join public.classes d on d.id=c.to_id where c.response is not null;
select is(s.status,'재원',c.label||' student status reflects destination enrollment') from transfer_cases c join public.students s on s.id=c.student_id where c.response is not null;
select is(t.class_name,case when c.label='edited_request' then '저장된 수정 이후반' else '최초 이후반 '||c.label end,c.label||' task preserves requested class label') from transfer_cases c join public.ops_tasks t on t.id=c.task_id where c.response is not null;
select is((select count(*)::integer from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.from_id),
 case when c.label in('normal','target_registered','source_claim') then 1 else 0 end,c.label||' removal history only for changed roster') from transfer_cases c where c.response is not null;
select is((select count(*)::integer from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.to_id),
 case when c.label in('target_registered','both_done','target_withdrawn','target_claim') then 0 else 1 end,c.label||' no duplicate destination history') from transfer_cases c where c.response is not null;
select is((select count(*)::integer from public.ops_task_events e where e.task_id=c.task_id and e.event_type='transfer.completed'),1,c.label||' single completion source') from transfer_cases c where c.response is not null;
select is((select count(*)::integer from dashboard_private.notification_events e where e.source_id=c.response->'sourceEventIds'->>0),1,c.label||' single canonical notification') from transfer_cases c where c.response is not null;
select is(to_jsonb(d)-'updated_at'-'timetable_roster_updated',b.facts,'request detail keeps exact dates, rounds, teachers and financial checks') from public.ops_transfer_details d join detail_before b using(task_id);
select is(e.payload->'requested_transfer_snapshot',
 jsonb_build_object('before_class','최초 이전반 edited_request','after_class','최초 이후반 edited_request','teacher_name','최초 전 교사',
 'before_class_end_date','2026-09-01','after_class_start_date','2026-09-02','before_class_end_session','3회차','after_class_start_session','4회차'),
 'completion uses earliest actual submitted dates, rounds and class info')
from public.ops_task_events e join transfer_cases c on c.task_id=e.task_id where c.label='edited_request' and e.event_type='transfer.completed';
select is(e.payload->'applied_transfer_snapshot',
 jsonb_build_object('before_class','저장된 수정 이전반','after_class','저장된 수정 이후반','teacher_name','최초 전 교사',
 'before_class_end_date','2026-09-10','after_class_start_date','2026-09-11','before_class_end_session','7회차','after_class_start_session','8회차'),
 'separate applied facts use saved edits without rewriting the request')
from public.ops_task_events e join transfer_cases c on c.task_id=e.task_id where c.label='edited_request' and e.event_type='transfer.completed';
select is(e.payload->>'requested_effective_date','2026-09-02','requested date does not inherit edited effective date')
from public.ops_task_events e join transfer_cases c on c.task_id=e.task_id where c.label='edited_request' and e.event_type='transfer.completed';
select is(e.payload->>'requested_transfer_snapshot_status','missing','legacy missing request recorded explicitly')
from public.ops_task_events e join transfer_cases c on c.task_id=e.task_id where c.label='no_submitted' and e.event_type='transfer.completed';
select ok(not(e.payload?'requested_effective_date') and not(e.payload?'requested_transfer_snapshot'),'absent original facts are never inferred from current detail')
from public.ops_task_events e join transfer_cases c on c.task_id=e.task_id where c.label='no_submitted' and e.event_type='transfer.completed';
select ok(e.payload->>'requested_transfer_snapshot_status'='incomplete'
 and not((e.payload->'requested_transfer_snapshot')?'before_class_end_session')
 and not((e.payload->'requested_transfer_snapshot')?'after_class_start_session'), 'legacy original rounds remain absent despite current populated detail')
from public.ops_task_events e join transfer_cases c on c.task_id=e.task_id where c.label='legacy_request' and e.event_type='transfer.completed';
select ok(e.payload->'requested_transfer_snapshot'->>'before_class_end_date'='2026-09-01'
 and e.payload->'requested_transfer_snapshot'->>'after_class_start_date'='2026-09-02'
 and e.payload->>'requested_effective_date'='2026-09-02','known legacy aliases preserve actual earliest request dates')
from public.ops_task_events e join transfer_cases c on c.task_id=e.task_id where c.label='legacy_request' and e.event_type='transfer.completed';
select ok(not exists(select 1 from source_before b left join public.ops_task_events e using(id) where to_jsonb(e) is distinct from b.facts),'all pre-existing request events are unchanged');
select ok(not exists(select 1 from finance_before b left join public.ops_registration_admission_batches f using(id) where to_jsonb(f) is distinct from b.facts),'non-empty invoice/payment batches unchanged');
select ok(not exists(select 1 from class_before b join public.classes c using(id) where (to_jsonb(c)-'student_ids'-'waitlist_ids') is distinct from b.facts),'tuition and schedule/lesson hours are unchanged');
select ok(not e.roster_active and e.roster_release_kind='transfer' and e.roster_release_source_task_id=c.task_id,'source claim released once')
from transfer_claims x join public.ops_registration_enrollments e on e.id=x.id join transfer_cases c using(label) where x.label in('source_claim','removed_claim');
select is(to_jsonb(e),b.facts,'destination claim and original admission schedule are unchanged')
from transfer_claims x join public.ops_registration_enrollments e on e.id=x.id join claims_before b on b.id=e.id where x.label='target_claim';
select is((select count(*)::integer from public.ops_registration_enrollments),(select count(*)::integer from claims_before),'completion never creates duplicate enrollment claims');

create temp table replay_counts as select (select count(*) from public.ops_task_events) events,(select count(*) from public.student_class_enrollment_history) history,(select count(*) from dashboard_private.notification_events) notifications;
set local role authenticated;
select is(public.complete_ops_transfer_roster_transition_v2(task_id,request_id),response,label||' same request replay is identical') from transfer_cases where response is not null;
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,gen_random_uuid()),'23514','ops_transfer_completion_state_conflict',label||' new request cannot repeat completion') from transfer_cases where response is not null;
reset role;
select ok(events=(select count(*) from public.ops_task_events) and history=(select count(*) from public.student_class_enrollment_history) and notifications=(select count(*) from dashboard_private.notification_events),'replays add no source, notification or roster history') from replay_counts;

set local role authenticated;
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'23514','registration_roster_projection_invalid','asymmetric roster rejected') from transfer_cases where label='mismatch';
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'23514','registration_roster_mode_conflict',label||' rejected') from transfer_cases where label in('target_waitlist','source_waitlist');
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'22023','ops_transfer_classes_must_differ','same class rejected') from transfer_cases where label='same_class';
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'22023','ops_transfer_management_link_required','missing target rejected') from transfer_cases where label='missing_target';
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'23514','ops_transfer_checklist_incomplete','fees still require the existing checklist') from transfer_cases where label='unpaid';
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'23514','ops_transfer_completion_state_conflict','canceled task rejected') from transfer_cases where label='canceled';
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'23514','ops_transfer_schedule_required','missing request date is not invented') from transfer_cases where label='missing_date';
reset role;

-- Fail after both roster writes to prove transaction rollback of the whole RPC.
create function pg_temp.fail_transfer() returns trigger language plpgsql as $$
begin
 if new.title='합성 전반 rollback' and new.status='done' then raise exception 'synthetic_completion_failure' using errcode='P0001'; end if;
 return new;
end; $$;
create trigger synthetic_transfer_failure before update on public.ops_tasks for each row execute function pg_temp.fail_transfer();
create temp table rollback_before as select to_jsonb(s) student,to_jsonb(f) source,to_jsonb(d) destination,to_jsonb(t) task,to_jsonb(td) detail
 from transfer_cases c join public.students s on s.id=c.student_id join public.classes f on f.id=c.from_id join public.classes d on d.id=c.to_id
 join public.ops_tasks t on t.id=c.task_id join public.ops_transfer_details td on td.task_id=t.id where c.label='rollback';
set local role authenticated;
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'P0001','synthetic_completion_failure','failure after roster writes rolls back') from transfer_cases where label='rollback';
reset role;
select ok(b.student=to_jsonb(s) and b.source=to_jsonb(f) and b.destination=to_jsonb(d) and b.task=to_jsonb(t) and b.detail=to_jsonb(td),'rollback restores all affected records')
 from rollback_before b cross join transfer_cases c join public.students s on s.id=c.student_id join public.classes f on f.id=c.from_id join public.classes d on d.id=c.to_id
 join public.ops_tasks t on t.id=c.task_id join public.ops_transfer_details td on td.task_id=t.id where c.label='rollback';
select is((select count(*)::integer from public.student_class_enrollment_history h join transfer_cases c on c.student_id=h.student_id where c.label='rollback'),0,'failure leaves no enrollment history');
select is((select count(*)::integer from public.ops_task_events e join transfer_cases c on c.task_id=e.task_id where c.label='rollback' and e.event_type='transfer.completed'),0,'failure leaves no completion/notification source');
drop trigger synthetic_transfer_failure on public.ops_tasks;
set local role authenticated;
select lives_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'failed request can retry unchanged ID') from transfer_cases where label='rollback';
select throws_ok(format('select public.transition_ops_task_status_v2(%L,%L,%L,%L)',c.task_id,'in_progress',t.updated_at,gen_random_uuid()),'40001','ops_transition_closed','completed transfer cannot be reopened') from transfer_cases c join public.ops_tasks t on t.id=c.task_id where c.label='normal';
select throws_ok(format('select public.transition_ops_task_status_v2(%L,%L,%L,%L)',c.task_id,'canceled',t.updated_at,gen_random_uuid()),'40001','ops_transition_closed','completed transfer cannot be canceled') from transfer_cases c join public.ops_tasks t on t.id=c.task_id where c.label='normal';
select lives_ok(format('select public.transition_ops_task_status_v2(%L,%L,%L,%L)',c.task_id,'canceled',t.updated_at,gen_random_uuid()),'pending transfer can cancel without roster mutation') from transfer_cases c join public.ops_tasks t on t.id=c.task_id where c.label='unpaid';
select lives_ok(format('select public.transition_ops_task_status_v2(%L,%L,%L,%L)',c.task_id,'in_progress',t.updated_at,gen_random_uuid()),'canceled transfer can reopen without roster mutation') from transfer_cases c join public.ops_tasks t on t.id=c.task_id where c.label='canceled';
select pg_temp.actor(3);
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'42501',null,'teacher denied') from transfer_cases where label='teacher';
select pg_temp.actor(2);
select lives_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'staff can complete pre-excluded transfer') from transfer_cases where label='staff';
reset role;
select is((select count(*)::integer from public.student_class_enrollment_history h join transfer_cases c on c.student_id=h.student_id where c.label in('unpaid','canceled')),0,'cancel and reopen do not write enrollment history');
update auth.users set banned_until=now()+interval '1 day' where id='a0900000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok(format('select public.complete_ops_transfer_roster_transition_v2(%L,%L)',task_id,request_id),'42501',null,'banned staff cannot complete') from transfer_cases where label='teacher';
reset role;
select ok(not has_function_privilege('anon','public.complete_ops_transfer_roster_transition_v2(uuid,uuid)','execute'),'anon has no execute');
select is((select count(*)::integer from net.http_request_queue),0,'no external provider queue');
select is((select count(*)::integer from dashboard_private.notification_request_ledger l join transfer_cases c on c.request_id=l.request_id where c.label in('mismatch','target_waitlist','source_waitlist','same_class','missing_target','unpaid','teacher','missing_date')),0,'failed attempts leave no success receipts');
select ok(position('registration_workflow_retry_required' in pg_get_functiondef('dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)'::regprocedure))>0,'final function retains locked rescan collision guard');
select * from finish();
rollback;
