begin;
select plan(24);
set local statement_timeout='120s';
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at
) values
('99830000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-admin@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',null,now(),now()),
('99830000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-staff@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',null,now(),now()),
('99830000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-teacher@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',null,now(),now()),
('99830000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-banned@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now()+interval '1 day',now(),now());
insert into public.profiles(id,role,name,email,created_at,updated_at) values
('99830000-0000-4000-8000-000000000001','admin','v2 원장','v2-admin@example.invalid',now(),now()),
('99830000-0000-4000-8000-000000000002','staff','v2 관리팀','v2-staff@example.invalid',now(),now()),
('99830000-0000-4000-8000-000000000003','teacher','v2 교사','v2-teacher@example.invalid',now(),now()),
('99830000-0000-4000-8000-000000000004','admin','v2 차단 원장','v2-banned@example.invalid',now(),now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;
insert into public.ops_tasks(id,title,type,status,priority,requested_by,student_name) values
('99830000-0000-4000-8000-000000000101','v2 준비 완료','registration','requested','normal','99830000-0000-4000-8000-000000000001','김명시'),
('99830000-0000-4000-8000-000000000102','v2 정보 누락','registration','requested','normal','99830000-0000-4000-8000-000000000001',null);
insert into public.ops_registration_details(task_id,school_grade,inquiry_at,request_note) values
('99830000-0000-4000-8000-000000000101','중2','2026-09-01 18:30+09','명시 발송'),
('99830000-0000-4000-8000-000000000102',null,null,null);
insert into public.ops_registration_subject_tracks(
 id,task_id,subject,pipeline_status,director_profile_id,director_assignment_source,
 director_assigned_at,migration_review_required,workflow_status,workflow_revision,
 workflow_status_entered_at,observation_return_workflow_status,observation_attempt_count
) values
('99830000-0000-4000-8000-000000000111','99830000-0000-4000-8000-000000000101','영어','consultation_waiting','99830000-0000-4000-8000-000000000001','manual',now(),false,'consultation_requested',7,now(),null,0),
('99830000-0000-4000-8000-000000000112','99830000-0000-4000-8000-000000000102','수학','consultation_waiting','99830000-0000-4000-8000-000000000001','manual',now(),false,'consultation_requested',3,now(),null,0);

create or replace function pg_temp.set_v2_actor(p_actor uuid,p_role text default 'authenticated')
returns void language plpgsql set search_path='' as $$ begin
 perform pg_catalog.set_config(
   'request.jwt.claims',
   pg_catalog.jsonb_build_object('sub',p_actor,'role',p_role)::text,
   true
 );
 perform pg_catalog.set_config('request.jwt.claim.sub',p_actor::text,true);
 perform pg_catalog.set_config('request.jwt.claim.role',p_role,true);
end $$;
create temporary table v2_result(k text primary key,v jsonb not null) on commit drop;
grant all on v2_result to authenticated,service_role;

do $v2_route_fixture$
declare
  v_rule_id uuid;
begin
  select rule.id
  into v_rule_id
  from dashboard_private.notification_rules rule
  where rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = 'registration.case_created'
    and rule.channel_key = 'google_chat'
    and rule.audience_key = 'management_team'
    and rule.rule_variant_key = 'immediate';

  if v_rule_id is null then
    v_rule_id := '99830000-0000-4000-8000-000000000801';
    insert into dashboard_private.notification_rules(
      id, scope_key, workflow_key, event_key, channel_key, audience_key,
      rule_variant_key, delivery_mode, schedule_key, schedule_config, enabled,
      active_template_id, revision, created_by, created_actor_kind,
      updated_by, updated_actor_kind
    ) values (
      v_rule_id, 'global', 'registration', 'registration.case_created',
      'google_chat', 'management_team', 'immediate', 'immediate', null, null,
      true, '99830000-0000-4000-8000-000000000802', 1,
      null, 'system', null, 'system'
    );
    insert into dashboard_private.notification_templates(
      id, rule_id, version, title_template, body_template, allowed_variables,
      payload_schema_version, checksum, created_by, created_actor_kind
    ) values (
      '99830000-0000-4000-8000-000000000802', v_rule_id, 1,
      '[등록] {student_name}',
      E'[학생] {student_name}\n[과목] {subjects}\n[상태] {current_status}',
      '[
        {"key":"student_name","token":"학생","pii_class":"student_name"},
        {"key":"subjects","token":"과목","pii_class":"none"},
        {"key":"current_status","token":"현재상태","pii_class":"none"}
      ]'::jsonb,
      1, 'registration-explicit-v2-test-template',
      null, 'system'
    );
  else
    update dashboard_private.notification_rules rule
    set enabled = true
    where rule.id = v_rule_id;
  end if;
end;
$v2_route_fixture$;

select ok(not has_function_privilege('anon','public.get_registration_management_notification_preview_v1(uuid,integer)','execute') and has_function_privilege('authenticated','public.get_registration_management_notification_preview_v1(uuid,integer)','execute'),'preview is authenticated only');
select ok((select provolatile='s' and prosecdef from pg_proc where oid='public.get_registration_management_notification_preview_v1(uuid,integer)'::regprocedure),'preview is read-only stable');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000003'); set local role authenticated;
select throws_ok($$select public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)$$,'42501','registration_access_denied','teacher cannot read manager preview'); reset role;
update dashboard_private.notification_rules set enabled=false where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('off',public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)); reset role;
select is((select v->>'status' from v2_result where k='off'),'rule_disabled','OFF explains settings instead of recording intent');
select is((select count(*) from dashboard_private.registration_management_notification_previews),0::bigint,'reading disabled preview records no binding');
update dashboard_private.notification_rules set enabled=true where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat';
insert into public.google_chat_webhook_settings(channel,webhook_url,connection_state) values('admin','','disconnected') on conflict(channel) do update set webhook_url='',webhook_url_ciphertext=null,connection_state='disconnected';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('disconnected',public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)); reset role;
select is((select v->>'status' from v2_result where k='disconnected'),'connection_missing','disconnected room blocks send with a reason');
update public.google_chat_webhook_settings set connection_state='legacy_active',webhook_url='https://chat.googleapis.com/v1/spaces/fixture/messages?key=fixture&token=fixture',revision=revision+1 where channel='admin';
insert into dashboard_private.google_chat_profile_identities(profile_id,account_email_snapshot,chat_user_id,source,verification_status,verified_at,last_sync_status,last_sync_at,identity_revision)
values('99830000-0000-4000-8000-000000000001','v2-admin@example.invalid','998312345','manual','verified',now(),'ok',now(),1);
insert into dashboard_private.notification_rule_mention_settings(rule_id,mention_enabled,revision) select id,true,1 from dashboard_private.notification_rules where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat' on conflict(rule_id) do update set mention_enabled=true;
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('ready',public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)); reset role;
select is((select jsonb_build_object('canSend',v->'canSend','mentions',v->'mentionUserNames') from v2_result where k='ready'),'{"canSend":true,"mentions":["users/998312345"]}'::jsonb,'preview contains only verified active director mention');
select is((select count(*) from public.ops_task_events where task_id='99830000-0000-4000-8000-000000000101' and dashboard_private.try_registration_event_jsonb_object(after_value)->>'event_type'='registration_management_notification_requested'),0::bigint,'successful preview also creates no source');
update public.ops_registration_details set school_grade='중3' where task_id='99830000-0000-4000-8000-000000000101';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v3('99830000-0000-4000-8000-000000000111',7,'99830000-0000-4000-8000-000000000907','send_registration_management_notification',(select v->>'previewChecksum' from v2_result where k='ready'))$$,'23514','registration_management_notification_preview_changed','changed fact rejects confirmation with exact domain SQLSTATE');
insert into v2_result values('fresh',public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7));
insert into v2_result select 'confirmed',public.ensure_registration_workflow_notification_v3('99830000-0000-4000-8000-000000000111',7,'99830000-0000-4000-8000-000000000907','send_registration_management_notification',v->>'previewChecksum') from v2_result where k='fresh';
insert into v2_result select 'replay',public.ensure_registration_workflow_notification_v3('99830000-0000-4000-8000-000000000111',7,'99830000-0000-4000-8000-000000000907','send_registration_management_notification',v->>'previewChecksum') from v2_result where k='fresh'; reset role;
select is((select v->>'ready' from v2_result where k='confirmed'),'true','confirmation uses existing v2 source');
select is((select v from v2_result where k='replay'),(select v from v2_result where k='confirmed'),'ambiguous retry reuses the same idempotent response');
select is((select count(*) from dashboard_private.registration_management_notification_previews),1::bigint,'exactly one binding exists');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result select 'plan',public.get_registration_core_legacy_dispatch_plan_v1((v->'sourceEventIds'->>0)::uuid,'99830000-0000-4000-8000-000000000001') from v2_result where k='confirmed'; reset role;
select is((select jsonb_build_object('body',p.v->'items'->0->>'renderedBody','mentions',p.v->'items'->0->'mentionUserNames') from v2_result p where p.k='plan'),(select jsonb_build_object('body',v->>'renderedBody','mentions',v->'mentionUserNames') from v2_result where k='fresh'),'real legacy plan preserves exact preview and mention targets');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001','service_role'); set local role service_role;
select ok(public.validate_registration_management_notification_preview_v1((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='confirmed'),(select v->>'previewChecksum' from v2_result where k='fresh')),'preview precheck passes before intervening settings change');
insert into v2_result select 'claim',public.begin_legacy_notification_dispatch_v1('registration',i->>'occurrenceKey',(i->>'ruleId')::uuid,i->>'channelKey',i->>'targetKey',(i->>'targetGeneration')::bigint,'registration_core_legacy_bridge_v1',0,'99830000-0000-4000-8000-000000000908') from v2_result r cross join lateral jsonb_array_elements(r.v->'items')i where r.k='plan'; reset role;
select is((select v->>'acquired' from v2_result where k='claim'),'true','existing ownership claim is retained');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('in-flight-preview',public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)); reset role;
select is((select jsonb_build_object('status',v->>'status','canSend',v->'canSend') from v2_result where k='in-flight-preview'),'{"status":"delivery_unknown","canSend":false}'::jsonb,'existing claim is visible before confirmation and cannot send again');

update dashboard_private.notification_rule_mention_settings set mention_enabled=false,revision=revision+1 where rule_id in(select id from dashboard_private.notification_rules where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001','service_role'); set local role service_role;
select throws_ok($$select public.register_notification_external_attempt_v1(null,(v->>'claim_id')::uuid,(v->>'owner_generation')::bigint,null,(v->>'dispatch_token')::uuid,(v->>'dispatch_token')::uuid) from v2_result where k='claim'$$,'23514','registration_management_notification_preview_changed','mention changed after precheck is rejected inside final provider gate'); reset role;
update public.google_chat_webhook_settings set revision=revision+1 where channel='admin';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001','service_role'); set local role service_role;
select throws_ok($$select public.register_notification_external_attempt_v1(null,(v->>'claim_id')::uuid,(v->>'owner_generation')::bigint,null,(v->>'dispatch_token')::uuid,(v->>'dispatch_token')::uuid) from v2_result where k='claim'$$,'23514','registration_management_notification_preview_changed','connection change cannot cross final provider gate'); reset role;
select is((select count(*) from dashboard_private.notification_audit_logs audit join v2_result claim on audit.request_id=(claim.v->>'dispatch_token')::uuid where claim.k='claim' and audit.entity_kind='notification_external_attempt' and audit.action='external_attempt_registered'),0::bigint,'stale settings register zero external attempts');
select ok(pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure) like '%registration_visit_cancellation_source_stale%' and pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure) like '%word_retest_google_chat_retired%','final gate preserves cancellation and word retest fences');
update dashboard_private.notification_rules set enabled=false where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat';
update public.ops_tasks set student_name='이전 요청 합성 학생' where id='99830000-0000-4000-8000-000000000102';
update public.ops_registration_details set school_grade='중2',inquiry_at='2026-09-08 18:00+09' where task_id='99830000-0000-4000-8000-000000000102';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('old-off',public.ensure_registration_workflow_notification_v2('99830000-0000-4000-8000-000000000112',3,'99830000-0000-4000-8000-000000000911','send_registration_management_notification')); reset role;
update dashboard_private.notification_rules set enabled=true where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('old-off-preview',public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000112',3)); reset role;
select is((select jsonb_build_object('canSend',v->'canSend','status',v->>'status','oldSetting',v->'existingRuleEnabled','hasEvent',v->>'existingEventId' is not null) from v2_result where k='old-off-preview'),'{"canSend":true,"status":"ready","oldSetting":false,"hasEvent":true}'::jsonb,'old OFF source offers explicit recovery while preserving its receipt identity');
select is((select count(*) from public.ops_task_events where task_id='99830000-0000-4000-8000-000000000102' and dashboard_private.try_registration_event_jsonb_object(after_value)->>'event_type'='registration_management_notification_requested'),1::bigint,'read-only detection preserves the old receipt and creates no replacement');
update dashboard_private.notification_dispatch_ownership_claims set state='closed',terminal_outcome='sent' where workflow_key='registration' and occurrence_key=(select v->'sourceEventIds'->>0 from v2_result where k='confirmed');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('sent-preview',public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)); reset role;
select is((select jsonb_build_object('status',v->>'status','canSend',v->'canSend') from v2_result where k='sent-preview'),'{"status":"already_sent","canSend":false}'::jsonb,'sent receipt blocks a second confirmation even when settings changed');
update dashboard_private.notification_rule_mention_settings set mention_enabled=true where rule_id in(select id from dashboard_private.notification_rules where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat');
insert into dashboard_private.notification_rule_mention_settings(rule_id,mention_enabled,revision)
select rule.id,false,1 from dashboard_private.notification_rules rule where rule.scope_key='global' and rule.workflow_key='registration' and rule.channel_key='google_chat' and rule.audience_key='management_team' and rule.event_key in ('registration.case_created','registration.consultation_completed','registration.waiting_transitioned','registration.admission_started') on conflict(rule_id) do nothing;
select ok((select bool_and(setting.mention_enabled) from dashboard_private.notification_rule_mention_settings setting join dashboard_private.notification_rules rule on rule.id=setting.rule_id where rule.workflow_key='registration' and rule.event_key='registration.case_created' and rule.channel_key='google_chat'),'idempotent OFF adoption preserves an existing ON choice');
select * from finish();
rollback;
