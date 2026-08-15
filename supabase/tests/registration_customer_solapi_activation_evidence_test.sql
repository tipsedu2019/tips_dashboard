begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select has_table(
  'dashboard_private',
  'registration_customer_solapi_activation_evidence',
  'private immutable activation evidence exists'
);
select has_column(
  'dashboard_private',
  'registration_customer_solapi_activation',
  'activation_evidence_id',
  'activation points to immutable evidence'
);
select hasnt_column(
  'dashboard_private',
  'registration_customer_solapi_activation',
  'live_test_message_id',
  'activation no longer points to a disposable message'
);
select hasnt_column(
  'dashboard_private',
  'registration_customer_solapi_activation',
  'live_test_confirmed_at',
  'activation no longer stores disposable receipt state'
);
select has_column(
  'public',
  'ops_registration_customer_messages',
  'provider_payload_checksum',
  'accepted messages bind the exact provider payload checksum'
);
select has_function(
  'dashboard_private',
  'registration_customer_solapi_live_evidence_valid_v1',
  array['text', 'text', 'text', 'text'],
  'one private helper owns live evidence checks'
);
select has_function(
  'public',
  'finalize_registration_customer_message_v1',
  array['uuid', 'uuid', 'text', 'jsonb', 'text'],
  'finalize requires a provider payload checksum'
);
select hasnt_function(
  'public',
  'finalize_registration_customer_message_v1',
  array['uuid', 'uuid', 'text', 'jsonb'],
  'checksum-free finalize was removed'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid =
      'dashboard_private.registration_customer_solapi_activation'::pg_catalog.regclass
      and attribute.attname in ('live_test_message_id', 'live_test_confirmed_at')
      and not attribute.attisdropped
  ),
  'no live gate can recover a dropped disposable column'
);
select ok(
  not has_table_privilege(
    'service_role',
    'dashboard_private.registration_customer_solapi_activation_evidence',
    'select'
  ),
  'service role cannot read private activation evidence directly'
);
select ok(
  not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
    'appointment_reminder', 'template-evidence', 'pf-evidence', repeat('a', 64)
  ),
  'off mode is fail closed without live evidence'
);

insert into dashboard_private.registration_customer_solapi_activation_evidence(
  id,
  message_kind,
  template_id,
  pf_id,
  template_checksum,
  rendered_variables_checksum,
  rendered_body_checksum,
  rendered_buttons_checksum,
  provider_payload_checksum,
  recipient_hash,
  provider_message_id,
  provider_status_code,
  verified_at,
  verified_by
) values (
  'e1000000-0000-4000-8000-000000000001',
  'appointment_reminder',
  'template-evidence',
  'pf-evidence',
  repeat('a', 64),
  repeat('b', 64),
  repeat('c', 64),
  repeat('d', 64),
  repeat('e', 64),
  repeat('f', 64),
  'provider-evidence-message',
  '4000',
  pg_catalog.clock_timestamp(),
  '96000000-0000-4000-8000-000000000001'
);

update dashboard_private.registration_customer_solapi_activation activation
set mode = 'live',
    verification_task_id = null,
    verification_recipient_hash = null,
    activation_evidence_id = 'e1000000-0000-4000-8000-000000000001',
    updated_by = '96000000-0000-4000-8000-000000000001'
where activation.message_kind = 'appointment_reminder';

select ok(
  dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
    'appointment_reminder', 'template-evidence', 'pf-evidence', repeat('a', 64)
  ),
  'live mode accepts the immutable matching evidence'
);
select ok(
  not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
    'appointment_reminder', 'changed-template', 'pf-evidence', repeat('a', 64)
  ),
  'template drift fails closed'
);
select is(
  (
    select count(*)::integer
    from public.ops_registration_customer_messages message
    where message.provider_message_id = 'provider-evidence-message'
  ),
  0,
  'live authorization does not require a public test message row'
);

update dashboard_private.registration_customer_solapi_activation activation
set mode = 'off',
    activation_evidence_id = 'e1000000-0000-4000-8000-000000000001',
    updated_by = '96000000-0000-4000-8000-000000000001'
where activation.message_kind = 'appointment_reminder';

select ok(
  not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
    'appointment_reminder', 'template-evidence', 'pf-evidence', repeat('a', 64)
  )
  and exists (
    select 1
    from dashboard_private.registration_customer_solapi_activation_evidence evidence
    where evidence.id = 'e1000000-0000-4000-8000-000000000001'
  ),
  'off disables delivery while retaining immutable audit evidence'
);

select * from finish();
rollback;
