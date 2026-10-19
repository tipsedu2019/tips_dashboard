-- Completed failed word retest retry contract, rollback-only synthetic pgTAP.
-- Prerequisites: the owned 184-input schema, pgTAP already installed, and the
-- separately approved candidate private function already applied by the owner.
-- This file installs no candidate, extension, product function, ACL, or policy.
-- Run with psql -X against ONLY the owned isolated database, never production.
\set ON_ERROR_STOP 1
\set VERBOSITY sqlstate
\set ECHO none
\set QUIET 1
\pset format unaligned
\pset tuples_only on
begin;
set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '3s';


-- Synthetic fixtures in the owned network-none DB only. The final done state
-- is produced by the unchanged public transition RPC below, not a direct edit.
-- Reserve the fixture catalog before auth signup, following the unchanged
-- signup trigger's reserved-account path without disabling any trigger.
insert into public.teacher_catalogs(id,name,account_email) values
 ('71000000-0000-4000-8000-000000000005','합성 연결 선생님','retest-teacher@fixture.invalid');
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000004','authenticated','authenticated','retest-teacher@fixture.invalid','{}','{}'),
 ('71000000-0000-4000-8000-000000000006','authenticated','authenticated','retest-assistant@fixture.invalid','{}','{}');
insert into public.profiles(id, role) values
 ('71000000-0000-4000-8000-000000000004','teacher'),
 ('71000000-0000-4000-8000-000000000006','assistant')
on conflict (id) do update set role=excluded.role;
update public.teacher_catalogs set profile_id='71000000-0000-4000-8000-000000000004',dashboard_role='teacher'
where id='71000000-0000-4000-8000-000000000005';
update public.profiles set teacher_catalog_id='71000000-0000-4000-8000-000000000005'
where id='71000000-0000-4000-8000-000000000004';
insert into public.students(id,name) values ('72000000-0000-4000-8000-000000000201','합성 불합격완료 학생');
insert into public.classroom_catalogs(id,name,subjects) values ('72000000-0000-4000-8000-000000000204','본관 2강',array['영어']);
insert into public.classes(id,name,subject,teacher,room,schedule,schedule_storage_mode) values ('72000000-0000-4000-8000-000000000202','합성 영어 어휘반','영어','합성 연결 선생님','본관 2강','화목 18:00-20:00','legacy');
insert into public.textbooks(id,name,title,subject,school_level,grade_level,school_levels,grade_levels,sub_subject)
values ('72000000-0000-4000-8000-000000000203','합성 어휘 교재','합성 어휘 교재','english','high','h1',array['high'],array['h1'],'어휘');
insert into public.ops_tasks(id,title,type,status,requested_by,assignee_id,student_id,class_id,textbook_id,student_name,class_name,textbook_title,campus,subject)
values ('72000000-0000-4000-8000-000000000101','합성 불합격완료 재시험','word_retest','review_requested','71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000006','72000000-0000-4000-8000-000000000201','72000000-0000-4000-8000-000000000202','72000000-0000-4000-8000-000000000203','합성 불합격완료 학생','합성 영어 어휘반','합성 어휘 교재','본관','영어');
insert into public.ops_word_retests(task_id,branch,teacher_catalog_id,teacher_name,class_name,student_name,test_at,textbook_name,unit,total_question_count,cutoff_question_count,first_score,retest_status,request_note,expected_retest_at)
values ('72000000-0000-4000-8000-000000000101','본관','71000000-0000-4000-8000-000000000005','합성 연결 선생님','합성 영어 어휘반','합성 불합격완료 학생','2026-07-19T09:00:00+09:00','합성 어휘 교재','Unit 6 재시험',30,27,24,'done','완료 뒤 재재시험 추가 확인용','2026-07-22T19:30:00+09:00');


update public.ops_tasks set title='영어 단어 재시험: 합성 불합격완료 학생',requested_team='영어팀',assignee_team='조교팀' where id='72000000-0000-4000-8000-000000000101';
set constraints all immediate;
-- The synthetic fixture begins the only transaction; keep every constraint active.
set local search_path = public, extensions, pg_catalog;

create temporary table draft_input(input jsonb not null);
create temporary table draft_results(case_id text primary key, result jsonb not null);
create temporary table draft_snapshots(case_id text primary key, value jsonb not null);
create temporary table draft_sources(case_id text primary key, task_id uuid unique not null,
  detail_patch jsonb not null default '{}'::jsonb);
insert into pg_temp.draft_input values ($producer${
  "task": {
    "title": "영어 단어 재시험: 합성 불합격완료 학생",
    "type": "word_retest",
    "status": "requested",
    "priority": "normal",
    "requested_by": "71000000-0000-4000-8000-000000000004",
    "requested_team": "영어팀",
    "assignee_id": null,
    "assignee_team": "조교팀",
    "secondary_assignee_id": null,
    "student_id": "72000000-0000-4000-8000-000000000201",
    "class_id": "72000000-0000-4000-8000-000000000202",
    "textbook_id": "72000000-0000-4000-8000-000000000203",
    "student_name": "합성 불합격완료 학생",
    "class_name": "합성 영어 어휘반",
    "textbook_title": "합성 어휘 교재",
    "campus": "본관",
    "subject": "영어",
    "start_at": null,
    "due_at": null,
    "completed_at": null,
    "memo": null
  },
  "word_retest": {
    "branch": "본관",
    "teacher_catalog_id": "71000000-0000-4000-8000-000000000005",
    "teacher_name": "합성 연결 선생님",
    "class_name": "합성 영어 어휘반",
    "student_name": "합성 불합격완료 학생",
    "test_at": "2026-07-19",
    "expected_retest_at": null,
    "textbook_name": "합성 어휘 교재",
    "unit": "Unit 6 재시험",
    "request_note": "완료 뒤 재재시험 추가 확인용",
    "total_question_count": 30,
    "score_out_of_100": null,
    "cutoff_question_count": 27,
    "first_score": null,
    "second_score": null,
    "third_score": null,
    "retest_status": "not_started"
  }
}$producer$::jsonb);

-- A second teacher follows the real reserved-catalog signup path. No direct
-- profile-only FK fixture and no second active catalog for the same profile.
insert into public.teacher_catalogs(id,name,account_email) values
 ('71000000-0000-4000-8000-000000000008','합성 무관 선생님','retest-unrelated@fixture.invalid');
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000007','authenticated','authenticated',
  'retest-unrelated@fixture.invalid','{}','{}');
insert into public.profiles(id,role) values
 ('71000000-0000-4000-8000-000000000007','teacher')
on conflict(id) do update set role=excluded.role;
update public.teacher_catalogs
set profile_id='71000000-0000-4000-8000-000000000007',dashboard_role='teacher'
where id='71000000-0000-4000-8000-000000000008';
update public.profiles set teacher_catalog_id='71000000-0000-4000-8000-000000000008'
where id='71000000-0000-4000-8000-000000000007';

-- Clone only the same synthetic source rows. All FK, taxonomy (h1), partial
-- unique indexes and expected-date guards remain installed and enabled.
insert into pg_temp.draft_sources(case_id,task_id,detail_patch) values
 ('review_failed','72000000-0000-4000-8000-000000000102','{}'),
 ('review_absent','72000000-0000-4000-8000-000000000103',
  '{"retest_status":"absent","first_score":null}'),
 ('done_absent','72000000-0000-4000-8000-000000000104',
  '{"retest_status":"absent","first_score":null}'),
 ('passed','72000000-0000-4000-8000-000000000105','{"second_score":27}'),
 ('cutoff_null','72000000-0000-4000-8000-000000000106','{"cutoff_question_count":null}'),
 ('scores_null','72000000-0000-4000-8000-000000000107',
  '{"first_score":null,"second_score":null,"third_score":null}'),
 ('unsupported','72000000-0000-4000-8000-000000000108','{}'),
 ('denials','72000000-0000-4000-8000-000000000109','{}');
insert into public.ops_tasks
select (pg_catalog.jsonb_populate_record(null::public.ops_tasks,
  pg_catalog.to_jsonb(t) || pg_catalog.jsonb_build_object('id',s.task_id))).*
from public.ops_tasks t cross join pg_temp.draft_sources s
where t.id='72000000-0000-4000-8000-000000000101';
insert into public.ops_word_retests
select (pg_catalog.jsonb_populate_record(null::public.ops_word_retests,
  pg_catalog.to_jsonb(d) || s.detail_patch || pg_catalog.jsonb_build_object('task_id',s.task_id))).*
from public.ops_word_retests d cross join pg_temp.draft_sources s
where d.task_id='72000000-0000-4000-8000-000000000101';

-- INVOKER only: public ACL checks still execute under authenticated/anon.
-- Every caught error returns its exact code and nothing else (no SQLERRM,
-- context, stack, detail, hint, or raw args). Query cancellation is explicit.
create function pg_temp.call_rpc(p_rpc text,p_task uuid,p_request uuid,
  p_input jsonb default null,p_expected timestamptz default null,p_status text default 'done')
returns jsonb language plpgsql security invoker set search_path='' as $wrapper$
declare v_data jsonb;
begin
  if p_rpc='retry' then
    v_data:=public.retry_word_retest_v1(p_task,p_input,p_request);
  elsif p_rpc='transition' then
    v_data:=public.transition_ops_task_status_v2(p_task,p_status,p_expected,p_request);
  else
    return pg_catalog.jsonb_build_object('code','22023');
  end if;
  return pg_catalog.jsonb_build_object('code','00000','data',v_data);
exception
  when query_canceled then return pg_catalog.jsonb_build_object('code',SQLSTATE);
  when others then return pg_catalog.jsonb_build_object('code',SQLSTATE);
end;
$wrapper$;
revoke all on function pg_temp.call_rpc(text,uuid,uuid,jsonb,timestamptz,text) from public;
grant execute on function pg_temp.call_rpc(text,uuid,uuid,jsonb,timestamptz,text) to authenticated,anon;
grant select on pg_temp.draft_input,pg_temp.draft_snapshots to authenticated,anon;
grant insert on pg_temp.draft_results to authenticated,anon;


-- Called only after RESET ROLE by the test owner. Fixed local table names;
-- missing relations fail instead of silently treating unavailable counters as 0.
create function pg_temp.no_send_counts() returns jsonb language sql security invoker
set search_path='' as $no_send$
select pg_catalog.jsonb_build_object(
 'legacyDeliveries',(select count(*) from public.ops_task_notification_deliveries),
 'legacyAttempts',(select coalesce(sum(attempt_count),0) from public.ops_task_notification_deliveries),
 'deliveries',(select count(*) from dashboard_private.notification_deliveries),
 'deliveryAttempts',(select coalesce(sum(attempt_count),0) from dashboard_private.notification_deliveries),
 'chatOutbox',(select count(*) from dashboard_private.chat_delivery_outbox),
 'chatAttempts',(select count(*) from dashboard_private.chat_delivery_attempts),
 'mentionSnapshots',(select count(*) from dashboard_private.notification_delivery_mention_snapshots),
 'ownershipClaims',(select count(*) from dashboard_private.notification_dispatch_ownership_claims),
 'networkQueue',(select count(*) from net.http_request_queue));
$no_send$;
create function pg_temp.state_digest() returns jsonb language sql security invoker
set search_path='' as $state$
select pg_catalog.jsonb_build_object(
 'tasks',(select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.ops_tasks x),
 'details',(select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.task_id),'[]'::jsonb)::text) from public.ops_word_retests x),
 'events',(select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.ops_task_events x),
 'notifications',(select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id),'[]'::jsonb)::text) from dashboard_private.notification_events x),
 'ledger',(select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.request_id),'[]'::jsonb)::text) from dashboard_private.notification_request_ledger x),
 'fanoutCount',(select count(*) from dashboard_private.notification_event_fanout_jobs),
 'noSend',pg_temp.no_send_counts());
$state$;
revoke all on function pg_temp.no_send_counts(),pg_temp.state_digest() from public;
insert into pg_temp.draft_snapshots values ('no_send_start',pg_temp.no_send_counts());

select no_plan();

-- Produce done through the real current public transition, then freeze the oracle.

insert into pg_temp.draft_snapshots values ('main_complete_expected',(select to_jsonb(updated_at) from public.ops_tasks where id='72000000-0000-4000-8000-000000000101'));

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('main_complete',pg_temp.call_rpc(
 'transition','72000000-0000-4000-8000-000000000101','73000000-0000-4000-8000-000000000001',null,
 ((select value from pg_temp.draft_snapshots where case_id='main_complete_expected') #>> '{}')::timestamptz,'done'));
reset role;

select is(((select result from pg_temp.draft_results where case_id='main_complete')->>'code'), '00000'::text, '01 public completion succeeds for linked teacher');

select ok((exists(select 1 from public.ops_tasks where id='72000000-0000-4000-8000-000000000101' and status='done' and completed_at is not null and completed_by='71000000-0000-4000-8000-000000000004' and completed_by_label is not null)), '02 completion precondition captures real completion actor and timestamp');

insert into pg_temp.draft_snapshots values ('parent_task',(select to_jsonb(t)-'updated_at' from public.ops_tasks t where id='72000000-0000-4000-8000-000000000101'));

insert into pg_temp.draft_snapshots values ('parent_detail',(select to_jsonb(d)-'updated_at'-'retry_task_id' from public.ops_word_retests d where task_id='72000000-0000-4000-8000-000000000101'));

insert into pg_temp.draft_snapshots values ('original_completion',to_jsonb((select count(*) from public.ops_task_events where task_id='72000000-0000-4000-8000-000000000101' and event_type='word_retest.completed')));

select ok(((select value from pg_temp.draft_snapshots where case_id='original_completion')='1'::jsonb), '03 original has exactly one completion event before retry');

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('main_retry',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000101','73000000-0000-4000-8000-000000000002',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='main_retry')->>'code'), '00000'::text, '04 completed failed retry succeeds for linked teacher');

select ok(((select to_jsonb(t)-'updated_at' from public.ops_tasks t where id='72000000-0000-4000-8000-000000000101')=(select value from pg_temp.draft_snapshots where case_id='parent_task')), '05 parent task and completion fields are preserved');

select ok(((select to_jsonb(d)-'updated_at'-'retry_task_id' from public.ops_word_retests d where task_id='72000000-0000-4000-8000-000000000101')=(select value from pg_temp.draft_snapshots where case_id='parent_detail')), '06 parent scores, result, expected datetime and context are preserved');

select ok(((select count(*)=1 from public.ops_word_retests where retry_of_task_id='72000000-0000-4000-8000-000000000101')
 and (select result#>>'{data,task,id}' from pg_temp.draft_results where case_id='main_retry')
   = (select task_id::text from public.ops_word_retests where retry_of_task_id='72000000-0000-4000-8000-000000000101')
 and (select result#>>'{data,previousTask,id}' from pg_temp.draft_results where case_id='main_retry')
   = '72000000-0000-4000-8000-000000000101'), '07 exactly one child and correct response task identities');

select ok((exists(select 1 from public.ops_tasks t join public.ops_word_retests d on d.task_id=t.id where d.retry_of_task_id='72000000-0000-4000-8000-000000000101' and t.status='requested' and t.completed_at is null and t.completed_by is null and t.completed_by_label is null and d.retest_status='not_started')), '08 child starts requested/not_started with no completion');

select ok((exists(select 1 from public.ops_word_retests where retry_of_task_id='72000000-0000-4000-8000-000000000101' and first_score is null and second_score is null and third_score is null and score_out_of_100 is null and expected_retest_at is null)), '09 child scores and expected datetime are null');

select ok((exists (select 1 from public.ops_word_retests p join public.ops_word_retests c on c.task_id=p.retry_task_id where p.task_id='72000000-0000-4000-8000-000000000101' and c.retry_of_task_id=p.task_id)), '10 parent and child retry links agree');

select ok((to_jsonb((select count(*) from public.ops_task_events where task_id='72000000-0000-4000-8000-000000000101' and event_type='word_retest.completed'))=(select value from pg_temp.draft_snapshots where case_id='original_completion')), '11 retry does not duplicate original completion event');

select ok(((select count(*)=1 from public.ops_task_events where request_id='73000000-0000-4000-8000-000000000002' and event_type='word_retest.retry_created') and (select count(*)=1 from dashboard_private.notification_request_ledger where request_id='73000000-0000-4000-8000-000000000002') and jsonb_array_length((select result from pg_temp.draft_results where case_id='main_retry')#>'{data,sourceEventIds}')=1
 and exists(select 1 from public.ops_task_events e
  where e.request_id='73000000-0000-4000-8000-000000000002' and e.event_type='word_retest.retry_created'
    and e.id::text=(select result#>>'{data,sourceEventIds,0}' from pg_temp.draft_results where case_id='main_retry')
    and e.task_id::text=(select result#>>'{data,task,id}' from pg_temp.draft_results where case_id='main_retry'))),
 '12 retry creates one matching source event, response event ID and request receipt');

select ok((pg_temp.no_send_counts()=(select value from pg_temp.draft_snapshots where case_id='no_send_start')), '13 completion and retry do not enqueue or attempt sending');

-- Same key replay is exact; changed payload and second distinct key are atomic failures.

insert into pg_temp.draft_snapshots values ('after_success',pg_temp.state_digest());

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('same_request',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000101','73000000-0000-4000-8000-000000000002',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='same_request')->>'code'), '00000'::text, '14 same request replay succeeds');

select ok(((select result from pg_temp.draft_results where case_id='same_request')=(select result from pg_temp.draft_results where case_id='main_retry')), '15 same request returns the identical stored JSONB response');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='after_success')), '16 same request replay changes no task, detail, event, ledger or send state');

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('changed_payload',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000101','73000000-0000-4000-8000-000000000002',(select jsonb_set(input,'{task,title}','"합성 다른 요청 제목"'::jsonb) from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='changed_payload')->>'code'), '22023'::text, '17 changed payload retains exact idempotency conflict SQLSTATE');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='after_success')), '18 changed-payload conflict preserves all observed state');

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('distinct_request',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000101','73000000-0000-4000-8000-000000000003',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='distinct_request')->>'code'), '23514'::text, '19 distinct request after existing child uses nonretryable conflict');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='after_success')), '20 distinct-request conflict creates no duplicate or partial change');

-- Existing review-failed and absent routes remain supported.

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('review_failed',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000102','73000000-0000-4000-8000-000000000004',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='review_failed')->>'code'), '00000'::text, '21 review_failed succeeds');

select ok((exists (select 1 from public.ops_word_retests p join public.ops_word_retests c on c.task_id=p.retry_task_id where p.task_id='72000000-0000-4000-8000-000000000102' and c.retry_of_task_id=p.task_id) and exists(select 1 from public.ops_tasks where id='72000000-0000-4000-8000-000000000102' and status='done')), '22 review_failed closes parent and links one child');

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('review_absent',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000103','73000000-0000-4000-8000-000000000005',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='review_absent')->>'code'), '00000'::text, '23 review_absent succeeds');

select ok((exists (select 1 from public.ops_word_retests p join public.ops_word_retests c on c.task_id=p.retry_task_id where p.task_id='72000000-0000-4000-8000-000000000103' and c.retry_of_task_id=p.task_id) and exists(select 1 from public.ops_tasks where id='72000000-0000-4000-8000-000000000103' and status='done')), '24 review_absent closes parent and links one child');

insert into pg_temp.draft_snapshots values ('absent_complete_expected',(select to_jsonb(updated_at) from public.ops_tasks where id='72000000-0000-4000-8000-000000000104'));

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('absent_complete',pg_temp.call_rpc(
 'transition','72000000-0000-4000-8000-000000000104','73000000-0000-4000-8000-000000000006',null,
 ((select value from pg_temp.draft_snapshots where case_id='absent_complete_expected') #>> '{}')::timestamptz,'done'));
reset role;

select is(((select result from pg_temp.draft_results where case_id='absent_complete')->>'code'), '00000'::text, '25 absent source can complete through public transition');

insert into pg_temp.draft_snapshots values ('absent_task',(select to_jsonb(t)-'updated_at' from public.ops_tasks t where id='72000000-0000-4000-8000-000000000104'));

insert into pg_temp.draft_snapshots values ('absent_detail',(select to_jsonb(d)-'updated_at'-'retry_task_id' from public.ops_word_retests d where task_id='72000000-0000-4000-8000-000000000104'));

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('done_absent',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000104','73000000-0000-4000-8000-000000000007',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='done_absent')->>'code'), '00000'::text, '26 existing done-absent retry succeeds');

select ok((exists (select 1 from public.ops_word_retests p join public.ops_word_retests c on c.task_id=p.retry_task_id where p.task_id='72000000-0000-4000-8000-000000000104' and c.retry_of_task_id=p.task_id) and (select to_jsonb(t)-'updated_at' from public.ops_tasks t where id='72000000-0000-4000-8000-000000000104')=(select value from pg_temp.draft_snapshots where case_id='absent_task') and (select to_jsonb(d)-'updated_at'-'retry_task_id' from public.ops_word_retests d where task_id='72000000-0000-4000-8000-000000000104')=(select value from pg_temp.draft_snapshots where case_id='absent_detail')), '27 done-absent preserves parent fields and links child');

-- Each negative is tested before any child exists; public transition produces closed state.

insert into pg_temp.draft_snapshots values ('passed_complete_expected',(select to_jsonb(updated_at) from public.ops_tasks where id='72000000-0000-4000-8000-000000000105'));

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('passed_complete',pg_temp.call_rpc(
 'transition','72000000-0000-4000-8000-000000000105','73000000-0000-4000-8000-000000000020',null,
 ((select value from pg_temp.draft_snapshots where case_id='passed_complete_expected') #>> '{}')::timestamptz,'done'));
reset role;

select is(((select result from pg_temp.draft_results where case_id='passed_complete')->>'code'), '00000'::text, '28 passed setup transition succeeds');

insert into pg_temp.draft_snapshots values ('passed_before',pg_temp.state_digest());

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('passed',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000105','73000000-0000-4000-8000-000000000030',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='passed')->>'code'), '23514'::text, '29 passed retry is rejected with exact nonretryable SQLSTATE');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='passed_before')), '30 passed rejection is atomic');

insert into pg_temp.draft_snapshots values ('cutoff_null_complete_expected',(select to_jsonb(updated_at) from public.ops_tasks where id='72000000-0000-4000-8000-000000000106'));

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('cutoff_null_complete',pg_temp.call_rpc(
 'transition','72000000-0000-4000-8000-000000000106','73000000-0000-4000-8000-000000000021',null,
 ((select value from pg_temp.draft_snapshots where case_id='cutoff_null_complete_expected') #>> '{}')::timestamptz,'done'));
reset role;

select is(((select result from pg_temp.draft_results where case_id='cutoff_null_complete')->>'code'), '00000'::text, '31 cutoff_null setup transition succeeds');

insert into pg_temp.draft_snapshots values ('cutoff_null_before',pg_temp.state_digest());

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('cutoff_null',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000106','73000000-0000-4000-8000-000000000031',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='cutoff_null')->>'code'), '23514'::text, '32 cutoff_null retry is rejected with exact nonretryable SQLSTATE');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='cutoff_null_before')), '33 cutoff_null rejection is atomic');

insert into pg_temp.draft_snapshots values ('scores_null_complete_expected',(select to_jsonb(updated_at) from public.ops_tasks where id='72000000-0000-4000-8000-000000000107'));

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('scores_null_complete',pg_temp.call_rpc(
 'transition','72000000-0000-4000-8000-000000000107','73000000-0000-4000-8000-000000000022',null,
 ((select value from pg_temp.draft_snapshots where case_id='scores_null_complete_expected') #>> '{}')::timestamptz,'done'));
reset role;

select is(((select result from pg_temp.draft_results where case_id='scores_null_complete')->>'code'), '00000'::text, '34 scores_null setup transition succeeds');

insert into pg_temp.draft_snapshots values ('scores_null_before',pg_temp.state_digest());

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('scores_null',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000107','73000000-0000-4000-8000-000000000032',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='scores_null')->>'code'), '23514'::text, '35 scores_null retry is rejected with exact nonretryable SQLSTATE');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='scores_null_before')), '36 scores_null rejection is atomic');

insert into pg_temp.draft_snapshots values ('unsupported_complete_expected',(select to_jsonb(updated_at) from public.ops_tasks where id='72000000-0000-4000-8000-000000000108'));

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('unsupported_complete',pg_temp.call_rpc(
 'transition','72000000-0000-4000-8000-000000000108','73000000-0000-4000-8000-000000000023',null,
 ((select value from pg_temp.draft_snapshots where case_id='unsupported_complete_expected') #>> '{}')::timestamptz,'canceled'));
reset role;

select is(((select result from pg_temp.draft_results where case_id='unsupported_complete')->>'code'), '00000'::text, '37 unsupported setup transition succeeds');

insert into pg_temp.draft_snapshots values ('unsupported_before',pg_temp.state_digest());

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('unsupported',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000108','73000000-0000-4000-8000-000000000033',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='unsupported')->>'code'), '23514'::text, '38 unsupported retry is rejected with exact nonretryable SQLSTATE');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='unsupported_before')), '39 unsupported rejection is atomic');

-- Denials target the same otherwise-eligible untouched review-failed source.

insert into pg_temp.draft_snapshots values ('assistant_before',pg_temp.state_digest());

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000006"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000006',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('assistant',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000109','73000000-0000-4000-8000-000000000041',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='assistant')->>'code'), '42501'::text, '40 assistant public retry is denied');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='assistant_before')), '41 assistant denial preserves all observed state');

insert into pg_temp.draft_snapshots values ('unrelated_teacher_before',pg_temp.state_digest());

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000007"}',true);
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000007',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role authenticated;

insert into pg_temp.draft_results values ('unrelated_teacher',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000109','73000000-0000-4000-8000-000000000042',
 (select jsonb_set(jsonb_set(jsonb_set(input,
   '{task,requested_by}','"71000000-0000-4000-8000-000000000007"'::jsonb),
   '{word_retest,teacher_catalog_id}','"71000000-0000-4000-8000-000000000008"'::jsonb),
   '{word_retest,teacher_name}','"합성 무관 선생님"'::jsonb)
  from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='unrelated_teacher')->>'code'), '42501'::text, '42 unrelated_teacher public retry is denied');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='unrelated_teacher_before')), '43 unrelated_teacher denial preserves all observed state');

insert into pg_temp.draft_snapshots values ('anon_before',pg_temp.state_digest());

do $claims$ begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.method','POST',true);
end; $claims$;
set local role anon;

insert into pg_temp.draft_results values ('anon',pg_temp.call_rpc(
 'retry','72000000-0000-4000-8000-000000000109','73000000-0000-4000-8000-000000000043',(select input from pg_temp.draft_input)));
reset role;

select is(((select result from pg_temp.draft_results where case_id='anon')->>'code'), '42501'::text, '44 anon public retry is denied');

select ok((pg_temp.state_digest() = (select value from pg_temp.draft_snapshots where case_id='anon_before')
 and not has_function_privilege('anon','public.retry_word_retest_v1(uuid,jsonb,uuid)','EXECUTE')),
 '45 anon has no public retry EXECUTE and denial preserves all observed state');

select ok((pg_temp.no_send_counts()=(select value from pg_temp.draft_snapshots where case_id='no_send_start')), '46 all focused cases leave every delivery/attempt/outbox/queue counter unchanged');

set constraints all immediate;
select * from finish();
rollback;
