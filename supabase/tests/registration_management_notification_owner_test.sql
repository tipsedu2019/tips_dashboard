begin;
select plan(22);
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


insert into dashboard_private.notification_runtime_flags(flag_key,enabled)
values('notification_control_plane_dispatch_registration_enabled',true)
on conflict(flag_key) do update set enabled=excluded.enabled;
insert into dashboard_private.notification_cutover_owners(scope_key,workflow_key,dispatch_flag_key,owner_kind)
values('registration','registration','notification_control_plane_dispatch_registration_enabled','legacy')
on conflict(scope_key) do update set owner_kind=excluded.owner_kind;
insert into public.google_chat_webhook_settings(channel,webhook_url,connection_state)
values('admin','https://chat.googleapis.com/v1/spaces/localonly123/messages?key=synthetic&token=synthetic','legacy_active')
on conflict(channel) do update set webhook_url=excluded.webhook_url,connection_state=excluded.connection_state;
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('preview',public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)); reset role;
select is((select v->>'canSend' from v2_result where k='preview'),'true','legacy scope owner stays usable when the unrelated canonical flag is ON');
select is(dashboard_private.notification_dispatch_enabled_v1('registration','registration.case_created'),false,'manual management event cannot be taken by the canonical worker while scope owner is legacy');
select is((select enabled from dashboard_private.notification_runtime_flags where flag_key='notification_control_plane_dispatch_registration_enabled'),true,'owner-aware reads do not mutate the stored flag');
select is((select count(*) from dashboard_private.registration_management_notification_previews),0::bigint,'preview reads create no request or send permission');

select ok((select bool_and(not dashboard_private.notification_dispatch_enabled_v1('registration',event_key))
 from unnest(array['registration.case_created','registration.consultation_completed','registration.waiting_transitioned','registration.admission_started']) event_key),'all four manual steps preserve the legacy owner');
select is(dashboard_private.notification_dispatch_enabled_v1('registration','registration.appointment_reminder_due'),true,'appointment dispatch behavior remains unchanged');
select is(dashboard_private.notification_dispatch_enabled_v1('registration','registration.visit_scheduled'),false,'visit adapter stays disabled');
select is(dashboard_private.notification_dispatch_enabled_v1('registration','registration.admission_message_requested'),false,'customer-message adapter stays disabled');
select ok(not has_function_privilege('authenticated','dashboard_private.registration_management_notification_owner_v1()','execute')
 and not has_function_privilege('service_role','dashboard_private.notification_dispatch_before_registration_owner_v1(text,text)','execute'),'ownership helpers remain private');

update dashboard_private.notification_cutover_owners set owner_kind='canonical' where scope_key='registration';
select ok((select bool_and(dashboard_private.notification_dispatch_enabled_v1('registration',event_key))
 from unnest(array['registration.case_created','registration.consultation_completed','registration.waiting_transitioned','registration.admission_started']) event_key),'canonical owner requires and honors its enabled flag');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
select is(public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)->>'status','owner_changed','canonical owner cannot use the direct provider'); reset role;
update dashboard_private.notification_runtime_flags set enabled=false where flag_key='notification_control_plane_dispatch_registration_enabled';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
select is(public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)->>'canSend','false','disabled canonical dispatch does not silently return ownership to legacy'); reset role;
delete from dashboard_private.notification_cutover_owners where scope_key='registration';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
select is(public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)->>'canSend','false','missing ownership blocks direct delivery'); reset role;
select is(dashboard_private.notification_dispatch_enabled_v1('registration','registration.case_created'),false,'missing ownership blocks canonical delivery');
insert into dashboard_private.notification_cutover_owners(scope_key,workflow_key,dispatch_flag_key,owner_kind)
values('registration','registration','notification_control_plane_dispatch_registration_enabled','legacy');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
select is(public.get_registration_management_notification_preview_v1('99830000-0000-4000-8000-000000000111',7)->>'previewChecksum',
 (select v->>'previewChecksum' from v2_result where k='preview'),'flag ON/OFF does not change an unchanged legacy approval'); reset role;
update dashboard_private.notification_runtime_flags set enabled=true where flag_key='notification_control_plane_dispatch_registration_enabled';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result select 'confirmed',public.ensure_registration_workflow_notification_v4('99830000-0000-4000-8000-000000000111',7,
 '99830000-0000-4000-8000-000000000907','send_registration_management_notification',v->>'previewChecksum',null) from v2_result where k='preview'; reset role;
select is((select jsonb_array_length(v->'sourceEventIds') from v2_result where k='confirmed'),1,'real v4 confirmation prepares exactly one source under the production owner/flag combination');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result select 'plan',public.get_registration_core_legacy_dispatch_plan_v1((v->'sourceEventIds'->>0)::uuid,'99830000-0000-4000-8000-000000000001') from v2_result where k='confirmed'; reset role;
select is((select jsonb_build_object('title',v->'items'->0->>'renderedTitle','body',v->'items'->0->>'renderedBody') from v2_result where k='plan'),
 (select jsonb_build_object('title',v->>'renderedTitle','body',v->>'renderedBody') from v2_result where k='preview'),'real dispatcher receives the exact approved title and body');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result select 'claim',public.begin_legacy_notification_dispatch_v1('registration',i->>'occurrenceKey',(i->>'ruleId')::uuid,
 i->>'channelKey',i->>'targetKey',(i->>'targetGeneration')::bigint,'registration_core_legacy_bridge_v1',0,'99830000-0000-4000-8000-000000000908')
 from v2_result cross join lateral jsonb_array_elements(v->'items')i where k='plan'; reset role;
select is((select v->>'acquired' from v2_result where k='claim'),'true','the actual legacy ownership claim remains available');
select is((select count(*) from dashboard_private.notification_audit_logs where entity_kind='notification_external_attempt'),0::bigint,'preview and confirmation have not attempted delivery');
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result select 'attempt',public.register_notification_external_attempt_v1(null,(v->>'claim_id')::uuid,(v->>'owner_generation')::bigint,null,
 (v->>'dispatch_token')::uuid,(v->>'dispatch_token')::uuid) from v2_result where k='claim'; reset role;
select is((select v->>'allowed' from v2_result where k='attempt'),'true','the real final provider gate accepts the unchanged legacy approval in this rollback-only test');
update dashboard_private.notification_cutover_owners set owner_kind='canonical' where scope_key='registration';
select pg_temp.set_v2_actor('99830000-0000-4000-8000-000000000001','service_role'); set local role service_role;
select throws_ok($$select public.register_notification_external_attempt_v1(null,(v->>'claim_id')::uuid,(v->>'owner_generation')::bigint,null,
 (v->>'dispatch_token')::uuid,(v->>'dispatch_token')::uuid) from v2_result where k='claim'$$,
 '23514','registration_management_notification_preview_changed','changing ownership after preview cannot cross the final provider gate'); reset role;
select is((select count(*) from dashboard_private.notification_audit_logs where entity_kind='notification_external_attempt' and action='external_attempt_registered'),1::bigint,'ownership change registers no second attempt');
select * from finish(); rollback;
