begin;
set local role postgres;
set local search_path = extensions, public;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated, service_role;
grant execute on all functions in schema extensions to authenticated, service_role;
select no_plan();
set local statement_timeout = '60s';
set local lock_timeout = '5s';

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('9ac10000-0000-4000-8000-000000000100', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'visit-cancel-admin@example.invalid',
   crypt('fixture-only', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now()),
  ('9ac10000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'visit-cancel-teacher@example.invalid',
   crypt('fixture-only', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now()),
  ('9ac10000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'visit-cancel-staff@example.invalid',
   crypt('fixture-only', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now());
insert into public.profiles(id, role, name, email)
values ('9ac10000-0000-4000-8000-000000000100', 'admin', '취소 검증 관리자', 'visit-cancel-admin@example.invalid'),
  ('9ac10000-0000-4000-8000-000000000101', 'teacher', '취소 검증 교사', 'visit-cancel-teacher@example.invalid'),
  ('9ac10000-0000-4000-8000-000000000102', 'staff', '취소 검증 직원', 'visit-cancel-staff@example.invalid')
on conflict (id) do update set role = excluded.role, name = excluded.name;
insert into public.academic_subject_settings(subject, is_active, registration_create_enabled, grade_levels, sort_order)
values ('영어', true, true, array['중1'], 10)
on conflict (subject) do update set is_active = true, registration_create_enabled = true, grade_levels = array['중1'];

create function pg_temp.cancel_actor(p_role text, p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', p_role)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
end;
$$;
create temporary table cancel_fixture(key text primary key, data jsonb not null) on commit drop;
grant select, insert, update on cancel_fixture to authenticated, service_role;

select ok(not has_function_privilege('anon', 'public.list_registration_visit_cancellations_v1(uuid,integer,integer)', 'execute'), 'anonymous cannot read cancellation history');
select ok(not has_function_privilege('service_role', 'public.ensure_registration_visit_cancellation_v1(uuid,integer,uuid,text,uuid)', 'execute'), 'service role cannot impersonate an explicit cancellation request');
select ok(not has_function_privilege('authenticated', 'dashboard_private.registration_visit_cancellation_preview_v1(uuid)', 'execute'), 'internal frozen snapshots are private');

set local role authenticated;
select pg_temp.cancel_actor('authenticated', '9ac10000-0000-4000-8000-000000000100');
insert into cancel_fixture values ('case', public.create_registration_case(
  '취소 검증 학생', '중1', '검증중', '01099990000', null,
  '본관', now(), array['영어'], '취소 검증', 'normal', 'visit-cancel-case'));
insert into cancel_fixture
select 'booking', public.save_registration_appointment_details_v1(null, (data ->> 'taskId')::uuid,
  'visit_consultation', now() + interval '10 days', '최초 전달 장소',
  array[(data #>> '{tracks,0,id}')::uuid], null, 'visit-cancel-booking')
from cancel_fixture where key = 'case';

select is((public.list_registration_visit_cancellations_v1((select (data ->> 'taskId')::uuid from cancel_fixture where key = 'case'), 1) -> 'items'), '[]'::jsonb, 'scheduled visits are not cancellation candidates');

set local role postgres;
-- Ordered migrations do not imply that an installation has seeded settings.
-- Install only the two fixture rules needed for the historical receipt below.
do $visit_rules$
declare v_event text; v_rule_id uuid; v_template_id uuid;
begin
  foreach v_event in array array['registration.visit_scheduled','registration.visit_canceled'] loop
    select id, active_template_id into v_rule_id, v_template_id
    from dashboard_private.notification_rules where scope_key='global' and workflow_key='registration'
      and event_key=v_event and channel_key='google_chat' and audience_key='management_team' and rule_variant_key='immediate';
    if not found then
      v_rule_id:=gen_random_uuid(); v_template_id:=gen_random_uuid();
      insert into dashboard_private.notification_rules(id,scope_key,workflow_key,event_key,channel_key,audience_key,
        rule_variant_key,delivery_mode,enabled,active_template_id,revision,created_actor_kind,updated_actor_kind)
      values(v_rule_id,'global','registration',v_event,'google_chat','management_team','immediate','immediate',true,v_template_id,1,'system','system');
      insert into dashboard_private.notification_templates(id,rule_id,version,title_template,body_template,allowed_variables,
        payload_schema_version,checksum,created_actor_kind)
      values(v_template_id,v_rule_id,1,'[방문상담 취소] {student_name}',E'[학생] {student_name}\n[취소 장소] {canceled_place}',
        '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"canceled_place","token":"취소장소","pii_class":"none"}]',
        2,'visit-cancellation-fixture','system');
    else
      update dashboard_private.notification_rules set enabled=true where id=v_rule_id;
    end if;
  end loop;
end;
$visit_rules$;
-- A historical provider-success receipt is a test fact; no provider is called.
insert into dashboard_private.notification_events(id, workflow_key, event_key, source_type, source_id,
  source_revision, occurrence_key, actor_profile_id, occurred_at, payload_schema_version, payload, rule_snapshot)
select '9ac10000-0000-4000-8000-000000000200', 'registration', 'registration.visit_scheduled',
  'registration_appointment', appointment.id::text, appointment.notification_revision,
  'visit-cancel-original', '9ac10000-0000-4000-8000-000000000100', now(), 2,
  jsonb_build_object('task_id', appointment.task_id, 'appointment_id', appointment.id,
    'notification_revision', appointment.notification_revision, 'recipient_revision', appointment.recipient_revision::text,
    'appointment_status', 'scheduled', 'scheduled_at', appointment.scheduled_at,
    'student_name', '전달 당시 학생', 'subjects', jsonb_build_array('영어'), 'place', '전달 당시 상담실',
    'track_ids', jsonb_build_array((select data #>> '{tracks,0,id}' from cancel_fixture where key = 'case'))),
  jsonb_build_array(jsonb_build_object('rule_id', rule.id, 'rule_revision', rule.revision::text,
    'template_id', rule.active_template_id, 'enabled', true, 'channel_key', 'google_chat', 'audience_key', 'management_team'))
from public.ops_registration_appointments appointment
cross join dashboard_private.notification_rules rule
where appointment.id = (select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'booking')
  and rule.workflow_key = 'registration' and rule.event_key = 'registration.visit_scheduled'
  and rule.channel_key = 'google_chat' and rule.audience_key = 'management_team';
insert into dashboard_private.notification_deliveries(id, event_id, rule_id, rule_revision, template_id,
  channel_key, audience_key, target_generation, target_set_hash, target_kind, target_key,
  connection_key, target_snapshot, status, dedupe_key, rendered_title, rendered_body,
  href, scheduled_for, max_attempts, sent_at)
select '9ac10000-0000-4000-8000-000000000201', event_row.id, rule.id, rule.revision, rule.active_template_id,
  'google_chat', 'management_team', 1, 'fixture-target-hash', 'connection', 'connection:google_chat.management',
  'google_chat.management', '{"connection_key":"google_chat.management"}', 'sent', 'visit-cancel-original',
  '이전 방문상담', '전달 당시 학생 · 전달 당시 상담실', '/admin/registration', now(), 1, now()
from dashboard_private.notification_events event_row
cross join dashboard_private.notification_rules rule
where event_row.id = '9ac10000-0000-4000-8000-000000000200'
  and rule.workflow_key = 'registration' and rule.event_key = 'registration.visit_scheduled'
  and rule.channel_key = 'google_chat' and rule.audience_key = 'management_team';
select is((select count(*) from dashboard_private.notification_deliveries where id='9ac10000-0000-4000-8000-000000000201'),
  1::bigint,'fixture installs exactly one delivered original without relying on production seed data');
insert into cancel_fixture values ('baseline', jsonb_build_object('events', (select count(*) from dashboard_private.notification_events)));

set local role authenticated;
select pg_temp.cancel_actor('authenticated', '9ac10000-0000-4000-8000-000000000100');
select lives_ok($q$
  select public.cancel_registration_appointment((select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'booking'),
    (select (data ->> 'notificationRevision')::integer from cancel_fixture where key = 'booking'), '일정 취소', 'visit-cancel-fact')
$q$, 'cancellation fact save succeeds independently');
insert into cancel_fixture
select 'preview', public.list_registration_visit_cancellations_v1((data ->> 'taskId')::uuid, 1) #> '{items,0}'
from cancel_fixture where key = 'case';
select is((select data ->> 'status' from cancel_fixture where key = 'preview'), 'ready', 'delivered original becomes an explicit cancellation candidate');
select ok((select data ->> 'renderedBody' from cancel_fixture where key = 'preview') like '%전달 당시 상담실%', 'cancellation uses the delivered place snapshot');
select ok((select data ->> 'renderedTitle' from cancel_fixture where key = 'preview') like '%전달 당시 학생%', 'cancellation uses the delivered student snapshot');
select ok(not (select data ? 'targetSnapshot' or data ? 'sourcePayload' or data ? 'href' from cancel_fixture where key = 'preview'), 'public DTO excludes internal target, event payload, and card href');
select is((select data - array['appointmentId','notificationRevision','status','reason','canSend','scheduledAt',
  'sourceDeliveryId','sourceSentAt','sourceTitle','sourceBody','targetLabel','renderedTitle','renderedBody','previewChecksum']
  from cancel_fixture where key='preview'), '{}'::jsonb, 'real ready DTO contains only fields accepted by the API consumer');
select throws_ok($q$
  select public.ensure_registration_visit_cancellation_v1((select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'preview'),
    1, '9ac10000-0000-4000-8000-000000000201', repeat('a',64), '9ac10000-0000-4000-8000-000000000301')
$q$, '23514', 'registration_visit_cancellation_refresh_required', 'stale cancellation revision is a nonretryable conflict');
select throws_ok($q$
  select public.ensure_registration_visit_cancellation_v1((select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'preview'),
    (select (data ->> 'notificationRevision')::integer from cancel_fixture where key = 'preview'),
    '9ac10000-0000-4000-8000-000000000201', repeat('a',64), '9ac10000-0000-4000-8000-000000000302')
$q$, '23514', 'registration_visit_cancellation_refresh_required', 'changed review checksum cannot send');

set local role postgres;
select is((select count(*) from dashboard_private.notification_events),
  (select (data ->> 'events')::bigint from cancel_fixture where key = 'baseline'),
  'fact save, list read, and rejected previews do not generate notifications');
update dashboard_private.notification_deliveries set status = 'delivery_unknown', status_reason = 'provider_ambiguous_response'
where id = '9ac10000-0000-4000-8000-000000000201';
select is(dashboard_private.registration_visit_cancellation_preview_v1((select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'booking')) ->> 'status',
  'unknown', 'ambiguous original blocks cancellation rather than assuming delivery');
update dashboard_private.notification_deliveries set status = 'failed', status_reason = 'provider_definite_rejection'
where id = '9ac10000-0000-4000-8000-000000000201';
select is(dashboard_private.registration_visit_cancellation_preview_v1((select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'booking')) ->> 'status',
  'not_needed', 'an original message that definitely failed does not need cancellation');
update dashboard_private.notification_deliveries set status = 'sent', status_reason = null
where id = '9ac10000-0000-4000-8000-000000000201';

set local role authenticated;
select pg_temp.cancel_actor('authenticated', '9ac10000-0000-4000-8000-000000000101');
select throws_ok($q$select public.list_registration_visit_cancellations_v1((select (data ->> 'taskId')::uuid from cancel_fixture where key = 'case'),1)$q$,
  '42501', null, 'teacher cannot read management cancellation history');
select pg_temp.cancel_actor('authenticated', '9ac10000-0000-4000-8000-000000000100');
insert into cancel_fixture
select 'ensure', public.ensure_registration_visit_cancellation_v1((data ->> 'appointmentId')::uuid,
  (data ->> 'notificationRevision')::integer, (data ->> 'sourceDeliveryId')::uuid,
  data ->> 'previewChecksum', '9ac10000-0000-4000-8000-000000000300')
from cancel_fixture where key = 'preview';
select is((select public.ensure_registration_visit_cancellation_v1((data ->> 'appointmentId')::uuid,
  (data ->> 'notificationRevision')::integer, (data ->> 'sourceDeliveryId')::uuid,
  data ->> 'previewChecksum', '9ac10000-0000-4000-8000-000000000300') from cancel_fixture where key = 'preview'),
  (select data from cancel_fixture where key = 'ensure'), 'lost-response replay returns the same explicit event');
select throws_ok($q$
  select public.ensure_registration_visit_cancellation_v1((select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'preview'),
    (select (data ->> 'notificationRevision')::integer from cancel_fixture where key = 'preview'),
    '9ac10000-0000-4000-8000-000000000201', repeat('b',64), '9ac10000-0000-4000-8000-000000000300')
$q$, '22023', 'idempotency_key_reused', 'request key cannot be reused for a different reviewed payload');
select throws_ok($q$
  select public.ensure_registration_visit_notification_v1((select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'preview'),
    (select (data ->> 'notificationRevision')::integer from cancel_fixture where key = 'preview'),
    '9ac10000-0000-4000-8000-000000000303', 'send_registration_visit_notification')
$q$, '23514', 'registration_visit_notification_not_ready', 'scheduled readiness still refuses a canceled appointment');
insert into cancel_fixture
select 'plan', public.get_registration_visit_legacy_dispatch_plan_v1((data ->> 'appointmentId')::uuid,
  '9ac10000-0000-4000-8000-000000000100') from cancel_fixture where key = 'preview';
select is((select data #>> '{items,0,eventKey}' from cancel_fixture where key = 'plan'), 'registration.visit_canceled', 'dedicated cancellation plan is used');
select is((select jsonb_array_length(data -> 'items') from cancel_fixture where key = 'plan'), 1, 'cancellation targets only the previously notified management room');
select is((public.list_registration_visit_cancellations_v1((select (data ->> 'taskId')::uuid from cancel_fixture where key='case'),1)->'items'->0)
  - array['appointmentId','notificationRevision','status','reason','canSend','scheduledAt','sourceDeliveryId','sourceSentAt',
    'sourceTitle','sourceBody','targetLabel','renderedTitle','renderedBody','previewChecksum'],
  '{}'::jsonb, 'stored cancellation preview also projects only public consumer fields');
select is((select data#>>'{items,0,href}' from cancel_fixture where key='plan'),
  '/admin/registration?taskId='||(select data->>'taskId' from cancel_fixture where key='case'),
  'public projection retains the original card href in the private dispatch plan');
select throws_ok($q$
  select public.get_registration_visit_legacy_dispatch_plan_v1((select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'preview'),
    '9ac10000-0000-4000-8000-000000000102')
$q$, '42501', 'registration_access_denied', 'authenticated manager cannot read a plan as another active manager');

set local role service_role;
select pg_temp.cancel_actor('service_role', null);
select throws_ok($q$
  select public.get_registration_visit_legacy_dispatch_plan_v1((select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'preview'),
    '9ac10000-0000-4000-8000-000000000100')
$q$, '42501', null, 'service role has no direct plan capability');
select throws_ok($q$
  select public.materialize_registration_visit_legacy_google_chat_v1((data ->> 'appointmentId')::uuid,
    (data #>> '{items,0,ruleId}')::uuid,(data ->> 'recipientRevision')::bigint,
    '9ac10000-0000-4000-8000-000000000101') from cancel_fixture where key='plan'
$q$, '42501', null, 'postgres-owned service bridge still rejects a non-manager actor');
insert into cancel_fixture
select 'materialized', public.materialize_registration_visit_legacy_google_chat_v1(
  (data ->> 'appointmentId')::uuid, (data #>> '{items,0,ruleId}')::uuid,
  (data ->> 'recipientRevision')::bigint, '9ac10000-0000-4000-8000-000000000100')
from cancel_fixture where key = 'plan';
select ok((select data->>'deliveryId' is not null from cancel_fixture where key='materialized'),
  'actual service materialize RPC reaches the authenticated-only plan as postgres and validates the manager');
select lives_ok($q$
  select public.begin_registration_visit_legacy_google_chat_v1((data ->> 'appointmentId')::uuid,
    (data #>> '{items,0,ruleId}')::uuid,(data ->> 'recipientRevision')::bigint,
    '9ac10000-0000-4000-8000-000000000100','9ac10000-0000-4000-8000-000000000304')
  from cancel_fixture where key='plan'
$q$, 'actual service begin RPC validates its manager through the plan without a direct service plan grant');

set local role postgres;
select is((select count(*) from dashboard_private.notification_events where source_type = 'registration_visit_cancellation'), 1::bigint, 'double preparation creates only one cancellation event');
select ok(not exists(select 1 from dashboard_private.notification_event_fanout_jobs job
  join dashboard_private.notification_events event_row on event_row.id = job.event_id
  where event_row.source_type = 'registration_visit_cancellation' and job.status in ('pending','claimed')),
  'generic workers cannot race explicit cancellation dispatch');
select ok(dashboard_private.registration_visit_cancellation_source_current_v1((select (data ->> 'sourceEventId')::uuid from cancel_fixture where key = 'ensure')),
  'frozen cancellation source is valid before send');
update dashboard_private.notification_deliveries set status = 'delivery_unknown', status_reason = 'provider_ambiguous_response'
where id = '9ac10000-0000-4000-8000-000000000201';
select is(dashboard_private.registration_visit_cancellation_source_current_v1((select (data ->> 'sourceEventId')::uuid from cancel_fixture where key = 'ensure')),
  false, 'an original receipt that becomes unknown invalidates the frozen source with false, never SQL null');
update dashboard_private.notification_deliveries set status = 'sent', status_reason = null
where id = '9ac10000-0000-4000-8000-000000000201';
update public.ops_registration_appointments set notification_revision = notification_revision + 1
where id = (select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'preview');
select ok(not dashboard_private.registration_visit_cancellation_source_current_v1((select (data ->> 'sourceEventId')::uuid from cancel_fixture where key = 'ensure')),
  'source fence rejects a changed appointment revision');
select ok(pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure)
  like '%registration_visit_cancellation_source_current_v1%', 'final ordered external gate revalidates cancellation immediately before provider');
select ok(pg_get_functiondef('public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::regprocedure)
  like '%word_retest_google_chat_retired%', 'final gate retains retest retirement');
select is((select status from public.ops_registration_appointments where id = (select (data ->> 'appointmentId')::uuid from cancel_fixture where key = 'preview')),
  'canceled', 'no notification step resurrects the canceled appointment');
select * from finish();
rollback;
