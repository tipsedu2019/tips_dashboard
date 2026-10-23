begin;
select no_plan();
set local statement_timeout='30s';
create function pg_temp.tid(n integer) returns uuid language sql immutable as $$select ('af240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.actor(n integer) returns void language plpgsql as $$begin perform set_config('request.jwt.claim.sub',pg_temp.tid(n)::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(n),'role','authenticated')::text,true);end$$;
create function pg_temp.filters(kind text,patch jsonb default '{}') returns jsonb language sql immutable as $$select jsonb_build_object('taskType',kind,'search','','statuses','[]'::jsonb)||case kind when 'registration' then '{"view":"inquiry","consultationOwnerId":null}'::jsonb else '{"view":"applicant","subject":null,"teacher":null,"dateFrom":null,"dateTo":null,"period":"all","filterColumn":null,"sortColumn":null,"sortDirection":null}'::jsonb end||patch$$;
insert into auth.users(id,instance_id,aud,role,email) select pg_temp.tid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','teacher-common-'||n||'@synthetic.invalid' from generate_series(1,5)n;
insert into public.profiles(id,role,name,email) select pg_temp.tid(n),case n when 1 then 'admin' when 2 then 'staff' when 3 then 'teacher' when 4 then 'assistant' else 'viewer' end,case n when 1 then '' else '합성 담당자 '||n end,'PRIVATE_ACCOUNT_CANARY'||n||'@synthetic.invalid' from generate_series(1,5)n on conflict(id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
select pg_temp.actor(1);
insert into public.students(id,name,class_ids) values(pg_temp.tid(101),'공통 학생3',jsonb_build_array(pg_temp.tid(102)));
insert into public.classes(id,name,subject,student_ids) values(pg_temp.tid(102),'공통 수업','수학',jsonb_build_array(pg_temp.tid(101)));
insert into public.ops_tasks(id,type,title,status,priority,requested_by,assignee_id,student_name,class_name,subject,memo,student_id,class_id) values
(pg_temp.tid(201),'transfer','PRIVATE_TITLE_CANARY','requested','normal',pg_temp.tid(3),pg_temp.tid(3),'공통 학생1','공통 수업','영어','PRIVATE_MEMO_CANARY',pg_temp.tid(101),pg_temp.tid(102)),
(pg_temp.tid(202),'transfer','PRIVATE_TITLE_CANARY','requested','normal',pg_temp.tid(1),pg_temp.tid(1),'공통 학생2','공통 수업','영어','PRIVATE_MEMO_CANARY',pg_temp.tid(101),pg_temp.tid(102)),
(pg_temp.tid(203),'withdrawal','PRIVATE_TITLE_CANARY','requested','normal',pg_temp.tid(1),pg_temp.tid(1),'공통 학생3','공통 수업','수학','PRIVATE_MEMO_CANARY',pg_temp.tid(101),pg_temp.tid(102)),
(pg_temp.tid(204),'registration','PRIVATE_TITLE_CANARY','requested','normal',pg_temp.tid(1),pg_temp.tid(1),'공통 학생4','공통 수업','영어','PRIVATE_MEMO_CANARY',pg_temp.tid(101),pg_temp.tid(102));
insert into public.ops_transfer_details(task_id,from_teacher_name,to_teacher_name,from_class_name,to_class_name,transfer_reason,from_undistributed_textbooks,to_undistributed_textbooks) select pg_temp.tid(n),'전 선생님','후 선생님','전 수업','후 수업','PRIVATE_REASON_CANARY','PRIVATE_BOOK_CANARY','PRIVATE_BOOK_CANARY' from generate_series(201,202)n;
insert into public.ops_withdrawal_details(task_id,teacher_name,customer_reason,teacher_opinion) values(pg_temp.tid(203),'담당 선생님','PRIVATE_REASON_CANARY','PRIVATE_OPINION_CANARY');
insert into public.ops_registration_details(task_id,parent_phone,student_phone,school_name,school_grade,request_note,level_test_result) values(pg_temp.tid(204),'PRIVATE_PHONE_CANARY','PRIVATE_PHONE_CANARY','공통 학교','중3','PRIVATE_NOTE_CANARY','PRIVATE_RESULT_CANARY');
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,workflow_revision) values(pg_temp.tid(304),pg_temp.tid(204),'영어','inquiry','inquiry',1);
insert into public.ops_registration_appointments(id,task_id,kind,scheduled_at,place,status,notification_revision) values(pg_temp.tid(401),pg_temp.tid(204),'visit_consultation',now()+interval '7 days','PRIVATE_VISIT_CANARY','scheduled',1);
insert into public.ops_registration_consultations(id,track_id,appointment_id,mode,status,director_profile_id) values(pg_temp.tid(402),pg_temp.tid(304),pg_temp.tid(401),'visit','scheduled',pg_temp.tid(1));
select pg_temp.actor(3);
set local role authenticated;
select is((public.list_ops_task_numbered_page_v1('transfer',pg_temp.filters('transfer'),1,15)->>'totalCount')::integer,2,'teacher reads own and unrelated transfer common rows');
select is(jsonb_array_length(public.list_ops_task_numbered_page_v1('transfer',pg_temp.filters('transfer'),1,15)->'rows'),2,'whole-read page has the same cardinality');
select is((public.get_ops_task_list_stats_v1('transfer',pg_temp.filters('transfer'))->>'total')::integer,2,'teacher common stats match list');
select is((public.get_ops_task_list_stats_v1('transfer',pg_temp.filters('transfer'))#>>'{byView,applicant}')::integer,2,'view count matches common rows');
select ok(public.list_ops_task_numbered_page_v1('transfer',pg_temp.filters('transfer'),1,15)::text not like '%PRIVATE_%','transfer page has no private title/memo/reason/account fallback');
select is(public.get_operational_common_detail_v1(pg_temp.tid(202))->>'studentName','공통 학생2','teacher reads unrelated common detail');
select ok(public.get_operational_common_detail_v1(pg_temp.tid(202))::text not like '%PRIVATE_%','common detail excludes the same private fields');
select is((public.list_ops_task_numbered_page_v1('transfer',pg_temp.filters('transfer','{"search":"PRIVATE_REASON_CANARY"}'),1,15)->>'totalCount')::integer,0,'private reason is not a teacher search side channel');
select is((public.list_ops_task_numbered_page_v1('transfer',pg_temp.filters('transfer','{"search":"공통 학생2"}'),1,15)->>'totalCount')::integer,1,'common name search still works');
select is((public.get_ops_task_list_stats_v1('transfer',pg_temp.filters('transfer','{"search":"공통 학생2"}'))->>'total')::integer,1,'common search list/count use the same eligible set');
select throws_ok($q$select public.list_ops_task_numbered_page_v1('transfer',pg_temp.filters('transfer','{"filterColumn":"transferReason","search":"PRIVATE"}'),1,15)$q$,'42501','operational_common_filter_forbidden','teacher cannot infer private reason via field filter');
select throws_ok($q$select public.list_ops_task_numbered_page_v1('withdrawal',pg_temp.filters('withdrawal','{"sortColumn":"teacherOpinion","sortDirection":"asc"}'),1,15)$q$,'42501','operational_common_filter_forbidden','teacher cannot infer opinion via sort order');
select is((public.list_ops_task_numbered_page_v1('registration',pg_temp.filters('registration'),1,15)->>'totalCount')::integer,1,'registration common list reads other owner');
select is((public.get_ops_task_list_stats_v1('registration',pg_temp.filters('registration'))->>'total')::integer,1,'registration common stats match');
select ok(public.get_operational_common_detail_v1(pg_temp.tid(204))::text not like '%PRIVATE_%','registration common DTO masks contact/counseling/internal note');
select is((public.list_ops_task_numbered_page_v1('registration',pg_temp.filters('registration','{"search":"PRIVATE_PHONE_CANARY"}'),1,15)->>'totalCount')::integer,0,'phone search reveals no teacher list result');
select is((public.get_ops_task_list_stats_v1('registration',pg_temp.filters('registration','{"search":"PRIVATE_PHONE_CANARY"}'))->>'total')::integer,0,'phone search reveals no teacher count');
select is((public.list_ops_task_numbered_page_v1('registration',pg_temp.filters('registration','{"search":"공통 학교"}'),1,15)->>'totalCount')::integer,1,'school search remains available');
select is((public.get_ops_task_list_stats_v1('registration',pg_temp.filters('registration','{"search":"공통 학교"}'))->>'total')::integer,1,'school search list/count agree');
select is((select count(*) from public.ops_tasks where id=pg_temp.tid(201)),0::bigint,'teacher cannot fall back to raw own private task');
select is(dashboard_private.can_read_ops_task_v1(pg_temp.tid(201)),false,'raw child/event/comment readers do not reopen an owned operation');
select throws_ok($q$select dashboard_private.teacher_operational_read_v1('arbitrary', '{}')$q$,'42501','operational_common_read_forbidden','fixed gateway does not accept arbitrary operations');
select throws_ok($q$select public.complete_ops_transfer_roster_transition_v2(pg_temp.tid(201),pg_temp.tid(991))$q$,'42501','ops_task_access_denied','teacher completion cannot use prior receipt or processing path');
select throws_ok($q$select public.complete_ops_withdrawal_roster_transition_v3(pg_temp.tid(203),pg_temp.tid(992))$q$,'42501','ops_task_access_denied','teacher withdrawal completion is read-only');
select throws_ok($q$select public.enter_registration_observation_v1(pg_temp.tid(304),1,'synthetic-key')$q$,'42501','registration_access_denied','teacher observation entry denies before input or replay');
select throws_ok($q$select public.cancel_registration_observation_v1(pg_temp.tid(304),1,1,'synthetic-key')$q$,'42501','registration_access_denied','teacher observation cancel denies before input or replay');
select throws_ok($q$update public.ops_tasks set memo='ILLEGAL' where id=pg_temp.tid(201)$q$,'42501',null,'raw operation update remains ACL-denied');
select is((public.list_ops_task_numbered_page_v1('registration',pg_temp.filters('registration','{"search":"PRIVATE_VISIT_CANARY"}'),1,15)->>'totalCount')::integer,0,'hidden visit place cannot infer a teacher list match');
select is((public.get_ops_task_list_stats_v1('registration',pg_temp.filters('registration','{"search":"PRIVATE_VISIT_CANARY"}'))->>'total')::integer,0,'hidden visit place cannot infer a teacher count');
select throws_ok($q$select public.save_registration_observation_booking_v1(pg_temp.tid(304),pg_temp.tid(101),pg_temp.tid(102),'legacy:session',null,null,1,1,1,'synthetic-booking-key')$q$,'42501','registration_access_denied','teacher observation booking denies before state or receipt');
select diag('TEACHER_COMMON_CAPTURE='||jsonb_build_object('transfer',public.list_ops_task_numbered_page_v1('transfer',pg_temp.filters('transfer'),1,15),'registration',public.list_ops_task_numbered_page_v1('registration',pg_temp.filters('registration'),1,15),'withdrawal',public.list_ops_task_numbered_page_v1('withdrawal',pg_temp.filters('withdrawal'),1,15))::text);
reset role;
select pg_temp.actor(2);set local role authenticated;
select ok(public.get_management_detail_v1('students',pg_temp.tid(900)) is null,'staff ordinary management path remains available');
select ok(public.list_ops_task_numbered_page_v1('transfer',pg_temp.filters('transfer'),1,15)::text like '%PRIVATE_REASON_CANARY%','staff retains original processing DTO');
select throws_ok($q$select public.get_operational_common_detail_v1(pg_temp.tid(202))$q$,'42501','operational_common_read_forbidden','teacher-specific gateway cannot elevate another role');
reset role;
select pg_temp.actor(4);set local role authenticated;
select throws_ok($q$select public.get_operational_common_detail_v1(pg_temp.tid(202))$q$,'42501','operational_common_read_forbidden','assistant cannot use teacher whole-read');
reset role;
select pg_temp.actor(5);set local role authenticated;
select throws_ok($q$select public.get_operational_common_detail_v1(pg_temp.tid(202))$q$,'42501','operational_common_read_forbidden','viewer scope is not expanded');
reset role;
-- Recreated legacy producers retain CAS/locks, but domain conflicts are not
-- database serialization failures and must never invite transaction retries.
select ok(pg_catalog.pg_get_functiondef(signature::regprocedure) !~ 'errcode[[:space:]]*=[[:space:]]*''40001''',
  signature||' preserves nonretryable domain SQLSTATE')
from unnest(array[
  'dashboard_private.update_ops_task_v2_impl(uuid,jsonb,timestamp with time zone,uuid)',
  'dashboard_private.transition_ops_task_status_v2_impl(uuid,text,timestamp with time zone,uuid)',
  'dashboard_private.complete_ops_transfer_roster_transition_v2_impl(uuid,uuid)',
  'dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl(uuid,uuid)',
  'dashboard_private.complete_ops_transition_legacy_bridge_v1(uuid,text,text)'
]) signatures(signature);
select * from finish();rollback;
