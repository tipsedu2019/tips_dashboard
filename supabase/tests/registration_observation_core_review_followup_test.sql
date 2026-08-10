begin;
select plan(2);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  deleted_at, banned_until, created_at, updated_at
)
values
  ('99020000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'followup-admin@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', null, null, now(), now()),
  ('99020000-0000-4000-8000-000000000002', '00000000-0000-0000-8000-000000000000', 'authenticated', 'authenticated', 'followup-snake-teacher@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', null, null, now(), now()),
  ('99020000-0000-4000-8000-000000000003', '00000000-0000-0000-8000-000000000000', 'authenticated', 'authenticated', 'followup-slot-teacher@example.invalid', crypt('review-only', gen_salt('bf')), now(), '{}', '{}', null, null, now(), now());

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('99020000-0000-4000-8000-000000000001', 'admin', '후속 관리자', 'followup-admin@example.invalid', now(), now()),
  ('99020000-0000-4000-8000-000000000002', 'teacher', '스네이크 권위 강사', 'followup-snake-teacher@example.invalid', now(), now()),
  ('99020000-0000-4000-8000-000000000003', 'teacher', '슬롯 대체 강사', 'followup-slot-teacher@example.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id in (
  '99020000-0000-4000-8000-000000000002',
  '99020000-0000-4000-8000-000000000003'
);

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role
)
values
  ('99020000-0000-4000-8000-000000000101', '스네이크 권위 강사', array['영어']::text[], true, 9902, '99020000-0000-4000-8000-000000000002', 'followup-snake-teacher@example.invalid', 'teacher'),
  ('99020000-0000-4000-8000-000000000103', '슬롯 대체 강사', array['영어']::text[], true, 9903, '99020000-0000-4000-8000-000000000003', 'followup-slot-teacher@example.invalid', 'teacher');

insert into public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)
values
  ('99020000-0000-4000-8000-000000000102', '스네이크 권위실', array['영어']::text[], true, 9902, '본관'),
  ('99020000-0000-4000-8000-000000000104', '슬롯 대체실', array['영어']::text[], true, 9903, '별관');

do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '99020000-0000-4000-8000-000000000200',
    '99020000-0000-4000-8000-000000000001',
    'registration_observation_core_review_followup_fixture'
  );
end;
$$;

insert into public.classes(id, name, subject, status, schedule_storage_mode, schedule_plan)
values (
  '99020000-0000-4000-8000-000000000200',
  '후속 별칭 우선순위반',
  '영어',
  '수업 진행 중',
  'legacy',
  pg_catalog.jsonb_build_object(
    'textbooks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'textbookId', '99020000-0000-4000-8000-000000000300',
      'title', '후속 별칭 교재'
    )),
    'sessions', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sessionKey', 'blank-camel-valid-snake',
      'date', pg_catalog.to_char(current_date + 14, 'YYYY-MM-DD'),
      'scheduleState', 'normal',
      'teacherCatalogId', '   ',
      'teacher_catalog_id', '99020000-0000-4000-8000-000000000101',
      'classroomCatalogId', '',
      'classroom_catalog_id', '99020000-0000-4000-8000-000000000102',
      'textbookEntries', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'textbookId', '99020000-0000-4000-8000-000000000300',
        'plan', pg_catalog.jsonb_build_object('label', '별칭 단원', 'memo', '별칭 복습')
      )),
      'publicNote', '별칭 진도'
    ))
  )
);

insert into public.class_schedule_slots(
  id, class_id, weekday, start_time, end_time,
  teacher_catalog_id, teacher_name, classroom_catalog_id, classroom_name, sort_order
)
values (
  '99020000-0000-4000-8000-000000000205',
  '99020000-0000-4000-8000-000000000200',
  extract(dow from current_date + 14)::smallint,
  '18:00'::time,
  '20:00'::time,
  '99020000-0000-4000-8000-000000000103',
  '슬롯 대체 강사',
  '99020000-0000-4000-8000-000000000104',
  '슬롯 대체실',
  1
);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, secondary_assignee_id, student_name
)
values (
  '99020000-0000-4000-8000-000000000201', '후속 별칭 우선순위', 'registration',
  'requested', 'normal', '99020000-0000-4000-8000-000000000001',
  '99020000-0000-4000-8000-000000000001', '후속 테스트 학생'
);

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required,
  workflow_status, workflow_revision, workflow_status_entered_at,
  observation_return_workflow_status, observation_attempt_count
)
values (
  '99020000-0000-4000-8000-000000000202',
  '99020000-0000-4000-8000-000000000201',
  '영어', 'consultation_waiting', '99020000-0000-4000-8000-000000000001',
  'manual', now(), false, 'observation_requested', 1, now(), 'consultation_completed', 0
);

create or replace function pg_temp.followup_set_actor(p_actor uuid)
returns void language plpgsql as $$
begin
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.followup_session_list()
returns jsonb language plpgsql security invoker as $$
declare v_result jsonb;
begin
  perform pg_temp.followup_set_actor('99020000-0000-4000-8000-000000000001');
  execute 'set local role authenticated';
  select public.list_registration_observation_sessions_v1(
    '99020000-0000-4000-8000-000000000202',
    '99020000-0000-4000-8000-000000000200',
    current_date + 14,
    current_date + 14
  ) into v_result;
  execute 'reset role';
  return v_result;
exception when others then execute 'reset role'; raise;
end;
$$;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'stable', function_row.provolatile = 's',
      'securityDefiner', function_row.prosecdef,
      'owner', pg_catalog.pg_get_userbyid(function_row.proowner),
      'emptySearchPath', exists (
        select 1
        from pg_catalog.unnest(coalesce(function_row.proconfig, '{}'::text[])) config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      ),
      'authenticated', pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE'),
      'anon', pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE'),
      'serviceRole', pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE')
    )
    from pg_catalog.pg_proc function_row
    where function_row.oid = pg_catalog.to_regprocedure(
      'dashboard_private.list_registration_observation_sessions_v1_impl(uuid,uuid,date,date)'
    )
  ),
  '{"anon":false,"authenticated":true,"emptySearchPath":true,"owner":"postgres","securityDefiner":true,"serviceRole":false,"stable":true}'::jsonb,
  'private list keeps its frozen security owner and ACL contract'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'teacherCatalogId', actual -> 'teacherCatalogId',
      'teacherProfileId', actual -> 'teacherProfileId',
      'teacherName', actual -> 'teacherName',
      'classroomCatalogId', actual -> 'classroomCatalogId',
      'classroomName', actual -> 'classroomName',
      'campus', actual -> 'campus',
      'legacySessionSourceHash', actual -> 'legacySessionSourceHash',
      'sourceRevision', actual -> 'sourceRevision',
      'bookingFactHash', actual -> 'bookingFactHash'
    )
    from pg_catalog.jsonb_array_elements(pg_temp.followup_session_list()) actual
    where actual ->> 'sessionKey' = 'blank-camel-valid-snake'
  ),
  (
    select pg_catalog.jsonb_build_object(
      'teacherCatalogId', expected -> 'teacherCatalogId',
      'teacherProfileId', expected -> 'teacherProfileId',
      'teacherName', expected -> 'teacherName',
      'classroomCatalogId', expected -> 'classroomCatalogId',
      'classroomName', expected -> 'classroomName',
      'campus', expected -> 'campus',
      'legacySessionSourceHash', expected -> 'legacySessionSourceHash',
      'sourceRevision', expected -> 'sourceRevision',
      'bookingFactHash', expected -> 'bookingFactHash'
    )
    from (
      select dashboard_private.resolve_registration_observation_session_v1(
        '99020000-0000-4000-8000-000000000202',
        '99020000-0000-4000-8000-000000000200',
        'legacy',
        null,
        'blank-camel-valid-snake'
      ) expected
    ) frozen
  ),
  'blank camelCase catalog IDs fall through to authoritative snake_case IDs names and hashes'
);

select * from finish();
rollback;
