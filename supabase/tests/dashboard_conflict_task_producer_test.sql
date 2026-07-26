begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';

select has_table('dashboard_private', 'dashboard_conflict_task_links');
select has_function('public', 'list_dashboard_conflict_task_links_v1', array['jsonb']);
select has_function('public', 'create_dashboard_conflict_task_v1', array['jsonb', 'uuid']);
select has_function('public', 'arm_dashboard_conflict_checkpoint_v1', array['uuid', 'text', 'uuid[]']);
select has_function('public', 'get_dashboard_conflict_notification_counts_v1', array['uuid[]']);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.list_dashboard_conflict_task_links_v1(jsonb)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_dashboard_conflict_task_v1(jsonb,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.create_dashboard_conflict_task_v1(jsonb,uuid)',
    'EXECUTE'
  ),
  'dashboard conflict RPCs are authenticated-only'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.dashboard_conflict_exam_subjects_for_student_v1(jsonb,date)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.dashboard_conflict_class_slots_v1(jsonb)',
    'EXECUTE'
  ),
  'security-definer and parser helpers are not directly executable by API roles'
);

select is(
  dashboard_private.dashboard_conflict_key_v1(
    dashboard_private.normalize_dashboard_conflict_v1(
      jsonb_build_object(
        'type', 'teacher',
        'occurrenceKind', 'weekly',
        'classIds', jsonb_build_array(
          '85000000-0000-4000-8000-000000000302',
          '85000000-0000-4000-8000-000000000301'
        ),
        'studentIds', '[]'::jsonb,
        'examEventIds', '[]'::jsonb,
        'examDetailIds', '[]'::jsonb,
        'teacherCatalogIds', '[]'::jsonb,
        'classroomCatalogIds', '[]'::jsonb,
        'weekday', '월',
        'overlapStart', '9:30',
        'overlapEnd', '10:00',
        'examDate', '',
        'examRule', ''
      )
    )
  ),
  'weekly:v1:teacher:월:09:30-10:00:85000000-0000-4000-8000-000000000301:85000000-0000-4000-8000-000000000302',
  'weekly key sorts class IDs and normalizes time without display names'
);

select is(
  dashboard_private.dashboard_conflict_key_v1(
    dashboard_private.normalize_dashboard_conflict_v1(
      jsonb_build_object(
        'type', 'teacher',
        'occurrenceKind', 'weekly',
        'classIds', jsonb_build_array(
          '{85000000-0000-4000-8000-000000000302}',
          '85000000-0000-4000-8000-000000000301'
        ),
        'studentIds', '[]'::jsonb,
        'examEventIds', '[]'::jsonb,
        'examDetailIds', '[]'::jsonb,
        'teacherCatalogIds', '[]'::jsonb,
        'classroomCatalogIds', '[]'::jsonb,
        'weekday', '월',
        'overlapStart', '09:30',
        'overlapEnd', '10:00',
        'examDate', '',
        'examRule', ''
      )
    )
  ),
  'weekly:v1:teacher:월:09:30-10:00:85000000-0000-4000-8000-000000000301:85000000-0000-4000-8000-000000000302',
  'UUID braces and case normalize into one canonical conflict key'
);

select throws_ok(
  $$select dashboard_private.normalize_dashboard_conflict_v1('{"type":"teacher"}'::jsonb)$$,
  '22023',
  'dashboard_conflict_input_invalid',
  'incomplete conflict source fails closed'
);

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.dashboard_conflict_class_slots_v1(
      jsonb_build_object(
        'teacher', '김연결, 이공동',
        'room', '별4, 본2',
        'schedule', '월 09:00-10:00'
      )
    )
  ),
  4::bigint,
  'default multi-teacher and multi-classroom slots expand like the dashboard parser'
);

select is(
  (
    select slot.teacher_name || '|' || slot.classroom_name
    from dashboard_private.dashboard_conflict_class_slots_v1(
      jsonb_build_object(
        'teacher', '김연결, 이공동',
        'room', '별4, 본2',
        'schedule', '월 09:00-10:00 (대체교사 / 별3)'
      )
    ) slot
  ),
  '대체교사|별관 3강',
  'day override uses the exact teacher and normalized classroom alias'
);

select ok(
  dashboard_private.dashboard_conflict_student_registered_v1(
    '{"id":"85000000-0000-4000-8000-000000000301","student_ids":["85000000-0000-4000-8000-000000000201"]}'::jsonb,
    '{"id":"85000000-0000-4000-8000-000000000201","class_ids":[]}'::jsonb
  )
  and dashboard_private.dashboard_conflict_student_registered_v1(
    '{"id":"85000000-0000-4000-8000-000000000301","student_ids":[]}'::jsonb,
    '{"id":"85000000-0000-4000-8000-000000000201","class_ids":["85000000-0000-4000-8000-000000000301"]}'::jsonb
  ),
  'either canonical registered projection proves student enrollment'
);

select ok(
  not dashboard_private.dashboard_conflict_student_registered_v1(
    '{"id":"85000000-0000-4000-8000-000000000301","student_ids":["85000000-0000-4000-8000-000000000201"],"waitlist_ids":["85000000-0000-4000-8000-000000000201"]}'::jsonb,
    '{"id":"85000000-0000-4000-8000-000000000201","class_ids":["85000000-0000-4000-8000-000000000301"]}'::jsonb
  ),
  'any waitlist projection wins over registered projections'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '85000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'dashboard-conflict-admin@runtime.invalid',
    crypt('dashboard-conflict-runtime-only', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"dashboard-conflict"}'::jsonb, now(), now()
  ),
  (
    '85000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-8000-000000000000',
    'authenticated', 'authenticated', 'dashboard-conflict-viewer@runtime.invalid',
    crypt('dashboard-conflict-runtime-only', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"dashboard-conflict"}'::jsonb, now(), now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '85000000-0000-4000-8000-000000000001', 'admin',
    '충돌검증 관리자', 'dashboard-conflict-admin@runtime.invalid', now(), now()
  ),
  (
    '85000000-0000-4000-8000-000000000002', 'viewer',
    '충돌검증 열람자', 'dashboard-conflict-viewer@runtime.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role
)
values (
  '85000000-0000-4000-8000-000000000101',
  '충돌검증 관리자', array['영어']::text[], true, 9850,
  '85000000-0000-4000-8000-000000000001',
  'dashboard-conflict-admin@runtime.invalid', 'admin'
)
on conflict (id) do update
set name = excluded.name,
    profile_id = excluded.profile_id,
    account_email = excluded.account_email,
    dashboard_role = excluded.dashboard_role;

update public.profiles
set teacher_catalog_id = '85000000-0000-4000-8000-000000000101',
    updated_at = now()
where id = '85000000-0000-4000-8000-000000000001';

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_plan
)
values
  (
    '85000000-0000-4000-8000-000000000301', '충돌검증 영어 A', '정규',
    '영어', '고1', '충돌검증 관리자', '월 09:00-11:00', '본관 1강',
    12, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '[]'::jsonb, '{}'::jsonb
  ),
  (
    '85000000-0000-4000-8000-000000000302', '충돌검증 영어 B', '정규',
    '영어', '고1', '충돌검증 관리자', '월 09:30-10:30', '별관 1강',
    12, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '[]'::jsonb, '{}'::jsonb
  );

insert into public.academic_schools(id, name, category)
values (
  '85000000-0000-4000-8000-000000000601',
  '충돌검증고',
  '고등학교'
)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category;

insert into public.students(
  id, name, uid, school, grade, contact, parent_contact, status,
  class_ids, waitlist_class_ids
)
values
  (
    '85000000-0000-4000-8000-000000000201', '시험충돌 등록학생',
    'dashboard-conflict-exam-enrolled', '충돌검증고', '고1', '01000000201', '01000001201', '재원',
    jsonb_build_array('85000000-0000-4000-8000-000000000303'), '[]'::jsonb
  ),
  (
    '85000000-0000-4000-8000-000000000202', '시험충돌 대기학생',
    'dashboard-conflict-exam-waitlist', '충돌검증고', '고1', '01000000202', '01000001202', '재원',
    '[]'::jsonb, jsonb_build_array('85000000-0000-4000-8000-000000000303')
  );

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_plan
)
values (
  '85000000-0000-4000-8000-000000000303', '시험충돌 영어', '정규',
  '영어', '고1', '충돌검증 관리자', '월화 18:00-20:00', '본관 2강',
  12, 100000, '수업 진행 중',
  jsonb_build_array('85000000-0000-4000-8000-000000000201'),
  jsonb_build_array('85000000-0000-4000-8000-000000000202'),
  '[]'::jsonb, '[]'::jsonb,
  jsonb_build_object('sessions', jsonb_build_array(
    jsonb_build_object('date', (current_date + 4)::text, 'sessionNumber', 1, 'scheduleState', 'active'),
    jsonb_build_object('date', (current_date + 5)::text, 'sessionNumber', 2, 'scheduleState', 'active')
  ))
);

insert into public.academic_events(id, title, date, type, grade, note, school_id)
values (
  '85000000-0000-4000-8000-000000000501',
  '시험충돌 현대 시험기간', current_date + 4, '시험기간', '고1',
  'dashboard conflict pgTAP', '85000000-0000-4000-8000-000000000601'
);

insert into public.academic_event_exam_details(
  id, academic_event_id, grade, subject, exam_date, exam_date_status, sort_order
)
values
  (
    '85000000-0000-4000-8000-000000000511',
    '85000000-0000-4000-8000-000000000501', '고1', '영어', current_date + 4, 'exact', 1
  ),
  (
    '85000000-0000-4000-8000-000000000512',
    '85000000-0000-4000-8000-000000000501', '고1', '영어', current_date + 5, 'exact', 2
  ),
  (
    '85000000-0000-4000-8000-000000000513',
    '85000000-0000-4000-8000-000000000501', '고1', '수학', current_date + 5, 'exact', 3
  ),
  (
    '85000000-0000-4000-8000-000000000514',
    '85000000-0000-4000-8000-000000000501', '고1', '수학', current_date + 6, 'exact', 4
  );

insert into public.academic_exam_days(
  id, school_id, grade, subject, exam_date, label, note, sort_order
)
values
  (
    '85000000-0000-4000-8000-000000000521',
    '85000000-0000-4000-8000-000000000601', '고1', '영어',
    current_date + 30, 'legacy 영어 시험', '날짜 단위 fallback 검증', 1
  ),
  (
    '85000000-0000-4000-8000-000000000522',
    '85000000-0000-4000-8000-000000000601', '고1', '수학',
    current_date + 4, 'legacy 수학 시험', 'modern 과목 상세 우선 검증', 2
  );

create or replace function pg_temp.dashboard_conflict_set_actor(p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
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

create or replace function pg_temp.dashboard_exam_conflict(
  p_rule text,
  p_exam_date date,
  p_student_id uuid,
  p_detail_ids uuid[]
) returns jsonb
language sql
as $$
  select jsonb_build_object(
    'type', 'exam',
    'occurrenceKind', 'dated',
    'classIds', jsonb_build_array('85000000-0000-4000-8000-000000000303'),
    'studentIds', to_jsonb(array[p_student_id::text]),
    'examEventIds', jsonb_build_array('85000000-0000-4000-8000-000000000501'),
    'examDetailIds', to_jsonb(
      coalesce(
        (select array_agg(detail_id::text order by detail_id) from unnest(p_detail_ids) detail_id),
        array[]::text[]
      )
    ),
    'teacherCatalogIds', jsonb_build_array('85000000-0000-4000-8000-000000000101'),
    'classroomCatalogIds', '[]'::jsonb,
    'weekday', '',
    'overlapStart', '',
    'overlapEnd', '',
    'examDate', p_exam_date::text,
    'examRule', p_rule
  );
$$;

select is(
  dashboard_private.dashboard_conflict_exam_subjects_for_student_v1(
    (
      select to_jsonb(student)
      from public.students student
      where student.id = '85000000-0000-4000-8000-000000000201'
    ),
    current_date + 30
  ),
  array['영어']::text[],
  '다른 날짜의 modern 시험 일정은 대상 날짜의 legacy 과목 fallback을 막지 않는다'
);

select is(
  dashboard_private.dashboard_conflict_exam_subjects_for_student_v1(
    (
      select to_jsonb(student)
      from public.students student
      where student.id = '85000000-0000-4000-8000-000000000201'
    ),
    current_date + 4
  ),
  array['영어']::text[],
  '같은 날짜에 modern 과목 상세가 있으면 legacy 과목 대신 modern 상세를 사용한다'
);

create temporary table dashboard_conflict_runtime (
  name text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update on dashboard_conflict_runtime to authenticated;

create temporary table dashboard_conflict_notification_baseline (
  ops_task_events bigint not null,
  canonical_events bigint not null,
  fanout_jobs bigint not null,
  deliveries bigint not null
) on commit drop;
insert into dashboard_conflict_notification_baseline
select
  (select count(*) from public.ops_task_events),
  (select count(*) from dashboard_private.notification_events),
  (select count(*) from dashboard_private.notification_event_fanout_jobs),
  (select count(*) from dashboard_private.notification_deliveries);

create temporary table dashboard_conflict_source (payload jsonb not null) on commit drop;
insert into dashboard_conflict_source(payload)
values (jsonb_build_object(
  'type', 'teacher',
  'occurrenceKind', 'weekly',
  'classIds', jsonb_build_array(
    '85000000-0000-4000-8000-000000000302',
    '85000000-0000-4000-8000-000000000301'
  ),
  'studentIds', '[]'::jsonb,
  'examEventIds', '[]'::jsonb,
  'examDetailIds', '[]'::jsonb,
  'teacherCatalogIds', jsonb_build_array('85000000-0000-4000-8000-000000000101'),
  'classroomCatalogIds', '[]'::jsonb,
  'weekday', '월',
  'overlapStart', '09:30',
  'overlapEnd', '10:30',
  'examDate', '',
  'examRule', ''
));
grant select on dashboard_conflict_source to authenticated;

select pg_temp.dashboard_conflict_set_actor('85000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into dashboard_conflict_runtime(name, payload)
select 'created', public.create_dashboard_conflict_task_v1(
  source.payload,
  '85000000-0000-4000-8000-000000000401'
)
from dashboard_conflict_source source;
insert into dashboard_conflict_runtime(name, payload)
select 'replayed', public.create_dashboard_conflict_task_v1(
  source.payload,
  '85000000-0000-4000-8000-000000000401'
)
from dashboard_conflict_source source;
reset role;

select is(
  (select payload from dashboard_conflict_runtime where name = 'created'),
  (select payload from dashboard_conflict_runtime where name = 'replayed'),
  'same request ID replays the original response'
);
select ok(
  (select (payload ->> 'linked')::boolean and (payload ->> 'canOpen')::boolean
    and payload ->> 'taskId' <> '' and not (payload ->> 'alreadyExists')::boolean
   from dashboard_conflict_runtime where name = 'created'),
  'creator receives the visible newly linked task'
);
select is(
  (select count(*) from dashboard_private.dashboard_conflict_task_links
    where conflict_key = 'weekly:v1:teacher:월:09:30-10:30:85000000-0000-4000-8000-000000000301:85000000-0000-4000-8000-000000000302'),
  1::bigint,
  'one canonical conflict owns one durable link'
);

select ok(
  exists (
    select 1
    from public.ops_tasks task
    where task.id = (
      select (payload ->> 'taskId')::uuid
      from dashboard_conflict_runtime
      where name = 'created'
    )
      and task.assignee_id = '85000000-0000-4000-8000-000000000001'
      and task.assignee_team is null
      and task.title like '[일정 충돌]%'
      and task.memo like '%[문제] 충돌검증 관리자 선생님의 충돌검증 영어 A, 충돌검증 영어 B 수업 시간이 겹칩니다.%'
      and task.memo like '%[처리] 1. 담당 선생님이 두 수업을 확인%'
  ),
  'created task preserves exact teacher, classes, linked owner, and resolution details'
);

select pg_temp.dashboard_conflict_set_actor('85000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.create_dashboard_conflict_task_v1(
    jsonb_set((select payload from dashboard_conflict_source), '{overlapEnd}', '"10:00"'::jsonb),
    '85000000-0000-4000-8000-000000000405'
  )$$,
  '40001',
  'dashboard_conflict_stale',
  'an arbitrary subrange of the genuine overlap is rejected'
);
reset role;

select pg_temp.dashboard_conflict_set_actor('85000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into dashboard_conflict_runtime(name, payload)
values (
  'exam-same-day',
  public.create_dashboard_conflict_task_v1(
    pg_temp.dashboard_exam_conflict(
      'same-day-subject', current_date + 4,
      '85000000-0000-4000-8000-000000000201',
      array['85000000-0000-4000-8000-000000000511'::uuid]
    ),
    '85000000-0000-4000-8000-000000000420'
  )
);
select throws_ok(
  $$select public.create_dashboard_conflict_task_v1(
    pg_temp.dashboard_exam_conflict(
      'day-before-other-subject', current_date + 5,
      '85000000-0000-4000-8000-000000000201',
      array[
        '85000000-0000-4000-8000-000000000512'::uuid,
        '85000000-0000-4000-8000-000000000513'::uuid
      ]
    ),
    '85000000-0000-4000-8000-000000000421'
  )$$,
  '40001',
  'dashboard_conflict_stale',
  'mixed next-day subjects including the class subject allow the previous-day class'
);
insert into dashboard_conflict_runtime(name, payload)
values (
  'exam-day-before-other',
  public.create_dashboard_conflict_task_v1(
    pg_temp.dashboard_exam_conflict(
      'day-before-other-subject', current_date + 6,
      '85000000-0000-4000-8000-000000000201',
      array['85000000-0000-4000-8000-000000000514'::uuid]
    ),
    '85000000-0000-4000-8000-000000000422'
  )
);
select throws_ok(
  $$select public.create_dashboard_conflict_task_v1(
    pg_temp.dashboard_exam_conflict(
      'day-before-other-subject', current_date,
      '85000000-0000-4000-8000-000000000201',
      array[]::uuid[]
    ),
    '85000000-0000-4000-8000-000000000423'
  )$$,
  '40001',
  'dashboard_conflict_stale',
  'past previous-day session is rejected even when the exam date is today'
);
select throws_ok(
  $$select public.create_dashboard_conflict_task_v1(
    pg_temp.dashboard_exam_conflict(
      'same-day-subject', current_date + 4,
      '85000000-0000-4000-8000-000000000202',
      array['85000000-0000-4000-8000-000000000511'::uuid]
    ),
    '85000000-0000-4000-8000-000000000424'
  )$$,
  '40001',
  'dashboard_conflict_stale',
  'waitlist-only student cannot prove an exam conflict'
);
reset role;

select ok(
  exists (
    select 1
    from public.ops_tasks task
    where task.id = (
      select (payload ->> 'taskId')::uuid
      from dashboard_conflict_runtime
      where name = 'exam-same-day'
    )
      and task.assignee_id = '85000000-0000-4000-8000-000000000001'
      and task.assignee_team is null
      and task.subject = '영어'
      and task.campus = '본관'
      and task.due_at = ((current_date + 3)::timestamp + time '18:00') at time zone 'Asia/Seoul'
      and task.memo like '%영어 시험일에 수업이 배치되어 있습니다. 영향 학생: 시험충돌 등록학생%'
  ),
  'same-day exam task persists subject, campus, linked owner, due time, exam subject, and student'
);
select ok(
  exists (
    select 1
    from public.ops_tasks task
    where task.id = (
      select (payload ->> 'taskId')::uuid
      from dashboard_conflict_runtime
      where name = 'exam-day-before-other'
    )
      and task.due_at = ((current_date + 4)::timestamp + time '18:00') at time zone 'Asia/Seoul'
      and task.memo like '%수학 시험 전날에 수업이 배치되어 있습니다. 영향 학생: 시험충돌 등록학생%'
  ),
  'all-other-subject next day produces the actionable previous-day conflict task'
);

select pg_temp.dashboard_conflict_set_actor('85000000-0000-4000-8000-000000000002');
set local role authenticated;
insert into dashboard_conflict_runtime(name, payload)
select 'viewer-list', public.list_dashboard_conflict_task_links_v1(jsonb_build_array(source.payload))
from dashboard_conflict_source source;
select throws_ok(
  $$select public.create_dashboard_conflict_task_v1(
    (select payload from dashboard_conflict_source),
    '85000000-0000-4000-8000-000000000402'
  )$$,
  '42501',
  'dashboard_conflict_access_denied',
  'viewer cannot create a conflict task'
);
reset role;

select ok(
  (select payload #>> '{0,taskId}' = ''
    and not (payload #>> '{0,canOpen}')::boolean
    and (payload #>> '{0,linked}')::boolean
   from dashboard_conflict_runtime where name = 'viewer-list'),
  'linked state remains visible without leaking a hidden task ID'
);

update public.classes
set schedule = '화 09:30-10:30'
where id = '85000000-0000-4000-8000-000000000302';

select pg_temp.dashboard_conflict_set_actor('85000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into dashboard_conflict_runtime(name, payload)
select 'replay-after-source-change', public.create_dashboard_conflict_task_v1(
  source.payload,
  '85000000-0000-4000-8000-000000000401'
)
from dashboard_conflict_source source;
select throws_ok(
  $$select public.create_dashboard_conflict_task_v1(
    (select payload from dashboard_conflict_source),
    '85000000-0000-4000-8000-000000000403'
  )$$,
  '40001',
  'dashboard_conflict_stale',
  'a new request rejects a disappeared source conflict'
);
select throws_ok(
  $$select public.create_dashboard_conflict_task_v1(
    jsonb_set((select payload from dashboard_conflict_source), '{overlapEnd}', '"10:00"'::jsonb),
    '85000000-0000-4000-8000-000000000401'
  )$$,
  '22023',
  'idempotency_key_reused',
  'same request ID cannot be reused for a different fingerprint'
);
reset role;

select is(
  (select payload from dashboard_conflict_runtime where name = 'created'),
  (select payload from dashboard_conflict_runtime where name = 'replay-after-source-change'),
  'completed replay precedes source revalidation'
);

update public.classes
set schedule = '월 09:30-10:30'
where id = '85000000-0000-4000-8000-000000000302';

select pg_temp.dashboard_conflict_set_actor('85000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into dashboard_conflict_runtime(name, payload)
select 'existing-new-request', public.create_dashboard_conflict_task_v1(
  source.payload,
  '85000000-0000-4000-8000-000000000404'
)
from dashboard_conflict_source source;
reset role;

select ok(
  (select (payload ->> 'linked')::boolean
    and (payload ->> 'alreadyExists')::boolean
   from dashboard_conflict_runtime where name = 'existing-new-request'),
  'a new request for the same live conflict returns the original link'
);

select throws_ok(
  format(
    'delete from public.ops_tasks where id = %L',
    (select payload ->> 'taskId' from dashboard_conflict_runtime where name = 'created')
  ),
  '42501',
  'dashboard_conflict_task_delete_forbidden',
  'linked tasks cannot be deleted'
);

select ok(
  (select count(*) from public.ops_task_events) = (select ops_task_events from dashboard_conflict_notification_baseline)
  and (select count(*) from dashboard_private.notification_events) = (select canonical_events from dashboard_conflict_notification_baseline)
  and (select count(*) from dashboard_private.notification_event_fanout_jobs) = (select fanout_jobs from dashboard_conflict_notification_baseline)
  and (select count(*) from dashboard_private.notification_deliveries) = (select deliveries from dashboard_conflict_notification_baseline),
  'conflict task creation produces zero notification source, canonical event, fanout job, and delivery rows'
);

select * from finish();
rollback;
