create extension if not exists dblink;

begin;
select no_plan();

create temp table chat_external_queue_baseline(
  customer_message_count bigint not null,
  reminder_job_count bigint not null
) on commit drop;
insert into chat_external_queue_baseline
select
  (select pg_catalog.count(*)
   from public.ops_registration_customer_messages),
  (select pg_catalog.count(*)
   from dashboard_private.registration_customer_reminder_jobs);

select has_table(
  'dashboard_private',
  'registration_observation_chat_jobs',
  'registration observation chat jobs table exists'
);
select has_function(
  'public',
  'get_registration_observation_notification_source_v1',
  array['uuid']
);
select has_function(
  'public',
  'claim_registration_observation_chat_jobs_v1',
  array['text','integer','integer']
);
select has_function(
  'public',
  'materialize_registration_observation_chat_job_v1',
  array['uuid','uuid','integer','jsonb']
);
select has_function(
  'public',
  'read_registration_observation_notification_delivery_frozen_state_v1',
  array['uuid','uuid']
);
select has_function(
  'public',
  'prepare_registration_observation_notification_delivery_v1',
  array['uuid','uuid','uuid','uuid','bigint','text','text']
);
select has_function(
  'public',
  'get_registration_observation_google_chat_readiness_v1',
  array[]::text[]
);
select has_function(
  'dashboard_private',
  'registration_observation_chat_payload_valid_v3',
  array['jsonb']
);
select has_trigger(
  'dashboard_private',
  'registration_observation_domain_events',
  'registration_observation_google_chat_materializer',
  'registration observation domain events own the chat materializer trigger'
);
select has_trigger(
  'dashboard_private',
  'notification_assignment_change_facts',
  'registration_observation_google_chat_assignment_materializer',
  'director assignment facts own the observation chat materializer trigger'
);

select is(
  (select pg_catalog.jsonb_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'dashboard_private'
     and table_name = 'registration_observation_chat_jobs'),
  pg_catalog.to_jsonb(array[
    'job_id','domain_event_id','assignment_fact_id','observation_id',
    'appointment_id','notification_revision','event_key','source_revision',
    'booking_fact_hash','reservation_snapshot_hash','current_booking_snapshot',
    'previous_booking_snapshot','preparation_snapshot','submission_snapshot',
    'mention_role','mention_profile_ids','rule_snapshot','due_at','expires_at',
    'status','attempt_count','next_attempt_at','claimed_by','claim_token',
    'lease_expires_at','materialized_event_id','last_error_code','completed_at',
    'created_at','updated_at'
  ]::text[]),
  'chat job ledger exposes the exact reviewed columns in order'
);

select is(
  (select pg_catalog.jsonb_agg(indexname order by indexname)
   from pg_catalog.pg_indexes
   where schemaname = 'dashboard_private'
     and tablename = 'registration_observation_chat_jobs'
     and indexname <> 'registration_observation_chat_jobs_pkey'),
  pg_catalog.to_jsonb(array[
    'registration_observation_chat_jobs_assignment_identity_idx',
    'registration_observation_chat_jobs_domain_identity_idx',
    'registration_observation_chat_jobs_due_claim_idx',
    'registration_observation_chat_jobs_lease_idx',
    'registration_observation_chat_jobs_observation_revision_idx',
    'registration_observation_chat_jobs_terminal_idx'
  ]::text[]),
  'chat job ledger has the exact six non-primary indexes'
);

select ok(
  (select relrowsecurity
   from pg_catalog.pg_class
   where oid = 'dashboard_private.registration_observation_chat_jobs'::regclass),
  'chat job ledger has RLS enabled'
);
select is_empty(
  $$select policyname from pg_catalog.pg_policies
    where schemaname = 'dashboard_private'
      and tablename = 'registration_observation_chat_jobs'$$,
  'chat job ledger has no direct-access policy'
);
select ok(
  (select pg_catalog.count(*) >= 12
   from pg_catalog.pg_constraint
   where conrelid = 'dashboard_private.registration_observation_chat_jobs'::regclass
     and contype in ('c','f')),
  'chat job invariants are database constraints'
);

select is_empty($$
  with expected(rule_id,event_key,audience_key,channel_key,cell_sort) as (
    values
      ('81000000-0000-4000-8000-000000000001'::uuid,'registration.observation_scheduled','subject_team','google_chat',1),
      ('81000000-0000-4000-8000-000000000002'::uuid,'registration.observation_rescheduled','subject_team','google_chat',1),
      ('81000000-0000-4000-8000-000000000003'::uuid,'registration.observation_canceled','subject_team','google_chat',1),
      ('81000000-0000-4000-8000-000000000004'::uuid,'registration.observation_reminder_due','subject_team','google_chat',1),
      ('81000000-0000-4000-8000-000000000005'::uuid,'registration.observation_feedback_due','subject_team','google_chat',1),
      ('81000000-0000-4000-8000-000000000006'::uuid,'registration.observation_feedback_submitted','management_team','google_chat',1),
      ('81000000-0000-4000-8000-000000000007'::uuid,'registration.observation_feedback_submitted','track_director','in_app',2),
      ('81000000-0000-4000-8000-000000000008'::uuid,'registration.observation_director_reassigned','management_team','google_chat',1)
  ), actual as (
    select rule.id, rule.event_key, rule.audience_key, rule.channel_key,
      registry.cell_sort
    from dashboard_private.notification_rules rule
    join dashboard_private.notification_settings_ui_registry registry
      on registry.rule_id = rule.id
    where rule.id between
      '81000000-0000-4000-8000-000000000001'::uuid and
      '81000000-0000-4000-8000-000000000008'::uuid
      and rule.scope_key = 'global'
      and rule.workflow_key = 'registration'
      and rule.rule_variant_key = 'immediate'
      and rule.delivery_mode = 'immediate'
      and rule.schedule_key is null
      and rule.schedule_config is null
      and rule.revision = 1
      and not rule.enabled
      and registry.initial_enabled = false
      and registry.configuration_kind = 'editable_rule'
      and not registry.activation_locked
  ), differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select * from differences
$$, 'the exact eight reviewed rules and registry rows are immediate and OFF');

select is(
  (select pg_catalog.jsonb_object_agg(setting.rule_id::text, setting.mention_enabled order by setting.rule_id)
   from dashboard_private.notification_rule_mention_settings setting
   where setting.rule_id between
     '81000000-0000-4000-8000-000000000001'::uuid and
     '81000000-0000-4000-8000-000000000008'::uuid),
  '{
    "81000000-0000-4000-8000-000000000001":true,
    "81000000-0000-4000-8000-000000000002":true,
    "81000000-0000-4000-8000-000000000003":false,
    "81000000-0000-4000-8000-000000000004":true,
    "81000000-0000-4000-8000-000000000005":true,
    "81000000-0000-4000-8000-000000000006":true,
    "81000000-0000-4000-8000-000000000008":true
  }'::jsonb,
  'the seven adopted mention settings preserve six ON and canceled OFF'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.notification_templates template
   join dashboard_private.notification_rules rule
     on rule.id = template.rule_id
    and rule.active_template_id = template.id
   where rule.id between
     '81000000-0000-4000-8000-000000000001'::uuid and
     '81000000-0000-4000-8000-000000000008'::uuid
     and template.version = 1
     and template.payload_schema_version = 3
     and template.content_contract_version = '1'
     and template.checksum ~ '^[a-f0-9]{64}$'),
  8::bigint,
  'all eight rules own one active immutable schema-v3 template'
);
select is(
  (select pg_catalog.count(*)
   from dashboard_private.notification_rule_content_contracts contract
   where contract.rule_id between
     '81000000-0000-4000-8000-000000000001'::uuid and
     '81000000-0000-4000-8000-000000000008'::uuid
     and contract.contract_version = '1'
     and contract.contract_json -> 'supportedPayloadVersions' = '[3]'::jsonb
     and contract.contract_json -> 'freeTextVisibility' = '{}'::jsonb
     and contract.contract_json -> 'freeTextPriority' = '[]'::jsonb),
  8::bigint,
  'all eight rule content contracts are schema-v3 and free-text closed'
);
select is_empty($$
  select rule.id
  from dashboard_private.notification_rules rule
  left join dashboard_private.notification_rule_content_contracts contract
    on contract.rule_id = rule.id
  where rule.id between
    '81000000-0000-4000-8000-000000000001'::uuid and
    '81000000-0000-4000-8000-000000000008'::uuid
    and (
      rule.event_key = 'google_chat.executive'
      or rule.channel_key = 'google_chat.executive'
      or contract.contract_json::text ~* '(phone|school|inquiry|suitability|feedback.reason|url|uuid)'
    )
$$, 'observation contracts contain no executive destination or private fields');

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_rules rule_row
    where rule_row.workflow_key = 'registration'
      and rule_row.event_key like 'registration.observation_%'
  ),
  8::bigint,
  'exactly eight observation destination rules are installed'
);

select is_empty($$
  select variable.item ->> 'key'
  from dashboard_private.notification_templates template_row
  join dashboard_private.notification_rules rule_row
    on rule_row.id = template_row.rule_id
  cross join lateral pg_catalog.jsonb_array_elements(template_row.allowed_variables) variable(item)
  where rule_row.workflow_key = 'registration'
    and rule_row.event_key like 'registration.observation_%'
    and variable.item ->> 'key' in ('phone','school','inquiry','suitability','feedback_reason','url','uuid')
$$, 'observation templates expose no forbidden variable key');

select is_empty($$
  select variable.item ->> 'key'
  from dashboard_private.notification_templates template_row
  join dashboard_private.notification_rules rule_row
    on rule_row.id = template_row.rule_id
  cross join lateral pg_catalog.jsonb_array_elements(template_row.allowed_variables) variable(item)
  where rule_row.workflow_key = 'registration'
    and rule_row.event_key = 'registration.observation_feedback_submitted'
    and variable.item ->> 'key' in ('suitability','feedback_reason','result','reason')
$$, 'feedback submitted exposes no result or reason token');

select is_empty($$
  with expected(
    event_key,audience_key,channel_key,rule_variant_key,payload_schema_version,required_tokens,allowed_variables
  ) as (
    values
      ('registration.observation_scheduled','subject_team','google_chat','immediate',3,
       '["학생","과목","수업","일정","담당선생님","강의실","교재","진도"]'::jsonb,
       '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"},{"key":"teacher_name","token":"담당선생님","pii_class":"staff_name"},{"key":"classroom","token":"강의실","pii_class":"location"},{"key":"textbooks","token":"교재","pii_class":"none"},{"key":"progress","token":"진도","pii_class":"none"}]'::jsonb),
      ('registration.observation_rescheduled','subject_team','google_chat','immediate',3,
       '["학생","과목","수업","기존일정","일정","담당선생님","강의실","교재","진도"]'::jsonb,
       '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"before_schedule","token":"기존일정","pii_class":"schedule"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"},{"key":"teacher_name","token":"담당선생님","pii_class":"staff_name"},{"key":"classroom","token":"강의실","pii_class":"location"},{"key":"textbooks","token":"교재","pii_class":"none"},{"key":"progress","token":"진도","pii_class":"none"}]'::jsonb),
      ('registration.observation_canceled','subject_team','google_chat','immediate',3,
       '["학생","과목","수업","일정"]'::jsonb,
       '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"}]'::jsonb),
      ('registration.observation_reminder_due','subject_team','google_chat','immediate',3,
       '["학생","과목","수업","일정","담당선생님","강의실","교재","진도"]'::jsonb,
       '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"},{"key":"teacher_name","token":"담당선생님","pii_class":"staff_name"},{"key":"classroom","token":"강의실","pii_class":"location"},{"key":"textbooks","token":"교재","pii_class":"none"},{"key":"progress","token":"진도","pii_class":"none"}]'::jsonb),
      ('registration.observation_feedback_due','subject_team','google_chat','immediate',3,
       '["학생","과목","수업","일정","담당선생님","강의실"]'::jsonb,
       '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"scheduled_at","token":"일정","pii_class":"schedule"},{"key":"teacher_name","token":"담당선생님","pii_class":"staff_name"},{"key":"classroom","token":"강의실","pii_class":"location"}]'::jsonb),
      ('registration.observation_feedback_submitted','management_team','google_chat','immediate',3,
       '["학생","과목","수업","제출자","제출시각"]'::jsonb,
       '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"submitted_by_name","token":"제출자","pii_class":"staff_name"},{"key":"submitted_at","token":"제출시각","pii_class":"schedule"}]'::jsonb),
      ('registration.observation_feedback_submitted','track_director','in_app','immediate',3,
       '["학생","과목","수업","제출자","제출시각"]'::jsonb,
       '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"},{"key":"submitted_by_name","token":"제출자","pii_class":"staff_name"},{"key":"submitted_at","token":"제출시각","pii_class":"schedule"}]'::jsonb),
      ('registration.observation_director_reassigned','management_team','google_chat','immediate',3,
       '["학생","과목","수업"]'::jsonb,
       '[{"key":"student_name","token":"학생","pii_class":"student_name"},{"key":"subjects","token":"과목","pii_class":"none"},{"key":"class_name","token":"수업","pii_class":"class_name"}]'::jsonb)
  ), actual as (
    select
      rule_row.event_key,
      rule_row.audience_key,
      rule_row.channel_key,
      rule_row.rule_variant_key,
      template_row.payload_schema_version,
      contract_row.contract_json -> 'requiredTokens' as required_tokens,
      template_row.allowed_variables
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates template_row
      on template_row.id = rule_row.active_template_id
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
    where rule_row.workflow_key = 'registration'
      and rule_row.event_key like 'registration.observation_%'
      and template_row.checksum = dashboard_private.notification_seed_template_checksum_v1(
        template_row.title_template,
        template_row.body_template,
        template_row.allowed_variables,
        template_row.payload_schema_version
      )
  ), differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select * from differences
$$, 'all eight observation contracts preserve exact schema-v3 Korean variable and checksum rows');

select is_empty($$
  with expected(event_key, audience_key, channel_key, title_template, body_template) as (
    values
      ('registration.observation_scheduled', 'subject_team', 'google_chat', '[청강 예약] {학생}', E'학생: {학생}\n과목/수업: [{과목}] {수업}\n일시: {일정}\n담당 선생님: {담당선생님}\n강의실: {강의실}\n교재: {교재}\n진도: {진도}\n교재 복사 등 청강 준비가 필요합니다.'),
      ('registration.observation_rescheduled', 'subject_team', 'google_chat', '[청강 일정 변경] {학생}', E'학생: {학생}\n과목/수업: [{과목}] {수업}\n이전 일정: {기존일정}\n변경 일정: {일정}\n담당 선생님: {담당선생님}\n강의실: {강의실}\n교재: {교재}\n진도: {진도}\n변경된 일정에 맞춰 청강 준비가 필요합니다.'),
      ('registration.observation_canceled', 'subject_team', 'google_chat', '[청강 취소] {학생}', E'학생: {학생}\n과목/수업: [{과목}] {수업}\n취소 일정: {일정}\n청강 예약이 취소되었습니다.'),
      ('registration.observation_reminder_due', 'subject_team', 'google_chat', '[오늘 청강 준비] {학생}', E'오늘 청강이 예정되어 있습니다.\n학생: {학생}\n과목/수업: [{과목}] {수업}\n일시: {일정}\n담당 선생님: {담당선생님}\n강의실: {강의실}\n교재: {교재}\n진도: {진도}\n교재 복사 등 준비 내용을 확인해 주세요.'),
      ('registration.observation_feedback_due', 'subject_team', 'google_chat', '[청강 피드백 요청] {학생}', E'청강은 어땠나요? 적합 여부와 사유를 입력해 주세요.\n학생: {학생}\n과목/수업: [{과목}] {수업}\n수업 일시: {일정}\n담당 선생님: {담당선생님}\n강의실: {강의실}'),
      ('registration.observation_feedback_submitted', 'management_team', 'google_chat', '[청강 피드백 등록] {학생}', E'청강 피드백이 등록되었습니다.\n학생: {학생}\n과목/수업: [{과목}] {수업}\n제출자: {제출자}\n제출시각: {제출시각}'),
      ('registration.observation_feedback_submitted', 'track_director', 'in_app', '[청강 피드백 등록] {학생}', E'청강 피드백이 등록되었습니다.\n학생: {학생}\n과목/수업: [{과목}] {수업}\n제출자: {제출자}\n제출시각: {제출시각}'),
      ('registration.observation_director_reassigned', 'management_team', 'google_chat', '[청강 담당 원장 변경] {학생}', E'학생: {학생}\n과목/수업: [{과목}] {수업}\n담당 원장이 변경되었습니다.')
  ), actual as (
    select
      rule_row.event_key,
      rule_row.audience_key,
      rule_row.channel_key,
      template_row.title_template,
      template_row.body_template
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates template_row
      on template_row.id = rule_row.active_template_id
    where rule_row.workflow_key = 'registration'
      and rule_row.event_key like 'registration.observation_%'
  ), differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select * from differences
$$, 'all eight observation active templates preserve exact Korean golden title and body rows');

create temp table chat_contract_samples(
  current_booking jsonb not null,
  previous_booking jsonb not null,
  job_current_booking jsonb not null,
  job_previous_booking jsonb not null,
  preparation jsonb not null,
  submission jsonb not null,
  scheduled_payload jsonb not null
) on commit drop;

insert into chat_contract_samples
select
  current_booking,
  previous_booking,
  pg_catalog.jsonb_build_object(
    'campus', current_booking ->> 'campus',
    'classId', current_booking ->> 'class_id',
    'classLessonSessionId', current_booking ->> 'class_lesson_session_id',
    'className', current_booking ->> 'class_name',
    'classroomCatalogId', '91000000-0000-4000-8000-000000000011',
    'classroomName', current_booking ->> 'classroom_name',
    'endsAt', current_booking ->> 'ends_at',
    'legacySessionKey', current_booking ->> 'legacy_session_key',
    'scheduleState', current_booking ->> 'schedule_state',
    'sessionAuthority', current_booking ->> 'session_authority',
    'startsAt', current_booking ->> 'starts_at',
    'teacherCatalogId', '91000000-0000-4000-8000-000000000012',
    'teacherName', current_booking ->> 'teacher_name',
    'teacherProfileId', '91000000-0000-4000-8000-000000000006'
  ),
  pg_catalog.jsonb_build_object(
    'campus', previous_booking ->> 'campus',
    'classId', previous_booking ->> 'class_id',
    'classLessonSessionId', previous_booking ->> 'class_lesson_session_id',
    'className', previous_booking ->> 'class_name',
    'classroomCatalogId', '91000000-0000-4000-8000-000000000011',
    'classroomName', previous_booking ->> 'classroom_name',
    'endsAt', previous_booking ->> 'ends_at',
    'legacySessionKey', previous_booking ->> 'legacy_session_key',
    'scheduleState', previous_booking ->> 'schedule_state',
    'sessionAuthority', previous_booking ->> 'session_authority',
    'startsAt', previous_booking ->> 'starts_at',
    'teacherCatalogId', '91000000-0000-4000-8000-000000000012',
    'teacherName', previous_booking ->> 'teacher_name',
    'teacherProfileId', '91000000-0000-4000-8000-000000000006'
  ),
  '{"textbookNames":["능률 VOCA"],"progressSummary":"42~49쪽"}'::jsonb,
  '{"submittedByName":"청강 선생님","submittedAt":"2026-08-17T12:00:00Z"}'::jsonb,
  pg_catalog.jsonb_build_object(
    'task_id','91000000-0000-4000-8000-000000000001',
    'track_id','91000000-0000-4000-8000-000000000002',
    'observation_id','91000000-0000-4000-8000-000000000003',
    'appointment_id','91000000-0000-4000-8000-000000000004',
    'appointment_notification_revision',1,
    'student_name','청강 검증','subject','영어',
    'source_revision',jsonb_build_object(
      'authority','normalized','sessionId','91000000-0000-4000-8000-000000000005','revision',7
    ),
    'booking_fact_hash',repeat('a',64),
    'occurred_at','2026-08-17T08:00:00Z',
    'delivery_expires_at','2026-08-18T08:00:00Z',
    'mention_role','subject_teacher',
    'mention_profile_ids',jsonb_build_array('91000000-0000-4000-8000-000000000006'),
    'event_kind','registration.observation_scheduled',
    'booking',current_booking,
    'textbook_names',jsonb_build_array('능률 VOCA'),
    'progress_summary','42~49쪽'
  )
from (
  select
    '{
      "class_id":"91000000-0000-4000-8000-000000000010",
      "class_name":"중2 영어 A반",
      "session_authority":"normalized",
      "class_lesson_session_id":"91000000-0000-4000-8000-000000000005",
      "legacy_session_key":null,
      "schedule_state":"active",
      "starts_at":"2026-08-17T09:00:00Z",
      "ends_at":"2026-08-17T11:00:00Z",
      "teacher_name":"홍길동",
      "classroom_name":"301호",
      "campus":"본관"
    }'::jsonb as current_booking,
    '{
      "class_id":"91000000-0000-4000-8000-000000000010",
      "class_name":"중2 영어 A반",
      "session_authority":"normalized",
      "class_lesson_session_id":"91000000-0000-4000-8000-000000000005",
      "legacy_session_key":null,
      "schedule_state":"active",
      "starts_at":"2026-08-16T09:00:00Z",
      "ends_at":"2026-08-16T11:00:00Z",
      "teacher_name":"홍길동",
      "classroom_name":"301호",
      "campus":"본관"
    }'::jsonb as previous_booking
) samples;

select ok(
  dashboard_private.registration_observation_chat_source_revision_valid_v1(
    '{"authority":"normalized","sessionId":"91000000-0000-4000-8000-000000000005","revision":7}'::jsonb
  ),
  'normalized tagged source revision is accepted'
);
select ok(
  dashboard_private.registration_observation_chat_source_revision_valid_v1(
    '{"authority":"legacy","sessionKey":"2026-08-17|09:00","contentHash":"abc"}'::jsonb
  ),
  'legacy tagged source revision is accepted'
);
select ok(
  not dashboard_private.registration_observation_chat_source_revision_valid_v1(
    '{"authority":"normalized","sessionId":"91000000-0000-4000-8000-000000000005","revision":7,"extra":true}'::jsonb
  ),
  'source revision rejects an extra key'
);
select ok(
  not dashboard_private.registration_observation_chat_source_revision_valid_v1(
    '{"authority":"normalized","sessionId":"91000000-0000-4000-8000-000000000005","revision":null}'::jsonb
  ),
  'source revision rejects JSON null'
);
select ok(
  dashboard_private.registration_observation_chat_payload_booking_valid_v1(
    (select current_booking from chat_contract_samples)
  ),
  'exact normalized booking presentation is accepted'
);
select ok(
  dashboard_private.registration_observation_chat_payload_booking_valid_v1(
    (select current_booking || '{"session_authority":"legacy","class_lesson_session_id":null,"legacy_session_key":"2026-08-17|09:00"}'::jsonb
     from chat_contract_samples)
  ),
  'exact legacy booking presentation is accepted'
);
select ok(
  not dashboard_private.registration_observation_chat_payload_booking_valid_v1(
    (select current_booking || '{"phone":"01000000000"}'::jsonb
     from chat_contract_samples)
  ),
  'booking presentation rejects extra private data'
);
select ok(
  not dashboard_private.registration_observation_chat_payload_booking_valid_v1(
    (select pg_catalog.jsonb_set(current_booking,'{class_name}','123'::jsonb)
     from chat_contract_samples)
  ),
  'booking presentation rejects a non-string class name'
);
select is(
  dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
    'registration.observation_scheduled',
    (select job_current_booking from chat_contract_samples),
    null
  ),
  dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
    'registration.observation_scheduled',
    (select pg_catalog.jsonb_object_agg(key,value order by key desc)
     from chat_contract_samples,
     lateral pg_catalog.jsonb_each(job_current_booking)),
    null
  ),
  'reservation hash is deterministic across object key order'
);
select isnt(
  dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
    'registration.observation_scheduled',
    (select job_current_booking from chat_contract_samples),
    null
  ),
  dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
    'registration.observation_scheduled',
    (select job_current_booking || '{"className":"changed"}'::jsonb
     from chat_contract_samples),
    null
  ),
  'reservation hash changes when one booking byte changes'
);
select is(
  (select pg_catalog.count(*)
   from chat_contract_samples sample
   cross join lateral (values
     ('registration.observation_scheduled', sample.job_current_booking, null::jsonb, sample.preparation, null::jsonb, 'subject_teacher'),
     ('registration.observation_rescheduled', sample.job_current_booking, sample.job_previous_booking, sample.preparation, null::jsonb, 'subject_teacher'),
     ('registration.observation_canceled', sample.job_current_booking, null::jsonb, null::jsonb, null::jsonb, 'subject_teacher'),
     ('registration.observation_reminder_due', sample.job_current_booking, null::jsonb, sample.preparation, null::jsonb, 'subject_teacher'),
     ('registration.observation_feedback_due', sample.job_current_booking, null::jsonb, null::jsonb, null::jsonb, 'subject_teacher'),
     ('registration.observation_feedback_submitted', sample.job_current_booking, null::jsonb, null::jsonb, sample.submission, 'track_director'),
     ('registration.observation_director_reassigned', sample.job_current_booking, null::jsonb, null::jsonb, null::jsonb, 'track_director')
   ) accepted(event_key,current_booking,previous_booking,preparation,submission,mention_role)
   where dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
     accepted.event_key, accepted.current_booking, accepted.previous_booking,
     accepted.preparation, accepted.submission, accepted.mention_role,
     array['91000000-0000-4000-8000-000000000006'::uuid]
   )),
  7::bigint,
  'all seven event-specific job snapshot unions are accepted'
);
select ok(
  not dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
    'registration.observation_scheduled',
    (select job_current_booking from chat_contract_samples), null,
    (select preparation from chat_contract_samples), null,
    'subject_teacher',
    array[
      '91000000-0000-4000-8000-000000000006'::uuid,
      '91000000-0000-4000-8000-000000000006'::uuid
    ]
  ),
  'job snapshot rejects duplicate mention profile IDs'
);
select ok(
  not dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
    'registration.observation_feedback_submitted',
    (select job_current_booking from chat_contract_samples), null, null,
    (select submission from chat_contract_samples),
    'subject_teacher', array[]::uuid[]
  ),
  'job snapshot rejects the wrong semantic mention role'
);
select ok(
  not dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
    'registration.observation_scheduled',
    (select pg_catalog.jsonb_set(job_current_booking,'{className}','123'::jsonb)
     from chat_contract_samples),
    null,(select preparation from chat_contract_samples),null,
    'subject_teacher',array[]::uuid[]
  ),
  'job snapshot rejects a non-string booking name'
);
select ok(
  not dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
    'registration.observation_scheduled',
    (select job_current_booking from chat_contract_samples),null,
    '{"textbookNames":[{"title":"능률 VOCA"}],"progressSummary":"42~49쪽"}'::jsonb,
    null,'subject_teacher',array[]::uuid[]
  ),
  'job snapshot rejects non-string textbook elements'
);
select ok(
  not dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
    'registration.observation_scheduled',
    (select job_current_booking from chat_contract_samples),null,
    '{"textbookNames":["능률 VOCA"],"progressSummary":null}'::jsonb,
    null,'subject_teacher',array[]::uuid[]
  ),
  'job snapshot rejects a null progress summary'
);
select ok(
  not dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
    'registration.observation_feedback_submitted',
    (select job_current_booking from chat_contract_samples),null,null,
    '{"submittedByName":"청강 선생님","submittedAt":"not-a-time"}'::jsonb,
    'track_director',array[]::uuid[]
  ),
  'job snapshot rejects an invalid submission timestamp'
);
select ok(
  dashboard_private.registration_observation_chat_payload_valid_v3(
    (select scheduled_payload from chat_contract_samples)
  ),
  'exact scheduled payload-v3 union is accepted'
);
select ok(
  not dashboard_private.registration_observation_chat_payload_valid_v3(
    (select scheduled_payload || '{"phone":"01000000000"}'::jsonb
     from chat_contract_samples)
  ),
  'payload-v3 rejects an injected private key'
);
select ok(
  not dashboard_private.registration_observation_chat_payload_valid_v3(
    (select scheduled_payload || jsonb_build_object(
      'mention_profile_ids', jsonb_build_array(
        '91000000-0000-4000-8000-000000000006',
        '91000000-0000-4000-8000-000000000006'
      )
    ) from chat_contract_samples)
  ),
  'payload-v3 rejects duplicate semantic profiles'
);
select ok(
  not dashboard_private.registration_observation_chat_payload_valid_v3(
    (select pg_catalog.jsonb_set(scheduled_payload,'{student_name}','123'::jsonb)
     from chat_contract_samples)
  ),
  'payload-v3 rejects a non-string student name'
);
select ok(
  not dashboard_private.registration_observation_chat_payload_valid_v3(
    (select pg_catalog.jsonb_set(
      scheduled_payload,'{textbook_names}','[{"title":"능률 VOCA"}]'::jsonb
    ) from chat_contract_samples)
  ),
  'payload-v3 rejects non-string textbook elements'
);
select ok(
  not dashboard_private.registration_observation_chat_payload_valid_v3(
    (select pg_catalog.jsonb_set(scheduled_payload,'{progress_summary}','42'::jsonb)
     from chat_contract_samples)
  ),
  'payload-v3 rejects a non-string progress summary'
);
select ok(
  not dashboard_private.registration_observation_chat_payload_valid_v3(
    (select (scheduled_payload - 'textbook_names' - 'progress_summary') ||
      pg_catalog.jsonb_build_object(
        'event_kind','registration.observation_feedback_submitted',
        'mention_role','track_director',
        'submitted_by_name','청강 선생님',
        'submitted_at',123
      ) from chat_contract_samples)
  ),
  'payload-v3 rejects a non-string submission timestamp'
);

select is(
  (select pg_catalog.count(*)
   from pg_catalog.pg_proc proc
   join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
   where namespace.nspname = 'public'
     and proc.proname in (
       'get_registration_observation_notification_source_v1',
       'claim_registration_observation_chat_jobs_v1',
       'finish_registration_observation_chat_job_v1',
       'reap_registration_observation_chat_job_leases_v1',
       'materialize_registration_observation_chat_job_v1',
       'read_registration_observation_notification_delivery_frozen_state_v1',
       'refresh_registration_observation_notification_delivery_v1',
       'prepare_registration_observation_notification_delivery_v1',
       'record_notification_worker_heartbeat_v1',
       'get_registration_observation_google_chat_readiness_v1'
     )
     and proc.prosecdef
     and proc.proowner = (select oid from pg_catalog.pg_roles where rolname = 'postgres')
     and proc.proconfig && array['search_path=','search_path=""']::text[]),
  10::bigint,
  'all ten public worker functions are postgres-owned definers with empty search path'
);
select is_empty($$
  select proc.oid::regprocedure
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'dashboard_private'
    and proc.proname like 'registration_observation_chat%'
    and (
      proc.prosecdef
      or has_function_privilege('service_role', proc.oid, 'EXECUTE')
      or has_function_privilege('authenticated', proc.oid, 'EXECUTE')
      or has_function_privilege('anon', proc.oid, 'EXECUTE')
    )
$$, 'private observation chat helpers are invokers with no API execute grant');
select ok(
  has_function_privilege(
    'service_role',
    'public.get_registration_observation_google_chat_readiness_v1()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.get_registration_observation_google_chat_readiness_v1()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.get_registration_observation_google_chat_readiness_v1()',
    'EXECUTE'
  ),
  'readiness execute is service-role only'
);
select is(
  (select pg_catalog.count(*)
   from pg_catalog.pg_proc proc
   join pg_catalog.pg_namespace namespace on namespace.oid=proc.pronamespace
   where namespace.nspname='public'
     and proc.proname in (
       'get_registration_observation_notification_source_v1',
       'claim_registration_observation_chat_jobs_v1',
       'finish_registration_observation_chat_job_v1',
       'reap_registration_observation_chat_job_leases_v1',
       'materialize_registration_observation_chat_job_v1',
       'read_registration_observation_notification_delivery_frozen_state_v1',
       'refresh_registration_observation_notification_delivery_v1',
       'prepare_registration_observation_notification_delivery_v1',
       'record_notification_worker_heartbeat_v1',
       'get_registration_observation_google_chat_readiness_v1'
     )
     and has_function_privilege('service_role',proc.oid,'EXECUTE')
     and not has_function_privilege('anon',proc.oid,'EXECUTE')
     and not has_function_privilege('authenticated',proc.oid,'EXECUTE')),
  10::bigint,
  'all ten observation worker wrappers have exact service-only execute ACLs'
);

set local role anon;
select pg_catalog.set_config('request.jwt.claim.role','anon',true);
select throws_ok(
  invocation.sql,
  '42501',null,
  'anon cannot execute observation wrapper: ' || invocation.name
)
from (values
  ('source',
   $$select public.get_registration_observation_notification_source_v1(
     '00000000-0000-0000-0000-000000000001'::uuid)$$),
  ('claim',
   $$select * from public.claim_registration_observation_chat_jobs_v1('x',1,60)$$),
  ('finish',
   $$select public.finish_registration_observation_chat_job_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,'failed','worker_lost_after_claim',null)$$),
  ('reap',
   $$select public.reap_registration_observation_chat_job_leases_v1('x',1)$$),
  ('materialize',
   $$select public.materialize_registration_observation_chat_job_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,3,'{}'::jsonb)$$),
  ('frozen-read',
   $$select public.read_registration_observation_notification_delivery_frozen_state_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid)$$),
  ('refresh',
   $$select public.refresh_registration_observation_notification_delivery_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,
     '00000000-0000-0000-0000-000000000003'::uuid,
     '00000000-0000-0000-0000-000000000004'::uuid,1,
     'x','x',null,'{}'::jsonb,repeat('a',64),repeat('b',64))$$),
  ('prepare',
   $$select public.prepare_registration_observation_notification_delivery_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,
     '00000000-0000-0000-0000-000000000003'::uuid,
     '00000000-0000-0000-0000-000000000004'::uuid,1,
     repeat('a',64),repeat('b',64))$$),
  ('heartbeat',
   $$select public.record_notification_worker_heartbeat_v1(
     'x','00000000-0000-0000-0000-000000000001'::uuid,
     'started','{}'::jsonb,null)$$),
  ('readiness',
   $$select public.get_registration_observation_google_chat_readiness_v1()$$)
) invocation(name,sql);
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
select throws_ok(
  invocation.sql,
  '42501',null,
  'authenticated cannot execute observation wrapper: ' || invocation.name
)
from (values
  ('source',
   $$select public.get_registration_observation_notification_source_v1(
     '00000000-0000-0000-0000-000000000001'::uuid)$$),
  ('claim',
   $$select * from public.claim_registration_observation_chat_jobs_v1('x',1,60)$$),
  ('finish',
   $$select public.finish_registration_observation_chat_job_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,'failed','worker_lost_after_claim',null)$$),
  ('reap',
   $$select public.reap_registration_observation_chat_job_leases_v1('x',1)$$),
  ('materialize',
   $$select public.materialize_registration_observation_chat_job_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,3,'{}'::jsonb)$$),
  ('frozen-read',
   $$select public.read_registration_observation_notification_delivery_frozen_state_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid)$$),
  ('refresh',
   $$select public.refresh_registration_observation_notification_delivery_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,
     '00000000-0000-0000-0000-000000000003'::uuid,
     '00000000-0000-0000-0000-000000000004'::uuid,1,
     'x','x',null,'{}'::jsonb,repeat('a',64),repeat('b',64))$$),
  ('prepare',
   $$select public.prepare_registration_observation_notification_delivery_v1(
     '00000000-0000-0000-0000-000000000001'::uuid,
     '00000000-0000-0000-0000-000000000002'::uuid,
     '00000000-0000-0000-0000-000000000003'::uuid,
     '00000000-0000-0000-0000-000000000004'::uuid,1,
     repeat('a',64),repeat('b',64))$$),
  ('heartbeat',
   $$select public.record_notification_worker_heartbeat_v1(
     'x','00000000-0000-0000-0000-000000000001'::uuid,
     'started','{}'::jsonb,null)$$),
  ('readiness',
   $$select public.get_registration_observation_google_chat_readiness_v1()$$)
) invocation(name,sql);
reset role;

select ok(
  has_table_privilege('service_role','dashboard_private.notification_deliveries','SELECT')
  and not has_table_privilege('service_role','dashboard_private.notification_deliveries','INSERT')
  and not has_table_privilege('service_role','dashboard_private.notification_deliveries','UPDATE')
  and not has_table_privilege('service_role','dashboard_private.notification_deliveries','DELETE'),
  'service role has SELECT-only delivery inspection'
);
select ok(
  has_table_privilege('service_role','dashboard_private.notification_dispatch_ownership_claims','SELECT')
  and not has_table_privilege('service_role','dashboard_private.notification_dispatch_ownership_claims','INSERT')
  and not has_table_privilege('service_role','dashboard_private.notification_dispatch_ownership_claims','UPDATE')
  and not has_table_privilege('service_role','dashboard_private.notification_dispatch_ownership_claims','DELETE'),
  'service role has SELECT-only ownership inspection'
);
select is_empty($$
  select grantee, table_name, privilege_type
  from information_schema.role_table_grants
  where grantee in ('PUBLIC','anon','authenticated')
    and table_schema = 'dashboard_private'
    and table_name in (
      'registration_observation_chat_jobs',
      'notification_deliveries',
      'notification_dispatch_ownership_claims'
    )
$$, 'browser roles have no direct chat-job, delivery, or ownership privilege');

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select throws_ok(
  $$insert into dashboard_private.notification_deliveries default values$$,
  '42501', null, 'service role cannot directly insert deliveries'
);
select throws_ok(
  $$update dashboard_private.notification_deliveries set updated_at = updated_at where false$$,
  '42501', null, 'service role cannot directly update deliveries'
);
select throws_ok(
  $$delete from dashboard_private.notification_deliveries where false$$,
  '42501', null, 'service role cannot directly delete deliveries'
);
select throws_ok(
  $$insert into dashboard_private.notification_dispatch_ownership_claims default values$$,
  '42501', null, 'service role cannot directly insert ownership rows'
);
select throws_ok(
  $$update dashboard_private.notification_dispatch_ownership_claims set updated_at = updated_at where false$$,
  '42501', null, 'service role cannot directly update ownership rows'
);
select throws_ok(
  $$delete from dashboard_private.notification_dispatch_ownership_claims where false$$,
  '42501', null, 'service role cannot directly delete ownership rows'
);
reset role;

delete from dashboard_private.notification_worker_heartbeats
where worker_id = 'notification-worker-route-v1';

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
select throws_ok(
  $$select public.get_registration_observation_google_chat_readiness_v1()$$,
  '42501', null, 'authenticated cannot execute service readiness'
);
reset role;

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select is(
  (select pg_catalog.jsonb_agg(key order by key)
   from pg_catalog.jsonb_object_keys(
     public.get_registration_observation_google_chat_readiness_v1()
   ) key),
  '["claimedCount","enabledRuleCount","failedCount","latestObservationHeartbeatAt","materializedCount","oldestPendingAt","pendingCount","recentObservationHeartbeat","ruleCount","schemaVersion","sourceDirtyCount","suppressedCount","triggerInstalled"]'::jsonb,
  'readiness exposes only its exact aggregate keys'
);
select is(
  pg_catalog.jsonb_build_object(
    'latest', public.get_registration_observation_google_chat_readiness_v1()
      -> 'latestObservationHeartbeatAt',
    'recent', public.get_registration_observation_google_chat_readiness_v1()
      -> 'recentObservationHeartbeat',
    'rules', public.get_registration_observation_google_chat_readiness_v1()
      -> 'ruleCount',
    'enabled', public.get_registration_observation_google_chat_readiness_v1()
      -> 'enabledRuleCount'
  ),
  '{"latest":null,"recent":false,"rules":8,"enabled":0}'::jsonb,
  'readiness starts with no heartbeat and eight disabled rules'
);
select throws_ok(
  $$select public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1',
    '93000000-0000-4000-8000-000000000001',
    'started',
    '{"observation_due":-1,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
    null
  )$$,
  '22023','notification_worker_heartbeat_invalid',
  'heartbeat rejects a negative observation count before insert'
);
select throws_ok(
  $$select public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1',
    '93000000-0000-4000-8000-000000000001',
    null,
    '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
    null
  )$$,
  '22023','notification_worker_heartbeat_invalid',
  'heartbeat rejects a null phase at the RPC boundary'
);
select throws_ok(
  $$select public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1',
    '93000000-0000-4000-8000-000000000002',
    'succeeded',
    '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
    null
  )$$,
  '55000','notification_worker_heartbeat_start_missing',
  'heartbeat success requires a matching start row'
);
select lives_ok($$
  select public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1',
    '93000000-0000-4000-8000-000000000003',
    'started',
    '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
    null
  )
$$, 'heartbeat accepts the exact six-key started shape');
select lives_ok($$
  select public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1',
    '93000000-0000-4000-8000-000000000003',
    'succeeded',
    '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
    null
  )
$$, 'heartbeat accepts the matching succeeded receipt');
select throws_ok($$
  select public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1',
    '93000000-0000-4000-8000-000000000003',
    'failed',
    '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
    'late_failure'
  )
$$,'40001','notification_worker_heartbeat_conflict',
  'a succeeded run cannot append an opposite failed terminal receipt');
reset role;

update dashboard_private.notification_worker_heartbeats
set created_at = pg_catalog.clock_timestamp() - interval '5 minutes 1 second'
where run_id = '93000000-0000-4000-8000-000000000003';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select is(
  (public.get_registration_observation_google_chat_readiness_v1()
    ->> 'recentObservationHeartbeat')::boolean,
  false,
  'a succeeded heartbeat older than five minutes is stale'
);
select public.record_notification_worker_heartbeat_v1(
  'notification-worker-route-v1',
  '93000000-0000-4000-8000-000000000004',
  'started',
  '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null
);
select public.record_notification_worker_heartbeat_v1(
  'notification-worker-route-v1',
  '93000000-0000-4000-8000-000000000004',
  'succeeded',
  '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null
);
reset role;
update dashboard_private.notification_worker_heartbeats
set created_at = pg_catalog.clock_timestamp() - case phase
  when 'started' then interval '4 minutes 59 seconds'
  else interval '4 minutes 58 seconds'
end
where run_id = '93000000-0000-4000-8000-000000000004';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select is(
  (public.get_registration_observation_google_chat_readiness_v1()
    ->> 'recentObservationHeartbeat')::boolean,
  true,
  'the latest current succeeded heartbeat is recent'
);
select public.record_notification_worker_heartbeat_v1(
  'notification-worker-route-v1',
  '93000000-0000-4000-8000-000000000005',
  'started',
  '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null
);
select public.record_notification_worker_heartbeat_v1(
  'notification-worker-route-v1',
  '93000000-0000-4000-8000-000000000005',
  'failed',
  '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  'synthetic_failure'
);
reset role;
update dashboard_private.notification_worker_heartbeats
set created_at = pg_catalog.clock_timestamp() - case phase
  when 'started' then interval '2 seconds'
  else interval '1 second'
end
where run_id = '93000000-0000-4000-8000-000000000005';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select is(
  (public.get_registration_observation_google_chat_readiness_v1()
    ->> 'recentObservationHeartbeat')::boolean,
  false,
  'a newer current failed heartbeat overrides an older success'
);
select public.record_notification_worker_heartbeat_v1(
  'notification-worker-route-v1',
  '93000000-0000-4000-8000-000000000006',
  'started',
  '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null
);
select public.record_notification_worker_heartbeat_v1(
  'notification-worker-route-v1',
  '93000000-0000-4000-8000-000000000006',
  'failed',
  '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  'synthetic_failure'
);
select throws_ok($$
  select public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1',
    '93000000-0000-4000-8000-000000000006',
    'succeeded',
    '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
    null
  )
$$,'40001','notification_worker_heartbeat_conflict',
  'a failed run cannot append an opposite succeeded terminal receipt');
select is_empty(
  $$select * from public.claim_registration_observation_chat_jobs_v1(
    'google-chat-contract-empty',1,30
  )$$,
  'service claim safely returns no row before lifecycle fixtures'
);
reset role;

create temp table chat_lifecycle_clock(
  session_date date not null,
  start_time time not null,
  end_time time not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occurred_at timestamptz not null
) on commit drop;
insert into chat_lifecycle_clock
select
  local_start::date,
  local_start::time,
  local_end::time,
  local_start at time zone 'Asia/Seoul',
  local_end at time zone 'Asia/Seoul',
  (local_start at time zone 'Asia/Seoul') - interval '3 hours'
from (
  select local_start,
    least(
      local_start + interval '2 hours',
      pg_catalog.date_trunc('day', local_start) + interval '23 hours 59 minutes'
    ) as local_end
  from (
    select pg_catalog.date_trunc(
      'minute', pg_catalog.clock_timestamp() at time zone 'Asia/Seoul'
    ) + interval '3 hours' as local_start
  ) raw_clock
) clock;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '94000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','chat-contract-teacher@example.invalid',
  crypt('chat-contract-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  now(),now()
);
insert into public.profiles(id,role,name,email,created_at,updated_at)
values (
  '94000000-0000-4000-8000-000000000001','admin','청강 계약 선생님',
  'chat-contract-teacher@example.invalid',now(),now()
)
on conflict (id) do update set
  role=excluded.role,name=excluded.name,email=excluded.email,updated_at=excluded.updated_at;
delete from public.teacher_catalogs
where profile_id = '94000000-0000-4000-8000-000000000001';
insert into public.teacher_catalogs(
  id,name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role
)
values (
  '94000000-0000-4000-8000-000000000101','청강 계약 선생님',
  array['영어']::text[],true,9941,
  '94000000-0000-4000-8000-000000000001',
  'chat-contract-teacher@example.invalid','teacher'
);
update public.profiles
set teacher_catalog_id='94000000-0000-4000-8000-000000000101'
where id='94000000-0000-4000-8000-000000000001';
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '94000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','chat-contract-teacher-b@example.invalid',
  crypt('chat-contract-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  now(),now()
);
insert into public.profiles(id,role,name,email,created_at,updated_at)
values (
  '94000000-0000-4000-8000-000000000003','teacher','청강 계약 선생님 B',
  'chat-contract-teacher-b@example.invalid',now(),now()
)
on conflict (id) do update set
  role=excluded.role,name=excluded.name,email=excluded.email,updated_at=excluded.updated_at;
delete from public.teacher_catalogs
where profile_id = '94000000-0000-4000-8000-000000000003';
insert into public.teacher_catalogs(
  id,name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role
)
values (
  '94000000-0000-4000-8000-000000000203','청강 계약 선생님 B',
  array['영어']::text[],true,9944,
  '94000000-0000-4000-8000-000000000003',
  'chat-contract-teacher-b@example.invalid','teacher'
);
update public.profiles
set teacher_catalog_id='94000000-0000-4000-8000-000000000203'
where id='94000000-0000-4000-8000-000000000003';
insert into public.classroom_catalogs(
  id,name,subjects,is_visible,sort_order,campus
)
values (
  '94000000-0000-4000-8000-000000000102','청강 계약 301호',
  array['영어']::text[],true,9942,'본관'
);
insert into public.classes(
  id,name,subject,status,schedule_storage_mode,schedule_plan
)
values (
  '94000000-0000-4000-8000-000000000103','청강 계약 영어반','영어',
  '수업 진행 중','normalized','{}'::jsonb
);
do $$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '94000000-0000-4000-8000-000000000103',
    '94000000-0000-4000-8000-000000000199',
    'registration_observation_google_chat_test'
  );
end;
$$;
insert into public.class_lesson_sessions(
  id,class_id,session_key,session_date,schedule_state,start_time,end_time,
  teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,
  classroom_name_snapshot,origin,revision
)
select
  '94000000-0000-4000-8000-000000000104',
  '94000000-0000-4000-8000-000000000103',
  pg_catalog.to_char(clock.session_date,'YYYY-MM-DD') || ':chat-contract',
  clock.session_date,'active',clock.start_time,clock.end_time,
  '94000000-0000-4000-8000-000000000101','청강 계약 선생님',
  '94000000-0000-4000-8000-000000000102','청강 계약 301호','manual',7
from chat_lifecycle_clock clock;
insert into public.ops_tasks(
  id,title,type,status,priority,requested_by,assignee_id,
  secondary_assignee_id,student_name
)
values (
  '94000000-0000-4000-8000-000000000105','청강 Chat 계약 fixture',
  'registration','requested','normal',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','합성 청강학생'
);
insert into public.ops_registration_details(task_id)
values ('94000000-0000-4000-8000-000000000105');
insert into public.ops_registration_subject_tracks(
  id,task_id,subject,pipeline_status,director_profile_id,
  director_assignment_source,director_assigned_at,migration_review_required,
  workflow_status,workflow_revision,workflow_status_entered_at,
  observation_return_workflow_status,observation_attempt_count
)
values (
  '94000000-0000-4000-8000-000000000106',
  '94000000-0000-4000-8000-000000000105','영어','consultation_waiting',
  '94000000-0000-4000-8000-000000000001','manual',now(),false,
  'observation_requested',1,now(),'consultation_completed',0
);
insert into public.ops_registration_appointments(
  id,task_id,kind,scheduled_at,place,status,notification_revision,created_by
)
select
  '94000000-0000-4000-8000-000000000107',
  '94000000-0000-4000-8000-000000000105','observation_class',
  clock.starts_at,'본관','scheduled',1,
  '94000000-0000-4000-8000-000000000001'
from chat_lifecycle_clock clock;
insert into public.ops_registration_observations(
  id,task_id,track_id,appointment_id,class_id,
  session_authority,class_lesson_session_id,legacy_session_key,
  session_date,starts_at,ends_at,session_schedule_state,
  session_source_revision,legacy_session_source_hash,source_revision,
  booking_fact_hash,teacher_catalog_id,teacher_profile_id,
  classroom_catalog_id,subject,class_name_snapshot,teacher_name_snapshot,
  classroom_name_snapshot,campus,textbook_snapshot,progress_snapshot,
  created_by,updated_by
)
select
  '94000000-0000-4000-8000-000000000108',
  '94000000-0000-4000-8000-000000000105',
  '94000000-0000-4000-8000-000000000106',
  '94000000-0000-4000-8000-000000000107',
  '94000000-0000-4000-8000-000000000103',
  'normalized','94000000-0000-4000-8000-000000000104',null,
  clock.session_date,clock.starts_at,clock.ends_at,'active',7,null,
  jsonb_build_object(
    'authority','normalized',
    'sessionId','94000000-0000-4000-8000-000000000104',
    'revision',7
  ),
  dashboard_private.registration_observation_booking_fact_hash_v1(
    jsonb_build_object(
      'classId','94000000-0000-4000-8000-000000000103'::uuid,
      'subject','영어','sessionAuthority','normalized',
      'classLessonSessionId','94000000-0000-4000-8000-000000000104'::uuid,
      'legacySessionKey',null,'sessionKey',
        pg_catalog.to_char(clock.session_date,'YYYY-MM-DD') || ':chat-contract',
      'scheduleState','active','sessionDate',clock.session_date,
      'startsAt',clock.starts_at,'endsAt',clock.ends_at,
      'teacherCatalogId','94000000-0000-4000-8000-000000000101'::uuid,
      'teacherProfileId','94000000-0000-4000-8000-000000000001'::uuid,
      'teacherName','청강 계약 선생님',
      'classroomCatalogId','94000000-0000-4000-8000-000000000102'::uuid,
      'classroomName','청강 계약 301호','campus','본관'
    )
  ),
  '94000000-0000-4000-8000-000000000101',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000102','영어','청강 계약 영어반',
  '청강 계약 선생님','청강 계약 301호','본관',
  '["능률 VOCA"]'::jsonb,'42~49쪽',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001'
from chat_lifecycle_clock clock;

select is(
  dashboard_private.registration_observation_chat_preparation_snapshot_v1(
    '[{"textbookId":"book-1","title":"능률 VOCA","planLabel":"42~49쪽","memo":"단어 시험"}]'::jsonb,
    '진도: 다른 fallback'
  ),
  '{"textbookNames":["능률 VOCA"],"progressSummary":"42~49쪽 · 단어 시험"}'::jsonb,
  'structured core textbook snapshots project to string names and selected-plan progress'
);
select is(
  dashboard_private.registration_observation_chat_preparation_snapshot_v1(
    '[]'::jsonb,'진도: 미입력'
  ),
  '{"textbookNames":["미지정"],"progressSummary":"미입력"}'::jsonb,
  'empty preparation has one explicit string fallback'
);

select is(
  (select pg_catalog.jsonb_agg(key order by key)
   from pg_catalog.jsonb_object_keys(
     dashboard_private.get_registration_observation_notification_source_impl_v1(
       '94000000-0000-4000-8000-000000000108'
     )
   ) key),
  '["appointmentId","appointmentStatus","bookingFactHash","campus","classId","classLessonSessionId","className","classroomCatalogId","classroomName","directorProfileId","endsAt","hasFeedback","legacySessionKey","notificationRevision","observationId","observationStatus","scheduleState","sessionAuthority","sourceRevision","startsAt","studentName","subject","taskId","teacherCatalogId","teacherName","teacherProfileId","trackId"]'::jsonb,
  'notification source returns only the exact safe key set'
);
select is(
  pg_catalog.jsonb_build_object(
    'student', dashboard_private.get_registration_observation_notification_source_impl_v1(
      '94000000-0000-4000-8000-000000000108'
    ) ->> 'studentName',
    'teacher', dashboard_private.get_registration_observation_notification_source_impl_v1(
      '94000000-0000-4000-8000-000000000108'
    ) ->> 'teacherName',
    'director', dashboard_private.get_registration_observation_notification_source_impl_v1(
      '94000000-0000-4000-8000-000000000108'
    ) ->> 'directorProfileId',
    'feedback', dashboard_private.get_registration_observation_notification_source_impl_v1(
      '94000000-0000-4000-8000-000000000108'
    ) -> 'hasFeedback'
  ),
  '{"student":"합성 청강학생","teacher":"청강 계약 선생님","director":"94000000-0000-4000-8000-000000000001","feedback":false}'::jsonb,
  'notification source projects exact current actor and eligibility facts'
);
select throws_ok($$
  do $drift$
  begin
    update public.class_lesson_sessions
    set schedule_state = 'makeup'
    where id = '94000000-0000-4000-8000-000000000104';
    perform dashboard_private.get_registration_observation_notification_source_impl_v1(
      '94000000-0000-4000-8000-000000000108'
    );
  end
  $drift$
$$, '55000','registration_observation_notification_source_dirty',
  'notification source rejects a changed normalized schedule state');

update dashboard_private.notification_rules
set enabled = true, revision = 2, updated_at = pg_catalog.clock_timestamp()
where id in (
  '81000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000004',
  '81000000-0000-4000-8000-000000000005'
);
insert into dashboard_private.registration_observation_domain_events(
  event_id,observation_id,appointment_id,notification_revision,event_kind,
  booking_fact_hash,source_revision,occurred_at
)
select
  '94000000-0000-4000-8000-000000000109',
  observation.id,observation.appointment_id,1,'observation_scheduled',
  observation.booking_fact_hash,observation.source_revision,clock.occurred_at
from public.ops_registration_observations observation
cross join chat_lifecycle_clock clock
where observation.id='94000000-0000-4000-8000-000000000108';

select is(
  (select pg_catalog.jsonb_object_agg(job.event_key,
     pg_catalog.jsonb_build_object(
       'status',job.status,
       'dueAt',job.due_at,
       'expiresAt',job.expires_at,
       'mentionRole',job.mention_role,
       'mentionProfileIds',job.mention_profile_ids
     ) order by job.event_key)
   from dashboard_private.registration_observation_chat_jobs job
   where job.observation_id='94000000-0000-4000-8000-000000000108'),
  (select pg_catalog.jsonb_build_object(
    'registration.observation_scheduled',jsonb_build_object(
      'status','pending','dueAt',clock.occurred_at,
      'expiresAt',clock.occurred_at+interval '24 hours',
      'mentionRole','subject_teacher',
      'mentionProfileIds',array['94000000-0000-4000-8000-000000000001'::uuid]
    ),
    'registration.observation_reminder_due',jsonb_build_object(
      'status','pending','dueAt',clock.starts_at-interval '3 hours',
      'expiresAt',clock.starts_at,'mentionRole','subject_teacher',
      'mentionProfileIds',array['94000000-0000-4000-8000-000000000001'::uuid]
    ),
    'registration.observation_feedback_due',jsonb_build_object(
      'status','pending','dueAt',clock.ends_at+interval '30 minutes',
      'expiresAt',clock.ends_at+interval '24 hours',
      'mentionRole','subject_teacher',
      'mentionProfileIds',array['94000000-0000-4000-8000-000000000001'::uuid]
    )
  ) from chat_lifecycle_clock clock),
  'exact three-hour schedule creates immediate, reminder, and feedback jobs'
);
select is_empty($$
  select observation_id,notification_revision,event_key
  from dashboard_private.registration_observation_chat_jobs
  group by observation_id,notification_revision,event_key
  having count(*) <> 1
$$, 'every Chat job identity remains unique');
select throws_ok(
  $$update dashboard_private.registration_observation_chat_jobs
    set next_attempt_at = null
    where observation_id='94000000-0000-4000-8000-000000000108'
      and event_key='registration.observation_scheduled'$$,
  '23514',null,'pending cannot lose next_attempt_at'
);
select throws_ok($$
  insert into dashboard_private.registration_observation_domain_events(
    event_id,observation_id,appointment_id,notification_revision,event_kind,
    booking_fact_hash,source_revision,occurred_at
  )
  select
    '94000000-0000-4000-8000-000000000110',
    observation.id,observation.appointment_id,1,'observation_scheduled',
    observation.booking_fact_hash,observation.source_revision,clock.occurred_at
  from public.ops_registration_observations observation
  cross join chat_lifecycle_clock clock
  where observation.id='94000000-0000-4000-8000-000000000108'
$$,'23505',null,'domain event replay cannot duplicate Chat jobs');
select is(
  (select pg_catalog.count(*)
   from dashboard_private.registration_observation_chat_jobs
   where observation_id='94000000-0000-4000-8000-000000000108'),
  3::bigint,
  'failed replay leaves the original three identities only'
);

create or replace function pg_temp.exercise_registration_observation_disabled_rule_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  begin
    update public.ops_registration_appointments
    set notification_revision=2,updated_at=pg_catalog.clock_timestamp()
    where id='94000000-0000-4000-8000-000000000107';
    insert into dashboard_private.registration_observation_domain_events(
      event_id,observation_id,appointment_id,notification_revision,event_kind,
      booking_fact_hash,source_revision,occurred_at
    )
    select
      '94000000-0000-4000-8000-000000000123',observation.id,
      observation.appointment_id,2,'observation_rescheduled',
      observation.booking_fact_hash,observation.source_revision,
      clock.starts_at-interval '3 hours'
    from public.ops_registration_observations observation
    cross join chat_lifecycle_clock clock
    where observation.id='94000000-0000-4000-8000-000000000108';
    update dashboard_private.notification_rules
    set enabled=true,revision=2,updated_at=pg_catalog.clock_timestamp()
    where id='81000000-0000-4000-8000-000000000002';
    select pg_catalog.jsonb_build_object(
      'status',job.status,
      'error',job.last_error_code,
      'nextAttemptAt',job.next_attempt_at,
      'sourceRuleEnabled',(
        select (snapshot ->> 'enabled')::boolean
        from pg_catalog.jsonb_array_elements(job.rule_snapshot) snapshot
      ),
      'laterRuleEnabled',rule.enabled
    )
    into v_result
    from dashboard_private.registration_observation_chat_jobs job
    join dashboard_private.notification_rules rule
      on rule.id='81000000-0000-4000-8000-000000000002'
    where job.observation_id='94000000-0000-4000-8000-000000000108'
      and job.notification_revision=2
      and job.event_key='registration.observation_rescheduled';
    raise exception 'registration_observation_disabled_rule_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_disabled_rule_v1(),
  '{"status":"suppressed","error":"rule_disabled_at_source","nextAttemptAt":null,"sourceRuleEnabled":false,"laterRuleEnabled":true}'::jsonb,
  'a rule disabled at source remains suppressed after a later enable'
);

create or replace function pg_temp.exercise_registration_observation_chat_lifecycle_v1(
  p_event_kind text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_new_date date;
  v_start_time time;
  v_end_time time;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_session_key text;
  v_booking_hash text;
  v_source_revision jsonb;
begin
  begin
    if p_event_kind = 'observation_rescheduled' then
      update dashboard_private.notification_rules
      set enabled=true,revision=2,updated_at=pg_catalog.clock_timestamp()
      where id='81000000-0000-4000-8000-000000000002';
      perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
        '94000000-0000-4000-8000-000000000103',
        '94000000-0000-4000-8000-000000000198',
        'registration_observation_google_chat_reschedule_test'
      );
      select lesson.session_date + 1, lesson.start_time, lesson.end_time
      into v_new_date, v_start_time, v_end_time
      from public.class_lesson_sessions lesson
      where lesson.id='94000000-0000-4000-8000-000000000104';
      v_session_key := pg_catalog.to_char(v_new_date,'YYYY-MM-DD') ||
        ':chat-contract-rescheduled';
      v_new_start := (v_new_date + v_start_time) at time zone 'Asia/Seoul';
      v_new_end := (v_new_date + v_end_time) at time zone 'Asia/Seoul';
      v_source_revision := pg_catalog.jsonb_build_object(
        'authority','normalized',
        'sessionId','94000000-0000-4000-8000-000000000104',
        'revision',8
      );
      v_booking_hash :=
        dashboard_private.registration_observation_booking_fact_hash_v1(
          pg_catalog.jsonb_build_object(
            'classId','94000000-0000-4000-8000-000000000103'::uuid,
            'subject','영어','sessionAuthority','normalized',
            'classLessonSessionId','94000000-0000-4000-8000-000000000104'::uuid,
            'legacySessionKey',null,'sessionKey',v_session_key,
            'scheduleState','active','sessionDate',v_new_date,
            'startsAt',v_new_start,'endsAt',v_new_end,
            'teacherCatalogId','94000000-0000-4000-8000-000000000203'::uuid,
            'teacherProfileId','94000000-0000-4000-8000-000000000003'::uuid,
            'teacherName','청강 계약 선생님 B',
            'classroomCatalogId','94000000-0000-4000-8000-000000000102'::uuid,
            'classroomName','청강 계약 301호','campus','본관'
          )
        );
      update public.class_lesson_sessions
      set session_date=v_new_date,session_key=v_session_key,revision=8,
          teacher_catalog_id='94000000-0000-4000-8000-000000000203',
          teacher_name_snapshot='청강 계약 선생님 B'
      where id='94000000-0000-4000-8000-000000000104';
      update public.ops_registration_appointments
      set scheduled_at=v_new_start,notification_revision=2,
          updated_at=pg_catalog.clock_timestamp()
      where id='94000000-0000-4000-8000-000000000107';
      update public.ops_registration_observations
      set session_date=v_new_date,starts_at=v_new_start,ends_at=v_new_end,
          session_source_revision=8,source_revision=v_source_revision,
          teacher_catalog_id='94000000-0000-4000-8000-000000000203',
          teacher_profile_id='94000000-0000-4000-8000-000000000003',
          teacher_name_snapshot='청강 계약 선생님 B',
          booking_fact_hash=v_booking_hash,revision=revision+1,
          updated_at=pg_catalog.clock_timestamp()
      where id='94000000-0000-4000-8000-000000000108';
      insert into dashboard_private.registration_observation_domain_events(
        event_id,observation_id,appointment_id,notification_revision,event_kind,
        booking_fact_hash,source_revision,occurred_at
      ) values (
        '94000000-0000-4000-8000-000000000120',
        '94000000-0000-4000-8000-000000000108',
        '94000000-0000-4000-8000-000000000107',2,
        'observation_rescheduled',v_booking_hash,v_source_revision,
        v_new_start-interval '3 hours'
      );
      select pg_catalog.jsonb_build_object(
        'oldDueOpen',(
          select pg_catalog.count(*)
          from dashboard_private.registration_observation_chat_jobs job
          where job.observation_id='94000000-0000-4000-8000-000000000108'
            and job.notification_revision=1
            and job.event_key in (
              'registration.observation_reminder_due',
              'registration.observation_feedback_due'
            )
            and job.status in ('pending','claimed')
        ),
        'newKeys',(
          select pg_catalog.jsonb_agg(job.event_key order by job.event_key)
          from dashboard_private.registration_observation_chat_jobs job
          where job.observation_id='94000000-0000-4000-8000-000000000108'
            and job.notification_revision=2
        ),
        'bookingChanged',(
          select pg_catalog.bool_and(
            job.current_booking_snapshot is distinct from
              job.previous_booking_snapshot
          )
          from dashboard_private.registration_observation_chat_jobs job
          where job.observation_id='94000000-0000-4000-8000-000000000108'
            and job.notification_revision=2
            and job.event_key='registration.observation_rescheduled'
        ),
        'changeFactBound',exists(
          select 1
          from dashboard_private.notification_assignment_change_facts fact
          where fact.workflow_key='registration'
            and fact.source_type='registration_observation'
            and fact.source_id='94000000-0000-4000-8000-000000000108'
            and fact.source_revision=2
            and fact.role_key='subject_teacher'
            and fact.previous_profile_ids=array[
              '94000000-0000-4000-8000-000000000001'::uuid
            ]
            and fact.current_profile_ids=array[
              '94000000-0000-4000-8000-000000000003'::uuid
            ]
        ),
        'rescheduleMentions',(
          select to_jsonb(job.mention_profile_ids)
          from dashboard_private.registration_observation_chat_jobs job
          where job.observation_id='94000000-0000-4000-8000-000000000108'
            and job.notification_revision=2
            and job.event_key='registration.observation_rescheduled'
        ),
        'currentDueMentions',(
          select pg_catalog.bool_and(job.mention_profile_ids=array[
            '94000000-0000-4000-8000-000000000003'::uuid
          ])
          from dashboard_private.registration_observation_chat_jobs job
          where job.observation_id='94000000-0000-4000-8000-000000000108'
            and job.notification_revision=2
            and job.event_key in (
              'registration.observation_reminder_due',
              'registration.observation_feedback_due'
            )
        ),
        'expires24Hours',(
          select job.expires_at = (v_new_start-interval '3 hours')
            + interval '24 hours'
          from dashboard_private.registration_observation_chat_jobs job
          where job.observation_id='94000000-0000-4000-8000-000000000108'
            and job.notification_revision=2
            and job.event_key='registration.observation_rescheduled'
        )
      ) into v_result;
    elsif p_event_kind = 'observation_canceled' then
      update dashboard_private.notification_rules
      set enabled=true,revision=2,updated_at=pg_catalog.clock_timestamp()
      where id='81000000-0000-4000-8000-000000000003';
      update public.ops_registration_appointments
      set status='canceled',updated_at=pg_catalog.clock_timestamp()
      where id='94000000-0000-4000-8000-000000000107';
      update public.ops_registration_observations
      set status='canceled',attendance=null,suitability_result=null,
          feedback_reason=null,feedback_submitted_by=null,
          feedback_submitted_at=null,updated_at=pg_catalog.clock_timestamp()
      where id='94000000-0000-4000-8000-000000000108';
      insert into dashboard_private.registration_observation_domain_events(
        event_id,observation_id,appointment_id,notification_revision,event_kind,
        booking_fact_hash,source_revision,occurred_at
      )
      select '94000000-0000-4000-8000-000000000121',id,appointment_id,1,
        'observation_canceled',booking_fact_hash,source_revision,
        pg_catalog.clock_timestamp()
      from public.ops_registration_observations
      where id='94000000-0000-4000-8000-000000000108';
      select pg_catalog.jsonb_build_object(
        'dueOpen',(
          select pg_catalog.count(*)
          from dashboard_private.registration_observation_chat_jobs job
          where job.observation_id='94000000-0000-4000-8000-000000000108'
            and job.event_key in (
              'registration.observation_reminder_due',
              'registration.observation_feedback_due'
            ) and job.status in ('pending','claimed')
        ),
        'cancelJobs',(
          select pg_catalog.count(*)
          from dashboard_private.registration_observation_chat_jobs job
          where job.observation_id='94000000-0000-4000-8000-000000000108'
            and job.event_key='registration.observation_canceled'
        )
      ) into v_result;
    elsif p_event_kind = 'observation_no_show' then
      update public.ops_registration_appointments
      set status='completed',updated_at=pg_catalog.clock_timestamp()
      where id='94000000-0000-4000-8000-000000000107';
      update public.ops_registration_observations
      set status='no_show',attendance='no_show',suitability_result=null,
          feedback_reason=null,feedback_submitted_by=null,
          feedback_submitted_at=null,
          attendance_recorded_by='94000000-0000-4000-8000-000000000001',
          attendance_recorded_at=pg_catalog.clock_timestamp(),
          updated_at=pg_catalog.clock_timestamp()
      where id='94000000-0000-4000-8000-000000000108';
      insert into dashboard_private.registration_observation_domain_events(
        event_id,observation_id,appointment_id,notification_revision,event_kind,
        booking_fact_hash,source_revision,occurred_at
      )
      select '94000000-0000-4000-8000-000000000122',id,appointment_id,1,
        'observation_no_show',booking_fact_hash,source_revision,
        pg_catalog.clock_timestamp()
      from public.ops_registration_observations
      where id='94000000-0000-4000-8000-000000000108';
      select pg_catalog.jsonb_build_object(
        'dueOpen',(
          select pg_catalog.count(*)
          from dashboard_private.registration_observation_chat_jobs job
          where job.observation_id='94000000-0000-4000-8000-000000000108'
            and job.event_key in (
              'registration.observation_reminder_due',
              'registration.observation_feedback_due'
            ) and job.status in ('pending','claimed')
        ),
        'newJobCount',(
          select pg_catalog.count(*)
          from dashboard_private.registration_observation_chat_jobs job
          where job.domain_event_id='94000000-0000-4000-8000-000000000122'
        )
      ) into v_result;
    else
      raise exception 'registration_observation_chat_lifecycle_fixture_invalid'
        using errcode='22023';
    end if;
    raise exception 'registration_observation_chat_lifecycle_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_chat_lifecycle_v1(
    'observation_rescheduled'
  ),
  '{"oldDueOpen":0,"newKeys":["registration.observation_feedback_due","registration.observation_reminder_due","registration.observation_rescheduled"],"bookingChanged":true,"changeFactBound":true,"rescheduleMentions":["94000000-0000-4000-8000-000000000001","94000000-0000-4000-8000-000000000003"],"currentDueMentions":true,"expires24Hours":true}'::jsonb,
  'reschedule binds its matching teacher fact, mentions A and B, and expires after 24 hours'
);
select is(
  pg_temp.exercise_registration_observation_chat_lifecycle_v1(
    'observation_canceled'
  ),
  '{"dueOpen":0,"cancelJobs":1}'::jsonb,
  'cancel closes every due job and creates one cancellation job'
);
select is(
  pg_temp.exercise_registration_observation_chat_lifecycle_v1(
    'observation_no_show'
  ),
  '{"dueOpen":0,"newJobCount":0}'::jsonb,
  'no-show closes reminder and feedback due without a new Chat job'
);

insert into public.ops_tasks(
  id,title,type,status,priority,requested_by,assignee_id,
  secondary_assignee_id,student_name
)
values (
  '94000000-0000-4000-8000-000000000205','청강 Chat near-boundary fixture',
  'registration','requested','normal',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','합성 경계학생'
);
insert into public.ops_registration_subject_tracks(
  id,task_id,subject,pipeline_status,director_profile_id,
  director_assignment_source,director_assigned_at,migration_review_required,
  workflow_status,workflow_revision,workflow_status_entered_at,
  observation_return_workflow_status,observation_attempt_count
)
values (
  '94000000-0000-4000-8000-000000000206',
  '94000000-0000-4000-8000-000000000205','영어','consultation_waiting',
  '94000000-0000-4000-8000-000000000001','manual',now(),false,
  'observation_requested',1,now(),'consultation_completed',0
);
insert into public.ops_registration_appointments(
  id,task_id,kind,scheduled_at,place,status,notification_revision,created_by
)
select
  '94000000-0000-4000-8000-000000000207',
  '94000000-0000-4000-8000-000000000205','observation_class',
  clock.starts_at,'본관','scheduled',1,
  '94000000-0000-4000-8000-000000000001'
from chat_lifecycle_clock clock;
insert into public.ops_registration_observations(
  id,task_id,track_id,appointment_id,class_id,
  session_authority,class_lesson_session_id,legacy_session_key,
  session_date,starts_at,ends_at,session_schedule_state,
  session_source_revision,legacy_session_source_hash,source_revision,
  booking_fact_hash,teacher_catalog_id,teacher_profile_id,
  classroom_catalog_id,subject,class_name_snapshot,teacher_name_snapshot,
  classroom_name_snapshot,campus,textbook_snapshot,progress_snapshot,
  created_by,updated_by
)
select
  '94000000-0000-4000-8000-000000000208',
  '94000000-0000-4000-8000-000000000205',
  '94000000-0000-4000-8000-000000000206',
  '94000000-0000-4000-8000-000000000207',
  '94000000-0000-4000-8000-000000000103',
  'normalized','94000000-0000-4000-8000-000000000104',null,
  clock.session_date,clock.starts_at,clock.ends_at,'active',7,null,
  jsonb_build_object(
    'authority','normalized',
    'sessionId','94000000-0000-4000-8000-000000000104',
    'revision',7
  ),
  dashboard_private.registration_observation_booking_fact_hash_v1(
    jsonb_build_object(
      'classId','94000000-0000-4000-8000-000000000103'::uuid,
      'subject','영어','sessionAuthority','normalized',
      'classLessonSessionId','94000000-0000-4000-8000-000000000104'::uuid,
      'legacySessionKey',null,'sessionKey',
        pg_catalog.to_char(clock.session_date,'YYYY-MM-DD') || ':chat-contract',
      'scheduleState','active','sessionDate',clock.session_date,
      'startsAt',clock.starts_at,'endsAt',clock.ends_at,
      'teacherCatalogId','94000000-0000-4000-8000-000000000101'::uuid,
      'teacherProfileId','94000000-0000-4000-8000-000000000001'::uuid,
      'teacherName','청강 계약 선생님',
      'classroomCatalogId','94000000-0000-4000-8000-000000000102'::uuid,
      'classroomName','청강 계약 301호','campus','본관'
    )
  ),
  '94000000-0000-4000-8000-000000000101',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000102','영어','청강 계약 영어반',
  '청강 계약 선생님','청강 계약 301호','본관',
  '["능률 VOCA"]'::jsonb,'42~49쪽',
  '94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001'
from chat_lifecycle_clock clock;
insert into dashboard_private.registration_observation_domain_events(
  event_id,observation_id,appointment_id,notification_revision,event_kind,
  booking_fact_hash,source_revision,occurred_at
)
select
  '94000000-0000-4000-8000-000000000209',
  observation.id,observation.appointment_id,1,'observation_scheduled',
  observation.booking_fact_hash,observation.source_revision,
  clock.starts_at - interval '2 hours 59 minutes 59 seconds'
from public.ops_registration_observations observation
cross join chat_lifecycle_clock clock
where observation.id='94000000-0000-4000-8000-000000000208';
select is(
  (select pg_catalog.jsonb_agg(job.event_key order by job.event_key)
   from dashboard_private.registration_observation_chat_jobs job
   where job.observation_id='94000000-0000-4000-8000-000000000208'),
  '["registration.observation_feedback_due","registration.observation_scheduled"]'::jsonb,
  'two-hours-fifty-nine-minutes-fifty-nine-seconds creates no reminder'
);

update public.ops_registration_observations
set status='attended_feedback_pending',attendance='attended',
  attendance_recorded_by='94000000-0000-4000-8000-000000000001',
  attendance_recorded_at=pg_catalog.clock_timestamp(),revision=revision+1,
  updated_by='94000000-0000-4000-8000-000000000001'
where id='94000000-0000-4000-8000-000000000108';
insert into dashboard_private.registration_observation_domain_events(
  event_id,observation_id,appointment_id,notification_revision,event_kind,
  booking_fact_hash,source_revision,occurred_at
)
select
  '94000000-0000-4000-8000-000000000111',id,appointment_id,1,
  'observation_attendance_recorded',booking_fact_hash,source_revision,
  pg_catalog.clock_timestamp()
from public.ops_registration_observations
where id='94000000-0000-4000-8000-000000000108';
select is(
  (select pg_catalog.count(*)
   from dashboard_private.registration_observation_chat_jobs
   where observation_id='94000000-0000-4000-8000-000000000108'
     and event_key in (
       'registration.observation_reminder_due',
       'registration.observation_feedback_due'
     ) and status in ('pending','claimed')),
  1::bigint,
  'attendance cancels reminder while feedback due remains current'
);
update public.ops_registration_observations
set status='completed',suitability_result='fit',feedback_reason='합성 피드백',
  feedback_submitted_by='94000000-0000-4000-8000-000000000001',
  feedback_submitted_at=pg_catalog.clock_timestamp(),feedback_revision=1,
  revision=revision+1,updated_by='94000000-0000-4000-8000-000000000001'
where id='94000000-0000-4000-8000-000000000108';
insert into dashboard_private.registration_observation_domain_events(
  event_id,observation_id,appointment_id,notification_revision,event_kind,
  booking_fact_hash,source_revision,occurred_at
)
select
  '94000000-0000-4000-8000-000000000112',id,appointment_id,1,
  'observation_feedback_submitted',booking_fact_hash,source_revision,
  pg_catalog.clock_timestamp()
from public.ops_registration_observations
where id='94000000-0000-4000-8000-000000000108';
select is(
  (select pg_catalog.count(*)
   from dashboard_private.registration_observation_chat_jobs
   where observation_id='94000000-0000-4000-8000-000000000108'
     and event_key in (
       'registration.observation_reminder_due',
       'registration.observation_feedback_due'
     ) and status in ('pending','claimed')),
  0::bigint,
  'feedback submission cancels every remaining due job'
);
select is(
  (select submission_snapshot
   from dashboard_private.registration_observation_chat_jobs
   where observation_id='94000000-0000-4000-8000-000000000108'
     and event_key='registration.observation_feedback_submitted'),
  (select jsonb_build_object(
    'submittedByName','청강 계약 선생님',
    'submittedAt',observation.feedback_submitted_at
  )
  from public.ops_registration_observations observation
  where observation.id='94000000-0000-4000-8000-000000000108'),
  'feedback submission snapshot contains only actor and timestamp'
);

update dashboard_private.notification_rules
set enabled=true,revision=2,updated_at=pg_catalog.clock_timestamp()
where id='81000000-0000-4000-8000-000000000008';
insert into public.ops_task_events(
  id,task_id,actor_id,event_type,field_name,before_value,after_value
)
values (
  '94000000-0000-4000-8000-000000000210',
  '94000000-0000-4000-8000-000000000105',null,
  'registration_track_event',
  'registration_track:94000000-0000-4000-8000-000000000106',null,
  pg_catalog.jsonb_build_object(
    'version',2,
    'event_type','director_default_resolved',
    'track_id','94000000-0000-4000-8000-000000000106',
    'metadata',pg_catalog.jsonb_build_object(
      'previousDirectorProfileId',null,
      'directorProfileId','94000000-0000-4000-8000-000000000001',
      'ruleKey','english-default',
      'recipientSetChanged',true
    )
  )::text
);
select is(
  (select pg_catalog.jsonb_build_object(
    'count',pg_catalog.count(*),
    'eventKey',pg_catalog.min(job.event_key),
    'mentionIds',pg_catalog.min(job.mention_profile_ids::text),
    'status',pg_catalog.min(job.status)
  )
  from dashboard_private.registration_observation_chat_jobs job
  join dashboard_private.notification_assignment_change_facts fact
    on fact.fact_id=job.assignment_fact_id
  where fact.source_id='94000000-0000-4000-8000-000000000210'),
  '{"count":1,"eventKey":"registration.observation_director_reassigned","mentionIds":"{94000000-0000-4000-8000-000000000001}","status":"pending"}'::jsonb,
  'canonical current-director track event creates one pending reassignment job'
);
select throws_ok($source_kind$
  do $mutate$
  begin
    update dashboard_private.registration_observation_chat_jobs job
    set event_key='registration.observation_feedback_submitted',
        submission_snapshot=pg_catalog.jsonb_build_object(
          'submittedByName','잘못된 assignment source',
          'submittedAt',pg_catalog.clock_timestamp()
        ),
        reservation_snapshot_hash=
          dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
            'registration.observation_feedback_submitted',
            job.current_booking_snapshot,
            null
          )
    from dashboard_private.notification_assignment_change_facts fact
    where fact.fact_id=job.assignment_fact_id
      and fact.source_id='94000000-0000-4000-8000-000000000210';
    if not found then
      raise exception 'registration_observation_chat_assignment_fixture_missing'
        using errcode='P0002';
    end if;
    raise exception 'registration_observation_chat_source_kind_guard_missing'
      using errcode='P0001';
  end
  $mutate$
$source_kind$,'23514',null,
  'assignment facts cannot back a non-director observation event');

insert into dashboard_private.notification_assignment_change_facts(
  fact_id,workflow_key,source_type,source_id,source_revision,
  context_entity_id,role_key,previous_profile_ids,current_profile_ids,occurred_at
)
values
  (
    '94000000-0000-4000-8000-000000000211','registration',
    'registration_track_event','94000000-0000-4000-8000-000000009999',null,
    '94000000-0000-4000-8000-000000000106','track_director',
    array[]::uuid[],array['94000000-0000-4000-8000-000000000001'::uuid],
    pg_catalog.clock_timestamp()
  ),
  (
    '94000000-0000-4000-8000-000000000212','registration',
    'registration_track_event','94000000-0000-4000-8000-000000000213',null,
    '94000000-0000-4000-8000-000000000106','track_director',
    array['94000000-0000-4000-8000-000000000001'::uuid],array[]::uuid[],
    pg_catalog.clock_timestamp()
  );
select is(
  (select pg_catalog.count(*)
   from dashboard_private.registration_observation_chat_jobs job
   where job.assignment_fact_id in (
     '94000000-0000-4000-8000-000000000211',
     '94000000-0000-4000-8000-000000000212'
   )),
  0::bigint,
  'missing-source and stale-current-director facts create no reassignment job'
);
update dashboard_private.registration_observation_chat_jobs
set status='canceled',next_attempt_at=null,claimed_by=null,claim_token=null,
  lease_expires_at=null,last_error_code='test_fixture_closed',
  completed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
where observation_id='94000000-0000-4000-8000-000000000108'
  and status='pending';

create or replace function pg_temp.registration_observation_chat_payload_for_job_v1(
  p_job_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'task_id',source ->> 'taskId',
    'track_id',source ->> 'trackId',
    'observation_id',job.observation_id,
    'appointment_id',job.appointment_id,
    'appointment_notification_revision',job.notification_revision,
    'student_name',source ->> 'studentName',
    'subject',source ->> 'subject',
    'source_revision',job.source_revision,
    'booking_fact_hash',job.booking_fact_hash,
    'occurred_at',domain_event.occurred_at,
    'delivery_expires_at',job.expires_at,
    'mention_role',job.mention_role,
    'mention_profile_ids',job.mention_profile_ids,
    'event_kind',job.event_key,
    'booking',jsonb_build_object(
      'class_id',job.current_booking_snapshot ->> 'classId',
      'class_name',job.current_booking_snapshot ->> 'className',
      'session_authority',job.current_booking_snapshot ->> 'sessionAuthority',
      'class_lesson_session_id',job.current_booking_snapshot ->> 'classLessonSessionId',
      'legacy_session_key',job.current_booking_snapshot ->> 'legacySessionKey',
      'schedule_state',job.current_booking_snapshot ->> 'scheduleState',
      'starts_at',job.current_booking_snapshot ->> 'startsAt',
      'ends_at',job.current_booking_snapshot ->> 'endsAt',
      'teacher_name',job.current_booking_snapshot ->> 'teacherName',
      'classroom_name',job.current_booking_snapshot ->> 'classroomName',
      'campus',job.current_booking_snapshot ->> 'campus'
    ),
    'textbook_names',job.preparation_snapshot -> 'textbookNames',
    'progress_summary',job.preparation_snapshot ->> 'progressSummary'
  )
  from dashboard_private.registration_observation_chat_jobs job
  join dashboard_private.registration_observation_domain_events domain_event
    on domain_event.event_id=job.domain_event_id
  cross join lateral (
    select dashboard_private.get_registration_observation_notification_source_impl_v1(
      job.observation_id
    ) as source
  ) source_row
  where job.job_id=p_job_id;
$$;

create temp table chat_claim_result(
  generation integer not null,
  payload jsonb not null
) on commit drop;
grant select,insert,delete on table chat_claim_result to service_role;
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
insert into chat_claim_result
select 1, claim
from public.claim_registration_observation_chat_jobs_v1(
  'google-chat-contract-worker',1,60
) claim;
reset role;
select is(
  (select pg_catalog.jsonb_agg(key order by key)
   from chat_claim_result,
   lateral pg_catalog.jsonb_object_keys(payload) key
   where generation=1),
  '["appointment_id","assignment_fact_id","attempt_count","booking_fact_hash","claim_token","current_booking_snapshot","due_at","event_key","expires_at","job_id","mention_profile_ids","mention_role","notification_revision","observation_id","preparation_snapshot","previous_booking_snapshot","reservation_snapshot_hash","rule_snapshot","source_revision","submission_snapshot"]'::jsonb,
  'claim returns only the exact twenty job keys'
);
select is(
  (select (payload ->> 'attempt_count')::integer
   from chat_claim_result where generation=1),
  1,
  'first claim increments attempt count exactly once'
);
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$
  select public.finish_registration_observation_chat_job_v1(
    (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=1),
    (select (payload ->> 'claim_token')::uuid from chat_claim_result where generation=1),
    'failed','notification_window_closed',null
  )
$$,'22023','registration_observation_chat_finish_invalid',
  'finish rejects a canceled-only code for failed');
select throws_ok($$
  select public.finish_registration_observation_chat_job_v1(
    (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=1),
    (select (payload ->> 'claim_token')::uuid from chat_claim_result where generation=1),
    'canceled','max_attempts_exhausted',null
  )
$$,'22023','registration_observation_chat_finish_invalid',
  'finish rejects a failed-only code for canceled');
select throws_ok($$
  select public.finish_registration_observation_chat_job_v1(
    (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=1),
    (select (payload ->> 'claim_token')::uuid from chat_claim_result where generation=1),
    'source_dirty','source_status_changed',null
  )
$$,'22023','registration_observation_chat_finish_invalid',
  'finish rejects a lifecycle code for source-dirty');
select throws_ok($$
  select public.finish_registration_observation_chat_job_v1(
    (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=1),
    (select (payload ->> 'claim_token')::uuid from chat_claim_result where generation=1),
    'suppressed','source_schedule_changed',null
  )
$$,'22023','registration_observation_chat_finish_invalid',
  'finish rejects a source-dirty code for suppressed');
select throws_ok($$
  select public.finish_registration_observation_chat_job_v1(
    (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=1),
    (select (payload ->> 'claim_token')::uuid from chat_claim_result where generation=1),
    null,'worker_lost_after_claim',null
  )
$$,'22023','registration_observation_chat_finish_invalid',
  'finish rejects a null disposition at the exact public boundary');
select throws_ok($$
  select public.finish_registration_observation_chat_job_v1(
    (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=1),
    '94000000-0000-4000-8000-000000000999',
    'failed','worker_lost_after_claim',null
  )
$$,'40001','registration_observation_chat_claim_mismatch',
  'finish rejects a stale claim token');
insert into chat_claim_result
select 0, public.finish_registration_observation_chat_job_v1(
  (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=1),
  (select (payload ->> 'claim_token')::uuid from chat_claim_result where generation=1),
  'retry','transient_pre_dispatch_failure',pg_catalog.clock_timestamp()+interval '5 seconds'
);
reset role;
update dashboard_private.registration_observation_chat_jobs
set next_attempt_at=pg_catalog.clock_timestamp()-interval '1 second'
where job_id=(select (payload ->> 'job_id')::uuid
              from chat_claim_result where generation=1);
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
insert into chat_claim_result
select 2, claim
from public.claim_registration_observation_chat_jobs_v1(
  'google-chat-contract-worker',1,60
) claim;
reset role;
select is(
  (select pg_catalog.jsonb_build_object(
    'attempt',(second.payload ->> 'attempt_count')::integer,
    'tokenChanged',second.payload ->> 'claim_token' <> first.payload ->> 'claim_token'
  )
  from chat_claim_result first
  cross join chat_claim_result second
  where first.generation=1 and second.generation=2),
  '{"attempt":2,"tokenChanged":true}'::jsonb,
  'retry returns to pending and a second claim owns a new token'
);

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$
  select * from public.claim_registration_observation_chat_jobs_v1(
    'google-chat-invalid-batch',0,60
  )
$$,'22023','registration_observation_chat_claim_invalid',
  'claim rejects a zero batch');
select throws_ok($$
  select * from public.claim_registration_observation_chat_jobs_v1(
    'google-chat-invalid-batch',101,60
  )
$$,'22023','registration_observation_chat_claim_invalid',
  'claim rejects a batch above one hundred');
select throws_ok($$
  select * from public.claim_registration_observation_chat_jobs_v1(
    'google-chat-null-batch',null,60
  )
$$,'22023','registration_observation_chat_claim_invalid',
  'claim rejects a null batch instead of treating LIMIT null as unbounded');
select throws_ok($$
  select * from public.claim_registration_observation_chat_jobs_v1(
    'google-chat-invalid-lease',1,29
  )
$$,'22023','registration_observation_chat_claim_invalid',
  'claim rejects a lease below thirty seconds');
select throws_ok($$
  select * from public.claim_registration_observation_chat_jobs_v1(
    'google-chat-invalid-lease',1,301
  )
$$,'22023','registration_observation_chat_claim_invalid',
  'claim rejects a lease above three hundred seconds');
select throws_ok($$
  select * from public.claim_registration_observation_chat_jobs_v1(
    'google-chat-null-lease',1,null
  )
$$,'22023','registration_observation_chat_claim_invalid',
  'claim rejects a null lease');
select throws_ok($$
  select * from public.claim_registration_observation_chat_jobs_v1(
    'google chat unsafe worker',1,60
  )
$$,'22023','registration_observation_chat_claim_invalid',
  'claim rejects worker identifiers outside the safe character set');
select throws_ok($$
  select public.reap_registration_observation_chat_job_leases_v1(
    'google-chat-null-reap',null
  )
$$,'22023','registration_observation_chat_reap_invalid',
  'reap rejects a null batch instead of treating LIMIT null as unbounded');
select throws_ok($$
  select public.reap_registration_observation_chat_job_leases_v1(
    'google chat unsafe reaper',1
  )
$$,'22023','registration_observation_chat_reap_invalid',
  'reap rejects worker identifiers outside the safe character set');
reset role;

create temp table chat_concurrent_claim_results(
  worker text primary key,
  payload jsonb not null
) on commit drop;

select dblink_connect(
  'observation_chat_claim_setup',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=observation_chat_claim_setup'
);
select dblink_exec('observation_chat_claim_setup',$remote$
  do $setup$
  declare
    v_profile_id uuid := '94600000-0000-4000-8000-000000000001';
    v_teacher_id uuid := '94600000-0000-4000-8000-000000000101';
    v_classroom_id uuid := '94600000-0000-4000-8000-000000000102';
    v_class_id uuid := '94600000-0000-4000-8000-000000000103';
    v_session_id uuid := '94600000-0000-4000-8000-000000000104';
    v_session_date date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date;
    v_starts_at timestamptz;
    v_ends_at timestamptz;
    v_source_revision jsonb;
    v_booking_fact jsonb;
    v_booking_hash text;
  begin
    v_starts_at := (v_session_date::text || ' 12:00:00 Asia/Seoul')::timestamptz;
    v_ends_at := (v_session_date::text || ' 13:00:00 Asia/Seoul')::timestamptz;
    v_source_revision := pg_catalog.jsonb_build_object(
      'authority','normalized','sessionId',v_session_id,'revision',1
    );
    v_booking_fact := pg_catalog.jsonb_build_object(
      'classId',v_class_id,'subject','영어','sessionAuthority','normalized',
      'classLessonSessionId',v_session_id,'legacySessionKey',null,
      'sessionKey',pg_catalog.to_char(v_session_date,'YYYY-MM-DD') || ':chat-claim-contract',
      'scheduleState','active','sessionDate',v_session_date,
      'startsAt',v_starts_at,'endsAt',v_ends_at,
      'teacherCatalogId',v_teacher_id,'teacherProfileId',v_profile_id,
      'teacherName','동시 claim 선생님','classroomCatalogId',v_classroom_id,
      'classroomName','동시 claim 401호','campus','본관'
    );
    v_booking_hash := dashboard_private.registration_observation_booking_fact_hash_v1(
      v_booking_fact
    );

    update dashboard_private.notification_rules
    set enabled=true,revision=2,updated_at=pg_catalog.clock_timestamp()
    where id='81000000-0000-4000-8000-000000000003';

    insert into auth.users(
      id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at
    ) values (
      v_profile_id,'00000000-0000-0000-0000-000000000000',
      'authenticated','authenticated','chat-claim@example.invalid',
      crypt('chat-claim-only',gen_salt('bf')),pg_catalog.clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
      pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
    );
    insert into public.profiles(id,role,name,email,created_at,updated_at)
    values (
      v_profile_id,'admin','동시 claim 선생님','chat-claim@example.invalid',
      pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
    )
    on conflict (id) do update set
      role=excluded.role,name=excluded.name,email=excluded.email,
      updated_at=excluded.updated_at;
    update public.profiles set teacher_catalog_id=null where id=v_profile_id;
    delete from public.teacher_catalogs where profile_id=v_profile_id;
    insert into public.teacher_catalogs(
      id,name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role
    ) values (
      v_teacher_id,'동시 claim 선생님',array['영어']::text[],true,9961,
      v_profile_id,'chat-claim@example.invalid','teacher'
    );
    update public.profiles set teacher_catalog_id=v_teacher_id where id=v_profile_id;
    insert into public.classroom_catalogs(
      id,name,subjects,is_visible,sort_order,campus
    ) values (
      v_classroom_id,'동시 claim 401호',array['영어']::text[],true,9962,'본관'
    );
    insert into public.classes(
      id,name,subject,status,schedule_storage_mode,schedule_plan
    ) values (
      v_class_id,'동시 claim 영어반','영어','수업 진행 중','normalized','{}'::jsonb
    );
    perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
      v_class_id,'94600000-0000-4000-8000-000000000199',
      'registration_observation_chat_claim_concurrency'
    );
    insert into public.class_lesson_sessions(
      id,class_id,session_key,session_date,schedule_state,start_time,end_time,
      teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,
      classroom_name_snapshot,origin,revision
    ) values (
      v_session_id,v_class_id,
      pg_catalog.to_char(v_session_date,'YYYY-MM-DD') || ':chat-claim-contract',
      v_session_date,'active','12:00'::time,'13:00'::time,
      v_teacher_id,'동시 claim 선생님',v_classroom_id,'동시 claim 401호','manual',1
    );

    insert into public.ops_tasks(
      id,title,type,status,priority,requested_by,assignee_id,
      secondary_assignee_id,student_name
    ) values
      ('94600000-0000-4000-8000-000000000105','동시 claim A','registration',
       'requested','normal',v_profile_id,v_profile_id,v_profile_id,'동시 학생 A'),
      ('94600000-0000-4000-8000-000000000205','동시 claim B','registration',
       'requested','normal',v_profile_id,v_profile_id,v_profile_id,'동시 학생 B');
    insert into public.ops_registration_subject_tracks(
      id,task_id,subject,pipeline_status,director_profile_id,
      director_assignment_source,director_assigned_at,migration_review_required,
      workflow_status,workflow_revision,workflow_status_entered_at,
      observation_return_workflow_status,observation_attempt_count
    ) values
      ('94600000-0000-4000-8000-000000000106',
       '94600000-0000-4000-8000-000000000105','영어','consultation_waiting',
       v_profile_id,'manual',pg_catalog.clock_timestamp(),false,
       'observation_requested',1,pg_catalog.clock_timestamp(),'consultation_completed',0),
      ('94600000-0000-4000-8000-000000000206',
       '94600000-0000-4000-8000-000000000205','영어','consultation_waiting',
       v_profile_id,'manual',pg_catalog.clock_timestamp(),false,
       'observation_requested',1,pg_catalog.clock_timestamp(),'consultation_completed',0);
    insert into public.ops_registration_appointments(
      id,task_id,kind,scheduled_at,place,status,notification_revision,created_by
    ) values
      ('94600000-0000-4000-8000-000000000107',
       '94600000-0000-4000-8000-000000000105','observation_class',v_starts_at,
       '본관','canceled',1,v_profile_id),
      ('94600000-0000-4000-8000-000000000207',
       '94600000-0000-4000-8000-000000000205','observation_class',v_starts_at,
       '본관','canceled',1,v_profile_id);
    insert into public.ops_registration_observations(
      id,task_id,track_id,appointment_id,class_id,session_authority,
      class_lesson_session_id,legacy_session_key,session_date,starts_at,ends_at,
      session_schedule_state,session_source_revision,legacy_session_source_hash,
      source_revision,booking_fact_hash,teacher_catalog_id,teacher_profile_id,
      classroom_catalog_id,subject,class_name_snapshot,teacher_name_snapshot,
      classroom_name_snapshot,campus,textbook_snapshot,progress_snapshot,
      status,attendance,suitability_result,feedback_reason,attendance_recorded_by,
      attendance_recorded_at,feedback_submitted_by,feedback_submitted_at,
      feedback_revision,created_by,updated_by
    )
    select fixture.observation_id,fixture.task_id,fixture.track_id,
      fixture.appointment_id,v_class_id,'normalized',v_session_id,null,
      v_session_date,v_starts_at,v_ends_at,'active',1,null,
      v_source_revision,v_booking_hash,v_teacher_id,v_profile_id,v_classroom_id,
      '영어','동시 claim 영어반','동시 claim 선생님','동시 claim 401호','본관',
      '["동시 교재"]'::jsonb,'동시 진도','canceled',null,null,
      null,null,null,null,null,0,v_profile_id,v_profile_id
    from (values
      ('94600000-0000-4000-8000-000000000108'::uuid,
       '94600000-0000-4000-8000-000000000105'::uuid,
       '94600000-0000-4000-8000-000000000106'::uuid,
       '94600000-0000-4000-8000-000000000107'::uuid),
      ('94600000-0000-4000-8000-000000000208'::uuid,
       '94600000-0000-4000-8000-000000000205'::uuid,
       '94600000-0000-4000-8000-000000000206'::uuid,
       '94600000-0000-4000-8000-000000000207'::uuid)
    ) fixture(observation_id,task_id,track_id,appointment_id);
    insert into dashboard_private.registration_observation_domain_events(
      event_id,observation_id,appointment_id,notification_revision,event_kind,
      booking_fact_hash,source_revision,occurred_at
    ) values
      ('94600000-0000-4000-8000-000000000109',
       '94600000-0000-4000-8000-000000000108',
       '94600000-0000-4000-8000-000000000107',1,
       'observation_canceled',v_booking_hash,v_source_revision,
       pg_catalog.clock_timestamp()-interval '1 second'),
      ('94600000-0000-4000-8000-000000000209',
       '94600000-0000-4000-8000-000000000208',
       '94600000-0000-4000-8000-000000000207',1,
       'observation_canceled',v_booking_hash,v_source_revision,
       pg_catalog.clock_timestamp()-interval '1 second');
    if (select pg_catalog.count(*)
        from dashboard_private.registration_observation_chat_jobs job
        where job.observation_id in (
          '94600000-0000-4000-8000-000000000108',
          '94600000-0000-4000-8000-000000000208'
        ) and job.status='pending') <> 2 then
      raise exception 'registration_observation_chat_claim_fixture_missing';
    end if;
  end
  $setup$;
$remote$);

select dblink_connect(
  connection_name,
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres application_name=' || connection_name
)
from (values
  ('observation_chat_claim_a'),
  ('observation_chat_claim_b')
) connection(connection_name);
select dblink_exec(
  connection_name,
  'set "request.jwt.claim.role" = ''service_role'''
)
from (values
  ('observation_chat_claim_a'),
  ('observation_chat_claim_b')
) connection(connection_name);
select dblink_send_query(
  'observation_chat_claim_a',
  $$select claim::text as payload
    from public.claim_registration_observation_chat_jobs_v1(
      'google-chat-concurrent-a',1,60
    ) claim$$
);
select dblink_send_query(
  'observation_chat_claim_b',
  $$select claim::text as payload
    from public.claim_registration_observation_chat_jobs_v1(
      'google-chat-concurrent-b',1,60
    ) claim$$
);
insert into chat_concurrent_claim_results
select 'a',payload::jsonb
from dblink_get_result('observation_chat_claim_a') result(payload text);
insert into chat_concurrent_claim_results
select 'b',payload::jsonb
from dblink_get_result('observation_chat_claim_b') result(payload text);
select is(
  (select pg_catalog.jsonb_build_object(
    'workers',pg_catalog.count(*),
    'distinctJobs',pg_catalog.count(distinct payload ->> 'job_id'),
    'attempts',pg_catalog.sum((payload ->> 'attempt_count')::integer),
    'workerOwners',pg_catalog.count(distinct job.claimed_by)
  )
   from chat_concurrent_claim_results result
   join dashboard_private.registration_observation_chat_jobs job
     on job.job_id=(result.payload ->> 'job_id')::uuid),
  '{"workers":2,"distinctJobs":2,"attempts":2,"workerOwners":2}'::jsonb,
  'two concurrent batch-one claim sessions own disjoint jobs exactly once'
);

select dblink_exec('observation_chat_claim_setup',$remote$
  do $cleanup$
  begin
    delete from dashboard_private.registration_observation_chat_jobs job
    where job.observation_id in (
      '94600000-0000-4000-8000-000000000108',
      '94600000-0000-4000-8000-000000000208'
    );
    delete from dashboard_private.registration_observation_domain_events event
    where event.observation_id in (
      '94600000-0000-4000-8000-000000000108',
      '94600000-0000-4000-8000-000000000208'
    );
    update dashboard_private.notification_rules
    set enabled=false,revision=1,updated_at=pg_catalog.clock_timestamp()
    where id='81000000-0000-4000-8000-000000000003';
  end
  $cleanup$;
$remote$);
select dblink_disconnect(connection_name)
from (values
  ('observation_chat_claim_a'),
  ('observation_chat_claim_b'),
  ('observation_chat_claim_setup')
) connection(connection_name);

create temp table chat_materialize_result(payload jsonb not null) on commit drop;
grant select,insert on table chat_materialize_result to service_role;
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$
  select public.materialize_registration_observation_chat_job_v1(
    (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=2),
    (select (payload ->> 'claim_token')::uuid from chat_claim_result where generation=2),
    3,
    pg_temp.registration_observation_chat_payload_for_job_v1(
      (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=2)
    ) || '{"phone":"01000000000"}'::jsonb
  )
$$,'22023','registration_observation_chat_payload_invalid',
  'materialize rejects payload key injection before event creation');
select throws_ok($guard$
  do $materialize$
  begin
    perform public.materialize_registration_observation_chat_job_v1(
      (select (payload ->> 'job_id')::uuid
       from chat_claim_result where generation=2),
      (select (payload ->> 'claim_token')::uuid
       from chat_claim_result where generation=2),
      null,
      pg_temp.registration_observation_chat_payload_for_job_v1(
        (select (payload ->> 'job_id')::uuid
         from chat_claim_result where generation=2)
      )
    );
    raise exception 'registration_observation_chat_schema_guard_missing'
      using errcode='P0001';
  end
  $materialize$
$guard$,'22023','registration_observation_chat_payload_invalid',
  'materialize rejects a null schema version instead of hard-coding version three');

reset role;
create or replace function pg_temp.exercise_registration_observation_materialize_drift_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before bigint;
  v_receipt jsonb;
  v_result jsonb;
begin
  begin
    select pg_catalog.count(*) into v_before
    from dashboard_private.notification_events event
    where event.source_type='registration_observation'
      and event.source_id='94000000-0000-4000-8000-000000000208'
      and event.event_key='registration.observation_scheduled';
    update public.class_lesson_sessions
    set schedule_state='makeup',updated_at=pg_catalog.clock_timestamp()
    where id='94000000-0000-4000-8000-000000000104';
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    v_receipt := public.materialize_registration_observation_chat_job_v1(
      p_job_id,p_claim_token,3,p_payload
    );
    select pg_catalog.jsonb_build_object(
      'receipt',v_receipt,
      'status',job.status,
      'error',job.last_error_code,
      'claimToken',job.claim_token,
      'lease',job.lease_expires_at,
      'eventDelta',(
        select pg_catalog.count(*)-v_before
        from dashboard_private.notification_events event
        where event.source_type='registration_observation'
          and event.source_id='94000000-0000-4000-8000-000000000208'
          and event.event_key='registration.observation_scheduled'
      )
    ) into v_result
    from dashboard_private.registration_observation_chat_jobs job
    where job.job_id=p_job_id;
    raise exception 'registration_observation_materialize_drift_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_materialize_drift_v1(
    (select (payload ->> 'job_id')::uuid
     from chat_claim_result where generation=2),
    (select (payload ->> 'claim_token')::uuid
     from chat_claim_result where generation=2),
    pg_temp.registration_observation_chat_payload_for_job_v1(
      (select (payload ->> 'job_id')::uuid
       from chat_claim_result where generation=2)
    )
  ),
  '{"receipt":{"outcome":"source_dirty","error_code":"source_schedule_changed"},"status":"source_dirty","error":"source_schedule_changed","claimToken":null,"lease":null,"eventDelta":0}'::jsonb,
  'materialize closes booking drift as source-dirty with zero NCP event'
);
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
insert into chat_materialize_result
select public.materialize_registration_observation_chat_job_v1(
  (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=2),
  (select (payload ->> 'claim_token')::uuid from chat_claim_result where generation=2),
  3,
  pg_temp.registration_observation_chat_payload_for_job_v1(
    (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=2)
  )
);
select is(
  public.materialize_registration_observation_chat_job_v1(
    (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=2),
    (select (payload ->> 'claim_token')::uuid from chat_claim_result where generation=2),
    3,
    pg_temp.registration_observation_chat_payload_for_job_v1(
      (select (payload ->> 'job_id')::uuid from chat_claim_result where generation=2)
    )
  ),
  (select payload from chat_materialize_result),
  'exact materialize replay returns the same canonical event receipt'
);
reset role;
select is(
  (select pg_catalog.jsonb_build_object(
    'jobStatus',job.status,
    'claimToken',job.claim_token,
    'lease',job.lease_expires_at,
    'eventCount',(select count(*) from dashboard_private.notification_events event
      where event.source_type='registration_observation'
        and event.source_id=job.observation_id::text
        and event.event_key=job.event_key)
  )
  from dashboard_private.registration_observation_chat_jobs job
  where job.job_id=(select (payload ->> 'job_id')::uuid
                    from chat_claim_result where generation=2)),
  '{"jobStatus":"materialized","claimToken":null,"lease":null,"eventCount":1}'::jsonb,
  'materialize atomically clears the claim and creates one canonical event'
);

create temp table chat_delivery_target(
  target_set jsonb not null,
  target_hash text not null,
  batch jsonb not null
) on commit drop;
insert into chat_delivery_target
select target_set,
  dashboard_private.notification_target_set_hash_v1(target_set),
  pg_catalog.jsonb_build_object(
    'deliveries',pg_catalog.jsonb_build_array(
      (target_set -> 0) || pg_catalog.jsonb_build_object(
        'template_id','82000000-0000-4000-8000-000000000001',
        'rendered_title','청강 예약',
        'rendered_body','합성 청강학생의 영어 청강이 예약되었습니다.',
        'href','/admin/registration-observation?observationId=94000000-0000-4000-8000-000000000208',
        'scheduled_for',pg_catalog.clock_timestamp()
      )
    )
  )
from (
  select pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'target_kind','connection',
    'target_key','connection:google_chat.english',
    'target_profile_id',null,
    'connection_key','google_chat.english',
    'target_snapshot',pg_catalog.jsonb_build_object(
      'connection_key','google_chat.english'
    )
  )) as target_set
) target;
grant select on table chat_delivery_target to service_role;

create temp table chat_fanout_claim(payload jsonb not null) on commit drop;
grant select,insert on table chat_fanout_claim to service_role;
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
insert into chat_fanout_claim
select claim
from public.claim_notification_fanout_jobs_v1(
  'google-chat-fanout-contract',100,60
) claim
where (claim ->> 'event_id')::uuid = (
  select (payload ->> 'event_id')::uuid from chat_materialize_result
);
select public.apply_notification_fanout_batch_v1(
  (select (payload ->> 'job_id')::uuid from chat_fanout_claim),
  (select (payload ->> 'claim_token')::uuid from chat_fanout_claim),
  null,
  '81000000-0000-4000-8000-000000000001',2,1,
  (select target_hash from chat_delivery_target),
  (select pg_catalog.jsonb_set(
     target.batch,
     '{deliveries,0,scheduled_for}',
     pg_catalog.to_jsonb(claim.payload ->> 'scheduled_for'),
     false
   )
   from chat_delivery_target target
   cross join chat_fanout_claim claim),
  null,true
);
reset role;
select is(
  (select pg_catalog.jsonb_build_object(
    'claims',pg_catalog.count(*),
    'deliveryCount',(
      select pg_catalog.count(*)
      from dashboard_private.notification_deliveries delivery
      where delivery.event_id=(
        select (payload ->> 'event_id')::uuid from chat_materialize_result
      )
    )
  ) from chat_fanout_claim),
  '{"claims":1,"deliveryCount":1}'::jsonb,
  'protected fanout RPC creates one canonical observation delivery'
);

-- The frozen generic materializer predates its own pending/next-at CHECK and
-- remains default-OFF. Promote only this rollback-only fixture so Task 1 can
-- exercise the protected generic claim and the new observation wrappers
-- without replacing any protected generic function body.
update dashboard_private.notification_deliveries delivery
set status='pending',status_reason=null,next_attempt_at=null,resolved_at=null,
    updated_at=pg_catalog.clock_timestamp()
where delivery.event_id=(
  select (payload ->> 'event_id')::uuid from chat_materialize_result
);
do $fixture_reserve$
declare
  v_delivery_id uuid;
begin
  select delivery.id into strict v_delivery_id
  from dashboard_private.notification_deliveries delivery
  where delivery.event_id=(
    select (payload ->> 'event_id')::uuid from chat_materialize_result
  );
  perform dashboard_private.reserve_canonical_dispatch_ownership_v1(v_delivery_id);
end
$fixture_reserve$;

create temp table chat_delivery_claim(payload jsonb not null) on commit drop;
grant select,insert on table chat_delivery_claim to service_role;
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
insert into chat_delivery_claim
select claim
from public.claim_notification_deliveries_v1(
  'google-chat-delivery-contract',100,60
) claim
where (claim ->> 'event_id')::uuid = (
  select (payload ->> 'event_id')::uuid from chat_materialize_result
);
reset role;
select is(
  (select pg_catalog.count(*) from chat_delivery_claim),
  1::bigint,
  'protected delivery claim returns the one materialized observation delivery'
);

create temp table chat_delivery_refresh_fixture(
  event_payload jsonb not null,
  injected_payload jsonb not null,
  tampered_payload jsonb not null,
  event_payload_hash text not null,
  injected_payload_hash text not null,
  tampered_payload_hash text not null,
  render_hash text not null
) on commit drop;
insert into chat_delivery_refresh_fixture
select
  event.payload,
  event.payload || '{"phone":"01000000000"}'::jsonb,
  pg_catalog.jsonb_set(event.payload,'{student_name}','"변조 학생"'::jsonb),
  dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(event.payload)
  ),
  dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      event.payload || '{"phone":"01000000000"}'::jsonb
    )
  ),
  dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_set(event.payload,'{student_name}','"변조 학생"'::jsonb)
    )
  ),
  dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'title','청강 예약',
        'body','합성 청강학생의 영어 청강이 예약되었습니다.',
        'href','/admin/registration-observation?observationId=94000000-0000-4000-8000-000000000208'
      )
    )
  )
from dashboard_private.notification_events event
where event.id=(select (payload ->> 'event_id')::uuid from chat_delivery_claim);
grant select on table chat_delivery_refresh_fixture to service_role;

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select is(
  (select pg_catalog.jsonb_build_object(
    'keys',pg_catalog.jsonb_agg(key order by key),
    'snapshotMatches',frozen.value -> 'snapshot' = event.payload,
    'payloadFingerprint',frozen.value -> 'payloadFingerprint',
    'renderFingerprint',frozen.value -> 'renderFingerprint'
  )
  from chat_delivery_claim claim
  join dashboard_private.notification_events event
    on event.id=(claim.payload ->> 'event_id')::uuid
  cross join lateral public.read_registration_observation_notification_delivery_frozen_state_v1(
    (claim.payload ->> 'delivery_id')::uuid,
    (claim.payload ->> 'claim_token')::uuid
  ) frozen(value)
  cross join lateral pg_catalog.jsonb_object_keys(frozen.value) key
  group by frozen.value,event.payload),
  '{"keys":["attemptCount","body","expiresAt","href","lastAttemptStartedAt","payloadFingerprint","renderFingerprint","snapshot","title"],"snapshotMatches":true,"payloadFingerprint":null,"renderFingerprint":null}'::jsonb,
  'first frozen-state read returns the exact nine keys and immutable event payload'
);
select throws_ok($$
  select public.refresh_registration_observation_notification_delivery_v1(
    (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
    (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
    (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
    '81000000-0000-4000-8000-000000000001',2,
    '청강 예약','합성 청강학생의 영어 청강이 예약되었습니다.',
    '/admin/registration-observation?observationId=94000000-0000-4000-8000-000000000208',
    (select injected_payload from chat_delivery_refresh_fixture),
    (select injected_payload_hash from chat_delivery_refresh_fixture),
    (select render_hash from chat_delivery_refresh_fixture)
  )
$$,'22023','registration_observation_delivery_refresh_invalid',
  'delivery refresh rejects an exact-hash payload with an injected key');

select throws_ok($$
  select public.refresh_registration_observation_notification_delivery_v1(
    (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
    (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
    (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
    '81000000-0000-4000-8000-000000000001',2,
    '청강 예약','합성 청강학생의 영어 청강이 예약되었습니다.',
    '/admin/registration-observation?observationId=94000000-0000-4000-8000-000000000208',
    (select tampered_payload from chat_delivery_refresh_fixture),
    (select tampered_payload_hash from chat_delivery_refresh_fixture),
    (select render_hash from chat_delivery_refresh_fixture)
  )
$$,'40001','registration_observation_delivery_refresh_stale',
  'delivery refresh rejects same-key student tampering with recomputed hashes');

select public.refresh_registration_observation_notification_delivery_v1(
  (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
  (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
  (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
  '81000000-0000-4000-8000-000000000001',2,
  '청강 예약','합성 청강학생의 영어 청강이 예약되었습니다.',
  '/admin/registration-observation?observationId=94000000-0000-4000-8000-000000000208',
  (select event_payload from chat_delivery_refresh_fixture),
  (select event_payload_hash from chat_delivery_refresh_fixture),
  (select render_hash from chat_delivery_refresh_fixture)
);
reset role;

select ok(
  dashboard_private.registration_observation_chat_refresh_payload_matches_v1(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(
            (select event_payload from chat_delivery_refresh_fixture),
            '{event_kind}',
            '"registration.observation_reminder_due"'::jsonb
          ),
          '{source_revision}',
          '{"authority":"normalized","revision":99,"sessionId":"94000000-0000-4000-8000-000000000201"}'::jsonb
        ),
        '{textbook_names}',
        '["현재 교재"]'::jsonb
      ),
      '{progress_summary}',
      '"현재 진도"'::jsonb
    ),
    pg_catalog.jsonb_set(
      (select event_payload from chat_delivery_refresh_fixture),
      '{event_kind}',
      '"registration.observation_reminder_due"'::jsonb
    ),
    '{"authority":"normalized","revision":99,"sessionId":"94000000-0000-4000-8000-000000000201"}'::jsonb,
    '["현재 교재"]'::jsonb,
    '현재 진도'
  ),
  'reminder refresh permits only current source revision and preparation fields'
);

create or replace function pg_temp.exercise_registration_observation_reminder_refresh_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_job_claim jsonb;
  v_payload_v8 jsonb;
  v_payload_v9 jsonb;
  v_materialized jsonb;
  v_event_id uuid;
  v_fanout_claim jsonb;
  v_target_set jsonb;
  v_target_hash text;
  v_delivery_id uuid;
  v_delivery_claim jsonb;
  v_payload_hash text;
  v_render_hash text;
  v_refresh jsonb;
  v_prepare jsonb;
  v_result jsonb;
begin
  begin
    select job.job_id into strict v_job_id
    from dashboard_private.registration_observation_chat_jobs job
    where job.observation_id='94000000-0000-4000-8000-000000000108'
      and job.event_key='registration.observation_reminder_due';

    update public.ops_registration_observations
    set status='scheduled',attendance=null,attendance_recorded_by=null,
        attendance_recorded_at=null,suitability_result=null,
        feedback_reason=null,feedback_submitted_by=null,
        feedback_submitted_at=null,feedback_revision=0,
        updated_at=pg_catalog.clock_timestamp()
    where id='94000000-0000-4000-8000-000000000108';
    update dashboard_private.registration_observation_chat_jobs
    set status='pending',next_attempt_at=pg_catalog.clock_timestamp(),
        due_at=pg_catalog.clock_timestamp(),claimed_by=null,claim_token=null,
        lease_expires_at=null,last_error_code=null,completed_at=null,
        updated_at=pg_catalog.clock_timestamp()
    where job_id=v_job_id;

    update public.class_lesson_sessions
    set revision=8,updated_at=pg_catalog.clock_timestamp()
    where id='94000000-0000-4000-8000-000000000104';
    perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
      '94000000-0000-4000-8000-000000000103',
      '94000000-0000-4000-8000-000000000001',
      'registration_observation_reminder_preparation_v8'
    );
    update public.classes class
    set schedule_plan=pg_catalog.jsonb_build_object(
      'textbooks',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'textbookId','reminder-book-v8','title','현재 교재 v8'
      )),
      'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'sessionKey',(select lesson.session_key
          from public.class_lesson_sessions lesson
          where lesson.id='94000000-0000-4000-8000-000000000104'),
        'textbookEntries',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'textbookId','reminder-book-v8',
          'plan',pg_catalog.jsonb_build_object('label','8~9쪽','memo','v8 메모')
        ))
      ))
    )
    where class.id='94000000-0000-4000-8000-000000000103';

    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    select claim into v_job_claim
    from public.claim_registration_observation_chat_jobs_v1(
      'google-chat-reminder-refresh-job',100,60
    ) claim
    where (claim ->> 'job_id')::uuid=v_job_id;
    if v_job_claim is null then
      select pg_catalog.jsonb_build_object(
        'jobStatus',job.status,
        'jobError',job.last_error_code
      ) into v_result
      from dashboard_private.registration_observation_chat_jobs job
      where job.job_id=v_job_id;
      raise exception 'registration_observation_reminder_refresh_fixture_rollback'
        using errcode='P1001';
    end if;
    v_payload_v8 := pg_temp.registration_observation_chat_payload_for_job_v1(
      v_job_id
    );
    v_payload_v8 := pg_catalog.jsonb_set(
      v_payload_v8,
      '{source_revision}',
      dashboard_private.get_registration_observation_notification_source_impl_v1(
        '94000000-0000-4000-8000-000000000108'
      ) -> 'sourceRevision'
    );
    v_payload_v8 := pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        v_payload_v8,'{textbook_names}','["현재 교재 v8"]'::jsonb
      ),
      '{progress_summary}','"8~9쪽 · v8 메모"'::jsonb
    );
    v_materialized := public.materialize_registration_observation_chat_job_v1(
      v_job_id,(v_job_claim ->> 'claim_token')::uuid,3,v_payload_v8
    );
    v_event_id := (v_materialized ->> 'event_id')::uuid;

    select claim into strict v_fanout_claim
    from public.claim_notification_fanout_jobs_v1(
      'google-chat-reminder-refresh-fanout',100,60
    ) claim
    where (claim ->> 'event_id')::uuid=v_event_id;
    v_target_set := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind','connection',
      'target_key','connection:google_chat.english',
      'target_profile_id',null,
      'connection_key','google_chat.english',
      'target_snapshot',pg_catalog.jsonb_build_object(
        'connection_key','google_chat.english'
      )
    ));
    v_target_hash := dashboard_private.notification_target_set_hash_v1(
      v_target_set
    );
    perform public.apply_notification_fanout_batch_v1(
      (v_fanout_claim ->> 'job_id')::uuid,
      (v_fanout_claim ->> 'claim_token')::uuid,
      null,'81000000-0000-4000-8000-000000000004',2,1,
      v_target_hash,
      pg_catalog.jsonb_build_object(
        'deliveries',pg_catalog.jsonb_build_array(
          (v_target_set -> 0) || pg_catalog.jsonb_build_object(
            'template_id','82000000-0000-4000-8000-000000000004',
            'rendered_title','오늘 청강 준비',
            'rendered_body','현재 교재와 진도를 확인해 주세요.',
            'href','/admin/registration-observation?observationId=94000000-0000-4000-8000-000000000108',
            'scheduled_for',v_fanout_claim ->> 'scheduled_for'
          )
        )
      ),
      null,true
    );
    select delivery.id into strict v_delivery_id
    from dashboard_private.notification_deliveries delivery
    where delivery.event_id=v_event_id;
    update dashboard_private.notification_deliveries
    set status='pending',status_reason=null,next_attempt_at=null,
        resolved_at=null,updated_at=pg_catalog.clock_timestamp()
    where id=v_delivery_id;
    perform dashboard_private.reserve_canonical_dispatch_ownership_v1(
      v_delivery_id
    );
    select claim into strict v_delivery_claim
    from public.claim_notification_deliveries_v1(
      'google-chat-reminder-refresh-delivery',100,60
    ) claim
    where (claim ->> 'delivery_id')::uuid=v_delivery_id;

    update public.class_lesson_sessions
    set revision=9,updated_at=pg_catalog.clock_timestamp()
    where id='94000000-0000-4000-8000-000000000104';
    perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
      '94000000-0000-4000-8000-000000000103',
      '94000000-0000-4000-8000-000000000001',
      'registration_observation_reminder_preparation_v9'
    );
    update public.classes class
    set schedule_plan=pg_catalog.jsonb_build_object(
      'textbooks',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'textbookId','reminder-book-v9','title','현재 교재 v9'
      )),
      'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'sessionKey',(select lesson.session_key
          from public.class_lesson_sessions lesson
          where lesson.id='94000000-0000-4000-8000-000000000104'),
        'textbookEntries',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'textbookId','reminder-book-v9',
          'plan',pg_catalog.jsonb_build_object(
            'label','50~57쪽','memo','단어 시험'
          )
        ))
      ))
    )
    where class.id='94000000-0000-4000-8000-000000000103';
    select event.payload into strict v_payload_v9
    from dashboard_private.notification_events event
    where event.id=v_event_id;
    v_payload_v9 := pg_catalog.jsonb_set(
      v_payload_v9,
      '{source_revision}',
      dashboard_private.get_registration_observation_notification_source_impl_v1(
        '94000000-0000-4000-8000-000000000108'
      ) -> 'sourceRevision'
    );
    v_payload_v9 := pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        v_payload_v9,'{textbook_names}','["현재 교재 v9"]'::jsonb
      ),
      '{progress_summary}','"50~57쪽 · 단어 시험"'::jsonb
    );
    v_payload_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(v_payload_v9)
    );
    v_render_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(
        pg_catalog.jsonb_build_object(
          'title','오늘 청강 준비',
          'body','현재 교재와 진도를 확인해 주세요.',
          'href','/admin/registration-observation?observationId=94000000-0000-4000-8000-000000000108'
        )
      )
    );
    v_refresh := public.refresh_registration_observation_notification_delivery_v1(
      v_delivery_id,(v_delivery_claim ->> 'claim_token')::uuid,
      v_event_id,'81000000-0000-4000-8000-000000000004',2,
      '오늘 청강 준비','현재 교재와 진도를 확인해 주세요.',
      '/admin/registration-observation?observationId=94000000-0000-4000-8000-000000000108',
      v_payload_v9,v_payload_hash,v_render_hash
    );

    insert into public.google_chat_webhook_settings(
      channel,webhook_url,webhook_url_ciphertext,webhook_url_mask,
      connection_state,revision,last_verified_at,last_error_code
    ) values (
      'english',
      'https://chat.googleapis.com/v1/spaces/ENGLISH01/messages?key=fixture-key&token=fixture-token',
      null,null,'legacy_active',1,pg_catalog.clock_timestamp(),null
    ) on conflict (channel) do update set
      webhook_url=excluded.webhook_url,
      connection_state=excluded.connection_state,
      revision=excluded.revision,
      last_verified_at=excluded.last_verified_at,
      last_error_code=excluded.last_error_code;
    update dashboard_private.notification_runtime_flags
    set enabled=true,revision=revision+1,
        updated_at=pg_catalog.clock_timestamp()
    where flag_key='notification_control_plane_dispatch_registration_enabled';
    v_prepare := public.prepare_registration_observation_notification_delivery_v1(
      v_delivery_id,(v_delivery_claim ->> 'claim_token')::uuid,
      v_event_id,'81000000-0000-4000-8000-000000000004',2,
      v_payload_hash,v_render_hash
    );
    select pg_catalog.jsonb_build_object(
      'eventRevision',event.payload #>> '{source_revision,revision}',
      'eventTextbooks',event.payload -> 'textbook_names',
      'frozenRevision',delivery.observation_payload_snapshot
        #>> '{source_revision,revision}',
      'frozenTextbooks',delivery.observation_payload_snapshot
        -> 'textbook_names',
      'frozenProgress',delivery.observation_payload_snapshot
        ->> 'progress_summary',
      'refreshOutcome',v_refresh ->> 'outcome',
      'prepared',(v_prepare ->> 'prepared')::boolean,
      'status',v_prepare ->> 'status',
      'attemptDelta',(
        select pg_catalog.count(*)
        from dashboard_private.notification_audit_logs audit
        where audit.entity_kind='notification_external_attempt'
          and audit.action='external_attempt_registered'
          and audit.entity_id like ownership.id::text || ':%'
      )
    ) into v_result
    from dashboard_private.notification_events event
    join dashboard_private.notification_deliveries delivery
      on delivery.event_id=event.id
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on ownership.workflow_key=event.workflow_key
     and ownership.occurrence_key=event.occurrence_key
     and ownership.rule_id=delivery.rule_id
     and ownership.channel_key=delivery.channel_key
     and ownership.target_key=delivery.target_key
     and ownership.target_generation=delivery.target_generation
    where event.id=v_event_id;
    raise exception 'registration_observation_reminder_refresh_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_reminder_refresh_v1(),
  '{"eventRevision":"8","eventTextbooks":["현재 교재 v8"],"frozenRevision":"9","frozenTextbooks":["현재 교재 v9"],"frozenProgress":"50~57쪽 · 단어 시험","refreshOutcome":"refreshed","prepared":true,"status":"sending","attemptDelta":0}'::jsonb,
  'real reminder materialize and first-attempt final prepare refresh only current same-session preparation'
);

-- Final-prepare concurrency uses only committed fixtures.  The outer pgTAP
-- transaction cannot make its local rows visible to dblink workers, so this
-- helper owns a disposable 946* fixture and is dropped before the test ends.
select dblink_connect(
  'observation_chat_race_setup',
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
    || ' application_name=observation_chat_race_setup'
);
select dblink_exec('observation_chat_race_setup',$remote$
  insert into auth.users(
    id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values (
    '94600000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'chat-race-director-b@example.invalid',
    crypt('chat-race-only',gen_salt('bf')),pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
    pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
  ) on conflict (id) do update set
    email=excluded.email,updated_at=excluded.updated_at;
  insert into public.profiles(id,role,name,email,created_at,updated_at)
  values (
    '94600000-0000-4000-8000-000000000002','admin','경합 원장 B',
    'chat-race-director-b@example.invalid',
    pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
  ) on conflict (id) do update set
    role=excluded.role,name=excluded.name,email=excluded.email,
    updated_at=excluded.updated_at;
  update public.profiles set teacher_catalog_id=null
  where id='94600000-0000-4000-8000-000000000002';
  delete from public.teacher_catalogs
  where profile_id='94600000-0000-4000-8000-000000000002';
  insert into public.teacher_catalogs(
    id,name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role
  ) values (
    '94600000-0000-4000-8000-000000000202','경합 원장 B',
    array['영어']::text[],true,9963,
    '94600000-0000-4000-8000-000000000002',
    'chat-race-director-b@example.invalid','teacher'
  );
  update public.profiles
  set teacher_catalog_id='94600000-0000-4000-8000-000000000202'
  where id='94600000-0000-4000-8000-000000000002';
  insert into public.ops_registration_details(task_id)
  values
    ('94600000-0000-4000-8000-000000000105'),
    ('94600000-0000-4000-8000-000000000205')
  on conflict (task_id) do nothing;
  select dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '94600000-0000-4000-8000-000000000103'::uuid,
    '94600000-0000-4000-8000-000000000198'::uuid,
    'registration_observation_chat_race_slot'
  );
  insert into public.class_schedule_slots(
    id,class_id,weekday,start_time,end_time,
    teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name,
    sort_order
  ) values (
    '94600000-0000-4000-8000-000000000113',
    '94600000-0000-4000-8000-000000000103',
    extract(dow from (
      (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date + 10
    ))::smallint,
    '12:00','13:00',
    '94600000-0000-4000-8000-000000000101','동시 claim 선생님',
    '94600000-0000-4000-8000-000000000102','동시 claim 401호',0
  );
  insert into dashboard_private.notification_rules(
    id,scope_key,workflow_key,event_key,channel_key,audience_key,
    rule_variant_key,delivery_mode,schedule_key,schedule_config,
    enabled,active_template_id,revision,
    created_by,created_actor_kind,updated_by,updated_actor_kind
  )
  select fixture.rule_id,rule.scope_key,rule.workflow_key,rule.event_key,
    rule.channel_key,rule.audience_key,'offset_before','scheduled',
    'offset_before','{"offsetMinutes":1}'::jsonb,true,
    fixture.template_id,2,null,'system',null,'system'
  from (values
    ('81000000-0000-4000-8000-000000000006'::uuid,
     '94600000-0000-4000-8000-000000000301'::uuid,
     '94600000-0000-4000-8000-000000000401'::uuid),
    ('81000000-0000-4000-8000-000000000007'::uuid,
     '94600000-0000-4000-8000-000000000302'::uuid,
     '94600000-0000-4000-8000-000000000402'::uuid)
  ) fixture(source_rule_id,rule_id,template_id)
  join dashboard_private.notification_rules rule
    on rule.id=fixture.source_rule_id;
  insert into dashboard_private.notification_templates(
    id,rule_id,version,title_template,body_template,allowed_variables,
    payload_schema_version,checksum,created_by,created_actor_kind
  )
  select fixture.template_id,fixture.rule_id,1,template.title_template,
    template.body_template,template.allowed_variables,
    template.payload_schema_version,template.checksum,null,'system'
  from (values
    ('82000000-0000-4000-8000-000000000006'::uuid,
     '94600000-0000-4000-8000-000000000301'::uuid,
     '94600000-0000-4000-8000-000000000401'::uuid),
    ('82000000-0000-4000-8000-000000000007'::uuid,
     '94600000-0000-4000-8000-000000000302'::uuid,
     '94600000-0000-4000-8000-000000000402'::uuid)
  ) fixture(source_template_id,rule_id,template_id)
  join dashboard_private.notification_templates template
    on template.id=fixture.source_template_id;
  set session_replication_role=replica;
  insert into dashboard_private.notification_rule_mention_settings(
    rule_id,mention_enabled,revision,updated_by
  ) values
    ('94600000-0000-4000-8000-000000000301',true,1,null),
    ('94600000-0000-4000-8000-000000000302',true,1,null);
  set session_replication_role=origin;
  update dashboard_private.notification_runtime_flags
  set enabled=true,revision=revision+1,updated_at=pg_catalog.clock_timestamp()
  where flag_key='notification_control_plane_dispatch_registration_enabled';
  insert into public.google_chat_webhook_settings(
    channel,webhook_url,webhook_url_ciphertext,webhook_url_mask,
    connection_state,revision,last_verified_at,last_error_code
  ) values (
    'admin',
    'https://chat.googleapis.com/v1/spaces/RACEMANAGEMENT/messages?key=fixture-key&token=fixture-token',
    null,null,'legacy_active',1,pg_catalog.clock_timestamp(),null
  ) on conflict (channel) do update set
    webhook_url=excluded.webhook_url,
    webhook_url_ciphertext=excluded.webhook_url_ciphertext,
    webhook_url_mask=excluded.webhook_url_mask,
    connection_state=excluded.connection_state,
    revision=excluded.revision,
    last_verified_at=excluded.last_verified_at,
    last_error_code=excluded.last_error_code;

  create or replace function dashboard_private.registration_observation_chat_race_fixture_v1(
    p_kind text,
    p_event_id uuid,
    p_delivery_id uuid
  )
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
  as $fixture$
  declare
    v_profile_a constant uuid := '94600000-0000-4000-8000-000000000001';
    v_observation_id uuid;
    v_track_id uuid;
    v_task_id uuid;
    v_appointment_id uuid;
    v_class_id constant uuid := '94600000-0000-4000-8000-000000000103';
    v_session_id constant uuid := '94600000-0000-4000-8000-000000000104';
    v_teacher_id constant uuid := '94600000-0000-4000-8000-000000000101';
    v_classroom_id constant uuid := '94600000-0000-4000-8000-000000000102';
    v_session_key text;
    v_session_date date := (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date + 10;
    v_starts_at timestamptz;
    v_ends_at timestamptz;
    v_lesson_revision bigint;
    v_legacy_hash text;
    v_source_revision jsonb;
    v_booking_fact jsonb;
    v_booking_hash text;
    v_source jsonb;
    v_payload jsonb;
    v_payload_hash text;
    v_render_hash text;
    v_claim_token uuid := pg_catalog.gen_random_uuid();
    v_rule_id uuid;
    v_template_id uuid;
    v_common_revision integer;
    v_content_hash text;
    v_plan jsonb;
  begin
    if p_kind not in ('director','normalized','legacy') then
      raise exception 'registration_observation_chat_race_kind_invalid'
        using errcode='22023';
    end if;
    if p_kind='director' then
      v_observation_id := '94600000-0000-4000-8000-000000000208';
      v_track_id := '94600000-0000-4000-8000-000000000206';
      v_task_id := '94600000-0000-4000-8000-000000000205';
      v_appointment_id := '94600000-0000-4000-8000-000000000207';
      v_rule_id := '94600000-0000-4000-8000-000000000302';
    else
      v_observation_id := '94600000-0000-4000-8000-000000000108';
      v_track_id := '94600000-0000-4000-8000-000000000106';
      v_task_id := '94600000-0000-4000-8000-000000000105';
      v_appointment_id := '94600000-0000-4000-8000-000000000107';
      v_rule_id := '94600000-0000-4000-8000-000000000301';
    end if;
    v_session_key := case when p_kind='legacy' then 'race-legacy-selected'
      else pg_catalog.to_char(v_session_date,'YYYY-MM-DD') || ':race-normalized' end;
    v_starts_at := (v_session_date + time '12:00') at time zone 'Asia/Seoul';
    v_ends_at := (v_session_date + time '13:00') at time zone 'Asia/Seoul';

    update public.ops_registration_subject_tracks
    set pipeline_status='inquiry',director_profile_id=v_profile_a,
        director_assignment_source='manual',
        director_assigned_at=pg_catalog.clock_timestamp(),
        updated_at=pg_catalog.clock_timestamp()
    where id=v_track_id;
    perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
      v_class_id,
      '94600000-0000-4000-8000-000000000199',
      'registration_observation_chat_final_prepare_race'
    );
    if p_kind='legacy' then
      v_plan := pg_catalog.jsonb_build_object(
        'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'sessionKey',v_session_key,'date',v_session_date,
          'scheduleState','active','startTime','12:00','endTime','13:00',
          'teacherCatalogId',v_teacher_id,'teacherName','동시 claim 선생님',
          'classroomCatalogId',v_classroom_id,'classroomName','동시 claim 401호',
          'textbookEntries','[]'::jsonb
        )),
        'textbooks','[]'::jsonb
      );
      update public.classes
      set schedule_storage_mode='legacy',schedule_plan=v_plan
      where id=v_class_id;
      v_legacy_hash :=
        dashboard_private.registration_observation_legacy_session_content_hash_v1(
          v_plan,v_session_key
        );
      v_source_revision := pg_catalog.jsonb_build_object(
        'authority','legacy','sessionKey',v_session_key,
        'contentHash',v_legacy_hash
      );
    else
      update public.classes
      set schedule_storage_mode='normalized',schedule_plan='{}'::jsonb
      where id=v_class_id;
      update public.class_lesson_sessions
      set session_key=v_session_key,session_date=v_session_date,
          schedule_state='active',start_time='12:00',end_time='13:00',
          teacher_catalog_id=v_teacher_id,
          teacher_name_snapshot='동시 claim 선생님',
          classroom_catalog_id=v_classroom_id,
          classroom_name_snapshot='동시 claim 401호',
          revision=revision+1,updated_at=pg_catalog.clock_timestamp()
      where id=v_session_id
      returning revision into v_lesson_revision;
      v_source_revision := pg_catalog.jsonb_build_object(
        'authority','normalized','sessionId',v_session_id,
        'revision',v_lesson_revision
      );
    end if;
    v_booking_fact := pg_catalog.jsonb_build_object(
      'classId',v_class_id,'subject','영어',
      'sessionAuthority',case when p_kind='legacy' then 'legacy' else 'normalized' end,
      'classLessonSessionId',case when p_kind='legacy' then null else v_session_id end,
      'legacySessionKey',case when p_kind='legacy' then v_session_key else null end,
      'sessionKey',v_session_key,'scheduleState','active',
      'sessionDate',v_session_date,'startsAt',v_starts_at,'endsAt',v_ends_at,
      'teacherCatalogId',v_teacher_id,'teacherProfileId',v_profile_a,
      'teacherName','동시 claim 선생님','classroomCatalogId',v_classroom_id,
      'classroomName','동시 claim 401호','campus','본관'
    );
    v_booking_hash :=
      dashboard_private.registration_observation_booking_fact_hash_v1(v_booking_fact);
    update public.ops_registration_appointments
    set scheduled_at=v_starts_at,status='completed',notification_revision=1,
        updated_at=pg_catalog.clock_timestamp()
    where id=v_appointment_id;
    update public.ops_registration_observations
    set class_id=v_class_id,
        session_authority=case when p_kind='legacy' then 'legacy' else 'normalized' end,
        class_lesson_session_id=case when p_kind='legacy' then null else v_session_id end,
        legacy_session_key=case when p_kind='legacy' then v_session_key else null end,
        session_date=v_session_date,starts_at=v_starts_at,ends_at=v_ends_at,
        session_schedule_state='active',
        session_source_revision=case when p_kind='legacy' then null else v_lesson_revision end,
        legacy_session_source_hash=case when p_kind='legacy' then v_legacy_hash else null end,
        source_revision=v_source_revision,booking_fact_hash=v_booking_hash,
        teacher_catalog_id=v_teacher_id,teacher_profile_id=v_profile_a,
        classroom_catalog_id=v_classroom_id,subject='영어',
        class_name_snapshot='동시 claim 영어반',
        teacher_name_snapshot='동시 claim 선생님',
        classroom_name_snapshot='동시 claim 401호',campus='본관',
        status='completed',attendance='attended',suitability_result='fit',
        feedback_reason='경합 피드백',attendance_recorded_by=v_profile_a,
        attendance_recorded_at=pg_catalog.clock_timestamp(),
        feedback_submitted_by=v_profile_a,
        feedback_submitted_at=pg_catalog.clock_timestamp(),
        feedback_revision=1,decision_kind=null,decided_by=null,decided_at=null,
        revision=revision+1,updated_by=v_profile_a,
        updated_at=pg_catalog.clock_timestamp()
    where id=v_observation_id;
    v_source :=
      dashboard_private.get_registration_observation_notification_source_impl_v1(
        v_observation_id
      );
    v_payload := pg_catalog.jsonb_build_object(
      'task_id',v_source ->> 'taskId','track_id',v_source ->> 'trackId',
      'observation_id',v_observation_id,'appointment_id',v_appointment_id,
      'appointment_notification_revision',1,
      'student_name',v_source ->> 'studentName','subject',v_source ->> 'subject',
      'source_revision',v_source -> 'sourceRevision',
      'booking_fact_hash',v_source ->> 'bookingFactHash',
      'occurred_at',pg_catalog.clock_timestamp(),
      'delivery_expires_at',pg_catalog.clock_timestamp()+interval '1 hour',
      'mention_role','track_director',
      'mention_profile_ids',pg_catalog.jsonb_build_array(v_profile_a),
      'event_kind','registration.observation_feedback_submitted',
      'booking',pg_catalog.jsonb_build_object(
        'class_id',v_source ->> 'classId','class_name',v_source ->> 'className',
        'session_authority',v_source ->> 'sessionAuthority',
        'class_lesson_session_id',v_source ->> 'classLessonSessionId',
        'legacy_session_key',v_source ->> 'legacySessionKey',
        'schedule_state',v_source ->> 'scheduleState',
        'starts_at',v_source ->> 'startsAt','ends_at',v_source ->> 'endsAt',
        'teacher_name',v_source ->> 'teacherName',
        'classroom_name',v_source ->> 'classroomName','campus',v_source ->> 'campus'
      ),
      'submitted_by_name','동시 claim 선생님',
      'submitted_at',pg_catalog.clock_timestamp()
    );
    v_payload_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(v_payload)
    );
    v_render_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(
        pg_catalog.jsonb_build_object(
          'title','청강 경합 계약','body','청강 경합 본문',
          'href','/admin/registration?taskId=' || v_task_id::text
        )
      )
    );
    select rule.active_template_id into strict v_template_id
    from dashboard_private.notification_rules rule
    where rule.id=v_rule_id and rule.enabled and rule.revision=2;
    insert into dashboard_private.notification_events(
      id,scope_key,workflow_key,event_key,source_type,source_id,
      source_revision,occurrence_key,occurred_at,payload_schema_version,
      payload,rule_snapshot
    ) values (
      p_event_id,'global','registration',
      'registration.observation_feedback_submitted',
      'registration_observation',v_observation_id::text,1,
      'registration-observation-race:' || p_event_id::text,
      pg_catalog.clock_timestamp(),3,v_payload,
      dashboard_private.registration_observation_chat_rule_snapshot_v1(
        'registration.observation_feedback_submitted'
      )
    );
    insert into dashboard_private.notification_deliveries(
      id,event_id,rule_id,rule_revision,template_id,channel_key,audience_key,
      target_generation,target_set_hash,target_kind,target_key,
      target_profile_id,connection_key,target_snapshot,parent_delivery_id,
      status,status_reason,dedupe_key,rendered_title,rendered_body,href,
      scheduled_for,attempt_count,max_attempts,next_attempt_at,
      claimed_by,claim_token,lease_expires_at
    ) values (
      p_delivery_id,p_event_id,v_rule_id,2,v_template_id,
      case when p_kind='director' then 'in_app' else 'google_chat' end,
      case when p_kind='director' then 'track_director' else 'management_team' end,
      1,pg_catalog.repeat('a',64),
      case when p_kind='director' then 'profile' else 'connection' end,
      case when p_kind='director' then 'profile:' || v_profile_a::text
        else 'connection:google_chat.management' end,
      case when p_kind='director' then v_profile_a else null end,
      case when p_kind='director' then null else 'google_chat.management' end,
      case when p_kind='director'
        then pg_catalog.jsonb_build_object('profile_id',v_profile_a)
        else '{"connection_key":"google_chat.management"}'::jsonb end,
      null,'claimed',null,'registration-observation-race:' || p_delivery_id::text,
      '청강 경합 계약','청강 경합 본문',
      '/admin/registration?taskId=' || v_task_id::text,
      pg_catalog.clock_timestamp(),0,5,null,
      'observation-chat-race',v_claim_token,
      pg_catalog.clock_timestamp()+interval '5 minutes'
    );
    perform dashboard_private.reserve_canonical_dispatch_ownership_v1(
      p_delivery_id
    );
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    perform public.refresh_registration_observation_notification_delivery_v1(
      p_delivery_id,v_claim_token,p_event_id,v_rule_id,2,
      '청강 경합 계약','청강 경합 본문',
      '/admin/registration?taskId=' || v_task_id::text,
      v_payload,v_payload_hash,v_render_hash
    );
    select detail.common_revision into strict v_common_revision
    from public.ops_registration_details detail
    where detail.task_id=v_task_id;
    if p_kind='legacy' then
      select dashboard_private.continuous_class_schedule_content_hash_v1(
        class.schedule_plan
      ) into v_content_hash
      from public.classes class where class.id=v_class_id;
    end if;
    return pg_catalog.jsonb_build_object(
      'kind',p_kind,'eventId',p_event_id,'deliveryId',p_delivery_id,
      'ruleId',v_rule_id,
      'claimToken',v_claim_token,'payloadHash',v_payload_hash,
      'renderHash',v_render_hash,'commonRevision',v_common_revision,
      'lessonRevision',v_lesson_revision,'contentHash',v_content_hash,
      'observationId',v_observation_id,'trackId',v_track_id
    );
  end;
  $fixture$;
  alter function dashboard_private.registration_observation_chat_race_fixture_v1(
    text,uuid,uuid
  ) owner to postgres;
  create or replace function dashboard_private.registration_observation_chat_race_assign_director_v1(
    p_track_id uuid,
    p_director_profile_id uuid,
    p_expected_common_revision integer,
    p_request_id text
  )
  returns jsonb
  language plpgsql
  volatile
  security invoker
  set search_path=''
  as $writer$
  declare
    v_result jsonb;
  begin
    perform pg_catalog.set_config('session_replication_role','replica',true);
    begin
      v_result := public.assign_registration_track_director(
        p_track_id,p_director_profile_id,'manual',null,
        p_expected_common_revision,p_request_id
      );
    exception when others then
      perform pg_catalog.set_config('session_replication_role','origin',true);
      raise;
    end;
    perform pg_catalog.set_config('session_replication_role','origin',true);
    return v_result;
  end;
  $writer$;
  alter function dashboard_private.registration_observation_chat_race_assign_director_v1(
    uuid,uuid,integer,text
  ) owner to postgres;
$remote$);

select dblink_connect(
  connection_name,
  'hostaddr=' || pg_catalog.host(pg_catalog.inet_server_addr())
    || ' port=5432 dbname=' || current_database()
    || ' user=' || connection_user
    || ' password=postgres application_name=' || connection_name
)
from (values
  ('observation_chat_race_blocker','postgres'),
  ('observation_chat_race_prepare','postgres'),
  ('observation_chat_race_writer','supabase_admin')
) connection(connection_name,connection_user);
select dblink_exec('observation_chat_race_prepare',
  'set role service_role; set "request.jwt.claim.role" = ''service_role''; set statement_timeout = ''8s''; set lock_timeout = ''8s''');
select dblink_exec('observation_chat_race_writer',
  'set "request.jwt.claim.role" = ''authenticated''; set "request.jwt.claim.sub" = ''94600000-0000-4000-8000-000000000001''; set statement_timeout = ''8s''; set lock_timeout = ''8s''');
select dblink_exec('observation_chat_race_blocker',
  'set statement_timeout = ''8s''; set lock_timeout = ''8s''');

create or replace function pg_temp.registration_observation_chat_race_writer_sql_v1(
  p_fixture jsonb,
  p_request_id uuid
)
returns text
language plpgsql
stable
set search_path=''
as $$
begin
  if p_fixture ->> 'kind'='director' then
    return pg_catalog.format(
      $sql$select dashboard_private.registration_observation_chat_race_assign_director_v1(
        %L::uuid,'94600000-0000-4000-8000-000000000002'::uuid,
        %s,%L
      )::text$sql$,
      p_fixture ->> 'trackId',
      (p_fixture ->> 'commonRevision')::integer,
      'registration-observation-race-' || p_request_id::text
    );
  elsif p_fixture ->> 'kind'='normalized' then
    return pg_catalog.format(
      $sql$select public.save_class_lesson_session_v1(
        session.id,%s,'makeup',session.session_date,
        session.start_time,session.end_time,session.teacher_catalog_id,
        session.classroom_catalog_id,session.memo,session.public_note,
        session.teacher_note,%L::uuid,null
      )::text
      from public.class_lesson_sessions session
      where session.id='94600000-0000-4000-8000-000000000104'::uuid$sql$,
      (p_fixture ->> 'lessonRevision')::bigint,p_request_id
    );
  elsif p_fixture ->> 'kind'='legacy' then
    return pg_catalog.format(
      $sql$update public.classes class
      set schedule_plan=pg_catalog.jsonb_set(
        class.schedule_plan,
        '{sessions}',
        (
          select pg_catalog.jsonb_agg(
            case when session ->> 'sessionKey'='race-legacy-selected'
              then session || '{"scheduleState":"makeup"}'::jsonb
              else session end
            order by ordinal
          )
          from pg_catalog.jsonb_array_elements(class.schedule_plan -> 'sessions')
            with ordinality source(session,ordinal)
        )
      )
      where class.id='94600000-0000-4000-8000-000000000103'::uuid
      returning pg_catalog.jsonb_build_object(
        'changed',true,'requestId',%L::text
      )::text$sql$,
      p_request_id
    );
  end if;
  raise exception 'registration_observation_chat_race_kind_invalid'
    using errcode='22023';
end;
$$;

create or replace function pg_temp.registration_observation_chat_race_prepare_sql_v1(
  p_fixture jsonb
)
returns text
language sql
stable
set search_path=''
as $$
  select pg_catalog.format(
    $sql$select public.prepare_registration_observation_notification_delivery_v1(
      %L::uuid,%L::uuid,%L::uuid,%L::uuid,
      2,%L,%L
    )::text$sql$,
    p_fixture ->> 'deliveryId',p_fixture ->> 'claimToken',
    p_fixture ->> 'eventId',p_fixture ->> 'ruleId',
    p_fixture ->> 'payloadHash',p_fixture ->> 'renderHash'
  );
$$;

create or replace function pg_temp.exercise_registration_observation_chat_lock_first_v1(
  p_kind text,
  p_event_id uuid,
  p_delivery_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_fixture jsonb;
  v_prepare_result jsonb;
  v_writer_result jsonb;
  v_blocker_pid integer;
  v_prepare_pid integer;
  v_writer_pid integer;
  v_prepare_blocked boolean := false;
  v_writer_blocked boolean := false;
  v_deadline timestamptz;
  v_dummy text;
  v_source_changed boolean;
  v_notifications bigint;
  v_attempts bigint;
begin
  select result.payload::jsonb into strict v_fixture
  from public.dblink(
    'observation_chat_race_setup',
    pg_catalog.format(
      'select dashboard_private.registration_observation_chat_race_fixture_v1(%L,%L::uuid,%L::uuid)::text',
      p_kind,p_event_id,p_delivery_id
    )
  ) result(payload text);
  select result.pid into strict v_blocker_pid
  from public.dblink('observation_chat_race_blocker','select pg_backend_pid()')
    result(pid integer);
  select result.pid into strict v_prepare_pid
  from public.dblink('observation_chat_race_prepare','select pg_backend_pid()')
    result(pid integer);
  select result.pid into strict v_writer_pid
  from public.dblink('observation_chat_race_writer','select pg_backend_pid()')
    result(pid integer);
  perform public.dblink_exec('observation_chat_race_blocker','begin');
  select result.value into strict v_dummy
  from public.dblink(
    'observation_chat_race_blocker',
    pg_catalog.format(
      'select id::text from dashboard_private.notification_deliveries where id=%L::uuid for update',
      p_delivery_id
    )
  ) result(value text);
  perform public.dblink_send_query(
    'observation_chat_race_prepare',
    pg_temp.registration_observation_chat_race_prepare_sql_v1(v_fixture)
  );
  v_deadline := pg_catalog.clock_timestamp()+interval '5 seconds';
  loop
    v_prepare_blocked := v_blocker_pid = any(pg_catalog.pg_blocking_pids(v_prepare_pid));
    exit when v_prepare_blocked or pg_catalog.clock_timestamp() >= v_deadline;
    perform pg_catalog.pg_sleep(0.02);
  end loop;
  perform public.dblink_send_query(
    'observation_chat_race_writer',
    pg_temp.registration_observation_chat_race_writer_sql_v1(v_fixture,p_request_id)
  );
  v_deadline := pg_catalog.clock_timestamp()+interval '5 seconds';
  loop
    v_writer_blocked := pg_catalog.cardinality(
      pg_catalog.pg_blocking_pids(v_writer_pid)
    ) > 0;
    exit when v_writer_blocked or pg_catalog.clock_timestamp() >= v_deadline;
    perform pg_catalog.pg_sleep(0.02);
  end loop;
  perform public.dblink_exec('observation_chat_race_blocker','commit');
  select (pg_catalog.array_agg(result.payload))[1]::jsonb
  into strict v_prepare_result
  from public.dblink_get_result('observation_chat_race_prepare') result(payload text);
  select (pg_catalog.array_agg(result.payload))[1]::jsonb
  into strict v_writer_result
  from public.dblink_get_result('observation_chat_race_writer') result(payload text);
  perform result.payload
  from public.dblink_get_result('observation_chat_race_prepare') result(payload text);
  perform result.payload
  from public.dblink_get_result('observation_chat_race_writer') result(payload text);
  if p_kind='director' then
    select track.director_profile_id=
      '94600000-0000-4000-8000-000000000002'::uuid
    into v_source_changed
    from public.ops_registration_subject_tracks track
    where track.id=(v_fixture ->> 'trackId')::uuid;
  elsif p_kind='normalized' then
    select session.schedule_state='makeup' into v_source_changed
    from public.class_lesson_sessions session
    where session.id='94600000-0000-4000-8000-000000000104';
  else
    select exists (
      select 1
      from pg_catalog.jsonb_array_elements(class.schedule_plan -> 'sessions')
        session(value)
      where session.value ->> 'sessionKey' = 'race-legacy-selected'
        and session.value ->> 'scheduleState' = 'makeup'
    )
    into v_source_changed
    from public.classes class
    where class.id='94600000-0000-4000-8000-000000000103';
  end if;
  select pg_catalog.count(*) into v_notifications
  from public.dashboard_notifications notification
  where notification.source_delivery_id=p_delivery_id;
  select pg_catalog.count(*) into v_attempts
  from dashboard_private.notification_audit_logs audit
  where audit.entity_kind='notification_external_attempt'
    and audit.action='external_attempt_registered';
  return pg_catalog.jsonb_build_object(
    'prepareBlocked',v_prepare_blocked,'writerBlocked',v_writer_blocked,
    'prepared',(v_prepare_result ->> 'prepared')::boolean,
    'status',v_prepare_result ->> 'status',
    'reason',v_prepare_result ->> 'status_reason',
    'writerOk',v_writer_result is not null,'sourceChanged',v_source_changed,
    'notificationCount',v_notifications,'externalAttemptCount',v_attempts
  );
exception when others then
  begin
    perform public.dblink_exec('observation_chat_race_blocker','rollback');
  exception when others then null;
  end;
  raise;
end;
$$;

create or replace function pg_temp.exercise_registration_observation_chat_commit_first_v1(
  p_kind text,
  p_event_id uuid,
  p_delivery_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_fixture jsonb;
  v_prepare_result jsonb;
  v_writer_result jsonb;
  v_source_changed boolean;
  v_notifications bigint;
  v_attempts bigint;
begin
  select result.payload::jsonb into strict v_fixture
  from public.dblink(
    'observation_chat_race_setup',
    pg_catalog.format(
      'select dashboard_private.registration_observation_chat_race_fixture_v1(%L,%L::uuid,%L::uuid)::text',
      p_kind,p_event_id,p_delivery_id
    )
  ) result(payload text);
  select result.payload::jsonb into strict v_writer_result
  from public.dblink(
    'observation_chat_race_writer',
    pg_temp.registration_observation_chat_race_writer_sql_v1(v_fixture,p_request_id)
  ) result(payload text);
  select result.payload::jsonb into strict v_prepare_result
  from public.dblink(
    'observation_chat_race_prepare',
    pg_temp.registration_observation_chat_race_prepare_sql_v1(v_fixture)
  ) result(payload text);
  if p_kind='director' then
    select track.director_profile_id=
      '94600000-0000-4000-8000-000000000002'::uuid
    into v_source_changed
    from public.ops_registration_subject_tracks track
    where track.id=(v_fixture ->> 'trackId')::uuid;
  elsif p_kind='normalized' then
    select session.schedule_state='makeup' into v_source_changed
    from public.class_lesson_sessions session
    where session.id='94600000-0000-4000-8000-000000000104';
  else
    select exists (
      select 1
      from pg_catalog.jsonb_array_elements(class.schedule_plan -> 'sessions')
        session(value)
      where session.value ->> 'sessionKey' = 'race-legacy-selected'
        and session.value ->> 'scheduleState' = 'makeup'
    )
    into v_source_changed
    from public.classes class
    where class.id='94600000-0000-4000-8000-000000000103';
  end if;
  select pg_catalog.count(*) into v_notifications
  from public.dashboard_notifications notification
  where notification.source_delivery_id=p_delivery_id;
  select pg_catalog.count(*) into v_attempts
  from dashboard_private.notification_audit_logs audit
  where audit.entity_kind='notification_external_attempt'
    and audit.action='external_attempt_registered';
  return pg_catalog.jsonb_build_object(
    'prepared',(v_prepare_result ->> 'prepared')::boolean,
    'status',v_prepare_result ->> 'status',
    'reason',v_prepare_result ->> 'status_reason',
    'writerOk',v_writer_result is not null,'sourceChanged',v_source_changed,
    'notificationCount',v_notifications,'externalAttemptCount',v_attempts
  );
end;
$$;

select is(
  pg_temp.exercise_registration_observation_chat_lock_first_v1(
    'director','94800000-0000-4000-8000-000000000101',
    '94800000-0000-4000-8000-000000000201',
    '94800000-0000-4000-8000-000000000301'
  ),
  '{"prepareBlocked":true,"writerBlocked":true,"prepared":true,"status":"sent","reason":null,"writerOk":true,"sourceChanged":true,"notificationCount":1,"externalAttemptCount":0}'::jsonb,
  'director lock-first final prepare commits A before the real A-to-B writer proceeds'
);
select is(
  pg_temp.exercise_registration_observation_chat_commit_first_v1(
    'director','94800000-0000-4000-8000-000000000102',
    '94800000-0000-4000-8000-000000000202',
    '94800000-0000-4000-8000-000000000302'
  ),
  '{"prepared":false,"status":"canceled","reason":"recipient_revoked","writerOk":true,"sourceChanged":true,"notificationCount":0,"externalAttemptCount":0}'::jsonb,
  'director commit-first final prepare observes B and closes the stale A target'
);
select is(
  pg_temp.exercise_registration_observation_chat_lock_first_v1(
    'normalized','94800000-0000-4000-8000-000000000103',
    '94800000-0000-4000-8000-000000000203',
    '94800000-0000-4000-8000-000000000303'
  ),
  '{"prepareBlocked":true,"writerBlocked":true,"prepared":true,"status":"sending","reason":null,"writerOk":true,"sourceChanged":true,"notificationCount":0,"externalAttemptCount":0}'::jsonb,
  'normalized lock-first final prepare completes before the selected-session save'
);
select is(
  pg_temp.exercise_registration_observation_chat_commit_first_v1(
    'normalized','94800000-0000-4000-8000-000000000104',
    '94800000-0000-4000-8000-000000000204',
    '94800000-0000-4000-8000-000000000304'
  ),
  '{"prepared":false,"status":"canceled","reason":"source_schedule_changed","writerOk":true,"sourceChanged":true,"notificationCount":0,"externalAttemptCount":0}'::jsonb,
  'normalized commit-first final prepare closes the changed selected session'
);
select is(
  pg_temp.exercise_registration_observation_chat_lock_first_v1(
    'legacy','94800000-0000-4000-8000-000000000105',
    '94800000-0000-4000-8000-000000000205',
    '94800000-0000-4000-8000-000000000305'
  ),
  '{"prepareBlocked":true,"writerBlocked":true,"prepared":true,"status":"sending","reason":null,"writerOk":true,"sourceChanged":true,"notificationCount":0,"externalAttemptCount":0}'::jsonb,
  'legacy lock-first final prepare completes before the selected schedule-plan save'
);
select is(
  pg_temp.exercise_registration_observation_chat_commit_first_v1(
    'legacy','94800000-0000-4000-8000-000000000106',
    '94800000-0000-4000-8000-000000000206',
    '94800000-0000-4000-8000-000000000306'
  ),
  '{"prepared":false,"status":"canceled","reason":"source_schedule_changed","writerOk":true,"sourceChanged":true,"notificationCount":0,"externalAttemptCount":0}'::jsonb,
  'legacy commit-first final prepare closes the changed selected schedule plan'
);

select dblink_exec('observation_chat_race_setup',$remote$
  set session_replication_role=replica;
  create temporary table registration_observation_chat_race_event_ids
  on commit drop as
  select event.id,event.occurrence_key
  from dashboard_private.notification_events event
  join public.ops_task_events source_event
    on source_event.id::text=event.source_id
  where event.source_type='ops_task_event'
    and event.event_key='registration.director_assigned'
    and source_event.task_id in (
      '94600000-0000-4000-8000-000000000105'::uuid,
      '94600000-0000-4000-8000-000000000205'::uuid
    )
    and source_event.field_name in (
      'registration_track:94600000-0000-4000-8000-000000000106',
      'registration_track:94600000-0000-4000-8000-000000000206'
    );
  create temporary table registration_observation_chat_race_delivery_ids
  on commit drop as
  select delivery.id
  from dashboard_private.notification_deliveries delivery
  where delivery.event_id in (
    select event_id.id
    from registration_observation_chat_race_event_ids event_id
  );
  delete from dashboard_private.notification_delivery_mention_snapshots snapshot
  where snapshot.delivery_id in (
    select delivery_id.id
    from registration_observation_chat_race_delivery_ids delivery_id
  );
  delete from public.dashboard_notifications notification
  where notification.source_delivery_id in (
    select delivery_id.id
    from registration_observation_chat_race_delivery_ids delivery_id
  );
  delete from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.occurrence_key in (
    select event_id.occurrence_key
    from registration_observation_chat_race_event_ids event_id
  );
  delete from dashboard_private.notification_deliveries delivery
  where delivery.id in (
    select delivery_id.id
    from registration_observation_chat_race_delivery_ids delivery_id
  );
  delete from dashboard_private.notification_event_fanout_jobs fanout
  where fanout.event_id in (
    select event_id.id
    from registration_observation_chat_race_event_ids event_id
  );
  delete from dashboard_private.notification_events event
  where event.id in (
    select event_id.id
    from registration_observation_chat_race_event_ids event_id
  );
  delete from dashboard_private.notification_delivery_mention_snapshots
  where delivery_id between
    '94800000-0000-4000-8000-000000000201'::uuid and
    '94800000-0000-4000-8000-000000000206'::uuid;
  delete from public.dashboard_notifications
  where source_delivery_id between
    '94800000-0000-4000-8000-000000000201'::uuid and
    '94800000-0000-4000-8000-000000000206'::uuid;
  delete from dashboard_private.notification_audit_logs audit
  where audit.entity_kind='notification_delivery'
    and audit.entity_id in (
      '94800000-0000-4000-8000-000000000201',
      '94800000-0000-4000-8000-000000000202',
      '94800000-0000-4000-8000-000000000203',
      '94800000-0000-4000-8000-000000000204',
      '94800000-0000-4000-8000-000000000205',
      '94800000-0000-4000-8000-000000000206'
    );
  delete from dashboard_private.notification_deliveries
  where id between
    '94800000-0000-4000-8000-000000000201'::uuid and
    '94800000-0000-4000-8000-000000000206'::uuid;
  delete from dashboard_private.notification_dispatch_ownership_claims
  where occurrence_key like 'registration-observation-race:%';
  delete from dashboard_private.notification_events
  where id between
    '94800000-0000-4000-8000-000000000101'::uuid and
    '94800000-0000-4000-8000-000000000106'::uuid;
  delete from dashboard_private.registration_observation_chat_jobs
  where observation_id in (
    '94600000-0000-4000-8000-000000000108',
    '94600000-0000-4000-8000-000000000208'
  );
  delete from dashboard_private.notification_assignment_change_facts
  where context_entity_id in (
    '94600000-0000-4000-8000-000000000106',
    '94600000-0000-4000-8000-000000000206'
  );
  delete from public.class_schedule_slots
  where id='94600000-0000-4000-8000-000000000113';
  update public.ops_registration_subject_tracks
  set director_profile_id='94600000-0000-4000-8000-000000000001',
      director_assignment_source='manual',
      director_assigned_at=pg_catalog.clock_timestamp()
  where id in (
    '94600000-0000-4000-8000-000000000106',
    '94600000-0000-4000-8000-000000000206'
  );
  set session_replication_role=origin;
  delete from dashboard_private.notification_templates
  where id in (
    '94600000-0000-4000-8000-000000000401',
    '94600000-0000-4000-8000-000000000402'
  );
  delete from dashboard_private.notification_rule_mention_settings
  where rule_id in (
    '94600000-0000-4000-8000-000000000301',
    '94600000-0000-4000-8000-000000000302'
  );
  delete from dashboard_private.notification_rules
  where id in (
    '94600000-0000-4000-8000-000000000301',
    '94600000-0000-4000-8000-000000000302'
  );
  update dashboard_private.notification_runtime_flags
  set enabled=false,revision=revision+1,updated_at=pg_catalog.clock_timestamp()
  where flag_key='notification_control_plane_dispatch_registration_enabled';
  drop function dashboard_private.registration_observation_chat_race_fixture_v1(
    text,uuid,uuid
  );
  revoke all on function dashboard_private.registration_observation_chat_race_assign_director_v1(
    uuid,uuid,integer,text
  ) from public,anon,authenticated,service_role;
  drop function dashboard_private.registration_observation_chat_race_assign_director_v1(
    uuid,uuid,integer,text
  );
$remote$);
select is(
  (
    select result.payload::jsonb
    from public.dblink(
      'observation_chat_race_setup',
      $diagnostic$
        select pg_catalog.jsonb_build_object(
          'events',(
            select coalesce(
              pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id',event.id,
                'eventKey',event.event_key,
                'sourceType',event.source_type,
                'sourceId',event.source_id,
                'occurrenceKey',event.occurrence_key
              ) order by event.id),
              '[]'::jsonb
            )
            from dashboard_private.notification_events event
          ),
          'audits',(
            select coalesce(
              pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id',audit.id,
                'entityKind',audit.entity_kind,
                'entityId',audit.entity_id,
                'action',audit.action,
                'requestId',audit.request_id,
                'reasonCode',audit.reason_code
              ) order by audit.created_at,audit.id),
              '[]'::jsonb
            )
            from dashboard_private.notification_audit_logs audit
            where audit.entity_kind='notification_delivery'
              and audit.entity_id in (
                '94800000-0000-4000-8000-000000000201',
                '94800000-0000-4000-8000-000000000202',
                '94800000-0000-4000-8000-000000000203',
                '94800000-0000-4000-8000-000000000204',
                '94800000-0000-4000-8000-000000000205',
                '94800000-0000-4000-8000-000000000206'
              )
          )
        )::text
      $diagnostic$
    ) result(payload text)
  ),
  '{"events":[],"audits":[]}'::jsonb,
  'committed final-prepare race cleanup leaves no notification event or audit'
);
select dblink_disconnect(connection_name)
from (values
  ('observation_chat_race_blocker'),
  ('observation_chat_race_prepare'),
  ('observation_chat_race_writer'),
  ('observation_chat_race_setup')
) connection(connection_name);

insert into public.google_chat_webhook_settings(
  channel,webhook_url,webhook_url_ciphertext,webhook_url_mask,
  connection_state,revision,last_verified_at,last_error_code
)
values (
  'english',
  'https://chat.googleapis.com/v1/spaces/ENGLISH01/messages?key=fixture-key&token=fixture-token',
  null,null,'legacy_active',1,pg_catalog.clock_timestamp(),null
)
on conflict (channel) do update set
  webhook_url=excluded.webhook_url,
  webhook_url_ciphertext=excluded.webhook_url_ciphertext,
  webhook_url_mask=excluded.webhook_url_mask,
  connection_state=excluded.connection_state,
  revision=excluded.revision,
  last_verified_at=excluded.last_verified_at,
  last_error_code=excluded.last_error_code;

-- Keep materialization on the default-OFF path above, then enable dispatch
-- only for the final begin-send boundary after the rollback-only delivery has
-- been claimed and refreshed.
update dashboard_private.notification_runtime_flags
set enabled=true,revision=revision+1,updated_at=pg_catalog.clock_timestamp()
where flag_key='notification_control_plane_dispatch_registration_enabled';

create or replace function pg_temp.prepare_with_wrong_subject_connection_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_payload_fingerprint text,
  p_render_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update dashboard_private.notification_dispatch_ownership_claims ownership
  set target_key='connection:google_chat.math',
      updated_at=pg_catalog.clock_timestamp()
  from dashboard_private.notification_deliveries delivery
  join dashboard_private.notification_events event
    on event.id=delivery.event_id
  where delivery.id=p_delivery_id
    and ownership.workflow_key=event.workflow_key
    and ownership.occurrence_key=event.occurrence_key
    and ownership.rule_id=delivery.rule_id
    and ownership.channel_key=delivery.channel_key
    and ownership.target_key=delivery.target_key
    and ownership.target_generation=delivery.target_generation;
  update dashboard_private.notification_deliveries delivery
  set target_key='connection:google_chat.math',
      connection_key='google_chat.math',
      target_snapshot='{"connection_key":"google_chat.math"}'::jsonb,
      updated_at=pg_catalog.clock_timestamp()
  where delivery.id=p_delivery_id;
  perform public.prepare_registration_observation_notification_delivery_v1(
    p_delivery_id,p_claim_token,p_event_id,p_rule_id,p_rule_revision,
    p_payload_fingerprint,p_render_fingerprint
  );
  raise exception 'registration_observation_subject_connection_guard_missing'
    using errcode='P0001';
end;
$$;
grant execute on function pg_temp.prepare_with_wrong_subject_connection_v1(
  uuid,uuid,uuid,uuid,bigint,text,text
) to service_role;

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$
  select pg_temp.prepare_with_wrong_subject_connection_v1(
    (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
    (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
    (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
    '81000000-0000-4000-8000-000000000001',2,
    (select observation_payload_fingerprint
     from dashboard_private.notification_deliveries delivery
     where delivery.id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim)),
    (select observation_render_fingerprint
     from dashboard_private.notification_deliveries delivery
     where delivery.id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim))
  )
$$,'40001','registration_observation_notification_target_lock_mismatch',
  'English observation delivery rejects a math-room connection at final prepare');
reset role;

create or replace function pg_temp.prepare_with_chat_target_mutation_v1(
  p_mutation text,
  p_delivery_id uuid,
  p_claim_token uuid,
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_payload_fingerprint text,
  p_render_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_mutation='audience' then
    update dashboard_private.notification_deliveries
    set audience_key='management_team',updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
  elsif p_mutation='target_key' then
    update dashboard_private.notification_dispatch_ownership_claims ownership
    set target_key='connection:google_chat.math',
        updated_at=pg_catalog.clock_timestamp()
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event
      on event.id=delivery.event_id
    where delivery.id=p_delivery_id
      and ownership.workflow_key=event.workflow_key
      and ownership.occurrence_key=event.occurrence_key
      and ownership.rule_id=delivery.rule_id
      and ownership.channel_key=delivery.channel_key
      and ownership.target_key=delivery.target_key
      and ownership.target_generation=delivery.target_generation;
    update dashboard_private.notification_deliveries
    set target_key='connection:google_chat.math',
        updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
  elsif p_mutation='target_profile' then
    update dashboard_private.notification_deliveries
    set target_profile_id='94000000-0000-4000-8000-000000000001',
        updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
  elsif p_mutation='connection_key' then
    update dashboard_private.notification_deliveries
    set connection_key=null,updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
  elsif p_mutation='snapshot_value' then
    update dashboard_private.notification_deliveries
    set target_snapshot='{"connection_key":"google_chat.math"}'::jsonb,
        updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
  elsif p_mutation='snapshot_extra' then
    update dashboard_private.notification_deliveries
    set target_snapshot=target_snapshot || '{"extra":true}'::jsonb,
        updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
  elsif p_mutation='raw_chat_id' then
    update dashboard_private.notification_deliveries
    set target_snapshot=target_snapshot
        || '{"chat_user_id":"users/123456789"}'::jsonb,
        updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
  else
    raise exception 'registration_observation_target_mutation_fixture_invalid'
      using errcode='22023';
  end if;
  perform public.prepare_registration_observation_notification_delivery_v1(
    p_delivery_id,p_claim_token,p_event_id,p_rule_id,p_rule_revision,
    p_payload_fingerprint,p_render_fingerprint
  );
  raise exception 'registration_observation_target_mutation_guard_missing'
    using errcode='P0001';
end;
$$;
grant execute on function pg_temp.prepare_with_chat_target_mutation_v1(
  text,uuid,uuid,uuid,uuid,bigint,text,text
) to service_role;

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select throws_ok(
  pg_catalog.format(
    $sql$select pg_temp.prepare_with_chat_target_mutation_v1(
      %L,
      %L::uuid,%L::uuid,%L::uuid,
      '81000000-0000-4000-8000-000000000001'::uuid,2,%L,%L
    )$sql$,
    mutation.kind,
    (select payload ->> 'delivery_id' from chat_delivery_claim),
    (select payload ->> 'claim_token' from chat_delivery_claim),
    (select payload ->> 'event_id' from chat_delivery_claim),
    (select observation_payload_fingerprint
     from dashboard_private.notification_deliveries delivery
     where delivery.id=(select (payload ->> 'delivery_id')::uuid
                        from chat_delivery_claim)),
    (select observation_render_fingerprint
     from dashboard_private.notification_deliveries delivery
     where delivery.id=(select (payload ->> 'delivery_id')::uuid
                        from chat_delivery_claim))
  ),
  '40001',
  'registration_observation_notification_target_lock_mismatch',
  'final prepare rejects one-at-a-time target mutation: ' || mutation.kind
)
from (
  values
    ('audience'),
    ('connection_key'),
    ('target_key'),
    ('target_profile'),
    ('snapshot_value'),
    ('snapshot_extra'),
    ('raw_chat_id')
) mutation(kind);
reset role;

create or replace function pg_temp.prepare_with_forged_chat_markup_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_payload_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body text := '<users/123456789> forged mention';
  v_href text;
  v_render_fingerprint text;
begin
  select delivery.rendered_title,delivery.href
  into v_title,v_href
  from dashboard_private.notification_deliveries delivery
  where delivery.id=p_delivery_id;
  v_render_fingerprint := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'title',v_title,'body',v_body,'href',v_href
      )
    )
  );
  update dashboard_private.notification_deliveries delivery
  set rendered_body=v_body,
      observation_render_fingerprint=v_render_fingerprint,
      updated_at=pg_catalog.clock_timestamp()
  where delivery.id=p_delivery_id;
  perform public.prepare_registration_observation_notification_delivery_v1(
    p_delivery_id,p_claim_token,p_event_id,p_rule_id,p_rule_revision,
    p_payload_fingerprint,v_render_fingerprint
  );
  raise exception 'registration_observation_forged_markup_guard_missing'
    using errcode='P0001';
end;
$$;
grant execute on function pg_temp.prepare_with_forged_chat_markup_v1(
  uuid,uuid,uuid,uuid,bigint,text
) to service_role;

set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$
  select pg_temp.prepare_with_forged_chat_markup_v1(
    (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
    (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
    (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
    '81000000-0000-4000-8000-000000000001',2,
    (select observation_payload_fingerprint
     from dashboard_private.notification_deliveries delivery
     where delivery.id=(select (payload ->> 'delivery_id')::uuid
                        from chat_delivery_claim))
  )
$$,'22023','registration_observation_delivery_render_unsafe',
  'forged Google Chat mention markup fails before begin-send');
reset role;

create or replace function pg_temp.exercise_registration_observation_expired_google_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_render_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_payload_fingerprint text;
  v_before_notifications bigint;
  v_before_attempts bigint;
  v_receipt jsonb;
  v_result jsonb;
begin
  begin
    select pg_catalog.count(*) into v_before_notifications
    from public.dashboard_notifications notification
    where notification.source_delivery_id=p_delivery_id;
    select pg_catalog.count(*) into v_before_attempts
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind='notification_external_attempt'
      and audit.action='external_attempt_registered';
    select pg_catalog.jsonb_set(
      event.payload,
      '{delivery_expires_at}',
      pg_catalog.to_jsonb(pg_catalog.clock_timestamp()-interval '1 second')
    ) into v_payload
    from dashboard_private.notification_events event
    where event.id=p_event_id;
    v_payload_fingerprint := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(v_payload)
    );
    update dashboard_private.notification_events
    set payload=v_payload
    where id=p_event_id;
    update dashboard_private.notification_deliveries
    set observation_payload_snapshot=v_payload,
        observation_payload_fingerprint=v_payload_fingerprint,
        updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    v_receipt := public.prepare_registration_observation_notification_delivery_v1(
      p_delivery_id,p_claim_token,p_event_id,p_rule_id,p_rule_revision,
      v_payload_fingerprint,p_render_fingerprint
    );
    select pg_catalog.jsonb_build_object(
      'receipt',v_receipt,
      'status',delivery.status,
      'reason',delivery.status_reason,
      'claimedBy',delivery.claimed_by,
      'claimToken',delivery.claim_token,
      'lease',delivery.lease_expires_at,
      'nextAttemptAt',delivery.next_attempt_at,
      'ownership',ownership.state,
      'notificationDelta',(
        select pg_catalog.count(*)-v_before_notifications
        from public.dashboard_notifications notification
        where notification.source_delivery_id=p_delivery_id
      ),
      'attemptDelta',(
        select pg_catalog.count(*)-v_before_attempts
        from dashboard_private.notification_audit_logs audit
        where audit.entity_kind='notification_external_attempt'
          and audit.action='external_attempt_registered'
      )
    ) into v_result
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event
      on event.id=delivery.event_id
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on ownership.workflow_key=event.workflow_key
     and ownership.occurrence_key=event.occurrence_key
     and ownership.rule_id=delivery.rule_id
     and ownership.channel_key=delivery.channel_key
     and ownership.target_key=delivery.target_key
     and ownership.target_generation=delivery.target_generation
    where delivery.id=p_delivery_id;
    raise exception 'registration_observation_expired_google_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_expired_google_v1(
    (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
    (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
    (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
    '81000000-0000-4000-8000-000000000001',2,
    (select observation_render_fingerprint
     from dashboard_private.notification_deliveries delivery
     where delivery.id=(select (payload ->> 'delivery_id')::uuid
                        from chat_delivery_claim))
  ),
  pg_catalog.jsonb_build_object(
    'receipt',pg_catalog.jsonb_build_object(
      'prepared',false,
      'delivery_id',(select (payload ->> 'delivery_id')::uuid
                     from chat_delivery_claim),
      'status','canceled',
      'status_reason','notification_window_closed'
    ),
    'status','canceled','reason','notification_window_closed',
    'claimedBy',null,'claimToken',null,'lease',null,'nextAttemptAt',null,
    'ownership','closed','notificationDelta',0,'attemptDelta',0
  ),
  'expired Google Chat final prepare closes ownership with zero send evidence'
);

create or replace function pg_temp.exercise_registration_observation_refresh_after_attempt_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_begin jsonb;
  v_attempt jsonb;
  v_error_state text;
  v_error_message text;
  v_attempt_count bigint;
  v_result jsonb;
begin
  begin
    select delivery.* into strict v_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.id=p_delivery_id;
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    v_begin := public.prepare_registration_observation_notification_delivery_v1(
      p_delivery_id,p_claim_token,p_event_id,p_rule_id,p_rule_revision,
      v_delivery.observation_payload_fingerprint,
      v_delivery.observation_render_fingerprint
    );
    v_attempt := public.register_notification_external_attempt_v1(
      p_delivery_id,null,null,p_claim_token,
      (v_begin ->> 'dispatch_token')::uuid,
      (v_begin ->> 'dispatch_token')::uuid
    );
    update dashboard_private.notification_deliveries
    set status='claimed',attempt_count=0,last_attempt_started_at=null,
        observation_payload_snapshot=null,
        observation_payload_fingerprint=null,
        observation_render_fingerprint=null,
        updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
    update dashboard_private.notification_dispatch_ownership_claims ownership
    set state='reserved',dispatch_started_at=null,dispatch_token=null,
        updated_at=pg_catalog.clock_timestamp()
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event
      on event.id=delivery.event_id
    where delivery.id=p_delivery_id
      and ownership.workflow_key=event.workflow_key
      and ownership.occurrence_key=event.occurrence_key
      and ownership.rule_id=delivery.rule_id
      and ownership.channel_key=delivery.channel_key
      and ownership.target_key=delivery.target_key
      and ownership.target_generation=delivery.target_generation;
    begin
      perform public.refresh_registration_observation_notification_delivery_v1(
        p_delivery_id,p_claim_token,p_event_id,p_rule_id,p_rule_revision,
        v_delivery.rendered_title,v_delivery.rendered_body,v_delivery.href,
        v_delivery.observation_payload_snapshot,
        v_delivery.observation_payload_fingerprint,
        v_delivery.observation_render_fingerprint
      );
      v_error_state := 'P0001';
      v_error_message := 'registration_observation_refresh_after_attempt_guard_missing';
    exception when others then
      get stacked diagnostics
        v_error_state=returned_sqlstate,
        v_error_message=message_text;
    end;
    select pg_catalog.count(*) into v_attempt_count
    from dashboard_private.notification_audit_logs audit
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on audit.entity_id like ownership.id::text || ':%'
    join dashboard_private.notification_deliveries delivery
      on delivery.id=p_delivery_id
    join dashboard_private.notification_events event
      on event.id=delivery.event_id
     and ownership.workflow_key=event.workflow_key
     and ownership.occurrence_key=event.occurrence_key
     and ownership.rule_id=delivery.rule_id
     and ownership.channel_key=delivery.channel_key
     and ownership.target_key=delivery.target_key
     and ownership.target_generation=delivery.target_generation
    where audit.entity_kind='notification_external_attempt'
      and audit.action='external_attempt_registered';
    v_result := pg_catalog.jsonb_build_object(
      'attemptAllowed',(v_attempt ->> 'allowed')::boolean,
      'registeredAttempts',v_attempt_count,
      'sqlstate',v_error_state,
      'message',v_error_message
    );
    raise exception 'registration_observation_attempt_refresh_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_refresh_after_attempt_v1(
    (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
    (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
    (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
    '81000000-0000-4000-8000-000000000001',2
  ),
  '{"attemptAllowed":true,"registeredAttempts":1,"sqlstate":"40001","message":"registration_observation_delivery_refresh_after_attempt"}'::jsonb,
  'an ownership-scoped external attempt permanently fences first refresh'
);

create or replace function pg_temp.exercise_registration_observation_retry_frozen_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_begin jsonb;
  v_attempt jsonb;
  v_retry_claim jsonb;
  v_frozen jsonb;
  v_retry_begin jsonb;
  v_retry_error_state text;
  v_retry_error_message text;
  v_result jsonb;
begin
  begin
    select delivery.* into strict v_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.id=p_delivery_id;
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    v_begin := public.prepare_registration_observation_notification_delivery_v1(
      p_delivery_id,p_claim_token,p_event_id,p_rule_id,p_rule_revision,
      v_delivery.observation_payload_fingerprint,
      v_delivery.observation_render_fingerprint
    );
    v_attempt := public.register_notification_external_attempt_v1(
      p_delivery_id,null,null,p_claim_token,
      (v_begin ->> 'dispatch_token')::uuid,
      (v_begin ->> 'dispatch_token')::uuid
    );
    perform public.finalize_notification_delivery_v1(
      p_delivery_id,p_claim_token,'retry_wait','provider_rate_limited',
      null,'429','provider_rate_limited','synthetic retry',
      pg_catalog.clock_timestamp()+interval '10 seconds'
    );
    update public.class_lesson_sessions lesson
    set revision=lesson.revision+1,
        updated_at=pg_catalog.clock_timestamp()
    where lesson.id='94000000-0000-4000-8000-000000000104';
    update dashboard_private.notification_deliveries
    set next_attempt_at=pg_catalog.clock_timestamp()-interval '1 second'
    where id=p_delivery_id;
    select claim into strict v_retry_claim
    from public.claim_notification_deliveries_v1('google-chat-retry-contract',100,60) claim
    where (claim ->> 'delivery_id')::uuid=p_delivery_id;
    v_frozen := public.read_registration_observation_notification_delivery_frozen_state_v1(
      p_delivery_id,(v_retry_claim ->> 'claim_token')::uuid
    );
    begin
      v_retry_begin := public.prepare_registration_observation_notification_delivery_v1(
        p_delivery_id,(v_retry_claim ->> 'claim_token')::uuid,
        p_event_id,p_rule_id,p_rule_revision,
        v_delivery.observation_payload_fingerprint,
        v_delivery.observation_render_fingerprint
      );
    exception when others then
      get stacked diagnostics
        v_retry_error_state=returned_sqlstate,
        v_retry_error_message=message_text;
    end;
    select pg_catalog.jsonb_build_object(
      'attemptAllowed',(v_attempt ->> 'allowed')::boolean,
      'frozenPayload',v_frozen ->> 'payloadFingerprint'
        = v_delivery.observation_payload_fingerprint,
      'frozenRender',v_frozen ->> 'renderFingerprint'
        = v_delivery.observation_render_fingerprint,
      'retryAttempt',(v_frozen ->> 'attemptCount')::integer,
      'retryStarted',v_frozen -> 'lastAttemptStartedAt' <> 'null'::jsonb,
      'sourceRevisionDrift',
        v_frozen #>> '{snapshot,source_revision,revision}' is distinct from
          dashboard_private.get_registration_observation_notification_source_impl_v1(
            '94000000-0000-4000-8000-000000000208'
          ) #>> '{sourceRevision,revision}',
      'status',delivery.status,
      'finalAttempt',delivery.attempt_count,
      'prepared',(v_retry_begin ->> 'prepared')::boolean,
      'retryErrorState',v_retry_error_state,
      'retryError',v_retry_error_message
    ) into v_result
    from dashboard_private.notification_deliveries delivery
    where delivery.id=p_delivery_id;
    raise exception 'registration_observation_retry_frozen_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_retry_frozen_v1(
    (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
    (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
    (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
    '81000000-0000-4000-8000-000000000001',2
  ),
  '{"attemptAllowed":true,"frozenPayload":true,"frozenRender":true,"retryAttempt":1,"retryStarted":true,"sourceRevisionDrift":true,"status":"sending","finalAttempt":2,"prepared":true,"retryErrorState":null,"retryError":null}'::jsonb,
  'retry final prepare preserves frozen payload and render fingerprints after exact-session revision drift'
);

select throws_ok($missing_ownership$
  do $fixture$
  declare
    v_delivery dashboard_private.notification_deliveries%rowtype;
    v_ownership_id uuid;
  begin
    select delivery.* into strict v_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.id=(select (payload ->> 'delivery_id')::uuid
                       from chat_delivery_claim);
    select ownership.id into strict v_ownership_id
    from dashboard_private.notification_dispatch_ownership_claims ownership
    join dashboard_private.notification_events event
      on event.workflow_key=ownership.workflow_key
     and event.occurrence_key=ownership.occurrence_key
    where event.id=v_delivery.event_id
      and ownership.rule_id=v_delivery.rule_id
      and ownership.channel_key=v_delivery.channel_key
      and ownership.target_key=v_delivery.target_key
      and ownership.target_generation=v_delivery.target_generation;
    delete from dashboard_private.notification_dispatch_ownership_claims
    where id=v_ownership_id;
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    perform public.prepare_registration_observation_notification_delivery_v1(
      v_delivery.id,v_delivery.claim_token,v_delivery.event_id,
      v_delivery.rule_id,v_delivery.rule_revision,
      v_delivery.observation_payload_fingerprint,
      v_delivery.observation_render_fingerprint
    );
  end
  $fixture$
$missing_ownership$,'40001','registration_observation_delivery_prepare_stale',
  'final prepare rejects a missing canonical ownership row before target dispatch');

select throws_ok($invalid_retry$
  do $fixture$
  declare
    v_delivery dashboard_private.notification_deliveries%rowtype;
    v_ownership_id uuid;
  begin
    select delivery.* into strict v_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.id=(select (payload ->> 'delivery_id')::uuid
                       from chat_delivery_claim);
    select ownership.id into strict v_ownership_id
    from dashboard_private.notification_dispatch_ownership_claims ownership
    join dashboard_private.notification_events event
      on event.workflow_key=ownership.workflow_key
     and event.occurrence_key=ownership.occurrence_key
    where event.id=v_delivery.event_id
      and ownership.rule_id=v_delivery.rule_id
      and ownership.channel_key=v_delivery.channel_key
      and ownership.target_key=v_delivery.target_key
      and ownership.target_generation=v_delivery.target_generation;
    update dashboard_private.notification_deliveries
    set attempt_count=1,last_attempt_started_at=pg_catalog.clock_timestamp()
    where id=v_delivery.id;
    delete from dashboard_private.notification_audit_logs audit
    where audit.entity_kind='notification_external_attempt'
      and audit.action='external_attempt_registered'
      and audit.entity_id like v_ownership_id::text || ':%';
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    perform public.prepare_registration_observation_notification_delivery_v1(
      v_delivery.id,v_delivery.claim_token,v_delivery.event_id,
      v_delivery.rule_id,v_delivery.rule_revision,
      v_delivery.observation_payload_fingerprint,
      v_delivery.observation_render_fingerprint
    );
  end
  $fixture$
$invalid_retry$,'55000','registration_observation_delivery_frozen_state_invalid',
  'final prepare rejects retry-shaped state without an ownership-scoped attempt');

create temp table chat_prepare_result(payload jsonb not null) on commit drop;
grant select,insert on table chat_prepare_result to service_role;
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
insert into chat_prepare_result
select public.prepare_registration_observation_notification_delivery_v1(
  (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
  (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
  (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
  '81000000-0000-4000-8000-000000000001',2,
  (select observation_payload_fingerprint
   from dashboard_private.notification_deliveries delivery
   where delivery.id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim)),
  (select observation_render_fingerprint
   from dashboard_private.notification_deliveries delivery
   where delivery.id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim))
);
reset role;
select is(
  (select pg_catalog.jsonb_build_object(
    'prepared',(payload ->> 'prepared')::boolean,
    'status',payload ->> 'status',
    'channel',payload ->> 'channel_key',
    'connection',payload ->> 'connection_key',
    'mentions',payload -> 'mention_user_names',
    'hasDispatchToken',payload ? 'dispatch_token'
  ) from chat_prepare_result),
  '{"prepared":true,"status":"sending","channel":"google_chat","connection":"google_chat.english","mentions":[],"hasDispatchToken":true}'::jsonb,
  'real final-prepare reaches sending with empty safe mentions and no provider call'
);

create or replace function pg_temp.exercise_registration_observation_session_commits_first_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_event_id uuid,
  p_payload_fingerprint text,
  p_render_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.class_lesson_sessions%rowtype;
  v_ownership_id uuid;
  v_receipt jsonb;
  v_sqlstate text := '00000';
  v_message text;
  v_before_notifications bigint;
  v_before_attempts bigint;
  v_result jsonb;
begin
  begin
    select session.* into strict v_session
    from public.class_lesson_sessions session
    where session.id='94000000-0000-4000-8000-000000000104';
    select ownership.id into strict v_ownership_id
    from dashboard_private.notification_dispatch_ownership_claims ownership
    join dashboard_private.notification_deliveries delivery
      on delivery.id=p_delivery_id
    join dashboard_private.notification_events event
      on event.id=delivery.event_id
    where ownership.workflow_key=event.workflow_key
      and ownership.occurrence_key=event.occurrence_key
      and ownership.rule_id=delivery.rule_id
      and ownership.channel_key=delivery.channel_key
      and ownership.target_key=delivery.target_key
      and ownership.target_generation=delivery.target_generation;
    select pg_catalog.count(*) into v_before_notifications
    from public.dashboard_notifications notification
    where notification.source_delivery_id=p_delivery_id;
    select pg_catalog.count(*) into v_before_attempts
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind='notification_external_attempt'
      and audit.action='external_attempt_registered'
      and audit.entity_id like v_ownership_id::text || ':%';
    update dashboard_private.notification_deliveries
    set status='claimed',status_reason=null,claimed_by='session-race-prepare',
        claim_token=p_claim_token,
        lease_expires_at=pg_catalog.clock_timestamp()+interval '60 seconds',
        next_attempt_at=null,resolved_at=null,
        updated_at=pg_catalog.clock_timestamp()
    where id=p_delivery_id;
    update dashboard_private.notification_dispatch_ownership_claims
    set state='reserved',dispatch_started_at=null,dispatch_token=null,
        updated_at=pg_catalog.clock_timestamp()
    where id=v_ownership_id;

    perform pg_catalog.set_config(
      'request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true
    );
    perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
    perform public.save_class_lesson_session_v1(
      v_session.id,v_session.revision,'makeup',v_session.session_date,
      v_session.start_time,v_session.end_time,v_session.teacher_catalog_id,
      v_session.classroom_catalog_id,v_session.memo,v_session.public_note,
      v_session.teacher_note,'94000000-0000-4000-8000-000000000290',null
    );
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    begin
      v_receipt := public.prepare_registration_observation_notification_delivery_v1(
        p_delivery_id,p_claim_token,p_event_id,
        '81000000-0000-4000-8000-000000000001',2,
        p_payload_fingerprint,p_render_fingerprint
      );
    exception when others then
      get stacked diagnostics v_sqlstate=returned_sqlstate,
        v_message=message_text;
    end;
    select pg_catalog.jsonb_build_object(
      'sqlstate',v_sqlstate,
      'message',v_message,
      'prepared',case when v_receipt is null then null
        else (v_receipt ->> 'prepared')::boolean end,
      'receiptStatus',v_receipt ->> 'status',
      'receiptReason',v_receipt ->> 'status_reason',
      'deliveryStatus',delivery.status,
      'deliveryReason',delivery.status_reason,
      'claimToken',delivery.claim_token,
      'lease',delivery.lease_expires_at,
      'ownership',ownership.state,
      'notificationDelta',(
        select pg_catalog.count(*)-v_before_notifications
        from public.dashboard_notifications notification
        where notification.source_delivery_id=p_delivery_id
      ),
      'attemptDelta',(
        select pg_catalog.count(*)-v_before_attempts
        from dashboard_private.notification_audit_logs audit
        where audit.entity_kind='notification_external_attempt'
          and audit.action='external_attempt_registered'
          and audit.entity_id like v_ownership_id::text || ':%'
      )
    ) into v_result
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on ownership.id=v_ownership_id
    where delivery.id=p_delivery_id;
    raise exception 'registration_observation_session_race_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_session_commits_first_v1(
    (select (payload ->> 'delivery_id')::uuid from chat_delivery_claim),
    (select (payload ->> 'claim_token')::uuid from chat_delivery_claim),
    (select (payload ->> 'event_id')::uuid from chat_delivery_claim),
    (select observation_payload_fingerprint
     from dashboard_private.notification_deliveries delivery
     where delivery.id=(select (payload ->> 'delivery_id')::uuid
                        from chat_delivery_claim)),
    (select observation_render_fingerprint
     from dashboard_private.notification_deliveries delivery
     where delivery.id=(select (payload ->> 'delivery_id')::uuid
                        from chat_delivery_claim))
  ),
  '{"sqlstate":"00000","message":null,"prepared":false,"receiptStatus":"canceled","receiptReason":"source_schedule_changed","deliveryStatus":"canceled","deliveryReason":"source_schedule_changed","claimToken":null,"lease":null,"ownership":"closed","notificationDelta":0,"attemptDelta":0}'::jsonb,
  'a committed normalized selected-session booking change closes final prepare without mixed source or send evidence'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '94000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','chat-contract-director-b@example.invalid',
  crypt('chat-contract-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  now(),now()
);
insert into public.profiles(id,role,name,email,created_at,updated_at)
values (
  '94000000-0000-4000-8000-000000000002','admin','청강 계약 원장 B',
  'chat-contract-director-b@example.invalid',now(),now()
)
on conflict (id) do update set
  role=excluded.role,name=excluded.name,email=excluded.email,
  updated_at=excluded.updated_at;
delete from public.teacher_catalogs
where profile_id = '94000000-0000-4000-8000-000000000002';
insert into public.teacher_catalogs(
  id,name,subjects,is_visible,sort_order,profile_id,account_email,dashboard_role
)
values (
  '94000000-0000-4000-8000-000000000202','청강 계약 원장 B',
  array['영어']::text[],true,9943,
  '94000000-0000-4000-8000-000000000002',
  'chat-contract-director-b@example.invalid','teacher'
);
update public.profiles
set teacher_catalog_id='94000000-0000-4000-8000-000000000202'
where id='94000000-0000-4000-8000-000000000002';

create or replace function pg_temp.exercise_registration_observation_in_app_v1(
  p_expired boolean,
  p_reassign boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_source jsonb;
  v_domain_event dashboard_private.registration_observation_domain_events%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_render_hash text;
  v_event_receipt jsonb;
  v_event_id uuid;
  v_delivery_id uuid := '94000000-0000-4000-8000-000000000240';
  v_claim jsonb;
  v_prepare jsonb;
  v_before_attempts bigint;
  v_common_revision integer;
  v_result jsonb;
begin
  begin
    select job.* into strict v_job
    from dashboard_private.registration_observation_chat_jobs job
    where job.observation_id='94000000-0000-4000-8000-000000000108'
      and job.event_key='registration.observation_feedback_submitted';
    select event_row.* into strict v_domain_event
    from dashboard_private.registration_observation_domain_events event_row
    where event_row.event_id=v_job.domain_event_id;
    update public.ops_registration_appointments appointment
    set status='completed',updated_at=pg_catalog.clock_timestamp()
    where appointment.id=v_job.appointment_id;
    v_source := dashboard_private.get_registration_observation_notification_source_impl_v1(
      v_job.observation_id
    );
    v_payload := pg_catalog.jsonb_build_object(
      'task_id',v_source ->> 'taskId',
      'track_id',v_source ->> 'trackId',
      'observation_id',v_job.observation_id,
      'appointment_id',v_job.appointment_id,
      'appointment_notification_revision',v_job.notification_revision,
      'student_name',v_source ->> 'studentName',
      'subject',v_source ->> 'subject',
      'source_revision',v_job.source_revision,
      'booking_fact_hash',v_job.booking_fact_hash,
      'occurred_at',v_domain_event.occurred_at,
      'delivery_expires_at',case when p_expired
        then v_domain_event.occurred_at + interval '1 microsecond'
        else v_job.expires_at
      end,
      'mention_role',v_job.mention_role,
      'mention_profile_ids',v_job.mention_profile_ids,
      'event_kind',v_job.event_key,
      'booking',pg_catalog.jsonb_build_object(
        'class_id',v_job.current_booking_snapshot ->> 'classId',
        'class_name',v_job.current_booking_snapshot ->> 'className',
        'session_authority',v_job.current_booking_snapshot ->> 'sessionAuthority',
        'class_lesson_session_id',v_job.current_booking_snapshot ->> 'classLessonSessionId',
        'legacy_session_key',v_job.current_booking_snapshot ->> 'legacySessionKey',
        'schedule_state',v_job.current_booking_snapshot ->> 'scheduleState',
        'starts_at',v_job.current_booking_snapshot ->> 'startsAt',
        'ends_at',v_job.current_booking_snapshot ->> 'endsAt',
        'teacher_name',v_job.current_booking_snapshot ->> 'teacherName',
        'classroom_name',v_job.current_booking_snapshot ->> 'classroomName',
        'campus',v_job.current_booking_snapshot ->> 'campus'
      ),
      'submitted_by_name',v_job.submission_snapshot ->> 'submittedByName',
      'submitted_at',v_job.submission_snapshot -> 'submittedAt'
    );
    v_payload_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(v_payload)
    );
    v_render_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(
        pg_catalog.jsonb_build_object(
          'title','청강 피드백 완료',
          'body','합성 청강학생의 영어 청강 피드백이 제출되었습니다.',
          'href','/admin/registration?taskId=94000000-0000-4000-8000-000000000105'
        )
      )
    );
    update dashboard_private.notification_rules
    set enabled=true,revision=2,updated_at=pg_catalog.clock_timestamp()
    where id='81000000-0000-4000-8000-000000000007';
    update dashboard_private.notification_runtime_flags
    set enabled=true,revision=revision+1,updated_at=pg_catalog.clock_timestamp()
    where flag_key='notification_control_plane_dispatch_registration_enabled';
    v_event_receipt := dashboard_private.record_notification_event_v1(
      'global','registration','registration.observation_feedback_submitted',
      'registration_observation',v_job.observation_id::text,
      v_job.notification_revision::bigint,
      'registration:observation:' || v_job.observation_id::text
        || ':feedback-submitted:in-app-contract',
      null,v_domain_event.occurred_at,3,v_payload,null,null
    );
    v_event_id := (v_event_receipt ->> 'event_id')::uuid;
    insert into dashboard_private.notification_deliveries(
      id,event_id,rule_id,rule_revision,template_id,channel_key,audience_key,
      target_generation,target_set_hash,target_kind,target_key,
      target_profile_id,connection_key,target_snapshot,parent_delivery_id,
      status,status_reason,dedupe_key,rendered_title,rendered_body,href,
      scheduled_for,attempt_count,max_attempts,next_attempt_at
    )
    select
      v_delivery_id,v_event_id,rule.id,rule.revision,rule.active_template_id,
      'in_app','track_director',1,pg_catalog.repeat('a',64),
      'profile','profile:94000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',null,
      '{"profile_id":"94000000-0000-4000-8000-000000000001"}'::jsonb,
      null,'pending',null,'registration-observation-in-app-contract',
      '청강 피드백 완료','합성 청강학생의 영어 청강 피드백이 제출되었습니다.',
      '/admin/registration?taskId=94000000-0000-4000-8000-000000000105',
      pg_catalog.clock_timestamp(),0,5,null
    from dashboard_private.notification_rules rule
    where rule.id='81000000-0000-4000-8000-000000000007';
    perform dashboard_private.reserve_canonical_dispatch_ownership_v1(
      v_delivery_id
    );
    select pg_catalog.count(*) into v_before_attempts
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind='notification_external_attempt'
      and audit.action='external_attempt_registered';
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    select claim into strict v_claim
    from public.claim_notification_deliveries_v1(
      'google-chat-in-app-contract',100,60
    ) claim
    where (claim ->> 'delivery_id')::uuid=v_delivery_id;
    perform public.refresh_registration_observation_notification_delivery_v1(
      v_delivery_id,(v_claim ->> 'claim_token')::uuid,v_event_id,
      '81000000-0000-4000-8000-000000000007',2,
      '청강 피드백 완료','합성 청강학생의 영어 청강 피드백이 제출되었습니다.',
      '/admin/registration?taskId=94000000-0000-4000-8000-000000000105',
      v_payload,v_payload_hash,v_render_hash
    );
    if p_reassign then
      select detail.common_revision into strict v_common_revision
      from public.ops_registration_details detail
      where detail.task_id=(v_source ->> 'taskId')::uuid;
      perform pg_catalog.set_config(
        'request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true
      );
      perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
      perform public.assign_registration_track_director(
        (v_source ->> 'trackId')::uuid,
        '94000000-0000-4000-8000-000000000002','manual',null,
        v_common_revision,'google-chat-director-race-b-first'
      );
      perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    end if;
    v_prepare := public.prepare_registration_observation_notification_delivery_v1(
      v_delivery_id,(v_claim ->> 'claim_token')::uuid,v_event_id,
      '81000000-0000-4000-8000-000000000007',2,
      v_payload_hash,v_render_hash
    );
    select pg_catalog.jsonb_build_object(
      'prepared',(v_prepare ->> 'prepared')::boolean,
      'channel',v_prepare ->> 'channel_key',
      'status',v_prepare ->> 'status',
      'reason',v_prepare ->> 'status_reason',
      'director',(
        select track.director_profile_id
        from public.ops_registration_subject_tracks track
        where track.id=(v_source ->> 'trackId')::uuid
      ),
      'pushChildren',(v_prepare ->> 'push_children_created')::integer,
      'notificationCount',(
        select pg_catalog.count(*)
        from public.dashboard_notifications notification
        where notification.source_delivery_id=v_delivery_id
      ),
      'deliveryStatus',delivery.status,
      'ownership',ownership.state,
      'externalAttemptDelta',(
        select pg_catalog.count(*)-v_before_attempts
        from dashboard_private.notification_audit_logs audit
        where audit.entity_kind='notification_external_attempt'
          and audit.action='external_attempt_registered'
      )
    ) into v_result
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event
      on event.id=delivery.event_id
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on ownership.workflow_key=event.workflow_key
     and ownership.occurrence_key=event.occurrence_key
     and ownership.rule_id=delivery.rule_id
     and ownership.channel_key=delivery.channel_key
     and ownership.target_key=delivery.target_key
     and ownership.target_generation=delivery.target_generation
    where delivery.id=v_delivery_id;
    raise exception 'registration_observation_in_app_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_in_app_v1(false),
  '{"prepared":true,"channel":"in_app","status":"sent","reason":null,"director":"94000000-0000-4000-8000-000000000001","pushChildren":0,"notificationCount":1,"deliveryStatus":"sent","ownership":"closed","externalAttemptDelta":0}'::jsonb,
  'real in-app final prepare commits one dashboard notification and no provider attempt'
);
select is(
  pg_temp.exercise_registration_observation_in_app_v1(true),
  '{"prepared":false,"channel":null,"status":"canceled","reason":"notification_window_closed","director":"94000000-0000-4000-8000-000000000001","pushChildren":null,"notificationCount":0,"deliveryStatus":"canceled","ownership":"closed","externalAttemptDelta":0}'::jsonb,
  'expired in-app final prepare closes without a dashboard notification or provider attempt'
);
select is(
  pg_temp.exercise_registration_observation_in_app_v1(false,true),
  '{"prepared":false,"channel":null,"status":"canceled","reason":"recipient_revoked","director":"94000000-0000-4000-8000-000000000002","pushChildren":null,"notificationCount":0,"deliveryStatus":"canceled","ownership":"closed","externalAttemptDelta":0}'::jsonb,
  'an actual committed-before-prepare director reassignment closes the stale A inbox without retargeting B'
);

create or replace function pg_temp.exercise_registration_observation_channel_pair_v1(
  p_director_state text,
  p_management_first boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_source jsonb;
  v_domain_event dashboard_private.registration_observation_domain_events%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_render_hash text;
  v_event_receipt jsonb;
  v_event_id uuid;
  v_in_app_delivery_id uuid := '94000000-0000-4000-8000-000000000240';
  v_google_delivery_id uuid := '94000000-0000-4000-8000-000000000241';
  v_claim jsonb;
  v_in_app_claim jsonb;
  v_google_claim jsonb;
  v_in_app_prepare jsonb;
  v_google_prepare jsonb;
  v_before_attempts bigint;
  v_result jsonb;
begin
  if p_director_state not in ('active','null','banned') then
    raise exception 'registration_observation_channel_pair_fixture_invalid'
      using errcode='22023';
  end if;
  begin
    select job.* into strict v_job
    from dashboard_private.registration_observation_chat_jobs job
    where job.observation_id='94000000-0000-4000-8000-000000000108'
      and job.event_key='registration.observation_feedback_submitted';
    select event_row.* into strict v_domain_event
    from dashboard_private.registration_observation_domain_events event_row
    where event_row.event_id=v_job.domain_event_id;
    update public.ops_registration_appointments appointment
    set status='completed',updated_at=pg_catalog.clock_timestamp()
    where appointment.id=v_job.appointment_id;
    v_source := dashboard_private.get_registration_observation_notification_source_impl_v1(
      v_job.observation_id
    );
    v_payload := pg_catalog.jsonb_build_object(
      'task_id',v_source ->> 'taskId',
      'track_id',v_source ->> 'trackId',
      'observation_id',v_job.observation_id,
      'appointment_id',v_job.appointment_id,
      'appointment_notification_revision',v_job.notification_revision,
      'student_name',v_source ->> 'studentName',
      'subject',v_source ->> 'subject',
      'source_revision',v_job.source_revision,
      'booking_fact_hash',v_job.booking_fact_hash,
      'occurred_at',v_domain_event.occurred_at,
      'delivery_expires_at',v_job.expires_at,
      'mention_role',v_job.mention_role,
      'mention_profile_ids',v_job.mention_profile_ids,
      'event_kind',v_job.event_key,
      'booking',pg_catalog.jsonb_build_object(
        'class_id',v_job.current_booking_snapshot ->> 'classId',
        'class_name',v_job.current_booking_snapshot ->> 'className',
        'session_authority',v_job.current_booking_snapshot ->> 'sessionAuthority',
        'class_lesson_session_id',v_job.current_booking_snapshot ->> 'classLessonSessionId',
        'legacy_session_key',v_job.current_booking_snapshot ->> 'legacySessionKey',
        'schedule_state',v_job.current_booking_snapshot ->> 'scheduleState',
        'starts_at',v_job.current_booking_snapshot ->> 'startsAt',
        'ends_at',v_job.current_booking_snapshot ->> 'endsAt',
        'teacher_name',v_job.current_booking_snapshot ->> 'teacherName',
        'classroom_name',v_job.current_booking_snapshot ->> 'classroomName',
        'campus',v_job.current_booking_snapshot ->> 'campus'
      ),
      'submitted_by_name',v_job.submission_snapshot ->> 'submittedByName',
      'submitted_at',v_job.submission_snapshot -> 'submittedAt'
    );
    v_payload_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(v_payload)
    );
    v_render_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(
        pg_catalog.jsonb_build_object(
          'title','청강 피드백 완료',
          'body','합성 청강학생의 영어 청강 피드백이 제출되었습니다.',
          'href','/admin/registration?taskId=94000000-0000-4000-8000-000000000105'
        )
      )
    );
    update dashboard_private.notification_rules
    set enabled=true,revision=2,updated_at=pg_catalog.clock_timestamp()
    where id in (
      '81000000-0000-4000-8000-000000000006',
      '81000000-0000-4000-8000-000000000007'
    );
    update dashboard_private.notification_runtime_flags
    set enabled=true,revision=revision+1,updated_at=pg_catalog.clock_timestamp()
    where flag_key='notification_control_plane_dispatch_registration_enabled';
    insert into public.google_chat_webhook_settings(
      channel,webhook_url,webhook_url_ciphertext,webhook_url_mask,
      connection_state,revision,last_verified_at,last_error_code
    ) values (
      'admin',
      'https://chat.googleapis.com/v1/spaces/MANAGEMENT01/messages?key=fixture-key&token=fixture-token',
      null,null,'legacy_active',1,pg_catalog.clock_timestamp(),null
    )
    on conflict (channel) do update set
      webhook_url=excluded.webhook_url,
      webhook_url_ciphertext=excluded.webhook_url_ciphertext,
      webhook_url_mask=excluded.webhook_url_mask,
      connection_state=excluded.connection_state,
      revision=excluded.revision,
      last_verified_at=excluded.last_verified_at,
      last_error_code=excluded.last_error_code;
    v_event_receipt := dashboard_private.record_notification_event_v1(
      'global','registration','registration.observation_feedback_submitted',
      'registration_observation',v_job.observation_id::text,
      v_job.notification_revision::bigint,
      'registration:observation:' || v_job.observation_id::text
        || ':feedback-submitted:paired-' || p_director_state
        || case when p_management_first then '-management-first' else '-in-app-first' end,
      null,v_domain_event.occurred_at,3,v_payload,null,null
    );
    v_event_id := (v_event_receipt ->> 'event_id')::uuid;

    insert into dashboard_private.notification_deliveries(
      id,event_id,rule_id,rule_revision,template_id,channel_key,audience_key,
      target_generation,target_set_hash,target_kind,target_key,
      target_profile_id,connection_key,target_snapshot,parent_delivery_id,
      status,status_reason,dedupe_key,rendered_title,rendered_body,href,
      scheduled_for,attempt_count,max_attempts,next_attempt_at
    )
    select
      v_in_app_delivery_id,v_event_id,rule.id,rule.revision,rule.active_template_id,
      'in_app','track_director',1,pg_catalog.repeat('a',64),
      'profile','profile:94000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',null,
      '{"profile_id":"94000000-0000-4000-8000-000000000001"}'::jsonb,
      null,'pending',null,'registration-observation-paired-in-app',
      '청강 피드백 완료','합성 청강학생의 영어 청강 피드백이 제출되었습니다.',
      '/admin/registration?taskId=94000000-0000-4000-8000-000000000105',
      pg_catalog.clock_timestamp(),0,5,null
    from dashboard_private.notification_rules rule
    where rule.id='81000000-0000-4000-8000-000000000007';
    insert into dashboard_private.notification_deliveries(
      id,event_id,rule_id,rule_revision,template_id,channel_key,audience_key,
      target_generation,target_set_hash,target_kind,target_key,
      target_profile_id,connection_key,target_snapshot,parent_delivery_id,
      status,status_reason,dedupe_key,rendered_title,rendered_body,href,
      scheduled_for,attempt_count,max_attempts,next_attempt_at
    )
    select
      v_google_delivery_id,v_event_id,rule.id,rule.revision,rule.active_template_id,
      'google_chat','management_team',1,pg_catalog.repeat('b',64),
      'connection','connection:google_chat.management',null,
      'google_chat.management','{"connection_key":"google_chat.management"}'::jsonb,
      null,'pending',null,'registration-observation-paired-google-chat',
      '청강 피드백 완료','합성 청강학생의 영어 청강 피드백이 제출되었습니다.',
      '/admin/registration?taskId=94000000-0000-4000-8000-000000000105',
      pg_catalog.clock_timestamp(),0,5,null
    from dashboard_private.notification_rules rule
    where rule.id='81000000-0000-4000-8000-000000000006';
    perform dashboard_private.reserve_canonical_dispatch_ownership_v1(
      v_in_app_delivery_id
    );
    perform dashboard_private.reserve_canonical_dispatch_ownership_v1(
      v_google_delivery_id
    );
    select pg_catalog.count(*) into v_before_attempts
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind='notification_external_attempt'
      and audit.action='external_attempt_registered';
    perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
    for v_claim in
      select claim from public.claim_notification_deliveries_v1(
        'google-chat-channel-pair-contract',100,60
      ) claim
    loop
      if (v_claim ->> 'delivery_id')::uuid=v_in_app_delivery_id then
        v_in_app_claim := v_claim;
      elsif (v_claim ->> 'delivery_id')::uuid=v_google_delivery_id then
        v_google_claim := v_claim;
      end if;
    end loop;
    if v_in_app_claim is null or v_google_claim is null then
      raise exception 'registration_observation_channel_pair_claim_missing'
        using errcode='P0002';
    end if;
    perform public.refresh_registration_observation_notification_delivery_v1(
      v_in_app_delivery_id,(v_in_app_claim ->> 'claim_token')::uuid,v_event_id,
      '81000000-0000-4000-8000-000000000007',2,
      '청강 피드백 완료','합성 청강학생의 영어 청강 피드백이 제출되었습니다.',
      '/admin/registration?taskId=94000000-0000-4000-8000-000000000105',
      v_payload,v_payload_hash,v_render_hash
    );
    perform public.refresh_registration_observation_notification_delivery_v1(
      v_google_delivery_id,(v_google_claim ->> 'claim_token')::uuid,v_event_id,
      '81000000-0000-4000-8000-000000000006',2,
      '청강 피드백 완료','합성 청강학생의 영어 청강 피드백이 제출되었습니다.',
      '/admin/registration?taskId=94000000-0000-4000-8000-000000000105',
      v_payload,v_payload_hash,v_render_hash
    );

    if p_director_state='null' then
      update public.ops_registration_subject_tracks track
      set director_profile_id=null,
          director_assignment_source=null,
          director_assigned_at=null,
          updated_at=pg_catalog.clock_timestamp()
      where track.id=(v_source ->> 'trackId')::uuid;
    elsif p_director_state='banned' then
      update auth.users account
      set banned_until=pg_catalog.clock_timestamp()+interval '1 day',
          updated_at=pg_catalog.clock_timestamp()
      where account.id='94000000-0000-4000-8000-000000000001';
    end if;

    if p_management_first then
      v_google_prepare := public.prepare_registration_observation_notification_delivery_v1(
        v_google_delivery_id,(v_google_claim ->> 'claim_token')::uuid,v_event_id,
        '81000000-0000-4000-8000-000000000006',2,v_payload_hash,v_render_hash
      );
      v_in_app_prepare := public.prepare_registration_observation_notification_delivery_v1(
        v_in_app_delivery_id,(v_in_app_claim ->> 'claim_token')::uuid,v_event_id,
        '81000000-0000-4000-8000-000000000007',2,v_payload_hash,v_render_hash
      );
    else
      v_in_app_prepare := public.prepare_registration_observation_notification_delivery_v1(
        v_in_app_delivery_id,(v_in_app_claim ->> 'claim_token')::uuid,v_event_id,
        '81000000-0000-4000-8000-000000000007',2,v_payload_hash,v_render_hash
      );
      v_google_prepare := public.prepare_registration_observation_notification_delivery_v1(
        v_google_delivery_id,(v_google_claim ->> 'claim_token')::uuid,v_event_id,
        '81000000-0000-4000-8000-000000000006',2,v_payload_hash,v_render_hash
      );
    end if;

    select pg_catalog.jsonb_build_object(
      'directorState',p_director_state,
      'sharedEvent',in_app.event_id=google_chat.event_id,
      'googlePrepared',(v_google_prepare ->> 'prepared')::boolean,
      'googleStatus',v_google_prepare ->> 'status',
      'googleConnection',v_google_prepare ->> 'connection_key',
      'googleMentions',v_google_prepare -> 'mention_user_names',
      'googleDeliveryStatus',google_chat.status,
      'googleOwnership',(
        select ownership.state
        from dashboard_private.notification_dispatch_ownership_claims ownership
        join dashboard_private.notification_events event
          on event.id=google_chat.event_id
        where ownership.workflow_key=event.workflow_key
          and ownership.occurrence_key=event.occurrence_key
          and ownership.rule_id=google_chat.rule_id
          and ownership.channel_key=google_chat.channel_key
          and ownership.target_key=google_chat.target_key
          and ownership.target_generation=google_chat.target_generation
      ),
      'inAppPrepared',(v_in_app_prepare ->> 'prepared')::boolean,
      'inAppStatus',v_in_app_prepare ->> 'status',
      'inAppReason',in_app.status_reason,
      'inAppDeliveryStatus',in_app.status,
      'inAppOwnership',(
        select ownership.state
        from dashboard_private.notification_dispatch_ownership_claims ownership
        join dashboard_private.notification_events event
          on event.id=in_app.event_id
        where ownership.workflow_key=event.workflow_key
          and ownership.occurrence_key=event.occurrence_key
          and ownership.rule_id=in_app.rule_id
          and ownership.channel_key=in_app.channel_key
          and ownership.target_key=in_app.target_key
          and ownership.target_generation=in_app.target_generation
      ),
      'notificationCount',(
        select pg_catalog.count(*)
        from public.dashboard_notifications notification
        where notification.source_delivery_id=v_in_app_delivery_id
      ),
      'externalAttemptDelta',(
        select pg_catalog.count(*)-v_before_attempts
        from dashboard_private.notification_audit_logs audit
        where audit.entity_kind='notification_external_attempt'
          and audit.action='external_attempt_registered'
      )
    ) into v_result
    from dashboard_private.notification_deliveries in_app
    cross join dashboard_private.notification_deliveries google_chat
    where in_app.id=v_in_app_delivery_id
      and google_chat.id=v_google_delivery_id;
    raise exception 'registration_observation_channel_pair_fixture_rollback'
      using errcode='P1001';
  exception when sqlstate 'P1001' then
    return v_result;
  end;
end;
$$;

select is(
  pg_temp.exercise_registration_observation_channel_pair_v1('active',true),
  '{"directorState":"active","sharedEvent":true,"googlePrepared":true,"googleStatus":"sending","googleConnection":"google_chat.management","googleMentions":[],"googleDeliveryStatus":"sending","googleOwnership":"dispatch_started","inAppPrepared":true,"inAppStatus":"sent","inAppReason":null,"inAppDeliveryStatus":"sent","inAppOwnership":"closed","notificationCount":1,"externalAttemptDelta":0}'::jsonb,
  'paired active feedback event reaches management begin and one in-app commit independently'
);
select is(
  pg_temp.exercise_registration_observation_channel_pair_v1('null',false),
  '{"directorState":"null","sharedEvent":true,"googlePrepared":true,"googleStatus":"sending","googleConnection":"google_chat.management","googleMentions":[],"googleDeliveryStatus":"sending","googleOwnership":"dispatch_started","inAppPrepared":false,"inAppStatus":"canceled","inAppReason":"recipient_revoked","inAppDeliveryStatus":"canceled","inAppOwnership":"closed","notificationCount":0,"externalAttemptDelta":0}'::jsonb,
  'null current director closes only in-app before management independently reaches begin'
);
select is(
  pg_temp.exercise_registration_observation_channel_pair_v1('banned',true),
  '{"directorState":"banned","sharedEvent":true,"googlePrepared":true,"googleStatus":"sending","googleConnection":"google_chat.management","googleMentions":[],"googleDeliveryStatus":"sending","googleOwnership":"dispatch_started","inAppPrepared":false,"inAppStatus":"canceled","inAppReason":"recipient_revoked","inAppDeliveryStatus":"canceled","inAppOwnership":"closed","notificationCount":0,"externalAttemptDelta":0}'::jsonb,
  'banned current director closes only in-app after management independently reaches begin'
);

update dashboard_private.registration_observation_chat_jobs
set status='claimed',attempt_count=1,next_attempt_at=null,
  claimed_by='expired-contract-worker',claim_token=gen_random_uuid(),
  lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second',
  updated_at=pg_catalog.clock_timestamp()
where observation_id='94000000-0000-4000-8000-000000000208'
  and event_key='registration.observation_feedback_due';
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
select is(
  public.reap_registration_observation_chat_job_leases_v1(
    'google-chat-reaper',1
  ),
  '{"reaped_count":1,"failed_count":0}'::jsonb,
  'reaper returns one live-window lease to pending'
);
reset role;
select is(
  (select pg_catalog.jsonb_build_object(
    'status',status,'nextScheduled',next_attempt_at is not null,
    'claimedBy',claimed_by,'claimToken',claim_token,'lease',lease_expires_at
  )
  from dashboard_private.registration_observation_chat_jobs
  where observation_id='94000000-0000-4000-8000-000000000208'
    and event_key='registration.observation_feedback_due'),
  '{"status":"pending","nextScheduled":true,"claimedBy":null,"claimToken":null,"lease":null}'::jsonb,
  'reaped job has the exact pending shape'
);

update public.ops_registration_appointments
set status='canceled',updated_at=pg_catalog.clock_timestamp()
where id='94000000-0000-4000-8000-000000000207';
update public.ops_registration_observations
set status='canceled',updated_at=pg_catalog.clock_timestamp()
where id='94000000-0000-4000-8000-000000000208';
update dashboard_private.registration_observation_chat_jobs
set next_attempt_at=pg_catalog.clock_timestamp()-interval '1 second',
    due_at=pg_catalog.clock_timestamp()-interval '1 second'
where observation_id='94000000-0000-4000-8000-000000000208'
  and event_key='registration.observation_feedback_due'
  and status='pending';
delete from chat_claim_result where generation=3;
set local role service_role;
select pg_catalog.set_config('request.jwt.claim.role','service_role',true);
insert into chat_claim_result
select 3, claim
from public.claim_registration_observation_chat_jobs_v1(
  'google-chat-lifecycle-worker',1,60
) claim;
reset role;
select is(
  (select pg_catalog.count(*) from chat_claim_result where generation=3),
  0::bigint,
  'claim returns no job whose current lifecycle is ineligible'
);
select is(
  (select pg_catalog.jsonb_build_object(
    'status',status,'error',last_error_code,'eventCount',(
      select pg_catalog.count(*)
      from dashboard_private.notification_events event
      where event.source_type='registration_observation'
        and event.source_id=job.observation_id::text
        and event.event_key=job.event_key
    )
  )
  from dashboard_private.registration_observation_chat_jobs job
  where job.observation_id='94000000-0000-4000-8000-000000000208'
    and job.event_key='registration.observation_feedback_due'),
  '{"status":"canceled","error":"source_status_changed","eventCount":0}'::jsonb,
  'claim terminalizes current lifecycle drift before event materialization'
);

select matches(
  (select pg_catalog.pg_get_constraintdef(constraint_row.oid)
   from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
     'dashboard_private.notification_deliveries'::regclass
     and constraint_row.conname = 'notification_deliveries_status_reason_check'),
  'notification_window_closed',
  'final delivery reason registry contains notification_window_closed'
);
select matches(
  (select pg_catalog.pg_get_constraintdef(constraint_row.oid)
   from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid =
     'dashboard_private.notification_deliveries'::regclass
     and constraint_row.conname = 'notification_deliveries_status_reason_mapping_check'),
  'canceled.*notification_window_closed',
  'notification_window_closed is mapped only through the canceled family'
);
select throws_ok($$
  update dashboard_private.notification_deliveries
  set status='failed',status_reason='notification_window_closed'
  where id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim)
$$,'23514',null,
  'failed cannot use notification_window_closed');
select throws_ok($$
  update dashboard_private.notification_deliveries
  set status='retry_wait',status_reason='notification_window_closed'
  where id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim)
$$,'23514',null,
  'retry-wait cannot use notification_window_closed');
select throws_ok($$
  update dashboard_private.notification_deliveries
  set status='canceled',status_reason='retry_window_closed'
  where id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim)
$$,'23514',null,
  'canceled cannot use retry_window_closed');
select throws_ok($$
  update dashboard_private.notification_deliveries
  set status='pending',status_reason='notification_window_closed'
  where id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim)
$$,'23514',null,
  'pending cannot persist a terminal reason');
select throws_ok($$
  update dashboard_private.notification_deliveries
  set status='claimed',status_reason='notification_window_closed'
  where id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim)
$$,'23514',null,
  'claimed cannot persist a terminal reason');
select throws_ok($$
  update dashboard_private.notification_deliveries
  set status='sending',status_reason='notification_window_closed'
  where id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim)
$$,'23514',null,
  'sending cannot persist a terminal reason');
select throws_ok($$
  update dashboard_private.notification_deliveries
  set status='sent',status_reason='notification_window_closed'
  where id=(select (payload ->> 'delivery_id')::uuid from chat_delivery_claim)
$$,'23514',null,
  'sent cannot persist a terminal reason');

create or replace function pg_temp.registration_observation_chat_explain_v1(
  p_kind text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
begin
  perform pg_catalog.set_config('enable_seqscan','off',true);
  if p_kind = 'due' then
    execute $plan$
      explain (format json)
      select job.job_id
      from dashboard_private.registration_observation_chat_jobs job
      where job.status='pending'
        and job.next_attempt_at <= pg_catalog.clock_timestamp()
      order by job.next_attempt_at,job.due_at,job.job_id
      limit 100
    $plan$ into v_plan;
  elsif p_kind = 'lease' then
    execute $plan$
      explain (format json)
      select job.job_id
      from dashboard_private.registration_observation_chat_jobs job
      where job.status='claimed'
        and job.lease_expires_at <= pg_catalog.clock_timestamp()
      order by job.lease_expires_at,job.job_id
      limit 100
    $plan$ into v_plan;
  elsif p_kind = 'observation' then
    execute $plan$
      explain (format json)
      select job.job_id
      from dashboard_private.registration_observation_chat_jobs job
      where job.observation_id='94000000-0000-4000-8000-000000000108'
      order by job.notification_revision desc,job.created_at desc
      limit 20
    $plan$ into v_plan;
  else
    raise exception 'registration_observation_chat_explain_fixture_invalid'
      using errcode='22023';
  end if;
  return v_plan;
end;
$$;
select matches(
  pg_temp.registration_observation_chat_explain_v1('due')::text,
  'registration_observation_chat_jobs_due_claim_idx',
  'due claim EXPLAIN uses the partial due index'
);
select matches(
  pg_temp.registration_observation_chat_explain_v1('lease')::text,
  'registration_observation_chat_jobs_lease_idx',
  'lease reap EXPLAIN uses the partial lease index'
);
select matches(
  pg_temp.registration_observation_chat_explain_v1('observation')::text,
  'registration_observation_chat_jobs_observation_revision_idx',
  'observation history EXPLAIN uses the bounded observation index'
);

select is(
  pg_catalog.jsonb_build_object(
    'customerMessages',(
      select pg_catalog.count(*) from public.ops_registration_customer_messages
    ) - (select customer_message_count from chat_external_queue_baseline),
    'reminderJobs',(
      select pg_catalog.count(*)
      from dashboard_private.registration_customer_reminder_jobs
    ) - (select reminder_job_count from chat_external_queue_baseline)
  ),
  '{"customerMessages":0,"reminderJobs":0}'::jsonb,
  'Google Chat contract tests leave customer and SOLAPI queues unchanged'
);

select is(
  (select pg_catalog.count(*)
   from dashboard_private.notification_audit_logs audit
   where audit.entity_kind = 'notification_external_attempt'
     and audit.action = 'external_attempt_registered'),
  0::bigint,
  'structural and readiness tests register no external attempt'
);

select * from finish();
rollback;
