begin;
select no_plan();
set local statement_timeout='30s';
set local lock_timeout='5s';
set local timezone='UTC';

-- Synthetic identities only. The actual final gateways, roster helpers, queue
-- guards and source triggers stay installed; no business function is replaced.
insert into auth.users(id,email) values('a0600000-0000-4000-8000-000000000001','withdrawal-boundary-fixture@example.invalid');
insert into public.profiles(id,role,name) values('a0600000-0000-4000-8000-000000000001','admin','경계 검증 관리자');
select set_config('request.jwt.claims','{"sub":"a0600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a0600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

create temp table withdrawal_cases(label text primary key,task_id uuid,student_id uuid,class_id uuid,request_id uuid,last_date date,response jsonb);
create function pg_temp.withdrawal_case(p_label text,p_date date) returns void language plpgsql as $$
declare v_task uuid:=gen_random_uuid();v_student uuid:=gen_random_uuid();v_class uuid:=gen_random_uuid();
begin
 insert into public.classes(id,name,status,subject,student_ids,waitlist_ids) values(v_class,'경계 검증 '||p_label,'진행중','영어',jsonb_build_array(v_student),'[]');
 insert into public.students(id,name,status,parent_contact,class_ids,waitlist_class_ids) values(v_student,'합성 학생 '||p_label,'재원','00000000000',jsonb_build_array(v_class),'[]');
 insert into public.ops_tasks(id,type,status,title,student_id,class_id,requested_by,subject,student_name,class_name)
 values(v_task,'withdrawal','requested','합성 퇴원 경계 '||p_label,v_student,v_class,'a0600000-0000-4000-8000-000000000001','영어','합성 학생 '||p_label,'경계 검증 '||p_label);
 insert into public.ops_withdrawal_details(task_id,withdrawal_date,withdrawal_session,makeedu_withdrawal_done,fee_processed,textbook_fee_processed)
 values(v_task,p_date,'3회차',true,true,true);
 insert into withdrawal_cases values(p_label,v_task,v_student,v_class,gen_random_uuid(),p_date,null);
end;$$;

select ok(not has_table_privilege('authenticated','dashboard_private.withdrawal_roster_release_queue_v1','SELECT'),'queue is private');
select ok(not has_function_privilege('authenticated','dashboard_private.process_due_withdrawal_roster_releases_v1(integer)','EXECUTE'),'worker is not browser callable');
select ok(not has_function_privilege('service_role','dashboard_private.apply_scheduled_withdrawal_roster_release_v1(uuid)','EXECUTE'),'service API cannot call worker helper');
select ok(has_function_privilege('service_role','public.manage_withdrawal_roster_release_scheduler_v1(text)','EXECUTE'),'scheduler manager is service only');
select ok(not has_function_privilege('authenticated','public.manage_withdrawal_roster_release_scheduler_v1(text)','EXECUTE'),'browser cannot manage scheduler');
select throws_ok($$select dashboard_private.process_due_withdrawal_roster_releases_v1(0)$$,'22023','withdrawal_release_batch_invalid','invalid batch has exact domain SQLSTATE');
select throws_ok($$select public.manage_withdrawal_roster_release_scheduler_v1('invalid')$$,'22023','withdrawal_release_scheduler_action_invalid','invalid manager action has exact SQLSTATE');

select pg_temp.withdrawal_case('early',(clock_timestamp() at time zone 'Asia/Seoul')::date+2);
select pg_temp.withdrawal_case('today',(clock_timestamp() at time zone 'Asia/Seoul')::date);
select pg_temp.withdrawal_case('late',(clock_timestamp() at time zone 'Asia/Seoul')::date-1);
select pg_temp.withdrawal_case('missing',null);
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'23514','withdrawal_last_lesson_date_required','missing last lesson has domain SQLSTATE') from withdrawal_cases where label='missing';
select public.manage_withdrawal_roster_release_scheduler_v1('remove');
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'55000','withdrawal_release_scheduler_not_ready','completion requires verified scheduler readiness') from withdrawal_cases where label='early';
select is((select count(*) from dashboard_private.withdrawal_roster_release_queue_v1),0::bigint,'blocked scheduling writes no queue');
select public.manage_withdrawal_roster_release_scheduler_v1('install');
select ok(dashboard_private.withdrawal_roster_release_scheduler_ready_v1(),'explicit local scheduler install satisfies metadata readiness');
update withdrawal_cases set response=public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id) where label in('early','today','late');
select is(response->>'rosterReleaseScheduled','true',label||' completion reserves removal') from withdrawal_cases where label in('early','today');
select is(response->>'lastLessonDate',last_date::text,label||' receipt keeps fixed last lesson') from withdrawal_cases where label in('early','today');
select is(s.status,'재원',c.label||' retains student status through KST D') from withdrawal_cases c join public.students s on s.id=c.student_id where label in('early','today');
select ok(s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text,c.label||' keeps reciprocal enrolled arrays') from withdrawal_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label in('early','today');
select is(q.last_lesson_date,c.last_date,c.label||' queue captures original date') from withdrawal_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label in('early','today');
select is(t.status,'done',c.label||' task completion is recorded') from withdrawal_cases c join public.ops_tasks t on t.id=c.task_id where label in('early','today');
select ok(d.timetable_roster_updated,c.label||' roster checklist is recorded') from withdrawal_cases c join public.ops_withdrawal_details d on d.task_id=c.task_id where label in('early','today');
select is(public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id),response,label||' exact retry returns same receipt') from withdrawal_cases where label in('early','today','late');
select is((select count(*) from dashboard_private.withdrawal_roster_release_queue_v1),2::bigint,'receipt retry creates no additional queue');
select is(s.status,'퇴원','past date completion removes final enrollment immediately') from withdrawal_cases c join public.students s on s.id=c.student_id where label='late';
select ok(not(s.class_ids?c.class_id::text) and not(cl.student_ids?c.student_id::text),'past date removes both reciprocal arrays') from withdrawal_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label='late';
select is(dashboard_private.apply_scheduled_withdrawal_roster_release_v1(task_id),'not_due',label||' worker does not release on or before KST D') from withdrawal_cases where label in('early','today');
select throws_ok(format('update dashboard_private.withdrawal_roster_release_queue_v1 set last_lesson_date=last_lesson_date+1 where task_id=%L',task_id),'23514','withdrawal_release_snapshot_immutable','immutable cutoff cannot drift') from withdrawal_cases where label='early';
select throws_ok(format('delete from dashboard_private.withdrawal_roster_release_queue_v1 where task_id=%L',task_id),'23514','withdrawal_release_snapshot_immutable','reservation cannot be deleted') from withdrawal_cases where label='early';

-- A second task for the same still-current generation must not reserve twice.
insert into public.ops_tasks(id,type,status,title,student_id,class_id,requested_by,subject)
select 'a0600000-0000-4000-8000-000000000020','withdrawal','requested','중복 합성 요청',student_id,class_id,'a0600000-0000-4000-8000-000000000001','영어' from withdrawal_cases where label='early';
insert into public.ops_withdrawal_details(task_id,withdrawal_date,withdrawal_session,makeedu_withdrawal_done,fee_processed,textbook_fee_processed)
values('a0600000-0000-4000-8000-000000000020',(clock_timestamp() at time zone 'Asia/Seoul')::date+3,'3회차',true,true,true);
select throws_ok($$select public.complete_ops_withdrawal_roster_transition_v3('a0600000-0000-4000-8000-000000000020',gen_random_uuid())$$,'23514','withdrawal_release_already_scheduled','same pair/generation duplicate has domain SQLSTATE');
select throws_ok(format('update public.ops_tasks set status=''requested'' where id=%L',task_id),'P0001','완료된 운영 업무는 관리 데이터가 반영되어 상태만 되돌릴 수 없습니다.','completed withdrawal keeps existing reopen guard') from withdrawal_cases where label='today';

-- Due reservations use historical synthetic dates; no production clock or
-- immutable queue snapshot is changed to simulate D+1.
select pg_temp.withdrawal_case('due',(clock_timestamp() at time zone 'Asia/Seoul')::date-1);
select set_config('app.ops_transition_completion_authorized','true',true);
update public.ops_tasks set status='done',completed_at=now() where id=(select task_id from withdrawal_cases where label='due');
select set_config('app.ops_transition_completion_authorized','false',true);
insert into dashboard_private.withdrawal_roster_release_queue_v1(task_id,student_id,class_id,expected_history_count,last_lesson_date,actor_id)
select task_id,student_id,class_id,(select count(*) from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.class_id),last_date,'a0600000-0000-4000-8000-000000000001' from withdrawal_cases c where label='due';
create temp table withdrawal_notification_counts as select (select count(*) from dashboard_private.notification_events) events,(select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,(select count(*) from dashboard_private.notification_deliveries) deliveries,(select count(*) from public.ops_task_events where event_type like 'withdrawal.%' or event_type like 'registration.%') sources;
select set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
select is(dashboard_private.apply_scheduled_withdrawal_roster_release_v1(task_id),'applied','D+1 worker releases without user JWT') from withdrawal_cases where label='due';
select is(q.status,'applied','due queue becomes terminal applied') from withdrawal_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label='due';
select is(s.status,'퇴원','due final enrollment updates student status') from withdrawal_cases c join public.students s on s.id=c.student_id where label='due';
select ok(not(s.class_ids?c.class_id::text) and not(cl.student_ids?c.student_id::text),'worker removes reciprocal arrays') from withdrawal_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label='due';
select is(dashboard_private.apply_scheduled_withdrawal_roster_release_v1(task_id),'unchanged','worker exact retry is no-op') from withdrawal_cases where label='due';
select is((select count(*) from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.class_id),1::bigint,'worker writes one physical roster history') from withdrawal_cases c where label='due';
select is((select count(*) from dashboard_private.notification_events),events,'worker adds no canonical notification') from withdrawal_notification_counts;
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),jobs,'worker adds no fanout job') from withdrawal_notification_counts;
select is((select count(*) from dashboard_private.notification_deliveries),deliveries,'worker adds no delivery') from withdrawal_notification_counts;
select is((select count(*) from public.ops_task_events where event_type like 'withdrawal.%' or event_type like 'registration.%'),sources,'worker adds no source notification event') from withdrawal_notification_counts;
select throws_ok(format('update dashboard_private.withdrawal_roster_release_queue_v1 set status=''pending'',applied_at=null,resolved_at=null where task_id=%L',task_id),'23514','withdrawal_release_snapshot_immutable','applied reservation cannot reopen') from withdrawal_cases where label='due';

-- Restore the active synthetic manager for independent read and write cases.
select set_config('request.jwt.claims','{"sub":"a0600000-0000-4000-8000-000000000001","role":"authenticated"}',true),set_config('request.jwt.claim.sub','a0600000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
select ok(has_function_privilege('authenticated','dashboard_private.withdrawal_roster_cutoff_v1(uuid,uuid)','EXECUTE'),'authenticated readers can access only scalar cutoff');
select ok(not has_function_privilege('anon','dashboard_private.withdrawal_roster_cutoff_v1(uuid,uuid)','EXECUTE'),'anonymous readers cannot call cutoff');
select ok(not has_function_privilege('service_role','dashboard_private.withdrawal_current_roster_cutoffs_v1()','EXECUTE'),'service readers cannot call cutoff DTO helper');
select is(dashboard_private.withdrawal_roster_cutoff_v1(student_id,class_id),last_date,label||' current generation has immutable cutoff') from withdrawal_cases where label in('early','today');
select ok(dashboard_private.withdrawal_roster_includes_date_v1(student_id,class_id,last_date),'last lesson date remains included') from withdrawal_cases where label='today';
select ok(not dashboard_private.withdrawal_roster_includes_date_v1(student_id,class_id,last_date+1),'next lesson date is excluded') from withdrawal_cases where label='today';
set local timezone='Pacific/Honolulu';
select is(dashboard_private.apply_scheduled_withdrawal_roster_release_v1(task_id),'not_due','session timezone cannot release KST D early') from withdrawal_cases where label='today';
set local timezone='Pacific/Kiritimati';
select is(dashboard_private.apply_scheduled_withdrawal_roster_release_v1(task_id),'not_due','UTC+14 session still respects KST D') from withdrawal_cases where label='today';
set local timezone='UTC';
select is(dashboard_private.withdrawal_roster_cutoff_v1(student_id,class_id),null::date,'terminal queue exposes no cutoff') from withdrawal_cases where label='due';
select set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
select throws_ok($$select dashboard_private.withdrawal_roster_cutoff_v1(gen_random_uuid(),gen_random_uuid())$$,'42501','withdrawal_roster_read_forbidden','null auth fails with exact SQLSTATE');
select throws_ok($$select * from dashboard_private.withdrawal_current_roster_cutoffs_v1()$$,'42501','withdrawal_roster_read_forbidden','null auth DTO helper fails with exact SQLSTATE');
select set_config('request.jwt.claims','{"sub":"a0600000-0000-4000-8000-000000000001","role":"authenticated"}',true),set_config('request.jwt.claim.sub','a0600000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);

-- Current generation changes only through real roster helper history. An old
-- cutoff must neither hide nor later remove the restored relationship.
select dashboard_private.apply_student_class_roster_mode(student_id,class_id,'removed','enrolled',null,'synthetic_manual_remove','a0600000-0000-4000-8000-000000000001') from withdrawal_cases where label='early';
select dashboard_private.apply_student_class_roster_mode(student_id,class_id,'enrolled','removed',null,'synthetic_manual_restore','a0600000-0000-4000-8000-000000000001') from withdrawal_cases where label='early';
select is(dashboard_private.withdrawal_roster_cutoff_v1(student_id,class_id),null::date,'manual remove/restore invalidates old cutoff generation') from withdrawal_cases where label='early';
select is((select count(*) from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.class_id),2::bigint,'manual remove and restore produce real generation history') from withdrawal_cases c where label='early';
select lives_ok($$select public.complete_ops_withdrawal_roster_transition_v3('a0600000-0000-4000-8000-000000000020',gen_random_uuid())$$,'new generation may reserve while old pending becomes superseded');
select is(q.status,'superseded','old generation becomes superseded') from withdrawal_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label='early';
select is(q.last_lesson_date,c.last_date,'superseded snapshot cutoff is still immutable') from withdrawal_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label='early';
select is(dashboard_private.withdrawal_roster_cutoff_v1(student_id,class_id),(clock_timestamp() at time zone 'Asia/Seoul')::date+3,'new generation owns its own cutoff') from withdrawal_cases where label='early';

select pg_temp.withdrawal_case('canceled',(clock_timestamp() at time zone 'Asia/Seoul')::date+1);
update public.ops_tasks set status='canceled' where id=(select task_id from withdrawal_cases where label='canceled');
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'40001','ops_withdrawal_completion_state_conflict','existing canceled-state guard remains exact') from withdrawal_cases where label='canceled';
update public.ops_tasks set status='requested' where id=(select task_id from withdrawal_cases where label='canceled');
select lives_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'canceled then reopened requested task may complete') from withdrawal_cases where label='canceled';

-- A claimed enrollment retains canonical ownership until the due worker runs.
create temp table withdrawal_claims(label text primary key,parent_id uuid,track_id uuid,batch_id uuid,claim_id uuid);
create function pg_temp.withdrawal_claim(p_label text) returns void language plpgsql as $$
declare c withdrawal_cases%rowtype;v_parent uuid:=gen_random_uuid();v_track uuid:=gen_random_uuid();v_batch uuid:=gen_random_uuid();v_claim uuid:=gen_random_uuid();
begin
 select * into strict c from withdrawal_cases where label=p_label;
 insert into public.ops_tasks(id,type,status,title,requested_by) values(v_parent,'registration','requested','합성 등록 부모','a0600000-0000-4000-8000-000000000001');
 insert into public.ops_registration_details(task_id) values(v_parent);
 insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status) values(v_track,v_parent,'영어','registered','registered');
 insert into public.ops_registration_admission_batches(id,task_id,status,revision_number) values(v_batch,v_parent,'completed',1);
 insert into public.ops_registration_enrollments(id,track_id,class_id,student_id,status,roster_active,admission_batch_id,class_start_date,class_start_session_key,class_start_session)
 values(v_claim,v_track,c.class_id,c.student_id,'enrolled',true,v_batch,c.last_date-10,(c.last_date-10)::text||':1','1회차');
 perform dashboard_private.recompute_registration_parent(v_parent);
 insert into withdrawal_claims values(p_label,v_parent,v_track,v_batch,v_claim);
end;$$;
select pg_temp.withdrawal_case('claimed',(clock_timestamp() at time zone 'Asia/Seoul')::date);
select pg_temp.withdrawal_claim('claimed');
update withdrawal_cases set response=public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id) where label='claimed';
select ok(e.roster_active and e.status='enrolled','completion preserves active canonical claim') from withdrawal_claims c join public.ops_registration_enrollments e on e.id=c.claim_id where c.label='claimed';
select is(q.expected_claim_id,c.claim_id,'reservation captures exact claim owner') from withdrawal_claims c join withdrawal_cases t using(label) join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=t.task_id where c.label='claimed';
select is(q.claim_source_task_id,t.task_id,'claimed queue fences deletion of source task') from withdrawal_claims c join withdrawal_cases t using(label) join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=t.task_id where c.label='claimed';
select is(dashboard_private.withdrawal_roster_cutoff_v1(t.student_id,t.class_id),t.last_date,'exact claimed generation exposes cutoff') from withdrawal_cases t where label='claimed';
select throws_ok(format('delete from public.ops_tasks where id=%L',task_id),'23503',null,'claimed source task deletion is fenced by foreign key') from withdrawal_cases where label='claimed';

select pg_temp.withdrawal_case('due_claimed',(clock_timestamp() at time zone 'Asia/Seoul')::date-1);
select pg_temp.withdrawal_claim('due_claimed');
select set_config('app.ops_transition_completion_authorized','true',true);
update public.ops_tasks set status='done',completed_at=now() where id=(select task_id from withdrawal_cases where label='due_claimed');
select set_config('app.ops_transition_completion_authorized','false',true);
insert into dashboard_private.withdrawal_roster_release_queue_v1(task_id,claim_source_task_id,student_id,class_id,expected_claim_id,expected_history_count,last_lesson_date,actor_id)
select t.task_id,t.task_id,t.student_id,t.class_id,c.claim_id,(select count(*) from public.student_class_enrollment_history h where h.student_id=t.student_id and h.class_id=t.class_id),t.last_date,'a0600000-0000-4000-8000-000000000001' from withdrawal_cases t join withdrawal_claims c using(label) where label='due_claimed';
truncate withdrawal_notification_counts;
insert into withdrawal_notification_counts select (select count(*) from dashboard_private.notification_events),(select count(*) from dashboard_private.notification_event_fanout_jobs),(select count(*) from dashboard_private.notification_deliveries),(select count(*) from public.ops_task_events where event_type like 'withdrawal.%' or event_type like 'registration.%');
select set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
select is(dashboard_private.apply_scheduled_withdrawal_roster_release_v1(task_id),'applied','claimed due worker succeeds without JWT') from withdrawal_cases where label='due_claimed';
select ok(not e.roster_active and e.status='enrolled' and e.roster_release_kind='withdrawal' and e.roster_release_source_task_id=t.task_id,'worker releases exact claim preserving canonical enrollment history') from withdrawal_claims c join withdrawal_cases t using(label) join public.ops_registration_enrollments e on e.id=c.claim_id where label='due_claimed';
select is((select count(*) from public.ops_task_events e where e.task_id=c.parent_id and e.event_type='registration_track_event' and e.after_value::jsonb->>'event_type'='registration_enrollment_roster_released' and e.after_value::jsonb->>'actor_kind'='system'),1::bigint,'claimed worker writes one v2 system audit event') from withdrawal_claims c where label='due_claimed';
select is((select count(*) from dashboard_private.notification_events),events,'claimed worker adds no canonical notification') from withdrawal_notification_counts;
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),jobs,'claimed worker adds no fanout job') from withdrawal_notification_counts;
select is((select count(*) from dashboard_private.notification_deliveries),deliveries,'claimed worker adds no delivery') from withdrawal_notification_counts;
select is((select count(*) from public.ops_task_events where event_type like 'withdrawal.%' or event_type like 'registration.%'),sources,'claimed worker adds no source notification event') from withdrawal_notification_counts;

select set_config('request.jwt.claims','{"sub":"a0600000-0000-4000-8000-000000000001","role":"authenticated"}',true),set_config('request.jwt.claim.sub','a0600000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
-- A later task with a past date cannot bypass an existing future reservation.
insert into public.ops_tasks(id,type,status,title,student_id,class_id,requested_by,subject)
select 'a0600000-0000-4000-8000-000000000021','withdrawal','requested','지난 날짜 중복 합성 요청',student_id,class_id,'a0600000-0000-4000-8000-000000000001','영어' from withdrawal_cases where label='today';
insert into public.ops_withdrawal_details(task_id,withdrawal_date,withdrawal_session,makeedu_withdrawal_done,fee_processed,textbook_fee_processed)
values('a0600000-0000-4000-8000-000000000021',(clock_timestamp() at time zone 'Asia/Seoul')::date-1,'3회차',true,true,true);
select throws_ok($$select public.complete_ops_withdrawal_roster_transition_v3('a0600000-0000-4000-8000-000000000021',gen_random_uuid())$$,'23514','withdrawal_release_already_scheduled','past-date second task cannot bypass pending current generation');
select ok(s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text and s.status='재원','past-date duplicate leaves current roster and status unchanged') from withdrawal_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label='today';
select is(public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id),response,'original receipt still replays after duplicate rejection') from withdrawal_cases where label='today';

create function pg_temp.withdrawal_due_reservation(p_label text) returns void language plpgsql as $$
declare c withdrawal_cases%rowtype;v_claim uuid;
begin
 select * into strict c from withdrawal_cases where label=p_label;
 select claim_id into v_claim from withdrawal_claims where label=p_label;
 perform set_config('app.ops_transition_completion_authorized','true',true);
 update public.ops_tasks set status='done',completed_at=now() where id=c.task_id;
 perform set_config('app.ops_transition_completion_authorized','false',true);
 insert into dashboard_private.withdrawal_roster_release_queue_v1(task_id,claim_source_task_id,student_id,class_id,expected_claim_id,expected_history_count,last_lesson_date,actor_id)
 select c.task_id,case when v_claim is not null then c.task_id end,c.student_id,c.class_id,v_claim,count(*),c.last_date,'a0600000-0000-4000-8000-000000000001' from public.student_class_enrollment_history h where h.student_id=c.student_id and h.class_id=c.class_id;
end;$$;
select pg_temp.withdrawal_case('multi',(clock_timestamp() at time zone 'Asia/Seoul')::date-1);
create temp table withdrawal_other_classes(enrolled uuid,waitlisted uuid);
insert into withdrawal_other_classes values(gen_random_uuid(),gen_random_uuid());
insert into public.classes(id,name,status,subject,student_ids,waitlist_ids)
select o.enrolled,'다른 합성 수업','진행중','수학',jsonb_build_array(c.student_id),'[]' from withdrawal_other_classes o cross join withdrawal_cases c where label='multi';
insert into public.classes(id,name,status,subject,student_ids,waitlist_ids)
select o.waitlisted,'합성 대기 수업','진행중','영어','[]',jsonb_build_array(c.student_id) from withdrawal_other_classes o cross join withdrawal_cases c where label='multi';
update public.students set class_ids=class_ids||jsonb_build_array(o.enrolled),waitlist_class_ids=jsonb_build_array(o.waitlisted) from withdrawal_other_classes o where id=(select student_id from withdrawal_cases where label='multi');
select pg_temp.withdrawal_due_reservation('multi');
select is(dashboard_private.apply_scheduled_withdrawal_roster_release_v1(task_id),'applied','one class releases while other enrolled/waitlisted classes remain') from withdrawal_cases where label='multi';
select ok(s.status='재원' and s.class_ids?o.enrolled::text and s.waitlist_class_ids?o.waitlisted::text,'remaining enrolled and waitlist projections keep student active') from withdrawal_cases c join public.students s on s.id=c.student_id cross join withdrawal_other_classes o where label='multi';
select ok(cl.student_ids?c.student_id::text and wl.waitlist_ids?c.student_id::text,'other classes keep reciprocal enrolled/waitlist projections') from withdrawal_cases c cross join withdrawal_other_classes o join public.classes cl on cl.id=o.enrolled join public.classes wl on wl.id=o.waitlisted where label='multi';

select pg_temp.withdrawal_case('stale_due',(clock_timestamp() at time zone 'Asia/Seoul')::date-1);
select pg_temp.withdrawal_due_reservation('stale_due');
select dashboard_private.apply_student_class_roster_mode(student_id,class_id,'removed','enrolled',null,'synthetic_manual_remove','a0600000-0000-4000-8000-000000000001') from withdrawal_cases where label='stale_due';
select dashboard_private.apply_student_class_roster_mode(student_id,class_id,'enrolled','removed',null,'synthetic_manual_restore','a0600000-0000-4000-8000-000000000001') from withdrawal_cases where label='stale_due';
select is(dashboard_private.apply_scheduled_withdrawal_roster_release_v1(task_id),'superseded','due old generation never removes manual restoration') from withdrawal_cases where label='stale_due';
select ok(s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text,'superseded due reservation preserves restored reciprocal roster') from withdrawal_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label='stale_due';

select pg_temp.withdrawal_case('status_failure',(clock_timestamp() at time zone 'Asia/Seoul')::date-1);
select pg_temp.withdrawal_due_reservation('status_failure');
update public.students set status='퇴원' where id=(select student_id from withdrawal_cases where label='status_failure');
select throws_ok(format('select dashboard_private.apply_scheduled_withdrawal_roster_release_v1(%L)',task_id),'23514','withdrawal_release_student_status_conflict','worker status conflict has exact domain SQLSTATE') from withdrawal_cases where label='status_failure';
select is(dashboard_private.process_due_withdrawal_roster_releases_v1(100)->>'failed','1','batch records failing due reservation without aborting');
select ok(q.status='pending' and q.attempt_count=1 and q.last_error_code='23514' and q.next_attempt_at>now(),'worker failure remains pending with bounded retry evidence') from withdrawal_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label='status_failure';
select ok(s.class_ids?c.class_id::text and cl.student_ids?c.student_id::text,'failed worker applies no partial physical removal') from withdrawal_cases c join public.students s on s.id=c.student_id join public.classes cl on cl.id=c.class_id where label='status_failure';

select set_config('request.jwt.claims','{"sub":"a0600000-0000-4000-8000-000000000001","role":"authenticated"}',true),set_config('request.jwt.claim.sub','a0600000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
insert into public.academic_schools(id,name,category) values('a0600000-0000-4000-8000-000000000031','합성 경계 학교','고등학교');
update public.students set school='합성 경계 학교',grade='고1' where id=(select student_id from withdrawal_cases where label='today');
update public.classes set schedule_plan=jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('date',c.last_date,'state','active'),jsonb_build_object('date',c.last_date+1,'state','active'))) from withdrawal_cases c where public.classes.id=c.class_id and c.label='today';
insert into public.academic_exam_days(id,school_id,grade,subject,exam_date)
select gen_random_uuid(),'a0600000-0000-4000-8000-000000000031','고1','영어',c.last_date+d from withdrawal_cases c cross join generate_series(0,1) d where label='today';
grant select on withdrawal_cases,withdrawal_claims to authenticated;
set local role authenticated;
select is(jsonb_array_length(public.get_dashboard_statistics_sources_v1('schedule_conflicts',null,null,(statement_timestamp() at time zone 'Asia/Seoul')::date,(statement_timestamp() at time zone 'Asia/Seoul')::date+90)->'examConflicts'),1,'actual authenticated statistics includes only last lesson exam conflict');
select is(public.get_dashboard_statistics_sources_v1('schedule_conflicts',null,null,(statement_timestamp() at time zone 'Asia/Seoul')::date,(statement_timestamp() at time zone 'Asia/Seoul')::date+90)#>>'{examConflicts,0,source,examDate}',(select last_date::text from withdrawal_cases where label='today'),'actual statistics conflict date is D');
select ok(exists(select 1 from jsonb_array_elements(public.get_dashboard_conflict_sources_v1((statement_timestamp() at time zone 'Asia/Seoul')::date,(statement_timestamp() at time zone 'Asia/Seoul')::date+90)->'withdrawalRosterCutoffs') pair where pair->>'studentId'=(select student_id::text from withdrawal_cases where label='today') and pair->>'classId'=(select class_id::text from withdrawal_cases where label='today') and pair->>'lastLessonDate'=(select last_date::text from withdrawal_cases where label='today')),'actual authenticated home RPC supplies visible nonempty cutoff DTO');
select ok(not exists(select 1 from jsonb_array_elements(public.get_dashboard_conflict_sources_v1((statement_timestamp() at time zone 'Asia/Seoul')::date,(statement_timestamp() at time zone 'Asia/Seoul')::date+90)->'withdrawalRosterCutoffs') pair where pair - array['studentId','classId','lastLessonDate']::text[] <> '{}'::jsonb),'home DTO contains only three allowed fields');
select throws_ok($$select dashboard_private.process_due_withdrawal_roster_releases_v1(100)$$,'42501',null,'actual browser role cannot execute worker');
select throws_ok($$select public.manage_withdrawal_roster_release_scheduler_v1('install')$$,'42501',null,'actual browser role cannot install scheduler');
reset role;
select throws_ok(format('update dashboard_private.withdrawal_roster_release_queue_v1 set claim_source_task_id=null where task_id=%L',task_id),'23514','withdrawal_release_snapshot_immutable','pending claimed FK cannot be cleared independently') from withdrawal_cases where label='claimed';
select is(q.claim_source_task_id,null::uuid,'applied queue clears only temporary source deletion fence') from withdrawal_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label='due_claimed';
select throws_ok(format('delete from public.ops_tasks where id=%L',task_id),'23503',null,'actual applied claim history still fences its source task deletion') from withdrawal_cases where label='due_claimed';

-- Active-account authorization is unchanged even though release later uses the
-- stored actor only for audit attribution.
select set_config('request.jwt.claims','{"sub":"a0600000-0000-4000-8000-000000000001","role":"authenticated"}',true),set_config('request.jwt.claim.sub','a0600000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
update auth.users set banned_until=now()+interval '1 day' where id='a0600000-0000-4000-8000-000000000001';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'42501','registration_access_denied','banned manager cannot complete') from withdrawal_cases where label='missing';
update auth.users set banned_until=null,deleted_at=now() where id='a0600000-0000-4000-8000-000000000001';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'42501','registration_access_denied','deleted manager cannot complete') from withdrawal_cases where label='missing';
update auth.users set deleted_at=null where id='a0600000-0000-4000-8000-000000000001';
update public.profiles set role='teacher' where id='a0600000-0000-4000-8000-000000000001';
select throws_ok(format('select public.complete_ops_withdrawal_roster_transition_v3(%L,%L)',task_id,request_id),'42501','registration_access_denied','nonmanager cannot complete') from withdrawal_cases where label='missing';
update public.profiles set role='staff' where id='a0600000-0000-4000-8000-000000000001';
select is(public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id),response,'active staff can replay its exact receipt') from withdrawal_cases where label='today';
update public.profiles set role='admin' where id='a0600000-0000-4000-8000-000000000001';
select public.manage_withdrawal_roster_release_scheduler_v1('disable');
select ok(not dashboard_private.withdrawal_roster_release_scheduler_ready_v1(),'disabled scheduler is not ready');
select public.manage_withdrawal_roster_release_scheduler_v1('install');
select ok(dashboard_private.withdrawal_roster_release_scheduler_ready_v1(),'exact disabled scheduler can be enabled explicitly');
update cron.job set command='select 1;' where jobname='tips-withdrawal-roster-release-v1';
select throws_ok($$select public.manage_withdrawal_roster_release_scheduler_v1('install')$$,'55000','withdrawal_release_scheduler_drift','scheduler drift has exact configuration SQLSTATE');
select ok(not dashboard_private.withdrawal_roster_release_scheduler_ready_v1(),'drifted scheduler blocks readiness');
update cron.job set command='set statement_timeout = ''30s''; select dashboard_private.process_due_withdrawal_roster_releases_v1();' where jobname='tips-withdrawal-roster-release-v1';
select ok(dashboard_private.withdrawal_roster_release_scheduler_ready_v1(),'bounded pure SQL command matches final readiness contract');
select ok((select count(*)=1 from cron.job where jobname='tips-withdrawal-roster-release-v1' and schedule='* * * * *' and command='set statement_timeout = ''30s''; select dashboard_private.process_due_withdrawal_roster_releases_v1();'),'scheduler contains one bounded database-only command');
select ok(pg_get_functiondef('public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::regprocedure) like '%withdrawal_cutoffs as materialized%' and pg_get_functiondef('public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::regprocedure) not like '%withdrawal_roster_includes_date_v1%','final statistics materializes bounded candidate set once');

-- A restored generation owns a new task even if that new task is already late.
-- The old claimed reservation becomes historical and releases only its temporary
-- source-task fence; no canonical claim history is retargeted.
select dashboard_private.apply_student_class_roster_mode(t.student_id,t.class_id,'removed','enrolled',c.claim_id,'synthetic_manual_remove','a0600000-0000-4000-8000-000000000001') from withdrawal_cases t join withdrawal_claims c using(label) where label='claimed';
update public.ops_registration_enrollments set status='canceled',roster_active=false where id=(select claim_id from withdrawal_claims where label='claimed');
select dashboard_private.apply_student_class_roster_mode(student_id,class_id,'enrolled','removed',null,'synthetic_manual_restore','a0600000-0000-4000-8000-000000000001') from withdrawal_cases where label='claimed';
select is(dashboard_private.withdrawal_roster_cutoff_v1(student_id,class_id),null::date,'changed claim owner/generation exposes no old cutoff') from withdrawal_cases where label='claimed';
insert into public.ops_tasks(id,type,status,title,student_id,class_id,requested_by,subject)
select 'a0600000-0000-4000-8000-000000000022','withdrawal','requested','새 세대 지난 날짜 합성 요청',student_id,class_id,'a0600000-0000-4000-8000-000000000001','영어' from withdrawal_cases where label='claimed';
insert into public.ops_withdrawal_details(task_id,withdrawal_date,withdrawal_session,makeedu_withdrawal_done,fee_processed,textbook_fee_processed)
values('a0600000-0000-4000-8000-000000000022',(clock_timestamp() at time zone 'Asia/Seoul')::date-1,'3회차',true,true,true);
select lives_ok($$select public.complete_ops_withdrawal_roster_transition_v3('a0600000-0000-4000-8000-000000000022',gen_random_uuid())$$,'restored new generation with past cutoff may complete immediately');
select ok(q.status='superseded' and q.claim_source_task_id is null,'superseded claimed reservation clears temporary source fence') from withdrawal_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label='claimed';
select is(s.status,'퇴원','new past-date generation removes final live roster immediately') from withdrawal_cases c join public.students s on s.id=c.student_id where label='claimed';
select is(public.complete_ops_withdrawal_roster_transition_v3(task_id,request_id),response,'old receipt is stable after new generation completion') from withdrawal_cases where label='claimed';
select throws_ok(format('update dashboard_private.withdrawal_roster_release_queue_v1 set expected_claim_id=null where task_id=%L',task_id),'23514','withdrawal_release_snapshot_immutable','superseded claimed snapshot cannot be retargeted') from withdrawal_cases where label='claimed';
select lives_ok(format('delete from public.ops_tasks where id=%L',task_id),'superseded source task may delete when no canonical claim references it') from withdrawal_cases where label='claimed';
select is(q.status,'superseded','historical queue remains after deleting superseded source task') from withdrawal_cases c join dashboard_private.withdrawal_roster_release_queue_v1 q on q.task_id=c.task_id where label='claimed';

select ok(strpos(pg_get_functiondef('dashboard_private.apply_student_class_roster_mode(uuid,uuid,text,text,uuid,text,uuid)'::regprocedure),'using errcode = ''40001''')=0,'actual final roster helper has ordered domain SQLSTATE patch');
select throws_ok(format('select dashboard_private.apply_student_class_roster_mode(%L,%L,''removed'',''waitlist'',null,''synthetic_wrong_expected_mode'',null)',student_id,class_id),'23514','registration_roster_mode_conflict','actual final helper expected-mode conflict has exact domain SQLSTATE') from withdrawal_cases where label='today';

select * from finish();
rollback;
