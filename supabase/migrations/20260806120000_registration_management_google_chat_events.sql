begin;

set local lock_timeout = '5s';

-- registration_management_google_chat_identity_fixture_begin
select $registration_management_identities$
[
  "registration|registration.consultation_completed|management_team|google_chat|immediate",
  "registration|registration.waiting_transitioned|management_team|google_chat|immediate",
  "registration|registration.admission_started|management_team|google_chat|immediate"
]
$registration_management_identities$::jsonb;
-- registration_management_google_chat_identity_fixture_end

-- notification_content_contract_extension_fixture_begin
select $notification_contract_extension$
[
  {"eventKey":"registration.consultation_completed","requiredTokens":["학생","과목","현재상태"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","current_state"],"supportedPayloadVersions":[2]},
  {"eventKey":"registration.waiting_transitioned","requiredTokens":["학생","과목","현재상태"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","current_state"],"supportedPayloadVersions":[2]},
  {"eventKey":"registration.admission_started","requiredTokens":["학생","과목","현재상태"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","current_state"],"supportedPayloadVersions":[2]}
]
$notification_contract_extension$::jsonb;
-- notification_content_contract_extension_fixture_end

-- notification_system_template_extension_fixture_begin
select $notification_system_template_extension$
[
  {"workflowKey":"registration","eventKey":"registration.consultation_completed","titleTemplate":"✅ [등록] {student_name} 상담이 완료됐어요","bodyTemplate":"[학생] {student_name}\n[과목] {subjects}\n[상태] {current_status}\n{progress_line}"},
  {"workflowKey":"registration","eventKey":"registration.waiting_transitioned","titleTemplate":"⏳ [등록] {student_name} 대기 신청이 접수됐어요","bodyTemplate":"[학생] {student_name}\n[과목] {subjects}\n[상태] {current_status}\n{progress_line}"},
  {"workflowKey":"registration","eventKey":"registration.admission_started","titleTemplate":"📝 [등록] {student_name} 등록 신청이 접수됐어요","bodyTemplate":"[학생] {student_name}\n[과목] {subjects}\n[상태] {current_status}\n{progress_line}"}
]
$notification_system_template_extension$::jsonb;
-- notification_system_template_extension_fixture_end

with event_catalog(event_key, event_label, trigger_description, event_sort) as (
  values
    ('registration.consultation_completed'::text, '상담 완료'::text, '상담 완료 상태가 저장되었을 때'::text, 4),
    ('registration.waiting_transitioned'::text, '대기 신청'::text, '고객이 대기 상태로 전환되었을 때'::text, 5),
    ('registration.admission_started'::text, '등록 신청'::text, '고객의 등록 절차가 시작되었을 때'::text, 6)
)
insert into dashboard_private.notification_settings_ui_registry(
  rule_id,
  workflow_key,
  workflow_label,
  workflow_sort,
  event_key,
  event_label,
  group_label,
  trigger_description,
  event_sort,
  audience_key,
  audience_label,
  channel_key,
  channel_label,
  cell_sort,
  rule_variant_key,
  delivery_mode,
  schedule_key,
  schedule_config,
  initial_enabled,
  source_trigger_kind,
  configuration_kind,
  activation_locked
)
select
  dashboard_private.notification_deterministic_uuid_v1(
    'notification-rule-v1',
    pg_catalog.concat_ws(
      '|',
      'global',
      'registration',
      event_catalog.event_key,
      'management_team',
      'google_chat',
      'immediate'
    )
  ),
  'registration',
  '등록',
  3,
  event_catalog.event_key,
  event_catalog.event_label,
  '등록 진행',
  event_catalog.trigger_description,
  event_catalog.event_sort,
  'management_team',
  '관리팀',
  'google_chat',
  'Google Chat',
  1,
  'immediate',
  'immediate',
  null,
  null,
  true,
  null,
  'editable_rule',
  false
from event_catalog
on conflict (
  workflow_key,
  event_key,
  audience_key,
  channel_key,
  rule_variant_key
) do update set
  event_label = excluded.event_label,
  group_label = excluded.group_label,
  trigger_description = excluded.trigger_description,
  event_sort = excluded.event_sort,
  initial_enabled = true,
  configuration_kind = 'editable_rule',
  activation_locked = false;

update dashboard_private.notification_settings_ui_registry
set
  event_label = '상담 신청',
  trigger_description = '새 상담 신청이 접수되었을 때',
  initial_enabled = true
where workflow_key = 'registration'
  and event_key = 'registration.case_created'
  and audience_key = 'management_team'
  and channel_key = 'google_chat'
  and rule_variant_key = 'immediate';

with registry as (
  select registry.*
  from dashboard_private.notification_settings_ui_registry registry
  where registry.workflow_key = 'registration'
    and registry.event_key in (
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started'
    )
    and registry.audience_key = 'management_team'
    and registry.channel_key = 'google_chat'
    and registry.rule_variant_key = 'immediate'
)
insert into dashboard_private.notification_rules(
  id,
  scope_key,
  workflow_key,
  event_key,
  channel_key,
  audience_key,
  rule_variant_key,
  delivery_mode,
  schedule_key,
  schedule_config,
  enabled,
  active_template_id,
  revision,
  created_by,
  created_actor_kind,
  updated_by,
  updated_actor_kind
)
select
  registry.rule_id,
  'global',
  registry.workflow_key,
  registry.event_key,
  registry.channel_key,
  registry.audience_key,
  registry.rule_variant_key,
  registry.delivery_mode,
  null,
  null,
  true,
  dashboard_private.notification_deterministic_uuid_v1(
    'notification-template-v1',
    registry.rule_id::text || '|1'
  ),
  1,
  null,
  'system',
  null,
  'system'
from registry
on conflict (id) do update set
  enabled = true,
  updated_by = null,
  updated_actor_kind = 'system',
  updated_at = now();

with registry as (
  select registry.*
  from dashboard_private.notification_settings_ui_registry registry
  where registry.workflow_key = 'registration'
    and registry.event_key in (
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started'
    )
    and registry.audience_key = 'management_team'
    and registry.channel_key = 'google_chat'
    and registry.rule_variant_key = 'immediate'
), template_payload(event_key, title_template, body_template) as (
  values
    (
      'registration.consultation_completed'::text,
      '✅ [등록] {student_name} 상담이 완료됐어요'::text,
      E'[학생] {student_name}\n[과목] {subjects}\n[상태] {current_status}\n{progress_line}'::text
    ),
    (
      'registration.waiting_transitioned'::text,
      '⏳ [등록] {student_name} 대기 신청이 접수됐어요'::text,
      E'[학생] {student_name}\n[과목] {subjects}\n[상태] {current_status}\n{progress_line}'::text
    ),
    (
      'registration.admission_started'::text,
      '📝 [등록] {student_name} 등록 신청이 접수됐어요'::text,
      E'[학생] {student_name}\n[과목] {subjects}\n[상태] {current_status}\n{progress_line}'::text
    )
), candidates as (
  select
    registry.rule_id,
    template_payload.title_template,
    template_payload.body_template,
    '[
      {"key":"student_name","token":"학생","pii_class":"student_name"},
      {"key":"subjects","token":"과목","pii_class":"none"},
      {"key":"current_status","token":"현재상태","pii_class":"none"},
      {"key":"progress_line","token":"진행정보","pii_class":"none"}
    ]'::jsonb as allowed_variables,
    2 as payload_schema_version
  from registry
  join template_payload using (event_key)
)
insert into dashboard_private.notification_templates(
  id,
  rule_id,
  version,
  title_template,
  body_template,
  allowed_variables,
  payload_schema_version,
  checksum,
  created_by,
  created_actor_kind,
  content_contract_version
)
select
  dashboard_private.notification_deterministic_uuid_v1(
    'notification-template-v1',
    candidates.rule_id::text || '|1'
  ),
  candidates.rule_id,
  1,
  candidates.title_template,
  candidates.body_template,
  candidates.allowed_variables,
  candidates.payload_schema_version,
  dashboard_private.notification_seed_template_checksum_v1(
    candidates.title_template,
    candidates.body_template,
    candidates.allowed_variables,
    candidates.payload_schema_version
  ),
  null,
  'system',
  '1'
from candidates
on conflict (rule_id, version) do update set
  title_template = excluded.title_template,
  body_template = excluded.body_template,
  allowed_variables = excluded.allowed_variables,
  payload_schema_version = excluded.payload_schema_version,
  checksum = excluded.checksum,
  content_contract_version = excluded.content_contract_version;

with registry as (
  select registry.*
  from dashboard_private.notification_settings_ui_registry registry
  where registry.workflow_key = 'registration'
    and registry.event_key in (
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started'
    )
    and registry.audience_key = 'management_team'
    and registry.channel_key = 'google_chat'
    and registry.rule_variant_key = 'immediate'
), contract_payload as (
  select pg_catalog.jsonb_build_object(
    'contractVersion', '1',
    'availableVariables', '[
      {"key":"student_name","token":"학생","piiClass":"student_name"},
      {"key":"subjects","token":"과목","piiClass":"none"},
      {"key":"current_status","token":"현재상태","piiClass":"none"},
      {"key":"progress_line","token":"진행정보","piiClass":"none"}
    ]'::jsonb,
    'requiredTokens', '["학생","과목","현재상태"]'::jsonb,
    'optionalLineTokens', '["진행정보"]'::jsonb,
    'mustHaveFacts', '["target","event","current_state"]'::jsonb,
    'supportedPayloadVersions', '[2]'::jsonb,
    'destinationPolicy', pg_catalog.jsonb_build_object(
      'allowedConnectionKeys', '["google_chat.management"]'::jsonb,
      'subjectScoped', false
    ),
    'freeTextVisibility', '{}'::jsonb,
    'freeTextPriority', '[]'::jsonb,
    'fieldPresence', '{
      "student_name":{"required":true,"nullBehavior":"reject","nullDisplay":null,"emptyArrayBehavior":"reject"},
      "subjects":{"required":true,"nullBehavior":"reject","nullDisplay":null,"emptyArrayBehavior":"reject"},
      "current_status":{"required":true,"nullBehavior":"reject","nullDisplay":null,"emptyArrayBehavior":"reject"},
      "progress_line":{"required":false,"nullBehavior":"omit","nullDisplay":null,"emptyArrayBehavior":"omit"}
    }'::jsonb
  ) as contract_json
)
insert into dashboard_private.notification_rule_content_contracts(
  rule_id,
  workflow_key,
  event_key,
  audience_key,
  channel_key,
  rule_variant_key,
  contract_version,
  contract_json
)
select
  registry.rule_id,
  registry.workflow_key,
  registry.event_key,
  registry.audience_key,
  registry.channel_key,
  registry.rule_variant_key,
  '1',
  contract_payload.contract_json
from registry
cross join contract_payload
on conflict (
  workflow_key,
  event_key,
  audience_key,
  channel_key,
  rule_variant_key
) do update set
  contract_version = excluded.contract_version,
  contract_json = excluded.contract_json;

update dashboard_private.notification_rules rule_row
set
  enabled = true,
  updated_by = null,
  updated_actor_kind = 'system',
  updated_at = now()
from dashboard_private.notification_settings_ui_registry registry
where registry.rule_id = rule_row.id
  and registry.workflow_key = 'registration'
  and registry.event_key = 'registration.case_created'
  and registry.audience_key = 'management_team'
  and registry.channel_key = 'google_chat'
  and registry.rule_variant_key = 'immediate'
  and rule_row.enabled = false;

set constraints all immediate;

commit;
