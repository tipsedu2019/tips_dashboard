begin;
set local search_path = public, extensions;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;
select no_plan();

-- Entirely synthetic transaction. No provider job, URL, token or live source.
insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('84910000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','render-bridge@example.invalid',now(),'{"provider":"email","providers":["email"]}','{}');
insert into public.profiles(id,role,name,email)
values ('84910000-0000-4000-8000-000000000001','staff','가상 담당','render-bridge@example.invalid')
on conflict(id) do update set role=excluded.role,name=excluded.name;
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_name,reason,makeup_slots)
values ('84910000-0000-4000-8000-000000000010','approval_pending','cancel_only','english','english','84910000-0000-4000-8000-000000000001','가상반','합성 자료','[]');
insert into public.makeup_request_events(id,request_id,event_type,actor_id,note,created_at)
select ('84910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'84910000-0000-4000-8000-000000000010','submitted','84910000-0000-4000-8000-000000000001','가상', '2026-10-26T00:00:00Z'::timestamptz
from generate_series(101,108) n;
insert into dashboard_private.notification_rules(id,scope_key,workflow_key,event_key,channel_key,audience_key,rule_variant_key,delivery_mode,enabled,active_template_id,created_actor_kind,updated_actor_kind)
values
('84910000-0000-4000-8000-000000000201','global','makeup_requests','makeup.render_bridge_fixture','google_chat','management_team','immediate','immediate',true,'84910000-0000-4000-8000-000000000301','system','system'),
('84910000-0000-4000-8000-000000000202','global','makeup_requests','makeup.render_bridge_fixture','in_app','management_team','immediate','immediate',false,'84910000-0000-4000-8000-000000000302','system','system');
insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,allowed_variables,payload_schema_version,checksum,created_actor_kind)
select ('84910000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,('84910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,'가상 제목','[담당] {담당선생님}', '[{"key":"teacher_name","token":"담당선생님","piiClass":"staff_name"}]',1,repeat('a',64),'system'
from generate_series(201,202) n;
insert into dashboard_private.notification_events(id,scope_key,workflow_key,event_key,source_type,source_id,occurrence_key,actor_profile_id,occurred_at,payload_schema_version,payload,rule_snapshot)
select ('84910000-0000-4000-8000-'||lpad((n+300)::text,12,'0'))::uuid,'global','makeup_requests','makeup.render_bridge_fixture','makeup_request_event',('84910000-0000-4000-8000-'||lpad(n::text,12,'0')),('84910000-0000-4000-8000-'||lpad(n::text,12,'0')),'84910000-0000-4000-8000-000000000001','2026-10-26T00:00:00Z',1,
'{"makeup_request_id":"84910000-0000-4000-8000-000000000010","class_name":"가상반","teacher_name":"가상교사","management_profile_ids":["84910000-0000-4000-8000-000000000001"]}',
(select jsonb_agg(jsonb_build_object('rule_id',id,'rule_revision','1','template_id',active_template_id,'channel_key',channel_key,'audience_key',audience_key,'rule_variant_key',rule_variant_key,'enabled',enabled)) from dashboard_private.notification_rules where id in ('84910000-0000-4000-8000-000000000201','84910000-0000-4000-8000-000000000202'))
from generate_series(101,108) n;

create temporary table render_bridge_results(k text primary key,v jsonb) on commit drop;
grant select,insert on render_bridge_results to service_role;
create function pg_temp.chat_v2(p_event integer,p_request integer,p_template uuid default '84910000-0000-4000-8000-000000000301',p_checksum text default repeat('a',64),p_generation bigint default 0,p_connection text default 'google_chat.management',p_body text default '[담당] 가상교사') returns jsonb language sql set search_path='' as $$
 select public.materialize_makeup_legacy_google_chat_v2(
 ('84910000-0000-4000-8000-'||lpad(p_event::text,12,'0'))::uuid,'84910000-0000-4000-8000-000000000201',p_connection,p_generation,'84910000-0000-4000-8000-000000000001',('84910000-0000-4000-8000-'||lpad(p_request::text,12,'0'))::uuid,p_template,p_checksum,'가상 제목',p_body);
$$;
grant execute on function pg_temp.chat_v2(integer,integer,uuid,text,bigint,text,text) to service_role;

select ok(not has_function_privilege('anon','public.materialize_makeup_legacy_google_chat_v2(uuid,uuid,text,bigint,uuid,uuid,uuid,text,text,text)','execute'), 'anonymous cannot call new chat materializer');
select ok(not has_function_privilege('authenticated','public.materialize_makeup_legacy_google_chat_v2(uuid,uuid,text,bigint,uuid,uuid,uuid,text,text,text)','execute'), 'authenticated cannot call new chat materializer');
select is(to_regprocedure('public.materialize_makeup_legacy_in_app_v2(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text)'),null::regprocedure,'no new retired-channel API is introduced');
select ok(has_function_privilege('service_role','public.materialize_makeup_legacy_google_chat_v2(uuid,uuid,text,bigint,uuid,uuid,uuid,text,text,text)','execute'), 'same server role can call new chat materializer');
select ok(not has_function_privilege('service_role','dashboard_private.notification_with_makeup_rendered_snapshot_v1(jsonb,uuid,text,text,text)','execute'), 'private validator cannot be called as a service endpoint');
set local role anon;
select throws_ok($$select public.materialize_makeup_legacy_google_chat_v2(null,null,null,null,null,null,null,null,null,null)$$,'42501','permission denied for function materialize_makeup_legacy_google_chat_v2','anonymous invocation fails before validation/writes');
reset role;
set local role authenticated;
select throws_ok($$select public.materialize_makeup_legacy_google_chat_v2(null,null,null,null,null,null,null,null,null,null)$$,'42501','permission denied for function materialize_makeup_legacy_google_chat_v2','non-service invocation fails before validation/writes');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.chat_v2(101,901,'84910000-0000-4000-8000-000000000999')$$,'22023','makeup_legacy_render_snapshot_invalid','mismatched immutable template is rejected');
select throws_ok($$select pg_temp.chat_v2(101,901,p_checksum=>repeat('b',64))$$,'22023','makeup_legacy_render_snapshot_invalid','mismatched checksum is rejected');
select throws_ok($$select pg_temp.chat_v2(101,901,p_generation=>null)$$,'22023','makeup_legacy_google_chat_projection_invalid','NULL generation is rejected');
select throws_ok($$select pg_temp.chat_v2(101,901,p_generation=>1)$$,'22023','makeup_legacy_google_chat_projection_invalid','generation expansion is rejected');
select throws_ok($$select pg_temp.chat_v2(101,901,p_connection=>'google_chat.executive')$$,'42501','makeup_legacy_google_chat_projection_forbidden','target outside frozen plan is rejected');
select throws_ok($$select pg_temp.chat_v2(101,901,p_body=>'')$$,'22023','makeup_legacy_render_snapshot_invalid','empty body is rejected');
select throws_ok($$select pg_temp.chat_v2(101,901,p_body=>'<b>unsafe</b>')$$,'22023','makeup_legacy_render_snapshot_invalid','HTML body is rejected');
select throws_ok($$select pg_temp.chat_v2(101,901,p_body=>'https://example.invalid')$$,'22023','makeup_legacy_render_snapshot_invalid','raw URL body is rejected');
reset role;
select is((select count(*) from dashboard_private.notification_deliveries where event_id='84910000-0000-4000-8000-000000000401'),0::bigint,'rejected inputs leave no delivery');
select is((select count(*) from dashboard_private.notification_dispatch_ownership_claims where occurrence_key='84910000-0000-4000-8000-000000000101'),0::bigint,'rejected inputs leave no claim');

set local role service_role;
insert into render_bridge_results select 'first',pg_temp.chat_v2(101,901);
insert into render_bridge_results select 'unknown-replay',pg_temp.chat_v2(101,901);
reset role;
select ok((select (v->>'acquired')::boolean from render_bridge_results where k='first'),'legacy v2 acquires first dispatch');
select ok((select not (v->>'acquired')::boolean and (v->>'recoveredUnknown')::boolean from render_bridge_results where k='unknown-replay'),'in-flight replay is unknown and cannot acquire again');
select is((select rendered_body from dashboard_private.notification_deliveries where id=(select (v->>'deliveryId')::uuid from render_bridge_results where k='first')),'[담당] 가상교사','ledger receives exact server-rendered body');
select is((select href from dashboard_private.notification_deliveries where id=(select (v->>'deliveryId')::uuid from render_bridge_results where k='first')),'/admin/makeup-requests?requestId=84910000-0000-4000-8000-000000000010','DB preserves legacy href');
set local role service_role;
select lives_ok($$select public.finalize_makeup_legacy_google_chat_v1((v->>'deliveryId')::uuid,(v->>'claimId')::uuid,(v->>'ownerGeneration')::bigint,(v->>'dispatchToken')::uuid,'sent','synthetic-only') from render_bridge_results where k='first'$$,'existing finalizer accepts v2 ownership');
insert into render_bridge_results select 'sent-replay',pg_temp.chat_v2(101,901);
select throws_ok($$select pg_temp.chat_v2(101,901,p_body=>'changed')$$,'22023','notification_delivery_replay_mismatch','existing rendered snapshot cannot be overwritten');
select throws_ok($$select public.materialize_makeup_legacy_google_chat_v1('84910000-0000-4000-8000-000000000101','84910000-0000-4000-8000-000000000201','google_chat.management',0,'84910000-0000-4000-8000-000000000001','84910000-0000-4000-8000-000000000901')$$,'22023','notification_delivery_replay_mismatch','v2 then old v1 body mismatch does not resend');
insert into render_bridge_results select 'old-first',public.materialize_makeup_legacy_google_chat_v1('84910000-0000-4000-8000-000000000102','84910000-0000-4000-8000-000000000201','google_chat.management',0,'84910000-0000-4000-8000-000000000001','84910000-0000-4000-8000-000000000902');
select throws_ok($$select pg_temp.chat_v2(102,902)$$,'22023','notification_delivery_replay_mismatch','old v1 then v2 mismatch does not create a corrected duplicate');
reset role;
select ok((select not (v->>'acquired')::boolean and v->>'replayOutcome'='sent' from render_bridge_results where k='sent-replay'),'sent replay remains terminal and unacquired');
select is((select count(*) from dashboard_private.notification_deliveries where event_id='84910000-0000-4000-8000-000000000401'),1::bigint,'all v2/v1 replays keep one delivery');
select is((select rendered_body from dashboard_private.notification_deliveries where event_id='84910000-0000-4000-8000-000000000402'),'[담당] {담당선생님}','old body remains unchanged after rejected migration replay');

select throws_ok($$update dashboard_private.notification_rules set enabled=true where id='84910000-0000-4000-8000-000000000202'$$,'55000','notification_internal_channel_disabled','retired internal channel cannot be enabled');

-- Canonical ownership can be pre-reserved; neither generation nor request seed
-- is changed to win it. This tests the shared ownership boundary, not a worker.
select is(dashboard_private.reserve_canonical_dispatch_ownership_v1((select (v->>'deliveryId')::uuid from render_bridge_results where k='first')),null::uuid,'canonical reservation cannot replace existing legacy owner');
select is((select owner_kind from dashboard_private.notification_dispatch_ownership_claims where occurrence_key='84910000-0000-4000-8000-000000000101'),'legacy','legacy-first owner remains unchanged');
insert into render_bridge_results
select 'canonical-first',jsonb_build_object('deliveryId',dashboard_private.materialize_notification_delivery_v1(
 (item->>'eventId')::uuid,(item->>'ruleId')::uuid,(item->>'ruleRevision')::bigint,(item->>'templateId')::uuid,0,
 dashboard_private.notification_target_set_hash_v1(jsonb_build_array(jsonb_build_object('target_kind',item->'targetKind','target_key',item->'targetKey','target_profile_id',item->'targetProfileId','connection_key',item->'connectionKey','target_snapshot',item->'targetSnapshot'))),
 item->>'targetKind',item->>'targetKey',null,item->>'connectionKey',item->'targetSnapshot','가상 제목','[담당] 가상교사',item->>'href',(item->>'scheduledFor')::timestamptz,null))
from jsonb_array_elements(public.get_makeup_legacy_dispatch_plan_v1('84910000-0000-4000-8000-000000000104','84910000-0000-4000-8000-000000000001')->'items') item
where item->>'channelKey'='google_chat';
select ok(dashboard_private.reserve_canonical_dispatch_ownership_v1((select (v->>'deliveryId')::uuid from render_bridge_results where k='canonical-first')) is not null,'canonical owner reserves a fresh synthetic delivery');
set local role service_role;
insert into render_bridge_results select 'legacy-after-canonical',pg_temp.chat_v2(104,904);
select throws_ok($$select public.materialize_makeup_legacy_in_app_v1('84910000-0000-4000-8000-000000000103','84910000-0000-4000-8000-000000000202','84910000-0000-4000-8000-000000000001',0,'84910000-0000-4000-8000-000000000903')$$,'42501','makeup_legacy_projection_forbidden','disabled internal channel remains absent from dispatch plan');
reset role;
select ok((select not (v->>'acquired')::boolean from render_bridge_results where k='legacy-after-canonical'),'legacy v2 cannot acquire after canonical reservation');
select is((select owner_kind from dashboard_private.notification_dispatch_ownership_claims where occurrence_key='84910000-0000-4000-8000-000000000104'),'canonical','canonical-first owner remains unchanged');
select is((select count(*) from dashboard_private.notification_deliveries where event_id='84910000-0000-4000-8000-000000000404'),1::bigint,'canonical/legacy share one immutable delivery');
select is((select count(*) from dashboard_private.notification_deliveries where event_id='84910000-0000-4000-8000-000000000403'),0::bigint,'disabled channel creates no delivery');
-- A retired pre-cutover snapshot can still contain an internal target, but
-- its earlier revision must fail the existing materializer without side effects.
update dashboard_private.notification_events e
set rule_snapshot=(select jsonb_agg(case when item->>'channel_key'='in_app' then item||jsonb_build_object('enabled',true,'rule_revision','0') else item end) from jsonb_array_elements(e.rule_snapshot) item)
where id='84910000-0000-4000-8000-000000000403';
set local role service_role;
select throws_ok($$select public.materialize_makeup_legacy_in_app_v1('84910000-0000-4000-8000-000000000103','84910000-0000-4000-8000-000000000202','84910000-0000-4000-8000-000000000001',0,'84910000-0000-4000-8000-000000000903')$$,'22023','notification_delivery_materialization_invalid','retired pre-cutover revision cannot revive internal delivery');
reset role;
select is((select count(*) from dashboard_private.notification_deliveries where event_id='84910000-0000-4000-8000-000000000403'),0::bigint,'retired snapshot leaves no delivery');
select is((select count(*) from dashboard_private.notification_dispatch_ownership_claims where occurrence_key='84910000-0000-4000-8000-000000000103'),0::bigint,'retired snapshot leaves no ownership claim');
select * from finish();
rollback;
