begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';

-- This packet owns all auth, teacher-catalog, subject-setting, registration,
-- appointment, reminder, and receipt fixtures and rolls them back at EOF.
select has_function(
  'dashboard_private',
  'registration_subject_sort_order',
  array['text']
);
select has_function(
  'dashboard_private',
  'assert_registration_subject_enabled',
  array['text', 'text']
);
select has_function(
  'dashboard_private',
  'is_active_subject_director',
  array['uuid', 'text']
);

select results_eq(
  $$
    select dashboard_private.registration_subject_sort_order(subject)
    from pg_catalog.unnest(array['영어', '수학', '과학']::text[]) subject
  $$,
  $$values (10), (20), (30)$$,
  '등록 과목 순서는 영어, 수학, 과학으로 고정된다'
);

select throws_ok(
  $$select dashboard_private.registration_subject_sort_order('사회')$$,
  '22023',
  'registration_subject_unsupported',
  '알 수 없는 과목은 fail-closed 처리된다'
);

select is(public.registration_subject_tracks_runtime_version(), 1);
select is(public.registration_intake_workflow_runtime_version(), 1);
select is(public.registration_appointment_reminders_runtime_version(), 1);
select is(public.registration_notification_handoffs_runtime_version(), 1);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_registration_case_with_initial_workflow_v1(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_registration_shared_appointment(uuid,uuid,text,timestamp with time zone,text,uuid[],boolean,integer,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.preview_registration_appointment_reminders_v1(text,timestamp with time zone,uuid[])',
    'EXECUTE'
  ),
  'authenticated는 현재 public 등록 mutation과 reminder preview만 호출할 수 있다'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.create_registration_case_with_initial_workflow_v1_impl(text,text,text,text,text,text,timestamp with time zone,text[],text,text,jsonb,jsonb,jsonb,jsonb,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.save_registration_shared_appointment_impl(uuid,uuid,text,timestamp with time zone,text,uuid[],boolean,integer,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.complete_registration_consultation_impl(uuid,text,text,uuid,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.registration_message_track_id_v1(uuid)',
    'EXECUTE'
  ),
  'lower-level registration cores와 admission selector는 외부 직접 실행이 닫혀 있다'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '83000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'science-registration-admin@runtime.invalid',
    crypt('science-registration-runtime-only', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-science"}'::jsonb, now(), now()
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'science-registration-director@runtime.invalid',
    crypt('science-registration-runtime-only', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-science"}'::jsonb, now(), now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '83000000-0000-4000-8000-000000000001', 'admin',
    '과학등록 런타임 관리자',
    'science-registration-admin@runtime.invalid', now(), now()
  ),
  (
    '83000000-0000-4000-8000-000000000002', 'teacher',
    '과학등록 런타임 원장',
    'science-registration-director@runtime.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

update public.profiles
set teacher_catalog_id = null,
    updated_at = now()
where id in (
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002'
);

delete from public.teacher_catalogs
where profile_id in (
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002'
);

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order,
  profile_id, account_email, dashboard_role
)
values
  (
    '83000000-0000-4000-8000-000000000101',
    '과학등록 런타임 관리자', array['영어', '수학']::text[], true, 9831,
    '83000000-0000-4000-8000-000000000001',
    'science-registration-admin@runtime.invalid', 'admin'
  ),
  (
    '83000000-0000-4000-8000-000000000102',
    '과학등록 런타임 원장', array['과학팀']::text[], true, 9832,
    '83000000-0000-4000-8000-000000000002',
    'science-registration-director@runtime.invalid', 'teacher'
  );

update public.profiles profile
set teacher_catalog_id = fixture.catalog_id,
    updated_at = now()
from (
  values
    (
      '83000000-0000-4000-8000-000000000001'::uuid,
      '83000000-0000-4000-8000-000000000101'::uuid
    ),
    (
      '83000000-0000-4000-8000-000000000002'::uuid,
      '83000000-0000-4000-8000-000000000102'::uuid
    )
) fixture(profile_id, catalog_id)
where profile.id = fixture.profile_id;

update public.academic_subject_settings
set is_active = true,
    registration_create_enabled = true,
    grade_levels = array['고1', '고2', '고3']::text[],
    default_director_profile_id = null
where subject = '과학';

create or replace function pg_temp.registration_science_set_actor(p_actor uuid)
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

create or replace function pg_temp.registration_science_throws(
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

create temporary table registration_science_cases(
  case_key text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update on registration_science_cases to authenticated;

create or replace function pg_temp.registration_science_task(p_case_key text)
returns uuid
language sql
stable
as $$
  select (fixture.payload ->> 'taskId')::uuid
  from registration_science_cases fixture
  where fixture.case_key = p_case_key;
$$;

create or replace function pg_temp.registration_science_track(
  p_case_key text,
  p_subject text
)
returns uuid
language sql
stable
as $$
  select (track.value ->> 'id')::uuid
  from registration_science_cases fixture
  cross join lateral pg_catalog.jsonb_array_elements(fixture.payload -> 'tracks') track(value)
  where fixture.case_key = p_case_key
    and track.value ->> 'subject' = p_subject;
$$;

set local role authenticated;
select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000001'
);

insert into registration_science_cases(case_key, payload)
select 'science_inquiry', public.create_registration_case(
  '과학문의학생', '고1', '과학런타임고', '01083000001', null,
  '별관', '2026-07-22 09:00+09'::timestamptz,
  array['과학'], '과학 단독 문의', 'normal', 'science-inquiry-create'
);

select ok(
  (
    select fixture.payload -> 'subjects' = '["과학"]'::jsonb
      and pg_catalog.jsonb_array_length(fixture.payload -> 'tracks') = 1
    from registration_science_cases fixture
    where fixture.case_key = 'science_inquiry'
  )
  and exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = pg_temp.registration_science_track('science_inquiry', '과학')
      and track.pipeline_status = 'inquiry'
  ),
  '고등학생 과학 단독 문의가 한 개의 독립 track으로 생성된다'
);

insert into registration_science_cases(case_key, payload)
select 'science_level_test', public.create_registration_case_with_initial_workflow_v1(
  '과학레벨학생', '고1', '과학런타임고', '01083000002', null,
  '별관', '2026-07-22 09:10+09'::timestamptz,
  array['과학'], '과학 레벨테스트', 'normal',
  '{"과학":"level_test"}'::jsonb,
  '{"scheduledAt":"2026-08-03T17:00:00+09:00","place":"별관","subjects":["과학"]}'::jsonb,
  null, '{}'::jsonb, 'science-level-test-create'
);

select ok(
  exists (
    select 1
    from public.ops_registration_level_tests attempt
    join public.ops_registration_subject_tracks track on track.id = attempt.track_id
    where track.id = pg_temp.registration_science_track('science_level_test', '과학')
      and attempt.status = 'scheduled'
      and track.pipeline_status = 'level_test_scheduled'
  ),
  '과학은 원장 지정 전에도 선택적으로 레벨테스트를 예약할 수 있다'
);

select ok(
  pg_temp.registration_science_throws(
    $sql$
      select public.create_registration_case_with_initial_workflow_v1(
        '과학원장없음', '고1', '과학런타임고', '01083000003', null,
        '별관', '2026-07-22 09:20+09'::timestamptz,
        array['과학'], '과학 전화상담', 'normal',
        '{"과학":"direct_phone"}'::jsonb,
        null, null, '{}'::jsonb, 'science-director-required'
      )
    $sql$,
    'registration_director_required'
  )
  and not exists (
    select 1 from public.ops_tasks task where task.student_name = '과학원장없음'
  ),
  '원장이 필요한 과학 상담은 configured director가 없으면 원자적으로 거부된다'
);

select lives_ok(
  $$
    select *
    from public.update_academic_subject_setting_v1(
      '과학', true, true, array['고1', '고2', '고3']::text[],
      '83000000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  '관리자는 별도 과학팀의 active teacher를 과학 원장으로 지정할 수 있다'
);

reset role;
select ok(
  dashboard_private.is_active_subject_director(
    '83000000-0000-4000-8000-000000000002', '과학'
  )
  and not dashboard_private.is_active_subject_director(
    '83000000-0000-4000-8000-000000000002', '영어'
  )
  and not dashboard_private.is_active_subject_director(
    '83000000-0000-4000-8000-000000000002', '수학'
  ),
  '과학 원장은 과학에만 활성 director이며 영어와 수학 권한을 얻지 않는다'
);

set local role authenticated;
select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000001'
);

insert into registration_science_cases(case_key, payload)
select 'science_phone', public.create_registration_case_with_initial_workflow_v1(
  '과학상담학생', '고2', '과학런타임고', '01083000004', null,
  '별관', '2026-07-22 09:30+09'::timestamptz,
  array['과학'], '과학 전화상담', 'normal',
  '{"과학":"direct_phone"}'::jsonb,
  null, null, '{}'::jsonb, 'science-phone-create'
);

select ok(
  exists (
    select 1
    from public.ops_registration_subject_tracks track
    join public.ops_registration_consultations consultation
      on consultation.track_id = track.id
    where track.id = pg_temp.registration_science_track('science_phone', '과학')
      and track.director_profile_id = '83000000-0000-4000-8000-000000000002'
      and track.pipeline_status = 'consultation_waiting'
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
      and consultation.director_profile_id = track.director_profile_id
  ),
  'configured 과학 원장은 과학 전화상담 track과 consultation에 함께 배정된다'
);

reset role;
create temporary table registration_science_runtime_ids(
  fixture_key text primary key,
  fixture_id uuid not null
) on commit drop;
grant select, insert on registration_science_runtime_ids to authenticated;

insert into registration_science_runtime_ids(fixture_key, fixture_id)
select 'science_phone_consultation', consultation.id
from public.ops_registration_consultations consultation
where consultation.track_id = pg_temp.registration_science_track('science_phone', '과학')
  and consultation.mode = 'phone'
  and consultation.status = 'waiting';

set local role authenticated;
select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000002'
);

insert into registration_science_cases(case_key, payload)
select 'science_phone_completed', public.complete_registration_consultation(
  (
    select fixture_id
    from registration_science_runtime_ids
    where fixture_key = 'science_phone_consultation'
  ),
  'not_registered', null, null, 'science-phone-complete'
);

select ok(
  (
    select fixture.payload #>> '{consultation,status}' = 'completed'
      and fixture.payload #>> '{track,status}' = 'not_registered'
    from registration_science_cases fixture
    where fixture.case_key = 'science_phone_completed'
  )
  and exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.id = (
      select fixture_id
      from registration_science_runtime_ids
      where fixture_key = 'science_phone_consultation'
    )
      and consultation.status = 'completed'
  ),
  '과학 원장은 자신에게 정확히 배정된 actionable 과학 상담만 완료할 수 있다'
);

select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000001'
);
insert into registration_science_cases(case_key, payload)
select 'english_phone', public.create_registration_case_with_initial_workflow_v1(
  '영어상담학생', '고1', '과학런타임고', '01083000005', null,
  '별관', '2026-07-22 09:40+09'::timestamptz,
  array['영어'], '영어 전화상담', 'normal',
  '{"영어":"direct_phone"}'::jsonb,
  null, null,
  '{"영어":"83000000-0000-4000-8000-000000000001"}'::jsonb,
  'science-english-phone-create'
);

insert into registration_science_runtime_ids(fixture_key, fixture_id)
select 'english_phone_consultation', consultation.id
from public.ops_registration_consultations consultation
where consultation.track_id = pg_temp.registration_science_track('english_phone', '영어')
  and consultation.mode = 'phone'
  and consultation.status = 'waiting';

select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000002'
);
select ok(
  pg_temp.registration_science_throws(
    (
      select pg_catalog.format(
        $sql$
          select public.complete_registration_consultation(
            %L::uuid, 'not_registered', null, null,
            'science-director-english-denied'
          )
        $sql$,
        fixture_id
      )
      from registration_science_runtime_ids
      where fixture_key = 'english_phone_consultation'
    ),
    'registration_access_denied'
  ),
  '과학 원장은 영어 상담을 완료할 수 없다'
);

select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000001'
);

insert into registration_science_cases(case_key, payload)
select 'english_science', public.create_registration_case(
  '영어과학학생', '고1', '과학런타임고', '01083000006', null,
  '별관', '2026-07-22 10:00+09'::timestamptz,
  array['과학', '영어'], null, 'normal', 'science-english-create'
);
insert into registration_science_cases(case_key, payload)
select 'math_science', public.create_registration_case(
  '수학과학학생', '고2', '과학런타임고', '01083000007', null,
  '별관', '2026-07-22 10:10+09'::timestamptz,
  array['과학', '수학'], null, 'normal', 'science-math-create'
);
insert into registration_science_cases(case_key, payload)
select 'all_three', public.create_registration_case(
  '삼과목학생', '고3', '과학런타임고', '01083000008', null,
  '별관', '2026-07-22 10:20+09'::timestamptz,
  array['과학', '수학', '영어'], null, 'normal', 'science-all-three-create'
);

select ok(
  (
    select payload -> 'subjects' = '["영어", "과학"]'::jsonb
    from registration_science_cases where case_key = 'english_science'
  )
  and (
    select payload -> 'subjects' = '["수학", "과학"]'::jsonb
    from registration_science_cases where case_key = 'math_science'
  )
  and (
    select payload -> 'subjects' = '["영어", "수학", "과학"]'::jsonb
      and pg_catalog.jsonb_array_length(payload -> 'tracks') = 3
    from registration_science_cases where case_key = 'all_three'
  ),
  '영어+과학, 수학+과학, 세 과목 조합은 모두 고정 순서로 생성된다'
);

reset role;
insert into dashboard_private.ops_registration_mutations(
  actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
) values (
  '83000000-0000-4000-8000-000000000001',
  'science-legacy-create-replay',
  pg_temp.registration_science_task('all_three'),
  'create_case',
  pg_catalog.jsonb_build_object(
    'studentName', '레거시생성재시도',
    'schoolGrade', '고1',
    'schoolName', '과학런타임고',
    'parentPhone', '01083000015',
    'studentPhone', null,
    'campus', '별관',
    'inquiryAt', '2026-07-22 10:25+09'::timestamptz,
    'subjects', '["수학", "영어"]'::jsonb,
    'requestNote', 'migration 전 receipt',
    'priority', 'normal'
  ),
  '{"legacyReceipt":"create"}'::jsonb
);

set local role authenticated;
select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000001'
);

select is(
  public.create_registration_case(
    '레거시생성재시도', '고1', '과학런타임고', '01083000015', null,
    '별관', '2026-07-22 10:25+09'::timestamptz,
    array['영어', '수학'], 'migration 전 receipt', 'normal',
    'science-legacy-create-replay'
  ),
  '{"legacyReceipt":"create"}'::jsonb,
  'migration 전 수학, 영어 lexical create receipt는 동일 payload 재시도만 replay한다'
);

select ok(
  pg_temp.registration_science_throws(
    $sql$
      select public.create_registration_case(
        '다른생성payload', '고1', '과학런타임고', '01083000015', null,
        '별관', '2026-07-22 10:25+09'::timestamptz,
        array['영어', '수학'], 'migration 전 receipt', 'normal',
        'science-legacy-create-replay'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'legacy create receipt도 같은 key의 다른 payload 재사용은 거부한다'
);

select ok(
  pg_temp.registration_science_throws(
    $sql$
      select public.create_registration_case(
        '중등과학거부', '중3', '과학런타임중', '01083000009', null,
        '별관', '2026-07-22 10:30+09'::timestamptz,
        array['과학'], null, 'normal', 'science-middle-rejected'
      )
    $sql$,
    'registration_science_grade_invalid'
  )
  and pg_temp.registration_science_throws(
    $sql$
      select public.create_registration_case(
        '네과목거부', '고1', '과학런타임고', '01083000010', null,
        '별관', '2026-07-22 10:40+09'::timestamptz,
        array['영어', '수학', '과학', '사회'], null, 'normal',
        'science-four-unsupported'
      )
    $sql$,
    'registration_subject_unsupported'
  ),
  '중등 과학과 네 번째 미지원 과목은 쓰기 전에 거부된다'
);

insert into registration_science_cases(case_key, payload)
select 'sync_base', public.create_registration_case(
  '동기화학생', '고1', '과학런타임고', '01083000011', null,
  '별관', '2026-07-22 10:50+09'::timestamptz,
  array['영어', '수학'], null, 'normal', 'science-sync-base'
);

insert into registration_science_cases(case_key, payload)
select 'legacy_sync_base', public.create_registration_case(
  '레거시동기화재시도', '고1', '과학런타임고', '01083000016', null,
  '별관', '2026-07-22 10:55+09'::timestamptz,
  array['영어'], null, 'normal', 'science-legacy-sync-base'
);

reset role;
insert into dashboard_private.ops_registration_mutations(
  actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
) values (
  '83000000-0000-4000-8000-000000000001',
  'science-legacy-sync-replay',
  pg_temp.registration_science_task('legacy_sync_base'),
  'sync_subjects',
  pg_catalog.jsonb_build_object(
    'taskId', pg_temp.registration_science_task('legacy_sync_base'),
    'subjects', '["수학", "영어"]'::jsonb
  ),
  '{"legacyReceipt":"sync"}'::jsonb
);

set local role authenticated;
select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000001'
);

select is(
  public.sync_registration_case_subjects(
    pg_temp.registration_science_task('legacy_sync_base'),
    array['영어', '수학'],
    'science-legacy-sync-replay'
  ),
  '{"legacyReceipt":"sync"}'::jsonb,
  'migration 전 수학, 영어 lexical sync receipt는 동일 payload 재시도만 replay한다'
);

select ok(
  pg_temp.registration_science_throws(
    (
      select pg_catalog.format(
        $sql$
          select public.sync_registration_case_subjects(
            %L::uuid, array['영어'], 'science-legacy-sync-replay'
          )
        $sql$,
        pg_temp.registration_science_task('legacy_sync_base')
      )
    ),
    'idempotency_key_reused'
  ),
  'legacy sync receipt도 같은 key의 다른 subject payload 재사용은 거부한다'
);

insert into registration_science_cases(case_key, payload)
select 'sync_three', public.sync_registration_case_subjects(
  pg_temp.registration_science_task('sync_base'),
  array['과학', '수학', '영어'],
  'science-sync-two-to-three'
);

select ok(
  (
    select payload -> 'subjects' = '["영어", "수학", "과학"]'::jsonb
      and pg_catalog.jsonb_array_length(payload -> 'tracks') = 3
    from registration_science_cases where case_key = 'sync_three'
  )
  and (
    select task.subject = '영어, 수학, 과학'
    from public.ops_tasks task
    where task.id = pg_temp.registration_science_task('sync_base')
  ),
  '기존 2과목 case는 이력과 parent projection을 보존하며 3과목으로 동기화된다'
);

reset role;
select ok(
  (
    select mutation.target_fingerprint -> 'subjects'
      = '["영어", "수학", "과학"]'::jsonb
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '83000000-0000-4000-8000-000000000001'
      and mutation.request_key = 'science-all-three-create'
  )
  and (
    select mutation.target_fingerprint -> 'subjects'
      = '["영어", "수학", "과학"]'::jsonb
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '83000000-0000-4000-8000-000000000001'
      and mutation.request_key = 'science-sync-two-to-three'
  ),
  'migration 이후 create와 sync receipt는 영어, 수학, 과학 canonical fingerprint를 저장한다'
);

set local role authenticated;
select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000001'
);

insert into registration_science_cases(case_key, payload)
select 'appointment_case', public.create_registration_case_with_initial_workflow_v1(
  '삼과목방문학생', '고1', '과학런타임고', '01083000012', null,
  '별관', '2026-07-22 11:00+09'::timestamptz,
  array['과학', '영어', '수학'], '삼과목 방문상담', 'normal',
  '{"과학":"direct_phone","영어":"direct_phone","수학":"direct_phone"}'::jsonb,
  null, null,
  '{"과학":"83000000-0000-4000-8000-000000000002","영어":"83000000-0000-4000-8000-000000000001","수학":"83000000-0000-4000-8000-000000000001"}'::jsonb,
  'science-appointment-case-create'
);

insert into registration_science_cases(case_key, payload)
select 'appointment_saved', public.save_registration_shared_appointment(
  null,
  pg_temp.registration_science_task('appointment_case'),
  'visit_consultation',
  '2026-08-05 18:00+09'::timestamptz,
  '별관 4강',
  array[
    pg_temp.registration_science_track('appointment_case', '과학'),
    pg_temp.registration_science_track('appointment_case', '수학'),
    pg_temp.registration_science_track('appointment_case', '영어')
  ],
  false,
  null,
  'science-three-track-visit-save'
);

select ok(
  (
    select payload -> 'trackIds' = pg_catalog.jsonb_build_array(
      pg_temp.registration_science_track('appointment_case', '영어'),
      pg_temp.registration_science_track('appointment_case', '수학'),
      pg_temp.registration_science_track('appointment_case', '과학')
    )
      and payload ->> 'place' = '별관 4강'
    from registration_science_cases where case_key = 'appointment_saved'
  )
  and (
    select calendar.subjects = array['영어', '수학', '과학']::text[]
      and calendar.track_ids = array[
        pg_temp.registration_science_track('appointment_case', '영어'),
        pg_temp.registration_science_track('appointment_case', '수학'),
        pg_temp.registration_science_track('appointment_case', '과학')
      ]::uuid[]
    from public.ops_registration_appointment_calendar calendar
    where calendar.appointment_id = (
      select (payload ->> 'appointmentId')::uuid
      from registration_science_cases where case_key = 'appointment_saved'
    )
  ),
  '삼과목 shared visit은 입력 순서와 무관하게 영어, 수학, 과학 순서로 저장·표시된다'
);

select lives_ok(
  $$
    select *
    from public.preview_registration_appointment_reminders_v1(
      'visit_consultation',
      '2026-08-05 18:00+09'::timestamptz,
      array[
        pg_temp.registration_science_track('appointment_case', '영어'),
        pg_temp.registration_science_track('appointment_case', '수학'),
        pg_temp.registration_science_track('appointment_case', '과학')
      ]
    )
  $$,
  'reminder preview는 세 개의 참여 track을 허용한다'
);

reset role;
select ok(
  (
    select snapshot -> 'subjects' = '["영어", "수학", "과학"]'::jsonb
      and snapshot -> 'participants' -> 0 ->> 'subject' = '영어'
      and snapshot -> 'participants' -> 1 ->> 'subject' = '수학'
      and snapshot -> 'participants' -> 2 ->> 'subject' = '과학'
      and snapshot -> 'director_profile_ids'
        @> '["83000000-0000-4000-8000-000000000002"]'::jsonb
    from (
      select dashboard_private.registration_appointment_source_snapshot_v1(
        (
          select (payload ->> 'appointmentId')::uuid
          from registration_science_cases where case_key = 'appointment_saved'
        )
      ) as snapshot
    ) source
  ),
  'reminder snapshot은 과학 원장을 유지하고 세 과목 participant를 고정 순서로 직렬화한다'
);

select ok(
  exists (
    select 1
    from dashboard_private.notification_events event_row
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.visit_scheduled'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = (
        select payload ->> 'appointmentId'
        from registration_science_cases where case_key = 'appointment_saved'
      )
      and event_row.payload ->> 'subjects' = '영어 · 수학 · 과학'
      and event_row.payload -> 'director_profile_ids'
        @> '["83000000-0000-4000-8000-000000000002"]'::jsonb
  ),
  'canonical visit event도 과학 원장과 영어, 수학, 과학 순서를 보존한다'
);

select is(
  dashboard_private.registration_message_track_id_v1(
    pg_temp.registration_science_task('all_three')
  ),
  pg_temp.registration_science_track('all_three', '영어'),
  'admission message selector는 세 과목 case에서 영어 track을 우선한다'
);

select is(
  dashboard_private.derive_registration_parent_projection(
    pg_temp.registration_science_task('all_three')
  ) ->> 'subject',
  '영어, 수학, 과학',
  'parent projection은 세 과목을 고정 순서로 요약한다'
);

update public.academic_subject_settings
set registration_create_enabled = false
where subject = '과학';

set local role authenticated;
select pg_temp.registration_science_set_actor(
  '83000000-0000-4000-8000-000000000001'
);

select ok(
  exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = pg_temp.registration_science_track('science_inquiry', '과학')
  ),
  'capability를 끈 뒤에도 기존 과학 track은 읽을 수 있다'
);

select lives_ok(
  (
    select pg_catalog.format(
      $sql$
        select public.update_registration_case_common(
          %L::uuid, '과학문의학생수정', '고1', '과학런타임고',
          '01083000001', null, '별관',
          '2026-07-22 09:00+09'::timestamptz,
          'capability off 일반정보 수정', 'normal', 1,
          'science-capability-off-common-update'
        )
      $sql$,
      pg_temp.registration_science_task('science_inquiry')
    )
  ),
  'capability off는 기존 과학 case의 일반 정보 수정을 막지 않는다'
);

select ok(
  pg_temp.registration_science_throws(
    (
      select pg_catalog.format(
        $sql$
          select public.update_registration_case_common(
            %L::uuid, '과학문의학생수정', '중3', '과학런타임중',
            '01083000001', null, '별관',
            '2026-07-22 09:00+09'::timestamptz,
            '과학 중등 변경 거부', 'normal', 2,
            'science-common-middle-rejected'
          )
        $sql$,
        pg_temp.registration_science_task('science_inquiry')
      )
    ),
    'registration_science_grade_invalid'
  ),
  '기존 과학 track을 둔 채 공통 학년을 중등으로 바꿀 수 없다'
);

select ok(
  pg_temp.registration_science_throws(
    $sql$
      select public.create_registration_case(
        '과학기능꺼짐', '고1', '과학런타임고', '01083000013', null,
        '별관', '2026-07-22 11:20+09'::timestamptz,
        array['과학'], null, 'normal', 'science-disabled-create'
      )
    $sql$,
    'registration_subject_disabled'
  ),
  'capability off 이후 신규 과학 case는 거부된다'
);

insert into registration_science_cases(case_key, payload)
select 'capability_sync_base', public.create_registration_case(
  '기능꺼짐동기화', '고1', '과학런타임고', '01083000014', null,
  '별관', '2026-07-22 11:30+09'::timestamptz,
  array['영어', '수학'], null, 'normal', 'science-disabled-sync-base'
);

select ok(
  pg_temp.registration_science_throws(
    (
      select pg_catalog.format(
        $sql$
          select public.sync_registration_case_subjects(
            %L::uuid, array['영어', '수학', '과학'],
            'science-disabled-sync-add'
          )
        $sql$,
        pg_temp.registration_science_task('capability_sync_base')
      )
    ),
    'registration_subject_disabled'
  ),
  'capability off 이후 sync로 과학 track을 새로 추가할 수 없다'
);

select ok(
  pg_temp.registration_science_throws(
    (
      select pg_catalog.format(
        $sql$
          insert into public.ops_registration_subject_tracks(
            task_id, subject, pipeline_status, migration_review_required
          ) values (%L::uuid, '과학', 'inquiry', false)
        $sql$,
        pg_temp.registration_science_task('capability_sync_base')
      )
    ),
    'permission denied|row-level security'
  ),
  'authenticated는 RPC를 우회해 과학 track을 직접 쓸 수 없다'
);

select * from finish();
rollback;
