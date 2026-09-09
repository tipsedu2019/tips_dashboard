begin;
set local search_path = extensions, public;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
select no_plan();

-- The isolated catalog intentionally contains no customer rules or deliveries.
insert into dashboard_private.notification_rules(id,workflow_key,event_key,channel_key,
  audience_key,rule_variant_key,delivery_mode,enabled,active_template_id,created_actor_kind,updated_actor_kind)
values
 ('99700000-0000-4000-8000-000000000201','word_retests','word_retest.result_reported','google_chat',
  'management_team','immediate','immediate',false,'99700000-0000-4000-8000-000000000301','system','system'),
 ('99700000-0000-4000-8000-000000000202','tasks','task.created','google_chat',
  'management_team','immediate','immediate',false,'99700000-0000-4000-8000-000000000302','system','system');
insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,
  allowed_variables,payload_schema_version,checksum,created_actor_kind)
values
 ('99700000-0000-4000-8000-000000000301','99700000-0000-4000-8000-000000000201',1,'검증','검증','[]',1,repeat('a',64),'system'),
 ('99700000-0000-4000-8000-000000000302','99700000-0000-4000-8000-000000000202',1,'검증','검증','[]',1,repeat('b',64),'system');

select is((select count(*)::integer from dashboard_private.notification_rules
  where workflow_key='word_retests' and channel_key='google_chat' and enabled
    and not (event_key='word_retest.result_reported' and audience_key='subject_team')), 0,
  'all word retest Google Chat rules except the subject result rule remain disabled');
select ok(exists(select 1 from dashboard_private.notification_rules
  where workflow_key='word_retests' and channel_key='google_chat'),
  'historical rules remain available for delivery audit foreign keys');
select throws_ok($$update dashboard_private.notification_rules set enabled=true
  where id='99700000-0000-4000-8000-000000000201'$$,
  '23514',null,'a stale settings client cannot re-enable retired management-team word retest Chat');

insert into dashboard_private.notification_dispatch_ownership_claims(
  id,workflow_key,occurrence_key,rule_id,channel_key,target_key,target_generation,
  owner_kind,owner_generation,state,dispatch_started_at,dispatch_token)
select '99700000-0000-4000-8000-000000000001','word_retests','q12-retired-chat',id,
  'google_chat','connection:google_chat.management',0,'legacy',0,'dispatch_started',now(),
  '99700000-0000-4000-8000-000000000101'
from dashboard_private.notification_rules where id='99700000-0000-4000-8000-000000000201';
insert into dashboard_private.notification_dispatch_ownership_claims(
  id,workflow_key,occurrence_key,rule_id,channel_key,target_key,target_generation,
  owner_kind,owner_generation,state,dispatch_started_at,dispatch_token)
select '99700000-0000-4000-8000-000000000002','tasks','q12-task-chat',id,
  'google_chat','connection:google_chat.management',0,'legacy',0,'dispatch_started',now(),
  '99700000-0000-4000-8000-000000000102'
from dashboard_private.notification_rules where workflow_key='tasks' and channel_key='google_chat'
order by id limit 1;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.register_notification_external_attempt_v1(null,
  '99700000-0000-4000-8000-000000000001',0,null,
  '99700000-0000-4000-8000-000000000101','99700000-0000-4000-8000-000000000101'),
  '{"allowed":false,"reason":"word_retest_google_chat_retired"}'::jsonb,
  'a previously started legacy word retest claim cannot attempt external delivery');
select is((public.register_notification_external_attempt_v1(null,
  '99700000-0000-4000-8000-000000000002',0,null,
  '99700000-0000-4000-8000-000000000102','99700000-0000-4000-8000-000000000102')->>'allowed')::boolean,
  true,'the ordinary task external-attempt contract remains available without calling a provider');
reset role;
select is((select count(*)::integer from dashboard_private.notification_audit_logs
  where entity_kind='notification_external_attempt' and action='external_attempt_registered'
  and entity_id like '99700000-0000-4000-8000-000000000001:%'),0,
  'a retired word retest claim registers no external attempt');
select is((select state from dashboard_private.notification_dispatch_ownership_claims
  where id='99700000-0000-4000-8000-000000000001'),'dispatch_started',
  'retirement does not rewrite a possibly delivered historical claim');
select ok((select prosecdef and pg_get_userbyid(proowner)='postgres'
  and proconfig=array['search_path=""']::text[] from pg_proc where oid=
  'public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure),
  'the final external-attempt function retains owner and empty search path');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.register_notification_external_attempt_v1(null,
  '99700000-0000-4000-8000-000000000001',0,null,
  '99700000-0000-4000-8000-000000000101','99700000-0000-4000-8000-000000000101')$$,
  '42501',null,'authenticated clients cannot bypass the service-only external-attempt API');
reset role;
select * from finish();
rollback;
