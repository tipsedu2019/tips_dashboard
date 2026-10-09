begin;

select no_plan();

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

-- These pre-existing legacy fixtures intentionally include overlapping or incomplete
-- schedules. Seal only the fixture baseline; all guards remain active for assertions.
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1()
where transaction_id=txid_current();
set constraints all immediate;


create temp table history_snapshots(state text primary key, observation_id uuid, observation_row jsonb, appointment_row jsonb, reader_before jsonb, reader_after jsonb);
grant all on history_snapshots to authenticated;
select pg_temp.registration_observation_independence_set_actor('99410000-0000-4000-8000-000000000001');
set local role authenticated;
insert into registration_observation_independence_results values ('seed', public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000104',null,null,null,null,'history-seed'));
reset role;

-- Seed one historical state, then freeze the complete rows before the operation.
update public.ops_registration_observations set status='attended_feedback_pending', attendance='attended', attendance_recorded_by='99410000-0000-4000-8000-000000000001', attendance_recorded_at=now()-interval '1 day', suitability_result=null, feedback_reason=null, feedback_submitted_by=null, feedback_submitted_at=null, feedback_revision=0, revision=2, starts_at=now()-interval '1 day 2 hours', ends_at=now()-interval '1 day'
where id=(select (response#>>'{observation,observationId}')::uuid from registration_observation_independence_results where result_key='seed');
update public.ops_registration_appointments set status='completed' where id=(select appointment_id from public.ops_registration_observations where id=(select (response#>>'{observation,observationId}')::uuid from registration_observation_independence_results where result_key='seed'));
insert into history_snapshots(state,observation_id,observation_row,appointment_row)
select 'attended_feedback_pending',o.id,to_jsonb(o),to_jsonb(a) from public.ops_registration_observations o join public.ops_registration_appointments a on a.id=o.appointment_id where o.id=(select (response#>>'{observation,observationId}')::uuid from registration_observation_independence_results where result_key='seed');
set local role authenticated;
update history_snapshots set reader_before=public.get_registration_observation_manager_detail_v1('99410000-0000-4000-8000-000000000116',20) where state='attended_feedback_pending';
select is((select reader_before->'currentObservation' from history_snapshots where state='attended_feedback_pending'),'null'::jsonb,'attended_feedback_pending: reader exposes a fresh booking while preserving history');
select lives_ok($test$insert into registration_observation_independence_results values ('attended_feedback_pending',public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000114',null,null,null,null,'rebook-attended_feedback_pending'))$test$,'attended_feedback_pending: real booking succeeds with no director decision');
update history_snapshots set reader_after=public.get_registration_observation_manager_detail_v1('99410000-0000-4000-8000-000000000116',20) where state='attended_feedback_pending';
select is(public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000114',null,null,null,null,'rebook-attended_feedback_pending'),(select response from registration_observation_independence_results where result_key='attended_feedback_pending'),'attended_feedback_pending: replay returns identical booking');
select throws_ok($test$select public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000104',null,null,null,null,'duplicate-attended_feedback_pending')$test$,'55000','registration_observation_transition_rejected','attended_feedback_pending: duplicate active booking remains denied');
select is((select observation_current_id::text from public.ops_registration_subject_track_summaries where id='99410000-0000-4000-8000-000000000116'),(select reader_after#>>'{currentObservation,observationId}' from history_snapshots where state='attended_feedback_pending'),'attended_feedback_pending: list summary agrees with the new current booking');
reset role;
select ok((select observation_row=to_jsonb(o) and appointment_row=to_jsonb(a) from history_snapshots h join public.ops_registration_observations o on o.id=h.observation_id join public.ops_registration_appointments a on a.id=o.appointment_id where h.state='attended_feedback_pending'),'attended_feedback_pending: complete old observation and appointment unchanged');
select ok((select exists(select 1 from jsonb_array_elements(reader_after->'attempts') a where a->>'observationId'=observation_id::text and a->'decisionKind'='null'::jsonb and a->>'status'='attended_feedback_pending') and reader_after#>>'{currentObservation,status}'='scheduled' from history_snapshots where state='attended_feedback_pending'),'attended_feedback_pending: undecided history and new scheduled attempt read back together');

-- Seed one historical state, then freeze the complete rows before the operation.
update public.ops_registration_observations set status='completed', attendance='attended', attendance_recorded_by='99410000-0000-4000-8000-000000000001', attendance_recorded_at=now()-interval '1 day', suitability_result='fit', feedback_reason='합성 과거 보고', feedback_submitted_by='99410000-0000-4000-8000-000000000003'::uuid, feedback_submitted_at=now()-interval '1 day', feedback_revision=1, revision=2, starts_at=now()-interval '1 day 2 hours', ends_at=now()-interval '1 day'
where id=(select (response#>>'{observation,observationId}')::uuid from registration_observation_independence_results where result_key='attended_feedback_pending');
update public.ops_registration_appointments set status='completed' where id=(select appointment_id from public.ops_registration_observations where id=(select (response#>>'{observation,observationId}')::uuid from registration_observation_independence_results where result_key='attended_feedback_pending'));
insert into history_snapshots(state,observation_id,observation_row,appointment_row)
select 'completed',o.id,to_jsonb(o),to_jsonb(a) from public.ops_registration_observations o join public.ops_registration_appointments a on a.id=o.appointment_id where o.id=(select (response#>>'{observation,observationId}')::uuid from registration_observation_independence_results where result_key='attended_feedback_pending');
set local role authenticated;
update history_snapshots set reader_before=public.get_registration_observation_manager_detail_v1('99410000-0000-4000-8000-000000000116',20) where state='completed';
select is((select reader_before->'currentObservation' from history_snapshots where state='completed'),'null'::jsonb,'completed: reader exposes a fresh booking while preserving history');
select lives_ok($test$insert into registration_observation_independence_results values ('completed',public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000114',null,null,null,null,'rebook-completed'))$test$,'completed: real booking succeeds with no director decision');
update history_snapshots set reader_after=public.get_registration_observation_manager_detail_v1('99410000-0000-4000-8000-000000000116',20) where state='completed';
select is(public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000114',null,null,null,null,'rebook-completed'),(select response from registration_observation_independence_results where result_key='completed'),'completed: replay returns identical booking');
select throws_ok($test$select public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000104',null,null,null,null,'duplicate-completed')$test$,'55000','registration_observation_transition_rejected','completed: duplicate active booking remains denied');
select is((select observation_current_id::text from public.ops_registration_subject_track_summaries where id='99410000-0000-4000-8000-000000000116'),(select reader_after#>>'{currentObservation,observationId}' from history_snapshots where state='completed'),'completed: list summary agrees with the new current booking');
reset role;
select ok((select observation_row=to_jsonb(o) and appointment_row=to_jsonb(a) from history_snapshots h join public.ops_registration_observations o on o.id=h.observation_id join public.ops_registration_appointments a on a.id=o.appointment_id where h.state='completed'),'completed: complete old observation and appointment unchanged');
select ok((select exists(select 1 from jsonb_array_elements(reader_after->'attempts') a where a->>'observationId'=observation_id::text and a->'decisionKind'='null'::jsonb and a->>'status'='completed') and reader_after#>>'{currentObservation,status}'='scheduled' from history_snapshots where state='completed'),'completed: undecided history and new scheduled attempt read back together');

-- Seed one historical state, then freeze the complete rows before the operation.
update public.ops_registration_observations set status='no_show', attendance='no_show', attendance_recorded_by='99410000-0000-4000-8000-000000000001', attendance_recorded_at=now()-interval '1 day', suitability_result=null, feedback_reason=null, feedback_submitted_by=null, feedback_submitted_at=null, feedback_revision=0, revision=2, starts_at=now()-interval '1 day 2 hours', ends_at=now()-interval '1 day'
where id=(select (response#>>'{observation,observationId}')::uuid from registration_observation_independence_results where result_key='completed');
update public.ops_registration_appointments set status='completed' where id=(select appointment_id from public.ops_registration_observations where id=(select (response#>>'{observation,observationId}')::uuid from registration_observation_independence_results where result_key='completed'));
insert into history_snapshots(state,observation_id,observation_row,appointment_row)
select 'no_show',o.id,to_jsonb(o),to_jsonb(a) from public.ops_registration_observations o join public.ops_registration_appointments a on a.id=o.appointment_id where o.id=(select (response#>>'{observation,observationId}')::uuid from registration_observation_independence_results where result_key='completed');
set local role authenticated;
update history_snapshots set reader_before=public.get_registration_observation_manager_detail_v1('99410000-0000-4000-8000-000000000116',20) where state='no_show';
select is((select reader_before->'currentObservation' from history_snapshots where state='no_show'),'null'::jsonb,'no_show: reader exposes a fresh booking while preserving history');
select lives_ok($test$insert into registration_observation_independence_results values ('no_show',public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000114',null,null,null,null,'rebook-no_show'))$test$,'no_show: real booking succeeds with no director decision');
update history_snapshots set reader_after=public.get_registration_observation_manager_detail_v1('99410000-0000-4000-8000-000000000116',20) where state='no_show';
select is(public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000114',null,null,null,null,'rebook-no_show'),(select response from registration_observation_independence_results where result_key='no_show'),'no_show: replay returns identical booking');
select throws_ok($test$select public.save_registration_observation_booking_v1('99410000-0000-4000-8000-000000000116',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000104',null,null,null,null,'duplicate-no_show')$test$,'55000','registration_observation_transition_rejected','no_show: duplicate active booking remains denied');
select is((select observation_current_id::text from public.ops_registration_subject_track_summaries where id='99410000-0000-4000-8000-000000000116'),(select reader_after#>>'{currentObservation,observationId}' from history_snapshots where state='no_show'),'no_show: list summary agrees with the new current booking');
reset role;
select ok((select observation_row=to_jsonb(o) and appointment_row=to_jsonb(a) from history_snapshots h join public.ops_registration_observations o on o.id=h.observation_id join public.ops_registration_appointments a on a.id=o.appointment_id where h.state='no_show'),'no_show: complete old observation and appointment unchanged');
select ok((select exists(select 1 from jsonb_array_elements(reader_after->'attempts') a where a->>'observationId'=observation_id::text and a->'decisionKind'='null'::jsonb and a->>'status'='no_show') and reader_after#>>'{currentObservation,status}'='scheduled' from history_snapshots where state='no_show'),'no_show: undecided history and new scheduled attempt read back together');

select is((select count(*) from public.ops_registration_observations where track_id='99410000-0000-4000-8000-000000000116' and status='scheduled'),1::bigint,'one scheduled attempt after all historical rebookings');
select is((select count(*) from public.ops_registration_observations where track_id='99410000-0000-4000-8000-000000000116' and decision_kind is not null),0::bigint,'no decision was fabricated');
-- Producer-shaped payloads consumed by the editor integration test; synthetic only.
select 'READER_FIXTURES:'||jsonb_agg(jsonb_build_object('state',state,'before',reader_before,'after',reader_after) order by state)::text from history_snapshots;
select * from finish();
rollback;
