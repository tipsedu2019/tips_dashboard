begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '10000000-0000-4000-8000-000000007201',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'level-place-admin@registration-runtime.invalid',
  crypt('registration-level-place-runtime-only', gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"registration-level-place"}'::jsonb, now(), now()
);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '10000000-0000-4000-8000-000000007201',
  'admin',
  '레벨테스트 장소 런타임 관리자',
  'level-place-admin@registration-runtime.invalid',
  now(),
  now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

create or replace function pg_temp.registration_place_set_actor(p_actor uuid)
returns void
language plpgsql
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

create or replace function pg_temp.registration_place_throws(
  p_sql text,
  p_message_pattern text
)
returns boolean
language plpgsql
volatile
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm ~ p_message_pattern;
end;
$$;

create temporary table registration_place_runtime_case(
  payload jsonb not null
) on commit drop;
grant select, insert on registration_place_runtime_case to authenticated;

set local role authenticated;
select pg_temp.registration_place_set_actor(
  '10000000-0000-4000-8000-000000007201'
);

select ok(
  pg_temp.registration_place_throws(
    $sql$
      select public.create_registration_case_with_initial_workflow_v1(
        '비정규장소 신규학생', '중1', '장소런타임중', '01077007201', null,
        '본관', '2026-07-20 09:30+09'::timestamptz, array['영어'],
        null, 'normal', '{"영어":"level_test"}'::jsonb,
        '{"scheduledAt":"2026-07-21T10:00:00+09:00","place":"본관 201호","subjects":["영어"]}'::jsonb,
        null, '{}'::jsonb, 'level-place-invalid-create'
      )
    $sql$,
    'registration_level_test_place_invalid'
  ),
  'authenticated public atomic create rejects a noncanonical level-test place'
);

select is(
  (
    select pg_catalog.count(*)
    from public.ops_tasks task
    where task.student_name = '비정규장소 신규학생'
  ),
  0::bigint,
  'rejected atomic create writes no registration task'
);

insert into registration_place_runtime_case(payload)
select public.create_registration_case_with_initial_workflow_v1(
  '정규장소 신규학생', '중1', '장소런타임중', '01077007202', null,
  '본관', '2026-07-20 09:30+09'::timestamptz, array['영어'],
  null, 'normal', '{"영어":"level_test"}'::jsonb,
  '{"scheduledAt":"2026-07-21T10:00:00+09:00","place":"  본관  ","subjects":["영어"]}'::jsonb,
  null, '{}'::jsonb, 'level-place-canonical-create'
);

select is(
  (
    select appointment.place
    from registration_place_runtime_case fixture
    join public.ops_registration_appointments appointment
      on appointment.id = (fixture.payload -> 'appointments' -> 0 ->> 'id')::uuid
  ),
  '본관',
  'atomic create trims and persists a canonical level-test place'
);

select ok(
  pg_temp.registration_place_throws(
    (
      select pg_catalog.format(
        $sql$
          select public.save_registration_shared_appointment(
            %L::uuid, %L::uuid, 'level_test',
            '2026-07-22 10:00+09'::timestamptz, '별관 301호',
            array[%L::uuid], false, %L::integer, 'level-place-invalid-save'
          )
        $sql$,
        fixture.payload -> 'appointments' -> 0 ->> 'id',
        fixture.payload ->> 'taskId',
        fixture.payload -> 'tracks' -> 0 ->> 'id',
        fixture.payload -> 'appointments' -> 0 ->> 'notificationRevision'
      )
      from registration_place_runtime_case fixture
    ),
    'registration_level_test_place_invalid'
  ),
  'authenticated public saved appointment RPC rejects a noncanonical level-test place'
);

select is(
  dashboard_private.normalize_registration_appointment_place_v1(
    'visit_consultation',
    '별관 301호'
  ),
  '별관 301호',
  'visit consultation place remains free text at the server boundary'
);

select * from finish();
rollback;
