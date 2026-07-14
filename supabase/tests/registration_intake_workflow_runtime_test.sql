begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

-- This packet is self-contained and rolls every auth, catalog, workflow, event,
-- readiness, receipt, and fault-injection fixture back at the end.
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '10000000-0000-4000-8000-000000007001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'intake-admin@registration-runtime.invalid',
    crypt('registration-intake-runtime-only', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-intake-runtime"}'::jsonb, now(), now()
  ),
  (
    '10000000-0000-4000-8000-000000007002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'intake-english-director@registration-runtime.invalid',
    crypt('registration-intake-runtime-only', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-intake-runtime"}'::jsonb, now(), now()
  ),
  (
    '10000000-0000-4000-8000-000000007003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'intake-math-director@registration-runtime.invalid',
    crypt('registration-intake-runtime-only', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-intake-runtime"}'::jsonb, now(), now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '10000000-0000-4000-8000-000000007001', 'admin', '초기등록 런타임 관리자',
    'intake-admin@registration-runtime.invalid', now(), now()
  ),
  (
    '10000000-0000-4000-8000-000000007002', 'admin', '강부희',
    'intake-english-director@registration-runtime.invalid', now(), now()
  ),
  (
    '10000000-0000-4000-8000-000000007003', 'admin', '강정은',
    'intake-math-director@registration-runtime.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

update public.profiles
set teacher_catalog_id = null,
    updated_at = now()
where id in (
  '10000000-0000-4000-8000-000000007001',
  '10000000-0000-4000-8000-000000007002',
  '10000000-0000-4000-8000-000000007003'
);
delete from public.teacher_catalogs
where profile_id in (
  '10000000-0000-4000-8000-000000007001',
  '10000000-0000-4000-8000-000000007002',
  '10000000-0000-4000-8000-000000007003'
);

-- Make the server resolver deterministic without changing persistent catalog data.
update public.teacher_catalogs
set name = name || ' [intake-runtime-shadow-' || pg_catalog.left(id::text, 8) || ']'
where name in ('강부희', '강정은');

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order,
  profile_id, account_email, dashboard_role
)
values
  (
    '10000000-0000-4000-8000-000000007102', '강부희', array['영어'], true, 9702,
    '10000000-0000-4000-8000-000000007002',
    'intake-english-director@registration-runtime.invalid', 'admin'
  ),
  (
    '10000000-0000-4000-8000-000000007103', '강정은', array['수학'], true, 9703,
    '10000000-0000-4000-8000-000000007003',
    'intake-math-director@registration-runtime.invalid', 'admin'
  );

update public.profiles profile
set teacher_catalog_id = fixture.teacher_catalog_id,
    updated_at = now()
from (
  values
    (
      '10000000-0000-4000-8000-000000007002'::uuid,
      '10000000-0000-4000-8000-000000007102'::uuid
    ),
    (
      '10000000-0000-4000-8000-000000007003'::uuid,
      '10000000-0000-4000-8000-000000007103'::uuid
    )
) fixture(profile_id, teacher_catalog_id)
where profile.id = fixture.profile_id;

create or replace function pg_temp.registration_intake_set_actor(p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (select profile.email from public.profiles profile where profile.id = p_actor)
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.registration_intake_throws(
  p_sql text,
  p_message_pattern text
)
returns boolean
language plpgsql
volatile
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm ~ p_message_pattern;
end;
$$;

create temporary table registration_intake_runtime_cases (
  case_key text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update on registration_intake_runtime_cases to authenticated;

create or replace function pg_temp.registration_intake_create(
  p_student_name text,
  p_parent_phone text,
  p_subjects text[],
  p_subject_plans jsonb,
  p_level_test_appointment jsonb,
  p_visit_appointment jsonb,
  p_request_key text
)
returns jsonb
language sql
volatile
as $$
  select public.create_registration_case_with_initial_workflow_v1(
    p_student_name,
    '중1',
    '초기등록런타임중',
    p_parent_phone,
    null,
    '본관',
    '2026-07-13 09:30+09'::timestamptz,
    p_subjects,
    'registration intake runtime',
    'normal',
    p_subject_plans,
    p_level_test_appointment,
    p_visit_appointment,
    '{}'::jsonb,
    p_request_key
  );
$$;

create or replace function pg_temp.registration_intake_track(
  p_case_key text,
  p_subject text
)
returns uuid
language sql
stable
as $$
  select (track.value ->> 'id')::uuid
  from registration_intake_runtime_cases fixture
  cross join lateral pg_catalog.jsonb_array_elements(fixture.payload -> 'tracks') track(value)
  where fixture.case_key = p_case_key
    and track.value ->> 'subject' = p_subject;
$$;

set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);

-- Inquiry-only initial plan.
insert into registration_intake_runtime_cases(case_key, payload)
select 'inquiry_only', pg_temp.registration_intake_create(
  '초기문의전용', '01077000001', array['영어'],
  '{"영어":"inquiry"}'::jsonb, null, null, 'intake-inquiry-only'
);
select ok(
  (
    select fixture.payload ->> 'commonRevision' = '1'
      and fixture.payload -> 'subjects' = '["영어"]'::jsonb
      and pg_catalog.jsonb_array_length(fixture.payload -> 'tracks') = 1
      and pg_catalog.jsonb_array_length(fixture.payload -> 'appointments') = 0
      and pg_catalog.jsonb_array_length(fixture.payload -> 'notificationTargets') = 0
    from registration_intake_runtime_cases fixture
    where fixture.case_key = 'inquiry_only'
  )
  and (
    select track.pipeline_status = 'inquiry'
      and not exists (
        select 1 from public.ops_registration_level_tests attempt
        where attempt.track_id = track.id
      )
      and not exists (
        select 1 from public.ops_registration_consultations consultation
        where consultation.track_id = track.id
      )
    from public.ops_registration_subject_tracks track
    where track.id = pg_temp.registration_intake_track('inquiry_only', '영어')
  ),
  'inquiry-only atomic intake leaves one independent inquiry track'
);

-- Malformed historical evidence is unavailable, so timestamp fallback stays safe.
set local role postgres;
insert into public.ops_task_events(
  task_id, actor_id, event_type, field_name, before_value, after_value
)
values
  (
    (select (payload ->> 'taskId')::uuid
     from registration_intake_runtime_cases where case_key = 'inquiry_only'),
    '10000000-0000-4000-8000-000000007001',
    'registration_track_event',
    'intake_malformed_json_evidence',
    null,
    '{not-json'
  ),
  (
    (select (payload ->> 'taskId')::uuid
     from registration_intake_runtime_cases where case_key = 'inquiry_only'),
    '10000000-0000-4000-8000-000000007001',
    'registration_track_event',
    'intake_malformed_timestamp_evidence',
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'eventType', 'appointment_canceled',
      'trackId', pg_temp.registration_intake_track('inquiry_only', '영어'),
      'occurredAt', 'not-a-timestamp',
      'metadata', pg_catalog.jsonb_build_object(
        'phoneConsultationId', '10000000-0000-4000-8000-000000007999'
      )
    )::text
  );
select ok(
  (
    select dashboard_private.try_registration_event_jsonb_object(event.after_value) is null
    from public.ops_task_events event
    where event.field_name = 'intake_malformed_json_evidence'
  )
  and (
    select parsed.payload is not null
      and dashboard_private.try_registration_event_timestamptz(
        parsed.payload ->> 'occurredAt'
      ) is null
      and coalesce(
        dashboard_private.try_registration_event_timestamptz(
          parsed.payload ->> 'occurredAt'
        ),
        event.created_at
      ) = event.created_at
    from public.ops_task_events event
    cross join lateral (
      select dashboard_private.try_registration_event_jsonb_object(event.after_value) as payload
    ) parsed
    where event.field_name = 'intake_malformed_timestamp_evidence'
  ),
  'malformed historical event evidence is ignored and falls back safely'
);
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);

-- Level-test-only initial plan.
insert into registration_intake_runtime_cases(case_key, payload)
select 'level_test_only', pg_temp.registration_intake_create(
  '초기레벨전용', '01077000002', array['영어'],
  '{"영어":"level_test"}'::jsonb,
  '{"scheduledAt":"2026-07-14T10:00:00+09:00","place":"본관 201호","subjects":["영어"]}'::jsonb,
  null,
  'intake-level-test-only'
);
select ok(
  (
    select track.pipeline_status = 'level_test_scheduled'
      and attempt.status = 'scheduled'
      and appointment.kind = 'level_test'
      and appointment.notification_revision = 1
    from public.ops_registration_subject_tracks track
    join public.ops_registration_level_tests attempt on attempt.track_id = track.id
    join public.ops_registration_appointments appointment on appointment.id = attempt.appointment_id
    where track.id = pg_temp.registration_intake_track('level_test_only', '영어')
  ),
  'level-test-only atomic intake creates one appointment and scheduled attempt'
);

-- Direct-phone-only initial plan and canonical inquiry readiness.
insert into registration_intake_runtime_cases(case_key, payload)
select 'direct_phone_only', pg_temp.registration_intake_create(
  '초기전화전용', '01077000003', array['영어'],
  '{"영어":"direct_phone"}'::jsonb, null, null, 'intake-direct-phone-only'
);
select ok(
  (
    select track.pipeline_status = 'consultation_waiting'
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
      and consultation.ready_at = detail.inquiry_at
      and consultation.ready_source = 'inquiry'
    from public.ops_registration_subject_tracks track
    join public.ops_registration_details detail on detail.task_id = track.task_id
    join public.ops_registration_consultations consultation on consultation.track_id = track.id
    where track.id = pg_temp.registration_intake_track('direct_phone_only', '영어')
  ),
  'direct-phone-only atomic intake queues at exact inquiry time'
);

-- Visit-only initial plan.
insert into registration_intake_runtime_cases(case_key, payload)
select 'visit_only', pg_temp.registration_intake_create(
  '초기방문전용', '01077000004', array['영어'],
  '{"영어":"visit"}'::jsonb, null,
  '{"scheduledAt":"2026-07-14T11:00:00+09:00","place":"본관 상담실","subjects":["영어"]}'::jsonb,
  'intake-visit-only'
);
select ok(
  (
    select track.pipeline_status = 'visit_consultation_scheduled'
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled'
      and consultation.ready_at is null
      and consultation.ready_source is null
      and appointment.kind = 'visit_consultation'
    from public.ops_registration_subject_tracks track
    join public.ops_registration_consultations consultation on consultation.track_id = track.id
    join public.ops_registration_appointments appointment on appointment.id = consultation.appointment_id
    where track.id = pg_temp.registration_intake_track('visit_only', '영어')
  ),
  'visit-only atomic intake creates one scheduled visit with null readiness'
);

-- Canonical revision-1 event consumed by the notification API.
select ok(
  exists (
    select 1
    from registration_intake_runtime_cases fixture
    join public.ops_task_events event
      on event.task_id = (fixture.payload ->> 'taskId')::uuid
    cross join lateral (select event.after_value::jsonb as payload) canonical
    where fixture.case_key = 'visit_only'
      and event.event_type = 'registration_track_event'
      and canonical.payload ->> 'version' = '1'
      and canonical.payload ->> 'eventType' = 'visit_scheduled'
      and canonical.payload ->> 'trackId' = pg_temp.registration_intake_track(
        'visit_only', '영어'
      )::text
      and canonical.payload #>> '{metadata,appointmentId}' = (
        select appointment.value ->> 'id'
        from pg_catalog.jsonb_array_elements(fixture.payload -> 'appointments') appointment(value)
        where appointment.value ->> 'kind' = 'visit_consultation'
      )
      and canonical.payload #>> '{metadata,notificationRevision}' = '1'
      and canonical.payload #>> '{metadata,kind}' = 'visit_consultation'
      and canonical.payload #>> '{metadata,scheduledAt}' is not null
      and canonical.payload #>> '{metadata,place}' = '본관 상담실'
      and canonical.payload #>> '{metadata,activityId}' is not null
      and pg_catalog.jsonb_typeof(canonical.payload #> '{metadata,activeTrackIds}') = 'array'
      and canonical.payload #> '{metadata,canceledTrackIds}' = '[]'::jsonb
      and canonical.payload #>> '{metadata,changeKind}' = 'created'
  ),
  'initial visit event matches the notification revision contract exactly'
);

-- Mixed English level test plus mathematics direct phone.
insert into registration_intake_runtime_cases(case_key, payload)
select 'mixed_test_phone', pg_temp.registration_intake_create(
  '초기혼합테스트전화', '01077000005', array['수학', '영어'],
  '{"영어":"level_test","수학":"direct_phone"}'::jsonb,
  '{"scheduledAt":"2026-07-14T12:00:00+09:00","place":"본관 202호","subjects":["영어"]}'::jsonb,
  null,
  'intake-mixed-test-phone'
);
select ok(
  (
    select english.pipeline_status = 'level_test_scheduled'
      and math.pipeline_status = 'consultation_waiting'
      and exists (
        select 1 from public.ops_registration_level_tests attempt
        where attempt.track_id = english.id and attempt.status = 'scheduled'
      )
      and exists (
        select 1 from public.ops_registration_consultations consultation
        where consultation.track_id = math.id
          and consultation.mode = 'phone'
          and consultation.status = 'waiting'
          and consultation.ready_source = 'inquiry'
      )
    from public.ops_registration_subject_tracks english
    join public.ops_registration_subject_tracks math on math.task_id = english.task_id
    where english.id = pg_temp.registration_intake_track('mixed_test_phone', '영어')
      and math.id = pg_temp.registration_intake_track('mixed_test_phone', '수학')
  ),
  'English test and mathematics phone begin independently in one transaction'
);

-- Shared two-subject level test.
insert into registration_intake_runtime_cases(case_key, payload)
select 'shared_test', pg_temp.registration_intake_create(
  '초기공유레벨', '01077000006', array['영어', '수학'],
  '{"영어":"level_test","수학":"level_test"}'::jsonb,
  '{"scheduledAt":"2026-07-14T13:00:00+09:00","place":"별관 301호","subjects":["수학","영어"]}'::jsonb,
  null,
  'intake-shared-test'
);
select ok(
  (
    select pg_catalog.count(distinct attempt.appointment_id) = 1
      and pg_catalog.count(*) = 2
      and pg_catalog.bool_and(attempt.status = 'scheduled')
    from public.ops_registration_level_tests attempt
    join public.ops_registration_subject_tracks track on track.id = attempt.track_id
    where track.task_id = (
      select (payload ->> 'taskId')::uuid
      from registration_intake_runtime_cases where case_key = 'shared_test'
    )
  ),
  'two-subject test uses one shared appointment and two attempts'
);

-- Shared two-subject visit.
insert into registration_intake_runtime_cases(case_key, payload)
select 'shared_visit', pg_temp.registration_intake_create(
  '초기공유방문', '01077000007', array['영어', '수학'],
  '{"영어":"visit","수학":"visit"}'::jsonb, null,
  '{"scheduledAt":"2026-07-14T14:00:00+09:00","place":"본관 공동상담실","subjects":["영어","수학"]}'::jsonb,
  'intake-shared-visit'
);
select ok(
  (
    select pg_catalog.count(distinct consultation.appointment_id) = 1
      and pg_catalog.count(*) = 2
      and pg_catalog.bool_and(consultation.mode = 'visit')
      and pg_catalog.bool_and(consultation.ready_at is null)
      and pg_catalog.bool_and(consultation.ready_source is null)
    from public.ops_registration_consultations consultation
    join public.ops_registration_subject_tracks track on track.id = consultation.track_id
    where track.task_id = (
      select (payload ->> 'taskId')::uuid
      from registration_intake_runtime_cases where case_key = 'shared_visit'
    )
  )
  and (
    select pg_catalog.jsonb_array_length(payload -> 'notificationTargets') = 1
      and payload #>> '{notificationTargets,0,notificationRevision}' = '1'
    from registration_intake_runtime_cases where case_key = 'shared_visit'
  ),
  'two-subject visit uses one shared appointment and one notification target'
);
select ok(
  (
    select pg_catalog.count(*) = 2
      and pg_catalog.count(distinct canonical.payload ->> 'trackId') = 2
      and pg_catalog.bool_and(canonical.payload ->> 'version' = '1')
      and pg_catalog.bool_and(
        pg_catalog.jsonb_array_length(
          canonical.payload #> '{metadata,activeTrackIds}'
        ) = 2
      )
    from registration_intake_runtime_cases fixture
    join public.ops_task_events event
      on event.task_id = (fixture.payload ->> 'taskId')::uuid
    cross join lateral (select event.after_value::jsonb as payload) canonical
    where fixture.case_key = 'shared_visit'
      and event.event_type = 'registration_track_event'
      and canonical.payload ->> 'eventType' = 'visit_scheduled'
      and canonical.payload ->> 'trackId' in (
        select track.value ->> 'id'
        from pg_catalog.jsonb_array_elements(fixture.payload -> 'tracks') track(value)
      )
      and canonical.payload #>> '{metadata,appointmentId}' = (
        select appointment.value ->> 'id'
        from pg_catalog.jsonb_array_elements(fixture.payload -> 'appointments') appointment(value)
        where appointment.value ->> 'kind' = 'visit_consultation'
      )
      and canonical.payload #>> '{metadata,notificationRevision}' = '1'
      and canonical.payload #>> '{metadata,kind}' = 'visit_consultation'
      and canonical.payload #>> '{metadata,scheduledAt}' = (
        select appointment.value ->> 'scheduledAt'
        from pg_catalog.jsonb_array_elements(fixture.payload -> 'appointments') appointment(value)
        where appointment.value ->> 'kind' = 'visit_consultation'
      )
      and canonical.payload #>> '{metadata,place}' = '본관 공동상담실'
      and exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.id::text = canonical.payload #>> '{metadata,activityId}'
          and consultation.track_id::text = canonical.payload ->> 'trackId'
          and consultation.appointment_id::text =
            canonical.payload #>> '{metadata,appointmentId}'
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
      )
      and canonical.payload #> '{metadata,activeTrackIds}' @> (
        select pg_catalog.jsonb_agg(track.value ->> 'id')
        from pg_catalog.jsonb_array_elements(fixture.payload -> 'tracks') track(value)
      )
      and canonical.payload #> '{metadata,canceledTrackIds}' = '[]'::jsonb
      and canonical.payload #>> '{metadata,changeKind}' = 'created'
  ),
  'two-subject visit writes one canonical notification event per subject'
);

-- Validation precedence: membership wins over malformed level-test details.
select ok(
  pg_temp.registration_intake_throws(
    $$select public.create_registration_case_with_initial_workflow_v1(
      '초기레벨복합검증', '중1', '초기등록런타임중', '01077000081', null,
      '본관', '2026-07-13 09:30+09'::timestamptz, array['영어'],
      'compound level-test validation', 'normal', '{"영어":"level_test"}'::jsonb,
      '{"scheduledAt":42,"place":false,"subjects":["수학"]}'::jsonb,
      null, '{}'::jsonb, 'intake-level-membership-precedence'
    )$$,
    'registration_initial_appointment_membership_invalid'
  )
  and not exists (
    select 1 from public.ops_tasks task where task.student_name = '초기레벨복합검증'
  ),
  'level-test membership beats malformed details'
);

-- Validation precedence: membership wins over malformed visit details.
select ok(
  pg_temp.registration_intake_throws(
    $$select public.create_registration_case_with_initial_workflow_v1(
      '초기방문복합검증', '중1', '초기등록런타임중', '01077000082', null,
      '본관', '2026-07-13 09:30+09'::timestamptz, array['영어'],
      'compound visit validation', 'normal', '{"영어":"visit"}'::jsonb,
      null,
      '{"scheduledAt":42,"place":false,"subjects":["수학"]}'::jsonb,
      '{}'::jsonb, 'intake-visit-membership-precedence'
    )$$,
    'registration_initial_appointment_membership_invalid'
  )
  and not exists (
    select 1 from public.ops_tasks task where task.student_name = '초기방문복합검증'
  ),
  'visit membership beats malformed details'
);

-- Validation precedence: an earlier campus error wins over a blank request key.
select ok(
  pg_temp.registration_intake_throws(
    $$select public.create_registration_case_with_initial_workflow_v1(
      '초기캠퍼스우선검증', '중1', '초기등록런타임중', '01077000083', null,
      '외부', '2026-07-13 09:30+09'::timestamptz, array['영어'],
      'compound campus validation', 'normal', '{"영어":"inquiry"}'::jsonb,
      null, null, '{}'::jsonb, '   '
    )$$,
    'registration_campus_invalid'
  )
  and not exists (
    select 1 from public.ops_tasks task where task.student_name = '초기캠퍼스우선검증'
  ),
  'campus validation beats request key'
);

-- Validation precedence: all common fields, including priority, beat a blank request key.
select ok(
  pg_temp.registration_intake_throws(
    $$select public.create_registration_case_with_initial_workflow_v1(
      '초기우선순위우선검증', '중1', '초기등록런타임중', '01077000084', null,
      '본관', '2026-07-13 09:30+09'::timestamptz, array['영어'],
      'compound priority validation', 'impossible', '{"영어":"inquiry"}'::jsonb,
      null, null, '{}'::jsonb, '   '
    )$$,
    'registration_priority_invalid'
  )
  and not exists (
    select 1 from public.ops_tasks task where task.student_name = '초기우선순위우선검증'
  ),
  'priority validation beats request key'
);

-- Appointment membership mismatch rolls the entire requested case back.
select ok(
  pg_temp.registration_intake_throws(
    $$select pg_temp.registration_intake_create(
      '초기멤버십실패', '01077000008', array['영어', '수학'],
      '{"영어":"level_test","수학":"inquiry"}'::jsonb,
      '{"scheduledAt":"2026-07-14T15:00:00+09:00","place":"본관 203호","subjects":["수학"]}'::jsonb,
      null,
      'intake-membership-mismatch'
    )$$,
    'registration_initial_appointment_membership_invalid'
  )
  and not exists (
    select 1 from public.ops_tasks task where task.student_name = '초기멤버십실패'
  ),
  'membership mismatch leaves no parent or children'
);

-- Required director failure is resolved before the parent insert.
set local role postgres;
update public.teacher_catalogs
set is_visible = false
where id = '10000000-0000-4000-8000-000000007103';
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);
select ok(
  pg_temp.registration_intake_throws(
    $$select pg_temp.registration_intake_create(
      '초기책임자실패', '01077000009', array['수학'],
      '{"수학":"direct_phone"}'::jsonb,
      null, null, 'intake-director-required'
    )$$,
    'registration_director_required'
  )
  and not exists (
    select 1 from public.ops_tasks task where task.student_name = '초기책임자실패'
  ),
  'missing required director leaves no parent'
);
set local role postgres;
update public.teacher_catalogs
set is_visible = true
where id = '10000000-0000-4000-8000-000000007103';
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);

-- Sequential identical retry returns the stored response and creates one parent.
select ok(
  (
    select payload = pg_temp.registration_intake_create(
      '초기문의전용', '01077000001', array['영어'],
      '{"영어":"inquiry"}'::jsonb, null, null, 'intake-inquiry-only'
    )
    from registration_intake_runtime_cases where case_key = 'inquiry_only'
  )
  and (
    select pg_catalog.count(*) = 1
    from public.ops_tasks task
    where task.student_name = '초기문의전용'
  ),
  'identical sequential retry replays one complete response'
);
set local role postgres;
select ok(
  (
    select pg_catalog.count(*) = 1
    from dashboard_private.ops_registration_mutations mutation
    join public.ops_tasks task on task.id = mutation.task_id
    where mutation.actor_id = '10000000-0000-4000-8000-000000007001'
      and mutation.request_key = 'intake-inquiry-only'
      and mutation.mutation_type = 'create_case_with_initial_workflow_v1'
      and task.student_name = '초기문의전용'
      and mutation.response_payload ->> 'taskId' = task.id::text
  ),
  'identical sequential retry stores exactly one successful outer receipt'
);
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);

-- The same actor/key with a changed normalized fingerprint is rejected.
select ok(
  pg_temp.registration_intake_throws(
    $$select public.create_registration_case_with_initial_workflow_v1(
      '초기문의전용', '중1', '초기등록런타임중', '01077000001', null,
      '본관', '2026-07-13 09:30+09'::timestamptz, array['영어'],
      'changed request note', 'normal', '{"영어":"inquiry"}'::jsonb,
      null, null, '{}'::jsonb, 'intake-inquiry-only'
    )$$,
    'idempotency_key_reused'
  ),
  'changed fingerprint cannot reuse an atomic intake request key'
);

-- A child insert fault proves parent, detail, track, event, and receipt rollback.
set local role postgres;
create temporary table registration_intake_fault_baseline on commit drop as
select
  (select pg_catalog.count(*) from public.ops_tasks) as task_count,
  (select pg_catalog.count(*) from public.ops_registration_details) as detail_count,
  (select pg_catalog.count(*) from public.ops_registration_subject_tracks) as track_count,
  (select pg_catalog.count(*) from public.ops_registration_appointments) as appointment_count,
  (select pg_catalog.count(*) from public.ops_registration_level_tests) as attempt_count,
  (select pg_catalog.count(*) from public.ops_registration_consultations) as consultation_count,
  (select pg_catalog.count(*) from public.ops_task_events) as event_count,
  (select pg_catalog.count(*) from dashboard_private.ops_registration_mutations) as receipt_count;
create or replace function pg_temp.registration_intake_fail_child()
returns trigger
language plpgsql
as $$
begin
  if pg_catalog.current_setting('registration.intake_fail_child', true) = 'on' then
    raise exception 'registration_intake_child_failure';
  end if;
  return new;
end;
$$;
create trigger registration_intake_fail_child
before insert on public.ops_registration_level_tests
for each row execute function pg_temp.registration_intake_fail_child();
select pg_catalog.set_config('registration.intake_fail_child', 'on', true);
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);
select ok(
  pg_temp.registration_intake_throws(
    $$select pg_temp.registration_intake_create(
      '초기자식실패', '01077000010', array['영어'],
      '{"영어":"level_test"}'::jsonb,
      '{"scheduledAt":"2026-07-14T16:00:00+09:00","place":"본관 204호","subjects":["영어"]}'::jsonb,
      null,
      'intake-induced-child-failure'
    )$$,
    'registration_intake_child_failure'
  )
  and not exists (
    select 1 from public.ops_tasks task where task.student_name = '초기자식실패'
  ),
  'induced child failure exposes no parent through the authenticated boundary'
);
set local role postgres;
select ok(
  (
    select baseline.task_count = (select pg_catalog.count(*) from public.ops_tasks)
      and baseline.detail_count = (
        select pg_catalog.count(*) from public.ops_registration_details
      )
      and baseline.track_count = (
        select pg_catalog.count(*) from public.ops_registration_subject_tracks
      )
      and baseline.appointment_count = (
        select pg_catalog.count(*) from public.ops_registration_appointments
      )
      and baseline.attempt_count = (
        select pg_catalog.count(*) from public.ops_registration_level_tests
      )
      and baseline.consultation_count = (
        select pg_catalog.count(*) from public.ops_registration_consultations
      )
      and baseline.event_count = (select pg_catalog.count(*) from public.ops_task_events)
      and baseline.receipt_count = (
        select pg_catalog.count(*) from dashboard_private.ops_registration_mutations
      )
    from registration_intake_fault_baseline baseline
  )
  and not exists (
    select 1 from public.ops_tasks task where task.student_name = '초기자식실패'
  )
  and not exists (
    select 1
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '10000000-0000-4000-8000-000000007001'
      and mutation.request_key = 'intake-induced-child-failure'
  ),
  'induced child failure leaves no parent, child, event, or outer receipt'
);
select pg_catalog.set_config('registration.intake_fail_child', 'off', true);
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);

-- Writer 1: route inquiry uses detail.inquiry_at.
select public.route_registration_inquiry(
  pg_temp.registration_intake_track('inquiry_only', '영어'),
  'consultation_waiting', null, null, 'intake-readiness-route'
);
select ok(
  (
    select consultation.ready_at = detail.inquiry_at
      and consultation.ready_source = 'inquiry'
    from public.ops_registration_consultations consultation
    join public.ops_registration_subject_tracks track on track.id = consultation.track_id
    join public.ops_registration_details detail on detail.task_id = track.task_id
    where consultation.track_id = pg_temp.registration_intake_track('inquiry_only', '영어')
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
  ),
  'route inquiry readiness uses inquiry_at and inquiry source'
);

-- Writer 2: a repaired director queue uses the pre-existing stage_entered_at.
insert into registration_intake_runtime_cases(case_key, payload)
select 'director_repair', pg_temp.registration_intake_create(
  '초기책임자복구', '01077000011', array['영어'],
  '{"영어":"direct_phone"}'::jsonb, null, null, 'intake-director-repair-case'
);
set local role postgres;
delete from public.ops_registration_consultations
where track_id = pg_temp.registration_intake_track('director_repair', '영어')
  and mode = 'phone'
  and status = 'waiting';
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);
select public.assign_registration_track_director(
  pg_temp.registration_intake_track('director_repair', '영어'),
  '10000000-0000-4000-8000-000000007002',
  'manual', null, 1, 'intake-readiness-director-repair'
);
select ok(
  (
    select consultation.ready_at = track.stage_entered_at
      and consultation.ready_source = 'director_resolved'
    from public.ops_registration_consultations consultation
    join public.ops_registration_subject_tracks track on track.id = consultation.track_id
    where track.id = pg_temp.registration_intake_track('director_repair', '영어')
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
  ),
  'director queue repair preserves stage-entered readiness'
);

-- Writer 3: removing one participant from a shared visit reopens only that track.
select public.save_registration_shared_appointment(
  (
    select (appointment.value ->> 'id')::uuid
    from registration_intake_runtime_cases fixture
    cross join lateral pg_catalog.jsonb_array_elements(
      fixture.payload -> 'appointments'
    ) appointment(value)
    where fixture.case_key = 'shared_visit'
  ),
  (
    select (payload ->> 'taskId')::uuid
    from registration_intake_runtime_cases where case_key = 'shared_visit'
  ),
  'visit_consultation',
  '2026-07-14 14:30+09'::timestamptz,
  '본관 공동상담실',
  array[pg_temp.registration_intake_track('shared_visit', '영어')],
  false,
  1,
  'intake-readiness-visit-deselect'
);
select ok(
  exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.track_id = pg_temp.registration_intake_track('shared_visit', '수학')
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
      and consultation.ready_at is not null
      and consultation.ready_source = 'visit_reopened'
  )
  and not exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.track_id = pg_temp.registration_intake_track('shared_visit', '영어')
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
  ),
  'visit participant deselection reopens only the removed subject'
);

-- Writer 4: canceling a visit reopens its participating track with now readiness.
select public.cancel_registration_appointment(
  (
    select (appointment.value ->> 'id')::uuid
    from registration_intake_runtime_cases fixture
    cross join lateral pg_catalog.jsonb_array_elements(
      fixture.payload -> 'appointments'
    ) appointment(value)
    where fixture.case_key = 'visit_only'
  ),
  1,
  'runtime visit cancellation',
  'intake-readiness-visit-cancel'
);
select ok(
  exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.track_id = pg_temp.registration_intake_track('visit_only', '영어')
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
      and consultation.ready_at is not null
      and consultation.ready_source = 'visit_reopened'
  ),
  'visit cancellation creates visit_reopened phone readiness'
);

-- Writer 5: completed attempt uses the exact returned completed_at.
select public.start_registration_level_test_attempt(
  (
    select attempt.id
    from public.ops_registration_level_tests attempt
    where attempt.track_id = pg_temp.registration_intake_track('level_test_only', '영어')
  ),
  'intake-level-test-start'
);
select public.complete_registration_level_test_attempt(
  (
    select attempt.id
    from public.ops_registration_level_tests attempt
    where attempt.track_id = pg_temp.registration_intake_track('level_test_only', '영어')
  ),
  'completed',
  'https://example.invalid/intake-level-test-result',
  'intake-level-test-complete'
);
select ok(
  (
    select consultation.ready_at = attempt.completed_at
      and consultation.ready_source = 'level_test_completion'
    from public.ops_registration_consultations consultation
    join public.ops_registration_level_tests attempt
      on attempt.track_id = consultation.track_id
    where consultation.track_id = pg_temp.registration_intake_track(
      'level_test_only', '영어'
    )
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
      and attempt.status = 'completed'
  ),
  'completed level test reuses the exact attempt completed_at readiness'
);

-- Migration-review consumer path: malformed raw evidence fails canonically and atomically.
set local role postgres;
insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name, campus, subject
) values (
  '10000000-0000-4000-8000-000000007601',
  '초기등록 malformed migration review',
  'registration', 'in_progress', 'normal',
  '10000000-0000-4000-8000-000000007001',
  '초기마이그레이션오염', '본관', '영어'
);
insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone,
  student_phone, request_note, pipeline_status, common_revision
) values (
  '10000000-0000-4000-8000-000000007601',
  '2026-07-01 09:00+09', '중1', '초기등록런타임중', '01077000601',
  null, 'malformed migration review runtime', '0. 등록 문의', 1
);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status,
  director_profile_id, director_assignment_source,
  director_assignment_rule_key, director_assigned_at,
  migration_review_required
) values (
  '10000000-0000-4000-8000-000000007611',
  '10000000-0000-4000-8000-000000007601',
  '영어', 'migration_review',
  '10000000-0000-4000-8000-000000007002', 'manual', null, now(), true
);
insert into public.ops_task_events(
  task_id, actor_id, event_type, field_name, before_value, after_value
) values (
  '10000000-0000-4000-8000-000000007601',
  '10000000-0000-4000-8000-000000007001',
  'legacy_registration_imported',
  'registration_track:10000000-0000-4000-8000-000000007611:malformed-container',
  '{not-json',
  '{not-json'
);
create temporary table registration_intake_malformed_review_result (
  stable_error boolean not null
) on commit drop;
grant select, insert on registration_intake_malformed_review_result to authenticated;
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);
insert into registration_intake_malformed_review_result(stable_error)
select pg_temp.registration_intake_throws(
  $$select public.resolve_registration_migration_review(
    '10000000-0000-4000-8000-000000007601',
    pg_catalog.jsonb_build_object(
      'assignments', '[]'::jsonb,
      'trackStates', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'trackId', '10000000-0000-4000-8000-000000007611',
          'targetStatus', 'consultation_waiting',
          'waitingKind', null,
          'classId', null
        )
      )
    ),
    'intake-malformed-migration-container'
  )$$,
  '^registration_migration_legacy_snapshot_missing$'
);
set local role postgres;
select ok(
  (select stable_error from registration_intake_malformed_review_result)
  and exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = '10000000-0000-4000-8000-000000007611'
      and track.pipeline_status = 'migration_review'
      and track.migration_review_required
  )
  and not exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.track_id = '10000000-0000-4000-8000-000000007611'
  )
  and not exists (
    select 1
    from public.ops_registration_appointments appointment
    where appointment.task_id = '10000000-0000-4000-8000-000000007601'
  )
  and not exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = '10000000-0000-4000-8000-000000007611'
  )
  and not exists (
    select 1
    from dashboard_private.ops_registration_mutations mutation
    where mutation.request_key = 'intake-malformed-migration-container'
  )
  and not exists (
    select 1
    from public.ops_task_events event
    where event.task_id = '10000000-0000-4000-8000-000000007601'
      and event.event_type = 'registration_track_event'
  ),
  'malformed migration-review container fails canonically without mutation'
);

-- A usable version-1 container with malformed nested scalars follows canonical fallbacks.
insert into public.ops_task_events(
  task_id, actor_id, event_type, field_name, before_value, after_value
) values (
  '10000000-0000-4000-8000-000000007601',
  '10000000-0000-4000-8000-000000007001',
  'legacy_registration_imported',
  'registration_track:10000000-0000-4000-8000-000000007611:malformed-scalars',
  pg_catalog.jsonb_build_object(
    'pipelineStatus', '2. 상담 예약',
    'studentId', 'not-a-uuid',
    'classId', 'not-a-uuid',
    'textbookId', 'not-a-uuid'
  )::text,
  pg_catalog.jsonb_build_object(
    'version', 1,
    'trackId', '10000000-0000-4000-8000-000000007611',
    'timestamps', pg_catalog.jsonb_build_object(
      'taskUpdatedAt', 'not-a-timestamp',
      'levelTestAt', 'not-a-timestamp',
      'levelTestCompletedAt', 'not-a-timestamp',
      'phoneConsultationAt', 'not-a-timestamp',
      'visitConsultationAt', 'not-a-timestamp',
      'consultationAt', 'not-a-timestamp',
      'classStartDate', 'not-a-date'
    ),
    'legacyBooleans', pg_catalog.jsonb_build_object(
      'admissionNoticeSent', 'not-a-boolean',
      'makeeduRegistered', 'not-a-boolean',
      'makeeduInvoiceSent', 'not-a-boolean',
      'paymentChecked', 'not-a-boolean'
    )
  )::text
);
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);
select public.resolve_registration_migration_review(
  '10000000-0000-4000-8000-000000007601',
  pg_catalog.jsonb_build_object(
    'assignments', '[]'::jsonb,
    'trackStates', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'trackId', '10000000-0000-4000-8000-000000007611',
        'targetStatus', 'consultation_waiting',
        'waitingKind', null,
        'classId', null
      )
    )
  ),
  'intake-malformed-migration-scalars'
);
set local role postgres;
select ok(
  exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = '10000000-0000-4000-8000-000000007611'
      and track.pipeline_status = 'consultation_waiting'
      and not track.migration_review_required
  )
  and (
    select pg_catalog.count(*) = 1
      and pg_catalog.bool_and(
        consultation.mode = 'phone'
        and consultation.status = 'waiting'
        and consultation.ready_at = pg_catalog.now()
        and consultation.ready_source = 'migration'
      )
    from public.ops_registration_consultations consultation
    where consultation.track_id = '10000000-0000-4000-8000-000000007611'
  )
  and not exists (
    select 1
    from public.ops_registration_appointments appointment
    where appointment.task_id = '10000000-0000-4000-8000-000000007601'
  )
  and not exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = '10000000-0000-4000-8000-000000007611'
  )
  and (
    select pg_catalog.count(*) = 1
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '10000000-0000-4000-8000-000000007001'
      and mutation.request_key = 'intake-malformed-migration-scalars'
      and mutation.mutation_type = 'resolve_migration_review'
  ),
  'malformed migration-review scalars use canonical fallback'
);

-- Writer 6: migration recovery uses the legacy phone timestamp.
set local role postgres;
insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name, campus, subject
) values (
  '10000000-0000-4000-8000-000000007501',
  '초기등록 migration readiness',
  'registration', 'in_progress', 'normal',
  '10000000-0000-4000-8000-000000007001',
  '초기마이그레이션', '본관', '영어'
);
insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone,
  student_phone, request_note, pipeline_status, common_revision
) values (
  '10000000-0000-4000-8000-000000007501',
  '2026-07-01 09:00+09', '중1', '초기등록런타임중', '01077000501',
  null, 'migration readiness runtime', '0. 등록 문의', 1
);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status,
  director_profile_id, director_assignment_source,
  director_assignment_rule_key, director_assigned_at,
  migration_review_required
) values (
  '10000000-0000-4000-8000-000000007511',
  '10000000-0000-4000-8000-000000007501',
  '영어', 'migration_review',
  '10000000-0000-4000-8000-000000007002', 'manual', null, now(), true
);
insert into public.ops_task_events(
  task_id, actor_id, event_type, field_name, before_value, after_value
) values (
  '10000000-0000-4000-8000-000000007501',
  '10000000-0000-4000-8000-000000007001',
  'legacy_registration_imported',
  'registration_track:10000000-0000-4000-8000-000000007511',
  '{"pipelineStatus":"2. 상담 예약","studentId":null,"classId":null,"textbookId":null}'::jsonb::text,
  '{"version":1,"trackId":"10000000-0000-4000-8000-000000007511","timestamps":{"phoneConsultationAt":"2026-07-02T10:15:00+09:00"},"legacyBooleans":{}}'::jsonb::text
);
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);
select public.resolve_registration_migration_review(
  '10000000-0000-4000-8000-000000007501',
  pg_catalog.jsonb_build_object(
    'assignments', '[]'::jsonb,
    'trackStates', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'trackId', '10000000-0000-4000-8000-000000007511',
        'targetStatus', 'consultation_waiting',
        'waitingKind', null,
        'classId', null
      )
    )
  ),
  'intake-readiness-migration'
);
select ok(
  exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.track_id = '10000000-0000-4000-8000-000000007511'
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
      and consultation.ready_at = '2026-07-02 10:15+09'::timestamptz
      and consultation.ready_source = 'migration'
  ),
  'migration review recovers the legacy phone timestamp'
);

-- Writer 7: terminal-track reopen uses track_reopened readiness.
insert into registration_intake_runtime_cases(case_key, payload)
select 'reopen_source', pg_temp.registration_intake_create(
  '초기재개출처', '01077000012', array['영어'],
  '{"영어":"inquiry"}'::jsonb, null, null, 'intake-reopen-source-case'
);
set local role postgres;
update public.ops_registration_subject_tracks
set pipeline_status = 'not_registered',
    stage_entered_at = now(),
    updated_at = now()
where id = pg_temp.registration_intake_track('reopen_source', '영어');
set local role authenticated;
select pg_temp.registration_intake_set_actor(
  '10000000-0000-4000-8000-000000007001'
);
select public.reopen_registration_track(
  pg_temp.registration_intake_track('reopen_source', '영어'),
  'consultation_waiting',
  'runtime reopen readiness',
  'intake-readiness-track-reopen'
);
select ok(
  exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.track_id = pg_temp.registration_intake_track(
      'reopen_source', '영어'
    )
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
      and consultation.ready_at is not null
      and consultation.ready_source = 'track_reopened'
  ),
  'terminal track reopen creates track_reopened readiness'
);

-- Moving one of two phone subjects to visit must not touch its sibling queue.
insert into registration_intake_runtime_cases(case_key, payload)
select 'phone_pair', pg_temp.registration_intake_create(
  '초기전화쌍', '01077000013', array['영어', '수학'],
  '{"영어":"direct_phone","수학":"direct_phone"}'::jsonb,
  null, null, 'intake-phone-pair'
);
create temporary table registration_intake_phone_pair_before on commit drop as
select consultation.id, consultation.track_id, consultation.ready_at, consultation.ready_source
from public.ops_registration_consultations consultation
where consultation.track_id in (
  pg_temp.registration_intake_track('phone_pair', '영어'),
  pg_temp.registration_intake_track('phone_pair', '수학')
)
  and consultation.mode = 'phone'
  and consultation.status = 'waiting';
grant select on registration_intake_phone_pair_before to authenticated;

select public.save_registration_shared_appointment(
  null,
  (
    select (payload ->> 'taskId')::uuid
    from registration_intake_runtime_cases where case_key = 'phone_pair'
  ),
  'visit_consultation',
  '2026-07-15 10:00+09'::timestamptz,
  '본관 선택상담실',
  array[pg_temp.registration_intake_track('phone_pair', '영어')],
  false,
  null,
  'intake-phone-pair-visit-English'
);
select ok(
  exists (
    select 1
    from registration_intake_phone_pair_before before_row
    join public.ops_registration_consultations consultation
      on consultation.id = before_row.id
    where before_row.track_id = pg_temp.registration_intake_track('phone_pair', '영어')
      and consultation.status = 'canceled'
      and consultation.ready_at = before_row.ready_at
      and consultation.ready_source = before_row.ready_source
  )
  and exists (
    select 1
    from registration_intake_phone_pair_before before_row
    join public.ops_registration_consultations consultation
      on consultation.id = before_row.id
    where before_row.track_id = pg_temp.registration_intake_track('phone_pair', '수학')
      and consultation.status = 'waiting'
      and consultation.ready_at = before_row.ready_at
      and consultation.ready_source = before_row.ready_source
  )
  and exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.track_id = pg_temp.registration_intake_track('phone_pair', '영어')
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled'
      and consultation.ready_at is null
      and consultation.ready_source is null
  ),
  'visit conversion cancels readiness only for participating subjects'
);

select * from finish();
rollback;
