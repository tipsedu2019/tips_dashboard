begin;

select plan(36);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local role postgres;

select ok(
  pg_catalog.to_regprocedure(
    'public.set_registration_admission_checklist_item_v1(uuid,text,boolean,text)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'dashboard_private.finalize_registration_track_enrollments_v1(uuid,uuid)'
  ) is not null
  and (
    select pg_catalog.pg_get_triggerdef(trigger.oid) like
      '%BEFORE UPDATE OF pipeline_status, counselor, makeedu_registered, makeedu_invoice_sent, payment_checked%'
      and pg_catalog.pg_get_triggerdef(trigger.oid) not like '%admission_checklist%'
    from pg_catalog.pg_trigger trigger
    where trigger.tgrelid = 'public.ops_registration_details'::pg_catalog.regclass
      and trigger.tgname = 'prevent_registration_compatibility_override'
      and not trigger.tgisinternal
  ),
  'checklist and registered-roster functions keep exact signatures'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.set_registration_admission_checklist_item_v1(uuid,text,boolean,text)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.set_registration_admission_checklist_item_v1(uuid,text,boolean,text)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.set_registration_admission_checklist_item_v1(uuid,text,boolean,text)',
    'execute'
  ),
  'only authenticated operators can execute the checklist RPC'
);

select ok(
  (
    select procedure.prosecdef is false
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] in ('search_path=', 'search_path=""')
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'public.set_registration_admission_checklist_item_v1(uuid,text,boolean,text)'::pg_catalog.regprocedure
  ),
  'public checklist wrapper is security invoker with an empty search path'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-00000000b101',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admission-checklist-admin@example.invalid',
    crypt('admission-checklist-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-admission-checklist-roster"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    '00000000-0000-4000-8000-00000000b102',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admission-checklist-teacher@example.invalid',
    crypt('admission-checklist-runtime-only', gen_salt('bf')),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-admission-checklist-roster"}'::jsonb,
    pg_catalog.now(),
    pg_catalog.now()
  );

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000b101',
    'role', 'authenticated',
    'email', 'admission-checklist-admin@example.invalid'
  )::text,
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-00000000b101',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '00000000-0000-4000-8000-00000000b101',
    'admin',
    '입학 체크 관리자',
    'admission-checklist-admin@example.invalid',
    pg_catalog.now(),
    pg_catalog.now()
  ),
  (
    '00000000-0000-4000-8000-00000000b102',
    'teacher',
    '입학 체크 교사',
    'admission-checklist-teacher@example.invalid',
    pg_catalog.now(),
    pg_catalog.now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

update public.profiles
set teacher_catalog_id = null,
    updated_at = pg_catalog.now()
where id in (
  '00000000-0000-4000-8000-00000000b101',
  '00000000-0000-4000-8000-00000000b102'
);
delete from public.teacher_catalogs
where profile_id in (
  '00000000-0000-4000-8000-00000000b101',
  '00000000-0000-4000-8000-00000000b102'
);
insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order,
  profile_id, account_email, dashboard_role
)
values (
  '00000000-0000-4000-8000-00000000b103',
  '입학 체크 교사',
  array['영어', '수학'],
  true,
  9801,
  '00000000-0000-4000-8000-00000000b102',
  'admission-checklist-teacher@example.invalid',
  'teacher'
);
update public.profiles
set teacher_catalog_id = '00000000-0000-4000-8000-00000000b103',
    updated_at = pg_catalog.now()
where id = '00000000-0000-4000-8000-00000000b102';

insert into public.students(
  id, name, grade, school, contact, parent_contact, status,
  class_ids, waitlist_class_ids
)
values
  (
    '00000000-0000-4000-8000-00000000b201',
    '입학체크학생',
    '중3',
    '입학중',
    '01000001201',
    '01000002201',
    '재원',
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000b202',
    '배치격리학생',
    '중3',
    '입학중',
    '01000001202',
    '01000002202',
    '재원',
    '[]'::jsonb,
    '[]'::jsonb
  );

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_storage_mode, schedule_plan
)
values
  (
    '00000000-0000-4000-8000-00000000b301',
    '입학 체크 영어반',
    '정규',
    '영어',
    '중3',
    '입학 체크 교사',
    '화 18:00',
    '본관',
    11,
    100000,
    '수업 진행 중',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'legacy',
    '{"sessions":[{"date":"2026-09-01","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000b305',
    '입학 체크 수학반',
    '정규',
    '수학',
    '중3',
    '입학 체크 교사',
    '수 18:00-20:00',
    '본관',
    11,
    100000,
    '수업 진행 중',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'legacy',
    '{"sessions":[{"date":"2026-09-02","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
  );

select pg_catalog.set_config('app.class_schedule_mutation', 'release2-rpc', true);
insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state,
  start_time, end_time, teacher_catalog_id, teacher_name_snapshot,
  classroom_name_snapshot, origin, revision
)
values
  (
    '00000000-0000-4000-8000-00000000b302',
    '00000000-0000-4000-8000-00000000b301',
    '2026-09-01:1',
    '2026-09-01',
    'active',
    '18:00',
    '20:00',
    '00000000-0000-4000-8000-00000000b103',
    '입학 체크 교사',
    '본관',
    'manual',
    1
  ),
  (
    '00000000-0000-4000-8000-00000000b306',
    '00000000-0000-4000-8000-00000000b305',
    '2026-09-02:1',
    '2026-09-02',
    'active',
    '18:00',
    '20:00',
    '00000000-0000-4000-8000-00000000b103',
    '입학 체크 교사',
    '본관',
    'manual',
    1
  );
select pg_catalog.set_config('app.class_schedule_mutation', '', true);

insert into public.ops_tasks(
  id, title, type, status, requested_by, student_id,
  student_name, subject, priority
)
values
  (
    '00000000-0000-4000-8000-00000000b401',
    '입학 체크 및 명단 일치',
    'registration',
    'requested',
    '00000000-0000-4000-8000-00000000b101',
    '00000000-0000-4000-8000-00000000b201',
    '입학체크학생',
    '영어',
    'normal'
  ),
  (
    '00000000-0000-4000-8000-00000000b411',
    '과목별 입학 배치 격리',
    'registration',
    'requested',
    '00000000-0000-4000-8000-00000000b101',
    '00000000-0000-4000-8000-00000000b202',
    '배치격리학생',
    '영어, 수학',
    'normal'
  );

insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name,
  parent_phone, student_phone, common_revision
)
values
  (
    '00000000-0000-4000-8000-00000000b401',
    '2026-08-26 09:00+09',
    '중3',
    '입학중',
    '01000002201',
    '01000001201',
    1
  ),
  (
    '00000000-0000-4000-8000-00000000b411',
    '2026-08-26 09:10+09',
    '중3',
    '입학중',
    '01000002202',
    '01000001202',
    1
  );

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status,
  director_profile_id, director_assignment_source, director_assigned_at,
  migration_review_required, workflow_status, workflow_revision,
  workflow_status_entered_at
)
values
  (
    '00000000-0000-4000-8000-00000000b402',
    '00000000-0000-4000-8000-00000000b401',
    '영어',
    'enrollment_processing',
    '00000000-0000-4000-8000-00000000b101',
    'manual',
    pg_catalog.now(),
    false,
    'payment_in_progress',
    1,
    pg_catalog.now()
  ),
  (
    '00000000-0000-4000-8000-00000000b412',
    '00000000-0000-4000-8000-00000000b411',
    '영어',
    'enrollment_processing',
    '00000000-0000-4000-8000-00000000b101',
    'manual',
    pg_catalog.now(),
    false,
    'payment_in_progress',
    1,
    pg_catalog.now()
  ),
  (
    '00000000-0000-4000-8000-00000000b405',
    '00000000-0000-4000-8000-00000000b411',
    '수학',
    'enrollment_processing',
    '00000000-0000-4000-8000-00000000b101',
    'manual',
    pg_catalog.now(),
    false,
    'payment_in_progress',
    1,
    pg_catalog.now()
  );

insert into public.ops_registration_admission_batches(
  id, task_id, revision_number, status
)
values
  (
    '00000000-0000-4000-8000-00000000b403',
    '00000000-0000-4000-8000-00000000b401',
    1,
    'draft'
  ),
  (
    '00000000-0000-4000-8000-00000000b413',
    '00000000-0000-4000-8000-00000000b411',
    1,
    'draft'
  );

alter table public.ops_registration_enrollments
  disable trigger ops_registration_enrollments_sync_lesson_session;
insert into public.ops_registration_enrollments(
  id, track_id, student_id, admission_batch_id, class_id,
  class_start_date, class_start_session_key, class_start_session,
  class_start_lesson_session_id, status, makeedu_registered,
  roster_active, sort_order
)
values
  (
    '00000000-0000-4000-8000-00000000b404',
    '00000000-0000-4000-8000-00000000b402',
    '00000000-0000-4000-8000-00000000b201',
    '00000000-0000-4000-8000-00000000b403',
    '00000000-0000-4000-8000-00000000b301',
    '2026-09-01',
    '2026-09-01:1',
    '1회차',
    '00000000-0000-4000-8000-00000000b302',
    'planned',
    false,
    true,
    0
  ),
  (
    '00000000-0000-4000-8000-00000000b414',
    '00000000-0000-4000-8000-00000000b412',
    '00000000-0000-4000-8000-00000000b202',
    '00000000-0000-4000-8000-00000000b413',
    '00000000-0000-4000-8000-00000000b301',
    '2026-09-01',
    '2026-09-01:1',
    '1회차',
    '00000000-0000-4000-8000-00000000b302',
    'planned',
    false,
    true,
    0
  ),
  (
    '00000000-0000-4000-8000-00000000b406',
    '00000000-0000-4000-8000-00000000b405',
    null,
    null,
    '00000000-0000-4000-8000-00000000b305',
    '2026-09-02',
    '2026-09-02:1',
    '1회차',
    null,
    'planned',
    false,
    false,
    0
  );
alter table public.ops_registration_enrollments
  enable trigger ops_registration_enrollments_sync_lesson_session;

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000b101',
    'role', 'authenticated',
    'email', 'admission-checklist-admin@example.invalid'
  )::text,
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-00000000b101',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  (
    select detail.admission_checklist =
      '{"applicationSent":false,"makeeduRegistered":false,"invoiceSent":false,"paymentConfirmed":false,"registrationCompleted":false}'::jsonb
    from public.ops_registration_details detail
    where detail.task_id = '00000000-0000-4000-8000-00000000b401'
  ),
  'all five manual checklist values default to false'
);

create temporary table registration_admission_before on commit drop as
select
  (select pg_catalog.count(*) from public.ops_registration_messages) as message_count,
  (select pg_catalog.count(*) from dashboard_private.notification_deliveries) as delivery_count,
  (select pg_catalog.count(*) from public.ops_task_events where task_id = '00000000-0000-4000-8000-00000000b401') as event_count,
  (select pg_catalog.to_jsonb(task) from public.ops_tasks task where task.id = '00000000-0000-4000-8000-00000000b401') as task_row,
  (select pg_catalog.to_jsonb(track) from public.ops_registration_subject_tracks track where track.id = '00000000-0000-4000-8000-00000000b402') as track_row,
  (
    select pg_catalog.to_jsonb(detail) - 'admission_checklist' - 'updated_at'
    from public.ops_registration_details detail
    where detail.task_id = '00000000-0000-4000-8000-00000000b401'
  ) as protected_detail_row,
  (select enrollment.status from public.ops_registration_enrollments enrollment where enrollment.id = '00000000-0000-4000-8000-00000000b404') as enrollment_status,
  (select track.workflow_status from public.ops_registration_subject_tracks track where track.id = '00000000-0000-4000-8000-00000000b402') as workflow_status;

select isnt(
  (
    select detail.pipeline_status
    from public.ops_registration_details detail
    where detail.task_id = '00000000-0000-4000-8000-00000000b401'
  ),
  dashboard_private.derive_registration_parent_projection(
    '00000000-0000-4000-8000-00000000b401'
  ) ->> 'pipelineStatus',
  'fixture starts with a deliberately stale legacy parent projection'
);

set local role authenticated;
create temporary table registration_admission_check_result on commit drop as
select public.set_registration_admission_checklist_item_v1(
  '00000000-0000-4000-8000-00000000b401',
  'registrationCompleted',
  true,
  'admission-checklist-last-first'
) as payload;
set local role postgres;

select ok(
  (
    select (result.payload #>> '{checklist,registrationCompleted}')::boolean
    from registration_admission_check_result result
  ),
  'registrationCompleted can be checked first'
);

select ok(
  (
    select detail.admission_checklist =
      '{"applicationSent":false,"makeeduRegistered":false,"invoiceSent":false,"paymentConfirmed":false,"registrationCompleted":true}'::jsonb
    from public.ops_registration_details detail
    where detail.task_id = '00000000-0000-4000-8000-00000000b401'
  ),
  'checking the last item changes no earlier checklist item'
);

set local role authenticated;
select lives_ok(
  $$select public.set_registration_admission_checklist_item_v1(
    '00000000-0000-4000-8000-00000000b401',
    'registrationCompleted',
    true,
    'admission-checklist-last-first'
  )$$,
  'the same checklist request is idempotent'
);

select throws_ok(
  $$select public.set_registration_admission_checklist_item_v1(
    '00000000-0000-4000-8000-00000000b401',
    'registrationCompleted',
    false,
    'admission-checklist-last-first'
  )$$,
  '22023',
  'idempotency_key_reused',
  'a request key cannot be reused for another checklist value'
);

select throws_ok(
  $$select public.set_registration_admission_checklist_item_v1(
    '00000000-0000-4000-8000-00000000b401',
    'unknownItem',
    true,
    'admission-checklist-unknown'
  )$$,
  '22023',
  'registration_admission_checklist_item_invalid',
  'unknown checklist keys are rejected without dependency logic'
);
set local role postgres;

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000b102',
    'role', 'authenticated',
    'email', 'admission-checklist-teacher@example.invalid'
  )::text,
  true
);
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b102', true);
set local role authenticated;
select throws_ok(
  $$select public.set_registration_admission_checklist_item_v1(
    '00000000-0000-4000-8000-00000000b401',
    'applicationSent',
    true,
    'admission-checklist-teacher-denied'
  )$$,
  '42501',
  'registration_access_denied',
  'a teacher cannot mutate the admission checklist'
);
set local role postgres;
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000b101',
    'role', 'authenticated',
    'email', 'admission-checklist-admin@example.invalid'
  )::text,
  true
);
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b101', true);

select throws_ok(
  $$update public.ops_registration_details
    set pipeline_status = '9. 문의만'
    where task_id = '00000000-0000-4000-8000-00000000b401'$$,
  '23514',
  'registration_compatibility_override_denied',
  'direct legacy compatibility overrides remain rejected'
);

select ok(
  (
    select before.enrollment_status = 'planned'
      and before.workflow_status = 'payment_in_progress'
      and before.message_count = (select pg_catalog.count(*) from public.ops_registration_messages)
      and before.delivery_count = (select pg_catalog.count(*) from dashboard_private.notification_deliveries)
      and before.event_count = (
        select pg_catalog.count(*)
        from public.ops_task_events event
        where event.task_id = '00000000-0000-4000-8000-00000000b401'
      )
      and before.task_row = (
        select pg_catalog.to_jsonb(task)
        from public.ops_tasks task
        where task.id = '00000000-0000-4000-8000-00000000b401'
      )
      and before.track_row = (
        select pg_catalog.to_jsonb(track)
        from public.ops_registration_subject_tracks track
        where track.id = '00000000-0000-4000-8000-00000000b402'
      )
      and before.protected_detail_row = (
        select pg_catalog.to_jsonb(detail) - 'admission_checklist' - 'updated_at'
        from public.ops_registration_details detail
        where detail.task_id = '00000000-0000-4000-8000-00000000b401'
      )
      and (
        select detail.pipeline_status
        from public.ops_registration_details detail
        where detail.task_id = '00000000-0000-4000-8000-00000000b401'
      ) is distinct from (
        dashboard_private.derive_registration_parent_projection(
          '00000000-0000-4000-8000-00000000b401'
        ) ->> 'pipelineStatus'
      )
    from registration_admission_before before
  ),
  'checklist writes do not mutate workflow, enrollment, messages, or deliveries'
);

create temporary table registration_admission_management_before on commit drop as
select
  (
    select (page.row_data ->> 'studentCount')::integer
    from public.list_management_page_v1(
      'classes',
      pg_catalog.jsonb_build_object(
        'kind', 'classes', 'search', '입학 체크 영어반',
        'status', null, 'subject', null, 'grade', null,
        'teacher', null, 'classroom', null, 'periodId', null
      ),
      null,
      null,
      30
    ) page
    where page.id = '00000000-0000-4000-8000-00000000b301'
  ) as class_count,
  pg_catalog.jsonb_array_length(
    public.list_management_detail_relation_page_v1(
      'students',
      '00000000-0000-4000-8000-00000000b201',
      'enrollments'
    ) #> '{page,rows}'
  ) as student_class_count,
  pg_catalog.jsonb_array_length(
    public.list_management_detail_relation_page_v1(
      'classes',
      '00000000-0000-4000-8000-00000000b301',
      'registered_students'
    ) #> '{page,rows}'
  ) as class_student_count;

select ok(
  (
    select before.class_count = 0
      and before.student_class_count = 0
      and before.class_student_count = 0
    from registration_admission_management_before before
  ),
  'a planned capacity claim is not exposed as completed enrollment'
);

create or replace function pg_temp.registration_admission_status_side_effect_snapshot(
  p_task_id uuid,
  p_track_id uuid,
  p_student_id uuid,
  p_class_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'task', (
      select pg_catalog.to_jsonb(task)
      from public.ops_tasks task
      where task.id = p_task_id
    ),
    'detail', (
      select pg_catalog.to_jsonb(detail)
      from public.ops_registration_details detail
      where detail.task_id = p_task_id
    ),
    'nonStatusTrack', (
      select pg_catalog.to_jsonb(track)
        - 'workflow_status'
        - 'workflow_revision'
        - 'workflow_status_entered_at'
        - 'updated_at'
      from public.ops_registration_subject_tracks track
      where track.id = p_track_id
    ),
    'batches', (
      select coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(batch) order by batch.id),
        '[]'::jsonb
      )
      from public.ops_registration_admission_batches batch
      where batch.task_id = p_task_id
    ),
    'enrollments', (
      select coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(enrollment) order by enrollment.id),
        '[]'::jsonb
      )
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = p_track_id
    ),
    'studentClassIds', (
      select coalesce(student.class_ids, '[]'::jsonb)
      from public.students student
      where student.id = p_student_id
    ),
    'studentWaitlistIds', (
      select coalesce(student.waitlist_class_ids, '[]'::jsonb)
      from public.students student
      where student.id = p_student_id
    ),
    'classStudentIds', (
      select coalesce(pg_catalog.to_jsonb(class.student_ids), '[]'::jsonb)
      from public.classes class
      where class.id = p_class_id
    ),
    'classWaitlistIds', (
      select coalesce(pg_catalog.to_jsonb(class.waitlist_ids), '[]'::jsonb)
      from public.classes class
      where class.id = p_class_id
    ),
    'historyCount', (
      select pg_catalog.count(*)
      from public.student_class_enrollment_history history
      where history.student_id = p_student_id
        and history.class_id = p_class_id
    ),
    'messages', (select pg_catalog.count(*) from public.ops_registration_messages),
    'canonical', (select pg_catalog.count(*) from dashboard_private.notification_events),
    'fanout', (select pg_catalog.count(*) from dashboard_private.notification_event_fanout_jobs),
    'deliveries', (select pg_catalog.count(*) from dashboard_private.notification_deliveries)
  );
$$;

create temporary table registration_isolated_status_before on commit drop as
select pg_temp.registration_admission_status_side_effect_snapshot(
  '00000000-0000-4000-8000-00000000b411',
  '00000000-0000-4000-8000-00000000b405',
  '00000000-0000-4000-8000-00000000b202',
  '00000000-0000-4000-8000-00000000b305'
) as state;

set local role authenticated;
create temporary table registration_isolated_batch_result on commit drop as
select public.set_registration_workflow_status_v1(
  '00000000-0000-4000-8000-00000000b405',
  'registered',
  1,
  'admission-register-isolated-unbatched-subject'
) as payload;
set local role postgres;

select ok(
  (
    select result.payload ->> 'workflowStatus' = 'registered'
      and (result.payload ->> 'workflowRevision')::integer = 2
      and result.payload ? 'enrollmentFinalization'
      and result.payload -> 'enrollmentFinalization' = 'null'::jsonb
      and before.state = pg_temp.registration_admission_status_side_effect_snapshot(
        '00000000-0000-4000-8000-00000000b411',
        '00000000-0000-4000-8000-00000000b405',
        '00000000-0000-4000-8000-00000000b202',
        '00000000-0000-4000-8000-00000000b305'
      )
    from registration_isolated_batch_result result
    cross join registration_isolated_status_before before
  ),
  'status changes only the manual status and revision without finalization side effects'
);

create temporary table registration_isolated_finalization_result on commit drop as
select dashboard_private.finalize_registration_track_enrollments_v1(
  '00000000-0000-4000-8000-00000000b405',
  '00000000-0000-4000-8000-00000000b101'
) as payload;

select ok(
  (
    select nullif(result.payload ->> 'batchId', '') is not null
      and result.payload ->> 'batchId' <>
        '00000000-0000-4000-8000-00000000b413'
      and exists (
        select 1
        from public.ops_registration_admission_batches batch
        where batch.id = (result.payload ->> 'batchId')::uuid
          and batch.task_id = '00000000-0000-4000-8000-00000000b411'
          and batch.revision_number = 2
          and batch.status = 'completed'
          and batch.invoice_sent_at is null
          and batch.payment_confirmed_at is null
      )
    from registration_isolated_finalization_result result
  ),
  'the explicit finalizer gives an unbatched subject its own terminal compatibility batch'
);

select ok(
  (
    select pg_catalog.count(*) = 1
    from dashboard_private.registration_first_consultation_task_links link
    join public.ops_tasks task on task.id = link.task_id
    where link.enrollment_id = '00000000-0000-4000-8000-00000000b406'
      and link.class_lesson_session_id is null
      and task.assignee_id = '00000000-0000-4000-8000-00000000b102'
      and task.student_id = '00000000-0000-4000-8000-00000000b202'
      and task.class_id = '00000000-0000-4000-8000-00000000b305'
      and task.start_at = '2026-09-02 20:00+09'::timestamptz
      and task.due_at = '2026-09-03 20:00+09'::timestamptz
  )
  and (
    select pg_catalog.count(*) = 1
    from public.ops_tasks task
    where task.student_id = '00000000-0000-4000-8000-00000000b202'
      and task.class_id = '00000000-0000-4000-8000-00000000b305'
      and task.title like '신규 등록 학부모 첫 상담 · %'
  ),
  'a legacy enrollment creates one first-consultation task from its effective class slot'
);

update public.ops_registration_enrollments
set status = 'canceled',
    roster_active = false
where id = '00000000-0000-4000-8000-00000000b406';

create temporary table registration_legacy_failure_before on commit drop as
select
  pg_catalog.to_jsonb(enrollment) as enrollment_row,
  link.task_id,
  pg_catalog.to_jsonb(task) as task_row,
  coalesce(student.class_ids, '[]'::jsonb) as student_class_ids,
  coalesce(pg_catalog.to_jsonb(class.student_ids), '[]'::jsonb) as class_student_ids,
  (
    select pg_catalog.count(*)
    from dashboard_private.registration_first_consultation_task_links all_links
    where all_links.enrollment_id = enrollment.id
  ) as link_count,
  (
    select pg_catalog.count(*)
    from public.ops_tasks matching_task
    where matching_task.student_id = enrollment.student_id
      and matching_task.class_id = enrollment.class_id
      and matching_task.title like '신규 등록 학부모 첫 상담 · %'
  ) as task_count,
  (select pg_catalog.count(*) from public.ops_registration_messages) as message_count,
  (select pg_catalog.count(*) from dashboard_private.notification_deliveries) as delivery_count
from public.ops_registration_enrollments enrollment
join dashboard_private.registration_first_consultation_task_links link
  on link.enrollment_id = enrollment.id
join public.ops_tasks task on task.id = link.task_id
join public.students student on student.id = enrollment.student_id
join public.classes class on class.id = enrollment.class_id
where enrollment.id = '00000000-0000-4000-8000-00000000b406';

update public.classes
set schedule = E'수 18:00-20:00\n수 20:00-22:00'
where id = '00000000-0000-4000-8000-00000000b305';

select throws_ok(
  $$update public.ops_registration_enrollments
    set status = 'enrolled',
        roster_active = true
    where id = '00000000-0000-4000-8000-00000000b406'$$,
  '55000',
  'registration_first_consultation_assignee_required',
  'ambiguous legacy weekday slots fail closed with the exact operational SQLSTATE'
);

select ok(
  (
    select before.enrollment_row = (
        select pg_catalog.to_jsonb(enrollment)
        from public.ops_registration_enrollments enrollment
        where enrollment.id = '00000000-0000-4000-8000-00000000b406'
      )
      and before.task_row = (
        select pg_catalog.to_jsonb(task)
        from public.ops_tasks task
        where task.id = before.task_id
      )
      and before.task_id = (
        select link.task_id
        from dashboard_private.registration_first_consultation_task_links link
        where link.enrollment_id = '00000000-0000-4000-8000-00000000b406'
      )
      and before.link_count = (
        select pg_catalog.count(*)
        from dashboard_private.registration_first_consultation_task_links link
        where link.enrollment_id = '00000000-0000-4000-8000-00000000b406'
      )
      and before.task_count = (
        select pg_catalog.count(*)
        from public.ops_tasks task
        where task.student_id = '00000000-0000-4000-8000-00000000b202'
          and task.class_id = '00000000-0000-4000-8000-00000000b305'
          and task.title like '신규 등록 학부모 첫 상담 · %'
      )
      and before.student_class_ids = (
        select coalesce(student.class_ids, '[]'::jsonb)
        from public.students student
        where student.id = '00000000-0000-4000-8000-00000000b202'
      )
      and before.class_student_ids = (
        select coalesce(pg_catalog.to_jsonb(class.student_ids), '[]'::jsonb)
        from public.classes class
        where class.id = '00000000-0000-4000-8000-00000000b305'
      )
      and before.message_count = (
        select pg_catalog.count(*) from public.ops_registration_messages
      )
      and before.delivery_count = (
        select pg_catalog.count(*) from dashboard_private.notification_deliveries
      )
    from registration_legacy_failure_before before
  ),
  'ambiguous legacy finalization rolls back enrollment, rosters, task, link, and delivery state atomically'
);

update public.classes
set schedule = '수 18:00-20:00'
where id = '00000000-0000-4000-8000-00000000b305';

update public.ops_registration_enrollments
set status = 'enrolled',
    roster_active = true
where id = '00000000-0000-4000-8000-00000000b406';

select ok(
  (
    select pg_catalog.count(*) = 1
    from public.ops_tasks task
    where task.student_id = '00000000-0000-4000-8000-00000000b202'
      and task.class_id = '00000000-0000-4000-8000-00000000b305'
      and task.title like '신규 등록 학부모 첫 상담 · %'
  )
  and exists (
    select 1
    from registration_legacy_failure_before before
    join dashboard_private.registration_first_consultation_task_links link
      on link.task_id = before.task_id
    join public.ops_tasks task on task.id = link.task_id
    where link.enrollment_id = '00000000-0000-4000-8000-00000000b406'
      and link.class_lesson_session_id is null
      and task.status = 'requested'
      and task.completed_at is null
  ),
  'legacy reenrollment reactivates its one linked consultation task without an orphan'
);

select ok(
  (
    select batch.status = 'draft'
    from public.ops_registration_admission_batches batch
    where batch.id = '00000000-0000-4000-8000-00000000b413'
  )
  and (
    select enrollment.status = 'planned'
      and enrollment.admission_batch_id = '00000000-0000-4000-8000-00000000b413'
      and enrollment.student_id = '00000000-0000-4000-8000-00000000b202'
      and enrollment.roster_active
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '00000000-0000-4000-8000-00000000b414'
  )
  and (
    select math_track.pipeline_status = 'registered'
      and math_track.workflow_status = 'registered'
      and english_track.pipeline_status = 'enrollment_processing'
      and english_track.workflow_status = 'payment_in_progress'
    from public.ops_registration_subject_tracks math_track
    cross join public.ops_registration_subject_tracks english_track
    where math_track.id = '00000000-0000-4000-8000-00000000b405'
      and english_track.id = '00000000-0000-4000-8000-00000000b412'
  )
  and (
    select task.status = 'in_progress'
    from public.ops_tasks task
    where task.id = '00000000-0000-4000-8000-00000000b411'
  ),
  'the other subject batch, claim, workflow, and parent remain independent'
);

select ok(
  (
    select coalesce(student.class_ids, '[]'::jsonb) ? '00000000-0000-4000-8000-00000000b305'
      and not (coalesce(student.class_ids, '[]'::jsonb) ? '00000000-0000-4000-8000-00000000b301')
    from public.students student
    where student.id = '00000000-0000-4000-8000-00000000b202'
  )
  and (
    select coalesce(pg_catalog.to_jsonb(class.student_ids), '[]'::jsonb) ? '00000000-0000-4000-8000-00000000b202'
    from public.classes class
    where class.id = '00000000-0000-4000-8000-00000000b305'
  )
  and (
    select not (coalesce(pg_catalog.to_jsonb(class.student_ids), '[]'::jsonb) ? '00000000-0000-4000-8000-00000000b202')
    from public.classes class
    where class.id = '00000000-0000-4000-8000-00000000b301'
  ),
  'isolated status finalization updates only its own reciprocal roster pair'
);

insert into public.ops_registration_enrollments(
  id, track_id, class_id, status, roster_active, sort_order
)
values (
  '00000000-0000-4000-8000-00000000b407',
  '00000000-0000-4000-8000-00000000b402',
  '00000000-0000-4000-8000-00000000b305',
  'planned',
  false,
  1
);
select throws_ok(
  $$select dashboard_private.finalize_registration_track_enrollments_v1(
    '00000000-0000-4000-8000-00000000b402',
    '00000000-0000-4000-8000-00000000b101'
  )$$,
  '23514',
  'registration_admission_batch_membership_invariant',
  'the private finalizer rejects mixed batched and unbatched rows with exact SQLSTATE 23514'
);
delete from public.ops_registration_enrollments
where id = '00000000-0000-4000-8000-00000000b407';

update public.ops_registration_subject_tracks
set pipeline_status = 'inquiry'
where id = '00000000-0000-4000-8000-00000000b402';
select throws_ok(
  $$select dashboard_private.finalize_registration_track_enrollments_v1(
    '00000000-0000-4000-8000-00000000b402',
    '00000000-0000-4000-8000-00000000b101'
  )$$,
  '23514',
  'registration_enrollment_pipeline_invalid',
  'the private finalizer rejects a track outside the enrollment pipeline with exact SQLSTATE 23514'
);
update public.ops_registration_subject_tracks
set pipeline_status = 'enrollment_processing'
where id = '00000000-0000-4000-8000-00000000b402';

create temporary table registration_admission_status_before on commit drop as
select pg_temp.registration_admission_status_side_effect_snapshot(
  '00000000-0000-4000-8000-00000000b401',
  '00000000-0000-4000-8000-00000000b402',
  '00000000-0000-4000-8000-00000000b201',
  '00000000-0000-4000-8000-00000000b301'
) as state;

set local role authenticated;
create temporary table registration_admission_registered_result on commit drop as
select public.set_registration_workflow_status_v1(
  '00000000-0000-4000-8000-00000000b402',
  'registered',
  1,
  'admission-register-without-checklist-order'
) as payload;
set local role postgres;

select ok(
  (
    select result.payload ->> 'workflowStatus' = 'registered'
      and (result.payload ->> 'workflowRevision')::integer = 2
      and result.payload ? 'enrollmentFinalization'
      and result.payload -> 'enrollmentFinalization' = 'null'::jsonb
      and before.state = pg_temp.registration_admission_status_side_effect_snapshot(
        '00000000-0000-4000-8000-00000000b401',
        '00000000-0000-4000-8000-00000000b402',
        '00000000-0000-4000-8000-00000000b201',
        '00000000-0000-4000-8000-00000000b301'
      )
    from registration_admission_registered_result result
    cross join registration_admission_status_before before
  ),
  'registered status changes only status and revision and returns null enrollmentFinalization'
);

update dashboard_private.ops_registration_mutations mutation
set response_payload = mutation.response_payload || pg_catalog.jsonb_build_object(
  'enrollmentFinalization',
  pg_catalog.jsonb_build_object(
    'batchId', '00000000-0000-4000-8000-000000000bad'
  )
)
where mutation.actor_id = '00000000-0000-4000-8000-00000000b101'
  and mutation.request_key = 'admission-register-without-checklist-order'
  and mutation.task_id = '00000000-0000-4000-8000-00000000b401'
  and mutation.mutation_type = 'set_workflow_status';

set local role authenticated;
create temporary table registration_admission_legacy_status_replay on commit drop as
select public.set_registration_workflow_status_v1(
  '00000000-0000-4000-8000-00000000b402',
  'registered',
  1,
  'admission-register-without-checklist-order'
) as payload;
set local role postgres;

select is(
  (
    select result.payload -> 'enrollmentFinalization'
    from registration_admission_legacy_status_replay result
  ),
  'null'::jsonb,
  'status replay sanitizes a legacy enrollment finalization receipt'
);

select is(
  (
    select mutation.response_payload -> 'enrollmentFinalization'
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '00000000-0000-4000-8000-00000000b101'
      and mutation.request_key = 'admission-register-without-checklist-order'
      and mutation.task_id = '00000000-0000-4000-8000-00000000b401'
      and mutation.mutation_type = 'set_workflow_status'
  ),
  'null'::jsonb,
  'status replay permanently removes the legacy enrollment finalization payload'
);

create temporary table registration_admission_finalization_result on commit drop as
select dashboard_private.finalize_registration_track_enrollments_v1(
  '00000000-0000-4000-8000-00000000b402',
  '00000000-0000-4000-8000-00000000b101'
) as payload;

select ok(
  (
    select result.payload ->> 'trackId' = '00000000-0000-4000-8000-00000000b402'
      and result.payload ->> 'studentId' = '00000000-0000-4000-8000-00000000b201'
      and result.payload ->> 'batchId' = '00000000-0000-4000-8000-00000000b403'
      and result.payload -> 'enrollmentIds'
        = '["00000000-0000-4000-8000-00000000b404"]'::jsonb
    from registration_admission_finalization_result result
  ),
  'the explicit private finalizer returns the canonical enrollment receipt'
);

select ok(
  (
    select track.workflow_status = 'registered'
      and track.pipeline_status = 'registered'
      and track.workflow_revision = 2
    from public.ops_registration_subject_tracks track
    where track.id = '00000000-0000-4000-8000-00000000b402'
  ),
  'the explicit finalizer commits the canonical pipeline without changing the manual status revision'
);

select ok(
  (
    select enrollment.status = 'enrolled'
      and enrollment.roster_active
      and enrollment.student_id = '00000000-0000-4000-8000-00000000b201'
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '00000000-0000-4000-8000-00000000b404'
  ),
  'planned enrollment becomes a canonical active enrollment'
);

select ok(
  (
    select coalesce(student.class_ids, '[]'::jsonb) ? '00000000-0000-4000-8000-00000000b301'
      and not (coalesce(student.waitlist_class_ids, '[]'::jsonb) ? '00000000-0000-4000-8000-00000000b301')
    from public.students student
    where student.id = '00000000-0000-4000-8000-00000000b201'
  )
  and (
    select coalesce(pg_catalog.to_jsonb(class.student_ids), '[]'::jsonb) ? '00000000-0000-4000-8000-00000000b201'
      and not (coalesce(pg_catalog.to_jsonb(class.waitlist_ids), '[]'::jsonb) ? '00000000-0000-4000-8000-00000000b201')
    from public.classes class
    where class.id = '00000000-0000-4000-8000-00000000b301'
  ),
  'student class_ids and class student_ids are reciprocal'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.student_class_enrollment_history history
    where history.student_id = '00000000-0000-4000-8000-00000000b201'
      and history.class_id = '00000000-0000-4000-8000-00000000b301'
      and history.action = 'enrolled'
  ),
  1,
  'roster history records exactly one enrolled transition'
);

select ok(
  (
    select (page.row_data ->> 'studentCount')::integer = 1
    from public.list_management_page_v1(
      'classes',
      pg_catalog.jsonb_build_object(
        'kind', 'classes', 'search', '입학 체크 영어반',
        'status', null, 'subject', null, 'grade', null,
        'teacher', null, 'classroom', null, 'periodId', null
      ),
      null,
      null,
      30
    ) page
    where page.id = '00000000-0000-4000-8000-00000000b301'
  )
  and pg_catalog.jsonb_array_length(
    public.list_management_detail_relation_page_v1(
      'students',
      '00000000-0000-4000-8000-00000000b201',
      'enrollments'
    ) #> '{page,rows}'
  ) = 1
  and pg_catalog.jsonb_array_length(
    public.list_management_detail_relation_page_v1(
      'classes',
      '00000000-0000-4000-8000-00000000b301',
      'registered_students'
    ) #> '{page,rows}'
  ) = 1,
  'management count, student classes, and class roster all expose one student'
);

select ok(
  (
    select detail.admission_checklist =
      '{"applicationSent":false,"makeeduRegistered":false,"invoiceSent":false,"paymentConfirmed":false,"registrationCompleted":true}'::jsonb
    from public.ops_registration_details detail
    where detail.task_id = '00000000-0000-4000-8000-00000000b401'
  ),
  'registered finalization does not infer or cascade checklist values'
);

select ok(
  (
    select before.message_count = (select pg_catalog.count(*) from public.ops_registration_messages)
      and before.delivery_count = (select pg_catalog.count(*) from dashboard_private.notification_deliveries)
    from registration_admission_before before
  ),
  'registered roster finalization performs no provider or delivery send'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)'::pg_catalog.regprocedure
    ),
    '40001'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.apply_student_class_roster_mode(uuid,uuid,text,text,uuid,text,uuid)'::pg_catalog.regprocedure
    ),
    '40001'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.finalize_registration_track_enrollments_v1(uuid,uuid)'::pg_catalog.regprocedure
    ),
    '23514'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.set_registration_admission_checklist_item_v1_impl(uuid,text,boolean,text)'::pg_catalog.regprocedure
    ),
    'recompute_registration_parent'
  ) = 0,
  'final active roster functions use non-retryable SQLSTATE 23514 for domain conflicts'
);

select * from finish();
rollback;
