begin;
select plan(61);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
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
  '{"summaryScalar":true,"stateMissingLegacyCampus":true}'::jsonb,
  'readiness reports missing summary scalar and state-missing selectable legacy campus'
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

select * from finish();
rollback;
