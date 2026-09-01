begin;
select plan(25);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

select hasnt_trigger(
  'public', 'ops_registration_observations',
  'sync_registration_observation_feedback_task_v1',
  'booking and attendance no longer create teacher feedback tasks'
);
select hasnt_trigger(
  'public', 'ops_tasks',
  'guard_registration_feedback_task_completion_v1',
  'generic task completion no longer depends on feedback submission'
);
select is(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.submit_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,integer,text)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot call the retired feedback submit RPC'
);
select is(
  pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.submit_registration_observation_feedback_v1_impl(uuid,text,text,text,bigint,bigint,integer,text)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot bypass the retired feedback submit wrapper'
);
select is(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot call the retired feedback correction RPC'
);
select is(
  pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.correct_registration_observation_feedback_v1_impl(uuid,text,text,text,bigint,bigint,text,text)',
    'EXECUTE'
  ),
  false,
  'authenticated users cannot bypass the retired feedback correction wrapper'
);
select is(
  pg_catalog.jsonb_build_object(
    'submit', pg_catalog.has_function_privilege(
      'service_role',
      'public.submit_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,integer,text)',
      'EXECUTE'
    ),
    'correct', pg_catalog.has_function_privilege(
      'service_role',
      'public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)',
      'EXECUTE'
    )
  ),
  '{"submit":false,"correct":false}'::jsonb,
  'service role has no retired feedback mutation escape hatch'
);
select is(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)',
    'EXECUTE'
  ),
  true,
  'the director decision RPC remains callable'
);
select is(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_registration_observation_attendance_v1(uuid,bigint,integer,text)',
    'EXECUTE'
  ),
  true,
  'the management attendance RPC remains callable'
);
select throws_ok(
  $$select dashboard_private.submit_registration_observation_feedback_v1_impl(
    null, null, null, null, null, null, null, null
  )$$,
  '55000',
  'registration_observation_feedback_retired',
  'the retired private submit definition fails closed even for its owner'
);
select throws_ok(
  $$select dashboard_private.correct_registration_observation_feedback_v1_impl(
    null, null, null, null, null, null, null, null
  )$$,
  '55000',
  'registration_observation_feedback_retired',
  'the retired private correction definition fails closed even for its owner'
);
select is(
  (
    select coalesce(pg_catalog.bool_or(rule.enabled), false)
    from dashboard_private.notification_rules rule
    where rule.scope_key = 'global'
      and rule.workflow_key = 'registration'
      and rule.event_key = 'registration.observation_feedback_due'
  ),
  false,
  'every feedback-due notification rule is disabled'
);
select is(
  dashboard_private.insert_registration_observation_chat_job_v1(
    null, null, null, null, null,
    'registration.observation_feedback_due',
    null, null, null, null, null, null, null, null, null, null
  ),
  null::uuid,
  'the feedback-due producer returns before validating or inserting a job'
);

-- The fixtures below exercise attendance and decision state. Their synthetic
-- source hashes intentionally do not emulate the full Chat source projection.
alter table dashboard_private.registration_observation_domain_events
  disable trigger registration_observation_google_chat_materializer;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('99600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retirement-admin@example.invalid', crypt('retirement-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retirement-staff@example.invalid', crypt('retirement-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99600000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retirement-teacher@example.invalid', crypt('retirement-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99600000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retirement-director@example.invalid', crypt('retirement-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('99600000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retirement-unrelated@example.invalid', crypt('retirement-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('99600000-0000-4000-8000-000000000001', 'admin', '피드백 은퇴 관리자', 'retirement-admin@example.invalid', now(), now()),
  ('99600000-0000-4000-8000-000000000002', 'staff', '피드백 은퇴 직원', 'retirement-staff@example.invalid', now(), now()),
  ('99600000-0000-4000-8000-000000000003', 'teacher', '피드백 은퇴 담당강사', 'retirement-teacher@example.invalid', now(), now()),
  ('99600000-0000-4000-8000-000000000004', 'admin', '피드백 은퇴 담당원장', 'retirement-director@example.invalid', now(), now()),
  ('99600000-0000-4000-8000-000000000005', 'teacher', '피드백 은퇴 무관강사', 'retirement-unrelated@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

update public.teacher_catalogs
set name = '피드백 은퇴 담당강사',
    subjects = array['영어']::text[],
    is_visible = true,
    sort_order = 9961,
    account_email = 'retirement-teacher@example.invalid',
    dashboard_role = 'teacher'
where profile_id = '99600000-0000-4000-8000-000000000003';
insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email,
  dashboard_role
)
select
  '99600000-0000-4000-8000-000000000101', '피드백 은퇴 담당강사',
  array['영어']::text[], true, 9961,
  '99600000-0000-4000-8000-000000000003',
  'retirement-teacher@example.invalid', 'teacher'
where not exists (
  select 1
  from public.teacher_catalogs catalog
  where catalog.profile_id = '99600000-0000-4000-8000-000000000003'
);
update public.profiles
set teacher_catalog_id = (
  select catalog.id
  from public.teacher_catalogs catalog
  where catalog.profile_id = '99600000-0000-4000-8000-000000000003'
)
where id = '99600000-0000-4000-8000-000000000003';

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  '99600000-0000-4000-8000-000000000102', '피드백 은퇴 101호',
  array['영어']::text[], true, 9962, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
values (
  '99600000-0000-4000-8000-000000000103', '피드백 은퇴 영어반',
  '영어', '수업 진행 중', 'normalized', '{"sessions":[]}'::jsonb
);
do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '99600000-0000-4000-8000-000000000103',
    '99600000-0000-4000-8000-000000000190',
    'registration_teacher_feedback_request_retirement_test'
  );
end;
$$;
insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state,
  start_time, end_time, teacher_catalog_id, teacher_name_snapshot,
  classroom_catalog_id, classroom_name_snapshot, origin, revision
)
values (
  '99600000-0000-4000-8000-000000000104',
  '99600000-0000-4000-8000-000000000103',
  'retirement-past-session', current_date - 2, 'active', '18:00', '20:00',
  (select catalog.id from public.teacher_catalogs catalog
    where catalog.profile_id = '99600000-0000-4000-8000-000000000003'),
  '피드백 은퇴 담당강사',
  '99600000-0000-4000-8000-000000000102', '피드백 은퇴 101호',
  'manual', 7
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values
  ('99600000-0000-4000-8000-000000000105', '피드백 없는 원장 결정', 'registration', 'requested', 'normal', '99600000-0000-4000-8000-000000000001', '은퇴 결정학생'),
  ('99600000-0000-4000-8000-000000000115', '진행상태 독립 출석', 'registration', 'requested', 'normal', '99600000-0000-4000-8000-000000000001', '은퇴 출석학생');
insert into public.ops_registration_details(task_id)
values
  ('99600000-0000-4000-8000-000000000105'),
  ('99600000-0000-4000-8000-000000000115');

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values
  ('99600000-0000-4000-8000-000000000106', '99600000-0000-4000-8000-000000000105', '영어', 'consultation_waiting', '99600000-0000-4000-8000-000000000004', 'manual', now(), false, 'consultation_completed', 41, now(), null, 1),
  ('99600000-0000-4000-8000-000000000116', '99600000-0000-4000-8000-000000000115', '영어', 'consultation_waiting', '99600000-0000-4000-8000-000000000004', 'manual', now(), false, 'consultation_completed', 17, now(), null, 1);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status,
  notification_revision, created_by
)
values
  ('99600000-0000-4000-8000-000000000107', '99600000-0000-4000-8000-000000000105', 'observation_class', now() - interval '2 days', '본관', 'completed', 4, '99600000-0000-4000-8000-000000000001'),
  ('99600000-0000-4000-8000-000000000117', '99600000-0000-4000-8000-000000000115', 'observation_class', now() - interval '2 days', '본관', 'scheduled', 5, '99600000-0000-4000-8000-000000000001');

insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, status, attendance,
  attendance_recorded_by, attendance_recorded_at, feedback_revision, revision,
  created_by, updated_by
)
values
  ('99600000-0000-4000-8000-000000000108', '99600000-0000-4000-8000-000000000105', '99600000-0000-4000-8000-000000000106', '99600000-0000-4000-8000-000000000107', '99600000-0000-4000-8000-000000000103', 'normalized', '99600000-0000-4000-8000-000000000104', null, current_date - 2, ((current_date - 2 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 2 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{"authority":"normalized","sessionId":"99600000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('a', 64), (select catalog.id from public.teacher_catalogs catalog where catalog.profile_id = '99600000-0000-4000-8000-000000000003'), '99600000-0000-4000-8000-000000000003', '99600000-0000-4000-8000-000000000102', '영어', '피드백 은퇴 영어반', '피드백 은퇴 담당강사', '피드백 은퇴 101호', '본관', 'attended_feedback_pending', 'attended', '99600000-0000-4000-8000-000000000002', now() - interval '2 days', 0, 5, '99600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000001'),
  ('99600000-0000-4000-8000-000000000118', '99600000-0000-4000-8000-000000000115', '99600000-0000-4000-8000-000000000116', '99600000-0000-4000-8000-000000000117', '99600000-0000-4000-8000-000000000103', 'normalized', '99600000-0000-4000-8000-000000000104', null, current_date - 2, ((current_date - 2 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 2 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{"authority":"normalized","sessionId":"99600000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('b', 64), (select catalog.id from public.teacher_catalogs catalog where catalog.profile_id = '99600000-0000-4000-8000-000000000003'), '99600000-0000-4000-8000-000000000003', '99600000-0000-4000-8000-000000000102', '영어', '피드백 은퇴 영어반', '피드백 은퇴 담당강사', '피드백 은퇴 101호', '본관', 'scheduled', null, null, null, 0, 3, '99600000-0000-4000-8000-000000000001', '99600000-0000-4000-8000-000000000001');

insert into dashboard_private.registration_observation_domain_events(
  observation_id, appointment_id, notification_revision,
  event_kind, booking_fact_hash, source_revision
)
values
  ('99600000-0000-4000-8000-000000000108', '99600000-0000-4000-8000-000000000107', 4, 'observation_attendance_recorded', repeat('a', 64), '{"authority":"normalized","sessionId":"99600000-0000-4000-8000-000000000104","revision":7}'::jsonb),
  ('99600000-0000-4000-8000-000000000118', '99600000-0000-4000-8000-000000000117', 5, 'observation_scheduled', repeat('b', 64), '{"authority":"normalized","sessionId":"99600000-0000-4000-8000-000000000104","revision":7}'::jsonb);

select is(
  (
    select count(*)
    from dashboard_private.registration_observation_feedback_tasks link
    where link.observation_id in (
      '99600000-0000-4000-8000-000000000108',
      '99600000-0000-4000-8000-000000000118'
    )
  ),
  0::bigint,
  'creating observation rows no longer creates linked teacher tasks'
);
select is(
  (
    select count(*)
    from dashboard_private.registration_observation_chat_jobs job
    where job.observation_id = '99600000-0000-4000-8000-000000000118'
      and job.event_key = 'registration.observation_feedback_due'
  ),
  0::bigint,
  'scheduling an observation no longer creates a feedback-due job'
);

insert into dashboard_private.registration_observation_runtime_settings(
  singleton, activation_version, updated_at, updated_by
)
values (
  true, 1, now(), '99600000-0000-4000-8000-000000000001'
)
on conflict (singleton) do update
set activation_version = excluded.activation_version,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

create or replace function pg_temp.feedback_retirement_set_actor(p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

select pg_temp.feedback_retirement_set_actor('99600000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.record_registration_observation_attendance_v1(
    '99600000-0000-4000-8000-000000000118', 3, 5,
    'feedback-retirement-teacher-attendance'
  )$$,
  '42501',
  'registration_observation_attendance_access_denied',
  'the assigned teacher cannot write observation attendance'
);
reset role;

select pg_temp.feedback_retirement_set_actor('99600000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select public.record_registration_observation_attendance_v1(
    '99600000-0000-4000-8000-000000000118', 3, 5,
    'feedback-retirement-attendance'
  )$$,
  'management may record attendance regardless of the manual workflow status'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'observationStatus', observation.status,
      'attendance', observation.attendance,
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision,
      'feedbackTaskCount', (
        select count(*)
        from dashboard_private.registration_observation_feedback_tasks link
        where link.observation_id = observation.id
      )
    )
    from public.ops_registration_observations observation
    join public.ops_registration_subject_tracks track on track.id = observation.track_id
    where observation.id = '99600000-0000-4000-8000-000000000118'
  ),
  '{"observationStatus":"attended_feedback_pending","attendance":"attended","workflowStatus":"consultation_completed","workflowRevision":17,"feedbackTaskCount":0}'::jsonb,
  'attendance records facts while preserving the manual status property'
);

update public.ops_registration_subject_tracks
set director_profile_id = '99600000-0000-4000-8000-000000000005'
where id = '99600000-0000-4000-8000-000000000106';
select pg_temp.feedback_retirement_set_actor('99600000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  $$select public.decide_registration_observation_v1(
    '99600000-0000-4000-8000-000000000108', 'enrollment', null,
    5, 0, 1, 'feedback-retirement-unrelated-decision'
  )$$,
  'P0002',
  'registration_observation_not_found',
  'a teacher cannot make the decision even when assigned as track director'
);
reset role;

-- reset_role changes the database role only; the request JWT remains the
-- teacher from the denied call above. Restore a manager actor before changing
-- fixture ownership through the manager-write fence.
select pg_temp.feedback_retirement_set_actor('99600000-0000-4000-8000-000000000001');
update public.ops_registration_subject_tracks
set director_profile_id = '99600000-0000-4000-8000-000000000004'
where id = '99600000-0000-4000-8000-000000000106';
select pg_temp.feedback_retirement_set_actor('99600000-0000-4000-8000-000000000004');
set local role authenticated;
select lives_ok(
  $$select public.decide_registration_observation_v1(
    '99600000-0000-4000-8000-000000000108', 'enrollment', null,
    5, 0, 1, 'feedback-retirement-director-decision'
  )$$,
  'the exact director may confirm the Chat report without feedback fields'
);
reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'decisionKind', observation.decision_kind,
      'observationStatus', observation.status,
      'feedbackReason', observation.feedback_reason,
      'feedbackSubmittedAt', observation.feedback_submitted_at,
      'workflowStatus', track.workflow_status,
      'workflowRevision', track.workflow_revision
    )
    from public.ops_registration_observations observation
    join public.ops_registration_subject_tracks track on track.id = observation.track_id
    where observation.id = '99600000-0000-4000-8000-000000000108'
  ),
  '{"decisionKind":"enrollment","observationStatus":"attended_feedback_pending","feedbackReason":null,"feedbackSubmittedAt":null,"workflowStatus":"consultation_completed","workflowRevision":41}'::jsonb,
  'director confirmation writes the decision fact without changing status or fabricating feedback'
);
select is(
  (
    select event.after_value::jsonb -> 'metadata' -> 'workflowRevisionBefore'
      = event.after_value::jsonb -> 'metadata' -> 'workflowRevisionAfter'
    from public.ops_task_events event
    where event.task_id = '99600000-0000-4000-8000-000000000105'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'event_type' = 'registration_observation_decided'
    order by event.created_at desc, event.id desc
    limit 1
  ),
  true,
  'decision audit records an unchanged workflow revision matrix'
);

select pg_temp.feedback_retirement_set_actor('99600000-0000-4000-8000-000000000002');
select is(
  dashboard_private.validate_registration_observation_class_start_source_v1(
    '99600000-0000-4000-8000-000000000106',
    '99600000-0000-4000-8000-000000000108',
    '99600000-0000-4000-8000-000000000103',
    current_date - 2,
    'retirement-past-session',
    '99600000-0000-4000-8000-000000000104'
  ) ->> 'observationId',
  '99600000-0000-4000-8000-000000000108',
  'a director-approved attended observation remains a usable enrollment source'
);

select is(
  (
    select count(*)
    from dashboard_private.registration_observation_chat_jobs job
    where job.observation_id in (
      '99600000-0000-4000-8000-000000000108',
      '99600000-0000-4000-8000-000000000118'
    )
      and job.event_key = 'registration.observation_feedback_due'
  ),
  0::bigint,
  'attendance and decision create no feedback-due producer rows'
);
select is(
  (
    select count(*)
    from dashboard_private.registration_observation_feedback_tasks link
    where link.observation_id in (
      '99600000-0000-4000-8000-000000000108',
      '99600000-0000-4000-8000-000000000118'
    )
  ),
  0::bigint,
  'attendance and decision create no teacher feedback task links'
);

alter table dashboard_private.registration_observation_domain_events
  enable trigger registration_observation_google_chat_materializer;
select * from finish();
rollback;
