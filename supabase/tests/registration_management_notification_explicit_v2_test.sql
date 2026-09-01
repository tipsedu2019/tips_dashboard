begin;

select plan(40);
set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

select is(
  pg_catalog.jsonb_build_object(
    'public', has_function_privilege('public', 'public.ensure_registration_workflow_notification_v1(uuid,integer)', 'EXECUTE'),
    'anon', has_function_privilege('anon', 'public.ensure_registration_workflow_notification_v1(uuid,integer)', 'EXECUTE'),
    'authenticated', has_function_privilege('authenticated', 'public.ensure_registration_workflow_notification_v1(uuid,integer)', 'EXECUTE'),
    'serviceRole', has_function_privilege('service_role', 'public.ensure_registration_workflow_notification_v1(uuid,integer)', 'EXECUTE')
  ),
  '{"anon":false,"public":false,"serviceRole":false,"authenticated":false}'::jsonb,
  'mixed-version v1 callers have no execute grant'
);
select throws_ok(
  $$select public.ensure_registration_workflow_notification_v1('99810000-0000-4000-8000-000000000111', 1)$$,
  '55000', 'registration_workflow_notification_v1_retired',
  'the retained v1 signature fails closed for privileged callers'
);
select ok((
  select pg_catalog.pg_get_userbyid(proowner) = 'postgres' and prosecdef
    and provolatile = 'v' and proconfig[1] = any(array['search_path=', 'search_path=""']::text[])
  from pg_catalog.pg_proc
  where oid = 'public.ensure_registration_workflow_notification_v2(uuid,integer,text,text)'::regprocedure
), 'v2 is volatile postgres-owned security-definer with empty search path');
select is(
  pg_catalog.jsonb_build_object(
    'public', has_function_privilege('public', 'public.ensure_registration_workflow_notification_v2(uuid,integer,text,text)', 'EXECUTE'),
    'anon', has_function_privilege('anon', 'public.ensure_registration_workflow_notification_v2(uuid,integer,text,text)', 'EXECUTE'),
    'authenticated', has_function_privilege('authenticated', 'public.ensure_registration_workflow_notification_v2(uuid,integer,text,text)', 'EXECUTE'),
    'serviceRole', has_function_privilege('service_role', 'public.ensure_registration_workflow_notification_v2(uuid,integer,text,text)', 'EXECUTE')
  ),
  '{"anon":false,"public":false,"serviceRole":false,"authenticated":true}'::jsonb,
  'only authenticated callers can execute v2'
);
select ok(
  pg_get_functiondef('public.get_registration_core_legacy_dispatch_plan_v1(uuid,uuid)'::regprocedure)
    like '%registration_management_notification_source_current_v2%',
  'the final manager-authorized plan rechecks the v2 source snapshot'
);
select ok(
  pg_get_functiondef('public.begin_legacy_notification_dispatch_v1(text,text,uuid,text,text,bigint,text,bigint,uuid)'::regprocedure)
    like '%registration_management_notification_snapshot_stale%'
  and pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure)
    like '%registration_management_notification_snapshot_stale%',
  'begin and external-attempt boundaries both fail closed on stale facts'
);
select ok(
  pg_get_functiondef(
    'public.ensure_registration_workflow_notification_v2(uuid,integer,text,text)'::regprocedure
  ) like '%source.task_id = v_track.task_id%'
  and pg_get_functiondef(
    'public.ensure_registration_workflow_notification_v2(uuid,integer,text,text)'::regprocedure
  ) like '%source.field_name = ''registration_track:'' || v_track.id::text%',
  'semantic dedupe filters task and field columns before parsing bounded JSON candidates'
);
select ok(
  pg_get_functiondef(
    'dashboard_private.registration_management_notification_source_current_v2(uuid,uuid)'::regprocedure
  ) like '%notification_request_ledger%'
  and pg_get_functiondef(
    'dashboard_private.registration_management_notification_source_current_v2(uuid,uuid)'::regprocedure
  ) like '%v_ledger.request_fingerprint = pg_catalog.md5%',
  'provider source validation requires the indexed v2 ledger operation and actor fingerprint'
);
select ok(
  pg_get_functiondef(pg_catalog.to_regprocedure(
    'dashboard_private.registration_management_notification_fact_snapshot_v2(uuid,uuid)'
  )) like '%activeSubjects%'
  and pg_get_functiondef(pg_catalog.to_regprocedure(
    'dashboard_private.registration_management_notification_fact_snapshot_v2(uuid,uuid)'
  )) like '%requestedBy%'
  and pg_get_functiondef(pg_catalog.to_regprocedure(
    'dashboard_private.registration_management_notification_fact_snapshot_v2(uuid,uuid)'
  )) like '%directorProfileId%'
  and pg_get_functiondef(pg_catalog.to_regprocedure(
    'dashboard_private.registration_management_notification_fact_snapshot_v2(uuid,uuid)'
  )) like '%actorDisplayName%',
  'fact checksum inventory covers all mutable canonical registration payload inputs'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at
) values
('99810000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-admin@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',null,now(),now()),
('99810000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-staff@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',null,now(),now()),
('99810000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-teacher@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',null,now(),now()),
('99810000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v2-banned@example.invalid',crypt('v2-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now()+interval '1 day',now(),now());
insert into public.profiles(id,role,name,email,created_at,updated_at) values
('99810000-0000-4000-8000-000000000001','admin','v2 원장','v2-admin@example.invalid',now(),now()),
('99810000-0000-4000-8000-000000000002','staff','v2 관리팀','v2-staff@example.invalid',now(),now()),
('99810000-0000-4000-8000-000000000003','teacher','v2 교사','v2-teacher@example.invalid',now(),now()),
('99810000-0000-4000-8000-000000000004','admin','v2 차단 원장','v2-banned@example.invalid',now(),now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;
insert into public.ops_tasks(id,title,type,status,priority,requested_by,student_name) values
('99810000-0000-4000-8000-000000000101','v2 준비 완료','registration','requested','normal','99810000-0000-4000-8000-000000000001','김명시'),
('99810000-0000-4000-8000-000000000102','v2 정보 누락','registration','requested','normal','99810000-0000-4000-8000-000000000001',null);
insert into public.ops_registration_details(task_id,school_grade,inquiry_at,request_note) values
('99810000-0000-4000-8000-000000000101','중2','2026-09-01 18:30+09','명시 발송'),
('99810000-0000-4000-8000-000000000102',null,null,null);
insert into public.ops_registration_subject_tracks(
 id,task_id,subject,pipeline_status,director_profile_id,director_assignment_source,
 director_assigned_at,migration_review_required,workflow_status,workflow_revision,
 workflow_status_entered_at,observation_return_workflow_status,observation_attempt_count
) values
('99810000-0000-4000-8000-000000000111','99810000-0000-4000-8000-000000000101','영어','consultation_waiting','99810000-0000-4000-8000-000000000001','manual',now(),false,'consultation_requested',7,now(),null,0),
('99810000-0000-4000-8000-000000000112','99810000-0000-4000-8000-000000000102','수학','consultation_waiting','99810000-0000-4000-8000-000000000001','manual',now(),false,'consultation_requested',3,now(),null,0);

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
    v_rule_id := '99810000-0000-4000-8000-000000000801';
    insert into dashboard_private.notification_rules(
      id, scope_key, workflow_key, event_key, channel_key, audience_key,
      rule_variant_key, delivery_mode, schedule_key, schedule_config, enabled,
      active_template_id, revision, created_by, created_actor_kind,
      updated_by, updated_actor_kind
    ) values (
      v_rule_id, 'global', 'registration', 'registration.case_created',
      'google_chat', 'management_team', 'immediate', 'immediate', null, null,
      true, '99810000-0000-4000-8000-000000000802', 1,
      null, 'system', null, 'system'
    );
    insert into dashboard_private.notification_templates(
      id, rule_id, version, title_template, body_template, allowed_variables,
      payload_schema_version, checksum, created_by, created_actor_kind
    ) values (
      '99810000-0000-4000-8000-000000000802', v_rule_id, 1,
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

select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000003'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000901','send_registration_management_notification')$$,'42501','registration_management_notification_access_denied','teachers cannot create explicit intent'); reset role;
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000004'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000902','send_registration_management_notification')$$,'42501','registration_management_notification_access_denied','banned managers cannot create explicit intent'); reset role;
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'not-a-uuid','send_registration_management_notification')$$,'22023','registration_management_notification_intent_invalid','v2 requires UUID request key');
select throws_ok($$select public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000903','status_changed')$$,'22023','registration_management_notification_intent_invalid','v2 requires exact send intent');
select throws_ok($$select public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',6,'99810000-0000-4000-8000-000000000904','send_registration_management_notification')$$,'23514','registration_management_notification_refresh_required','v2 requires exact workflow revision');
select throws_ok($$select public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000112',3,'99810000-0000-4000-8000-000000000905','send_registration_management_notification')$$,'23514','registration_management_notification_not_ready','missing facts block only send'); reset role;

insert into dashboard_private.notification_request_ledger(request_id,request_kind,request_fingerprint,response_payload)
values('99810000-0000-4000-8000-000000000906','legacy_dispatch_begin','existing-operation','{"acquired":false}');
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000906','send_registration_management_notification')$$,'22023','idempotency_key_reused','request UUID owned by another operation is rejected'); reset role;

insert into public.ops_task_events(id,task_id,actor_id,event_type,field_name,after_value) values(
'99810000-0000-4000-8000-000000000701','99810000-0000-4000-8000-000000000101','99810000-0000-4000-8000-000000000001','registration_track_event','registration_track:99810000-0000-4000-8000-000000000111',
jsonb_build_object('version',2,'event_type','registration_workflow_status_changed','actor_profile_id','99810000-0000-4000-8000-000000000001'::uuid,'actor_kind','user','track_id','99810000-0000-4000-8000-000000000111'::uuid,'subject','영어','source','inquiry','destination','consultation_requested','metadata',jsonb_build_object('workflowRevision',7),'occurred_at',clock_timestamp())::text);
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('first',public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000907','send_registration_management_notification')); reset role;

select is((select jsonb_build_object('ready',(v->>'ready')::boolean,'requestKey',v->>'requestKey','sourceCount',jsonb_array_length(v->'sourceEventIds'),'checksumValid',v->>'factsChecksum'~'^[a-f0-9]{64}$') from v2_result where k='first'),'{"ready":true,"requestKey":"99810000-0000-4000-8000-000000000907","sourceCount":1,"checksumValid":true}'::jsonb,'explicit click returns one checksummed source');
select is((select jsonb_build_object('eventType',p.payload->>'event_type','version',(p.payload->'metadata'->>'contractVersion')::int,'intent',p.payload->'metadata'->>'intent','requestKey',p.payload->'metadata'->>'requestKey','checksumMatch',p.payload->'metadata'->>'factsChecksum'=r.v->>'factsChecksum') from v2_result r join public.ops_task_events e on e.id=(r.v->'sourceEventIds'->>0)::uuid cross join lateral (select dashboard_private.try_registration_event_jsonb_object(e.after_value) as payload) p where r.k='first'),'{"intent":"send_registration_management_notification","version":2,"eventType":"registration_management_notification_requested","requestKey":"99810000-0000-4000-8000-000000000907","checksumMatch":true}'::jsonb,'source records exact intent request and checksum');
select isnt((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='first'),'99810000-0000-4000-8000-000000000701'::uuid,'status audit is never reused');
select is((select jsonb_build_object('kind',l.request_kind,'sourceMatch',l.response_payload->>'sourceEventId'=r.v->'sourceEventIds'->>0,'canonical',(select count(*) from dashboard_private.notification_events n where n.source_id=r.v->'sourceEventIds'->>0 and n.event_key='registration.case_created')) from dashboard_private.notification_request_ledger l cross join v2_result r where l.request_id='99810000-0000-4000-8000-000000000907' and r.k='first'),'{"kind":"registration_management_notification_v2","canonical":1,"sourceMatch":true}'::jsonb,'indexed ledger owns one source and canonical event');
select ok(dashboard_private.registration_management_notification_source_current_v2((select (v->'sourceEventIds'->>0)::uuid from v2_result where k='first'),'99810000-0000-4000-8000-000000000001'),'new source is current');

select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('replay',public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000907','send_registration_management_notification')); reset role;
select is((select v from v2_result where k='replay'),(select v from v2_result where k='first'),'same actor replay returns exact receipt');
select is((select jsonb_build_object('sources',(select count(*) from public.ops_task_events e where e.task_id='99810000-0000-4000-8000-000000000101' and dashboard_private.try_registration_event_jsonb_object(e.after_value)->>'event_type'='registration_management_notification_requested'),'ledgers',(select count(*) from dashboard_private.notification_request_ledger where request_id='99810000-0000-4000-8000-000000000907'))),'{"sources":1,"ledgers":1}'::jsonb,'replay creates no duplicates');
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000002'); set local role authenticated;
select throws_ok($$select public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000907','send_registration_management_notification')$$,'22023','idempotency_key_reused','different actor cannot replay request UUID'); reset role;
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000002'); set local role authenticated;
insert into v2_result values('semantic',public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000910','send_registration_management_notification')); reset role;
select is((select jsonb_build_object('sameSource',s.v->'sourceEventIds'=f.v->'sourceEventIds','alreadyRequested',(s.v->>'alreadyRequested')::boolean,'sources',(select count(*) from public.ops_task_events e where e.task_id='99810000-0000-4000-8000-000000000101' and dashboard_private.try_registration_event_jsonb_object(e.after_value)->>'event_type'='registration_management_notification_requested'),'canonicals',(select count(*) from dashboard_private.notification_events n where n.source_id=f.v->'sourceEventIds'->>0 and n.event_key='registration.case_created'),'ledgers',(select count(*) from dashboard_private.notification_request_ledger l where l.request_id in ('99810000-0000-4000-8000-000000000907','99810000-0000-4000-8000-000000000910'))) from v2_result s cross join v2_result f where s.k='semantic' and f.k='first'),'{"sources":1,"ledgers":2,"canonicals":1,"sameSource":true,"alreadyRequested":true}'::jsonb,'a new UUID and another active manager reuse one semantic source and canonical');
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000002'); set local role authenticated;
insert into v2_result values('semantic-replay',public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000910','send_registration_management_notification')); reset role;
select is((select jsonb_build_object('sameReceipt',r.v=s.v,'ready',(r.v->>'ready')::boolean,'sourceCount',(select count(*) from public.ops_task_events e where e.task_id='99810000-0000-4000-8000-000000000101' and dashboard_private.try_registration_event_jsonb_object(e.after_value)->>'event_type'='registration_management_notification_requested'),'canonicalCount',(select count(*) from dashboard_private.notification_events n where n.source_id=s.v->'sourceEventIds'->>0 and n.event_key='registration.case_created'),'suppressionCount',(select count(*) from dashboard_private.notification_audit_logs a where a.entity_id=s.v->'sourceEventIds'->>0 and a.action='stale_notification_suppressed')) from v2_result r cross join v2_result s where r.k='semantic-replay' and s.k='semantic'),'{"ready":true,"sameReceipt":true,"sourceCount":1,"canonicalCount":1,"suppressionCount":0}'::jsonb,'cross-manager semantic request replay keeps the original source current without suppression');

select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result select 'plan-before',public.get_registration_core_legacy_dispatch_plan_v1((v->'sourceEventIds'->>0)::uuid,'99810000-0000-4000-8000-000000000001') from v2_result where k='first'; reset role;
select is((select jsonb_array_length(v->'items') from v2_result where k='plan-before'),1,'current v2 source produces one adapter item');
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result select 'begin-before',public.begin_legacy_notification_dispatch_v1('registration',i->>'occurrenceKey',(i->>'ruleId')::uuid,i->>'channelKey',i->>'targetKey',(i->>'targetGeneration')::bigint,'registration_core_legacy_bridge_v1',0,'99810000-0000-4000-8000-000000000908') from v2_result r cross join lateral jsonb_array_elements(r.v->'items')i where r.k='plan-before'; reset role;
select is((select (v->>'acquired')::boolean from v2_result where k='begin-before'),true,'current snapshot acquires adapter claim');
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000002'); set local role authenticated;
insert into v2_result values('started-semantic',public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000911','send_registration_management_notification')); reset role;
select is((select jsonb_build_object('sameSource',s.v->'sourceEventIds'=f.v->'sourceEventIds','alreadyRequested',(s.v->>'alreadyRequested')::boolean,'sourceCount',(select count(*) from public.ops_task_events e where e.task_id='99810000-0000-4000-8000-000000000101' and dashboard_private.try_registration_event_jsonb_object(e.after_value)->>'event_type'='registration_management_notification_requested')) from v2_result s cross join v2_result f where s.k='started-semantic' and f.k='first'),'{"sameSource":true,"sourceCount":1,"alreadyRequested":true}'::jsonb,'dispatch-started uncertainty cannot create a second semantic source');
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000002','service_role'); set local role service_role;
insert into v2_result select 'begin-semantic-retry',public.begin_legacy_notification_dispatch_v1('registration',i->>'occurrenceKey',(i->>'ruleId')::uuid,i->>'channelKey',i->>'targetKey',(i->>'targetGeneration')::bigint,'registration_core_legacy_bridge_v1',0,'99810000-0000-4000-8000-000000000912') from v2_result r cross join lateral jsonb_array_elements(r.v->'items')i where r.k='plan-before'; reset role;
select is((select jsonb_build_object('acquired',(v->>'acquired')::boolean,'status',v->>'status','reason',v->>'reason') from v2_result where k='begin-semantic-retry'),'{"reason":"ownership_not_acquired","status":"legacy_deduped","acquired":false}'::jsonb,'redispatching the reused source cannot reacquire provider ownership');

insert into dashboard_private.notification_target_reconciliation_jobs(workflow_key,source_type,source_id,source_revision,source_event_id,reconciliation_kind,target_generation,current_target_set_hash,status,next_attempt_at)
select 'registration',n.source_type,n.source_id,n.source_revision,n.id,'recipient_set_changed',41,'v2-target-set','pending',clock_timestamp() from dashboard_private.notification_events n join v2_result r on n.source_id=r.v->'sourceEventIds'->>0 where r.k='first' and n.event_key='registration.case_created';
insert into dashboard_private.notification_deliveries(event_id,rule_id,rule_revision,template_id,channel_key,audience_key,target_generation,target_set_hash,target_kind,target_key,connection_key,target_snapshot,status,dedupe_key,rendered_title,rendered_body,href,scheduled_for,max_attempts,claimed_by,claim_token,lease_expires_at,last_attempt_started_at)
select n.id,u.id,u.revision,u.active_template_id,'google_chat','management_team',s.g,'set-'||s.g,'connection','connection:google_chat.management:'||s.g,'google_chat.management','{"connection_key":"google_chat.management"}',s.st,'dedupe-'||s.g,'title','body','/admin/registration?taskId=99810000-0000-4000-8000-000000000101',clock_timestamp(),3,case when s.st='sending' then 'worker' end,case when s.st='sending' then '99810000-0000-4000-8000-000000000951'::uuid end,case when s.st='sending' then clock_timestamp()+interval '5 min' end,case when s.st='sending' then clock_timestamp() end
from dashboard_private.notification_events n join v2_result r on n.source_id=r.v->'sourceEventIds'->>0 join dashboard_private.notification_rules u on u.workflow_key='registration' and u.event_key=n.event_key and u.channel_key='google_chat' and u.audience_key='management_team' cross join(values('pending'::text,41),('sending'::text,42),('sent'::text,43))s(st,g) where r.k='first' and n.event_key='registration.case_created';

select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('delivery-semantic',public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000913','send_registration_management_notification')); reset role;
select is((select jsonb_build_object('sameSource',s.v->'sourceEventIds'=f.v->'sourceEventIds','alreadyRequested',(s.v->>'alreadyRequested')::boolean,'sources',(select count(*) from public.ops_task_events e where e.task_id='99810000-0000-4000-8000-000000000101' and dashboard_private.try_registration_event_jsonb_object(e.after_value)->>'event_type'='registration_management_notification_requested'),'sending',(select count(*) from dashboard_private.notification_deliveries d join dashboard_private.notification_events n on n.id=d.event_id where n.source_id=f.v->'sourceEventIds'->>0 and d.status='sending'),'sent',(select count(*) from dashboard_private.notification_deliveries d join dashboard_private.notification_events n on n.id=d.event_id where n.source_id=f.v->'sourceEventIds'->>0 and d.status='sent')) from v2_result s cross join v2_result f where s.k='delivery-semantic' and f.k='first'),'{"sent":1,"sources":1,"sending":1,"sameSource":true,"alreadyRequested":true}'::jsonb,'sending and sent evidence still reuse exactly one semantic source');

select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001'); set local role authenticated;
select lives_ok($$select public.sync_registration_case_subjects('99810000-0000-4000-8000-000000000101',array['영어','수학']::text[],'v2-add-math-after-source')$$,'subject fact edit stays notification-independent');
insert into v2_result values('stale',public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000907','send_registration_management_notification')); reset role;
select is((select jsonb_build_object('ready',(v->>'ready')::boolean,'sources',jsonb_array_length(v->'sourceEventIds'),'message',v->'missingFields'->>0) from v2_result where k='stale'),'{"ready":false,"sources":0,"message":"등록정보가 변경되어 알림을 다시 확인해 주세요"}'::jsonb,'stale replay commits no-send suppression');
select is((select jsonb_build_object('fanout',f.status,'target',t.status,'pending',p.status,'sending',s.status,'sent',done.status,'cancelMarked',s.cancel_requested_at is not null,'audit',exists(select 1 from dashboard_private.notification_audit_logs a where a.entity_id=n.source_id and a.action='external_attempt_uncertainty_preserved')) from dashboard_private.notification_events n join v2_result r on n.source_id=r.v->'sourceEventIds'->>0 join dashboard_private.notification_event_fanout_jobs f on f.event_id=n.id join dashboard_private.notification_target_reconciliation_jobs t on t.source_event_id=n.id and t.target_generation=41 join dashboard_private.notification_deliveries p on p.event_id=n.id and p.target_generation=41 join dashboard_private.notification_deliveries s on s.event_id=n.id and s.target_generation=42 join dashboard_private.notification_deliveries done on done.event_id=n.id and done.target_generation=43 where r.k='first' and n.event_key='registration.case_created'),'{"sent":"sent","audit":true,"target":"failed","fanout":"failed","pending":"canceled","sending":"sending","cancelMarked":true}'::jsonb,'stale suppression cancels backlog and preserves sending/sent uncertainty');

select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result select 'plan-after',public.get_registration_core_legacy_dispatch_plan_v1((v->'sourceEventIds'->>0)::uuid,'99810000-0000-4000-8000-000000000001') from v2_result where k='first';
insert into v2_result select 'external',public.register_notification_external_attempt_v1(null,(v->>'claim_id')::uuid,(v->>'owner_generation')::bigint,null,(v->>'dispatch_token')::uuid,(v->>'dispatch_token')::uuid) from v2_result where k='begin-before'; reset role;
select is((select jsonb_array_length(v->'items') from v2_result where k='plan-after'),0,'changed active subjects make plan items empty');
select is((select jsonb_build_object('allowed',(v->>'allowed')::boolean,'reason',v->>'reason') from v2_result where k='external'),'{"allowed":false,"reason":"registration_management_notification_snapshot_stale"}'::jsonb,'external attempt rejects stale source');
select is((select count(*) from dashboard_private.notification_audit_logs a join v2_result b on a.request_id=(b.v->>'dispatch_token')::uuid where b.k='begin-before' and a.entity_kind='notification_external_attempt' and a.action='external_attempt_registered'),0::bigint,'stale rejection records no provider attempt');
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result select 'begin-after',public.begin_legacy_notification_dispatch_v1('registration',i->>'occurrenceKey',(i->>'ruleId')::uuid,i->>'channelKey',i->>'targetKey',(i->>'targetGeneration')::bigint,'registration_core_legacy_bridge_v1',0,'99810000-0000-4000-8000-000000000909') from v2_result r cross join lateral jsonb_array_elements(r.v->'items')i where r.k='plan-before'; reset role;
select is((select jsonb_build_object('acquired',(v->>'acquired')::boolean,'reason',v->>'reason') from v2_result where k='begin-after'),'{"reason":"registration_management_notification_snapshot_stale","acquired":false}'::jsonb,'begin rechecks stale snapshot');

select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001'); set local role authenticated;
insert into v2_result values('refreshed',public.ensure_registration_workflow_notification_v2('99810000-0000-4000-8000-000000000111',7,'99810000-0000-4000-8000-000000000914','send_registration_management_notification')); reset role;
select is((select pg_catalog.jsonb_build_object('ready',(fresh.v->>'ready')::boolean,'newSource',fresh.v->'sourceEventIds'<>old.v->'sourceEventIds','newChecksum',fresh.v->>'factsChecksum'<>old.v->>'factsChecksum','sourceCount',(select count(*) from public.ops_task_events e where e.task_id='99810000-0000-4000-8000-000000000101' and dashboard_private.try_registration_event_jsonb_object(e.after_value)->>'event_type'='registration_management_notification_requested'),'canonicalCount',(select count(*) from dashboard_private.notification_events n where n.source_id in (old.v->'sourceEventIds'->>0,fresh.v->'sourceEventIds'->>0) and n.event_key='registration.case_created'),'subjects',(select n.payload->'subjects' from dashboard_private.notification_events n where n.source_id=fresh.v->'sourceEventIds'->>0 and n.event_key='registration.case_created'),'oldCurrent',dashboard_private.registration_management_notification_source_current_v2((old.v->'sourceEventIds'->>0)::uuid,null),'newCurrent',dashboard_private.registration_management_notification_source_current_v2((fresh.v->'sourceEventIds'->>0)::uuid,null)) from v2_result fresh cross join v2_result old where fresh.k='refreshed' and old.k='first'),'{"ready":true,"newSource":true,"newChecksum":true,"sourceCount":2,"canonicalCount":2,"subjects":["영어","수학"],"oldCurrent":false,"newCurrent":true}'::jsonb,'a new UUID after subject sync creates one new current source with the complete active-subject payload');

do $$ begin
  perform dashboard_private.record_registration_management_notification_v1(
    '99810000-0000-4000-8000-000000000701',
    'registration.case_created',
    '99810000-0000-4000-8000-000000000101',
    '99810000-0000-4000-8000-000000000111',
    7,
    clock_timestamp(),
    '99810000-0000-4000-8000-000000000001'
  );
end $$;
select pg_temp.set_v2_actor('99810000-0000-4000-8000-000000000001','service_role'); set local role service_role;
insert into v2_result values('old-plan',public.get_registration_core_legacy_dispatch_plan_v1('99810000-0000-4000-8000-000000000701','99810000-0000-4000-8000-000000000001')); reset role;
select is((select jsonb_array_length(v->'items') from v2_result where k='old-plan'),0,'pre-v2 status-origin canonical remains provider-zero');

select * from finish();
rollback;
