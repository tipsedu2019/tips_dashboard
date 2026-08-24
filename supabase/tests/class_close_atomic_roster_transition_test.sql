begin;

select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';
set local role postgres;

select has_function(
  'public',
  'close_class_atomic_v1',
  array['uuid', 'uuid'],
  'atomic class-close RPC keeps its exact public signature'
);

select function_returns(
  'public',
  'close_class_atomic_v1',
  array['uuid', 'uuid'],
  'jsonb',
  'atomic class-close RPC returns jsonb'
);

select ok(
  (
    select
      procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and language.lanname = 'plpgsql'
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any (
        array['search_path=', 'search_path=""']::text[]
      )
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
    where procedure.oid =
      'public.close_class_atomic_v1(uuid,uuid)'::pg_catalog.regprocedure
  ),
  'atomic class-close RPC is postgres-owned PL/pgSQL SECURITY DEFINER with an empty search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.close_class_atomic_v1(uuid,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'public',
    'public.close_class_atomic_v1(uuid,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.close_class_atomic_v1(uuid,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.close_class_atomic_v1(uuid,uuid)',
    'EXECUTE'
  ),
  'atomic class-close RPC is executable only by authenticated callers'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.close_class_atomic_v1(uuid,uuid)'::pg_catalog.regprocedure
    ),
    '40001'
  ) = 0,
  'class-close domain conflicts are never mislabeled as serialization failures'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.close_class_atomic_v1(uuid,uuid)'::pg_catalog.regprocedure
    ),
    $contract$raise exception 'class_close_refresh_required' using errcode = '23514'$contract$
  ) > 0,
  'a changed lock snapshot uses the decisive class-close refresh contract'
);

insert into auth.users(
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '87000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'class-close-admin@runtime.invalid',
  crypt('class-close-runtime-only', gen_salt('bf')),
  pg_catalog.now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"class-close-atomic-roster-transition"}'::jsonb,
  pg_catalog.now(),
  pg_catalog.now()
);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '87000000-0000-4000-8000-000000000001',
  'admin',
  '종강 원자성 관리자',
  'class-close-admin@runtime.invalid',
  pg_catalog.now(),
  pg_catalog.now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

create or replace function pg_temp.class_close_set_actor(p_actor_id uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor_id::text,
      'role', 'authenticated',
      'email', (
        select profile.email
        from public.profiles profile
        where profile.id = p_actor_id
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

select pg_catalog.set_config('app.class_close_mutation', 'v1', true);

insert into public.classes(
  id,
  name,
  class_type,
  subject,
  grade,
  teacher,
  schedule,
  room,
  capacity,
  fee,
  status,
  student_ids,
  waitlist_ids,
  textbook_ids,
  lessons,
  schedule_storage_mode,
  schedule_plan
)
values
  (
    '87000000-0000-4000-8000-000000000101',
    '원자적 종강 대상반',
    '정규',
    '영어',
    '중1',
    '종강 교사',
    '월 18:00',
    '본관 1강의실',
    12,
    100000,
    '수강',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'legacy',
    '{"sessions":[{"date":"2026-08-25","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000102',
    '종강 후 유지할 다른 반',
    '정규',
    '영어',
    '중1',
    '종강 교사',
    '수 18:00',
    '본관 2강의실',
    12,
    100000,
    '수강',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'legacy',
    '{"sessions":[{"date":"2026-08-27","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000103',
    '미처리 입학 예정 종강 차단반',
    '정규',
    '영어',
    '중1',
    '종강 교사',
    '금 18:00',
    '본관 3강의실',
    12,
    100000,
    '수강',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'legacy',
    '{"sessions":[{"date":"2026-08-29","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000104',
    '열린 입학 배치 종강 차단반',
    '정규',
    '영어',
    '중1',
    '종강 교사',
    '토 18:00',
    '본관 4강의실',
    12,
    100000,
    '수강',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'legacy',
    '{"sessions":[{"date":"2026-08-30","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000106',
    '레거시 종강 마감 보정반',
    '정규',
    '영어',
    '중1',
    '종강 교사',
    '일 18:00',
    '본관 5강의실',
    12,
    100000,
    '종강',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'legacy',
    '{"sessions":[]}'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000108',
    '레거시 종강 연결 보정반',
    '정규',
    '영어',
    '중1',
    '종강 교사',
    '일 20:00',
    '본관 7강의실',
    12,
    100000,
    '수강',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'legacy',
    '{"sessions":[]}'::jsonb
  );

select pg_catalog.set_config('app.class_close_mutation', '', true);

insert into public.students(
  id,
  name,
  uid,
  school,
  grade,
  contact,
  parent_contact,
  status,
  class_ids,
  waitlist_class_ids
)
values
  (
    '87000000-0000-4000-8000-000000000201',
    '종강 재원 수강생',
    'class-close-enrolled',
    '원자중',
    '중1',
    '01087000201',
    '01087000101',
    '재원',
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000202',
    '종강 재원 대기생',
    'class-close-waitlist',
    '원자중',
    '중1',
    '01087000202',
    '01087000102',
    '재원',
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000203',
    '종강 재원 레거시생',
    'class-close-legacy',
    '원자중',
    '중1',
    '01087000203',
    '01087000103',
    '재원',
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000204',
    '열린 배치 재원생',
    'class-close-open-batch',
    '원자중',
    '중1',
    '01087000204',
    '01087000104',
    '재원',
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    '87000000-0000-4000-8000-000000000206',
    '레거시 종강 연결 수강생',
    'class-close-legacy-linked',
    '원자중',
    '중1',
    '01087000206',
    '01087000106',
    '재원',
    '[]'::jsonb,
    '[]'::jsonb
  );

select pg_temp.class_close_set_actor('87000000-0000-4000-8000-000000000001');
set local role authenticated;

select public.set_student_class_roster_mode(
  '87000000-0000-4000-8000-000000000201',
  '87000000-0000-4000-8000-000000000101',
  'enrolled',
  'removed',
  'class-close-fixture-target-enrolled'
);
select public.set_student_class_roster_mode(
  '87000000-0000-4000-8000-000000000201',
  '87000000-0000-4000-8000-000000000102',
  'enrolled',
  'removed',
  'class-close-fixture-other-class'
);
select public.set_student_class_roster_mode(
  '87000000-0000-4000-8000-000000000202',
  '87000000-0000-4000-8000-000000000101',
  'waitlist',
  'removed',
  'class-close-fixture-target-waitlist'
);
select public.set_student_class_roster_mode(
  '87000000-0000-4000-8000-000000000203',
  '87000000-0000-4000-8000-000000000101',
  'enrolled',
  'removed',
  'class-close-fixture-target-legacy'
);
select public.set_student_class_roster_mode(
  '87000000-0000-4000-8000-000000000204',
  '87000000-0000-4000-8000-000000000104',
  'enrolled',
  'removed',
  'class-close-fixture-open-batch'
);
select public.set_student_class_roster_mode(
  '87000000-0000-4000-8000-000000000206',
  '87000000-0000-4000-8000-000000000108',
  'enrolled',
  'removed',
  'class-close-fixture-legacy-linked'
);

set local role postgres;

select pg_catalog.set_config('app.class_close_mutation', 'v1', true);
update public.classes
set status = '종강'
where id = '87000000-0000-4000-8000-000000000108';
select pg_catalog.set_config('app.class_close_mutation', '', true);

insert into public.ops_tasks(
  id,
  title,
  type,
  status,
  requested_by,
  student_name,
  subject,
  priority
)
values
  (
    '87000000-0000-4000-8000-000000000301',
    '종강 원자성 수강 등록',
    'registration',
    'done',
    '87000000-0000-4000-8000-000000000001',
    '종강 재원 수강생',
    '영어',
    'normal'
  ),
  (
    '87000000-0000-4000-8000-000000000302',
    '종강 원자성 대기 등록',
    'registration',
    'in_progress',
    '87000000-0000-4000-8000-000000000001',
    '종강 재원 대기생',
    '영어',
    'normal'
  ),
  (
    '87000000-0000-4000-8000-000000000303',
    '종강 예정 차단 등록',
    'registration',
    'in_progress',
    '87000000-0000-4000-8000-000000000001',
    '종강 예정 차단 학생',
    '영어',
    'normal'
  ),
  (
    '87000000-0000-4000-8000-000000000304',
    '종강 열린 배치 차단 등록',
    'registration',
    'in_progress',
    '87000000-0000-4000-8000-000000000001',
    '열린 배치 재원생',
    '영어',
    'normal'
  );

insert into public.ops_registration_details(
  task_id,
  inquiry_at,
  school_grade,
  school_name,
  parent_phone,
  student_phone,
  common_revision,
  admission_notice_sent
)
values
  (
    '87000000-0000-4000-8000-000000000301',
    '2026-08-20 09:01+09',
    '중1',
    '원자중',
    '01087000101',
    '01087000201',
    1,
    false
  ),
  (
    '87000000-0000-4000-8000-000000000302',
    '2026-08-20 09:02+09',
    '중1',
    '원자중',
    '01087000102',
    '01087000202',
    1,
    false
  ),
  (
    '87000000-0000-4000-8000-000000000303',
    '2026-08-20 09:03+09',
    '중1',
    '원자중',
    '01087000103',
    null,
    1,
    false
  ),
  (
    '87000000-0000-4000-8000-000000000304',
    '2026-08-20 09:04+09',
    '중1',
    '원자중',
    '01087000104',
    '01087000204',
    1,
    false
  );

insert into public.ops_registration_subject_tracks(
  id,
  task_id,
  subject,
  pipeline_status,
  waiting_kind,
  migration_review_required
)
values
  (
    '87000000-0000-4000-8000-000000000401',
    '87000000-0000-4000-8000-000000000301',
    '영어',
    'registered',
    null,
    false
  ),
  (
    '87000000-0000-4000-8000-000000000402',
    '87000000-0000-4000-8000-000000000302',
    '영어',
    'waiting',
    'current_class',
    false
  ),
  (
    '87000000-0000-4000-8000-000000000403',
    '87000000-0000-4000-8000-000000000303',
    '영어',
    'enrollment_processing',
    null,
    false
  ),
  (
    '87000000-0000-4000-8000-000000000404',
    '87000000-0000-4000-8000-000000000304',
    '영어',
    'enrollment_processing',
    null,
    false
  );

insert into public.ops_registration_admission_batches(
  id,
  task_id,
  revision_number,
  status,
  invoice_sent_at,
  payment_confirmed_at
)
values
  (
    '87000000-0000-4000-8000-000000000501',
    '87000000-0000-4000-8000-000000000301',
    1,
    'completed',
    '2026-08-21 10:00+09',
    '2026-08-21 11:00+09'
  ),
  (
    '87000000-0000-4000-8000-000000000502',
    '87000000-0000-4000-8000-000000000304',
    1,
    'draft',
    null,
    null
  );

insert into public.ops_registration_enrollments(
  id,
  track_id,
  student_id,
  admission_batch_id,
  class_id,
  class_start_date,
  class_start_session_key,
  class_start_session,
  status,
  roster_active,
  sort_order
)
values
  (
    '87000000-0000-4000-8000-000000000601',
    '87000000-0000-4000-8000-000000000401',
    '87000000-0000-4000-8000-000000000201',
    '87000000-0000-4000-8000-000000000501',
    '87000000-0000-4000-8000-000000000101',
    '2026-08-25',
    '2026-08-25:1',
    '1회차',
    'enrolled',
    true,
    0
  ),
  (
    '87000000-0000-4000-8000-000000000602',
    '87000000-0000-4000-8000-000000000402',
    '87000000-0000-4000-8000-000000000202',
    null,
    '87000000-0000-4000-8000-000000000101',
    null,
    null,
    null,
    'waitlisted',
    true,
    0
  ),
  (
    '87000000-0000-4000-8000-000000000603',
    '87000000-0000-4000-8000-000000000403',
    null,
    null,
    '87000000-0000-4000-8000-000000000103',
    null,
    null,
    null,
    'planned',
    false,
    0
  ),
  (
    '87000000-0000-4000-8000-000000000604',
    '87000000-0000-4000-8000-000000000404',
    '87000000-0000-4000-8000-000000000204',
    '87000000-0000-4000-8000-000000000502',
    '87000000-0000-4000-8000-000000000104',
    '2026-08-30',
    '2026-08-30:1',
    '1회차',
    'enrolled',
    true,
    0
  );

create temporary table class_close_history_before
on commit drop
as
select history.id
from public.student_class_enrollment_history history
where history.class_id = '87000000-0000-4000-8000-000000000101';

grant select on table class_close_history_before to authenticated;

select is(
  (select pg_catalog.count(*) from class_close_history_before),
  3::bigint,
  'fixture starts with one immutable roster history row for every target student'
);

set local role authenticated;
select pg_temp.class_close_set_actor('87000000-0000-4000-8000-000000000001');

select throws_ok(
  $$
    update public.classes
    set status = '종강'
    where id = '87000000-0000-4000-8000-000000000101'
  $$,
  '42501',
  'class_close_requires_rpc',
  'a raw class status update cannot bypass the atomic close gateway'
);

select throws_ok(
  $$
    select public.close_class_atomic_v1(
      '87000000-0000-4000-8000-000000000103',
      '87000000-0000-4000-8000-000000000702'
    )
  $$,
  '23514',
  'class_close_open_admission_batch',
  'an unmaterialized planned enrollment blocks class close'
);

select throws_ok(
  $$
    select public.close_class_atomic_v1(
      '87000000-0000-4000-8000-000000000104',
      '87000000-0000-4000-8000-000000000703'
    )
  $$,
  '23514',
  'class_close_open_admission_batch',
  'an open admission batch blocks class close'
);

select ok(
  (
    select pg_catalog.bool_and(class.status = '수강' and class.closed_at is null)
    from public.classes class
    where class.id in (
      '87000000-0000-4000-8000-000000000103',
      '87000000-0000-4000-8000-000000000104'
    )
  )
  and (
    select enrollment.roster_active
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '87000000-0000-4000-8000-000000000604'
  ),
  'refused closes leave class state and active enrollment claims untouched'
);

select throws_ok(
  $$
    select public.close_class_atomic_v1(
      '87000000-0000-4000-8000-000000009999',
      '87000000-0000-4000-8000-000000000704'
    )
  $$,
  'P0002',
  'class_close_not_found',
  'a missing class is a decisive not-found error'
);

select throws_ok(
  $$
    select public.set_student_class_roster_mode(
      '87000000-0000-4000-8000-000000000203',
      '87000000-0000-4000-8000-000000000106',
      'enrolled',
      'removed',
      'legacy-status-close-readd-must-fail'
    )
  $$,
  '23514',
  'class_roster_closed',
  'a legacy status-only closed class rejects roster re-add before finalization'
);

create temporary table legacy_class_close_response
on commit drop
as
select public.close_class_atomic_v1(
  '87000000-0000-4000-8000-000000000106',
  '87000000-0000-4000-8000-000000000707'
) as payload;

select ok(
  (
    select
      payload ->> 'status' = '종강'
      and (payload ->> 'removedStudentCount')::integer = 0
      and nullif(payload ->> 'closedAt', '') is not null
    from legacy_class_close_response
  )
  and (
    select
      class.status = '종강'
      and class.closed_at is not null
      and class.closed_by = '87000000-0000-4000-8000-000000000001'
    from public.classes class
    where class.id = '87000000-0000-4000-8000-000000000106'
  ),
  'a legacy status-only closed class is finalized without inventing roster transitions'
);

create temporary table legacy_linked_class_close_response
on commit drop
as
select public.close_class_atomic_v1(
  '87000000-0000-4000-8000-000000000108',
  '87000000-0000-4000-8000-000000000709'
) as payload;

select ok(
  (
    select
      (payload ->> 'removedStudentCount')::integer = 1
      and (payload ->> 'removedEnrolledCount')::integer = 1
    from legacy_linked_class_close_response
  )
  and (
    select
      class.status = '종강'
      and class.closed_at is not null
      and class.student_ids = '[]'::jsonb
    from public.classes class
    where class.id = '87000000-0000-4000-8000-000000000108'
  )
  and (
    select
      student.status = '재원'
      and not (student.class_ids ? '87000000-0000-4000-8000-000000000108')
    from public.students student
    where student.id = '87000000-0000-4000-8000-000000000206'
  ),
  'a legacy status-only closed class atomically removes its symmetric linked roster'
);

create temporary table class_close_first_response
on commit drop
as
select public.close_class_atomic_v1(
  '87000000-0000-4000-8000-000000000101',
  '87000000-0000-4000-8000-000000000701'
) as payload;

select ok(
  (
    select
      payload ?& array[
        'id',
        'classId',
        'status',
        'closedAt',
        'removedStudentCount',
        'removedEnrolledCount',
        'removedWaitlistCount',
        'releasedEnrollmentIds',
        'canceledWaitlistEnrollmentIds'
      ]
      and payload ->> 'id' = '87000000-0000-4000-8000-000000000101'
      and payload ->> 'classId' = '87000000-0000-4000-8000-000000000101'
      and payload ->> 'status' = '종강'
      and nullif(payload ->> 'closedAt', '') is not null
      and (payload ->> 'removedStudentCount')::integer = 3
      and (payload ->> 'removedEnrolledCount')::integer = 2
      and (payload ->> 'removedWaitlistCount')::integer = 1
      and payload -> 'releasedEnrollmentIds'
        = '["87000000-0000-4000-8000-000000000601"]'::jsonb
      and payload -> 'canceledWaitlistEnrollmentIds'
        = '["87000000-0000-4000-8000-000000000602"]'::jsonb
    from class_close_first_response
  ),
  'close response reports the exact class, counts, timestamp, and canonical claim transitions'
);

select ok(
  (
    select
      class.status = '종강'
      and class.closed_at is not null
      and class.closed_by = '87000000-0000-4000-8000-000000000001'
      and class.closed_at = (
        select (response.payload ->> 'closedAt')::timestamptz
        from class_close_first_response response
      )
      and class.student_ids = '[]'::jsonb
      and class.waitlist_ids = '[]'::jsonb
    from public.classes class
    where class.id = '87000000-0000-4000-8000-000000000101'
  ),
  'class close fields are written once and both class-side roster projections are cleared'
);

select ok(
  (
    select
      pg_catalog.count(*) = 3
      and pg_catalog.bool_and(student.status = '재원')
      and pg_catalog.bool_and(
        not (coalesce(student.class_ids, '[]'::jsonb)
          ? '87000000-0000-4000-8000-000000000101')
      )
      and pg_catalog.bool_and(
        not (coalesce(student.waitlist_class_ids, '[]'::jsonb)
          ? '87000000-0000-4000-8000-000000000101')
      )
    from public.students student
    where student.id in (
      '87000000-0000-4000-8000-000000000201',
      '87000000-0000-4000-8000-000000000202',
      '87000000-0000-4000-8000-000000000203'
    )
  ),
  'all student-side enrolled and waitlist projections are cleared without changing student lifecycle status'
);

select ok(
  (
    select
      student.class_ids ? '87000000-0000-4000-8000-000000000102'
      and not (
        student.waitlist_class_ids ? '87000000-0000-4000-8000-000000000102'
      )
    from public.students student
    where student.id = '87000000-0000-4000-8000-000000000201'
  )
  and (
    select class.student_ids ? '87000000-0000-4000-8000-000000000201'
    from public.classes class
    where class.id = '87000000-0000-4000-8000-000000000102'
  ),
  'closing one class preserves the same student connection to every unrelated active class'
);

select ok(
  (
    select
      enrollment.status = 'enrolled'
      and not enrollment.roster_active
      and enrollment.roster_released_at is not null
      and nullif(pg_catalog.btrim(enrollment.roster_release_reason), '') is not null
      and enrollment.roster_release_kind = 'class_close'
      and enrollment.roster_release_source_task_id is null
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '87000000-0000-4000-8000-000000000601'
  )
  and (
    select
      enrollment.status = 'canceled'
      and not enrollment.roster_active
      and enrollment.roster_released_at is null
      and enrollment.roster_release_reason is null
      and enrollment.roster_release_kind is null
      and enrollment.roster_release_source_task_id is null
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '87000000-0000-4000-8000-000000000602'
  )
  and not exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.class_id = '87000000-0000-4000-8000-000000000101'
      and enrollment.roster_active
  ),
  'enrolled claims are released, waitlist claims are canceled, and no active canonical claim remains'
);

select ok(
  not exists (
    select 1
    from class_close_history_before before_row
    left join public.student_class_enrollment_history history
      on history.id = before_row.id
    where history.id is null
  )
  and (
    select pg_catalog.count(*) = 3
    from public.student_class_enrollment_history history
    where history.class_id = '87000000-0000-4000-8000-000000000101'
      and history.id not in (select before_row.id from class_close_history_before before_row)
      and history.action = 'removed'
      and history.next_mode is null
      and history.changed_by = '87000000-0000-4000-8000-000000000001'
      and nullif(pg_catalog.btrim(history.memo), '') is not null
  )
  and exists (
    select 1
    from public.student_class_enrollment_history history
    where history.class_id = '87000000-0000-4000-8000-000000000101'
      and history.student_id = '87000000-0000-4000-8000-000000000201'
      and history.id not in (select before_row.id from class_close_history_before before_row)
      and history.previous_mode = 'enrolled'
  )
  and exists (
    select 1
    from public.student_class_enrollment_history history
    where history.class_id = '87000000-0000-4000-8000-000000000101'
      and history.student_id = '87000000-0000-4000-8000-000000000202'
      and history.id not in (select before_row.id from class_close_history_before before_row)
      and history.previous_mode = 'waitlist'
  )
  and exists (
    select 1
    from public.student_class_enrollment_history history
    where history.class_id = '87000000-0000-4000-8000-000000000101'
      and history.student_id = '87000000-0000-4000-8000-000000000203'
      and history.id not in (select before_row.id from class_close_history_before before_row)
      and history.previous_mode = 'enrolled'
  ),
  'prior enrollment history is preserved and one immutable removed transition is appended per affected student'
);

create temporary table class_close_replay_response
on commit drop
as
select public.close_class_atomic_v1(
  '87000000-0000-4000-8000-000000000101',
  '87000000-0000-4000-8000-000000000701'
) as payload;

select is(
  (select payload from class_close_replay_response),
  (select payload from class_close_first_response),
  'replaying the same request key returns the exact stored response'
);

select is(
  (
    select pg_catalog.count(*)
    from public.student_class_enrollment_history history
    where history.class_id = '87000000-0000-4000-8000-000000000101'
      and history.id not in (select before_row.id from class_close_history_before before_row)
  ),
  3::bigint,
  'request replay does not duplicate class-close history'
);

select throws_ok(
  $$
    select public.close_class_atomic_v1(
      '87000000-0000-4000-8000-000000000101',
      '87000000-0000-4000-8000-000000000705'
    )
  $$,
  '23514',
  'class_already_closed',
  'a closed class rejects a different close request key'
);

select throws_ok(
  $$
    select public.set_student_class_roster_mode(
      '87000000-0000-4000-8000-000000000203',
      '87000000-0000-4000-8000-000000000101',
      'enrolled',
      'removed',
      'closed-class-readd-must-fail'
    )
  $$,
  '23514',
  'class_roster_closed',
  'the canonical roster gateway cannot reconnect a student to a closed class'
);

select ok(
  not (
    select student.class_ids ? '87000000-0000-4000-8000-000000000101'
      or student.waitlist_class_ids ? '87000000-0000-4000-8000-000000000101'
    from public.students student
    where student.id = '87000000-0000-4000-8000-000000000203'
  )
  and not (
    select class.student_ids ? '87000000-0000-4000-8000-000000000203'
      or class.waitlist_ids ? '87000000-0000-4000-8000-000000000203'
    from public.classes class
    where class.id = '87000000-0000-4000-8000-000000000101'
  ),
  'failed closed-class re-add rolls back both sides of the attempted projection change'
);

set local role postgres;

insert into public.classes(
  id,
  name,
  class_type,
  subject,
  grade,
  teacher,
  schedule,
  room,
  capacity,
  fee,
  status,
  student_ids,
  waitlist_ids,
  textbook_ids,
  lessons,
  schedule_storage_mode,
  schedule_plan
)
values (
  '87000000-0000-4000-8000-000000000105',
  '비대칭 명단 종강 차단반',
  '정규',
  '영어',
  '중1',
  '종강 교사',
  '일 18:00',
  '본관 5강의실',
  12,
  100000,
  '수강',
  '["87000000-0000-4000-8000-000000000202"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'legacy',
  '{"sessions":[{"date":"2026-08-31","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
);

insert into public.classes(
  id,
  name,
  class_type,
  subject,
  grade,
  teacher,
  schedule,
  room,
  capacity,
  fee,
  status,
  student_ids,
  waitlist_ids,
  textbook_ids,
  lessons,
  schedule_storage_mode,
  schedule_plan
)
values (
  '87000000-0000-4000-8000-000000000107',
  '학생측 비대칭 종강 차단반',
  '정규',
  '영어',
  '중1',
  '종강 교사',
  '일 19:00',
  '본관 6강의실',
  12,
  100000,
  '수강',
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'legacy',
  '{"sessions":[]}'::jsonb
);

insert into public.students(
  id,
  name,
  uid,
  school,
  grade,
  contact,
  parent_contact,
  status,
  class_ids,
  waitlist_class_ids
)
values (
  '87000000-0000-4000-8000-000000000205',
  '학생측 비대칭 수강생',
  'class-close-reverse-only',
  '원자중',
  '중1',
  '01087000205',
  '01087000105',
  '재원',
  '["87000000-0000-4000-8000-000000000107"]'::jsonb,
  '[]'::jsonb
);

set local role authenticated;
select pg_temp.class_close_set_actor('87000000-0000-4000-8000-000000000001');

select throws_ok(
  $$
    select public.close_class_atomic_v1(
      '87000000-0000-4000-8000-000000000105',
      '87000000-0000-4000-8000-000000000706'
    )
  $$,
  '23514',
  'class_close_roster_invalid',
  'an asymmetric legacy projection fails closed instead of losing roster history'
);

select ok(
  (
    select
      class.status = '수강'
      and class.closed_at is null
      and class.student_ids
        = '["87000000-0000-4000-8000-000000000202"]'::jsonb
    from public.classes class
    where class.id = '87000000-0000-4000-8000-000000000105'
  ),
  'invalid-roster refusal leaves the source class unchanged for operator repair'
);

select throws_ok(
  $$
    select public.close_class_atomic_v1(
      '87000000-0000-4000-8000-000000000107',
      '87000000-0000-4000-8000-000000000708'
    )
  $$,
  '23514',
  'class_close_roster_invalid',
  'a student-side-only legacy projection fails closed instead of leaving a closed-class link'
);

select ok(
  (
    select class.status = '수강' and class.closed_at is null
    from public.classes class
    where class.id = '87000000-0000-4000-8000-000000000107'
  )
  and (
    select student.class_ids ? '87000000-0000-4000-8000-000000000107'
    from public.students student
    where student.id = '87000000-0000-4000-8000-000000000205'
  ),
  'student-side invalid-roster refusal leaves both asymmetric projections unchanged'
);

select * from finish();
rollback;
