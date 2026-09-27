begin;
select no_plan();
set local statement_timeout='30s';

select ok(not p.prosecdef and p.provolatile='s','workload source preserves RLS and is stable') from pg_proc p where p.oid='dashboard_private.dashboard_workload_items_v1()'::regprocedure;
select ok(not has_function_privilege('anon','public.get_dashboard_workload_v1()','execute'),'anon cannot read aggregate');
select ok(not has_function_privilege('anon','public.list_dashboard_workload_page_v1(text,text,text,text,boolean,integer,integer)','execute'),'anon cannot read detail');

-- Synthetic read fixtures only: no notification or business mutation producers.
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('98000000-0000-4000-8000-000000000001','workload-admin@runtime.invalid'),
 ('98000000-0000-4000-8000-000000000002','workload-a@runtime.invalid'),
 ('98000000-0000-4000-8000-000000000003','workload-b@runtime.invalid'),
 ('98000000-0000-4000-8000-000000000004','workload-hidden@runtime.invalid');
insert into public.profiles(id,name,role) values
 ('98000000-0000-4000-8000-000000000001','합성 관리자','admin'),
 ('98000000-0000-4000-8000-000000000002','같은 이름','teacher'),
 ('98000000-0000-4000-8000-000000000003','같은 이름','teacher'),
 ('98000000-0000-4000-8000-000000000004','다른 선생님','teacher');
insert into public.ops_tasks(id,title,type,status,assignee_id,requested_by,assignee_team,requested_team,created_at,updated_at)
select ('98010000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'workload-'||i,'transfer',
 case when i=13 then 'done' when i=1 then 'review_requested' else 'requested' end,
 '98000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000003','영어팀','영어팀',now()-interval '10 days',now()
from generate_series(1,13) i;
insert into public.ops_tasks(id,title,type,status,created_at) values
 ('98010000-0000-4000-8000-000000000100','workload-registration','registration','in_progress',now()-interval '20 days');
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,director_profile_id,director_assignment_source,director_assigned_at,workflow_status_entered_at,created_at,archived_at,archived_by)
values
 ('98020000-0000-4000-8000-000000000001','98010000-0000-4000-8000-000000000100','영어','consultation_waiting','consultation_completed','98000000-0000-4000-8000-000000000002','manual',now(),now()-interval '1 day',now()-interval '20 days',null,null),
 ('98020000-0000-4000-8000-000000000002','98010000-0000-4000-8000-000000000100','수학','enrollment_decided','enrollment_requested','98000000-0000-4000-8000-000000000002','manual',now(),now()-interval '9 days',now()-interval '20 days',null,null),
 ('98020000-0000-4000-8000-000000000003','98010000-0000-4000-8000-000000000100','과학','inquiry','inquiry',null,null,null,now(),now(),now(),'98000000-0000-4000-8000-000000000001');
insert into public.makeup_requests(id,status,subject,approval_group,requester_id,approver_profile_id,class_name,request_kind,cancel_date,created_at)
values
 ('98030000-0000-4000-8000-000000000001','approval_pending','영어','english','98000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000003','workload-makeup','cancel_only',current_date,now()-interval '10 days'),
 ('98030000-0000-4000-8000-000000000002','refund_pending','수학','math_high','98000000-0000-4000-8000-000000000002',null,'workload-refund','cancel_only',current_date,now()-interval '10 days'),
 ('98030000-0000-4000-8000-000000000003','rejected','영어','english','98000000-0000-4000-8000-000000000002',null,'workload-rejected','cancel_only',current_date,now()-interval '10 days');
insert into public.ops_task_events(task_id,event_type,field_name,after_value,created_at) values
 ('98010000-0000-4000-8000-000000000002','status_changed','status','requested',now()-interval '8 days');

insert into public.ops_task_events(task_id,event_type,field_name,after_value,created_at)
select '98010000-0000-4000-8000-000000000002','status_changed','status',case when i%2=0 then 'requested' else 'confirmed' end,now()-i*interval '1 minute' from generate_series(1,20000)i;
set local session_replication_role=origin;
analyze public.ops_task_events;
explain (analyze,buffers) select max(created_at) from public.ops_task_events where task_id='98010000-0000-4000-8000-000000000002' and field_name='status' and after_value='requested';
drop index public.ops_task_events_status_entered_idx;
explain (analyze,buffers) select max(created_at) from public.ops_task_events where task_id='98010000-0000-4000-8000-000000000002' and field_name='status' and after_value='requested';
rollback;
