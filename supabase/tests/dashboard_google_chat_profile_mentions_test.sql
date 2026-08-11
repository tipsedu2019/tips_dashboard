begin;

select plan(70);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

create temporary table chat_existing_notification_rule_state_baseline
on commit drop
as
select rule.id, rule.enabled, rule.revision, rule.active_template_id
from dashboard_private.notification_rules rule;

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where (namespace.nspname, relation.relname) in (
      ('dashboard_private', 'google_chat_profile_identities'),
      ('dashboard_private', 'google_chat_profile_identity_audits'),
      ('dashboard_private', 'google_chat_profile_identity_requests'),
      ('dashboard_private', 'notification_rule_mention_settings'),
      ('dashboard_private', 'notification_rule_mention_setting_audits'),
      ('dashboard_private', 'notification_rule_mention_setting_requests'),
      ('dashboard_private', 'notification_assignment_change_facts'),
      ('dashboard_private', 'notification_delivery_mention_snapshots')
    )
  ),
  8::bigint,
  'all eight private mention ledger tables exist'
);

select is(
  (
    select pg_catalog.array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'dashboard_private'
      and table_name = 'notification_assignment_change_facts'
  ),
  array[
    'fact_id', 'workflow_key', 'source_type', 'source_id', 'source_revision',
    'context_entity_id', 'role_key', 'previous_profile_ids',
    'current_profile_ids', 'occurred_at'
  ]::text[],
  'assignment facts expose the exact provider-neutral schema'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'dashboard_private'
      and relation.relname in (
        'google_chat_profile_identities',
        'google_chat_profile_identity_audits',
        'google_chat_profile_identity_requests',
        'notification_rule_mention_settings',
        'notification_rule_mention_setting_audits',
        'notification_rule_mention_setting_requests',
        'notification_assignment_change_facts',
        'notification_delivery_mention_snapshots'
      )
      and relation.relrowsecurity
  ),
  8::bigint,
  'all private mention ledger tables keep RLS enabled as defense in depth'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.unnest(array[
      'public.list_google_chat_profile_identities_v1()',
      'public.read_google_chat_profile_identity_sync_source_v1(uuid,uuid)',
      'public.apply_google_chat_profile_identity_sync_v1(uuid,uuid,text,text,text,text,bigint,uuid)',
      'public.list_notification_rule_mention_settings_v1(text)',
      'public.save_notification_rule_mention_setting_v1(uuid,boolean,bigint,uuid)',
      'public.resolve_google_chat_profile_mentions_v1(uuid[])'
    ]::text[]) signature(value)
    where pg_catalog.to_regprocedure(signature.value) is not null
  ),
  6::bigint,
  'all six public mention RPC signatures exist'
);

select ok(
  pg_catalog.to_regprocedure(
    'dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(uuid,uuid,uuid,uuid[],boolean)'
  ) is not null,
  'private delivery mention snapshot seam exists'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles owner on owner.oid = procedure.proowner
    where (
      namespace.nspname || '.' || procedure.proname
    ) in (
      'public.list_google_chat_profile_identities_v1',
      'public.read_google_chat_profile_identity_sync_source_v1',
      'public.apply_google_chat_profile_identity_sync_v1',
      'public.list_notification_rule_mention_settings_v1',
      'public.save_notification_rule_mention_setting_v1',
      'public.resolve_google_chat_profile_mentions_v1',
      'dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1'
    )
      and procedure.prosecdef
      and owner.rolname = 'postgres'
      and exists (
        select 1
        from pg_catalog.unnest(
          coalesce(procedure.proconfig, array[]::text[])
        ) config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      )
  ),
  7::bigint,
  'all seven exported or privileged seams are postgres-owned definers with empty search path'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.unnest(array[
      'google_chat_profile_identities',
      'google_chat_profile_identity_audits',
      'google_chat_profile_identity_requests',
      'notification_rule_mention_settings',
      'notification_rule_mention_setting_audits',
      'notification_rule_mention_setting_requests',
      'notification_assignment_change_facts',
      'notification_delivery_mention_snapshots'
    ]::text[]) table_name(value)
    cross join pg_catalog.unnest(array[
      'anon', 'authenticated', 'service_role'
    ]::text[]) database_role(value)
    cross join pg_catalog.unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]::text[]) privilege(value)
    where pg_catalog.has_table_privilege(
      database_role.value,
      pg_catalog.format('dashboard_private.%I', table_name.value),
      privilege.value
    )
  ),
  0::bigint,
  'API roles have no direct privilege on any private mention ledger table'
);

select is(
  pg_catalog.jsonb_build_object(
    'identityListAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.list_google_chat_profile_identities_v1()',
      'EXECUTE'
    ),
    'identityListAnon', pg_catalog.has_function_privilege(
      'anon',
      'public.list_google_chat_profile_identities_v1()',
      'EXECUTE'
    ),
    'syncSourceService', pg_catalog.has_function_privilege(
      'service_role',
      'public.read_google_chat_profile_identity_sync_source_v1(uuid,uuid)',
      'EXECUTE'
    ),
    'syncSourceAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.read_google_chat_profile_identity_sync_source_v1(uuid,uuid)',
      'EXECUTE'
    ),
    'syncApplyService', pg_catalog.has_function_privilege(
      'service_role',
      'public.apply_google_chat_profile_identity_sync_v1(uuid,uuid,text,text,text,text,bigint,uuid)',
      'EXECUTE'
    ),
    'settingListAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.list_notification_rule_mention_settings_v1(text)',
      'EXECUTE'
    ),
    'settingSaveAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.save_notification_rule_mention_setting_v1(uuid,boolean,bigint,uuid)',
      'EXECUTE'
    ),
    'resolverService', pg_catalog.has_function_privilege(
      'service_role',
      'public.resolve_google_chat_profile_mentions_v1(uuid[])',
      'EXECUTE'
    ),
    'resolverAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.resolve_google_chat_profile_mentions_v1(uuid[])',
      'EXECUTE'
    ),
    'snapshotServiceDirect', pg_catalog.has_function_privilege(
      'service_role',
      'dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(uuid,uuid,uuid,uuid[],boolean)',
      'EXECUTE'
    )
  ),
  pg_catalog.jsonb_build_object(
    'identityListAuthenticated', true,
    'identityListAnon', false,
    'syncSourceService', true,
    'syncSourceAuthenticated', false,
    'syncApplyService', true,
    'settingListAuthenticated', true,
    'settingSaveAuthenticated', true,
    'resolverService', true,
    'resolverAuthenticated', false,
    'snapshotServiceDirect', false
  ),
  'public and private function ACLs expose only the approved roles'
);

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_rule_mention_settings
  ),
  0::bigint,
  'foundation migration adopts zero existing workflow rules'
);

select is(
  (
    select setting.activation_version
    from dashboard_private.registration_observation_runtime_settings setting
    where setting.singleton = true
  ),
  0,
  'mention foundation leaves observation runtime disabled'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  deleted_at, banned_until, created_at, updated_at
)
values
  ('99450000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-admin@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99450000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-staff@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99450000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-teacher@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99450000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-assistant@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99450000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-viewer@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99450000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-deleted@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), null, now(), now()),
  ('99450000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-banned@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, now() + interval '1 day', now(), now()),
  ('99450000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-teacher-a@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99450000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-teacher-b@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99450000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-inactive@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99450000-0000-4000-8000-000000000104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-missing@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now()),
  ('99450000-0000-4000-8000-000000000105', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-mismatch@example.invalid', crypt('chat-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', null, null, now(), now());

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('99450000-0000-4000-8000-000000000001', 'admin', 'Chat 관리자', 'chat-admin@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000002', 'staff', 'Chat 스태프', 'chat-staff@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000003', 'teacher', 'Chat 교사', 'chat-teacher@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000004', 'assistant', 'Chat 조교', 'chat-assistant@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000005', 'viewer', 'Chat 조회자', 'chat-viewer@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000006', 'admin', '삭제 관리자', 'chat-deleted@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000007', 'staff', '정지 스태프', 'chat-banned@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000101', 'teacher', '담당 교사 A', 'chat-teacher-a@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000102', 'teacher', '담당 교사 B', 'chat-teacher-b@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000103', 'teacher', '비활성 대상', 'chat-inactive@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000104', 'teacher', '미설정 대상', 'chat-missing@example.invalid', now(), now()),
  ('99450000-0000-4000-8000-000000000105', 'teacher', '불일치 대상', 'chat-mismatch@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id = any(array[
  '99450000-0000-4000-8000-000000000001'::uuid,
  '99450000-0000-4000-8000-000000000002'::uuid,
  '99450000-0000-4000-8000-000000000003'::uuid,
  '99450000-0000-4000-8000-000000000004'::uuid,
  '99450000-0000-4000-8000-000000000005'::uuid,
  '99450000-0000-4000-8000-000000000006'::uuid,
  '99450000-0000-4000-8000-000000000007'::uuid,
  '99450000-0000-4000-8000-000000000101'::uuid,
  '99450000-0000-4000-8000-000000000102'::uuid,
  '99450000-0000-4000-8000-000000000103'::uuid,
  '99450000-0000-4000-8000-000000000104'::uuid,
  '99450000-0000-4000-8000-000000000105'::uuid
]);

create table pg_temp.chat_mention_results(
  label text primary key,
  payload jsonb not null
);

create or replace function pg_temp.chat_set_claims(
  p_actor uuid,
  p_database_role text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_database_role not in ('anon', 'authenticated', 'service_role') then
    raise exception 'chat_test_role_invalid';
  end if;
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'sub', p_actor,
      'role', p_database_role
    ))::text,
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', coalesce(p_actor::text, ''), true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role', p_database_role, true
  );
end;
$$;

create or replace function pg_temp.chat_list_identities(
  p_actor uuid,
  p_database_role text default 'authenticated'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.chat_set_claims(p_actor, p_database_role);
  execute pg_catalog.format('set local role %I', p_database_role);
  select public.list_google_chat_profile_identities_v1() into v_result;
  execute 'reset role';
  return v_result;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.chat_sync_source(
  p_actor uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.chat_set_claims(p_actor, 'service_role');
  execute 'set local role service_role';
  select public.read_google_chat_profile_identity_sync_source_v1(
    p_actor, p_profile_id
  ) into v_result;
  execute 'reset role';
  return v_result;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.chat_apply_identity(
  p_actor uuid,
  p_profile_id uuid,
  p_account_email_snapshot text,
  p_lookup_mode text,
  p_candidate_chat_user_id text,
  p_sync_outcome text,
  p_expected_identity_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.chat_set_claims(p_actor, 'service_role');
  execute 'set local role service_role';
  select public.apply_google_chat_profile_identity_sync_v1(
    p_actor,
    p_profile_id,
    p_account_email_snapshot,
    p_lookup_mode,
    p_candidate_chat_user_id,
    p_sync_outcome,
    p_expected_identity_revision,
    p_request_id
  ) into v_result;
  execute 'reset role';
  return v_result;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.chat_list_settings(
  p_actor uuid,
  p_workflow_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.chat_set_claims(p_actor, 'authenticated');
  execute 'set local role authenticated';
  select public.list_notification_rule_mention_settings_v1(p_workflow_key)
  into v_result;
  execute 'reset role';
  return v_result;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.chat_save_setting(
  p_actor uuid,
  p_rule_id uuid,
  p_mention_enabled boolean,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.chat_set_claims(p_actor, 'authenticated');
  execute 'set local role authenticated';
  select public.save_notification_rule_mention_setting_v1(
    p_rule_id, p_mention_enabled, p_expected_revision, p_request_id
  ) into v_result;
  execute 'reset role';
  return v_result;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.chat_resolve_mentions(
  p_profile_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.chat_set_claims(null, 'service_role');
  execute 'set local role service_role';
  select public.resolve_google_chat_profile_mentions_v1(p_profile_ids)
  into v_result;
  execute 'reset role';
  return v_result;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.chat_prepare_snapshot(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_rule_id uuid,
  p_profile_ids uuid[],
  p_retry_frozen boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.chat_set_claims(null, 'service_role');
  select dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(
    p_delivery_id,
    p_claim_token,
    p_rule_id,
    p_profile_ids,
    p_retry_frozen
  ) into v_result;
  return v_result;
end;
$$;

create or replace function pg_temp.chat_attempt_private_identity_insert()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_temp.chat_set_claims(
    '99450000-0000-4000-8000-000000000001', 'authenticated'
  );
  execute 'set local role authenticated';
  insert into dashboard_private.google_chat_profile_identities(profile_id)
  values ('99450000-0000-4000-8000-000000000104');
  execute 'reset role';
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.chat_attempt_adopted_rule_channel_drift()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update dashboard_private.notification_rules rule
  set channel_key = 'in_app'
  where rule.id = '99450000-0000-4000-8000-000000000401';
  raise exception 'notification_mention_rule_drift_unexpected_success'
    using errcode = 'P0001';
end;
$$;

insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, enabled, active_template_id, revision,
  created_by, created_actor_kind, updated_by, updated_actor_kind
)
values
  (
    '99450000-0000-4000-8000-000000000401', 'global', 'registration',
    'registration.observation.teacher_changed', 'google_chat', 'subject_team',
    'immediate', 'immediate', true,
    '99450000-0000-4000-8000-000000000501', 7,
    null, 'system', null, 'system'
  ),
  (
    '99450000-0000-4000-8000-000000000402', 'global', 'registration',
    'registration.observation.director_changed', 'google_chat', 'management_team',
    'immediate', 'immediate', true,
    '99450000-0000-4000-8000-000000000502', 3,
    null, 'system', null, 'system'
  ),
  (
    '99450000-0000-4000-8000-000000000403', 'global', 'registration',
    'registration.observation.internal', 'in_app', 'track_director',
    'immediate', 'immediate', true,
    '99450000-0000-4000-8000-000000000503', 2,
    null, 'system', null, 'system'
  );

insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind
)
values
  (
    '99450000-0000-4000-8000-000000000501',
    '99450000-0000-4000-8000-000000000401', 1,
    '담당 교사 변경', '담당 교사가 변경되었습니다.', '[]'::jsonb,
    1, repeat('a', 64), null, 'system'
  ),
  (
    '99450000-0000-4000-8000-000000000502',
    '99450000-0000-4000-8000-000000000402', 1,
    '담당 원장 변경', '담당 원장이 변경되었습니다.', '[]'::jsonb,
    1, repeat('b', 64), null, 'system'
  ),
  (
    '99450000-0000-4000-8000-000000000503',
    '99450000-0000-4000-8000-000000000403', 1,
    '내부 알림', '내부 알림입니다.', '[]'::jsonb,
    1, repeat('c', 64), null, 'system'
  );

insert into dashboard_private.notification_rule_mention_settings(
  rule_id, mention_enabled, revision, updated_by
)
values (
  '99450000-0000-4000-8000-000000000401', false, 1,
  '99450000-0000-4000-8000-000000000001'
);

insert into dashboard_private.notification_events(
  id, scope_key, workflow_key, event_key, source_type, source_id,
  source_revision, occurrence_key, actor_profile_id, occurred_at,
  payload_schema_version, payload, rule_snapshot
)
values (
  '99450000-0000-4000-8000-000000000601', 'global', 'registration',
  'registration.observation.teacher_changed', 'registration_observation',
  '99450000-0000-4000-8000-000000000304', 4,
  'chat-mention-snapshot-fixture', null, now(), 1, '{}'::jsonb, '[]'::jsonb
);

insert into dashboard_private.notification_deliveries(
  id, event_id, rule_id, rule_revision, template_id, channel_key,
  audience_key, target_generation, target_set_hash, target_kind, target_key,
  target_snapshot, status, dedupe_key, rendered_title, rendered_body,
  scheduled_for, attempt_count, max_attempts, claimed_by, claim_token,
  lease_expires_at
)
values
  (
    '99450000-0000-4000-8000-000000000701',
    '99450000-0000-4000-8000-000000000601',
    '99450000-0000-4000-8000-000000000401', 7,
    '99450000-0000-4000-8000-000000000501', 'google_chat', 'subject_team',
    0, repeat('d', 64), 'audience', 'subject-team-fixture-1', '{}'::jsonb,
    'claimed', 'chat-mention-delivery-1', '제목', '본문', now(), 1, 3,
    'chat-mention-test', '99450000-0000-4000-8000-000000000801',
    now() + interval '5 minutes'
  ),
  (
    '99450000-0000-4000-8000-000000000702',
    '99450000-0000-4000-8000-000000000601',
    '99450000-0000-4000-8000-000000000401', 7,
    '99450000-0000-4000-8000-000000000501', 'google_chat', 'subject_team',
    0, repeat('e', 64), 'audience', 'subject-team-fixture-2', '{}'::jsonb,
    'claimed', 'chat-mention-delivery-2', '제목', '본문', now(), 1, 3,
    'chat-mention-test', '99450000-0000-4000-8000-000000000802',
    now() + interval '5 minutes'
  );

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email,
  dashboard_role
)
values
  (
    '99450000-0000-4000-8000-000000000201', '담당 교사 A',
    array['영어']::text[], true, 99451,
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a@example.invalid', 'teacher'
  ),
  (
    '99450000-0000-4000-8000-000000000202', '담당 교사 B',
    array['영어']::text[], true, 99452,
    '99450000-0000-4000-8000-000000000102',
    'chat-teacher-b@example.invalid', 'teacher'
  );

update public.profiles
set teacher_catalog_id = case id
  when '99450000-0000-4000-8000-000000000101'::uuid
    then '99450000-0000-4000-8000-000000000201'::uuid
  else '99450000-0000-4000-8000-000000000202'::uuid
end
where id in (
  '99450000-0000-4000-8000-000000000101',
  '99450000-0000-4000-8000-000000000102'
);

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  '99450000-0000-4000-8000-000000000203', '청강 101호',
  array['영어']::text[], true, 99451, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
values (
  '99450000-0000-4000-8000-000000000204', '청강 영어반', '영어',
  '수업 진행 중', 'legacy',
  pg_catalog.jsonb_build_object(
    'sessions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sessionKey', 'chat-mention-session',
        'date', (current_date + 7)::text,
        'startTime', '18:00', 'endTime', '20:00',
        'teacherCatalogId', '99450000-0000-4000-8000-000000000201',
        'classroomCatalogId', '99450000-0000-4000-8000-000000000203',
        'scheduleState', 'active'
      )
    )
  )
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values (
  '99450000-0000-4000-8000-000000000301', 'Chat 멘션 청강',
  'registration', 'requested', 'normal',
  '99450000-0000-4000-8000-000000000001', '멘션 학생'
);

insert into public.ops_registration_details(
  task_id, school_grade, school_name, parent_phone, student_phone, request_note
)
values (
  '99450000-0000-4000-8000-000000000301', '중3', '테스트중',
  '01000000000', null, 'Chat mention fixture'
);

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values (
  '99450000-0000-4000-8000-000000000302',
  '99450000-0000-4000-8000-000000000301', '영어',
  'consultation_waiting', '99450000-0000-4000-8000-000000000101',
  'manual', now(), false, 'observation_requested', 4, now(),
  'consultation_completed', 1
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision,
  created_by
)
values (
  '99450000-0000-4000-8000-000000000303',
  '99450000-0000-4000-8000-000000000301', 'observation_class',
  ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'),
  '본관', 'scheduled', 4, '99450000-0000-4000-8000-000000000001'
);

insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, legacy_session_key, session_date, starts_at, ends_at,
  session_schedule_state, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, status, revision, created_by, updated_by
)
values (
  '99450000-0000-4000-8000-000000000304',
  '99450000-0000-4000-8000-000000000301',
  '99450000-0000-4000-8000-000000000302',
  '99450000-0000-4000-8000-000000000303',
  '99450000-0000-4000-8000-000000000204',
  'legacy', 'chat-mention-session', current_date + 7,
  ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'),
  ((current_date + 7 + time '20:00') at time zone 'Asia/Seoul'),
  'active', repeat('f', 64),
  pg_catalog.jsonb_build_object(
    'authority', 'legacy', 'sessionKey', 'chat-mention-session',
    'contentHash', repeat('f', 64)
  ),
  repeat('1', 64), '99450000-0000-4000-8000-000000000201',
  '99450000-0000-4000-8000-000000000101',
  '99450000-0000-4000-8000-000000000203', '영어', '청강 영어반',
  '담당 교사 A', '청강 101호', '본관', 'scheduled', 4,
  '99450000-0000-4000-8000-000000000001',
  '99450000-0000-4000-8000-000000000001'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(
      pg_temp.chat_list_identities('99450000-0000-4000-8000-000000000001')
    ) row(value)
    where row.value ->> 'profileId' like '99450000-%'
  ),
  12::bigint,
  'active admin can list canonical profile identity rows'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(
      pg_temp.chat_list_identities('99450000-0000-4000-8000-000000000002')
    ) row(value)
    where row.value ->> 'profileId' like '99450000-%'
  ),
  12::bigint,
  'active staff can list canonical profile identity rows'
);

select is(
  (
    select row.value - 'profileName' - 'accountEmail' - 'dashboardRole'
      - 'verifiedAt' - 'lastSyncAt' - 'eligible'
    from pg_catalog.jsonb_array_elements(
      pg_temp.chat_list_identities('99450000-0000-4000-8000-000000000001')
    ) row(value)
    where row.value ->> 'profileId' = '99450000-0000-4000-8000-000000000104'
  ),
  '{"profileId":"99450000-0000-4000-8000-000000000104","chatUserId":null,"resourceName":null,"source":null,"verificationStatus":"unverified","lastSyncStatus":null,"identityRevision":"0"}'::jsonb,
  'never-synced profile exposes null lastSyncStatus rather than an internal sentinel'
);

select throws_ok(
  $$select pg_temp.chat_list_identities('99450000-0000-4000-8000-000000000003')$$,
  '42501', 'google_chat_profile_mentions_access_denied',
  'teacher cannot list profile identities'
);

select throws_ok(
  $$select pg_temp.chat_list_identities('99450000-0000-4000-8000-000000000004')$$,
  '42501', 'google_chat_profile_mentions_access_denied',
  'assistant cannot list profile identities'
);

select throws_ok(
  $$select pg_temp.chat_list_identities('99450000-0000-4000-8000-000000000005')$$,
  '42501', 'google_chat_profile_mentions_access_denied',
  'viewer cannot list profile identities'
);

select throws_ok(
  $$select pg_temp.chat_list_identities(null, 'anon')$$,
  '42501', null,
  'anonymous caller cannot list profile identities'
);

select throws_ok(
  $$select pg_temp.chat_list_identities('99450000-0000-4000-8000-000000000006')$$,
  '42501', 'google_chat_profile_mentions_access_denied',
  'deleted admin cannot list profile identities'
);

select throws_ok(
  $$select pg_temp.chat_list_identities('99450000-0000-4000-8000-000000000007')$$,
  '42501', 'google_chat_profile_mentions_access_denied',
  'banned staff cannot list profile identities'
);

select is(
  pg_temp.chat_sync_source(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101'
  ),
  pg_catalog.jsonb_build_object(
    'profileId', '99450000-0000-4000-8000-000000000101',
    'profileName', '담당 교사 A',
    'accountEmail', 'chat-teacher-a@example.invalid',
    'dashboardRole', 'teacher',
    'identityRevision', '0'
  ),
  'active admin service request reads normalized current sync source'
);

select lives_ok(
  $$select pg_temp.chat_sync_source(
    '99450000-0000-4000-8000-000000000002',
    '99450000-0000-4000-8000-000000000102'
  )$$,
  'active staff service request can read a sync source'
);

select throws_ok(
  $$select pg_temp.chat_sync_source(
    '99450000-0000-4000-8000-000000000003',
    '99450000-0000-4000-8000-000000000101'
  )$$,
  '42501', 'google_chat_profile_mentions_access_denied',
  'teacher cannot proxy a service-role identity sync'
);

select throws_ok(
  $$select pg_temp.chat_sync_source(
    '99450000-0000-4000-8000-000000000006',
    '99450000-0000-4000-8000-000000000101'
  )$$,
  '42501', 'google_chat_profile_mentions_access_denied',
  'deleted admin cannot proxy a service-role identity sync'
);

insert into pg_temp.chat_mention_results(label, payload)
values (
  'identity_a_verified',
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    ' CHAT-TEACHER-A@EXAMPLE.INVALID ', 'auto', '111111111', 'verified', 0,
    '99450000-0000-4000-8000-000000000901'
  )
);

select is(
  (
    select payload - 'verifiedAt' - 'lastSyncAt'
    from pg_temp.chat_mention_results where label = 'identity_a_verified'
  ),
  pg_catalog.jsonb_build_object(
    'profileId', '99450000-0000-4000-8000-000000000101',
    'profileName', '담당 교사 A',
    'accountEmail', 'chat-teacher-a@example.invalid',
    'dashboardRole', 'teacher',
    'chatUserId', '111111111', 'resourceName', 'users/111111111',
    'source', 'directory', 'verificationStatus', 'verified',
    'lastSyncStatus', 'ok', 'identityRevision', '1', 'eligible', true
  ),
  'auto verification stores a numeric ID against the normalized current email'
);

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a@example.invalid', 'auto', '111111111', 'verified', 0,
    '99450000-0000-4000-8000-000000000901'
  ) - 'verifiedAt' - 'lastSyncAt',
  (
    select payload - 'verifiedAt' - 'lastSyncAt'
    from pg_temp.chat_mention_results where label = 'identity_a_verified'
  ),
  'same identity request replays a byte-equal response'
);

select is(
  pg_catalog.jsonb_build_object(
    'revision', (select identity_revision from dashboard_private.google_chat_profile_identities where profile_id = '99450000-0000-4000-8000-000000000101'),
    'audits', (select pg_catalog.count(*) from dashboard_private.google_chat_profile_identity_audits where profile_id = '99450000-0000-4000-8000-000000000101')
  ),
  '{"revision":1,"audits":1}'::jsonb,
  'identity replay changes neither revision nor audit count'
);

select throws_ok(
  $$select pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a@example.invalid', 'manual', '111111111', 'verified', 1,
    '99450000-0000-4000-8000-000000000901'
  )$$,
  '22023', 'idempotency_key_reused',
  'same request ID with another fingerprint is rejected'
);

select throws_ok(
  $$select pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a@example.invalid', 'auto', '111111111', 'verified', 0,
    '99450000-0000-4000-8000-000000000902'
  )$$,
  '40001', 'google_chat_profile_identity_revision_conflict',
  'stale identity revision is rejected'
);

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000002',
    '99450000-0000-4000-8000-000000000102',
    'chat-teacher-b@example.invalid', 'manual', '222222222', 'verified', 0,
    '99450000-0000-4000-8000-000000000903'
  ) ->> 'source',
  'manual',
  'manual verification is stored only after server-side verification succeeds'
);

select throws_ok(
  $$select pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000105',
    'chat-mismatch@example.invalid', 'manual', 'not-numeric', 'verified', 0,
    '99450000-0000-4000-8000-000000000904'
  )$$,
  '22023', 'google_chat_profile_identity_invalid',
  'non-numeric Google Chat user ID is rejected'
);

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000105',
    'chat-mismatch@example.invalid', 'auto', '444444444', 'verified', 0,
    '99450000-0000-4000-8000-000000000905'
  ) ->> 'verificationStatus',
  'verified',
  'mismatch fixture first has a verified identity'
);

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000105',
    'chat-mismatch@example.invalid', 'auto', null, 'email_mismatch', 1,
    '99450000-0000-4000-8000-000000000906'
  ) - 'profileName' - 'accountEmail' - 'dashboardRole'
    - 'verifiedAt' - 'lastSyncAt',
  '{"profileId":"99450000-0000-4000-8000-000000000105","chatUserId":null,"resourceName":null,"source":null,"verificationStatus":"unverified","lastSyncStatus":"email_mismatch","identityRevision":"2","eligible":false}'::jsonb,
  'email mismatch clears the verified ID and eligibility'
);

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a@example.invalid', 'auto', null, 'not_found', 1,
    '99450000-0000-4000-8000-000000000907'
  ) ->> 'verificationStatus',
  'not_found',
  'Directory not-found removes eligibility'
);

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a@example.invalid', 'auto', '111111111', 'verified', 2,
    '99450000-0000-4000-8000-000000000908'
  ) ->> 'identityRevision',
  '3',
  'identity can be reverified after a not-found result'
);

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a@example.invalid', 'auto', null, 'provider_error', 3,
    '99450000-0000-4000-8000-000000000909'
  ) -> 'chatUserId',
  '"111111111"'::jsonb,
  'provider error preserves the verified ID when current email still matches'
);

update auth.users
set email = 'chat-teacher-a-new@example.invalid'
where id = '99450000-0000-4000-8000-000000000101';
update public.profiles
set email = 'chat-teacher-a-new@example.invalid'
where id = '99450000-0000-4000-8000-000000000101';

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a-new@example.invalid', 'auto', null, 'provider_error', 4,
    '99450000-0000-4000-8000-000000000910'
  ) -> 'chatUserId',
  'null'::jsonb,
  'provider error clears stale verified ID after account email changes'
);

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a-new@example.invalid', 'auto', '111111111', 'verified', 5,
    '99450000-0000-4000-8000-000000000911'
  ) ->> 'identityRevision',
  '6',
  'changed account email can be reverified explicitly'
);

select throws_ok(
  $$select pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000105',
    'chat-mismatch@example.invalid', 'manual', '222222222', 'verified', 2,
    '99450000-0000-4000-8000-000000000912'
  )$$,
  '23505', null,
  'one Google Chat user ID cannot belong to two dashboard profiles'
);

update public.profiles
set role = 'teacher'
where id = '99450000-0000-4000-8000-000000000001';

select throws_ok(
  $$select pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000101',
    'chat-teacher-a-new@example.invalid', 'auto', '111111111', 'verified', 0,
    '99450000-0000-4000-8000-000000000901'
  )$$,
  '42501', 'google_chat_profile_mentions_access_denied',
  'actor role loss is revalidated before an identity request replay'
);

update public.profiles
set role = 'admin'
where id = '99450000-0000-4000-8000-000000000001';

select is(
  pg_catalog.jsonb_array_length(
    pg_temp.chat_list_settings(
      '99450000-0000-4000-8000-000000000001', 'registration'
    )
  ),
  1,
  'settings list contains only explicitly adopted Google Chat rules'
);

select throws_ok(
  $$select pg_temp.chat_list_settings(
    '99450000-0000-4000-8000-000000000003', 'registration'
  )$$,
  '42501', 'google_chat_profile_mentions_access_denied',
  'teacher cannot list mention settings'
);

insert into pg_temp.chat_mention_results(label, payload)
values (
  'setting_enabled',
  pg_temp.chat_save_setting(
    '99450000-0000-4000-8000-000000000002',
    '99450000-0000-4000-8000-000000000401', true, 1,
    '99450000-0000-4000-8000-000000000913'
  )
);

select is(
  (
    select payload - 'updatedAt'
    from pg_temp.chat_mention_results where label = 'setting_enabled'
  ),
  pg_catalog.jsonb_build_object(
    'ruleId', '99450000-0000-4000-8000-000000000401',
    'workflowKey', 'registration',
    'eventKey', 'registration.observation.teacher_changed',
    'channelKey', 'google_chat',
    'mentionEnabled', true, 'revision', '2', 'editable', true
  ),
  'rule mention toggle updates its own revision and exact setting DTO'
);

select is(
  (select revision from dashboard_private.notification_rules where id = '99450000-0000-4000-8000-000000000401'),
  7::bigint,
  'mention toggle does not mutate the notification rule revision'
);

select is(
  pg_temp.chat_save_setting(
    '99450000-0000-4000-8000-000000000002',
    '99450000-0000-4000-8000-000000000401', true, 1,
    '99450000-0000-4000-8000-000000000913'
  ) - 'updatedAt',
  (
    select payload - 'updatedAt'
    from pg_temp.chat_mention_results where label = 'setting_enabled'
  ),
  'same setting request replays byte-equal response'
);

select is(
  (select pg_catalog.count(*) from dashboard_private.notification_rule_mention_setting_audits where rule_id = '99450000-0000-4000-8000-000000000401'),
  1::bigint,
  'setting replay does not append another audit row'
);

select throws_ok(
  $$select pg_temp.chat_save_setting(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000401', false, 2,
    '99450000-0000-4000-8000-000000000913'
  )$$,
  '22023', 'idempotency_key_reused',
  'setting request ID fingerprint conflict is rejected'
);

select throws_ok(
  $$select pg_temp.chat_save_setting(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000401', false, 1,
    '99450000-0000-4000-8000-000000000914'
  )$$,
  '40001', 'notification_mention_setting_revision_conflict',
  'stale mention setting revision is rejected'
);

select throws_ok(
  $$select pg_temp.chat_save_setting(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000402', true, 0,
    '99450000-0000-4000-8000-000000000915'
  )$$,
  'P0002', 'notification_mention_setting_not_found',
  'unadopted Google Chat rule cannot be toggled'
);

select throws_ok(
  $$insert into dashboard_private.notification_rule_mention_settings(
    rule_id, mention_enabled, revision, updated_by
  ) values (
    '99450000-0000-4000-8000-000000000403', true, 1,
    '99450000-0000-4000-8000-000000000001'
  )$$,
  '23514', 'notification_mention_setting_rule_invalid',
  'non-Google-Chat rule cannot be adopted for mentions'
);

select throws_ok(
  $$select pg_temp.chat_attempt_adopted_rule_channel_drift()$$,
  '23514', 'notification_mention_setting_rule_invalid',
  'an adopted mention rule cannot drift away from Google Chat'
);

update public.ops_registration_appointments
set notification_revision = notification_revision + 1
where id = '99450000-0000-4000-8000-000000000303';
update public.ops_registration_observations
set teacher_profile_id = '99450000-0000-4000-8000-000000000102',
    teacher_catalog_id = '99450000-0000-4000-8000-000000000202',
    teacher_name_snapshot = '담당 교사 B'
where id = '99450000-0000-4000-8000-000000000304';

select is(
  (
    select pg_catalog.jsonb_build_object(
      'kind', fact.role_key,
      'sourceId', fact.source_id,
      'sourceRevision', fact.source_revision,
      'contextId', fact.context_entity_id,
      'previous', fact.previous_profile_ids,
      'current', fact.current_profile_ids
    )
    from dashboard_private.notification_assignment_change_facts fact
    where fact.source_id = '99450000-0000-4000-8000-000000000304'
  ),
  pg_catalog.jsonb_build_object(
    'kind', 'subject_teacher',
    'sourceId', '99450000-0000-4000-8000-000000000304',
    'sourceRevision', 5,
    'contextId', '99450000-0000-4000-8000-000000000302',
    'previous', array['99450000-0000-4000-8000-000000000101'::uuid],
    'current', array['99450000-0000-4000-8000-000000000102'::uuid]
  ),
  'teacher reassignment fact uses the already-incremented appointment revision'
);

update public.ops_registration_observations
set teacher_name_snapshot = '담당 교사 B 유지'
where id = '99450000-0000-4000-8000-000000000304';

select is(
  (select pg_catalog.count(*) from dashboard_private.notification_assignment_change_facts where source_id = '99450000-0000-4000-8000-000000000304'),
  1::bigint,
  'non-assignment observation update writes no duplicate teacher fact'
);

insert into public.ops_task_events(
  id, task_id, actor_id, event_type, field_name, before_value, after_value
)
values
  (
    '99450000-0000-4000-8000-000000000620',
    '99450000-0000-4000-8000-000000000301', null,
    'registration_track_event',
    'registration_track:99450000-0000-4000-8000-000000000302', null,
    pg_catalog.jsonb_build_object(
      'version', 2,
      'event_type', 'director_manual_override',
      'track_id', '99450000-0000-4000-8000-000000000302',
      'metadata', pg_catalog.jsonb_build_object(
        'appointmentId', '99450000-0000-4000-8000-000000000303',
        'previousDirectorProfileId', '99450000-0000-4000-8000-000000000101',
        'directorProfileId', '99450000-0000-4000-8000-000000000102',
        'ruleKey', 'english-default',
        'recipientSetChanged', true
      )
    )::text
  ),
  (
    '99450000-0000-4000-8000-000000000621',
    '99450000-0000-4000-8000-000000000301', null,
    'registration_track_event', null, null,
    '{"version":20,"event_type":"director_manual_override"}'
  ),
  (
    '99450000-0000-4000-8000-000000000622',
    '99450000-0000-4000-8000-000000000301', null,
    'updated', null, null, 'not-json'
  );

select is(
  (
    select pg_catalog.jsonb_build_object(
      'kind', fact.role_key,
      'sourceId', fact.source_id,
      'contextId', fact.context_entity_id,
      'previous', fact.previous_profile_ids,
      'current', fact.current_profile_ids
    )
    from dashboard_private.notification_assignment_change_facts fact
    where fact.source_id = '99450000-0000-4000-8000-000000000620'
  ),
  pg_catalog.jsonb_build_object(
    'kind', 'track_director',
    'sourceId', '99450000-0000-4000-8000-000000000620',
    'contextId', '99450000-0000-4000-8000-000000000302',
    'previous', array['99450000-0000-4000-8000-000000000101'::uuid],
    'current', array['99450000-0000-4000-8000-000000000102'::uuid]
  ),
  'canonical v2 director event writes one exact director assignment fact'
);

select is(
  (select pg_catalog.count(*) from dashboard_private.notification_assignment_change_facts where role_key = 'track_director'),
  1::bigint,
  'malformed, version-20 and non-track events write no director fact'
);

select throws_ok(
  $$insert into dashboard_private.notification_assignment_change_facts(
    workflow_key, source_type, source_id, source_revision,
    context_entity_id, role_key, previous_profile_ids, current_profile_ids
  ) values (
    'registration', 'registration_observation', 'noncanonical-fixture', 0,
    '99450000-0000-4000-8000-000000000302', 'subject_teacher',
    array[
      '99450000-0000-4000-8000-000000000102'::uuid,
      '99450000-0000-4000-8000-000000000101'::uuid
    ],
    array['99450000-0000-4000-8000-000000000102'::uuid]
  )$$,
  '23514', null,
  'assignment facts reject noncanonical profile arrays'
);

update auth.users
set banned_until = now() + interval '1 day'
where id = '99450000-0000-4000-8000-000000000103';

select is(
  pg_temp.chat_resolve_mentions(array[
    '99450000-0000-4000-8000-000000000102'::uuid,
    '99450000-0000-4000-8000-000000000101'::uuid,
    '99450000-0000-4000-8000-000000000102'::uuid,
    '99450000-0000-4000-8000-000000000105'::uuid,
    '99450000-0000-4000-8000-000000000103'::uuid,
    '99450000-0000-4000-8000-000000000104'::uuid
  ]) - 'identity_revision_fingerprint',
  pg_catalog.jsonb_build_object(
    'profile_ids', array[
      '99450000-0000-4000-8000-000000000102'::uuid,
      '99450000-0000-4000-8000-000000000101'::uuid
    ],
    'user_names', array['users/222222222', 'users/111111111'],
    'omitted', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('profile_id', '99450000-0000-4000-8000-000000000105', 'reason', 'identity_unverified'),
      pg_catalog.jsonb_build_object('profile_id', '99450000-0000-4000-8000-000000000103', 'reason', 'profile_inactive'),
      pg_catalog.jsonb_build_object('profile_id', '99450000-0000-4000-8000-000000000104', 'reason', 'identity_missing')
    )
  ),
  'resolver preserves first occurrence, deduplicates and reports exact omissions'
);

select is(
  pg_catalog.length(
    pg_temp.chat_resolve_mentions(array[
      '99450000-0000-4000-8000-000000000102'::uuid,
      '99450000-0000-4000-8000-000000000101'::uuid
    ]) ->> 'identity_revision_fingerprint'
  ),
  64,
  'resolver returns a canonical SHA-256 identity revision fingerprint'
);

insert into pg_temp.chat_mention_results(label, payload)
values (
  'snapshot_enabled',
  pg_temp.chat_prepare_snapshot(
    '99450000-0000-4000-8000-000000000701',
    '99450000-0000-4000-8000-000000000801',
    '99450000-0000-4000-8000-000000000401',
    array[
      '99450000-0000-4000-8000-000000000102'::uuid,
      '99450000-0000-4000-8000-000000000101'::uuid
    ],
    false
  )
);

select is(
  (select payload -> 'user_names' from pg_temp.chat_mention_results where label = 'snapshot_enabled'),
  '["users/222222222","users/111111111"]'::jsonb,
  'first enabled prepare freezes exact canonical user names'
);

select is(
  (select pg_catalog.count(*) from dashboard_private.notification_delivery_mention_snapshots where delivery_id = '99450000-0000-4000-8000-000000000701'),
  1::bigint,
  'first prepare writes exactly one immutable delivery snapshot'
);

select throws_ok(
  $$select pg_temp.chat_prepare_snapshot(
    '99450000-0000-4000-8000-000000000701',
    '99450000-0000-4000-8000-000000000801',
    '99450000-0000-4000-8000-000000000401',
    array['99450000-0000-4000-8000-000000000102'::uuid], false
  )$$,
  '40001', 'google_chat_mention_snapshot_already_exists',
  'non-retry prepare cannot replace a frozen snapshot'
);

select is(
  pg_temp.chat_apply_identity(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000102',
    'chat-teacher-b@example.invalid', 'manual', null, 'provider_error', 1,
    '99450000-0000-4000-8000-000000000917'
  ) ->> 'identityRevision',
  '2',
  'identity revision can drift after a delivery snapshot is frozen'
);

select lives_ok(
  $$select pg_temp.chat_save_setting(
    '99450000-0000-4000-8000-000000000001',
    '99450000-0000-4000-8000-000000000401', false, 2,
    '99450000-0000-4000-8000-000000000916'
  )$$,
  'setting can be turned off after the first snapshot'
);

select is(
  pg_temp.chat_prepare_snapshot(
    '99450000-0000-4000-8000-000000000701',
    '99450000-0000-4000-8000-000000000801',
    '99450000-0000-4000-8000-000000000401',
    array['99450000-0000-4000-8000-000000000101'::uuid], true
  ),
  (select payload from pg_temp.chat_mention_results where label = 'snapshot_enabled'),
  'retry returns the frozen snapshot despite setting and identity drift'
);

select is(
  pg_temp.chat_prepare_snapshot(
    '99450000-0000-4000-8000-000000000702',
    '99450000-0000-4000-8000-000000000802',
    '99450000-0000-4000-8000-000000000401',
    array[
      '99450000-0000-4000-8000-000000000102'::uuid,
      '99450000-0000-4000-8000-000000000101'::uuid
    ], false
  ) -> 'user_names',
  '[]'::jsonb,
  'mention OFF freezes an empty user-name list without a broad fallback'
);

select throws_ok(
  $$select pg_temp.chat_prepare_snapshot(
    '99450000-0000-4000-8000-000000000702',
    '99450000-0000-4000-8000-000000000899',
    '99450000-0000-4000-8000-000000000401',
    array[]::uuid[], true
  )$$,
  '40001', 'google_chat_mention_snapshot_claim_invalid',
  'retry requires the exact delivery claim token'
);

select throws_ok(
  $$update dashboard_private.notification_delivery_mention_snapshots
    set user_names = array['users/999999999']
    where delivery_id = '99450000-0000-4000-8000-000000000701'$$,
  '55000', 'google_chat_mention_row_immutable',
  'delivery mention snapshots are immutable after insert'
);

select throws_ok(
  $$update dashboard_private.google_chat_profile_identity_audits
    set before_identity = '{}'::jsonb
    where profile_id = '99450000-0000-4000-8000-000000000101'$$,
  '55000', 'google_chat_mention_row_immutable',
  'identity audit rows are immutable after insert'
);

select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', rule.id,
        'enabled', rule.enabled,
        'revision', rule.revision,
        'activeTemplateId', rule.active_template_id
      ) order by rule.id
    )
    from dashboard_private.notification_rules rule
    join chat_existing_notification_rule_state_baseline baseline
      on baseline.id = rule.id
  ),
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', baseline.id,
        'enabled', baseline.enabled,
        'revision', baseline.revision,
        'activeTemplateId', baseline.active_template_id
      ) order by baseline.id
    )
    from chat_existing_notification_rule_state_baseline baseline
  ),
  'identity, setting, resolver and snapshot transitions preserve all pre-existing rule states'
);

select throws_ok(
  $$select pg_temp.chat_attempt_private_identity_insert()$$,
  '42501', null,
  'authenticated callers cannot write private identity tables directly'
);

select is(
  (
    select setting.activation_version
    from dashboard_private.registration_observation_runtime_settings setting
    where setting.singleton = true
  ),
  0,
  'mention ledger behavior leaves observation runtime disabled'
);

select * from finish();
rollback;
