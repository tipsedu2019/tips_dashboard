begin;
set local search_path = extensions, public;
select no_plan();
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_function('public', 'read_registration_customer_message_delivery_context_v1', array['uuid', 'uuid']);
select function_privs_are('public', 'read_registration_customer_message_delivery_context_v1', array['uuid', 'uuid'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'read_registration_customer_message_delivery_context_v1', array['uuid', 'uuid'], 'authenticated', array[]::text[]);
select function_privs_are('public', 'read_registration_customer_message_delivery_context_v1', array['uuid', 'uuid'], 'anon', array[]::text[]);
select is((select provolatile::text from pg_proc where oid = 'public.read_registration_customer_message_delivery_context_v1(uuid,uuid)'::regprocedure), 's', 'lookup function cannot mutate data');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  email, crypt('delivery-lookup-fixture-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values
  ('95160000-0000-4000-8000-000000000001'::uuid, 'lookup-admin@example.invalid'),
  ('95160000-0000-4000-8000-000000000002'::uuid, 'lookup-staff@example.invalid'),
  ('95160000-0000-4000-8000-000000000003'::uuid, 'lookup-teacher@example.invalid')
) fixture(id, email);

insert into public.profiles(id, role, name, email)
values ('95160000-0000-4000-8000-000000000001', 'admin', 'Lookup fixture admin', 'lookup-admin@example.invalid'),
       ('95160000-0000-4000-8000-000000000002', 'staff', 'Lookup fixture staff', 'lookup-staff@example.invalid'),
       ('95160000-0000-4000-8000-000000000003', 'teacher', 'Lookup fixture teacher', 'lookup-teacher@example.invalid')
on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email;
insert into public.ops_tasks(id, title, type, status, priority, requested_by, student_name)
values ('95160000-0000-4000-8000-000000000010', 'Lookup fixture', 'registration', 'requested', 'normal', '95160000-0000-4000-8000-000000000001', '합성 학생');
insert into public.ops_registration_customer_message_previews(
 id, task_id, message_kind, source_fingerprint, source_facts_checksum, recipient_hash,
 recipient_last4, template_key, template_revision, template_checksum,
 rendered_variables_checksum, rendered_body_checksum, rendered_buttons_checksum, created_by
) values (
 '95160000-0000-4000-8000-000000000020', '95160000-0000-4000-8000-000000000010',
 'admission_application', repeat('a',64), repeat('b',64), repeat('c',64),
 '1234', 'admission_application', 1, repeat('d',64), repeat('e',64), repeat('f',64), repeat('a',64),
 '95160000-0000-4000-8000-000000000001'
);
-- Seed an already accepted historical receipt, without activating any provider.
-- Restore the send gate before exercising the lookup.
alter table public.ops_registration_customer_messages disable trigger enforce_registration_customer_solapi_delivery_gate_v1;
insert into public.ops_registration_customer_messages(
 id, preview_id, task_id, message_kind, source_fingerprint, source_facts_checksum, recipient_hash,
 recipient_last4, template_key, template_revision, template_checksum,
 rendered_variables_checksum, rendered_body_checksum, rendered_buttons_checksum,
 dedupe_key, request_key, status, dispatch_token, provider_attempt_started_at,
 provider_attempt_count, provider_message_id, provider_group_id, confirmed_by, resolution_source, resolved_at
) values (
 '95160000-0000-4000-8000-000000000030', '95160000-0000-4000-8000-000000000020',
 '95160000-0000-4000-8000-000000000010', 'admission_application',
 repeat('a',64), repeat('b',64), repeat('c',64), '1234', 'admission_application', 1,
 repeat('d',64), repeat('e',64), repeat('f',64), repeat('a',64), repeat('b',64),
 '95160000-0000-4000-8000-000000000040', 'accepted', '95160000-0000-4000-8000-000000000050',
 now(), 1, 'fixture-provider-message', 'fixture-provider-group', '95160000-0000-4000-8000-000000000001', 'provider_send', now()
);
alter table public.ops_registration_customer_messages enable trigger enforce_registration_customer_solapi_delivery_gate_v1;
select ok((select tgenabled = 'O' from pg_trigger where tgrelid = 'public.ops_registration_customer_messages'::regclass and tgname = 'enforce_registration_customer_solapi_delivery_gate_v1'), 'provider gate is enabled during every lookup assertion');
create temporary table lookup_before as select to_jsonb(m) as body from public.ops_registration_customer_messages m where m.id = '95160000-0000-4000-8000-000000000030';
select set_config('request.jwt.claim.role', 'service_role', true);
select is(public.read_registration_customer_message_delivery_context_v1(
 '95160000-0000-4000-8000-000000000001', '95160000-0000-4000-8000-000000000030'),
 '{"providerMessageId":"fixture-provider-message","providerGroupId":"fixture-provider-group","requestKey":"95160000-0000-4000-8000-000000000040"}'::jsonb,
 'admin reads only provider lookup identities, with no customer content');
select lives_ok($$ select public.read_registration_customer_message_delivery_context_v1('95160000-0000-4000-8000-000000000002', '95160000-0000-4000-8000-000000000030') $$, 'staff can inspect accepted receipt');
select is((select to_jsonb(m) from public.ops_registration_customer_messages m where m.id = '95160000-0000-4000-8000-000000000030'), (select body from lookup_before), 'lookup preserves every outbox field including attempt and dedupe locks');
select throws_ok($$ select public.read_registration_customer_message_delivery_context_v1('95160000-0000-4000-8000-000000000003', '95160000-0000-4000-8000-000000000030') $$, '42501', 'registration_customer_message_access_denied', 'teacher cannot retrieve provider identities');
select throws_ok($$ select public.read_registration_customer_message_delivery_context_v1(null, '95160000-0000-4000-8000-000000000030') $$, '42501', 'registration_customer_message_access_denied', 'missing actor fails closed');
select throws_ok($$ select public.read_registration_customer_message_delivery_context_v1('95160000-0000-4000-8000-000000000001', '95160000-0000-4000-8000-000000000099') $$, 'P0002', 'registration_customer_message_not_found', 'missing receipt is distinguished from provider failure');
update public.ops_registration_customer_messages set status = 'unknown' where id = '95160000-0000-4000-8000-000000000030';
select throws_ok($$ select public.read_registration_customer_message_delivery_context_v1('95160000-0000-4000-8000-000000000001', '95160000-0000-4000-8000-000000000030') $$, '23514', 'registration_customer_message_delivery_check_not_allowed', 'ambiguous attempts retain the existing reconciliation path');
update public.ops_registration_customer_messages set status = 'accepted', provider_message_id = null where id = '95160000-0000-4000-8000-000000000030';
select throws_ok($$ select public.read_registration_customer_message_delivery_context_v1('95160000-0000-4000-8000-000000000001', '95160000-0000-4000-8000-000000000030') $$, '23514', 'registration_customer_message_delivery_check_not_allowed', 'missing provider identity never causes a guessed lookup');
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($$ select public.read_registration_customer_message_delivery_context_v1('95160000-0000-4000-8000-000000000001', '95160000-0000-4000-8000-000000000030') $$, '42501', 'registration_customer_message_access_denied', 'actor id alone cannot bypass service boundary');
select * from finish();
rollback;
