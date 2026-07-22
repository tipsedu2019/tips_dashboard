begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_table('public', 'academic_subject_settings');
select has_table('public', 'academic_subject_areas');
select has_function(
  'public',
  'list_registration_subject_capabilities_v1',
  array[]::text[]
);
select has_function(
  'public',
  'update_academic_subject_setting_v1',
  array['text', 'boolean', 'boolean', 'text[]', 'uuid']
);

select results_eq(
  $$
    select subject, is_active, registration_create_enabled, grade_levels, sort_order
    from public.academic_subject_settings
    order by sort_order
  $$,
  $$
    values
      (
        '영어'::text,
        true,
        true,
        array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3']::text[],
        10
      ),
      (
        '수학'::text,
        true,
        true,
        array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3']::text[],
        20
      ),
      ('과학'::text, true, true, array['고1','고2','고3']::text[], 30)
  $$,
  '세 과목 설정은 고정 순서와 안전한 기본 학년으로 시드된다'
);

select results_eq(
  $$
    select area_key, label, sort_order, is_active
    from public.academic_subject_areas
    where subject = '과학'
    order by sort_order
  $$,
  $$
    values
      ('integrated_science'::text, '통합과학'::text, 10, true),
      ('physics'::text, '물리학'::text, 20, true),
      ('chemistry'::text, '화학'::text, 30, true),
      ('life_science'::text, '생명과학'::text, 40, true),
      ('earth_science'::text, '지구과학'::text, 50, true)
  $$,
  '과학 영역 키와 정렬 순서는 고정된다'
);

select throws_ok(
  $$
    insert into public.academic_subject_areas(
      subject, area_key, label, sort_order, is_active
    ) values ('과학', 'astronomy', '천문학', 60, true)
  $$,
  '23514',
  null,
  '승인되지 않은 astronomy 영역은 거부된다'
);

select throws_ok(
  $$
    insert into public.academic_subject_areas(
      subject, area_key, label, sort_order, is_active
    ) values ('영어', 'physics', '물리학', 60, true)
  $$,
  '23514',
  null,
  '영어 또는 수학에는 과목 영역을 추가할 수 없다'
);

select is(
  (
    select grade_levels
    from public.academic_subject_settings
    where subject = '과학'
  ),
  array['고1', '고2', '고3']::text[],
  '과학 등록 학년은 고등학교 1~3학년으로 제한된다'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.academic_subject_settings'::pg_catalog.regclass
  ),
  '과목 설정 테이블에 RLS가 켜져 있다'
);
select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.academic_subject_areas'::pg_catalog.regclass
  ),
  '과목 영역 테이블에 RLS가 켜져 있다'
);

select ok(
  not pg_catalog.has_table_privilege(
    'anon',
    'public.academic_subject_settings',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'public.academic_subject_settings',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'public.academic_subject_settings',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  '브라우저와 서비스 역할은 과목 설정 테이블에 직접 접근하지 못한다'
);
select ok(
  not pg_catalog.has_table_privilege(
    'anon',
    'public.academic_subject_areas',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'public.academic_subject_areas',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'public.academic_subject_areas',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  '브라우저와 서비스 역할은 과목 영역 테이블에 직접 접근하지 못한다'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.list_registration_subject_capabilities_v1()',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.list_registration_subject_capabilities_v1()',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.list_registration_subject_capabilities_v1()',
    'EXECUTE'
  ),
  'capability 조회 RPC는 authenticated에만 노출된다'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.update_academic_subject_setting_v1(text,boolean,boolean,text[],uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.update_academic_subject_setting_v1(text,boolean,boolean,text[],uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.update_academic_subject_setting_v1(text,boolean,boolean,text[],uuid)',
    'EXECUTE'
  ),
  '과목 설정 update RPC는 authenticated에만 노출되고 내부 admin 검사를 수행한다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.academic_subject_director_candidate_is_active_v1(uuid,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.academic_subject_director_candidate_is_active_v1(uuid,text)',
    'EXECUTE'
  ),
  'director 검증 helper는 외부 역할에 노출되지 않는다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'dashboard_private.academic_subject_grade_levels_valid_v1(text,text[])',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.academic_subject_grade_levels_valid_v1(text,text[])',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.academic_subject_grade_levels_valid_v1(text,text[])',
    'EXECUTE'
  ),
  'grade validator helper는 모든 외부 역할에서 직접 실행할 수 없다'
);

select results_eq(
  $$
    select
      function_row.proname::text,
      function_row.prosecdef,
      pg_catalog.pg_get_userbyid(function_row.proowner)::text,
      exists (
        select 1
        from pg_catalog.unnest(
          pg_catalog.coalesce(function_row.proconfig, '{}'::text[])
        ) as config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      ) as has_empty_search_path,
      function_row.provolatile
    from pg_catalog.pg_proc as function_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = function_row.pronamespace
    where (
      namespace_row.nspname = 'dashboard_private'
      and function_row.proname in (
        'academic_subject_director_candidate_is_active_v1',
        'academic_subject_grade_levels_valid_v1'
      )
    ) or (
      namespace_row.nspname = 'public'
      and function_row.proname in (
        'list_registration_subject_capabilities_v1',
        'update_academic_subject_setting_v1'
      )
    )
    order by function_row.proname
  $$,
  $$
    values
      (
        'academic_subject_director_candidate_is_active_v1'::text,
        true,
        'postgres'::text,
        true,
        's'::"char"
      ),
      (
        'academic_subject_grade_levels_valid_v1'::text,
        false,
        'postgres'::text,
        true,
        'i'::"char"
      ),
      (
        'list_registration_subject_capabilities_v1'::text,
        true,
        'postgres'::text,
        true,
        's'::"char"
      ),
      (
        'update_academic_subject_setting_v1'::text,
        true,
        'postgres'::text,
        true,
        'v'::"char"
      )
  $$,
  '새 함수의 SECURITY DEFINER, owner, empty search_path, volatility가 고정된다'
);

select is(
  public.registration_subject_tracks_runtime_version(),
  1,
  '기존 registration runtime marker는 1로 유지된다'
);

create temporary table academic_subject_fixture_ids (
  fixture_key text primary key,
  profile_id uuid not null,
  catalog_id uuid
) on commit drop;

insert into academic_subject_fixture_ids(fixture_key, profile_id, catalog_id) values
  (
    'admin',
    '82000000-0000-4000-8000-000000000001',
    null
  ),
  (
    'science_teacher',
    '82000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000102'
  ),
  (
    'wrong_team',
    '82000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000103'
  ),
  (
    'hidden_teacher',
    '82000000-0000-4000-8000-000000000004',
    '82000000-0000-4000-8000-000000000104'
  ),
  (
    'banned_teacher',
    '82000000-0000-4000-8000-000000000005',
    '82000000-0000-4000-8000-000000000105'
  ),
  (
    'deleted_teacher',
    '82000000-0000-4000-8000-000000000006',
    '82000000-0000-4000-8000-000000000106'
  );

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  banned_until, deleted_at, created_at, updated_at
)
select
  fixture.profile_id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  fixture.fixture_key || '@academic-subject.invalid',
  crypt('academic-subject-test-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"academic-subject-foundation"}'::jsonb,
  case
    when fixture.fixture_key = 'banned_teacher' then now() + interval '1 day'
    else null
  end,
  case
    when fixture.fixture_key = 'deleted_teacher' then now()
    else null
  end,
  now(),
  now()
from academic_subject_fixture_ids as fixture;

insert into public.profiles(id, role, name, email, created_at, updated_at)
select
  fixture.profile_id,
  case when fixture.fixture_key = 'admin' then 'admin' else 'teacher' end,
  '과목설정 ' || fixture.fixture_key,
  fixture.fixture_key || '@academic-subject.invalid',
  now(),
  now()
from academic_subject_fixture_ids as fixture
on conflict (id) do update set
  role = excluded.role,
  name = excluded.name,
  email = excluded.email,
  updated_at = excluded.updated_at;

update public.profiles
set teacher_catalog_id = null,
    updated_at = now()
where id in (
  select fixture.profile_id
  from academic_subject_fixture_ids as fixture
);

delete from public.teacher_catalogs
where profile_id in (
  select fixture.profile_id
  from academic_subject_fixture_ids as fixture
);

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order,
  profile_id, account_email, dashboard_role
)
select
  fixture.catalog_id,
  '과목설정-' || fixture.fixture_key,
  case
    when fixture.fixture_key = 'wrong_team' then array['과학']::text[]
    else array['과학팀']::text[]
  end,
  fixture.fixture_key <> 'hidden_teacher',
  9800 + row_number() over (order by fixture.fixture_key),
  fixture.profile_id,
  fixture.fixture_key || '@academic-subject.invalid',
  'teacher'
from academic_subject_fixture_ids as fixture
where fixture.catalog_id is not null;

create or replace function pg_temp.academic_subject_set_actor(p_fixture_key text)
returns void
language plpgsql
as $$
declare
  v_profile_id uuid;
begin
  select fixture.profile_id
  into strict v_profile_id
  from academic_subject_fixture_ids as fixture
  where fixture.fixture_key = p_fixture_key;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', v_profile_id::text,
      'role', 'authenticated',
      'email', p_fixture_key || '@academic-subject.invalid'
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', v_profile_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

select pg_temp.academic_subject_set_actor('admin');
set local role authenticated;

select throws_ok(
  $$select count(*) from public.academic_subject_settings$$,
  '42501',
  null,
  'authenticated 역할은 설정 테이블을 직접 읽을 수 없다'
);

select results_eq(
  $$
    select subject, is_active, registration_create_enabled, grade_levels, sort_order
    from public.list_registration_subject_capabilities_v1()
  $$,
  $$
    values
      (
        '영어'::text,
        true,
        true,
        array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3']::text[],
        10
      ),
      (
        '수학'::text,
        true,
        true,
        array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3']::text[],
        20
      ),
      ('과학'::text, true, true, array['고1','고2','고3']::text[], 30)
  $$,
  '인증된 사용자는 safe capability RPC로 세 과목을 읽는다'
);

select lives_ok(
  $$
    select public.update_academic_subject_setting_v1(
      '과학',
      true,
      true,
      array['고1', '고2', '고3']::text[],
      '82000000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  'admin은 전역 role이 teacher인 활성 과학팀 교사를 director로 지정할 수 있다'
);

reset role;

select is(
  (
    select default_director_profile_id
    from public.academic_subject_settings
    where subject = '과학'
  ),
  '82000000-0000-4000-8000-000000000002'::uuid,
  'director는 teacher_catalogs.profile_id 권위 링크로 저장된다'
);

set local role authenticated;

select is(
  (
    select default_director_profile_id
    from public.list_registration_subject_capabilities_v1()
    where subject = '과학'
  ),
  '82000000-0000-4000-8000-000000000002'::uuid,
  '저장된 active director는 capability 조회에서도 유지된다'
);

reset role;
update public.teacher_catalogs
set is_visible = false
where profile_id = '82000000-0000-4000-8000-000000000002'::uuid;
set local role authenticated;
select is(
  (
    select default_director_profile_id
    from public.list_registration_subject_capabilities_v1()
    where subject = '과학'
  ),
  null::uuid,
  '저장된 director가 숨김 상태가 되면 capability 조회는 null로 재검증한다'
);

reset role;
update public.teacher_catalogs
set is_visible = true
where profile_id = '82000000-0000-4000-8000-000000000002'::uuid;
update auth.users
set banned_until = now() + interval '1 day'
where id = '82000000-0000-4000-8000-000000000002'::uuid;
set local role authenticated;
select is(
  (
    select default_director_profile_id
    from public.list_registration_subject_capabilities_v1()
    where subject = '과학'
  ),
  null::uuid,
  '저장된 director가 ban 상태가 되면 capability 조회는 null로 재검증한다'
);

reset role;
update auth.users
set banned_until = null,
    deleted_at = now()
where id = '82000000-0000-4000-8000-000000000002'::uuid;
set local role authenticated;
select is(
  (
    select default_director_profile_id
    from public.list_registration_subject_capabilities_v1()
    where subject = '과학'
  ),
  null::uuid,
  '저장된 director가 삭제 상태가 되면 capability 조회는 null로 재검증한다'
);

reset role;
update auth.users
set deleted_at = null
where id = '82000000-0000-4000-8000-000000000002'::uuid;

set local role authenticated;

select throws_ok(
  $$
    select public.update_academic_subject_setting_v1(
      '과학', true, true, array['중3', '고1']::text[], null
    )
  $$,
  '22023',
  'academic_subject_setting_invalid_payload',
  '과학에 중학교 학년을 설정할 수 없다'
);

select throws_ok(
  $$
    select public.update_academic_subject_setting_v1(
      '과학', true, true, array['고1', '고1']::text[], null
    )
  $$,
  '22023',
  'academic_subject_setting_invalid_payload',
  '중복 학년 payload는 거부된다'
);

select throws_ok(
  $$
    select public.update_academic_subject_setting_v1(
      '과학', true, true, array[array['고1', '고2', '고3']]::text[], null
    )
  $$,
  '22023',
  'academic_subject_setting_invalid_payload',
  '중복이 없는 2차원 학년 배열도 거부된다'
);

select throws_ok(
  $$
    select public.update_academic_subject_setting_v1(
      '과학', true, true, array['고1', '고2', '고3']::text[],
      '82000000-0000-4000-8000-000000000003'::uuid
    )
  $$,
  '22023',
  'academic_subject_setting_invalid_director',
  '정확한 과학팀 membership가 없는 교사는 director가 될 수 없다'
);

select throws_ok(
  $$
    select public.update_academic_subject_setting_v1(
      '과학', true, true, array['고1', '고2', '고3']::text[],
      '82000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '22023',
  'academic_subject_setting_invalid_director',
  '숨김 teacher catalog는 director 후보가 아니다'
);

select throws_ok(
  $$
    select public.update_academic_subject_setting_v1(
      '과학', true, true, array['고1', '고2', '고3']::text[],
      '82000000-0000-4000-8000-000000000005'::uuid
    )
  $$,
  '22023',
  'academic_subject_setting_invalid_director',
  '현재 ban 상태인 auth account는 director 후보가 아니다'
);

select throws_ok(
  $$
    select public.update_academic_subject_setting_v1(
      '과학', true, true, array['고1', '고2', '고3']::text[],
      '82000000-0000-4000-8000-000000000006'::uuid
    )
  $$,
  '22023',
  'academic_subject_setting_invalid_director',
  '삭제된 auth account는 director 후보가 아니다'
);

reset role;
select pg_temp.academic_subject_set_actor('science_teacher');
set local role authenticated;

select throws_ok(
  $$
    select public.update_academic_subject_setting_v1(
      '과학', true, true, array['고1', '고2', '고3']::text[], null
    )
  $$,
  '42501',
  'academic_subject_setting_admin_required',
  '일반 teacher caller는 과목 설정을 변경할 수 없다'
);

reset role;

select results_eq(
  $$
    select
      subject,
      is_active,
      registration_create_enabled,
      grade_levels,
      default_director_profile_id,
      sort_order
    from public.academic_subject_settings
    where subject = '과학'
  $$,
  $$
    values (
      '과학'::text,
      true,
      true,
      array['고1', '고2', '고3']::text[],
      '82000000-0000-4000-8000-000000000002'::uuid,
      30
    )
  $$,
  '거부된 admin/teacher mutation 뒤 저장된 과학 설정은 변하지 않는다'
);

select * from finish();
rollback;
