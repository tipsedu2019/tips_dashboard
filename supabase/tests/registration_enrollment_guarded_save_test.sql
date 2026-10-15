-- Run only against an explicitly authorized isolated synthetic database with
-- the complete migration chain. Record runtime results against the exact source.
-- Every fixture and fault-injection object belongs to this rollback transaction.
-- Sequential stale-snapshot cases do not claim cross-session concurrency proof.
begin;

set local role postgres;
set local search_path = extensions, public;
select no_plan();
set local timezone = 'Asia/Seoul';
set local statement_timeout = '60s';
set local lock_timeout = '5s';

select has_function('public', 'save_registration_enrollment_details_guarded_v2',
  array['uuid', 'jsonb', 'jsonb', 'integer', 'text'],
  'guarded enrollment RPC has the expected snapshot and workflow revision contract');
select has_function('dashboard_private', 'save_registration_enrollment_details_guarded_v2_impl',
  array['uuid', 'jsonb', 'jsonb', 'integer', 'text'],
  'the guarded implementation has the same five arguments');
select hasnt_function('public', 'save_registration_enrollment_details_guarded_v2',
  array['uuid', 'jsonb', 'integer', 'text'],
  'there is no overload that silently omits the expected enrollment rows');
select function_returns('public', 'save_registration_enrollment_details_guarded_v2',
  array['uuid', 'jsonb', 'jsonb', 'integer', 'text'], 'jsonb',
  'the save returns durable enrollment rows and final workflow state');
select function_privs_are('public', 'save_registration_enrollment_details_guarded_v2',
  array['uuid', 'jsonb', 'jsonb', 'integer', 'text'], 'authenticated', array['EXECUTE'],
  'authenticated callers can execute the guarded public RPC');
select ok(not pg_catalog.has_function_privilege('anon',
    'public.save_registration_enrollment_details_guarded_v2(uuid,jsonb,jsonb,integer,text)', 'execute')
  and not pg_catalog.has_function_privilege('service_role',
    'public.save_registration_enrollment_details_guarded_v2(uuid,jsonb,jsonb,integer,text)', 'execute'),
  'anonymous and service-role callers receive no guarded public RPC grant');
select ok(not pg_catalog.has_function_privilege('anon',
    'dashboard_private.save_registration_enrollment_details_guarded_v2_impl(uuid,jsonb,jsonb,integer,text)', 'execute')
  and not pg_catalog.has_function_privilege('service_role',
    'dashboard_private.save_registration_enrollment_details_guarded_v2_impl(uuid,jsonb,jsonb,integer,text)', 'execute')
  and pg_catalog.has_function_privilege('authenticated',
    'dashboard_private.save_registration_enrollment_details_guarded_v2_impl(uuid,jsonb,jsonb,integer,text)', 'execute'),
  'implementation ACL preserves the authenticated wrapper execution boundary');
select is_empty($$
  select 1 from information_schema.routine_privileges
  where routine_schema in ('public', 'dashboard_private')
    and routine_name in ('save_registration_enrollment_details_guarded_v2',
      'save_registration_enrollment_details_guarded_v2_impl', 'registration_enrollment_save_snapshot_v2')
    and grantee = 'PUBLIC' and privilege_type = 'EXECUTE'
$$, 'no new guarded function inherits a PUBLIC execute grant');
select ok(not pg_catalog.has_function_privilege('authenticated',
    'dashboard_private.registration_enrollment_save_snapshot_v2(uuid)', 'execute')
  and not pg_catalog.has_function_privilege('anon',
    'dashboard_private.registration_enrollment_save_snapshot_v2(uuid)', 'execute')
  and not pg_catalog.has_function_privilege('service_role',
    'dashboard_private.registration_enrollment_save_snapshot_v2(uuid)', 'execute'),
  'internal snapshot reader cannot expose enrollment data as a separate API');
select ok((select not procedure.prosecdef and procedure.provolatile = 'v'
    and cardinality(procedure.proconfig) = 1 and procedure.proconfig[1] in ('search_path=', 'search_path=""')
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.save_registration_enrollment_details_guarded_v2(uuid,jsonb,jsonb,integer,text)'::regprocedure),
  'the public wrapper is volatile SECURITY INVOKER with an empty search path');
select ok((select procedure.prosecdef and procedure.provolatile = 'v'
    and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
    and cardinality(procedure.proconfig) = 1 and procedure.proconfig[1] in ('search_path=', 'search_path=""')
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'dashboard_private.save_registration_enrollment_details_guarded_v2_impl(uuid,jsonb,jsonb,integer,text)'::regprocedure),
  'the private writer is a postgres-owned SECURITY DEFINER with an empty search path');

-- Inspect the installed final definition, including later migrations. A source
-- file match alone does not establish the actual function or its SQLSTATE.
select ok((select definition !~ '40001'
    and definition ~ 'registration_enrollment_details_refresh_required[^;]*23514'
    and definition ~ 'registration_mutation_request_conflict[^;]*22023'
  from (select pg_catalog.pg_get_functiondef(
    'dashboard_private.save_registration_enrollment_details_guarded_v2_impl(uuid,jsonb,jsonb,integer,text)'::regprocedure
  ) as definition) final),
  'final guarded definition uses exact non-retryable domain SQLSTATEs');
select ok((select pg_catalog.strpos(definition, 'pg_advisory_xact_lock') > 0
    and pg_catalog.strpos(definition, 'pg_advisory_xact_lock')
      < pg_catalog.strpos(definition, 'perform 1 from public.ops_tasks task')
    and pg_catalog.strpos(definition, 'perform 1 from public.ops_tasks task')
      < pg_catalog.strpos(definition, 'select track.* into v_track')
    and pg_catalog.strpos(definition, 'select track.* into v_track')
      < pg_catalog.strpos(definition, 'perform 1 from public.ops_registration_enrollments enrollment')
  from (select pg_catalog.pg_get_functiondef(
    'dashboard_private.save_registration_enrollment_details_guarded_v2_impl(uuid,jsonb,jsonb,integer,text)'::regprocedure
  ) as definition) final),
  'final guarded writer locks request, task, track, then enrollment rows');
select ok((select pg_catalog.strpos(definition, 'from dashboard_private.ops_registration_mutations mutation') > 0
    and pg_catalog.strpos(definition, 'return v_response;')
      < pg_catalog.strpos(definition, 'registration_enrollment_save_snapshot_v2(p_track_id)')
  from (select pg_catalog.pg_get_functiondef(
    'dashboard_private.save_registration_enrollment_details_guarded_v2_impl(uuid,jsonb,jsonb,integer,text)'::regprocedure
  ) as definition) final),
  'final guarded writer resolves a matching receipt before freshness checks');
select ok((select definition ~ 'registration_observation_booking_required[^;]*23514'
    and definition !~ '40001'
    and definition like '%observation.decision_kind is null%'
  from (select pg_catalog.pg_get_functiondef(
    'dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::regprocedure
  ) as definition) final),
  'final status setter requires an undecided booked observation with SQLSTATE 23514');
select ok((select pg_catalog.strpos(definition, 'pg_advisory_xact_lock') > 0
    and pg_catalog.strpos(definition, 'pg_advisory_xact_lock')
      < pg_catalog.strpos(definition, 'for no key update of task')
    and pg_catalog.strpos(definition, 'for no key update of task')
      < pg_catalog.strpos(definition, 'for update of track')
  from (select pg_catalog.pg_get_functiondef(
    'dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)'::regprocedure
  ) as definition) final),
  'the installed legacy detail writer shares the request/task/track lock order');

select ok((select definition ~ 'ops_tasks task[^;]*for no key update'
    and definition ~ 'select track\.\* into v_track[^;]*for update'
    and definition ~ 'ops_registration_enrollments enrollment[^;]*for update'
  from (select pg_catalog.pg_get_functiondef(
    'dashboard_private.save_registration_enrollment_details_guarded_v2_impl(uuid,jsonb,jsonb,integer,text)'::regprocedure
  ) as definition) final),
  'final guarded task lock permits audit FK KEY SHARE without weakening track or enrollment locks');
select ok((select pg_catalog.pg_get_functiondef(
    'dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)'::regprocedure
  ) ~ 'for no key update of task'
  and pg_catalog.pg_get_functiondef(
    'public.save_registration_enrollment_rows(uuid,jsonb,text)'::regprocedure
  ) ~ 'ops_tasks task[^;]*for no key update'),
  'both compatibility writers retain the FK-compatible task write lock');
select is((select count(*) from pg_catalog.pg_trigger trigger
    where trigger.tgrelid = 'public.ops_task_events'::regclass
      and not trigger.tgisinternal and (trigger.tgtype::integer & 4) = 4),
  1::bigint, 'the final event INSERT path has only the active collaboration-role trigger');
select ok(exists (select 1 from pg_catalog.pg_trigger trigger
    where trigger.tgrelid = 'public.ops_task_events'::regclass and not trigger.tgisinternal
      and (trigger.tgtype::integer & 4) = 4
      and trigger.tgfoid = 'dashboard_private.enforce_registration_collaboration_write_role_v1()'::regprocedure)
  and pg_catalog.pg_get_functiondef(
    'dashboard_private.enforce_registration_collaboration_write_role_v1()'::regprocedure
  ) !~* '(update|insert into|delete from)[[:space:]]+public[.]ops_tasks|for[[:space:]]+(no key[[:space:]]+)?update',
  'the remaining event INSERT trigger reads authorization without upgrading the task row lock');

create function pg_temp.registration_guard_sid(p_number integer)
returns uuid language sql immutable as $$
  select ('a9700000-0000-4000-8000-' || lpad(p_number::text, 12, '0'))::uuid;
$$;
create function pg_temp.registration_guard_actor(p_number integer)
returns void language plpgsql as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',
    coalesce(pg_temp.registration_guard_sid(p_number)::text, ''), true);
  perform pg_catalog.set_config('request.jwt.claim.role',
    case when p_number is null then '' else 'authenticated' end, true);
  perform pg_catalog.set_config('request.jwt.claims', case when p_number is null then '{}'
    else pg_catalog.jsonb_build_object('sub', pg_temp.registration_guard_sid(p_number),
      'role', 'authenticated', 'user_metadata', pg_catalog.jsonb_build_object('role', 'admin'))::text end, true);
end;
$$;
create function pg_temp.registration_guard_rows(
  p_complete boolean default true, p_class_number integer default 21, p_sort_order integer default 0
)
returns jsonb language sql stable as $$
  select pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'classId', pg_temp.registration_guard_sid(p_class_number), 'textbookIds', '[]'::jsonb,
    'classStartDate', case when p_complete then current_date + 7 else null end,
    'classStartSessionKey', case when p_complete then to_char(current_date + 7, 'YYYY-MM-DD') || ':1' else null end,
    'classStartSession', case when p_complete then '입력한 합성 라벨' else null end,
    'classStartLessonSessionId', case when p_complete and p_class_number = 22 then pg_temp.registration_guard_sid(41) else null end,
    'classStartSourceObservationId', null, 'sortOrder', p_sort_order));
$$;

-- A prior test must not lend this fixture an actor. Overwrite both JWT forms,
-- including malformed inherited values, before creating the synthetic accounts.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'malformed-fixture-sub', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', 'malformed-fixture-json', true);
end; $$;
select pg_temp.registration_guard_actor(null);
select ok((select auth.uid()) is null and (select auth.role()) is null
    and current_setting('request.jwt.claim.sub') = ''
    and current_setting('request.jwt.claim.role') = ''
    and current_setting('request.jwt.claims')::jsonb = '{}'::jsonb,
  'fixture bootstrap clears malformed or stale JWT settings without inheriting an actor');

insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, banned_until, deleted_at)
select pg_temp.registration_guard_sid(number), 'authenticated', 'authenticated',
  'registration-guard-' || number || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb, '{"role":"admin","fixture":true}'::jsonb,
  case number when 5 then now() + interval '1 day' when 7 then now() - interval '1 day' else null end,
  case when number = 6 then now() else null end
from generate_series(1, 7) number;
insert into public.profiles(id, role, name, email)
select pg_temp.registration_guard_sid(number),
  case number when 1 then 'admin' when 2 then 'staff' when 3 then 'teacher'
    when 4 then 'assistant' when 5 then 'staff' else 'admin' end,
  '등록 저장 합성 계정', 'registration-guard-' || number || '@example.invalid'
from generate_series(1, 7) number
on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email;

-- postgres supplies fixture DDL/seed privileges, but enrollment and registration
-- triggers also require auth.uid() backed by a live admin/staff account.
select pg_temp.registration_guard_actor(1);
select ok(current_user = 'postgres'
    and (select auth.uid()) = pg_temp.registration_guard_sid(1)
    and (select auth.role()) = 'authenticated'
    and current_setting('request.jwt.claims')::jsonb ->> 'sub' = pg_temp.registration_guard_sid(1)::text
    and current_setting('request.jwt.claims')::jsonb ->> 'role' = 'authenticated'
    and dashboard_private.registration_actor_is_active_manager_v1((select auth.uid())),
  'fixture domain seeding has consistent JWT settings and an actual active manager');
update public.profiles set teacher_catalog_id = null
where id in (pg_temp.registration_guard_sid(2), pg_temp.registration_guard_sid(3));
delete from public.teacher_catalogs
where profile_id in (pg_temp.registration_guard_sid(2), pg_temp.registration_guard_sid(3));
insert into public.teacher_catalogs(id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role)
values
  (pg_temp.registration_guard_sid(31), '등록 저장 합성 계정', array['영어', '수학'], true, 9971,
    pg_temp.registration_guard_sid(3), 'registration-guard-3@example.invalid', 'teacher'),
  (pg_temp.registration_guard_sid(33), '등록 저장 합성 운영교사', array['영어'], true, 9973,
    pg_temp.registration_guard_sid(2), 'registration-guard-2@example.invalid', 'staff');
update public.profiles set teacher_catalog_id = case id
  when pg_temp.registration_guard_sid(2) then pg_temp.registration_guard_sid(33)
  else pg_temp.registration_guard_sid(31) end
where id in (pg_temp.registration_guard_sid(2), pg_temp.registration_guard_sid(3));
insert into public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)
values (pg_temp.registration_guard_sid(32), '등록 저장 합성 강의실', array['영어', '수학'], true, 9972, '본관');
-- Complete, nonoverlapping weekly/dated occupancy also satisfies the current
-- deferred timetable guard. The wrong-subject class remains a real math class.
insert into public.classes(id, name, subject, status, teacher, room, schedule, schedule_storage_mode, schedule_plan)
values
  (pg_temp.registration_guard_sid(21), '등록 저장 합성 영어반', '영어', '수업 진행 중',
    '등록 저장 합성 계정', '등록 저장 합성 강의실',
    substr('일월화수목금토', extract(dow from current_date + 7)::integer + 1, 1) || ' 14:00-16:00', 'legacy',
    jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object(
      'date', current_date + 7, 'sessionNumber', 1, 'scheduleState', 'active',
      'sessionKey', to_char(current_date + 7, 'YYYY-MM-DD') || ':1',
      'startTime', '14:00', 'endTime', '16:00',
      'teacherCatalogId', pg_temp.registration_guard_sid(31), 'classroomCatalogId', pg_temp.registration_guard_sid(32))))),
  (pg_temp.registration_guard_sid(22), '등록 저장 합성 정규화반', '영어', '수업 진행 중',
    '등록 저장 합성 계정', '등록 저장 합성 강의실',
    substr('일월화수목금토', extract(dow from current_date + 7)::integer + 1, 1) || ' 18:00-20:00',
    'normalized', '{"sessions":[]}'::jsonb),
  (pg_temp.registration_guard_sid(23), '등록 저장 합성 타과목반', '수학', '수업 진행 중',
    '등록 저장 합성 계정', '등록 저장 합성 강의실',
    substr('일월화수목금토', extract(dow from current_date + 7)::integer + 1, 1) || ' 10:00-12:00', 'legacy',
    jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object(
      'date', current_date + 7, 'sessionNumber', 1, 'scheduleState', 'active',
      'sessionKey', to_char(current_date + 7, 'YYYY-MM-DD') || ':1',
      'startTime', '10:00', 'endTime', '12:00',
      'teacherCatalogId', pg_temp.registration_guard_sid(31), 'classroomCatalogId', pg_temp.registration_guard_sid(32)))));
do $$ begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    pg_temp.registration_guard_sid(22), pg_temp.registration_guard_sid(42),
    'registration_enrollment_guarded_save_test');
end; $$;
insert into public.class_schedule_slots(id, class_id, weekday, start_time, end_time,
  teacher_catalog_id, teacher_name, classroom_catalog_id, classroom_name)
values (pg_temp.registration_guard_sid(43), pg_temp.registration_guard_sid(22),
  extract(dow from current_date + 7)::smallint, '18:00', '20:00',
  pg_temp.registration_guard_sid(31), '등록 저장 합성 계정',
  pg_temp.registration_guard_sid(32), '등록 저장 합성 강의실');
insert into public.class_lesson_sessions(id, class_id, source_schedule_slot_id, session_key, session_date, schedule_state,
  start_time, end_time, teacher_catalog_id, teacher_name_snapshot,
  classroom_catalog_id, classroom_name_snapshot, origin, revision)
values (pg_temp.registration_guard_sid(41), pg_temp.registration_guard_sid(22), pg_temp.registration_guard_sid(43),
  to_char(current_date + 7, 'YYYY-MM-DD') || ':1', current_date + 7, 'active', '18:00', '20:00',
  pg_temp.registration_guard_sid(31), '등록 저장 합성 계정',
  pg_temp.registration_guard_sid(32), '등록 저장 합성 강의실', 'manual', 1);
-- The schedule-write context belongs only to the one normalized lesson seed.
do $$ begin
  perform set_config('app.class_schedule_mutation', '', true);
  perform set_config('app.class_schedule_class_id', '', true);
  perform set_config('app.class_schedule_request_key', '', true);
  perform set_config('app.class_schedule_request_operation', '', true);
  perform set_config('app.class_schedule_change_reason', '', true);
end; $$;

create temporary table registration_guard_cases(
  number integer primary key, initial_status text not null, review_required boolean not null default false
) on commit drop;
insert into registration_guard_cases(number, initial_status, review_required) values
  (1, 'inquiry', false), (2, 'consultation_requested', false), (3, 'consultation_completed', false),
  (4, 'waiting_current_class', false), (5, 'waiting_new_class', false), (6, 'waiting_next_opening', false),
  (7, 'observation_requested', false), (8, 'observation_feedback_pending', false), (9, 'observation_completed', false),
  (10, 'level_test_requested', false), (11, 'enrollment_requested', false), (12, 'payment_in_progress', false),
  (13, 'registered', false), (14, 'not_registered', false), (15, 'inquiry_only', false), (16, 'inquiry', true);
insert into registration_guard_cases(number, initial_status)
select number, case when number = 25 then 'waiting_new_class'
  when number = 32 then 'consultation_completed' else 'consultation_requested' end
from generate_series(17, 33) number;
insert into public.ops_tasks(id, title, type, status, requested_by, student_name, subject, campus, priority)
select pg_temp.registration_guard_sid(200 + number), '등록 저장 합성 ' || number, 'registration', 'requested',
  pg_temp.registration_guard_sid(1), '등록 저장 합성 학생 ' || number, '영어', '본관', 'normal'
from registration_guard_cases;
insert into public.ops_registration_details(task_id)
select pg_temp.registration_guard_sid(200 + number) from registration_guard_cases;
insert into public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, director_profile_id, director_assignment_source, director_assigned_at)
select pg_temp.registration_guard_sid(300 + number), pg_temp.registration_guard_sid(200 + number),
  '영어', case when review_required then 'migration_review' else 'inquiry' end,
  review_required, initial_status, 1, now() - interval '1 day',
  case when initial_status like 'observation_%' then 'consultation_completed' else null end,
  pg_temp.registration_guard_sid(3), 'manual', now()
from registration_guard_cases;

-- A canceled admission-owned historical row is enough to require reconciliation.
-- A separate waitlist row tests roster_active without an admission batch.
insert into public.ops_registration_admission_batches(id, task_id, revision_number, status)
values (pg_temp.registration_guard_sid(520), pg_temp.registration_guard_sid(220), 1, 'canceled');
insert into public.students(id, name, grade, school, status, class_ids, waitlist_class_ids)
values (pg_temp.registration_guard_sid(51), '등록 저장 합성 대기학생', '중2', '합성중', '퇴원', '[]',
  jsonb_build_array(pg_temp.registration_guard_sid(21)));

-- Exercise the actual INSERT triggers before seeding the historical rows. These
-- failures must roll back; neither postgres nor forged metadata supplies a JWT
-- actor or grants a teacher/unknown account registration write access.
select pg_temp.registration_guard_actor(null);
select throws_ok($$insert into public.ops_registration_enrollments(id, track_id, class_id, status)
  values (pg_temp.registration_guard_sid(699), pg_temp.registration_guard_sid(320),
    pg_temp.registration_guard_sid(21), 'canceled')$$,
  '42501', 'registration_access_denied', 'historical enrollment seed rejects a missing JWT actor');
select pg_temp.registration_guard_actor(99);
select throws_ok($$insert into public.ops_registration_enrollments(id, track_id, class_id, status)
  values (pg_temp.registration_guard_sid(699), pg_temp.registration_guard_sid(320),
    pg_temp.registration_guard_sid(21), 'canceled')$$,
  '42501', 'registration_manager_write_access_denied', 'historical enrollment seed rejects an unknown JWT account');
select pg_temp.registration_guard_actor(3);
select throws_ok($$insert into public.ops_registration_enrollments(id, track_id, class_id, status)
  values (pg_temp.registration_guard_sid(699), pg_temp.registration_guard_sid(320),
    pg_temp.registration_guard_sid(21), 'canceled')$$,
  '42501', 'registration_manager_write_access_denied', 'forged admin metadata cannot authorize the teacher seed actor');
select pg_temp.registration_guard_actor(1);
select is((select count(*) from public.ops_registration_enrollments where id = pg_temp.registration_guard_sid(699)),
  0::bigint, 'all rejected seed attempts leave no enrollment row');
insert into public.ops_registration_enrollments(id, track_id, class_id, status, admission_batch_id, student_id, roster_active)
values
  (pg_temp.registration_guard_sid(620), pg_temp.registration_guard_sid(320), pg_temp.registration_guard_sid(21),
    'canceled', pg_temp.registration_guard_sid(520), null, false),
  (pg_temp.registration_guard_sid(633), pg_temp.registration_guard_sid(333), pg_temp.registration_guard_sid(21),
    'waitlisted', null, pg_temp.registration_guard_sid(51), true);

insert into public.ops_registration_appointments(id, task_id, kind, scheduled_at, place, status, notification_revision)
select pg_temp.registration_guard_sid(700 + number), pg_temp.registration_guard_sid(200 + number),
  'observation_class', (current_date + 7 + time '18:00') at time zone 'Asia/Seoul', '본관',
  case when number = 27 then 'canceled' else 'scheduled' end, 1
from (values (24), (25), (26), (27), (29)) fixture(number);
insert into public.ops_registration_observations(id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key, session_date, starts_at, ends_at,
  session_schedule_state, session_source_revision, legacy_session_source_hash, source_revision, booking_fact_hash,
  teacher_catalog_id, teacher_profile_id, classroom_catalog_id, subject, class_name_snapshot,
  teacher_name_snapshot, classroom_name_snapshot, campus, status, decision_kind, decided_by, decided_at)
select pg_temp.registration_guard_sid(800 + number), pg_temp.registration_guard_sid(200 + number),
  pg_temp.registration_guard_sid(300 + number), pg_temp.registration_guard_sid(700 + number),
  pg_temp.registration_guard_sid(case when number = 25 then 21 else 22 end),
  case when number = 25 then 'legacy' else 'normalized' end,
  case when number = 25 then null else pg_temp.registration_guard_sid(41) end,
  case when number = 25 then to_char(current_date + 7, 'YYYY-MM-DD') || ':1' else null end,
  current_date + 7, (current_date + 7 + case when number = 25 then time '14:00' else time '18:00' end) at time zone 'Asia/Seoul',
  (current_date + 7 + case when number = 25 then time '16:00' else time '20:00' end) at time zone 'Asia/Seoul', 'active',
  case when number = 25 then null else 1 end, case when number = 25 then repeat('a', 64) else null end,
  case when number = 25 then jsonb_build_object('authority', 'legacy',
      'sessionKey', to_char(current_date + 7, 'YYYY-MM-DD') || ':1', 'contentHash', repeat('a', 64))
    else jsonb_build_object('authority', 'normalized', 'sessionId', pg_temp.registration_guard_sid(41), 'revision', 1) end,
  repeat('b', 64), pg_temp.registration_guard_sid(31), pg_temp.registration_guard_sid(3),
  pg_temp.registration_guard_sid(32), '영어', '등록 저장 합성반', '등록 저장 합성 계정', '등록 저장 합성 강의실', '본관',
  case when number = 26 then 'canceled' else 'scheduled' end,
  case when number = 29 then 'waiting_new_class' else null end,
  case when number = 29 then pg_temp.registration_guard_sid(1) else null end,
  case when number = 29 then now() else null end
from (values (24), (25), (26), (27), (29)) fixture(number);

-- Validate the complete seed graph now, then restore the original constraint
-- timing before exercising multi-statement RPCs. No seed row is rolled back.
savepoint registration_guard_fixture_checks;
set constraints all immediate;
rollback to savepoint registration_guard_fixture_checks;
release savepoint registration_guard_fixture_checks;

create temporary table registration_guard_results(result_key text primary key, response jsonb not null) on commit drop;
grant all on registration_guard_results to authenticated;
grant select on registration_guard_cases to authenticated;
create temporary table registration_guard_no_send on commit drop as
select jsonb_build_object(
  'events', (select count(*) from dashboard_private.notification_events),
  'fanout', (select count(*) from dashboard_private.notification_event_fanout_jobs),
  'deliveries', (select count(*) from dashboard_private.notification_deliveries),
  'customerMessages', (select count(*) from public.ops_registration_customer_messages),
  'customerReminders', (select count(*) from dashboard_private.registration_customer_reminder_jobs),
  'observationChat', (select count(*) from dashboard_private.registration_observation_chat_jobs),
  'observationEvents', (select count(*) from dashboard_private.registration_observation_domain_events)
) as counts;
create temporary table registration_guard_history on commit drop as
select 'observation'::text as kind, observation.id, to_jsonb(observation) as original
from public.ops_registration_observations observation
where observation.track_id in (select pg_temp.registration_guard_sid(300 + number) from registration_guard_cases)
union all
select 'appointment', appointment.id, to_jsonb(appointment)
from public.ops_registration_appointments appointment
where appointment.task_id in (select pg_temp.registration_guard_sid(200 + number) from registration_guard_cases)
union all
select 'enrollment', enrollment.id, to_jsonb(enrollment)
from public.ops_registration_enrollments enrollment
where enrollment.id in (pg_temp.registration_guard_sid(620), pg_temp.registration_guard_sid(633))
union all
select 'student', student.id, to_jsonb(student) from public.students student where student.id = pg_temp.registration_guard_sid(51)
union all
select 'batch', batch.id, to_jsonb(batch) from public.ops_registration_admission_batches batch where batch.id = pg_temp.registration_guard_sid(520);

set local role authenticated;
select pg_temp.registration_guard_actor(1);
insert into registration_guard_results
select 'first', public.save_registration_enrollment_details_guarded_v2(
  pg_temp.registration_guard_sid(301), pg_temp.registration_guard_rows(), '[]', 1, 'guard-first');
select is((select response ->> 'workflowStatus' from registration_guard_results where result_key = 'first'),
  'enrollment_requested', 'complete enrollment details atomically request enrollment from inquiry');
select is((select (response ->> 'workflowRevision')::integer from registration_guard_results where result_key = 'first'),
  2, 'atomic advancement increments workflow revision once');
select is((select response ->> 'statusChanged' from registration_guard_results where result_key = 'first'),
  'true', 'the response reports the committed workflow change');
select is((select response ->> 'externalReconciliationRequired' from registration_guard_results where result_key = 'first'),
  'false', 'an editable draft does not require external reconciliation');
select is((select response -> 'rows' -> 0 ->> 'classStartSession' from registration_guard_results where result_key = 'first'),
  '1회차', 'save returns the durable session label instead of the submitted display label');
select ok((select response -> 'rows' -> 0 ->> 'id' is not null
    and response -> 'rows' -> 0 ->> 'classId' = pg_temp.registration_guard_sid(21)::text
  from registration_guard_results where result_key = 'first'),
  'save returns the canonical enrollment identity and selected class');
select ok((select workflow_status = 'enrollment_requested' and workflow_revision = 2
    and observation_return_workflow_status is null
    and enrollment_detail_rows = (select response -> 'rows' from registration_guard_results where result_key = 'first')
  from public.ops_registration_subject_tracks where id = pg_temp.registration_guard_sid(301)),
  'authenticated RLS readback matches returned workflow and normalized saved rows');
select is((select count(*) from public.ops_registration_enrollments where track_id = pg_temp.registration_guard_sid(301)),
  1::bigint, 'one request creates exactly one enrollment draft');

reset role;
create temporary table registration_guard_replay_before on commit drop as
select jsonb_build_object(
  'events', (select count(*) from public.ops_task_events where task_id = pg_temp.registration_guard_sid(201)),
  'receipts', (select count(*) from dashboard_private.ops_registration_mutations
    where actor_id = pg_temp.registration_guard_sid(1) and request_key = 'guard-first'),
  'track', (select to_jsonb(track) from public.ops_registration_subject_tracks track where id = pg_temp.registration_guard_sid(301)),
  'enrollments', (select jsonb_agg(to_jsonb(enrollment) order by enrollment.id) from public.ops_registration_enrollments enrollment
    where track_id = pg_temp.registration_guard_sid(301))
) as state;
set local role authenticated;
select is(public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(301),
    pg_temp.registration_guard_rows(), '[]', 1, 'guard-first'),
  (select response from registration_guard_results where result_key = 'first'),
  'same request replays after its original rows and workflow revision became stale');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(301),
  pg_temp.registration_guard_rows(true, 21, 1), '[]', 1, 'guard-first')$$,
  '22023', 'registration_mutation_request_conflict', 'reusing a receipt key with changed rows is rejected');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(302),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-first')$$,
  '22023', 'registration_mutation_request_conflict', 'reusing a receipt key for another track is rejected');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(301),
  pg_temp.registration_guard_rows(), '[]', 2, 'guard-first')$$,
  '22023', 'registration_mutation_request_conflict', 'changing the expected workflow revision under a saved key is rejected');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(301),
  pg_temp.registration_guard_rows(), (select response -> 'rows' from registration_guard_results where result_key = 'first'),
  1, 'guard-first')$$,
  '22023', 'registration_mutation_request_conflict', 'changing the expected row snapshot under a saved key is rejected');
reset role;
select is(jsonb_build_object(
  'events', (select count(*) from public.ops_task_events where task_id = pg_temp.registration_guard_sid(201)),
  'receipts', (select count(*) from dashboard_private.ops_registration_mutations
    where actor_id = pg_temp.registration_guard_sid(1) and request_key = 'guard-first'),
  'track', (select to_jsonb(track) from public.ops_registration_subject_tracks track where id = pg_temp.registration_guard_sid(301)),
  'enrollments', (select jsonb_agg(to_jsonb(enrollment) order by enrollment.id) from public.ops_registration_enrollments enrollment
    where track_id = pg_temp.registration_guard_sid(301))
), (select state from registration_guard_replay_before),
  'matching replay and rejected key conflicts do not duplicate receipts, audits, or writes');

set local role authenticated;
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(302),
  pg_temp.registration_guard_rows(), '[]', 2, 'guard-stale-workflow')$$,
  '23514', 'registration_enrollment_details_refresh_required', 'stale workflow revision requires a refresh');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(301),
  pg_temp.registration_guard_rows(true, 21, 1), '[]', 2, 'guard-stale-rows')$$,
  '23514', 'registration_enrollment_details_refresh_required',
  'a second editor cannot overwrite nonempty rows loaded as empty even with a current workflow revision');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(318),
  pg_temp.registration_guard_rows(), pg_temp.registration_guard_rows(), 1, 'guard-stale-missing-rows')$$,
  '23514', 'registration_enrollment_details_refresh_required', 'expected rows that disappeared also require a refresh');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(999),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-invalid-track')$$,
  'P0002', 'registration_track_not_found', 'a missing track fails before enrollment writes');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(302),
  pg_temp.registration_guard_rows(), '[]', 1, ' ')$$,
  '22023', 'registration_enrollment_details_invalid', 'blank request keys are rejected');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(302),
  pg_temp.registration_guard_rows(), null, 1, 'guard-invalid-expected')$$,
  '22023', 'registration_enrollment_details_invalid', 'a missing expected snapshot cannot opt out of freshness');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(302),
  pg_temp.registration_guard_rows(), '[]', 0, 'guard-invalid-revision')$$,
  '22023', 'registration_enrollment_details_invalid', 'invalid workflow revisions are rejected');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(302),
  '{}', '[]', 1, 'guard-invalid-rows')$$,
  '22023', 'registration_enrollment_rows_invalid', 'an object is not an enrollment row array');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(302),
  jsonb_set(pg_temp.registration_guard_rows(), '{0,classStartSessionKey}', 'null'), '[]', 1, 'guard-invalid-session')$$,
  '22023', 'registration_enrollment_schedule_incomplete', 'a date with a missing selected session has an explicit input error');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(321),
  pg_temp.registration_guard_rows() || pg_temp.registration_guard_rows(), '[]', 1, 'guard-duplicate-class')$$,
  '22023', 'registration_enrollment_rows_duplicate_class', 'duplicate class rows cannot produce duplicate enrollments');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(321),
  jsonb_set(pg_temp.registration_guard_rows(), '{0,id}', to_jsonb(pg_temp.registration_guard_sid(621)::text))
    || jsonb_set(pg_temp.registration_guard_rows(true, 22, 1), '{0,id}', to_jsonb(pg_temp.registration_guard_sid(621)::text)),
  '[]', 1, 'guard-duplicate-id')$$,
  '22023', 'registration_enrollment_rows_duplicate_id', 'one enrollment id cannot be reused for two classes');
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(319),
  pg_temp.registration_guard_rows() || pg_temp.registration_guard_rows(true, 23, 1), '[]', 1, 'guard-invalid-second-row')$$,
  '23514', 'registration_class_subject_mismatch', 'a rejected second row makes the entire save fail');
select is((select count(*) from public.ops_registration_enrollments where track_id = pg_temp.registration_guard_sid(319)),
  0::bigint, 'a failed multi-row save leaves no first row behind');
select ok((select workflow_status = 'consultation_requested' and workflow_revision = 1
    and enrollment_detail_rows = '[]'::jsonb
  from public.ops_registration_subject_tracks where id = pg_temp.registration_guard_sid(319)),
  'failed multi-row save preserves both previous inputs and workflow state');

-- Fail after canonical enrollment DML, at the automatic workflow transition.
-- This demonstrates transaction rollback of rows, audit, details, and receipt.
reset role;
create function pg_temp.registration_guard_fail_transition()
returns trigger language plpgsql as $$
begin
  if new.id = pg_temp.registration_guard_sid(330)
    and new.workflow_status = 'enrollment_requested'
    and old.workflow_status is distinct from new.workflow_status
    and current_setting('test.registration_guard.fail_transition', true) = 'on'
  then
    raise exception 'registration_guard_test_transition_failure' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger registration_guard_test_transition_failure
before update on public.ops_registration_subject_tracks for each row
execute function pg_temp.registration_guard_fail_transition();
select set_config('test.registration_guard.fail_transition', 'on', true);
set local role authenticated;
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(330),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-failed-transition')$$,
  '23514', 'registration_guard_test_transition_failure', 'transition failure rolls back the already-written canonical rows');
select is((select count(*) from public.ops_registration_enrollments where track_id = pg_temp.registration_guard_sid(330)),
  0::bigint, 'transition failure leaves no enrollment draft');
select ok((select workflow_status = 'consultation_requested' and workflow_revision = 1
    and enrollment_detail_rows = '[]'::jsonb
  from public.ops_registration_subject_tracks where id = pg_temp.registration_guard_sid(330)),
  'transition failure restores the workflow and saved detail property together');
reset role;
select is((select count(*) from public.ops_task_events where task_id = pg_temp.registration_guard_sid(230)),
  0::bigint, 'transition failure also rolls back the canonical row audit');
select is((select count(*) from dashboard_private.ops_registration_mutations
  where actor_id = pg_temp.registration_guard_sid(1) and request_key ~ '^guard-(stale|invalid|duplicate|failed)'),
  0::bigint, 'validation and stale-write failures leave no idempotency receipt');
select set_config('test.registration_guard.fail_transition', 'off', true);
drop trigger registration_guard_test_transition_failure on public.ops_registration_subject_tracks;

set local role authenticated;
insert into registration_guard_results
select 'matrix-' || number, public.save_registration_enrollment_details_guarded_v2(
  pg_temp.registration_guard_sid(300 + number),
  pg_temp.registration_guard_rows(true, case when number = 32 then 22 else 21 end), '[]', 1, 'guard-matrix-' || number)
from registration_guard_cases where number between 4 and 16 or number in (2, 32) order by number;
select is(result.response ->> 'workflowStatus', case when fixture.number in (11, 12, 13, 14, 15, 16)
    then fixture.initial_status else 'enrollment_requested' end,
  'complete save from ' || fixture.initial_status || case when fixture.review_required then ' with migration review' else '' end
    || ' has the intended workflow result')
from registration_guard_cases fixture join registration_guard_results result on result.result_key = 'matrix-' || fixture.number
order by fixture.number;
select ok((result.response ->> 'workflowRevision')::integer = case when fixture.number in (11, 12, 13, 14, 15, 16) then 1 else 2 end
    and (result.response ->> 'statusChanged')::boolean = (fixture.number not in (11, 12, 13, 14, 15, 16)),
  'save from ' || fixture.initial_status || case when fixture.review_required then ' with migration review' else '' end
    || ' increments the revision only when advancing')
from registration_guard_cases fixture join registration_guard_results result on result.result_key = 'matrix-' || fixture.number
order by fixture.number;
select ok((select pipeline_status = 'migration_review' and migration_review_required
    and workflow_status = 'inquiry' and workflow_revision = 1
    and jsonb_array_length(enrollment_detail_rows) = 1
  from public.ops_registration_subject_tracks where id = pg_temp.registration_guard_sid(316)),
  'a migration-review case saves its draft while retaining both review and workflow state');
select is((select response -> 'rows' -> 0 ->> 'classStartLessonSessionId'
  from registration_guard_results where result_key = 'matrix-32'),
  pg_temp.registration_guard_sid(41)::text, 'a normalized selected lesson is saved with its durable lesson identity');
select is((select count(*) from public.ops_registration_subject_tracks
  where id in (pg_temp.registration_guard_sid(307), pg_temp.registration_guard_sid(308), pg_temp.registration_guard_sid(309))
    and workflow_status = 'enrollment_requested' and observation_return_workflow_status is null),
  3::bigint, 'automatic enrollment entry clears the observation return-status pair in all observation stages');
insert into registration_guard_results values ('partial', public.save_registration_enrollment_details_guarded_v2(
  pg_temp.registration_guard_sid(303), pg_temp.registration_guard_rows(false), '[]', 1, 'guard-partial'));
select ok((select response ->> 'workflowStatus' = 'consultation_completed'
    and response ->> 'workflowRevision' = '1' and response ->> 'statusChanged' = 'false'
    and response -> 'rows' -> 0 -> 'classStartDate' = 'null'::jsonb
  from registration_guard_results where result_key = 'partial'),
  'a class without a start session saves as a draft without advancing the workflow');
insert into registration_guard_results values ('empty', public.save_registration_enrollment_details_guarded_v2(
  pg_temp.registration_guard_sid(322), '[]', '[]', 1, 'guard-empty'));
select ok((select response -> 'rows' = '[]'::jsonb and response ->> 'workflowStatus' = 'consultation_requested'
    and response ->> 'workflowRevision' = '1' and response ->> 'statusChanged' = 'false'
  from registration_guard_results where result_key = 'empty'),
  'an empty draft cannot move the track to enrollment requested');

insert into registration_guard_results values ('fresh-edit', public.save_registration_enrollment_details_guarded_v2(
  pg_temp.registration_guard_sid(301),
  jsonb_set((select response -> 'rows' from registration_guard_results where result_key = 'first'), '{0,sortOrder}', '1'),
  (select response -> 'rows' from registration_guard_results where result_key = 'first'), 2, 'guard-fresh-edit'));
select ok((select response ->> 'workflowStatus' = 'enrollment_requested' and response ->> 'workflowRevision' = '2'
    and response ->> 'statusChanged' = 'false' and response -> 'rows' -> 0 ->> 'sortOrder' = '1'
  from registration_guard_results where result_key = 'fresh-edit'),
  'a fresh second edit updates details without advancing an already-requested enrollment again');
select is((select count(*) from public.ops_registration_enrollments where track_id = pg_temp.registration_guard_sid(301)),
  1::bigint, 'a fresh edit preserves one stable enrollment identity');

insert into registration_guard_results
select 'external-' || number, public.save_registration_enrollment_details_guarded_v2(
  pg_temp.registration_guard_sid(300 + number), pg_temp.registration_guard_rows(), '[]', 1, 'guard-external-' || number)
from (values (20), (33)) fixture(number);
select ok(response ->> 'externalReconciliationRequired' = 'true'
    and response ->> 'workflowStatus' = 'consultation_requested'
    and response ->> 'workflowRevision' = '1' and response ->> 'statusChanged' = 'false',
  result_key || ' saves correction facts without replacing admission or roster facts')
from registration_guard_results where result_key in ('external-20', 'external-33') order by result_key;
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(320),
  pg_temp.registration_guard_rows(true, 21, 1), '[]', 1, 'guard-stale-external')$$,
  '23514', 'registration_enrollment_details_refresh_required', 'external correction compares the saved detail property snapshot');
select is(public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(320),
    pg_temp.registration_guard_rows(), '[]', 1, 'guard-external-20'),
  (select response from registration_guard_results where result_key = 'external-20'),
  'external correction receipt replays even after its detail snapshot changed');

-- All account names are identical. Teacher linkage/director assignment and
-- forged user_metadata must never turn a teacher into an operations manager.
select pg_temp.registration_guard_actor(3);
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(317),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-role-teacher')$$,
  '42501', 'registration_access_denied', 'the assigned teacher cannot edit enrollment details');
select pg_temp.registration_guard_actor(4);
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(317),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-role-assistant')$$,
  '42501', 'registration_access_denied', 'assistant role cannot edit enrollment details');
select pg_temp.registration_guard_actor(5);
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(317),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-role-banned')$$,
  '42501', 'registration_access_denied', 'a banned staff account cannot edit enrollment details');
select pg_temp.registration_guard_actor(6);
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(317),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-role-deleted')$$,
  '42501', 'registration_access_denied', 'a deleted admin account cannot edit enrollment details');
select pg_temp.registration_guard_actor(null);
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(317),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-role-no-actor')$$,
  '42501', 'registration_access_denied', 'a missing authenticated actor cannot edit enrollment details');
select pg_temp.registration_guard_actor(2);
select lives_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(317),
  pg_temp.registration_guard_rows(false), '[]', 1, 'guard-role-operator-teacher')$$,
  'an active staff operator linked to the teacher catalog can save registration details');
select pg_temp.registration_guard_actor(7);
select lives_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(331),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-role-expired-ban')$$,
  'an active admin whose ban expired can save registration details');

reset role;
select pg_temp.registration_guard_actor(7);
update public.profiles set role = 'teacher' where id = pg_temp.registration_guard_sid(1);
select pg_temp.registration_guard_actor(1);
set local role authenticated;
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(301),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-first')$$,
  '42501', 'registration_access_denied', 'a receipt cannot bypass role revocation');
reset role;
select pg_temp.registration_guard_actor(7);
update public.profiles set role = 'admin' where id = pg_temp.registration_guard_sid(1);
update public.ops_registration_subject_tracks set archived_at = now(), archived_by = pg_temp.registration_guard_sid(1)
where id = pg_temp.registration_guard_sid(301);
select pg_temp.registration_guard_actor(1);
set local role authenticated;
select throws_ok($$select public.save_registration_enrollment_details_guarded_v2(pg_temp.registration_guard_sid(301),
  pg_temp.registration_guard_rows(), '[]', 1, 'guard-first')$$,
  '42501', 'registration_access_denied', 'a receipt cannot bypass subject archive');
reset role;
update public.ops_registration_subject_tracks set archived_at = null, archived_by = null
where id = pg_temp.registration_guard_sid(301);

set local role authenticated;
select throws_ok($$select public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(323),
  'observation_requested', 1, 'guard-observation-missing')$$,
  '23514', 'registration_observation_booking_required', 'observation request cannot save without a selected booked session');
select throws_ok($$select public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(326),
  'observation_requested', 1, 'guard-observation-canceled')$$,
  '23514', 'registration_observation_booking_required', 'a canceled observation does not satisfy the requested stage');
select throws_ok($$select public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(327),
  'observation_requested', 1, 'guard-observation-canceled-appointment')$$,
  '23514', 'registration_observation_booking_required', 'a canceled parent appointment does not satisfy the requested stage');
select throws_ok($$select public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(328),
  'observation_requested', 1, 'guard-observation-other-track')$$,
  '23514', 'registration_observation_booking_required', 'a booked observation on another track cannot satisfy this track');
select throws_ok($$select public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(329),
  'observation_requested', 1, 'guard-observation-decided')$$,
  '23514', 'registration_observation_booking_required', 'a decided historical observation does not satisfy an active request');
insert into registration_guard_results values
  ('observation-normalized', public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(324),
    'observation_requested', 1, 'guard-observation-normalized')),
  ('observation-legacy', public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(325),
    'observation_requested', 1, 'guard-observation-legacy'));
select ok(response ->> 'workflowStatus' = 'observation_requested' and response ->> 'workflowRevision' = '2',
  result_key || ' selected booking permits observation requested')
from registration_guard_results where result_key in ('observation-normalized', 'observation-legacy') order by result_key;
select is((select observation_return_workflow_status from public.ops_registration_subject_tracks where id = pg_temp.registration_guard_sid(324)),
  'consultation_completed', 'entering observation from consultation requested supplies a valid return-status pair');
select is((select observation_return_workflow_status from public.ops_registration_subject_tracks where id = pg_temp.registration_guard_sid(325)),
  'waiting_new_class', 'entering observation preserves the previous waiting status as its return-status pair');
select is(public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(324),
    'observation_requested', 1, 'guard-observation-normalized'),
  (select response from registration_guard_results where result_key = 'observation-normalized'),
  'observation workflow request also replays without a second revision');
select lives_ok($$select public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(324),
  'consultation_completed', 2, 'guard-observation-leave')$$,
  'leaving observation through the generic setter retains the workflow pair constraint');
select is((select observation_return_workflow_status from public.ops_registration_subject_tracks where id = pg_temp.registration_guard_sid(324)),
  null::text, 'leaving observation clears the return-status pair');
select throws_ok($$select public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(324),
  'observation_feedback_pending', 3, 'guard-observation-dead-target')$$,
  '22023', 'registration_workflow_status_invalid', 'retired teacher-feedback stages are not selectable generic status targets');
select pg_temp.registration_guard_actor(3);
select throws_ok($$select public.set_registration_workflow_status_v1(pg_temp.registration_guard_sid(325),
  'observation_requested', 2, 'guard-observation-teacher')$$,
  '42501', 'registration_access_denied', 'a selected session does not grant workflow-edit permission to its teacher');

reset role;
select pg_temp.registration_guard_actor(1);
-- Flush while the fixture manager is still authenticated, before history and
-- no-send comparisons, so deferred effects cannot escape those assertions.
set constraints all immediate;
select is((select count(*) from dashboard_private.ops_registration_mutations
  where request_key in ('guard-observation-missing', 'guard-observation-canceled',
    'guard-observation-canceled-appointment', 'guard-observation-other-track', 'guard-observation-decided',
    'guard-observation-dead-target', 'guard-observation-teacher')),
  0::bigint, 'rejected observation status edits create no receipt');
select ok(not exists (
  select 1 from registration_guard_history history
  left join lateral (
    select to_jsonb(history_source) as current_value from public.ops_registration_observations history_source
      where history.kind = 'observation' and history_source.id = history.id
    union all select to_jsonb(history_source) from public.ops_registration_appointments history_source
      where history.kind = 'appointment' and history_source.id = history.id
    union all select to_jsonb(history_source) from public.ops_registration_enrollments history_source
      where history.kind = 'enrollment' and history_source.id = history.id
    union all select to_jsonb(history_source) from public.students history_source
      where history.kind = 'student' and history_source.id = history.id
    union all select to_jsonb(history_source) from public.ops_registration_admission_batches history_source
      where history.kind = 'batch' and history_source.id = history.id
  ) current_row on true
  where current_row.current_value is distinct from history.original
), 'workflow edits and external corrections preserve existing observations, appointments, enrollments, students, and batches');
select is(jsonb_build_object(
  'events', (select count(*) from dashboard_private.notification_events),
  'fanout', (select count(*) from dashboard_private.notification_event_fanout_jobs),
  'deliveries', (select count(*) from dashboard_private.notification_deliveries),
  'customerMessages', (select count(*) from public.ops_registration_customer_messages),
  'customerReminders', (select count(*) from dashboard_private.registration_customer_reminder_jobs),
  'observationChat', (select count(*) from dashboard_private.registration_observation_chat_jobs),
  'observationEvents', (select count(*) from dashboard_private.registration_observation_domain_events)
), (select counts from registration_guard_no_send),
  'detail saves and observation status edits never send or enqueue provider/customer/observation work');

select pg_temp.registration_guard_actor(null);
select ok((select auth.uid()) is null and (select auth.role()) is null
    and current_setting('request.jwt.claims')::jsonb = '{}'::jsonb,
  'fixture cleanup clears both JWT representations after all deferred checks');
select * from finish();
rollback;
