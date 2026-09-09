begin;
set local search_path=extensions,public;
set local statement_timeout='120s';
set local lock_timeout='5s';
select no_plan();

select is((select count(*)::integer from pg_constraint
  where conrelid='dashboard_private.notification_rules'::regclass
    and conname in ('notification_rules_workflow_audience_check',
      'notification_rules_word_retest_chat_retired_check')
    and convalidated),2,'Both subject notification constraints are validated in the final migration chain');

select ok(strpos(pg_get_functiondef('public.revalidate_immediate_notification_delivery_v1(text,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)'::regprocedure),
  'when ''google_chat.science'' then ''science''')>0,
  'Final revalidator preserves the existing Science connection mapping');
select ok(strpos(pg_get_functiondef('public.revalidate_immediate_notification_delivery_v1(text,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)'::regprocedure),
  'v_delivery.audience_key = ''subject_team''')>0
  and strpos(pg_get_functiondef('public.revalidate_immediate_notification_delivery_v1(text,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)'::regprocedure),
  'notification_profile_is_active_v1')>0,
  'Final revalidator preserves existing subject-audience and active-profile protections');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('99880000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','subject-admin@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('99880000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','subject-teacher@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.profiles(id,role,name,email) values
('99880000-0000-4000-8000-000000000001','admin','과목팀 관리자','subject-admin@example.invalid'),
('99880000-0000-4000-8000-000000000002','teacher','과목팀 교사','subject-teacher@example.invalid')
on conflict(id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
insert into public.academic_subject_settings(subject,is_active,registration_create_enabled,grade_levels,sort_order)
values('영어',true,true,array['중1'],10) on conflict(subject) do update set is_active=true,registration_create_enabled=true,grade_levels=excluded.grade_levels;
select set_config('request.jwt.claims','{"sub":"99880000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','99880000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
create temporary table subject_results(k text primary key,v jsonb) on commit drop;
grant all on subject_results to authenticated,service_role;

select is((select count(*)::integer from dashboard_private.notification_rules where audience_key='subject_team' and enabled
  and event_key in ('registration.subject_registration_completed','transfer.completed','withdrawal.completed','word_retest.result_reported')),4,
  'Only four immediate subject-team rules are added');
select is((select count(*)::integer from dashboard_private.notification_rules rule_row
  join dashboard_private.notification_template_compliance_audits audit on audit.template_id=rule_row.active_template_id
  where rule_row.audience_key='subject_team' and rule_row.event_key in
  ('registration.subject_registration_completed','transfer.completed','withdrawal.completed','word_retest.result_reported')
  and audit.compliance='conformant'),4,
  'All four new templates have the compliance evidence required by the real settings snapshot');
select is((select count(*)::integer from dashboard_private.notification_rules where workflow_key='word_retests' and channel_key='google_chat' and enabled
  and (event_key<>'word_retest.result_reported' or audience_key<>'subject_team')),0,'All other word-retest Chat rules remain retired');
select throws_ok($$update dashboard_private.notification_rules set event_key='word_retest.completed'
  where workflow_key='word_retests' and channel_key='google_chat' and audience_key='subject_team'$$,'23514',null,
  'A settings mutation cannot broaden the result-only retired exception');
select is((select count(*)::integer from dashboard_private.notification_rules where audience_key='subject_team' and event_key in
  ('registration.subject_registration_completed','transfer.completed','withdrawal.completed','word_retest.result_reported') and delivery_mode='scheduled'),0,
  'No follow-up due schedule is introduced');

set local role authenticated;
insert into subject_results values('case',public.create_registration_case('과목팀 등록 학생','중1','검증중','01099880001',null,'본관',now(),array['영어'],'완료 알림 검증','normal','subject-create'));
insert into subject_results select 'checklist',public.set_registration_admission_checklist_item_v1((v->>'taskId')::uuid,'registrationCompleted',true,'subject-checklist') from subject_results where k='case';
reset role;
select is((select count(*)::integer from dashboard_private.notification_events where event_key='registration.subject_registration_completed'),0,
  'Registration checklist remains a silent independent fact');
set local role authenticated;
insert into subject_results select 'registered',public.set_registration_workflow_status_v1((v->'tracks'->0->>'id')::uuid,'registered',1,'subject-register') from subject_results where k='case';
insert into subject_results select 'replayed',public.set_registration_workflow_status_v1((v->'tracks'->0->>'id')::uuid,'registered',1,'subject-register') from subject_results where k='case';
insert into subject_results select 'unchanged',public.set_registration_workflow_status_v1((v->'tracks'->0->>'id')::uuid,'registered',2,'subject-nochange') from subject_results where k='case';
reset role;
select is((select count(*)::integer from dashboard_private.notification_events where event_key='registration.subject_registration_completed'),1,
  'A real transition to registered emits once through canonical source recording');
select is((select v->'sourceEventIds' from subject_results where k='registered'),(select v->'sourceEventIds' from subject_results where k='replayed'),
  'Status request replay returns the exact original notification source');
select is((select v->'sourceEventIds' from subject_results where k='unchanged'),'[]'::jsonb,'Saving the same status creates no second source');
select is((select v->'enrollmentFinalization' from subject_results where k='registered'),'null'::jsonb,'Workflow status still does not perform enrollment finalization');
select is((select payload->'notification_subjects' from dashboard_private.notification_events where event_key='registration.subject_registration_completed'),'["영어"]'::jsonb,
  'Registration routing is derived from the active subject track');
select set_config('request.jwt.claim.role','service_role',true);
insert into subject_results select 'registration-plan',public.get_ops_task_legacy_dispatch_plan_v1((v->'sourceEventIds'->>0)::uuid,'99880000-0000-4000-8000-000000000001') from subject_results where k='registered';
select is((select v->'items'->0->>'connectionKey' from subject_results where k='registration-plan'),'google_chat.english','Registration legacy plan resolves the English team connection');
select is((select v->'items'->0->>'renderedBody' from subject_results where k='registration-plan'),E'[학생] 과목팀 등록 학생\n[과목] 영어\n[상태] 등록 완료',
  'Registration template renders the factual completion copy');
select throws_ok($$select public.get_ops_task_legacy_dispatch_plan_v1((select (v->'sourceEventIds'->>0)::uuid from subject_results where k='registered'),'99880000-0000-4000-8000-000000000002')$$,
  '42501','ops_task_legacy_dispatch_forbidden','An unrelated teacher cannot acquire a registration completion plan');
update public.ops_registration_subject_tracks set workflow_status='payment_in_progress',workflow_revision=workflow_revision+1
where id=(select (v->'tracks'->0->>'id')::uuid from subject_results where k='case');
select is((public.get_ops_task_legacy_dispatch_plan_v1((select (v->'sourceEventIds'->>0)::uuid from subject_results where k='registered'),'99880000-0000-4000-8000-000000000001')->'items'),'[]'::jsonb,
  'A later workflow change suppresses the stale subject completion plan');

-- Use the real transfer and withdrawal completion RPCs, preserving their
-- existing roster validation and notification trigger chain.
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.students(id,name,status,parent_contact,class_ids,waitlist_class_ids) values
('99880000-0000-4000-8000-000000000010','전반 학생','재원','01099880010','["99880000-0000-4000-8000-000000000020"]','[]'),
('99880000-0000-4000-8000-000000000011','퇴원 학생','재원','01099880011','["99880000-0000-4000-8000-000000000022"]','[]');
insert into public.academic_subject_settings(subject,is_active,registration_create_enabled,grade_levels,sort_order)
values('과학',true,true,array['고1'],30) on conflict(subject) do nothing;
insert into public.academic_subject_areas(subject,area_key,label,is_active,sort_order)
values('과학','integrated_science','통합과학',true,999) on conflict(subject,area_key) do update set is_active=true;
insert into public.classes(id,name,subject,teacher,schedule,room,status,student_ids,waitlist_ids,grade,subject_area_key) values
('99880000-0000-4000-8000-000000000020','전반 이전반','영어','과목팀 교사','월 17:00-19:00','본관1','수업 진행 중','["99880000-0000-4000-8000-000000000010"]','[]','중1',null),
('99880000-0000-4000-8000-000000000021','전반 이후반','영어','과목팀 교사','화 17:00-19:00','본관1','수업 진행 중','[]','[]','중1',null),
('99880000-0000-4000-8000-000000000022','퇴원 과학반','과학','과목팀 교사','수 17:00-19:00','본관1','수업 진행 중','["99880000-0000-4000-8000-000000000011"]','[]','고1','integrated_science');
do $custom_management$
declare v_rule uuid; v_version bigint;
begin
  select id into v_rule from dashboard_private.notification_rules where event_key='transfer.completed'
    and channel_key='google_chat' and audience_key='management_team' and rule_variant_key='immediate';
  if v_rule is null then
    v_rule:='99880000-0000-4000-8000-000000000070';
    insert into dashboard_private.notification_rules(id,workflow_key,event_key,channel_key,audience_key,rule_variant_key,
      delivery_mode,enabled,active_template_id,created_actor_kind,updated_actor_kind)
    values(v_rule,'transfer','transfer.completed','google_chat','management_team','immediate','immediate',true,
      '99880000-0000-4000-8000-000000000071','system','system');
  else
    update dashboard_private.notification_rules set enabled=true,active_template_id='99880000-0000-4000-8000-000000000071' where id=v_rule;
  end if;
  select coalesce(max(version),0)+1 into v_version from dashboard_private.notification_templates where rule_id=v_rule;
  insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,allowed_variables,
    payload_schema_version,checksum,created_actor_kind)
  values('99880000-0000-4000-8000-000000000071',v_rule,v_version,'관리팀 기존 맞춤: {학생}',E'기존 문구\n{전 수업 종료일}',
    '[]',1,repeat('a',64),'system');
  insert into dashboard_private.notification_settings_ui_registry(rule_id,workflow_key,workflow_label,workflow_sort,event_key,
    event_label,group_label,trigger_description,event_sort,audience_key,audience_label,channel_key,channel_label,cell_sort,initial_enabled)
  values(v_rule,'transfer','전반',4,'transfer.completed','완료','전반','완료 시',2,'management_team','관리팀','google_chat','Google Chat',1,true)
  on conflict do nothing;
end;
$custom_management$;
insert into public.ops_tasks(id,title,type,status,requested_by,student_id,student_name,class_id,class_name) values
('99880000-0000-4000-8000-000000000030','전반 완료 검증','transfer','requested','99880000-0000-4000-8000-000000000001','99880000-0000-4000-8000-000000000010','전반 학생','99880000-0000-4000-8000-000000000021','전반 이후반'),
('99880000-0000-4000-8000-000000000031','퇴원 완료 검증','withdrawal','requested','99880000-0000-4000-8000-000000000001','99880000-0000-4000-8000-000000000011','퇴원 학생','99880000-0000-4000-8000-000000000022','퇴원 과학반');
insert into public.ops_transfer_details(task_id,from_class_id,to_class_id,from_class_name,to_class_name,from_class_end_date,to_class_start_date,
  from_teacher_name,to_teacher_name,makeedu_transfer_done,fee_processed,textbook_fee_processed)
values('99880000-0000-4000-8000-000000000030','99880000-0000-4000-8000-000000000020','99880000-0000-4000-8000-000000000021',
  '전반 이전반','전반 이후반','2026-09-14','2026-09-15','과목팀 교사','과목팀 교사',true,true,true);
insert into public.ops_withdrawal_details(task_id,teacher_name,withdrawal_date,withdrawal_session,makeedu_withdrawal_done,fee_processed,textbook_fee_processed)
values('99880000-0000-4000-8000-000000000031','과목팀 교사','2026-09-16','3회차',true,true,true);
set local role authenticated;
insert into subject_results values('transfer',public.complete_ops_transfer_roster_transition_v2('99880000-0000-4000-8000-000000000030','99880000-0000-4000-8000-000000000040'));
insert into subject_results values('withdrawal',public.complete_ops_withdrawal_roster_transition_v2('99880000-0000-4000-8000-000000000031','99880000-0000-4000-8000-000000000041'));
reset role;
select is((select payload->'notification_subjects' from dashboard_private.notification_events where event_key='transfer.completed'),'["영어"]'::jsonb,
  'Real transfer completion deduplicates the same subject in before and after classes');
select is((select payload->'notification_subjects' from dashboard_private.notification_events where event_key='withdrawal.completed'),'["과학"]'::jsonb,
  'Real withdrawal completion addresses the selected class subject only');
select is((select payload->>'subjects' from dashboard_private.notification_events where event_key='withdrawal.completed'),'과학',
  'Existing withdrawal content field remains unchanged');
select set_config('request.jwt.claim.role','service_role',true);
insert into subject_results select 'transfer-plan',public.get_ops_task_legacy_dispatch_plan_v1(source_id::uuid,'99880000-0000-4000-8000-000000000001')
  from dashboard_private.notification_events where event_key='transfer.completed';
insert into subject_results select 'withdrawal-plan',public.get_ops_task_legacy_dispatch_plan_v1(source_id::uuid,'99880000-0000-4000-8000-000000000001')
  from dashboard_private.notification_events where event_key='withdrawal.completed';
select is((select count(*)::integer from subject_results r,jsonb_array_elements(r.v->'items') item where r.k='transfer-plan' and item->>'connectionKey'='google_chat.english'),1,
  'Transfer plan contains one English team target');
select is((select count(*)::integer from subject_results r,jsonb_array_elements(r.v->'items') item where r.k='withdrawal-plan' and item->>'connectionKey'='google_chat.science'),1,
  'Withdrawal plan contains one Science team target');
select is((select jsonb_agg(item) from subject_results r,jsonb_array_elements(r.v->'items') item
  where r.k='transfer-plan' and item->>'audienceKey'='management_team'),
  public.get_ops_task_legacy_dispatch_before_subject_completion_v1((select source_id::uuid from dashboard_private.notification_events where event_key='transfer.completed'),
    '99880000-0000-4000-8000-000000000001')->'items','Existing custom management plan survives byte-for-byte beside the subject plan');
update public.classes set subject='수학' where id='99880000-0000-4000-8000-000000000021';
select is(public.get_ops_task_legacy_dispatch_plan_v1((select source_id::uuid from dashboard_private.notification_events where event_key='transfer.completed'),
  '99880000-0000-4000-8000-000000000001')->'items',
  public.get_ops_task_legacy_dispatch_before_subject_completion_v1((select source_id::uuid from dashboard_private.notification_events where event_key='transfer.completed'),
    '99880000-0000-4000-8000-000000000001')->'items','A stale subject snapshot suppresses only the new audience and preserves the old management plan');
update public.classes set subject='영어' where id='99880000-0000-4000-8000-000000000021';

-- Report a real word-retest result. No other retired word event gets a route.
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.teacher_catalogs(id,name,profile_id) values('99880000-0000-4000-8000-000000000050','과목팀 교사','99880000-0000-4000-8000-000000000002')
on conflict do nothing;
set local role authenticated;
insert into subject_results values('word-created',public.create_ops_task_v2(jsonb_build_object(
  'task',jsonb_build_object('type','word_retest','title','재시험 결과 공유','status','requested'),
  'word_retest',jsonb_build_object('branch','본관','student_name','재시험 학생','teacher_catalog_id',(select id from public.teacher_catalogs where profile_id='99880000-0000-4000-8000-000000000002'),
    'class_name','영어반','test_at','2026-09-09T01:00:00Z','total_question_count',10,'cutoff_question_count',8,'retest_status','not_started')),
  '99880000-0000-4000-8000-000000000051'));
reset role;
insert into subject_results select 'word-id',to_jsonb(id) from public.ops_tasks where title='재시험 결과 공유';
set local role authenticated;
insert into subject_results select 'word-started',public.transition_ops_task_status_v2((v#>>'{}')::uuid,'in_progress',
  (select updated_at from public.ops_tasks where id=(v#>>'{}')::uuid),'99880000-0000-4000-8000-000000000052') from subject_results where k='word-id';
insert into subject_results select 'word-result',public.report_word_retest_result_v1((v#>>'{}')::uuid,'{"first_score":9}','99880000-0000-4000-8000-000000000053') from subject_results where k='word-id';
reset role;
select is((select payload->'notification_subjects' from dashboard_private.notification_events where event_key='word_retest.result_reported'),'["영어"]'::jsonb,
  'Result producer fixes the recipient subject to English');
select set_config('request.jwt.claim.role','service_role',true);
insert into subject_results select 'word-plan',public.get_ops_task_legacy_dispatch_plan_v1(source_id::uuid,'99880000-0000-4000-8000-000000000001')
  from dashboard_private.notification_events where event_key='word_retest.result_reported';
select is((select v->'items'->0->>'audienceKey' from subject_results where k='word-plan'),'subject_team','Result sharing cannot reuse retired management audience');
select is((select v->'items'->0->>'connectionKey' from subject_results where k='word-plan'),'google_chat.english','Only the English team receives a result plan');
update public.ops_word_retests set cutoff_question_count=10 where task_id=(select (v#>>'{}')::uuid from subject_results where k='word-id');
select is((public.get_ops_task_legacy_dispatch_plan_v1((select source_id::uuid from dashboard_private.notification_events where event_key='word_retest.result_reported'),
  '99880000-0000-4000-8000-000000000001')->'items'),'[]'::jsonb,'Threshold-only correction suppresses a stale passed result');
update public.ops_word_retests set cutoff_question_count=8 where task_id=(select (v#>>'{}')::uuid from subject_results where k='word-id');
update auth.users set banned_until=now()+interval '1 day' where id='99880000-0000-4000-8000-000000000001';
select throws_ok($$select public.get_ops_task_legacy_dispatch_plan_v1((select source_id::uuid from dashboard_private.notification_events where event_key='word_retest.result_reported'),
  '99880000-0000-4000-8000-000000000001')$$,'42501','ops_task_legacy_dispatch_forbidden','A banned actor cannot read a subject-team result plan');
update auth.users set banned_until=null where id='99880000-0000-4000-8000-000000000001';
select is((public.get_ops_task_legacy_dispatch_plan_v1((select source_id::uuid from dashboard_private.notification_events where event_key='word_retest.created'),
  '99880000-0000-4000-8000-000000000001')->'items'),'[]'::jsonb,'Word-retest creation remains retired for Google Chat');
select is((select count(*)::integer from dashboard_private.notification_audit_logs where action='external_attempt_registered'),0,
  'Source creation and plan reads never register an external send');
select is((select count(*)::integer from dashboard_private.notification_deliveries),0,'Sources and legacy plan previews do not create delivery attempts');
select ok(has_function_privilege('service_role','public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid)','execute')
  and not has_function_privilege('service_role','dashboard_private.get_subject_completion_legacy_plan_v1(uuid,uuid)','execute'),
  'Public legacy reader and private helper preserve ACL separation');

-- Exercise the final canonical revalidator with a real claimed delivery row.
-- The route remains legacy-owned in production; this is a local contract probe.
update public.ops_registration_subject_tracks set workflow_status='registered',workflow_revision=2
where id=(select (v->'tracks'->0->>'id')::uuid from subject_results where k='case');
insert into public.google_chat_webhook_settings(channel,webhook_url,connection_state)
values('english','https://chat.googleapis.com/v1/spaces/fixture-room/messages?key=local&token=local','legacy_active')
on conflict(channel) do update set webhook_url=excluded.webhook_url,connection_state=excluded.connection_state;
insert into dashboard_private.notification_deliveries(id,event_id,rule_id,rule_revision,template_id,channel_key,audience_key,
  target_generation,target_set_hash,target_kind,target_key,connection_key,target_snapshot,status,dedupe_key,
  rendered_title,rendered_body,href,scheduled_for,max_attempts,claimed_by,claim_token,lease_expires_at)
select '99880000-0000-4000-8000-000000000080',event_row.id,rule_row.id,rule_row.revision,rule_row.active_template_id,
  'google_chat','subject_team',0,'subject-fixture','connection','connection:google_chat.english','google_chat.english',
  '{"connection_key":"google_chat.english"}','claimed','subject-fixture','검증','검증','/admin/registration',event_row.occurred_at,
  3,'subject-fixture','99880000-0000-4000-8000-000000000081',now()+interval '5 minutes'
from dashboard_private.notification_events event_row join dashboard_private.notification_rules rule_row
  on rule_row.event_key=event_row.event_key and rule_row.audience_key='subject_team'
where event_row.event_key='registration.subject_registration_completed';
create function pg_temp.revalidate_subject_fixture() returns jsonb language sql as $$
  select public.revalidate_immediate_notification_delivery_v1(event_row.workflow_key,event_row.id,delivery.id,
    event_row.event_key,event_row.source_type,event_row.source_id,event_row.source_revision,delivery.rule_id,delivery.rule_revision,
    delivery.target_generation,delivery.scheduled_for,jsonb_build_object('target_kind',delivery.target_kind,'target_key',delivery.target_key,
      'target_profile_id',delivery.target_profile_id,'connection_key',delivery.connection_key,'target_snapshot',delivery.target_snapshot))
  from dashboard_private.notification_deliveries delivery join dashboard_private.notification_events event_row on event_row.id=delivery.event_id
  where delivery.id='99880000-0000-4000-8000-000000000080';
$$;
select is(pg_temp.revalidate_subject_fixture(),'{"ok":true}'::jsonb,'Final canonical revalidator accepts the exact active registered source and English target');
update dashboard_private.notification_deliveries set target_key='connection:google_chat.math',connection_key='google_chat.math',
  target_snapshot='{"connection_key":"google_chat.math"}' where id='99880000-0000-4000-8000-000000000080';
select is(pg_temp.revalidate_subject_fixture(),'{"ok":false,"status":"canceled","reason":"source_status_changed"}'::jsonb,
  'A mismatched subject connection is rejected even if the claimed delivery repeats it');
update dashboard_private.notification_deliveries set target_key='connection:google_chat.english',connection_key='google_chat.english',
  target_snapshot='{"connection_key":"google_chat.english"}' where id='99880000-0000-4000-8000-000000000080';
update public.ops_registration_subject_tracks set workflow_status='payment_in_progress',workflow_revision=3
where id=(select (v->'tracks'->0->>'id')::uuid from subject_results where k='case');
select is(pg_temp.revalidate_subject_fixture(),'{"ok":false,"status":"canceled","reason":"source_status_changed"}'::jsonb,
  'Canonical revalidation also suppresses a superseded registered status');

-- Calling the SQL attempt gate does not call a provider. Verify the exact
-- narrow word-result exception, wrong target fence and duplicate-attempt gate.
insert into dashboard_private.notification_dispatch_ownership_claims(id,workflow_key,occurrence_key,rule_id,channel_key,
  target_key,target_generation,owner_kind,owner_generation,state,dispatch_started_at,dispatch_token)
select '99880000-0000-4000-8000-000000000090','word_retests',event_row.occurrence_key,rule_row.id,'google_chat',
  'connection:google_chat.english',0,'legacy',0,'dispatch_started',now(),'99880000-0000-4000-8000-000000000091'
from dashboard_private.notification_events event_row join dashboard_private.notification_rules rule_row
  on rule_row.event_key=event_row.event_key and rule_row.audience_key='subject_team'
where event_row.event_key='word_retest.result_reported';
select is((public.register_notification_external_attempt_v1(null,'99880000-0000-4000-8000-000000000090',0,null,
  '99880000-0000-4000-8000-000000000091','99880000-0000-4000-8000-000000000091')->>'allowed')::boolean,true,
  'Current English subject result alone passes the final SQL provider boundary');
select is(public.register_notification_external_attempt_v1(null,'99880000-0000-4000-8000-000000000090',0,null,
  '99880000-0000-4000-8000-000000000091','99880000-0000-4000-8000-000000000091'),
  '{"allowed":false,"reason":"attempt_already_registered"}'::jsonb,'The same dispatch token cannot register a duplicate attempt');
update dashboard_private.notification_dispatch_ownership_claims set target_key='connection:google_chat.math'
where id='99880000-0000-4000-8000-000000000090';
select is(public.register_notification_external_attempt_v1(null,'99880000-0000-4000-8000-000000000090',0,null,
  '99880000-0000-4000-8000-000000000091','99880000-0000-4000-8000-000000000091'),
  '{"allowed":false,"reason":"word_retest_google_chat_retired"}'::jsonb,'Word result cannot cross the SQL boundary to the Math team');
select * from finish();
rollback;
