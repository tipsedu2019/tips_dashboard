begin;
select no_plan();

select ok(not has_table_privilege(role_name, 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  role_name || ' has no access to archived ' || table_name)
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array['approval_requests','approval_templates','approval_comments','approval_events']) table_name;
select is((select count(*)::integer from pg_policies where schemaname = 'public'
  and tablename in ('approval_requests','approval_templates','approval_comments','approval_events')),0,
  'no policy can reopen the retired document API');
select is((select count(*)::integer from pg_trigger where not tgisinternal and tgrelid in
  ('public.approval_requests'::regclass,'public.approval_templates'::regclass,'public.approval_comments'::regclass)),0,
  'approval notification producers are removed');
select ok(to_regprocedure(signature) is null, signature || ' is removed') from unnest(array[
  'public.create_approval_request_v2(jsonb,text,uuid)',
  'public.update_approval_request_v2(uuid,jsonb,text,timestamptz,uuid)',
  'public.transition_approval_request_v2(uuid,text,timestamptz,uuid)',
  'public.delete_approval_request_v2(uuid,uuid)',
  'public.add_approval_comment_v2(uuid,text,uuid)',
  'public.list_approval_numbered_page_v1(text,integer,integer)',
  'public.get_approval_detail_v1(uuid)'
]) signature;
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='dashboard_private' and p.proname ~ '^(approval_|write_approval_|(create|update|transition|delete)_approval_request_|add_approval_comment_)'),0,
  'no standalone approval implementation remains');
select is((select count(*)::integer from dashboard_private.notification_rules where workflow_key='approvals' and enabled),0,'retired notification rules disabled');
select is((select count(*)::integer from dashboard_private.notification_deliveries d join dashboard_private.notification_events e on e.id=d.event_id
  where e.workflow_key='approvals' and d.status in ('pending','claimed','retry_wait')),0,'no queued approval deliveries remain');
select throws_ok($$insert into dashboard_private.notification_rules(workflow_key,event_key,channel_key,audience_key,rule_variant_key,delivery_mode,enabled,active_template_id,created_actor_kind,updated_actor_kind) values ('approvals','approval.submitted','google_chat','management_team','immediate','immediate',true,gen_random_uuid(),'system','system')$$,
  '23514', null, 'rules cannot be reactivated');
select throws_ok($$insert into dashboard_private.notification_runtime_flags(flag_key,enabled) values ('notification_control_plane_dispatch_approvals_enabled',true) on conflict(flag_key) do update set enabled=true$$,
  '23514', null, 'dispatch flag cannot be reactivated');
select ok(strpos(pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure),
  $guard$if v_claim.workflow_key in ('tasks','word_retests','approvals') then$guard$)>0,
  'final external attempt gate rejects approvals before provider dispatch');
select ok(strpos(pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure),
  'ops_subject_completion_source_stale')>0,'existing source integrity gate survives');
select ok(to_regprocedure('public.list_makeup_numbered_page_v1(jsonb,integer,integer)') is not null,'independent makeup workflow remains');
select ok(to_regprocedure('public.get_makeup_detail_v1(uuid)') is not null,'independent makeup detail remains');
set local role authenticated;
select throws_ok('select * from public.approval_requests','42501',null,'old clients cannot read retired documents');
select throws_ok('insert into public.approval_templates default values','42501',null,'old clients cannot create templates');
select throws_ok('update public.approval_requests set title=title','42501',null,'old clients cannot change documents');
select throws_ok('delete from public.approval_requests','42501',null,'old clients cannot delete archived documents');
select throws_ok($$select public.create_approval_request_v2('{}'::jsonb,'draft'::text,null::uuid)$$,
  '42883',null,'old mutation RPC no longer exists');
reset role;
select * from finish();
rollback;
