begin;
select plan(8);

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
    'f7000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'legacy-slot-admin@example.invalid',
    crypt('legacy-slot-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  ),
  (
    'f7000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'legacy-slot-teacher@example.invalid',
    crypt('legacy-slot-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    'f7000000-0000-4000-8000-000000000001', 'admin',
    '구형 일정 관리자', 'legacy-slot-admin@example.invalid', now(), now()
  ),
  (
    'f7000000-0000-4000-8000-000000000002', 'teacher',
    '구형 일정 선생님', 'legacy-slot-teacher@example.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id = 'f7000000-0000-4000-8000-000000000002';
insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email,
  dashboard_role
)
values (
  'f7000000-0000-4000-8000-000000000011', '구형 일정 선생님',
  array['영어']::text[], true, 9961,
  'f7000000-0000-4000-8000-000000000002',
  'legacy-slot-teacher@example.invalid', 'teacher'
);
update public.profiles
set teacher_catalog_id = 'f7000000-0000-4000-8000-000000000011'
where id = 'f7000000-0000-4000-8000-000000000002';

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
)
values (
  'f7000000-0000-4000-8000-000000000012', '구형 일정 101호',
  array['영어']::text[], true, 9962, '본관'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan,
  schedule, teacher, room
)
values (
  'f7000000-0000-4000-8000-000000000020', '구형 일정 영어반',
  '영어', '수업 진행 중', 'legacy',
  pg_catalog.jsonb_build_object(
    'sessions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sessionKey', 'legacy-slot-session-a',
        'date', (current_date + 21)::text,
        'scheduleState', 'active',
        'teacherCatalogId', 'f7000000-0000-4000-8000-000000000011',
        'teacherName', '구형 일정 선생님',
        'classroomCatalogId', 'f7000000-0000-4000-8000-000000000012',
        'classroomName', '구형 일정 101호'
      )
    ),
    'textbooks', '[]'::jsonb
  ),
  (case extract(dow from current_date + 21)::integer
    when 0 then '일'
    when 1 then '월'
    when 2 then '화'
    when 3 then '수'
    when 4 then '목'
    when 5 then '금'
    when 6 then '토'
  end) || ' 16:00-18:00',
  '구형 일정 선생님',
  '구형 일정 101호'
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name
)
values (
  'f7000000-0000-4000-8000-000000000030', '구형 일정 청강 fixture',
  'registration', 'requested', 'normal',
  'f7000000-0000-4000-8000-000000000001', '구형 일정 학생'
);
insert into public.ops_registration_details(task_id)
values ('f7000000-0000-4000-8000-000000000030');
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values (
  'f7000000-0000-4000-8000-000000000031',
  'f7000000-0000-4000-8000-000000000030',
  '영어', 'consultation_waiting',
  'f7000000-0000-4000-8000-000000000002',
  'manual', now(), false,
  'observation_requested', 1, now(), 'consultation_completed', 0
);

update dashboard_private.registration_observation_runtime_settings
set activation_version = 1,
    updated_at = now(),
    updated_by = 'f7000000-0000-4000-8000-000000000001'
where singleton = true;

create temporary table legacy_schedule_slot_results(
  response jsonb not null
) on commit drop;
grant all on legacy_schedule_slot_results to authenticated;

select has_function(
  'dashboard_private',
  'registration_observation_effective_legacy_slots_v1',
  array['uuid'],
  'private effective legacy-slot helper exists'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'stable', function_row.provolatile = 's',
      'securityDefiner', function_row.prosecdef,
      'owner', pg_catalog.pg_get_userbyid(function_row.proowner),
      'authenticated', pg_catalog.has_function_privilege(
        'authenticated', function_row.oid, 'EXECUTE'
      ),
      'serviceRole', pg_catalog.has_function_privilege(
        'service_role', function_row.oid, 'EXECUTE'
      )
    )
    from pg_catalog.pg_proc function_row
    where function_row.oid = pg_catalog.to_regprocedure(
      'dashboard_private.registration_observation_effective_legacy_slots_v1(uuid)'
    )
  ),
  '{"stable":true,"securityDefiner":true,"owner":"postgres","authenticated":false,"serviceRole":false}'::jsonb,
  'effective legacy-slot helper is private stable and owner fenced'
);
select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'slotId', slot.id,
        'weekday', slot.weekday,
        'startTime', pg_catalog.to_char(slot.start_time, 'HH24:MI'),
        'endTime', pg_catalog.to_char(slot.end_time, 'HH24:MI'),
        'teacherName', slot.teacher_name,
        'classroomName', slot.classroom_name
      ) order by slot.sort_order, slot.weekday, slot.start_time
    )
    from dashboard_private.registration_observation_effective_legacy_slots_v1(
      'f7000000-0000-4000-8000-000000000020'
    ) slot
  ),
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'slotId', null,
    'weekday', extract(dow from current_date + 21)::smallint,
    'startTime', '16:00',
    'endTime', '18:00',
    'teacherName', '구형 일정 선생님',
    'classroomName', '구형 일정 101호'
  )),
  'slotless legacy class derives one exact virtual slot from classes.schedule'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'f7000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'email', 'legacy-slot-admin@example.invalid'
  )::text,
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'f7000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

set local role authenticated;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'count', pg_catalog.jsonb_array_length(payload),
      'sessionKey', payload -> 0 -> 'sessionKey',
      'startsAt', payload -> 0 -> 'startsAt',
      'endsAt', payload -> 0 -> 'endsAt',
      'teacherName', payload -> 0 -> 'teacherName',
      'classroomName', payload -> 0 -> 'classroomName'
    )
    from (
      select public.list_registration_observation_sessions_v1(
        'f7000000-0000-4000-8000-000000000031',
        'f7000000-0000-4000-8000-000000000020',
        current_date + 21,
        current_date + 21
      ) payload
    ) result
  ),
  pg_catalog.jsonb_build_object(
    'count', 1,
    'sessionKey', 'legacy-slot-session-a',
    'startsAt', (current_date + 21 + time '16:00') at time zone 'Asia/Seoul',
    'endsAt', (current_date + 21 + time '18:00') at time zone 'Asia/Seoul',
    'teacherName', '구형 일정 선생님',
    'classroomName', '구형 일정 101호'
  ),
  'slotless legacy class lists one selectable schedule-plan session'
);

insert into legacy_schedule_slot_results(response)
select public.save_registration_observation_booking_v1(
  'f7000000-0000-4000-8000-000000000031', null,
  'f7000000-0000-4000-8000-000000000020', 'legacy',
  null, 'legacy-slot-session-a',
  1, null, null, 'legacy-slot-booking'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'sessionKey', result.response -> 'observation' -> 'sessionKey',
      'legacySessionKey', result.response -> 'observation' -> 'legacySessionKey',
      'startsAt', result.response -> 'observation' -> 'startsAt',
      'endsAt', result.response -> 'observation' -> 'endsAt',
      'teacherName', result.response -> 'observation' -> 'teacherName',
      'classroomName', result.response -> 'observation' -> 'classroomName'
    )
    from legacy_schedule_slot_results result
  ),
  pg_catalog.jsonb_build_object(
    'sessionKey', 'legacy-slot-session-a',
    'legacySessionKey', 'legacy-slot-session-a',
    'startsAt', (current_date + 21 + time '16:00') at time zone 'Asia/Seoul',
    'endsAt', (current_date + 21 + time '18:00') at time zone 'Asia/Seoul',
    'teacherName', '구형 일정 선생님',
    'classroomName', '구형 일정 101호'
  ),
  'slotless legacy booking persists the exact selected schedule facts'
);

select is(
  dashboard_private.assert_registration_observation_current_session_v1(
    (
      select (result.response -> 'observation' ->> 'observationId')::uuid
      from legacy_schedule_slot_results result
    ),
    'submit_feedback'
  ),
  pg_catalog.jsonb_build_object(
    'startsAt', (current_date + 21 + time '16:00') at time zone 'Asia/Seoul',
    'endsAt', (current_date + 21 + time '18:00') at time zone 'Asia/Seoul',
    'sourceRevision', pg_catalog.jsonb_build_object(
      'authority', 'legacy',
      'sessionKey', 'legacy-slot-session-a',
      'contentHash', dashboard_private.registration_observation_legacy_session_content_hash_v1(
        (select class.schedule_plan from public.classes class
         where class.id = 'f7000000-0000-4000-8000-000000000020'),
        'legacy-slot-session-a'
      )
    )
  ),
  'slotless legacy feedback revalidates the exact stored booking facts'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'legacySessionKey', payload -> 'legacySessionKey',
      'startsAt', payload -> 'startsAt',
      'endsAt', payload -> 'endsAt',
      'teacherName', payload -> 'teacherName',
      'classroomName', payload -> 'classroomName'
    )
    from (
      select dashboard_private.get_registration_observation_notification_source_impl_v1(
        (result.response -> 'observation' ->> 'observationId')::uuid
      ) payload
      from legacy_schedule_slot_results result
    ) source_result
  ),
  pg_catalog.jsonb_build_object(
    'legacySessionKey', 'legacy-slot-session-a',
    'startsAt', (current_date + 21 + time '16:00') at time zone 'Asia/Seoul',
    'endsAt', (current_date + 21 + time '18:00') at time zone 'Asia/Seoul',
    'teacherName', '구형 일정 선생님',
    'classroomName', '구형 일정 101호'
  ),
  'slotless legacy notification source keeps the selected schedule facts'
);

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    'f7000000-0000-4000-8000-000000000020',
    'f7000000-0000-4000-8000-000000000001',
    'registration_observation_legacy_schedule_slots_test'
  );
end;
$$;
insert into public.class_schedule_slots(
  id, class_id, weekday, start_time, end_time,
  teacher_catalog_id, teacher_name, classroom_catalog_id, classroom_name,
  sort_order
)
values (
  'f7000000-0000-4000-8000-000000000040',
  'f7000000-0000-4000-8000-000000000020',
  extract(dow from current_date + 21)::smallint,
  '17:00', '19:00',
  'f7000000-0000-4000-8000-000000000011', '구형 일정 선생님',
  'f7000000-0000-4000-8000-000000000012', '구형 일정 101호',
  0
);
select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'slotId', slot.id,
        'startTime', pg_catalog.to_char(slot.start_time, 'HH24:MI'),
        'endTime', pg_catalog.to_char(slot.end_time, 'HH24:MI')
      ) order by slot.sort_order, slot.weekday, slot.start_time
    )
    from dashboard_private.registration_observation_effective_legacy_slots_v1(
      'f7000000-0000-4000-8000-000000000020'
    ) slot
  ),
  '[{"slotId":"f7000000-0000-4000-8000-000000000040","startTime":"17:00","endTime":"19:00"}]'::jsonb,
  'persisted schedule slots stay authoritative when any shadow slot exists'
);

select * from finish();
rollback;
