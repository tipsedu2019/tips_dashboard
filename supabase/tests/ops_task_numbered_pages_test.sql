begin;
select no_plan();
set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;
create temp table no_send_initial as select (select count(*) from dashboard_private.notification_deliveries) deliveries;

-- The phone-ready source trigger requires a complete retired in-app snapshot.
-- Disabled from creation: final materializer returns before creating a delivery.
insert into dashboard_private.notification_rules(id,scope_key,workflow_key,event_key,channel_key,audience_key,rule_variant_key,delivery_mode,schedule_key,schedule_config,enabled,active_template_id,revision,created_by,created_actor_kind,updated_by,updated_actor_kind)
values('96900000-0000-4000-8000-000000000001','global','registration','registration.phone_consultation_ready','in_app','track_director','immediate','immediate',null,null,false,'96900000-0000-4000-8000-000000000002',1,null,'system',null,'system');
insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,allowed_variables,payload_schema_version,checksum,created_by,created_actor_kind)
values('96900000-0000-4000-8000-000000000002','96900000-0000-4000-8000-000000000001',1,'번호형 읽기 fixture','번호형 읽기 fixture','[]',2,'numbered-phone-disabled-fixture',null,'system');

select has_function('public', 'list_ops_task_numbered_page_v1', array['text','jsonb','integer','integer'], 'numbered RPC exists');
create function pg_temp.task_filters(p_type text, patch jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('taskType',p_type,'search','np-fixture','statuses','[]'::jsonb) ||
  case p_type
    when 'general' then '{"queue":"inbox","requestedById":null,"requestedTeam":null,"assigneeId":null,"assigneeTeam":null,"focus":"none","sort":"due"}'::jsonb
    when 'registration' then '{"view":"inquiry","consultationOwnerId":null}'::jsonb
    when 'word_retest' then '{"queue":"assistant","branch":null,"classId":null,"dateFrom":null,"dateTo":null,"includeClosed":false,"period":"all","tableSortColumn":null,"tableSortDirection":null,"teacherId":null}'::jsonb
    else '{"view":"applicant","subject":null,"teacher":null,"dateFrom":null,"dateTo":null,"period":"all","filterColumn":null,"sortColumn":null,"sortDirection":null}'::jsonb
  end || patch
$$;

-- Real auth users + profiles. No mutation RPC, worker, dispatcher, or delivery call.
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('94000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, '00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','numbered-'||n||'@example.invalid','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
from generate_series(1,3) n;
insert into public.profiles(id,role,name,email)
select ('94000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 case when n=1 then 'staff' else 'teacher' end, '번호 처리자 '||n,'numbered-'||n||'@example.invalid'
from generate_series(1,3) n on conflict(id) do update set role=excluded.role,name=excluded.name;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);

insert into public.ops_tasks(id,title,type,status,priority,requested_by,assignee_id,requested_team,assignee_team,start_at,due_at,created_at,updated_at)
select ('95000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'np-fixture tied',
 case when n%10=0 then 'textbook' else 'general' end,'requested','normal',
 '94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','신청팀','처리팀',
 current_date,current_date,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
from generate_series(1,101) n;
insert into public.ops_tasks(id,title,type,status,priority,requested_by,assignee_id,secondary_assignee_id,due_at,created_at,updated_at)
values
 ('95000000-0000-4000-8000-000000000201','np-extra review','general','review_requested','urgent','94000000-0000-4000-8000-000000000001',null,'94000000-0000-4000-8000-000000000002',null,now(),now()),
 ('95000000-0000-4000-8000-000000000202','np-extra overdue','general','requested','high','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001',null,current_date-1,now(),now()),
 ('95000000-0000-4000-8000-000000000203','np-extra done','general','requested','normal','94000000-0000-4000-8000-000000000001',null,null,null,now(),now());
update public.ops_tasks set status='done' where id='95000000-0000-4000-8000-000000000203';
-- Changing the live profile must not change stored completion attribution.
update public.profiles set name='변경된 이름' where id='94000000-0000-4000-8000-000000000001';
insert into public.ops_tasks(id,title,type,status,priority,requested_by,created_at,updated_at)
select ('95100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'np-completed','general','requested',
 case when n=1 then 'normal' when n=2 then 'urgent' else 'high' end,'94000000-0000-4000-8000-000000000001',now(),now()
from generate_series(1,3) n;
update public.ops_tasks set status='done',completed_at='2026-01-01T00:00:00Z'
where id between '95100000-0000-4000-8000-000000000001' and '95100000-0000-4000-8000-000000000003';

insert into public.ops_tasks(id,title,type,status,priority,requested_by,subject,student_name,class_name,created_at,updated_at)
select ('96000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'np-fixture registration '||n,'registration','requested','normal',
 '94000000-0000-4000-8000-000000000002','영어, 수학','번호 학생','', '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
from generate_series(1,2) n;
insert into public.ops_registration_details(task_id,parent_phone,school_name)
select id,'010-1234-5678','번호학교' from public.ops_tasks where id between '96000000-0000-4000-8000-000000000001' and '96000000-0000-4000-8000-000000000002';
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,workflow_revision)
select ('96100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('96000000-0000-4000-8000-'||lpad(((n+1)/2)::text,12,'0'))::uuid,
 case when n%2=1 then '영어' else '수학' end,'inquiry','inquiry',1
from generate_series(1,4) n;

-- Read-only stage fixtures: no enrollment/roster/appointment rows are needed.
create temp table stage_fixture(n,workflow,pipeline,waiting_kind,view_key) as values
 (1,'inquiry','inquiry',null::text,'inquiry'),
 (2,'level_test_requested','level_test_scheduled',null,'level_test'),
 (3,'consultation_requested','consultation_waiting',null,'consultation_requested'),
 (4,'consultation_completed','visit_consultation_scheduled',null,'consultation_completed'),
 (5,'waiting_current_class','waiting','current_class','waiting'),
 (6,'waiting_new_class','waiting','current_term_opening','waiting'),
 (7,'waiting_next_opening','waiting','next_term_opening','waiting'),
 (8,'observation_requested','enrollment_decided',null,'observation'),
 (9,'observation_feedback_pending','enrollment_decided',null,'observation'),
 (10,'observation_completed','enrollment_decided',null,'observation'),
 (11,'enrollment_requested','enrollment_decided',null,'enrollment'),
 (12,'payment_in_progress','enrollment_processing',null,'payment'),
 (13,'registered','registered',null,'completed'),
 (14,'not_registered','not_registered',null,'completed'),
 (15,'inquiry_only','inquiry_closed',null,'completed');
insert into public.ops_tasks(id,title,type,status,priority,requested_by,subject,created_at,updated_at)
select ('96200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'np-views '||n,'registration','requested','normal',
 '94000000-0000-4000-8000-000000000001','영어','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z' from stage_fixture;
insert into public.ops_registration_details(task_id) select ('96200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from stage_fixture;
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,workflow_revision,waiting_kind,observation_return_workflow_status,director_profile_id,director_assignment_source,director_assigned_at)
select ('96300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('96200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '영어',pipeline,workflow,1,waiting_kind,case when view_key='observation' then 'consultation_completed' end,
 '94000000-0000-4000-8000-000000000001','manual','2026-01-01T00:00:00Z' from stage_fixture;

-- A lower-ID nonmatching sibling must follow the selected Math track.
insert into public.ops_tasks(id,title,type,status,priority,subject,requested_by)
values('96400000-0000-4000-8000-000000000001','np-representative','registration','requested','normal','영어, 수학','94000000-0000-4000-8000-000000000001');
insert into public.ops_registration_details(task_id) values('96400000-0000-4000-8000-000000000001');
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,workflow_revision,director_profile_id,director_assignment_source,director_assigned_at)
values
 ('96500000-0000-4000-8000-000000000001','96400000-0000-4000-8000-000000000001','영어','inquiry','inquiry',1,null,null,null),
 ('96500000-0000-4000-8000-000000000002','96400000-0000-4000-8000-000000000001','수학','consultation_waiting','consultation_requested',1,'94000000-0000-4000-8000-000000000001','manual',now());

insert into public.ops_tasks(id,title,type,status,priority,subject,requested_by,updated_at)
select ('96600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'np-consult-order','registration','requested','normal','영어',
 '94000000-0000-4000-8000-000000000001',now()+n*interval '1 day' from generate_series(1,3) n;
insert into public.ops_registration_details(task_id)
select ('96600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,workflow_revision,director_profile_id,director_assignment_source,director_assigned_at)
select ('96700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('96600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'영어',
 case when n=3 then 'visit_consultation_scheduled' else 'consultation_waiting' end,'consultation_requested',1,
 '94000000-0000-4000-8000-000000000001','manual',now() from generate_series(1,3) n;
insert into public.ops_registration_consultations(id,track_id,mode,status,director_profile_id,ready_at,ready_source)
select ('96800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('96700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'phone','waiting','94000000-0000-4000-8000-000000000001','2026-01-01T00:00:00Z','inquiry' from generate_series(1,2) n;

insert into public.ops_tasks(id,title,type,status,priority,requested_by,student_name,class_name,subject,created_at,updated_at)
select ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'np-fixture '||kind,'withdrawal','requested','normal',
 '94000000-0000-4000-8000-000000000001','학생 '||n,'반 10',case when n=1 then '영어' else '' end,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
from (values (1,'withdrawal'),(2,'withdrawal'),(3,'withdrawal')) fixture(n,kind);
insert into public.ops_withdrawal_details(task_id,teacher_name,withdrawal_date,completed_lesson_hours,four_week_lesson_hours,makeedu_withdrawal_done,fee_processed,textbook_fee_processed)
select id,case when right(id::text,1)='1' then '교사 2' else '' end,current_date,2,8,true,false,false
from public.ops_tasks where id between '97000000-0000-4000-8000-000000000001' and '97000000-0000-4000-8000-000000000003';
update public.ops_tasks set status=case when right(id::text,1)='2' then 'in_progress' else 'canceled' end
where id in ('97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000003');
insert into public.ops_tasks(id,title,type,status,priority,requested_by,student_name,class_name,subject,created_at,updated_at)
select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'np-fixture transfer','transfer','requested','normal',
 '94000000-0000-4000-8000-000000000001','학생 '||n,'반 10','영어','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
from generate_series(1,3) n;
insert into public.ops_transfer_details(task_id,from_teacher_name,to_teacher_name,to_class_name,from_class_end_date,to_class_start_date,makeedu_transfer_done,fee_processed,textbook_fee_processed)
select id,'교사 2','교사 10',null,current_date-1,current_date,true,true,false
from public.ops_tasks where id between '98000000-0000-4000-8000-000000000001' and '98000000-0000-4000-8000-000000000003';
update public.ops_tasks set status=case when right(id::text,1)='2' then 'review_requested' else 'canceled' end
where id in ('98000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000003');
insert into public.ops_tasks(id,title,type,status,priority,requested_by,student_name,class_name,due_at,created_at,updated_at)
select ('99000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'np-fixture retest','word_retest',
 case when n=2 then 'review_requested' when n=3 then 'canceled' else 'requested' end,'normal',
 '94000000-0000-4000-8000-000000000001','학생 '||n,'반 2',current_date,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
from generate_series(1,3) n;
insert into public.ops_word_retests(task_id,branch,teacher_name,class_name,test_at,retest_status,total_question_count,cutoff_question_count,first_score)
select id,'본관',case when right(id::text,1)='1' then '교사 2' else null end,'반 2',null,
 case when right(id::text,1)='2' then 'done' else 'not_started' end,20,16,18
from public.ops_tasks where id between '99000000-0000-4000-8000-000000000001' and '99000000-0000-4000-8000-000000000003';

insert into public.ops_tasks(id,title,type,status,priority,requested_by,student_name,class_name,subject,created_at,updated_at)
select (prefix||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'np-fixture header',kind,'requested','normal',
 '94000000-0000-4000-8000-000000000001',case when n=4 then '학생 10' else '학생 2' end,'반 10','영어','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
from (values('97000000','withdrawal'),('98000000','transfer')) kinds(prefix,kind) cross join generate_series(4,5) n;
insert into public.ops_withdrawal_details(task_id,teacher_name,withdrawal_date,completed_lesson_hours,four_week_lesson_hours)
select id,'교사 2',current_date,2,8 from public.ops_tasks where id in ('97000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000005');
insert into public.ops_transfer_details(task_id,from_teacher_name,to_teacher_name,to_class_name,from_class_end_date,to_class_start_date)
select id,'교사 2','교사 10',null,current_date-1,current_date from public.ops_tasks where id in ('98000000-0000-4000-8000-000000000004','98000000-0000-4000-8000-000000000005');

create temp table no_send_before as select (select count(*) from dashboard_private.notification_deliveries) deliveries,(select count(*) from public.ops_registration_messages) messages;
grant select on no_send_before to authenticated;
set local role authenticated;
select is(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general'),11,10)->'rows'->0->>'id','95000000-0000-4000-8000-000000000101','direct page11 tied ID');
select is(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general'),11,10)-'rows','{"page":11,"pageSize":10,"totalCount":101}'::jsonb,'exact count and requested page');
select is(jsonb_array_length(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general'),11,10)->'rows'),1,'last partial page');
select is(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general'),12,10),' {"rows":[],"page":12,"pageSize":10,"totalCount":101}'::jsonb,'off-end count preserved');
select is(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general'),2147483647,20),' {"rows":[],"page":2147483647,"pageSize":20,"totalCount":101}'::jsonb,'bigint offset never overflows');
select is(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general','{"search":"np-extra"}'),1,10)->>'totalCount','2','general parity corpus has two literal inbox parents');
select is((select jsonb_agg(item->>'id') from jsonb_array_elements(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general','{"search":"np-extra"}'),1,10)->'rows') item),
 '["95000000-0000-4000-8000-000000000202","95000000-0000-4000-8000-000000000201"]'::jsonb,'overdue inbox precedes null-date review requester');
select is(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general','{"search":"np-extra","focus":"confirmation"}'),1,10)->'rows'->0->>'id','95000000-0000-4000-8000-000000000201','confirmation focus retains positive review-requester match');
select is(jsonb_array_length(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general'),1,n)->'rows'),n,'strict allowed size '||n) from (values(10),(15),(20)) s(n);
select is(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration'),1,10)->>'totalCount','2','four tracks count as two parents');
select is(jsonb_array_length(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration','{"search":"수학"}'),1,10)->'rows'->0->'registrationTracks'),2,'all authorized siblings retained');
select is(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration','{"search":"01012345678"}'),1,10)->>'totalCount','2','normalized phone search');
select is(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration',jsonb_build_object('search','np-views','view',v)),1,10)->>'totalCount',expected,'positive membership for registration view '||v)
from (values('inquiry','1'),('level_test','1'),('consultation_requested','1'),('consultation_completed','1'),('waiting','3'),('observation','3'),('enrollment','1'),('payment','1'),('completed','3')) f(v,expected);
select is(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration','{"search":"np-representative","view":"consultation_requested"}'),1,10)->'rows'->0->'registrationTracks'->0->>'id','96500000-0000-4000-8000-000000000002','matching track precedes lower-ID authorized sibling');
select is(jsonb_array_length(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration','{"search":"np-representative","view":"consultation_requested"}'),1,10)->'rows'->0->'registrationTracks'),2,'selected parent still retains nonmatching authorized sibling');
select is(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration','{"search":"np-views","view":"consultation_requested","consultationOwnerId":"94000000-0000-4000-8000-000000000003"}'),1,10)->>'totalCount','0','consultation owner filters count and page');
select is((select jsonb_agg(item->>'id') from jsonb_array_elements(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration','{"search":"np-consult-order","view":"consultation_requested"}'),1,10)->'rows') item),
 '["96600000-0000-4000-8000-000000000001","96600000-0000-4000-8000-000000000002","96600000-0000-4000-8000-000000000003"]'::jsonb,'consultation waiting priority and tied phone ready time end in ID, not recency');
select is(public.list_ops_task_numbered_page_v1('withdrawal',pg_temp.task_filters('withdrawal'),1,10)->'rows'->0->'displayValues'->>'progress','25%','withdrawal progress scalar');
select is(public.list_ops_task_numbered_page_v1('withdrawal',pg_temp.task_filters('withdrawal'),1,10)->'rows'->0->'displayValues'->>'operationsChecklist','1/3 · 수업료 처리, 교재비 처리','withdrawal checklist scalar');
select is(public.list_ops_task_numbered_page_v1('transfer',pg_temp.task_filters('transfer'),1,10)->'rows'->0->'displayValues'->>'toClassName','반 10','transfer parent class fallback');
select is((select jsonb_agg(item->>'id') from jsonb_array_elements(public.list_ops_task_numbered_page_v1('withdrawal',pg_temp.task_filters('withdrawal','{"sortColumn":"student","sortDirection":"asc"}'),1,10)->'rows') item),
 '["97000000-0000-4000-8000-000000000001","97000000-0000-4000-8000-000000000005","97000000-0000-4000-8000-000000000004"]'::jsonb,'header uses Korean numeric 1,2,10 order');
select is((select jsonb_agg(item->>'id') from jsonb_array_elements(public.list_ops_task_numbered_page_v1('transfer',pg_temp.task_filters('transfer','{"sortColumn":"fromTeacher","sortDirection":"desc"}'),1,10)->'rows') item),
 '["98000000-0000-4000-8000-000000000001","98000000-0000-4000-8000-000000000004","98000000-0000-4000-8000-000000000005"]'::jsonb,'equal header and recency scalars end in ID ASC');
select is(public.list_ops_task_numbered_page_v1('word_retest',pg_temp.task_filters('word_retest','{"queue":"teacher"}'),1,10)->'rows'->0->'displayValues'->>'status','완료: 합격','retest score status');
select is(public.list_ops_task_numbered_page_v1('word_retest',pg_temp.task_filters('word_retest','{"queue":"teacher"}'),1,10)->'rows'->0->'displayValues'->>'result','통과','retest result');
select is(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general','{"search":"np-extra done","queue":"completed"}'),1,10)->'rows'->0->>'completedByLabel','번호 처리자 1','stored actor label does not follow profile');
select is((select jsonb_agg(item->>'id') from jsonb_array_elements(public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general',jsonb_build_object('search','np-completed','queue','completed','sort',s)),1,10)->'rows') item),
 '["95100000-0000-4000-8000-000000000002","95100000-0000-4000-8000-000000000003","95100000-0000-4000-8000-000000000001"]'::jsonb,'completed-time ties still use selected/general priority keys '||s) from unnest(array['status','priority','due']) s;

-- Runtime parity against the final cursor definition, including every enum branch.
-- Small fixture filters fit the first legacy page; large general uses isolated extra rows.
create function pg_temp.parity(p_type text, p_patch jsonb) returns setof text language plpgsql as $$
declare f jsonb := pg_temp.task_filters(p_type,p_patch); numbered jsonb; legacy jsonb; total bigint;
begin
  numbered := public.list_ops_task_numbered_page_v1(p_type,f,1,20);
  select coalesce(jsonb_agg(row_data order by ord),'[]'::jsonb) into legacy
  from public.list_ops_task_page_v2(p_type,f,null,null,30) with ordinality r(id,row_data,sort_values,ord);
  select count(*) into total from dashboard_private.ops_task_page_source_v1(p_type,f);
  return next is(numbered->>'totalCount',total::text,p_type||' exact filtered total '||p_patch);
  return next is(numbered->'rows',legacy,p_type||' full DTO and order parity '||p_patch);
end $$;
select pg_temp.parity('general',jsonb_build_object('search','np-extra','queue',q,'focus',f,'sort',s))
from unnest(array['inbox','sent','completed']) q cross join unnest(array['none','today','overdue','mine','unassigned','confirmation']) f cross join unnest(array['status','priority','due']) s;
select pg_temp.parity('general',jsonb_build_object('search','np-extra',k,v))
from unnest(array['requestedById','requestedTeam','assigneeId','assigneeTeam']) k cross join unnest(array['__unassigned__','94000000-0000-4000-8000-000000000001','처리팀']) v;
select pg_temp.parity('registration',jsonb_build_object('view',v)) from unnest(array['inquiry','level_test','consultation_requested','consultation_completed','waiting','observation','enrollment','payment','completed']) v;
select pg_temp.parity('registration',jsonb_build_object('search','np-views','view',v)) from unnest(array['inquiry','level_test','consultation_requested','consultation_completed','waiting','observation','enrollment','payment','completed']) v;
select pg_temp.parity('registration','{"search":"np-consult-order","view":"consultation_requested"}');
select pg_temp.parity(t,jsonb_build_object('view',v,'period',p)) from unnest(array['withdrawal','transfer']) t cross join unnest(array['applicant','operations','closed']) v cross join unnest(array['all','today','week','month']) p;
select pg_temp.parity(t,jsonb_build_object('period','custom','dateFrom',current_date::text,'dateTo',current_date::text)) from unnest(array['withdrawal','transfer','word_retest']) t;
select pg_temp.parity(t,jsonb_build_object(k,v)) from unnest(array['withdrawal','transfer']) t cross join (values('subject','-'),('subject','영어'),('teacher','미지정'),('teacher','교사 2')) f(k,v);
select pg_temp.parity('word_retest',jsonb_build_object('queue',q,'includeClosed',c,'period',p)) from unnest(array['assistant','teacher']) q cross join unnest(array[true,false]) c cross join unnest(array['all','today','week','month']) p;
select pg_temp.parity('word_retest',jsonb_build_object(k,v)) from (values('teacherId','__unassigned__'),('teacherId','teacher_name:교사 2'),('teacherId','94000000-0000-4000-8000-000000000001'),('classId','class_name:반 2'),('classId','__unassigned__'),('classId','94000000-0000-4000-8000-000000000001'),('branch','본관'),('branch','별관')) f(k,v);
select pg_temp.parity(t,jsonb_build_object('statuses',jsonb_build_array(s),'search',case when t='general' then 'np-extra' else 'np-fixture' end)) from unnest(array['general','registration','withdrawal','transfer','word_retest']) t cross join unnest(array['requested','canceled']) s;
select pg_temp.parity('withdrawal',jsonb_build_object('sortColumn',c,'sortDirection',d))
from unnest(array['status','subject','teacher','className','student','withdrawalDate','withdrawalSession','completedLessonHours','fourWeekLessonHours','progress','customerReason','teacherOpinion','undistributedTextbooks','operationsChecklist']) c cross join unnest(array['asc','desc']) d;
select pg_temp.parity('transfer',jsonb_build_object('sortColumn',c,'sortDirection',d))
from unnest(array['status','subject','fromTeacher','fromClassName','student','transferReason','fromUndistributedTextbooks','fromClassEndDate','fromClassEndSession','toTeacher','toClassName','toClassStartDate','toClassStartSession','toUndistributedTextbooks','operationsChecklist']) c cross join unnest(array['asc','desc']) d;
select pg_temp.parity('word_retest',jsonb_build_object('tableSortColumn',c,'tableSortDirection',d,'includeClosed',true))
from unnest(array['status','testAt','expectedRetestAt','teacher','class','student','textbook','unit','note','total','cutoff','score','result']) c cross join unnest(array['asc','desc']) d;
select pg_temp.parity('withdrawal',jsonb_build_object('filterColumn',c,'search',s)) from (values('progress','25%'),('operationsChecklist','수업료'),('teacher','교사 2'),('status','신청')) v(c,s);
select pg_temp.parity('transfer',jsonb_build_object('filterColumn',c,'search',s)) from (values('toClassName','반 10'),('operationsChecklist','교재비'),('fromTeacher','교사 2'),('status','신청')) v(c,s);

select throws_ok(format('select public.list_ops_task_numbered_page_v1(%L,%L::jsonb,%s,%s)','general',pg_temp.task_filters('general'),coalesce(p::text,'null'),coalesce(s::text,'null')),'22023',null,'invalid page/size raises22023')
from (values(0,10),(-1,10),(null,10),(1,5),(1,30),(1,null)) v(p,s);
select throws_ok(format('select public.list_ops_task_numbered_page_v1(%L,%L::jsonb,1,10)',t,pg_temp.task_filters(t,jsonb_build_object(k,null))),'22023',null,'null required enum '||t||'.'||k)
from (values('general','queue'),('general','focus'),('general','sort'),('registration','view'),('withdrawal','view'),('withdrawal','period'),('transfer','view'),('word_retest','period'),('word_retest','queue'),('word_retest','includeClosed')) f(t,k);
select throws_ok(format('select public.list_ops_task_numbered_page_v1(%L,%L::jsonb,1,10)','withdrawal',pg_temp.task_filters('withdrawal',patch)),'22023',null,'invalid ISO/sort contract22023')
from (values ('{"period":"custom","dateFrom":"2026-02-30","dateTo":"2026-03-01"}'::jsonb),('{"period":"custom","dateFrom":"2026-09-01","dateTo":"2026-08-31"}'),('{"sortColumn":"status","sortDirection":"bad"}'),('{"dateFrom":"2026-08-31"}'),('{"filterColumn":""}'),('{"sortColumn":"","sortDirection":"asc"}')) v(patch);
select throws_ok($$select public.list_ops_task_numbered_page_v1(null,null,1,10)$$,'22023',null,'null type filters22023');

reset role;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration'),1,10)->>'totalCount','2','linked teacher sees authorized parent cases');
select is(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration'),1,10)->'rows'->0->'registrationTracks'->0->'observationAttemptCount','null'::jsonb,'observation tuple remains masked for unassigned teacher');
select is(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration'),1,10)->'rows'->0->'registrationTracks'->0->'observationSummaryVisible','false'::jsonb,'masked observation tuple does not claim visibility');
reset role;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is(public.list_ops_task_numbered_page_v1('registration',pg_temp.task_filters('registration'),1,10)->>'totalCount','0','unlinked authenticated user cannot count hidden parents');
reset role;
set local role anon;
select throws_ok($$select public.list_ops_task_numbered_page_v1('general',pg_temp.task_filters('general'),1,10)$$,'42501',null,'anon cannot execute numbered RPC');
reset role;
select ok(not p.prosecdef and (coalesce('search_path='=any(p.proconfig),false) or coalesce('search_path=""'=any(p.proconfig),false))
 and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('public',p.oid,'EXECUTE'),
 p.proname||' is fixed-path invoker and authenticated-only') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='dashboard_private' and p.proname in ('ops_task_numbered_keys_v1','ops_task_numbered_project_v1','ops_withdrawal_numbered_scalar_v1','ops_transfer_numbered_scalar_v1','ops_word_retest_numbered_scalar_v1')) or (n.nspname='public' and p.proname='list_ops_task_numbered_page_v1');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send_before),'reads create zero notification deliveries');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send_initial),'disabled fixture setup also creates zero deliveries');
select is((select count(*) from public.ops_registration_messages),(select messages from no_send_before),'reads create zero registration messages');
select * from finish();
rollback;
