begin;

select no_plan();

create extension if not exists dblink;

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

select has_function(
  'dashboard_private',
  'registration_appointment_has_active_subject_v1',
  array['uuid', 'uuid'],
  'appointment delivery eligibility has one active-subject authority'
);

select ok(
  (
    select pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig[1] = any (
        array['search_path=', 'search_path=""']::text[]
      )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.registration_appointment_has_active_subject_v1(uuid,uuid)'::regprocedure
  ),
  'active-subject authority is a postgres-owned empty-search-path stable definer'
);

select ok(
  (
    select definition like '%track.archived_at is null%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.get_registration_observation_notification_source_impl_v1(uuid)'::regprocedure
      )) as definition
    ) source
  ),
  'Google Chat observation source rejects archived tracks'
);

select ok(
  (
    select pg_catalog.regexp_count(definition, 'track\.archived_at is null') >= 3
      and definition like '%level_test.track_id%'
      and definition like '%consultation.track_id%'
      and definition like '%observation.track_id%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.collect_registration_customer_message_bundle_items_v1(uuid,text,text,date,timestamp with time zone)'::regprocedure
      )) as definition
    ) source
  ),
  'bundle source collection rejects archived level-test, consultation, and observation tracks'
);

select ok(
  (
    select definition like '%order by track.id%for share%'
      and definition like '%track.task_id = p_task_id%'
      and definition like '%track.archived_at is not null%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.materialize_registration_customer_message_bundle_v1(uuid,text,text,date,timestamp with time zone)'::regprocedure
      )) as definition
    ) source
  ),
  'bundle materialization serializes with archive and rechecks every collected track'
);

select ok(
  (
    select definition like '%track.archived_at is null%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'::regprocedure
      )) as definition
    ) source
  ),
  'observation Alimtalk source rejects archived tracks'
);

select ok(
  (
    select definition like '%level_test.track_id%track.archived_at is null%'
      and definition like '%consultation.track_id%track.archived_at is null%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(text,uuid)'::regprocedure
      )) as definition
    ) source
  ),
  'appointment booking and reminder sources include active participants only'
);

select ok(
  (
    select definition like '%track.id = p_source_id%track.archived_at is null%'
      and definition like '%pipeline_status in (%'
      and definition like '%ops_registration_enrollments%'
      and pg_catalog.regexp_count(
        definition,
        'track\.archived_at is null'
      ) >= 5
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.resolve_registration_customer_message_source_pre_booking_eligib(text,uuid)'::regprocedure
      )) as definition
    ) source
  ),
  'waiting and admission sources include active tracks and enrollment plans only'
);

select ok(
  (
    select definition like '%return 0%'
      and definition not like '%registration_appointment_has_active_subject_v1%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.sync_registration_customer_reminder_jobs_v1()'::regprocedure
      )) as definition
    ) source
  ),
  'the retired automatic reminder synchronizer is a constant provider-zero no-op'
);

select ok(
  (
    select definition like '%return null%'
      and definition not like '%resolve_registration_customer_message_source_v1_impl%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.claim_registration_customer_reminder_job_v1()'::regprocedure
      )) as definition
    ) source
  ),
  'the retired automatic reminder claim returns no work'
);

select ok(
  (
    select definition like '%resolve_registration_customer_message_source_v1_impl%appointment_reminder%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::regprocedure
      )) as definition
    ) source
  ),
  'final reminder prepare re-resolves and locks appointment source facts'
);

select ok(
  (
    select definition like '%track.archived_at is null%'
      and definition like '%get_registration_observation_notification_source_impl_v1%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.prepare_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text)'::regprocedure
      )) as definition
    ) source
  ),
  'final Google Chat prepare locks an active track and re-resolves its source'
);

select ok(
  (
    select definition like '%registration_customer_message_assert_current_v1%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.mark_registration_customer_message_attempt_started_v1(uuid,uuid,uuid,jsonb)'::regprocedure
      )) as definition
    ) source
  ),
  'manual message provider marker keeps the current-source recheck'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
      'public.ops_registration_customer_messages'::regclass
      and constraint_row.conname =
        'ops_registration_customer_messages_dedupe_key_key'
      and constraint_row.contype = 'u'
      and constraint_row.convalidated
  )
  and not exists (
    select 1
    from pg_catalog.pg_indexes index_row
    where index_row.schemaname = 'public'
      and index_row.tablename = 'ops_registration_customer_messages'
      and index_row.indexname =
        'ops_registration_customer_messages_dedupe_key_active_uidx'
  ),
  'message dedupe remains lifetime unique and is not released by archive state'
);

select ok(
  (
    select pg_catalog.count(*) = 6
    from (
      values
        ('public.ops_reg_customer_msg_appointment_revision_once_idx'::text),
        ('public.ops_reg_customer_msg_reminder_lifetime_once_idx'::text),
        ('public.ops_reg_customer_msg_waiting_once_idx'::text),
        ('public.ops_reg_customer_msg_admission_once_idx'::text),
        ('public.ops_reg_customer_msg_observation_revision_once_idx'::text),
        ('public.ops_reg_customer_msg_booking_bundle_once_idx'::text)
    ) expected(index_name)
    join pg_catalog.pg_class index_relation
      on index_relation.oid = pg_catalog.to_regclass(expected.index_name)
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    where index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and pg_catalog.lower(coalesce(
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
        ''
      )) not like '%subject_archived%'
  ),
  'message business identities remain lifetime unique across subject archive'
);

select ok(
  (
    select pg_catalog.count(*) = 2
    from (
      values
        ('dashboard_private.registration_customer_message_booking_bundle_revision_idx'::text),
        ('dashboard_private.registration_customer_message_reminder_bundle_revision_idx'::text)
    ) expected(index_name)
    join pg_catalog.pg_class index_relation
      on index_relation.oid = pg_catalog.to_regclass(expected.index_name)
    join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    where index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and pg_catalog.lower(coalesce(
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
        ''
      )) not like '%canceled%'
  ),
  'bundle revisions remain lifetime unique across subject archive'
);

select ok(
  (
    select pg_catalog.bool_and(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(identity))
        not like '%subject_archived%'
    )
    from (
      values
        ('dashboard_private.claim_registration_customer_message_pre_observation_v1(uuid,uuid,text,jsonb)'::regprocedure),
        ('public.claim_registration_customer_message_v1(uuid,uuid,text,jsonb)'::regprocedure)
    ) claims(identity)
  ),
  'manual message claims do not reinterpret archive state as a released identity'
);

select hasnt_function(
  'dashboard_private',
  'cancel_registration_archived_subject_delivery_v1',
  array[]::text[],
  'subject archive has no synchronous notification mutation function'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
      'public.ops_registration_subject_tracks'::regclass
      and trigger_row.tgname =
        'cancel_registration_archived_subject_delivery'
      and not trigger_row.tgisinternal
  ),
  'subject archive has no AFTER trigger that can lock notification rows'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_proc procedure
      on procedure.oid = trigger_row.tgfoid
    where trigger_row.tgrelid =
      'public.ops_registration_subject_tracks'::regclass
      and not trigger_row.tgisinternal
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
        ~ '(notification_deliveries|registration_customer_reminder_jobs|ops_registration_customer_messages|registration_customer_message_bundles)'
  ),
  'every subject-track trigger is independent from delivery and reminder tables'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '98710000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'archive-delivery-fence-admin@example.invalid',
  crypt('archive-delivery-fence-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now()
);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '98710000-0000-4000-8000-000000000001',
  'admin', '과목 발송차단 원장',
  'archive-delivery-fence-admin@example.invalid', now(), now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values (
  '98710000-0000-4000-8000-000000000101',
  '등록: 공유예약 발송차단', 'registration', 'requested', 'normal',
  '98710000-0000-4000-8000-000000000001', '발송차단학생'
);

insert into public.ops_registration_details(task_id, parent_phone)
values ('98710000-0000-4000-8000-000000000101', '01098710001');

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, migration_review_required,
  workflow_status, workflow_revision, director_profile_id,
  director_assignment_source, director_assigned_at
)
values
  (
    '98710000-0000-4000-8000-000000000201',
    '98710000-0000-4000-8000-000000000101',
    '영어', 'inquiry', false, 'inquiry', 1,
    '98710000-0000-4000-8000-000000000001', 'manual', now()
  ),
  (
    '98710000-0000-4000-8000-000000000202',
    '98710000-0000-4000-8000-000000000101',
    '수학', 'inquiry', false, 'inquiry', 1,
    '98710000-0000-4000-8000-000000000001', 'manual', now()
  );

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, schedule_confirmed_at
)
values (
  '98710000-0000-4000-8000-000000000301',
  '98710000-0000-4000-8000-000000000101',
  'visit_consultation', now() + interval '7 days', '본관 상담실',
  'scheduled', 1, now() - interval '2 days'
);

insert into public.ops_registration_consultations(
  id, track_id, appointment_id, mode, status, director_profile_id
)
values
  (
    '98710000-0000-4000-8000-000000000401',
    '98710000-0000-4000-8000-000000000201',
    '98710000-0000-4000-8000-000000000301',
    'visit', 'scheduled', '98710000-0000-4000-8000-000000000001'
  ),
  (
    '98710000-0000-4000-8000-000000000402',
    '98710000-0000-4000-8000-000000000202',
    '98710000-0000-4000-8000-000000000301',
    'visit', 'scheduled', '98710000-0000-4000-8000-000000000001'
  );

-- Direct postgres-only inert fixture: automatic producers and claims remain
-- retired; this row exists only to prove fact writes do not wait on it.
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, task_id, message_kind, source_revision,
  scheduled_for, due_at, available_at, request_key, status
)
values (
  '98710000-0000-4000-8000-000000000501',
  '98710000-0000-4000-8000-000000000301',
  '98710000-0000-4000-8000-000000000101',
  'appointment_reminder', 1,
  now() + interval '7 days', now() + interval '6 days', now(),
  '98710000-0000-4000-8000-000000000502', 'pending'
);

create or replace function pg_temp.resolve_archive_delivery_bundle_v1(
  p_message_kind text,
  p_task_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source jsonb;
  v_previous_role text := pg_catalog.current_setting(
    'request.jwt.claim.role',
    true
  );
begin
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  begin
    v_source := public.resolve_registration_customer_message_bundle_source_v1(
      p_message_kind,
      p_task_id,
      null
    );
  exception when others then
    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      coalesce(v_previous_role, ''),
      true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    coalesce(v_previous_role, ''),
    true
  );
  return (v_source ->> 'bundleId')::uuid;
end;
$$;

create temporary table archive_delivery_bundle_fixture(
  label text primary key,
  bundle_id uuid not null
) on commit drop;

insert into archive_delivery_bundle_fixture(label, bundle_id)
values (
  'before_archive',
  pg_temp.resolve_archive_delivery_bundle_v1(
    'visit_consultation_booking_bundle',
    '98710000-0000-4000-8000-000000000101'
  )
);

-- A second immutable snapshot represents work that already crossed the
-- provider marker.  Its dispatching state and outbox identity must survive
-- the archive as uncertainty evidence.
insert into dashboard_private.registration_customer_message_bundles(
  id, task_id, reservation_kind, delivery_kind, recipient_revision,
  source_fingerprint, status, request_key
)
values (
  '98710000-0000-4000-8000-000000000511',
  '98710000-0000-4000-8000-000000000101',
  'visit_consultation', 'booking', 1, repeat('9', 64),
  'dispatching', '98710000-0000-4000-8000-000000000512'
);

insert into dashboard_private.registration_customer_message_bundle_items(
  bundle_id, sort_order, source_kind, source_id, source_revision,
  track_id, activity_id, subject, scheduled_at, service_date, place,
  source_fact_hash
)
values (
  '98710000-0000-4000-8000-000000000511', 1,
  'visit_consultation', '98710000-0000-4000-8000-000000000301',
  '{"appointmentNotificationRevision":1}'::jsonb,
  '98710000-0000-4000-8000-000000000201',
  '98710000-0000-4000-8000-000000000401', '영어',
  now() + interval '7 days', current_date + 7, '본관 상담실',
  repeat('8', 64)
);

insert into public.ops_registration_customer_message_previews(
  id, task_id, bundle_id, message_kind, source_fingerprint,
  source_facts_checksum, recipient_hash, recipient_last4, template_key,
  template_revision, template_checksum, rendered_variables_checksum,
  rendered_body_checksum, rendered_buttons_checksum, created_by
)
select
  fixture.preview_id,
  '98710000-0000-4000-8000-000000000101', fixture.bundle_id,
  fixture.message_kind, fixture.source_fingerprint, repeat('0', 64),
  repeat(fixture.recipient_digit, 64), '0001', fixture.message_kind,
  1, repeat('c', 64), repeat('d', 64), repeat('e', 64), repeat('f', 64),
  '98710000-0000-4000-8000-000000000001'
from (
  select
    '98710000-0000-4000-8000-000000000521'::uuid as preview_id,
    bundle.bundle_id,
    'visit_consultation_booking_bundle'::text as message_kind,
    manifest.source_fingerprint,
    'a'::text as recipient_digit
  from archive_delivery_bundle_fixture bundle
  join dashboard_private.registration_customer_message_bundles manifest
    on manifest.id = bundle.bundle_id
  where bundle.label = 'before_archive'
  union all
  select
    '98710000-0000-4000-8000-000000000522',
    '98710000-0000-4000-8000-000000000511',
    'level_test_booking_bundle', repeat('9', 64), 'b'
  union all
  select
    '98710000-0000-4000-8000-000000000523',
    '98710000-0000-4000-8000-000000000511',
    'level_test_booking_bundle', repeat('9', 64), '7'
) fixture;

alter table public.ops_registration_customer_messages
  disable trigger enforce_registration_customer_solapi_delivery_gate_v1;

insert into public.ops_registration_customer_messages(
  id, preview_id, task_id, bundle_id, message_kind, source_fingerprint,
  source_facts_checksum, recipient_hash, recipient_last4, template_key,
  template_revision, template_checksum, rendered_variables_checksum,
  rendered_body_checksum, rendered_buttons_checksum, dedupe_key,
  request_key, status, claim_active, claim_token, claim_owner_id,
  claim_expires_at, dispatch_token, provider_attempt_started_at,
  provider_attempt_count, confirmed_by
)
select
  '98710000-0000-4000-8000-000000000531', preview.id,
  preview.task_id, preview.bundle_id, preview.message_kind,
  preview.source_fingerprint, preview.source_facts_checksum,
  preview.recipient_hash, preview.recipient_last4, preview.template_key,
  preview.template_revision, preview.template_checksum,
  preview.rendered_variables_checksum, preview.rendered_body_checksum,
  preview.rendered_buttons_checksum, repeat('1', 64),
  '98710000-0000-4000-8000-000000000532', 'pending', true,
  '98710000-0000-4000-8000-000000000533',
  '98710000-0000-4000-8000-000000000001', now() + interval '5 minutes',
  '98710000-0000-4000-8000-000000000534', null, 0,
  '98710000-0000-4000-8000-000000000001'
from public.ops_registration_customer_message_previews preview
where preview.id = '98710000-0000-4000-8000-000000000521';

insert into public.ops_registration_customer_messages(
  id, preview_id, task_id, bundle_id, message_kind, source_fingerprint,
  source_facts_checksum, recipient_hash, recipient_last4, template_key,
  template_revision, template_checksum, rendered_variables_checksum,
  rendered_body_checksum, rendered_buttons_checksum, dedupe_key,
  request_key, status, claim_active, dispatch_token,
  provider_attempt_started_at, provider_attempt_count, confirmed_by
)
select
  '98710000-0000-4000-8000-000000000541', preview.id,
  preview.task_id, preview.bundle_id, preview.message_kind,
  preview.source_fingerprint, preview.source_facts_checksum,
  preview.recipient_hash, preview.recipient_last4, preview.template_key,
  preview.template_revision, preview.template_checksum,
  preview.rendered_variables_checksum, preview.rendered_body_checksum,
  preview.rendered_buttons_checksum, repeat('2', 64),
  '98710000-0000-4000-8000-000000000542', 'pending', false,
  '98710000-0000-4000-8000-000000000544', now(), 1,
  '98710000-0000-4000-8000-000000000001'
from public.ops_registration_customer_message_previews preview
where preview.id = '98710000-0000-4000-8000-000000000522';

alter table public.ops_registration_customer_messages
  enable trigger enforce_registration_customer_solapi_delivery_gate_v1;

-- Use a real registration Google Chat delivery in sending state.  The archive
-- may request cancellation, but it must never pretend the provider boundary
-- was not crossed.
set constraints all deferred;

insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  enabled, active_template_id, revision,
  created_by, created_actor_kind, updated_by, updated_actor_kind
)
values (
  '98710000-0000-4000-8000-000000000610', 'global', 'registration',
  'registration.observation_scheduled', 'google_chat', 'subject_team',
  'immediate', 'immediate', null, null, true,
  '98710000-0000-4000-8000-000000000611', 1,
  null, 'system', null, 'system'
), (
  '98710000-0000-4000-8000-000000000612', 'global', 'registration',
  'registration.observation_reminder_due', 'google_chat', 'subject_team',
  'immediate', 'immediate', null, null, true,
  '98710000-0000-4000-8000-000000000613', 1,
  null, 'system', null, 'system'
);

insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind
)
values (
  '98710000-0000-4000-8000-000000000611',
  '98710000-0000-4000-8000-000000000610', 1,
  '등록 과목 변경', '등록 과목 변경 발송 fixture', '[]'::jsonb,
  1, repeat('3', 64), null, 'system'
), (
  '98710000-0000-4000-8000-000000000613',
  '98710000-0000-4000-8000-000000000612', 1,
  '등록 청강 알림', '등록 청강 알림 fixture', '[]'::jsonb,
  1, repeat('4', 64), null, 'system'
);

set constraints all immediate;

create temporary table archive_delivery_notification_fixture(
  event_id uuid primary key,
  delivery_id uuid not null
) on commit drop;

with selected_rule as (
  select rule.*
  from dashboard_private.notification_rules rule
  where rule.workflow_key = 'registration'
    and rule.channel_key = 'google_chat'
    and rule.id = '98710000-0000-4000-8000-000000000610'
  order by rule.id
  limit 1
), inserted_event as (
  insert into dashboard_private.notification_events(
    id, workflow_key, event_key, source_type, source_id, source_revision,
    occurrence_key, occurred_at, payload_schema_version, payload,
    rule_snapshot
  )
  select
    '98710000-0000-4000-8000-000000000551', 'registration',
    rule.event_key, 'registration_bundle',
    (select bundle_id::text from archive_delivery_bundle_fixture
      where label = 'before_archive'),
    1, 'registration-archive-delivery-sending-fixture', now(), 1,
    pg_catalog.jsonb_build_object(
      'bundle_id', (select bundle_id::text
        from archive_delivery_bundle_fixture where label = 'before_archive')
    ),
    '[]'::jsonb
  from selected_rule rule
  returning id
), inserted_delivery as (
  insert into dashboard_private.notification_deliveries(
    id, event_id, rule_id, rule_revision, template_id, channel_key,
    audience_key, target_generation, target_set_hash, target_kind,
    target_key, connection_key, target_snapshot, status, status_reason,
    dedupe_key, rendered_title, rendered_body, href, scheduled_for,
    attempt_count, max_attempts, claimed_by, claim_token,
    lease_expires_at, last_attempt_started_at
  )
  select
    '98710000-0000-4000-8000-000000000552', event_row.id,
    rule.id, rule.revision, rule.active_template_id, 'google_chat',
    rule.audience_key, 1, repeat('6', 64), 'connection',
    'connection:google_chat.english', 'google_chat.english',
    '{"connection_key":"google_chat.english"}'::jsonb,
    'sending', null, 'registration-archive-delivery-sending-fixture',
    '등록 과목 변경', '등록 과목 변경 발송 fixture', '/admin/registration',
    now(), 1, 3, 'archive-delivery-worker',
    '98710000-0000-4000-8000-000000000553',
    now() + interval '5 minutes', now()
  from inserted_event event_row
  cross join selected_rule rule
  returning event_id, id
)
insert into archive_delivery_notification_fixture(event_id, delivery_id)
select event_id, id from inserted_delivery;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '98710000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'archive-delivery-fence-teacher@example.invalid',
  crypt('archive-delivery-fence-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now()
);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '98710000-0000-4000-8000-000000000002',
  'teacher', '과목 발송차단 강사',
  'archive-delivery-fence-teacher@example.invalid', now(), now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id = '98710000-0000-4000-8000-000000000002';

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id,
  account_email, dashboard_role
)
values (
  '98710000-0000-4000-8000-000000000601', '과목 발송차단 강사',
  array['영어']::text[], true, 9871,
  '98710000-0000-4000-8000-000000000002',
  'archive-delivery-fence-teacher@example.invalid', 'teacher'
);

update public.profiles
set teacher_catalog_id = '98710000-0000-4000-8000-000000000601'
where id = '98710000-0000-4000-8000-000000000002';

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  '98710000-0000-4000-8000-000000000602', '발송차단 101호',
  array['영어']::text[], true, 9872, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
values (
  '98710000-0000-4000-8000-000000000603', '발송차단 영어반', '영어',
  '수업 진행 중', 'normalized', '{}'::jsonb
);

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '98710000-0000-4000-8000-000000000603',
    '98710000-0000-4000-8000-000000000609',
    'registration_archived_subject_delivery_fence_test'
  );
end;
$$;

insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state,
  start_time, end_time, teacher_catalog_id, teacher_name_snapshot,
  classroom_catalog_id, classroom_name_snapshot, origin, revision
)
values (
  '98710000-0000-4000-8000-000000000608',
  '98710000-0000-4000-8000-000000000603',
  pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD')
    || ':archive-delivery-chat',
  current_date + 7, 'active', time '18:00', time '20:00',
  '98710000-0000-4000-8000-000000000601', '과목 발송차단 강사',
  '98710000-0000-4000-8000-000000000602', '발송차단 101호',
  'manual', 7
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, schedule_confirmed_at
)
values (
  '98710000-0000-4000-8000-000000000604',
  '98710000-0000-4000-8000-000000000101',
  'observation_class',
  ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), '본관',
  'scheduled', 1, now() - interval '2 days'
);

insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot,
  teacher_name_snapshot, classroom_name_snapshot, campus,
  created_by, updated_by
)
values (
  '98710000-0000-4000-8000-000000000605',
  '98710000-0000-4000-8000-000000000101',
  '98710000-0000-4000-8000-000000000201',
  '98710000-0000-4000-8000-000000000604',
  '98710000-0000-4000-8000-000000000603',
  'normalized', '98710000-0000-4000-8000-000000000608', null,
  current_date + 7,
  ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'),
  ((current_date + 7 + time '20:00') at time zone 'Asia/Seoul'),
  'active', 7, null,
  pg_catalog.jsonb_build_object(
    'authority', 'normalized',
    'sessionId', '98710000-0000-4000-8000-000000000608',
    'revision', 7
  ),
  dashboard_private.registration_observation_booking_fact_hash_v1(
    pg_catalog.jsonb_build_object(
      'classId', '98710000-0000-4000-8000-000000000603'::uuid,
      'subject', '영어', 'sessionAuthority', 'normalized',
      'classLessonSessionId',
        '98710000-0000-4000-8000-000000000608'::uuid,
      'legacySessionKey', null,
      'sessionKey', pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD')
        || ':archive-delivery-chat',
      'scheduleState', 'active', 'sessionDate', current_date + 7,
      'startsAt',
        ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'),
      'endsAt',
        ((current_date + 7 + time '20:00') at time zone 'Asia/Seoul'),
      'teacherCatalogId',
        '98710000-0000-4000-8000-000000000601'::uuid,
      'teacherProfileId',
        '98710000-0000-4000-8000-000000000002'::uuid,
      'teacherName', '과목 발송차단 강사',
      'classroomCatalogId',
        '98710000-0000-4000-8000-000000000602'::uuid,
      'classroomName', '발송차단 101호', 'campus', '본관'
    )
  ),
  '98710000-0000-4000-8000-000000000601',
  '98710000-0000-4000-8000-000000000002',
  '98710000-0000-4000-8000-000000000602',
  '영어', '발송차단 영어반', '과목 발송차단 강사',
  '발송차단 101호', '본관',
  '98710000-0000-4000-8000-000000000001',
  '98710000-0000-4000-8000-000000000001'
);

update dashboard_private.notification_rules rule
set enabled = true,
    revision = rule.revision + 1,
    updated_at = now()
where rule.workflow_key = 'registration'
  and rule.event_key = 'registration.observation_scheduled'
  and rule.channel_key = 'google_chat';

insert into dashboard_private.registration_observation_domain_events(
  event_id, observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision, occurred_at
)
select
  '98710000-0000-4000-8000-000000000606', observation.id,
  observation.appointment_id, 1, 'observation_scheduled',
  observation.booking_fact_hash, observation.source_revision, now()
from public.ops_registration_observations observation
where observation.id = '98710000-0000-4000-8000-000000000605';

select ok(
  dashboard_private.registration_appointment_has_active_subject_v1(
    '98710000-0000-4000-8000-000000000301',
    '98710000-0000-4000-8000-000000000101'
  ),
  'a shared appointment is active while either subject participant remains active'
);

select ok(
  (
    select pg_catalog.count(*) = 2
    from dashboard_private.registration_customer_message_bundle_items item
    join archive_delivery_bundle_fixture fixture
      on fixture.bundle_id = item.bundle_id
    where fixture.label = 'before_archive'
  )
  and not exists (
    select 1
    from dashboard_private.registration_observation_chat_jobs job
    where job.observation_id = '98710000-0000-4000-8000-000000000605'
  )
  and (
    select delivery.status = 'sending'
      and delivery.cancel_requested_at is null
    from dashboard_private.notification_deliveries delivery
    join archive_delivery_notification_fixture fixture
      on fixture.delivery_id = delivery.id
  ),
  'pre-archive fixtures include a two-subject bundle and manual sending delivery but no automatic Chat job'
);

select lives_ok(
  $$update public.ops_registration_subject_tracks
    set archived_at = now(),
        archived_by = '98710000-0000-4000-8000-000000000001'
    where id = '98710000-0000-4000-8000-000000000201'$$,
  'archiving one subject never blocks the underlying fact edit'
);

select ok(
  dashboard_private.registration_appointment_has_active_subject_v1(
    '98710000-0000-4000-8000-000000000301',
    '98710000-0000-4000-8000-000000000101'
  )
  and (
    select job.status = 'pending'
    from dashboard_private.registration_customer_reminder_jobs job
    where job.job_id = '98710000-0000-4000-8000-000000000501'
  ),
  'archiving one shared participant retains the reminder for the active subject'
);

select ok(
  (
    select bundle.status = 'pending'
      and bundle.last_error_code is null
      and bundle.claim_token is null
    from dashboard_private.registration_customer_message_bundles bundle
    join archive_delivery_bundle_fixture fixture
      on fixture.bundle_id = bundle.id
    where fixture.label = 'before_archive'
  )
  and (
    select bundle.status = 'dispatching'
      and bundle.last_error_code is null
    from dashboard_private.registration_customer_message_bundles bundle
    where bundle.id = '98710000-0000-4000-8000-000000000511'
  )
  and (
    select message.status = 'pending'
      and message.provider_attempt_count = 0
      and message.claim_active
      and message.claim_token = '98710000-0000-4000-8000-000000000533'
      and message.error_code is null
    from public.ops_registration_customer_messages message
    where message.id = '98710000-0000-4000-8000-000000000531'
  )
  and (
    select message.status = 'pending'
      and message.provider_attempt_count = 1
      and message.error_code is null
    from public.ops_registration_customer_messages message
    where message.id = '98710000-0000-4000-8000-000000000541'
  ),
  'archive fact commit does not mutate pre-marker or post-marker bundle work'
);

select ok(
  not exists (
    select 1
    from dashboard_private.registration_observation_chat_jobs job
    where job.observation_id = '98710000-0000-4000-8000-000000000605'
  )
  and (
    select delivery.status = 'sending'
      and delivery.claim_token = '98710000-0000-4000-8000-000000000553'
      and delivery.cancel_requested_at is null
      and delivery.cancel_reason is null
    from dashboard_private.notification_deliveries delivery
    join archive_delivery_notification_fixture fixture
      on fixture.delivery_id = delivery.id
  ),
  'archive creates no automatic Chat job and preserves manual sending-delivery uncertainty'
);

insert into archive_delivery_bundle_fixture(label, bundle_id)
values (
  'after_first_archive',
  pg_temp.resolve_archive_delivery_bundle_v1(
    'visit_consultation_booking_bundle',
    '98710000-0000-4000-8000-000000000101'
  )
);

select ok(
  (
    select current_bundle.bundle_id <> previous_bundle.bundle_id
    from archive_delivery_bundle_fixture current_bundle
    cross join archive_delivery_bundle_fixture previous_bundle
    where current_bundle.label = 'after_first_archive'
      and previous_bundle.label = 'before_archive'
  )
  and (
    select pg_catalog.count(*) = 1
      and pg_catalog.bool_and(item.track_id =
        '98710000-0000-4000-8000-000000000202')
    from dashboard_private.registration_customer_message_bundle_items item
    join archive_delivery_bundle_fixture fixture
      on fixture.bundle_id = item.bundle_id
    where fixture.label = 'after_first_archive'
  ),
  'fresh bundle rendering excludes the archived participant and gets a new audit identity'
);

insert into public.ops_registration_customer_message_previews(
  id, task_id, bundle_id, message_kind, source_fingerprint,
  source_facts_checksum, recipient_hash, recipient_last4, template_key,
  template_revision, template_checksum, rendered_variables_checksum,
  rendered_body_checksum, rendered_buttons_checksum, created_by
)
select
  '98710000-0000-4000-8000-000000000561',
  manifest.task_id, manifest.id, 'visit_consultation_booking_bundle',
  manifest.source_fingerprint, repeat('0', 64), repeat('a', 64), '0001',
  'visit_consultation_booking_bundle', 1, repeat('c', 64),
  repeat('d', 64), repeat('e', 64), repeat('f', 64),
  '98710000-0000-4000-8000-000000000001'
from dashboard_private.registration_customer_message_bundles manifest
join archive_delivery_bundle_fixture fixture
  on fixture.bundle_id = manifest.id
where fixture.label = 'after_first_archive';

alter table public.ops_registration_customer_messages
  disable trigger enforce_registration_customer_solapi_delivery_gate_v1;

select lives_ok(
  $$insert into public.ops_registration_customer_messages(
      id, preview_id, task_id, bundle_id, message_kind, source_fingerprint,
      source_facts_checksum, recipient_hash, recipient_last4, template_key,
      template_revision, template_checksum, rendered_variables_checksum,
      rendered_body_checksum, rendered_buttons_checksum, dedupe_key,
      request_key, status, claim_active, dispatch_token,
      provider_attempt_count, confirmed_by
    )
    select
      '98710000-0000-4000-8000-000000000562', preview.id,
      preview.task_id, preview.bundle_id, preview.message_kind,
      preview.source_fingerprint, preview.source_facts_checksum,
      preview.recipient_hash, preview.recipient_last4, preview.template_key,
      preview.template_revision, preview.template_checksum,
      preview.rendered_variables_checksum, preview.rendered_body_checksum,
      preview.rendered_buttons_checksum, repeat('3', 64),
      '98710000-0000-4000-8000-000000000563', 'pending', false,
      '98710000-0000-4000-8000-000000000564', 0,
      '98710000-0000-4000-8000-000000000001'
    from public.ops_registration_customer_message_previews preview
    where preview.id = '98710000-0000-4000-8000-000000000561'$$,
  'fresh active-subject bundle can create a distinct outbox identity without rewriting history'
);

select throws_ok(
  $$insert into public.ops_registration_customer_messages(
      id, preview_id, task_id, bundle_id, message_kind, source_fingerprint,
      source_facts_checksum, recipient_hash, recipient_last4, template_key,
      template_revision, template_checksum, rendered_variables_checksum,
      rendered_body_checksum, rendered_buttons_checksum, dedupe_key,
      request_key, status, claim_active, dispatch_token,
      provider_attempt_count, confirmed_by
    )
    select
      '98710000-0000-4000-8000-000000000565', preview.id,
      preview.task_id, preview.bundle_id, preview.message_kind,
      preview.source_fingerprint, preview.source_facts_checksum,
      preview.recipient_hash, preview.recipient_last4, preview.template_key,
      preview.template_revision, preview.template_checksum,
      preview.rendered_variables_checksum, preview.rendered_body_checksum,
      preview.rendered_buttons_checksum, repeat('2', 64),
      '98710000-0000-4000-8000-000000000566', 'pending', false,
      '98710000-0000-4000-8000-000000000567', 0,
      '98710000-0000-4000-8000-000000000001'
    from public.ops_registration_customer_message_previews preview
    where preview.id = '98710000-0000-4000-8000-000000000523'$$,
  '23505', null,
  'post-marker bundle identity remains lifetime unique after subject archive'
);

alter table public.ops_registration_customer_messages
  enable trigger enforce_registration_customer_solapi_delivery_gate_v1;

select lives_ok(
  $$update public.ops_registration_subject_tracks
    set archived_at = now(),
        archived_by = '98710000-0000-4000-8000-000000000001'
    where id = '98710000-0000-4000-8000-000000000202'$$,
  'archiving the final subject also remains a fact-only successful edit'
);

select ok(
  not dashboard_private.registration_appointment_has_active_subject_v1(
    '98710000-0000-4000-8000-000000000301',
    '98710000-0000-4000-8000-000000000101'
  )
  and (
    select job.status = 'pending'
      and job.last_error_code is null
      and job.claim_token is null
    from dashboard_private.registration_customer_reminder_jobs job
    where job.job_id = '98710000-0000-4000-8000-000000000501'
  ),
  'archiving the final participant commits without synchronously touching its reminder'
);

select ok(
  (
    select bundle.status = 'pending'
      and bundle.last_error_code is null
    from dashboard_private.registration_customer_message_bundles bundle
    join archive_delivery_bundle_fixture fixture
      on fixture.bundle_id = bundle.id
    where fixture.label = 'after_first_archive'
  )
  and (
    select message.error_code is null
      and message.provider_attempt_count = 0
    from public.ops_registration_customer_messages message
    where message.id = '98710000-0000-4000-8000-000000000562'
  ),
  'archiving the last participant leaves the inert provider-zero row untouched'
);

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $$select dashboard_private.sync_registration_customer_reminder_jobs_v1()$$,
  'the retired reminder synchronizer remains a harmless no-op'
);
select is(
  public.claim_registration_customer_reminder_job_v1(),
  null::jsonb,
  'a directly seeded inert reminder is never claimable'
);
select is(
  public.has_registration_customer_reminder_backlog_v1(),
  false,
  'a directly seeded inert reminder never reactivates the automatic backlog'
);
select pg_catalog.set_config('request.jwt.claim.role', '', true);

select ok(
  (
    select job.status = 'pending'
      and job.last_error_code is null
      and job.claim_token is null
      and job.available_at is not null
    from dashboard_private.registration_customer_reminder_jobs job
    where job.job_id = '98710000-0000-4000-8000-000000000501'
  )
  and (
    select message.provider_attempt_count = 0
      and message.provider_attempt_started_at is null
    from public.ops_registration_customer_messages message
    where message.id = '98710000-0000-4000-8000-000000000562'
  )
  and (
    select message.provider_attempt_count = 1
      and message.provider_attempt_started_at is not null
    from public.ops_registration_customer_messages message
    where message.id = '98710000-0000-4000-8000-000000000541'
  ),
  'retired synchronization leaves the inert reminder row and provider-marker uncertainty untouched'
);

select lives_ok(
  $$update public.ops_registration_subject_tracks
    set archived_at = null,
        archived_by = null
    where id = '98710000-0000-4000-8000-000000000202'$$,
  'restoring a subject remains a fact-only successful edit'
);

select ok(
  dashboard_private.registration_appointment_has_active_subject_v1(
    '98710000-0000-4000-8000-000000000301',
    '98710000-0000-4000-8000-000000000101'
  )
  and (
    select job.status = 'pending'
      and job.last_error_code is null
      and job.available_at is not null
      and job.claim_token is null
    from dashboard_private.registration_customer_reminder_jobs job
    where job.job_id = '98710000-0000-4000-8000-000000000501'
  ),
  'restoring a fact leaves the inert reminder state untouched'
);

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $$select dashboard_private.sync_registration_customer_reminder_jobs_v1()$$,
  'the retired reminder synchronizer cannot reactivate work after restore'
);
select pg_catalog.set_config('request.jwt.claim.role', '', true);

select ok(
  (
    select job.status = 'pending'
      and job.last_error_code is null
      and job.available_at is not null
      and job.claim_token is null
    from dashboard_private.registration_customer_reminder_jobs job
    where job.job_id = '98710000-0000-4000-8000-000000000501'
  ),
  'retired synchronization leaves the restored appointment reminder inert'
);

insert into archive_delivery_bundle_fixture(label, bundle_id)
values (
  'after_restore',
  pg_temp.resolve_archive_delivery_bundle_v1(
    'visit_consultation_booking_bundle',
    '98710000-0000-4000-8000-000000000101'
  )
);

select ok(
  (
    select restored.bundle_id = archived.bundle_id
    from archive_delivery_bundle_fixture restored
    cross join archive_delivery_bundle_fixture archived
    where restored.label = 'after_restore'
      and archived.label = 'after_first_archive'
  )
  and (
    select pg_catalog.count(*) = 1
      and pg_catalog.bool_and(item.track_id =
        '98710000-0000-4000-8000-000000000202')
    from dashboard_private.registration_customer_message_bundle_items item
    join archive_delivery_bundle_fixture fixture
      on fixture.bundle_id = item.bundle_id
    where fixture.label = 'after_restore'
  ),
  'restore safely reuses the identical immutable active-subject bundle snapshot'
);

-- A committed reminder fixture is owned by remote sessions so one backend can
-- hold its row lock while another archives the subject.  The fact write must
-- not wait on, update, or otherwise depend on that delivery row.
select dblink_connect(
  'archive_delivery_lock_setup',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=archive_delivery_lock_setup'
);
select dblink_connect(
  'archive_delivery_lock_blocker',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=archive_delivery_lock_blocker'
);
select dblink_connect(
  'archive_delivery_lock_writer',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=archive_delivery_lock_writer'
);

select dblink_exec('archive_delivery_lock_setup', $remote$
  do $archive_delivery_setup$
  begin
    insert into auth.users(
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '98719999-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'archive-delivery-lock@example.invalid',
      crypt('archive-delivery-lock-only', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb, now(), now()
    );
    insert into public.profiles(id, role, name, email, created_at, updated_at)
    values (
      '98719999-0000-4000-8000-000000000001', 'admin',
      '과목 저장 잠금 분리', 'archive-delivery-lock@example.invalid', now(), now()
    )
    on conflict (id) do update
    set role = excluded.role,
        name = excluded.name,
        email = excluded.email,
        updated_at = excluded.updated_at;
    insert into public.ops_tasks(
      id, title, type, status, priority, requested_by, student_name
    ) values (
      '98719999-0000-4000-8000-000000000101',
      '등록: 알림 잠금 분리', 'registration', 'requested', 'normal',
      '98719999-0000-4000-8000-000000000001', '잠금분리학생'
    );
    insert into public.ops_registration_details(task_id, parent_phone)
    values ('98719999-0000-4000-8000-000000000101', '01098719999');
    insert into public.ops_registration_subject_tracks(
      id, task_id, subject, pipeline_status, migration_review_required,
      workflow_status, workflow_revision, director_profile_id,
      director_assignment_source, director_assigned_at
    ) values (
      '98719999-0000-4000-8000-000000000201',
      '98719999-0000-4000-8000-000000000101',
      '영어', 'inquiry', false, 'inquiry', 1,
      '98719999-0000-4000-8000-000000000001', 'manual', now()
    );
    insert into public.ops_registration_appointments(
      id, task_id, kind, scheduled_at, place, status,
      notification_revision, schedule_confirmed_at
    ) values (
      '98719999-0000-4000-8000-000000000301',
      '98719999-0000-4000-8000-000000000101',
      'visit_consultation', now() + interval '7 days', '본관 상담실',
      'scheduled', 1, now() - interval '2 days'
    );
    insert into public.ops_registration_consultations(
      id, track_id, appointment_id, mode, status, director_profile_id
    ) values (
      '98719999-0000-4000-8000-000000000401',
      '98719999-0000-4000-8000-000000000201',
      '98719999-0000-4000-8000-000000000301',
      'visit', 'scheduled', '98719999-0000-4000-8000-000000000001'
    );
    insert into dashboard_private.registration_customer_reminder_jobs(
      job_id, appointment_id, task_id, message_kind, source_revision,
      scheduled_for, due_at, available_at, request_key, status
    ) values (
      '98719999-0000-4000-8000-000000000501',
      '98719999-0000-4000-8000-000000000301',
      '98719999-0000-4000-8000-000000000101',
      'appointment_reminder', 1, now() + interval '7 days',
      now() + interval '6 days', now(),
      '98719999-0000-4000-8000-000000000502', 'pending'
    );
  end;
  $archive_delivery_setup$;
$remote$);

select dblink_exec('archive_delivery_lock_blocker', 'begin');
select dblink_exec('archive_delivery_lock_blocker', $remote$
  do $archive_delivery_blocker$
  begin
    perform job.job_id
    from dashboard_private.registration_customer_reminder_jobs job
    where job.job_id = '98719999-0000-4000-8000-000000000501'
    for update;
    if not found then
      raise exception 'archive_delivery_lock_target_missing';
    end if;
  end;
  $archive_delivery_blocker$;
$remote$);

select dblink_exec('archive_delivery_lock_writer', $remote$
  create or replace function pg_temp.capture_archive_delivery_lock_v1()
  returns text
  language plpgsql
  as $capture$
  begin
    perform pg_catalog.set_config('lock_timeout', '750ms', true);
    begin
      update public.ops_registration_subject_tracks
      set archived_at = pg_catalog.clock_timestamp(),
          archived_by = '98719999-0000-4000-8000-000000000001'
      where id = '98719999-0000-4000-8000-000000000201';
      return '00000';
    exception
      when others then
        return sqlstate;
    end;
  end;
  $capture$;
$remote$);

select is(
  (
    select result.result_sqlstate
    from dblink(
      'archive_delivery_lock_writer',
      'select pg_temp.capture_archive_delivery_lock_v1()'
    ) result(result_sqlstate text)
  ),
  '00000',
  'subject archive commits while its reminder row is locked by another backend'
);

select is(
  (
    select result.state
    from dblink(
      'archive_delivery_lock_setup',
      $remote$select pg_catalog.jsonb_build_object(
        'archived', track.archived_at is not null,
        'jobStatus', job.status,
        'jobError', job.last_error_code
      )::text
      from public.ops_registration_subject_tracks track
      join dashboard_private.registration_customer_reminder_jobs job
        on job.task_id = track.task_id
      where track.id = '98719999-0000-4000-8000-000000000201'
        and job.job_id = '98719999-0000-4000-8000-000000000501'$remote$
    ) result(state text)
  )::jsonb,
  '{"archived":true,"jobError":null,"jobStatus":"pending"}'::jsonb,
  'the lock-independent archive leaves the committed inert reminder row byte-for-byte unchanged'
);

select dblink_exec('archive_delivery_lock_blocker', 'rollback');
select dblink_exec('archive_delivery_lock_setup', $remote$
  do $archive_delivery_cleanup$
  begin
    delete from dashboard_private.registration_customer_reminder_jobs
    where job_id = '98719999-0000-4000-8000-000000000501';
    delete from public.ops_registration_consultations
    where id = '98719999-0000-4000-8000-000000000401';
    delete from public.ops_registration_appointments
    where id = '98719999-0000-4000-8000-000000000301';
    delete from public.ops_registration_subject_tracks
    where id = '98719999-0000-4000-8000-000000000201';
    delete from public.ops_registration_details
    where task_id = '98719999-0000-4000-8000-000000000101';
    delete from public.ops_tasks
    where id = '98719999-0000-4000-8000-000000000101';
    delete from public.profiles
    where id = '98719999-0000-4000-8000-000000000001';
    delete from auth.users
    where id = '98719999-0000-4000-8000-000000000001';
  end;
  $archive_delivery_cleanup$;
$remote$);
select dblink_disconnect('archive_delivery_lock_writer');
select dblink_disconnect('archive_delivery_lock_blocker');
select dblink_disconnect('archive_delivery_lock_setup');

select * from finish();

rollback;
