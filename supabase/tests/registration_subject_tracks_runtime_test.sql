begin;
select plan(150);

-- This packet is intentionally self-contained and transaction-scoped. It is run only
-- against a disposable local/preview database after both registration migrations have
-- been applied. All catalog, auth, workflow, and audit fixtures are fixed and roll back.
set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

create temporary table registration_runtime_ids (
  key text primary key,
  id uuid not null
) on commit drop;

insert into registration_runtime_ids(key, id) values
  ('management_admin',  '00000000-0000-4000-8000-000000000101'),
  ('assigned_director', '00000000-0000-4000-8000-000000000102'),
  ('sibling_director',  '00000000-0000-4000-8000-000000000103'),
  ('staff',             '00000000-0000-4000-8000-000000000104'),
  ('assistant',         '00000000-0000-4000-8000-000000000105'),
  ('teacher',           '00000000-0000-4000-8000-000000000106'),
  ('student',           '00000000-0000-4000-8000-000000000201'),
  ('student_unused',    '00000000-0000-4000-8000-000000000202'),
  ('student_withdrawn', '00000000-0000-4000-8000-000000000203'),
  ('english_class',     '00000000-0000-4000-8000-000000000301'),
  ('english_class_2',   '00000000-0000-4000-8000-000000000302'),
  ('math_class',        '00000000-0000-4000-8000-000000000303'),
  ('english_textbook',  '00000000-0000-4000-8000-000000000401'),
  ('math_textbook',     '00000000-0000-4000-8000-000000000402'),
  ('main_case',         '00000000-0000-4000-8000-000000000501'),
  ('legacy_case',       '00000000-0000-4000-8000-000000000502'),
  ('guard_case',        '00000000-0000-4000-8000-000000000503'),
  ('message_case',      '00000000-0000-4000-8000-000000000504'),
  ('withdrawal_task',   '00000000-0000-4000-8000-000000000505'),
  ('transfer_task',     '00000000-0000-4000-8000-000000000506');

grant select, update on table registration_runtime_ids to authenticated;

-- Fixed auth users. The labels below are part of the role matrix reviewed with this
-- packet: management admin, assigned admin director, sibling admin director, staff,
-- assistant, and ordinary teacher.
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select
  fixture.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  fixture.key || '@registration-runtime.invalid',
  crypt('registration-runtime-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('fixture', 'registration-subject-tracks-runtime'),
  now(), now()
from registration_runtime_ids fixture
where fixture.key in (
  'management_admin', 'assigned_director', 'sibling_director',
  'staff', 'assistant', 'teacher'
);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000101', 'admin', '런타임 관리 원장', 'management_admin@registration-runtime.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000102', 'admin', '강부희', 'assigned_director@registration-runtime.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000103', 'admin', '정보영', 'sibling_director@registration-runtime.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000104', 'staff', '런타임 관리팀', 'staff@registration-runtime.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000105', 'assistant', '런타임 조교', 'assistant@registration-runtime.invalid', now(), now()),
  ('00000000-0000-4000-8000-000000000106', 'teacher', '런타임 일반교사', 'teacher@registration-runtime.invalid', now(), now())
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

-- The auth signup trigger creates and links a catalog for every inserted auth user.
-- Remove only this packet's trigger-created links before installing deterministic IDs.
update public.profiles
set teacher_catalog_id = null,
    updated_at = now()
where id in (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000105',
  '00000000-0000-4000-8000-000000000106'
);
delete from public.teacher_catalogs
where profile_id in (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000105',
  '00000000-0000-4000-8000-000000000106'
);

-- A disposable database may also contain the real director names. Shadow those rows
-- transactionally so the resolver has exactly one fixed actor for each fixture name.
update public.teacher_catalogs
set name = name || ' [runtime-shadow-' || left(id::text, 8) || ']'
where name in ('강부희', '정보영', '런타임 일반교사');

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role
)
values
  ('00000000-0000-4000-8000-000000000111', '강부희', array['영어'], true, 9001, '00000000-0000-4000-8000-000000000102', 'assigned_director@registration-runtime.invalid', 'admin'),
  ('00000000-0000-4000-8000-000000000112', '정보영', array['영어'], true, 9002, '00000000-0000-4000-8000-000000000103', 'sibling_director@registration-runtime.invalid', 'admin'),
  ('00000000-0000-4000-8000-000000000113', '런타임 일반교사', array['영어'], true, 9003, '00000000-0000-4000-8000-000000000106', 'teacher@registration-runtime.invalid', 'teacher');

update public.profiles profile
set teacher_catalog_id = fixture.teacher_catalog_id,
    updated_at = now()
from (
  values
    ('00000000-0000-4000-8000-000000000102'::uuid, '00000000-0000-4000-8000-000000000111'::uuid),
    ('00000000-0000-4000-8000-000000000103'::uuid, '00000000-0000-4000-8000-000000000112'::uuid),
    ('00000000-0000-4000-8000-000000000106'::uuid, '00000000-0000-4000-8000-000000000113'::uuid)
) fixture(profile_id, teacher_catalog_id)
where profile.id = fixture.profile_id;

insert into public.textbooks(
  id, title, name, subject, school_level, grade_level, school_levels, grade_levels,
  sub_subject, publisher, price, tags, lessons, status
)
values
  (
    '00000000-0000-4000-8000-000000000401', '런타임 영어 교재', '런타임 영어 교재',
    'english', 'middle', 'm1', array['middle']::text[], array['m1', 'm2', 'm3']::text[],
    '기타', '런타임', 10000, '{}'::text[], '[]'::jsonb, 'active'
  ),
  (
    '00000000-0000-4000-8000-000000000402', '런타임 수학 교재', '런타임 수학 교재',
    'math', 'middle', 'm1', array['middle']::text[], array['m1', 'm2', 'm3']::text[],
    '기타', '런타임', 10000, '{}'::text[], '[]'::jsonb, 'active'
  );

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_plan
)
values
  ('00000000-0000-4000-8000-000000000301', '런타임 영어 A', '정규', '영어', '중1', '강부희', '월 18:00', '본관', 12, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '["00000000-0000-4000-8000-000000000401"]'::jsonb, '[]'::jsonb, '{"sessions":[{"date":"2026-07-20","sessionNumber":1,"scheduleState":"active"}]}'::jsonb),
  ('00000000-0000-4000-8000-000000000302', '런타임 영어 B', '정규', '영어', '중1', '강부희', '수 18:00', '별관', 12, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '["00000000-0000-4000-8000-000000000401"]'::jsonb, '[]'::jsonb, '{"sessions":[{"date":"2026-07-22","sessionNumber":1,"scheduleState":"active"}]}'::jsonb),
  ('00000000-0000-4000-8000-000000000303', '런타임 수학 A', '정규', '수학', '중1', '강정은', '화 18:00', '본관', 12, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '["00000000-0000-4000-8000-000000000402"]'::jsonb, '[]'::jsonb, '{"sessions":[{"date":"2026-07-21","sessionNumber":1,"scheduleState":"active"}]}'::jsonb);

insert into public.students(
  id, name, uid, school, grade, contact, parent_contact, status,
  class_ids, waitlist_class_ids
)
values
  ('00000000-0000-4000-8000-000000000201', '런타임학생', 'runtime-student', '런타임중', '중1', '01000002001', '01000001001', '재원', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000202', '런타임미사용', 'runtime-unused', '런타임중', '중1', '01000002002', '01000001002', '재원', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000203', '런타임퇴원', 'runtime-withdrawn', '런타임중', '중1', '01000002003', '01000001003', '퇴원', '[]'::jsonb, '[]'::jsonb);

-- Seed only legacy/review and cross-workflow parents directly as postgres. Ready-version
-- cases are always created through the public RPC below.
insert into public.ops_tasks(
  id, title, type, status, requested_by, student_name, subject, priority
)
values
  ('00000000-0000-4000-8000-000000000502', '런타임 레거시 검토', 'registration', 'done', '00000000-0000-4000-8000-000000000101', '레거시학생', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000503', '런타임 가드', 'general', 'requested', '00000000-0000-4000-8000-000000000101', '가드학생', null, 'normal'),
  ('00000000-0000-4000-8000-000000000504', '런타임 메시지', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지학생', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000505', '런타임 퇴원', 'withdrawal', 'requested', '00000000-0000-4000-8000-000000000101', '런타임학생', null, 'normal'),
  ('00000000-0000-4000-8000-000000000506', '런타임 전반', 'transfer', 'requested', '00000000-0000-4000-8000-000000000101', '런타임학생', null, 'normal');

insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone,
  student_phone, common_revision, admission_notice_sent
)
values
  ('00000000-0000-4000-8000-000000000502', '2026-07-13 09:00+09', '중1', '런타임중', '01000001502', '01000002502', 1, false),
  ('00000000-0000-4000-8000-000000000504', '2026-07-13 09:00+09', '중1', '런타임중', '01000001504', '01000002504', 1, false);

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, migration_review_required
)
values
  ('00000000-0000-4000-8000-000000000512', '00000000-0000-4000-8000-000000000502', '영어', 'migration_review', true),
  ('00000000-0000-4000-8000-000000000514', '00000000-0000-4000-8000-000000000504', '영어', 'enrollment_decided', false);

create or replace function pg_temp.registration_set_actor(p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (select email from public.profiles where id = p_actor)
    )::text,
    true
  );
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create temporary table registration_runtime_observations (
  assertion_number integer primary key,
  passed boolean not null,
  evidence jsonb not null default '{}'::jsonb
) on commit drop;

grant select, insert, update on table registration_runtime_observations
  to authenticated;

create or replace function pg_temp.registration_record(
  p_number integer,
  p_passed boolean,
  p_evidence jsonb default '{}'::jsonb
)
returns void
language sql
as $$
  insert into registration_runtime_observations(assertion_number, passed, evidence)
  values (p_number, coalesce(p_passed, false), coalesce(p_evidence, '{}'::jsonb))
  on conflict (assertion_number) do update
  set passed = excluded.passed,
      evidence = excluded.evidence;
$$;

create or replace function pg_temp.registration_has_trigger(p_name text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from pg_trigger
    where tgname = p_name and not tgisinternal
  );
$$;

create or replace function pg_temp.registration_global_roster_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (student.class_ids), (student.waitlist_class_ids)
    ) projection(value)
    where projection.value is not null
      and pg_catalog.jsonb_typeof(projection.value) is distinct from 'array'
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (class.student_ids), (class.waitlist_ids)
    ) projection(value)
    where projection.value is not null
      and pg_catalog.jsonb_typeof(projection.value) is distinct from 'array'
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (coalesce(student.class_ids, '[]'::jsonb)),
             (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral pg_catalog.jsonb_array_elements(projection.value) element(value)
    where pg_catalog.jsonb_typeof(element.value) <> 'string'
      or (element.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (coalesce(class.student_ids, '[]'::jsonb)),
             (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral pg_catalog.jsonb_array_elements(projection.value) element(value)
    where pg_catalog.jsonb_typeof(element.value) <> 'string'
      or (element.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (coalesce(student.class_ids, '[]'::jsonb)),
             (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral pg_catalog.jsonb_array_elements(projection.value) element(value)
    where element.value #>> '{}' is distinct from ((element.value #>> '{}')::uuid)::text
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (coalesce(class.student_ids, '[]'::jsonb)),
             (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral pg_catalog.jsonb_array_elements(projection.value) element(value)
    where element.value #>> '{}' is distinct from ((element.value #>> '{}')::uuid)::text
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (coalesce(student.class_ids, '[]'::jsonb)),
             (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    where pg_catalog.jsonb_array_length(projection.value) <> (
      select pg_catalog.count(distinct ((element.value #>> '{}')::uuid)::text)
      from pg_catalog.jsonb_array_elements(projection.value) element(value)
    )
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (coalesce(class.student_ids, '[]'::jsonb)),
             (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    where pg_catalog.jsonb_array_length(projection.value) <> (
      select pg_catalog.count(distinct ((element.value #>> '{}')::uuid)::text)
      from pg_catalog.jsonb_array_elements(projection.value) element(value)
    )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (coalesce(student.class_ids, '[]'::jsonb)),
             (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    where projection.value is distinct from (
      select coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
        '[]'::jsonb
      )
      from (
        select ((element.value #>> '{}')::uuid)::text as value
        from pg_catalog.jsonb_array_elements(projection.value) element(value)
      ) canonical
    )
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (coalesce(class.student_ids, '[]'::jsonb)),
             (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    where projection.value is distinct from (
      select coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
        '[]'::jsonb
      )
      from (
        select ((element.value #>> '{}')::uuid)::text as value
        from pg_catalog.jsonb_array_elements(projection.value) element(value)
      ) canonical
    )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(student.class_ids, '[]'::jsonb)
    ) element(value)
    left join public.classes class on class.id = (element.value #>> '{}')::uuid
    where class.id is null
      or not (coalesce(class.student_ids, '[]'::jsonb) ? student.id::text)
      or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? class.id::text
      or coalesce(class.waitlist_ids, '[]'::jsonb) ? student.id::text
  ) or exists (
    select 1
    from public.students student
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(student.waitlist_class_ids, '[]'::jsonb)
    ) element(value)
    left join public.classes class on class.id = (element.value #>> '{}')::uuid
    where class.id is null
      or not (coalesce(class.waitlist_ids, '[]'::jsonb) ? student.id::text)
      or coalesce(student.class_ids, '[]'::jsonb) ? class.id::text
      or coalesce(class.student_ids, '[]'::jsonb) ? student.id::text
  ) or exists (
    select 1
    from public.classes class
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(class.student_ids, '[]'::jsonb)
    ) element(value)
    left join public.students student on student.id = (element.value #>> '{}')::uuid
    where student.id is null
      or not (coalesce(student.class_ids, '[]'::jsonb) ? class.id::text)
      or coalesce(class.waitlist_ids, '[]'::jsonb) ? student.id::text
      or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? class.id::text
  ) or exists (
    select 1
    from public.classes class
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(class.waitlist_ids, '[]'::jsonb)
    ) element(value)
    left join public.students student on student.id = (element.value #>> '{}')::uuid
    where student.id is null
      or not (coalesce(student.waitlist_class_ids, '[]'::jsonb) ? class.id::text)
      or coalesce(class.student_ids, '[]'::jsonb) ? student.id::text
      or coalesce(student.class_ids, '[]'::jsonb) ? class.id::text
  ) then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function pg_temp.registration_missing_observation(p_number integer)
returns boolean
language plpgsql
immutable
as $$
begin
  raise exception 'registration_runtime_observation_missing:%', p_number;
end;
$$;

create or replace function pg_temp.registration_contract(p_number integer)
returns boolean
language plpgsql
stable
as $$
declare
  v_observed boolean;
begin
  select observation.passed
  into v_observed
  from registration_runtime_observations observation
  where observation.assertion_number = p_number;
  if found then
    return v_observed;
  end if;

  return case p_number
    when 14 then not exists (
      select 1
      from public.ops_tasks task
      left join public.ops_registration_subject_tracks track on track.task_id = task.id
      where task.type = 'registration'
        and public.registration_subject_tracks_runtime_version() = 1
      group by task.id
      having count(track.id) = 0
    )
    when 15 then public.registration_subject_tracks_runtime_version() = 1
      and pg_temp.registration_global_roster_ready()
    when 69 then not has_table_privilege(
      'authenticated', 'public.student_class_enrollment_history', 'TRUNCATE'
    )
    when 150 then has_column_privilege(
        'authenticated', 'public.ops_registration_messages', 'status', 'SELECT'
      )
      and has_column_privilege(
        'authenticated', 'public.ops_registration_messages', 'claim_active', 'SELECT'
      )
      and not has_column_privilege(
        'authenticated', 'public.ops_registration_messages', 'recipient_last4', 'SELECT'
      )
      and not has_column_privilege(
        'authenticated', 'public.ops_registration_messages', 'provider_message_id', 'SELECT'
      )
      and not has_column_privilege(
        'authenticated', 'public.ops_registration_messages', 'error_message', 'SELECT'
      )
    else pg_temp.registration_missing_observation(p_number)
  end;
end;
$$;

-- Authenticated RPC fixture creation. The RPC owns the ready parent/detail/children.
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

create temporary table registration_runtime_main_case on commit drop as
select public.create_registration_case(
  '런타임신규', '중1', '런타임중', '01000001501', '01000002501',
  '본관', '2026-07-13 09:00+09'::timestamptz,
  array['영어', '수학']::text[], 'runtime pgTAP', 'normal', 'runtime-create-main'
) as payload;

update registration_runtime_ids
set id = (select (payload ->> 'taskId')::uuid from registration_runtime_main_case)
where key = 'main_case';

select pg_temp.registration_record(
  1,
  (select count(*) = 2
   from public.ops_registration_subject_tracks track
   where track.task_id = (select id from registration_runtime_ids where key = 'main_case')),
  (select payload from registration_runtime_main_case)
);

create or replace function pg_temp.registration_throws(
  p_sql text,
  p_message_pattern text default null,
  p_sqlstate text default null
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
    return (p_message_pattern is null or sqlerrm ~ p_message_pattern)
      and (p_sqlstate is null or sqlstate = p_sqlstate);
end;
$$;

create or replace function pg_temp.registration_lives(p_sql text)
returns boolean
language plpgsql
volatile
as $$
begin
  execute p_sql;
  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function pg_temp.registration_changes_zero(p_sql text)
returns boolean
language plpgsql
volatile
as $$
declare
  v_row_count bigint;
begin
  execute p_sql;
  get diagnostics v_row_count = row_count;
  return v_row_count = 0;
exception
  when others then return false;
end;
$$;

-- 2-13: parent/detail write gates, reserved events, provenance, and FK safety.
select pg_temp.registration_record(2, pg_temp.registration_throws(
  $$select public.create_registration_case(
    '빈과목', '중1', '런타임중', '01000001991', null, '본관', now(),
    '{}'::text[], null, 'normal', 'runtime-empty-subjects'
  )$$,
  'registration_subjects_required'
));
select pg_temp.registration_record(3, pg_temp.registration_throws(
  $$insert into public.ops_tasks(title, type, status, requested_by)
    values ('위조 등록', 'registration', 'requested', auth.uid())$$,
  'row-level security|permission denied|registration'
));
select pg_temp.registration_record(4, pg_temp.registration_throws(
  $$update public.ops_tasks
    set type = 'registration'
    where id = '00000000-0000-4000-8000-000000000503'$$,
  'registration_type_reclassification_forbidden|row-level security'
));
select pg_temp.registration_record(5, pg_temp.registration_changes_zero(
  format(
    $$update public.ops_tasks set type = 'general' where id = %L::uuid$$,
    (select id from registration_runtime_ids where key = 'main_case')
  )
));
select pg_temp.registration_record(6, pg_temp.registration_throws(
  $$insert into public.ops_registration_details(task_id, inquiry_at, school_grade, parent_phone)
    values ('00000000-0000-4000-8000-000000000503', now(), '중1', '01000009999')$$,
  'row-level security|permission denied'
));
select pg_temp.registration_record(7, pg_temp.registration_changes_zero(
  format(
    $$update public.ops_tasks set title = '직접 수정' where id = %L::uuid$$,
    (select id from registration_runtime_ids where key = 'main_case')
  )
));
select pg_temp.registration_record(8, pg_temp.registration_changes_zero(
  format(
    $$update public.ops_registration_details set school_name = '직접 수정' where task_id = %L::uuid$$,
    (select id from registration_runtime_ids where key = 'main_case')
  )
));
select pg_temp.registration_record(9, pg_temp.registration_changes_zero(
  format(
    $$delete from public.ops_tasks where id = %L::uuid$$,
    (select id from registration_runtime_ids where key = 'main_case')
  )
));
select pg_temp.registration_record(10, pg_temp.registration_changes_zero(
  format(
    $$delete from public.ops_registration_details where task_id = %L::uuid$$,
    (select id from registration_runtime_ids where key = 'main_case')
  )
));
select pg_temp.registration_record(11, pg_temp.registration_throws(
  format(
    $$insert into public.ops_task_events(task_id, actor_id, event_type, after_value)
      values (%L::uuid, auth.uid(), 'registration_track_event', '{}')$$,
    (select id from registration_runtime_ids where key = 'main_case')
  ),
  'row-level security|permission denied'
));
set local role postgres;
insert into public.ops_tasks(
  id, title, type, status, requested_by, student_name, priority
) values (
  '00000000-0000-4000-8000-000000000507', '런타임 provenance check',
  'registration', 'requested', '00000000-0000-4000-8000-000000000101',
  'provenance check', 'normal'
);
select pg_temp.registration_record(12, pg_temp.registration_throws(
  $$insert into public.ops_registration_subject_tracks(
    id, task_id, subject, pipeline_status,
    director_profile_id, director_assignment_source,
    director_assignment_rule_key, director_assigned_at
  ) values (
    gen_random_uuid(), '00000000-0000-4000-8000-000000000507', '영어', 'inquiry',
    '00000000-0000-4000-8000-000000000102', null, null, null
  )$$,
  'check constraint|ops_registration_subject_tracks_check'
));
delete from public.ops_tasks where id = '00000000-0000-4000-8000-000000000507';
select pg_temp.registration_record(13, pg_temp.registration_throws(
  $$delete from public.profiles where id = '00000000-0000-4000-8000-000000000102'$$,
  'foreign key|violates foreign key constraint'
));
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

-- 16-17: RLS visibility matrix.
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000102');
select pg_temp.registration_record(
  16,
  exists (
    select 1
    from public.ops_tasks task
    join public.ops_registration_subject_tracks track on track.task_id = task.id
    where task.id = (select id from registration_runtime_ids where key = 'main_case')
  )
);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000106');
select pg_temp.registration_record(
  17,
  not exists (
    select 1 from public.ops_tasks
    where id = (select id from registration_runtime_ids where key = 'main_case')
  )
);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

-- Route English to a phone queue once. This produces the consultation fixture used by
-- the director-ownership matrix and the independent outcome proof.
create temporary table registration_runtime_tracks on commit drop as
select
  max(track.id) filter (where track.subject = '영어') as english_track_id,
  max(track.id) filter (where track.subject = '수학') as math_track_id
from public.ops_registration_subject_tracks track
where track.task_id = (select id from registration_runtime_ids where key = 'main_case');

select public.route_registration_inquiry(
  (select english_track_id from registration_runtime_tracks),
  'consultation_waiting', null, null, 'runtime-route-english-phone'
);

create temporary table registration_runtime_consultations on commit drop as
select
  max(consultation.id) filter (
    where consultation.track_id = fixture.english_track_id and consultation.status = 'waiting'
  ) as english_phone_id
from public.ops_registration_consultations consultation
cross join registration_runtime_tracks fixture;

-- 18-24: only the assigned admin director may complete consultation; admin/staff still
-- retain non-consultation management mutations.
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000103');
select pg_temp.registration_record(19, pg_temp.registration_throws(
  format(
    $$select public.complete_registration_consultation(%L::uuid, 'waiting', 'next_term_opening', null, 'runtime-sibling-denied')$$,
    (select english_phone_id from registration_runtime_consultations)
  ),
  'registration_access_denied'
));
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000104');
select pg_temp.registration_record(20, pg_temp.registration_throws(
  format(
    $$select public.complete_registration_consultation(%L::uuid, 'waiting', 'next_term_opening', null, 'runtime-staff-denied')$$,
    (select english_phone_id from registration_runtime_consultations)
  ),
  'registration_access_denied'
));
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000106');
select pg_temp.registration_record(21, pg_temp.registration_throws(
  format(
    $$select public.complete_registration_consultation(%L::uuid, 'waiting', 'next_term_opening', null, 'runtime-teacher-denied')$$,
    (select english_phone_id from registration_runtime_consultations)
  ),
  'registration_access_denied'
));
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000105');
select pg_temp.registration_record(22, pg_temp.registration_throws(
  format(
    $$select public.complete_registration_consultation(%L::uuid, 'waiting', 'next_term_opening', null, 'runtime-assistant-denied')$$,
    (select english_phone_id from registration_runtime_consultations)
  ),
  'registration_access_denied'
));
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(23, pg_temp.registration_lives(
  format(
    $$select public.update_registration_case_common(
      %L::uuid, '런타임신규', '중1', '런타임중', '01000001501', '01000002501',
      '본관', '2026-07-13 09:00+09'::timestamptz, 'admin edit', 'normal', 1,
      'runtime-admin-common-edit'
    )$$,
    (select id from registration_runtime_ids where key = 'main_case')
  )
));
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000104');
select pg_temp.registration_record(24, pg_temp.registration_lives(
  format(
    $$select public.update_registration_case_common(
      %L::uuid, '런타임신규', '중1', '런타임중', '01000001501', '01000002501',
      '본관', '2026-07-13 09:00+09'::timestamptz, 'staff edit', 'normal', 2,
      'runtime-staff-common-edit'
    )$$,
    (select id from registration_runtime_ids where key = 'main_case')
  )
));
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000102');
select pg_temp.registration_record(18, pg_temp.registration_lives(
  format(
    $$select public.complete_registration_consultation(%L::uuid, 'waiting', 'next_term_opening', null, 'runtime-assigned-complete')$$,
    (select english_phone_id from registration_runtime_consultations)
  )
));
select pg_temp.registration_record(
  50,
  exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = (select english_track_id from registration_runtime_tracks)
      and track.pipeline_status = 'waiting'
      and track.waiting_kind = 'next_term_opening'
  )
  and exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = (select math_track_id from registration_runtime_tracks)
      and track.pipeline_status = 'inquiry'
  )
);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

-- Dedicated untouched cases make provenance, revision, replay, and pre-roster identity
-- boundaries observable without sharing state with the consultation fixture.
create temporary table registration_runtime_director_cases on commit drop as
select
  public.create_registration_case(
    '런타임감독A', '중1', '런타임중', '01000001601', null, '본관',
    '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
    'runtime-director-case-a'
  ) as case_a,
  public.create_registration_case(
    '런타임감독B', '중1', '런타임중', '01000001602', null, '본관',
    '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
    'runtime-director-case-b'
  ) as case_b;

create temporary table registration_runtime_director_tracks on commit drop as
select
  (select track.id from public.ops_registration_subject_tracks track where track.task_id = (cases.case_a ->> 'taskId')::uuid) as track_a,
  (select track.id from public.ops_registration_subject_tracks track where track.task_id = (cases.case_b ->> 'taskId')::uuid) as track_b,
  (cases.case_a ->> 'taskId')::uuid as task_a,
  (cases.case_b ->> 'taskId')::uuid as task_b
from registration_runtime_director_cases cases;

set local role postgres;
update public.teacher_catalogs
set is_visible = false
where id = '00000000-0000-4000-8000-000000000111';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(25, pg_temp.registration_lives(
  format(
    $$select public.assign_registration_track_director(%L::uuid, null, 'clear_default', null, %s, 'runtime-clear-default')$$,
    (select track_a from registration_runtime_director_tracks),
    (select detail.common_revision
     from public.ops_registration_details detail
     where detail.task_id = (select task_a from registration_runtime_director_tracks))
  )
) and (
  select director_profile_id is null
    and director_assignment_source is null
    and director_assignment_rule_key is null
    and director_assigned_at is null
  from public.ops_registration_subject_tracks
  where id = (select track_a from registration_runtime_director_tracks)
));
set local role postgres;
update public.teacher_catalogs
set is_visible = true
where id = '00000000-0000-4000-8000-000000000111';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

select public.assign_registration_track_director(
  (select track_b from registration_runtime_director_tracks),
  '00000000-0000-4000-8000-000000000103',
  'manual', null, 1, 'runtime-manual-director'
);
select pg_temp.registration_record(26, pg_temp.registration_throws(
  format(
    $$select public.assign_registration_track_director(%L::uuid, null, 'clear_default', null, %s, 'runtime-manual-clear-denied')$$,
    (select track_b from registration_runtime_director_tracks),
    (select detail.common_revision
     from public.ops_registration_details detail
     where detail.task_id = (select task_b from registration_runtime_director_tracks))
  ),
  'registration_director_clear_denied'
));
select pg_temp.registration_record(27, pg_temp.registration_throws(
  format(
    $$select public.assign_registration_track_director(
      %L::uuid, '00000000-0000-4000-8000-000000000103', 'default',
      'academic-director-v1:2026:영어:중1', %s, 'runtime-wrong-default'
    )$$,
    (select track_b from registration_runtime_director_tracks),
    (select detail.common_revision
     from public.ops_registration_details detail
     where detail.task_id = (select task_b from registration_runtime_director_tracks))
  ),
  'registration_director_default_stale'
));
select public.update_registration_case_common(
  fixture.task_b, '런타임감독B', '중1', '런타임중', '01000001602', null,
  '본관', '2026-07-13 09:00+09'::timestamptz, 'revision bump', 'normal',
  detail.common_revision, 'runtime-director-case-b-revision'
)
from registration_runtime_director_tracks fixture
join public.ops_registration_details detail on detail.task_id = fixture.task_b;
select pg_temp.registration_record(28, pg_temp.registration_throws(
  format(
    $$select public.assign_registration_track_director(
      %L::uuid, '00000000-0000-4000-8000-000000000102', 'default',
      'academic-director-v1:2026:영어:중1', %s, 'runtime-stale-default-revision'
    )$$,
    (select track_b from registration_runtime_director_tracks),
    (select detail.common_revision - 1
     from public.ops_registration_details detail
     where detail.task_id = (select task_b from registration_runtime_director_tracks))
  ),
  'registration_common_revision_conflict'
));

-- Corrupt only fixture snapshots as postgres, then prove public mutations fail closed.
set local role postgres;
update public.ops_registration_subject_tracks
set director_profile_id = '00000000-0000-4000-8000-000000000102',
    director_assignment_source = 'default',
    director_assignment_rule_key = 'academic-director-v1:2025:영어:중1',
    director_assigned_at = now()
where id = (select track_b from registration_runtime_director_tracks);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(29, pg_temp.registration_throws(
  format(
    $$select public.route_registration_inquiry(%L::uuid, 'consultation_waiting', null, null, 'runtime-stale-phone')$$,
    (select track_b from registration_runtime_director_tracks)
  ),
  'registration_director_refresh_required'
));

set local role postgres;
update public.ops_registration_subject_tracks
set director_profile_id = '00000000-0000-4000-8000-000000000102',
    director_assignment_source = 'manual',
    director_assignment_rule_key = null,
    director_assigned_at = now()
where id = (select track_b from registration_runtime_director_tracks);
update public.teacher_catalogs
set is_visible = false
where profile_id = '00000000-0000-4000-8000-000000000102';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(30, pg_temp.registration_throws(
  format(
    $$select public.route_registration_inquiry(%L::uuid, 'consultation_waiting', null, null, 'runtime-inactive-phone')$$,
    (select track_b from registration_runtime_director_tracks)
  ),
  'registration_director_refresh_required'
));
set local role postgres;
update public.teacher_catalogs set is_visible = true
where profile_id = '00000000-0000-4000-8000-000000000102';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

create temporary table registration_runtime_replay on commit drop as
select public.update_registration_case_common(
  fixture.task_a, '런타임감독A', '중1', '런타임중', '01000001601', null,
  '본관', '2026-07-13 09:00+09'::timestamptz, 'replay', 'normal',
  detail.common_revision,
  'runtime-common-replay'
) as first_response,
  detail.common_revision as expected_revision
from registration_runtime_director_tracks fixture
join public.ops_registration_details detail on detail.task_id = fixture.task_a;
alter table registration_runtime_replay add column second_response jsonb;
update registration_runtime_replay
set second_response = public.update_registration_case_common(
  (select task_a from registration_runtime_director_tracks),
  '런타임감독A', '중1', '런타임중', '01000001601', null,
  '본관', '2026-07-13 09:00+09'::timestamptz, 'replay', 'normal',
  expected_revision,
  'runtime-common-replay'
);
select pg_temp.registration_record(31, (
  select first_response = second_response from registration_runtime_replay
));
select pg_temp.registration_record(32, pg_temp.registration_throws(
  format(
    $$select public.update_registration_case_common(
      %L::uuid, '런타임감독A-변경', '중1', '런타임중', '01000001601', null,
      '본관', '2026-07-13 09:00+09'::timestamptz, 'replay', 'normal', %s,
      'runtime-common-replay'
    )$$,
    (select task_a from registration_runtime_director_tracks),
    (select expected_revision from registration_runtime_replay)
  ),
  'idempotency_key_reused'
));

set local role postgres;
update public.ops_tasks
set student_id = '00000000-0000-4000-8000-000000000201'
where id = (select task_a from registration_runtime_director_tracks);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(33, pg_temp.registration_lives(
  format(
    $$select public.update_registration_case_common(
      %L::uuid, '런타임감독A', '중1', '다른학교', '01000001601', null,
      '본관', '2026-07-13 09:00+09'::timestamptz, 'identity detach', 'normal', %s,
      'runtime-safe-detach'
    )$$,
    (select task_a from registration_runtime_director_tracks),
    (select detail.common_revision
     from public.ops_registration_details detail
     where detail.task_id = (select task_a from registration_runtime_director_tracks))
  )
) and (
  select student_id is null from public.ops_tasks
  where id = (select task_a from registration_runtime_director_tracks)
));
select pg_temp.registration_record(34, pg_temp.registration_throws(
  format(
    $$select public.update_registration_case_common(
      %L::uuid, '런타임감독A', '중1', '런타임중', '01000001601', null,
      '본관', '2026-07-13 09:00+09'::timestamptz, 'stale', 'normal', 1,
      'runtime-stale-common'
    )$$,
    (select task_a from registration_runtime_director_tracks)
  ),
  'registration_common_revision_conflict'
));
select pg_temp.registration_record(39, (
  select common_revision = 3 from public.ops_registration_details
  where task_id = (select task_a from registration_runtime_director_tracks)
));
set local role postgres;
select pg_temp.registration_record(42, (
  dashboard_private.resolve_registration_default_director(
    '영어', '중1', '2026-07-13 09:00+09'::timestamptz
  )
  @> '{"status":"resolved","profileId":"00000000-0000-4000-8000-000000000102","ruleKey":"academic-director-v1:2026:영어:중1"}'::jsonb
));
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(43, pg_temp.registration_throws(
  format(
    $$select public.sync_registration_case_subjects(%L::uuid, '{}'::text[], 'runtime-last-subject')$$,
    (select task_a from registration_runtime_director_tracks)
  ),
  'registration_subjects_required|registration_last_subject_required'
));

-- 44-54: shared appointment set semantics, optimistic revisions, subject-local attempt
-- history, and director-ready visit/phone routing.
create temporary table registration_runtime_appointment_case on commit drop as
select public.create_registration_case(
  '런타임예약', '중1', '런타임중', '01000001701', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어', '수학'], null, 'normal',
  'runtime-appointment-case'
) as payload;
create temporary table registration_runtime_appointment_tracks on commit drop as
select
  (fixture.payload ->> 'taskId')::uuid as task_id,
  max(track.id) filter (where track.subject = '영어') as english_track_id,
  max(track.id) filter (where track.subject = '수학') as math_track_id
from registration_runtime_appointment_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid
group by fixture.payload;
create temporary table registration_runtime_appointment on commit drop as
select public.save_registration_shared_appointment(
  null,
  fixture.task_id,
  'level_test',
  '2026-07-20 10:00+09'::timestamptz,
  '본관 1강의실',
  array[fixture.english_track_id, fixture.math_track_id, fixture.english_track_id],
  false,
  null,
  'runtime-dual-level-test'
) as payload
from registration_runtime_appointment_tracks fixture;
select pg_temp.registration_record(44,
  (select count(*) = 2
   from public.ops_registration_level_tests attempt
   where attempt.appointment_id = (
     select (payload ->> 'appointmentId')::uuid from registration_runtime_appointment
   ))
  and (select count(distinct track_id) = 2
       from public.ops_registration_level_tests attempt
       where attempt.appointment_id = (
         select (payload ->> 'appointmentId')::uuid from registration_runtime_appointment
       ))
);
select pg_temp.registration_record(45, pg_temp.registration_throws(
  format(
    $$select public.save_registration_shared_appointment(
      null, %L::uuid, 'level_test', '2026-07-21 10:00+09'::timestamptz,
      '본관 1강의실', '{}'::uuid[], false, null, 'runtime-empty-appointment'
    )$$,
    (select task_id from registration_runtime_appointment_tracks)
  ),
  'registration_appointment_tracks_required'
));
select pg_temp.registration_record(46, pg_temp.registration_throws(
  format(
    $$select public.save_registration_shared_appointment(
      null, %L::uuid, 'level_test', '2026-07-21 10:00+09'::timestamptz,
      '본관 1강의실', array[%L::uuid], false, null, 'runtime-duplicate-active'
    )$$,
    (select task_id from registration_runtime_appointment_tracks),
    (select english_track_id from registration_runtime_appointment_tracks)
  ),
  'registration_appointment_active_activity_exists|duplicate key'
));
select pg_temp.registration_record(47, pg_temp.registration_throws(
  format(
    $$select public.save_registration_shared_appointment(
      %L::uuid, %L::uuid, 'level_test', '2026-07-20 11:00+09'::timestamptz,
      '본관 1강의실', array[%L::uuid, %L::uuid], false, 0,
      'runtime-stale-appointment-edit'
    )$$,
    (select (payload ->> 'appointmentId')::uuid from registration_runtime_appointment),
    (select task_id from registration_runtime_appointment_tracks),
    (select english_track_id from registration_runtime_appointment_tracks),
    (select math_track_id from registration_runtime_appointment_tracks)
  ),
  'registration_appointment_revision_conflict'
));
select pg_temp.registration_record(48, pg_temp.registration_throws(
  format(
    $$select public.cancel_registration_appointment(%L::uuid, 0, 'stale', 'runtime-stale-appointment-cancel')$$,
    (select (payload ->> 'appointmentId')::uuid from registration_runtime_appointment)
  ),
  'registration_appointment_revision_conflict'
));

create temporary table registration_runtime_attempts on commit drop as
select
  max(attempt.id) filter (where attempt.track_id = fixture.english_track_id) as english_attempt_id,
  max(attempt.id) filter (where attempt.track_id = fixture.math_track_id) as math_attempt_id
from public.ops_registration_level_tests attempt
cross join registration_runtime_appointment_tracks fixture
where attempt.appointment_id = (
  select (payload ->> 'appointmentId')::uuid from registration_runtime_appointment
);
select public.start_registration_level_test_attempt(
  (select english_attempt_id from registration_runtime_attempts),
  'runtime-start-english'
);
select public.complete_registration_level_test_attempt(
  (select english_attempt_id from registration_runtime_attempts),
  'completed', 'https://drive.invalid/runtime/english-result',
  'runtime-complete-english'
);
select public.complete_registration_level_test_attempt(
  (select math_attempt_id from registration_runtime_attempts),
  'absent', null, 'runtime-absent-math'
);
select public.save_registration_shared_appointment(
  null,
  (select task_id from registration_runtime_appointment_tracks),
  'level_test', '2026-07-27 10:00+09'::timestamptz, '본관 1강의실',
  array[(select math_track_id from registration_runtime_appointment_tracks)],
  false, null, 'runtime-reschedule-math'
);
select pg_temp.registration_record(49,
  (select count(*) = 1
   from public.ops_registration_level_tests attempt
   where attempt.track_id = (select english_track_id from registration_runtime_appointment_tracks)
     and attempt.status = 'completed')
  and (select count(*) = 2 and max(attempt_number) = 2
       from public.ops_registration_level_tests attempt
       where attempt.track_id = (select math_track_id from registration_runtime_appointment_tracks))
);

create temporary table registration_runtime_stale_test_case on commit drop as
select public.create_registration_case(
  '런타임만료시험', '중1', '런타임중', '01000001702', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
  'runtime-stale-test-case'
) as payload;
create temporary table registration_runtime_stale_test on commit drop as
select
  (fixture.payload ->> 'taskId')::uuid as task_id,
  track.id as track_id,
  public.save_registration_shared_appointment(
    null, (fixture.payload ->> 'taskId')::uuid, 'level_test',
    '2026-07-22 10:00+09'::timestamptz, '본관 1강의실', array[track.id],
    false, null, 'runtime-stale-test-appointment'
  ) as appointment
from registration_runtime_stale_test_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid;
create temporary table registration_runtime_stale_attempt on commit drop as
select attempt.id
from public.ops_registration_level_tests attempt
where attempt.appointment_id = (
  select (appointment ->> 'appointmentId')::uuid from registration_runtime_stale_test
);
select public.start_registration_level_test_attempt(
  (select id from registration_runtime_stale_attempt), 'runtime-start-stale-test'
);
set local role postgres;
update public.ops_registration_subject_tracks
set director_assignment_rule_key = 'academic-director-v1:2025:영어:중1'
where id = (select track_id from registration_runtime_stale_test);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(51, pg_temp.registration_throws(
  format(
    $$select public.complete_registration_level_test_attempt(
      %L::uuid, 'completed', 'https://drive.invalid/runtime/stale', 'runtime-stale-test-complete'
    )$$,
    (select id from registration_runtime_stale_attempt)
  ),
  'registration_director_refresh_required'
));

create temporary table registration_runtime_visit_case on commit drop as
select public.create_registration_case(
  '런타임방문', '중1', '런타임중', '01000001703', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
  'runtime-visit-case'
) as payload;
create temporary table registration_runtime_visit_track on commit drop as
select (fixture.payload ->> 'taskId')::uuid as task_id, track.id as track_id
from registration_runtime_visit_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid;
select public.route_registration_inquiry(
  (select track_id from registration_runtime_visit_track),
  'consultation_waiting', null, null, 'runtime-visit-phone-queue'
);
set local role postgres;
update public.teacher_catalogs set is_visible = false
where profile_id = '00000000-0000-4000-8000-000000000102';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(52, pg_temp.registration_throws(
  format(
    $$select public.save_registration_shared_appointment(
      null, %L::uuid, 'visit_consultation', '2026-07-23 14:00+09'::timestamptz,
      '원장실', array[%L::uuid], false, null, 'runtime-inactive-visit'
    )$$,
    (select task_id from registration_runtime_visit_track),
    (select track_id from registration_runtime_visit_track)
  ),
  'registration_director_refresh_required'
));
set local role postgres;
update public.teacher_catalogs set is_visible = true
where profile_id = '00000000-0000-4000-8000-000000000102';
update public.ops_registration_subject_tracks
set director_assignment_rule_key = 'academic-director-v1:2025:영어:중1'
where id = (select track_id from registration_runtime_visit_track);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(53, pg_temp.registration_throws(
  format(
    $$select public.save_registration_shared_appointment(
      null, %L::uuid, 'visit_consultation', '2026-07-23 14:00+09'::timestamptz,
      '원장실', array[%L::uuid], false, null, 'runtime-stale-visit'
    )$$,
    (select task_id from registration_runtime_visit_track),
    (select track_id from registration_runtime_visit_track)
  ),
  'registration_director_refresh_required'
));
set local role postgres;
update public.ops_registration_subject_tracks
set director_assignment_rule_key = 'academic-director-v1:2026:영어:중1'
where id = (select track_id from registration_runtime_visit_track);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_visit_appointment on commit drop as
select public.save_registration_shared_appointment(
  null, fixture.task_id, 'visit_consultation',
  '2026-07-23 14:00+09'::timestamptz, '원장실', array[fixture.track_id],
  false, null, 'runtime-valid-visit'
) as payload
from registration_runtime_visit_track fixture;
set local role postgres;
update public.teacher_catalogs set is_visible = false
where profile_id = '00000000-0000-4000-8000-000000000102';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_visit_cancel on commit drop as
select public.cancel_registration_appointment(
  (select (payload ->> 'appointmentId')::uuid from registration_runtime_visit_appointment),
  1, 'owner unavailable', 'runtime-cancel-unavailable-visit'
) as payload;
select pg_temp.registration_record(54,
  jsonb_array_length(coalesce((select payload -> 'requiresDirectorAssignmentTrackIds' from registration_runtime_visit_cancel), '[]'::jsonb)) = 1
  and not exists (
    select 1 from public.ops_registration_consultations consultation
    where consultation.track_id = (select track_id from registration_runtime_visit_track)
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
  )
);
set local role postgres;
update public.teacher_catalogs set is_visible = true
where profile_id = '00000000-0000-4000-8000-000000000102';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

-- 59-73: generic roster gateway and immutable history boundaries.
set local role postgres;
update public.students
set class_ids = '{}'::jsonb
where id = '00000000-0000-4000-8000-000000000202';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(59, pg_temp.registration_throws(
  $$select public.set_student_class_roster_mode(
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000302',
    'removed', 'enrolled', 'runtime-malformed-scalar'
  )$$,
  'registration_roster_projection_invalid'
));
set local role postgres;
update public.students
set class_ids = '["not-a-uuid"]'::jsonb
where id = '00000000-0000-4000-8000-000000000202';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(60, pg_temp.registration_throws(
  $$select public.set_student_class_roster_mode(
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000302',
    'removed', 'enrolled', 'runtime-malformed-uuid'
  )$$,
  'registration_roster_projection_invalid|invalid input syntax for type uuid'
));
set local role postgres;
update public.students set class_ids = '[]'::jsonb
where id = '00000000-0000-4000-8000-000000000202';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_roster_commit on commit drop as
select public.set_student_class_roster_mode(
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000302',
  'enrolled', 'removed', 'runtime-roster-admin'
) as payload;
select pg_temp.registration_record(61,
  (select payload @> '{"studentId":"00000000-0000-4000-8000-000000000202","classId":"00000000-0000-4000-8000-000000000302","previousMode":"removed","nextMode":"enrolled","changed":true,"studentClassIds":["00000000-0000-4000-8000-000000000302"],"studentWaitlistClassIds":[],"classStudentIds":["00000000-0000-4000-8000-000000000202"],"classWaitlistIds":[]}'::jsonb
   from registration_runtime_roster_commit)
  and (select class_ids ? '00000000-0000-4000-8000-000000000302'
       from public.students where id = '00000000-0000-4000-8000-000000000202')
  and (select student_ids ? '00000000-0000-4000-8000-000000000202'
       from public.classes where id = '00000000-0000-4000-8000-000000000302')
);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000105');
select pg_temp.registration_record(62, pg_temp.registration_throws(
  $$select public.set_student_class_roster_mode(
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000302',
    'enrolled', 'removed', 'runtime-roster-assistant'
  )$$,
  'registration_access_denied'
));
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000104');
select pg_temp.registration_record(63, pg_temp.registration_throws(
  $$select public.set_student_class_roster_mode(
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000302',
    'removed', 'waitlist', 'runtime-roster-conflict'
  )$$,
  'registration_roster_mode_conflict'
));
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(
  64,
  pg_temp.registration_lives(
    $$insert into public.students(
        id, name, uid, school, grade, contact, parent_contact, status
      ) values (
        '00000000-0000-4000-8000-000000000206', '런타임신규', 'runtime-insert-student',
        '런타임중', '중1', '01000002006', '01000001006', '재원'
      )$$
  )
  and pg_temp.registration_lives(
    $$insert into public.students(
        id, name, uid, school, grade, contact, parent_contact, status
      )
      values (
        '00000000-0000-4000-8000-000000000201', '런타임학생', 'runtime-student',
        '런타임중', '중1', '01000002001', '01000001001', '재원'
      )
      on conflict (id) do update set name = excluded.name$$
  )
  and pg_temp.registration_throws(
    $$insert into public.students(
        id, name, school, grade, parent_contact, status, class_ids, waitlist_class_ids
      ) values (
        gen_random_uuid(), '위조학생', '런타임중', '중1', '01099999999', '재원',
        '["00000000-0000-4000-8000-000000000301"]'::jsonb, '[]'::jsonb
      )$$,
    'registration_roster_write_requires_rpc',
    '42501'
  )
);
select pg_temp.registration_record(
  65,
  pg_temp.registration_lives(
    $$insert into public.classes(
        id, name, class_type, subject, grade, teacher, schedule, room,
        capacity, fee, status, textbook_ids, lessons, schedule_plan
      ) values (
        '00000000-0000-4000-8000-000000000390', '런타임 영어 신규', '정규', '영어', '중1',
        '강부희', '목 18:00', '본관', 12, 100000, '수업 진행 중', '[]'::jsonb,
        '[]'::jsonb, '{"sessions":[]}'::jsonb
      )$$
  )
  and pg_temp.registration_lives(
    $$insert into public.classes(
        id, name, class_type, subject, grade, teacher, schedule, room,
        capacity, fee, status, textbook_ids, lessons, schedule_plan
      )
      values (
        '00000000-0000-4000-8000-000000000301', '런타임 영어 A', '정규', '영어', '중1',
        '강부희', '월 18:00', '본관', 12, 100000, '수업 진행 중',
        '["00000000-0000-4000-8000-000000000401"]'::jsonb, '[]'::jsonb,
        '{"sessions":[{"date":"2026-07-20","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
      )
      on conflict (id) do update set name = excluded.name$$
  )
  and pg_temp.registration_throws(
    $$insert into public.classes(
        id, name, subject, status, student_ids, waitlist_ids, textbook_ids
      ) values (
        gen_random_uuid(), '위조수업', '영어', '수업 진행 중',
        '["00000000-0000-4000-8000-000000000201"]'::jsonb, '[]'::jsonb, '[]'::jsonb
      )$$,
    'registration_roster_write_requires_rpc',
    '42501'
  )
);
select pg_temp.registration_record(
  66,
  pg_temp.registration_throws(
    $$update public.students
      set class_ids = '[]'::jsonb
      where id = '00000000-0000-4000-8000-000000000202'$$,
    'registration_roster_write_requires_rpc',
    '42501'
  )
  and pg_temp.registration_throws(
    $$update public.classes
      set student_ids = student_ids
      where id = '00000000-0000-4000-8000-000000000301'$$,
    'registration_roster_write_requires_rpc',
    '42501'
  )
);
delete from public.classes
where id = '00000000-0000-4000-8000-000000000390';
delete from public.students
where id = '00000000-0000-4000-8000-000000000206';
select pg_temp.registration_record(67, pg_temp.registration_throws(
  $$insert into public.student_class_enrollment_history(
      student_id, class_id, action, previous_mode, next_mode, memo, changed_by
    ) values (
      '00000000-0000-4000-8000-000000000202',
      '00000000-0000-4000-8000-000000000302',
      'enrolled', null, 'enrolled', 'forged', auth.uid()
    )$$,
  'row-level security|permission denied'
));
select pg_temp.registration_record(68,
  pg_temp.registration_throws(
    $$update public.student_class_enrollment_history set memo = 'forged update'
      where student_id = '00000000-0000-4000-8000-000000000202'$$,
    'row-level security|permission denied'
  )
  and pg_temp.registration_throws(
    $$delete from public.student_class_enrollment_history
      where student_id = '00000000-0000-4000-8000-000000000202'$$,
    'row-level security|permission denied'
  )
);
select pg_temp.registration_record(69, pg_temp.registration_contract(69));

set local role postgres;
update public.classes
set waitlist_ids = waitlist_ids || '"00000000-0000-4000-8000-000000000203"'::jsonb
where id = '00000000-0000-4000-8000-000000000303';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(70, pg_temp.registration_throws(
  $$delete from public.students where id = '00000000-0000-4000-8000-000000000203'$$,
  'registration_roster_cleanup_required|row-level security|permission denied'
));
set local role postgres;
update public.classes
set waitlist_ids = waitlist_ids - '00000000-0000-4000-8000-000000000203'
where id = '00000000-0000-4000-8000-000000000303';
insert into public.students(
  id, name, school, grade, parent_contact, status, class_ids, waitlist_class_ids
) values (
  '00000000-0000-4000-8000-000000000204', '런타임이력학생', '런타임중', '중1',
  '01000001004', '재원', '[]'::jsonb, '[]'::jsonb
);
insert into public.student_class_enrollment_history(
  student_id, class_id, action, previous_mode, next_mode, memo, changed_by
) values (
  '00000000-0000-4000-8000-000000000204',
  '00000000-0000-4000-8000-000000000303',
  'removed', 'enrolled', null, 'runtime history',
  '00000000-0000-4000-8000-000000000101'
);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(71, pg_temp.registration_throws(
  $$delete from public.students where id = '00000000-0000-4000-8000-000000000204'$$,
  'registration_history_preservation_required|row-level security|permission denied'
));
set local role postgres;
insert into public.students(
  id, name, school, grade, parent_contact, status, class_ids, waitlist_class_ids
) values (
  '00000000-0000-4000-8000-000000000205', '런타임삭제가능', '런타임중', '중1',
  '01000001005', '재원', '[]'::jsonb, '[]'::jsonb
);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(72, pg_temp.registration_lives(
  $$delete from public.students where id = '00000000-0000-4000-8000-000000000205'$$
));

set local role postgres;
update public.students
set class_ids = class_ids || '"00000000-0000-4000-8000-000000000303"'::jsonb
where id = '00000000-0000-4000-8000-000000000201';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(73, pg_temp.registration_throws(
  $$select public.set_student_class_roster_mode(
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000303',
    'removed', 'enrolled', 'runtime-one-sided'
  )$$,
  'registration_roster_projection_invalid|registration_roster_mode_conflict'
));
set local role postgres;
update public.students
set class_ids = class_ids - '00000000-0000-4000-8000-000000000303'
where id = '00000000-0000-4000-8000-000000000201';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

-- 74-81: a real current-class wait and retest transition exercise all four projections.
create temporary table registration_runtime_wait_case on commit drop as
select public.create_registration_case(
  '런타임학생', '중1', '런타임중', '01000001001', '01000002001', '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
  'runtime-wait-case'
) as payload;
create temporary table registration_runtime_wait_track on commit drop as
select (fixture.payload ->> 'taskId')::uuid as task_id, track.id as track_id
from registration_runtime_wait_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid;
select public.route_registration_inquiry(
  (select track_id from registration_runtime_wait_track),
  'waiting', 'current_class',
  '00000000-0000-4000-8000-000000000301',
  'runtime-current-class-wait'
);
select pg_temp.registration_record(74,
  not (select class_ids ? '00000000-0000-4000-8000-000000000301'
       from public.students where id = '00000000-0000-4000-8000-000000000201')
);
select pg_temp.registration_record(75,
  (select waitlist_class_ids ? '00000000-0000-4000-8000-000000000301'
   from public.students where id = '00000000-0000-4000-8000-000000000201')
);
select pg_temp.registration_record(76,
  not (select student_ids ? '00000000-0000-4000-8000-000000000201'
       from public.classes where id = '00000000-0000-4000-8000-000000000301')
);
select pg_temp.registration_record(77,
  (select waitlist_ids ? '00000000-0000-4000-8000-000000000201'
   from public.classes where id = '00000000-0000-4000-8000-000000000301')
);
select pg_temp.registration_record(78,
  (select count(*) = 1
   from public.student_class_enrollment_history history
   where history.student_id = '00000000-0000-4000-8000-000000000201'
     and history.class_id = '00000000-0000-4000-8000-000000000301'
     and history.action = 'waitlist')
);

select public.transition_registration_waiting(
  (select track_id from registration_runtime_wait_track),
  'record_retest_required', null, null, 'required', 'retest required',
  'runtime-retest-required'
);
select public.save_registration_shared_appointment(
  null, (select task_id from registration_runtime_wait_track), 'level_test',
  '2026-07-30 10:00+09'::timestamptz, '본관 1강의실',
  array[(select track_id from registration_runtime_wait_track)], false, null,
  'runtime-retest-appointment'
);
select pg_temp.registration_record(80,
  not (select waitlist_class_ids ? '00000000-0000-4000-8000-000000000301'
       from public.students where id = '00000000-0000-4000-8000-000000000201')
  and not (select waitlist_ids ? '00000000-0000-4000-8000-000000000201'
           from public.classes where id = '00000000-0000-4000-8000-000000000301')
  and exists (
    select 1 from public.ops_registration_enrollments enrollment
    where enrollment.track_id = (select track_id from registration_runtime_wait_track)
      and enrollment.status = 'canceled'
  )
);
select pg_temp.registration_record(81,
  (select count(*) = 2
   from public.student_class_enrollment_history history
   where history.student_id = '00000000-0000-4000-8000-000000000201'
     and history.class_id = '00000000-0000-4000-8000-000000000301'
     and history.action in ('waitlist', 'removed'))
);

-- Assertions 82-107 are populated below by dedicated executable admission, migration,
-- timestamp, projection, and cancellation fixtures.

-- 79, 82-85, 88-89: build one real two-row paid batch. A temporary trigger injects a
-- failure on the second class update so the first projection must roll back.
create temporary table registration_runtime_paid_case on commit drop as
select public.create_registration_case(
  '런타임입학', '중1', '런타임중', '01000001801', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
  'runtime-paid-case'
) as payload;
create temporary table registration_runtime_paid_track on commit drop as
select (fixture.payload ->> 'taskId')::uuid as task_id, track.id as track_id
from registration_runtime_paid_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid;
select public.route_registration_inquiry(
  (select track_id from registration_runtime_paid_track),
  'consultation_waiting', null, null, 'runtime-paid-phone'
);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000102');
select public.complete_registration_consultation(
  (select consultation.id
   from public.ops_registration_consultations consultation
   where consultation.track_id = (select track_id from registration_runtime_paid_track)
     and consultation.status = 'waiting'),
  'enrollment', null, null, 'runtime-paid-consultation'
);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_paid_rows on commit drop as
select public.save_registration_enrollment_rows(
  (select track_id from registration_runtime_paid_track),
  jsonb_build_array(
    jsonb_build_object(
      'classId', '00000000-0000-4000-8000-000000000301',
      'textbookId', '00000000-0000-4000-8000-000000000401',
      'classStartDate', '2026-07-20',
      'classStartSessionKey', '2026-07-20:1',
      'classStartSession', '1회차',
      'sortOrder', 0
    ),
    jsonb_build_object(
      'classId', '00000000-0000-4000-8000-000000000302',
      'textbookId', '00000000-0000-4000-8000-000000000401',
      'classStartDate', '2026-07-22',
      'classStartSessionKey', '2026-07-22:1',
      'classStartSession', '1회차',
      'sortOrder', 1
    )
  ),
  'runtime-paid-rows'
) as payload;
create temporary table registration_runtime_paid_row_ids on commit drop as
select (row_item ->> 'id')::uuid as id, (row_item ->> 'classId')::uuid as class_id
from registration_runtime_paid_rows saved
cross join lateral jsonb_array_elements(saved.payload -> 'rows') row_item;
set local role postgres;
update public.ops_registration_details
set admission_notice_sent = true
where task_id = (select task_id from registration_runtime_paid_track);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_paid_batch on commit drop as
select public.start_registration_admission_batch(
  (select task_id from registration_runtime_paid_track),
  array[(select track_id from registration_runtime_paid_track)],
  (select array_agg(id order by class_id) from registration_runtime_paid_row_ids),
  'runtime-paid-batch'
) as payload;
select public.set_registration_enrollment_makeedu(
  row_id.id, true, 'runtime-makeedu-' || right(row_id.id::text, 8)
)
from registration_runtime_paid_row_ids row_id;
select public.advance_registration_admission_batch(
  (select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch),
  'invoice_sent', 'runtime-paid-invoice'
);
select public.advance_registration_admission_batch(
  (select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch),
  'payment_confirmed', 'runtime-paid-payment'
);

set local role postgres;
create or replace function pg_temp.registration_fail_second_class()
returns trigger
language plpgsql
as $$
begin
  if new.id = '00000000-0000-4000-8000-000000000302'
    and current_setting('registration.runtime_fail_second_class', true) = 'on'
  then
    raise exception 'registration_runtime_second_row_failure';
  end if;
  return new;
end;
$$;
create trigger registration_runtime_fail_second_class
before update on public.classes
for each row execute function pg_temp.registration_fail_second_class();
select set_config('registration.runtime_fail_second_class', 'on', true);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(82,
  pg_temp.registration_throws(
    format(
      $$select public.complete_registration_admission_batch(%L::uuid, 'runtime-paid-injected-failure')$$,
      (select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch)
    ),
    'registration_runtime_second_row_failure'
  )
  and (select count(*) = 2
       from public.ops_registration_enrollments enrollment
       where enrollment.admission_batch_id = (
         select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch
       ) and enrollment.status = 'planned' and enrollment.roster_active)
  and not (select class_ids ? '00000000-0000-4000-8000-000000000301'
           from public.students student
           where student.id = (
             select student_id from public.ops_tasks
             where id = (select task_id from registration_runtime_paid_track)
           ))
  and not (select student_ids ? (
             select student_id::text from public.ops_tasks
             where id = (select task_id from registration_runtime_paid_track)
           ) from public.classes where id = '00000000-0000-4000-8000-000000000301')
);
set local role postgres;
select set_config('registration.runtime_fail_second_class', 'off', true);
update public.classes set subject = '수학'
where id = '00000000-0000-4000-8000-000000000302';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(83,
  pg_temp.registration_throws(
    format(
      $$select public.complete_registration_admission_batch(%L::uuid, 'runtime-paid-stale-subject')$$,
      (select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch)
    ),
    'registration_class_subject_mismatch'
  )
  and (select count(*) = 0
       from public.ops_registration_enrollments enrollment
       where enrollment.admission_batch_id = (
         select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch
       ) and enrollment.status = 'enrolled')
);
set local role postgres;
update public.classes
set subject = '영어', textbook_ids = '[]'::jsonb
where id = '00000000-0000-4000-8000-000000000302';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(84,
  pg_temp.registration_throws(
    format(
      $$select public.complete_registration_admission_batch(%L::uuid, 'runtime-paid-stale-textbook')$$,
      (select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch)
    ),
    'registration_textbook_class_mismatch'
  )
  and (select count(*) = 0
       from public.ops_registration_enrollments enrollment
       where enrollment.admission_batch_id = (
         select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch
       ) and enrollment.status = 'enrolled')
);
set local role postgres;
update public.classes
set textbook_ids = '["00000000-0000-4000-8000-000000000401"]'::jsonb
where id = '00000000-0000-4000-8000-000000000302';
update public.students
set school = '다른학교'
where id = (
  select student_id from public.ops_tasks
  where id = (select task_id from registration_runtime_paid_track)
);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(85,
  pg_temp.registration_throws(
    format(
      $$select public.complete_registration_admission_batch(%L::uuid, 'runtime-paid-identity-mismatch')$$,
      (select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch)
    ),
    'registration_student_identity_mismatch'
  )
  and (select count(*) = 0
       from public.ops_registration_enrollments enrollment
       where enrollment.admission_batch_id = (
         select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch
       ) and enrollment.status = 'enrolled')
);
set local role postgres;
update public.students
set school = '런타임중'
where id = (
  select student_id from public.ops_tasks
  where id = (select task_id from registration_runtime_paid_track)
);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_paid_complete on commit drop as
select public.complete_registration_admission_batch(
  (select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch),
  'runtime-paid-complete'
) as payload;
select pg_temp.registration_record(79,
  (select class_ids @> '["00000000-0000-4000-8000-000000000301","00000000-0000-4000-8000-000000000302"]'::jsonb
   from public.students student
   where student.id = (
     select student_id from public.ops_tasks
     where id = (select task_id from registration_runtime_paid_track)
   ))
  and (select bool_and(class.student_ids ? task.student_id::text)
       from public.classes class
       cross join lateral (
         select student_id from public.ops_tasks
         where id = (select task_id from registration_runtime_paid_track)
       ) task
       where class.id in (
         '00000000-0000-4000-8000-000000000301',
         '00000000-0000-4000-8000-000000000302'
       ))
);
select pg_temp.registration_record(88,
  (select payload #>> '{batch,status}' = 'completed'
      and jsonb_array_length(payload -> 'enrollments') = 2
   from registration_runtime_paid_complete)
);
select pg_temp.registration_record(89,
  (select count(*) = 2
   from public.ops_registration_enrollments enrollment
   where enrollment.admission_batch_id = (
     select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch
   ) and enrollment.status = 'enrolled' and enrollment.roster_active)
  and (select pipeline_status = 'registered'
       from public.ops_registration_subject_tracks
       where id = (select track_id from registration_runtime_paid_track))
  and (select status = 'completed'
       from public.ops_registration_admission_batches
       where id = (select (payload #>> '{batch,id}')::uuid from registration_runtime_paid_batch))
);

-- 86, 87, 107: batch and last-live-row cancellation routes are exercised with real
-- historical/live claims and symmetric current-class wait materialization.
set local role postgres;
insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids, lessons, schedule_plan
) values (
  '00000000-0000-4000-8000-000000000304', '런타임 수학 B', '정규', '수학', '중1',
  '강정은', '목 18:00', '별관', 12, 100000, '수업 진행 중', '[]'::jsonb,
  '[]'::jsonb, '["00000000-0000-4000-8000-000000000402"]'::jsonb, '[]'::jsonb,
  '{"sessions":[{"date":"2026-07-23","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
);
insert into public.students(
  id, name, school, grade, parent_contact, status, class_ids, waitlist_class_ids
) values (
  '00000000-0000-4000-8000-000000000271', '런타임혼합취소', '런타임중', '중1',
  '01000001871', '재원', '[]'::jsonb, '[]'::jsonb
), (
  '00000000-0000-4000-8000-000000000272', '런타임마지막취소', '런타임중', '중1',
  '01000001872', '재원', '["00000000-0000-4000-8000-000000000301"]'::jsonb, '[]'::jsonb
);
update public.classes
set student_ids = student_ids || '"00000000-0000-4000-8000-000000000272"'::jsonb
where id = '00000000-0000-4000-8000-000000000301';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_cancel_cases on commit drop as
select
  public.create_registration_case(
    '런타임혼합취소', '중1', '런타임중', '01000001871', null, '본관',
    '2026-07-13 09:00+09'::timestamptz, array['영어','수학'], null, 'normal',
    'runtime-mixed-cancel-case'
  ) as mixed_case,
  public.create_registration_case(
    '런타임마지막취소', '중1', '런타임중', '01000001872', null, '본관',
    '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
    'runtime-last-cancel-case'
  ) as last_case;
create temporary table registration_runtime_cancel_tracks on commit drop as
select
  (cases.mixed_case ->> 'taskId')::uuid as mixed_task_id,
  max(track.id) filter (where track.task_id = (cases.mixed_case ->> 'taskId')::uuid and track.subject = '영어') as mixed_english_track_id,
  max(track.id) filter (where track.task_id = (cases.mixed_case ->> 'taskId')::uuid and track.subject = '수학') as mixed_math_track_id,
  (cases.last_case ->> 'taskId')::uuid as last_task_id,
  max(track.id) filter (where track.task_id = (cases.last_case ->> 'taskId')::uuid) as last_track_id
from registration_runtime_cancel_cases cases
join public.ops_registration_subject_tracks track
  on track.task_id in ((cases.mixed_case ->> 'taskId')::uuid, (cases.last_case ->> 'taskId')::uuid)
group by cases.mixed_case, cases.last_case;
set local role postgres;
update public.ops_tasks
set student_id = case
  when id = (select mixed_task_id from registration_runtime_cancel_tracks)
    then '00000000-0000-4000-8000-000000000271'::uuid
  else '00000000-0000-4000-8000-000000000272'::uuid end
where id in (
  (select mixed_task_id from registration_runtime_cancel_tracks),
  (select last_task_id from registration_runtime_cancel_tracks)
);
update public.ops_registration_subject_tracks
set pipeline_status = case
  when id = (select last_track_id from registration_runtime_cancel_tracks) then 'registered'
  else 'enrollment_processing' end
where id in (
  (select mixed_english_track_id from registration_runtime_cancel_tracks),
  (select mixed_math_track_id from registration_runtime_cancel_tracks),
  (select last_track_id from registration_runtime_cancel_tracks)
);
insert into public.ops_registration_admission_batches(
  id, task_id, revision_number, status, invoice_sent_at, payment_confirmed_at
)
values
  ('00000000-0000-4000-8000-000000000871', (select mixed_task_id from registration_runtime_cancel_tracks), 1, 'completed', now(), now()),
  ('00000000-0000-4000-8000-000000000872', (select mixed_task_id from registration_runtime_cancel_tracks), 2, 'draft', null, null),
  ('00000000-0000-4000-8000-000000000873', (select last_task_id from registration_runtime_cancel_tracks), 1, 'completed', now(), now());
insert into public.ops_registration_enrollments(
  id, track_id, student_id, admission_batch_id, class_id, textbook_id,
  class_start_date, class_start_session_key, class_start_session, status,
  makeedu_registered, roster_active, roster_released_at, roster_release_reason,
  roster_release_source_task_id, roster_release_kind, sort_order
)
values
  ('00000000-0000-4000-8000-000000000881', (select mixed_english_track_id from registration_runtime_cancel_tracks), '00000000-0000-4000-8000-000000000271', '00000000-0000-4000-8000-000000000871', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000401', '2026-07-22', '2026-07-22:1', '1회차', 'enrolled', true, false, now(), 'historical transfer release', '00000000-0000-4000-8000-000000000506', 'transfer', 0),
  ('00000000-0000-4000-8000-000000000882', (select mixed_english_track_id from registration_runtime_cancel_tracks), '00000000-0000-4000-8000-000000000271', '00000000-0000-4000-8000-000000000872', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000401', '2026-07-20', '2026-07-20:1', '1회차', 'planned', false, true, null, null, null, null, 1),
  ('00000000-0000-4000-8000-000000000883', (select mixed_math_track_id from registration_runtime_cancel_tracks), '00000000-0000-4000-8000-000000000271', '00000000-0000-4000-8000-000000000872', '00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000402', '2026-07-21', '2026-07-21:1', '1회차', 'planned', false, true, null, null, null, null, 0),
  ('00000000-0000-4000-8000-000000000885', (select last_track_id from registration_runtime_cancel_tracks), '00000000-0000-4000-8000-000000000272', '00000000-0000-4000-8000-000000000873', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000401', '2026-07-20', '2026-07-20:1', '1회차', 'enrolled', true, true, null, null, null, null, 0);
insert into public.ops_registration_enrollments(
  id, track_id, class_id, textbook_id, class_start_date, class_start_session_key,
  class_start_session, status, makeedu_registered, roster_active, sort_order
) values (
  '00000000-0000-4000-8000-000000000884', (select mixed_math_track_id from registration_runtime_cancel_tracks), '00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000402', '2026-07-23', '2026-07-23:1', '1회차', 'planned', false, false, 1
);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select public.cancel_registration_admission_batch(
  '00000000-0000-4000-8000-000000000872',
  jsonb_build_array(jsonb_build_object(
    'trackId', (select mixed_math_track_id from registration_runtime_cancel_tracks),
    'destination', 'waiting', 'waitingKind', 'current_class',
    'classId', '00000000-0000-4000-8000-000000000303'
  )),
  'mixed batch canceled', 'runtime-mixed-batch-cancel'
);
select pg_temp.registration_record(86,
  (select pipeline_status = 'registered' from public.ops_registration_subject_tracks
   where id = (select mixed_english_track_id from registration_runtime_cancel_tracks))
  and (select pipeline_status = 'waiting' and waiting_kind = 'current_class'
       from public.ops_registration_subject_tracks
       where id = (select mixed_math_track_id from registration_runtime_cancel_tracks))
  and (select count(*) = 3 from public.ops_registration_enrollments
       where id in (
         '00000000-0000-4000-8000-000000000882',
         '00000000-0000-4000-8000-000000000883',
         '00000000-0000-4000-8000-000000000884'
       ) and status = 'canceled' and not roster_active)
  and (select status = 'enrolled' and not roster_active
       from public.ops_registration_enrollments
       where id = '00000000-0000-4000-8000-000000000881')
);

-- A registered row's add-class draft can be canceled without changing the closed
-- projection; a later last-live-row cancellation routes to current-class waiting.
create temporary table registration_runtime_last_draft on commit drop as
select public.save_registration_enrollment_rows(
  (select last_track_id from registration_runtime_cancel_tracks),
  '[{"classId":"00000000-0000-4000-8000-000000000302","textbookId":"00000000-0000-4000-8000-000000000401","classStartDate":"2026-07-22","classStartSessionKey":"2026-07-22:1","classStartSession":"1회차","sortOrder":1}]'::jsonb,
  'runtime-last-draft-one'
) as payload;
select public.cancel_registration_enrollment(
  (select (payload #>> '{rows,0,id}')::uuid from registration_runtime_last_draft),
  null, null, null, 'remove add-class draft', 'runtime-last-draft-cancel'
);
alter table registration_runtime_last_draft add column second_payload jsonb;
update registration_runtime_last_draft
set second_payload = public.save_registration_enrollment_rows(
  (select last_track_id from registration_runtime_cancel_tracks),
  '[{"classId":"00000000-0000-4000-8000-000000000302","textbookId":"00000000-0000-4000-8000-000000000401","classStartDate":"2026-07-22","classStartSessionKey":"2026-07-22:1","classStartSession":"1회차","sortOrder":2}]'::jsonb,
  'runtime-last-draft-two'
);
select public.cancel_registration_enrollment(
  '00000000-0000-4000-8000-000000000885',
  'waiting', 'current_class', '00000000-0000-4000-8000-000000000301',
  'last live row canceled', 'runtime-last-live-cancel'
);
select pg_temp.registration_record(87,
  (select pipeline_status = 'waiting' and waiting_kind = 'current_class'
   from public.ops_registration_subject_tracks
   where id = (select last_track_id from registration_runtime_cancel_tracks))
  and (select count(*) = 3
       from public.ops_registration_enrollments enrollment
       where enrollment.track_id = (select last_track_id from registration_runtime_cancel_tracks)
         and enrollment.status = 'canceled')
  and (select status = 'canceled' and not roster_active
       from public.ops_registration_enrollments
       where id = '00000000-0000-4000-8000-000000000885')
);
select pg_temp.registration_record(107,
  (select count(*) = 2
   from public.ops_registration_enrollments enrollment
   where enrollment.status = 'waitlisted' and enrollment.roster_active
     and enrollment.track_id in (
       (select mixed_math_track_id from registration_runtime_cancel_tracks),
       (select last_track_id from registration_runtime_cancel_tracks)
     ))
  and (select waitlist_class_ids ? '00000000-0000-4000-8000-000000000303'
       from public.students where id = '00000000-0000-4000-8000-000000000271')
  and (select waitlist_ids ? '00000000-0000-4000-8000-000000000271'
       from public.classes where id = '00000000-0000-4000-8000-000000000303')
  and (select waitlist_class_ids ? '00000000-0000-4000-8000-000000000301'
       from public.students where id = '00000000-0000-4000-8000-000000000272')
  and (select waitlist_ids ? '00000000-0000-4000-8000-000000000272'
       from public.classes where id = '00000000-0000-4000-8000-000000000301')
);

-- 55-58 and 90: fixed legacy snapshots are resolved through the public migration RPC;
-- invalid evidence leaves the review row and creates no child activity.
set local role postgres;
insert into public.students(
  id, name, school, grade, contact, parent_contact, status,
  class_ids, waitlist_class_ids
)
values
  ('00000000-0000-4000-8000-000000000261', '런타임이관처리', '런타임중', '중1', null, '01000001861', '재원', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000262', '런타임이관오류', '런타임중', '중1', null, '01000001862', '재원', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000263', '런타임이관등록', '런타임중', '중1', null, '01000001863', '재원', '["00000000-0000-4000-8000-000000000302"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000264', '런타임이관등록오류', '런타임중', '중1', null, '01000001864', '재원', '[]'::jsonb, '[]'::jsonb);
update public.classes class
set student_ids = (
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
    '[]'::jsonb
  )
  from (
    select distinct source.value
    from (
      select element.value
      from pg_catalog.jsonb_array_elements_text(
        coalesce(class.student_ids, '[]'::jsonb)
      ) element(value)
      union all
      select '00000000-0000-4000-8000-000000000263'
    ) source
  ) canonical
)
where class.id = '00000000-0000-4000-8000-000000000302';
insert into public.ops_tasks(
  id, title, type, status, requested_by, student_id, student_name, subject, priority, campus
)
values
  ('00000000-0000-4000-8000-000000000561', '런타임 이관 처리', 'registration', 'done', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000261', '런타임이관처리', '영어', 'normal', '본관'),
  ('00000000-0000-4000-8000-000000000562', '런타임 이관 처리 오류', 'registration', 'done', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000262', '런타임이관오류', '영어', 'normal', '본관'),
  ('00000000-0000-4000-8000-000000000563', '런타임 이관 등록', 'registration', 'done', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000263', '런타임이관등록', '영어', 'normal', '본관'),
  ('00000000-0000-4000-8000-000000000564', '런타임 이관 등록 오류', 'registration', 'done', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000264', '런타임이관등록오류', '영어', 'normal', '본관');
insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone, common_revision,
  admission_notice_sent
)
values
  ('00000000-0000-4000-8000-000000000561', '2026-07-13 09:00+09', '중1', '런타임중', '01000001861', 1, false),
  ('00000000-0000-4000-8000-000000000562', '2026-07-13 09:00+09', '중1', '런타임중', '01000001862', 1, false),
  ('00000000-0000-4000-8000-000000000563', '2026-07-13 09:00+09', '중1', '런타임중', '01000001863', 1, false),
  ('00000000-0000-4000-8000-000000000564', '2026-07-13 09:00+09', '중1', '런타임중', '01000001864', 1, false);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, migration_review_required
)
values
  ('00000000-0000-4000-8000-000000000571', '00000000-0000-4000-8000-000000000561', '영어', 'migration_review', true),
  ('00000000-0000-4000-8000-000000000572', '00000000-0000-4000-8000-000000000562', '영어', 'migration_review', true),
  ('00000000-0000-4000-8000-000000000573', '00000000-0000-4000-8000-000000000563', '영어', 'migration_review', true),
  ('00000000-0000-4000-8000-000000000574', '00000000-0000-4000-8000-000000000564', '영어', 'migration_review', true);
insert into public.ops_task_events(
  task_id, actor_id, event_type, field_name, before_value, after_value
)
values
  ('00000000-0000-4000-8000-000000000561', '00000000-0000-4000-8000-000000000101', 'legacy_registration_imported', 'registration_legacy',
   '{"pipelineStatus":"5-1. 입학신청서 발송 완료","studentId":"00000000-0000-4000-8000-000000000261","classId":"00000000-0000-4000-8000-000000000301","textbookId":"00000000-0000-4000-8000-000000000401"}',
   '{"version":1,"trackId":"00000000-0000-4000-8000-000000000571","timestamps":{"taskUpdatedAt":"2026-07-13T09:00:00+09:00","classStartDate":"2026-07-20","classStartSession":"1회차"},"legacyBooleans":{"admissionNoticeSent":true,"makeeduRegistered":false,"makeeduInvoiceSent":false,"paymentChecked":false}}'),
  ('00000000-0000-4000-8000-000000000562', '00000000-0000-4000-8000-000000000101', 'legacy_registration_imported', 'registration_legacy',
   '{"pipelineStatus":"5-1. 입학신청서 발송 완료","studentId":"00000000-0000-4000-8000-000000000262","classId":"00000000-0000-4000-8000-000000000301","textbookId":"00000000-0000-4000-8000-000000000401"}',
   '{"version":1,"trackId":"00000000-0000-4000-8000-000000000572","timestamps":{"taskUpdatedAt":"2026-07-13T09:00:00+09:00","classStartDate":"2026-07-20","classStartSession":"1회차"},"legacyBooleans":{"admissionNoticeSent":false,"makeeduRegistered":false,"makeeduInvoiceSent":false,"paymentChecked":false}}'),
  ('00000000-0000-4000-8000-000000000563', '00000000-0000-4000-8000-000000000101', 'legacy_registration_imported', 'registration_legacy',
   '{"pipelineStatus":"7. 등록 완료","studentId":"00000000-0000-4000-8000-000000000263","classId":"00000000-0000-4000-8000-000000000302","textbookId":"00000000-0000-4000-8000-000000000401"}',
   '{"version":1,"trackId":"00000000-0000-4000-8000-000000000573","timestamps":{"taskUpdatedAt":"2026-07-13T09:00:00+09:00","classStartDate":"2026-07-22","classStartSession":"1회차"},"legacyBooleans":{"admissionNoticeSent":true,"makeeduRegistered":true,"makeeduInvoiceSent":true,"paymentChecked":true}}'),
  ('00000000-0000-4000-8000-000000000564', '00000000-0000-4000-8000-000000000101', 'legacy_registration_imported', 'registration_legacy',
   '{"pipelineStatus":"7. 등록 완료","studentId":"00000000-0000-4000-8000-000000000264","classId":"00000000-0000-4000-8000-000000000302","textbookId":"00000000-0000-4000-8000-000000000401"}',
   '{"version":1,"trackId":"00000000-0000-4000-8000-000000000574","timestamps":{"taskUpdatedAt":"2026-07-13T09:00:00+09:00","classStartDate":"2026-07-22","classStartSession":"1회차"},"legacyBooleans":{"admissionNoticeSent":true,"makeeduRegistered":true,"makeeduInvoiceSent":true,"paymentChecked":false}}');
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_migration_valid on commit drop as
select public.resolve_registration_migration_review(
  '00000000-0000-4000-8000-000000000561',
  '{"assignments":[{"group":"placement","trackId":"00000000-0000-4000-8000-000000000571","preserveAsCommonHistory":false}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000571","targetStatus":"enrollment_processing","waitingKind":null,"classId":"00000000-0000-4000-8000-000000000301"}]}'::jsonb,
  'runtime-migration-processing'
) as processing_response,
public.resolve_registration_migration_review(
  '00000000-0000-4000-8000-000000000563',
  '{"assignments":[{"group":"placement","trackId":"00000000-0000-4000-8000-000000000573","preserveAsCommonHistory":false}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000573","targetStatus":"registered","waitingKind":null,"classId":"00000000-0000-4000-8000-000000000302"}]}'::jsonb,
  'runtime-migration-registered'
) as registered_response;
select pg_temp.registration_record(55,
  (select pipeline_status = 'enrollment_processing' and not migration_review_required
   from public.ops_registration_subject_tracks
   where id = '00000000-0000-4000-8000-000000000571')
  and exists (
    select 1 from public.ops_registration_admission_batches batch
    join public.ops_registration_enrollments enrollment on enrollment.admission_batch_id = batch.id
    where batch.task_id = '00000000-0000-4000-8000-000000000561'
      and batch.status = 'draft' and enrollment.status = 'planned'
      and enrollment.roster_active
  )
);
select pg_temp.registration_record(56, pg_temp.registration_throws(
  $$select public.resolve_registration_migration_review(
    '00000000-0000-4000-8000-000000000562',
    '{"assignments":[{"group":"placement","trackId":"00000000-0000-4000-8000-000000000572","preserveAsCommonHistory":false}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000572","targetStatus":"enrollment_processing","waitingKind":null,"classId":"00000000-0000-4000-8000-000000000301"}]}'::jsonb,
    'runtime-migration-processing-invalid'
  )$$,
  'registration_migration_placement_evidence_invalid'
) and not exists (
  select 1 from public.ops_registration_enrollments
  where track_id = '00000000-0000-4000-8000-000000000572'
));
select pg_temp.registration_record(57,
  (select pipeline_status = 'registered' and not migration_review_required
   from public.ops_registration_subject_tracks
   where id = '00000000-0000-4000-8000-000000000573')
  and exists (
    select 1 from public.ops_registration_admission_batches batch
    join public.ops_registration_enrollments enrollment on enrollment.admission_batch_id = batch.id
    where batch.task_id = '00000000-0000-4000-8000-000000000563'
      and batch.status = 'completed' and enrollment.status = 'enrolled'
      and enrollment.roster_active
  )
);
select pg_temp.registration_record(58, pg_temp.registration_throws(
  $$select public.resolve_registration_migration_review(
    '00000000-0000-4000-8000-000000000564',
    '{"assignments":[{"group":"placement","trackId":"00000000-0000-4000-8000-000000000574","preserveAsCommonHistory":false}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000574","targetStatus":"registered","waitingKind":null,"classId":"00000000-0000-4000-8000-000000000302"}]}'::jsonb,
    'runtime-migration-registered-invalid'
  )$$,
  'registration_migration_placement_evidence_invalid'
) and not exists (
  select 1 from public.ops_registration_enrollments
  where track_id = '00000000-0000-4000-8000-000000000574'
));
select pg_temp.registration_record(90,
  (select status = 'in_progress' from public.ops_tasks
   where id = '00000000-0000-4000-8000-000000000561')
  and (select count(*) = 1 from public.ops_task_events
       where task_id = '00000000-0000-4000-8000-000000000561'
         and event_type = 'migration_review_resolved')
);

-- 91-99: legacy evidence anomalies are exercised against the migration resolver, not
-- inferred from its source. Safe common-history resolutions create no child activity;
-- unsafe placement imports fail and retain migration_review.
set local role postgres;
insert into public.students(
  id, name, school, grade, parent_contact, status, class_ids, waitlist_class_ids
)
values
  ('00000000-0000-4000-8000-000000000291', '런타임비대칭대기', '런타임중', '중1', '01000001996', '재원', '["00000000-0000-4000-8000-000000000301"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000292', '런타임비대칭등록', '런타임중', '중1', '01000001997', '재원', '["00000000-0000-4000-8000-000000000301"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000293', '런타임세션오류', '런타임중', '중1', '01000001999', '재원', '[]'::jsonb, '[]'::jsonb);
insert into public.ops_tasks(
  id, title, type, status, requested_by, student_id, student_name, subject, priority, campus
)
select
  ('00000000-0000-4000-8000-000000000' || right(n::text, 3))::uuid,
  '런타임 검토 ' || n::text,
  'registration', 'done', '00000000-0000-4000-8000-000000000101',
  case n when 596 then '00000000-0000-4000-8000-000000000291'::uuid
         when 597 then '00000000-0000-4000-8000-000000000292'::uuid
         when 599 then '00000000-0000-4000-8000-000000000293'::uuid end,
  case n when 596 then '런타임비대칭대기'
         when 597 then '런타임비대칭등록'
         when 599 then '런타임세션오류'
         else '런타임검토' || n::text end,
  '영어', 'normal', '본관'
from generate_series(591, 599) n;
insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone, common_revision,
  level_test_place, visit_consultation_place
)
select task.id, '2026-07-13 09:00+09', '중1', '런타임중',
  case right(task.id::text, 3)
    when '596' then '01000001996'
    when '597' then '01000001997'
    when '599' then '01000001999'
    else '0100000' || right(task.id::text, 4)
  end,
  1, null, null
from public.ops_tasks task
where task.id::text ~ '00000000-0000-4000-8000-00000000059[1-9]';
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, migration_review_required
)
select
  ('00000000-0000-4000-8000-000000000' || (100 + n)::text)::uuid,
  ('00000000-0000-4000-8000-000000000' || n::text)::uuid,
  '영어', 'migration_review', true
from generate_series(591, 599) n;
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, migration_review_required
) values (
  '00000000-0000-4000-8000-000000000795',
  '00000000-0000-4000-8000-000000000595',
  '수학', 'migration_review', true
);
insert into public.ops_task_events(
  task_id, actor_id, event_type, field_name, before_value, after_value
)
values
  ('00000000-0000-4000-8000-000000000591','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"1. 레벨테스트 예약","studentId":null,"classId":null,"textbookId":null}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000691","timestamps":{"levelTestAt":"2026-07-20T10:00:00+09:00"},"legacyBooleans":{}}'),
  ('00000000-0000-4000-8000-000000000592','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"2. 상담 예약","studentId":null,"classId":null,"textbookId":null}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000692","timestamps":{"visitConsultationAt":"2026-07-21T10:00:00+09:00"},"legacyBooleans":{}}'),
  ('00000000-0000-4000-8000-000000000593','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"6. 수납 확인","studentId":null,"classId":null,"textbookId":null}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000693","timestamps":{"taskUpdatedAt":"2026-07-13T09:00:00+09:00"},"legacyBooleans":{"admissionNoticeSent":true,"makeeduRegistered":true,"makeeduInvoiceSent":false,"paymentChecked":true}}'),
  ('00000000-0000-4000-8000-000000000594','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"7. 등록 완료","studentId":null,"classId":null,"textbookId":null}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000694","timestamps":{},"legacyBooleans":{"admissionNoticeSent":true,"makeeduRegistered":true,"makeeduInvoiceSent":true,"paymentChecked":true}}'),
  ('00000000-0000-4000-8000-000000000595','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"2. 상담 예약","studentId":null,"classId":null,"textbookId":null}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000695","timestamps":{"phoneConsultationAt":"2026-07-21T10:00:00+09:00"},"legacyBooleans":{}}'),
  ('00000000-0000-4000-8000-000000000595','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"2. 상담 예약","studentId":null,"classId":null,"textbookId":null}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000795","timestamps":{"phoneConsultationAt":"2026-07-21T10:00:00+09:00"},"legacyBooleans":{}}'),
  ('00000000-0000-4000-8000-000000000596','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"4-1. 현재반 대기 신청","studentId":"00000000-0000-4000-8000-000000000291","classId":"00000000-0000-4000-8000-000000000301","textbookId":null}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000696","timestamps":{},"legacyBooleans":{}}'),
  ('00000000-0000-4000-8000-000000000597','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"7. 등록 완료","studentId":"00000000-0000-4000-8000-000000000292","classId":"00000000-0000-4000-8000-000000000301","textbookId":"00000000-0000-4000-8000-000000000401"}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000697","timestamps":{"taskUpdatedAt":"2026-07-13T09:00:00+09:00","classStartDate":"2026-07-20","classStartSession":"1회차"},"legacyBooleans":{"admissionNoticeSent":true,"makeeduRegistered":true,"makeeduInvoiceSent":true,"paymentChecked":true}}'),
  ('00000000-0000-4000-8000-000000000598','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"6. 수납 확인","studentId":null,"classId":null,"textbookId":null}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000698","timestamps":{"taskUpdatedAt":"2026-07-13T09:00:00+09:00"},"legacyBooleans":{"admissionNoticeSent":true,"makeeduRegistered":true,"makeeduInvoiceSent":true,"paymentChecked":false}}'),
  ('00000000-0000-4000-8000-000000000599','00000000-0000-4000-8000-000000000101','legacy_registration_imported','registration_legacy','{"pipelineStatus":"6. 수납 확인","studentId":"00000000-0000-4000-8000-000000000293","classId":"00000000-0000-4000-8000-000000000301","textbookId":"00000000-0000-4000-8000-000000000401"}','{"version":1,"trackId":"00000000-0000-4000-8000-000000000699","timestamps":{"taskUpdatedAt":"2026-07-13T09:00:00+09:00","classStartDate":"2026-07-25","classStartSession":"1회차"},"legacyBooleans":{"admissionNoticeSent":true,"makeeduRegistered":true,"makeeduInvoiceSent":true,"paymentChecked":false}}');
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

select public.resolve_registration_migration_review(
  '00000000-0000-4000-8000-000000000591',
  '{"assignments":[{"group":"level_test","trackId":null,"preserveAsCommonHistory":true}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000691","targetStatus":"inquiry","waitingKind":null,"classId":null}]}'::jsonb,
  'runtime-review-missing-level-place'
);
select pg_temp.registration_record(91,
  (select pipeline_status = 'inquiry' from public.ops_registration_subject_tracks
   where id = '00000000-0000-4000-8000-000000000691')
  and not exists (select 1 from public.ops_registration_level_tests where track_id = '00000000-0000-4000-8000-000000000691')
);
select public.resolve_registration_migration_review(
  '00000000-0000-4000-8000-000000000592',
  '{"assignments":[{"group":"consultation","trackId":null,"preserveAsCommonHistory":true}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000692","targetStatus":"inquiry","waitingKind":null,"classId":null}]}'::jsonb,
  'runtime-review-incomplete-visit'
);
select pg_temp.registration_record(92,
  (select pipeline_status = 'inquiry' from public.ops_registration_subject_tracks
   where id = '00000000-0000-4000-8000-000000000692')
  and not exists (select 1 from public.ops_registration_consultations where track_id = '00000000-0000-4000-8000-000000000692')
);
select public.resolve_registration_migration_review(
  '00000000-0000-4000-8000-000000000593',
  '{"assignments":[{"group":"placement","trackId":null,"preserveAsCommonHistory":true}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000693","targetStatus":"inquiry","waitingKind":null,"classId":null}]}'::jsonb,
  'runtime-review-payment-without-invoice'
);
select pg_temp.registration_record(93,
  (select pipeline_status = 'inquiry' from public.ops_registration_subject_tracks
   where id = '00000000-0000-4000-8000-000000000693')
  and not exists (select 1 from public.ops_registration_admission_batches where task_id = '00000000-0000-4000-8000-000000000593')
);
select public.resolve_registration_migration_review(
  '00000000-0000-4000-8000-000000000594',
  '{"assignments":[{"group":"placement","trackId":null,"preserveAsCommonHistory":true}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000694","targetStatus":"inquiry","waitingKind":null,"classId":null}]}'::jsonb,
  'runtime-review-registered-missing-evidence'
);
select pg_temp.registration_record(94,
  (select pipeline_status = 'inquiry' from public.ops_registration_subject_tracks
   where id = '00000000-0000-4000-8000-000000000694')
  and not exists (select 1 from public.ops_registration_enrollments where track_id = '00000000-0000-4000-8000-000000000694')
);
select public.resolve_registration_migration_review(
  '00000000-0000-4000-8000-000000000595',
  '{"assignments":[{"group":"consultation","trackId":null,"preserveAsCommonHistory":true}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000695","targetStatus":"inquiry","waitingKind":null,"classId":null},{"trackId":"00000000-0000-4000-8000-000000000795","targetStatus":"inquiry","waitingKind":null,"classId":null}]}'::jsonb,
  'runtime-review-multi-counselor'
);
select pg_temp.registration_record(95,
  (select counselor is null from public.ops_registration_details
   where task_id = '00000000-0000-4000-8000-000000000595')
  and (select secondary_assignee_id is null from public.ops_tasks
       where id = '00000000-0000-4000-8000-000000000595')
);
select pg_temp.registration_record(96, pg_temp.registration_throws(
  $$select public.resolve_registration_migration_review(
    '00000000-0000-4000-8000-000000000596',
    '{"assignments":[{"group":"placement","trackId":"00000000-0000-4000-8000-000000000696","preserveAsCommonHistory":false}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000696","targetStatus":"waiting","waitingKind":"current_class","classId":"00000000-0000-4000-8000-000000000301"}]}'::jsonb,
    'runtime-review-asymmetric-wait'
  )$$,
  'registration_roster_projection_invalid|registration_roster_mode_conflict'
) and (select pipeline_status = 'migration_review' from public.ops_registration_subject_tracks where id = '00000000-0000-4000-8000-000000000696'));
select pg_temp.registration_record(97, pg_temp.registration_throws(
  $$select public.resolve_registration_migration_review(
    '00000000-0000-4000-8000-000000000597',
    '{"assignments":[{"group":"placement","trackId":"00000000-0000-4000-8000-000000000697","preserveAsCommonHistory":false}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000697","targetStatus":"registered","waitingKind":null,"classId":"00000000-0000-4000-8000-000000000301"}]}'::jsonb,
    'runtime-review-asymmetric-registered'
  )$$,
  'registration_migration_placement_evidence_invalid'
) and (select pipeline_status = 'migration_review' from public.ops_registration_subject_tracks where id = '00000000-0000-4000-8000-000000000697'));
select pg_temp.registration_record(98, pg_temp.registration_throws(
  $$select public.resolve_registration_migration_review(
    '00000000-0000-4000-8000-000000000598',
    '{"assignments":[{"group":"placement","trackId":"00000000-0000-4000-8000-000000000698","preserveAsCommonHistory":false}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000698","targetStatus":"enrollment_processing","waitingKind":null,"classId":null}]}'::jsonb,
    'runtime-review-zero-enrollment'
  )$$,
  'registration_migration_placement_evidence_invalid'
) and not exists (select 1 from public.ops_registration_enrollments where track_id = '00000000-0000-4000-8000-000000000698'));
select pg_temp.registration_record(99, pg_temp.registration_throws(
  $$select public.resolve_registration_migration_review(
    '00000000-0000-4000-8000-000000000599',
    '{"assignments":[{"group":"placement","trackId":"00000000-0000-4000-8000-000000000699","preserveAsCommonHistory":false}],"trackStates":[{"trackId":"00000000-0000-4000-8000-000000000699","targetStatus":"enrollment_processing","waitingKind":null,"classId":"00000000-0000-4000-8000-000000000301"}]}'::jsonb,
    'runtime-review-invalid-session'
  )$$,
  'registration_migration_placement_evidence_invalid'
) and not exists (select 1 from public.ops_registration_enrollments where track_id = '00000000-0000-4000-8000-000000000699'));
set local role postgres;
update public.students
set class_ids = '[]'::jsonb
where id in (
  '00000000-0000-4000-8000-000000000291',
  '00000000-0000-4000-8000-000000000292'
);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

-- 100-105: exercise real status changes, same-stage edits/replays, and parent director
-- precedence on dual-subject cases.
create temporary table registration_runtime_stage_case on commit drop as
select public.create_registration_case(
  '런타임단계', '중1', '런타임중', '01000001831', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어', '수학'], null, 'normal',
  'runtime-stage-case'
) as payload;
create temporary table registration_runtime_stage_tracks on commit drop as
select
  (fixture.payload ->> 'taskId')::uuid as task_id,
  max(track.id) filter (where track.subject = '영어') as english_track_id,
  max(track.id) filter (where track.subject = '수학') as math_track_id,
  max(track.stage_entered_at) filter (where track.subject = '영어') as original_english_stage
from registration_runtime_stage_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid
group by fixture.payload;
set local role postgres;
update public.ops_registration_subject_tracks
set stage_entered_at = '2026-01-01 00:00+09'
where id = (select english_track_id from registration_runtime_stage_tracks);
update registration_runtime_stage_tracks
set original_english_stage = '2026-01-01 00:00+09';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select public.route_registration_inquiry(
  (select english_track_id from registration_runtime_stage_tracks),
  'consultation_waiting', null, null, 'runtime-stage-transition'
);
select pg_temp.registration_record(100,
  (select track.stage_entered_at > fixture.original_english_stage
   from public.ops_registration_subject_tracks track
   cross join registration_runtime_stage_tracks fixture
   where track.id = fixture.english_track_id)
);
create temporary table registration_runtime_stage_after on commit drop as
select stage_entered_at
from public.ops_registration_subject_tracks
where id = (select english_track_id from registration_runtime_stage_tracks);
create temporary table registration_runtime_stage_common on commit drop as
select public.update_registration_case_common(
  fixture.task_id, '런타임단계', '중1', '런타임중', '01000001831', null,
  '본관', '2026-07-13 09:00+09'::timestamptz, 'same-stage', 'normal', 1,
  'runtime-stage-common'
) as first_response
from registration_runtime_stage_tracks fixture;
select public.assign_registration_track_director(
  (select english_track_id from registration_runtime_stage_tracks),
  '00000000-0000-4000-8000-000000000102', 'manual', null, 2,
  'runtime-stage-manual-director'
);
select pg_temp.registration_record(101,
  (select track.stage_entered_at = snapshot.stage_entered_at
   from public.ops_registration_subject_tracks track
   cross join registration_runtime_stage_after snapshot
   where track.id = (select english_track_id from registration_runtime_stage_tracks))
);
alter table registration_runtime_stage_common add column replay_response jsonb;
update registration_runtime_stage_common
set replay_response = public.update_registration_case_common(
  (select task_id from registration_runtime_stage_tracks),
  '런타임단계', '중1', '런타임중', '01000001831', null,
  '본관', '2026-07-13 09:00+09'::timestamptz, 'same-stage', 'normal', 1,
  'runtime-stage-common'
);
select pg_temp.registration_record(102,
  (select first_response = replay_response from registration_runtime_stage_common)
  and (select track.stage_entered_at = snapshot.stage_entered_at
       from public.ops_registration_subject_tracks track
       cross join registration_runtime_stage_after snapshot
       where track.id = (select english_track_id from registration_runtime_stage_tracks))
);
select pg_temp.registration_record(103,
  (select task.secondary_assignee_id = '00000000-0000-4000-8000-000000000102'
   from public.ops_tasks task
   where task.id = (select task_id from registration_runtime_stage_tracks))
  and (select detail.counselor = '강부희'
       from public.ops_registration_details detail
       where detail.task_id = (select task_id from registration_runtime_stage_tracks))
);

create temporary table registration_runtime_projection_case on commit drop as
select public.create_registration_case(
  '런타임투영', '중1', '런타임중', '01000001832', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어', '수학'], null, 'normal',
  'runtime-projection-case'
) as payload;
create temporary table registration_runtime_projection_tracks on commit drop as
select
  (fixture.payload ->> 'taskId')::uuid as task_id,
  max(track.id) filter (where track.subject = '영어') as english_track_id,
  max(track.id) filter (where track.subject = '수학') as math_track_id
from registration_runtime_projection_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid
group by fixture.payload;
set local role postgres;
update public.teacher_catalogs
set is_visible = false
where id = '00000000-0000-4000-8000-000000000111';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select public.assign_registration_track_director(
  (select english_track_id from registration_runtime_projection_tracks),
  null, 'clear_default', null, 1, 'runtime-projection-clear-english'
);
set local role postgres;
update public.teacher_catalogs
set is_visible = true
where id = '00000000-0000-4000-8000-000000000111';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select public.assign_registration_track_director(
  (select math_track_id from registration_runtime_projection_tracks),
  '00000000-0000-4000-8000-000000000103', 'manual', null, 1,
  'runtime-projection-math-director'
);
select pg_temp.registration_record(104,
  (select task.secondary_assignee_id is null
   from public.ops_tasks task
   where task.id = (select task_id from registration_runtime_projection_tracks))
  and (select detail.counselor is null
       from public.ops_registration_details detail
       where detail.task_id = (select task_id from registration_runtime_projection_tracks))
);
select public.route_registration_inquiry(
  (select english_track_id from registration_runtime_projection_tracks),
  'inquiry_closed', null, null, 'runtime-projection-close-english'
);
select public.route_registration_inquiry(
  (select math_track_id from registration_runtime_projection_tracks),
  'inquiry_closed', null, null, 'runtime-projection-close-math'
);
select pg_temp.registration_record(105,
  (select task.secondary_assignee_id is null and task.status = 'canceled'
   from public.ops_tasks task
   where task.id = (select task_id from registration_runtime_projection_tracks))
  and (select detail.counselor is null
       from public.ops_registration_details detail
       where detail.task_id = (select task_id from registration_runtime_projection_tracks))
);

-- 106: both phone and visit completion revalidate the default against changed grade/year.
create temporary table registration_runtime_stale_consult_cases on commit drop as
select
  public.create_registration_case(
    '런타임만료전화', '중1', '런타임중', '01000001833', null, '본관',
    '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
    'runtime-stale-phone-case'
  ) as phone_case,
  public.create_registration_case(
    '런타임만료방문', '중1', '런타임중', '01000001834', null, '본관',
    '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
    'runtime-stale-visit-case-two'
  ) as visit_case;
create temporary table registration_runtime_stale_consult_tracks on commit drop as
select
  (cases.phone_case ->> 'taskId')::uuid as phone_task_id,
  (select id from public.ops_registration_subject_tracks where task_id = (cases.phone_case ->> 'taskId')::uuid) as phone_track_id,
  (cases.visit_case ->> 'taskId')::uuid as visit_task_id,
  (select id from public.ops_registration_subject_tracks where task_id = (cases.visit_case ->> 'taskId')::uuid) as visit_track_id
from registration_runtime_stale_consult_cases cases;
select public.route_registration_inquiry(
  (select phone_track_id from registration_runtime_stale_consult_tracks),
  'consultation_waiting', null, null, 'runtime-stale-phone-route'
);
select public.route_registration_inquiry(
  (select visit_track_id from registration_runtime_stale_consult_tracks),
  'consultation_waiting', null, null, 'runtime-stale-visit-route'
);
create temporary table registration_runtime_stale_visit_two on commit drop as
select public.save_registration_shared_appointment(
  null, fixture.visit_task_id, 'visit_consultation',
  '2026-07-25 14:00+09'::timestamptz, '원장실', array[fixture.visit_track_id],
  false, null, 'runtime-stale-visit-save-two'
) as payload
from registration_runtime_stale_consult_tracks fixture;
set local role postgres;
update public.ops_registration_details
set school_grade = '중2'
where task_id = (select phone_task_id from registration_runtime_stale_consult_tracks);
update public.ops_registration_details
set inquiry_at = '2027-07-13 09:00+09'
where task_id = (select visit_task_id from registration_runtime_stale_consult_tracks);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000102');
select pg_temp.registration_record(106,
  pg_temp.registration_throws(
    format(
      $$select public.complete_registration_consultation(%L::uuid, 'not_registered', null, null, 'runtime-stale-phone-complete')$$,
      (select consultation.id from public.ops_registration_consultations consultation
       where consultation.track_id = (select phone_track_id from registration_runtime_stale_consult_tracks)
         and consultation.status = 'waiting')
    ),
    'registration_director_refresh_required'
  )
  and pg_temp.registration_throws(
    format(
      $$select public.complete_registration_consultation(%L::uuid, 'not_registered', null, null, 'runtime-stale-visit-complete')$$,
      (select consultation.id from public.ops_registration_consultations consultation
       where consultation.track_id = (select visit_track_id from registration_runtime_stale_consult_tracks)
         and consultation.status = 'scheduled')
    ),
    'registration_director_refresh_required'
  )
);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

-- Message fixtures use separate parents so the one-live-claim index is exercised rather
-- than bypassed. Provider payloads remain visible only to postgres/service_role.
set local role postgres;
insert into public.ops_tasks(
  id, title, type, status, requested_by, student_name, subject, priority
)
values
  ('00000000-0000-4000-8000-000000000521', '런타임 메시지 A', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지A', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000522', '런타임 메시지 B', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지B', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000523', '런타임 메시지 C', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지C', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000524', '런타임 메시지 D', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지D', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000525', '런타임 메시지 E', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지E', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000526', '런타임 메시지 F', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지F', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000527', '런타임 메시지 G', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지G', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000529', '런타임 메시지 H', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지H', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000530', '런타임 메시지 I', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '메시지I', '영어', 'normal');
insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone, common_revision,
  admission_notice_sent
)
select id, '2026-07-13 09:00+09'::timestamptz, '중1', '런타임중',
       '0100000' || right(id::text, 4), 1, false
from public.ops_tasks
where id in (
  '00000000-0000-4000-8000-000000000521',
  '00000000-0000-4000-8000-000000000522',
  '00000000-0000-4000-8000-000000000523',
  '00000000-0000-4000-8000-000000000524',
  '00000000-0000-4000-8000-000000000525',
  '00000000-0000-4000-8000-000000000526',
  '00000000-0000-4000-8000-000000000527',
  '00000000-0000-4000-8000-000000000529',
  '00000000-0000-4000-8000-000000000530'
);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at
)
values
  ('00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-000000000521', '영어', 'enrollment_decided', '00000000-0000-4000-8000-000000000102', 'manual', now()),
  ('00000000-0000-4000-8000-000000000532', '00000000-0000-4000-8000-000000000522', '영어', 'enrollment_decided', '00000000-0000-4000-8000-000000000102', 'manual', now()),
  ('00000000-0000-4000-8000-000000000533', '00000000-0000-4000-8000-000000000523', '영어', 'enrollment_decided', '00000000-0000-4000-8000-000000000102', 'manual', now()),
  ('00000000-0000-4000-8000-000000000534', '00000000-0000-4000-8000-000000000524', '영어', 'enrollment_decided', '00000000-0000-4000-8000-000000000102', 'manual', now()),
  ('00000000-0000-4000-8000-000000000535', '00000000-0000-4000-8000-000000000525', '영어', 'enrollment_decided', '00000000-0000-4000-8000-000000000102', 'manual', now()),
  ('00000000-0000-4000-8000-000000000536', '00000000-0000-4000-8000-000000000526', '영어', 'enrollment_decided', '00000000-0000-4000-8000-000000000102', 'manual', now()),
  ('00000000-0000-4000-8000-000000000537', '00000000-0000-4000-8000-000000000527', '영어', 'enrollment_decided', '00000000-0000-4000-8000-000000000102', 'manual', now()),
  ('00000000-0000-4000-8000-000000000539', '00000000-0000-4000-8000-000000000529', '영어', 'enrollment_decided', '00000000-0000-4000-8000-000000000102', 'manual', now()),
  ('00000000-0000-4000-8000-000000000540', '00000000-0000-4000-8000-000000000530', '영어', 'enrollment_decided', '00000000-0000-4000-8000-000000000102', 'manual', now());
insert into public.ops_registration_messages(
  id, task_id, template_key, request_key, status, claim_active,
  recipient_last4, sent_by, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000000541', '00000000-0000-4000-8000-000000000521', 'admission_application', 'runtime-message-unknown', 'unknown', true, '0521', '00000000-0000-4000-8000-000000000101', now() - interval '1 hour', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000542', '00000000-0000-4000-8000-000000000522', 'admission_application', 'runtime-message-pending-a', 'pending', true, '0522', '00000000-0000-4000-8000-000000000101', now(), now()),
  ('00000000-0000-4000-8000-000000000543', '00000000-0000-4000-8000-000000000523', 'admission_application', 'runtime-message-pending-b', 'pending', true, '0523', '00000000-0000-4000-8000-000000000101', now(), now()),
  ('00000000-0000-4000-8000-000000000544', '00000000-0000-4000-8000-000000000524', 'admission_application', 'runtime-message-pending-c', 'pending', true, '0524', '00000000-0000-4000-8000-000000000101', now(), now()),
  ('00000000-0000-4000-8000-000000000545', '00000000-0000-4000-8000-000000000525', 'admission_application', 'runtime-message-failed-hold', 'failed', true, '0525', '00000000-0000-4000-8000-000000000101', now(), now()),
  ('00000000-0000-4000-8000-000000000546', '00000000-0000-4000-8000-000000000526', 'admission_application', 'runtime-message-reconcile-chain', 'unknown', true, '0526', '00000000-0000-4000-8000-000000000101', now() - interval '1 hour', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000547', '00000000-0000-4000-8000-000000000527', 'admission_application', 'runtime-message-timer-reset', 'unknown', true, '0527', '00000000-0000-4000-8000-000000000101', now() - interval '1 hour', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000548', '00000000-0000-4000-8000-000000000529', 'admission_application', 'runtime-message-failed-active', 'failed', true, '0529', '00000000-0000-4000-8000-000000000101', now(), now()),
  ('00000000-0000-4000-8000-000000000549', '00000000-0000-4000-8000-000000000530', 'admission_application', 'runtime-message-failed-released', 'failed', false, '0530', '00000000-0000-4000-8000-000000000101', now(), now());
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

-- 108-118: browser reconciliation is evidence-bound and the provider finalizer is not.
select pg_temp.registration_record(108,
  pg_temp.registration_throws(
    $$select public.reconcile_registration_admission_message(
      '00000000-0000-4000-8000-000000000541', 'accepted', '{}'::jsonb,
      '', 'runtime-reconcile-missing'
    )$$,
    'registration_reconciliation_reason_required'
  )
  and pg_temp.registration_throws(
    $$select public.reconcile_registration_admission_message(
      '00000000-0000-4000-8000-000000000541', 'accepted',
      '{"unknown":true}'::jsonb, 'manual evidence', 'runtime-reconcile-unknown-key'
    )$$,
    'registration_provider_evidence_invalid'
  )
);
select pg_temp.registration_record(109, pg_temp.registration_throws(
  $$select public.reconcile_registration_admission_message(
    '00000000-0000-4000-8000-000000000542', 'failed',
    '{"lookupRequestKey":"runtime-message-pending-a","observedState":"failed"}'::jsonb,
    'browser may not decide pending', 'runtime-pending-reconcile'
  )$$,
  'registration_message_provider_check_required'
));
create temporary table registration_runtime_reconcile on commit drop as
select public.reconcile_registration_admission_message(
  '00000000-0000-4000-8000-000000000541', 'accepted',
  '{"providerMessageId":"runtime-provider-accepted","observedState":"accepted"}'::jsonb,
  'provider accepted', 'runtime-unknown-accepted'
) as first_response;
select public.mark_registration_admission_notice_sent(
  '00000000-0000-4000-8000-000000000521',
  'runtime-message-unknown', 'runtime-mark-accepted'
);
set local role postgres;
update public.ops_registration_subject_tracks
set pipeline_status = 'waiting', waiting_kind = 'next_term_opening'
where id = '00000000-0000-4000-8000-000000000531';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_accepted_recovery on commit drop as
select public.claim_registration_admission_message(
  '00000000-0000-4000-8000-000000000521', 'runtime-message-unknown'
) as payload;
select pg_temp.registration_record(110,
  (select admission_notice_sent from public.ops_registration_details
   where task_id = '00000000-0000-4000-8000-000000000521')
  and (select count(*) = 1 from public.ops_task_events
       where task_id = '00000000-0000-4000-8000-000000000521'
         and event_type = 'customer_message_sent')
  and (select payload @> '{"claimStatus":"accepted","claimActive":true,"shouldSend":false}'::jsonb
       from registration_runtime_accepted_recovery)
);

create temporary table registration_runtime_failed_hold_chain on commit drop as
select public.reconcile_registration_admission_message(
  '00000000-0000-4000-8000-000000000546', 'failed',
  '{"lookupRequestKey":"runtime-message-reconcile-chain","observedState":"failed"}'::jsonb,
  'provider failed hold', 'runtime-chain-failed-hold'
) as failed_response;
select pg_temp.registration_record(111,
  (select status = 'failed' and claim_active
   from public.ops_registration_messages
   where id = '00000000-0000-4000-8000-000000000546')
  and pg_temp.registration_throws(
    $$select public.update_registration_case_common(
      '00000000-0000-4000-8000-000000000526', '메시지F변경', '중1', '런타임중',
      '01000000526', null, '본관', '2026-07-13 09:00+09'::timestamptz,
      null, 'normal', 1, 'runtime-chain-identity-blocked'
    )$$,
    'registration_student_identity_correction_required'
  )
);
alter table registration_runtime_failed_hold_chain add column accepted_response jsonb;
alter table registration_runtime_failed_hold_chain add column replay_response jsonb;
alter table registration_runtime_failed_hold_chain add column accepted_at timestamptz;
update registration_runtime_failed_hold_chain
set accepted_response = public.reconcile_registration_admission_message(
      '00000000-0000-4000-8000-000000000546', 'accepted',
      '{"providerMessageId":"runtime-chain-accepted","observedState":"accepted"}'::jsonb,
      'later provider acceptance', 'runtime-chain-accepted'
    ),
    accepted_at = clock_timestamp();
update registration_runtime_failed_hold_chain
set replay_response = public.reconcile_registration_admission_message(
  '00000000-0000-4000-8000-000000000546', 'accepted',
  '{"providerMessageId":"runtime-chain-accepted","observedState":"accepted"}'::jsonb,
  'later provider acceptance', 'runtime-chain-accepted'
);
select pg_temp.registration_record(112,
  (select status = 'accepted' and claim_active
   from public.ops_registration_messages
   where id = '00000000-0000-4000-8000-000000000546')
  and (select accepted_response @> '{"nextStatus":"accepted","claimActive":true}'::jsonb
       from registration_runtime_failed_hold_chain)
);
select pg_temp.registration_record(113,
  (select accepted_response = replay_response
   from registration_runtime_failed_hold_chain)
  and (select count(*) = 2
       from public.ops_task_events
       where task_id = '00000000-0000-4000-8000-000000000526'
         and event_type = 'registration_admission_message_reconciled')
  and (select updated_at <= (select accepted_at from registration_runtime_failed_hold_chain)
       from public.ops_registration_messages
       where id = '00000000-0000-4000-8000-000000000546')
);

create temporary table registration_runtime_timer_reset on commit drop as
select updated_at as old_unknown_at
from public.ops_registration_messages
where id = '00000000-0000-4000-8000-000000000547';
select public.reconcile_registration_admission_message(
  '00000000-0000-4000-8000-000000000547', 'failed',
  '{"lookupRequestKey":"runtime-message-timer-reset","observedState":"failed"}'::jsonb,
  'reset release timer', 'runtime-timer-failed-hold'
);
select pg_temp.registration_record(116,
  (select message.updated_at > timer.old_unknown_at
   from public.ops_registration_messages message
   cross join registration_runtime_timer_reset timer
   where message.id = '00000000-0000-4000-8000-000000000547')
  and pg_temp.registration_throws(
    $$select public.release_registration_admission_message_retry(
      '00000000-0000-4000-8000-000000000547',
      '{"lookupRequestKey":"runtime-message-timer-reset","observedState":"failed"}'::jsonb,
      'must still wait', 'runtime-timer-release-too-early'
    )$$,
    'registration_message_retry_release_too_early'
  )
);

select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000103');
select public.mark_registration_admission_notice_sent(
  '00000000-0000-4000-8000-000000000521',
  'runtime-message-unknown', 'runtime-mark-accepted-cross-actor'
);
select pg_temp.registration_record(40,
  (select admission_notice_sent from public.ops_registration_details
   where task_id = '00000000-0000-4000-8000-000000000521')
  and (select count(*) = 1 from public.ops_task_events
       where task_id = '00000000-0000-4000-8000-000000000521'
         and event_type = 'customer_message_sent')
);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(114,
  pg_temp.registration_lives(format(
    $$select public.assign_registration_track_director(
      %L::uuid, '00000000-0000-4000-8000-000000000102', 'manual', null, 1,
      'runtime-reassign-after-cancel'
    )$$,
    (select track_id from registration_runtime_visit_track)
  ))
  and (select count(*) = 1
       from public.ops_registration_consultations consultation
       where consultation.track_id = (select track_id from registration_runtime_visit_track)
         and consultation.mode = 'phone' and consultation.status = 'waiting')
);
create temporary table registration_runtime_claim_boundary on commit drop as
select pg_temp.registration_throws(
  $$select public.update_registration_case_common(
    '00000000-0000-4000-8000-000000000525', '메시지E변경', '중1', '런타임중',
    '01000000525', null, '본관', '2026-07-13 09:00+09'::timestamptz,
    null, 'normal', 1, 'runtime-active-failed-hold-identity'
  )$$,
  'registration_student_identity_correction_required'
) as active_claim_denied;
select pg_temp.registration_record(115, pg_temp.registration_throws(
  $$select public.release_registration_admission_message_retry(
    '00000000-0000-4000-8000-000000000545',
    '{"lookupRequestKey":"runtime-message-failed-hold","observedState":"failed"}'::jsonb,
    'too early', 'runtime-release-too-early'
  )$$,
  'registration_message_retry_release_too_early'
));
set local role postgres;
update public.ops_registration_messages
set updated_at = now() - interval '16 minutes'
where id = '00000000-0000-4000-8000-000000000545';
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_release on commit drop as
select public.release_registration_admission_message_retry(
  '00000000-0000-4000-8000-000000000545',
  '{"lookupRequestKey":"runtime-message-failed-hold","observedState":"failed"}'::jsonb,
  'provider definitive failure', 'runtime-release-delayed'
) as payload;
select pg_temp.registration_record(117,
  (select status = 'failed' and not claim_active
   from public.ops_registration_messages
   where id = '00000000-0000-4000-8000-000000000545')
  and (select payload @> '{"status":"failed","claimActive":false,"retryRequiresNewMessageKey":true}'::jsonb
       from registration_runtime_release)
);
select pg_temp.registration_record(35,
  (select active_claim_denied from registration_runtime_claim_boundary)
  and pg_temp.registration_lives(
    $$select public.update_registration_case_common(
      '00000000-0000-4000-8000-000000000525', '메시지E변경', '중1', '런타임중',
      '01000000525', null, '본관', '2026-07-13 09:00+09'::timestamptz,
      null, 'normal', 1, 'runtime-inactive-failed-identity'
    )$$
  )
);
select pg_temp.registration_record(118, pg_temp.registration_throws(
  $$select public.finalize_registration_admission_message(
    '00000000-0000-4000-8000-000000000542', 'accepted',
    '{"providerMessageId":"forbidden-browser"}'::jsonb
  )$$,
  'permission denied|registration_service_role_required'
));

set local role postgres;
create temporary table registration_runtime_finalizer (
  accepted_response jsonb not null,
  unknown_response jsonb not null,
  failed_response jsonb not null,
  failed_hold_accepted_response jsonb not null,
  released_ignored_response jsonb not null
) on commit drop;
grant insert, select on table registration_runtime_finalizer
  to service_role, authenticated;

-- service-role finalizer lane: begin
set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"00000000-0000-4000-8000-000000000101"}',
  true
);
insert into registration_runtime_finalizer(
  accepted_response, unknown_response, failed_response,
  failed_hold_accepted_response, released_ignored_response
)
select
  public.finalize_registration_admission_message(
    '00000000-0000-4000-8000-000000000542', 'accepted',
    '{"providerMessageId":"provider-a","providerStatusCode":"202"}'::jsonb
  ) as accepted_response,
  public.finalize_registration_admission_message(
    '00000000-0000-4000-8000-000000000543', 'unknown',
    '{"providerStatusCode":"timeout","errorMessage":"lookup required"}'::jsonb
  ) as unknown_response,
  public.finalize_registration_admission_message(
    '00000000-0000-4000-8000-000000000544', 'failed',
    '{"providerStatusCode":"400","errorMessage":"definitive"}'::jsonb
  ) as failed_response,
  public.finalize_registration_admission_message(
    '00000000-0000-4000-8000-000000000548', 'accepted',
    '{"providerMessageId":"provider-failed-hold-winner"}'::jsonb
  ) as failed_hold_accepted_response,
  public.finalize_registration_admission_message(
    '00000000-0000-4000-8000-000000000549', 'accepted',
    '{"providerMessageId":"provider-must-not-reactivate"}'::jsonb
  ) as released_ignored_response;
-- service-role finalizer lane: end

set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(119,
  (select accepted_response @> '{"currentStatus":"accepted","claimActive":true}'::jsonb
      and unknown_response @> '{"currentStatus":"unknown","claimActive":true}'::jsonb
      and failed_response @> '{"currentStatus":"failed","claimActive":false,"retryRequiresNewMessageKey":true}'::jsonb
   from registration_runtime_finalizer)
);
select pg_temp.registration_record(120,
  (select failed_hold_accepted_response @> '{"applied":true,"currentStatus":"accepted","claimActive":true}'::jsonb
      and released_ignored_response @> '{"applied":false,"currentStatus":"failed","claimActive":false}'::jsonb
   from registration_runtime_finalizer)
  and (select status = 'accepted' and claim_active
       from public.ops_registration_messages
       where id = '00000000-0000-4000-8000-000000000548')
  and (select status = 'failed' and not claim_active
       from public.ops_registration_messages
       where id = '00000000-0000-4000-8000-000000000549')
);
select pg_temp.registration_record(121, pg_temp.registration_throws(
  $$select public.claim_registration_admission_message(
    '00000000-0000-4000-8000-000000000530', 'runtime-message-pending-a'
  )$$,
  'registration_message_request_key_reused'
));
set local role postgres;
select pg_temp.registration_record(122, pg_temp.registration_throws(
  $$insert into public.ops_registration_messages(
      id, task_id, template_key, request_key, status, claim_active, recipient_last4, sent_by
    ) values (
      gen_random_uuid(), '00000000-0000-4000-8000-000000000521',
      'admission_application', 'runtime-invalid-claim-state', 'accepted', false,
      '0000', auth.uid()
    )$$,
  'ops_registration_messages_claim_state_check|check constraint'
));
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(123,
  pg_temp.registration_throws(
    $$update public.ops_registration_messages
      set provider_message_id = 'forged', status = 'accepted'
      where id = '00000000-0000-4000-8000-000000000543'$$,
    'row-level security|permission denied'
  )
  and pg_temp.registration_throws(
    $$insert into public.ops_task_events(task_id, actor_id, event_type, after_value)
      values (
        '00000000-0000-4000-8000-000000000521', auth.uid(),
        'registration_admission_message_reconciled', '{}'
      )$$,
    'row-level security|permission denied'
  )
);

-- Identity-lock fixtures for current-class waiting, completed registration, and exact
-- duplicate materialization are executable and independent of source inspection.
create temporary table registration_runtime_identity_cases on commit drop as
select
  public.create_registration_case(
    '런타임현재대기', '중1', '런타임중', '01000001821', null, '본관',
    '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
    'runtime-identity-current-wait'
  ) as waiting_case,
  public.create_registration_case(
    '런타임등록완료', '중1', '런타임중', '01000001822', null, '본관',
    '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
    'runtime-identity-registered'
  ) as registered_case;
create temporary table registration_runtime_identity_tracks on commit drop as
select
  (cases.waiting_case ->> 'taskId')::uuid as waiting_task_id,
  (select id from public.ops_registration_subject_tracks
   where task_id = (cases.waiting_case ->> 'taskId')::uuid) as waiting_track_id,
  (cases.registered_case ->> 'taskId')::uuid as registered_task_id,
  (select id from public.ops_registration_subject_tracks
   where task_id = (cases.registered_case ->> 'taskId')::uuid) as registered_track_id
from registration_runtime_identity_cases cases;
select public.route_registration_inquiry(
  (select waiting_track_id from registration_runtime_identity_tracks),
  'waiting', 'current_class', '00000000-0000-4000-8000-000000000301',
  'runtime-identity-current-wait-route'
);
select pg_temp.registration_record(37, pg_temp.registration_throws(
  format(
    $$select public.update_registration_case_common(
      %L::uuid, '런타임현재대기', '중1', '다른학교', '01000001821', null,
      '본관', '2026-07-13 09:00+09'::timestamptz, null, 'normal', 1,
      'runtime-current-wait-identity-change'
    )$$,
    (select waiting_task_id from registration_runtime_identity_tracks)
  ),
  'registration_student_identity_correction_required'
));
set local role postgres;
update public.ops_registration_subject_tracks
set pipeline_status = 'registered'
where id = (select registered_track_id from registration_runtime_identity_tracks);
insert into public.ops_registration_admission_batches(
  id, task_id, revision_number, status, invoice_sent_at, payment_confirmed_at
) values (
  '00000000-0000-4000-8000-000000000581',
  (select registered_task_id from registration_runtime_identity_tracks),
  1, 'completed', now(), now()
);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(36, pg_temp.registration_throws(
  format(
    $$select public.update_registration_case_common(
      %L::uuid, '런타임등록완료', '중1', '런타임중', '01000001822', '01099991822',
      '본관', '2026-07-13 09:00+09'::timestamptz, null, 'normal', 1,
      'runtime-post-history-optional-identity'
    )$$,
    (select registered_task_id from registration_runtime_identity_tracks)
  ),
  'registration_student_identity_correction_required'
));
select pg_temp.registration_record(38, pg_temp.registration_throws(
  format(
    $$select public.update_registration_case_common(
      %L::uuid, '런타임등록완료', '중1', '다른학교', '01000001822', null,
      '본관', '2026-07-13 09:00+09'::timestamptz, null, 'normal', 1,
      'runtime-registered-identity-change'
    )$$,
    (select registered_task_id from registration_runtime_identity_tracks)
  ),
  'registration_student_identity_correction_required'
));

set local role postgres;
insert into public.students(
  id, name, school, grade, contact, parent_contact, status,
  class_ids, waitlist_class_ids
) values (
  '00000000-0000-4000-8000-000000000281', '런타임중복', '런타임중', '중1', null,
  '01000001823', '재원', '[]'::jsonb, '[]'::jsonb
), (
  '00000000-0000-4000-8000-000000000282', '런타임중복', '런타임중', '중1', null,
  '01000001823', '재원', '[]'::jsonb, '[]'::jsonb
);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_duplicate_case on commit drop as
select public.create_registration_case(
  '런타임중복', '중1', '런타임중', '01000001823', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
  'runtime-duplicate-identity-case'
) as payload;
select pg_temp.registration_record(41, pg_temp.registration_throws(
  format(
    $$select public.route_registration_inquiry(
      %L::uuid, 'waiting', 'current_class',
      '00000000-0000-4000-8000-000000000301', 'runtime-duplicate-materialize'
    )$$,
    (select track.id
     from registration_runtime_duplicate_case fixture
     join public.ops_registration_subject_tracks track
       on track.task_id = (fixture.payload ->> 'taskId')::uuid)
  ),
  'registration_student_identity_ambiguous'
));

-- Assertions 124-149 exercise the remaining appointment, admission, and lifecycle
-- paths through runtime RPCs and observed rows. All fixtures remain inside the outer
-- pgTAP transaction and are rolled back with the rest of the packet.

-- The authoritative admission validator reads `classes.schedule_plan.sessions`.
-- Normalize only the fixed classes used by this snippet; the outer rollback restores
-- the packet's original class fixtures.
set local role postgres;
update public.classes
set schedule_plan = '{"sessions":[{"date":"2026-07-20","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
where id = '00000000-0000-4000-8000-000000000301';
update public.classes
set schedule_plan = '{"sessions":[{"date":"2026-07-22","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
where id = '00000000-0000-4000-8000-000000000302';

-- ---------------------------------------------------------------------------
-- 124-127: subject-scoped visit/phone and shared level-test appointment state.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

create temporary table registration_runtime_124_case on commit drop as
select public.create_registration_case(
  '런타임124', '중1', '런타임중', '01000006124', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어', '수학'], null, 'normal',
  'runtime-124-create'
) as payload;
create temporary table registration_runtime_124_tracks on commit drop as
select
  (fixture.payload ->> 'taskId')::uuid as task_id,
  max(track.id) filter (where track.subject = '영어') as english_track_id,
  max(track.id) filter (where track.subject = '수학') as math_track_id
from registration_runtime_124_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid
group by fixture.payload;

-- Both consultations have the same active manual owner. This keeps the fixture
-- independent from calendar-year default-director changes.
set local role postgres;
update public.ops_registration_subject_tracks
set director_profile_id = '00000000-0000-4000-8000-000000000102',
    director_assignment_source = 'manual',
    director_assignment_rule_key = null,
    director_assigned_at = now()
where task_id = (select task_id from registration_runtime_124_tracks);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

select public.route_registration_inquiry(
  (select english_track_id from registration_runtime_124_tracks),
  'consultation_waiting', null, null, 'runtime-124-phone-english'
);
select public.route_registration_inquiry(
  (select math_track_id from registration_runtime_124_tracks),
  'consultation_waiting', null, null, 'runtime-124-phone-math'
);
create temporary table registration_runtime_124_phone_ids on commit drop as
select
  max(consultation.id) filter (
    where consultation.track_id = fixture.english_track_id
  ) as english_phone_id,
  max(consultation.id) filter (
    where consultation.track_id = fixture.math_track_id
  ) as math_phone_id
from registration_runtime_124_tracks fixture
join public.ops_registration_consultations consultation
  on consultation.track_id in (fixture.english_track_id, fixture.math_track_id)
where consultation.mode = 'phone'
  and consultation.status = 'waiting';
create temporary table registration_runtime_124_visit on commit drop as
select public.save_registration_shared_appointment(
  null,
  fixture.task_id,
  'visit_consultation',
  '2026-07-25 14:00+09'::timestamptz,
  '원장실',
  array[fixture.english_track_id],
  false,
  null,
  'runtime-124-visit-english'
) as payload
from registration_runtime_124_tracks fixture;

select pg_temp.registration_record(124,
  exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.id = (select english_phone_id from registration_runtime_124_phone_ids)
      and consultation.mode = 'phone'
      and consultation.status = 'canceled'
  )
  and exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.track_id = (select english_track_id from registration_runtime_124_tracks)
      and consultation.appointment_id = (
        select (payload ->> 'appointmentId')::uuid from registration_runtime_124_visit
      )
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled'
  )
  and exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.id = (select math_phone_id from registration_runtime_124_phone_ids)
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
  )
  and (
    select pipeline_status = 'visit_consultation_scheduled'
    from public.ops_registration_subject_tracks
    where id = (select english_track_id from registration_runtime_124_tracks)
  )
  and (
    select pipeline_status = 'consultation_waiting'
    from public.ops_registration_subject_tracks
    where id = (select math_track_id from registration_runtime_124_tracks)
  )
);

create temporary table registration_runtime_125_case on commit drop as
select public.create_registration_case(
  '런타임125', '중1', '런타임중', '01000006125', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어', '수학'], null, 'normal',
  'runtime-125-create'
) as payload;
create temporary table registration_runtime_125_tracks on commit drop as
select
  (fixture.payload ->> 'taskId')::uuid as task_id,
  max(track.id) filter (where track.subject = '영어') as english_track_id,
  max(track.id) filter (where track.subject = '수학') as math_track_id
from registration_runtime_125_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid
group by fixture.payload;
create temporary table registration_runtime_125_appointment on commit drop as
select public.save_registration_shared_appointment(
  null,
  fixture.task_id,
  'level_test',
  '2026-07-26 10:00+09'::timestamptz,
  '본관 1강의실',
  array[fixture.english_track_id, fixture.math_track_id],
  false,
  null,
  'runtime-125-dual-test'
) as payload
from registration_runtime_125_tracks fixture;
create temporary table registration_runtime_125_edit on commit drop as
select public.save_registration_shared_appointment(
  (appointment.payload ->> 'appointmentId')::uuid,
  fixture.task_id,
  'level_test',
  '2026-07-26 10:00+09'::timestamptz,
  '본관 1강의실',
  array[fixture.english_track_id],
  false,
  1,
  'runtime-125-deselect-math'
) as payload
from registration_runtime_125_tracks fixture
cross join registration_runtime_125_appointment appointment;

select pg_temp.registration_record(125,
  (
    select pipeline_status = 'level_test_scheduled'
    from public.ops_registration_subject_tracks
    where id = (select english_track_id from registration_runtime_125_tracks)
  )
  and (
    select pipeline_status = 'inquiry'
    from public.ops_registration_subject_tracks
    where id = (select math_track_id from registration_runtime_125_tracks)
  )
  and exists (
    select 1
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = (
      select (payload ->> 'appointmentId')::uuid from registration_runtime_125_appointment
    )
      and attempt.track_id = (select english_track_id from registration_runtime_125_tracks)
      and attempt.status = 'scheduled'
  )
  and exists (
    select 1
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = (
      select (payload ->> 'appointmentId')::uuid from registration_runtime_125_appointment
    )
      and attempt.track_id = (select math_track_id from registration_runtime_125_tracks)
      and attempt.status = 'canceled'
      and attempt.completed_at is not null
  )
  and not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = (select task_id from registration_runtime_125_tracks)
      and track.pipeline_status = 'level_test_scheduled'
      and not exists (
        select 1
        from public.ops_registration_level_tests attempt
        where attempt.track_id = track.id
          and attempt.status in ('scheduled', 'in_progress')
      )
  )
);

-- Parameter validation and mode/status coupling are observed independently before
-- completing the two valid consultation rows.
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000102');
create temporary table registration_runtime_126_checks (
  null_outcome_denied boolean not null,
  nonwaiting_fields_denied boolean not null,
  phone_state_denied boolean not null,
  visit_state_denied boolean not null
) on commit drop;
insert into registration_runtime_126_checks(
  null_outcome_denied,
  nonwaiting_fields_denied,
  phone_state_denied,
  visit_state_denied
)
values (
  pg_temp.registration_throws(
    format(
      $$select public.complete_registration_consultation(
        %L::uuid, null, null, null, 'runtime-126-null-outcome'
      )$$,
      (select math_phone_id from registration_runtime_124_phone_ids)
    ),
    'registration_consultation_outcome_invalid'
  ),
  pg_temp.registration_throws(
    format(
      $$select public.complete_registration_consultation(
        %L::uuid, 'enrollment', 'current_term_opening', null,
        'runtime-126-nonwaiting-fields'
      )$$,
      (select math_phone_id from registration_runtime_124_phone_ids)
    ),
    'registration_consultation_waiting_fields_not_allowed'
  ),
  false,
  false
);

set local role postgres;
update public.ops_registration_subject_tracks
set pipeline_status = 'inquiry'
where id = (select math_track_id from registration_runtime_124_tracks);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000102');
update registration_runtime_126_checks
set phone_state_denied = pg_temp.registration_throws(
  format(
    $$select public.complete_registration_consultation(
      %L::uuid, 'not_registered', null, null, 'runtime-126-phone-state'
    )$$,
    (select math_phone_id from registration_runtime_124_phone_ids)
  ),
  'registration_invalid_source_state'
);
set local role postgres;
update public.ops_registration_subject_tracks
set pipeline_status = 'consultation_waiting'
where id = (select math_track_id from registration_runtime_124_tracks);
update public.ops_registration_subject_tracks
set pipeline_status = 'consultation_waiting'
where id = (select english_track_id from registration_runtime_124_tracks);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000102');
update registration_runtime_126_checks
set visit_state_denied = pg_temp.registration_throws(
  format(
    $$select public.complete_registration_consultation(
      %L::uuid, 'enrollment', null, null, 'runtime-126-visit-state'
    )$$,
    (
      select consultation.id
      from public.ops_registration_consultations consultation
      where consultation.track_id = (
        select english_track_id from registration_runtime_124_tracks
      )
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled'
    )
  ),
  'registration_invalid_source_state'
);
set local role postgres;
update public.ops_registration_subject_tracks
set pipeline_status = 'visit_consultation_scheduled'
where id = (select english_track_id from registration_runtime_124_tracks);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000102');
create temporary table registration_runtime_126_valid on commit drop as
select
  public.complete_registration_consultation(
    (select math_phone_id from registration_runtime_124_phone_ids),
    'not_registered', null, null, 'runtime-126-phone-valid'
  ) as phone_response,
  public.complete_registration_consultation(
    (
      select consultation.id
      from public.ops_registration_consultations consultation
      where consultation.track_id = (
        select english_track_id from registration_runtime_124_tracks
      )
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled'
    ),
    'enrollment', null, null, 'runtime-126-visit-valid'
  ) as visit_response;

select pg_temp.registration_record(126,
  (
    select null_outcome_denied
      and nonwaiting_fields_denied
      and phone_state_denied
      and visit_state_denied
    from registration_runtime_126_checks
  )
  and (
    select phone_response #>> '{consultation,status}' = 'completed'
      and phone_response #>> '{track,status}' = 'not_registered'
      and visit_response #>> '{consultation,status}' = 'completed'
      and visit_response #>> '{track,status}' = 'enrollment_decided'
    from registration_runtime_126_valid
  )
);

create temporary table registration_runtime_127_before on commit drop as
select
  (select count(*) from public.ops_registration_consultations consultation
   where consultation.track_id = fixture.english_track_id) as child_count,
  (select count(*) from public.ops_task_events event
   where event.task_id = fixture.task_id) as event_count
from registration_runtime_124_tracks fixture;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(127,
  pg_temp.registration_throws(
    format(
      $$select public.route_registration_inquiry(
        %L::uuid, 'inquiry_closed', null, null, 'runtime-127-later-stage'
      )$$,
      (select english_track_id from registration_runtime_124_tracks)
    ),
    'registration_invalid_source_state'
  )
  and (
    select pipeline_status = 'enrollment_decided'
    from public.ops_registration_subject_tracks
    where id = (select english_track_id from registration_runtime_124_tracks)
  )
  and (
    select before.child_count = (
        select count(*)
        from public.ops_registration_consultations consultation
        where consultation.track_id = fixture.english_track_id
      )
      and before.event_count = (
        select count(*)
        from public.ops_task_events event
        where event.task_id = fixture.task_id
      )
    from registration_runtime_127_before before
    cross join registration_runtime_124_tracks fixture
  )
);

-- ---------------------------------------------------------------------------
-- 128-134: subject removal, exclusive claims, and admission finance ordering.
-- ---------------------------------------------------------------------------
create temporary table registration_runtime_128_case on commit drop as
select public.create_registration_case(
  '런타임128', '중1', '런타임중', '01000006128', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어', '수학'], null, 'normal',
  'runtime-128-create'
) as payload;
create temporary table registration_runtime_128_tracks on commit drop as
select
  (fixture.payload ->> 'taskId')::uuid as task_id,
  max(track.id) filter (where track.subject = '영어') as english_track_id,
  max(track.id) filter (where track.subject = '수학') as math_track_id
from registration_runtime_128_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid
group by fixture.payload;
set local role postgres;
update public.ops_registration_subject_tracks
set director_profile_id = '00000000-0000-4000-8000-000000000102',
    director_assignment_source = 'default',
    director_assignment_rule_key = 'runtime-automatic-default-only:' || subject,
    director_assigned_at = now()
where task_id = (select task_id from registration_runtime_128_tracks);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_128_sync on commit drop as
select public.sync_registration_case_subjects(
  fixture.task_id, array['영어'], 'runtime-128-remove-math'
) as payload
from registration_runtime_128_tracks fixture;
select pg_temp.registration_record(128,
  (select payload -> 'subjects' = '["영어"]'::jsonb from registration_runtime_128_sync)
  and not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = (select math_track_id from registration_runtime_128_tracks)
  )
  and (
    select count(*) = 1
    from public.ops_task_events event
    where event.task_id = (select task_id from registration_runtime_128_tracks)
      and event.event_type = 'registration_subject_removed'
      and event.field_name = 'registration_subject'
      and event.before_value = '수학'
      and event.after_value::jsonb ->> 'trackId' = (
        select math_track_id::text from registration_runtime_128_tracks
      )
  )
);

create temporary table registration_runtime_129_manual_case on commit drop as
select public.create_registration_case(
  '런타임129수동', '중1', '런타임중', '01000006129', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어', '수학'], null, 'normal',
  'runtime-129-manual-create'
) as payload;
create temporary table registration_runtime_129_manual_tracks on commit drop as
select
  (fixture.payload ->> 'taskId')::uuid as task_id,
  max(track.id) filter (where track.subject = '수학') as math_track_id
from registration_runtime_129_manual_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid
group by fixture.payload;
set local role postgres;
update public.ops_registration_subject_tracks
set director_profile_id = '00000000-0000-4000-8000-000000000102',
    director_assignment_source = 'manual',
    director_assignment_rule_key = null,
    director_assigned_at = now()
where id = (select math_track_id from registration_runtime_129_manual_tracks);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

create temporary table registration_runtime_129_activity_case on commit drop as
select public.create_registration_case(
  '런타임129활동', '중1', '런타임중', '01000007129', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어', '수학'], null, 'normal',
  'runtime-129-activity-create'
) as payload;
create temporary table registration_runtime_129_activity_tracks on commit drop as
select
  (fixture.payload ->> 'taskId')::uuid as task_id,
  max(track.id) filter (where track.subject = '수학') as math_track_id
from registration_runtime_129_activity_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid
group by fixture.payload;
select public.save_registration_shared_appointment(
  null,
  (select task_id from registration_runtime_129_activity_tracks),
  'level_test',
  '2026-07-27 10:00+09'::timestamptz,
  '본관 1강의실',
  array[(select math_track_id from registration_runtime_129_activity_tracks)],
  false,
  null,
  'runtime-129-math-activity'
);
select pg_temp.registration_record(129,
  pg_temp.registration_throws(
    format(
      $$select public.sync_registration_case_subjects(
        %L::uuid, array['영어'], 'runtime-129-manual-remove'
      )$$,
      (select task_id from registration_runtime_129_manual_tracks)
    ),
    'registration_subject_removal_blocked'
  )
  and pg_temp.registration_throws(
    format(
      $$select public.sync_registration_case_subjects(
        %L::uuid, array['영어'], 'runtime-129-activity-remove'
      )$$,
      (select task_id from registration_runtime_129_activity_tracks)
    ),
    'registration_subject_removal_blocked'
  )
  and (
    select count(*) = 2
    from public.ops_registration_subject_tracks track
    where track.task_id = (select task_id from registration_runtime_129_manual_tracks)
  )
  and (
    select count(*) = 2
    from public.ops_registration_subject_tracks track
    where track.task_id = (select task_id from registration_runtime_129_activity_tracks)
  )
);

-- Two independent parents contend for one `(student_id,class_id)` active claim.
set local role postgres;
insert into public.students(
  id, name, school, grade, contact, parent_contact, status, class_ids, waitlist_class_ids
) values (
  '00000000-0000-4000-8000-000000000671', '런타임claim', '런타임중', '중1',
  null, '01000006671', '재원', '[]'::jsonb, '[]'::jsonb
);
insert into public.ops_tasks(
  id, title, type, status, requested_by, student_id, student_name, subject, priority
) values
  ('00000000-0000-4000-8000-000000000672', '런타임 claim A', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000671', '런타임claim', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000673', '런타임 claim B', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000671', '런타임claim', '영어', 'normal');
insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone, common_revision,
  admission_notice_sent
) values
  ('00000000-0000-4000-8000-000000000672', now(), '중1', '런타임중', '01000006671', 1, true),
  ('00000000-0000-4000-8000-000000000673', now(), '중1', '런타임중', '01000006671', 1, true);
insert into public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status)
values
  ('00000000-0000-4000-8000-000000000674', '00000000-0000-4000-8000-000000000672', '영어', 'enrollment_processing'),
  ('00000000-0000-4000-8000-000000000675', '00000000-0000-4000-8000-000000000673', '영어', 'enrollment_processing');
insert into public.ops_registration_admission_batches(id, task_id, revision_number, status)
values
  ('00000000-0000-4000-8000-000000000676', '00000000-0000-4000-8000-000000000672', 1, 'draft'),
  ('00000000-0000-4000-8000-000000000677', '00000000-0000-4000-8000-000000000673', 1, 'draft');
insert into public.ops_registration_enrollments(
  id, track_id, student_id, admission_batch_id, class_id, status, roster_active,
  sort_order
) values (
  '00000000-0000-4000-8000-000000000678',
  '00000000-0000-4000-8000-000000000674',
  '00000000-0000-4000-8000-000000000671',
  '00000000-0000-4000-8000-000000000676',
  '00000000-0000-4000-8000-000000000301',
  'planned', true, 0
);
select pg_temp.registration_record(130,
  pg_temp.registration_throws(
    $$insert into public.ops_registration_enrollments(
        id, track_id, student_id, admission_batch_id, class_id, status,
        roster_active, sort_order
      ) values (
        '00000000-0000-4000-8000-000000000679',
        '00000000-0000-4000-8000-000000000675',
        '00000000-0000-4000-8000-000000000671',
        '00000000-0000-4000-8000-000000000677',
        '00000000-0000-4000-8000-000000000301',
        'planned', true, 0
      )$$,
    'ops_registration_enrollments_student_class_claim_uidx'
  )
  and (
    select count(*) = 1
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = '00000000-0000-4000-8000-000000000671'
      and enrollment.class_id = '00000000-0000-4000-8000-000000000301'
      and enrollment.roster_active
  )
);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_131_open_check on commit drop as
select pg_temp.registration_throws(
    $$select public.set_student_class_roster_mode(
      '00000000-0000-4000-8000-000000000671',
      '00000000-0000-4000-8000-000000000301',
      'enrolled', 'removed', 'runtime-131-generic-roster'
    )$$,
    'registration_student_class_claim_conflict'
) as denied,
  not (
    select class_ids ? '00000000-0000-4000-8000-000000000301'
    from public.students
    where id = '00000000-0000-4000-8000-000000000671'
  ) as projection_unchanged;

-- Real admission batch used for forged-finance denial and ordered/replayed advance.
create temporary table registration_runtime_132_case on commit drop as
select public.create_registration_case(
  '런타임132', '중1', '런타임중', '01000006132', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
  'runtime-132-create'
) as payload;
create temporary table registration_runtime_132_track on commit drop as
select (fixture.payload ->> 'taskId')::uuid as task_id, track.id as track_id
from registration_runtime_132_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid;
set local role postgres;
update public.ops_registration_details
set admission_notice_sent = true
where task_id = (select task_id from registration_runtime_132_track);
update public.ops_registration_subject_tracks
set pipeline_status = 'enrollment_decided'
where id = (select track_id from registration_runtime_132_track);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_132_rows on commit drop as
select public.save_registration_enrollment_rows(
  fixture.track_id,
  jsonb_build_array(jsonb_build_object(
    'classId', '00000000-0000-4000-8000-000000000302',
    'textbookId', null,
    'classStartDate', '2026-07-22',
    'classStartSessionKey', '2026-07-22:1',
    'classStartSession', '1회차',
    'sortOrder', 0
  )),
  'runtime-132-save-row'
) as payload
from registration_runtime_132_track fixture;
create temporary table registration_runtime_132_batch on commit drop as
select public.start_registration_admission_batch(
  fixture.task_id,
  array[fixture.track_id],
  array[(rows.payload -> 'rows' -> 0 ->> 'id')::uuid],
  'runtime-132-start-batch'
) as payload
from registration_runtime_132_track fixture
cross join registration_runtime_132_rows rows;
select public.set_registration_enrollment_makeedu(
  (select (payload -> 'rows' -> 0 ->> 'id')::uuid from registration_runtime_132_rows),
  true,
  'runtime-132-makeedu'
);

set local role postgres;
update public.ops_registration_admission_batches
set invoice_sent_at = now() - interval '2 minutes',
    payment_confirmed_at = now() - interval '1 minute'
where id = (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(132,
  pg_temp.registration_throws(
    format(
      $$select public.complete_registration_admission_batch(
        %L::uuid, 'runtime-132-forged-complete'
      )$$,
      (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch)
    ),
    'registration_admission_batch_not_paid'
  )
  and (
    select status = 'draft'
    from public.ops_registration_admission_batches
    where id = (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch)
  )
  and (
    select status = 'planned' and roster_active
    from public.ops_registration_enrollments
    where id = (select (payload -> 'rows' -> 0 ->> 'id')::uuid from registration_runtime_132_rows)
  )
);
set local role postgres;
update public.ops_registration_admission_batches
set invoice_sent_at = null, payment_confirmed_at = null
where id = (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000103');
create temporary table registration_runtime_133_out_of_order on commit drop as
select pg_temp.registration_throws(
  format(
    $$select public.advance_registration_admission_batch(
      %L::uuid, 'payment_confirmed', 'runtime-133-payment-too-early'
    )$$,
    (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch)
  ),
  'registration_admission_batch_out_of_order'
) as denied;

select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_133_invoice on commit drop as
select public.advance_registration_admission_batch(
  (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch),
  'invoice_sent',
  'runtime-133-invoice-first'
) as payload;
create temporary table registration_runtime_133_invoice_snapshot on commit drop as
select
  batch.invoice_sent_at,
  (
    select count(*)
    from public.ops_task_events event
    where event.task_id = batch.task_id
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'eventType' = 'admission_batch_advanced'
      and event.after_value::jsonb #>> '{metadata,action}' = 'invoice_sent'
  ) as event_count
from public.ops_registration_admission_batches batch
where batch.id = (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000103');
create temporary table registration_runtime_133_invoice_replay on commit drop as
select public.advance_registration_admission_batch(
  (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch),
  'invoice_sent',
  'runtime-133-invoice-first'
) as payload;
create temporary table registration_runtime_133_payment on commit drop as
select public.advance_registration_admission_batch(
  (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch),
  'payment_confirmed',
  'runtime-133-payment-first'
) as payload;
create temporary table registration_runtime_133_payment_snapshot on commit drop as
select
  batch.payment_confirmed_at,
  (
    select count(*)
    from public.ops_task_events event
    where event.task_id = batch.task_id
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'eventType' = 'admission_batch_advanced'
      and event.after_value::jsonb #>> '{metadata,action}' = 'payment_confirmed'
  ) as event_count
from public.ops_registration_admission_batches batch
where batch.id = (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch);
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_133_payment_replay on commit drop as
select public.advance_registration_admission_batch(
  (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch),
  'payment_confirmed',
  'runtime-133-payment-first'
) as payload;
select pg_temp.registration_record(133,
  (select denied from registration_runtime_133_out_of_order)
  and (select payload ->> 'applied' = 'true' from registration_runtime_133_invoice)
  and (select payload ->> 'applied' = 'false' from registration_runtime_133_invoice_replay)
  and (select payload ->> 'applied' = 'true' from registration_runtime_133_payment)
  and (select payload ->> 'applied' = 'false' from registration_runtime_133_payment_replay)
  and (
    select snapshot.invoice_sent_at = batch.invoice_sent_at
      and snapshot.event_count = 1
      and snapshot.event_count = (
        select count(*)
        from public.ops_task_events event
        where event.task_id = batch.task_id
          and event.event_type = 'registration_track_event'
          and event.after_value::jsonb ->> 'eventType' = 'admission_batch_advanced'
          and event.after_value::jsonb #>> '{metadata,action}' = 'invoice_sent'
      )
    from registration_runtime_133_invoice_snapshot snapshot
    cross join public.ops_registration_admission_batches batch
    where batch.id = (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch)
  )
  and (
    select snapshot.payment_confirmed_at = batch.payment_confirmed_at
      and snapshot.event_count = 1
      and snapshot.event_count = (
        select count(*)
        from public.ops_task_events event
        where event.task_id = batch.task_id
          and event.event_type = 'registration_track_event'
          and event.after_value::jsonb ->> 'eventType' = 'admission_batch_advanced'
          and event.after_value::jsonb #>> '{metadata,action}' = 'payment_confirmed'
      )
    from registration_runtime_133_payment_snapshot snapshot
    cross join public.ops_registration_admission_batches batch
    where batch.id = (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch)
  )
);

-- Finish the paid batch to give assertion 134 a real active enrolled row.
select public.complete_registration_admission_batch(
  (select (payload #>> '{batch,id}')::uuid from registration_runtime_132_batch),
  'runtime-134-complete-paid'
);

create temporary table registration_runtime_134_wait_case on commit drop as
select public.create_registration_case(
  '런타임134대기', '중1', '런타임중', '01000006134', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['수학'], null, 'normal',
  'runtime-134-wait-create'
) as payload;
create temporary table registration_runtime_134_wait_track on commit drop as
select (fixture.payload ->> 'taskId')::uuid as task_id, track.id as track_id
from registration_runtime_134_wait_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid;
select public.route_registration_inquiry(
  (select track_id from registration_runtime_134_wait_track),
  'waiting', 'current_class',
  '00000000-0000-4000-8000-000000000303',
  'runtime-134-current-wait'
);

-- The generic roster gateway must reject every roster-active registration owner:
-- open admission claim, current-class wait claim, and completed enrollment claim.
select pg_temp.registration_record(131,
  (
    select denied and projection_unchanged
    from registration_runtime_131_open_check
  )
  and pg_temp.registration_throws(
    format(
      $$select public.set_student_class_roster_mode(
        %L::uuid,
        '00000000-0000-4000-8000-000000000303',
        'removed', 'waitlist', 'runtime-131-wait-claim'
      )$$,
      (
        select task.student_id
        from public.ops_tasks task
        where task.id = (select task_id from registration_runtime_134_wait_track)
      )
    ),
    'registration_student_class_claim_conflict'
  )
  and pg_temp.registration_throws(
    format(
      $$select public.set_student_class_roster_mode(
        %L::uuid,
        '00000000-0000-4000-8000-000000000302',
        'removed', 'enrolled', 'runtime-131-enrolled-claim'
      )$$,
      (
        select task.student_id
        from public.ops_tasks task
        where task.id = (select task_id from registration_runtime_132_track)
      )
    ),
    'registration_student_class_claim_conflict'
  )
);
create temporary table registration_runtime_134_draft_case on commit drop as
select public.create_registration_case(
  '런타임134초안', '중1', '런타임중', '01000007134', null, '본관',
  '2026-07-13 09:00+09'::timestamptz, array['영어'], null, 'normal',
  'runtime-134-draft-create'
) as payload;
create temporary table registration_runtime_134_draft_track on commit drop as
select (fixture.payload ->> 'taskId')::uuid as task_id, track.id as track_id
from registration_runtime_134_draft_case fixture
join public.ops_registration_subject_tracks track
  on track.task_id = (fixture.payload ->> 'taskId')::uuid;
set local role postgres;
update public.ops_registration_subject_tracks
set pipeline_status = 'enrollment_decided'
where id = (select track_id from registration_runtime_134_draft_track);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select public.save_registration_enrollment_rows(
  (select track_id from registration_runtime_134_draft_track),
  jsonb_build_array(jsonb_build_object(
    'classId', '00000000-0000-4000-8000-000000000301',
    'textbookId', null,
    'classStartDate', null,
    'classStartSessionKey', null,
    'classStartSession', null,
    'sortOrder', 0
  )),
  'runtime-134-unbatched-draft'
);

-- Assertion 134 is intentionally a row invariant query, not a function-source proxy.
-- Canceled batch rows and explicitly released enrolled history are handled by 135/136.
select pg_temp.registration_record(134,
  not exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where (
      enrollment.status = 'waitlisted'
      or (enrollment.status = 'planned' and enrollment.admission_batch_id is not null)
      or (
        enrollment.status = 'enrolled'
        and enrollment.roster_released_at is null
      )
    )
    and (not enrollment.roster_active or enrollment.student_id is null)
  )
  and not exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and (
        enrollment.roster_active
        or enrollment.student_id is not null
        or enrollment.roster_released_at is not null
        or enrollment.roster_release_source_task_id is not null
        or enrollment.roster_release_kind is not null
      )
  )
);

-- ---------------------------------------------------------------------------
-- 135-136 and 148-149: released history, re-enrollment, and canceled batches.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.students(
  id, name, school, grade, contact, parent_contact, status, class_ids, waitlist_class_ids
) values (
  '00000000-0000-4000-8000-000000000680', '런타임이력재등록', '런타임중', '중1',
  null, '01000006680', '재원',
  '["00000000-0000-4000-8000-000000000302"]'::jsonb,
  '[]'::jsonb
);
update public.classes class
set student_ids = (
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
    '[]'::jsonb
  )
  from (
    select distinct source.value
    from (
      select element.value
      from pg_catalog.jsonb_array_elements_text(
        coalesce(class.student_ids, '[]'::jsonb)
      ) element(value)
      union all
      select '00000000-0000-4000-8000-000000000680'
    ) source
  ) canonical
)
where class.id = '00000000-0000-4000-8000-000000000302';
insert into public.ops_tasks(
  id, title, type, status, requested_by, student_id, student_name, subject, priority
) values
  (
    '00000000-0000-4000-8000-000000000681', '런타임 이력 재등록', 'registration',
    'done', '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000680', '런타임이력재등록', '영어', 'normal'
  ),
  (
    '00000000-0000-4000-8000-000000000687', '런타임 과거 전반 출처', 'transfer',
    'canceled', '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000680', '런타임이력재등록', '영어', 'normal'
  );
insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone, common_revision,
  admission_notice_sent
) values (
  '00000000-0000-4000-8000-000000000681', now(), '중1', '런타임중',
  '01000006680', 1, true
);
insert into public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status)
values (
  '00000000-0000-4000-8000-000000000682',
  '00000000-0000-4000-8000-000000000681',
  '영어', 'registered'
);
insert into public.ops_registration_admission_batches(
  id, task_id, revision_number, status, invoice_sent_at, payment_confirmed_at
) values
  ('00000000-0000-4000-8000-000000000683', '00000000-0000-4000-8000-000000000681', 1, 'completed', now() - interval '2 days', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000684', '00000000-0000-4000-8000-000000000681', 2, 'completed', now() - interval '2 days', now() - interval '1 day');
insert into public.ops_registration_enrollments(
  id, track_id, student_id, admission_batch_id, class_id,
  class_start_date, class_start_session_key, class_start_session,
  status, makeedu_registered, roster_active,
  roster_released_at, roster_release_reason,
  roster_release_source_task_id, roster_release_kind, sort_order
) values
  (
    '00000000-0000-4000-8000-000000000685',
    '00000000-0000-4000-8000-000000000682',
    '00000000-0000-4000-8000-000000000680',
    '00000000-0000-4000-8000-000000000683',
    '00000000-0000-4000-8000-000000000301',
    '2026-07-20', '2026-07-20:1', '1회차',
    'enrolled', true, false,
    now() - interval '1 hour', 'prior transfer release',
    '00000000-0000-4000-8000-000000000687', 'transfer', 0
  ),
  (
    '00000000-0000-4000-8000-000000000686',
    '00000000-0000-4000-8000-000000000682',
    '00000000-0000-4000-8000-000000000680',
    '00000000-0000-4000-8000-000000000684',
    '00000000-0000-4000-8000-000000000302',
    '2026-07-22', '2026-07-22:1', '1회차',
    'enrolled', true, true,
    null, null, null, null, 1
  );
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_136_new_draft on commit drop as
select public.save_registration_enrollment_rows(
  '00000000-0000-4000-8000-000000000682',
  jsonb_build_array(jsonb_build_object(
    'classId', '00000000-0000-4000-8000-000000000301',
    'textbookId', null,
    'classStartDate', '2026-07-20',
    'classStartSessionKey', '2026-07-20:1',
    'classStartSession', '1회차',
    'sortOrder', 2
  )),
  'runtime-136-save-same-class'
) as payload;
select pg_temp.registration_record(136,
  (
    select payload #>> '{rows,0,status}' = 'planned'
      and payload #>> '{rows,0,classId}' = '00000000-0000-4000-8000-000000000301'
      and payload #>> '{rows,0,studentId}' is null
      and payload #>> '{rows,0,admissionBatchId}' is null
    from registration_runtime_136_new_draft
  )
  and (
    select status = 'enrolled'
      and not roster_active
      and roster_release_kind = 'transfer'
      and admission_batch_id = '00000000-0000-4000-8000-000000000683'
    from public.ops_registration_enrollments
    where id = '00000000-0000-4000-8000-000000000685'
  )
  and pg_temp.registration_throws(
    $$select public.cancel_registration_enrollment(
      '00000000-0000-4000-8000-000000000685',
      null, null, null, 'released history is immutable',
      'runtime-136-cancel-history'
    )$$,
    'registration_enrollment_not_cancelable'
  )
);

create temporary table registration_runtime_148_cancel_live on commit drop as
select public.cancel_registration_enrollment(
  '00000000-0000-4000-8000-000000000686',
  'enrollment_decided', null, null,
  'replace current class after released history',
  'runtime-148-cancel-live'
) as payload;
create temporary table registration_runtime_148_batch on commit drop as
select public.start_registration_admission_batch(
  '00000000-0000-4000-8000-000000000681',
  array['00000000-0000-4000-8000-000000000682'::uuid],
  array[(draft.payload -> 'rows' -> 0 ->> 'id')::uuid],
  'runtime-148-reenroll-released-class'
) as payload
from registration_runtime_136_new_draft draft;
select pg_temp.registration_record(148,
  (
    select payload ->> 'remainingLiveEnrollmentCount' = '0'
      and payload ->> 'trackStatus' = 'enrollment_decided'
    from registration_runtime_148_cancel_live
  )
  and (
    select status = 'enrolled'
      and not roster_active
      and roster_release_kind = 'transfer'
    from public.ops_registration_enrollments
    where id = '00000000-0000-4000-8000-000000000685'
  )
  and (
    select payload #>> '{batch,status}' = 'draft'
      and payload #>> '{enrollments,0,status}' = 'planned'
      and payload #>> '{enrollments,0,rosterActive}' = 'true'
      and payload #>> '{enrollments,0,studentId}' = '00000000-0000-4000-8000-000000000680'
    from registration_runtime_148_batch
  )
  and (
    select count(*) = 1
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = '00000000-0000-4000-8000-000000000680'
      and enrollment.class_id = '00000000-0000-4000-8000-000000000301'
      and enrollment.roster_active
  )
);

create temporary table registration_runtime_135_cancel_batch on commit drop as
select public.cancel_registration_admission_batch(
  (select (payload #>> '{batch,id}')::uuid from registration_runtime_148_batch),
  '[]'::jsonb,
  'cancel selected re-enrollment rows',
  'runtime-135-cancel-batch'
) as payload;
select pg_temp.registration_record(135,
  (
    select payload #>> '{batch,status}' = 'canceled'
      and payload #>> '{enrollments,0,status}' = 'canceled'
      and payload #>> '{enrollments,0,rosterActive}' = 'false'
      and payload #>> '{enrollments,0,studentId}' = '00000000-0000-4000-8000-000000000680'
      and payload #>> '{enrollments,0,admissionBatchId}' = payload #>> '{batch,id}'
    from registration_runtime_135_cancel_batch
  )
  and (
    select enrollment.status = 'canceled'
      and not enrollment.roster_active
      and enrollment.student_id = '00000000-0000-4000-8000-000000000680'
      and enrollment.admission_batch_id = (
        select (payload #>> '{batch,id}')::uuid from registration_runtime_135_cancel_batch
      )
    from public.ops_registration_enrollments enrollment
    where enrollment.id = (
      select (payload #>> '{enrollments,0,id}')::uuid
      from registration_runtime_135_cancel_batch
    )
  )
);
select pg_temp.registration_record(149,
  (
    select enrollment.status = 'canceled'
      and enrollment.admission_batch_id = batch.id
      and batch.status = 'canceled'
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_admission_batches batch
      on batch.id = enrollment.admission_batch_id
    where enrollment.id = (
      select (payload #>> '{enrollments,0,id}')::uuid
      from registration_runtime_135_cancel_batch
    )
  )
  and exists (
    select 1
    from public.ops_task_events event
    where event.task_id = '00000000-0000-4000-8000-000000000681'
      and event.event_type = 'registration_track_event'
      and event.after_value::jsonb ->> 'eventType' = 'admission_batch_canceled'
      and event.after_value::jsonb #>> '{metadata,batchId}' = (
        select payload #>> '{batch,id}' from registration_runtime_135_cancel_batch
      )
  )
  and (
    select payload #>> '{enrollments,0,admissionBatchId}' = payload #>> '{batch,id}'
    from registration_runtime_135_cancel_batch
  )
);

-- ---------------------------------------------------------------------------
-- 137-147: cross-workflow status and roster gateways.
-- ---------------------------------------------------------------------------
-- Fixed lifecycle fixtures. Registration parents/claims are seeded by postgres;
-- every lifecycle transition itself runs through the authenticated public RPC.
set local role postgres;
insert into public.classes(
  id, name, subject, status, student_ids, waitlist_ids, textbook_ids
) values
  ('00000000-0000-4000-8000-000000000711', '런타임 711', '영어', '수업 진행 중', '["00000000-0000-4000-8000-000000000701"]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000712', '런타임 712', '수학', '수업 진행 중', '[]'::jsonb, '["00000000-0000-4000-8000-000000000701"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000714', '런타임 714', '영어', '수업 진행 중', '["00000000-0000-4000-8000-000000000701"]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000715', '런타임 715', '영어', '수업 진행 중', '["00000000-0000-4000-8000-000000000702"]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000716', '런타임 716', '영어', '수업 진행 중', '["00000000-0000-4000-8000-000000000703"]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000717', '런타임 717', '영어', '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000718', '런타임 718', '영어', '수업 진행 중', '["00000000-0000-4000-8000-000000000704"]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000719', '런타임 719', '영어', '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000720', '런타임 720', '영어', '수업 진행 중', '["00000000-0000-4000-8000-000000000705"]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000721', '런타임 721', '수학', '수업 진행 중', '[]'::jsonb, '["00000000-0000-4000-8000-000000000705"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000722', '런타임 722', '영어', '수업 진행 중', '["00000000-0000-4000-8000-000000000706"]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000723', '런타임 723', '영어', '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000724', '런타임 724', '영어', '수업 진행 중', '["00000000-0000-4000-8000-000000000707"]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000725', '런타임 725', '영어', '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000726', '런타임 726', '영어', '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000727', '런타임 727', '영어', '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
update public.classes
set lessons = '[{"date":"2026-07-20","sessionKey":"2026-07-20:1","session":"1회차"}]'::jsonb,
    schedule_plan = '{"sessions":[{"date":"2026-07-20","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
where id = '00000000-0000-4000-8000-000000000727';

insert into public.students(
  id, name, school, grade, contact, parent_contact, status, class_ids, waitlist_class_ids
) values
  ('00000000-0000-4000-8000-000000000701', '런타임퇴원claim', '런타임중', '중1', null, '01000006701', '재원', '["00000000-0000-4000-8000-000000000711","00000000-0000-4000-8000-000000000714"]'::jsonb, '["00000000-0000-4000-8000-000000000712"]'::jsonb),
  ('00000000-0000-4000-8000-000000000702', '런타임퇴원legacy', '런타임중', '중1', null, '01000006702', '재원', '["00000000-0000-4000-8000-000000000715"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000703', '런타임전반claim', '런타임중', '중1', null, '01000006703', '재원', '["00000000-0000-4000-8000-000000000716"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000704', '런타임전반legacy', '런타임중', '중1', null, '01000006704', '재원', '["00000000-0000-4000-8000-000000000718"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000705', '런타임퇴원rollback', '런타임중', '중1', null, '01000006705', '재원', '["00000000-0000-4000-8000-000000000720"]'::jsonb, '["00000000-0000-4000-8000-000000000721"]'::jsonb),
  ('00000000-0000-4000-8000-000000000706', '런타임전반rollback', '런타임중', '중1', null, '01000006706', '재원', '["00000000-0000-4000-8000-000000000722"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000707', '런타임열린배치', '런타임중', '중1', null, '01000006707', '재원', '["00000000-0000-4000-8000-000000000724"]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000708', '런타임퇴원대기차단', '런타임중', '중1', null, '01000006708', '퇴원', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-4000-8000-000000000709', '런타임퇴원배치차단', '런타임중', '중1', null, '01000006709', '퇴원', '[]'::jsonb, '[]'::jsonb);

insert into public.ops_tasks(
  id, title, type, status, requested_by, student_id, class_id,
  student_name, subject, priority
) values
  ('00000000-0000-4000-8000-000000000801', '등록 801', 'registration', 'done', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000701', null, '런타임퇴원claim', '영어, 수학', 'normal'),
  ('00000000-0000-4000-8000-000000000802', '등록 802', 'registration', 'done', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000703', null, '런타임전반claim', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000803', '등록 803', 'registration', 'done', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000705', null, '런타임퇴원rollback', '영어, 수학', 'normal'),
  ('00000000-0000-4000-8000-000000000804', '등록 804', 'registration', 'done', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000706', null, '런타임전반rollback', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000805', '등록 805', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000707', null, '런타임열린배치', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000806', '등록 806', 'registration', 'requested', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000708', null, '런타임퇴원대기차단', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000807', '등록 807', 'registration', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000709', null, '런타임퇴원배치차단', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000841', '퇴원 841', 'withdrawal', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000711', '런타임퇴원claim', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000842', '퇴원 842', 'withdrawal', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000715', '런타임퇴원legacy', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000843', '전반 843', 'transfer', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000716', '런타임전반claim', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000844', '전반 844', 'transfer', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000718', '런타임전반legacy', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000845', '퇴원 845', 'withdrawal', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000705', '00000000-0000-4000-8000-000000000720', '런타임퇴원rollback', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000846', '전반 846', 'transfer', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000706', '00000000-0000-4000-8000-000000000722', '런타임전반rollback', '영어', 'normal'),
  ('00000000-0000-4000-8000-000000000847', '퇴원 847', 'withdrawal', 'in_progress', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000707', '00000000-0000-4000-8000-000000000724', '런타임열린배치', '영어', 'normal');

insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone, common_revision,
  admission_notice_sent
) values
  ('00000000-0000-4000-8000-000000000801', now(), '중1', '런타임중', '01000006701', 1, true),
  ('00000000-0000-4000-8000-000000000802', now(), '중1', '런타임중', '01000006703', 1, true),
  ('00000000-0000-4000-8000-000000000803', now(), '중1', '런타임중', '01000006705', 1, true),
  ('00000000-0000-4000-8000-000000000804', now(), '중1', '런타임중', '01000006706', 1, true),
  ('00000000-0000-4000-8000-000000000805', now(), '중1', '런타임중', '01000006707', 1, true),
  ('00000000-0000-4000-8000-000000000806', now(), '중1', '런타임중', '01000006708', 1, false),
  ('00000000-0000-4000-8000-000000000807', now(), '중1', '런타임중', '01000006709', 1, true);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, waiting_kind
) values
  ('00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000801', '영어', 'registered', null),
  ('00000000-0000-4000-8000-000000000812', '00000000-0000-4000-8000-000000000801', '수학', 'waiting', 'current_class'),
  ('00000000-0000-4000-8000-000000000813', '00000000-0000-4000-8000-000000000802', '영어', 'registered', null),
  ('00000000-0000-4000-8000-000000000814', '00000000-0000-4000-8000-000000000803', '영어', 'registered', null),
  ('00000000-0000-4000-8000-000000000815', '00000000-0000-4000-8000-000000000803', '수학', 'waiting', 'current_class'),
  ('00000000-0000-4000-8000-000000000816', '00000000-0000-4000-8000-000000000804', '영어', 'registered', null),
  ('00000000-0000-4000-8000-000000000817', '00000000-0000-4000-8000-000000000805', '영어', 'enrollment_processing', null),
  ('00000000-0000-4000-8000-000000000818', '00000000-0000-4000-8000-000000000806', '영어', 'inquiry', null),
  ('00000000-0000-4000-8000-000000000819', '00000000-0000-4000-8000-000000000807', '영어', 'enrollment_decided', null);
insert into public.ops_registration_admission_batches(
  id, task_id, revision_number, status, invoice_sent_at, payment_confirmed_at
) values
  ('00000000-0000-4000-8000-000000000821', '00000000-0000-4000-8000-000000000801', 1, 'completed', now() - interval '2 days', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000802', 1, 'completed', now() - interval '2 days', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000803', 1, 'completed', now() - interval '2 days', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000804', 1, 'completed', now() - interval '2 days', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000825', '00000000-0000-4000-8000-000000000805', 1, 'draft', null, null);
insert into public.ops_registration_enrollments(
  id, track_id, student_id, admission_batch_id, class_id,
  class_start_date, class_start_session_key, class_start_session,
  status, makeedu_registered, roster_active, sort_order
) values
  ('00000000-0000-4000-8000-000000000831', '00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000821', '00000000-0000-4000-8000-000000000711', '2026-07-20', '2026-07-20:1', '1회차', 'enrolled', true, true, 0),
  ('00000000-0000-4000-8000-000000000832', '00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000821', '00000000-0000-4000-8000-000000000714', '2026-07-20', '2026-07-20:1', '1회차', 'enrolled', true, true, 1),
  ('00000000-0000-4000-8000-000000000833', '00000000-0000-4000-8000-000000000812', '00000000-0000-4000-8000-000000000701', null, '00000000-0000-4000-8000-000000000712', null, null, null, 'waitlisted', false, true, 0),
  ('00000000-0000-4000-8000-000000000834', '00000000-0000-4000-8000-000000000813', '00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000716', '2026-07-20', '2026-07-20:1', '1회차', 'enrolled', true, true, 0),
  ('00000000-0000-4000-8000-000000000835', '00000000-0000-4000-8000-000000000814', '00000000-0000-4000-8000-000000000705', '00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000720', '2026-07-20', '2026-07-20:1', '1회차', 'enrolled', true, true, 0),
  ('00000000-0000-4000-8000-000000000836', '00000000-0000-4000-8000-000000000815', '00000000-0000-4000-8000-000000000705', null, '00000000-0000-4000-8000-000000000721', null, null, null, 'waitlisted', false, true, 0),
  ('00000000-0000-4000-8000-000000000837', '00000000-0000-4000-8000-000000000816', '00000000-0000-4000-8000-000000000706', '00000000-0000-4000-8000-000000000824', '00000000-0000-4000-8000-000000000722', '2026-07-20', '2026-07-20:1', '1회차', 'enrolled', true, true, 0),
  ('00000000-0000-4000-8000-000000000838', '00000000-0000-4000-8000-000000000817', '00000000-0000-4000-8000-000000000707', '00000000-0000-4000-8000-000000000825', '00000000-0000-4000-8000-000000000725', '2026-07-20', '2026-07-20:1', '1회차', 'planned', false, true, 0),
  ('00000000-0000-4000-8000-000000000839', '00000000-0000-4000-8000-000000000819', null, null, '00000000-0000-4000-8000-000000000727', '2026-07-20', '2026-07-20:1', '1회차', 'planned', false, false, 0);

insert into public.ops_withdrawal_details(
  task_id, timetable_roster_updated, makeedu_withdrawal_done,
  fee_processed, textbook_fee_processed
) values
  ('00000000-0000-4000-8000-000000000841', false, true, true, true),
  ('00000000-0000-4000-8000-000000000842', false, true, true, true),
  ('00000000-0000-4000-8000-000000000845', false, true, true, true),
  ('00000000-0000-4000-8000-000000000847', false, true, true, true);
insert into public.ops_transfer_details(
  task_id, from_class_id, to_class_id, timetable_roster_updated,
  makeedu_transfer_done, fee_processed, textbook_fee_processed
) values
  ('00000000-0000-4000-8000-000000000843', '00000000-0000-4000-8000-000000000716', '00000000-0000-4000-8000-000000000717', false, true, true, true),
  ('00000000-0000-4000-8000-000000000844', '00000000-0000-4000-8000-000000000718', '00000000-0000-4000-8000-000000000719', false, true, true, true),
  ('00000000-0000-4000-8000-000000000846', '00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000723', false, true, true, true);

-- Direct status, terminal-state, detail-flag, and type/detail bypass attempts.
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
create temporary table registration_runtime_137_direct_checks on commit drop as
select
  pg_temp.registration_throws(
    $$update public.students set status = '퇴원'
      where id = '00000000-0000-4000-8000-000000000701'$$,
    'student_status_transition_requires_workflow'
  ) as active_to_withdrawn_denied,
  pg_temp.registration_throws(
    $$update public.students set status = '재원'
      where id = '00000000-0000-4000-8000-000000000708'$$,
    'student_status_transition_requires_workflow'
  ) as withdrawn_to_active_denied;

set local role postgres;
insert into public.ops_tasks(id, title, type, status, requested_by, priority)
values
  ('00000000-0000-4000-8000-000000000861', '가드 전반', 'transfer', 'in_progress', '00000000-0000-4000-8000-000000000101', 'normal'),
  ('00000000-0000-4000-8000-000000000862', '가드 퇴원', 'withdrawal', 'in_progress', '00000000-0000-4000-8000-000000000101', 'normal'),
  ('00000000-0000-4000-8000-000000000863', '가드 전반 상세', 'transfer', 'in_progress', '00000000-0000-4000-8000-000000000101', 'normal'),
  ('00000000-0000-4000-8000-000000000864', '가드 전반 불일치', 'transfer', 'in_progress', '00000000-0000-4000-8000-000000000101', 'normal'),
  ('00000000-0000-4000-8000-000000000866', '가드 퇴원 삽입', 'withdrawal', 'in_progress', '00000000-0000-4000-8000-000000000101', 'normal'),
  ('00000000-0000-4000-8000-000000000868', '가드 일반', 'general', 'in_progress', '00000000-0000-4000-8000-000000000101', 'normal');
insert into public.ops_withdrawal_details(task_id, timetable_roster_updated)
values ('00000000-0000-4000-8000-000000000862', false);
insert into public.ops_transfer_details(task_id, timetable_roster_updated)
values ('00000000-0000-4000-8000-000000000863', false);
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(138,
  pg_temp.registration_throws(
    $$insert into public.ops_tasks(
        id, title, type, status, requested_by, priority
      ) values (
        '00000000-0000-4000-8000-000000000865', '위조 완료 퇴원',
        'withdrawal', 'done', auth.uid(), 'normal'
      )$$,
    'ops_roster_completion_requires_rpc'
  )
  and pg_temp.registration_throws(
    $$update public.ops_tasks set status = 'done'
      where id = '00000000-0000-4000-8000-000000000861'$$,
    'ops_roster_completion_requires_rpc'
  )
  and pg_temp.registration_throws(
    $$insert into public.ops_withdrawal_details(
        task_id, timetable_roster_updated
      ) values (
        '00000000-0000-4000-8000-000000000866', true
      )$$,
    'ops_roster_completion_requires_rpc'
  )
  and pg_temp.registration_throws(
    $$update public.ops_transfer_details set timetable_roster_updated = true
      where task_id = '00000000-0000-4000-8000-000000000863'$$,
    'ops_roster_completion_requires_rpc'
  )
);
select pg_temp.registration_record(139,
  pg_temp.registration_throws(
    $$update public.ops_tasks set type = 'withdrawal'
      where id = '00000000-0000-4000-8000-000000000868'$$,
    'ops_roster_type_immutable'
  )
  and pg_temp.registration_throws(
    $$update public.ops_tasks set type = 'transfer'
      where id = '00000000-0000-4000-8000-000000000862'$$,
    'ops_roster_type_immutable'
  )
  and pg_temp.registration_throws(
    $$insert into public.ops_withdrawal_details(
        task_id, timetable_roster_updated
      ) values (
        '00000000-0000-4000-8000-000000000864', false
      )$$,
    'ops_roster_detail_type_mismatch'
  )
  and pg_temp.registration_throws(
    $$update public.ops_withdrawal_details set timetable_roster_updated = true
      where task_id = '00000000-0000-4000-8000-000000000862'$$,
    'ops_roster_completion_requires_rpc'
  )
  and pg_temp.registration_throws(
    $$update public.ops_tasks set status = 'done'
      where id = '00000000-0000-4000-8000-000000000862'$$,
    'ops_roster_completion_requires_rpc'
  )
);

-- Successful claimed/unclaimed withdrawal and transfer paths.
create temporary table registration_runtime_140_response on commit drop as
select public.complete_ops_withdrawal_roster_transition(
  '00000000-0000-4000-8000-000000000841', 'runtime-140-withdraw-claimed'
) as payload;
create temporary table registration_runtime_141_response on commit drop as
select public.complete_ops_withdrawal_roster_transition(
  '00000000-0000-4000-8000-000000000842', 'runtime-141-withdraw-unclaimed'
) as payload;
create temporary table registration_runtime_142_response on commit drop as
select public.complete_ops_transfer_roster_transition(
  '00000000-0000-4000-8000-000000000843', 'runtime-142-transfer-claimed'
) as payload;
create temporary table registration_runtime_143_response on commit drop as
select public.complete_ops_transfer_roster_transition(
  '00000000-0000-4000-8000-000000000844', 'runtime-143-transfer-unclaimed'
) as payload;

select pg_temp.registration_record(140,
  (
    select payload @> '{"studentStatus":"퇴원","taskStatus":"done","timetableRosterUpdated":true}'::jsonb
      and jsonb_array_length(payload -> 'releasedEnrollmentIds') = 2
      and jsonb_array_length(payload -> 'canceledWaitlistEnrollmentIds') = 1
    from registration_runtime_140_response
  )
  and (
    select status = '퇴원'
      and class_ids = '[]'::jsonb
      and waitlist_class_ids = '[]'::jsonb
    from public.students
    where id = '00000000-0000-4000-8000-000000000701'
  )
  and not exists (
    select 1
    from public.classes class
    where class.id in (
      '00000000-0000-4000-8000-000000000711',
      '00000000-0000-4000-8000-000000000712',
      '00000000-0000-4000-8000-000000000714'
    )
      and (
        coalesce(class.student_ids, '[]'::jsonb) ? '00000000-0000-4000-8000-000000000701'
        or coalesce(class.waitlist_ids, '[]'::jsonb) ? '00000000-0000-4000-8000-000000000701'
      )
  )
  and (
    select count(*) = 2
    from public.ops_registration_enrollments enrollment
    where enrollment.id in (
      '00000000-0000-4000-8000-000000000831',
      '00000000-0000-4000-8000-000000000832'
    )
      and enrollment.status = 'enrolled'
      and not enrollment.roster_active
      and enrollment.roster_release_kind = 'withdrawal'
      and enrollment.roster_release_source_task_id = '00000000-0000-4000-8000-000000000841'
  )
  and (
    select status = 'canceled' and not roster_active
    from public.ops_registration_enrollments
    where id = '00000000-0000-4000-8000-000000000833'
  )
  and (
    select pipeline_status = 'not_registered' and waiting_kind is null
    from public.ops_registration_subject_tracks
    where id = '00000000-0000-4000-8000-000000000812'
  )
);
select pg_temp.registration_record(141,
  (
    select payload @> '{"studentStatus":"퇴원","taskStatus":"done","releasedEnrollmentIds":[],"canceledWaitlistEnrollmentIds":[]}'::jsonb
    from registration_runtime_141_response
  )
  and (
    select status = '퇴원' and class_ids = '[]'::jsonb
    from public.students
    where id = '00000000-0000-4000-8000-000000000702'
  )
  and not exists (
    select 1 from public.ops_registration_enrollments
    where student_id = '00000000-0000-4000-8000-000000000702'
  )
  and (
    select status = 'done' from public.ops_tasks
    where id = '00000000-0000-4000-8000-000000000842'
  )
);
select pg_temp.registration_record(142,
  (
    select payload @> '{"studentStatus":"재원","taskStatus":"done","timetableRosterUpdated":true,"releasedEnrollmentId":"00000000-0000-4000-8000-000000000834"}'::jsonb
    from registration_runtime_142_response
  )
  and (
    select status = '재원'
      and class_ids = '["00000000-0000-4000-8000-000000000717"]'::jsonb
    from public.students
    where id = '00000000-0000-4000-8000-000000000703'
  )
  and (
    select status = 'enrolled'
      and not roster_active
      and roster_release_kind = 'transfer'
      and roster_release_source_task_id = '00000000-0000-4000-8000-000000000843'
      and admission_batch_id = '00000000-0000-4000-8000-000000000822'
    from public.ops_registration_enrollments
    where id = '00000000-0000-4000-8000-000000000834'
  )
  and (
    select status = 'completed'
    from public.ops_registration_admission_batches
    where id = '00000000-0000-4000-8000-000000000822'
  )
  and (
    select not (student_ids ? '00000000-0000-4000-8000-000000000703')
    from public.classes where id = '00000000-0000-4000-8000-000000000716'
  )
  and (
    select student_ids ? '00000000-0000-4000-8000-000000000703'
    from public.classes where id = '00000000-0000-4000-8000-000000000717'
  )
);
select pg_temp.registration_record(143,
  (
    select payload @> '{"studentStatus":"재원","taskStatus":"done","releasedEnrollmentId":null}'::jsonb
    from registration_runtime_143_response
  )
  and (
    select class_ids = '["00000000-0000-4000-8000-000000000719"]'::jsonb
    from public.students
    where id = '00000000-0000-4000-8000-000000000704'
  )
  and not exists (
    select 1 from public.ops_registration_enrollments
    where student_id = '00000000-0000-4000-8000-000000000704'
  )
  and (
    select status = 'done' from public.ops_tasks
    where id = '00000000-0000-4000-8000-000000000844'
  )
);

select pg_temp.registration_record(137,
  (
    select active_to_withdrawn_denied and withdrawn_to_active_denied
    from registration_runtime_137_direct_checks
  )
  and (select payload ->> 'studentStatus' = '퇴원' from registration_runtime_140_response)
  and (select payload ->> 'studentStatus' = '재원' from registration_runtime_142_response)
);

-- State serializer used only to compare before/after rows around an injected late
-- failure. It observes rows; it does not inspect function definitions or catalogs.
set local role postgres;
create or replace function pg_temp.registration_runtime_lifecycle_state(
  p_student_id uuid,
  p_task_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'student', (
      select to_jsonb(student)
      from public.students student
      where student.id = p_student_id
    ),
    'classes', (
      select coalesce(jsonb_agg(to_jsonb(class) order by class.id), '[]'::jsonb)
      from public.classes class
      where coalesce(class.student_ids, '[]'::jsonb) ? p_student_id::text
        or coalesce(class.waitlist_ids, '[]'::jsonb) ? p_student_id::text
        or class.id in (
          select enrollment.class_id
          from public.ops_registration_enrollments enrollment
          where enrollment.student_id = p_student_id
        )
        or class.id = (
          select task.class_id from public.ops_tasks task where task.id = p_task_id
        )
        or class.id in (
          select detail.from_class_id from public.ops_transfer_details detail
          where detail.task_id = p_task_id
          union
          select detail.to_class_id from public.ops_transfer_details detail
          where detail.task_id = p_task_id
        )
    ),
    'enrollments', (
      select coalesce(jsonb_agg(to_jsonb(enrollment) order by enrollment.id), '[]'::jsonb)
      from public.ops_registration_enrollments enrollment
      where enrollment.student_id = p_student_id
    ),
    'tracks', (
      select coalesce(jsonb_agg(to_jsonb(track) order by track.id), '[]'::jsonb)
      from public.ops_registration_subject_tracks track
      where track.task_id in (
        select distinct claim_track.task_id
        from public.ops_registration_enrollments enrollment
        join public.ops_registration_subject_tracks claim_track
          on claim_track.id = enrollment.track_id
        where enrollment.student_id = p_student_id
      )
    ),
    'task', (
      select to_jsonb(task) from public.ops_tasks task where task.id = p_task_id
    ),
    'withdrawalDetail', (
      select to_jsonb(detail)
      from public.ops_withdrawal_details detail
      where detail.task_id = p_task_id
    ),
    'transferDetail', (
      select to_jsonb(detail)
      from public.ops_transfer_details detail
      where detail.task_id = p_task_id
    ),
    'history', (
      select coalesce(jsonb_agg(to_jsonb(history) order by history.id), '[]'::jsonb)
      from public.student_class_enrollment_history history
      where history.student_id = p_student_id
    ),
    'mutations', (
      select coalesce(jsonb_agg(to_jsonb(mutation) order by mutation.actor_id, mutation.request_key), '[]'::jsonb)
      from dashboard_private.ops_registration_mutations mutation
      where mutation.task_id = p_task_id
        or mutation.task_id in (
          select distinct claim_track.task_id
          from public.ops_registration_enrollments enrollment
          join public.ops_registration_subject_tracks claim_track
            on claim_track.id = enrollment.track_id
          where enrollment.student_id = p_student_id
        )
    ),
    'events', (
      select coalesce(jsonb_agg(to_jsonb(event) order by event.id), '[]'::jsonb)
      from public.ops_task_events event
      where event.task_id = p_task_id
        or event.task_id in (
          select distinct claim_track.task_id
          from public.ops_registration_enrollments enrollment
          join public.ops_registration_subject_tracks claim_track
            on claim_track.id = enrollment.track_id
          where enrollment.student_id = p_student_id
        )
    )
  );
$$;
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

create temporary table registration_runtime_144_before on commit drop as
select pg_temp.registration_runtime_lifecycle_state(
  '00000000-0000-4000-8000-000000000705',
  '00000000-0000-4000-8000-000000000845'
) as state;
create temporary table registration_runtime_145_before on commit drop as
select pg_temp.registration_runtime_lifecycle_state(
  '00000000-0000-4000-8000-000000000706',
  '00000000-0000-4000-8000-000000000846'
) as state;

set local role postgres;
create or replace function dashboard_private.registration_runtime_injected_completion_failure()
returns trigger
language plpgsql
as $$
begin
  if new.id in (
      '00000000-0000-4000-8000-000000000845'::uuid,
      '00000000-0000-4000-8000-000000000846'::uuid
    )
    and old.status is distinct from new.status
    and new.status = 'done'
  then
    raise exception 'registration_runtime_injected_failure' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists registration_runtime_injected_completion_failure on public.ops_tasks;
create trigger registration_runtime_injected_completion_failure
before update of status on public.ops_tasks
for each row execute function dashboard_private.registration_runtime_injected_completion_failure();

set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');
select pg_temp.registration_record(144,
  pg_temp.registration_throws(
    $$select public.complete_ops_withdrawal_roster_transition(
      '00000000-0000-4000-8000-000000000845',
      'runtime-144-injected-withdrawal-failure'
    )$$,
    'registration_runtime_injected_failure'
  )
  and (
    select before.state = pg_temp.registration_runtime_lifecycle_state(
      '00000000-0000-4000-8000-000000000705',
      '00000000-0000-4000-8000-000000000845'
    )
    from registration_runtime_144_before before
  )
);
select pg_temp.registration_record(145,
  pg_temp.registration_throws(
    $$select public.complete_ops_transfer_roster_transition(
      '00000000-0000-4000-8000-000000000846',
      'runtime-145-injected-transfer-failure'
    )$$,
    'registration_runtime_injected_failure'
  )
  and (
    select before.state = pg_temp.registration_runtime_lifecycle_state(
      '00000000-0000-4000-8000-000000000706',
      '00000000-0000-4000-8000-000000000846'
    )
    from registration_runtime_145_before before
  )
);

set local role postgres;
drop trigger registration_runtime_injected_completion_failure on public.ops_tasks;
drop function dashboard_private.registration_runtime_injected_completion_failure();
set local role authenticated;
select pg_temp.registration_set_actor('00000000-0000-4000-8000-000000000101');

-- Open admission ownership blocks withdrawal, and withdrawn students cannot create
-- either a current-class wait claim or an admission-batch claim.
select pg_temp.registration_record(146,
  pg_temp.registration_throws(
    $$select public.complete_ops_withdrawal_roster_transition(
      '00000000-0000-4000-8000-000000000847',
      'runtime-146-open-batch-withdrawal'
    )$$,
    'registration_open_admission_batch'
  )
  and pg_temp.registration_throws(
    $$select public.route_registration_inquiry(
      '00000000-0000-4000-8000-000000000818',
      'waiting', 'current_class',
      '00000000-0000-4000-8000-000000000726',
      'runtime-146-withdrawn-current-wait'
    )$$,
    'registration_student_reactivation_required'
  )
  and pg_temp.registration_throws(
    $$select public.start_registration_admission_batch(
      '00000000-0000-4000-8000-000000000807',
      array['00000000-0000-4000-8000-000000000819'::uuid],
      array['00000000-0000-4000-8000-000000000839'::uuid],
      'runtime-146-withdrawn-batch'
    )$$,
    'registration_student_reactivation_required'
  )
  and (
    select status = 'in_progress'
    from public.ops_tasks
    where id = '00000000-0000-4000-8000-000000000847'
  )
  and (
    select status = 'draft'
    from public.ops_registration_admission_batches
    where id = '00000000-0000-4000-8000-000000000825'
  )
  and (
    select status = '퇴원'
      and class_ids = '[]'::jsonb
      and waitlist_class_ids = '[]'::jsonb
    from public.students
    where id = '00000000-0000-4000-8000-000000000708'
  )
  and (
    select status = 'planned'
      and admission_batch_id is null
      and student_id is null
      and not roster_active
    from public.ops_registration_enrollments
    where id = '00000000-0000-4000-8000-000000000839'
  )
);

-- Assertion 147 is the exact readiness invariant over final row state.
select pg_temp.registration_record(147,
  not exists (
    select 1
    from public.students student
    where student.status = '퇴원'
      and (
        jsonb_array_length(coalesce(student.class_ids, '[]'::jsonb)) <> 0
        or jsonb_array_length(coalesce(student.waitlist_class_ids, '[]'::jsonb)) <> 0
        or exists (
          select 1
          from public.classes class
          where coalesce(class.student_ids, '[]'::jsonb) ? student.id::text
            or coalesce(class.waitlist_ids, '[]'::jsonb) ? student.id::text
        )
        or exists (
          select 1
          from public.ops_registration_enrollments enrollment
          where enrollment.student_id = student.id
            and enrollment.roster_active
        )
      )
  )
);

-- Re-evaluate the ready-parent and global roster invariants only after every runtime
-- fixture and workflow mutation has reached its final state.
select pg_temp.registration_record(14, pg_temp.registration_contract(14));
select pg_temp.registration_record(15, pg_temp.registration_contract(15));

-- Assertion 150 remains the packet's explicit column-privilege invariant query.
select pg_temp.registration_record(150, pg_temp.registration_contract(150));

-- assertion 1: atomic RPC creation with exactly two subject tracks.
select ok(
  pg_temp.registration_contract(1),
  '1. atomic RPC creation with exactly two subject tracks.'
);

-- assertion 2: empty-subject create denial.
select ok(
  pg_temp.registration_contract(2),
  '2. empty-subject create denial.'
);

-- assertion 3: direct registration parent insert denial.
select ok(
  pg_temp.registration_contract(3),
  '3. direct registration parent insert denial.'
);

-- assertion 4: general-task-to-registration reclassification denial.
select ok(
  pg_temp.registration_contract(4),
  '4. general-task-to-registration reclassification denial.'
);

-- assertion 5: legacy-registration-to-general reclassification denial.
select ok(
  pg_temp.registration_contract(5),
  '5. legacy-registration-to-general reclassification denial.'
);

-- assertion 6: direct registration detail insert denial.
select ok(
  pg_temp.registration_contract(6),
  '6. direct registration detail insert denial.'
);

-- assertion 7: child-backed parent update denial.
select ok(
  pg_temp.registration_contract(7),
  '7. child-backed parent update denial.'
);

-- assertion 8: child-backed detail update denial.
select ok(
  pg_temp.registration_contract(8),
  '8. child-backed detail update denial.'
);

-- assertion 9: direct child-backed parent delete denial.
select ok(
  pg_temp.registration_contract(9),
  '9. direct child-backed parent delete denial.'
);

-- assertion 10: direct child-backed detail delete denial.
select ok(
  pg_temp.registration_contract(10),
  '10. direct child-backed detail delete denial.'
);

-- assertion 11: reserved-event forgery denial.
select ok(
  pg_temp.registration_contract(11),
  '11. reserved-event forgery denial.'
);

-- assertion 12: invalid/null director-provenance combinations rejected.
select ok(
  pg_temp.registration_contract(12),
  '12. invalid/null director-provenance combinations rejected.'
);

-- assertion 13: assigned director profile deletion restricted.
select ok(
  pg_temp.registration_contract(13),
  '13. assigned director profile deletion restricted.'
);

-- assertion 14: ready-version registration coverage contains no childless parent.
select ok(
  pg_temp.registration_contract(14),
  '14. ready-version registration coverage contains no childless parent.'
);

-- assertion 15: ready-version global roster shape/symmetry assertion succeeds.
select ok(
  pg_temp.registration_contract(15),
  '15. ready-version global roster shape/symmetry assertion succeeds.'
);

-- assertion 16: parent-visible admin director can read the case and children.
select ok(
  pg_temp.registration_contract(16),
  '16. parent-visible admin director can read the case and children.'
);

-- assertion 17: non-participant ordinary teacher receives no new case read.
select ok(
  pg_temp.registration_contract(17),
  '17. non-participant ordinary teacher receives no new case read.'
);

-- assertion 18: assigned admin director own-consultation completion.
select ok(
  pg_temp.registration_contract(18),
  '18. assigned admin director own-consultation completion.'
);

-- assertion 19: sibling admin director consultation-completion denial.
select ok(
  pg_temp.registration_contract(19),
  '19. sibling admin director consultation-completion denial.'
);

-- assertion 20: staff consultation-completion denial.
select ok(
  pg_temp.registration_contract(20),
  '20. staff consultation-completion denial.'
);

-- assertion 21: ordinary-teacher consultation-completion denial on an admin-owned track.
select ok(
  pg_temp.registration_contract(21),
  '21. ordinary-teacher consultation-completion denial on an admin-owned track.'
);

-- assertion 22: assistant consultation-completion denial.
select ok(
  pg_temp.registration_contract(22),
  '22. assistant consultation-completion denial.'
);

-- assertion 23: admin management mutation success outside consultation completion.
select ok(
  pg_temp.registration_contract(23),
  '23. admin management mutation success outside consultation completion.'
);

-- assertion 24: staff management mutation success outside consultation completion.
select ok(
  pg_temp.registration_contract(24),
  '24. staff management mutation success outside consultation completion.'
);

-- assertion 25: valid default-director clear leaves all four provenance fields null.
select ok(
  pg_temp.registration_contract(25),
  '25. valid default-director clear leaves all four provenance fields null.'
);

-- assertion 26: manual-director clear denial.
select ok(
  pg_temp.registration_contract(26),
  '26. manual-director clear denial.'
);

-- assertion 27: wrong but active profile rejected as a default assignment.
select ok(
  pg_temp.registration_contract(27),
  '27. wrong but active profile rejected as a default assignment.'
);

-- assertion 28: stale common-revision default assignment denial.
select ok(
  pg_temp.registration_contract(28),
  '28. stale common-revision default assignment denial.'
);

-- assertion 29: stale-default direct-phone routing denial.
select ok(
  pg_temp.registration_contract(29),
  '29. stale-default direct-phone routing denial.'
);

-- assertion 30: inactive-director direct-phone routing denial.
select ok(
  pg_temp.registration_contract(30),
  '30. inactive-director direct-phone routing denial.'
);

-- assertion 31: same actor/key replay returns the stored response.
select ok(
  pg_temp.registration_contract(31),
  '31. same actor/key replay returns the stored response.'
);

-- assertion 32: changed-payload key reuse denial.
select ok(
  pg_temp.registration_contract(32),
  '32. changed-payload key reuse denial.'
);

-- assertion 33: safe pre-roster identity edit clears only a stale student link.
select ok(
  pg_temp.registration_contract(33),
  '33. safe pre-roster identity edit clears only a stale student link.'
);

-- assertion 34: stale common-revision save denial.
select ok(
  pg_temp.registration_contract(34),
  '34. stale common-revision save denial.'
);

-- assertion 35: every active admission claim—including failed-hold—freezes identity, while inactive failed releases only that boundary.
select ok(
  pg_temp.registration_contract(35),
  '35. every active admission claim—including failed-hold—freezes identity, while inactive failed releases only that boundary.'
);

-- assertion 36: post-history optional identity-field change denial.
select ok(
  pg_temp.registration_contract(36),
  '36. post-history optional identity-field change denial.'
);

-- assertion 37: identity change after current-class waiting denial.
select ok(
  pg_temp.registration_contract(37),
  '37. identity change after current-class waiting denial.'
);

-- assertion 38: identity change after completed registration denial.
select ok(
  pg_temp.registration_contract(38),
  '38. identity change after completed registration denial.'
);

-- assertion 39: common revision increments exactly once and remains stable on replay.
select ok(
  pg_temp.registration_contract(39),
  '39. common revision increments exactly once and remains stable on replay.'
);

-- assertion 40: cross-actor admission-notice replay produces one flag and one event.
select ok(
  pg_temp.registration_contract(40),
  '40. cross-actor admission-notice replay produces one flag and one event.'
);

-- assertion 41: duplicate exact student identity raises the management-cleanup error.
select ok(
  pg_temp.registration_contract(41),
  '41. duplicate exact student identity raises the management-cleanup error.'
);

-- assertion 42: SQL default-director resolver returns the exact current profile and rule key.
select ok(
  pg_temp.registration_contract(42),
  '42. SQL default-director resolver returns the exact current profile and rule key.'
);

-- assertion 43: sync-to-empty/last-subject removal denial.
select ok(
  pg_temp.registration_contract(43),
  '43. sync-to-empty/last-subject removal denial.'
);

-- assertion 44: duplicate-containing dual-subject appointment input produces one child per distinct track.
select ok(
  pg_temp.registration_contract(44),
  '44. duplicate-containing dual-subject appointment input produces one child per distinct track.'
);

-- assertion 45: empty appointment-track-set denial.
select ok(
  pg_temp.registration_contract(45),
  '45. empty appointment-track-set denial.'
);

-- assertion 46: duplicate-active appointment denial.
select ok(
  pg_temp.registration_contract(46),
  '46. duplicate-active appointment denial.'
);

-- assertion 47: stale appointment edit revision conflict.
select ok(
  pg_temp.registration_contract(47),
  '47. stale appointment edit revision conflict.'
);

-- assertion 48: stale appointment cancel revision conflict.
select ok(
  pg_temp.registration_contract(48),
  '48. stale appointment cancel revision conflict.'
);

-- assertion 49: completed-English/absent-mathematics attempt-2 rescheduling.
select ok(
  pg_temp.registration_contract(49),
  '49. completed-English/absent-mathematics attempt-2 rescheduling.'
);

-- assertion 50: independent consultation outcome.
select ok(
  pg_temp.registration_contract(50),
  '50. independent consultation outcome.'
);

-- assertion 51: stale-default level-test completion queue denial.
select ok(
  pg_temp.registration_contract(51),
  '51. stale-default level-test completion queue denial.'
);

-- assertion 52: inactive-director visit save denial.
select ok(
  pg_temp.registration_contract(52),
  '52. inactive-director visit save denial.'
);

-- assertion 53: stale-default visit save denial.
select ok(
  pg_temp.registration_contract(53),
  '53. stale-default visit save denial.'
);

-- assertion 54: visit cancellation with unavailable director succeeds without a phone row and returns assignment-required.
select ok(
  pg_temp.registration_contract(54),
  '54. visit cancellation with unavailable director succeeds without a phone row and returns assignment-required.'
);

-- assertion 55: valid migration-review enrollment-processing import.
select ok(
  pg_temp.registration_contract(55),
  '55. valid migration-review enrollment-processing import.'
);

-- assertion 56: invalid migration-review enrollment-processing evidence denial.
select ok(
  pg_temp.registration_contract(56),
  '56. invalid migration-review enrollment-processing evidence denial.'
);

-- assertion 57: valid migration-review registered import.
select ok(
  pg_temp.registration_contract(57),
  '57. valid migration-review registered import.'
);

-- assertion 58: invalid migration-review registered evidence denial.
select ok(
  pg_temp.registration_contract(58),
  '58. invalid migration-review registered evidence denial.'
);

-- assertion 59: malformed scalar/object roster JSON rejection.
select ok(
  pg_temp.registration_contract(59),
  '59. malformed scalar/object roster JSON rejection.'
);

-- assertion 60: malformed roster UUID-string element rejection.
select ok(
  pg_temp.registration_contract(60),
  '60. malformed roster UUID-string element rejection.'
);

-- assertion 61: generic roster RPC admin/staff success with exact committed response.
select ok(
  pg_temp.registration_contract(61),
  '61. generic roster RPC admin/staff success with exact committed response.'
);

-- assertion 62: generic roster RPC assistant denial.
select ok(
  pg_temp.registration_contract(62),
  '62. generic roster RPC assistant denial.'
);

-- assertion 63: generic roster expected-mode conflict.
select ok(
  pg_temp.registration_contract(63),
  '63. generic roster expected-mode conflict.'
);

-- assertion 64: authenticated student insert/upsert success and nonempty roster denial.
select ok(
  pg_temp.registration_contract(64),
  '64. authenticated student insert/upsert success and nonempty roster denial.'
);

-- assertion 65: authenticated class insert/upsert success and nonempty roster denial.
select ok(
  pg_temp.registration_contract(65),
  '65. authenticated class insert/upsert success and nonempty roster denial.'
);

-- assertion 66: direct authenticated student/class roster-array update denial.
select ok(
  pg_temp.registration_contract(66),
  '66. direct authenticated student/class roster-array update denial.'
);

-- assertion 67: direct enrollment-history insert forgery denial.
select ok(
  pg_temp.registration_contract(67),
  '67. direct enrollment-history insert forgery denial.'
);

-- assertion 68: direct enrollment-history update/delete denial.
select ok(
  pg_temp.registration_contract(68),
  '68. direct enrollment-history update/delete denial.'
);

-- assertion 69: authenticated history TRUNCATE privilege absence.
select ok(
  pg_temp.registration_contract(69),
  '69. authenticated history TRUNCATE privilege absence.'
);

-- assertion 70: linked student delete denial when only the reverse class side references it.
select ok(
  pg_temp.registration_contract(70),
  '70. linked student delete denial when only the reverse class side references it.'
);

-- assertion 71: unlinked but history-bearing student delete denial.
select ok(
  pg_temp.registration_contract(71),
  '71. unlinked but history-bearing student delete denial.'
);

-- assertion 72: already-unlinked never-used student delete allowance.
select ok(
  pg_temp.registration_contract(72),
  '72. already-unlinked never-used student delete allowance.'
);

-- assertion 73: one-sided enrolled projection rejected by the roster helper.
select ok(
  pg_temp.registration_contract(73),
  '73. one-sided enrolled projection rejected by the roster helper.'
);

-- assertion 74: current-wait student enrolled-array absence.
select ok(
  pg_temp.registration_contract(74),
  '74. current-wait student enrolled-array absence.'
);

-- assertion 75: current-wait student waitlist-array presence.
select ok(
  pg_temp.registration_contract(75),
  '75. current-wait student waitlist-array presence.'
);

-- assertion 76: current-wait class enrolled-array absence.
select ok(
  pg_temp.registration_contract(76),
  '76. current-wait class enrolled-array absence.'
);

-- assertion 77: current-wait class waitlist-array presence.
select ok(
  pg_temp.registration_contract(77),
  '77. current-wait class waitlist-array presence.'
);

-- assertion 78: one waitlist history row.
select ok(
  pg_temp.registration_contract(78),
  '78. one waitlist history row.'
);

-- assertion 79: batch enrollment symmetry across both enrolled arrays.
select ok(
  pg_temp.registration_contract(79),
  '79. batch enrollment symmetry across both enrolled arrays.'
);

-- assertion 80: required-retest appointment cancels the current-class waitlisted row and removes both waitlist projections.
select ok(
  pg_temp.registration_contract(80),
  '80. required-retest appointment cancels the current-class waitlisted row and removes both waitlist projections.'
);

-- assertion 81: one enrolled/removed history row per real transition.
select ok(
  pg_temp.registration_contract(81),
  '81. one enrolled/removed history row per real transition.'
);

-- assertion 82: second-row batch rollback.
select ok(
  pg_temp.registration_contract(82),
  '82. second-row batch rollback.'
);

-- assertion 83: stale class-subject rollback at paid completion.
select ok(
  pg_temp.registration_contract(83),
  '83. stale class-subject rollback at paid completion.'
);

-- assertion 84: stale/unlinked textbook rollback at paid completion.
select ok(
  pg_temp.registration_contract(84),
  '84. stale/unlinked textbook rollback at paid completion.'
);

-- assertion 85: locked student-identity mismatch rollback at paid completion.
select ok(
  pg_temp.registration_contract(85),
  '85. locked student-identity mismatch rollback at paid completion.'
);

-- assertion 86: mixed add-class cancellation restore/routing plus unselected first-admission draft cancellation.
select ok(
  pg_temp.registration_contract(86),
  '86. mixed add-class cancellation restore/routing plus unselected first-admission draft cancellation.'
);

-- assertion 87: registered-track unbatched add-class draft preserves closed projection then cancels on last-row waiting route.
select ok(
  pg_temp.registration_contract(87),
  '87. registered-track unbatched add-class draft preserves closed projection then cancels on last-row waiting route.'
);

-- assertion 88: batch completion response returns the committed batch and enrollment rows.
select ok(
  pg_temp.registration_contract(88),
  '88. batch completion response returns the committed batch and enrollment rows.'
);

-- assertion 89: paid completion commits every row and all four roster projections atomically.
select ok(
  pg_temp.registration_contract(89),
  '89. paid completion commits every row and all four roster projections atomically.'
);

-- assertion 90: progressed legacy done case recomputes to migration review then resolves.
select ok(
  pg_temp.registration_contract(90),
  '90. progressed legacy done case recomputes to migration review then resolves.'
);

-- assertion 91: missing level-test place review resolves to inquiry with zero child activity.
select ok(
  pg_temp.registration_contract(91),
  '91. missing level-test place review resolves to inquiry with zero child activity.'
);

-- assertion 92: incomplete visit time/place review.
select ok(
  pg_temp.registration_contract(92),
  '92. incomplete visit time/place review.'
);

-- assertion 93: inconsistent legacy payment-without-invoice review.
select ok(
  pg_temp.registration_contract(93),
  '93. inconsistent legacy payment-without-invoice review.'
);

-- assertion 94: registered legacy row with missing evidence review.
select ok(
  pg_temp.registration_contract(94),
  '94. registered legacy row with missing evidence review.'
);

-- assertion 95: multi-subject legacy counselor remains unassigned.
select ok(
  pg_temp.registration_contract(95),
  '95. multi-subject legacy counselor remains unassigned.'
);

-- assertion 96: asymmetric current-wait roster review.
select ok(
  pg_temp.registration_contract(96),
  '96. asymmetric current-wait roster review.'
);

-- assertion 97: asymmetric registered roster review.
select ok(
  pg_temp.registration_contract(97),
  '97. asymmetric registered roster review.'
);

-- assertion 98: legacy 6 row with zero valid enrollment goes to review.
select ok(
  pg_temp.registration_contract(98),
  '98. legacy 6 row with zero valid enrollment goes to review.'
);

-- assertion 99: legacy 6 row with invalid canonical session goes to review.
select ok(
  pg_temp.registration_contract(99),
  '99. legacy 6 row with invalid canonical session goes to review.'
);

-- assertion 100: real machine-status transition stamps stage_entered_at once.
select ok(
  pg_temp.registration_contract(100),
  '100. real machine-status transition stamps stage_entered_at once.'
);

-- assertion 101: same-stage waiting-kind/director/common edit preserves stage_entered_at.
select ok(
  pg_temp.registration_contract(101),
  '101. same-stage waiting-kind/director/common edit preserves stage_entered_at.'
);

-- assertion 102: same-key replay preserves stage_entered_at.
select ok(
  pg_temp.registration_contract(102),
  '102. same-key replay preserves stage_entered_at.'
);

-- assertion 103: parent director projection chooses the first active English track before mathematics and projects its assigned director.
select ok(
  pg_temp.registration_contract(103),
  '103. parent director projection chooses the first active English track before mathematics and projects its assigned director.'
);

-- assertion 104: parent director projection remains null when the first active English track is unassigned even if mathematics is directed.
select ok(
  pg_temp.registration_contract(104),
  '104. parent director projection remains null when the first active English track is unassigned even if mathematics is directed.'
);

-- assertion 105: fully terminal parent clears both legacy director projections.
select ok(
  pg_temp.registration_contract(105),
  '105. fully terminal parent clears both legacy director projections.'
);

-- assertion 106: stale-default phone/visit consultation completion denial after grade or Seoul-effective-year change.
select ok(
  pg_temp.registration_contract(106),
  '106. stale-default phone/visit consultation completion denial after grade or Seoul-effective-year change.'
);

-- assertion 107: last-row and admission-batch cancellation into current-class waiting each materialize one waitlisted row with symmetric four-projection state.
select ok(
  pg_temp.registration_contract(107),
  '107. last-row and admission-batch cancellation into current-class waiting each materialize one waitlisted row with symmetric four-projection state.'
);

-- assertion 108: reconciliation JSON evidence and reason are both required and unknown keys are denied.
select ok(
  pg_temp.registration_contract(108),
  '108. reconciliation JSON evidence and reason are both required and unknown keys are denied.'
);

-- assertion 109: every pending-message browser reconciliation is denied in favor of server provider check.
select ok(
  pg_temp.registration_contract(109),
  '109. every pending-message browser reconciliation is denied in favor of server provider check.'
);

-- assertion 110: unknown-to-accepted and accepted-unsynced-after-last-eligibility recovery each produce one admission flag/event mark with zero resend.
select ok(
  pg_temp.registration_contract(110),
  '110. unknown-to-accepted and accepted-unsynced-after-last-eligibility recovery each produce one admission flag/event mark with zero resend.'
);

-- assertion 111: unknown-to-failed-hold keeps the claim active and identity/send blocked.
select ok(
  pg_temp.registration_contract(111),
  '111. unknown-to-failed-hold keeps the claim active and identity/send blocked.'
);

-- assertion 112: failed-hold-to-accepted succeeds before release when later provider evidence proves acceptance.
select ok(
  pg_temp.registration_contract(112),
  '112. failed-hold-to-accepted succeeds before release when later provider evidence proves acceptance.'
);

-- assertion 113: reconciliation same-key replay preserves one immutable audit event and timestamp.
select ok(
  pg_temp.registration_contract(113),
  '113. reconciliation same-key replay preserves one immutable audit event and timestamp.'
);

-- assertion 114: assigning a valid director after unavailable-owner visit cancellation creates exactly one completable phone consultation.
select ok(
  pg_temp.registration_contract(114),
  '114. assigning a valid director after unavailable-owner visit cancellation creates exactly one completable phone consultation.'
);

-- assertion 115: failed-hold retry release before the 15-minute delay is denied.
select ok(
  pg_temp.registration_contract(115),
  '115. failed-hold retry release before the 15-minute delay is denied.'
);

-- assertion 116: failed-hold transition resets `updated_at`, so an old unknown timestamp cannot bypass the delay.
select ok(
  pg_temp.registration_contract(116),
  '116. failed-hold transition resets `updated_at`, so an old unknown timestamp cannot bypass the delay.'
);

-- assertion 117: explicit delayed retry release sets only `claim_active = false`, preserves failed history, and requires a new message key.
select ok(
  pg_temp.registration_contract(117),
  '117. explicit delayed retry release sets only `claim_active = false`, preserves failed history, and requires a new message key.'
);

-- assertion 118: authenticated admin/staff direct execution of the message finalizer is denied.
select ok(
  pg_temp.registration_contract(118),
  '118. authenticated admin/staff direct execution of the message finalizer is denied.'
);

-- assertion 119: service-role finalizer performs pending-to-accepted, pending-to-unknown, and definitive pending-to-inactive-failed transitions with exact camelCase claim state.
select ok(
  pg_temp.registration_contract(119),
  '119. service-role finalizer performs pending-to-accepted, pending-to-unknown, and definitive pending-to-inactive-failed transitions with exact camelCase claim state.'
);

-- assertion 120: finalizer accepted result wins against an unreleased failed-hold, while an already released failed row cannot reactivate.
select ok(
  pg_temp.registration_contract(120),
  '120. finalizer accepted result wins against an unreleased failed-hold, while an already released failed row cannot reactivate.'
);

-- assertion 121: a message request key reused by another task/template raises `registration_message_request_key_reused`.
select ok(
  pg_temp.registration_contract(121),
  '121. a message request key reused by another task/template raises `registration_message_request_key_reused`.'
);

-- assertion 122: the message claim-state CHECK rejects a non-failed row with `claim_active = false`.
select ok(
  pg_temp.registration_contract(122),
  '122. the message claim-state CHECK rejects a non-failed row with `claim_active = false`.'
);

-- assertion 123: direct authenticated provider-field/message status mutation and every newly reserved event forgery are denied.
select ok(
  pg_temp.registration_contract(123),
  '123. direct authenticated provider-field/message status mutation and every newly reserved event forgery are denied.'
);

-- assertion 124: scheduling one subject for a visit cancels only its active phone row; the sibling phone queue remains waiting.
select ok(
  pg_temp.registration_contract(124),
  '124. scheduling one subject for a visit cancels only its active phone row; the sibling phone queue remains waiting.'
);

-- assertion 125: deselecting one subject from an all-scheduled dual level test returns only that track to inquiry and leaves no appointment-less scheduled state.
select ok(
  pg_temp.registration_contract(125),
  '125. deselecting one subject from an all-scheduled dual level test returns only that track to inquiry and leaves no appointment-less scheduled state.'
);

-- assertion 126: phone/waiting requires `consultation_waiting`, visit/scheduled requires `visit_consultation_scheduled`, null outcome is denied, and non-waiting outcomes reject waiting fields.
select ok(
  pg_temp.registration_contract(126),
  '126. phone/waiting requires `consultation_waiting`, visit/scheduled requires `visit_consultation_scheduled`, null outcome is denied, and non-waiting outcomes reject waiting fields.'
);

-- assertion 127: `route_registration_inquiry` invoked from any later stage is denied with no child/event change.
select ok(
  pg_temp.registration_contract(127),
  '127. `route_registration_inquiry` invoked from any later stage is denied with no child/event change.'
);

-- assertion 128: automatic-default-only dual inquiry permits removal of one untouched subject and records the parent removal audit.
select ok(
  pg_temp.registration_contract(128),
  '128. automatic-default-only dual inquiry permits removal of one untouched subject and records the parent removal audit.'
);

-- assertion 129: manual director assignment or operational activity blocks subject removal.
select ok(
  pg_temp.registration_contract(129),
  '129. manual director assignment or operational activity blocks subject removal.'
);

-- assertion 130: two registration cases cannot hold the same roster-active student/class claim.
select ok(
  pg_temp.registration_contract(130),
  '130. two registration cases cannot hold the same roster-active student/class claim.'
);

-- assertion 131: a generic roster command is denied while an open-batch/wait/enrolled claim owns that same pair.
select ok(
  pg_temp.registration_contract(131),
  '131. a generic roster command is denied while an open-batch/wait/enrolled claim owns that same pair.'
);

-- assertion 132: forged invoice/payment timestamps cannot complete a non-paid batch.
select ok(
  pg_temp.registration_contract(132),
  '132. forged invoice/payment timestamps cannot complete a non-paid batch.'
);

-- assertion 133: batch advance enforces exact draft-to-invoiced-to-paid order; cross-actor replay cannot restamp timestamps/events.
select ok(
  pg_temp.registration_contract(133),
  '133. batch advance enforces exact draft-to-invoiced-to-paid order; cross-actor replay cannot restamp timestamps/events.'
);

-- assertion 134: every backfilled waitlisted/batched/enrolled row is roster-active with frozen student, while an unbatched planned draft is inactive with null student.
select ok(
  pg_temp.registration_contract(134),
  '134. every backfilled waitlisted/batched/enrolled row is roster-active with frozen student, while an unbatched planned draft is inactive with null student.'
);

-- assertion 135: canceled batch rows release claims but retain frozen student and canceled-batch membership.
select ok(
  pg_temp.registration_contract(135),
  '135. canceled batch rows release claims but retain frozen student and canceled-batch membership.'
);

-- assertion 136: a released enrolled history row permits a later planned row for the same track/class and renders no live cancellation claim.
select ok(
  pg_temp.registration_contract(136),
  '136. a released enrolled history row permits a later planned row for the same track/class and renders no live cancellation claim.'
);

-- assertion 137: direct authenticated student-status transitions in either direction are denied while roster/withdrawal/transfer RPC transitions succeed.
select ok(
  pg_temp.registration_contract(137),
  '137. direct authenticated student-status transitions in either direction are denied while roster/withdrawal/transfer RPC transitions succeed.'
);

-- assertion 138: direct terminal withdrawal/transfer task or completion-flag insert/update is denied.
select ok(
  pg_temp.registration_contract(138),
  '138. direct terminal withdrawal/transfer task or completion-flag insert/update is denied.'
);

-- assertion 139: withdrawal/transfer type reclassification, general-task/detail mismatch, and two-step completion bypass are denied.
select ok(
  pg_temp.registration_contract(139),
  '139. withdrawal/transfer type reclassification, general-task/detail mismatch, and two-step completion bypass are denied.'
);

-- assertion 140: claimed whole-student withdrawal removes every enrolled and current-class waitlist pair, releases/cancels claims, closes wait tracks, then sets `퇴원` atomically.
select ok(
  pg_temp.registration_contract(140),
  '140. claimed whole-student withdrawal removes every enrolled and current-class waitlist pair, releases/cancels claims, closes wait tracks, then sets `퇴원` atomically.'
);

-- assertion 141: unclaimed legacy/management whole-student withdrawal completes through the same atomic roster/status/task path.
select ok(
  pg_temp.registration_contract(141),
  '141. unclaimed legacy/management whole-student withdrawal completes through the same atomic roster/status/task path.'
);

-- assertion 142: claimed transfer releases only the source registration claim, moves the roster to the destination, and preserves paid admission history.
select ok(
  pg_temp.registration_contract(142),
  '142. claimed transfer releases only the source registration claim, moves the roster to the destination, and preserves paid admission history.'
);

-- assertion 143: unclaimed legacy/management transfer moves the roster and task state atomically.
select ok(
  pg_temp.registration_contract(143),
  '143. unclaimed legacy/management transfer moves the roster and task state atomically.'
);

-- assertion 144: injected withdrawal failure rolls back all classes, waitlists, claims, student status, task/checklist, history, and receipts.
select ok(
  pg_temp.registration_contract(144),
  '144. injected withdrawal failure rolls back all classes, waitlists, claims, student status, task/checklist, history, and receipts.'
);

-- assertion 145: injected transfer failure rolls back both classes, any claim, student status, task/checklist, history, and receipts.
select ok(
  pg_temp.registration_contract(145),
  '145. injected transfer failure rolls back both classes, any claim, student status, task/checklist, history, and receipts.'
);

-- assertion 146: withdrawal rejects an open admission-batch claim and a withdrawn student cannot materialize a wait/batch claim without explicit reactivation.
select ok(
  pg_temp.registration_contract(146),
  '146. withdrawal rejects an open admission-batch claim and a withdrawn student cannot materialize a wait/batch claim without explicit reactivation.'
);

-- assertion 147: withdrawn-state readiness invariant requires zero live student/class projections and zero roster-active claims.
select ok(
  pg_temp.registration_contract(147),
  '147. withdrawn-state readiness invariant requires zero live student/class projections and zero roster-active claims.'
);

-- assertion 148: registration cancellation counts only roster-active enrolled rows; released history is read-only and does not block re-enrollment.
select ok(
  pg_temp.registration_contract(148),
  '148. registration cancellation counts only roster-active enrolled rows; released history is read-only and does not block re-enrollment.'
);

-- assertion 149: canceled selected rows remain linked to their canceled admission batch and preserve audit reconstruction.
select ok(
  pg_temp.registration_contract(149),
  '149. canceled selected rows remain linked to their canceled admission batch and preserve audit reconstruction.'
);

-- assertion 150: message-table column grants expose only workflow-safe state columns to authenticated readers, not recipient/provider/error payload.
select ok(
  pg_temp.registration_contract(150),
  '150. message-table column grants expose only workflow-safe state columns to authenticated readers, not recipient/provider/error payload.'
);

select * from finish();
rollback;
