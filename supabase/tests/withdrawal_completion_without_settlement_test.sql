-- Local synthetic pgTAP only. Run after the ordered migration chain with
-- pgTAP and transaction-safe pg_cron metadata available. Scheduler install/remove
-- follows withdrawal_last_lesson_release_test.sql and rolls back with this test;
-- the isolated evidence runner uses record-only cron helpers and no network.
-- All identities and amounts below are fictional. Business RPCs/helpers and
-- active source/projection guards remain installed; no business function is stubbed.
begin;
select no_plan();
set local statement_timeout='30s';set local lock_timeout='5s';set local timezone='UTC';
insert into auth.users(id,email)values('a0700000-0000-4000-8000-000000000001','withdrawal-unpaid-fixture@example.invalid');
insert into public.profiles(id,role,name)values('a0700000-0000-4000-8000-000000000001','admin','합성 퇴원 검증 관리자');
select set_config('request.jwt.claims','{"sub":"a0700000-0000-4000-8000-000000000001","role":"authenticated"}',true),set_config('request.jwt.claim.sub','a0700000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
create temp table completion_cases(label text primary key,task_id uuid,student_id uuid,class_id uuid,request_id uuid,last_date date,original_fee boolean,original_book boolean,response jsonb);
create function pg_temp.completion_case(p_label text,p_date date,p_mode text default 'removed',p_status text default '재원',p_fee boolean default false,p_book boolean default false,p_timetable boolean default true,p_makeedu boolean default true)returns void language plpgsql as $$
declare t uuid:=gen_random_uuid();s uuid:=gen_random_uuid();c uuid:=gen_random_uuid();
begin
 insert into public.classes(id,name,status,subject,student_ids,waitlist_ids)values(c,'합성 수업 '||p_label,'진행중','영어',case when p_mode in('enrolled','asymmetric')then jsonb_build_array(s)else'[]'::jsonb end,case when p_mode='waitlist'then jsonb_build_array(s)else'[]'::jsonb end);
 insert into public.students(id,name,status,parent_contact,class_ids,waitlist_class_ids)values(s,'합성 학생 '||p_label,p_status,'00000000000',case when p_mode='enrolled'then jsonb_build_array(c)else'[]'::jsonb end,case when p_mode='waitlist'then jsonb_build_array(c)else'[]'::jsonb end);
 insert into public.ops_tasks(id,type,status,title,student_id,class_id,requested_by,subject,student_name,class_name)values(t,'withdrawal','requested','합성 완료 '||p_label,s,c,'a0700000-0000-4000-8000-000000000001','영어','합성 학생 '||p_label,'합성 수업 '||p_label);
 insert into public.ops_withdrawal_details(task_id,withdrawal_date,withdrawal_session,makeedu_withdrawal_done,fee_processed,textbook_fee_processed,timetable_roster_updated)values(t,p_date,'3회차',p_makeedu,p_fee,p_book,p_timetable);
 insert into completion_cases values(p_label,t,s,c,gen_random_uuid(),p_date,p_fee,p_book,null);
end;$$;
create temp table completion_claims(label text primary key,parent_id uuid,track_id uuid,batch_id uuid,claim_id uuid);
create function pg_temp.completion_claim(p_label text)returns void language plpgsql as $$
declare c completion_cases%rowtype;p uuid:=gen_random_uuid();t uuid:=gen_random_uuid();b uuid:=gen_random_uuid();e uuid:=gen_random_uuid();
begin
 select * into strict c from completion_cases where label=p_label;
 insert into public.ops_tasks(id,type,status,title,requested_by)values(p,'registration','requested','합성 등록 부모','a0700000-0000-4000-8000-000000000001');
 insert into public.ops_registration_details(task_id)values(p);
 insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status)values(t,p,'영어','registered','registered');
 insert into public.ops_registration_admission_batches(id,task_id,status,revision_number)values(b,p,'completed',1);
 insert into public.ops_registration_enrollments(id,track_id,class_id,student_id,status,roster_active,admission_batch_id,class_start_date,class_start_session_key,class_start_session)values(e,t,c.class_id,c.student_id,'enrolled',true,b,c.last_date-10,(c.last_date-10)::text||':1','1회차');
 perform dashboard_private.recompute_registration_parent(p);
 insert into completion_claims values(p_label,p,t,b,e);
end;$$;

select is(public.withdrawal_last_lesson_release_runtime_version(),'withdrawal_completion_without_settlement_v2','runtime capability identifies new contract');
select pg_temp.completion_case('absent00',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'removed','재원',false,false);
select pg_temp.completion_case('absent01',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'removed','재원',false,true);
select pg_temp.completion_case('absent10',(clock_timestamp()at time zone'Asia/Seoul')::date-20,'removed','재원',true,false);
select pg_temp.completion_case('absent11',(clock_timestamp()at time zone'Asia/Seoul')::date-20,'removed','재원',true,true);
select pg_temp.completion_case('withdrawn',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'removed','퇴원',false,false,true);
select pg_temp.completion_case('absent_false_flag',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'removed','재원',false,false,false);
select pg_temp.completion_case('makeedu_false',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'removed','재원',false,false,true,false);
select pg_temp.completion_case('missing_date',null);
select pg_temp.completion_case('asymmetric',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'asymmetric');
select pg_temp.completion_case('waitlist',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'waitlist');
select pg_temp.completion_case('claim_absent',(clock_timestamp()at time zone'Asia/Seoul')::date+20);
select pg_temp.completion_claim('claim_absent');

-- Actual financial tables hold both textbook and tuition unpaid evidence.
insert into public.textbooks(id,title,name,subject,school_levels,grade_levels,sub_subject)values('a0700000-0000-4000-8000-000000000031','합성 교재','합성 교재','english',array['high'],array['h1'],'영어');
insert into public.textbook_sales(id,class_id,charge_month,status)select 'a0700000-0000-4000-8000-000000000032',class_id,'2026-10','charged'from completion_cases where label='absent00';
insert into public.textbook_sale_lines(id,sale_id,student_id,class_id,textbook_id,charge_month,quantity,unit_price,status,makeedu_charge_amount,makeedu_paid_amount,makeedu_unpaid_amount,makeedu_payment_status)select 'a0700000-0000-4000-8000-000000000033','a0700000-0000-4000-8000-000000000032',student_id,class_id,'a0700000-0000-4000-8000-000000000031','2026-10',1,25000,'charged',25000,5000,20000,'unpaid'from completion_cases where label='absent00';
insert into public.textbook_makeedu_payment_imports(id,makeedu_import_key,student_external_id,category,charge_month,item_name,payment_status,charge_amount,paid_amount,unpaid_amount,matched_sale_line_id)values('a0700000-0000-4000-8000-000000000034','synthetic-book-unpaid','synthetic-student','교재비','2026-10','합성 교재','unpaid',25000,5000,20000,'a0700000-0000-4000-8000-000000000033'),('a0700000-0000-4000-8000-000000000035','synthetic-tuition-unpaid','synthetic-student','수업료','2026-10','합성 수업료','unpaid',77000,0,77000,null);
create function pg_temp.financial_state()returns jsonb language sql as $$select jsonb_build_object('sales',(select jsonb_agg(to_jsonb(r)order by id)from public.textbook_sales r),'lines',(select jsonb_agg(to_jsonb(r)order by id)from public.textbook_sale_lines r),'imports',(select jsonb_agg(to_jsonb(r)order by id)from public.textbook_makeedu_payment_imports r),'batches',(select jsonb_agg(to_jsonb(r)order by id)from public.ops_registration_admission_batches r))$$;
create temp table protected_financial_state as select pg_temp.financial_state() state;
select public.manage_withdrawal_roster_release_scheduler_v1('remove');
select ok(not dashboard_private.withdrawal_roster_release_scheduler_ready_v1(),'absent roster tests have no scheduler');
update completion_cases set response=public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id)where label in('absent00','absent01','absent10','absent11','withdrawn','absent_false_flag');
select is(t.status,'done',c.label||' completes with absent roster')from completion_cases c join public.ops_tasks t on t.id=c.task_id where c.response is not null;
select is(c.response->>'rosterAlreadyRemoved','true',c.label||' receipt reports already removed roster')from completion_cases c where c.response is not null;
select ok(d.fee_processed=c.original_fee and d.textbook_fee_processed=c.original_book,c.label||' preserves exact original settlement flags')from completion_cases c join public.ops_withdrawal_details d on d.task_id=c.task_id where c.response is not null;
select is((select count(*)from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.class_id),0::bigint,c.label||' does not fabricate roster history')from completion_cases c where c.response is not null;
select is((select count(*)from dashboard_private.withdrawal_roster_release_queue_v1),0::bigint,'absent past/future dates never enqueue or restore roster');
select is(s.status,'퇴원','already withdrawn empty student stays withdrawn')from completion_cases c join public.students s on s.id=c.student_id where label='withdrawn';
select ok(d.timetable_roster_updated,'false roster checklist becomes true after absent completion')from completion_cases c join public.ops_withdrawal_details d on d.task_id=c.task_id where label='absent_false_flag';
select is(pg_temp.financial_state(),state,'completion preserves actual tuition/book balances and batch finance byte-for-byte')from protected_financial_state;
select is(public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id),response,'same completion receipt replays without extra effects')from completion_cases where label='absent00';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','ops_withdrawal_checklist_incomplete','makeedu still required')from completion_cases where label='makeedu_false';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','withdrawal_last_lesson_date_required','missing cutoff remains domain conflict')from completion_cases where label='missing_date';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','registration_roster_projection_invalid','four-array asymmetry cannot complete')from completion_cases where label='asymmetric';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','ops_withdrawal_waitlist_conflict','source waitlist is not withdrawn as enrolled')from completion_cases where label='waitlist';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','ops_withdrawal_claim_roster_conflict','absent arrays with active claim cannot release canonical claim')from completion_cases where label='claim_absent';
select ok(e.roster_active,'claim conflict preserves active ownership')from completion_claims c join public.ops_registration_enrollments e on e.id=c.claim_id where label='claim_absent';

select pg_temp.completion_case('present_future',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'enrolled','재원',false,false,false);
select pg_temp.completion_claim('present_future');
select pg_temp.completion_case('present_past',(clock_timestamp()at time zone'Asia/Seoul')::date-20,'enrolled','재원',false,false,false);
select pg_temp.completion_claim('present_past');
select public.manage_withdrawal_roster_release_scheduler_v1('install');
update completion_cases set response=public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id)where label in('present_future','present_past');
select ok(s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text and e.roster_active and s.status='재원','future existing roster remains live with unpaid flags')from completion_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id join completion_claims own using(label)join public.ops_registration_enrollments e on e.id=own.claim_id where label='present_future';
select is(response->>'rosterReleaseScheduled','true','future existing roster schedules immutable release')from completion_cases where label='present_future';
select ok(not(s.class_ids?c.class_id::text)and not(cl.student_ids?c.student_id::text)and not e.roster_active,'past existing roster and exact claim release normally despite unpaid fees')from completion_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id join completion_claims own using(label)join public.ops_registration_enrollments e on e.id=own.claim_id where label='present_past';
select ok(not d.fee_processed and not d.textbook_fee_processed,c.label||' existing roster completion never marks fees settled')from completion_cases c join public.ops_withdrawal_details d on d.task_id=c.task_id where label in('present_future','present_past');
select is(pg_temp.financial_state()-'batches',state-'batches','existing roster completion preserves real balances and sale status')from protected_financial_state;

-- Initial admission history is not re-entry; a removed/enrolled cycle after
-- an old request is a newer relationship and cannot be removed by that task.
select pg_temp.completion_case('initial_history',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'enrolled','재원',false,false,false);
insert into public.student_class_enrollment_history(student_id,class_id,action,changed_by,memo)select student_id,class_id,'enrolled','a0700000-0000-4000-8000-000000000001','합성 최초 등록'from completion_cases where label='initial_history';
select lives_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'initial enrollment alone is not mistaken for re-entry')from completion_cases where label='initial_history';
select pg_temp.completion_case('reentry',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'enrolled','재원',false,false,false);
update public.ops_tasks set created_at=now()-interval'1 day'where id=(select task_id from completion_cases where label='reentry');
select dashboard_private.apply_student_class_roster_mode(student_id,class_id,'removed','enrolled',null,'synthetic_remove','a0700000-0000-4000-8000-000000000001')from completion_cases where label='reentry';
select dashboard_private.apply_student_class_roster_mode(student_id,class_id,'enrolled','removed',null,'synthetic_reentry','a0700000-0000-4000-8000-000000000001')from completion_cases where label='reentry';
select is((select max(changed_at)-min(changed_at)from public.student_class_enrollment_history where student_id=c.student_id and class_id=c.class_id),interval'0','actual helper remove and restore share transaction timestamp')from completion_cases c where label='reentry';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','ops_withdrawal_registration_changed','old task cannot remove newer re-entry')from completion_cases where label='reentry';
select ok(s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text,'re-entry guard preserves reciprocal roster')from completion_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label='reentry';

-- All present-roster fee combinations, including a previously checked roster.
select pg_temp.completion_case('present01',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'enrolled','재원',false,true,true);
select pg_temp.completion_case('present10',(clock_timestamp()at time zone'Asia/Seoul')::date+20,'enrolled','재원',true,false,true);
select pg_temp.completion_case('present11',(clock_timestamp()at time zone'Asia/Seoul')::date-20,'enrolled','재원',true,true,true);
update completion_cases set response=public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id)where label in('present01','present10','present11');
select is(t.status,'done',c.label||' completes with existing roster and original fee combination')from completion_cases c join public.ops_tasks t on t.id=c.task_id where label in('present01','present10','present11');
select ok(d.fee_processed=c.original_fee and d.textbook_fee_processed=c.original_book and d.timetable_roster_updated,c.label||' preserves fee combination and accepts timetable already true')from completion_cases c join public.ops_withdrawal_details d on d.task_id=c.task_id where label in('present01','present10','present11');
select ok(s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text,c.label||' future roster remains through cutoff')from completion_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label in('present01','present10');
select ok(not(s.class_ids?c.class_id::text)and not(cl.student_ids?c.student_id::text),'present11 past roster removed with true timetable')from completion_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label='present11';
select is(public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id),response,'scheduled receipt replays exactly after timetable true')from completion_cases where label='present01';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,gen_random_uuid())',task_id),'23514','ops_withdrawal_completion_state_conflict','new request cannot complete done task twice')from completion_cases where label='present01';
select pg_temp.completion_case('canceled',(clock_timestamp()at time zone'Asia/Seoul')::date-20);
update public.ops_tasks set status='canceled'where id=(select task_id from completion_cases where label='canceled');
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','ops_withdrawal_completion_state_conflict','canceled task remains blocked')from completion_cases where label='canceled';
-- UUID identity remains exact even when student/class display names match.
select pg_temp.completion_case('exact_target',(clock_timestamp()at time zone'Asia/Seoul')::date-20,'enrolled');
select pg_temp.completion_case('exact_other',(clock_timestamp()at time zone'Asia/Seoul')::date-20,'enrolled');
update public.students set name='합성 동명이인'where id in(select student_id from completion_cases where label in('exact_target','exact_other'));
update public.classes set name='합성 동일 수업명'where id in(select class_id from completion_cases where label in('exact_target','exact_other'));
select lives_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'exact UUID target completes with colliding display names')from completion_cases where label='exact_target';
select ok(s.status='재원'and s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text and t.status='requested','same-name non-target student/class/task remain untouched')from completion_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id join public.ops_tasks t on t.id=c.task_id where label='exact_other';
-- Already absent source preserves another active class instead of forcing withdrawal.
select pg_temp.completion_case('absent_other',(clock_timestamp()at time zone'Asia/Seoul')::date+20);
create temp table other_class as select gen_random_uuid()id;
insert into public.classes(id,name,status,subject,student_ids,waitlist_ids)select o.id,'합성 타수업','진행중','영어',jsonb_build_array(c.student_id),'[]'::jsonb from other_class o cross join completion_cases c where c.label='absent_other';
update public.students set class_ids=jsonb_build_array(o.id)from other_class o where public.students.id=(select student_id from completion_cases where label='absent_other');
select lives_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'absent source completes while other class remains')from completion_cases where label='absent_other';
select ok(s.status='재원'and s.class_ids?o.id::text and cl.student_ids?s.id::text,'other enrolled class reciprocal arrays and active student status are preserved')from completion_cases c join public.students s on s.id=c.student_id cross join other_class o join public.classes cl on cl.id=o.id where c.label='absent_other';
-- Validate the class side and malformed student arrays, not only the student side.
select pg_temp.completion_case('class_waitlist',(clock_timestamp()at time zone'Asia/Seoul')::date-20);
update public.classes set waitlist_ids=jsonb_build_array(c.student_id)from completion_cases c where c.label='class_waitlist'and public.classes.id=c.class_id;
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','registration_roster_projection_invalid','class-only waitlist asymmetry is blocked')from completion_cases where label='class_waitlist';
select pg_temp.completion_case('malformed_student',(clock_timestamp()at time zone'Asia/Seoul')::date-20);
update public.students set class_ids='{}'::jsonb where id=(select student_id from completion_cases where label='malformed_student');
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','registration_roster_projection_invalid','malformed student array remains blocked')from completion_cases where label='malformed_student';
select pg_temp.completion_case('malformed_class',(clock_timestamp()at time zone'Asia/Seoul')::date-20);
update public.classes set student_ids='{}'::jsonb where id=(select class_id from completion_cases where label='malformed_class');
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'22023','registration_roster_projection_invalid','malformed class array retains final helper invalid-argument SQLSTATE')from completion_cases where label='malformed_class';

-- Fee-only endpoint: actual task, queue, claims, money and notification counters
-- are protected while only one check, its audit and receipt may change.
create temp table fee_protected as select (select to_jsonb(t)from public.ops_tasks t where t.id=(select task_id from completion_cases where label='absent00'))task,(select jsonb_agg(to_jsonb(r)order by task_id)from dashboard_private.withdrawal_roster_release_queue_v1 r)queue,(select jsonb_agg(to_jsonb(r)order by id)from public.ops_registration_enrollments r)claims,pg_temp.financial_state()finance,(select count(*)from dashboard_private.notification_events)events,(select count(*)from dashboard_private.notification_event_fanout_jobs)jobs,(select count(*)from dashboard_private.notification_deliveries)deliveries,(select count(*)from public.ops_task_events where event_type like'withdrawal.%'or event_type like'registration.%')sources;
create temp table fee_receipts(request_id uuid,response jsonb);
insert into fee_receipts values('a0700000-0000-4000-8000-000000000041',null);
update fee_receipts set response=public.update_ops_withdrawal_settlement_check_v1((select task_id from completion_cases where label='absent00'),'feeProcessed',true,false,request_id);
select is(response->>'changed','true','fee-only endpoint changes requested check')from fee_receipts;
select ok(d.fee_processed and not d.textbook_fee_processed,'only tuition check changes')from completion_cases c join public.ops_withdrawal_details d on d.task_id=c.task_id where label='absent00';
select is(public.update_ops_withdrawal_settlement_check_v1((select task_id from completion_cases where label='absent00'),'feeProcessed',true,false,request_id),response,'same settlement request replays exact receipt')from fee_receipts;
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''textbookFeeProcessed'',true,false,''a0700000-0000-4000-8000-000000000041'')',task_id),'22023','idempotency_key_reused','request reuse for different fee field is rejected')from completion_cases where label='absent00';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',false,false,gen_random_uuid())',task_id),'23514','withdrawal_settlement_check_conflict','stale expected fee check has domain conflict')from completion_cases where label='absent00';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''makeeduWithdrawalDone'',false,true,gen_random_uuid())',task_id),'22023','withdrawal_settlement_check_invalid','completed fee endpoint cannot edit makeedu')from completion_cases where label='absent00';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',true,false,gen_random_uuid())',task_id),'23514','withdrawal_settlement_completed_task_required','unfinished task cannot use completed fee endpoint')from completion_cases where label='makeedu_false';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''timetableRosterUpdated'',false,true,gen_random_uuid())',task_id),'22023','withdrawal_settlement_check_invalid','completed fee endpoint cannot edit timetable')from completion_cases where label='absent00';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',null,true,gen_random_uuid())',task_id),'22023','withdrawal_settlement_check_invalid','null target check is invalid')from completion_cases where label='absent00';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',false,null,gen_random_uuid())',task_id),'22023','withdrawal_settlement_check_invalid','null expected check is invalid')from completion_cases where label='absent00';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',false,true,null)',task_id),'22023','withdrawal_settlement_check_invalid','null request ID is invalid')from completion_cases where label='absent00';
select is(public.update_ops_withdrawal_settlement_check_v1((select task_id from completion_cases where label='absent00'),'feeProcessed',true,false,gen_random_uuid())->>'changed','false','already desired check is a no-op with stale expected value');
select lives_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''textbookFeeProcessed'',true,false,gen_random_uuid())',task_id),'book check follows up independently')from completion_cases where label='absent00';
select is((select to_jsonb(t)from public.ops_tasks t where t.id=(select task_id from completion_cases where label='absent00')),task,'fee endpoint preserves task/status/completion timestamps byte-for-byte')from fee_protected;
select is((select jsonb_agg(to_jsonb(r)order by task_id)from dashboard_private.withdrawal_roster_release_queue_v1 r),queue,'fee endpoint preserves reservations byte-for-byte')from fee_protected;
select is((select jsonb_agg(to_jsonb(r)order by id)from public.ops_registration_enrollments r),claims,'fee endpoint preserves all canonical claims byte-for-byte')from fee_protected;
select is(pg_temp.financial_state(),finance,'fee endpoint preserves tuition/book debt, invoice evidence and payment amounts byte-for-byte')from fee_protected;
select is((select count(*)from dashboard_private.notification_events),events,'fee endpoint creates no canonical notification')from fee_protected;
select is((select count(*)from dashboard_private.notification_event_fanout_jobs),jobs,'fee endpoint creates no fanout job')from fee_protected;
select is((select count(*)from dashboard_private.notification_deliveries),deliveries,'fee endpoint creates no delivery')from fee_protected;
select is((select count(*)from public.ops_task_events where event_type like'withdrawal.%'or event_type like'registration.%'),sources,'fee endpoint creates no source notification')from fee_protected;
select ok(not has_function_privilege('anon','public.update_ops_withdrawal_settlement_check_v1(uuid,text,boolean,boolean,uuid)','EXECUTE')and not has_function_privilege('service_role','public.update_ops_withdrawal_settlement_check_v1(uuid,text,boolean,boolean,uuid)','EXECUTE'),'fee RPC exposes only authenticated manager path');
update auth.users set banned_until=now()+interval'1 day'where id='a0700000-0000-4000-8000-000000000001';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',true,false,''a0700000-0000-4000-8000-000000000041'')',task_id),'42501','registration_access_denied','banned manager cannot replay existing fee receipt')from completion_cases where label='absent00';
update auth.users set banned_until=null,deleted_at=now()where id='a0700000-0000-4000-8000-000000000001';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',false,true,gen_random_uuid())',task_id),'42501','registration_access_denied','deleted manager cannot follow up fees')from completion_cases where label='absent00';
update auth.users set deleted_at=null where id='a0700000-0000-4000-8000-000000000001';
update public.profiles set role='teacher'where id='a0700000-0000-4000-8000-000000000001';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',false,true,gen_random_uuid())',task_id),'42501','registration_access_denied','teacher cannot follow up completed fees')from completion_cases where label='absent00';
update public.profiles set role='assistant'where id='a0700000-0000-4000-8000-000000000001';
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',false,true,gen_random_uuid())',task_id),'42501','registration_access_denied','assistant cannot follow up completed fees')from completion_cases where label='absent00';
update public.profiles set role='staff'where id='a0700000-0000-4000-8000-000000000001';
select lives_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',false,true,gen_random_uuid())',task_id),'active staff can uncheck one fee field')from completion_cases where label='absent00';
update public.profiles set role='admin'where id='a0700000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','authenticated',true);
select throws_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',true,false,gen_random_uuid())',task_id),'42501','registration_access_denied','null authenticated identity cannot follow up completed fees')from completion_cases where label='absent00';
select set_config('request.jwt.claims','{"sub":"a0700000-0000-4000-8000-000000000001","role":"authenticated"}',true),set_config('request.jwt.claim.sub','a0700000-0000-4000-8000-000000000001',true);
grant select on completion_cases to authenticated;
set local role authenticated;
select lives_ok(format('select public.update_ops_withdrawal_settlement_check_v1(%L,''feeProcessed'',false,false,gen_random_uuid())',task_id),'actual authenticated browser role can call authorized fee endpoint')from completion_cases where label='absent00';
reset role;
select is(pg_temp.financial_state(),finance,'all authorized and rejected fee attempts preserve actual financial rows')from fee_protected;
select * from finish();rollback;
