begin;
set local role postgres;
set local search_path = extensions, public;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated, service_role;
grant execute on all functions in schema extensions to authenticated, service_role;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '60s';
set local lock_timeout = '5s';

select ok(
  not exists (
    select 1
    from pg_catalog.pg_trigger trigger
    where not trigger.tgisinternal
      and trigger.tgname in (
        'registration_observation_google_chat_materializer',
        'registration_observation_google_chat_assignment_materializer',
        'capture_lightweight_registration_booking_alerts',
        'write_registration_phone_queue_event_v1',
        'capture_registration_observation_teacher_change',
        'capture_registration_director_change'
      )
  ),
  'fact tables have no synchronous registration notification projection triggers'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(
      'dashboard_private.save_registration_level_test_result_impl(uuid,text,text,text)'::regprocedure
    ) not like '%40001%'
      and pg_catalog.pg_get_functiondef(
        'dashboard_private.save_registration_level_test_result_impl(uuid,text,text,text)'::regprocedure
      ) not like '%write_registration_track_event%'
      and pg_catalog.pg_get_functiondef(
        'dashboard_private.save_registration_level_test_result_impl(uuid,text,text,text)'::regprocedure
      ) not like '%cancel_registration_appointment_reminders%'
  ),
  'the active level-test result writer is non-retryable and notification-free'
);

select ok(
  pg_catalog.to_regprocedure(
    'dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text)'
  ) is null
  or (
    pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure(
        'dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text)'
      )
    ) not like '%40001%'
    and pg_catalog.pg_get_userbyid((
      select procedure.proowner
      from pg_catalog.pg_proc procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text)'
      )
    )) = 'postgres'
    and not pg_catalog.has_function_privilege(
      'public',
      pg_catalog.to_regprocedure(
        'dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text)'
      ),
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure(
        'dashboard_private.write_registration_track_event_payload_v3(uuid,uuid,text,text,text,text,jsonb,text,text)'
      ),
      'EXECUTE'
    )
  ),
  'an optional production payload-v3 event writer is non-retryable and private'
);

select ok(
  not coalesce((
    select settings.enabled
    from dashboard_private.registration_customer_reminder_settings settings
    where settings.singleton
  ), false),
  'automatic customer reminders are disabled'
);

select is_empty(
  $$
    select 1
    from dashboard_private.registration_customer_reminder_jobs job
    where job.status in ('pending', 'claimed')
  $$,
  'no automatic customer reminder job remains claimable'
);

select is_empty(
  $$
    select 1
    from dashboard_private.registration_observation_chat_jobs job
    where job.status in ('pending', 'claimed')
  $$,
  'no automatic observation Chat job remains claimable'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '99500000-0000-4000-8000-000000001200',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-fact-finalization-admin@example.invalid',
    crypt('flat-fact-finalization-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"flat-fact-finalization"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99500000-0000-4000-8000-000000001201',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-fact-finalization-teacher@example.invalid',
    crypt('flat-fact-finalization-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"flat-fact-finalization"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '99500000-0000-4000-8000-000000001200',
    'admin',
    '등록 사실 독립성 원장',
    'flat-fact-finalization-admin@example.invalid',
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99500000-0000-4000-8000-000000001201',
    'teacher',
    '등록 사실 독립성 강사',
    'flat-fact-finalization-teacher@example.invalid',
    pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.academic_subject_settings(
  subject, is_active, registration_create_enabled, grade_levels, sort_order
)
values (
  '영어', true, true,
  array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'],
  10
)
on conflict (subject) do update
set is_active = excluded.is_active,
    registration_create_enabled = excluded.registration_create_enabled,
    grade_levels = excluded.grade_levels,
    sort_order = excluded.sort_order;

create or replace function pg_temp.set_flat_fact_actor(p_role text, p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', p_actor::text, 'role', p_role)::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', p_role, true);
end;
$$;

create temporary table flat_fact_case(response jsonb not null) on commit drop;
create temporary table flat_fact_booking(response jsonb not null) on commit drop;
grant select, insert on flat_fact_case, flat_fact_booking to authenticated;

set local role authenticated;
select pg_temp.set_flat_fact_actor(
  'authenticated',
  '99500000-0000-4000-8000-000000001200'
);

insert into flat_fact_case(response)
select public.create_registration_case(
  '사실 독립성 학생', '중1', '사실독립중', '01099501200', null,
  '본관', pg_catalog.now(), array['영어'],
  'migration review에서도 예약 사실 저장', 'normal',
  'flat-fact-finalization-case'
);

set local role postgres;
update public.ops_registration_subject_tracks track
set pipeline_status = 'migration_review',
    migration_review_required = true,
    updated_at = pg_catalog.now()
where track.task_id = (select (fixture.response ->> 'taskId')::uuid from flat_fact_case fixture);

create temporary table flat_fact_notification_baseline on commit drop as
select pg_catalog.jsonb_build_object(
  'events', (select pg_catalog.count(*) from dashboard_private.notification_events),
  'reminders', (select pg_catalog.count(*) from dashboard_private.registration_customer_reminder_jobs),
  'messages', (select pg_catalog.count(*) from public.ops_registration_customer_messages),
  'lightweight', (select pg_catalog.count(*) from dashboard_private.lightweight_registration_alert_deliveries),
  'chat', (select pg_catalog.count(*) from dashboard_private.registration_observation_chat_jobs)
) as counts;

set local role authenticated;
select pg_temp.set_flat_fact_actor(
  'authenticated',
  '99500000-0000-4000-8000-000000001200'
);

insert into flat_fact_booking(response)
select public.save_registration_appointment_details_v1(
  null,
  (fixture.response ->> 'taskId')::uuid,
  'visit_consultation',
  pg_catalog.now() + interval '10 days',
  '상담실',
  array[(fixture.response -> 'tracks' -> 0 ->> 'id')::uuid],
  null,
  'flat-fact-finalization-booking'
)
from flat_fact_case fixture;

set local role postgres;
select ok(
  exists (
    select 1
    from flat_fact_booking booking
    join public.ops_registration_appointments appointment
      on appointment.id = (booking.response ->> 'appointmentId')::uuid
    join public.ops_registration_consultations consultation
      on consultation.appointment_id = appointment.id
     and consultation.mode = 'visit'
    join public.ops_registration_subject_tracks track
      on track.id = consultation.track_id
    where appointment.status = 'scheduled'
      and consultation.status = 'scheduled'
      and consultation.director_profile_id is null
      and track.pipeline_status = 'migration_review'
      and track.migration_review_required
  ),
  'a visit fact saves without a director while the track remains in migration review'
);

select is(
  pg_catalog.jsonb_build_object(
    'events', (select pg_catalog.count(*) from dashboard_private.notification_events),
    'reminders', (select pg_catalog.count(*) from dashboard_private.registration_customer_reminder_jobs),
    'messages', (select pg_catalog.count(*) from public.ops_registration_customer_messages),
    'lightweight', (select pg_catalog.count(*) from dashboard_private.lightweight_registration_alert_deliveries),
    'chat', (select pg_catalog.count(*) from dashboard_private.registration_observation_chat_jobs)
  ),
  (select baseline.counts from flat_fact_notification_baseline baseline),
  'saving the reservation fact writes no notification, customer-message, or worker job row'
);

set local role authenticated;
select pg_temp.set_flat_fact_actor(
  'authenticated',
  '99500000-0000-4000-8000-000000001201'
);
select throws_ok(
  $$
    select public.get_registration_visit_legacy_dispatch_plan_v1(
      (select (booking.response ->> 'appointmentId')::uuid from flat_fact_booking booking),
      '99500000-0000-4000-8000-000000001200'
    )
  $$,
  '42501',
  'registration_access_denied',
  'an authenticated teacher cannot impersonate a manager in the dispatch-plan RPC'
);

set local role postgres;
select pg_temp.set_flat_fact_actor('service_role', null);
set local role service_role;

select is(
  public.claim_registration_customer_reminder_job_v1(),
  null::jsonb,
  'the retired automatic customer reminder worker cannot claim a job'
);

select is_empty(
  $$ select * from public.claim_registration_observation_chat_jobs_v1('pgtap-worker', 10, 60) $$,
  'the retired observation Chat worker cannot claim a job'
);

select is(
  public.enqueue_lightweight_registration_booking_alerts_v1(
    'booking',
    '99500000-0000-4000-8000-000000001200',
    1
  ),
  0::integer,
  'the retired lightweight producer enqueues nothing'
);

select throws_ok(
  $$
    select public.materialize_registration_observation_chat_job_v1(
      '99500000-0000-4000-8000-000000001201',
      '99500000-0000-4000-8000-000000001202',
      1,
      '{}'::jsonb
    )
  $$,
  '55000',
  'registration_observation_chat_automatic_materialization_retired',
  'automatic observation Chat materialization requires an explicit action'
);

set local role postgres;
select * from finish();
rollback;
