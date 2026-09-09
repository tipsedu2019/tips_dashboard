begin;
set local role postgres;
set local search_path = extensions, public;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version)
values(true,0) on conflict(singleton) do update set version=excluded.version;

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
('99870000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admission-facts-admin@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('99870000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admission-facts-teacher@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.profiles(id,role,name,email)
values ('99870000-0000-4000-8000-000000000001','admin','입학 안내 관리자','admission-facts-admin@example.invalid'),
('99870000-0000-4000-8000-000000000002','teacher','입학 안내 선생님','admission-facts-teacher@example.invalid')
on conflict(id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
insert into public.academic_subject_settings(subject,is_active,registration_create_enabled,grade_levels,sort_order)
values('영어',true,true,array['중1'],10)
on conflict(subject) do update set is_active=true,registration_create_enabled=true,grade_levels=excluded.grade_levels;
insert into public.classes(id,name,subject,teacher,schedule,room,status,schedule_plan,schedule_storage_mode)
values('99870000-0000-4000-8000-000000000010','입학 안내 저장 사실 수업','영어','입학 안내 선생님','월 17:00-19:00','본관 1강','수업 진행 중',
'{"sessions":[{"date":"2026-09-14","sessionNumber":1,"scheduleState":"active","startTime":"17:00","endTime":"19:00"}]}','legacy');

create function pg_temp.set_admission_facts_actor(p_role text,p_actor uuid)
returns void language plpgsql as $$begin
  perform set_config('request.jwt.claims',jsonb_build_object('role',p_role,'sub',p_actor::text)::text,true);
  perform set_config('request.jwt.claim.role',p_role,true);
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
end;$$;
create temporary table admission_facts_case(response jsonb) on commit drop;
create temporary table admission_facts_rows(response jsonb) on commit drop;
grant select,insert on admission_facts_case,admission_facts_rows to authenticated,service_role;
select pg_temp.set_admission_facts_actor('authenticated','99870000-0000-4000-8000-000000000001');
set local role authenticated;
insert into admission_facts_case(response)
select public.create_registration_case('입학 안내 학생','중1','입학안내중','01099870001',null,'본관',now(),array['영어'],'사실 기반 입학 안내','normal','admission-facts-create');
insert into admission_facts_rows(response)
select public.save_registration_enrollment_details_v1(
  (response->'tracks'->0->>'id')::uuid,
  '[{"classId":"99870000-0000-4000-8000-000000000010","textbookId":null,"classStartDate":"2026-09-14","classStartSessionKey":"2026-09-14:1","classStartSession":"1회차","classStartLessonSessionId":null,"classStartSourceObservationId":null,"sortOrder":0}]',
  'admission-facts-enrollment') from admission_facts_case;
set local role postgres;
select is((select pipeline_status from public.ops_registration_subject_tracks where task_id=(select (response->>'taskId')::uuid from admission_facts_case)),
  'inquiry','Real flat create and enrollment save retain inquiry pipeline metadata');
select ok((select not (response->>'externalReconciliationRequired')::boolean from admission_facts_rows),
  'Real fact save creates canonical unbatched planned enrollment');

create temporary table admission_facts_no_send on commit drop as
select jsonb_build_object('messages',(select count(*) from public.ops_registration_customer_messages),
  'events',(select count(*) from dashboard_private.notification_events),
  'deliveries',(select count(*) from dashboard_private.notification_deliveries),
  'legacyMessages',(select count(*) from public.ops_registration_messages)) counts;
select pg_temp.set_admission_facts_actor('service_role','99870000-0000-4000-8000-000000000001');
create function pg_temp.resolve_admission_facts(p_actor uuid default '99870000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
  select public.resolve_registration_customer_message_source_v1(p_actor,'admission_application',
    (select (response->>'taskId')::uuid from admission_facts_case));
$$;
create temporary table admission_facts_preview on commit drop as select pg_temp.resolve_admission_facts() response;
select is((select jsonb_array_length(response->'enrollmentPlans') from admission_facts_preview),1,
  'Final public source resolves a saved planned enrollment before manual status changes');
select is((select response->'tracks'->0->>'pipelineStatus' from admission_facts_preview),'inquiry',
  'Preview preserves the factual pipeline metadata instead of manufacturing an admission status');
select is((select response->'enrollmentPlans'->0->'firstLesson'->>'startTime' from admission_facts_preview),'17:00',
  'Preview retains complete authoritative first-lesson time');
select is((select response->'enrollmentPlans'->0->'slots'->0->>'teacherName' from admission_facts_preview),'입학 안내 선생님',
  'Preview retains saved class teacher details');
select is(jsonb_build_object('messages',(select count(*) from public.ops_registration_customer_messages),
  'events',(select count(*) from dashboard_private.notification_events),
  'deliveries',(select count(*) from dashboard_private.notification_deliveries),
  'legacyMessages',(select count(*) from public.ops_registration_messages)),
  (select counts from admission_facts_no_send),'Resolving preview facts creates no messages or notification deliveries');
select throws_ok($$select pg_temp.resolve_admission_facts('99870000-0000-4000-8000-000000000002')$$,
  '42501','registration_customer_message_access_denied','A teacher cannot acquire the manager-only send source');

update public.ops_registration_subject_tracks set workflow_status='consultation_requested'
where task_id=(select (response->>'taskId')::uuid from admission_facts_case);
select lives_ok($$select pg_temp.resolve_admission_facts()$$,'Manual workflow metadata does not control saved-facts admission eligibility');
update public.ops_registration_subject_tracks set migration_review_required=true,pipeline_status='migration_review'
where task_id=(select (response->>'taskId')::uuid from admission_facts_case);
select throws_ok($$select pg_temp.resolve_admission_facts()$$,'22023','registration_customer_message_admission_schedule_incomplete',
  'Ambiguous migration-review subjects remain excluded');
update public.ops_registration_subject_tracks set migration_review_required=false,pipeline_status='inquiry',archived_at=now(),archived_by='99870000-0000-4000-8000-000000000001'
where task_id=(select (response->>'taskId')::uuid from admission_facts_case);
select throws_ok($$select pg_temp.resolve_admission_facts()$$,'22023','registration_customer_message_admission_schedule_incomplete',
  'Archived subjects stay outside the final delegated source');
select throws_ok($$select dashboard_private.registration_customer_message_admission_plan_v1(
  (select id from public.ops_registration_enrollments where track_id=(select (response->'tracks'->0->>'id')::uuid from admission_facts_case)),0)$$,
  '22023','registration_customer_message_admission_schedule_incomplete','Direct private plan reader also rejects archived subjects');
update public.ops_registration_subject_tracks set archived_at=null,archived_by=null
where task_id=(select (response->>'taskId')::uuid from admission_facts_case);

update public.ops_registration_enrollments set status='canceled'
where track_id=(select (response->'tracks'->0->>'id')::uuid from admission_facts_case);
select throws_ok($$select pg_temp.resolve_admission_facts()$$,'22023','registration_customer_message_admission_schedule_incomplete',
  'Canceled enrollments cannot reappear in an admission preview');
update public.ops_registration_enrollments set status='planned'
where track_id=(select (response->'tracks'->0->>'id')::uuid from admission_facts_case);
update public.classes set schedule='월 17:00' where id='99870000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.resolve_admission_facts()$$,'22023','registration_customer_message_admission_schedule_incomplete',
  'Missing schedule end time remains a precise non-retryable validation failure');
update public.classes set schedule='월 17:00-19:00',subject='수학' where id='99870000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.resolve_admission_facts()$$,'22023','registration_customer_message_admission_schedule_incomplete',
  'Class and subject identity mismatch remains rejected');
update public.classes set subject='영어' where id='99870000-0000-4000-8000-000000000010';
update public.ops_registration_details set parent_phone='02-0000-0000'
where task_id=(select (response->>'taskId')::uuid from admission_facts_case);
select throws_ok($$select pg_temp.resolve_admission_facts()$$,'22023','registration_customer_message_source_invalid',
  'Invalid recipient identity remains rejected');
update public.ops_registration_details set parent_phone='01099870001',admission_notice_sent=true
where task_id=(select (response->>'taskId')::uuid from admission_facts_case);
select throws_ok($$select pg_temp.resolve_admission_facts()$$,'23505','registration_customer_message_admission_already_sent',
  'Already-sent admission checklist prevents duplicate preview');
update public.ops_registration_details set admission_notice_sent=false
where task_id=(select (response->>'taskId')::uuid from admission_facts_case);
insert into public.ops_registration_messages(task_id,template_key,request_key,status,claim_active)
select (response->>'taskId')::uuid,'admission_application','admission-facts-legacy-claim','pending',true from admission_facts_case;
select throws_ok($$select pg_temp.resolve_admission_facts()$$,'23505','registration_customer_message_admission_already_sent',
  'An active legacy admission claim remains an exclusive duplicate-send barrier');
delete from public.ops_registration_messages where request_key='admission-facts-legacy-claim';

insert into public.students(id,name,class_ids,waitlist_class_ids)
values('99870000-0000-4000-8000-000000000030','입학 배치 학생','[]','[]');
insert into public.ops_registration_admission_batches(id,task_id,revision_number,status)
select '99870000-0000-4000-8000-000000000040',(response->>'taskId')::uuid,1,'draft' from admission_facts_case;
update public.ops_registration_enrollments set admission_batch_id='99870000-0000-4000-8000-000000000040',
  student_id='99870000-0000-4000-8000-000000000030',roster_active=true
where track_id=(select (response->'tracks'->0->>'id')::uuid from admission_facts_case);
select throws_ok($$select pg_temp.resolve_admission_facts()$$,'22023','registration_customer_message_admission_schedule_incomplete',
  'Already-batched planned enrollment remains excluded');

select ok(not has_function_privilege('authenticated','public.resolve_registration_customer_message_source_v1(uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.resolve_registration_customer_message_source_v1(uuid,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.resolve_registration_customer_message_source_v1(uuid,text,uuid)','EXECUTE'),
  'Public source keeps its service-role-only ACL');
select ok(not has_function_privilege('service_role','dashboard_private.registration_customer_message_admission_plan_v1(uuid,integer)','EXECUTE')
  and not has_function_privilege('authenticated','dashboard_private.registration_customer_message_admission_plan_v1(uuid,integer)','EXECUTE')
  and not has_function_privilege('service_role','dashboard_private.resolve_registration_customer_message_source_pre_booking_eligib(text,uuid)','EXECUTE'),
  'Private admission helpers retain private ACLs');
select * from finish();
rollback;
