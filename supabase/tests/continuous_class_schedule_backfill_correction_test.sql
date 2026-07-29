begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '87000000-0000-4000-8000-000000000001',
  'admin',
  '연속일정 보정 관리자',
  'continuous-schedule-backfill@test.invalid',
  now(),
  now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '87000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'email', 'continuous-schedule-backfill@test.invalid'
  )::text,
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '87000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_plan
)
values (
  '87000000-0000-4000-8000-000000000301',
  '연속일정 보정 수업',
  '정규',
  '영어',
  '고1',
  '테스트 선생님',
  '월 09:00-10:00',
  '본관 1강',
  12,
  100000,
  '수업 진행 중',
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_object(
    'textbooks', jsonb_build_array(jsonb_build_object('id', 'book-1')),
    'sessions', jsonb_build_array(jsonb_build_object(
      'id', 'legacy-session-1',
      'date', '2026-08-03',
      'scheduleState', 'active',
      'memo', '기존 메모',
      'billingId', 'period-august',
      'billingLabel', '8월',
      'billingColor', '#3182f6',
      'textbookEntries', jsonb_build_array(jsonb_build_object('id', 'entry-1'))
    ))
  )
);

create temporary table continuous_schedule_backfill_fixture as
select
  dashboard_private.continuous_class_schedule_backfill_source_hash_v1(classes) as source_hash,
  dashboard_private.continuous_class_schedule_hash_v1(schedule_plan) as source_plan_hash
from public.classes
where id = '87000000-0000-4000-8000-000000000301';

select throws_ok(
  $$
    select public.backfill_class_schedule_shadow_v1(
      '87000000-0000-4000-8000-000000000301',
      (select source_hash from continuous_schedule_backfill_fixture),
      '[]'::jsonb,
      '[{"unexpected":true}]'::jsonb,
      '87000000-0000-4000-8000-000000000401'
    )
  $$,
  '22023',
  'class_schedule_validation',
  'malformed backfill rows are rejected before shadow mutation'
);

create temporary table continuous_schedule_backfill_result as
select public.backfill_class_schedule_shadow_v1(
  '87000000-0000-4000-8000-000000000301',
  (select source_hash from continuous_schedule_backfill_fixture),
  jsonb_build_array(jsonb_build_object(
    'classId', '87000000-0000-4000-8000-000000000301',
    'weekday', 1,
    'startTime', '09:00',
    'endTime', '10:00',
    'teacherCatalogId', null,
    'teacherName', '테스트 선생님',
    'classroomCatalogId', null,
    'classroomName', '본관 1강',
    'sortOrder', 0
  )),
  jsonb_build_array(jsonb_build_object(
    'classId', '87000000-0000-4000-8000-000000000301',
    'sessionKey', 'legacy-session-1',
    'sessionDate', '2026-08-03',
    'scheduleState', 'active',
    'startTime', null,
    'endTime', null,
    'teacherCatalogId', null,
    'teacherNameSnapshot', '',
    'classroomCatalogId', null,
    'classroomNameSnapshot', '',
    'memo', '기존 메모',
    'origin', 'legacy',
    'legacyBillingId', 'period-august',
    'legacyBillingLabel', '8월',
    'legacyBillingColor', '#3182f6'
  )),
  '87000000-0000-4000-8000-000000000402'
) as payload;

select is(
  (select payload ->> 'storageMode' from continuous_schedule_backfill_result),
  'shadow',
  'backfill reports shadow storage'
);
select is(
  (select schedule_storage_mode from public.classes
   where id = '87000000-0000-4000-8000-000000000301'),
  'shadow',
  'backfill moves only the selected class to shadow'
);
select is(
  (select count(*)::integer from public.class_schedule_slots
   where class_id = '87000000-0000-4000-8000-000000000301'),
  1,
  'backfill persists one default slot'
);
select ok(
  exists (
    select 1
    from public.class_schedule_slots
    where class_id = '87000000-0000-4000-8000-000000000301'
      and weekday = 1
      and start_time = '09:00'::time
      and end_time = '10:00'::time
      and teacher_catalog_id is null
      and teacher_name = '테스트 선생님'
      and classroom_catalog_id is null
      and classroom_name = '본관 1강'
      and sort_order = 0
  ),
  'slot tuple matches the approved payload'
);
select is(
  (select count(*)::integer from public.class_lesson_sessions
   where class_id = '87000000-0000-4000-8000-000000000301'),
  1,
  'backfill persists one legacy lesson session'
);
select ok(
  exists (
    select 1
    from public.class_lesson_sessions
    where class_id = '87000000-0000-4000-8000-000000000301'
      and session_key = 'legacy-session-1'
      and session_date = '2026-08-03'
      and schedule_state = 'active'
      and start_time is null
      and end_time is null
      and teacher_catalog_id is null
      and teacher_name_snapshot = ''
      and classroom_catalog_id is null
      and classroom_name_snapshot = ''
      and memo = '기존 메모'
      and origin = 'legacy'
      and legacy_billing_id = 'period-august'
      and legacy_billing_label = '8월'
      and legacy_billing_color = '#3182f6'
      and source_schedule_slot_id is null
      and makeup_of_session_id is null
      and public_note = ''
      and teacher_note = ''
      and revision = 0
  ),
  'legacy session tuple is exact and does not invent time or resources'
);
select is(
  dashboard_private.continuous_class_schedule_hash_v1(
    (select schedule_plan from public.classes
     where id = '87000000-0000-4000-8000-000000000301')
  ),
  (select source_plan_hash from continuous_schedule_backfill_fixture),
  'backfill does not rewrite the legacy source plan'
);
select is(
  public.continuous_class_schedule_runtime_version(),
  0,
  'backfill does not activate runtime'
);
select ok(
  exists (
    select 1
    from dashboard_private.class_schedule_cutovers
    where class_id = '87000000-0000-4000-8000-000000000301'
      and request_key = '87000000-0000-4000-8000-000000000402'
      and source_backfill_hash =
        (select source_hash from continuous_schedule_backfill_fixture)
      and source_schedule_plan_hash =
        (select source_plan_hash from continuous_schedule_backfill_fixture)
      and slot_count = 1
      and session_count = 1
      and expected_slot_rows_hash is not null
      and expected_session_rows_hash is not null
      and projected_schedule_plan_hash is not null
      and status = 'prepared'
  ),
  'cutover stores counts and exact row evidence'
);
select is(
  (select count(*)::integer
   from public.dashboard_audit_logs
   where class_id = '87000000-0000-4000-8000-000000000301'
     and request_key = '87000000-0000-4000-8000-000000000402'
     and request_operation = 'backfill_class_schedule_shadow_v1'
     and entity_table in ('class_schedule_slots', 'class_lesson_sessions')),
  2,
  'slot and session writes share the backfill audit context'
);
select ok(
  (select payload from continuous_schedule_backfill_result)
  = public.backfill_class_schedule_shadow_v1(
    '87000000-0000-4000-8000-000000000301',
    (select source_hash from continuous_schedule_backfill_fixture),
    jsonb_build_array(jsonb_build_object(
      'classId', '87000000-0000-4000-8000-000000000301',
      'weekday', 1,
      'startTime', '09:00',
      'endTime', '10:00',
      'teacherCatalogId', null,
      'teacherName', '테스트 선생님',
      'classroomCatalogId', null,
      'classroomName', '본관 1강',
      'sortOrder', 0
    )),
    jsonb_build_array(jsonb_build_object(
      'classId', '87000000-0000-4000-8000-000000000301',
      'sessionKey', 'legacy-session-1',
      'sessionDate', '2026-08-03',
      'scheduleState', 'active',
      'startTime', null,
      'endTime', null,
      'teacherCatalogId', null,
      'teacherNameSnapshot', '',
      'classroomCatalogId', null,
      'classroomNameSnapshot', '',
      'memo', '기존 메모',
      'origin', 'legacy',
      'legacyBillingId', 'period-august',
      'legacyBillingLabel', '8월',
      'legacyBillingColor', '#3182f6'
    )),
    '87000000-0000-4000-8000-000000000402'
  ),
  'same request key and body replay the original response'
);
select is(
  (select count(*)::integer
   from dashboard_private.class_schedule_cutovers
   where request_key = '87000000-0000-4000-8000-000000000402'),
  1,
  'idempotent replay creates no duplicate cutover'
);

create temporary table continuous_schedule_verify_result as
select public.verify_class_schedule_shadow_v1(
  '87000000-0000-4000-8000-000000000301',
  (select source_hash from continuous_schedule_backfill_fixture)
) as payload;

select is(
  (select (payload ->> 'matches')::boolean from continuous_schedule_verify_result),
  true,
  'verify accepts exact persisted rows'
);
select ok(
  exists (
    select 1
    from dashboard_private.class_schedule_cutovers
    where request_key = '87000000-0000-4000-8000-000000000402'
      and status = 'applied'
      and verified_at is not null
      and issue_codes = '{}'::text[]
  ),
  'successful verify records applied evidence'
);

update public.classes
set schedule = '화 09:00-10:00'
where id = '87000000-0000-4000-8000-000000000301';
select throws_ok(
  $$
    select public.verify_class_schedule_shadow_v1(
      '87000000-0000-4000-8000-000000000301',
      (select source_hash from continuous_schedule_backfill_fixture)
    )
  $$,
  '40001',
  'class_schedule_stale',
  'verify rejects a changed default schedule even when schedule_plan is unchanged'
);
update public.classes
set schedule = '월 09:00-10:00'
where id = '87000000-0000-4000-8000-000000000301';

select dashboard_private.with_continuous_class_schedule_audit_context_v1(
  '87000000-0000-4000-8000-000000000301',
  '87000000-0000-4000-8000-000000000403',
  'continuous_class_schedule_backfill_test_drift',
  'pgTAP drift fixture'
);
update public.class_lesson_sessions
set memo = 'drifted'
where class_id = '87000000-0000-4000-8000-000000000301'
  and session_key = 'legacy-session-1';

create temporary table continuous_schedule_drift_result as
select public.verify_class_schedule_shadow_v1(
  '87000000-0000-4000-8000-000000000301',
  (select source_hash from continuous_schedule_backfill_fixture)
) as payload;

select ok(
  (select not (payload ->> 'matches')::boolean
          and payload -> 'issueCodes' ? 'session_payload_mismatch'
   from continuous_schedule_drift_result),
  'verify reports exact session row drift'
);
select ok(
  exists (
    select 1
    from dashboard_private.class_schedule_cutovers
    where request_key = '87000000-0000-4000-8000-000000000402'
      and status = 'failed'
      and 'session_payload_mismatch' = any(issue_codes)
  ),
  'failed verify persists the mismatch issue code'
);

update dashboard_private.continuous_class_schedule_runtime
set version = 1,
    updated_at = now(),
    updated_by = '87000000-0000-4000-8000-000000000001'
where singleton = true;
select throws_ok(
  $$
    select public.activate_class_schedule_storage_v1(
      '87000000-0000-4000-8000-000000000301',
      0,
      (select source_hash from continuous_schedule_backfill_fixture),
      '87000000-0000-4000-8000-000000000404'
    )
  $$,
  '22023',
  'class_schedule_validation',
  'activation re-verifies current shadow rows and rejects drift'
);
select is(
  (select schedule_storage_mode from public.classes
   where id = '87000000-0000-4000-8000-000000000301'),
  'shadow',
  'failed activation leaves the class in shadow'
);
update dashboard_private.continuous_class_schedule_runtime
set version = 0,
    updated_at = now(),
    updated_by = '87000000-0000-4000-8000-000000000001'
where singleton = true;

select is(
  public.continuous_class_schedule_runtime_version(),
  0,
  'verification also leaves runtime inactive'
);

select * from finish();
rollback;
