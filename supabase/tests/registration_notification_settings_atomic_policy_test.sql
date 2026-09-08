begin;
select no_plan();
set local statement_timeout = '90s';
set local lock_timeout = '5s';

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('99480000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'atomic-admin@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
 ('99480000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'atomic-teacher@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into public.profiles(id, role, name) values
 ('99480000-0000-4000-8000-000000000001', 'admin', '원자적 저장 관리자'),
 ('99480000-0000-4000-8000-000000000002', 'teacher', '원자적 저장 교사')
on conflict(id) do update set role = excluded.role;
insert into dashboard_private.notification_runtime_flags(flag_key, enabled)
values ('notification_control_plane_settings_ui_enabled', true)
on conflict(flag_key) do update set enabled = excluded.enabled;

-- Synthetic rules keep this behavior test independent of stripped baseline DML.
insert into dashboard_private.notification_rules(id,scope_key,workflow_key,event_key,channel_key,audience_key,
 rule_variant_key,delivery_mode,enabled,active_template_id,revision,created_actor_kind,updated_actor_kind)
values
 ('99480000-0000-4000-8000-000000000101','global','tasks','task.created','google_chat','management_team','immediate','immediate',false,'99480000-0000-4000-8000-000000000201',1,'system','system'),
 ('99480000-0000-4000-8000-000000000102','global','tasks','task.completed','google_chat','management_team','immediate','immediate',false,'99480000-0000-4000-8000-000000000202',1,'system','system'),
 ('99480000-0000-4000-8000-000000000103','global','registration','registration.observation_scheduled','google_chat','subject_team','immediate','immediate',false,'99480000-0000-4000-8000-000000000203',1,'system','system')
on conflict do nothing;
insert into dashboard_private.notification_settings_ui_registry(rule_id,workflow_key,workflow_label,workflow_sort,event_key,event_label,group_label,trigger_description,event_sort,audience_key,audience_label,channel_key,channel_label,cell_sort,initial_enabled)
select r.id,r.workflow_key,'검증',1,r.event_key,'검증','검증','명시적 검증',1,r.audience_key,'관리팀',r.channel_key,'Google Chat',1,false
from dashboard_private.notification_rules r where r.id::text like '99480000-0000-4000-8000-00000000010%'
on conflict do nothing;
insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,allowed_variables,payload_schema_version,checksum,created_actor_kind)
select r.active_template_id,r.id,1,'설정 검증','설정 검증','[]',1,repeat('a',64),'system'
from dashboard_private.notification_rules r where r.id::text like '99480000-0000-4000-8000-00000000010%'
on conflict do nothing;
insert into dashboard_private.notification_rule_content_contracts(rule_id,workflow_key,event_key,audience_key,channel_key,rule_variant_key,contract_version,contract_json)
select r.id,r.workflow_key,r.event_key,r.audience_key,r.channel_key,r.rule_variant_key,'1',
 dashboard_private.notification_content_contract_for_identity_v1(case when r.workflow_key='tasks' then r.event_key else 'registration.case_created' end,r.audience_key,r.channel_key)
from dashboard_private.notification_rules r where r.id::text like '99480000-0000-4000-8000-00000000010%'
on conflict do nothing;
insert into dashboard_private.notification_rule_mention_settings(rule_id, mention_enabled, revision)
select rule.id, false, 1 from dashboard_private.notification_rules rule
where (rule.workflow_key='tasks' and rule.channel_key='google_chat' and rule.event_key in ('task.created','task.completed'))
 or (rule.workflow_key='registration' and rule.channel_key='google_chat' and rule.event_key='registration.observation_scheduled')
on conflict(rule_id) do nothing;

create temporary table atomic_fixture on commit drop as
select row_number() over(order by rule.id) as n, rule.id, rule.revision, contract.contract_version,
 (select string_agg('{' || (v.value ->> 'token') || '}', E'\n') from jsonb_array_elements(contract.contract_json -> 'availableVariables') v(value) where contract.contract_json -> 'requiredTokens' ? (v.value ->> 'token')) as body_template, setting.mention_enabled, setting.revision as mention_revision
from dashboard_private.notification_rules rule
join dashboard_private.notification_rule_content_contracts contract on contract.rule_id = rule.id
join dashboard_private.notification_templates template on template.id = rule.active_template_id
join dashboard_private.notification_rule_mention_settings setting on setting.rule_id = rule.id
where rule.id in (
 '99480000-0000-4000-8000-000000000101',
 '99480000-0000-4000-8000-000000000102'
)
order by rule.id limit 2;
select is((select count(*) from atomic_fixture), 2::bigint, 'two seeded current rules exercise ordered mention mutations');
create temporary table atomic_baseline on commit drop as select
 (select count(*) from dashboard_private.notification_request_ledger) ledger_count,
 (select count(*) from dashboard_private.notification_rule_mention_setting_audits) mention_audits,
 (select count(*) from dashboard_private.notification_rule_reconciliation_jobs) jobs,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;

create function pg_temp.atomic_call(p_request uuid, p_bad_rule boolean default false, p_bad_mention boolean default false,
 p_actor uuid default '99480000-0000-4000-8000-000000000001', p_bad_contract boolean default false) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r record; m jsonb; e jsonb; result jsonb;
begin
 select * into strict r from pg_temp.atomic_fixture where n = 1;
 select jsonb_object_agg(id::text, not mention_enabled),
   jsonb_object_agg(id::text, (mention_revision + case when n = 2 and p_bad_mention then 10 else 0 end)::text)
 into m, e from pg_temp.atomic_fixture;
 perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
 perform set_config('request.jwt.claim.sub', p_actor::text, true);
 perform set_config('request.jwt.claim.role', 'authenticated', true);
 execute 'set local role authenticated';
 result := public.save_notification_settings_v1('tasks',
   jsonb_build_object(r.id::text, (r.revision + case when p_bad_rule then 10 else 0 end)::text),
   jsonb_build_object(r.id::text, case when p_bad_contract then '9999999' else r.contract_version end),
   jsonb_build_object('rules', jsonb_build_object(r.id::text, jsonb_build_object('title_template','설정 검증', 'body_template', r.body_template || E'\n설정 검증'))),
   e, m, p_request);
 execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;

select ok(has_function_privilege('authenticated', 'public.save_notification_settings_v1(text,jsonb,jsonb,jsonb,jsonb,jsonb,uuid,jsonb)', 'execute')
 and not has_function_privilege('anon', 'public.save_notification_settings_v1(text,jsonb,jsonb,jsonb,jsonb,jsonb,uuid,jsonb)', 'execute')
 and not has_function_privilege('service_role', 'public.save_notification_settings_v1(text,jsonb,jsonb,jsonb,jsonb,jsonb,uuid,jsonb)', 'execute'),
 'atomic RPC admits only authenticated callers before its manager guard');
select ok(not has_function_privilege('authenticated', 'dashboard_private.assert_notification_settings_patch_editable_v1(jsonb)', 'execute'), 'private archive guard cannot be called directly');
select is((select proconfig from pg_proc where oid = 'public.save_notification_settings_v1(text,jsonb,jsonb,jsonb,jsonb,jsonb,uuid,jsonb)'::regprocedure), array['search_path=""'], 'atomic RPC has an empty search path');
select throws_ok($$select pg_temp.atomic_call('99480000-0000-4000-8000-000000000010', false, false, '99480000-0000-4000-8000-000000000002')$$,
 '42501', 'notification_access_denied', 'teacher cannot edit settings');
select throws_ok($$select pg_temp.atomic_call('99480000-0000-4000-8000-000000000011', true, false)$$,
 '23514', 'notification_revision_conflict', 'final rule implementation uses business conflict SQLSTATE');
select throws_ok($$select pg_temp.atomic_call('99480000-0000-4000-8000-000000000014', false, false, '99480000-0000-4000-8000-000000000001', true)$$,
 '23514', 'notification_contract_version_conflict', 'final contract implementation uses business conflict SQLSTATE');
select throws_ok($$select pg_temp.atomic_call('99480000-0000-4000-8000-000000000012', false, true)$$,
 '23514', 'notification_mention_setting_revision_conflict', 'second mention conflict rolls back preceding rule and first mention');
select ok(not exists(select 1 from atomic_fixture f join dashboard_private.notification_rules r on r.id = f.id where r.revision <> f.revision), 'rule revision remains unchanged after late mention conflict');
select ok(not exists(select 1 from atomic_fixture f join dashboard_private.notification_rule_mention_settings s on s.rule_id = f.id where s.revision <> f.mention_revision or s.mention_enabled <> f.mention_enabled), 'all mention values and revisions remain unchanged');
select is((select count(*) from dashboard_private.notification_request_ledger), (select ledger_count from atomic_baseline), 'failure leaves no outer or nested idempotency receipt');
select is((select count(*) from dashboard_private.notification_rule_mention_setting_audits), (select mention_audits from atomic_baseline), 'failure rolls back mention audits');
select is((select count(*) from dashboard_private.notification_rule_reconciliation_jobs), (select jobs from atomic_baseline), 'failure rolls back reconciliation jobs');

create temporary table atomic_success on commit drop as select pg_temp.atomic_call('99480000-0000-4000-8000-000000000013') payload;
select ok((select payload ? 'mention_settings' and payload ? 'rules' from atomic_success), 'single commit returns both updated domains');
select is((select revision from dashboard_private.notification_rules where id = (select id from atomic_fixture where n = 1)), (select revision + 1 from atomic_fixture where n = 1), 'successful atomic save updates rule once');
select ok(not exists(select 1 from atomic_fixture f join dashboard_private.notification_rule_mention_settings s on s.rule_id=f.id where s.revision <> f.mention_revision + 1 or s.mention_enabled = f.mention_enabled), 'successful atomic save updates both mentions once');
select is(pg_temp.atomic_call('99480000-0000-4000-8000-000000000013'), (select payload from atomic_success), 'lost-response replay precedes both stale revision checks');
select throws_ok($$select pg_temp.atomic_call('99480000-0000-4000-8000-000000000013', false, true)$$,
 '22023', 'idempotency_key_reused', 'same request cannot change mention payload');
update auth.users set banned_until=now()+interval '1 day' where id='99480000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.atomic_call('99480000-0000-4000-8000-000000000013')$$,
 '42501','notification_access_denied','banned manager cannot replay an existing atomic save receipt');
update auth.users set banned_until=null,deleted_at=now() where id='99480000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.atomic_call('99480000-0000-4000-8000-000000000013')$$,
 '42501','notification_access_denied','deleted manager cannot replay an existing atomic save receipt');
update auth.users set deleted_at=null where id='99480000-0000-4000-8000-000000000001';
select is((select count(*) from dashboard_private.notification_deliveries), (select deliveries from atomic_baseline), 'settings save creates no delivery attempts');
select throws_ok(format(
 'select public.save_notification_settings_v1(''transfer'', ''{}'', ''{}'', ''{"rules":{}}'', %L, %L, ''99480000-0000-4000-8000-000000000015'')',
 (select jsonb_build_object(id::text, mention_revision::text)::text from atomic_fixture where n=1),
 (select jsonb_build_object(id::text, true)::text from atomic_fixture where n=1)),
 '22023', 'notification_rule_unknown', 'atomic save rejects a mention from another workflow');

create function pg_temp.archived_write(p_kind text) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r record; result jsonb;
begin
 select rule.*, setting.revision as mention_revision, contract.contract_version into strict r
 from dashboard_private.notification_rules rule
 join dashboard_private.notification_rule_mention_settings setting on setting.rule_id = rule.id
 join dashboard_private.notification_rule_content_contracts contract on contract.rule_id = rule.id
 where rule.workflow_key = 'registration' and rule.event_key = 'registration.observation_scheduled' and rule.channel_key='google_chat';
 perform set_config('request.jwt.claims', '{"sub":"99480000-0000-4000-8000-000000000001","role":"authenticated"}', true);
 perform set_config('request.jwt.claim.sub', '99480000-0000-4000-8000-000000000001', true);
 execute 'set local role authenticated';
 if p_kind = 'mention' then
   result := public.save_notification_rule_mention_setting_v1(r.id, true, r.mention_revision, '99480000-0000-4000-8000-000000000020');
 elsif p_kind = 'legacy' then
   result := public.save_notification_control_plane_v1('registration', jsonb_build_object(r.id::text,r.revision::text),
     jsonb_build_object('rules',jsonb_build_object(r.id::text,jsonb_build_object('enabled',true))), '99480000-0000-4000-8000-000000000021');
 else
   result := public.save_notification_control_plane_v2('registration', jsonb_build_object(r.id::text,r.revision::text), jsonb_build_object(r.id::text,r.contract_version),
     jsonb_build_object('rules',jsonb_build_object(r.id::text,jsonb_build_object('body_template','이전 문구 변경'))), '99480000-0000-4000-8000-000000000022');
 end if;
 execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;
select throws_ok($$select pg_temp.archived_write('mention')$$, '23514', 'notification_setting_archived', 'legacy mention API cannot alter archived settings');
select throws_ok($$select pg_temp.archived_write('legacy')$$, '23514', 'notification_setting_archived', 'legacy rule API cannot reactivate archived settings');
select throws_ok($$select pg_temp.archived_write('current')$$, '23514', 'notification_setting_archived', 'current rule API cannot edit archived text');
select is((select count(*) from (values ('registration.observation_scheduled'),('registration.observation_rescheduled'),('registration.observation_canceled'),('registration.observation_reminder_due'),('registration.observation_feedback_due'),('registration.observation_feedback_submitted'),('registration.observation_director_reassigned'),('registration.appointment_reminder_due'),('registration.appointment_reminder_due'),('registration.appointment_reminder_due'),('registration.registration_completed'),('registration.case_closed')) identity(event_key) where dashboard_private.notification_registration_setting_archived_v1('registration',identity.event_key,'google_chat')),12::bigint,'archive policy covers seven observation, three reminder and two closing rules');
select ok(not exists(select 1 from dashboard_private.notification_rules r where dashboard_private.notification_registration_setting_archived_v1(r.workflow_key,r.event_key,r.channel_key)
 and (dashboard_private.notification_rule_mention_setting_json_v1(r.id)->>'editable')::boolean), 'archived mention DTO is read only while preserving stored value');
select * from finish();
rollback;
