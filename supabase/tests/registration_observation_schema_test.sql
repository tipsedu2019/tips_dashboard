begin;
select plan(107);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('97000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'observation-admin@example.invalid', crypt('observation-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('97000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'observation-staff@example.invalid', crypt('observation-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('97000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'observation-director@example.invalid', crypt('observation-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('97000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'observation-unrelated@example.invalid', crypt('observation-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('97000000-0000-4000-8000-000000000001', 'admin', '청강 관리자', 'observation-admin@example.invalid', now(), now()),
  ('97000000-0000-4000-8000-000000000002', 'staff', '청강 운영자', 'observation-staff@example.invalid', now(), now()),
  ('97000000-0000-4000-8000-000000000003', 'teacher', '청강 담당원장', 'observation-director@example.invalid', now(), now()),
  ('97000000-0000-4000-8000-000000000004', 'viewer', '청강 무관계자', 'observation-unrelated@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id in (
  '97000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000002',
  '97000000-0000-4000-8000-000000000003',
  '97000000-0000-4000-8000-000000000004'
);

create or replace function pg_temp.registration_observation_set_actor(p_actor uuid)
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

create or replace function pg_temp.registration_observation_visible_count(p_actor uuid)
returns bigint
language plpgsql
security invoker
as $$
declare
  v_count bigint;
begin
  perform pg_temp.registration_observation_set_actor(p_actor);
  execute 'set local role authenticated';
  select count(*) into v_count
  from public.ops_registration_observations;
  execute 'reset role';
  return v_count;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.registration_observation_director_match_as_actor(
  p_actor uuid,
  p_track_id uuid
)
returns boolean
language plpgsql
security invoker
as $$
declare
  v_matches boolean;
begin
  perform pg_temp.registration_observation_set_actor(p_actor);
  execute 'set local role authenticated';
  select dashboard_private.registration_observation_track_director_profile_id_matches_v1(p_track_id)
  into v_matches;
  execute 'reset role';
  return v_matches;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.registration_observation_statement_raises(
  p_sql text,
  p_expected_sqlstate text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sqlstate text;
begin
  begin
    execute p_sql;
    return false;
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      return v_sqlstate = p_expected_sqlstate;
  end;
end;
$$;

select has_column('public', 'ops_registration_subject_tracks', 'observation_return_workflow_status', 'track has observation return workflow status');
select has_column('public', 'ops_registration_subject_tracks', 'observation_attempt_count', 'track has observation attempt count');
select has_column('public', 'classroom_catalogs', 'campus', 'classroom catalog has campus');
select has_table('public', 'ops_registration_observations', 'observation ledger exists');
select has_table('dashboard_private', 'registration_observation_mutation_requests', 'observation mutation receipts exist');
select has_table('dashboard_private', 'registration_observation_domain_events', 'observation domain events exist');
select has_table('dashboard_private', 'registration_observation_runtime_settings', 'observation runtime singleton exists');
select function_returns('public', 'registration_observation_schema_readiness_v1', array[]::text[], 'jsonb');
select function_returns('public', 'registration_observation_runtime_version', array[]::text[], 'integer');
select function_returns('public', 'activate_registration_observation_runtime_v1', array['integer','text'], 'jsonb');
select function_returns('dashboard_private', 'registration_observation_schema_readiness_v1_impl', array[]::text[], 'jsonb');
select function_returns('dashboard_private', 'registration_observation_runtime_version_impl', array[]::text[], 'integer');
select function_returns('dashboard_private', 'activate_registration_observation_runtime_v1_impl', array['integer','text'], 'jsonb');
select function_returns('dashboard_private', 'assert_registration_observation_runtime_v1', array[]::text[], 'void');

select is(
  (select pg_catalog.jsonb_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'ops_registration_observations'),
  pg_catalog.to_jsonb(array[
    'id', 'task_id', 'track_id', 'appointment_id', 'class_id',
    'session_authority', 'class_lesson_session_id', 'legacy_session_key',
    'session_date', 'starts_at', 'ends_at', 'session_schedule_state',
    'session_source_revision', 'legacy_session_source_hash', 'source_revision',
    'booking_fact_hash', 'teacher_catalog_id', 'teacher_profile_id',
    'classroom_catalog_id', 'subject', 'class_name_snapshot',
    'teacher_name_snapshot', 'classroom_name_snapshot', 'campus',
    'textbook_snapshot', 'progress_snapshot', 'status', 'attendance',
    'attendance_recorded_by', 'attendance_recorded_at', 'suitability_result',
    'feedback_reason', 'feedback_submitted_by', 'feedback_submitted_at',
    'feedback_revision', 'decision_kind', 'decided_by', 'decided_at',
    'revision', 'created_by', 'updated_by', 'created_at', 'updated_at'
  ]::text[]),
  'observation ledger exposes only the frozen columns in order'
);

select ok(
  (select count(*) from pg_catalog.pg_constraint
   where conrelid = 'public.ops_registration_observations'::regclass
     and contype = 'c') >= 10,
  'observation truth tables are database constraints'
);

select is(
  (select pg_catalog.jsonb_agg(indexname order by indexname)
   from pg_catalog.pg_indexes
   where schemaname = 'public' and tablename = 'ops_registration_observations'
     and indexname <> 'ops_registration_observations_pkey'),
  pg_catalog.to_jsonb(array[
    'ops_registration_observations_appointment_id_key',
    'ops_registration_observations_attendance_actor_idx',
    'ops_registration_observations_class_idx',
    'ops_registration_observations_classroom_catalog_idx',
    'ops_registration_observations_created_actor_idx',
    'ops_registration_observations_decision_actor_idx',
    'ops_registration_observations_feedback_actor_idx',
    'ops_registration_observations_open_track_key',
    'ops_registration_observations_session_idx',
    'ops_registration_observations_task_idx',
    'ops_registration_observations_teacher_catalog_idx',
    'ops_registration_observations_teacher_status_idx',
    'ops_registration_observations_track_created_idx',
    'ops_registration_observations_track_decision_status_idx',
    'ops_registration_observations_updated_actor_idx'
  ]::text[]),
  'observation indexes match the reviewed access paths'
);

select is(
  (select pg_catalog.jsonb_agg(schemaname || '.' || indexname order by schemaname || '.' || indexname)
   from pg_catalog.pg_indexes
   where (schemaname, tablename) in (
     ('dashboard_private', 'registration_observation_mutation_requests'),
     ('dashboard_private', 'registration_observation_domain_events')
   )
     and indexdef not like 'CREATE UNIQUE INDEX%'),
  pg_catalog.to_jsonb(array[
    'dashboard_private.registration_observation_domain_events_appointment_occurred_idx',
    'dashboard_private.registration_observation_domain_events_observation_occurred_idx',
    'dashboard_private.registration_observation_domain_events_occurred_idx',
    'dashboard_private.registration_observation_mutation_requests_track_created_idx'
  ]::text[]),
  'receipt and event seams have the exact reviewer indexes'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.ops_registration_observations'::regclass),
  'observation RLS is enabled'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'ops_registration_observations'
      and cmd = 'SELECT'
      and qual like '%director_profile_id%'
      and qual like '%current_dashboard_role%'
  ),
  'observation SELECT policy contains manager and exact director branches'
);
select ok(has_table_privilege('authenticated', 'public.ops_registration_observations', 'SELECT'), 'authenticated can select through RLS');
select isnt(has_table_privilege('authenticated', 'public.ops_registration_observations', 'INSERT'), true, 'authenticated cannot insert ledger rows');
select isnt(has_table_privilege('authenticated', 'public.ops_registration_observations', 'UPDATE'), true, 'authenticated cannot update ledger rows');
select isnt(has_table_privilege('authenticated', 'public.ops_registration_observations', 'DELETE'), true, 'authenticated cannot delete ledger rows');
select isnt(has_table_privilege('anon', 'public.ops_registration_observations', 'SELECT'), true, 'anon cannot read ledger rows');
select is_empty(
  $$
    select 1 from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'dashboard_private'
      and table_name in (
        'registration_observation_runtime_settings',
        'registration_observation_mutation_requests',
        'registration_observation_domain_events'
      )
  $$,
  'private runtime, receipt, and event tables have no authenticated grants'
);

select is((select activation_version from dashboard_private.registration_observation_runtime_settings where singleton = true), 0, 'runtime singleton defaults off');

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
)
values (
  '97000000-0000-4000-8000-000000000112',
  '청강 legacy campus readiness fixture',
  '영어',
  '수업 진행 중',
  'legacy',
  pg_catalog.jsonb_build_object(
    'sessions',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'date',
        pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD')
      )
    )
  )
);
do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '97000000-0000-4000-8000-000000000112',
    '97000000-0000-4000-8000-000000000114',
    'registration_observation_schema_campus_readiness_test'
  );
end;
$$;
insert into public.class_schedule_slots(
  id, class_id, weekday, start_time, end_time,
  classroom_catalog_id, classroom_name
)
values (
  '97000000-0000-4000-8000-000000000113',
  '97000000-0000-4000-8000-000000000112',
  1, '18:00', '20:00', null, ''
);

select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select pg_catalog.jsonb_agg(key_name order by key_name)
   from pg_catalog.jsonb_object_keys(public.registration_observation_schema_readiness_v1()) key(key_name)),
  '["missingObjects","runtimeVersion","schemaReady"]'::jsonb,
  'readiness returns the exact diagnostic keys'
);
select is((public.registration_observation_schema_readiness_v1()->>'schemaReady')::boolean, false, 'partial schema remains unready before feedback and enrollment');
select is((public.registration_observation_schema_readiness_v1()->>'runtimeVersion')::integer, 0, 'readiness reports runtime zero independently');
select ok(public.registration_observation_schema_readiness_v1()->'missingObjects' ? 'public.get_registration_observation_feedback_v1(uuid)', 'exact missing feedback signature is reported');
select ok(public.registration_observation_schema_readiness_v1()->'missingObjects' ? 'public.ops_registration_enrollments.class_start_source_observation_id', 'missing enrollment source column is reported');
select is(
  pg_catalog.jsonb_build_object(
    'summaryScalar',
    public.registration_observation_schema_readiness_v1()->'missingObjects'
      ? 'public.ops_registration_subject_track_summaries.observation_attempt_count',
    'stateMissingLegacyCampus',
    public.registration_observation_schema_readiness_v1()->'missingObjects'
      ? 'classroom_catalogs.campus_backfill'
  ),
  '{"summaryScalar":false,"stateMissingLegacyCampus":true}'::jsonb,
  'readiness sees the Task 3 summary scalar while later selectable-campus work remains missing'
);
select ok(public.registration_observation_schema_readiness_v1()->'missingObjects' ? 'dashboard_private.registration_appointment_track_ids_v1(uuid)', 'stale appointment helper body remains unready');
select is(
  (select pg_catalog.jsonb_agg(value order by value) from pg_catalog.jsonb_array_elements_text(public.registration_observation_schema_readiness_v1()->'missingObjects') item(value)),
  public.registration_observation_schema_readiness_v1()->'missingObjects',
  'missingObjects is sorted and unique'
);
reset role;

select lives_ok(
  $$select public.registration_observation_schema_readiness_v1()$$,
  'active admin can inspect readiness'
);
select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok($$select public.registration_observation_schema_readiness_v1()$$, 'active staff can inspect readiness');
reset role;
select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select public.registration_observation_schema_readiness_v1()$$, '42501', 'registration_observation_readiness_access_denied', 'director cannot inspect readiness');
reset role;
select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok($$select public.registration_observation_schema_readiness_v1()$$, '42501', 'registration_observation_readiness_access_denied', 'unrelated actor cannot inspect readiness');
reset role;

select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000003');
set local role authenticated;
select is(public.registration_observation_runtime_version(), 0, 'active authenticated director can read runtime');
reset role;
select isnt(has_function_privilege('anon', 'public.registration_observation_runtime_version()', 'EXECUTE'), true, 'anon cannot read runtime');

select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.activate_registration_observation_runtime_v1(0, 'task1-staff')$$, '42501', 'registration_observation_activation_access_denied', 'non-admin activation is rejected');
reset role;
select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.activate_registration_observation_runtime_v1(0, 'task1-premature')$$, '55000', 'registration_observation_schema_not_ready', 'admin cannot activate an incomplete schema');
reset role;
select is(
  pg_catalog.jsonb_build_object(
    'runtimeVersion', (select activation_version from dashboard_private.registration_observation_runtime_settings where singleton = true),
    'receiptCount', (select count(*) from dashboard_private.registration_observation_mutation_requests where operation = 'activate')
  ),
  '{"receiptCount": 0, "runtimeVersion": 0}'::jsonb,
  'failed activation leaves runtime off and writes no receipt'
);

insert into dashboard_private.registration_observation_mutation_requests(
  actor_profile_id,
  operation,
  request_key,
  track_id,
  request_fingerprint,
  response_payload
)
values (
  '97000000-0000-4000-8000-000000000001',
  'activate',
  'task1-fingerprint-conflict',
  null,
  '{"expectedCurrentVersion":999}',
  '{}'::jsonb
);
set local role authenticated;
select throws_ok(
  $$select public.activate_registration_observation_runtime_v1(0, 'task1-fingerprint-conflict')$$,
  '23505',
  'registration_observation_request_key_conflict',
  'activation request-key fingerprint conflict is exact'
);
reset role;
delete from dashboard_private.registration_observation_mutation_requests
where actor_profile_id = '97000000-0000-4000-8000-000000000001'
  and request_key = 'task1-fingerprint-conflict';

select function_privs_are('public', 'registration_observation_schema_readiness_v1', array[]::text[], 'authenticated', array['EXECUTE']);
select function_privs_are('public', 'registration_observation_runtime_version', array[]::text[], 'authenticated', array['EXECUTE']);
select function_privs_are('public', 'activate_registration_observation_runtime_v1', array['integer','text'], 'authenticated', array['EXECUTE']);
select is_empty(
  $$
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name in (
        'registration_observation_schema_readiness_v1',
        'registration_observation_runtime_version',
        'activate_registration_observation_runtime_v1'
      )
      and grantee in ('PUBLIC', 'anon')
  $$,
  'public and anon cannot execute observation runtime functions'
);
select ok(
  has_function_privilege('authenticated', 'dashboard_private.registration_observation_schema_readiness_v1_impl()', 'EXECUTE')
  and has_function_privilege('authenticated', 'dashboard_private.registration_observation_runtime_version_impl()', 'EXECUTE')
  and has_function_privilege('authenticated', 'dashboard_private.activate_registration_observation_runtime_v1_impl(integer,text)', 'EXECUTE'),
  'thin invoker wrappers can call the guarded definer implementations'
);
select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  pg_catalog.jsonb_build_object(
    'runtimeZero',
    pg_temp.registration_observation_statement_raises(
      'select dashboard_private.assert_registration_observation_runtime_v1()',
      '55000'
    ),
    'singletonMissing',
    pg_temp.registration_observation_statement_raises(
      'do $block$ begin delete from dashboard_private.registration_observation_runtime_settings where singleton = true; perform dashboard_private.assert_registration_observation_runtime_v1(); end $block$',
      '55000'
    )
  ),
  '{"runtimeZero":true,"singletonMissing":true}'::jsonb,
  'mutation guard rejects runtime zero and a missing singleton'
);
reset role;

insert into public.teacher_catalogs(id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role)
values ('97000000-0000-4000-8000-000000000101', '청강 담당원장', array['영어']::text[], true, 9971, '97000000-0000-4000-8000-000000000003', 'observation-director@example.invalid', 'teacher');
update public.profiles set teacher_catalog_id = '97000000-0000-4000-8000-000000000101' where id = '97000000-0000-4000-8000-000000000003';
insert into public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)
values ('97000000-0000-4000-8000-000000000102', '청강 101호', array['영어']::text[], true, 9972, '본관');
insert into public.classes(id, name, subject, status, schedule_storage_mode, schedule_plan)
values ('97000000-0000-4000-8000-000000000103', '청강 영어반', '영어', '수업 진행 중', 'normalized', '{}'::jsonb);
do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '97000000-0000-4000-8000-000000000103',
    '97000000-0000-4000-8000-000000000111',
    'registration_observation_schema_test'
  );
end;
$$;
insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state, start_time, end_time,
  teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id,
  classroom_name_snapshot, origin, revision
)
values (
  '97000000-0000-4000-8000-000000000104',
  '97000000-0000-4000-8000-000000000103',
  '2026-08-17:1', '2026-08-17', 'active', '18:00', '20:00',
  '97000000-0000-4000-8000-000000000101', '청강 담당원장',
  '97000000-0000-4000-8000-000000000102', '청강 101호', 'manual', 7
);
insert into public.ops_tasks(id, title, type, status, priority, requested_by, student_name)
values ('97000000-0000-4000-8000-000000000105', '청강 schema fixture', 'registration', 'requested', 'normal', '97000000-0000-4000-8000-000000000001', '합성 청강학생');
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values (
  '97000000-0000-4000-8000-000000000106',
  '97000000-0000-4000-8000-000000000105',
  '영어', 'consultation_waiting', '97000000-0000-4000-8000-000000000003',
  'manual', now(), false, 'observation_requested', 1, now(),
  'consultation_completed', 0
);
insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
)
values (
  '97000000-0000-4000-8000-000000000107',
  '97000000-0000-4000-8000-000000000105',
  'observation_class', '2026-08-17 18:00+09', '본관', 'scheduled', 1,
  '97000000-0000-4000-8000-000000000001'
);
insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, created_by, updated_by
)
values (
  '97000000-0000-4000-8000-000000000108',
  '97000000-0000-4000-8000-000000000105',
  '97000000-0000-4000-8000-000000000106',
  '97000000-0000-4000-8000-000000000107',
  '97000000-0000-4000-8000-000000000103',
  'normalized', '97000000-0000-4000-8000-000000000104', null,
  '2026-08-17', '2026-08-17 18:00+09', '2026-08-17 20:00+09', 'active',
  7, null,
  '{"authority":"normalized","sessionId":"97000000-0000-4000-8000-000000000104","revision":7}'::jsonb,
  repeat('a', 64), '97000000-0000-4000-8000-000000000101',
  '97000000-0000-4000-8000-000000000003',
  '97000000-0000-4000-8000-000000000102', '영어', '청강 영어반',
  '청강 담당원장', '청강 101호', '본관',
  '97000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001'
);

select is((select workflow_status || ':' || observation_return_workflow_status from public.ops_registration_subject_tracks where id = '97000000-0000-4000-8000-000000000106'), 'observation_requested:consultation_completed', 'valid observation workflow preserves its return state');
select is((select kind from public.ops_registration_appointments where id = '97000000-0000-4000-8000-000000000107'), 'observation_class', 'observation appointment kind is accepted');
select is((select status from public.ops_registration_observations where id = '97000000-0000-4000-8000-000000000108'), 'scheduled', 'valid normalized scheduled observation is accepted');
select is(
  pg_catalog.jsonb_build_object(
    'stringRevision',
    pg_temp.registration_observation_statement_raises(
      $$update public.ops_registration_observations set source_revision = '{"authority":"normalized","sessionId":"97000000-0000-4000-8000-000000000104","revision":"7"}'::jsonb where id = '97000000-0000-4000-8000-000000000108'$$,
      '23514'
    ),
    'nullRevision',
    pg_temp.registration_observation_statement_raises(
      $$update public.ops_registration_observations set source_revision = '{"authority":"normalized","sessionId":"97000000-0000-4000-8000-000000000104","revision":null}'::jsonb where id = '97000000-0000-4000-8000-000000000108'$$,
      '23514'
    )
  ),
  '{"stringRevision":true,"nullRevision":true}'::jsonb,
  'normalized source revision rejects string and JSON null revisions'
);
select is(
  pg_catalog.jsonb_build_object(
    'pendingMissingAttendance',
    pg_temp.registration_observation_statement_raises(
      $$update public.ops_registration_observations set status = 'attended_feedback_pending' where id = '97000000-0000-4000-8000-000000000108'$$,
      '23514'
    ),
    'noShowMissingAttendance',
    pg_temp.registration_observation_statement_raises(
      $$update public.ops_registration_observations set status = 'no_show' where id = '97000000-0000-4000-8000-000000000108'$$,
      '23514'
    ),
    'completedMissingAttendance',
    pg_temp.registration_observation_statement_raises(
      $$update public.ops_registration_observations set status = 'completed', suitability_result = 'fit', feedback_reason = '합성 적합', feedback_submitted_by = '97000000-0000-4000-8000-000000000001', feedback_submitted_at = now() where id = '97000000-0000-4000-8000-000000000108'$$,
      '23514'
    ),
    'completedMissingSuitability',
    pg_temp.registration_observation_statement_raises(
      $$update public.ops_registration_observations set status = 'completed', attendance = 'attended', attendance_recorded_by = '97000000-0000-4000-8000-000000000001', attendance_recorded_at = now(), feedback_reason = '합성 적합', feedback_submitted_by = '97000000-0000-4000-8000-000000000001', feedback_submitted_at = now() where id = '97000000-0000-4000-8000-000000000108'$$,
      '23514'
    )
  ),
  '{"pendingMissingAttendance":true,"noShowMissingAttendance":true,"completedMissingAttendance":true,"completedMissingSuitability":true}'::jsonb,
  'non-scheduled status facts reject every missing required attendance or suitability value'
);
select throws_ok(
  $$update public.ops_registration_observations set decision_kind = 'enrollment' where id = '97000000-0000-4000-8000-000000000108'$$,
  '23514', null, 'decision requires actor and time'
);
select is(
  pg_catalog.jsonb_build_object(
    'stringRevision',
    pg_temp.registration_observation_statement_raises(
      $$insert into dashboard_private.registration_observation_domain_events(observation_id, appointment_id, notification_revision, event_kind, booking_fact_hash, source_revision) values ('97000000-0000-4000-8000-000000000108', '97000000-0000-4000-8000-000000000107', 1, 'observation_scheduled', repeat('a', 64), '{"authority":"normalized","sessionId":"97000000-0000-4000-8000-000000000104","revision":"7"}'::jsonb)$$,
      '23514'
    ),
    'nullRevision',
    pg_temp.registration_observation_statement_raises(
      $$insert into dashboard_private.registration_observation_domain_events(observation_id, appointment_id, notification_revision, event_kind, booking_fact_hash, source_revision) values ('97000000-0000-4000-8000-000000000108', '97000000-0000-4000-8000-000000000107', 1, 'observation_scheduled', repeat('a', 64), '{"authority":"normalized","sessionId":"97000000-0000-4000-8000-000000000104","revision":null}'::jsonb)$$,
      '23514'
    )
  ),
  '{"stringRevision":true,"nullRevision":true}'::jsonb,
  'event source revision rejects string and JSON null revisions'
);

select is(
  pg_catalog.jsonb_build_object(
    'visibleCounts',
    (with actors(id) as (values
       ('97000000-0000-4000-8000-000000000001'::uuid),
       ('97000000-0000-4000-8000-000000000002'::uuid),
       ('97000000-0000-4000-8000-000000000003'::uuid),
       ('97000000-0000-4000-8000-000000000004'::uuid)
     )
     select pg_catalog.jsonb_agg(
       pg_catalog.jsonb_build_array(actor.id::text, pg_temp.registration_observation_visible_count(actor.id))
       order by actor.id
     )
     from actors actor),
    'actorOverrideSignatureAbsent',
    pg_catalog.to_regprocedure(
      'dashboard_private.registration_observation_track_director_profile_id_matches_v1(uuid,uuid)'
    ) is null,
    'unrelatedDirectorMatch',
    pg_temp.registration_observation_director_match_as_actor(
      '97000000-0000-4000-8000-000000000004',
      '97000000-0000-4000-8000-000000000106'
    )
  ),
  '{"visibleCounts":[["97000000-0000-4000-8000-000000000001",1],["97000000-0000-4000-8000-000000000002",1],["97000000-0000-4000-8000-000000000003",1],["97000000-0000-4000-8000-000000000004",0]],"actorOverrideSignatureAbsent":true,"unrelatedDirectorMatch":false}'::jsonb,
  'RLS exposes the ledger only to managers and the authenticated exact director without an actor override surface'
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
)
values (
  '97000000-0000-4000-8000-000000000109',
  '97000000-0000-4000-8000-000000000105',
  'observation_class', '2026-08-24 18:00+09', '본관', 'scheduled', 1,
  '97000000-0000-4000-8000-000000000001'
);
select throws_ok(
  $$insert into public.ops_registration_observations(id, task_id, track_id, appointment_id, class_id, session_authority, class_lesson_session_id, session_date, starts_at, ends_at, session_schedule_state, session_source_revision, source_revision, booking_fact_hash, teacher_catalog_id, teacher_profile_id, classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot, classroom_name_snapshot, campus, created_by, updated_by) values ('97000000-0000-4000-8000-000000000110', '97000000-0000-4000-8000-000000000105', '97000000-0000-4000-8000-000000000106', '97000000-0000-4000-8000-000000000109', '97000000-0000-4000-8000-000000000103', 'normalized', '97000000-0000-4000-8000-000000000104', '2026-08-17', '2026-08-17 18:00+09', '2026-08-17 20:00+09', 'active', 7, '{"authority":"normalized","sessionId":"97000000-0000-4000-8000-000000000104","revision":7}'::jsonb, repeat('b', 64), '97000000-0000-4000-8000-000000000101', '97000000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000102', '영어', '청강 영어반', '청강 담당원장', '청강 101호', '본관', '97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'one track cannot have a second open observation'
);
select throws_ok(
  $$update public.ops_registration_subject_tracks set observation_return_workflow_status = null where id = '97000000-0000-4000-8000-000000000106'$$,
  '23514', null, 'observation workflow requires a return state'
);

create or replace function pg_temp.registration_observation_call_as_actor(
  p_actor uuid,
  p_sql text
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.registration_observation_set_actor(p_actor);
  execute 'set local role authenticated';
  execute p_sql into v_result;
  execute 'reset role';
  return v_result;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.registration_observation_explain_as_actor(
  p_actor uuid,
  p_sql text
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_result jsonb;
begin
  perform pg_temp.registration_observation_set_actor(p_actor);
  execute 'set local role authenticated';
  execute 'explain (analyze, buffers, format json) ' || p_sql into v_result;
  execute 'reset role';
  return v_result;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create or replace function pg_temp.registration_observation_plan_nodes(p_plan jsonb)
returns table(node jsonb)
language sql
stable
as $$
  with recursive nodes(node) as (
    select p_plan -> 0 -> 'Plan'
    union all
    select child.value
    from nodes parent
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(parent.node -> 'Plans', '[]'::jsonb)
    ) child(value)
  )
  select nodes.node from nodes;
$$;

select is(
  pg_catalog.jsonb_build_object(
    'managerAccess', pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('dashboard_private.assert_registration_observation_manager_access_v1(uuid)')),
    'resolver', pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('dashboard_private.resolve_registration_observation_session_v1(uuid,uuid,text,uuid,text)')),
    'bookingHash', pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('dashboard_private.registration_observation_booking_fact_hash_v1(jsonb)')),
    'legacyHash', pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('dashboard_private.registration_observation_legacy_session_content_hash_v1(jsonb,text)')),
    'list', pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('public.list_registration_observation_sessions_v1(uuid,uuid,date,date)')),
    'detail', pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('public.get_registration_observation_manager_detail_v1(uuid,integer)')),
    'attempt', pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('public.get_registration_observation_manager_attempt_v1(uuid,uuid)'))
  ),
  '{"attempt":"jsonb","bookingHash":"text","detail":"jsonb","legacyHash":"text","list":"jsonb","managerAccess":"ops_registration_subject_tracks","resolver":"jsonb"}'::jsonb,
  'read helpers and RPCs have the exact frozen signatures'
);

select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'signature', function_row.proname || '(' || pg_catalog.pg_get_function_identity_arguments(function_row.oid) || ')',
        'definer', function_row.prosecdef,
        'searchPath', function_row.proconfig
      )
      order by (function_row.proname || '(' || pg_catalog.pg_get_function_identity_arguments(function_row.oid) || ')') collate "C"
    )
    from pg_catalog.pg_proc function_row
    where function_row.oid in (
      pg_catalog.to_regprocedure('public.list_registration_observation_sessions_v1(uuid,uuid,date,date)'),
      pg_catalog.to_regprocedure('public.get_registration_observation_manager_detail_v1(uuid,integer)'),
      pg_catalog.to_regprocedure('public.get_registration_observation_manager_attempt_v1(uuid,uuid)'),
      pg_catalog.to_regprocedure('dashboard_private.list_registration_observation_sessions_v1_impl(uuid,uuid,date,date)'),
      pg_catalog.to_regprocedure('dashboard_private.get_registration_observation_manager_detail_v1_impl(uuid,integer)'),
      pg_catalog.to_regprocedure('dashboard_private.get_registration_observation_manager_attempt_v1_impl(uuid,uuid)'),
      pg_catalog.to_regprocedure('dashboard_private.assert_registration_observation_manager_access_v1(uuid)'),
      pg_catalog.to_regprocedure('dashboard_private.resolve_registration_observation_session_v1(uuid,uuid,text,uuid,text)'),
      pg_catalog.to_regprocedure('dashboard_private.registration_observation_booking_fact_hash_v1(jsonb)'),
      pg_catalog.to_regprocedure('dashboard_private.registration_observation_legacy_session_content_hash_v1(jsonb,text)')
    )
  ),
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'signature', expected.signature,
        'definer', expected.definer,
        'searchPath', array['search_path=""']::text[]
      )
      order by expected.signature collate "C"
    )
    from (values
      ('assert_registration_observation_manager_access_v1(p_track_id uuid)', true),
      ('get_registration_observation_manager_attempt_v1(p_track_id uuid, p_observation_id uuid)', false),
      ('get_registration_observation_manager_attempt_v1_impl(p_track_id uuid, p_observation_id uuid)', true),
      ('get_registration_observation_manager_detail_v1(p_track_id uuid, p_attempt_limit integer)', false),
      ('get_registration_observation_manager_detail_v1_impl(p_track_id uuid, p_attempt_limit integer)', true),
      ('list_registration_observation_sessions_v1(p_track_id uuid, p_class_id uuid, p_date_from date, p_date_to date)', false),
      ('list_registration_observation_sessions_v1_impl(p_track_id uuid, p_class_id uuid, p_date_from date, p_date_to date)', true),
      ('registration_observation_booking_fact_hash_v1(p_fact jsonb)', true),
      ('registration_observation_legacy_session_content_hash_v1(p_schedule_plan jsonb, p_session_key text)', true),
      ('resolve_registration_observation_session_v1(p_track_id uuid, p_class_id uuid, p_session_authority text, p_class_lesson_session_id uuid, p_legacy_session_key text)', true)
    ) expected(signature, definer)
  ),
  'public wrappers are invokers and every private read helper is a fixed-search-path definer'
);

select is(
  pg_catalog.jsonb_build_object(
    'publicAuthenticated',
      has_function_privilege('authenticated', 'public.list_registration_observation_sessions_v1(uuid,uuid,date,date)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_registration_observation_manager_detail_v1(uuid,integer)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_registration_observation_manager_attempt_v1(uuid,uuid)', 'EXECUTE'),
    'privateChainAuthenticated',
      has_function_privilege('authenticated', 'dashboard_private.list_registration_observation_sessions_v1_impl(uuid,uuid,date,date)', 'EXECUTE')
      and has_function_privilege('authenticated', 'dashboard_private.get_registration_observation_manager_detail_v1_impl(uuid,integer)', 'EXECUTE')
      and has_function_privilege('authenticated', 'dashboard_private.get_registration_observation_manager_attempt_v1_impl(uuid,uuid)', 'EXECUTE'),
    'anonDenied',
      not has_function_privilege('anon', 'public.list_registration_observation_sessions_v1(uuid,uuid,date,date)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.get_registration_observation_manager_detail_v1(uuid,integer)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.get_registration_observation_manager_attempt_v1(uuid,uuid)', 'EXECUTE'),
    'serviceRoleDenied',
      not has_function_privilege('service_role', 'public.list_registration_observation_sessions_v1(uuid,uuid,date,date)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.get_registration_observation_manager_detail_v1(uuid,integer)', 'EXECUTE')
      and not has_function_privilege('service_role', 'public.get_registration_observation_manager_attempt_v1(uuid,uuid)', 'EXECUTE'),
    'pureHelpersDenied',
      not has_function_privilege('authenticated', 'dashboard_private.assert_registration_observation_manager_access_v1(uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'dashboard_private.resolve_registration_observation_session_v1(uuid,uuid,text,uuid,text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'dashboard_private.registration_observation_booking_fact_hash_v1(jsonb)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'dashboard_private.registration_observation_legacy_session_content_hash_v1(jsonb,text)', 'EXECUTE')
  ),
  '{"anonDenied":true,"privateChainAuthenticated":true,"publicAuthenticated":true,"pureHelpersDenied":true,"serviceRoleDenied":true}'::jsonb,
  'read RPC grants are explicit and pure helpers remain outside the Data API chain'
);

select is(
  (
    select pg_catalog.jsonb_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ops_registration_subject_track_summaries'
      and ordinal_position > 25
  ),
  pg_catalog.to_jsonb(array[
    'observation_attempt_count',
    'observation_current_id',
    'observation_current_status',
    'observation_current_appointment_id',
    'observation_nearest_scheduled_at',
    'observation_nearest_place',
    'observation_notification_revision',
    'observation_revision',
    'observation_feedback_revision'
  ]::text[]),
  'summary preserves existing order and appends only the nine observation scalars'
);

select is(
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[],"sessions":[{"sessionKey":"priority-session-key","session_key":"priority-snake","id":"priority-id","textbookEntries":[]}]}'::jsonb,
    'priority-session-key'
  ),
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[],"sessions":[{"sessionKey":"priority-session-key","textbookEntries":[]}]}'::jsonb,
    'priority-session-key'
  ),
  'sessionKey/session_key/id priority prefers sessionKey'
);

select is(
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[],"sessions":[{"session_key":"priority-snake","id":"priority-id","textbookEntries":[]}]}'::jsonb,
    'priority-snake'
  ),
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[],"sessions":[{"sessionKey":"priority-snake","textbookEntries":[]}]}'::jsonb,
    'priority-snake'
  ),
  'sessionKey/session_key/id priority falls back to session_key'
);

select is(
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[],"session_list":[{"id":"priority-id","textbookEntries":[]}]}'::jsonb,
    'priority-id'
  ),
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[],"sessions":[{"sessionKey":"priority-id","textbookEntries":[]}]}'::jsonb,
    'priority-id'
  ),
  'sessionKey/session_key/id priority falls back to id and supports session_list only when sessions is absent'
);

select throws_ok(
  $$select dashboard_private.registration_observation_legacy_session_content_hash_v1('{"sessions":[{"memo":"missing key"}]}'::jsonb, 'missing')$$,
  '22023',
  'registration_observation_legacy_session_invalid',
  'legacy content hash rejects a missing canonical key'
);

select throws_ok(
  $$select dashboard_private.registration_observation_legacy_session_content_hash_v1('{"sessions":[{"sessionKey":"duplicate"},{"session_key":"duplicate"}]}'::jsonb, 'duplicate')$$,
  '22023',
  'registration_observation_legacy_session_invalid',
  'legacy content hash rejects duplicate canonical keys'
);

select isnt(
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[{"textbookId":"book-selected","title":"선택 교재"}],"sessions":[{"sessionKey":"selected","textbookEntries":[{"textbookId":"book-selected","plan":{"label":"1단원"}}]},{"sessionKey":"other","textbookEntries":[]}]}'::jsonb,
    'selected'
  ),
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[{"textbookId":"book-selected","title":"선택 교재"}],"sessions":[{"sessionKey":"selected","textbookEntries":[{"textbookId":"book-selected","plan":{"label":"2단원"}}]},{"sessionKey":"other","textbookEntries":[]}]}'::jsonb,
    'selected'
  ),
  'selected-session legacy content hash changes with selected textbookEntries'
);

select is(
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[{"textbookId":"book-selected","title":"선택 교재"},{"textbookId":"book-other","title":"다른 교재 A"}],"sessions":[{"sessionKey":"selected","state":"active","memo":"selected","textbookEntries":[{"textbookId":"book-selected"}]},{"sessionKey":"other","state":"active","memo":"A","textbookEntries":[{"textbookId":"book-other"}]}]}'::jsonb,
    'selected'
  ),
  dashboard_private.registration_observation_legacy_session_content_hash_v1(
    '{"textbooks":[{"textbookId":"book-selected","title":"선택 교재"},{"textbookId":"book-other","title":"다른 교재 B"}],"sessions":[{"sessionKey":"selected","state":"active","memo":"selected","textbookEntries":[{"textbookId":"book-selected"}]},{"sessionKey":"other","state":"makeup","memo":"B","textbookEntries":[]}]}'::jsonb,
    'selected'
  ),
  'selected-session legacy content hash ignores every unselected session and textbook change'
);

select is(
  dashboard_private.registration_observation_booking_fact_hash_v1(
    '{"classId":"97000000-0000-4000-8000-000000000103","subject":"영어","sessionAuthority":"normalized","classLessonSessionId":"97000000-0000-4000-8000-000000000104","legacySessionKey":null,"sessionKey":"hash-session","scheduleState":"active","sessionDate":"2026-08-17","startsAt":"2026-08-17T09:00:00Z","endsAt":"2026-08-17T11:00:00Z","teacherCatalogId":"97000000-0000-4000-8000-000000000101","teacherProfileId":"97000000-0000-4000-8000-000000000003","teacherName":"청강 담당원장","classroomCatalogId":"97000000-0000-4000-8000-000000000102","classroomName":"청강 101호","campus":"본관","textbooks":[1],"progress":"변경","memo":"변경","workflowStatus":"변경"}'::jsonb
  ),
  dashboard_private.registration_observation_booking_fact_hash_v1(
    '{"classId":"97000000-0000-4000-8000-000000000103","subject":"영어","sessionAuthority":"normalized","classLessonSessionId":"97000000-0000-4000-8000-000000000104","legacySessionKey":null,"sessionKey":"hash-session","scheduleState":"active","sessionDate":"2026-08-17","startsAt":"2026-08-17T09:00:00Z","endsAt":"2026-08-17T11:00:00Z","teacherCatalogId":"97000000-0000-4000-8000-000000000101","teacherProfileId":"97000000-0000-4000-8000-000000000003","teacherName":"청강 담당원장","classroomCatalogId":"97000000-0000-4000-8000-000000000102","classroomName":"청강 101호","campus":"본관"}'::jsonb
  ),
  'booking fact hash excludes textbook progress memo and workflow facts'
);

select isnt(
  dashboard_private.registration_observation_booking_fact_hash_v1(
    '{"classId":"97000000-0000-4000-8000-000000000103","subject":"영어","sessionAuthority":"normalized","classLessonSessionId":"97000000-0000-4000-8000-000000000104","legacySessionKey":null,"sessionKey":"hash-session","scheduleState":"active","sessionDate":"2026-08-17","startsAt":"2026-08-17T09:00:00Z","endsAt":"2026-08-17T11:00:00Z","teacherCatalogId":"97000000-0000-4000-8000-000000000101","teacherProfileId":"97000000-0000-4000-8000-000000000003","teacherName":"청강 담당원장","classroomCatalogId":"97000000-0000-4000-8000-000000000102","classroomName":"청강 101호","campus":"본관"}'::jsonb
  ),
  dashboard_private.registration_observation_booking_fact_hash_v1(
    '{"classId":"97000000-0000-4000-8000-000000000103","subject":"영어","sessionAuthority":"normalized","classLessonSessionId":"97000000-0000-4000-8000-000000000104","legacySessionKey":null,"sessionKey":"hash-session","scheduleState":"active","sessionDate":"2026-08-17","startsAt":"2026-08-17T10:00:00Z","endsAt":"2026-08-17T11:00:00Z","teacherCatalogId":"97000000-0000-4000-8000-000000000101","teacherProfileId":"97000000-0000-4000-8000-000000000003","teacherName":"청강 담당원장","classroomCatalogId":"97000000-0000-4000-8000-000000000102","classroomName":"청강 101호","campus":"본관"}'::jsonb
  ),
  'booking fact hash changes when a booking authority fact changes'
);

insert into public.textbooks(
  id, name, title, subject, school_level, grade_level,
  school_levels, grade_levels, sub_subject, status
)
values (
  '97000000-0000-4000-8000-000000000120',
  '청강 교재',
  '청강 교재',
  'english',
  'middle',
  'm1',
  array['middle']::text[],
  array['m1']::text[],
  '기타',
  'active'
);

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan, teacher, room
)
values
(
  '97000000-0000-4000-8000-000000000121',
  '청강 정규 resolver 반',
  '영어',
  '수업 진행 중',
  'normalized',
  pg_catalog.jsonb_build_object(
    'textbooks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'textbookId', '97000000-0000-4000-8000-000000000120',
      'title', '청강 교재'
    )),
    'sessions', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sessionKey', pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD') || ':normalized',
      'textbookEntries', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'textbookId', '97000000-0000-4000-8000-000000000120',
        'plan', pg_catalog.jsonb_build_object('label', '1단원', 'memo', '예습')
      ))
    ))
  ),
  '청강 담당원장',
  '청강 101호'
),
(
  '97000000-0000-4000-8000-000000000124',
  '청강 legacy resolver 반',
  '영어',
  '수업 진행 중',
  'legacy',
  pg_catalog.jsonb_build_object(
    'textbooks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'textbookId', '97000000-0000-4000-8000-000000000120',
      'title', '청강 교재'
    )),
    'sessions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sessionKey', 'legacy-primary', 'session_key', 'legacy-secondary', 'id', 'legacy-id',
        'date', pg_catalog.to_char(current_date + 8, 'YYYY-MM-DD'),
        'scheduleState', 'normal',
        'textbookEntries', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'textbookId', '97000000-0000-4000-8000-000000000120',
          'plan', pg_catalog.jsonb_build_object('label', '2단원', 'memo', '복습')
        ))
      ),
      pg_catalog.jsonb_build_object(
        'session_key', 'legacy-snake', 'id', 'legacy-snake-id',
        'sessionDate', pg_catalog.to_char(current_date + 9, 'YYYY-MM-DD'),
        'schedule_state', 'active', 'textbookEntries', '[]'::jsonb
      ),
      pg_catalog.jsonb_build_object(
        'id', 'legacy-id-only',
        'session_date', pg_catalog.to_char(current_date + 10, 'YYYY-MM-DD'),
        'state', 'makeup', 'textbookEntries', '[]'::jsonb
      ),
      pg_catalog.jsonb_build_object(
        'sessionKey', 'legacy-unknown',
        'date', pg_catalog.to_char(current_date + 11, 'YYYY-MM-DD'),
        'scheduleState', 'removed', 'textbookEntries', '[]'::jsonb
      ),
      pg_catalog.jsonb_build_object(
        'sessionKey', 'legacy-ambiguous',
        'date', pg_catalog.to_char(current_date + 12, 'YYYY-MM-DD'),
        'scheduleState', 'active', 'textbookEntries', '[]'::jsonb
      )
    )
  ),
  '청강 담당원장',
  '청강 101호'
);

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '97000000-0000-4000-8000-000000000121',
    '97000000-0000-4000-8000-000000000111',
    'registration_observation_reads_normalized_fixture'
  );
end;
$$;

insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state, start_time, end_time,
  teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id,
  classroom_name_snapshot, origin, memo, public_note, revision
)
values (
  '97000000-0000-4000-8000-000000000122',
  '97000000-0000-4000-8000-000000000121',
  pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD') || ':normalized',
  current_date + 7,
  'active',
  '18:00',
  '20:00',
  '97000000-0000-4000-8000-000000000101',
  '청강 담당원장',
  '97000000-0000-4000-8000-000000000102',
  '청강 101호',
  'manual',
  '정규 회차 메모',
  '정규 공개 메모',
  9
),
(
  '97000000-0000-4000-8000-000000000129',
  '97000000-0000-4000-8000-000000000121',
  pg_catalog.to_char(current_date + 40, 'YYYY-MM-DD') || ':normalized-null-catalogs',
  current_date + 40,
  'active',
  '18:00',
  '20:00',
  null,
  '청강 담당원장',
  null,
  '청강 101호',
  'manual',
  '',
  '',
  1
);

insert into public.progress_logs(
  id, class_id, textbook_id, session_id, status, range_label, content,
  public_note, updated_at
)
values
(
  '97000000-0000-4000-8000-000000000127',
  '97000000-0000-4000-8000-000000000121',
  '97000000-0000-4000-8000-000000000120',
  pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD') || ':normalized',
  'partial', '정규 진도', '정규 진도 본문', '정규 진도 공개', now() - interval '1 minute'
),
(
  '97000000-0000-4000-8000-000000000128',
  '97000000-0000-4000-8000-000000000121',
  '97000000-0000-4000-8000-000000000120',
  'other-session',
  'done', '다른 회차 진도', '다른 회차 본문', '다른 회차 공개', now()
);

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '97000000-0000-4000-8000-000000000124',
    '97000000-0000-4000-8000-000000000111',
    'registration_observation_reads_legacy_fixture'
  );
end;
$$;

insert into public.class_schedule_slots(
  id, class_id, weekday, start_time, end_time,
  teacher_catalog_id, teacher_name, classroom_catalog_id, classroom_name, sort_order
)
select
  ('97000000-0000-4000-8000-' || pg_catalog.lpad((130 + fixture.sort_order)::text, 12, '0'))::uuid,
  '97000000-0000-4000-8000-000000000124'::uuid,
  extract(dow from current_date + fixture.offset_value)::smallint,
  fixture.start_time,
  fixture.end_time,
  null,
  '청강 담당원장',
  null,
  '청강 101호',
  fixture.sort_order
from (values
  (8, '17:00'::time, '19:00'::time, 0),
  (9, '17:00'::time, '19:00'::time, 1),
  (10, '17:00'::time, '19:00'::time, 2),
  (11, '17:00'::time, '19:00'::time, 3),
  (12, '17:00'::time, '19:00'::time, 4),
  (12, '19:30'::time, '21:00'::time, 5)
) fixture(offset_value, start_time, end_time, sort_order);

select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.list_registration_observation_sessions_v1('97000000-0000-4000-8000-000000000106', '97000000-0000-4000-8000-000000000121', current_date, current_date + 121)$$,
  '22023',
  'registration_observation_date_range_invalid',
  'session list rejects a range longer than 120 days'
);
select is(
  pg_catalog.jsonb_array_length(public.list_registration_observation_sessions_v1(
    '97000000-0000-4000-8000-000000000106',
    '97000000-0000-4000-8000-000000000121',
    current_date,
    current_date + 30
  )),
  1,
  'normalized session list resolves one future active session'
);
select is(
  (
    select pg_catalog.jsonb_agg(key order by key)
    from pg_catalog.jsonb_object_keys(
      public.list_registration_observation_sessions_v1(
        '97000000-0000-4000-8000-000000000106',
        '97000000-0000-4000-8000-000000000121',
        current_date,
        current_date + 30
      ) -> 0
    ) key
  ),
  pg_catalog.to_jsonb(array[
    'bookingFactHash', 'campus', 'classId', 'classLessonSessionId', 'className',
    'classroomCatalogId', 'classroomName', 'endsAt', 'legacySessionKey',
    'legacySessionSourceHash', 'progress', 'scheduleState', 'sessionAuthority',
    'sessionDate', 'sessionKey', 'sessionSourceRevision', 'sourceRevision',
    'startsAt', 'subject', 'teacherCatalogId', 'teacherName', 'teacherProfileId',
    'textbooks'
  ]::text[]),
  'normalized resolver returns the exact session option key set'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'sessionAuthority', item -> 'sessionAuthority',
      'classLessonSessionId', item -> 'classLessonSessionId',
      'legacySessionKey', item -> 'legacySessionKey',
      'sessionKey', item -> 'sessionKey',
      'scheduleState', item -> 'scheduleState',
      'sessionSourceRevision', item -> 'sessionSourceRevision',
      'legacySessionSourceHash', item -> 'legacySessionSourceHash',
      'sourceRevision', item -> 'sourceRevision',
      'campus', item -> 'campus',
      'textbooks', item -> 'textbooks',
      'progress', item -> 'progress'
    )
    from pg_catalog.jsonb_array_elements(
      public.list_registration_observation_sessions_v1(
        '97000000-0000-4000-8000-000000000106',
        '97000000-0000-4000-8000-000000000121',
        current_date,
        current_date + 30
      )
    ) item
  ),
  '{"campus":"본관","classLessonSessionId":"97000000-0000-4000-8000-000000000122","legacySessionKey":null,"legacySessionSourceHash":null,"progress":"진도: 정규 진도","scheduleState":"active","sessionAuthority":"normalized","sessionKey":null,"sessionSourceRevision":9,"sourceRevision":{"authority":"normalized","revision":9,"sessionId":"97000000-0000-4000-8000-000000000122"},"textbooks":[{"memo":"예습","planLabel":"1단원","textbookId":"97000000-0000-4000-8000-000000000120","title":"청강 교재"}]}'::jsonb
    || pg_catalog.jsonb_build_object('sessionKey', pg_catalog.to_char(current_date + 7, 'YYYY-MM-DD') || ':normalized'),
  'normalized resolver uses canonical source revision selected textbook and exact-session progress only'
);
select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'sessionKey', item -> 'sessionKey',
        'legacySessionKey', item -> 'legacySessionKey',
        'scheduleState', item -> 'scheduleState',
        'textbooks', item -> 'textbooks'
      )
      order by item ->> 'sessionDate'
    )
    from pg_catalog.jsonb_array_elements(
      public.list_registration_observation_sessions_v1(
        '97000000-0000-4000-8000-000000000106',
        '97000000-0000-4000-8000-000000000124',
        current_date + 8,
        current_date + 10
      )
    ) item
  ),
  '[{"legacySessionKey":"legacy-primary","scheduleState":"active","sessionKey":"legacy-primary","textbooks":[{"memo":"복습","planLabel":"2단원","textbookId":"97000000-0000-4000-8000-000000000120","title":"청강 교재"}]},{"legacySessionKey":"legacy-snake","scheduleState":"active","sessionKey":"legacy-snake","textbooks":[]},{"legacySessionKey":"legacy-id-only","scheduleState":"makeup","sessionKey":"legacy-id-only","textbooks":[]}]'::jsonb,
  'legacy resolver uses exact unique name fallback, honors key priority, maps normal to active, and keeps selected textbooks'
);
reset role;

select throws_ok(
  $$select dashboard_private.resolve_registration_observation_session_v1('97000000-0000-4000-8000-000000000106', '97000000-0000-4000-8000-000000000121', 'normalized', '97000000-0000-4000-8000-000000000129', null)$$,
  '22023',
  'registration_observation_session_invalid',
  'normalized resolver rejects name fallback when canonical catalog IDs are missing'
);
select throws_ok(
  $$select dashboard_private.resolve_registration_observation_session_v1('97000000-0000-4000-8000-000000000106', '97000000-0000-4000-8000-000000000124', 'legacy', null, 'legacy-unknown')$$,
  '22023',
  'registration_observation_legacy_session_invalid',
  'legacy resolver rejects an unknown selected-session state'
);
select throws_ok(
  $$select dashboard_private.resolve_registration_observation_session_v1('97000000-0000-4000-8000-000000000106', '97000000-0000-4000-8000-000000000124', 'legacy', null, 'legacy-ambiguous')$$,
  '22023',
  'registration_observation_session_time_ambiguous',
  'legacy resolver rejects zero or multiple repeating slots for the exact date'
);

insert into public.ops_tasks(id, title, type, status, priority, requested_by, student_name)
values ('97000000-0000-4000-8000-000000000125', '청강 other track fixture', 'registration', 'requested', 'normal', '97000000-0000-4000-8000-000000000001', '합성 다른학생');
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values (
  '97000000-0000-4000-8000-000000000126',
  '97000000-0000-4000-8000-000000000125',
  '영어', 'consultation_waiting', '97000000-0000-4000-8000-000000000003',
  'manual', now(), false, 'consultation_completed', 1, now(), null, 0
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision,
  created_by, created_at, updated_at
)
select
  ('98000000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  '97000000-0000-4000-8000-000000000105'::uuid,
  'observation_class',
  '2026-08-17 18:00+09'::timestamptz,
  '본관',
  'canceled',
  1,
  '97000000-0000-4000-8000-000000000001'::uuid,
  now() - ((10001 - series.value) * interval '1 second'),
  now() - ((10001 - series.value) * interval '1 second')
from pg_catalog.generate_series(1, 10000) series(value);

insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, status, decision_kind, decided_by, decided_at,
  created_by, updated_by, created_at, updated_at
)
select
  ('98100000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  '97000000-0000-4000-8000-000000000105'::uuid,
  '97000000-0000-4000-8000-000000000106'::uuid,
  ('98000000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  '97000000-0000-4000-8000-000000000103'::uuid,
  'normalized',
  '97000000-0000-4000-8000-000000000104'::uuid,
  null,
  '2026-08-17'::date,
  '2026-08-17 18:00+09'::timestamptz,
  '2026-08-17 20:00+09'::timestamptz,
  'active',
  7,
  null,
  '{"authority":"normalized","sessionId":"97000000-0000-4000-8000-000000000104","revision":7}'::jsonb,
  repeat('c', 64),
  '97000000-0000-4000-8000-000000000101'::uuid,
  '97000000-0000-4000-8000-000000000003'::uuid,
  '97000000-0000-4000-8000-000000000102'::uuid,
  '영어',
  '청강 영어반',
  '청강 담당원장',
  '청강 101호',
  '본관',
  case when series.value = 2 then 'scheduled' else 'canceled' end,
  case when series.value in (1, 2) then 'enrollment' else null end,
  case when series.value in (1, 2) then '97000000-0000-4000-8000-000000000001'::uuid else null end,
  case when series.value in (1, 2) then now() - interval '3 hours' else null end,
  '97000000-0000-4000-8000-000000000001'::uuid,
  '97000000-0000-4000-8000-000000000001'::uuid,
  now() - ((10001 - series.value) * interval '1 second'),
  now() - ((10001 - series.value) * interval '1 second')
from pg_catalog.generate_series(1, 10000) series(value);

update public.ops_registration_subject_tracks
set observation_attempt_count = 10001
where id = '97000000-0000-4000-8000-000000000106';
analyze public.ops_registration_subject_tracks;
analyze public.ops_registration_observations;
analyze public.ops_registration_appointments;

select is(
  (select observation_attempt_count from public.ops_registration_subject_tracks where id = '97000000-0000-4000-8000-000000000106'),
  10001::bigint,
  '10k terminal history plus one open row uses the transactionally maintained scalar'
);

select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.get_registration_observation_manager_detail_v1('97000000-0000-4000-8000-000000000106', 20)$$,
  'manager detail accepts the default-sized bounded read'
);
select throws_ok(
  $$select public.get_registration_observation_manager_detail_v1('97000000-0000-4000-8000-000000000106', 51)$$,
  '22023',
  'registration_observation_attempt_limit_invalid',
  'manager detail rejects a limit above 50'
);
select is(
  pg_catalog.jsonb_array_length(
    public.get_registration_observation_manager_detail_v1(
      '97000000-0000-4000-8000-000000000106', 50
    ) -> 'attempts'
  ),
  50,
  'manager detail returns at most the requested 50 recent attempts'
);
select is(
  (public.get_registration_observation_manager_detail_v1(
    '97000000-0000-4000-8000-000000000106', 50
  ) -> 'attempts') @> '[{"observationId":"98100000-0000-4000-8000-000000000001"}]'::jsonb,
  false,
  'manager detail excludes the oldest attempt outside the recent limit'
);
select is(
  public.get_registration_observation_manager_detail_v1(
    '97000000-0000-4000-8000-000000000106', 50
  ) ->> 'latestEnrollmentDecisionObservationId',
  '98100000-0000-4000-8000-000000000002',
  'latest enrollment decision scalar is independent of the attempt limit and status group'
);
select lives_ok(
  $$select public.get_registration_observation_manager_attempt_v1('97000000-0000-4000-8000-000000000106', '98100000-0000-4000-8000-000000000001')$$,
  'exact observation lookup is independent of the recent-attempt limit'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'topKeys', (
        select pg_catalog.jsonb_agg(key order by key)
        from pg_catalog.jsonb_object_keys(exact_result) key
      ),
      'trackId', exact_result -> 'trackId',
      'taskId', exact_result -> 'taskId',
      'observationTrackId', exact_result -> 'observation' -> 'trackId',
      'observationTaskId', exact_result -> 'observation' -> 'taskId',
      'appointmentId', exact_result -> 'observation' -> 'appointmentId'
    )
    from (select public.get_registration_observation_manager_attempt_v1(
      '97000000-0000-4000-8000-000000000106',
      '98100000-0000-4000-8000-000000000001'
    ) exact_result) result
  ),
  '{"appointmentId":"98000000-0000-4000-8000-000000000001","observationTaskId":"97000000-0000-4000-8000-000000000105","observationTrackId":"97000000-0000-4000-8000-000000000106","taskId":"97000000-0000-4000-8000-000000000105","topKeys":["observation","taskId","trackId"],"trackId":"97000000-0000-4000-8000-000000000106"}'::jsonb,
  'exact attempt returns the frozen identifiers and exact three-key envelope'
);
select is(
  public.get_registration_observation_manager_attempt_v1(
    '97000000-0000-4000-8000-000000000106',
    '98100000-0000-4000-8000-000000010000'
  ) -> 'observation',
  (
    select attempt.value
    from pg_catalog.jsonb_array_elements(
      public.get_registration_observation_manager_detail_v1(
        '97000000-0000-4000-8000-000000000106', 50
      ) -> 'attempts'
    ) attempt(value)
    where attempt.value ->> 'observationId' = '98100000-0000-4000-8000-000000010000'
  ),
  'exact lookup observation is byte-for-byte the same object as a manager detail attempt'
);
select throws_ok(
  $$select public.get_registration_observation_manager_attempt_v1('97000000-0000-4000-8000-000000000126', '98100000-0000-4000-8000-000000000001')$$,
  'P0002',
  'registration_observation_not_found',
  'other track ID conceals an existing exact observation'
);
select throws_ok(
  $$select public.get_registration_observation_manager_attempt_v1('97000000-0000-4000-8000-000000000106', '98100000-0000-4000-8000-999999999999')$$,
  'P0002',
  'registration_observation_not_found',
  'missing exact observation uses the same concealed error'
);
reset role;

select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select public.get_registration_observation_manager_detail_v1('97000000-0000-4000-8000-000000000106', 20)$$,
  'active staff can read manager detail'
);
reset role;

select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok(
  $$select public.get_registration_observation_manager_detail_v1('97000000-0000-4000-8000-000000000106', 20)$$,
  'active exact director can read manager detail'
);
reset role;

update auth.users
set banned_until = now() + interval '1 day'
where id = '97000000-0000-4000-8000-000000000003';
select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.get_registration_observation_manager_detail_v1('97000000-0000-4000-8000-000000000106', 20)$$,
  'P0002',
  'registration_observation_not_found',
  'banned exact director receives the concealed manager error'
);
reset role;
update auth.users
set banned_until = null,
    deleted_at = now()
where id = '97000000-0000-4000-8000-000000000003';
select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.get_registration_observation_manager_detail_v1('97000000-0000-4000-8000-000000000106', 20)$$,
  'P0002',
  'registration_observation_not_found',
  'deleted exact director receives the concealed manager error'
);
reset role;
update auth.users
set deleted_at = null
where id = '97000000-0000-4000-8000-000000000003';

select pg_temp.registration_observation_set_actor('97000000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.get_registration_observation_manager_attempt_v1('97000000-0000-4000-8000-000000000106', '98100000-0000-4000-8000-000000000001')$$,
  'P0002',
  'registration_observation_not_found',
  'unrelated actor receives the same concealed exact-attempt error'
);
select throws_ok(
  $$select public.get_registration_observation_manager_detail_v1('97000000-0000-4000-8000-000000000106', 20)$$,
  'P0002',
  'registration_observation_not_found',
  'unrelated actor cannot infer manager detail existence'
);
reset role;

create temporary table registration_observation_read_plans(
  name text primary key,
  plan jsonb not null
) on commit drop;

insert into registration_observation_read_plans(name, plan)
values
(
  'exact-10k',
  pg_temp.registration_observation_explain_as_actor(
    '97000000-0000-4000-8000-000000000001',
    $$select observation.id
      from public.ops_registration_observations observation
      where observation.id = '98100000-0000-4000-8000-000000000001'
        and observation.track_id = '97000000-0000-4000-8000-000000000106'
      limit 1$$
  )
),
(
  'detail-10k',
  pg_temp.registration_observation_explain_as_actor(
    '97000000-0000-4000-8000-000000000001',
    $$select observation.id
      from public.ops_registration_observations observation
      where observation.track_id = '97000000-0000-4000-8000-000000000106'
      order by observation.created_at desc, observation.id desc
      limit 50$$
  )
),
(
  'summary-10k',
  pg_temp.registration_observation_explain_as_actor(
    '97000000-0000-4000-8000-000000000001',
    $$select summary.*
      from public.ops_registration_subject_track_summaries summary
      where summary.id = '97000000-0000-4000-8000-000000000106'$$
  )
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'historySeqOrAggregate', count(*) filter (
        where node ->> 'Node Type' like '%Aggregate%'
          or (node ->> 'Node Type' = 'Seq Scan' and node ->> 'Relation Name' = 'ops_registration_observations')
      ),
      'pkRowsBounded', coalesce(bool_and((node ->> 'Actual Rows')::numeric <= 1), false),
      'pkLoopsOne', coalesce(bool_and((node ->> 'Actual Loops')::numeric = 1), false)
    )
    from registration_observation_read_plans stored
    cross join lateral pg_temp.registration_observation_plan_nodes(stored.plan) node
    where stored.name = 'exact-10k'
      and (
        node ->> 'Index Name' = 'ops_registration_observations_pkey'
        or node ->> 'Node Type' like '%Aggregate%'
        or (node ->> 'Node Type' = 'Seq Scan' and node ->> 'Relation Name' = 'ops_registration_observations')
      )
  ),
  '{"historySeqOrAggregate":0,"pkLoopsOne":true,"pkRowsBounded":true}'::jsonb,
  'exact attempt PK plan reads at most one row in one loop with no history scan or aggregate'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'historySeqOrAggregate', count(*) filter (
        where node ->> 'Node Type' like '%Aggregate%'
          or (node ->> 'Node Type' = 'Seq Scan' and node ->> 'Relation Name' = 'ops_registration_observations')
      ),
      'rowsBounded', coalesce(bool_and((node ->> 'Actual Rows')::numeric <= 50) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_track_created_idx'
      ), false),
      'loopsOne', coalesce(bool_and((node ->> 'Actual Loops')::numeric = 1) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_track_created_idx'
      ), false)
    )
    from registration_observation_read_plans stored
    cross join lateral pg_temp.registration_observation_plan_nodes(stored.plan) node
    where stored.name = 'detail-10k'
  ),
  '{"historySeqOrAggregate":0,"loopsOne":true,"rowsBounded":true}'::jsonb,
  '10k manager detail plan uses one bounded recent-attempt index scan'
);

select is(
  (
    select count(*)
    from registration_observation_read_plans stored
    cross join lateral pg_temp.registration_observation_plan_nodes(stored.plan) node
    where stored.name = 'summary-10k'
      and (
        node ->> 'Node Type' like '%Aggregate%'
        or (node ->> 'Node Type' = 'Seq Scan' and node ->> 'Relation Name' = 'ops_registration_observations')
      )
  ),
  0::bigint,
  '10k summary plan has no observation history Seq Scan or aggregate node'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'rowsBounded', coalesce(bool_and((node ->> 'Actual Rows')::numeric <= 1), false),
      'loopsOne', coalesce(bool_and((node ->> 'Actual Loops')::numeric = 1), false),
      'blocksBounded', coalesce(bool_and(
        coalesce((node ->> 'Shared Hit Blocks')::integer, 0)
          + coalesce((node ->> 'Shared Read Blocks')::integer, 0) <= 32
      ), false)
    )
    from registration_observation_read_plans stored
    cross join lateral pg_temp.registration_observation_plan_nodes(stored.plan) node
    where stored.name = 'summary-10k'
      and node ->> 'Index Name' = 'ops_registration_observations_open_track_key'
  ),
  '{"blocksBounded":true,"loopsOne":true,"rowsBounded":true}'::jsonb,
  '10k summary open-index node is one-loop one-row and at most 32 shared blocks'
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision,
  created_by, created_at, updated_at
)
select
  ('98000000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  '97000000-0000-4000-8000-000000000105'::uuid,
  'observation_class',
  '2026-08-17 18:00+09'::timestamptz,
  '본관',
  'canceled',
  1,
  '97000000-0000-4000-8000-000000000001'::uuid,
  now() - ((20001 - series.value) * interval '1 second'),
  now() - ((20001 - series.value) * interval '1 second')
from pg_catalog.generate_series(10001, 20000) series(value);

insert into public.ops_registration_observations(
  id, task_id, track_id, appointment_id, class_id,
  session_authority, class_lesson_session_id, legacy_session_key,
  session_date, starts_at, ends_at, session_schedule_state,
  session_source_revision, legacy_session_source_hash, source_revision,
  booking_fact_hash, teacher_catalog_id, teacher_profile_id,
  classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
  classroom_name_snapshot, campus, status, created_by, updated_by, created_at, updated_at
)
select
  ('98100000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  '97000000-0000-4000-8000-000000000105'::uuid,
  '97000000-0000-4000-8000-000000000106'::uuid,
  ('98000000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  '97000000-0000-4000-8000-000000000103'::uuid,
  'normalized',
  '97000000-0000-4000-8000-000000000104'::uuid,
  null,
  '2026-08-17'::date,
  '2026-08-17 18:00+09'::timestamptz,
  '2026-08-17 20:00+09'::timestamptz,
  'active',
  7,
  null,
  '{"authority":"normalized","sessionId":"97000000-0000-4000-8000-000000000104","revision":7}'::jsonb,
  repeat('d', 64),
  '97000000-0000-4000-8000-000000000101'::uuid,
  '97000000-0000-4000-8000-000000000003'::uuid,
  '97000000-0000-4000-8000-000000000102'::uuid,
  '영어',
  '청강 영어반',
  '청강 담당원장',
  '청강 101호',
  '본관',
  'canceled',
  '97000000-0000-4000-8000-000000000001'::uuid,
  '97000000-0000-4000-8000-000000000001'::uuid,
  now() - ((20001 - series.value) * interval '1 second'),
  now() - ((20001 - series.value) * interval '1 second')
from pg_catalog.generate_series(10001, 20000) series(value);

update public.ops_registration_subject_tracks
set observation_attempt_count = 20001
where id = '97000000-0000-4000-8000-000000000106';
analyze public.ops_registration_observations;
analyze public.ops_registration_appointments;

select is(
  (select observation_attempt_count from public.ops_registration_subject_tracks where id = '97000000-0000-4000-8000-000000000106'),
  20001::bigint,
  '20k terminal history plus one open row keeps the exact track scalar'
);

insert into registration_observation_read_plans(name, plan)
values
(
  'latest-enrollment-20k',
  pg_temp.registration_observation_explain_as_actor(
    '97000000-0000-4000-8000-000000000001',
    $$select bounded.id
      from (values
        ('scheduled'::text),
        ('attended_feedback_pending'),
        ('completed'),
        ('no_show'),
        ('canceled')
      ) status_candidate(status)
      cross join lateral (
        select observation.id, observation.created_at
        from public.ops_registration_observations observation
        where observation.track_id = '97000000-0000-4000-8000-000000000106'
          and observation.decision_kind = 'enrollment'
          and observation.status = status_candidate.status
        order by observation.created_at desc, observation.id desc
        limit 1
      ) bounded
      order by bounded.created_at desc, bounded.id desc
      limit 1$$
  )
),
(
  'summary-20k',
  pg_temp.registration_observation_explain_as_actor(
    '97000000-0000-4000-8000-000000000001',
    $$select summary.*
      from public.ops_registration_subject_track_summaries summary
      where summary.id = '97000000-0000-4000-8000-000000000106'$$
  )
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'historySeqOrAggregate', count(*) filter (
        where node ->> 'Node Type' like '%Aggregate%'
          or (node ->> 'Node Type' = 'Seq Scan' and node ->> 'Relation Name' = 'ops_registration_observations')
      ),
      'trackCreatedIndex', count(*) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_track_created_idx'
      ),
      'decisionIndexPresent', count(*) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_track_decision_status_idx'
      ) > 0,
      'rowsBounded', coalesce(bool_and((node ->> 'Actual Rows')::numeric <= 1) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_track_decision_status_idx'
      ), false),
      'loopsBounded', coalesce(bool_and(
        (node ->> 'Actual Loops')::numeric between 1 and 5
      ) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_track_decision_status_idx'
      ), false),
      'blocksBounded', coalesce(bool_and(
        coalesce((node ->> 'Shared Hit Blocks')::integer, 0)
          + coalesce((node ->> 'Shared Read Blocks')::integer, 0) <= 32
      ) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_track_decision_status_idx'
      ), false)
    )
    from registration_observation_read_plans stored
    cross join lateral pg_temp.registration_observation_plan_nodes(stored.plan) node
    where stored.name = 'latest-enrollment-20k'
  ),
  '{"blocksBounded":true,"decisionIndexPresent":true,"historySeqOrAggregate":0,"loopsBounded":true,"rowsBounded":true,"trackCreatedIndex":0}'::jsonb,
  '20k latest enrollment scalar uses at most five one-row decision-status index probes'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'historySeqOrAggregate', count(*) filter (
        where node ->> 'Node Type' like '%Aggregate%'
          or (node ->> 'Node Type' = 'Seq Scan' and node ->> 'Relation Name' = 'ops_registration_observations')
      ),
      'rowsBounded', coalesce(bool_and((node ->> 'Actual Rows')::numeric <= 1) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_open_track_key'
      ), false),
      'loopsOne', coalesce(bool_and((node ->> 'Actual Loops')::numeric = 1) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_open_track_key'
      ), false),
      'blocksBounded', coalesce(bool_and(
        coalesce((node ->> 'Shared Hit Blocks')::integer, 0)
          + coalesce((node ->> 'Shared Read Blocks')::integer, 0) <= 32
      ) filter (
        where node ->> 'Index Name' = 'ops_registration_observations_open_track_key'
      ), false)
    )
    from registration_observation_read_plans stored
    cross join lateral pg_temp.registration_observation_plan_nodes(stored.plan) node
    where stored.name = 'summary-20k'
  ),
  '{"blocksBounded":true,"historySeqOrAggregate":0,"loopsOne":true,"rowsBounded":true}'::jsonb,
  '20k summary preserves the same no-history one-row one-loop 32-block bound'
);

select is(
  pg_catalog.jsonb_build_object(
    'runtimeVersion', (select activation_version from dashboard_private.registration_observation_runtime_settings where singleton = true),
    'domainEventCount', (select count(*) from dashboard_private.registration_observation_domain_events)
  ),
  '{"domainEventCount":0,"runtimeVersion":0}'::jsonb,
  'Task 3 reads leave runtime zero and provider-independent outbox delta zero'
);

rollback;
