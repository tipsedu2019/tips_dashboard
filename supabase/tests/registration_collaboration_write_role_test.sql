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
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
      and pg_catalog.pg_get_functiondef(procedure.oid) not like '%40001%'
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.enforce_registration_collaboration_write_role_v1()'::regprocedure
  ),
  'registration collaboration write guard is postgres-owned, private, and non-retryable'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger trigger
    where trigger.tgname = 'enforce_registration_collaboration_write_role_v1'
      and trigger.tgrelid in (
        'public.ops_task_comments'::regclass,
        'public.ops_task_attachments'::regclass,
        'public.ops_task_events'::regclass
      )
      and trigger.tgfoid =
        'dashboard_private.enforce_registration_collaboration_write_role_v1()'::regprocedure
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
  ),
  3::bigint,
  'comments, attachments, and events all enforce the same registration write role'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_trigger trigger
    where trigger.tgname = 'enforce_registration_collaboration_write_role_v1'
      and trigger.tgrelid in (
        'public.ops_task_comments'::regclass,
        'public.ops_task_attachments'::regclass,
        'public.ops_task_events'::regclass
      )
      and trigger.tgtype <> 31
  ),
  'the guard also covers future update and delete paths'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and (
        (policy.tablename = 'ops_task_comments'
          and policy.policyname = 'ops_task_comments_write')
        or (policy.tablename = 'ops_task_attachments'
          and policy.policyname = 'ops_task_attachments_write')
        or (policy.tablename = 'ops_task_events'
          and policy.policyname = 'ops_task_events_write')
      )
      and policy.roles = array['authenticated']::name[]
      and policy.cmd = 'INSERT'
      and policy.with_check like
        '%registration_observation_current_actor_is_active_manager_v1%'
  ),
  3::bigint,
  'direct registration collaboration inserts are manager-only at RLS too'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, banned_until, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '99200000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-write-admin@example.invalid',
    crypt('registration-write-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-write-role"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99200000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-write-staff@example.invalid',
    crypt('registration-write-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-write-role"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99200000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-write-teacher@example.invalid',
    crypt('registration-write-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-write-role"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99200000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-write-banned@example.invalid',
    crypt('registration-write-runtime-only', gen_salt('bf')),
    pg_catalog.now(), pg_catalog.now() + interval '1 day',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-write-role"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '99200000-0000-4000-8000-000000000001', 'admin', '등록쓰기 원장',
    'registration-write-admin@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99200000-0000-4000-8000-000000000002', 'staff', '등록쓰기 관리팀',
    'registration-write-staff@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99200000-0000-4000-8000-000000000003', 'teacher', '등록쓰기 교사',
    'registration-write-teacher@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99200000-0000-4000-8000-000000000004', 'staff', '등록쓰기 정지직원',
    'registration-write-banned@example.invalid', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id
)
values
  (
    '99210000-0000-4000-8000-000000000001',
    '등록 협업쓰기 권한', 'registration', 'requested', 'normal',
    '99200000-0000-4000-8000-000000000003',
    '99200000-0000-4000-8000-000000000003'
  ),
  (
    '99210000-0000-4000-8000-000000000002',
    '일반 협업쓰기 유지', 'general', 'requested', 'normal',
    '99200000-0000-4000-8000-000000000003',
    '99200000-0000-4000-8000-000000000003'
  );

insert into public.ops_registration_details(task_id, common_revision)
values ('99210000-0000-4000-8000-000000000001', 1);

create or replace function pg_temp.registration_write_set_actor(p_actor uuid)
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
        select profile.email
        from public.profiles profile
        where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

set local role authenticated;
select pg_temp.registration_write_set_actor(
  '99200000-0000-4000-8000-000000000003'
);

select throws_ok(
  $$
    select public.add_ops_task_comment_v2(
      '99210000-0000-4000-8000-000000000001',
      '교사 등록 댓글 차단',
      '99220000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  null,
  'an assigned teacher cannot use the security-definer comment RPC on registration'
);

select throws_ok(
  $$
    insert into public.ops_task_attachments(
      task_id, file_name, file_kind, drive_link
    ) values (
      '99210000-0000-4000-8000-000000000001',
      'teacher-registration.txt', 'text/plain',
      'https://example.invalid/teacher-registration'
    )
  $$,
  '42501',
  null,
  'an assigned teacher cannot add a registration attachment directly'
);

select throws_ok(
  $$
    insert into public.ops_task_events(
      task_id, event_type, field_name, after_value
    ) values (
      '99210000-0000-4000-8000-000000000001',
      'updated', 'teacher-bypass', 'blocked'
    )
  $$,
  '42501',
  null,
  'an assigned teacher cannot add a registration event directly'
);

insert into public.ops_task_comments(task_id, body)
values (
  '99210000-0000-4000-8000-000000000002',
  '일반 업무 협업은 유지'
);

select pg_temp.registration_write_set_actor(
  '99200000-0000-4000-8000-000000000004'
);

select throws_ok(
  $$
    select public.add_ops_task_comment_v2(
      '99210000-0000-4000-8000-000000000001',
      '정지직원 등록 댓글 차단',
      '99220000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  null,
  'a banned staff account cannot write registration collaboration data'
);

select pg_temp.registration_write_set_actor(
  '99200000-0000-4000-8000-000000000001'
);

insert into public.ops_task_attachments(
  task_id, file_name, file_kind, drive_link
) values (
  '99210000-0000-4000-8000-000000000001',
  'admin-registration.txt', 'text/plain',
  'https://example.invalid/admin-registration'
);

select pg_temp.registration_write_set_actor(
  '99200000-0000-4000-8000-000000000002'
);

insert into public.ops_task_events(
  task_id, event_type, field_name, after_value
) values (
  '99210000-0000-4000-8000-000000000001',
  'updated', 'staff-write', 'allowed'
);

select public.add_ops_task_comment_v2(
  '99210000-0000-4000-8000-000000000001',
  '관리팀 등록 댓글 허용',
  '99220000-0000-4000-8000-000000000003'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.ops_task_comments comment_row
    where comment_row.task_id = '99210000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'only the management-team registration comment was stored'
);

select is(
  (
    select pg_catalog.count(*)
    from public.ops_task_attachments attachment
    where attachment.task_id = '99210000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'only the director registration attachment was stored'
);

select is(
  (
    select pg_catalog.count(*)
    from public.ops_task_events event_row
    where event_row.task_id = '99210000-0000-4000-8000-000000000001'
      and event_row.field_name in ('teacher-bypass', 'staff-write')
  ),
  1::bigint,
  'only the management-team direct registration event was stored'
);

select ok(
  exists (
    select 1
    from public.ops_task_comments comment_row
    where comment_row.task_id = '99210000-0000-4000-8000-000000000002'
      and comment_row.body = '일반 업무 협업은 유지'
  ),
  'non-registration collaboration remains unchanged'
);

select * from finish();
rollback;
