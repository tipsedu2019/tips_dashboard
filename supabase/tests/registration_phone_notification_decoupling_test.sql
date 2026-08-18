begin;

select plan(9);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  enabled, active_template_id, revision,
  created_by, created_actor_kind, updated_by, updated_actor_kind
)
values (
  '18275200-0000-4000-8000-000000000301',
  'global', 'registration', 'registration.phone_consultation_ready',
  'in_app', 'track_director', 'immediate', 'immediate', null, null,
  false, '18275200-0000-4000-8000-000000000302', 4,
  null, 'system', null, 'system'
);

insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind
)
values (
  '18275200-0000-4000-8000-000000000302',
  '18275200-0000-4000-8000-000000000301',
  4,
  '☎️ [등록] {student_name}의 전화상담을 기다리고 있어요',
  E'[학생] {student_name}\n[과목] {subjects}\n[진행] {progress_actor}의 전화상담 확인을 기다리고 있어요.',
  '[
    {"key":"student_name","token":"student_name","pii_class":"student_name"},
    {"key":"subjects","token":"subjects","pii_class":"none"},
    {"key":"progress_actor","token":"progress_actor","pii_class":"staff_name"}
  ]'::jsonb,
  2,
  'registration-phone-notification-decoupling-fixture',
  null,
  'system'
);

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_rules rule_row
    where rule_row.scope_key = 'global'
      and rule_row.workflow_key = 'registration'
      and rule_row.event_key = 'registration.phone_consultation_ready'
      and rule_row.audience_key = 'track_director'
      and rule_row.channel_key = 'in_app'
      and not rule_row.enabled
  ),
  1::bigint,
  '폐기된 전화상담 inbox 규칙은 비활성 상태다'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '18275200-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'phone-decoupling@runtime.invalid',
  crypt('phone-decoupling-runtime-only', gen_salt('bf')),
  pg_catalog.now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"registration-phone-notification-decoupling"}'::jsonb,
  pg_catalog.now(), pg_catalog.now()
);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '18275200-0000-4000-8000-000000000001',
  'admin', '전화상담 분리 검증', 'phone-decoupling@runtime.invalid',
  pg_catalog.now(), pg_catalog.now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

update public.teacher_catalogs
set name = '전화상담 분리 검증',
    subjects = array['영어']::text[],
    is_visible = true,
    sort_order = 9875,
    account_email = 'phone-decoupling@runtime.invalid',
    dashboard_role = 'admin'
where profile_id = '18275200-0000-4000-8000-000000000001';

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by,
  student_name, campus, subject
)
values (
  '18275200-0000-4000-8000-000000000101',
  '등록 전화상담 분리 검증', 'registration', 'in_progress', 'normal',
  '18275200-0000-4000-8000-000000000001',
  '런타임검증', '본관', '영어'
);

insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone
)
values (
  '18275200-0000-4000-8000-000000000101',
  '2026-08-18 20:27:52+09', '중3', '런타임중', '01000000000'
);

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status,
  director_profile_id, director_assignment_source, director_assigned_at
)
values (
  '18275200-0000-4000-8000-000000000201',
  '18275200-0000-4000-8000-000000000101',
  '영어', 'consultation_waiting',
  '18275200-0000-4000-8000-000000000001', 'manual', pg_catalog.now()
);

create or replace function pg_temp.registration_phone_decoupling_set_actor()
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', '18275200-0000-4000-8000-000000000001',
      'role', 'authenticated',
      'email', 'phone-decoupling@runtime.invalid'
    )::text,
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '18275200-0000-4000-8000-000000000001',
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

set local role authenticated;
select pg_temp.registration_phone_decoupling_set_actor();

select lives_ok(
  $$select public.save_registration_phone_consultation_v1(
    '18275200-0000-4000-8000-000000000201',
    'phone-decoupling-first-save'
  )$$,
  '비활성 알림 규칙이 전화상담 업무 저장을 롤백하지 않는다'
);

set local role postgres;

select is(
  (
    select pg_catalog.count(*)
    from public.ops_registration_consultations consultation
    where consultation.track_id = '18275200-0000-4000-8000-000000000201'
      and consultation.mode = 'phone'
      and consultation.status = 'waiting'
  ),
  1::bigint,
  '전화상담 업무 원장은 정상 저장된다'
);

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_events event_row
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.phone_consultation_ready'
      and event_row.payload ->> 'track_id' = '18275200-0000-4000-8000-000000000201'
  ),
  1::bigint,
  '알림 원본 이벤트는 감사 가능하게 남는다'
);

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row
      on event_row.id = delivery.event_id
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.phone_consultation_ready'
      and event_row.payload ->> 'track_id' = '18275200-0000-4000-8000-000000000201'
  ),
  0::bigint,
  '비활성 규칙에는 delivery를 만들지 않는다'
);

select is(
  (
    select pg_catalog.count(*)
    from public.dashboard_notifications notification
    where notification.type = 'registration_consultation'
      and notification.metadata ->> 'trackId' = '18275200-0000-4000-8000-000000000201'
  ),
  0::bigint,
  '폐기된 내부 inbox 알림을 만들지 않는다'
);

set local role authenticated;
select pg_temp.registration_phone_decoupling_set_actor();

select lives_ok(
  $$select public.save_registration_phone_consultation_v1(
    '18275200-0000-4000-8000-000000000201',
    'phone-decoupling-first-save'
  )$$,
  '같은 요청키 재시도도 성공한다'
);

set local role postgres;

select is(
  (
    select pg_catalog.count(*)
    from public.ops_registration_consultations consultation
    where consultation.track_id = '18275200-0000-4000-8000-000000000201'
      and consultation.mode = 'phone'
  ),
  1::bigint,
  '재시도는 전화상담 원장을 중복 생성하지 않는다'
);

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row
      on event_row.id = delivery.event_id
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.phone_consultation_ready'
      and event_row.payload ->> 'track_id' = '18275200-0000-4000-8000-000000000201'
  ),
  0::bigint,
  '재시도 후에도 provider delivery는 0건이다'
);

select * from finish();

rollback;
