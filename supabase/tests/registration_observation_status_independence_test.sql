begin;

select plan(27);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '99410000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'observation-independence-admin@example.invalid',
    crypt('observation-independence-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  ),
  (
    '99410000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'observation-independence-teacher@example.invalid',
    crypt('observation-independence-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '99410000-0000-4000-8000-000000000001', 'admin',
    '청강 상태분리 관리자',
    'observation-independence-admin@example.invalid', now(), now()
  ),
  (
    '99410000-0000-4000-8000-000000000003', 'teacher',
    '청강 상태분리 담당강사',
    'observation-independence-teacher@example.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id = '99410000-0000-4000-8000-000000000003';

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email,
  dashboard_role
)
values (
  '99410000-0000-4000-8000-000000000101', '청강 상태분리 담당강사',
  array['영어']::text[], true, 9941,
  '99410000-0000-4000-8000-000000000003',
  'observation-independence-teacher@example.invalid', 'teacher'
);

update public.profiles
set teacher_catalog_id = '99410000-0000-4000-8000-000000000101'
where id = '99410000-0000-4000-8000-000000000003';

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  '99410000-0000-4000-8000-000000000102', '청강 상태분리 101호',
  array['영어']::text[], true, 9942, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
values (
  '99410000-0000-4000-8000-000000000103', '청강 상태분리 영어반',
  '영어', '수업 진행 중', 'normalized', '{"sessions":[]}'::jsonb
);

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '99410000-0000-4000-8000-000000000103',
    '99410000-0000-4000-8000-000000000111',
    'registration_observation_status_independence_test'
  );
end;
$$;

insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state,
  start_time, end_time, teacher_catalog_id, teacher_name_snapshot,
  classroom_catalog_id, classroom_name_snapshot, origin, revision
)
values
  (
    '99410000-0000-4000-8000-000000000104',
    '99410000-0000-4000-8000-000000000103',
    'observation-independence-session-a', current_date + 7, 'active',
    '18:00', '20:00',
    '99410000-0000-4000-8000-000000000101', '청강 상태분리 담당강사',
    '99410000-0000-4000-8000-000000000102', '청강 상태분리 101호',
    'manual', 1
  ),
  (
    '99410000-0000-4000-8000-000000000114',
    '99410000-0000-4000-8000-000000000103',
    'observation-independence-session-b', current_date + 14, 'active',
    '19:00', '21:00',
    '99410000-0000-4000-8000-000000000101', '청강 상태분리 담당강사',
    '99410000-0000-4000-8000-000000000102', '청강 상태분리 101호',
    'manual', 2
  );

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values
  (
    '99410000-0000-4000-8000-000000000105',
    '청강 상태분리 enter fixture', 'registration', 'requested', 'normal',
    '99410000-0000-4000-8000-000000000001', '합성 상태분리학생1'
  ),
  (
    '99410000-0000-4000-8000-000000000115',
    '청강 상태분리 booking fixture', 'registration', 'requested', 'normal',
    '99410000-0000-4000-8000-000000000001', '합성 상태분리학생2'
  );

insert into public.ops_registration_details(task_id)
values
  ('99410000-0000-4000-8000-000000000105'),
  ('99410000-0000-4000-8000-000000000115');

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values
  (
    '99410000-0000-4000-8000-000000000106',
    '99410000-0000-4000-8000-000000000105',
    '영어', 'consultation_waiting',
    '99410000-0000-4000-8000-000000000003', 'manual', now(), false,
    'inquiry', 9, now(), null, 0
  ),
  (
    '99410000-0000-4000-8000-000000000116',
    '99410000-0000-4000-8000-000000000115',
    '영어', 'consultation_waiting',
    '99410000-0000-4000-8000-000000000003', 'manual', now(), false,
    'registered', 12, now(), null, 0
  );

create or replace function pg_temp.registration_observation_independence_set_actor(
  p_actor uuid
)
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

create temporary table registration_observation_independence_results(
  result_key text primary key,
  response jsonb not null
) on commit drop;
grant all on registration_observation_independence_results to authenticated;

insert into dashboard_private.registration_observation_runtime_settings(
  singleton, activation_version, updated_at, updated_by
)
values (
  true, 1, now(), '99410000-0000-4000-8000-000000000001'
)
on conflict (singleton) do update
set activation_version = excluded.activation_version,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

-- The isolated reviewed baseline is schema-only for notification control-plane
-- rows. Keep the real domain-event materializer active, but provide disabled
-- rules so booking/rescheduling/canceling can exercise their event boundary
-- without preparing or sending any notification.
set constraints all deferred;

with seed(rule_id, template_id, event_key) as (
  values
    (
      '99410000-0000-4000-8000-000000000301'::uuid,
      '99410000-0000-4000-8000-000000000401'::uuid,
      'registration.observation_scheduled'::text
    ),
    (
      '99410000-0000-4000-8000-000000000302'::uuid,
      '99410000-0000-4000-8000-000000000402'::uuid,
      'registration.observation_rescheduled'::text
    ),
    (
      '99410000-0000-4000-8000-000000000303'::uuid,
      '99410000-0000-4000-8000-000000000403'::uuid,
      'registration.observation_canceled'::text
    ),
    (
      '99410000-0000-4000-8000-000000000304'::uuid,
      '99410000-0000-4000-8000-000000000404'::uuid,
      'registration.observation_reminder_due'::text
    ),
    (
      '99410000-0000-4000-8000-000000000305'::uuid,
      '99410000-0000-4000-8000-000000000405'::uuid,
      'registration.observation_feedback_due'::text
    )
)
insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  enabled, active_template_id, revision,
  created_by, created_actor_kind, updated_by, updated_actor_kind
)
select
  seed.rule_id, 'global', 'registration', seed.event_key,
  'google_chat', 'subject_team', 'immediate', 'immediate', null, null,
  false, seed.template_id, 1, null, 'system', null, 'system'
from seed
where not exists (
  select 1
  from dashboard_private.notification_rules rule
  where rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = seed.event_key
);

with seed(rule_id, template_id) as (
  values
    (
      '99410000-0000-4000-8000-000000000301'::uuid,
      '99410000-0000-4000-8000-000000000401'::uuid
    ),
    (
      '99410000-0000-4000-8000-000000000302'::uuid,
      '99410000-0000-4000-8000-000000000402'::uuid
    ),
    (
      '99410000-0000-4000-8000-000000000303'::uuid,
      '99410000-0000-4000-8000-000000000403'::uuid
    ),
    (
      '99410000-0000-4000-8000-000000000304'::uuid,
      '99410000-0000-4000-8000-000000000404'::uuid
    ),
    (
      '99410000-0000-4000-8000-000000000305'::uuid,
      '99410000-0000-4000-8000-000000000405'::uuid
    )
)
insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind
)
select
  seed.template_id, seed.rule_id, 1,
  '청강 상태분리 테스트', '비활성 규칙 테스트', '[]'::jsonb, 3,
  dashboard_private.notification_seed_template_checksum_v1(
    '청강 상태분리 테스트', '비활성 규칙 테스트', '[]'::jsonb, 3
  ),
  null, 'system'
from seed
where exists (
  select 1
  from dashboard_private.notification_rules rule
  where rule.id = seed.rule_id
)
and not exists (
  select 1
  from dashboard_private.notification_templates template
  where template.id = seed.template_id
);

set constraints all immediate;

select function_returns(
  'public', 'enter_registration_observation_v1',
  array['uuid','integer','text'], 'jsonb'
);
select function_returns(
  'public', 'save_registration_observation_booking_v1',
  array['uuid','uuid','uuid','text','uuid','text','integer','integer','bigint','text'],
  'jsonb'
);
select function_returns(
  'public', 'cancel_registration_observation_v1',
  array['uuid','integer','bigint','text'], 'jsonb'
);

select ok(
  (
    select pg_catalog.bool_and(
      not procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.proconfig in (
        array['search_path=']::text[], array['search_path=""']::text[]
      )
    )
    from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'public.enter_registration_observation_v1(uuid,integer,text)'::regprocedure,
      'public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)'::regprocedure,
      'public.cancel_registration_observation_v1(uuid,integer,bigint,text)'::regprocedure
    )
  ),
  'public observation mutation wrappers remain postgres-owned fixed-path security invokers'
);

select ok(
  (
    select pg_catalog.bool_and(
      procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.proconfig in (
        array['search_path=']::text[], array['search_path=""']::text[]
      )
    )
    from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'dashboard_private.enter_registration_observation_v1_impl(uuid,integer,text)'::regprocedure,
      'dashboard_private.save_registration_observation_booking_v1_impl(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)'::regprocedure,
      'dashboard_private.cancel_registration_observation_v1_impl(uuid,integer,bigint,text)'::regprocedure
    )
  ),
  'private observation mutation implementations remain postgres-owned fixed-path security definers'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.enter_registration_observation_v1(uuid,integer,text)', 'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.cancel_registration_observation_v1(uuid,integer,bigint,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.enter_registration_observation_v1(uuid,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)',
    'EXECUTE'
  ),
  'public observation mutation ACL stays authenticated-only'
);

select ok(
  has_function_privilege(
    'authenticated',
    'dashboard_private.enter_registration_observation_v1_impl(uuid,integer,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'dashboard_private.save_registration_observation_booking_v1_impl(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'dashboard_private.cancel_registration_observation_v1_impl(uuid,integer,bigint,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'dashboard_private.enter_registration_observation_v1_impl(uuid,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'dashboard_private.cancel_registration_observation_v1_impl(uuid,integer,bigint,text)',
    'EXECUTE'
  ),
  'private observation implementation ACL preserves the reviewed authenticated boundary'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'dashboard_private.withdraw_registration_observation_v1_impl(uuid,text,text,uuid,integer,bigint,bigint,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'dashboard_private.withdraw_registration_observation_v1_impl(uuid,text,text,uuid,integer,bigint,bigint,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'dashboard_private.withdraw_registration_observation_v1_impl(uuid,text,text,uuid,integer,bigint,bigint,text,text)',
    'EXECUTE'
  )
  and (
    select pg_catalog.bool_and(
      not procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.proconfig in (
        array['search_path=']::text[], array['search_path=""']::text[]
      )
    )
    from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)'::regprocedure,
      'dashboard_private.withdraw_registration_observation_v1_impl(uuid,text,text,uuid,integer,bigint,bigint,text,text)'::regprocedure
    )
  ),
  'legacy combined withdraw RPC is fixed-path owner-only and has no caller grant'
);

select throws_ok(
  $$
    select dashboard_private.withdraw_registration_observation_v1_impl(
      null::uuid, null::text, null::text, null::uuid, null::integer,
      null::bigint, null::bigint, null::text, null::text
    )
  $$,
  '55000',
  'registration_observation_withdraw_retired',
  'owner-only withdraw compatibility implementation rejects the coupled mutation'
);

select pg_temp.registration_observation_independence_set_actor(
  '99410000-0000-4000-8000-000000000001'
);
set local role authenticated;

insert into registration_observation_independence_results(result_key, response)
select 'enter-stale', public.enter_registration_observation_v1(
  '99410000-0000-4000-8000-000000000106', 999, 'independent-enter-stale'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'responseStatus', result.response ->> 'workflowStatus',
      'responseRevision', (result.response ->> 'workflowRevision')::integer,
      'changed', (result.response ->> 'changed')::boolean,
      'status', track.workflow_status,
      'revision', track.workflow_revision,
      'returnStatus', track.observation_return_workflow_status,
      'eventCount', (
        select pg_catalog.count(*)
        from public.ops_task_events event
        where event.task_id = track.task_id
      ),
      'receiptCount', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.request_key = 'independent-enter-stale'
      )
    )
    from public.ops_registration_subject_tracks track
    join registration_observation_independence_results result
      on result.result_key = 'enter-stale'
    where track.id = '99410000-0000-4000-8000-000000000106'
  ),
  '{"responseStatus":"inquiry","responseRevision":9,"changed":false,"status":"inquiry","revision":9,"returnStatus":null,"eventCount":0,"receiptCount":1}'::jsonb,
  'enter is a compatibility no-op even with a stale workflow revision'
);

set local role authenticated;
select is(
  public.enter_registration_observation_v1(
    '99410000-0000-4000-8000-000000000106',
    999,
    'independent-enter-stale'
  ),
  (
    select result.response
    from registration_observation_independence_results result
    where result.result_key = 'enter-stale'
  ),
  'enter replays its byte-identical no-op receipt'
);

insert into registration_observation_independence_results(result_key, response)
select 'enter-null', public.enter_registration_observation_v1(
  '99410000-0000-4000-8000-000000000106', null, 'independent-enter-null'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'changed', (result.response ->> 'changed')::boolean,
      'status', track.workflow_status,
      'revision', track.workflow_revision,
      'eventCount', (
        select pg_catalog.count(*)
        from public.ops_task_events event
        where event.task_id = track.task_id
      ),
      'receiptCount', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.track_id = track.id
          and request.operation = 'enter'
      )
    )
    from public.ops_registration_subject_tracks track
    join registration_observation_independence_results result
      on result.result_key = 'enter-null'
    where track.id = '99410000-0000-4000-8000-000000000106'
  ),
  '{"changed":false,"status":"inquiry","revision":9,"eventCount":0,"receiptCount":2}'::jsonb,
  'enter accepts no workflow revision because workflow status is not its domain'
);

set local role authenticated;
insert into registration_observation_independence_results(result_key, response)
select 'book', public.save_registration_observation_booking_v1(
  '99410000-0000-4000-8000-000000000116', null,
  '99410000-0000-4000-8000-000000000103', 'normalized',
  '99410000-0000-4000-8000-000000000104', null,
  null, null, null, 'independent-book'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', track.workflow_status,
      'revision', track.workflow_revision,
      'returnStatus', track.observation_return_workflow_status,
      'attempts', track.observation_attempt_count,
      'observationStatus', observation.status,
      'observationRevision', observation.revision,
      'appointmentStatus', appointment.status,
      'notificationRevision', appointment.notification_revision,
      'domainEvents', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
          and event.event_kind = 'observation_scheduled'
      ),
      'trackEvents', (
        select pg_catalog.count(*)
        from public.ops_task_events event
        where event.task_id = track.task_id
      )
    )
    from registration_observation_independence_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    where result.result_key = 'book'
  ),
  '{"status":"registered","revision":12,"returnStatus":null,"attempts":1,"observationStatus":"scheduled","observationRevision":1,"appointmentStatus":"scheduled","notificationRevision":1,"domainEvents":1,"trackEvents":1}'::jsonb,
  'booking saves facts and receipts without reading or changing manual workflow status'
);

set local role authenticated;
select is(
  public.save_registration_observation_booking_v1(
    '99410000-0000-4000-8000-000000000116', null,
    '99410000-0000-4000-8000-000000000103', 'normalized',
    '99410000-0000-4000-8000-000000000104', null,
    null, null, null, 'independent-book'
  ),
  (
    select result.response
    from registration_observation_independence_results result
    where result.result_key = 'book'
  ),
  'booking replays its byte-identical receipt'
);

select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99410000-0000-4000-8000-000000000116', null,
    '99410000-0000-4000-8000-000000000103', 'normalized',
    '99410000-0000-4000-8000-000000000114', null,
    null, null, null, 'independent-book-duplicate'
  )$$,
  '55000', 'registration_observation_transition_rejected',
  'a second active observation remains rejected independently of workflow status'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'attempts', track.observation_attempt_count,
      'observations', (
        select pg_catalog.count(*)
        from public.ops_registration_observations observation
        where observation.track_id = track.id
      ),
      'appointments', (
        select pg_catalog.count(*)
        from public.ops_registration_appointments appointment
        where appointment.task_id = track.task_id
          and appointment.kind = 'observation_class'
      ),
      'duplicateReceipts', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.request_key = 'independent-book-duplicate'
      )
    )
    from public.ops_registration_subject_tracks track
    where track.id = '99410000-0000-4000-8000-000000000116'
  ),
  '{"attempts":1,"observations":1,"appointments":1,"duplicateReceipts":0}'::jsonb,
  'active duplicate rejection leaves booking facts and receipts unchanged'
);

set local role authenticated;
select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99410000-0000-4000-8000-000000000116',
    (
      select (result.response -> 'observation' ->> 'observationId')::uuid
      from registration_observation_independence_results result
      where result.result_key = 'book'
    ),
    '99410000-0000-4000-8000-000000000103', 'normalized',
    '99410000-0000-4000-8000-000000000114', null,
    null, 1, 99, 'independent-reschedule-observation-stale'
  )$$,
  '23514', 'registration_observation_stale_revision',
  'stale observation revisions are non-retryable domain conflicts'
);

select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99410000-0000-4000-8000-000000000116',
    (
      select (result.response -> 'observation' ->> 'observationId')::uuid
      from registration_observation_independence_results result
      where result.result_key = 'book'
    ),
    '99410000-0000-4000-8000-000000000103', 'normalized',
    '99410000-0000-4000-8000-000000000114', null,
    null, 99, 1, 'independent-reschedule-notification-stale'
  )$$,
  '23514', 'registration_observation_stale_revision',
  'stale appointment revisions are non-retryable domain conflicts'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'observationRevision', observation.revision,
      'notificationRevision', appointment.notification_revision,
      'domainEvents', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      ),
      'staleReceipts', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.request_key in (
          'independent-reschedule-observation-stale',
          'independent-reschedule-notification-stale'
        )
      )
    )
    from registration_observation_independence_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    where result.result_key = 'book'
  ),
  '{"observationRevision":1,"notificationRevision":1,"domainEvents":1,"staleReceipts":0}'::jsonb,
  'stale reschedules leave facts events and receipts unchanged'
);

set local role authenticated;
insert into registration_observation_independence_results(result_key, response)
select 'reschedule', public.save_registration_observation_booking_v1(
  '99410000-0000-4000-8000-000000000116',
  (
    select (result.response -> 'observation' ->> 'observationId')::uuid
    from registration_observation_independence_results result
    where result.result_key = 'book'
  ),
  '99410000-0000-4000-8000-000000000103', 'normalized',
  '99410000-0000-4000-8000-000000000114', null,
  null, 1, 1, 'independent-reschedule'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'changed', (result.response ->> 'changed')::boolean,
      'status', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'observationRevision', observation.revision,
      'notificationRevision', appointment.notification_revision,
      'sessionId', observation.class_lesson_session_id,
      'domainEvents', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      )
    )
    from registration_observation_independence_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    where result.result_key = 'reschedule'
  ),
  '{"changed":true,"status":"registered","workflowRevision":12,"observationRevision":2,"notificationRevision":2,"sessionId":"99410000-0000-4000-8000-000000000114","domainEvents":2}'::jsonb,
  'rescheduling changes only booking-domain revisions and facts'
);

set local role authenticated;
select throws_ok(
  $$select public.cancel_registration_observation_v1(
    (
      select (result.response -> 'observation' ->> 'observationId')::uuid
      from registration_observation_independence_results result
      where result.result_key = 'book'
    ),
    2, 1, 'independent-cancel-stale'
  )$$,
  '23514', 'registration_observation_stale_revision',
  'stale cancel revisions are non-retryable domain conflicts'
);

insert into registration_observation_independence_results(result_key, response)
select 'cancel', public.cancel_registration_observation_v1(
  (
    select (result.response -> 'observation' ->> 'observationId')::uuid
    from registration_observation_independence_results result
    where result.result_key = 'book'
  ),
  2, 2, 'independent-cancel'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'observationStatus', observation.status,
      'observationRevision', observation.revision,
      'appointmentStatus', appointment.status,
      'notificationRevision', appointment.notification_revision,
      'domainEvents', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      )
    )
    from registration_observation_independence_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    join public.ops_registration_subject_tracks track
      on track.id = observation.track_id
    where result.result_key = 'cancel'
  ),
  '{"status":"registered","workflowRevision":12,"observationStatus":"canceled","observationRevision":3,"appointmentStatus":"canceled","notificationRevision":3,"domainEvents":3}'::jsonb,
  'cancel is allowed without a workflow-state gate and leaves manual status unchanged'
);

set local role authenticated;
select throws_ok(
  $$select public.save_registration_observation_booking_v1(
    '99410000-0000-4000-8000-000000000116',
    (
      select (result.response -> 'observation' ->> 'observationId')::uuid
      from registration_observation_independence_results result
      where result.result_key = 'book'
    ),
    '99410000-0000-4000-8000-000000000103', 'normalized',
    '99410000-0000-4000-8000-000000000104', null,
    null, 3, 3, 'independent-terminal-reschedule'
  )$$,
  '55000', 'registration_observation_transition_rejected',
  'terminal observations remain protected from rescheduling'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'observationRevision', observation.revision,
      'notificationRevision', appointment.notification_revision,
      'domainEvents', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_domain_events event
        where event.observation_id = observation.id
      ),
      'terminalReceipts', (
        select pg_catalog.count(*)
        from dashboard_private.registration_observation_mutation_requests request
        where request.request_key = 'independent-terminal-reschedule'
      )
    )
    from registration_observation_independence_results result
    join public.ops_registration_observations observation
      on observation.id = (result.response -> 'observation' ->> 'observationId')::uuid
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
    where result.result_key = 'book'
  ),
  '{"observationRevision":3,"notificationRevision":3,"domainEvents":3,"terminalReceipts":0}'::jsonb,
  'terminal reschedule rejection leaves domain state and receipts unchanged'
);

select ok(
  (
    select pg_catalog.bool_and(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
        !~ 'set[[:space:]]+workflow_status'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
        !~ 'workflow_revision[[:space:]]*='
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
        !~ 'v_track\.workflow_status[[:space:]]*<>'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
        !~ 'v_track\.workflow_revision[[:space:]]*<>'
    )
    from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'dashboard_private.enter_registration_observation_v1_impl(uuid,integer,text)'::regprocedure,
      'dashboard_private.save_registration_observation_booking_v1_impl(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)'::regprocedure,
      'dashboard_private.cancel_registration_observation_v1_impl(uuid,integer,bigint,text)'::regprocedure
    )
  ),
  'final observation definitions neither gate on nor mutate manual workflow status revisions'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'dashboard_private.enter_registration_observation_v1_impl(uuid,integer,text)'::regprocedure,
      'dashboard_private.save_registration_observation_booking_v1_impl(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)'::regprocedure,
      'dashboard_private.cancel_registration_observation_v1_impl(uuid,integer,bigint,text)'::regprocedure
    )
      and pg_catalog.pg_get_functiondef(procedure.oid) like '%40001%'
  ),
  'observation domain conflicts are never manually mislabeled as serialization failures'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.enter_registration_observation_v1(uuid,integer,text)'::regprocedure
  ) like '%dashboard_private.enter_registration_observation_v1_impl%'
  and pg_catalog.pg_get_functiondef(
    'public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)'::regprocedure
  ) like '%dashboard_private.save_registration_observation_booking_v1_impl%'
  and pg_catalog.pg_get_functiondef(
    'public.cancel_registration_observation_v1(uuid,integer,bigint,text)'::regprocedure
  ) like '%dashboard_private.cancel_registration_observation_v1_impl%',
  'public wrappers retain exact delegation to the reviewed private implementations'
);

select * from finish();
rollback;
