begin;
select plan(25);

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
      ('public', 'ops_registration_customer_message_previews', 'source_revision', 'int8', 'YES'),
      ('public', 'ops_registration_customer_message_previews', 'recipient_last4', 'text', 'NO'),
      ('public', 'ops_registration_customer_messages', 'preview_id', 'uuid', 'NO'),
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
      id, task_id, message_kind, source_fingerprint, recipient_hash,
      recipient_last4, template_key, template_revision, template_checksum,
      rendered_variables_checksum, rendered_body_checksum,
      rendered_buttons_checksum, created_by
    ) values (
      '95000000-0000-4000-8000-000000000101',
      '95000000-0000-4000-8000-000000000002',
      'admission_application',
      repeat('a', 64),
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
      id, task_id, message_kind, source_fingerprint, recipient_hash,
      recipient_last4, template_key, template_revision, template_checksum,
      rendered_variables_checksum, rendered_body_checksum,
      rendered_buttons_checksum, created_by
    ) values (
      '95000000-0000-4000-8000-000000000102',
      '95000000-0000-4000-8000-000000000002',
      'admission_application',
      'not-a-checksum',
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
      id, task_id, message_kind, source_fingerprint, recipient_hash,
      recipient_last4, template_key, template_revision, template_checksum,
      rendered_variables_checksum, rendered_body_checksum,
      rendered_buttons_checksum, created_by
    ) values (
      '95000000-0000-4000-8000-000000000103',
      '95000000-0000-4000-8000-000000000002',
      'level_test_booking',
      repeat('a', 64),
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
  id, task_id, message_kind, source_fingerprint, recipient_hash,
  recipient_last4, template_key, template_revision, template_checksum,
  rendered_variables_checksum, rendered_body_checksum,
  rendered_buttons_checksum, created_by
) values (
  '95000000-0000-4000-8000-000000000110',
  '95000000-0000-4000-8000-000000000002',
  'admission_application',
  repeat('a', 64),
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
      id, preview_id, task_id, message_kind, source_fingerprint,
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
      id, preview_id, task_id, message_kind, source_fingerprint,
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
      id, preview_id, task_id, message_kind, source_fingerprint,
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

rollback;
