begin;

select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

select ok(
  (
    select
      pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any (
        array['search_path=', 'search_path=""']::text[]
      )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
  ),
  'flat common implementation keeps the postgres-owned empty-search-path security boundary'
);

select ok(
  (
    select
      pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any (
        array['search_path=', 'search_path=""']::text[]
      )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.update_registration_case_common_with_reminders_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
  ),
  'common compatibility delegate keeps the postgres-owned empty-search-path security boundary'
);

select ok(
  (
    select
      pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and pg_catalog.cardinality(procedure.proconfig) = 1
      and procedure.proconfig[1] = any (
        array['search_path=', 'search_path=""']::text[]
      )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.save_registration_case_inquiry_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)'::regprocedure
  ),
  'unified inquiry save keeps the postgres-owned empty-search-path security boundary'
);

select is(
  pg_catalog.jsonb_build_object(
    'commonImplAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)',
      'EXECUTE'
    ),
    'commonDelegateAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'dashboard_private.update_registration_case_common_with_reminders_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)',
      'EXECUTE'
    ),
    'commonPublicAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.update_registration_case_common(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)',
      'EXECUTE'
    ),
    'saveImplAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'dashboard_private.save_registration_case_inquiry_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)',
      'EXECUTE'
    ),
    'savePublicAuthenticated', pg_catalog.has_function_privilege(
      'authenticated',
      'public.save_registration_case_inquiry_v1(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)',
      'EXECUTE'
    ),
    'savePublicAnon', pg_catalog.has_function_privilege(
      'anon',
      'public.save_registration_case_inquiry_v1(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)',
      'EXECUTE'
    ),
    'savePublicServiceRole', pg_catalog.has_function_privilege(
      'service_role',
      'public.save_registration_case_inquiry_v1(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)',
      'EXECUTE'
    )
  ),
  '{"commonDelegateAuthenticated":true,"commonImplAuthenticated":false,"commonPublicAuthenticated":true,"saveImplAuthenticated":true,"savePublicAnon":false,"savePublicAuthenticated":true,"savePublicServiceRole":false}'::jsonb,
  'the existing authenticated wrapper and private delegation ACL boundary is preserved'
);

select ok(
  (
    select definition like '%dashboard_private.assert_registration_mutation_access%'
      and definition like '%pg_catalog.pg_advisory_xact_lock%'
      and definition like '%for update%'
      and definition like '%registration_common_info_updated%'
      and definition not like '%student_link_recheck_required%'
      and definition not like '%public.ops_registration_subject_tracks%'
      and definition not like '%public.students%'
      and definition like '%dashboard_private.ops_registration_mutations%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
      ) as definition
    ) source
  ),
  'flat common input retains active-manager authorization, locks, audit, and idempotency'
);

select ok(
  (
    select definition not like '%registration_student_name_required%'
      and definition not like '%registration_school_grade_required%'
      and definition not like '%registration_parent_phone_invalid%'
      and definition not like '%registration_inquiry_at_required%'
      and definition not like '%registration_science_grade_invalid%'
      and definition not like '%registration_student_identity_correction_required%'
      and definition not like '%v_identity_frozen%'
      and definition not like '%public.ops_registration_admission_batches%'
      and definition not like '%public.ops_registration_messages%'
      and definition not like '%public.ops_registration_enrollments%'
      and definition not like '%dashboard_private.recompute_registration_parent%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
      ) as definition
    ) source
  ),
  'flat common facts have no notification-readiness, science-grade, or admission identity freeze gate'
);

select ok(
  (
    select definition not like '%dashboard_private.assert_registration_reminder_runtime_v1%'
      and definition not like '%notification-control-plane-workflow:registration%'
      and definition not like '%cancel_registration_appointment_reminders_v1%'
      and definition not like '%materialize_registration_appointment_reminders_v1%'
      and definition not like '%public.ops_registration_appointments%'
      and definition like '%''notificationJobs''%'
      and definition like '%''[]''::jsonb%'
      and definition not like '%if v_response ? ''notificationJobs'' then%'
      and definition like '%update dashboard_private.ops_registration_mutations%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.update_registration_case_common_with_reminders_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
      ) as definition
    ) source
  ),
  'common compatibility delegate returns an empty job list without touching reminder state'
);

select ok(
  (
    select definition not like '%dashboard_private.assert_registration_reminder_runtime_v1%'
      and definition not like '%notification-control-plane-workflow:registration%'
      and definition not like '%dashboard_private.assert_registration_subject_enabled%'
      and definition not like '%registration_science_grade_invalid%'
      and definition like '%dashboard_private.update_registration_case_common_with_reminders_v1_impl%'
      and definition like '%dashboard_private.sync_registration_case_subjects_impl%'
      and definition not like '%registration_subject_removal_blocked%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.save_registration_case_inquiry_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)'::regprocedure
      ) as definition
    ) source
  ),
  'unified save delegates only flat common facts and does not gate subject additions on common fields'
);

select ok(
  (
    select common_definition like
        '%registration_common_revision_conflict'' using errcode = ''23514''%'
      and save_definition like
        '%registration_common_revision_conflict'' using errcode = ''23514''%'
      and save_definition like
        '%registration_subjects_conflict'' using errcode = ''23514''%'
      and save_definition not like '%registration_subject_removal_blocked%'
      and common_definition not like '%40001%'
      and save_definition not like '%40001%'
    from (
      select
        pg_catalog.pg_get_functiondef(
          'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
        ) as common_definition,
        pg_catalog.pg_get_functiondef(
          'dashboard_private.save_registration_case_inquiry_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)'::regprocedure
        ) as save_definition
    ) source
  ),
  'common and subject snapshots are non-retryable while soft archive replaces removal blocking'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  banned_until, created_at, updated_at
)
values
  (
    '98900000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-common-admin@example.invalid',
    crypt('flat-common-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, null, now(), now()
  ),
  (
    '98900000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-common-staff@example.invalid',
    crypt('flat-common-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, null, now(), now()
  ),
  (
    '98900000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-common-teacher@example.invalid',
    crypt('flat-common-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, null, now(), now()
  ),
  (
    '98900000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'flat-common-banned@example.invalid',
    crypt('flat-common-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now() + interval '1 day', now(), now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '98900000-0000-4000-8000-000000000001', 'admin',
    '공통정보 관리자', 'flat-common-admin@example.invalid', now(), now()
  ),
  (
    '98900000-0000-4000-8000-000000000002', 'staff',
    '공통정보 관리팀', 'flat-common-staff@example.invalid', now(), now()
  ),
  (
    '98900000-0000-4000-8000-000000000003', 'teacher',
    '공통정보 강사', 'flat-common-teacher@example.invalid', now(), now()
  ),
  (
    '98900000-0000-4000-8000-000000000004', 'staff',
    '공통정보 정지계정', 'flat-common-banned@example.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '98900000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'email', 'flat-common-admin@example.invalid'
  )::text,
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '98900000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.students(
  id, name, uid, school, grade, contact, parent_contact, status,
  class_ids, waitlist_class_ids
)
values (
  '98900000-0000-4000-8000-000000000201',
  '연결학생', 'flat-common-linked', '연결중', '중1',
  '01098902001', '01098901001', '재원', '[]'::jsonb, '[]'::jsonb
);

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_storage_mode, schedule_plan
)
values (
  '98900000-0000-4000-8000-000000000301',
  '공통정보 영어반', '정규', '영어', '중1', '공통정보 원장',
  '월 18:00', '본관', 12, 100000, '수업 진행 중',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'legacy',
  '{"sessions":[{"date":"2026-09-07","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
);

insert into public.ops_tasks(
  id, title, type, status, requested_by, student_id, student_name,
  subject, campus, priority
)
values
  (
    '98900000-0000-4000-8000-000000000401',
    '등록: 연결학생', 'registration', 'in_progress',
    '98900000-0000-4000-8000-000000000001',
    '98900000-0000-4000-8000-000000000201', '연결학생',
    '영어', '본관', 'normal'
  ),
  (
    '98900000-0000-4000-8000-000000000411',
    '등록: 관리팀학생', 'registration', 'requested',
    '98900000-0000-4000-8000-000000000002',
    null, '관리팀학생', '영어', '별관', 'high'
  );

insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone,
  student_phone, request_note, common_revision, admission_notice_sent
)
values
  (
    '98900000-0000-4000-8000-000000000401',
    '2026-09-01 18:49+09', '중1', '연결중',
    '01098901001', '01098902001', '수정 전', 1, true
  ),
  (
    '98900000-0000-4000-8000-000000000411',
    '2026-09-01 19:00+09', '중2', '관리중',
    '01098901002', null, '관리팀 수정 전', 1, false
  );

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_profile_id,
  director_assignment_source, director_assigned_at, migration_review_required
)
values
  (
    '98900000-0000-4000-8000-000000000501',
    '98900000-0000-4000-8000-000000000401',
    '영어', 'visit_consultation_scheduled',
    '98900000-0000-4000-8000-000000000001', 'manual', now(), false
  ),
  (
    '98900000-0000-4000-8000-000000000511',
    '98900000-0000-4000-8000-000000000411',
    '영어', 'inquiry', null, null, null, false
  );

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision
)
values (
  '98900000-0000-4000-8000-000000000601',
  '98900000-0000-4000-8000-000000000401',
  'visit_consultation', now() + interval '7 days',
  '본관 상담실', 'scheduled', 1
);

insert into public.ops_registration_consultations(
  id, track_id, appointment_id, mode, status, director_profile_id
)
values (
  '98900000-0000-4000-8000-000000000611',
  '98900000-0000-4000-8000-000000000501',
  '98900000-0000-4000-8000-000000000601',
  'visit', 'scheduled', '98900000-0000-4000-8000-000000000001'
);

insert into public.ops_registration_admission_batches(
  id, task_id, revision_number, status
)
values (
  '98900000-0000-4000-8000-000000000701',
  '98900000-0000-4000-8000-000000000401', 1, 'draft'
);

insert into public.ops_registration_enrollments(
  id, track_id, student_id, admission_batch_id, class_id,
  status, roster_active, sort_order
)
values (
  '98900000-0000-4000-8000-000000000711',
  '98900000-0000-4000-8000-000000000501',
  '98900000-0000-4000-8000-000000000201',
  '98900000-0000-4000-8000-000000000701',
  '98900000-0000-4000-8000-000000000301',
  'planned', true, 0
);

insert into public.ops_registration_messages(
  id, task_id, template_key, request_key, status, claim_active,
  recipient_last4, sent_by, created_at, updated_at
)
values (
  '98900000-0000-4000-8000-000000000721',
  '98900000-0000-4000-8000-000000000401',
  'admission_application', 'flat-common-active-message',
  'pending', true, '1001',
  '98900000-0000-4000-8000-000000000001', now(), now()
);

create temporary table registration_flat_common_notification_before
on commit drop
as
select
  appointment.notification_revision,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_events event_row
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = appointment.id::text
  ) as event_count,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_event_fanout_jobs job
    join dashboard_private.notification_events event_row on event_row.id = job.event_id
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = appointment.id::text
  ) as fanout_job_count,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = appointment.id::text
  ) as delivery_count,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'notification_external_attempt'
      and audit.action = 'external_attempt_registered'
  ) as external_attempt_count
from public.ops_registration_appointments appointment
where appointment.id = '98900000-0000-4000-8000-000000000601';

select ok(
  (
    select pg_catalog.count(*) = 1
      and pg_catalog.bool_and(before.notification_revision = 1)
    from registration_flat_common_notification_before before
  ),
  'the no-side-effect proof captures the scheduled appointment at revision one'
);

create or replace function pg_temp.registration_flat_common_set_actor(p_actor uuid)
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

create temporary table registration_flat_common_results(
  result_key text primary key,
  response jsonb not null
) on commit drop;
grant select, insert on registration_flat_common_results to authenticated;

select pg_temp.registration_flat_common_set_actor(
  '98900000-0000-4000-8000-000000000003'
);
set local role authenticated;
select throws_ok(
  $$select public.save_registration_case_inquiry_v1(
    '98900000-0000-4000-8000-000000000401',
    '', '', '', '임시-연락처', '', '', null, '강사 입력 금지', '',
    1, array['영어']::text[], array['영어', '수학']::text[],
    'flat-common-teacher-denied'
  )$$,
  '42501',
  'registration_access_denied',
  'teachers cannot write registration common facts'
);
reset role;

select pg_temp.registration_flat_common_set_actor(
  '98900000-0000-4000-8000-000000000004'
);
set local role authenticated;
select throws_ok(
  $$select public.save_registration_case_inquiry_v1(
    '98900000-0000-4000-8000-000000000401',
    '', '', '', '임시-연락처', '', '', null, '정지계정 입력 금지', '',
    1, array['영어']::text[], array['영어', '수학']::text[],
    'flat-common-banned-denied'
  )$$,
  '42501',
  'registration_access_denied',
  'a banned staff account cannot write registration common facts'
);
reset role;

select pg_temp.registration_flat_common_set_actor(
  '98900000-0000-4000-8000-000000000001'
);
set local role authenticated;

select throws_ok(
  $$select public.save_registration_case_inquiry_v1(
    '98900000-0000-4000-8000-000000000401',
    '', '', '', '임시-연락처', '', '', null, 'stale common', '',
    2, array['영어']::text[], array['영어', '수학']::text[],
    'flat-common-stale-common'
  )$$,
  '23514',
  'registration_common_revision_conflict',
  'stale common revisions are exact non-retryable domain conflicts'
);

select throws_ok(
  $$select public.save_registration_case_inquiry_v1(
    '98900000-0000-4000-8000-000000000401',
    '', '', '', '임시-연락처', '', '', null, 'stale subjects', '',
    1, array['수학']::text[], array['영어', '수학']::text[],
    'flat-common-stale-subjects'
  )$$,
  '23514',
  'registration_subjects_conflict',
  'stale subject snapshots are exact non-retryable domain conflicts'
);

insert into registration_flat_common_results(result_key, response)
select
  'admin-save',
  public.save_registration_case_inquiry_v1(
    '98900000-0000-4000-8000-000000000401',
    '   ', ' ', '', '임시-연락처', ' ', '', null,
    '필수값 작성 중', '', 1,
    array['영어']::text[], array['영어', '수학']::text[],
    'flat-common-admin-save'
  );

reset role;

select is(
  (
    select result.response -> 'notificationJobs'
    from registration_flat_common_results result
    where result.result_key = 'admin-save'
  ),
  '[]'::jsonb,
  'partial common input returns the compatible empty notification job list'
);

select ok(
  (
    select task.status = 'in_progress'
      and task.student_id = '98900000-0000-4000-8000-000000000201'
      and task.student_name is null
      and task.title = '등록'
      and task.campus = '본관'
      and task.priority = 'normal'
      and detail.school_grade is null
      and detail.school_name is null
      and detail.parent_phone = '임시-연락처'
      and detail.student_phone is null
      and detail.inquiry_at is null
      and detail.request_note = '필수값 작성 중'
      and detail.common_revision = 2
    from public.ops_tasks task
    join public.ops_registration_details detail on detail.task_id = task.id
    where task.id = '98900000-0000-4000-8000-000000000401'
  ),
  'blank and in-progress facts save without mutating the separate student link'
);

select ok(
  (
    select track.pipeline_status = 'visit_consultation_scheduled'
      and track.director_profile_id = '98900000-0000-4000-8000-000000000001'
      and track.director_assignment_source = 'manual'
      and not track.migration_review_required
    from public.ops_registration_subject_tracks track
    where track.id = '98900000-0000-4000-8000-000000000501'
  ),
  'flat common input leaves the existing track state unchanged'
);

select ok(
  (
    select student.name = '연결학생'
      and student.school = '연결중'
      and student.contact = '01098902001'
      and student.parent_contact = '01098901001'
    from public.students student
    where student.id = '98900000-0000-4000-8000-000000000201'
  )
  and exists (
    select 1
    from public.ops_registration_admission_batches batch
    where batch.id = '98900000-0000-4000-8000-000000000701'
      and batch.status = 'draft'
  )
  and exists (
    select 1
    from public.ops_registration_messages message
    where message.id = '98900000-0000-4000-8000-000000000721'
      and message.claim_active
  )
  and exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.id = '98900000-0000-4000-8000-000000000711'
      and enrollment.student_id = '98900000-0000-4000-8000-000000000201'
      and enrollment.admission_batch_id = '98900000-0000-4000-8000-000000000701'
      and enrollment.roster_active
  ),
  'linked student and admission facts remain unchanged while the editable case facts diverge'
);

select is(
  (
    select pg_catalog.array_agg(
      track.subject
      order by dashboard_private.registration_subject_sort_order(track.subject)
    )
    from public.ops_registration_subject_tracks track
    where track.task_id = '98900000-0000-4000-8000-000000000401'
  ),
  array['영어', '수학']::text[],
  'a subject addition commits with incomplete common facts'
);

select ok(
  (
    select appointment.notification_revision = before.notification_revision
    from public.ops_registration_appointments appointment
    cross join registration_flat_common_notification_before before
    where appointment.id = '98900000-0000-4000-8000-000000000601'
  )
  and (
    select pg_catalog.count(*) = (
      select before.event_count
      from registration_flat_common_notification_before before
    )
    from dashboard_private.notification_events event_row
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = '98900000-0000-4000-8000-000000000601'
  )
  and (
    select pg_catalog.count(*) = (
      select before.fanout_job_count
      from registration_flat_common_notification_before before
    )
    from dashboard_private.notification_event_fanout_jobs job
    join dashboard_private.notification_events event_row on event_row.id = job.event_id
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = '98900000-0000-4000-8000-000000000601'
  )
  and (
    select pg_catalog.count(*) = (
      select before.delivery_count
      from registration_flat_common_notification_before before
    )
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = '98900000-0000-4000-8000-000000000601'
  )
  and (
    select pg_catalog.count(*) = (
      select before.external_attempt_count
      from registration_flat_common_notification_before before
    )
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'notification_external_attempt'
      and audit.action = 'external_attempt_registered'
  ),
  'common input changes no appointment revision, reminder job, delivery, or provider-send evidence'
);

select ok(
  (
    select pg_catalog.count(*) = 1
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '98900000-0000-4000-8000-000000000001'
      and mutation.request_key = 'flat-common-admin-save'
      and mutation.task_id = '98900000-0000-4000-8000-000000000401'
      and mutation.mutation_type = 'save_inquiry'
  )
  and (
    select pg_catalog.count(*) = 1
    from public.ops_task_events event_row
    where event_row.task_id = '98900000-0000-4000-8000-000000000401'
      and event_row.event_type = 'registration_common_info_updated'
  )
  and (
    select pg_catalog.count(*) = 0
    from public.ops_task_events event_row
    where event_row.task_id = '98900000-0000-4000-8000-000000000401'
      and event_row.event_type = 'student_link_recheck_required'
  )
  and (
    select pg_catalog.count(*) = 1
    from public.ops_task_events event_row
    where event_row.task_id = '98900000-0000-4000-8000-000000000401'
      and event_row.event_type = 'registration_subjects_synced'
  ),
  'flat input keeps one idempotency receipt and only the factual audit trail'
);

set local role authenticated;
reset role;
update dashboard_private.ops_registration_mutations mutation
set response_payload = mutation.response_payload || pg_catalog.jsonb_build_object(
  'notificationJobs',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('jobId', 'legacy-save-inquiry-job')
  )
)
where mutation.actor_id = '98900000-0000-4000-8000-000000000001'
  and mutation.request_key = 'flat-common-admin-save'
  and mutation.task_id = '98900000-0000-4000-8000-000000000401'
  and mutation.mutation_type = 'save_inquiry';
set local role authenticated;
select is(
  public.save_registration_case_inquiry_v1(
    '98900000-0000-4000-8000-000000000401',
    '   ', ' ', '', '임시-연락처', ' ', '', null,
    '필수값 작성 중', '', 1,
    array['영어']::text[], array['영어', '수학']::text[],
    'flat-common-admin-save'
  ),
  (
    select result.response
    from registration_flat_common_results result
    where result.result_key = 'admin-save'
  ),
  'unified partial input replay sanitizes a legacy notification job receipt without another write'
);

reset role;
select is(
  (
    select mutation.response_payload -> 'notificationJobs'
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '98900000-0000-4000-8000-000000000001'
      and mutation.request_key = 'flat-common-admin-save'
      and mutation.task_id = '98900000-0000-4000-8000-000000000401'
      and mutation.mutation_type = 'save_inquiry'
  ),
  '[]'::jsonb,
  'unified replay permanently removes legacy notification jobs from its receipt'
);

select pg_temp.registration_flat_common_set_actor(
  '98900000-0000-4000-8000-000000000002'
);
set local role authenticated;

insert into registration_flat_common_results(result_key, response)
select
  'staff-common',
  public.update_registration_case_common(
    '98900000-0000-4000-8000-000000000411',
    '', '', '', '연락처 확인 중', '', '', null,
    '관리팀 부분 저장', '', 1, 'flat-common-staff-save'
  );

select ok(
  (
    select result.response -> 'notificationJobs' = '[]'::jsonb
      and (result.response ->> 'commonRevision')::integer = 2
    from registration_flat_common_results result
    where result.result_key = 'staff-common'
  )
  and (
    select task.student_name is null
      and task.title = '등록'
      and task.campus = '별관'
      and task.priority = 'high'
      and detail.school_grade is null
      and detail.school_name is null
      and detail.parent_phone = '연락처 확인 중'
      and detail.inquiry_at is null
      and detail.common_revision = 2
    from public.ops_tasks task
    join public.ops_registration_details detail on detail.task_id = task.id
    where task.id = '98900000-0000-4000-8000-000000000411'
  ),
  'an active staff account can separately save incomplete common facts with no notification job'
);

reset role;
update dashboard_private.ops_registration_mutations mutation
set response_payload = mutation.response_payload || pg_catalog.jsonb_build_object(
  'notificationJobs',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('jobId', 'legacy-common-job')
  )
)
where mutation.actor_id = '98900000-0000-4000-8000-000000000002'
  and mutation.request_key = 'flat-common-staff-save'
  and mutation.task_id = '98900000-0000-4000-8000-000000000411'
  and mutation.mutation_type = 'update_common';
set local role authenticated;

select is(
  public.update_registration_case_common(
    '98900000-0000-4000-8000-000000000411',
    '', '', '', '연락처 확인 중', '', '', null,
    '관리팀 부분 저장', '', 1, 'flat-common-staff-save'
  ) -> 'notificationJobs',
  '[]'::jsonb,
  'legacy common replay exposes no notification job to an old client'
);

reset role;
select is(
  (
    select mutation.response_payload -> 'notificationJobs'
    from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = '98900000-0000-4000-8000-000000000002'
      and mutation.request_key = 'flat-common-staff-save'
      and mutation.task_id = '98900000-0000-4000-8000-000000000411'
      and mutation.mutation_type = 'update_common'
  ),
  '[]'::jsonb,
  'legacy common replay permanently removes notification jobs from its receipt'
);

select * from finish();
rollback;
