begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';

select has_function(
  'public',
  'save_registration_case_inquiry_v1',
  array[
    'uuid', 'text', 'text', 'text', 'text', 'text', 'text',
    'timestamp with time zone', 'text', 'text', 'integer', 'text[]', 'text[]', 'text'
  ]
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_registration_case_inquiry_v1(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_registration_case_inquiry_v1(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)',
    'EXECUTE'
  ),
  'atomic inquiry RPC is authenticated-only'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '84000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'atomic-inquiry-staff@runtime.invalid',
    crypt('atomic-inquiry-runtime-only', gen_salt('bf')),
    pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-case-inquiry-atomic-save"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '84000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'atomic-inquiry-director@runtime.invalid',
    crypt('atomic-inquiry-runtime-only', gen_salt('bf')),
    pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-case-inquiry-atomic-save"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '84000000-0000-4000-8000-000000000001', 'staff',
    '통합저장 운영담당', 'atomic-inquiry-staff@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '84000000-0000-4000-8000-000000000002', 'admin',
    '통합저장 상담원장', 'atomic-inquiry-director@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
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
  '84000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002'
);

delete from public.teacher_catalogs
where profile_id in (
  '84000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002'
);

insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order,
  profile_id, account_email, dashboard_role
)
values (
  '84000000-0000-4000-8000-000000000012',
  '통합저장 상담원장', array['영어']::text[], true, 9842,
  '84000000-0000-4000-8000-000000000002',
  'atomic-inquiry-director@runtime.invalid', 'admin'
);

update public.profiles
set teacher_catalog_id = '84000000-0000-4000-8000-000000000012',
    updated_at = pg_catalog.now()
where id = '84000000-0000-4000-8000-000000000002';

update public.academic_subject_settings
set is_active = true,
    registration_create_enabled = true,
    grade_levels = array['고1', '고2', '고3']::text[]
where subject = '과학';

insert into public.ops_tasks(
  id, title, type, status, requested_by, student_name,
  subject, campus, priority
)
values
  ('84000000-0000-4000-8000-000000000101', '등록: 상향학생', 'registration', 'requested', '84000000-0000-4000-8000-000000000001', '상향학생', '영어', '본관', 'normal'),
  ('84000000-0000-4000-8000-000000000102', '등록: 하향학생', 'registration', 'requested', '84000000-0000-4000-8000-000000000001', '하향학생', '영어, 과학', '본관', 'normal'),
  ('84000000-0000-4000-8000-000000000103', '등록: 삭제차단', 'registration', 'in_progress', '84000000-0000-4000-8000-000000000001', '삭제차단', '영어, 과학', '본관', 'normal'),
  ('84000000-0000-4000-8000-000000000104', '등록: 공통충돌', 'registration', 'requested', '84000000-0000-4000-8000-000000000001', '공통충돌', '영어', '본관', 'normal'),
  ('84000000-0000-4000-8000-000000000105', '등록: 과목충돌', 'registration', 'requested', '84000000-0000-4000-8000-000000000001', '과목충돌', '영어', '본관', 'normal'),
  ('84000000-0000-4000-8000-000000000106', '등록: 재시도학생', 'registration', 'requested', '84000000-0000-4000-8000-000000000001', '재시도학생', '영어', '본관', 'normal'),
  ('84000000-0000-4000-8000-000000000107', '등록: 기존과학', 'registration', 'requested', '84000000-0000-4000-8000-000000000001', '기존과학', '과학', '별관', 'normal'),
  ('84000000-0000-4000-8000-000000000108', '등록: 신규과학', 'registration', 'requested', '84000000-0000-4000-8000-000000000001', '신규과학', '영어', '별관', 'normal'),
  ('84000000-0000-4000-8000-000000000109', '등록: 알림학생', 'registration', 'in_progress', '84000000-0000-4000-8000-000000000001', '알림학생', '영어', '본관', 'normal'),
  ('84000000-0000-4000-8000-000000000110', '등록: 후기검증실패', 'registration', 'requested', '84000000-0000-4000-8000-000000000001', '후기검증실패', '영어', '본관', 'normal');

insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name,
  parent_phone, student_phone, request_note,
  common_revision, admission_notice_sent
)
values
  ('84000000-0000-4000-8000-000000000101', '2026-07-22 09:01+09', '중3', '통합중', '01084000101', null, '상향 전', 1, false),
  ('84000000-0000-4000-8000-000000000102', '2026-07-22 09:02+09', '고1', '통합고', '01084000102', null, '하향 전', 1, false),
  ('84000000-0000-4000-8000-000000000103', '2026-07-22 09:03+09', '고1', '통합고', '01084000103', null, '삭제 차단 원본', 1, false),
  ('84000000-0000-4000-8000-000000000104', '2026-07-22 09:04+09', '중3', '통합중', '01084000104', null, '공통 충돌 원본', 1, false),
  ('84000000-0000-4000-8000-000000000105', '2026-07-22 09:05+09', '중3', '통합중', '01084000105', null, '과목 충돌 원본', 1, false),
  ('84000000-0000-4000-8000-000000000106', '2026-07-22 09:06+09', '중3', '통합중', '01084000106', null, '재시도 전', 1, false),
  ('84000000-0000-4000-8000-000000000107', '2026-07-22 09:07+09', '고1', '통합고', '01084000107', null, '기존 과학 전', 1, false),
  ('84000000-0000-4000-8000-000000000108', '2026-07-22 09:08+09', '고1', '통합고', '01084000108', null, '신규 과학 전', 1, false),
  ('84000000-0000-4000-8000-000000000109', '2026-07-22 09:09+09', '중3', '통합중', '01084000109', null, '알림 전', 1, false),
  ('84000000-0000-4000-8000-000000000110', '2026-07-22 09:10+09', '중3', '통합중', '01084000110', null, '후기 검증 원본', 1, false);

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, migration_review_required,
  director_profile_id, director_assignment_source, director_assigned_at
)
values
  ('84000000-0000-4000-8000-000000000201', '84000000-0000-4000-8000-000000000101', '영어', 'inquiry', false, null, null, null),
  ('84000000-0000-4000-8000-000000000202', '84000000-0000-4000-8000-000000000102', '영어', 'inquiry', false, null, null, null),
  ('84000000-0000-4000-8000-000000000203', '84000000-0000-4000-8000-000000000102', '과학', 'inquiry', false, null, null, null),
  ('84000000-0000-4000-8000-000000000204', '84000000-0000-4000-8000-000000000103', '영어', 'inquiry', false, null, null, null),
  ('84000000-0000-4000-8000-000000000205', '84000000-0000-4000-8000-000000000103', '과학', 'consultation_waiting', false, null, null, null),
  ('84000000-0000-4000-8000-000000000206', '84000000-0000-4000-8000-000000000104', '영어', 'inquiry', false, null, null, null),
  ('84000000-0000-4000-8000-000000000207', '84000000-0000-4000-8000-000000000105', '영어', 'inquiry', false, null, null, null),
  ('84000000-0000-4000-8000-000000000208', '84000000-0000-4000-8000-000000000106', '영어', 'inquiry', false, null, null, null),
  ('84000000-0000-4000-8000-000000000209', '84000000-0000-4000-8000-000000000107', '과학', 'inquiry', false, null, null, null),
  ('84000000-0000-4000-8000-000000000210', '84000000-0000-4000-8000-000000000108', '영어', 'inquiry', false, null, null, null),
  ('84000000-0000-4000-8000-000000000211', '84000000-0000-4000-8000-000000000109', '영어', 'visit_consultation_scheduled', false, '84000000-0000-4000-8000-000000000002', 'manual', pg_catalog.now()),
  ('84000000-0000-4000-8000-000000000212', '84000000-0000-4000-8000-000000000110', '영어', 'inquiry', false, null, null, null);

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision
)
values (
  '84000000-0000-4000-8000-000000000301',
  '84000000-0000-4000-8000-000000000109',
  'visit_consultation', pg_catalog.now() + interval '7 days',
  '본관 상담실', 'scheduled', 1
);

insert into public.ops_registration_consultations(
  id, track_id, appointment_id, mode, status, director_profile_id
)
values (
  '84000000-0000-4000-8000-000000000401',
  '84000000-0000-4000-8000-000000000211',
  '84000000-0000-4000-8000-000000000301',
  'visit', 'scheduled', '84000000-0000-4000-8000-000000000002'
);

create temporary table registration_inquiry_reminder_fixture(
  rule_id uuid primary key,
  template_id uuid not null,
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  prior_jobs jsonb not null default '[]'::jsonb,
  prior_event_id uuid,
  prior_fanout_job_id uuid,
  prior_delivery_id uuid not null
) on commit drop;

insert into registration_inquiry_reminder_fixture(
  rule_id,
  template_id,
  prior_delivery_id
)
select
  rule.id,
  rule.active_template_id,
  '84000000-0000-4000-8000-000000000501'::uuid
from dashboard_private.notification_rules as rule
where rule.scope_key = 'global'
  and rule.workflow_key = 'registration'
  and rule.event_key = 'registration.appointment_reminder_due'
  and rule.rule_variant_key = 'previous_day_at'
  and rule.audience_key = 'track_director'
  and rule.channel_key = 'in_app';

update dashboard_private.notification_rules as rule
set enabled = true,
    updated_at = pg_catalog.clock_timestamp()
from registration_inquiry_reminder_fixture as fixture
where rule.id = fixture.rule_id;

update registration_inquiry_reminder_fixture as fixture
set prior_jobs = dashboard_private.materialize_registration_appointment_reminders_v1(
  '84000000-0000-4000-8000-000000000301',
  pg_catalog.clock_timestamp()
);

update registration_inquiry_reminder_fixture as fixture
set prior_event_id = event_row.id
from dashboard_private.notification_events as event_row
where event_row.workflow_key = 'registration'
  and event_row.event_key = 'registration.appointment_reminder_due'
  and event_row.source_type = 'registration_appointment'
  and event_row.source_id = '84000000-0000-4000-8000-000000000301'
  and event_row.source_revision = 1
  and event_row.materialized_rule_id = fixture.rule_id;

update registration_inquiry_reminder_fixture as fixture
set prior_fanout_job_id = job.id
from dashboard_private.notification_event_fanout_jobs as job
where job.event_id = fixture.prior_event_id;

select ok(
  (
    select pg_catalog.count(*) = 1
      and pg_catalog.bool_and(rule.enabled)
      and pg_catalog.bool_and(
        dashboard_private.registration_appointment_reminder_applicable_v1(
          'visit_consultation',
          rule.audience_key,
          rule.channel_key
        )
      )
      and pg_catalog.bool_and(pg_catalog.jsonb_array_length(fixture.prior_jobs) > 0)
      and pg_catalog.bool_and(fixture.prior_event_id is not null)
      and pg_catalog.bool_and(fixture.prior_fanout_job_id is not null)
      and pg_catalog.bool_and(appointment.notification_revision = 1)
    from registration_inquiry_reminder_fixture as fixture
    join dashboard_private.notification_rules as rule on rule.id = fixture.rule_id
    join public.ops_registration_appointments as appointment
      on appointment.id = '84000000-0000-4000-8000-000000000301'
  ),
  'reminder-prior-materialization has one applicable enabled rule, event, and fanout job'
);

insert into dashboard_private.notification_deliveries(
  id,
  event_id,
  rule_id,
  rule_revision,
  template_id,
  channel_key,
  audience_key,
  target_generation,
  target_set_hash,
  target_kind,
  target_key,
  target_profile_id,
  connection_key,
  target_snapshot,
  status,
  status_reason,
  dedupe_key,
  rendered_title,
  rendered_body,
  href,
  scheduled_for,
  attempt_count,
  max_attempts,
  next_attempt_at
)
select
  fixture.prior_delivery_id,
  fixture.prior_event_id,
  fixture.rule_id,
  rule.revision,
  fixture.template_id,
  rule.channel_key,
  rule.audience_key,
  1,
  dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'target_kind', 'profile',
        'target_key', 'profile:84000000-0000-4000-8000-000000000002',
        'target_profile_id', '84000000-0000-4000-8000-000000000002',
        'connection_key', null,
        'target_snapshot', pg_catalog.jsonb_build_object(
          'profile_id', '84000000-0000-4000-8000-000000000002'
        )
      )
    )
  ),
  'profile',
  'profile:84000000-0000-4000-8000-000000000002',
  '84000000-0000-4000-8000-000000000002',
  null,
  pg_catalog.jsonb_build_object(
    'profile_id', '84000000-0000-4000-8000-000000000002'
  ),
  'pending',
  null,
  'atomic-inquiry-prior-reminder-delivery',
  '통합저장 사전 알림',
  'revision 1 취소 검증용 대기 알림',
  '/admin/tasks',
  job.scheduled_for,
  0,
  5,
  null
from registration_inquiry_reminder_fixture as fixture
join dashboard_private.notification_rules as rule on rule.id = fixture.rule_id
join dashboard_private.notification_event_fanout_jobs as job
  on job.id = fixture.prior_fanout_job_id;

create temporary table registration_inquiry_results(
  case_key text primary key,
  response jsonb not null
) on commit drop;
grant select, insert, update on registration_inquiry_results to authenticated;

create or replace function pg_temp.registration_inquiry_receipt_count(
  p_request_keys text[],
  p_mutation_type text default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)
  from dashboard_private.ops_registration_mutations as mutation
  where mutation.actor_id = '84000000-0000-4000-8000-000000000001'
    and mutation.request_key = any(p_request_keys)
    and (
      p_mutation_type is null
      or mutation.mutation_type = p_mutation_type
    );
$$;

create or replace function pg_temp.registration_inquiry_receipt_has_jobs(
  p_request_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select mutation.response_payload ? 'notificationJobs'
        and pg_catalog.jsonb_array_length(
          mutation.response_payload -> 'notificationJobs'
        ) > 0
      from dashboard_private.ops_registration_mutations as mutation
      where mutation.actor_id = '84000000-0000-4000-8000-000000000001'
        and mutation.request_key = p_request_key
        and mutation.mutation_type = 'save_inquiry'
    ),
    false
  );
$$;

create or replace function pg_temp.registration_inquiry_set_actor(p_actor uuid)
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
        select profile.email
        from public.profiles as profile
        where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

set local role authenticated;
select pg_temp.registration_inquiry_set_actor(
  '84000000-0000-4000-8000-000000000001'
);

select lives_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000101',
      '상향학생', '고1', '통합고', '01084000101', null,
      '본관', '2026-07-22 09:01+09', '상향 완료', 'normal',
      1, array['영어']::text[], array['과학', '영어']::text[],
      'atomic-upshift'
    )
  $$,
  'middle-english-to-high-english-science'
);
select ok(
  (
    select detail.common_revision = 2
      and detail.school_grade = '고1'
      and (
        select pg_catalog.array_agg(track.subject order by dashboard_private.registration_subject_sort_order(track.subject))
        from public.ops_registration_subject_tracks as track
        where track.task_id = detail.task_id
      ) = array['영어', '과학']::text[]
    from public.ops_registration_details as detail
    where detail.task_id = '84000000-0000-4000-8000-000000000101'
  ),
  'middle-english-to-high-english-science committed one revision and the final subject set'
);

select lives_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000102',
      '하향학생', '중3', '통합중', '01084000102', null,
      '본관', '2026-07-22 09:02+09', '하향 완료', 'normal',
      1, array['영어', '과학']::text[], array['영어']::text[],
      'atomic-downshift'
    )
  $$,
  'high-science-to-middle-english'
);
select ok(
  (
    select detail.common_revision = 2
      and detail.school_grade = '중3'
      and not exists (
        select 1
        from public.ops_registration_subject_tracks as track
        where track.task_id = detail.task_id
          and track.subject = '과학'
      )
    from public.ops_registration_details as detail
    where detail.task_id = '84000000-0000-4000-8000-000000000102'
  ),
  'high-science-to-middle-english removes science before the reminder-aware common mutation'
);

select throws_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000103',
      '삭제차단', '중3', '통합중', '01084000103', null,
      '본관', '2026-07-22 09:03+09', '쓰이면 안 됨', 'normal',
      1, array['영어', '과학']::text[], array['영어']::text[],
      'atomic-removal-block'
    )
  $$,
  '40001',
  'registration_subject_removal_blocked',
  'removal-block-rollback'
);
select ok(
  (
    select detail.common_revision = 1
      and detail.school_grade = '고1'
      and detail.request_note = '삭제 차단 원본'
      and exists (
        select 1
        from public.ops_registration_subject_tracks as track
        where track.task_id = detail.task_id
          and track.subject = '과학'
      )
    from public.ops_registration_details as detail
    where detail.task_id = '84000000-0000-4000-8000-000000000103'
  ),
  'removal-block-rollback leaves common data and tracks unchanged'
);

select throws_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000104',
      '공통충돌', '중3', '통합중', '01084000104', null,
      '본관', '2026-07-22 09:04+09', '쓰이면 안 됨', 'normal',
      2, array['영어']::text[], array['영어']::text[],
      'atomic-stale-common'
    )
  $$,
  '40001',
  'registration_common_revision_conflict',
  'stale-common-revision'
);

select throws_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000105',
      '과목충돌', '중3', '통합중', '01084000105', null,
      '본관', '2026-07-22 09:05+09', '쓰이면 안 됨', 'normal',
      1, array['수학']::text[], array['영어']::text[],
      'atomic-stale-subjects'
    )
  $$,
  '40001',
  'registration_subjects_conflict',
  'stale-expected-subjects'
);
select is(
  pg_temp.registration_inquiry_receipt_count(
    array['atomic-stale-common', 'atomic-stale-subjects']::text[]
  ),
  0::bigint,
  'stale-common-revision and stale-expected-subjects write no receipt'
);

insert into registration_inquiry_results(case_key, response)
select
  'replay',
  public.save_registration_case_inquiry_v1(
    '84000000-0000-4000-8000-000000000106',
    '재시도학생', '중3', '통합중', '01084000106', null,
    '본관', '2026-07-22 09:06+09', '재시도 완료', 'normal',
    1, array['영어']::text[], array['영어']::text[],
    'atomic-replay'
  );
select is(
  public.save_registration_case_inquiry_v1(
    '84000000-0000-4000-8000-000000000106',
    '재시도학생', '중3', '통합중', '01084000106', null,
    '본관', '2026-07-22 09:06+09', '재시도 완료', 'normal',
    1, array['영어']::text[], array['영어']::text[],
    'atomic-replay'
  ),
  (select result.response from registration_inquiry_results as result where result.case_key = 'replay'),
  'idempotent-replay'
);
select is(
  pg_temp.registration_inquiry_receipt_count(
    array['atomic-replay']::text[],
    'save_inquiry'
  ),
  1::bigint,
  'idempotent-replay stores one outer save_inquiry receipt'
);

select throws_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000106',
      '재시도학생', '중3', '통합중', '01084000106', null,
      '본관', '2026-07-22 09:06+09', '다른 payload', 'normal',
      1, array['영어']::text[], array['영어']::text[],
      'atomic-replay'
    )
  $$,
  '22023',
  'idempotency_key_reused',
  'mismatched-key-reuse'
);

reset role;
update public.academic_subject_settings
set is_active = false,
    registration_create_enabled = false
where subject = '과학';
set local role authenticated;

select lives_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000107',
      '기존과학', '고1', '통합고', '01084000107', null,
      '별관', '2026-07-22 09:07+09', '기존 과학 수정 허용', 'normal',
      1, array['과학']::text[], array['과학']::text[],
      'atomic-existing-disabled-science'
    )
  $$,
  'disabled-existing-science-common-edit'
);

select throws_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000108',
      '신규과학', '고1', '통합고', '01084000108', null,
      '별관', '2026-07-22 09:08+09', '쓰이면 안 됨', 'normal',
      1, array['영어']::text[], array['영어', '과학']::text[],
      'atomic-new-disabled-science'
    )
  $$,
  '40001',
  'registration_subject_disabled',
  'disabled-new-science-rejection'
);
select ok(
  (
    select detail.common_revision = 1
      and detail.school_grade = '고1'
      and not exists (
        select 1
        from public.ops_registration_subject_tracks as track
        where track.task_id = detail.task_id
          and track.subject = '과학'
      )
    from public.ops_registration_details as detail
    where detail.task_id = '84000000-0000-4000-8000-000000000108'
  ),
  'disabled-new-science-rejection is zero-write'
);

select throws_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000110',
      '후기검증실패-변경', '중3', '변경학교', 'invalid-phone', null,
      '별관', '2026-07-22 10:10+09', '쓰이면 안 됨', 'high',
      1, array['영어']::text[], array['영어', '수학']::text[],
      'atomic-post-subject-common-failure'
    )
  $$,
  '22023',
  'registration_parent_phone_invalid',
  'post-subject-write-common-validation-rollback'
);
select ok(
  (
    select task.student_name = '후기검증실패'
      and task.campus = '본관'
      and task.priority = 'normal'
      and detail.common_revision = 1
      and detail.school_grade = '중3'
      and detail.school_name = '통합중'
      and detail.parent_phone = '01084000110'
      and detail.request_note = '후기 검증 원본'
      and (
        select pg_catalog.array_agg(
          track.subject
          order by dashboard_private.registration_subject_sort_order(track.subject)
        )
        from public.ops_registration_subject_tracks as track
        where track.task_id = task.id
      ) = array['영어']::text[]
      and not exists (
        select 1
        from public.ops_task_events as event_row
        where event_row.task_id = task.id
          and event_row.event_type in (
            'registration_subjects_synced',
            'registration_subject_removed',
            'registration_common_info_updated'
          )
      )
      and pg_temp.registration_inquiry_receipt_count(
        array['atomic-post-subject-common-failure']::text[]
      ) = 0
    from public.ops_tasks as task
    join public.ops_registration_details as detail on detail.task_id = task.id
    where task.id = '84000000-0000-4000-8000-000000000110'
  ),
  'registration_subjects_synced, tracks, events, common fields, revision, and receipt all rollback after post-subject-write-common-validation-rollback'
);

select lives_ok(
  $$
    select public.save_registration_case_inquiry_v1(
      '84000000-0000-4000-8000-000000000109',
      '알림학생수정', '중3', '통합중', '01084000109', null,
      '본관', '2026-07-22 09:09+09', '알림 identity 수정', 'normal',
      1, array['영어']::text[], array['영어']::text[],
      'atomic-reminder-rematerialize'
    )
  $$,
  'reminder-rematerialization'
);
select is(
  (
    select appointment.notification_revision
    from public.ops_registration_appointments as appointment
    where appointment.id = '84000000-0000-4000-8000-000000000301'
  ),
  2,
  'notification_revision increments before reminder-rematerialization'
);
select ok(
  pg_temp.registration_inquiry_receipt_has_jobs(
    'atomic-reminder-rematerialize'
  ),
  'reminder-rematerialization response keeps non-empty notificationJobs on the single outer receipt'
);

reset role;
select ok(
  exists (
    select 1
    from dashboard_private.notification_events as event_row
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = '84000000-0000-4000-8000-000000000301'
      and event_row.source_revision = 2
      and event_row.materialized_rule_id = (
        select fixture.rule_id
        from registration_inquiry_reminder_fixture as fixture
      )
  )
  and exists (
    select 1
    from dashboard_private.notification_event_fanout_jobs as job
    join dashboard_private.notification_events as event_row
      on event_row.id = job.event_id
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = '84000000-0000-4000-8000-000000000301'
      and event_row.source_revision = 2
      and job.status = 'pending'
      and job.target_generation = 1
  ),
  'reminder-rematerialization creates the new-revision notification event and fanout job'
);

select ok(
  (
    select delivery.status = 'canceled'
      and delivery.status_reason = 'source_revision_changed'
      and delivery.attempt_count = 0
      and delivery.last_attempt_started_at is null
      and delivery.provider_message_id is null
      and delivery.provider_response_code is null
      and delivery.sent_at is null
    from dashboard_private.notification_deliveries as delivery
    where delivery.id = (
      select fixture.prior_delivery_id
      from registration_inquiry_reminder_fixture as fixture
    )
  ),
  'reminder-rematerialization cancels the prior revision before any provider send'
);

select is(
  (
    with new_revision_events as (
      select event_row.id
      from dashboard_private.notification_events as event_row
      where event_row.workflow_key = 'registration'
        and event_row.event_key = 'registration.appointment_reminder_due'
        and event_row.source_type = 'registration_appointment'
        and event_row.source_id = '84000000-0000-4000-8000-000000000301'
        and event_row.source_revision = 2
    )
    select pg_catalog.count(*)
    from dashboard_private.notification_deliveries as delivery
    where delivery.event_id in (select event_row.id from new_revision_events as event_row)
  ),
  0::bigint,
  'provider-delivery-zero: the new revision has no delivery before fanout runs'
);

select ok(
  not exists (
    select 1
    from dashboard_private.notification_deliveries as delivery
    join dashboard_private.notification_events as event_row on event_row.id = delivery.event_id
    where event_row.workflow_key = 'registration'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = '84000000-0000-4000-8000-000000000301'
      and (
        delivery.attempt_count <> 0
        or delivery.last_attempt_started_at is not null
        or delivery.provider_message_id is not null
        or delivery.provider_response_code is not null
        or delivery.sent_at is not null
      )
  )
  and not exists (
    select 1
    from dashboard_private.notification_audit_logs as audit
    where audit.entity_kind = 'notification_external_attempt'
      and audit.action = 'external_attempt_registered'
      and audit.created_at >= (
        select fixture.started_at
        from registration_inquiry_reminder_fixture as fixture
      )
  ),
  'provider-send-zero: rematerialization records no external provider boundary crossing'
);

select * from finish();
rollback;
