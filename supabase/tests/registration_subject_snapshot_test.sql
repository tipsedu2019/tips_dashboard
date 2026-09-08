begin;
set local search_path = extensions, public;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
select no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  email, crypt('subject-snapshot-fixture-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values
  ('99600000-0000-4000-8000-000000000001'::uuid, 'q06-admin@example.invalid'),
  ('99600000-0000-4000-8000-000000000002'::uuid, 'q06-staff@example.invalid'),
  ('99600000-0000-4000-8000-000000000003'::uuid, 'q06-teacher@example.invalid')
) fixture(id, email);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('99600000-0000-4000-8000-000000000001', 'admin', '과목 충돌 원장', 'q06-admin@example.invalid', now(), now()),
  ('99600000-0000-4000-8000-000000000002', 'staff', '과목 충돌 관리팀', 'q06-staff@example.invalid', now(), now()),
  ('99600000-0000-4000-8000-000000000003', 'teacher', '과목 충돌 강사', 'q06-teacher@example.invalid', now(), now())
on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email;

insert into public.ops_tasks(id, title, type, status, requested_by, student_name, subject, campus, priority)
values ('99600000-0000-4000-8000-000000000101', '등록: 과목 동시 수정', 'registration', 'in_progress',
  '99600000-0000-4000-8000-000000000001', '과목 동시 수정', '영어', '본관', 'normal');
insert into public.ops_registration_details(task_id, inquiry_at, school_grade, parent_phone, common_revision)
values ('99600000-0000-4000-8000-000000000101', '2026-09-07 18:00+09', '중2', '01000000000', 1);
insert into public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status, workflow_status, workflow_revision, migration_review_required)
values ('99600000-0000-4000-8000-000000000201', '99600000-0000-4000-8000-000000000101', '영어', 'inquiry', 'inquiry', 1, false);

create temporary table q06_response(result jsonb, event_count bigint);
grant all on q06_response to authenticated;
create temporary table q06_delivery_before as select
  (select count(*) from dashboard_private.notification_deliveries) as deliveries,
  (select count(*) from dashboard_private.registration_customer_reminder_jobs) as reminders,
  (select count(*) from dashboard_private.registration_observation_chat_jobs) as observation_jobs;

select ok((select procedure.prosecdef and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
  and procedure.proconfig = array['search_path=""']::text[]
  from pg_catalog.pg_proc procedure where procedure.oid =
  'dashboard_private.sync_registration_case_subjects_v2_impl(uuid,text[],text[],text)'::regprocedure),
  'the subject guard is postgres-owned with an empty search path');
select ok(pg_catalog.has_function_privilege('authenticated',
  'public.sync_registration_case_subjects_v2(uuid,text[],text[],text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon',
  'public.sync_registration_case_subjects_v2(uuid,text[],text[],text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role',
  'public.sync_registration_case_subjects_v2(uuid,text[],text[],text)', 'EXECUTE'),
  'the new wrapper retains the authenticated-only API boundary');

set local role authenticated;
select set_config('request.jwt.claim.sub', '99600000-0000-4000-8000-000000000001', true);
select lives_ok($$
  insert into q06_response(result) select public.sync_registration_case_subjects_v2(
    '99600000-0000-4000-8000-000000000101', array['영어','수학'], array['영어'], 'q06-manager-a')
$$, 'manager A adds math from the English-only snapshot');
update q06_response set event_count = (select count(*) from public.ops_task_events
  where task_id = '99600000-0000-4000-8000-000000000101');
select is(public.sync_registration_case_subjects_v2(
  '99600000-0000-4000-8000-000000000101', array[' 수학 ','영어','영어'], array['영어'], 'q06-manager-a'),
  (select result from q06_response), 'a lost response replays despite the now-stale snapshot and normalized ordering');
select is((select count(*) from public.ops_task_events where task_id = '99600000-0000-4000-8000-000000000101'),
  (select event_count from q06_response), 'a replay does not add another audit or mutation');
select throws_ok($$
  select public.sync_registration_case_subjects_v2(
    '99600000-0000-4000-8000-000000000101', array['영어','수학'], array['영어','수학'], 'q06-manager-a')
$$, '22023', 'idempotency_key_reused', 'a reused request key cannot change its expected snapshot');

select set_config('request.jwt.claim.sub', '99600000-0000-4000-8000-000000000002', true);
select throws_ok($$
  select public.sync_registration_case_subjects_v2(
    '99600000-0000-4000-8000-000000000101', array['영어'], array['영어'], 'q06-manager-b-stale')
$$, '23514', 'registration_subjects_conflict', 'manager B cannot archive the subject added after opening the inquiry');

reset role;
select is((select count(*)::integer from public.ops_registration_subject_tracks
  where task_id = '99600000-0000-4000-8000-000000000101' and subject = '수학' and archived_at is null),
  1, 'the first manager math subject remains active after the stale save');
select is((select count(*)::integer from dashboard_private.ops_registration_mutations
  where request_key = 'q06-manager-b-stale'), 0, 'rejected stale input creates no completed receipt');

set local role authenticated;
select lives_ok($$
  select public.sync_registration_case_subjects_v2(
    '99600000-0000-4000-8000-000000000101', array['수학'], array['영어','수학'], 'q06-manager-b-fresh')
$$, 'the second manager can explicitly save after refreshing the subject list');
select set_config('request.jwt.claim.sub', '99600000-0000-4000-8000-000000000001', true);
select is(public.sync_registration_case_subjects_v2(
  '99600000-0000-4000-8000-000000000101', array['영어','수학'], array['영어'], 'q06-manager-a'),
  (select result from q06_response), 'an old completed request still returns its original receipt');
reset role;
select is((select count(*)::integer from public.ops_registration_subject_tracks
  where id = '99600000-0000-4000-8000-000000000201' and archived_at is not null),
  1, 'replaying an old request does not restore a subsequently archived subject');
select is((select common_revision from public.ops_registration_details
  where task_id = '99600000-0000-4000-8000-000000000101'), 1, 'subject changes do not change common facts');
select is((select workflow_revision from public.ops_registration_subject_tracks
  where id = '99600000-0000-4000-8000-000000000201'), 1, 'subject changes do not advance workflow status');
select is((select count(*)::integer from public.ops_registration_appointments
  where task_id = '99600000-0000-4000-8000-000000000101'), 0, 'subject saves create no appointment');
select is((select count(*)::integer from public.ops_registration_admission_batches
  where task_id = '99600000-0000-4000-8000-000000000101'), 0, 'subject saves start no admission batch');
select results_eq($$select
  (select count(*) from dashboard_private.notification_deliveries),
  (select count(*) from dashboard_private.registration_customer_reminder_jobs),
  (select count(*) from dashboard_private.registration_observation_chat_jobs)$$,
  $$select deliveries, reminders, observation_jobs from q06_delivery_before$$,
  'subject changes and rejected/replayed requests create no delivery or automatic reminder job');

set local role authenticated;
select set_config('request.jwt.claim.sub', '99600000-0000-4000-8000-000000000003', true);
select throws_ok($$
  select public.sync_registration_case_subjects_v2(
    '99600000-0000-4000-8000-000000000101', array['영어'], array['수학'], 'q06-teacher')
$$, '42501', null, 'a teacher cannot change subjects');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$
  select public.sync_registration_case_subjects_v2(
    '99600000-0000-4000-8000-000000000101', array['영어'], array['수학'], 'q06-no-actor')
$$, '42501', 'registration_access_denied', 'a missing user cannot change subjects');
select set_config('request.jwt.claim.sub', '99600000-0000-4000-8000-000000000001', true);
select throws_ok($$
  select public.sync_registration_case_subjects_v2(
    '99600000-0000-4000-8000-000000000101', array['영어'], null, 'q06-no-snapshot')
$$, '22023', 'registration_subject_snapshot_required', 'the snapshot cannot be omitted');
select lives_ok($$
  select public.sync_registration_case_subjects_v2(
    '99600000-0000-4000-8000-000000000101', array[]::text[], array['수학'], 'q06-empty')
$$, 'an explicit empty subject list remains supported');
select lives_ok($$
  select public.sync_registration_case_subjects_v2(
    '99600000-0000-4000-8000-000000000101', array['영어'], array[]::text[], 'q06-restore')
$$, 'archived subjects can be restored from a fresh empty snapshot');
reset role;
select is((select count(*)::integer from public.ops_registration_subject_tracks
  where id = '99600000-0000-4000-8000-000000000201' and archived_at is null),
  1, 'restoring a subject preserves its original track identity and history');
select * from finish();
rollback;
