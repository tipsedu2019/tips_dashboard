begin;
select no_plan();
set local statement_timeout='120s';
set local lock_timeout='5s';
create temp table explicit_auto_baseline on commit drop as select
 (select count(*) from dashboard_private.registration_observation_chat_jobs) jobs,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.ops_registration_customer_messages) customer_messages;
create temp table chat_lifecycle_clock(
  session_date date not null,
  start_time time not null,
  end_time time not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occurred_at timestamptz not null
) on commit drop;
insert into chat_lifecycle_clock
select
  local_start::date,
  local_start::time,
  local_end::time,
  local_start at time zone 'Asia/Seoul',
  local_end at time zone 'Asia/Seoul',
  (local_start at time zone 'Asia/Seoul') - interval '3 hours'
from (
  select local_start,
    least(
      local_start + interval '2 hours',
      pg_catalog.date_trunc('day', local_start) + interval '23 hours 59 minutes'
    ) as local_end
  from (
    select pg_catalog.date_trunc(
      'minute', pg_catalog.clock_timestamp() at time zone 'Asia/Seoul'
    ) - interval '1 day' as local_start
  ) raw_clock
) clock;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '94980000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','chat-contract-teacher@example.invalid',
  crypt('chat-contract-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  now(),now()
);
insert into public.profiles(id,role,name,email,created_at,updated_at)
values (
  '94980000-0000-4000-8000-000000000001','admin','청강 계약 선생님',
  'chat-contract-teacher@example.invalid',now(),now()
)
on conflict (id) do update set
  role=excluded.role,name=excluded.name,email=excluded.email,updated_at=excluded.updated_at;
delete from public.teacher_catalogs
where profile_id = '94980000-0000-4000-8000-000000000001';
insert into public.teacher_catalogs(
  id,name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role
)
values (
  '94980000-0000-4000-8000-000000000101','청강 계약 선생님',
  array['영어']::text[],true,9941,
  '94980000-0000-4000-8000-000000000001',
  'chat-contract-teacher@example.invalid','teacher'
);
update public.profiles
set teacher_catalog_id='94980000-0000-4000-8000-000000000101'
where id='94980000-0000-4000-8000-000000000001';
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '94980000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','chat-contract-teacher-b@example.invalid',
  crypt('chat-contract-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  now(),now()
);
insert into public.profiles(id,role,name,email,created_at,updated_at)
values (
  '94980000-0000-4000-8000-000000000003','teacher','청강 계약 선생님 B',
  'chat-contract-teacher-b@example.invalid',now(),now()
)
on conflict (id) do update set
  role=excluded.role,name=excluded.name,email=excluded.email,updated_at=excluded.updated_at;
delete from public.teacher_catalogs
where profile_id = '94980000-0000-4000-8000-000000000003';
insert into public.teacher_catalogs(
  id,name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role
)
values (
  '94980000-0000-4000-8000-000000000203','청강 계약 선생님 B',
  array['영어']::text[],true,9944,
  '94980000-0000-4000-8000-000000000003',
  'chat-contract-teacher-b@example.invalid','teacher'
);
update public.profiles
set teacher_catalog_id='94980000-0000-4000-8000-000000000203'
where id='94980000-0000-4000-8000-000000000003';
insert into public.classroom_catalogs(
  id,name,subjects,is_visible,sort_order,campus
)
values (
  '94980000-0000-4000-8000-000000000102','청강 계약 301호',
  array['영어']::text[],true,9942,'본관'
);
insert into public.classes(
  id,name,subject,status,schedule_storage_mode,schedule_plan
)
values (
  '94980000-0000-4000-8000-000000000103','청강 계약 영어반','영어',
  '수업 진행 중','normalized','{}'::jsonb
);
do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '94980000-0000-4000-8000-000000000103',
    '94980000-0000-4000-8000-000000000199',
    'registration_observation_explicit_chat_test'
  );
end;
$$;
insert into public.class_lesson_sessions(
  id,class_id,session_key,session_date,schedule_state,start_time,end_time,
  teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,
  classroom_name_snapshot,origin,revision
)
select
  '94980000-0000-4000-8000-000000000104',
  '94980000-0000-4000-8000-000000000103',
  pg_catalog.to_char(clock.session_date,'YYYY-MM-DD') || ':chat-contract',
  clock.session_date,'active',clock.start_time,clock.end_time,
  '94980000-0000-4000-8000-000000000101','청강 계약 선생님',
  '94980000-0000-4000-8000-000000000102','청강 계약 301호','manual',7
from chat_lifecycle_clock clock;
insert into public.ops_tasks(
  id,title,type,status,priority,requested_by,assignee_id,
  secondary_assignee_id,student_name
)
values (
  '94980000-0000-4000-8000-000000000105','청강 Chat 계약 fixture',
  'registration','requested','normal',
  '94980000-0000-4000-8000-000000000001',
  '94980000-0000-4000-8000-000000000001',
  '94980000-0000-4000-8000-000000000001','합성 청강학생'
);
insert into public.ops_registration_details(task_id)
values ('94980000-0000-4000-8000-000000000105');
insert into public.ops_registration_subject_tracks(
  id,task_id,subject,pipeline_status,director_profile_id,
  director_assignment_source,director_assigned_at,migration_review_required,
  workflow_status,workflow_revision,workflow_status_entered_at,
  observation_return_workflow_status,observation_attempt_count
)
values (
  '94980000-0000-4000-8000-000000000106',
  '94980000-0000-4000-8000-000000000105','영어','consultation_waiting',
  '94980000-0000-4000-8000-000000000001','manual',now(),false,
  'observation_requested',1,now(),'consultation_completed',0
);
insert into public.ops_registration_appointments(
  id,task_id,kind,scheduled_at,place,status,notification_revision,created_by
)
select
  '94980000-0000-4000-8000-000000000107',
  '94980000-0000-4000-8000-000000000105','observation_class',
  clock.starts_at,'본관','scheduled',1,
  '94980000-0000-4000-8000-000000000001'
from chat_lifecycle_clock clock;
insert into public.ops_registration_observations(
  id,task_id,track_id,appointment_id,class_id,
  session_authority,class_lesson_session_id,legacy_session_key,
  session_date,starts_at,ends_at,session_schedule_state,
  session_source_revision,legacy_session_source_hash,source_revision,
  booking_fact_hash,teacher_catalog_id,teacher_profile_id,
  classroom_catalog_id,subject,class_name_snapshot,teacher_name_snapshot,
  classroom_name_snapshot,campus,textbook_snapshot,progress_snapshot,
  created_by,updated_by
)
select
  '94980000-0000-4000-8000-000000000108',
  '94980000-0000-4000-8000-000000000105',
  '94980000-0000-4000-8000-000000000106',
  '94980000-0000-4000-8000-000000000107',
  '94980000-0000-4000-8000-000000000103',
  'normalized','94980000-0000-4000-8000-000000000104',null,
  clock.session_date,clock.starts_at,clock.ends_at,'active',7,null,
  jsonb_build_object(
    'authority','normalized',
    'sessionId','94980000-0000-4000-8000-000000000104',
    'revision',7
  ),
  dashboard_private.registration_observation_booking_fact_hash_v1(
    jsonb_build_object(
      'classId','94980000-0000-4000-8000-000000000103'::uuid,
      'subject','영어','sessionAuthority','normalized',
      'classLessonSessionId','94980000-0000-4000-8000-000000000104'::uuid,
      'legacySessionKey',null,'sessionKey',
        pg_catalog.to_char(clock.session_date,'YYYY-MM-DD') || ':chat-contract',
      'scheduleState','active','sessionDate',clock.session_date,
      'startsAt',clock.starts_at,'endsAt',clock.ends_at,
      'teacherCatalogId','94980000-0000-4000-8000-000000000101'::uuid,
      'teacherProfileId','94980000-0000-4000-8000-000000000001'::uuid,
      'teacherName','청강 계약 선생님',
      'classroomCatalogId','94980000-0000-4000-8000-000000000102'::uuid,
      'classroomName','청강 계약 301호','campus','본관'
    )
  ),
  '94980000-0000-4000-8000-000000000101',
  '94980000-0000-4000-8000-000000000001',
  '94980000-0000-4000-8000-000000000102','영어','청강 계약 영어반',
  '청강 계약 선생님','청강 계약 301호','본관',
  '["능률 VOCA"]'::jsonb,'42~49쪽',
  '94980000-0000-4000-8000-000000000001',
  '94980000-0000-4000-8000-000000000001'
from chat_lifecycle_clock clock;

insert into dashboard_private.google_chat_profile_identities(profile_id,account_email_snapshot,chat_user_id,source,verification_status,verified_at,last_sync_status,last_sync_at,identity_revision)
values('94980000-0000-4000-8000-000000000001','chat-contract-teacher@example.invalid','994800001','manual','verified',now(),'ok',now(),1);
insert into public.google_chat_webhook_settings(channel,webhook_url,connection_state,revision)
values('english','https://chat.googleapis.com/v1/spaces/fixture/messages?key=fixture&token=fixture','legacy_active',1)
on conflict(channel) do update set webhook_url=excluded.webhook_url,connection_state=excluded.connection_state,revision=excluded.revision;

create function pg_temp.explicit_claims(p_actor uuid,p_role text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role',p_role)::text,true);
 perform set_config('request.jwt.claim.sub',coalesce(p_actor::text,''),true);
 perform set_config('request.jwt.claim.role',p_role,true);
end;
$$;
select ok((select relrowsecurity from pg_class where oid='dashboard_private.registration_observation_explicit_chat_attempts'::regclass), 'explicit receipts keep RLS enabled');
select ok(not has_table_privilege('authenticated','dashboard_private.registration_observation_explicit_chat_attempts','select')
 and not has_table_privilege('service_role','dashboard_private.registration_observation_explicit_chat_attempts','insert'), 'receipt table is private even to application service clients');
select ok(has_function_privilege('authenticated','public.get_registration_observation_explicit_chat_preview_v1(uuid,text)','execute')
 and not has_function_privilege('anon','public.get_registration_observation_explicit_chat_preview_v1(uuid,text)','execute')
 and not has_function_privilege('authenticated','public.begin_registration_observation_explicit_chat_v1(uuid,text,text,uuid,uuid)','execute')
 and has_function_privilege('service_role','public.begin_registration_observation_explicit_chat_v1(uuid,text,text,uuid,uuid)','execute'), 'read and dispatch capabilities use separate ACLs');
select is((select proconfig from pg_proc where oid='public.begin_registration_observation_explicit_chat_v1(uuid,text,text,uuid,uuid)'::regprocedure),array['search_path=""'],'dispatch RPC has an empty search path');
select pg_temp.explicit_claims('94980000-0000-4000-8000-000000000001','authenticated');
create temp table explicit_preview on commit drop as select public.get_registration_observation_explicit_chat_preview_v1('94980000-0000-4000-8000-000000000108','handoff') payload;
select ok((select (payload->>'canSend')::boolean and payload->>'targetLabel'='영어팀 · 청강 계약 선생님 선생님' from explicit_preview),'preview identifies the current subject room and teacher');
select is((select count(*) from dashboard_private.registration_observation_explicit_chat_attempts),0::bigint,'reading the preview creates no send reservation');
select pg_temp.explicit_claims('94980000-0000-4000-8000-000000000003','authenticated');
select throws_ok($$select public.get_registration_observation_explicit_chat_preview_v1('94980000-0000-4000-8000-000000000108','handoff')$$,'42501','notification_access_denied','teacher cannot initiate staff handoff');
select pg_temp.explicit_claims(null,'service_role');
select throws_ok($$select public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','handoff',repeat('0',64),'94980000-0000-4000-8000-000000000301','94980000-0000-4000-8000-000000000001')$$,
 '23514','registration_observation_chat_source_changed','begin checks the exact reviewed source fingerprint');
create temp table explicit_begin on commit drop as select public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','handoff',(select payload->>'previewChecksum' from explicit_preview),'94980000-0000-4000-8000-000000000302','94980000-0000-4000-8000-000000000001') payload;
select ok((select (payload->>'acquired')::boolean from explicit_begin),'first confirmed send acquires a unique prepared receipt');
select is(public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','handoff',(select payload->>'previewChecksum' from explicit_preview),'94980000-0000-4000-8000-000000000302','94980000-0000-4000-8000-000000000001')->>'status','unknown','interrupted request replay cannot reacquire a claim');
select throws_ok($$select public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','handoff',repeat('0',64),'94980000-0000-4000-8000-000000000302','94980000-0000-4000-8000-000000000001')$$,
 '23514','idempotency_key_reused','one confirmation key cannot change its reviewed source');
select throws_ok($$do $drift$ begin
 update public.ops_tasks set student_name='변경된 합성 학생' where id='94980000-0000-4000-8000-000000000105';
 perform public.register_registration_observation_explicit_chat_attempt_v1((select (payload->>'attemptId')::uuid from explicit_begin),(select (payload->>'claimToken')::uuid from explicit_begin));
end $drift$;$$,'23514','registration_observation_chat_source_changed','final external-attempt gate rejects changed student/source content');
select throws_ok($$do $drift$ begin
 update dashboard_private.google_chat_profile_identities set identity_revision=identity_revision+1 where profile_id='94980000-0000-4000-8000-000000000001';
 perform public.register_registration_observation_explicit_chat_attempt_v1((select (payload->>'attemptId')::uuid from explicit_begin),(select (payload->>'claimToken')::uuid from explicit_begin));
end $drift$;$$,'23514','registration_observation_chat_source_changed','final gate rejects a changed teacher Chat identity');
select throws_ok($$do $drift$ begin
 update public.google_chat_webhook_settings set revision=revision+1 where channel='english';
 perform public.register_registration_observation_explicit_chat_attempt_v1((select (payload->>'attemptId')::uuid from explicit_begin),(select (payload->>'claimToken')::uuid from explicit_begin));
end $drift$;$$,'23514','registration_observation_chat_source_changed','final gate rejects a changed destination revision');
select is((select count(*) from dashboard_private.registration_observation_explicit_chat_attempts where external_attempt_at is not null),0::bigint,'rejected final checks register zero external attempts');
select ok(public.register_registration_observation_explicit_chat_attempt_v1((select (payload->>'attemptId')::uuid from explicit_begin),(select (payload->>'claimToken')::uuid from explicit_begin)),'current source registers exactly one external attempt');
select ok(not public.register_registration_observation_explicit_chat_attempt_v1((select (payload->>'attemptId')::uuid from explicit_begin),(select (payload->>'claimToken')::uuid from explicit_begin)),'same claim cannot register a second HTTP attempt');
select public.finish_registration_observation_explicit_chat_v1((select (payload->>'attemptId')::uuid from explicit_begin),(select (payload->>'claimToken')::uuid from explicit_begin),'sent','fixture-only');
select is(public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','handoff',(select payload->>'previewChecksum' from explicit_preview),'94980000-0000-4000-8000-000000000303','94980000-0000-4000-8000-000000000001')->>'status','sent','new request key cannot resend an unchanged successful handoff');

create temp table explicit_feedback on commit drop as select public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','feedback_request',
 dashboard_private.registration_observation_explicit_chat_context_v1('94980000-0000-4000-8000-000000000108','feedback_request')->>'previewChecksum',
 '94980000-0000-4000-8000-000000000304','94980000-0000-4000-8000-000000000001') payload;
select ok((select (payload->>'acquired')::boolean from explicit_feedback),'after-class feedback request is an independent explicit intent');
select public.finish_registration_observation_explicit_chat_v1((select (payload->>'attemptId')::uuid from explicit_feedback),(select (payload->>'claimToken')::uuid from explicit_feedback),'unknown','fixture-only');
update public.ops_tasks set student_name='새 합성 학생' where id='94980000-0000-4000-8000-000000000105';
select is(public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','feedback_request',
 dashboard_private.registration_observation_explicit_chat_context_v1('94980000-0000-4000-8000-000000000108','feedback_request')->>'previewChecksum',
 '94980000-0000-4000-8000-000000000305','94980000-0000-4000-8000-000000000001')->>'status','unknown','unknown blocks another request even when the source has changed');
create temp table explicit_failed on commit drop as select public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','handoff',
 dashboard_private.registration_observation_explicit_chat_context_v1('94980000-0000-4000-8000-000000000108','handoff')->>'previewChecksum',
 '94980000-0000-4000-8000-000000000306','94980000-0000-4000-8000-000000000001') payload;
select public.finish_registration_observation_explicit_chat_v1((select (payload->>'attemptId')::uuid from explicit_failed),(select (payload->>'claimToken')::uuid from explicit_failed),'failed','fixture-pre-dispatch-rejection');
select ok((public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','handoff',
 dashboard_private.registration_observation_explicit_chat_context_v1('94980000-0000-4000-8000-000000000108','handoff')->>'previewChecksum',
 '94980000-0000-4000-8000-000000000307','94980000-0000-4000-8000-000000000001')->>'acquired')::boolean,'definite failure permits one newly confirmed manual retry');
select is(public.begin_registration_observation_explicit_chat_v1('94980000-0000-4000-8000-000000000108','handoff',
 dashboard_private.registration_observation_explicit_chat_context_v1('94980000-0000-4000-8000-000000000108','handoff')->>'previewChecksum',
 '94980000-0000-4000-8000-000000000306','94980000-0000-4000-8000-000000000001')->>'status','failed','replaying a failed request preserves its original receipt');
select throws_ok($$do $archive$ begin
 update public.ops_registration_subject_tracks set archived_at=now(), archived_by='94980000-0000-4000-8000-000000000001' where id='94980000-0000-4000-8000-000000000106';
 perform dashboard_private.registration_observation_explicit_chat_context_v1('94980000-0000-4000-8000-000000000108','handoff');
end $archive$;$$,'P0002','registration_observation_notification_source_missing','archived subject cannot be handed off by the new explicit path');
select is((select count(*) from dashboard_private.registration_observation_chat_jobs),(select jobs from explicit_auto_baseline),'no retired automatic jobs are created');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from explicit_auto_baseline),'no canonical or legacy worker deliveries are materialized');
select is((select count(*) from public.ops_registration_customer_messages),(select customer_messages from explicit_auto_baseline),'staff handoff creates no customer messages');
select * from finish();
rollback;
