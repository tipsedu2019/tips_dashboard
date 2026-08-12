begin;
select plan(30);

create temp table adapter_forward_flag_snapshot(
  flag_key text primary key,
  enabled boolean not null,
  revision bigint not null
) on commit drop;

insert into adapter_forward_flag_snapshot(flag_key, enabled, revision)
select flag_key, enabled, revision
from dashboard_private.notification_runtime_flags
where flag_key in (
  'notification_control_plane_dispatch_tasks_enabled',
  'notification_control_plane_dispatch_word_retests_enabled',
  'notification_control_plane_dispatch_registration_enabled',
  'notification_control_plane_registration_phone_adapter_enabled',
  'notification_control_plane_registration_visit_adapter_enabled',
  'notification_control_plane_registration_solapi_adapter_enabled',
  'notification_control_plane_dispatch_transfer_enabled',
  'notification_control_plane_dispatch_withdrawal_enabled',
  'notification_control_plane_dispatch_makeup_requests_enabled',
  'notification_control_plane_dispatch_approvals_enabled'
);

select has_table(
  'dashboard_private',
  'notification_cutover_owners',
  'passive adapter package owns the dispatch-scope table'
);

select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'scope', owner_row.scope_key,
        'workflow', owner_row.workflow_key,
        'dispatchFlag', owner_row.dispatch_flag_key,
        'ownerKind', owner_row.owner_kind
      ) order by owner_row.scope_key
    )
    from dashboard_private.notification_cutover_owners owner_row
  ),
  '[
    {"scope":"approvals","workflow":"approvals","dispatchFlag":"notification_control_plane_dispatch_approvals_enabled","ownerKind":"legacy"},
    {"scope":"makeup_requests","workflow":"makeup_requests","dispatchFlag":"notification_control_plane_dispatch_makeup_requests_enabled","ownerKind":"legacy"},
    {"scope":"registration","workflow":"registration","dispatchFlag":"notification_control_plane_dispatch_registration_enabled","ownerKind":"legacy"},
    {"scope":"registration_phone","workflow":"registration","dispatchFlag":"notification_control_plane_registration_phone_adapter_enabled","ownerKind":"legacy"},
    {"scope":"registration_solapi","workflow":"registration","dispatchFlag":"notification_control_plane_registration_solapi_adapter_enabled","ownerKind":"legacy"},
    {"scope":"registration_visit","workflow":"registration","dispatchFlag":"notification_control_plane_registration_visit_adapter_enabled","ownerKind":"legacy"},
    {"scope":"tasks","workflow":"tasks","dispatchFlag":"notification_control_plane_dispatch_tasks_enabled","ownerKind":"legacy"},
    {"scope":"transfer","workflow":"transfer","dispatchFlag":"notification_control_plane_dispatch_transfer_enabled","ownerKind":"legacy"},
    {"scope":"withdrawal","workflow":"withdrawal","dispatchFlag":"notification_control_plane_dispatch_withdrawal_enabled","ownerKind":"legacy"},
    {"scope":"word_retests","workflow":"word_retests","dispatchFlag":"notification_control_plane_dispatch_word_retests_enabled","ownerKind":"legacy"}
  ]'::jsonb,
  'the ten scopes are exact legacy-owned runtime-flag partitions'
);

select is(
  dashboard_private.notification_dispatch_scope_for_event_v1(
    'registration', 'registration.phone_consultation_ready'
  ),
  'registration_phone',
  'phone consultation events use the phone adapter scope'
);
select is(
  dashboard_private.notification_dispatch_scope_for_event_v1(
    'registration', 'registration.visit_scheduled'
  ),
  'registration_visit',
  'visit events use the visit adapter scope'
);
select is(
  dashboard_private.notification_dispatch_scope_for_event_v1(
    'registration', 'registration.admission_message_ready'
  ),
  'registration_solapi',
  'admission-message events use the SOLAPI adapter scope'
);
select is(
  dashboard_private.notification_dispatch_scope_for_event_v1(
    'registration', 'registration.observation_scheduled'
  ),
  'registration',
  'other known registration events use the registration scope'
);
select is(dashboard_private.notification_dispatch_scope_for_event_v1('tasks', 'task.created'), 'tasks', 'tasks resolves to tasks');
select is(dashboard_private.notification_dispatch_scope_for_event_v1('word_retests', 'word_retest.due'), 'word_retests', 'word retests resolves to word retests');
select is(dashboard_private.notification_dispatch_scope_for_event_v1('transfer', 'transfer.requested'), 'transfer', 'transfer resolves to transfer');
select is(dashboard_private.notification_dispatch_scope_for_event_v1('withdrawal', 'withdrawal.requested'), 'withdrawal', 'withdrawal resolves to withdrawal');
select is(dashboard_private.notification_dispatch_scope_for_event_v1('makeup_requests', 'makeup.requested'), 'makeup_requests', 'makeup requests resolves to makeup requests');
select is(dashboard_private.notification_dispatch_scope_for_event_v1('approvals', 'approval.requested'), 'approvals', 'approvals resolves to approvals');
select is(dashboard_private.notification_dispatch_scope_for_event_v1('registration', 'registration.unknown'), null::text, 'unknown registration event is not defaulted');
select is(dashboard_private.notification_dispatch_scope_for_event_v1('unknown', 'unknown.event'), null::text, 'unknown workflow is not defaulted');
select ok(
  dashboard_private.notification_dispatch_scope_for_event_v1(null, 'registration.visit_scheduled') is null
  and dashboard_private.notification_dispatch_scope_for_event_v1('registration', null) is null,
  'null workflow and event inputs are rejected'
);

select is(public.notification_workflow_adapters_runtime_version(), 1, 'passive adapter marker returns one');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'dashboard_private.notification_cutover_owners'::regclass),
  'owner table has RLS enabled'
);
select is_empty(
  $$select policyname from pg_catalog.pg_policies where schemaname = 'dashboard_private' and tablename = 'notification_cutover_owners'$$,
  'owner table has no direct-access policy'
);
select ok(not has_table_privilege('anon', 'dashboard_private.notification_cutover_owners', 'select'), 'anon cannot select owners');
select ok(not has_table_privilege('authenticated', 'dashboard_private.notification_cutover_owners', 'select'), 'authenticated cannot select owners');
select ok(not has_table_privilege('service_role', 'dashboard_private.notification_cutover_owners', 'select'), 'service role cannot select owners directly');

select ok(
  (select proc.prosecdef and pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
   from pg_catalog.pg_proc proc
   where proc.oid = 'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)'::regprocedure),
  'private resolver is postgres-owned security definer'
);
select ok(
  not has_function_privilege('anon', 'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)', 'execute')
  and not has_function_privilege('authenticated', 'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)', 'execute')
  and not has_function_privilege('service_role', 'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)', 'execute'),
  'private resolver has no API-role execute grant'
);
select ok(
  (select exists(
    select 1 from unnest(coalesce(proc.proconfig, '{}'::text[])) setting
    where setting in ('search_path=', 'search_path=""')
  ) from pg_catalog.pg_proc proc
  where proc.oid = 'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)'::regprocedure),
  'private resolver has an empty search path'
);
select ok(
  (select pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
   from pg_catalog.pg_proc proc
   where proc.oid = 'public.notification_workflow_adapters_runtime_version()'::regprocedure)
  and has_function_privilege('authenticated', 'public.notification_workflow_adapters_runtime_version()', 'execute')
  and has_function_privilege('service_role', 'public.notification_workflow_adapters_runtime_version()', 'execute')
  and not has_function_privilege('anon', 'public.notification_workflow_adapters_runtime_version()', 'execute'),
  'public marker has the reviewed owner and exact API ACL'
);
select ok(
  (select proc.prosecdef is false
   from pg_catalog.pg_proc proc
   where proc.oid = 'public.notification_workflow_adapters_runtime_version()'::regprocedure),
  'public marker remains security invoker'
);
select ok(
  (select exists(
    select 1 from unnest(coalesce(proc.proconfig, '{}'::text[])) setting
    where setting in ('search_path=', 'search_path=""')
  ) from pg_catalog.pg_proc proc
  where proc.oid = 'public.notification_workflow_adapters_runtime_version()'::regprocedure),
  'public marker has an empty search path'
);

select is_empty($$
  select before_row.flag_key
  from adapter_forward_flag_snapshot before_row
  left join dashboard_private.notification_runtime_flags current_row using (flag_key)
  where current_row.enabled is distinct from before_row.enabled
     or current_row.revision is distinct from before_row.revision
$$, 'forward package leaves every dispatch and adapter flag unchanged');

select throws_ok(
  $$set local role authenticated; insert into dashboard_private.notification_cutover_owners(scope_key, workflow_key, dispatch_flag_key, owner_kind) values ('forbidden', 'tasks', 'notification_control_plane_dispatch_tasks_enabled', 'legacy')$$,
  '42501',
  'permission denied for table notification_cutover_owners',
  'authenticated direct owner-table insert is denied'
);
select throws_ok(
  $$set local role service_role; delete from dashboard_private.notification_cutover_owners where scope_key = 'tasks'$$,
  '42501',
  'permission denied for table notification_cutover_owners',
  'service role direct owner-table delete is denied'
);

select * from finish();
rollback;
