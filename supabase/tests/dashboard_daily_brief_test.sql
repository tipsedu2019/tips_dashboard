begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_function(
  'public',
  'get_dashboard_daily_brief_v1',
  array[]::text[],
  'daily brief RPC exists'
);
select volatility_is(
  'public',
  'get_dashboard_daily_brief_v1',
  array[]::text[],
  'stable',
  'daily brief RPC is stable'
);
select ok(
  not (
    select function_row.prosecdef
    from pg_catalog.pg_proc function_row
    where function_row.oid = 'public.get_dashboard_daily_brief_v1()'::pg_catalog.regprocedure
  ),
  'daily brief RPC is security invoker'
);
select is(
  (
    select function_row.proconfig
    from pg_catalog.pg_proc function_row
    where function_row.oid = 'public.get_dashboard_daily_brief_v1()'::pg_catalog.regprocedure
  ),
  array['search_path=']::text[],
  'daily brief RPC has an empty search_path'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_dashboard_daily_brief_v1()',
    'EXECUTE'
  ),
  'authenticated can execute daily brief RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.get_dashboard_daily_brief_v1()',
    'EXECUTE'
  ),
  'anon cannot execute daily brief RPC'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    where function_row.oid =
      'public.get_dashboard_daily_brief_v1()'::pg_catalog.regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute daily brief RPC'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '86100000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'daily-brief-visible@runtime.invalid',
    crypt('daily-brief-local-only', gen_salt('bf')),
    pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"dashboard-daily-brief"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '86100000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'daily-brief-hidden@runtime.invalid',
    crypt('daily-brief-local-only', gen_salt('bf')),
    pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"dashboard-daily-brief"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '86100000-0000-4000-8000-000000000001', 'teacher',
    'Daily brief visible actor', 'daily-brief-visible@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '86100000-0000-4000-8000-000000000002', 'teacher',
    'Daily brief hidden actor', 'daily-brief-hidden@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

create table public.dashboard_daily_brief_appointment_fixture (
  appointment_id uuid primary key,
  task_id uuid not null,
  student_name text,
  kind text not null,
  scheduled_at timestamptz not null,
  place text,
  status text not null,
  notification_revision integer not null,
  track_ids uuid[],
  subjects text[],
  observation_id uuid,
  observation_track_id uuid,
  observation_class_id uuid,
  observation_class_name text,
  observation_ends_at timestamptz,
  observation_teacher_name text,
  observation_classroom_name text
);
grant select on table public.dashboard_daily_brief_appointment_fixture
  to authenticated;

create or replace view public.ops_registration_appointment_calendar
with (security_invoker = true)
as
select
  fixture.appointment_id,
  fixture.task_id,
  fixture.student_name,
  fixture.kind,
  fixture.scheduled_at,
  fixture.place,
  fixture.status,
  fixture.notification_revision,
  fixture.track_ids,
  fixture.subjects,
  fixture.observation_id,
  fixture.observation_track_id,
  fixture.observation_class_id,
  fixture.observation_class_name,
  fixture.observation_ends_at,
  fixture.observation_teacher_name,
  fixture.observation_classroom_name
from public.dashboard_daily_brief_appointment_fixture fixture;
grant select on table public.ops_registration_appointment_calendar
  to authenticated;

with bounds as (
  select
    ((pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date::timestamp
      at time zone 'Asia/Seoul') as starts_at,
    (((pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date + 1)::timestamp
      at time zone 'Asia/Seoul') as ends_at
)
insert into public.dashboard_daily_brief_appointment_fixture(
  appointment_id, task_id, student_name, kind, scheduled_at, place, status,
  notification_revision, track_ids, subjects, observation_id,
  observation_track_id, observation_class_id, observation_class_name,
  observation_ends_at, observation_teacher_name, observation_classroom_name
)
select fixture.*
from bounds
cross join lateral (values
  (
    '86110000-0000-4000-8000-000000000001'::uuid,
    '86120000-0000-4000-8000-000000000001'::uuid,
    '경계 학생', 'level_test', bounds.starts_at, '본관', 'scheduled', 1,
    array['86130000-0000-4000-8000-000000000001'::uuid], array['영어']::text[],
    null::uuid, null::uuid, null::uuid, null::text, null::timestamptz,
    null::text, null::text
  ),
  (
    '86110000-0000-4000-8000-000000000002'::uuid,
    '86120000-0000-4000-8000-000000000002'::uuid,
    '방문 학생', 'visit_consultation', bounds.starts_at + interval '9 hours',
    '별관', 'scheduled', 1,
    array['86130000-0000-4000-8000-000000000002'::uuid], array['수학']::text[],
    null::uuid, null::uuid, null::uuid, null::text, null::timestamptz,
    null::text, null::text
  ),
  (
    '86110000-0000-4000-8000-000000000003'::uuid,
    '86120000-0000-4000-8000-000000000003'::uuid,
    '청강 학생', 'observation_class', bounds.starts_at + interval '12 hours',
    '본관', 'scheduled', 1,
    array['86130000-0000-4000-8000-000000000003'::uuid], array['영어']::text[],
    '86140000-0000-4000-8000-000000000003'::uuid,
    '86130000-0000-4000-8000-000000000003'::uuid,
    '86150000-0000-4000-8000-000000000003'::uuid,
    '청강 영어반', bounds.starts_at + interval '14 hours', '청강 교사', '101호'
  ),
  (
    '86110000-0000-4000-8000-000000000004'::uuid,
    '86120000-0000-4000-8000-000000000004'::uuid,
    '동시각 학생', 'level_test', bounds.starts_at + interval '12 hours',
    '본관', 'scheduled', 1,
    array['86130000-0000-4000-8000-000000000004'::uuid], array['영어']::text[],
    null::uuid, null::uuid, null::uuid, null::text, null::timestamptz,
    null::text, null::text
  ),
  (
    '86110000-0000-4000-8000-000000000005'::uuid,
    '86120000-0000-4000-8000-000000000005'::uuid,
    '저녁 학생', 'visit_consultation', bounds.starts_at + interval '18 hours',
    '본관', 'scheduled', 1,
    array['86130000-0000-4000-8000-000000000005'::uuid], array['수학']::text[],
    null::uuid, null::uuid, null::uuid, null::text, null::timestamptz,
    null::text, null::text
  ),
  (
    '86110000-0000-4000-8000-000000000006'::uuid,
    '86120000-0000-4000-8000-000000000006'::uuid,
    '마감 학생', 'observation_class', bounds.ends_at - interval '1 minute',
    '별관', 'scheduled', 1,
    array['86130000-0000-4000-8000-000000000006'::uuid], array['과학']::text[],
    '86140000-0000-4000-8000-000000000006'::uuid,
    '86130000-0000-4000-8000-000000000006'::uuid,
    '86150000-0000-4000-8000-000000000006'::uuid,
    '청강 과학반', bounds.ends_at, '청강 교사', '202호'
  ),
  (
    '86110000-0000-4000-8000-000000000007'::uuid,
    '86120000-0000-4000-8000-000000000007'::uuid,
    '취소 학생', 'level_test', bounds.starts_at + interval '10 hours',
    '본관', 'canceled', 1,
    array['86130000-0000-4000-8000-000000000007'::uuid], array['영어']::text[],
    null::uuid, null::uuid, null::uuid, null::text, null::timestamptz,
    null::text, null::text
  ),
  (
    '86110000-0000-4000-8000-000000000008'::uuid,
    '86120000-0000-4000-8000-000000000008'::uuid,
    '완료 학생', 'visit_consultation', bounds.starts_at + interval '11 hours',
    '본관', 'completed', 1,
    array['86130000-0000-4000-8000-000000000008'::uuid], array['수학']::text[],
    null::uuid, null::uuid, null::uuid, null::text, null::timestamptz,
    null::text, null::text
  ),
  (
    '86110000-0000-4000-8000-000000000009'::uuid,
    '86120000-0000-4000-8000-000000000009'::uuid,
    '전날 학생', 'level_test', bounds.starts_at - interval '1 second',
    '본관', 'scheduled', 1,
    array['86130000-0000-4000-8000-000000000009'::uuid], array['영어']::text[],
    null::uuid, null::uuid, null::uuid, null::text, null::timestamptz,
    null::text, null::text
  ),
  (
    '86110000-0000-4000-8000-000000000010'::uuid,
    '86120000-0000-4000-8000-000000000010'::uuid,
    '다음날 학생', 'visit_consultation', bounds.ends_at,
    '본관', 'scheduled', 1,
    array['86130000-0000-4000-8000-000000000010'::uuid], array['수학']::text[],
    null::uuid, null::uuid, null::uuid, null::text, null::timestamptz,
    null::text, null::text
  )
) fixture(
  appointment_id, task_id, student_name, kind, scheduled_at, place, status,
  notification_revision, track_ids, subjects, observation_id,
  observation_track_id, observation_class_id, observation_class_name,
  observation_ends_at, observation_teacher_name, observation_classroom_name
);

with bounds as (
  select
    ((pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date::timestamp
      at time zone 'Asia/Seoul') as starts_at,
    (((pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date + 1)::timestamp
      at time zone 'Asia/Seoul') as ends_at
)
insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, due_at, created_at, updated_at
)
select projected.*
from bounds
cross join lateral (values
  ('86160000-0000-4000-8000-000000000001'::uuid, 'requested', 'requested', bounds.starts_at),
  ('86160000-0000-4000-8000-000000000002'::uuid, 'confirmed', 'confirmed', bounds.starts_at + interval '1 hour'),
  ('86160000-0000-4000-8000-000000000003'::uuid, 'in progress', 'in_progress', bounds.starts_at + interval '2 hours'),
  ('86160000-0000-4000-8000-000000000004'::uuid, 'on hold', 'on_hold', bounds.ends_at - interval '1 minute'),
  ('86160000-0000-4000-8000-000000000005'::uuid, 'review', 'review_requested', bounds.starts_at + interval '3 hours'),
  ('86160000-0000-4000-8000-000000000006'::uuid, 'done', 'done', bounds.starts_at + interval '4 hours'),
  ('86160000-0000-4000-8000-000000000007'::uuid, 'before', 'requested', bounds.starts_at - interval '1 second'),
  ('86160000-0000-4000-8000-000000000008'::uuid, 'after', 'requested', bounds.ends_at)
) fixture(id, title, status, due_at)
cross join lateral (values (
  fixture.id, fixture.title, 'general'::text, fixture.status, 'normal'::text,
  '86100000-0000-4000-8000-000000000001'::uuid,
  fixture.due_at, pg_catalog.now(), pg_catalog.now()
)) projected;

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, due_at, created_at, updated_at
)
select
  '86160000-0000-4000-8000-000000000009'::uuid,
  'RLS hidden', 'general', 'requested', 'normal',
  '86100000-0000-4000-8000-000000000002'::uuid,
  ((pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date::timestamp
    at time zone 'Asia/Seoul') + interval '5 hours',
  pg_catalog.now(), pg_catalog.now();

create or replace function pg_temp.dashboard_daily_brief_set_actor(p_actor uuid)
returns void
language plpgsql
as $function$
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
$function$;

set local role authenticated;
select pg_temp.dashboard_daily_brief_set_actor(
  '86100000-0000-4000-8000-000000000001'
);

create temporary table dashboard_daily_brief_result(payload jsonb not null)
on commit drop;
grant select, insert on table dashboard_daily_brief_result to authenticated;
insert into dashboard_daily_brief_result(payload)
select public.get_dashboard_daily_brief_v1();

select is(
  (select payload #>> '{counts,levelTests}' from dashboard_daily_brief_result),
  '2',
  'KST 00:00 scheduled appointment is counted'
);
select is(
  (select payload #>> '{counts,observationClasses}' from dashboard_daily_brief_result),
  '2',
  'KST 23:59 scheduled appointment is counted'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'levelTests', payload #> '{counts,levelTests}',
      'visitConsultations', payload #> '{counts,visitConsultations}',
      'observationClasses', payload #> '{counts,observationClasses}'
    )
    from dashboard_daily_brief_result
  ),
  '{"levelTests":2,"visitConsultations":2,"observationClasses":2}'::jsonb,
  'canceled and completed appointments are excluded from all scheduled counts'
);
select is(
  (select payload #>> '{counts,openTasks}' from dashboard_daily_brief_result),
  '4',
  'RLS-hidden task and non-open or out-of-day tasks are excluded'
);
select is(
  (
    select pg_catalog.jsonb_agg(item ->> 'sourceId' order by ordinal)
    from dashboard_daily_brief_result result
    cross join lateral pg_catalog.jsonb_array_elements(result.payload -> 'upcoming')
      with ordinality upcoming(item, ordinal)
  ),
  '["86110000-0000-4000-8000-000000000001","86110000-0000-4000-8000-000000000002","86110000-0000-4000-8000-000000000003","86110000-0000-4000-8000-000000000004","86110000-0000-4000-8000-000000000005"]'::jsonb,
  'scheduled_at and source_id tie-breaker is deterministic'
);
select is(
  (
    select pg_catalog.jsonb_array_length(payload -> 'upcoming')
    from dashboard_daily_brief_result
  ),
  5,
  'six appointments are limited to five'
);
select ok(
  not exists (
    select 1
    from dashboard_daily_brief_result result
    cross join lateral pg_catalog.jsonb_array_elements(result.payload -> 'upcoming')
      upcoming(item)
    where item ?| array['phone', 'contact', 'memo', 'consultationNote', 'messageBody']
  ),
  'upcoming exposes no private contact, consultation, task, or message row data'
);

reset role;
select * from finish();
rollback;
