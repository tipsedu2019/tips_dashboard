begin;
select plan(52);
set local statement_timeout='120s';
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at
) values
('99840000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-admin@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',null,now(),now()),
('99840000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-staff@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',null,now(),now()),
('99840000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-teacher@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',null,now(),now()),
('99840000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-banned@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now()+interval '1 day',now(),now());
insert into public.profiles(id,role,name,email,created_at,updated_at) values
('99840000-0000-4000-8000-000000000001','admin','v2 원장','v2-admin@example.invalid',now(),now()),
('99840000-0000-4000-8000-000000000002','staff','v2 관리팀','v2-staff@example.invalid',now(),now()),
('99840000-0000-4000-8000-000000000003','teacher','v2 교사','v2-teacher@example.invalid',now(),now()),
('99840000-0000-4000-8000-000000000004','admin','v2 차단 원장','v2-banned@example.invalid',now(),now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;
insert into public.ops_tasks(id,title,type,status,priority,requested_by,student_name)
select ('99840000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,'복구 검증 '||n,'registration','requested','normal','99840000-0000-4000-8000-000000000001','합성 학생 '||n from generate_series(1,10)n;
insert into public.ops_registration_details(task_id,school_grade,inquiry_at,request_note)
select ('99840000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,'중2','2026-09-08 18:30+09','복구 합성 정보' from generate_series(1,10)n;
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,director_profile_id,director_assignment_source,director_assigned_at,migration_review_required,workflow_status,workflow_revision,workflow_status_entered_at,observation_return_workflow_status,observation_attempt_count)
select ('99840000-0000-4000-8000-'||lpad((110+n)::text,12,'0'))::uuid,('99840000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,'영어','consultation_waiting','99840000-0000-4000-8000-000000000001','manual',now(),false,'consultation_requested',7,now(),null,0 from generate_series(1,10)n;
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
    v_rule_id := '99840000-0000-4000-8000-000000000801';
    insert into dashboard_private.notification_rules(
      id, scope_key, workflow_key, event_key, channel_key, audience_key,
      rule_variant_key, delivery_mode, schedule_key, schedule_config, enabled,
      active_template_id, revision, created_by, created_actor_kind,
      updated_by, updated_actor_kind
    ) values (
      v_rule_id, 'global', 'registration', 'registration.case_created',
      'google_chat', 'management_team', 'immediate', 'immediate', null, null,
      true, '99840000-0000-4000-8000-000000000802', 1,
      null, 'system', null, 'system'
    );
    insert into dashboard_private.notification_templates(
      id, rule_id, version, title_template, body_template, allowed_variables,
      payload_schema_version, checksum, created_by, created_actor_kind
    ) values (
      '99840000-0000-4000-8000-000000000802', v_rule_id, 1,
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


-- Actor is deliberately present in the template: preview, new source, plan and
-- final gate must all keep the second manager's content, not the old author.
insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,allowed_variables,payload_schema_version,checksum,created_by,created_actor_kind)
select '99840000-0000-4000-8000-000000000803',rule.id,(select coalesce(max(version),0)+1 from dashboard_private.notification_templates where rule_id=rule.id),
 '[등록] {student_name}',E'[학생] {student_name}\n[작성] {actor_name}',
 '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"actor_name","token":"작성자","pii_class":"none"}]',1,repeat('b',64),null,'system'
from dashboard_private.notification_rules rule where scope_key='global' and workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat' and audience_key='management_team';
update dashboard_private.notification_rules set active_template_id='99840000-0000-4000-8000-000000000803',enabled=false,revision=revision+1 where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat' and audience_key='management_team';
insert into public.google_chat_webhook_settings(channel,webhook_url,connection_state) values('admin','https://chat.googleapis.com/v1/spaces/fixture/messages?key=fixture&token=fixture','legacy_active')
 on conflict(channel) do update set webhook_url=excluded.webhook_url,webhook_url_ciphertext=null,connection_state='legacy_active',revision=public.google_chat_webhook_settings.revision+1;
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('old-1',public.ensure_registration_workflow_notification_v2('99840000-0000-4000-8000-000000000111',7,'99840000-0000-4000-8000-000000000901','send_registration_management_notification')); reset role;
update dashboard_private.notification_rules set enabled=true where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat';
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result select 'old-'||n,public.ensure_registration_workflow_notification_v2(('99840000-0000-4000-8000-'||lpad((110+n)::text,12,'0'))::uuid,7,'99840000-0000-4000-8000-'||lpad((900+n)::text,12,'0'),'send_registration_management_notification') from generate_series(2,7)n;
insert into v2_result values('initial-9',public.get_registration_management_notification_preview_v1('99840000-0000-4000-8000-000000000119',7));
insert into v2_result select 'old-9',public.ensure_registration_workflow_notification_v3('99840000-0000-4000-8000-000000000119',7,'99840000-0000-4000-8000-000000000909','send_registration_management_notification',v->>'previewChecksum') from v2_result where k='initial-9';
reset role;
-- Capture a real legacy plan before changing the settings.
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result select 'old-plan-2',public.get_registration_core_legacy_dispatch_plan_v1((v->'sourceEventIds'->>0)::uuid,'99840000-0000-4000-8000-000000000001') from v2_result where k='old-2'; reset role;
update dashboard_private.notification_rules set revision=revision+1 where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat';

select ok(has_function_privilege('authenticated','public.ensure_registration_workflow_notification_v4(uuid,integer,text,text,text,uuid)','execute') and not has_function_privilege('anon','public.ensure_registration_workflow_notification_v4(uuid,integer,text,text,text,uuid)','execute') and not has_function_privilege('service_role','public.ensure_registration_workflow_notification_v4(uuid,integer,text,text,text,uuid)','execute'),'v4 is authenticated only');
select ok(not has_table_privilege('authenticated','dashboard_private.registration_management_notification_recoveries','select') and not has_table_privilege('service_role','dashboard_private.registration_management_notification_superseded_sources','insert'),'recovery provenance tables have no application grants');
select ok((select provolatile='s' and prosecdef and proowner='postgres'::regrole from pg_proc where oid='public.get_registration_management_notification_preview_v1(uuid,integer)'::regprocedure),'final preview is stable postgres definer');
select ok(not has_function_privilege('authenticated','public.get_registration_management_preview_before_recovery_v1(uuid,integer)','execute') and not has_function_privilege('service_role','dashboard_private.registration_management_source_current_before_recovery_v2(uuid,uuid)','execute'),'delegates are private');
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000003'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000111',7,'99840000-0000-4000-8000-000000000921','send_registration_management_notification',repeat('a',64),null)$$,'42501','registration_access_denied','teacher cannot confirm'); reset role;

insert into v2_result select 'immutable-'||r.k,jsonb_build_object('source',to_jsonb(source),'event',(select to_jsonb(event_row) from dashboard_private.notification_events event_row where source_id=source.id::text and source_type='ops_task_event'),
 'ledger',(select to_jsonb(ledger) from dashboard_private.notification_request_ledger ledger where request_id=(dashboard_private.try_registration_event_jsonb_object(source.after_value)->'metadata'->>'requestKey')::uuid),
 'preview',(select to_jsonb(preview) from dashboard_private.registration_management_notification_previews preview where source_event_id=source.id))
 from v2_result r join public.ops_task_events source on source.id=(r.v->'sourceEventIds'->>0)::uuid where r.k in ('old-1','old-9');
-- Raw source IDs and canonical IDs are both supported by the existing target queue contract.
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000001','service_role'); reset role;
select dashboard_private.enqueue_notification_target_reconciliation_job_v1('registration','ops_task_event',v->'sourceEventIds'->>0,7,(v->'sourceEventIds'->>0)::uuid,'recipient_set_changed',1,null,repeat('c',64)) from v2_result where k='old-9'; reset role;
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000002'); set local role authenticated;
insert into v2_result values('recovery-1',public.get_registration_management_notification_preview_v1('99840000-0000-4000-8000-000000000111',7));
insert into v2_result values('recovery-2',public.get_registration_management_notification_preview_v1('99840000-0000-4000-8000-000000000112',7));
insert into v2_result values('recovery-7',public.get_registration_management_notification_preview_v1('99840000-0000-4000-8000-000000000117',7));
insert into v2_result values('recovery-9',public.get_registration_management_notification_preview_v1('99840000-0000-4000-8000-000000000119',7));
select is((select jsonb_build_object('ready',v->'canSend','available',v->'recoveryAvailable','status',v->>'status','oldSetting',v->'existingRuleEnabled') from v2_result where k='recovery-1'),'{"ready":true,"available":true,"status":"ready","oldSetting":false}'::jsonb,'old OFF source exposes explicit recovery');
select is((select v->>'sourceActorId' from v2_result where k='recovery-1'),'99840000-0000-4000-8000-000000000002','recovery content uses the confirming manager');
select matches((select v->>'renderedBody' from v2_result where k='recovery-1'),'v2 관리팀','second manager is visible in rendered content');
select throws_ok($$select public.ensure_registration_workflow_notification_v3('99840000-0000-4000-8000-000000000111',7,'99840000-0000-4000-8000-000000000920','send_registration_management_notification',(select v->>'previewChecksum' from v2_result where k='recovery-1'))$$,'23514','registration_management_notification_recovery_not_allowed','old v3 cannot implicitly replace an old request');
reset role;
select is((select count(*) from dashboard_private.registration_management_notification_recoveries),0::bigint,'GET and rejected v3 create no recovery');
select is((select count(*) from dashboard_private.notification_request_ledger where request_id='99840000-0000-4000-8000-000000000920'),0::bigint,'rejected v3 creates no request ledger');

-- Strict denial of any attempt, ownership or materialization history.
insert into dashboard_private.notification_dispatch_ownership_claims(workflow_key,occurrence_key,rule_id,channel_key,target_key,target_generation,owner_kind,owner_generation,state,terminal_outcome)
 select 'registration',r.v->'sourceEventIds'->>0,rule.id,'google_chat','connection:google_chat.management',0,'legacy',0,'closed',case r.k when 'old-3' then 'failed' else 'sent' end
 from v2_result r cross join dashboard_private.notification_rules rule where r.k in('old-3','old-4') and rule.workflow_key='registration' and rule.event_key='registration.case_created' and rule.channel_key='google_chat';
insert into dashboard_private.notification_deliveries(event_id,rule_id,rule_revision,template_id,channel_key,audience_key,target_generation,target_set_hash,target_kind,target_key,connection_key,target_snapshot,status,status_reason,dedupe_key,rendered_title,rendered_body,scheduled_for,max_attempts,last_attempt_started_at)
 select event_row.id,rule.id,rule.revision,rule.active_template_id,'google_chat','management_team',0,'fixture','connection','connection:google_chat.management','google_chat.management','{}',
 case r.k when 'old-5' then 'delivery_unknown' else 'pending' end,case r.k when 'old-5' then 'provider_ambiguous_response' else null end,'recovery-test-'||r.k,'합성 제목','합성 본문',now(),3,case r.k when 'old-5' then now() else null end
 from v2_result r join dashboard_private.notification_events event_row on event_row.source_id=r.v->'sourceEventIds'->>0 cross join dashboard_private.notification_rules rule
 where r.k in('old-2','old-5') and rule.workflow_key='registration' and rule.event_key='registration.case_created' and rule.channel_key='google_chat';
update dashboard_private.notification_event_fanout_jobs set attempt_count=1 where event_id=(select event_row.id from dashboard_private.notification_events event_row join v2_result r on event_row.source_id=r.v->'sourceEventIds'->>0 where r.k='old-6');
select is((select count(*) from dashboard_private.notification_deliveries where dedupe_key like 'recovery-test-%'),2::bigint,'fixture has both pending and unknown materializations');
select ok(not dashboard_private.registration_management_notification_recovery_allowed_v1((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='old-2')),'a pending delivery with zero attempts still forbids recovery');
select ok(not dashboard_private.registration_management_notification_recovery_allowed_v1((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='old-3')),'a closed failed claim still forbids recovery');
select ok(not dashboard_private.registration_management_notification_recovery_allowed_v1((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='old-4')),'sent claim forbids recovery');
select ok(not dashboard_private.registration_management_notification_recovery_allowed_v1((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='old-5')),'unknown delivery forbids recovery');
select ok(not dashboard_private.registration_management_notification_recovery_allowed_v1((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='old-6')),'queue attempt history forbids recovery');
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000002'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000112',7,'99840000-0000-4000-8000-000000000922','send_registration_management_notification',(select v->>'previewChecksum' from v2_result where k='recovery-2'),(select (v->>'recoverySourceEventId')::uuid from v2_result where k='recovery-2'))$$,'23514','registration_management_notification_recovery_changed','new history between GET and confirm blocks old recovery preview');
reset role;
update dashboard_private.notification_rules set revision=revision+1 where workflow_key='registration' and event_key='registration.case_created' and channel_key='google_chat';
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000002'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000117',7,'99840000-0000-4000-8000-000000000927','send_registration_management_notification',(select v->>'previewChecksum' from v2_result where k='recovery-7'),(select (v->>'recoverySourceEventId')::uuid from v2_result where k='recovery-7'))$$,'23514','registration_management_notification_recovery_changed','current settings changed since GET require a fresh preview');
update v2_result set v=public.get_registration_management_notification_preview_v1('99840000-0000-4000-8000-000000000111',7) where k='recovery-1';
update v2_result set v=public.get_registration_management_notification_preview_v1('99840000-0000-4000-8000-000000000119',7) where k='recovery-9';
insert into v2_result select 'new-1',public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000111',7,'99840000-0000-4000-8000-000000000921','send_registration_management_notification',v->>'previewChecksum',(v->>'recoverySourceEventId')::uuid) from v2_result where k='recovery-1';
insert into v2_result select 'replay-1',public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000111',7,'99840000-0000-4000-8000-000000000921','send_registration_management_notification',v->>'previewChecksum',(v->>'recoverySourceEventId')::uuid) from v2_result where k='recovery-1';
select is((select v from v2_result where k='replay-1'),(select v from v2_result where k='new-1'),'same request replays even though old source is already superseded');
select is((select v->>'previousSourceEventId' from v2_result where k='new-1'),(select v->'sourceEventIds'->>0 from v2_result where k='old-1'),'receipt links to the preserved old source');
select is((select v->>'recovered' from v2_result where k='new-1'),'true','explicit confirm reports a replacement');
select throws_ok($$select public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000111',7,'99840000-0000-4000-8000-000000000923','send_registration_management_notification',(select v->>'previewChecksum' from v2_result where k='recovery-1'),(select (v->>'recoverySourceEventId')::uuid from v2_result where k='recovery-1'))$$,'23514','registration_management_notification_recovery_changed','a different key cannot make a second replacement');
insert into v2_result values('after-1',public.get_registration_management_notification_preview_v1('99840000-0000-4000-8000-000000000111',7));
select is((select v->>'previewChecksum' from v2_result where k='after-1'),(select v->>'previewChecksum' from v2_result where k='recovery-1'),'GET after replacement keeps the exact confirmed checksum');
select is((select jsonb_build_object('available',v->'recoveryAvailable','source',v->'recoverySourceEventId','from',v->'recoveredFromEventId') from v2_result where k='after-1'),(select jsonb_build_object('available',false,'source',null,'from',v->'previousEventId') from v2_result where k='new-1'),'new GET exposes history relation without offering recovery again');
insert into v2_result select 'new-9',public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000119',7,'99840000-0000-4000-8000-000000000929','send_registration_management_notification',v->>'previewChecksum',(v->>'recoverySourceEventId')::uuid) from v2_result where k='recovery-9'; reset role;
select is((select count(*) from dashboard_private.registration_management_notification_recoveries),2::bigint,'two independently eligible sources each have one relation');
select is((select count(*) from public.ops_task_events where task_id='99840000-0000-4000-8000-000000000101' and dashboard_private.try_registration_event_jsonb_object(after_value)->>'event_type'='registration_management_notification_requested'),2::bigint,'original and one replacement source remain');
select ok(not dashboard_private.registration_management_notification_source_current_v2((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='old-1'),null),'superseded source is permanently excluded from current source');
select ok(dashboard_private.registration_management_source_current_before_recovery_v2((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='old-1'),null),'original facts and ledger still satisfy the preceding current-source contract');
select ok(dashboard_private.registration_management_notification_source_current_v2((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='new-1'),null),'new source satisfies all original current-fact checks');
select is((select count(*) from dashboard_private.notification_event_fanout_jobs job join dashboard_private.notification_events event_row on event_row.id=job.event_id join v2_result r on r.v->'sourceEventIds'->>0=event_row.source_id where r.k in('old-1','old-9') and job.status='succeeded' and job.attempt_count=0 and job.outcome_summary->>'outcome'='superseded'),2::bigint,'only old pending fanout jobs are terminalized with zero attempts');
insert into v2_result select 'after-immutable-'||r.k,jsonb_build_object('source',to_jsonb(source),'event',(select to_jsonb(event_row) from dashboard_private.notification_events event_row where source_id=source.id::text and source_type='ops_task_event'),
 'ledger',(select to_jsonb(ledger) from dashboard_private.notification_request_ledger ledger where request_id=(dashboard_private.try_registration_event_jsonb_object(source.after_value)->'metadata'->>'requestKey')::uuid),
 'preview',(select to_jsonb(preview) from dashboard_private.registration_management_notification_previews preview where source_event_id=source.id))
 from v2_result r join public.ops_task_events source on source.id=(r.v->'sourceEventIds'->>0)::uuid where r.k in ('old-1','old-9');
select is((select v from v2_result where k='after-immutable-old-1'),(select v from v2_result where k='immutable-old-1'),'old OFF raw source, canonical and original ledger stay byte-for-byte equal');
select is((select v from v2_result where k='after-immutable-old-9'),(select v from v2_result where k='immutable-old-9'),'old v3 preview binding and its source records stay byte-for-byte equal');
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000002','service_role'); set local role service_role;
insert into v2_result select 'new-plan-1',public.get_registration_core_legacy_dispatch_plan_v1((v->'sourceEventIds'->>0)::uuid,'99840000-0000-4000-8000-000000000002') from v2_result where k='new-1';
select is((select v->'items'->0->>'previewChecksum' from v2_result where k='new-plan-1'),(select v->>'previewChecksum' from v2_result where k='recovery-1'),'real legacy plan keeps the confirmed recovery checksum');
select is((select v->'items'->0->>'renderedBody' from v2_result where k='new-plan-1'),(select v->>'renderedBody' from v2_result where k='recovery-1'),'real legacy plan keeps the second manager rendered body');
select ok(public.validate_registration_management_notification_preview_v1((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='new-1'),(select v->>'previewChecksum' from v2_result where k='recovery-1')),'final preview validation accepts the same second-manager checksum');
select ok(not public.validate_registration_management_notification_preview_v1((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='old-9'),(select v->>'previewChecksum' from v2_result where k='initial-9')),'old preview cannot pass final validation after replacement');
reset role;
select throws_ok($$insert into dashboard_private.notification_dispatch_ownership_claims(workflow_key,occurrence_key,rule_id,channel_key,target_key,target_generation,owner_kind,owner_generation,state)
 select 'registration',r.v->'sourceEventIds'->>0,rule.id,'google_chat','connection:google_chat.management',0,'legacy',0,'reserved' from v2_result r cross join dashboard_private.notification_rules rule where r.k='old-1' and rule.workflow_key='registration' and rule.event_key='registration.case_created' and rule.channel_key='google_chat'$$,'23514','registration_management_notification_snapshot_stale','a late ownership insertion cannot revive superseded source');
select throws_ok($$update dashboard_private.notification_event_fanout_jobs set status='pending',next_attempt_at=now() where event_id=(select id from dashboard_private.notification_events where source_id=(select v->'sourceEventIds'->>0 from v2_result where k='old-1'))$$,'23514','registration_management_notification_snapshot_stale','terminalized old queue cannot be requeued');
select throws_ok($$select dashboard_private.materialize_notification_delivery_v1(event_row.id,rule.id,rule.revision,rule.active_template_id,0,'late-fixture','connection','connection:google_chat.management',null,'google_chat.management','{}','합성 제목','합성 본문',null,now()) from dashboard_private.notification_events event_row cross join dashboard_private.notification_rules rule where event_row.source_id=(select v->'sourceEventIds'->>0 from v2_result where k='old-1') and rule.workflow_key='registration' and rule.event_key='registration.case_created' and rule.channel_key='google_chat'$$,'23514','registration_management_notification_snapshot_stale','actual canonical materializer cannot insert after recovery');
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000001'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000111',7,'99840000-0000-4000-8000-000000000921','send_registration_management_notification',(select v->>'previewChecksum' from v2_result where k='recovery-1'),(select (v->>'recoverySourceEventId')::uuid from v2_result where k='recovery-1'))$$,'23514','notification_idempotency_conflict','another manager cannot replay the recovery receipt'); reset role;
update auth.users set banned_until=now()+interval '1 day' where id='99840000-0000-4000-8000-000000000002';
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000002'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000111',7,'99840000-0000-4000-8000-000000000921','send_registration_management_notification',(select v->>'previewChecksum' from v2_result where k='recovery-1'),(select (v->>'recoverySourceEventId')::uuid from v2_result where k='recovery-1'))$$,'42501','registration_access_denied','banned manager cannot use receipt replay'); reset role;
update auth.users set banned_until=null where id='99840000-0000-4000-8000-000000000002';
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000002'); set local role authenticated;
insert into v2_result values('normal-8',public.get_registration_management_notification_preview_v1('99840000-0000-4000-8000-000000000118',7));
insert into v2_result select 'normal-confirm-8',public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000118',7,'99840000-0000-4000-8000-000000000928','send_registration_management_notification',v->>'previewChecksum',null) from v2_result where k='normal-8';
select is((select jsonb_build_object('available',v->'recoveryAvailable','source',v->'recoverySourceEventId') from v2_result where k='normal-8'),'{"available":false,"source":null}'::jsonb,'ordinary GET always returns explicit false/null recovery fields');
select is((select jsonb_build_object('recovered',v->'recovered','previousKey',v?'previousSourceEventId') from v2_result where k='normal-confirm-8'),'{"recovered":false,"previousKey":false}'::jsonb,'ordinary v4 confirmation retains v3 and omits recovery keys'); reset role;
select is((select count(*) from dashboard_private.notification_audit_logs where entity_kind='notification_external_attempt' and action='external_attempt_registered'),0::bigint,'all recovery tests performed zero external attempts');

select is((select count(*) from dashboard_private.notification_target_reconciliation_jobs where source_id=(select v->'sourceEventIds'->>0 from v2_result where k='old-9') and status='succeeded' and attempt_count=0 and last_error_code='registration_management_notification_superseded'),1::bigint,'raw-source target queue was terminalized without an attempt');
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000002','service_role'); reset role;
select throws_ok($$select dashboard_private.enqueue_notification_target_reconciliation_job_v1('registration','ops_task_event',v->'sourceEventIds'->>0,7,(v->'sourceEventIds'->>0)::uuid,'recipient_set_changed',1,null,repeat('d',64)) from v2_result where k='old-1'$$,'23514','registration_management_notification_snapshot_stale','late raw-source target enqueue is rejected by the same fence');
select throws_ok($$select dashboard_private.enqueue_notification_target_reconciliation_job_v1('registration','ops_task_event',v->'sourceEventIds'->>0,7,(v->'sourceEventIds'->>0)::uuid,'recipient_set_changed',1,null,repeat('c',64)) from v2_result where k='old-9'$$,'23514','registration_management_notification_snapshot_stale','duplicate raw-source target enqueue cannot revive the terminalized queue'); reset role;

-- Exercise the real final gate in a rolled-back subtransaction: it records a
-- synthetic intent to call the provider, but this test never calls a transport.
create function pg_temp.probe_recovery_final_gate() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_claim jsonb; v_attempt jsonb;
begin
 select v->'items'->0 into v_item from pg_temp.v2_result where k='new-plan-1';
 begin
  v_claim:=public.begin_legacy_notification_dispatch_v1('registration',v_item->>'occurrenceKey',(v_item->>'ruleId')::uuid,v_item->>'channelKey',v_item->>'targetKey',(v_item->>'targetGeneration')::bigint,'registration_core_legacy_bridge_v1',0,'99840000-0000-4000-8000-000000000950');
  v_attempt:=public.register_notification_external_attempt_v1(null,(v_claim->>'claim_id')::uuid,(v_claim->>'owner_generation')::bigint,null,(v_claim->>'dispatch_token')::uuid,(v_claim->>'dispatch_token')::uuid);
  raise exception 'rollback_recovery_gate_probe';
 exception when raise_exception then
  if sqlerrm<>'rollback_recovery_gate_probe' then raise; end if;
 end;
 return jsonb_build_object('claim',v_claim,'attempt',v_attempt);
end;
$$;
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000002','service_role'); set local role service_role;
insert into v2_result values('final-gate-probe',pg_temp.probe_recovery_final_gate());
select is((select v->'claim'->>'acquired' from v2_result where k='final-gate-probe'),'true','new second-manager source acquires a real dispatch claim');
select ok((select v->'attempt' is not null from v2_result where k='final-gate-probe'),'new second-manager checksum passes the real final external-attempt gate');
insert into v2_result select 'new-claim-1',public.begin_legacy_notification_dispatch_v1('registration',i->>'occurrenceKey',(i->>'ruleId')::uuid,i->>'channelKey',i->>'targetKey',(i->>'targetGeneration')::bigint,'registration_core_legacy_bridge_v1',0,'99840000-0000-4000-8000-000000000951') from v2_result r cross join lateral jsonb_array_elements(r.v->'items')i where r.k='new-plan-1'; reset role;
select pg_temp.set_v2_actor('99840000-0000-4000-8000-000000000002'); set local role authenticated;
select is(public.ensure_registration_workflow_notification_v4('99840000-0000-4000-8000-000000000111',7,'99840000-0000-4000-8000-000000000921','send_registration_management_notification',(select v->>'previewChecksum' from v2_result where k='recovery-1'),(select (v->>'recoverySourceEventId')::uuid from v2_result where k='recovery-1')),(select v from v2_result where k='new-1'),'committed recovery receipt replays after new-source dispatch began'); reset role;
select is((select count(*) from dashboard_private.notification_audit_logs where entity_kind='notification_external_attempt' and action='external_attempt_registered'),0::bigint,'final gate subtransaction leaves zero external-attempt records');
select * from finish();
rollback;
