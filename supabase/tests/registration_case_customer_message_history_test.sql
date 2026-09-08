begin;
set local role postgres;
set local search_path = extensions, public;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local statement_timeout = '60s';
set local lock_timeout = '5s';

select function_privs_are('public', 'list_registration_case_customer_messages_v1', array['uuid','uuid','integer','integer'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'list_registration_case_customer_messages_v1', array['uuid','uuid','integer','integer'], 'authenticated', array[]::text[]);
select function_privs_are('public', 'list_registration_case_customer_messages_v1', array['uuid','uuid','integer','integer'], 'anon', array[]::text[]);
select function_privs_are('public', 'get_registration_customer_guidance_settings_v1', array['uuid'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'get_registration_customer_guidance_settings_v1', array['uuid'], 'authenticated', array[]::text[]);
select function_privs_are('public', 'get_registration_customer_guidance_settings_v1', array['uuid'], 'anon', array[]::text[]);
select is((select provolatile::text from pg_proc where oid = 'public.list_registration_case_customer_messages_v1(uuid,uuid,integer,integer)'::regprocedure), 's', 'case history SQL is read-only');
select is((select provolatile::text from pg_proc where oid = 'public.get_registration_customer_guidance_settings_v1(uuid)'::regprocedure), 's', 'settings SQL is read-only');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  email, crypt('case-history-fixture-only', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now()
from (values
  ('9ac20000-0000-4000-8000-000000000001'::uuid, 'case-history-admin@example.invalid'),
  ('9ac20000-0000-4000-8000-000000000002'::uuid, 'case-history-staff@example.invalid'),
  ('9ac20000-0000-4000-8000-000000000003'::uuid, 'case-history-teacher@example.invalid')
) fixture(id, email);
insert into public.profiles(id, role, name, email)
values ('9ac20000-0000-4000-8000-000000000001', 'admin', '이력 담당자', 'case-history-admin@example.invalid'),
  ('9ac20000-0000-4000-8000-000000000002', 'staff', '이력 직원', 'case-history-staff@example.invalid'),
  ('9ac20000-0000-4000-8000-000000000003', 'teacher', '이력 교사', 'case-history-teacher@example.invalid')
on conflict (id) do update set role = excluded.role, name = excluded.name;
insert into public.ops_tasks(id, title, type, status, priority, requested_by, student_name, completed_at)
values ('9ac20000-0000-4000-8000-000000000010', '취소된 이력 검증', 'registration', 'canceled', 'normal', '9ac20000-0000-4000-8000-000000000001', '취소 합성 학생', null),
  ('9ac20000-0000-4000-8000-000000000011', '종료된 이력 검증', 'registration', 'done', 'normal', '9ac20000-0000-4000-8000-000000000001', '종료 합성 학생', now()),
  ('9ac20000-0000-4000-8000-000000000012', '등록이 아닌 할 일', 'general', 'requested', 'normal', '9ac20000-0000-4000-8000-000000000001', null, null);
insert into public.ops_registration_appointments(id, task_id, kind, scheduled_at, place, status)
values ('9ac20000-0000-4000-8000-000000000100', '9ac20000-0000-4000-8000-000000000010', 'visit_consultation', now() - interval '10 days', '이전 상담실', 'canceled');

create temporary table case_history_receipts on commit drop as
select index, ('9ac20000-0000-4000-8000-' || lpad((1000 + index)::text,12,'0'))::uuid as preview_id,
  ('9ac20000-0000-4000-8000-' || lpad((2000 + index)::text,12,'0'))::uuid as message_id,
  case when index = 22 then '9ac20000-0000-4000-8000-000000000011'::uuid
    else '9ac20000-0000-4000-8000-000000000010'::uuid end as task_id,
  case when index = 22 then 'admission_application' else 'visit_consultation_booking' end as message_kind,
  case when index <> 22 then '9ac20000-0000-4000-8000-000000000100'::uuid end as appointment_id
from generate_series(1,22) index;
insert into public.ops_registration_customer_message_previews(id, task_id, appointment_id, message_kind, source_revision,
  source_fingerprint, source_facts_checksum, recipient_hash, recipient_last4, template_key, template_revision,
  template_checksum, rendered_variables_checksum, rendered_body_checksum, rendered_buttons_checksum, created_by)
select preview_id, task_id, appointment_id, message_kind, index, repeat('a',64), repeat('b',64), repeat('c',64),
  '1234', message_kind, 1, repeat('d',64), repeat('e',64), repeat('f',64), repeat('a',64),
  '9ac20000-0000-4000-8000-000000000001' from case_history_receipts;

-- Insert historical receipts only; restore the delivery gate before any read.
alter table public.ops_registration_customer_messages disable trigger enforce_registration_customer_solapi_delivery_gate_v1;
insert into public.ops_registration_customer_messages(id, preview_id, task_id, appointment_id, message_kind, source_revision,
  source_fingerprint, source_facts_checksum, recipient_hash, recipient_last4, template_key, template_revision,
  template_checksum, rendered_variables_checksum, rendered_body_checksum, rendered_buttons_checksum,
  dedupe_key, request_key, status, dispatch_token, provider_attempt_started_at, provider_attempt_count,
  provider_message_id, provider_group_id, confirmed_by, confirmed_at, resolution_source, resolved_at, created_at, updated_at)
select message_id, preview_id, task_id, appointment_id, message_kind, index,
  repeat('a',64), repeat('b',64), repeat('c',64), '1234', message_kind, 1,
  repeat('d',64), repeat('e',64), repeat('f',64), repeat('a',64),
  md5(index::text) || md5(index::text), 'case-history-request-' || index,
  case when index = 2 then 'unknown' when index = 3 then 'pending' else 'accepted' end,
  ('9ac20000-0000-4000-8000-' || lpad((3000 + index)::text,12,'0'))::uuid,
  case when index <> 3 then now() - interval '30 minutes' end, case when index = 3 then 0 else 1 end,
  case when index <> 4 then 'provider-message-secret-' || index end, 'provider-group-secret',
  '9ac20000-0000-4000-8000-000000000001', now() - interval '1 day',
  case when index <> 3 then 'provider_send' end, case when index <> 3 then now() end,
  now() - interval '2 days' + index * interval '1 minute', now()
from case_history_receipts;
alter table public.ops_registration_customer_messages enable trigger enforce_registration_customer_solapi_delivery_gate_v1;

create temporary table case_history_before on commit drop as select
  (select jsonb_agg(to_jsonb(message) order by message.id) from public.ops_registration_customer_messages message) as messages,
  (select count(*) from public.ops_registration_customer_message_previews) as previews,
  (select count(*) from dashboard_private.notification_events) as events,
  (select jsonb_agg(to_jsonb(activation) order by activation.message_kind) from dashboard_private.registration_customer_solapi_activation activation) as activation;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001', '9ac20000-0000-4000-8000-000000000010',1,10) ->> 'totalCount', '21', 'canceled case history includes old appointment revisions');
select is(jsonb_array_length(public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001', '9ac20000-0000-4000-8000-000000000010',1,10) -> 'history'), 10, 'default-sized page is bounded to ten');
select is(jsonb_array_length(public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001', '9ac20000-0000-4000-8000-000000000010',1,15) -> 'history'), 15, 'fifteen-row page is supported');
select is(jsonb_array_length(public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001', '9ac20000-0000-4000-8000-000000000010',1,20) -> 'history'), 20, 'twenty-row page is supported');
select is(public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000002', '9ac20000-0000-4000-8000-000000000010',3,10) #>> '{history,0,messageKind}', 'visit_consultation_booking', 'staff can retrieve the canceled historical appointment on the final page');
select is(public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001', '9ac20000-0000-4000-8000-000000000010',4,10) -> 'history', '[]'::jsonb, 'an out-of-range page is empty without losing totalCount');
select is(public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001', '9ac20000-0000-4000-8000-000000000011',1,10) ->> 'totalCount', '1', 'completed case remains readable and other case receipts do not leak');

create temporary table case_history_result on commit drop as
select value as item from jsonb_array_elements(public.list_registration_case_customer_messages_v1(
  '9ac20000-0000-4000-8000-000000000001', '9ac20000-0000-4000-8000-000000000010',1,20) -> 'history');
select ok(not exists(select 1 from case_history_result where item - array[
  'messageId','messageKind','currentStatus','confirmedByName','confirmedAt','updatedAt','recipientLast4','canCheck','canCheckDelivery'] <> '{}'::jsonb),
  'response contains only approved public metadata');
select ok((select jsonb_agg(item)::text not like '%provider-%secret%' from case_history_result), 'provider identities are not exposed');
select is((select item ->> 'canCheck' from case_history_result where item ->> 'currentStatus' = 'unknown'), 'true', 'an old ambiguous attempt can use existing result reconciliation');
select is((select item ->> 'canCheck' from case_history_result where item ->> 'currentStatus' = 'pending'), 'false', 'a queued message without an attempt cannot be reconciled');
select is((select item ->> 'canCheckDelivery' from case_history_result where item ->> 'messageId' = '9ac20000-0000-4000-8000-000000002004'), 'false', 'accepted message without provider identity is not represented as queryable');

select throws_ok($$select public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000003','9ac20000-0000-4000-8000-000000000010',1,10)$$,
  '42501', 'registration_customer_message_access_denied', 'teachers cannot read full case receipt histories');
select throws_ok($$select public.list_registration_case_customer_messages_v1(null,'9ac20000-0000-4000-8000-000000000010',1,10)$$,
  '42501', 'registration_customer_message_access_denied', 'missing actor fails closed');
select throws_ok($$select public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001','9ac20000-0000-4000-8000-000000000012',1,10)$$,
  '42501', 'registration_customer_message_access_denied', 'non-registration tasks are not a case history source');
select throws_ok($$select public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001','9ac20000-0000-4000-8000-000000000099',1,10)$$,
  '42501', 'registration_customer_message_access_denied', 'missing case is not a successful empty history');
select throws_ok($$select public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001','9ac20000-0000-4000-8000-000000000010',0,10)$$,
  '22023', 'registration_customer_message_history_page_invalid', 'zero page rejected');
select throws_ok($$select public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001','9ac20000-0000-4000-8000-000000000010',1,100)$$,
  '22023', 'registration_customer_message_history_page_invalid', 'unbounded page size rejected');

select is(jsonb_array_length(public.get_registration_customer_guidance_settings_v1('9ac20000-0000-4000-8000-000000000001')), 5, 'settings contain exactly the current five customer guidance kinds');
select lives_ok($$select public.get_registration_customer_guidance_settings_v1('9ac20000-0000-4000-8000-000000000002')$$, 'staff can inspect settings without activation rights');
select ok(not exists(select 1 from jsonb_array_elements(public.get_registration_customer_guidance_settings_v1('9ac20000-0000-4000-8000-000000000001')) item
  where item - array['messageKind','mode','templateVerifiedAt'] <> '{}'::jsonb), 'settings omit template/provider secrets');
select ok(not exists(select 1 from jsonb_array_elements(public.get_registration_customer_guidance_settings_v1('9ac20000-0000-4000-8000-000000000001')) item
  where item ->> 'messageKind' like '%reminder%' or item ->> 'messageKind' like '%bundle%'), 'retired automatic and bundle types do not become settings');
select throws_ok($$select public.get_registration_customer_guidance_settings_v1('9ac20000-0000-4000-8000-000000000003')$$,
  '42501', 'registration_customer_message_access_denied', 'teacher cannot inspect customer guidance configuration');

update auth.users set banned_until = now() + interval '1 day'
where id = '9ac20000-0000-4000-8000-000000000002';
select throws_ok($$select public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000002','9ac20000-0000-4000-8000-000000000010',1,10)$$,
  '42501', 'registration_customer_message_access_denied', 'banned manager cannot read case histories through the service RPC');
select throws_ok($$select public.get_registration_customer_guidance_settings_v1('9ac20000-0000-4000-8000-000000000002')$$,
  '42501', 'registration_customer_message_access_denied', 'banned manager cannot read customer guidance settings');
update auth.users set banned_until = null, deleted_at = now()
where id = '9ac20000-0000-4000-8000-000000000002';
select throws_ok($$select public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000002','9ac20000-0000-4000-8000-000000000010',1,10)$$,
  '42501', 'registration_customer_message_access_denied', 'deleted manager cannot read case histories through the service RPC');
select throws_ok($$select public.get_registration_customer_guidance_settings_v1('9ac20000-0000-4000-8000-000000000002')$$,
  '42501', 'registration_customer_message_access_denied', 'deleted manager cannot read customer guidance settings');
update auth.users set deleted_at = null
where id = '9ac20000-0000-4000-8000-000000000002';

select is((select jsonb_agg(to_jsonb(message) order by message.id) from public.ops_registration_customer_messages message), (select messages from case_history_before), 'history/settings reads preserve every outbox field and send lock');
select is((select count(*) from public.ops_registration_customer_message_previews), (select previews from case_history_before), 'no preview is created');
select is((select count(*) from dashboard_private.notification_events), (select events from case_history_before), 'no staff notification event is created');
select is((select jsonb_agg(to_jsonb(activation) order by activation.message_kind) from dashboard_private.registration_customer_solapi_activation activation), (select activation from case_history_before), 'settings reads never activate a customer message type');
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($$select public.list_registration_case_customer_messages_v1('9ac20000-0000-4000-8000-000000000001','9ac20000-0000-4000-8000-000000000010',1,10)$$,
  '42501', 'registration_customer_message_access_denied', 'actor ID cannot bypass service boundary');
select throws_ok($$select public.get_registration_customer_guidance_settings_v1('9ac20000-0000-4000-8000-000000000001')$$,
  '42501', 'registration_customer_message_access_denied', 'settings RPC remains service-only');
select * from finish();
rollback;
