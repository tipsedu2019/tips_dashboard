begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_table(
  'public',
  'ops_registration_customer_message_previews',
  'preview audit table exists'
);

select has_table(
  'public',
  'ops_registration_customer_messages',
  'customer message outbox exists'
);

select has_table(
  'dashboard_private',
  'registration_customer_solapi_template_receipts',
  'private template receipt table exists'
);

select has_table(
  'dashboard_private',
  'registration_customer_solapi_activation',
  'private activation table exists'
);

select is_empty($$
  with expected(column_name) as (
    values
      ('id'),
      ('task_id'),
      ('track_id'),
      ('appointment_id'),
      ('message_kind'),
      ('source_fingerprint'),
      ('source_facts_checksum'),
      ('source_revision'),
      ('recipient_hash'),
      ('recipient_last4'),
      ('template_key'),
      ('template_revision'),
      ('template_checksum'),
      ('rendered_variables_checksum'),
      ('rendered_body_checksum'),
      ('rendered_buttons_checksum'),
      ('created_by'),
      ('created_at'),
      ('expires_at'),
      ('consumed_at')
  )
  select expected.column_name
  from expected
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = 'ops_registration_customer_message_previews'
   and actual.column_name = expected.column_name
  where actual.column_name is null
$$, 'preview table keeps every locked identity and checksum column');

select is_empty($$
  with expected(column_name) as (
    values
      ('id'),
      ('preview_id'),
      ('task_id'),
      ('track_id'),
      ('appointment_id'),
      ('message_kind'),
      ('source_fingerprint'),
      ('source_facts_checksum'),
      ('source_revision'),
      ('recipient_hash'),
      ('recipient_last4'),
      ('template_key'),
      ('template_revision'),
      ('template_checksum'),
      ('rendered_variables_checksum'),
      ('rendered_body_checksum'),
      ('rendered_buttons_checksum'),
      ('dedupe_key'),
      ('request_key'),
      ('status'),
      ('claim_active'),
      ('claim_token'),
      ('claim_owner_id'),
      ('claim_expires_at'),
      ('claim_release_reason'),
      ('dispatch_token'),
      ('provider_attempt_started_at'),
      ('provider_attempt_count'),
      ('provider_message_id'),
      ('provider_group_id'),
      ('provider_status_code'),
      ('provider_status_message'),
      ('provider_evidence'),
      ('error_code'),
      ('confirmed_by'),
      ('confirmed_at'),
      ('resolution_source'),
      ('resolved_by'),
      ('resolved_at'),
      ('created_at'),
      ('updated_at')
  )
  select expected.column_name
  from expected
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = 'ops_registration_customer_messages'
   and actual.column_name = expected.column_name
  where actual.column_name is null
$$, 'outbox keeps every locked dedupe claim attempt and resolution column');

select is_empty($$
  with expected(table_schema, table_name, column_name, udt_name, is_nullable) as (
    values
      ('public', 'ops_registration_customer_message_previews', 'id', 'uuid', 'NO'),
      ('public', 'ops_registration_customer_message_previews', 'task_id', 'uuid', 'NO'),
      ('public', 'ops_registration_customer_message_previews', 'track_id', 'uuid', 'YES'),
      ('public', 'ops_registration_customer_message_previews', 'appointment_id', 'uuid', 'YES'),
      ('public', 'ops_registration_customer_message_previews', 'source_facts_checksum', 'text', 'NO'),
      ('public', 'ops_registration_customer_message_previews', 'source_revision', 'int8', 'YES'),
      ('public', 'ops_registration_customer_message_previews', 'recipient_last4', 'text', 'NO'),
      ('public', 'ops_registration_customer_messages', 'preview_id', 'uuid', 'NO'),
      ('public', 'ops_registration_customer_messages', 'source_facts_checksum', 'text', 'NO'),
      ('public', 'ops_registration_customer_messages', 'claim_active', 'bool', 'NO'),
      ('public', 'ops_registration_customer_messages', 'claim_token', 'uuid', 'YES'),
      ('public', 'ops_registration_customer_messages', 'dispatch_token', 'uuid', 'NO'),
      ('public', 'ops_registration_customer_messages', 'provider_attempt_count', 'int4', 'NO'),
      ('public', 'ops_registration_customer_messages', 'provider_evidence', 'jsonb', 'NO'),
      ('dashboard_private', 'registration_customer_solapi_activation', 'mode', 'text', 'NO'),
      ('dashboard_private', 'registration_customer_solapi_activation', 'verification_recipient_hash', 'text', 'YES')
  )
  select
    expected.table_schema,
    expected.table_name,
    expected.column_name,
    actual.udt_name,
    actual.is_nullable
  from expected
  left join information_schema.columns actual
    on actual.table_schema = expected.table_schema
   and actual.table_name = expected.table_name
   and actual.column_name = expected.column_name
  where actual.column_name is null
     or actual.udt_name <> expected.udt_name
     or actual.is_nullable <> expected.is_nullable
$$, 'storage identities hashes claims and evidence keep exact types and nullability');

select is_empty($$
  with expected(constraint_name) as (
    values
      ('ops_registration_customer_message_previews_message_kind_check'),
      ('ops_registration_customer_message_previews_hashes_check'),
      ('ops_registration_customer_message_previews_last4_check'),
      ('ops_registration_customer_message_previews_source_shape_check'),
      ('ops_registration_customer_message_previews_expiry_check'),
      ('ops_registration_customer_messages_message_kind_check'),
      ('ops_registration_customer_messages_hashes_check'),
      ('ops_registration_customer_messages_status_check'),
      ('ops_registration_customer_messages_attempt_marker_check'),
      ('ops_registration_customer_messages_terminal_attempt_check'),
      ('ops_registration_customer_messages_claim_shape_check'),
      ('ops_registration_customer_messages_provider_evidence_check'),
      ('registration_customer_solapi_template_receipts_sendable_check'),
      ('registration_customer_solapi_activation_mode_check'),
      ('registration_customer_solapi_activation_shape_check')
  )
  select expected.constraint_name
  from expected
  left join pg_catalog.pg_constraint actual
    on actual.conname = expected.constraint_name
  where actual.oid is null
$$, 'all safety-critical storage checks are named and installed');

select is_empty($$
  with expected(index_name) as (
    values
      ('ops_registration_customer_messages_preview_id_key'),
      ('ops_registration_customer_messages_dedupe_key_key'),
      ('ops_registration_customer_messages_request_key_key'),
      ('ops_registration_customer_messages_dispatch_token_key')
  )
  select expected.index_name
  from expected
  where pg_catalog.to_regclass('public.' || expected.index_name) is null
$$, 'preview request dispatch and dedupe identities are unique');

select is_empty($$
  with expected(index_name) as (
    values
      ('ops_registration_customer_message_previews_open_expiry_idx'),
      ('ops_registration_customer_message_previews_actor_expiry_idx'),
      ('ops_registration_customer_message_previews_task_created_idx'),
      ('ops_registration_customer_message_previews_appointment_idx'),
      ('ops_registration_customer_message_previews_track_idx'),
      ('ops_registration_customer_messages_task_kind_created_idx'),
      ('ops_registration_customer_messages_appointment_idx'),
      ('ops_registration_customer_messages_track_idx'),
      ('ops_registration_customer_messages_unresolved_attempt_idx'),
      ('ops_registration_customer_messages_active_claim_expiry_idx'),
      ('ops_registration_customer_messages_provider_message_idx')
  )
  select expected.index_name
  from expected
  where pg_catalog.to_regclass('public.' || expected.index_name) is null
$$, 'preview cleanup and outbox operations have bounded indexes');

select is_empty($$
  with expected(table_schema, table_name) as (
    values
      ('public', 'ops_registration_customer_message_previews'),
      ('public', 'ops_registration_customer_messages'),
      ('dashboard_private', 'registration_customer_solapi_template_receipts'),
      ('dashboard_private', 'registration_customer_solapi_activation')
  )
  select expected.table_schema, expected.table_name
  from expected
  left join pg_catalog.pg_namespace namespace
    on namespace.nspname = expected.table_schema
  left join pg_catalog.pg_class relation
    on relation.relnamespace = namespace.oid
   and relation.relname = expected.table_name
  where relation.oid is null
     or not relation.relrowsecurity
$$, 'all four customer message tables have row level security');

select is(
  (
    select count(*)
    from pg_catalog.pg_policy policy
    where policy.polrelid in (
      'public.ops_registration_customer_message_previews'::regclass,
      'public.ops_registration_customer_messages'::regclass,
      'dashboard_private.registration_customer_solapi_template_receipts'::regclass,
      'dashboard_private.registration_customer_solapi_activation'::regclass
    )
  ),
  0::bigint,
  'no direct table policies bypass the server RPC boundary'
);

select is_empty($$
  with expected(table_name) as (
    values
      ('public.ops_registration_customer_message_previews'),
      ('public.ops_registration_customer_messages'),
      ('dashboard_private.registration_customer_solapi_template_receipts'),
      ('dashboard_private.registration_customer_solapi_activation')
  ), api_roles(role_name) as (
    values ('anon'), ('authenticated'), ('service_role')
  )
  select expected.table_name, api_roles.role_name
  from expected
  cross join api_roles
  where pg_catalog.has_table_privilege(
    api_roles.role_name,
    expected.table_name,
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
  )
  union all
  select expected.table_name, 'PUBLIC'
  from expected
  join pg_catalog.pg_class relation
    on relation.oid = pg_catalog.to_regclass(expected.table_name)
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      relation.relacl,
      pg_catalog.acldefault('r', relation.relowner)
    )
  ) privilege
  where privilege.grantee = 0
    and privilege.privilege_type in (
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    )
$$, 'direct table privileges are denied to every API role including service_role');

select results_eq(
  $$
    select message_kind, mode
    from dashboard_private.registration_customer_solapi_activation
    order by message_kind
  $$,
  $$
    values
      ('admission_application'::text, 'off'::text),
      ('appointment_reminder'::text, 'off'::text),
      ('level_test_booking'::text, 'off'::text),
      ('visit_consultation_booking'::text, 'off'::text),
      ('waiting_notice'::text, 'off'::text)
  $$,
  'five activation rows default off'
);

select is(
  (
    select count(*)
    from dashboard_private.registration_customer_solapi_activation
    where verification_task_id is not null
       or verification_recipient_hash is not null
       or live_test_message_id is not null
       or live_test_confirmed_at is not null
       or updated_by is not null
  ),
  0::bigint,
  'initial off activation rows contain no verification or live evidence'
);

select is(
  (
    select
      (select count(*) from public.ops_registration_customer_message_previews)
      +
      (select count(*) from public.ops_registration_customer_messages)
  ),
  0::bigint,
  'storage migration seeds no preview or outbox rows'
);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '95000000-0000-4000-8000-000000000001',
  'admin',
  'Registration SOLAPI Storage Admin',
  'registration-solapi-storage@example.invalid',
  now(),
  now()
)
on conflict (id) do update
set
  role = excluded.role,
  name = excluded.name,
  email = excluded.email,
  updated_at = excluded.updated_at;

insert into public.ops_tasks(
  id,
  title,
  type,
  status,
  priority,
  requested_by,
  student_name
) values (
  '95000000-0000-4000-8000-000000000002',
  'Registration SOLAPI storage fixture',
  'registration',
  'requested',
  'normal',
  '95000000-0000-4000-8000-000000000001',
  'SOLAPI 테스트'
);

select throws_ok(
  $$
    insert into public.ops_registration_customer_message_previews(
      id, task_id, message_kind, source_fingerprint, source_facts_checksum, recipient_hash,
      recipient_last4, template_key, template_revision, template_checksum,
      rendered_variables_checksum, rendered_body_checksum,
      rendered_buttons_checksum, created_by
    ) values (
      '95000000-0000-4000-8000-000000000101',
      '95000000-0000-4000-8000-000000000002',
      'admission_application',
      repeat('a', 64),
      repeat('0', 64),
      repeat('b', 64),
      '123',
      'admission_application',
      1,
      repeat('c', 64),
      repeat('d', 64),
      repeat('e', 64),
      repeat('f', 64),
      '95000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  null,
  'invalid recipient last4 is rejected'
);

select throws_ok(
  $$
    insert into public.ops_registration_customer_message_previews(
      id, task_id, message_kind, source_fingerprint, source_facts_checksum, recipient_hash,
      recipient_last4, template_key, template_revision, template_checksum,
      rendered_variables_checksum, rendered_body_checksum,
      rendered_buttons_checksum, created_by
    ) values (
      '95000000-0000-4000-8000-000000000102',
      '95000000-0000-4000-8000-000000000002',
      'admission_application',
      'not-a-checksum',
      repeat('0', 64),
      repeat('b', 64),
      '1234',
      'admission_application',
      1,
      repeat('c', 64),
      repeat('d', 64),
      repeat('e', 64),
      repeat('f', 64),
      '95000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  null,
  'invalid checksum is rejected'
);

select throws_ok(
  $$
    insert into public.ops_registration_customer_message_previews(
      id, task_id, message_kind, source_fingerprint, source_facts_checksum, recipient_hash,
      recipient_last4, template_key, template_revision, template_checksum,
      rendered_variables_checksum, rendered_body_checksum,
      rendered_buttons_checksum, created_by
    ) values (
      '95000000-0000-4000-8000-000000000103',
      '95000000-0000-4000-8000-000000000002',
      'level_test_booking',
      repeat('a', 64),
      repeat('0', 64),
      repeat('b', 64),
      '1234',
      'level_test_booking',
      1,
      repeat('c', 64),
      repeat('d', 64),
      repeat('e', 64),
      repeat('f', 64),
      '95000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  null,
  'invalid source shape is rejected'
);

insert into public.ops_registration_customer_message_previews(
  id, task_id, message_kind, source_fingerprint, source_facts_checksum, recipient_hash,
  recipient_last4, template_key, template_revision, template_checksum,
  rendered_variables_checksum, rendered_body_checksum,
  rendered_buttons_checksum, created_by
) values (
  '95000000-0000-4000-8000-000000000110',
  '95000000-0000-4000-8000-000000000002',
  'admission_application',
  repeat('a', 64),
  repeat('0', 64),
  repeat('b', 64),
  '1234',
  'admission_application',
  1,
  repeat('c', 64),
  repeat('d', 64),
  repeat('e', 64),
  repeat('f', 64),
  '95000000-0000-4000-8000-000000000001'
);

select throws_ok(
  $$
    insert into public.ops_registration_customer_messages(
      id, preview_id, task_id, message_kind, source_fingerprint, source_facts_checksum,
      recipient_hash, recipient_last4, template_key, template_revision,
      template_checksum, rendered_variables_checksum,
      rendered_body_checksum, rendered_buttons_checksum, dedupe_key,
      request_key, status, claim_active, dispatch_token,
      provider_attempt_count, confirmed_by
    ) values (
      '95000000-0000-4000-8000-000000000201',
      '95000000-0000-4000-8000-000000000110',
      '95000000-0000-4000-8000-000000000002',
      'admission_application',
      repeat('a', 64),
      repeat('0', 64),
      repeat('b', 64),
      '1234',
      'admission_application',
      1,
      repeat('c', 64),
      repeat('d', 64),
      repeat('e', 64),
      repeat('f', 64),
      repeat('1', 64),
      'registration-solapi-attempt-shape',
      'pending',
      false,
      '95000000-0000-4000-8000-000000000301',
      1,
      '95000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  null,
  'invalid provider attempt shape is rejected'
);

select throws_ok(
  $$
    insert into public.ops_registration_customer_messages(
      id, preview_id, task_id, message_kind, source_fingerprint, source_facts_checksum,
      recipient_hash, recipient_last4, template_key, template_revision,
      template_checksum, rendered_variables_checksum,
      rendered_body_checksum, rendered_buttons_checksum, dedupe_key,
      request_key, status, claim_active, claim_token, claim_owner_id,
      claim_expires_at, dispatch_token, provider_attempt_started_at,
      provider_attempt_count, confirmed_by, resolution_source, resolved_at
    ) values (
      '95000000-0000-4000-8000-000000000202',
      '95000000-0000-4000-8000-000000000110',
      '95000000-0000-4000-8000-000000000002',
      'admission_application',
      repeat('a', 64),
      repeat('0', 64),
      repeat('b', 64),
      '1234',
      'admission_application',
      1,
      repeat('c', 64),
      repeat('d', 64),
      repeat('e', 64),
      repeat('f', 64),
      repeat('2', 64),
      'registration-solapi-terminal-claim',
      'accepted',
      true,
      '95000000-0000-4000-8000-000000000302',
      '95000000-0000-4000-8000-000000000001',
      now() + interval '1 minute',
      '95000000-0000-4000-8000-000000000303',
      now(),
      1,
      '95000000-0000-4000-8000-000000000001',
      'provider_send',
      now()
    )
  $$,
  '23514',
  null,
  'terminal message cannot keep an active claim'
);

select throws_ok(
  $$
    insert into public.ops_registration_customer_messages(
      id, preview_id, task_id, message_kind, source_fingerprint, source_facts_checksum,
      recipient_hash, recipient_last4, template_key, template_revision,
      template_checksum, rendered_variables_checksum,
      rendered_body_checksum, rendered_buttons_checksum, dedupe_key,
      request_key, status, claim_active, dispatch_token,
      provider_attempt_count, provider_evidence, confirmed_by
    ) values (
      '95000000-0000-4000-8000-000000000203',
      '95000000-0000-4000-8000-000000000110',
      '95000000-0000-4000-8000-000000000002',
      'admission_application',
      repeat('a', 64),
      repeat('0', 64),
      repeat('b', 64),
      '1234',
      'admission_application',
      1,
      repeat('c', 64),
      repeat('d', 64),
      repeat('e', 64),
      repeat('f', 64),
      repeat('3', 64),
      'registration-solapi-provider-evidence',
      'pending',
      false,
      '95000000-0000-4000-8000-000000000304',
      0,
      '{"phone":"01000001234"}'::jsonb,
      '95000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  null,
  'provider evidence rejects unexpected keys'
);

select throws_ok(
  $$
    insert into dashboard_private.registration_customer_solapi_template_receipts(
      message_kind, template_id, pf_id, catalog_checksum,
      provider_checksum, provider_status, verified_by
    ) values (
      'level_test_booking',
      'template-fixture',
      'pf-fixture',
      repeat('a', 64),
      repeat('b', 64),
      'sendable',
      '95000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  null,
  'template receipt requires matching sendable checksums'
);

select throws_ok(
  $$
    update dashboard_private.registration_customer_solapi_activation
    set mode = 'verification'
    where message_kind = 'level_test_booking'
  $$,
  '23514',
  null,
  'activation verification requires scoped evidence'
);

select throws_ok(
  $$
    update dashboard_private.registration_customer_solapi_activation
    set
      mode = 'live',
      updated_by = '95000000-0000-4000-8000-000000000001'
    where message_kind = 'waiting_notice'
  $$,
  '23514',
  null,
  'activation live evidence must be paired'
);

-- Task 3 RPC contract and disposable state-machine fixtures.
select has_function('public', 'resolve_registration_customer_message_source_v1', array['uuid', 'text', 'uuid']);
select has_function('public', 'create_registration_customer_message_preview_v1', array['uuid', 'text', 'uuid', 'jsonb']);
select has_function('public', 'claim_registration_customer_message_v1', array['uuid', 'uuid', 'text', 'jsonb']);
select has_function('public', 'mark_registration_customer_message_attempt_started_v1', array['uuid', 'uuid', 'uuid', 'jsonb']);
select has_function('public', 'release_registration_customer_message_pre_send_claim_v1', array['uuid', 'uuid', 'text']);
select has_function('public', 'release_registration_customer_message_pre_send_claim_admin_v1', array['uuid', 'uuid', 'text', 'text']);
select has_function('public', 'finalize_registration_customer_message_v1', array['uuid', 'uuid', 'text', 'jsonb']);
select has_function('public', 'list_registration_customer_messages_v1', array['uuid', 'text', 'uuid', 'integer']);
select has_function('public', 'record_registration_customer_message_provider_check_v1', array['uuid', 'uuid', 'text', 'jsonb', 'text']);
select has_function('public', 'reconcile_registration_customer_message_v1', array['uuid', 'uuid', 'text', 'jsonb', 'text', 'text']);

select function_privs_are('public', 'resolve_registration_customer_message_source_v1', array['uuid', 'text', 'uuid'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'create_registration_customer_message_preview_v1', array['uuid', 'text', 'uuid', 'jsonb'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'claim_registration_customer_message_v1', array['uuid', 'uuid', 'text', 'jsonb'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'mark_registration_customer_message_attempt_started_v1', array['uuid', 'uuid', 'uuid', 'jsonb'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'release_registration_customer_message_pre_send_claim_v1', array['uuid', 'uuid', 'text'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'release_registration_customer_message_pre_send_claim_admin_v1', array['uuid', 'uuid', 'text', 'text'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'finalize_registration_customer_message_v1', array['uuid', 'uuid', 'text', 'jsonb'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'list_registration_customer_messages_v1', array['uuid', 'text', 'uuid', 'integer'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'record_registration_customer_message_provider_check_v1', array['uuid', 'uuid', 'text', 'jsonb', 'text'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'reconcile_registration_customer_message_v1', array['uuid', 'uuid', 'text', 'jsonb', 'text', 'text'], 'service_role', array['EXECUTE']);

select is_empty($$
  select routine_name, grantee
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in (
      'resolve_registration_customer_message_source_v1',
      'create_registration_customer_message_preview_v1',
      'claim_registration_customer_message_v1',
      'mark_registration_customer_message_attempt_started_v1',
      'release_registration_customer_message_pre_send_claim_v1',
      'release_registration_customer_message_pre_send_claim_admin_v1',
      'finalize_registration_customer_message_v1',
      'list_registration_customer_messages_v1',
      'record_registration_customer_message_provider_check_v1',
      'reconcile_registration_customer_message_v1'
    )
    and grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type = 'EXECUTE'
$$, 'message RPC execute is unavailable to PUBLIC anon and authenticated');

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('95000000-0000-4000-8000-000000000011', 'staff', 'Registration SOLAPI Staff', 'registration-solapi-staff@example.invalid', now(), now()),
  ('95000000-0000-4000-8000-000000000012', 'teacher', 'Registration SOLAPI Teacher', 'registration-solapi-teacher@example.invalid', now(), now()),
  ('95000000-0000-4000-8000-000000000013', 'teacher', 'Registration SOLAPI Other', 'registration-solapi-other@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role, name = excluded.name, email = excluded.email, updated_at = excluded.updated_at;

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_plan
) values (
  '95000000-0000-4000-8000-000000000020',
  '등록 SOLAPI 현재반',
  '정규',
  '영어',
  '중1',
  'Registration SOLAPI Teacher',
  '월 18:00',
  '본관',
  12,
  100000,
  '수업 진행 중',
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '{"sessions":[]}'::jsonb
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id, student_name
) values
  ('95000000-0000-4000-8000-000000000500', 'Registration SOLAPI canonical', 'registration', 'in_progress', 'normal', '95000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000012', '정상학생'),
  ('95000000-0000-4000-8000-000000000501', 'Registration SOLAPI inaccessible', 'registration', 'in_progress', 'normal', '95000000-0000-4000-8000-000000000013', null, '다른학생'),
  ('95000000-0000-4000-8000-000000000502', 'Registration SOLAPI invalid phone', 'registration', 'in_progress', 'normal', '95000000-0000-4000-8000-000000000001', null, '번호오류'),
  ('95000000-0000-4000-8000-000000000503', 'Registration SOLAPI missing name', 'registration', 'in_progress', 'normal', '95000000-0000-4000-8000-000000000001', null, null),
  ('95000000-0000-4000-8000-000000000504', 'Registration SOLAPI wrong type', 'general', 'in_progress', 'normal', '95000000-0000-4000-8000-000000000001', null, '일반업무');

insert into public.ops_registration_details(
  task_id, parent_phone, common_revision, admission_notice_sent
) values
  ('95000000-0000-4000-8000-000000000500', '010-1234-5678', 1, false),
  ('95000000-0000-4000-8000-000000000501', '010-2234-5678', 1, false),
  ('95000000-0000-4000-8000-000000000502', '02-1234-5678', 1, false),
  ('95000000-0000-4000-8000-000000000503', '010-3234-5678', 1, false),
  ('95000000-0000-4000-8000-000000000504', '010-4234-5678', 1, false);

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, waiting_kind,
  migration_review_required, workflow_status, workflow_revision,
  workflow_status_entered_at, waiting_detail_kind, waiting_detail_class_id
) values
  (
    '95000000-0000-4000-8000-000000000540',
    '95000000-0000-4000-8000-000000000500',
    '영어', 'inquiry', '95000000-0000-4000-8000-000000000012',
    'manual', now(), null, false, 'waiting_current_class', 3, now(),
    'current_class', '95000000-0000-4000-8000-000000000020'
  ),
  (
    '95000000-0000-4000-8000-000000000541',
    '95000000-0000-4000-8000-000000000500',
    '수학', 'inquiry', '95000000-0000-4000-8000-000000000012',
    'manual', now(), null, false, 'enrollment_requested', 4, now(),
    null, null
  ),
  (
    '95000000-0000-4000-8000-000000000542',
    '95000000-0000-4000-8000-000000000500',
    '과학', 'enrollment_decided', '95000000-0000-4000-8000-000000000012',
    'manual', now(), null, false, 'inquiry', 5, now(),
    null, null
  );

insert into public.ops_registration_enrollments(
  id, track_id, class_id, status, sort_order
) values (
  '95000000-0000-4000-8000-000000000550',
  '95000000-0000-4000-8000-000000000540',
  '95000000-0000-4000-8000-000000000020',
  'planned',
  0
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, created_by
) values
  ('95000000-0000-4000-8000-000000000601', '95000000-0000-4000-8000-000000000500', 'level_test', clock_timestamp() + interval '1 day', '본관', 'scheduled', 2, '95000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000602', '95000000-0000-4000-8000-000000000500', 'visit_consultation', clock_timestamp() + interval '2 days', '별관', 'scheduled', 3, '95000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000603', '95000000-0000-4000-8000-000000000500', 'level_test', clock_timestamp() + interval '3 days', '본관', 'canceled', 1, '95000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000604', '95000000-0000-4000-8000-000000000500', 'level_test', clock_timestamp() - interval '1 day', '본관', 'scheduled', 1, '95000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000605', '95000000-0000-4000-8000-000000000500', 'level_test', clock_timestamp() + interval '4 days', '본관', 'scheduled', 1, '95000000-0000-4000-8000-000000000001');

insert into public.ops_registration_level_tests(
  id, track_id, appointment_id, attempt_number, status
) values
  ('95000000-0000-4000-8000-000000000611', '95000000-0000-4000-8000-000000000540', '95000000-0000-4000-8000-000000000601', 1, 'scheduled'),
  ('95000000-0000-4000-8000-000000000612', '95000000-0000-4000-8000-000000000541', '95000000-0000-4000-8000-000000000601', 1, 'scheduled'),
  ('95000000-0000-4000-8000-000000000613', '95000000-0000-4000-8000-000000000540', '95000000-0000-4000-8000-000000000603', 2, 'scheduled'),
  ('95000000-0000-4000-8000-000000000614', '95000000-0000-4000-8000-000000000540', '95000000-0000-4000-8000-000000000604', 3, 'scheduled');

insert into public.ops_registration_consultations(
  id, track_id, appointment_id, mode, status, director_profile_id
) values
  ('95000000-0000-4000-8000-000000000621', '95000000-0000-4000-8000-000000000540', '95000000-0000-4000-8000-000000000602', 'visit', 'scheduled', '95000000-0000-4000-8000-000000000012'),
  ('95000000-0000-4000-8000-000000000622', '95000000-0000-4000-8000-000000000542', '95000000-0000-4000-8000-000000000602', 'visit', 'scheduled', '95000000-0000-4000-8000-000000000012');

create function pg_temp.registration_solapi_contract(
  p_source jsonb,
  p_message_kind text,
  p_source_fingerprint text default repeat('a', 64)
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'parentPhoneDigits', p_source ->> 'parentPhoneDigits',
    'sourceFingerprint', p_source_fingerprint,
    'recipientHash', repeat('b', 64),
    'templateKey', p_message_kind,
    'templateRevision', 1,
    'templateChecksum', repeat('c', 64),
    'renderedVariablesChecksum', repeat('d', 64),
    'renderedBodyChecksum', repeat('e', 64),
    'renderedButtonsChecksum', repeat('f', 64)
  );
$$;

create temporary table registration_solapi_rpc_results (
  label text primary key,
  response jsonb not null
) on commit drop;
grant select, insert, update on table registration_solapi_rpc_results to service_role;

set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"95000000-0000-4000-8000-000000000001"}',
  true
);

insert into registration_solapi_rpc_results(label, response)
values
  ('level source', public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'level_test_booking', '95000000-0000-4000-8000-000000000601')),
  ('visit source', public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000011', 'visit_consultation_booking', '95000000-0000-4000-8000-000000000602')),
  ('reminder source', public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'appointment_reminder', '95000000-0000-4000-8000-000000000601')),
  ('waiting source', public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'waiting_notice', '95000000-0000-4000-8000-000000000540')),
  ('admission source', public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'admission_application', '95000000-0000-4000-8000-000000000500'));

reset role;

insert into registration_solapi_rpc_results(label, response)
values (
  'provider evidence seoul',
  dashboard_private.registration_customer_message_provider_evidence_v1(
    pg_catalog.jsonb_build_object(
      'statusCode', '202',
      'statusMessage', 'accepted',
      'observedAt', '2026-08-05T12:00:00+09:00',
      'requestKeyMatched', true
    )
  )
);

set local timezone = 'UTC';
set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'level source utc',
  public.resolve_registration_customer_message_source_v1(
    '95000000-0000-4000-8000-000000000001',
    'level_test_booking',
    '95000000-0000-4000-8000-000000000601'
  )
);
reset role;

insert into registration_solapi_rpc_results(label, response)
values (
  'provider evidence utc',
  dashboard_private.registration_customer_message_provider_evidence_v1(
    pg_catalog.jsonb_build_object(
      'statusCode', '202',
      'statusMessage', 'accepted',
      'observedAt', '2026-08-05T03:00:00+00:00',
      'requestKeyMatched', true
    )
  )
);

set local timezone = 'Asia/Seoul';

select is(
  (select response from registration_solapi_rpc_results where label = 'level source'),
  (select response from registration_solapi_rpc_results where label = 'level source utc'),
  'resolved appointment source is invariant across session time zones'
);

select is(
  dashboard_private.registration_customer_message_source_facts_checksum_v1(
    (select response from registration_solapi_rpc_results where label = 'level source')
  ),
  dashboard_private.registration_customer_message_source_facts_checksum_v1(
    (select response from registration_solapi_rpc_results where label = 'level source utc')
  ),
  'source facts checksum is invariant across session time zones'
);

select is(
  (select response from registration_solapi_rpc_results where label = 'provider evidence seoul'),
  (select response from registration_solapi_rpc_results where label = 'provider evidence utc'),
  'provider evidence canonicalization is invariant across session time zones'
);

select is(
  (select response ->> 'parentPhoneDigits' from registration_solapi_rpc_results where label = 'level source'),
  '01012345678',
  'valid level-test source resolves the normalized phone'
);
select is(
  (select response -> 'subjects' from registration_solapi_rpc_results where label = 'level source'),
  '["영어", "수학"]'::jsonb,
  'level-test source resolves only active participants in stable subject order'
);
select is(
  (select response -> 'subjects' from registration_solapi_rpc_results where label = 'visit source'),
  '["영어", "과학"]'::jsonb,
  'valid visit source resolves scheduled visit participants'
);
select is(
  (select response ->> 'appointmentKind' from registration_solapi_rpc_results where label = 'reminder source'),
  'level_test',
  'reminder source retains the canonical appointment kind'
);
select is(
  (select response ->> 'waitingClassName' from registration_solapi_rpc_results where label = 'waiting source'),
  '등록 SOLAPI 현재반',
  'valid waiting source resolves the saved current class'
);
select is(
  pg_catalog.jsonb_array_length((select response -> 'tracks' from registration_solapi_rpc_results where label = 'admission source')),
  3,
  'admission source includes workflow legacy and planned eligibility paths'
);

set local role service_role;
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'level_test_booking', '95000000-0000-4000-8000-000000000603')$$,
  '22023', 'registration_customer_message_source_invalid',
  'canceled appointment is rejected'
);
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'level_test_booking', '95000000-0000-4000-8000-000000000604')$$,
  '22023', 'registration_customer_message_source_invalid',
  'past appointment is rejected'
);
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'level_test_booking', '95000000-0000-4000-8000-000000000605')$$,
  '22023', 'registration_customer_message_source_invalid',
  'appointment without active participants is rejected'
);
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'admission_application', '95000000-0000-4000-8000-000000000502')$$,
  '22023', 'registration_customer_message_source_invalid',
  'invalid parent phone is rejected'
);
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'admission_application', '95000000-0000-4000-8000-000000000503')$$,
  '22023', 'registration_customer_message_source_invalid',
  'missing student name is rejected'
);
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'admission_application', '95000000-0000-4000-8000-000000000504')$$,
  '22023', 'registration_customer_message_source_invalid',
  'wrong task type is rejected'
);
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000013', 'waiting_notice', '95000000-0000-4000-8000-000000000540')$$,
  '42501', 'registration_customer_message_access_denied',
  'other actor cannot resolve an unrelated task'
);
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000012', 'waiting_notice', '95000000-0000-4000-8000-000000000540')$$,
  '42501', 'registration_customer_message_access_denied',
  'assigned teacher cannot create a send source'
);
reset role;

update public.ops_registration_subject_tracks
set pipeline_status = 'waiting', waiting_kind = 'next_term_opening'
where id = '95000000-0000-4000-8000-000000000540';
set local role service_role;
select throws_ok(
  $$select public.resolve_registration_customer_message_source_v1('95000000-0000-4000-8000-000000000001', 'waiting_notice', '95000000-0000-4000-8000-000000000540')$$,
  '22023', 'registration_customer_message_waiting_source_inconsistent',
  'inconsistent waiting detail and populated legacy waiting value are rejected'
);
reset role;
update public.ops_registration_subject_tracks
set pipeline_status = 'inquiry', waiting_kind = null
where id = '95000000-0000-4000-8000-000000000540';

-- Task 3 state-machine fixtures run only inside the synthetic verification scope.
insert into dashboard_private.registration_customer_solapi_template_receipts(
  message_kind, template_id, pf_id, catalog_checksum,
  provider_checksum, provider_status, verified_by
)
select
  activation.message_kind,
  'task3-template-' || activation.message_kind,
  'task3-pf',
  repeat('c', 64),
  repeat('c', 64),
  'sendable',
  '95000000-0000-4000-8000-000000000001'
from dashboard_private.registration_customer_solapi_activation activation;

update dashboard_private.registration_customer_solapi_activation
set mode = 'verification',
    verification_task_id = '95000000-0000-4000-8000-000000000500',
    verification_recipient_hash = repeat('b', 64),
    updated_by = '95000000-0000-4000-8000-000000000001';

set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'level participant stale preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001',
    'level_test_booking',
    '95000000-0000-4000-8000-000000000601',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'level source'),
      'level_test_booking',
      repeat('7', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'level participant stale claim',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'level participant stale preview') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000762',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'level source'),
      'level_test_booking',
      repeat('7', 64)
    )
  )
);
reset role;
update public.ops_registration_level_tests
set status = 'canceled',
    completed_at = pg_catalog.clock_timestamp()
where id = '95000000-0000-4000-8000-000000000611';
set local role service_role;
select throws_ok(
  $$select public.mark_registration_customer_message_attempt_started_v1(
      ((select response from registration_solapi_rpc_results where label = 'level participant stale claim') ->> 'messageId')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'level participant stale claim') ->> 'claimToken')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'level participant stale claim') ->> 'dispatchToken')::uuid,
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'level source'),
        'level_test_booking',
        repeat('7', 64)
      )
    )$$,
  '40001', 'registration_customer_message_preview_stale',
  'level-test participant status or subject fact change is stale'
);
reset role;
update public.ops_registration_level_tests
set status = 'scheduled',
    completed_at = null
where id = '95000000-0000-4000-8000-000000000611';

set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'visit participant stale preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001',
    'visit_consultation_booking',
    '95000000-0000-4000-8000-000000000602',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'visit source'),
      'visit_consultation_booking',
      repeat('8', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'visit participant stale claim',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'visit participant stale preview') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000761',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'visit source'),
      'visit_consultation_booking',
      repeat('8', 64)
    )
  )
);
reset role;
update public.ops_registration_consultations
set status = 'canceled'
where id = '95000000-0000-4000-8000-000000000622';
set local role service_role;
select throws_ok(
  $$select public.mark_registration_customer_message_attempt_started_v1(
      ((select response from registration_solapi_rpc_results where label = 'visit participant stale claim') ->> 'messageId')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'visit participant stale claim') ->> 'claimToken')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'visit participant stale claim') ->> 'dispatchToken')::uuid,
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'visit source'),
        'visit_consultation_booking',
        repeat('8', 64)
      )
    )$$,
  '40001', 'registration_customer_message_preview_stale',
  'visit participant status or subject fact change is stale'
);
reset role;
update public.ops_registration_consultations
set status = 'scheduled'
where id = '95000000-0000-4000-8000-000000000622';

set local role service_role;
select throws_ok(
  $$select public.create_registration_customer_message_preview_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      '95000000-0000-4000-8000-000000000540',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice'
      ) || '{"phone":"01012345678"}'::jsonb
    )$$,
  '22023', 'registration_customer_message_contract_invalid',
  'preview contract rejects unexpected keys'
);
select throws_ok(
  $$select public.create_registration_customer_message_preview_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      '95000000-0000-4000-8000-000000000540',
      null
    )$$,
  '22023', 'registration_customer_message_contract_invalid',
  'preview contract rejects SQL null explicitly'
);

insert into registration_solapi_rpc_results(label, response)
values
  (
    'waiting preview first',
    public.create_registration_customer_message_preview_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      '95000000-0000-4000-8000-000000000540',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice'
      )
    )
  ),
  (
    'waiting preview second',
    public.create_registration_customer_message_preview_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      '95000000-0000-4000-8000-000000000540',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice'
      )
    )
  ),
  (
    'staff owned preview',
    public.create_registration_customer_message_preview_v1(
      '95000000-0000-4000-8000-000000000011',
      'waiting_notice',
      '95000000-0000-4000-8000-000000000540',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice',
        repeat('1', 64)
      )
    )
  ),
  (
    'stale contract preview',
    public.create_registration_customer_message_preview_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      '95000000-0000-4000-8000-000000000540',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice',
        repeat('2', 64)
      )
    )
  ),
  (
    'expired preview',
    public.create_registration_customer_message_preview_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      '95000000-0000-4000-8000-000000000540',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice',
        repeat('3', 64)
      )
    )
  );

select throws_ok(
  $$select public.claim_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'staff owned preview') ->> 'previewId')::uuid,
      '95000000-0000-4000-8000-000000000701',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice', repeat('1', 64)
      )
    )$$,
  '42501', 'registration_customer_message_preview_owner_mismatch',
  'other actor cannot claim a preview'
);

select throws_ok(
  $$select public.claim_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'stale contract preview') ->> 'previewId')::uuid,
      '95000000-0000-4000-8000-000000000702',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice', repeat('4', 64)
      )
    )$$,
  '40001', 'registration_customer_message_preview_stale',
  'stale source fingerprint cannot consume a preview'
);
reset role;

update public.ops_registration_customer_message_previews
set created_at = statement_timestamp() - interval '16 minutes',
    expires_at = statement_timestamp() - interval '1 minute'
where id = ((select response from registration_solapi_rpc_results where label = 'expired preview') ->> 'previewId')::uuid;

set local role service_role;
select throws_ok(
  $$select public.claim_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'expired preview') ->> 'previewId')::uuid,
      '95000000-0000-4000-8000-000000000703',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice', repeat('3', 64)
      )
    )$$,
  '40001', 'registration_customer_message_preview_expired',
  'expired preview cannot be claimed'
);

insert into registration_solapi_rpc_results(label, response)
values (
  'waiting claim first',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'waiting preview first') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000710',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice'
    )
  )
);

insert into registration_solapi_rpc_results(label, response)
values (
  'waiting exact replay',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'waiting preview first') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000710',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice'
    )
  )
);

select throws_ok(
  $$select public.claim_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'waiting preview first') ->> 'previewId')::uuid,
      '95000000-0000-4000-8000-000000000711',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice'
      )
    )$$,
  '23505', 'registration_customer_message_preview_consumed',
  'consumed preview rejects a different request key'
);

select throws_ok(
  $$select public.claim_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'waiting preview second') ->> 'previewId')::uuid,
      '95000000-0000-4000-8000-000000000710',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice'
      )
    )$$,
  '23505', 'registration_customer_message_request_key_conflict',
  'request key conflict is detected before any consumed-preview detail leaks'
);

insert into registration_solapi_rpc_results(label, response)
values (
  'waiting duplicate claim',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'waiting preview second') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000712',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice'
    )
  )
);
reset role;

select is(
  (select response ->> 'messageId' from registration_solapi_rpc_results where label = 'waiting exact replay'),
  (select response ->> 'messageId' from registration_solapi_rpc_results where label = 'waiting claim first'),
  'exact replay returns the same masked message identity before consumed rejection'
);
select is(
  (select (response ->> 'owner')::boolean from registration_solapi_rpc_results where label = 'waiting duplicate claim'),
  false,
  'two previews produce only one permanent dedupe owner'
);
select is(
  (
    select count(*)
    from public.ops_registration_customer_messages
    where message_kind = 'waiting_notice'
      and source_fingerprint = repeat('a', 64)
      and recipient_hash = repeat('b', 64)
  ),
  1::bigint,
  'DB dedupe serializes identical facts to one outbox row'
);
select is(
  (
    select dedupe_key
    from public.ops_registration_customer_messages
    where id = ((select response from registration_solapi_rpc_results where label = 'waiting claim first') ->> 'messageId')::uuid
  ),
  dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'messageKind', 'waiting_notice',
        'sourceId', '95000000-0000-4000-8000-000000000540',
        'sourceFingerprint', repeat('a', 64),
        'recipientHash', repeat('b', 64)
      )
    )
  ),
  'DB computes dedupe from kind source fingerprint and recipient hash'
);

set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting released',
  public.release_registration_customer_message_pre_send_claim_v1(
    ((select response from registration_solapi_rpc_results where label = 'waiting claim first') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'waiting claim first') ->> 'claimToken')::uuid,
    'pre_send_render_failed'
  )
);

insert into registration_solapi_rpc_results(label, response)
values (
  'waiting reacquired',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'waiting preview first') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000710',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice'
    )
  )
);
reset role;

select isnt(
  (select response ->> 'claimToken' from registration_solapi_rpc_results where label = 'waiting reacquired'),
  (select response ->> 'claimToken' from registration_solapi_rpc_results where label = 'waiting claim first'),
  'pre-marker exact replay reacquires a new claim token'
);
select is(
  (select response ->> 'dispatchToken' from registration_solapi_rpc_results where label = 'waiting reacquired'),
  (select response ->> 'dispatchToken' from registration_solapi_rpc_results where label = 'waiting claim first'),
  'pre-marker replay preserves the one dispatch identity'
);

update public.classes
set name = '등록 SOLAPI 변경반'
where id = '95000000-0000-4000-8000-000000000020';
set local role service_role;
select throws_ok(
  $$select public.mark_registration_customer_message_attempt_started_v1(
      ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'messageId')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'claimToken')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'dispatchToken')::uuid,
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice'
      )
    )$$,
  '40001', 'registration_customer_message_preview_stale',
  'waiting class-name fact change is stale without a workflow revision change'
);
reset role;
update public.classes
set name = '등록 SOLAPI 현재반'
where id = '95000000-0000-4000-8000-000000000020';
set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting marker',
  public.mark_registration_customer_message_attempt_started_v1(
    ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'claimToken')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'dispatchToken')::uuid,
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice'
    )
  )
);

insert into registration_solapi_rpc_results(label, response)
values (
  'waiting marker replay',
  public.mark_registration_customer_message_attempt_started_v1(
    ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'claimToken')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'dispatchToken')::uuid,
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice'
    )
  )
);

insert into registration_solapi_rpc_results(label, response)
values (
  'waiting replay after marker',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'waiting preview first') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000710',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice'
    )
  )
);
reset role;

select is(
  (select (response ->> 'allowed')::boolean from registration_solapi_rpc_results where label = 'waiting marker'),
  true,
  'attempt marker authorizes one provider call only after commit'
);
select is(
  (select (response ->> 'allowed')::boolean from registration_solapi_rpc_results where label = 'waiting marker replay'),
  false,
  'attempt marker replay cannot authorize another provider call'
);
select is(
  (select response ->> 'currentStatus' from registration_solapi_rpc_results where label = 'waiting replay after marker'),
  'unknown',
  'pending attempt marker replay closes atomically to unknown'
);
select is(
  (select (response ->> 'owner')::boolean from registration_solapi_rpc_results where label = 'waiting replay after marker'),
  false,
  'marker recovery returns provider ownership false'
);
select is(
  (
    select resolution_source
    from public.ops_registration_customer_messages
    where id = ((select response from registration_solapi_rpc_results where label = 'waiting claim first') ->> 'messageId')::uuid
  ),
  'marker_recovery',
  'marker recovery records the conservative resolution source'
);

set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting finalized after recovery',
  public.finalize_registration_customer_message_v1(
    ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'waiting reacquired') ->> 'dispatchToken')::uuid,
    'accepted',
    pg_catalog.jsonb_build_object(
      'providerMessageId', 'provider-waiting-accepted',
      'statusCode', '202',
      'statusMessage', 'accepted',
      'observedAt', pg_catalog.clock_timestamp()::text,
      'requestKeyMatched', true
    )
  )
);
reset role;
select is(
  (select response ->> 'currentStatus' from registration_solapi_rpc_results where label = 'waiting finalized after recovery'),
  'accepted',
  'original dispatch finalization can correct marker-recovery unknown'
);

set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'admission preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001',
    'admission_application',
    '95000000-0000-4000-8000-000000000500',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'admission source'),
      'admission_application', repeat('5', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'admission claim',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'admission preview') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000720',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'admission source'),
      'admission_application', repeat('5', 64)
    )
  )
);
reset role;
update public.ops_registration_subject_tracks
set workflow_revision = workflow_revision + 1
where id = '95000000-0000-4000-8000-000000000541';
set local role service_role;
select throws_ok(
  $$select public.mark_registration_customer_message_attempt_started_v1(
      ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'messageId')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'claimToken')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'dispatchToken')::uuid,
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'admission source'),
        'admission_application', repeat('5', 64)
      )
    )$$,
  '40001', 'registration_customer_message_preview_stale',
  'admission track fact change is stale even when common revision is unchanged'
);
reset role;
update public.ops_registration_subject_tracks
set workflow_revision = workflow_revision - 1
where id = '95000000-0000-4000-8000-000000000541';
set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'admission marker',
  public.mark_registration_customer_message_attempt_started_v1(
    ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'claimToken')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'dispatchToken')::uuid,
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'admission source'),
      'admission_application', repeat('5', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'admission accepted',
  public.finalize_registration_customer_message_v1(
    ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'dispatchToken')::uuid,
    'accepted',
    pg_catalog.jsonb_build_object(
      'providerMessageId', 'provider-admission-accepted',
      'providerGroupId', 'group-admission-accepted',
      'statusCode', '202',
      'statusMessage', 'accepted',
      'observedAt', '2026-08-05T12:00:00+09:00',
      'requestKeyMatched', true
    )
  )
);
reset role;

set local timezone = 'UTC';
set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'admission accepted timezone replay',
  public.finalize_registration_customer_message_v1(
    ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'dispatchToken')::uuid,
    'accepted',
    pg_catalog.jsonb_build_object(
      'providerMessageId', 'provider-admission-accepted',
      'providerGroupId', 'group-admission-accepted',
      'statusCode', '202',
      'statusMessage', 'accepted',
      'observedAt', '2026-08-05T03:00:00+00:00',
      'requestKeyMatched', true
    )
  )
);
reset role;
set local timezone = 'Asia/Seoul';

select is(
  (select response - 'idempotent' from registration_solapi_rpc_results where label = 'admission accepted timezone replay'),
  (select response - 'idempotent' from registration_solapi_rpc_results where label = 'admission accepted'),
  'finalize replay is invariant across session time zones'
);
select is(
  (select (response ->> 'idempotent')::boolean from registration_solapi_rpc_results where label = 'admission accepted timezone replay'),
  true,
  'finalize exact replay reports idempotent'
);

select is(
  (select admission_notice_sent from public.ops_registration_details where task_id = '95000000-0000-4000-8000-000000000500'),
  true,
  'admission accepted atomically updates compatibility flag'
);
select is(
  (
    select count(*)
    from public.ops_task_events
    where task_id = '95000000-0000-4000-8000-000000000500'
      and event_type = 'customer_message_sent'
      and field_name = 'registration_customer_message:' || ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'messageId')
  ),
  1::bigint,
  'admission accepted writes one sanitized customer_message_sent event'
);
select unlike(
  (
    select after_value
    from public.ops_task_events
    where task_id = '95000000-0000-4000-8000-000000000500'
      and event_type = 'customer_message_sent'
      and field_name = 'registration_customer_message:' || ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'messageId')
  ),
  '%01012345678%',
  'admission audit event stores no full recipient phone'
);
select unlike(
  (
    select after_value
    from public.ops_task_events
    where task_id = '95000000-0000-4000-8000-000000000500'
      and event_type = 'customer_message_sent'
      and field_name = 'registration_customer_message:' || ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'messageId')
  ),
  '%provider-admission-accepted%',
  'admission audit event stores no provider evidence'
);

set local role service_role;
select throws_ok(
  $$select public.finalize_registration_customer_message_v1(
      ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'messageId')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'admission claim') ->> 'dispatchToken')::uuid,
      'accepted',
      pg_catalog.jsonb_build_object(
        'statusCode', '202', 'statusMessage', 'accepted',
        'observedAt', pg_catalog.clock_timestamp()::text,
        'requestKeyMatched', true, 'rawBody', 'forbidden'
      )
    )$$,
  '22023', 'registration_customer_message_provider_evidence_invalid',
  'provider evidence rejects raw or unexpected keys'
);
reset role;

-- Create explicit unknown and failed_hold finalization paths on independent facts.
set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'level preview unknown',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001', 'level_test_booking',
    '95000000-0000-4000-8000-000000000601',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'level source'),
      'level_test_booking', repeat('6', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'level claim unknown',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'level preview unknown') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000730',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'level source'),
      'level_test_booking', repeat('6', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'level marker unknown',
  public.mark_registration_customer_message_attempt_started_v1(
    ((select response from registration_solapi_rpc_results where label = 'level claim unknown') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'level claim unknown') ->> 'claimToken')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'level claim unknown') ->> 'dispatchToken')::uuid,
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'level source'),
      'level_test_booking', repeat('6', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'level finalized unknown',
  public.finalize_registration_customer_message_v1(
    ((select response from registration_solapi_rpc_results where label = 'level claim unknown') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'level claim unknown') ->> 'dispatchToken')::uuid,
    'unknown',
    pg_catalog.jsonb_build_object(
      'statusCode', 'timeout', 'statusMessage', 'lookup required',
      'observedAt', pg_catalog.clock_timestamp()::text,
      'requestKeyMatched', true
    )
  )
);

insert into registration_solapi_rpc_results(label, response)
values (
  'visit preview failed',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001', 'visit_consultation_booking',
    '95000000-0000-4000-8000-000000000602',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'visit source'),
      'visit_consultation_booking', repeat('7', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'visit claim failed',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'visit preview failed') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000731',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'visit source'),
      'visit_consultation_booking', repeat('7', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'visit marker failed',
  public.mark_registration_customer_message_attempt_started_v1(
    ((select response from registration_solapi_rpc_results where label = 'visit claim failed') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'visit claim failed') ->> 'claimToken')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'visit claim failed') ->> 'dispatchToken')::uuid,
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'visit source'),
      'visit_consultation_booking', repeat('7', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'visit finalized failed',
  public.finalize_registration_customer_message_v1(
    ((select response from registration_solapi_rpc_results where label = 'visit claim failed') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'visit claim failed') ->> 'dispatchToken')::uuid,
    'failed_hold',
    pg_catalog.jsonb_build_object(
      'statusCode', '400', 'statusMessage', 'rejected',
      'observedAt', pg_catalog.clock_timestamp()::text,
      'requestKeyMatched', true
    )
  )
);
reset role;

select is(
  (select response ->> 'currentStatus' from registration_solapi_rpc_results where label = 'level finalized unknown'),
  'unknown',
  'unprovable provider result finalizes to unknown'
);
select is(
  (select response ->> 'currentStatus' from registration_solapi_rpc_results where label = 'visit finalized failed'),
  'failed_hold',
  'explicit provider rejection finalizes to failed_hold'
);

set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'level terminal preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001', 'level_test_booking',
    '95000000-0000-4000-8000-000000000601',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'level source'),
      'level_test_booking', repeat('6', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'level terminal duplicate',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'level terminal preview') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000732',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'level source'),
      'level_test_booking', repeat('6', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'visit terminal preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001', 'visit_consultation_booking',
    '95000000-0000-4000-8000-000000000602',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'visit source'),
      'visit_consultation_booking', repeat('7', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'visit terminal duplicate',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'visit terminal preview') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000733',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'visit source'),
      'visit_consultation_booking', repeat('7', 64)
    )
  )
);
reset role;

select is(
  (select response ->> 'messageId' from registration_solapi_rpc_results where label = 'level terminal duplicate'),
  (select response ->> 'messageId' from registration_solapi_rpc_results where label = 'level claim unknown'),
  'unknown terminal state keeps the original dedupe row'
);
select is(
  (select (response ->> 'owner')::boolean from registration_solapi_rpc_results where label = 'level terminal duplicate'),
  false,
  'unknown terminal duplicate receives no provider-call ownership'
);
select is(
  (select response ->> 'messageId' from registration_solapi_rpc_results where label = 'visit terminal duplicate'),
  (select response ->> 'messageId' from registration_solapi_rpc_results where label = 'visit claim failed'),
  'failed_hold terminal state keeps the original dedupe row'
);
select is(
  (select (response ->> 'owner')::boolean from registration_solapi_rpc_results where label = 'visit terminal duplicate'),
  false,
  'failed_hold terminal duplicate receives no provider-call ownership'
);
select is(
  (
    select provider_attempt_count
    from public.ops_registration_customer_messages
    where id = ((select response from registration_solapi_rpc_results where label = 'level claim unknown') ->> 'messageId')::uuid
  ),
  1,
  'unknown terminal duplicate cannot increment the provider attempt count'
);
select is(
  (
    select provider_attempt_count
    from public.ops_registration_customer_messages
    where id = ((select response from registration_solapi_rpc_results where label = 'visit claim failed') ->> 'messageId')::uuid
  ),
  1,
  'failed_hold terminal duplicate cannot increment the provider attempt count'
);

-- Age the unknown attempt and confirm exact provider-check evidence can resolve it.
update public.ops_registration_customer_messages
set created_at = clock_timestamp() - interval '20 minutes',
    confirmed_at = clock_timestamp() - interval '20 minutes',
    provider_attempt_started_at = clock_timestamp() - interval '16 minutes'
where id = ((select response from registration_solapi_rpc_results where label = 'level claim unknown') ->> 'messageId')::uuid;

set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'level provider lookup context',
  public.record_registration_customer_message_provider_check_v1(
    '95000000-0000-4000-8000-000000000011',
    ((select response from registration_solapi_rpc_results where label = 'level claim unknown') ->> 'messageId')::uuid,
    'lookup_context',
    '{}'::jsonb,
    null
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'level provider checked',
  public.record_registration_customer_message_provider_check_v1(
    '95000000-0000-4000-8000-000000000011',
    ((select response from registration_solapi_rpc_results where label = 'level claim unknown') ->> 'messageId')::uuid,
    'accepted',
    pg_catalog.jsonb_build_object(
      'providerMessageId', 'provider-level-checked',
      'statusCode', '202', 'statusMessage', 'accepted on lookup',
      'observedAt', pg_catalog.clock_timestamp()::text,
      'requestKeyMatched', true
    ),
    '95000000-0000-4000-8000-000000000730'
  )
);
reset role;
select is(
  (select response ->> 'requestKey' from registration_solapi_rpc_results where label = 'level provider lookup context'),
  '95000000-0000-4000-8000-000000000730',
  'provider check server context returns the private original request key'
);
select is(
  (
    select response - array['messageId', 'providerMessageId', 'providerGroupId', 'requestKey']::text[]
    from registration_solapi_rpc_results
    where label = 'level provider lookup context'
  ),
  '{}'::jsonb,
  'provider check server context exposes no phone body hash or token fields'
);
select is(
  (select response ->> 'currentStatus' from registration_solapi_rpc_results where label = 'level provider checked'),
  'accepted',
  'provider check resolves an aged unknown with exact request evidence'
);

-- Admin-only expired pre-send release keeps the dedupe row and exact replay lane.
set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'admin release preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000011', 'waiting_notice',
    '95000000-0000-4000-8000-000000000540',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice', repeat('9', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'admin release claim',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000011',
    ((select response from registration_solapi_rpc_results where label = 'admin release preview') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000740',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice', repeat('9', 64)
    )
  )
);
reset role;

update public.ops_registration_customer_messages
set created_at = clock_timestamp() - interval '10 minutes',
    confirmed_at = clock_timestamp() - interval '10 minutes',
    claim_expires_at = clock_timestamp() - interval '1 minute'
where id = ((select response from registration_solapi_rpc_results where label = 'admin release claim') ->> 'messageId')::uuid;

set local role service_role;
select throws_ok(
  $$select public.mark_registration_customer_message_attempt_started_v1(
      ((select response from registration_solapi_rpc_results where label = 'admin release claim') ->> 'messageId')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'admin release claim') ->> 'claimToken')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'admin release claim') ->> 'dispatchToken')::uuid,
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice', repeat('9', 64)
      )
    )$$,
  '40001', 'registration_customer_message_claim_invalid',
  'an expired claim cannot commit the provider attempt marker'
);
select throws_ok(
  $$select public.release_registration_customer_message_pre_send_claim_admin_v1(
      '95000000-0000-4000-8000-000000000011',
      ((select response from registration_solapi_rpc_results where label = 'admin release claim') ->> 'messageId')::uuid,
      'staff may not release another claim',
      '95000000-0000-4000-8000-000000000741'
    )$$,
  '42501', 'registration_customer_message_admin_required',
  'staff cannot perform admin pre-send release'
);

insert into registration_solapi_rpc_results(label, response)
values (
  'admin released expired claim',
  public.release_registration_customer_message_pre_send_claim_admin_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'admin release claim') ->> 'messageId')::uuid,
    'expired worker claim',
    '95000000-0000-4000-8000-000000000742'
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'admin release replay',
  public.release_registration_customer_message_pre_send_claim_admin_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'admin release claim') ->> 'messageId')::uuid,
    'expired worker claim',
    '95000000-0000-4000-8000-000000000742'
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'admin release reacquired',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000011',
    ((select response from registration_solapi_rpc_results where label = 'admin release preview') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000740',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice', repeat('9', 64)
    )
  )
);
select throws_ok(
  $$select public.release_registration_customer_message_pre_send_claim_admin_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'admin release claim') ->> 'messageId')::uuid,
      'different reason',
      '95000000-0000-4000-8000-000000000742'
    )$$,
  '23505', 'registration_customer_message_mutation_conflict',
  'admin release action key cannot be reused with a different reason'
);
reset role;

select is(
  (select response from registration_solapi_rpc_results where label = 'admin release replay'),
  (select response from registration_solapi_rpc_results where label = 'admin released expired claim'),
  'admin release action request key replays exactly'
);
select is(
  (select (response ->> 'owner')::boolean from registration_solapi_rpc_results where label = 'admin release reacquired'),
  true,
  'only pending count zero without a marker can reacquire after admin release'
);

-- Manual reconcile is admin-only, terminal-only, and action-key idempotent.
set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'reminder preview reconcile',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001', 'appointment_reminder',
    '95000000-0000-4000-8000-000000000601',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'reminder source'),
      'appointment_reminder', repeat('8', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'reminder claim reconcile',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'reminder preview reconcile') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000750',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'reminder source'),
      'appointment_reminder', repeat('8', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'reminder marker reconcile',
  public.mark_registration_customer_message_attempt_started_v1(
    ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'claimToken')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'dispatchToken')::uuid,
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'reminder source'),
      'appointment_reminder', repeat('8', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'reminder unknown reconcile',
  public.finalize_registration_customer_message_v1(
    ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'dispatchToken')::uuid,
    'unknown',
    pg_catalog.jsonb_build_object(
      'statusCode', 'timeout', 'statusMessage', 'lookup required',
      'observedAt', pg_catalog.clock_timestamp()::text,
      'requestKeyMatched', true
    )
  )
);
select throws_ok(
  $$select public.reconcile_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'messageId')::uuid,
      'failed_hold',
      pg_catalog.jsonb_build_object(
        'statusCode', '404', 'statusMessage', 'not accepted',
        'observedAt', pg_catalog.clock_timestamp()::text,
        'requestKeyMatched', true
      ),
      'provider dashboard reviewed',
      '95000000-0000-4000-8000-000000000742'
    )$$,
  '23505', 'registration_customer_message_mutation_conflict',
  'admin action request key cannot cross from release to reconcile'
);
select throws_ok(
  $$select public.reconcile_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000011',
      ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'messageId')::uuid,
      'failed_hold',
      pg_catalog.jsonb_build_object(
        'statusCode', '404', 'statusMessage', 'not accepted',
        'observedAt', pg_catalog.clock_timestamp()::text,
        'requestKeyMatched', true
      ),
      'provider dashboard reviewed',
      '95000000-0000-4000-8000-000000000751'
    )$$,
  '42501', 'registration_customer_message_admin_required',
  'staff cannot reconcile a provider result'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'reminder reconciled',
  public.reconcile_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'messageId')::uuid,
    'failed_hold',
    pg_catalog.jsonb_build_object(
      'statusCode', '404', 'statusMessage', 'not accepted',
      'observedAt', '2026-08-05T12:00:00+09:00',
      'requestKeyMatched', true
    ),
    'provider dashboard reviewed',
    '95000000-0000-4000-8000-000000000752'
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'reminder reconcile replay',
  public.reconcile_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'messageId')::uuid,
    'failed_hold',
    pg_catalog.jsonb_build_object(
      'statusCode', '404', 'statusMessage', 'not accepted',
      'observedAt', '2026-08-05T12:00:00+09:00',
      'requestKeyMatched', true
    ),
    'provider dashboard reviewed',
    '95000000-0000-4000-8000-000000000752'
  )
);
select throws_ok(
  $$select public.reconcile_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'reminder claim reconcile') ->> 'messageId')::uuid,
      'accepted',
      pg_catalog.jsonb_build_object(
        'statusCode', '202', 'statusMessage', 'accepted',
        'observedAt', '2026-08-05T12:00:00+09:00',
        'requestKeyMatched', true
      ),
      'conflicting action',
      '95000000-0000-4000-8000-000000000752'
    )$$,
  '23505', 'registration_customer_message_mutation_conflict',
  'reconcile action request key cannot target a different resolution'
);
reset role;

select is(
  (select response from registration_solapi_rpc_results where label = 'reminder reconcile replay'),
  (select response from registration_solapi_rpc_results where label = 'reminder reconciled'),
  'admin reconcile exact action replay returns the same masked result'
);

-- A terminal row permanently keeps its dedupe across a fresh preview.
set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting terminal preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice',
    '95000000-0000-4000-8000-000000000540',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice'
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting terminal duplicate',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'waiting terminal preview') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000760',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice'
    )
  )
);

insert into registration_solapi_rpc_results(label, response)
values
  (
    'staff waiting history',
    public.list_registration_customer_messages_v1(
      '95000000-0000-4000-8000-000000000011', 'waiting_notice',
      '95000000-0000-4000-8000-000000000540', 20
    )
  ),
  (
    'teacher waiting history',
    public.list_registration_customer_messages_v1(
      '95000000-0000-4000-8000-000000000012', 'waiting_notice',
      '95000000-0000-4000-8000-000000000540', 20
    )
  );
select throws_ok(
  $$select public.list_registration_customer_messages_v1(
      '95000000-0000-4000-8000-000000000013', 'waiting_notice',
      '95000000-0000-4000-8000-000000000540', 20
    )$$,
  '42501', 'registration_customer_message_access_denied',
  'unrelated teacher cannot list task message history'
);
reset role;

select is(
  (select (response ->> 'owner')::boolean from registration_solapi_rpc_results where label = 'waiting terminal duplicate'),
  false,
  'accepted terminal state permanently locks the same dedupe'
);
select ok(
  ((select response -> 0 from registration_solapi_rpc_results where label = 'staff waiting history') ? 'recipientLast4'),
  'admin and staff history includes only masked last4 recipient evidence'
);
select ok(
  not ((select response -> 0 from registration_solapi_rpc_results where label = 'teacher waiting history') ? 'recipientLast4'),
  'assigned teacher history omits the recipientLast4 key entirely'
);
select unlike(
  (select response::text from registration_solapi_rpc_results where label = 'teacher waiting history'),
  '%recipientHash%',
  'teacher history contains no recipient hash'
);
select unlike(
  (select response::text from registration_solapi_rpc_results where label = 'teacher waiting history'),
  '%providerEvidence%',
  'teacher history contains no provider evidence'
);
select unlike(
  (select response::text from registration_solapi_rpc_results where label = 'teacher waiting history'),
  '%confirmedBy%',
  'teacher history contains no confirmer identity'
);

-- Task 4 template receipt, activation, readiness, and delivery-gate contract.
select has_function('public', 'record_registration_customer_solapi_template_receipt_v1', array['uuid', 'text', 'jsonb']);
select has_function('public', 'set_registration_customer_solapi_activation_v1', array['uuid', 'text', 'text', 'jsonb']);
select has_function('public', 'record_registration_customer_solapi_live_test_receipt_v1', array['uuid', 'text', 'uuid', 'timestamp with time zone', 'text']);
select has_function('public', 'get_registration_customer_solapi_readiness_v1', array['uuid', 'text', 'uuid', 'jsonb']);
select has_function('public', 'registration_customer_solapi_runtime_version', array[]::text[]);

select function_privs_are('public', 'record_registration_customer_solapi_template_receipt_v1', array['uuid', 'text', 'jsonb'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'set_registration_customer_solapi_activation_v1', array['uuid', 'text', 'text', 'jsonb'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'record_registration_customer_solapi_live_test_receipt_v1', array['uuid', 'text', 'uuid', 'timestamp with time zone', 'text'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'get_registration_customer_solapi_readiness_v1', array['uuid', 'text', 'uuid', 'jsonb'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'registration_customer_solapi_runtime_version', array[]::text[], 'authenticated', array['EXECUTE']);
select function_privs_are('public', 'registration_customer_solapi_runtime_version', array[]::text[], 'service_role', array['EXECUTE']);

select is_empty($$
  select routine_name, grantee
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in (
      'record_registration_customer_solapi_template_receipt_v1',
      'set_registration_customer_solapi_activation_v1',
      'record_registration_customer_solapi_live_test_receipt_v1',
      'get_registration_customer_solapi_readiness_v1'
    )
    and grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type = 'EXECUTE'
$$, 'activation RPCs are service-role-only and runtime marker is exact');

select is(
  public.registration_customer_solapi_runtime_version(),
  1,
  'runtime marker returns the exact activation contract version'
);

update dashboard_private.registration_customer_solapi_activation
set mode = 'off',
    verification_task_id = null,
    verification_recipient_hash = null,
    live_test_message_id = null,
    live_test_confirmed_at = null,
    updated_by = null;
delete from dashboard_private.registration_customer_solapi_template_receipts;

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, waiting_kind,
  migration_review_required, workflow_status, workflow_revision,
  workflow_status_entered_at, waiting_detail_kind, waiting_detail_class_id
) values (
  '95000000-0000-4000-8000-000000000543',
  '95000000-0000-4000-8000-000000000501',
  '과학', 'inquiry', null,
  null, null, null,
  false, 'waiting_next_opening', 1,
  pg_catalog.clock_timestamp(), 'next_term_opening', null
);

set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'other waiting source',
  public.resolve_registration_customer_message_source_v1(
    '95000000-0000-4000-8000-000000000011',
    'waiting_notice',
    '95000000-0000-4000-8000-000000000543'
  )
);
reset role;

create function pg_temp.registration_solapi_readiness_contract(
  p_source jsonb,
  p_recipient_hash text,
  p_source_fingerprint text default repeat('9', 64),
  p_credentials_configured boolean default true,
  p_pf_id text default 'pf-waiting',
  p_template_id text default 'template-waiting',
  p_catalog_checksum text default repeat('c', 64)
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'credentialsConfigured', p_credentials_configured,
    'pfId', p_pf_id,
    'templateId', p_template_id,
    'catalogChecksum', p_catalog_checksum,
    'recipientHash', p_recipient_hash,
    'sourceFingerprint', p_source_fingerprint,
    'sourceFactsChecksum',
      dashboard_private.registration_customer_message_source_facts_checksum_v1(p_source)
  );
$$;
grant execute on function pg_temp.registration_solapi_readiness_contract(jsonb, text, text, boolean, text, text, text)
  to service_role;

set local role service_role;
select throws_ok(
  $$select public.record_registration_customer_solapi_template_receipt_v1(
      '95000000-0000-4000-8000-000000000011',
      'waiting_notice',
      pg_catalog.jsonb_build_object(
        'templateId', 'template-waiting', 'pfId', 'pf-waiting',
        'catalogChecksum', repeat('c', 64),
        'providerChecksum', repeat('c', 64), 'providerStatus', 'sendable'
      )
    )$$,
  '42501', 'registration_customer_message_admin_required',
  'staff cannot record a template receipt'
);
select throws_ok(
  $$select public.record_registration_customer_solapi_template_receipt_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      pg_catalog.jsonb_build_object(
        'templateId', 'template-waiting', 'pfId', 'pf-waiting',
        'catalogChecksum', repeat('c', 64),
        'providerChecksum', repeat('d', 64), 'providerStatus', 'sendable'
      )
    )$$,
  '22023', 'registration_customer_solapi_template_receipt_invalid',
  'template receipt rejects drifted or unexpected evidence'
);
select throws_ok(
  $$select public.record_registration_customer_solapi_template_receipt_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      pg_catalog.jsonb_build_object(
        'templateId', 'template-waiting', 'pfId', 'pf-waiting',
        'catalogChecksum', repeat('c', 64),
        'providerChecksum', repeat('c', 64), 'providerStatus', 'sendable',
        'rawBody', 'forbidden'
      )
    )$$,
  '22023', 'registration_customer_solapi_template_receipt_invalid',
  'template receipt rejects unexpected provider keys'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting template receipt',
  public.record_registration_customer_solapi_template_receipt_v1(
    '95000000-0000-4000-8000-000000000001',
    'waiting_notice',
    pg_catalog.jsonb_build_object(
      'templateId', 'template-waiting', 'pfId', 'pf-waiting',
      'catalogChecksum', repeat('c', 64),
      'providerChecksum', repeat('c', 64), 'providerStatus', 'sendable'
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting readiness off',
  public.get_registration_customer_solapi_readiness_v1(
    '95000000-0000-4000-8000-000000000011',
    'waiting_notice',
    '95000000-0000-4000-8000-000000000540',
    pg_temp.registration_solapi_readiness_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      repeat('b', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting readiness missing env',
  public.get_registration_customer_solapi_readiness_v1(
    '95000000-0000-4000-8000-000000000011',
    'waiting_notice',
    '95000000-0000-4000-8000-000000000540',
    pg_temp.registration_solapi_readiness_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      repeat('b', 64), repeat('9', 64), false, null, null, repeat('c', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting readiness drift',
  public.get_registration_customer_solapi_readiness_v1(
    '95000000-0000-4000-8000-000000000011',
    'waiting_notice',
    '95000000-0000-4000-8000-000000000540',
    pg_temp.registration_solapi_readiness_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      repeat('b', 64), repeat('9', 64), true,
      'pf-waiting', 'template-drifted', repeat('c', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting readiness dirty',
  public.get_registration_customer_solapi_readiness_v1(
    '95000000-0000-4000-8000-000000000011',
    'waiting_notice',
    '95000000-0000-4000-8000-000000000540',
    pg_catalog.jsonb_set(
      pg_temp.registration_solapi_readiness_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        repeat('b', 64)
      ),
      array['sourceFactsChecksum']::text[],
      pg_catalog.to_jsonb(repeat('8', 64)),
      false
    )
  )
);
select throws_ok(
  $$select public.record_registration_customer_solapi_live_test_receipt_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      ((select response from registration_solapi_rpc_results where label = 'waiting finalized after recovery') ->> 'messageId')::uuid,
      pg_catalog.clock_timestamp(),
      '95000000-0000-4000-8000-000000000800'
    )$$,
  '40001', 'registration_customer_solapi_live_test_not_allowed',
  'live-test receipt is allowed only during verification'
);
select throws_ok(
  $$select public.set_registration_customer_solapi_activation_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice', 'live',
      pg_catalog.jsonb_build_object(
        'requestKey', '95000000-0000-4000-8000-000000000801',
        'templateId', 'template-waiting', 'pfId', 'pf-waiting',
        'catalogChecksum', repeat('c', 64)
      )
    )$$,
  '40001', 'registration_customer_solapi_activation_transition_invalid',
  'activation transition cannot skip verification'
);
select throws_ok(
  $$select public.set_registration_customer_solapi_activation_v1(
      '95000000-0000-4000-8000-000000000011',
      'waiting_notice', 'verification',
      pg_catalog.jsonb_build_object(
        'requestKey', '95000000-0000-4000-8000-000000000802',
        'verificationTaskId', '95000000-0000-4000-8000-000000000500',
        'verificationRecipientHash', repeat('b', 64),
        'templateId', 'template-waiting', 'pfId', 'pf-waiting',
        'catalogChecksum', repeat('c', 64)
      )
    )$$,
  '42501', 'registration_customer_message_admin_required',
  'staff cannot change customer SOLAPI activation'
);

insert into registration_solapi_rpc_results(label, response)
values (
  'off claim preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001',
    'waiting_notice',
    '95000000-0000-4000-8000-000000000540',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice', repeat('4', 64)
    )
  )
);
select throws_ok(
  $$select public.claim_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'off claim preview') ->> 'previewId')::uuid,
      '95000000-0000-4000-8000-000000000900',
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice', repeat('4', 64)
      )
    )$$,
  '40001', 'registration_customer_solapi_activation_off',
  'activation off blocks outbox claim'
);
reset role;

select ok(
  (select (response ->> 'templateVerified')::boolean from registration_solapi_rpc_results where label = 'waiting template receipt'),
  'matching sendable receipt is recorded without provider body storage'
);
select ok(
  (select response -> 'blockers' from registration_solapi_rpc_results where label = 'waiting readiness off')
    @> '["activation_off"]'::jsonb,
  'off readiness returns independent safe blockers without private identifiers'
);
select ok(
  (select response -> 'blockers' from registration_solapi_rpc_results where label = 'waiting readiness missing env')
    @> '["credentials_missing", "pf_missing", "template_missing"]'::jsonb,
  'readiness reports credential PF and template configuration independently'
);
select ok(
  (select response -> 'blockers' from registration_solapi_rpc_results where label = 'waiting readiness drift')
    @> '["template_drift"]'::jsonb,
  'readiness distinguishes a drifted receipt from no receipt'
);
select ok(
  (select response -> 'blockers' from registration_solapi_rpc_results where label = 'waiting readiness dirty')
    @> '["source_dirty"]'::jsonb,
  'readiness detects source facts changed after server rendering'
);
select unlike(
  (select response::text from registration_solapi_rpc_results where label = 'waiting readiness off'),
  '%verificationTaskId%',
  'public readiness omits verification task identifiers'
);
select unlike(
  (select response::text from registration_solapi_rpc_results where label = 'waiting readiness off'),
  '%recipientHash%',
  'public readiness omits recipient hashes'
);
select unlike(
  (select response::text from registration_solapi_rpc_results where label = 'waiting readiness off'),
  '%template-waiting%',
  'public readiness omits template and PF identifiers'
);

set local role service_role;
insert into registration_solapi_rpc_results(label, response)
values (
  'level template receipt',
  public.record_registration_customer_solapi_template_receipt_v1(
    '95000000-0000-4000-8000-000000000001',
    'level_test_booking',
    pg_catalog.jsonb_build_object(
      'templateId', 'template-level', 'pfId', 'pf-level',
      'catalogChecksum', repeat('c', 64),
      'providerChecksum', repeat('c', 64), 'providerStatus', 'sendable'
    )
  )
);
select throws_ok(
  $$select public.set_registration_customer_solapi_activation_v1(
      '95000000-0000-4000-8000-000000000001',
      'level_test_booking', 'verification',
      pg_catalog.jsonb_build_object(
        'requestKey', '95000000-0000-4000-8000-000000000809',
        'verificationTaskId', '95000000-0000-4000-8000-000000000500',
        'verificationRecipientHash', repeat('b', 64),
        'templateId', 'template-level-drift', 'pfId', 'pf-level',
        'catalogChecksum', repeat('c', 64)
      )
    )$$,
  '40001', 'registration_customer_solapi_template_drift',
  'verification requires the current template receipt'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'level verification',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001',
    'level_test_booking', 'verification',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000810',
      'verificationTaskId', '95000000-0000-4000-8000-000000000500',
      'verificationRecipientHash', repeat('b', 64),
      'templateId', 'template-level', 'pfId', 'pf-level',
      'catalogChecksum', repeat('c', 64)
    )
  )
);
select throws_ok(
  $$select public.set_registration_customer_solapi_activation_v1(
      '95000000-0000-4000-8000-000000000001',
      'level_test_booking', 'live',
      pg_catalog.jsonb_build_object(
        'requestKey', '95000000-0000-4000-8000-000000000811',
        'templateId', 'template-level', 'pfId', 'pf-level',
        'catalogChecksum', repeat('c', 64)
      )
    )$$,
  '40001', 'registration_customer_solapi_live_evidence_missing',
  'live transition requires accepted user-confirmed evidence'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'level off',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001',
    'level_test_booking', 'off',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000812'
    )
  )
);

insert into registration_solapi_rpc_results(label, response)
values (
  'waiting verification marker gate',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001',
    'waiting_notice', 'verification',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000820',
      'verificationTaskId', '95000000-0000-4000-8000-000000000500',
      'verificationRecipientHash', repeat('b', 64),
      'templateId', 'template-waiting', 'pfId', 'pf-waiting',
      'catalogChecksum', repeat('c', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'verification mismatch preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001',
    'waiting_notice',
    '95000000-0000-4000-8000-000000000543',
    pg_catalog.jsonb_set(
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'other waiting source'),
        'waiting_notice', repeat('5', 64)
      ),
      array['recipientHash']::text[],
      pg_catalog.to_jsonb(repeat('9', 64)),
      false
    )
  )
);
select throws_ok(
  $$select public.claim_registration_customer_message_v1(
      '95000000-0000-4000-8000-000000000001',
      ((select response from registration_solapi_rpc_results where label = 'verification mismatch preview') ->> 'previewId')::uuid,
      '95000000-0000-4000-8000-000000000901',
      pg_catalog.jsonb_set(
        pg_temp.registration_solapi_contract(
          (select response from registration_solapi_rpc_results where label = 'other waiting source'),
          'waiting_notice', repeat('5', 64)
        ),
        array['recipientHash']::text[],
        pg_catalog.to_jsonb(repeat('9', 64)),
        false
      )
    )$$,
  '40001', 'registration_customer_solapi_verification_scope_mismatch',
  'verification scope mismatch blocks outbox claim'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'marker gate preview',
  public.create_registration_customer_message_preview_v1(
    '95000000-0000-4000-8000-000000000001',
    'waiting_notice',
    '95000000-0000-4000-8000-000000000540',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice', repeat('6', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'marker gate claim',
  public.claim_registration_customer_message_v1(
    '95000000-0000-4000-8000-000000000001',
    ((select response from registration_solapi_rpc_results where label = 'marker gate preview') ->> 'previewId')::uuid,
    '95000000-0000-4000-8000-000000000902',
    pg_temp.registration_solapi_contract(
      (select response from registration_solapi_rpc_results where label = 'waiting source'),
      'waiting_notice', repeat('6', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting off before marker',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001',
    'waiting_notice', 'off',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000821'
    )
  )
);
select throws_ok(
  $$select public.mark_registration_customer_message_attempt_started_v1(
      ((select response from registration_solapi_rpc_results where label = 'marker gate claim') ->> 'messageId')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'marker gate claim') ->> 'claimToken')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'marker gate claim') ->> 'dispatchToken')::uuid,
      pg_temp.registration_solapi_contract(
        (select response from registration_solapi_rpc_results where label = 'waiting source'),
        'waiting_notice', repeat('6', 64)
      )
    )$$,
  '40001', 'registration_customer_solapi_activation_off',
  'activation off blocks provider attempt marker'
);

insert into registration_solapi_rpc_results(label, response)
values (
  'waiting verification wrong task',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001',
    'waiting_notice', 'verification',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000822',
      'verificationTaskId', '95000000-0000-4000-8000-000000000501',
      'verificationRecipientHash', repeat('9', 64),
      'templateId', 'template-waiting', 'pfId', 'pf-waiting',
      'catalogChecksum', repeat('c', 64)
    )
  )
);
select throws_ok(
  $$select public.record_registration_customer_solapi_live_test_receipt_v1(
      '95000000-0000-4000-8000-000000000001', 'waiting_notice',
      ((select response from registration_solapi_rpc_results where label = 'waiting finalized after recovery') ->> 'messageId')::uuid,
      pg_catalog.clock_timestamp(),
      '95000000-0000-4000-8000-000000000830'
    )$$,
  '40001', 'registration_customer_solapi_live_test_evidence_mismatch',
  'accepted evidence must match kind task recipient and current receipt'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting off after wrong task',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'off',
    pg_catalog.jsonb_build_object('requestKey', '95000000-0000-4000-8000-000000000823')
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting verification wrong hash',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'verification',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000824',
      'verificationTaskId', '95000000-0000-4000-8000-000000000500',
      'verificationRecipientHash', repeat('a', 64),
      'templateId', 'template-waiting', 'pfId', 'pf-waiting',
      'catalogChecksum', repeat('c', 64)
    )
  )
);
select throws_ok(
  $$select public.record_registration_customer_solapi_live_test_receipt_v1(
      '95000000-0000-4000-8000-000000000001', 'waiting_notice',
      ((select response from registration_solapi_rpc_results where label = 'waiting finalized after recovery') ->> 'messageId')::uuid,
      pg_catalog.clock_timestamp(),
      '95000000-0000-4000-8000-000000000831'
    )$$,
  '40001', 'registration_customer_solapi_live_test_evidence_mismatch',
  'accepted evidence with another recipient hash is rejected'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting off after wrong hash',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'off',
    pg_catalog.jsonb_build_object('requestKey', '95000000-0000-4000-8000-000000000825')
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting verification final',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'verification',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000826',
      'verificationTaskId', '95000000-0000-4000-8000-000000000500',
      'verificationRecipientHash', repeat('b', 64),
      'templateId', 'template-waiting', 'pfId', 'pf-waiting',
      'catalogChecksum', repeat('c', 64)
    )
  )
);
select throws_ok(
  $$select public.record_registration_customer_solapi_live_test_receipt_v1(
      '95000000-0000-4000-8000-000000000001', 'waiting_notice',
      ((select response from registration_solapi_rpc_results where label = 'admission accepted') ->> 'messageId')::uuid,
      pg_catalog.clock_timestamp(),
      '95000000-0000-4000-8000-000000000832'
    )$$,
  '40001', 'registration_customer_solapi_live_test_evidence_mismatch',
  'accepted evidence of another message kind is rejected'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting live receipt',
  public.record_registration_customer_solapi_live_test_receipt_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice',
    ((select response from registration_solapi_rpc_results where label = 'waiting finalized after recovery') ->> 'messageId')::uuid,
    pg_catalog.clock_timestamp(),
    '95000000-0000-4000-8000-000000000833'
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting live receipt replay',
  public.record_registration_customer_solapi_live_test_receipt_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice',
    ((select response from registration_solapi_rpc_results where label = 'waiting finalized after recovery') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'waiting live receipt') ->> 'receivedAt')::timestamptz,
    '95000000-0000-4000-8000-000000000833'
  )
);
select throws_ok(
  $$select public.record_registration_customer_solapi_live_test_receipt_v1(
      '95000000-0000-4000-8000-000000000001', 'waiting_notice',
      ((select response from registration_solapi_rpc_results where label = 'waiting finalized after recovery') ->> 'messageId')::uuid,
      ((select response from registration_solapi_rpc_results where label = 'waiting live receipt') ->> 'receivedAt')::timestamptz,
      '95000000-0000-4000-8000-000000000834'
    )$$,
  '23505', 'registration_customer_solapi_live_test_receipt_conflict',
  'a second request key cannot replace retained live-test evidence'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting live',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'live',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000840',
      'templateId', 'template-waiting', 'pfId', 'pf-waiting',
      'catalogChecksum', repeat('c', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting live replay',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'live',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000840',
      'templateId', 'template-waiting', 'pfId', 'pf-waiting',
      'catalogChecksum', repeat('c', 64)
    )
  )
);
select throws_ok(
  $$select public.set_registration_customer_solapi_activation_v1(
      '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'off',
      pg_catalog.jsonb_build_object('requestKey', '95000000-0000-4000-8000-000000000840')
    )$$,
  '23505', 'registration_customer_message_mutation_conflict',
  'activation action request keys replay exactly and conflict safely'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'other waiting readiness live',
  public.get_registration_customer_solapi_readiness_v1(
    '95000000-0000-4000-8000-000000000011',
    'waiting_notice',
    '95000000-0000-4000-8000-000000000543',
    pg_temp.registration_solapi_readiness_contract(
      (select response from registration_solapi_rpc_results where label = 'other waiting source'),
      repeat('9', 64)
    )
  )
);
select throws_ok(
  $$select public.record_registration_customer_solapi_template_receipt_v1(
      '95000000-0000-4000-8000-000000000001',
      'waiting_notice',
      pg_catalog.jsonb_build_object(
        'templateId', 'template-waiting-replaced', 'pfId', 'pf-waiting',
        'catalogChecksum', repeat('d', 64),
        'providerChecksum', repeat('d', 64), 'providerStatus', 'sendable'
      )
    )$$,
  '40001', 'registration_customer_solapi_receipt_change_requires_off',
  'an active receipt cannot be replaced behind verification evidence'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting off retained',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'off',
    pg_catalog.jsonb_build_object('requestKey', '95000000-0000-4000-8000-000000000841')
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting live receipt replay after off',
  public.record_registration_customer_solapi_live_test_receipt_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice',
    ((select response from registration_solapi_rpc_results where label = 'waiting finalized after recovery') ->> 'messageId')::uuid,
    ((select response from registration_solapi_rpc_results where label = 'waiting live receipt') ->> 'receivedAt')::timestamptz,
    '95000000-0000-4000-8000-000000000833'
  )
);
reset role;

select is(
  (select response from registration_solapi_rpc_results where label = 'waiting live receipt replay'),
  (select response from registration_solapi_rpc_results where label = 'waiting live receipt'),
  'live-test receipt request key replays exactly'
);
select is(
  (select response from registration_solapi_rpc_results where label = 'waiting live receipt replay after off'),
  (select response from registration_solapi_rpc_results where label = 'waiting live receipt'),
  'live-test receipt request key replays exactly after activation changes'
);
select is(
  (select response from registration_solapi_rpc_results where label = 'waiting live replay'),
  (select response from registration_solapi_rpc_results where label = 'waiting live'),
  'activation request key exact replay returns the same public result'
);
select ok(
  (select (response ->> 'sendAllowed')::boolean from registration_solapi_rpc_results where label = 'other waiting readiness live'),
  'live readiness allows a clean source without exposing private evidence'
);
select is(
  (
    select mode
    from dashboard_private.registration_customer_solapi_activation
    where message_kind = 'waiting_notice'
  ),
  'off',
  'off transition disables delivery'
);
select ok(
  (
    select live_test_message_id is not null and live_test_confirmed_at is not null
    from dashboard_private.registration_customer_solapi_activation
    where message_kind = 'waiting_notice'
  ),
  'off retains accepted live-test evidence without authorizing sends'
);

set local role service_role;
select throws_ok(
  $$select public.set_registration_customer_solapi_activation_v1(
      '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'verification',
      pg_catalog.jsonb_build_object(
        'requestKey', '95000000-0000-4000-8000-000000000842',
        'verificationTaskId', '95000000-0000-4000-8000-000000000500',
        'templateId', 'template-waiting', 'pfId', 'pf-waiting',
        'catalogChecksum', repeat('c', 64)
      )
    )$$,
  '22023', 'registration_customer_solapi_activation_evidence_invalid',
  're-entering verification requires an explicit task and current recipient hash'
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting verification retained evidence',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'verification',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000843',
      'verificationTaskId', '95000000-0000-4000-8000-000000000500',
      'verificationRecipientHash', repeat('b', 64),
      'templateId', 'template-waiting', 'pfId', 'pf-waiting',
      'catalogChecksum', repeat('c', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting live retained evidence',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'live',
    pg_catalog.jsonb_build_object(
      'requestKey', '95000000-0000-4000-8000-000000000844',
      'templateId', 'template-waiting', 'pfId', 'pf-waiting',
      'catalogChecksum', repeat('c', 64)
    )
  )
);
insert into registration_solapi_rpc_results(label, response)
values (
  'waiting final off',
  public.set_registration_customer_solapi_activation_v1(
    '95000000-0000-4000-8000-000000000001', 'waiting_notice', 'off',
    pg_catalog.jsonb_build_object('requestKey', '95000000-0000-4000-8000-000000000845')
  )
);
reset role;

select * from finish();

rollback;
