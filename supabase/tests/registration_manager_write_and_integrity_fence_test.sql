begin;

select no_plan();

set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local role postgres;

select ok(
  (
    select pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any(
        array['search_path=', 'search_path=""']::text[]
      )
      and not pg_catalog.has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and pg_catalog.pg_get_functiondef(procedure.oid) not like '%40001%'
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.enforce_registration_manager_write_fence_v1()'::regprocedure
  ),
  'the registration write fence is postgres-owned, private, and non-retryable'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger trigger
    where trigger.tgname = 'enforce_registration_manager_write_fence_v1'
      and trigger.tgfoid =
        'dashboard_private.enforce_registration_manager_write_fence_v1()'::regprocedure
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 31
  ),
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and (
        relation.relname = 'ops_tasks'
        or pg_catalog.substr(relation.relname, 1, 17) = 'ops_registration_'
      )
  ),
  'every registration table plus the registration task row has the all-write fence'
);

select ok(
  (
    select pg_catalog.strpos(definition, 'assert_registration_task_replay_access_v1') > 0
      and pg_catalog.strpos(definition, 'assert_registration_task_replay_access_v1')
        < pg_catalog.strpos(definition, 'add_ops_task_comment_v2_impl')
    from (
      select pg_catalog.pg_get_functiondef(
        'public.add_ops_task_comment_v2(uuid,text,uuid)'::regprocedure
      ) as definition
    ) source
  ),
  'comment authorization runs before its private receipt replay implementation'
);

select ok(
  (
    select pg_catalog.strpos(definition, 'assert_registration_task_replay_access_v1') > 0
      and pg_catalog.strpos(definition, 'assert_registration_task_replay_access_v1')
        < pg_catalog.strpos(definition, 'record_ops_task_activity_event_v1_impl')
    from (
      select pg_catalog.pg_get_functiondef(
        'public.record_ops_task_activity_event_v1(uuid,text,text,text,text,uuid)'::regprocedure
      ) as definition
    ) source
  ),
  'activity authorization runs before its private receipt replay implementation'
);

select ok(
  (
    select pg_catalog.strpos(definition, 'assert_registration_actor_is_active_manager_v1') > 0
      and pg_catalog.strpos(definition, 'assert_registration_actor_is_active_manager_v1')
        < pg_catalog.strpos(definition, 'delete_registration_case_v1_impl')
    from (
      select pg_catalog.pg_get_functiondef(
        'public.delete_registration_case_v1(uuid,uuid)'::regprocedure
      ) as definition
    ) source
  ),
  'registration delete authorization runs before its private receipt replay implementation'
);

select ok(
  (
    select pg_catalog.strpos(definition, 'assert_registration_actor_is_active_manager_v1') > 0
      and pg_catalog.strpos(definition, 'assert_registration_actor_is_active_manager_v1')
        < pg_catalog.strpos(definition, 'from public.ops_registration_consultations')
      and definition not like '%save_registration_consultation_result_v2_base%'
      and definition like '%dashboard_private.record_registration_fact_audit_v1%'
    from (
      select pg_catalog.pg_get_functiondef(
        'public.save_registration_consultation_result_v2(uuid,text,text,text,uuid,integer,text)'::regprocedure
      ) as definition
    ) source
  ),
  'consultation-result authorization runs before the direct fact-table implementation'
);

select ok(
  (
    select pg_catalog.strpos(definition, 'assert_registration_actor_is_active_manager_v1') > 0
      and pg_catalog.strpos(definition, 'assert_registration_actor_is_active_manager_v1')
        < pg_catalog.strpos(
          definition,
          'get_registration_core_legacy_dispatch_plan_v1_base'
        )
    from (
      select pg_catalog.pg_get_functiondef(
        'public.get_registration_core_legacy_dispatch_plan_v1(uuid,uuid)'::regprocedure
      ) as definition
    ) source
  ),
  'the service-role registration plan authorizes an active manager before reading the base plan'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(procedure.oid) like '%23514%'
      and pg_catalog.pg_get_functiondef(procedure.oid) not like '%40001%'
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.assert_registration_appointment_integrity_v1(uuid)'::regprocedure
  ),
  'the final appointment domain conflict is exact non-retryable SQLSTATE 23514'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(procedure.oid)
        like '%new.pipeline_status is not distinct from old.pipeline_status%'
      and pg_catalog.pg_get_functiondef(procedure.oid) like '%tg_op = ''UPDATE''%'
      and pg_catalog.pg_get_functiondef(procedure.oid) like '%coalesce(new.id, old.id)%'
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.assert_registration_appointment_integrity_from_track_v1()'::regprocedure
  ),
  'the track integrity trigger skips unrelated updates and retains delete coverage'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, banned_until, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '99300000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-fence-admin@example.invalid',
    crypt('registration-fence-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-manager-fence"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-fence-staff@example.invalid',
    crypt('registration-fence-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-manager-fence"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-fence-teacher@example.invalid',
    crypt('registration-fence-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-manager-fence"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-fence-banned@example.invalid',
    crypt('registration-fence-runtime-only', gen_salt('bf')),
    pg_catalog.now(), pg_catalog.now() + interval '1 day',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-manager-fence"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '99300000-0000-4000-8000-000000000001', 'admin', '등록 펜스 원장',
    'registration-fence-admin@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000002', 'staff', '등록 펜스 관리팀',
    'registration-fence-staff@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000003', 'teacher', '등록 펜스 교사',
    'registration-fence-teacher@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000004', 'staff', '등록 펜스 정지직원',
    'registration-fence-banned@example.invalid', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

select pg_catalog.set_config('request.jwt.claims', '{}'::jsonb::text, true);
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claim.role', '', true);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id
)
values
  (
    '99310000-0000-4000-8000-000000000001',
    '등록 manager fence', 'registration', 'requested', 'normal',
    '99300000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000002'
  ),
  (
    '99310000-0000-4000-8000-000000000002',
    '일반 업무 fence 비회귀', 'general', 'requested', 'normal',
    '99300000-0000-4000-8000-000000000003',
    '99300000-0000-4000-8000-000000000003'
  ),
  (
    '99310000-0000-4000-8000-000000000003',
    'appointment integrity 독립성', 'registration', 'requested', 'normal',
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000001'
  );

insert into public.ops_registration_details(task_id, common_revision)
values
  ('99310000-0000-4000-8000-000000000001', 1),
  ('99310000-0000-4000-8000-000000000003', 1);

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status
)
values
  (
    '99320000-0000-4000-8000-000000000001',
    '99310000-0000-4000-8000-000000000001',
    '영어', 'inquiry'
  ),
  (
    '99320000-0000-4000-8000-000000000002',
    '99310000-0000-4000-8000-000000000003',
    '수학', 'inquiry'
  );

insert into public.ops_task_events(
  id, task_id, actor_id, event_type, field_name, after_value
)
values
  (
    '99330000-0000-4000-8000-000000000001',
    '99310000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000002',
    'registration_case_created', 'task_id',
    '99310000-0000-4000-8000-000000000001'
  ),
  (
    '99330000-0000-4000-8000-000000000002',
    '99310000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000003',
    'updated', 'memo', '일반 업무'
  );

create or replace function pg_temp.registration_fence_set_actor(p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (
        select profile.email from public.profiles profile where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.registration_fence_security_definer_track_write(
  p_track_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ops_registration_subject_tracks track
  set updated_at = pg_catalog.clock_timestamp()
  where track.id = p_track_id;
$$;

create or replace function pg_temp.registration_fence_security_definer_task_write(
  p_task_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ops_tasks task
  set memo = 'security-definer-write'
  where task.id = p_task_id;
$$;

set local role authenticated;
select pg_temp.registration_fence_set_actor(
  '99300000-0000-4000-8000-000000000003'
);

select throws_ok(
  $$
    select pg_temp.registration_fence_security_definer_track_write(
      '99320000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'registration_manager_write_access_denied',
  'an active teacher cannot bypass the registration table fence through SECURITY DEFINER'
);

select lives_ok(
  $$
    select pg_temp.registration_fence_security_definer_task_write(
      '99310000-0000-4000-8000-000000000002'
    )
  $$,
  'the same teacher security-definer write remains available for a non-registration task'
);

select throws_ok(
  $$
    select public.save_registration_consultation_result_v2(
      '99340000-0000-4000-8000-000000000001',
      'undecided', null, null, null, 1, 'teacher-direct-consultation-result'
    )
  $$,
  '42501',
  'registration_access_denied',
  'a teacher direct call is denied before the legacy consultation-result base executes'
);

select throws_ok(
  $$
    select public.list_registration_legacy_source_ids_v1(
      '99310000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'registration_legacy_source_access_denied',
  'registration legacy source listing is manager-only'
);

select throws_ok(
  $$
    select public.authorize_registration_legacy_dispatch_v1(
      '99330000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'registration_legacy_dispatch_access_denied',
  'the authenticated registration dispatch preflight denies a teacher'
);

select is(
  public.authorize_registration_legacy_dispatch_v1(
    '99330000-0000-4000-8000-000000000002'
  ),
  false,
  'the registration preflight leaves non-registration dispatch authorization unchanged'
);

reset role;
select pg_temp.registration_fence_set_actor(
  '99300000-0000-4000-8000-000000000002'
);
set local role authenticated;

select lives_ok(
  $$
    select public.add_ops_task_comment_v2(
      '99310000-0000-4000-8000-000000000001',
      'manager receipt seed',
      '99350000-0000-4000-8000-000000000001'
    )
  $$,
  'an active staff account can create the registration comment receipt'
);

select lives_ok(
  $$
    select public.record_ops_task_activity_event_v1(
      '99310000-0000-4000-8000-000000000001',
      'manual_checked', 'receipt-test', null, 'checked',
      '99350000-0000-4000-8000-000000000002'
    )
  $$,
  'an active staff account can create the registration activity receipt'
);

reset role;
update public.profiles profile
set role = 'teacher', updated_at = pg_catalog.clock_timestamp()
where profile.id = '99300000-0000-4000-8000-000000000002';
select pg_temp.registration_fence_set_actor(
  '99300000-0000-4000-8000-000000000002'
);
set local role authenticated;

select throws_ok(
  $$
    select public.add_ops_task_comment_v2(
      '99310000-0000-4000-8000-000000000001',
      'manager receipt seed',
      '99350000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'registration_access_denied',
  'a role-changed teacher cannot receive a stored registration comment response'
);

reset role;
update public.profiles profile
set role = 'staff', updated_at = pg_catalog.clock_timestamp()
where profile.id = '99300000-0000-4000-8000-000000000002';
update auth.users account
set banned_until = pg_catalog.now() + interval '1 day',
    updated_at = pg_catalog.clock_timestamp()
where account.id = '99300000-0000-4000-8000-000000000002';
select pg_temp.registration_fence_set_actor(
  '99300000-0000-4000-8000-000000000002'
);
set local role authenticated;

select throws_ok(
  $$
    select public.record_ops_task_activity_event_v1(
      '99310000-0000-4000-8000-000000000001',
      'manual_checked', 'receipt-test', null, 'checked',
      '99350000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'registration_access_denied',
  'a banned staff account cannot receive a stored registration activity response'
);

reset role;
insert into dashboard_private.notification_request_ledger(
  request_id, request_kind, request_fingerprint, response_payload
)
values (
  '99350000-0000-4000-8000-000000000003',
  'delete_registration_case_v1',
  pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', '99300000-0000-4000-8000-000000000004'::uuid,
    'task_id', '99310000-0000-4000-8000-000000000001'::uuid
  )::text),
  pg_catalog.jsonb_build_object(
    'taskId', '99310000-0000-4000-8000-000000000001'::uuid,
    'deleted', true
  )
);
select pg_temp.registration_fence_set_actor(
  '99300000-0000-4000-8000-000000000004'
);
set local role authenticated;

select throws_ok(
  $$
    select public.delete_registration_case_v1(
      '99310000-0000-4000-8000-000000000001',
      '99350000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  'registration_access_denied',
  'a banned account cannot replay a stored registration delete response'
);

reset role;
set local role service_role;
select throws_ok(
  $$
    select public.get_registration_core_legacy_dispatch_plan_v1(
      '99330000-0000-4000-8000-000000000001',
      '99300000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  'registration_access_denied',
  'the service-role plan rejects a teacher actor before reading registration data'
);
select throws_ok(
  $$
    select public.get_registration_core_legacy_dispatch_plan_v1(
      '99330000-0000-4000-8000-000000000001',
      '99300000-0000-4000-8000-000000000004'
    )
  $$,
  '42501',
  'registration_access_denied',
  'the service-role plan rejects a banned staff actor before reading registration data'
);

reset role;
select pg_catalog.set_config('request.jwt.claims', '{}'::jsonb::text, true);
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claim.role', '', true);

select lives_ok(
  $$
    update public.ops_registration_subject_tracks track
    set updated_at = pg_catalog.clock_timestamp()
    where track.id = '99320000-0000-4000-8000-000000000001'
  $$,
  'a null-actor internal registration writer remains available'
);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, created_by
)
values (
  '99360000-0000-4000-8000-000000000001',
  '99310000-0000-4000-8000-000000000003',
  'level_test', pg_catalog.now() + interval '1 day', '본관', 'canceled',
  '99300000-0000-4000-8000-000000000001'
);

insert into public.ops_registration_level_tests(
  id, track_id, appointment_id, attempt_number, status, completed_at
)
values (
  '99370000-0000-4000-8000-000000000001',
  '99320000-0000-4000-8000-000000000002',
  '99360000-0000-4000-8000-000000000001',
  1, 'canceled', pg_catalog.now()
);

set constraints all immediate;
set constraints all deferred;
alter table public.ops_registration_appointments
  disable trigger registration_appointment_integrity_on_appointment;
update public.ops_registration_appointments appointment
set status = 'scheduled'
where appointment.id = '99360000-0000-4000-8000-000000000001';
alter table public.ops_registration_appointments
  enable trigger registration_appointment_integrity_on_appointment;

select lives_ok(
  $$
    update public.ops_registration_subject_tracks track
    set updated_at = track.updated_at + interval '1 second'
    where track.id = '99320000-0000-4000-8000-000000000002';
    set constraints registration_appointment_integrity_on_track immediate;
  $$,
  'updated_at-only track storage is independent from appointment integrity'
);

select lives_ok(
  $$
    update public.ops_registration_subject_tracks track
    set workflow_status = 'inquiry_only',
        workflow_revision = track.workflow_revision + 1,
        workflow_status_entered_at = pg_catalog.clock_timestamp()
    where track.id = '99320000-0000-4000-8000-000000000002';
    set constraints registration_appointment_integrity_on_track immediate;
  $$,
  'status-property storage is independent from appointment integrity'
);

select lives_ok(
  $$
    update public.ops_registration_subject_tracks track
    set archived_at = pg_catalog.clock_timestamp(),
        archived_by = '99300000-0000-4000-8000-000000000001'
    where track.id = '99320000-0000-4000-8000-000000000002';
    set constraints registration_appointment_integrity_on_track immediate;
  $$,
  'subject archive storage is independent from appointment integrity'
);

select throws_ok(
  $$
    select dashboard_private.assert_registration_appointment_integrity_v1(
      '99360000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'registration_invalid_source_state',
  'an actual deterministic appointment conflict is SQLSTATE 23514'
);

select throws_ok(
  $$
    update public.ops_registration_subject_tracks track
    set pipeline_status = 'migration_review',
        migration_review_required = true
    where track.id = '99320000-0000-4000-8000-000000000002'
  $$,
  '23514',
  'registration_invalid_source_state',
  'an actual pipeline_status change still invokes appointment integrity'
);

select * from finish();
rollback;
