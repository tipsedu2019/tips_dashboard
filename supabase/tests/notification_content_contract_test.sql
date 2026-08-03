begin;
select plan(28);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

select has_table(
  'dashboard_private',
  'notification_rule_content_contracts',
  'private rule content contract table exists'
);
select has_table(
  'dashboard_private',
  'notification_template_compliance_audits',
  'private immutable compliance table exists'
);
select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'dashboard_private.notification_rule_content_contracts'::regclass
  )
  and (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'dashboard_private.notification_template_compliance_audits'::regclass
  ),
  'both content contract relations enforce RLS'
);
select ok(
  not pg_catalog.has_table_privilege(
    'anon', 'dashboard_private.notification_rule_content_contracts', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'dashboard_private.notification_rule_content_contracts', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'dashboard_private.notification_rule_content_contracts', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'anon', 'dashboard_private.notification_template_compliance_audits', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'dashboard_private.notification_template_compliance_audits', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'dashboard_private.notification_template_compliance_audits', 'SELECT'
  ),
  'browser and service roles have no direct content registry access'
);
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_rule_content_contracts
  ),
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_settings_ui_registry
    where channel_key <> 'customer_message'
  ),
  'contract registry mirrors every in-scope UI rule identity'
);
select is_empty($$
  select event_key
  from dashboard_private.notification_rule_content_contracts
  where channel_key = 'customer_message'
$$, 'customer-message rules remain outside the editable content registry');
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_settings_ui_registry
    where configuration_kind = 'fixed_policy_editable_template'
      and activation_locked
  ),
  11::bigint,
  'fixed registration rules expose editable content with activation locked'
);
select is_empty($$
  select registry.rule_id
  from dashboard_private.notification_settings_ui_registry registry
  where registry.configuration_kind = 'fixed_policy_editable_template'
    and (
      registry.workflow_key <> 'registration'
      or registry.event_key not in (
        'registration.phone_consultation_ready',
        'registration.visit_scheduled',
        'registration.visit_rescheduled',
        'registration.visit_replaced',
        'registration.visit_subject_deselected',
        'registration.visit_canceled'
      )
      or not registry.activation_locked
    )
$$, 'only reviewed fixed registration identities are activation locked');
select is(
  dashboard_private.notification_content_contract_for_rule_v1(
    (
      select rule_id
      from dashboard_private.notification_settings_ui_registry
      where event_key = 'approval.submitted'
        and audience_key = 'management_team'
        and channel_key = 'google_chat'
      limit 1
    )
  ) -> 'fieldPresence' -> 'progress_actor' ->> 'nullDisplay',
  '결재자 지정 대기',
  'approval contract stores neutral group-room waiting state'
);
select is(
  dashboard_private.notification_content_contract_for_rule_v1(
    (
      select rule_id
      from dashboard_private.notification_settings_ui_registry
      where event_key = 'registration.visit_subject_deselected'
        and audience_key = 'track_director'
        and channel_key = 'in_app'
      limit 1
    )
  ) -> 'fieldPresence' -> 'other_active_subjects' ->> 'emptyArrayBehavior',
  'allow',
  'explicit empty remaining-subject list stays distinct from missing data'
);
select is_empty($$
  select contract_row.rule_id
  from dashboard_private.notification_rule_content_contracts contract_row
  where contract_row.contract_version <> '1'
    or contract_row.contract_json ->> 'contractVersion' <> contract_row.contract_version
    or pg_catalog.jsonb_typeof(contract_row.contract_json -> 'availableVariables') <> 'array'
    or pg_catalog.jsonb_typeof(contract_row.contract_json -> 'requiredTokens') <> 'array'
    or pg_catalog.jsonb_typeof(contract_row.contract_json -> 'destinationPolicy') <> 'object'
$$, 'every seeded contract has one complete version-one JSON snapshot');
select is_empty($$
  select template_row.id
  from dashboard_private.notification_templates template_row
  where template_row.content_contract_version is not null
$$, 'migration preserves all historical template snapshot bytes and contract nullability');
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'only authenticated callers can enter the role-checked v2 save'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_notification_control_plane_with_override_v2(text,jsonb,jsonb,jsonb,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_notification_control_plane_with_override_v2(text,jsonb,jsonb,jsonb,uuid,uuid,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.save_notification_control_plane_with_override_v2(text,jsonb,jsonb,jsonb,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'only authenticated callers can enter the role-checked v2 override'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)'::regprocedure
    ),
    'for update of rule_row, contract_row'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)'::regprocedure
    ),
    'notification_contract_version_conflict'
  ) > 0,
  'v2 checks both rule and contract revisions after row locks'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)'::regprocedure
    ),
    'notification_seed_template_checksum_v1'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)'::regprocedure
    ),
    'content_contract_version'
  ) > 0,
  'v2 snapshots contract variables/version and the SHA-256 checksum helper'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)'::regprocedure
    ),
    'notification_activation_locked'
  ) > 0,
  'activation-locked rules reject enabled patches'
);
select is_empty($$
  select flag_key
  from dashboard_private.notification_runtime_flags
  where enabled
$$, 'content contract installation leaves every runtime flag disabled');

create or replace function pg_temp.notification_content_set_actor(p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (
        select profile.email
        from public.profiles profile
        where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.notification_content_throws(
  p_sql text,
  p_message_pattern text
)
returns boolean
language plpgsql
volatile
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm ~ p_message_pattern;
end;
$$;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '31400000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'notification-content-admin@runtime.invalid',
  crypt('notification-content-runtime-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"notification-content-contract"}'::jsonb,
  now(),
  now()
)
on conflict (id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '31400000-0000-4000-8000-000000000001',
  'admin',
  '알림 콘텐츠 관리자',
  'notification-content-admin@runtime.invalid',
  now(),
  now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

create temporary table notification_content_rule_fixture on commit drop as
select
  rule_row.id as rule_id,
  rule_row.revision as initial_revision,
  rule_row.enabled as initial_enabled,
  rule_row.active_template_id as initial_template_id,
  contract_row.contract_version,
  contract_row.contract_json,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_templates template_count
    where template_count.rule_id = rule_row.id
  ) as initial_template_count
from dashboard_private.notification_rules rule_row
join dashboard_private.notification_settings_ui_registry registry
  on registry.rule_id = rule_row.id
join dashboard_private.notification_rule_content_contracts contract_row
  on contract_row.rule_id = rule_row.id
where registry.workflow_key = 'tasks'
  and registry.event_key = 'task.created'
  and registry.audience_key = 'requester_profile'
  and registry.channel_key = 'in_app'
limit 1;

create temporary table notification_content_locked_fixture on commit drop as
select
  rule_row.id as rule_id,
  rule_row.revision,
  rule_row.enabled,
  contract_row.contract_version
from dashboard_private.notification_rules rule_row
join dashboard_private.notification_settings_ui_registry registry
  on registry.rule_id = rule_row.id
 and registry.activation_locked
join dashboard_private.notification_rule_content_contracts contract_row
  on contract_row.rule_id = rule_row.id
where registry.event_key = 'registration.phone_consultation_ready'
limit 1;

grant select on notification_content_rule_fixture to authenticated;
grant select on notification_content_locked_fixture to authenticated;
grant execute on function pg_temp.notification_content_set_actor(uuid)
  to authenticated;
grant execute on function pg_temp.notification_content_throws(text, text)
  to authenticated;

create temporary table notification_content_save_results(
  result_key text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on notification_content_save_results to authenticated;

update dashboard_private.notification_runtime_flags
set enabled = true
where flag_key = 'notification_control_plane_settings_ui_enabled';

select pg_temp.notification_content_set_actor(
  '31400000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into notification_content_save_results(result_key, payload)
select
  'changed',
  public.save_notification_control_plane_v2(
    'tasks',
    pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.initial_revision::text),
    pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version),
    pg_catalog.jsonb_build_object(
      'rules',
      pg_catalog.jsonb_build_object(
        fixture.rule_id::text,
        pg_catalog.jsonb_build_object(
          'title_template', '새 업무 · {task_title}',
          'body_template', '[상태] {current_status}' || chr(10) || '[담당] {current_assignee}'
        )
      )
    ),
    '31400000-0000-4000-8000-000000000101'
  )
from notification_content_rule_fixture fixture;
reset role;

select ok(
  (
    select pg_catalog.count(*) = fixture.initial_template_count + 1
    from dashboard_private.notification_templates template_row,
         notification_content_rule_fixture fixture
    where template_row.rule_id = fixture.rule_id
  )
  and (
    select rule_row.revision = fixture.initial_revision + 1
      and rule_row.active_template_id <> fixture.initial_template_id
    from dashboard_private.notification_rules rule_row,
         notification_content_rule_fixture fixture
    where rule_row.id = fixture.rule_id
  ),
  'v2 changed content appends one contract-versioned custom template'
);
select ok(
  (
    select template_row.content_contract_version = fixture.contract_version
      and template_row.allowed_variables = fixture.contract_json -> 'availableVariables'
      and template_row.created_by = '31400000-0000-4000-8000-000000000001'
      and template_row.created_actor_kind = 'user'
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates template_row
      on template_row.id = rule_row.active_template_id,
         notification_content_rule_fixture fixture
    where rule_row.id = fixture.rule_id
  ),
  'active custom content remains user-authored and snapshots the server allowlist'
);

select pg_temp.notification_content_set_actor(
  '31400000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into notification_content_save_results(result_key, payload)
select
  'retry',
  public.save_notification_control_plane_v2(
    'tasks',
    pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.initial_revision::text),
    pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version),
    pg_catalog.jsonb_build_object(
      'rules',
      pg_catalog.jsonb_build_object(
        fixture.rule_id::text,
        pg_catalog.jsonb_build_object(
          'title_template', '새 업무 · {task_title}',
          'body_template', '[상태] {current_status}' || chr(10) || '[담당] {current_assignee}'
        )
      )
    ),
    '31400000-0000-4000-8000-000000000101'
  )
from notification_content_rule_fixture fixture;
reset role;
select ok(
  (select payload from notification_content_save_results where result_key = 'retry')
    = (select payload from notification_content_save_results where result_key = 'changed')
  and (
    select pg_catalog.count(*) = fixture.initial_template_count + 1
    from dashboard_private.notification_templates template_row,
         notification_content_rule_fixture fixture
    where template_row.rule_id = fixture.rule_id
  ),
  'v2 retry is an exact no-op'
);

select pg_temp.notification_content_set_actor(
  '31400000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into notification_content_save_results(result_key, payload)
select
  'identical',
  public.save_notification_control_plane_v2(
    'tasks',
    pg_catalog.jsonb_build_object(fixture.rule_id::text, rule_row.revision::text),
    pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version),
    pg_catalog.jsonb_build_object(
      'rules',
      pg_catalog.jsonb_build_object(
        fixture.rule_id::text,
        pg_catalog.jsonb_build_object(
          'title_template', '새 업무 · {task_title}',
          'body_template', '[상태] {current_status}' || chr(10) || '[담당] {current_assignee}'
        )
      )
    ),
    '31400000-0000-4000-8000-000000000102'
  )
from notification_content_rule_fixture fixture
join dashboard_private.notification_rules rule_row on rule_row.id = fixture.rule_id;
reset role;
select ok(
  (
    select rule_row.revision = fixture.initial_revision + 1
    from dashboard_private.notification_rules rule_row,
         notification_content_rule_fixture fixture
    where rule_row.id = fixture.rule_id
  )
  and (
    select pg_catalog.count(*) = fixture.initial_template_count + 1
    from dashboard_private.notification_templates template_row,
         notification_content_rule_fixture fixture
    where template_row.rule_id = fixture.rule_id
  ),
  'identical content does not increment the rule revision'
);

select pg_temp.notification_content_set_actor(
  '31400000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_content_throws(
    format(
      $sql$
        select public.save_notification_control_plane_v2(
          'tasks', %L::jsonb, %L::jsonb, %L::jsonb,
          '31400000-0000-4000-8000-000000000103'
        )
      $sql$,
      pg_catalog.jsonb_build_object(fixture.rule_id::text, rule_row.revision::text)::text,
      pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version)::text,
      pg_catalog.jsonb_build_object(
        'rules',
        pg_catalog.jsonb_build_object(
          fixture.rule_id::text,
          pg_catalog.jsonb_build_object(
            'title_template', '새 업무 · {task_title}',
            'body_template', '[상태] {current_status}' || chr(10)
              || '[담당] {current_assignee}' || chr(10) || '{deep_link}'
          )
        )
      )::text
    ),
    'notification_template_contract_invalid.*notification_template_variable_unknown'
  ),
  'contract validator rejects an unknown template token'
)
from notification_content_rule_fixture fixture
join dashboard_private.notification_rules rule_row on rule_row.id = fixture.rule_id;
select ok(
  pg_temp.notification_content_throws(
    format(
      $sql$
        select public.save_notification_control_plane_v2(
          'tasks', %L::jsonb, %L::jsonb, %L::jsonb,
          '31400000-0000-4000-8000-000000000104'
        )
      $sql$,
      pg_catalog.jsonb_build_object(fixture.rule_id::text, rule_row.revision::text)::text,
      pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version)::text,
      pg_catalog.jsonb_build_object(
        'rules',
        pg_catalog.jsonb_build_object(
          fixture.rule_id::text,
          pg_catalog.jsonb_build_object(
            'title_template', '새 업무',
            'body_template', '[상태] {current_status}'
          )
        )
      )::text
    ),
    'notification_template_contract_invalid.*notification_template_required_token_missing'
  ),
  'contract validator rejects a missing required token'
)
from notification_content_rule_fixture fixture
join dashboard_private.notification_rules rule_row on rule_row.id = fixture.rule_id;
reset role;

select pg_temp.notification_content_set_actor(
  '31400000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into notification_content_save_results(result_key, payload)
select
  'warning',
  public.save_notification_control_plane_v2(
    'tasks',
    pg_catalog.jsonb_build_object(fixture.rule_id::text, rule_row.revision::text),
    pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version),
    pg_catalog.jsonb_build_object(
      'rules',
      pg_catalog.jsonb_build_object(
        fixture.rule_id::text,
        pg_catalog.jsonb_build_object(
          'title_template', '새 업무 · {task_title}',
          'body_template', '[상태] {current_status}' || chr(10)
            || '[담당] {current_assignee}' || chr(10) || '[다음] 확인하세요.'
        )
      )
    ),
    '31400000-0000-4000-8000-000000000105'
  )
from notification_content_rule_fixture fixture
join dashboard_private.notification_rules rule_row on rule_row.id = fixture.rule_id;
reset role;
select ok(
  (
    select audit.compliance = 'legacy_custom_nonconformant'
      and audit.violations @> '[{"code":"notification_template_direct_imperative","severity":"warning"}]'::jsonb
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates template_row
      on template_row.id = rule_row.active_template_id
    join dashboard_private.notification_template_compliance_audits audit
      on audit.template_id = template_row.id
     and audit.contract_version = template_row.content_contract_version,
         notification_content_rule_fixture fixture
    where rule_row.id = fixture.rule_id
  ),
  'direct imperative content is saved only as legacy custom nonconformant'
);

select pg_temp.notification_content_set_actor(
  '31400000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_content_throws(
    format(
      $sql$
        select public.save_notification_control_plane_v2(
          'registration', %L::jsonb, %L::jsonb, %L::jsonb,
          '31400000-0000-4000-8000-000000000106'
        )
      $sql$,
      pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.revision::text)::text,
      pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version)::text,
      pg_catalog.jsonb_build_object(
        'rules',
        pg_catalog.jsonb_build_object(
          fixture.rule_id::text,
          pg_catalog.jsonb_build_object('enabled', not fixture.enabled)
        )
      )::text
    ),
    'notification_activation_locked'
  ),
  'activation-locked rules reject enabled patches'
)
from notification_content_locked_fixture fixture;
select ok(
  pg_temp.notification_content_throws(
    format(
      $sql$
        select public.save_notification_control_plane_v1(
          'registration', %L::jsonb, %L::jsonb,
          '31400000-0000-4000-8000-000000000107'
        )
      $sql$,
      pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.revision::text)::text,
      pg_catalog.jsonb_build_object(
        'rules',
        pg_catalog.jsonb_build_object(
          fixture.rule_id::text,
          pg_catalog.jsonb_build_object('enabled', not fixture.enabled)
        )
      )::text
    ),
    'notification_activation_locked'
  ),
  'activation lock guard also closes the unchanged v1 save path'
)
from notification_content_locked_fixture fixture;
reset role;
select ok(
  (
    select rule_row.enabled = fixture.enabled
    from dashboard_private.notification_rules rule_row,
         notification_content_locked_fixture fixture
    where rule_row.id = fixture.rule_id
  )
  and not exists (
    select 1
    from dashboard_private.notification_runtime_flags
    where flag_key <> 'notification_control_plane_settings_ui_enabled'
      and enabled
  ),
  'locked content edits preserve enabled owner and runtime state'
);

select * from finish();
rollback;
