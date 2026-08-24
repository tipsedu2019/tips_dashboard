begin;

select plan(21);

select ok(
  pg_catalog.to_regprocedure(
    'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'
  ) is not null,
  'admission batch implementation keeps its exact contract'
);

select ok(
  pg_catalog.to_regprocedure(
    'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'
  ) is not null,
  'common registration update keeps its exact contract'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
    ),
    'registration_admission_notice_required'
  ) = 0,
  'admission-form delivery no longer gates admission batch creation'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
    ),
    'v_detail.admission_notice_sent'
  ) = 0,
  'admission-form delivery no longer appears in admission batch creation'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
    ),
    'registration_invalid_source_state'
  ) = 0,
  'legacy workflow pipeline status no longer gates admission batch creation'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
    ),
    '40001'
  ) = 0,
  'admission batch domain-state conflicts are non-retryable'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
    ),
    'registration_admission_batch_already_open'
  ) > 0,
  'an existing active admission batch still blocks a duplicate batch'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
    ),
    $contract$raise exception 'registration_admission_batch_already_open' using errcode = '23514'$contract$
  ) > 0,
  'duplicate admission batches remain decisive domain conflicts'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
    ),
    'idempotency_key_reused'
  ) > 0,
  'admission batch idempotency protection remains active'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
    ),
    'v_detail.admission_notice_sent'
  ) = 0,
  'admission-form delivery no longer freezes identity edits'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
    ),
    '40001'
  ) = 0,
  'common registration domain-state conflicts are non-retryable'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
    ),
    $contract$raise exception 'registration_common_revision_conflict' using errcode = '23514'$contract$
  ) > 0,
  'stale common revisions remain decisive domain conflicts'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
    ),
    $contract$raise exception 'registration_student_identity_correction_required' using errcode = '23514'$contract$
  ) > 0,
  'frozen student identity changes remain decisive domain conflicts'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
    ),
    'message.claim_active'
  ) > 0,
  'an active admission message claim still freezes identity edits'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
    ),
    'ops_registration_admission_batches'
  ) > 0,
  'admission batch history still freezes identity edits'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text)'::regprocedure
    ),
    'enrollment.status = ''planned'''
  ) > 0,
  'non-planned or batched enrollments still freeze identity edits'
);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local role postgres;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-4000-8000-00000000a701',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'admission-order-runtime-admin@example.invalid',
  crypt('admission-order-runtime-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"registration-admission-order-independence"}'::jsonb,
  now(),
  now()
);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '00000000-0000-4000-8000-00000000a701',
  'admin',
  '입학 순서 독립 관리자',
  'admission-order-runtime-admin@example.invalid',
  now(),
  now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000a701',
    'role', 'authenticated',
    'email', 'admission-order-runtime-admin@example.invalid'
  )::text,
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-00000000a701',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_storage_mode, schedule_plan
)
values (
  '00000000-0000-4000-8000-00000000a702',
  '입학 순서 독립 영어반',
  '정규',
  '영어',
  '중1',
  '입학 순서 독립 교사',
  '월 18:00',
  '본관',
  12,
  100000,
  '수업 진행 중',
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'legacy',
  '{"sessions":[{"date":"2026-08-31","sessionNumber":1,"scheduleState":"active"}]}'::jsonb
);

insert into public.ops_tasks(
  id, title, type, status, requested_by, student_name, subject, priority
)
values (
  '00000000-0000-4000-8000-00000000a703',
  '입학 순서 독립 런타임',
  'registration',
  'requested',
  '00000000-0000-4000-8000-00000000a701',
  '입학순서독립학생',
  '영어',
  'normal'
);

insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone,
  student_phone, common_revision, admission_notice_sent
)
values (
  '00000000-0000-4000-8000-00000000a703',
  '2026-08-24 09:00+09',
  '중1',
  '입학순서중',
  '01000002701',
  '01000001701',
  1,
  false
);

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, migration_review_required
)
values (
  '00000000-0000-4000-8000-00000000a704',
  '00000000-0000-4000-8000-00000000a703',
  '영어',
  'inquiry',
  false
);

insert into public.ops_registration_enrollments(
  id, track_id, class_id, class_start_date, class_start_session_key,
  class_start_session, status, makeedu_registered, roster_active, sort_order
)
values (
  '00000000-0000-4000-8000-00000000a705',
  '00000000-0000-4000-8000-00000000a704',
  '00000000-0000-4000-8000-00000000a702',
  '2026-08-31',
  '2026-08-31:1',
  '1회차',
  'planned',
  false,
  false,
  0
);

create temporary table registration_admission_order_runtime_before on commit drop as
select pipeline_status = 'inquiry' as track_was_inquiry
from public.ops_registration_subject_tracks
where id = '00000000-0000-4000-8000-00000000a704';

update public.ops_registration_details
set admission_notice_sent = true
where task_id = '00000000-0000-4000-8000-00000000a703';

set local role authenticated;
create temporary table registration_admission_order_runtime_common on commit drop as
select public.update_registration_case_common(
  '00000000-0000-4000-8000-00000000a703',
  '입학순서독립학생수정',
  '중1',
  '입학순서중',
  '01000002701',
  '01000001701',
  '본관',
  '2026-08-24 09:00+09'::timestamptz,
  '입학신청서 발송 여부와 무관한 일반정보 수정',
  'normal',
  1,
  'admission-order-runtime-common'
) as payload;
set local role postgres;

select ok(
  (
    select (response.payload ->> 'commonRevision')::integer = 2
      and response.payload -> 'notificationJobs' = '[]'::jsonb
      and (
        select task.student_name = '입학순서독립학생수정'
        from public.ops_tasks task
        where task.id = '00000000-0000-4000-8000-00000000a703'
      )
      and (
        select detail.common_revision = 2
          and detail.admission_notice_sent is true
        from public.ops_registration_details detail
        where detail.task_id = '00000000-0000-4000-8000-00000000a703'
      )
    from registration_admission_order_runtime_common response
  ),
  'an authenticated common update remains available after admission-form delivery'
);

update public.ops_registration_details
set admission_notice_sent = false
where task_id = '00000000-0000-4000-8000-00000000a703';

set local role authenticated;
create temporary table registration_admission_order_runtime_response on commit drop as
select public.start_registration_admission_batch(
  '00000000-0000-4000-8000-00000000a703',
  array['00000000-0000-4000-8000-00000000a704'::uuid],
  array['00000000-0000-4000-8000-00000000a705'::uuid],
  'admission-order-runtime-batch'
) as payload;
set local role postgres;

select ok(
  (
    select (response.payload #>> '{batch,id}')::uuid is not null
      and exists (
        select 1
        from public.ops_registration_admission_batches batch
        where batch.id = (response.payload #>> '{batch,id}')::uuid
          and batch.task_id = '00000000-0000-4000-8000-00000000a703'
          and batch.status = 'draft'
      )
    from registration_admission_order_runtime_response response
  ),
  'an admission batch is created without an admission notice'
);

select ok(
  (
    select runtime_before.track_was_inquiry
      and (
        select pipeline_status = 'enrollment_processing'
        from public.ops_registration_subject_tracks
        where id = '00000000-0000-4000-8000-00000000a704'
      )
    from registration_admission_order_runtime_before runtime_before
  ),
  'an inquiry track moves directly to enrollment processing'
);

select ok(
  (
    select status = 'planned' and roster_active
      and student_id is not null
      and admission_batch_id = (
        select (response.payload #>> '{batch,id}')::uuid
        from registration_admission_order_runtime_response response
      )
    from public.ops_registration_enrollments
    where id = '00000000-0000-4000-8000-00000000a705'
  ),
  'the planned enrollment is claimed with an active roster'
);

select ok(
  (
    select admission_notice_sent is false
    from public.ops_registration_details
    where task_id = '00000000-0000-4000-8000-00000000a703'
  ),
  'the admission notice remains unsent after batch creation'
);

select * from finish();
rollback;
