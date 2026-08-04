begin;

set local lock_timeout = '5s';

alter table dashboard_private.notification_settings_ui_registry
  add column configuration_kind text not null default 'editable_rule',
  add column activation_locked boolean not null default false;

alter table dashboard_private.notification_settings_ui_registry
  add constraint notification_settings_ui_registry_configuration_kind_check
    check (configuration_kind in (
      'editable_rule',
      'fixed_policy_editable_template'
    ));

alter table dashboard_private.notification_templates
  add column content_contract_version text;

alter table dashboard_private.notification_templates
  add constraint notification_templates_content_contract_version_check
    check (
      content_contract_version is null
      or content_contract_version ~ '^[1-9][0-9]*$'
    );

with fixed_event_catalog(event_key, event_label, event_sort) as (
  values
    ('registration.phone_consultation_ready'::text, '전화상담 준비', 101),
    ('registration.visit_scheduled'::text, '방문상담 예약', 102),
    ('registration.visit_rescheduled'::text, '방문상담 일정 변경', 103),
    ('registration.visit_replaced'::text, '방문상담 예약 교체', 104),
    ('registration.visit_subject_deselected'::text, '방문상담 과목 제외', 105),
    ('registration.visit_canceled'::text, '방문상담 취소', 106)
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
  rule_row.id,
  rule_row.workflow_key,
  '등록',
  3,
  rule_row.event_key,
  event_catalog.event_label,
  '상담 인계',
  case rule_row.event_key
    when 'registration.phone_consultation_ready'
      then '전화상담 담당자에게 인계할 준비가 되었을 때'
    when 'registration.visit_scheduled'
      then '방문상담 일정이 처음 배정되었을 때'
    when 'registration.visit_rescheduled'
      then '방문상담 일정이 변경되었을 때'
    when 'registration.visit_replaced'
      then '방문상담 예약이 다른 예약으로 교체되었을 때'
    when 'registration.visit_subject_deselected'
      then '방문상담 대상 과목이 제외되었을 때'
    else '방문상담 예약이 취소되었을 때'
  end,
  event_catalog.event_sort,
  rule_row.audience_key,
  case rule_row.audience_key
    when 'track_director' then '트랙 담당자'
    when 'management_team' then '관리팀'
  end,
  rule_row.channel_key,
  case rule_row.channel_key
    when 'in_app' then '대시보드'
    when 'google_chat' then 'Google Chat'
  end,
  case
    when rule_row.audience_key = 'track_director' then 1
    else 2
  end,
  rule_row.rule_variant_key,
  rule_row.delivery_mode,
  rule_row.schedule_key,
  rule_row.schedule_config,
  rule_row.enabled,
  null,
  'fixed_policy_editable_template',
  true
from dashboard_private.notification_rules rule_row
join fixed_event_catalog event_catalog
  on event_catalog.event_key = rule_row.event_key
where rule_row.scope_key = 'global'
  and rule_row.workflow_key = 'registration'
  and rule_row.channel_key <> 'customer_message'
on conflict do nothing;

create table dashboard_private.notification_rule_content_contracts (
  rule_id uuid not null unique
    references dashboard_private.notification_rules(id),
  workflow_key text not null,
  event_key text not null,
  audience_key text not null,
  channel_key text not null,
  rule_variant_key text not null,
  contract_version text not null,
  contract_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (
    workflow_key,
    event_key,
    audience_key,
    channel_key,
    rule_variant_key
  ),
  constraint notification_rule_content_contracts_registry_fkey
    foreign key (
      workflow_key,
      event_key,
      audience_key,
      channel_key,
      rule_variant_key
    ) references dashboard_private.notification_settings_ui_registry(
      workflow_key,
      event_key,
      audience_key,
      channel_key,
      rule_variant_key
    ) deferrable initially deferred,
  constraint notification_rule_content_contracts_version_check
    check (contract_version ~ '^[1-9][0-9]*$'),
  constraint notification_rule_content_contracts_json_check
    check (
      pg_catalog.jsonb_typeof(contract_json) = 'object'
      and contract_json ->> 'contractVersion' = contract_version
      and pg_catalog.jsonb_typeof(contract_json -> 'availableVariables') = 'array'
      and pg_catalog.jsonb_typeof(contract_json -> 'requiredTokens') = 'array'
      and pg_catalog.jsonb_typeof(contract_json -> 'optionalLineTokens') = 'array'
      and pg_catalog.jsonb_typeof(contract_json -> 'destinationPolicy') = 'object'
    )
);

create table dashboard_private.notification_template_compliance_audits (
  template_id uuid not null
    references dashboard_private.notification_templates(id),
  rule_id uuid not null
    references dashboard_private.notification_rules(id),
  contract_version text not null,
  compliance text not null,
  violations jsonb not null,
  audited_at timestamptz not null default now(),
  primary key (template_id, contract_version),
  constraint notification_template_compliance_audits_state_check
    check (compliance in ('conformant', 'legacy_custom_nonconformant')),
  constraint notification_template_compliance_audits_violations_check
    check (pg_catalog.jsonb_typeof(violations) = 'array')
);

alter table dashboard_private.notification_rule_content_contracts
  enable row level security;
alter table dashboard_private.notification_template_compliance_audits
  enable row level security;

revoke all on table dashboard_private.notification_rule_content_contracts
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_template_compliance_audits
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.notification_content_event_spec_v1(
  p_event_key text
)
returns jsonb
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select specification.item
  from pg_catalog.jsonb_array_elements(
    (
      -- notification_content_contract_fixture_begin
      $notification_contracts$
{
  "contractVersion": "1",
  "eventContracts": [
    {"eventKey":"task.created","requiredTokens":["업무","현재상태","현재담당"],"optionalLineTokens":["메모정보","진행정보"],"mustHaveFacts":["target","event","current_state"],"fieldPresenceOverrides":{"current_assignee":{"required":true,"nullBehavior":"display","nullDisplay":"미배정","emptyArrayBehavior":"reject"}}},
    {"eventKey":"task.assignee_changed","requiredTokens":["업무","기존담당","새담당"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after"],"fieldPresenceOverrides":{"before_assignee":{"required":true,"nullBehavior":"display","nullDisplay":"미배정","emptyArrayBehavior":"reject"},"after_assignee":{"required":true,"nullBehavior":"display","nullDisplay":"미배정","emptyArrayBehavior":"reject"}}},
    {"eventKey":"task.due_changed","requiredTokens":["업무","기존일정","새일정"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after","schedule"],"fieldPresenceOverrides":{"before_schedule":{"required":true,"nullBehavior":"display","nullDisplay":"일정 없음","emptyArrayBehavior":"reject"},"after_schedule":{"required":true,"nullBehavior":"display","nullDisplay":"일정 없음","emptyArrayBehavior":"reject"}}},
    {"eventKey":"task.status_changed","requiredTokens":["업무","기존상태","새상태"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after"]},
    {"eventKey":"task.completed","requiredTokens":["업무","완료상태"],"optionalLineTokens":["메모정보"],"mustHaveFacts":["target","event","current_state"]},
    {"eventKey":"task.canceled","requiredTokens":["업무","취소상태"],"optionalLineTokens":["사유정보","메모정보"],"mustHaveFacts":["target","event","current_state"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"task.reopened","requiredTokens":["업무","기존상태","새상태"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after"]},
    {"eventKey":"task.comment_added","requiredTokens":["업무","댓글작성자","댓글미리보기"],"optionalLineTokens":["첨부정보","진행정보"],"mustHaveFacts":["target","event"],"freeTextVisibility":{"comment_preview":"show","attachment_summary":"show"},"freeTextPriority":["comment_preview","attachment_summary"]},
    {"eventKey":"word_retest.created","requiredTokens":["학생","수업","시험범위","시험일"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","schedule"]},
    {"eventKey":"word_retest.assigned","requiredTokens":["학생","기존담당","새담당"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after"],"fieldPresenceOverrides":{"before_assignee":{"required":true,"nullBehavior":"display","nullDisplay":"미배정","emptyArrayBehavior":"reject"},"after_assignee":{"required":true,"nullBehavior":"display","nullDisplay":"미배정","emptyArrayBehavior":"reject"}}},
    {"eventKey":"word_retest.schedule_changed","requiredTokens":["학생","기존시험일","새시험일"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after","schedule"],"fieldPresenceOverrides":{"before_test_date":{"required":true,"nullBehavior":"display","nullDisplay":"일정 없음","emptyArrayBehavior":"reject"},"after_test_date":{"required":true,"nullBehavior":"display","nullDisplay":"일정 없음","emptyArrayBehavior":"reject"}}},
    {"eventKey":"word_retest.started","requiredTokens":["학생","수업","시험범위","시작상태"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","current_state"]},
    {"eventKey":"word_retest.result_reported","requiredTokens":["학생","점수","통과기준","판정"],"optionalLineTokens":["메모정보"],"mustHaveFacts":["target","event","result"]},
    {"eventKey":"word_retest.absent_reported","requiredTokens":["학생","시험일","판정"],"optionalLineTokens":["사유정보","메모정보"],"mustHaveFacts":["target","event","result","schedule"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"word_retest.revision_requested","requiredTokens":["학생","현재결과","요청주체"],"optionalLineTokens":["사유정보","진행정보"],"mustHaveFacts":["target","event","result","progress_actor"],"freeTextVisibility":{"reason":"show"},"freeTextPriority":["reason"]},
    {"eventKey":"word_retest.retry_created","requiredTokens":["학생","이전결과","후속일정"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","result","schedule"]},
    {"eventKey":"word_retest.completed","requiredTokens":["학생","최종결과"],"optionalLineTokens":["메모정보"],"mustHaveFacts":["target","event","result"]},
    {"eventKey":"word_retest.canceled","requiredTokens":["학생","취소상태"],"optionalLineTokens":["사유정보"],"mustHaveFacts":["target","event","current_state"],"freeTextVisibility":{"reason":"show"},"freeTextPriority":["reason"]},
    {"eventKey":"registration.case_created","requiredTokens":["학생","학년","과목","문의시각"],"optionalLineTokens":["메모정보","진행정보"],"mustHaveFacts":["target","event","schedule"]},
    {"eventKey":"registration.registration_completed","requiredTokens":["학생","등록과목","등록수업","완료상태"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","current_state"]},
    {"eventKey":"registration.case_closed","requiredTokens":["학생","과목","종료상태"],"optionalLineTokens":["사유정보","메모정보"],"mustHaveFacts":["target","event","current_state"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"registration.appointment_reminder_due","requiredTokens":["상담종류","학생","과목","일정","장소"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","schedule","location"],"supportedPayloadVersions":[2]},
    {"eventKey":"registration.phone_consultation_ready","requiredTokens":["학생","과목","진행주체"],"optionalLineTokens":["메모정보"],"mustHaveFacts":["target","event","progress_actor"],"supportedPayloadVersions":[2],"fieldPresenceOverrides":{"progress_actor":{"required":true,"nullBehavior":"display","nullDisplay":"담당자 지정 대기","emptyArrayBehavior":"reject"}}},
    {"eventKey":"registration.visit_scheduled","requiredTokens":["학생","과목","새일정","새장소"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","schedule","location"],"supportedPayloadVersions":[2]},
    {"eventKey":"registration.visit_rescheduled","requiredTokens":["학생","과목","기존일정","새일정","새장소"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after","schedule","location"],"supportedPayloadVersions":[2]},
    {"eventKey":"registration.visit_replaced","requiredTokens":["학생","과목","기존예약","새예약","새장소"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after","schedule","location"],"supportedPayloadVersions":[2]},
    {"eventKey":"registration.visit_subject_deselected","requiredTokens":["학생","제외과목","남은과목","유지일정","유지장소"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after","schedule","location"],"supportedPayloadVersions":[2],"fieldPresenceOverrides":{"other_active_subjects":{"required":true,"nullBehavior":"reject","nullDisplay":null,"emptyArrayBehavior":"allow"}}},
    {"eventKey":"registration.visit_canceled","requiredTokens":["학생","과목","취소일정","취소장소"],"optionalLineTokens":["사유정보","진행정보"],"mustHaveFacts":["target","event","schedule","location"],"supportedPayloadVersions":[2],"freeTextVisibility":{"reason":"show"},"freeTextPriority":["reason"]},
    {"eventKey":"transfer.submitted","requiredTokens":["학생","기존반","이동반","적용일","신청자"],"optionalLineTokens":["사유정보","메모정보","진행정보"],"mustHaveFacts":["target","event","before_after","schedule"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"transfer.completed","requiredTokens":["학생","기존반","이동반","기존반종료일","새반시작일"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after","schedule"]},
    {"eventKey":"withdrawal.submitted","requiredTokens":["학생","과목","수업","제외일","제외회차","신청자"],"optionalLineTokens":["사유정보","메모정보","진행정보"],"mustHaveFacts":["target","event","schedule"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"withdrawal.completed","requiredTokens":["학생","과목","수업","제외일","제외회차"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","schedule"]},
    {"eventKey":"makeup.submitted","requiredTokens":["수업","과목","담당선생님","휴강일","보강일정","장소","진행주체"],"optionalLineTokens":["사유정보","메모정보"],"mustHaveFacts":["target","event","schedule","location","progress_actor"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"makeup.refund_requested","requiredTokens":["수업","과목","대상일정","현재상태"],"optionalLineTokens":["사유정보","진행정보"],"mustHaveFacts":["target","event","current_state","schedule"],"freeTextVisibility":{"reason":"show"},"freeTextPriority":["reason"]},
    {"eventKey":"makeup.approved","requiredTokens":["수업","과목","휴강일","보강일정","장소","승인주체"],"optionalLineTokens":["메모정보"],"mustHaveFacts":["target","event","schedule","location","progress_actor"],"freeTextVisibility":{"memo":"show"},"freeTextPriority":["memo"]},
    {"eventKey":"makeup.refund_completed","requiredTokens":["수업","과목","현재상태","처리시각"],"optionalLineTokens":["메모정보"],"mustHaveFacts":["target","event","current_state","schedule"]},
    {"eventKey":"makeup.approval_canceled","requiredTokens":["수업","과목","현재상태","처리시각","처리주체"],"optionalLineTokens":["사유정보","메모정보"],"mustHaveFacts":["target","event","current_state","progress_actor","schedule"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"makeup.revision_requested","requiredTokens":["수업","과목","요청주체","현재상태"],"optionalLineTokens":["사유정보","진행정보"],"mustHaveFacts":["target","event","current_state","progress_actor"],"freeTextVisibility":{"reason":"show"},"freeTextPriority":["reason"]},
    {"eventKey":"makeup.rejected","requiredTokens":["수업","과목","반려주체","현재상태"],"optionalLineTokens":["사유정보","메모정보"],"mustHaveFacts":["target","event","current_state","progress_actor"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"approval.created","requiredTokens":["문서","작성자","대상기간","현재상태"],"optionalLineTokens":["첨부정보","메모정보"],"mustHaveFacts":["target","event","current_state"]},
    {"eventKey":"approval.submitted","requiredTokens":["문서","작성자","대상기간","진행주체"],"optionalLineTokens":["첨부정보"],"mustHaveFacts":["target","event","progress_actor"],"fieldPresenceOverrides":{"progress_actor":{"required":true,"nullBehavior":"display","nullDisplay":"결재자 지정 대기","emptyArrayBehavior":"reject"}}},
    {"eventKey":"approval.review_started","requiredTokens":["문서","검토주체","현재상태"],"optionalLineTokens":["메모정보"],"mustHaveFacts":["target","event","current_state","progress_actor"]},
    {"eventKey":"approval.approver_changed","requiredTokens":["문서","기존결재자","새결재자"],"optionalLineTokens":["진행정보"],"mustHaveFacts":["target","event","before_after"],"fieldPresenceOverrides":{"before_approver":{"required":true,"nullBehavior":"display","nullDisplay":"결재자 지정 대기","emptyArrayBehavior":"reject"},"after_approver":{"required":true,"nullBehavior":"display","nullDisplay":"결재자 지정 대기","emptyArrayBehavior":"reject"}}},
    {"eventKey":"approval.approved","requiredTokens":["문서","승인주체","현재상태","처리시각"],"optionalLineTokens":["메모정보"],"mustHaveFacts":["target","event","current_state","progress_actor","schedule"]},
    {"eventKey":"approval.returned","requiredTokens":["문서","반려주체","현재상태"],"optionalLineTokens":["사유정보","메모정보"],"mustHaveFacts":["target","event","current_state","progress_actor"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"approval.canceled","requiredTokens":["문서","취소주체","현재상태"],"optionalLineTokens":["사유정보","메모정보"],"mustHaveFacts":["target","event","current_state","progress_actor"],"freeTextVisibility":{"reason":"show","memo":"show"},"freeTextPriority":["reason","memo"]},
    {"eventKey":"approval.resubmitted","requiredTokens":["문서","재상신자","진행주체"],"optionalLineTokens":["첨부정보"],"mustHaveFacts":["target","event","progress_actor"]},
    {"eventKey":"approval.comment_added","requiredTokens":["문서","댓글작성자","댓글미리보기"],"optionalLineTokens":["첨부정보","진행정보"],"mustHaveFacts":["target","event"],"freeTextVisibility":{"comment_preview":"show","attachment_summary":"show"},"freeTextPriority":["comment_preview","attachment_summary"]}
  ]
}
      $notification_contracts$::jsonb
      -- notification_content_contract_fixture_end
    ) -> 'eventContracts'
  ) specification(item)
  where specification.item ->> 'eventKey' = p_event_key;
$$;

create or replace function dashboard_private.notification_content_variable_v1(
  p_token text
)
returns jsonb
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'key', variable.key,
    'token', variable.token,
    'piiClass', variable.pii_class
  )
  from (
    values
      ('업무','task_title','none'),
      ('현재상태','current_status','none'),
      ('현재담당','current_assignee','staff_name'),
      ('기존담당','before_assignee','staff_name'),
      ('새담당','after_assignee','staff_name'),
      ('기존일정','before_schedule','schedule'),
      ('새일정','after_schedule','schedule'),
      ('기존상태','before_status','none'),
      ('새상태','after_status','none'),
      ('완료상태','completion_status','none'),
      ('취소상태','cancellation_status','none'),
      ('댓글작성자','comment_author','staff_name'),
      ('댓글미리보기','comment_preview','free_text'),
      ('학생','student_name','student_name'),
      ('수업','class_name','class_name'),
      ('시험범위','test_scope','none'),
      ('시험일','test_date','schedule'),
      ('기존시험일','before_test_date','schedule'),
      ('새시험일','after_test_date','schedule'),
      ('시작상태','start_status','none'),
      ('점수','score','none'),
      ('통과기준','pass_threshold','none'),
      ('판정','result','none'),
      ('현재결과','current_result','none'),
      ('요청주체','request_actor','staff_name'),
      ('이전결과','previous_result','none'),
      ('후속일정','followup_schedule','schedule'),
      ('최종결과','final_result','none'),
      ('학년','grade','none'),
      ('과목','subjects','none'),
      ('문의시각','inquiry_at','schedule'),
      ('등록과목','registered_subjects','none'),
      ('등록수업','registered_classes','class_name'),
      ('종료상태','close_status','none'),
      ('상담종류','appointment_kind','none'),
      ('일정','scheduled_at','schedule'),
      ('장소','place','location'),
      ('진행주체','progress_actor','staff_name'),
      ('새장소','after_place','location'),
      ('기존예약','before_appointment','schedule'),
      ('새예약','after_appointment','schedule'),
      ('제외과목','deselected_subjects','none'),
      ('남은과목','other_active_subjects','none'),
      ('유지일정','retained_schedule','schedule'),
      ('유지장소','retained_place','location'),
      ('취소일정','canceled_schedule','schedule'),
      ('취소장소','canceled_place','location'),
      ('기존반','before_class','class_name'),
      ('이동반','after_class','class_name'),
      ('적용일','effective_date','schedule'),
      ('신청자','requester_name','staff_name'),
      ('기존반종료일','before_class_end_date','schedule'),
      ('새반시작일','after_class_start_date','schedule'),
      ('제외일','withdrawal_date','schedule'),
      ('제외회차','withdrawal_round','none'),
      ('담당선생님','teacher_name','staff_name'),
      ('휴강일','cancellation_date','schedule'),
      ('보강일정','makeup_schedule','schedule'),
      ('대상일정','target_schedule','schedule'),
      ('승인주체','approval_actor','staff_name'),
      ('처리시각','processed_at','schedule'),
      ('처리주체','processing_actor','staff_name'),
      ('반려주체','return_actor','staff_name'),
      ('문서','document_title','none'),
      ('작성자','author_name','staff_name'),
      ('대상기간','target_period','schedule'),
      ('검토주체','reviewer_name','staff_name'),
      ('기존결재자','before_approver','staff_name'),
      ('새결재자','after_approver','staff_name'),
      ('취소주체','cancel_actor','staff_name'),
      ('재상신자','resubmitter_name','staff_name'),
      ('메모정보','memo_line','free_text'),
      ('진행정보','progress_line','none'),
      ('사유정보','reason_line','free_text'),
      ('첨부정보','attachment_line','none')
  ) variable(token, key, pii_class)
  where variable.token = p_token;
$$;

create or replace function dashboard_private.notification_content_contract_for_identity_v1(
  p_event_key text,
  p_audience_key text,
  p_channel_key text
)
returns jsonb
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  v_spec jsonb := dashboard_private.notification_content_event_spec_v1(p_event_key);
  v_variables jsonb;
  v_field_presence jsonb;
  v_destination_keys jsonb;
begin
  if v_spec is null then
    raise exception 'notification_content_event_contract_missing'
      using errcode = '22023';
  end if;

  select
    pg_catalog.jsonb_agg(variable.definition order by token.ordinal),
    pg_catalog.jsonb_object_agg(
      variable.definition ->> 'key',
      coalesce(
        v_spec -> 'fieldPresenceOverrides' -> (variable.definition ->> 'key'),
        pg_catalog.jsonb_build_object(
          'required', token.required,
          'nullBehavior', case when token.required then 'reject' else 'omit' end,
          'nullDisplay', null,
          'emptyArrayBehavior', case when token.required then 'reject' else 'omit' end
        )
      )
      order by token.ordinal
    )
  into v_variables, v_field_presence
  from (
    select required.value as token, required.ordinality as ordinal, true as required
    from pg_catalog.jsonb_array_elements_text(v_spec -> 'requiredTokens')
      with ordinality required(value, ordinality)
    union all
    select optional.value, optional.ordinality + 1000, false
    from pg_catalog.jsonb_array_elements_text(
      coalesce(v_spec -> 'optionalLineTokens', '[]'::jsonb)
    ) with ordinality optional(value, ordinality)
  ) token
  cross join lateral (
    select dashboard_private.notification_content_variable_v1(token.token) as definition
  ) variable;

  if v_variables is null
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_variables) item(value)
      where item.value is null
    )
  then
    raise exception 'notification_content_variable_unknown'
      using errcode = '22023';
  end if;

  v_destination_keys := case
    when p_channel_key <> 'google_chat' then '[]'::jsonb
    when p_audience_key = 'management_team'
      then '["google_chat.management"]'::jsonb
    when p_audience_key = 'executive_team'
      then '["google_chat.executive"]'::jsonb
    when p_audience_key = 'subject_team'
      then '["google_chat.english","google_chat.math","google_chat.science"]'::jsonb
    else null
  end;
  if v_destination_keys is null then
    raise exception 'notification_content_google_chat_audience_unsupported'
      using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'contractVersion', '1',
    'availableVariables', v_variables,
    'requiredTokens', v_spec -> 'requiredTokens',
    'optionalLineTokens', coalesce(v_spec -> 'optionalLineTokens', '[]'::jsonb),
    'mustHaveFacts', coalesce(v_spec -> 'mustHaveFacts', '["target","event"]'::jsonb),
    'supportedPayloadVersions', coalesce(v_spec -> 'supportedPayloadVersions', '[1]'::jsonb),
    'destinationPolicy', pg_catalog.jsonb_build_object(
      'allowedConnectionKeys', v_destination_keys,
      'subjectScoped', p_audience_key = 'subject_team'
    ),
    'freeTextVisibility', coalesce(v_spec -> 'freeTextVisibility', '{}'::jsonb),
    'freeTextPriority', coalesce(v_spec -> 'freeTextPriority', '[]'::jsonb),
    'fieldPresence', v_field_presence
  );
end;
$$;

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
  dashboard_private.notification_content_contract_for_identity_v1(
    registry.event_key,
    registry.audience_key,
    registry.channel_key
  )
from dashboard_private.notification_settings_ui_registry registry
where registry.channel_key <> 'customer_message'
on conflict do nothing;

create or replace function dashboard_private.notification_content_contract_for_rule_v1(
  p_rule_id uuid
)
returns jsonb
language sql
stable
strict
security definer
set search_path = ''
as $$
  select contract_row.contract_json
  from dashboard_private.notification_rule_content_contracts contract_row
  where contract_row.rule_id = p_rule_id;
$$;

create or replace function dashboard_private.notification_template_contract_violations_v1(
  p_rule_id uuid,
  p_title_template text,
  p_body_template text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contract jsonb;
  v_combined text := coalesce(p_title_template, '') || chr(10)
    || coalesce(p_body_template, '');
  v_without_valid_tokens text;
  v_variable record;
  v_token_match text[];
  v_violations jsonb := '[]'::jsonb;
begin
  select contract_row.contract_json
  into v_contract
  from dashboard_private.notification_rule_content_contracts contract_row
  where contract_row.rule_id = p_rule_id;
  if not found then
    raise exception 'notification_content_contract_not_found'
      using errcode = 'P0002';
  end if;

  if nullif(pg_catalog.btrim(coalesce(p_title_template, '')), '') is null
    or nullif(pg_catalog.btrim(coalesce(p_body_template, '')), '') is null
  then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_content_empty',
        'severity', 'error',
        'message', '제목과 본문을 모두 입력해 주세요.'
      )
    );
  end if;
  if pg_catalog.char_length(coalesce(p_title_template, '')) > 200 then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_title_too_long',
        'severity', 'error',
        'message', '제목은 200자 이내로 입력해 주세요.'
      )
    );
  end if;
  if pg_catalog.char_length(coalesce(p_body_template, '')) > 4000 then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_body_too_long',
        'severity', 'error',
        'message', '본문은 4,000자 이내로 입력해 주세요.'
      )
    );
  end if;
  if v_combined ~ '<[^>]*>' then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_html_forbidden',
        'severity', 'error',
        'message', 'HTML 태그는 사용할 수 없어요.'
      )
    );
  end if;
  if v_combined ~* '(https?://|javascript:|(^|[[:space:]])//)' then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_external_url_forbidden',
        'severity', 'error',
        'message', '알림 내용에서 링크를 제거해 주세요.'
      )
    );
  end if;
  if v_combined ~* '(@all|@everyone|@channel|@here|@전체)' then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_broadcast_mention_forbidden',
        'severity', 'error',
        'message', '전체 호출 멘션은 사용할 수 없어요.'
      )
    );
  end if;

  v_without_valid_tokens := pg_catalog.regexp_replace(
    v_combined,
    '[{][A-Za-z_][A-Za-z0-9_]*[}]',
    '',
    'g'
  );
  if v_without_valid_tokens ~ '[{}]' then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_braces_malformed',
        'severity', 'error',
        'message', '변수 괄호 형식을 다시 확인해 주세요.'
      )
    );
  end if;

  for v_token_match in
    select matched.value
    from pg_catalog.regexp_matches(
      v_combined,
      '[{]([A-Za-z_][A-Za-z0-9_]*)[}]',
      'g'
    ) matched(value)
  loop
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_contract -> 'availableVariables'
      ) variable(item)
      where variable.item ->> 'key' = v_token_match[1]
    ) then
      v_violations := v_violations || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', 'notification_template_variable_unknown',
          'severity', 'error',
          'variable', v_token_match[1],
          'message', case
            when v_token_match[1] = 'deep_link'
              then 'deep_link 변수는 새 템플릿에서 사용할 수 없어요. 링크를 제거해 주세요.'
            else '계약에 없는 변수를 제거해 주세요.'
          end
        )
      );
    end if;
  end loop;

  for v_variable in
    select available.item ->> 'key' as key
    from pg_catalog.jsonb_array_elements(
      v_contract -> 'availableVariables'
    ) available(item)
    join pg_catalog.jsonb_array_elements_text(
      v_contract -> 'requiredTokens'
    ) required(token)
      on required.token = available.item ->> 'token'
  loop
    if pg_catalog.strpos(v_combined, '{' || v_variable.key || '}') = 0 then
      v_violations := v_violations || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', 'notification_template_required_token_missing',
          'severity', 'error',
          'variable', v_variable.key,
          'message', '필수 정보를 알림 내용에 포함해 주세요.'
        )
      );
    end if;
  end loop;

  for v_variable in
    select available.item ->> 'key' as key
    from pg_catalog.jsonb_array_elements(
      v_contract -> 'availableVariables'
    ) available(item)
    join pg_catalog.jsonb_array_elements_text(
      v_contract -> 'optionalLineTokens'
    ) optional(token)
      on optional.token = available.item ->> 'token'
  loop
    if pg_catalog.strpos(v_combined, '{' || v_variable.key || '}') > 0
      and (
        pg_catalog.strpos(coalesce(p_title_template, ''), '{' || v_variable.key || '}') > 0
        or not exists (
          select 1
          from pg_catalog.regexp_split_to_table(
            coalesce(p_body_template, ''),
            chr(10)
          ) line(value)
          where pg_catalog.btrim(line.value) = '{' || v_variable.key || '}'
        )
      )
    then
      v_violations := v_violations || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', 'notification_template_optional_line_invalid',
          'severity', 'error',
          'variable', v_variable.key,
          'message', '선택 정보는 별도 줄에 배치해 주세요.'
        )
      );
    end if;
  end loop;

  if pg_catalog.strpos(v_combined, '[다음]') > 0
    or v_combined ~ '(확인하세요|처리하세요|입력하세요|연락하세요|해주세요|바랍니다)[.! ]*$'
  then
    v_violations := v_violations || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'code', 'notification_template_direct_imperative',
        'severity', 'warning',
        'message', '단체방에서는 특정인을 지시하지 않는 진행 상태 문장을 권장해요.'
      )
    );
  end if;

  return v_violations;
end;
$$;

create or replace function dashboard_private.notification_template_compliance_v1(
  p_rule_id uuid,
  p_template_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_template dashboard_private.notification_templates%rowtype;
  v_contract_version text;
  v_violations jsonb;
  v_compliance text;
begin
  select template_row.*
  into v_template
  from dashboard_private.notification_templates template_row
  where template_row.id = p_template_id
    and template_row.rule_id = p_rule_id;
  if not found then
    raise exception 'notification_template_not_found'
      using errcode = 'P0002';
  end if;
  select contract_row.contract_version
  into v_contract_version
  from dashboard_private.notification_rule_content_contracts contract_row
  where contract_row.rule_id = p_rule_id;
  if not found then
    raise exception 'notification_content_contract_not_found'
      using errcode = 'P0002';
  end if;

  v_violations := dashboard_private.notification_template_contract_violations_v1(
    p_rule_id,
    v_template.title_template,
    v_template.body_template
  );
  v_compliance := case
    when pg_catalog.jsonb_array_length(v_violations) = 0 then 'conformant'
    else 'legacy_custom_nonconformant'
  end;

  insert into dashboard_private.notification_template_compliance_audits(
    template_id,
    rule_id,
    contract_version,
    compliance,
    violations
  ) values (
    p_template_id,
    p_rule_id,
    v_contract_version,
    v_compliance,
    v_violations
  )
  on conflict do nothing;

  return pg_catalog.jsonb_build_object(
    'contract_version', v_contract_version,
    'compliance', v_compliance,
    'violations', v_violations
  );
end;
$$;

create or replace function dashboard_private.notification_template_compliance_audits_immutable()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception 'notification_template_compliance_audit_immutable'
    using errcode = '55000';
end;
$$;

create trigger notification_template_compliance_audits_immutable
before update or delete
on dashboard_private.notification_template_compliance_audits
for each row execute function
  dashboard_private.notification_template_compliance_audits_immutable();

create or replace function dashboard_private.notification_activation_lock_guard_v1()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
begin
  if old.enabled is distinct from new.enabled
    and exists (
      select 1
      from dashboard_private.notification_settings_ui_registry registry
      where registry.rule_id = old.id
        and registry.activation_locked
    )
  then
    raise exception 'notification_activation_locked' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger notification_rules_activation_lock_guard
before update of enabled
on dashboard_private.notification_rules
for each row execute function
  dashboard_private.notification_activation_lock_guard_v1();

select dashboard_private.notification_template_compliance_v1(
  template_row.rule_id,
  template_row.id
)
from dashboard_private.notification_templates template_row
join dashboard_private.notification_rule_content_contracts contract_row
  on contract_row.rule_id = template_row.rule_id
order by template_row.rule_id, template_row.version;

create or replace function public.save_notification_control_plane_v2(
  p_workflow_key text,
  p_expected_rule_revisions jsonb,
  p_expected_contract_versions jsonb,
  p_patch jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_request_kind constant text := 'notification_settings_save_v2';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_rules_patch jsonb;
  v_rule_id_text text;
  v_rule_id uuid;
  v_seen_rule_ids uuid[] := '{}'::uuid[];
  v_rule_patch jsonb;
  v_enabled boolean;
  v_event_key text;
  v_channel_key text;
  v_audience_key text;
  v_schedule_key text;
  v_schedule_config jsonb;
  v_revision bigint;
  v_activation_locked boolean;
  v_contract_version text;
  v_contract_json jsonb;
  v_active_template_id uuid;
  v_template_version bigint;
  v_title_template text;
  v_body_template text;
  v_payload_schema_version integer;
  v_next_enabled boolean;
  v_next_schedule_config jsonb;
  v_next_title_template text;
  v_next_body_template text;
  v_template_changed boolean;
  v_rule_changed boolean;
  v_new_template_id uuid;
  v_new_template_version bigint;
  v_new_checksum text;
  v_new_revision bigint;
  v_violations jsonb;
  v_error_codes text;
  v_changed_revisions jsonb := '{}'::jsonb;
  v_job_id uuid;
  v_response jsonb;
begin
  if v_actor is null or (v_role in ('admin', 'staff')) is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_workflow_key is null or p_workflow_key not in (
    'tasks',
    'word_retests',
    'registration',
    'transfer',
    'withdrawal',
    'makeup_requests',
    'approvals'
  ) then
    raise exception 'notification_workflow_unknown' using errcode = '22023';
  end if;
  if p_request_id is null
    or p_expected_rule_revisions is null
    or p_expected_contract_versions is null
    or p_patch is null
  then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', v_actor,
      'workflow_key', p_workflow_key,
      'expected_rule_revisions', p_expected_rule_revisions,
      'expected_contract_versions', p_expected_contract_versions,
      'patch', p_patch
    )::text
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );

  select
    ledger.request_kind,
    ledger.request_fingerprint,
    ledger.response_payload
  into v_ledger_kind, v_ledger_fingerprint, v_ledger_response
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  v_ledger_found := found;
  if v_ledger_found then
    if v_ledger_kind <> v_request_kind
      or v_ledger_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'notification-control-plane-workflow:' || p_workflow_key,
      0
    )
  );

  perform 1
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = 'notification_control_plane_settings_ui_enabled'
    and flag_row.enabled
  for share;
  if not found then
    raise exception 'notification_settings_ui_disabled' using errcode = '55000';
  end if;

  if pg_catalog.jsonb_typeof(p_expected_rule_revisions) <> 'object'
    or pg_catalog.jsonb_typeof(p_expected_contract_versions) <> 'object'
    or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or not (p_patch ? 'rules')
    or p_patch - 'rules' <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_patch -> 'rules') <> 'object'
  then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;
  v_rules_patch := p_patch -> 'rules';

  if exists (
    select 1
    from pg_catalog.jsonb_each(p_expected_rule_revisions) expected_entry(key, value)
    where pg_catalog.jsonb_typeof(expected_entry.value) <> 'string'
      or expected_entry.value #>> '{}' !~ '^[1-9][0-9]*$'
      or not (v_rules_patch ? expected_entry.key)
  ) or exists (
    select 1
    from pg_catalog.jsonb_each(p_expected_contract_versions) expected_entry(key, value)
    where pg_catalog.jsonb_typeof(expected_entry.value) <> 'string'
      or expected_entry.value #>> '{}' !~ '^[1-9][0-9]*$'
      or not (v_rules_patch ? expected_entry.key)
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    where not (p_expected_rule_revisions ? patch_key.value)
      or not (p_expected_contract_versions ? patch_key.value)
  ) then
    raise exception 'notification_patch_invalid' using errcode = '22023';
  end if;

  for v_rule_id_text in
    select patch_key.value
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    order by patch_key.value
  loop
    if v_rule_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'notification_rule_unknown' using errcode = '22023';
    end if;
    v_rule_id := v_rule_id_text::uuid;
    if v_rule_id::text <> v_rule_id_text
      or v_rule_id = any(v_seen_rule_ids)
    then
      raise exception 'notification_patch_invalid' using errcode = '22023';
    end if;
    v_seen_rule_ids := pg_catalog.array_append(v_seen_rule_ids, v_rule_id);
    v_rule_patch := v_rules_patch -> v_rule_id_text;
    if pg_catalog.jsonb_typeof(v_rule_patch) <> 'object'
      or v_rule_patch = '{}'::jsonb
      or v_rule_patch - array[
        'enabled',
        'title_template',
        'body_template',
        'schedule_config'
      ]::text[] <> '{}'::jsonb
      or (
        v_rule_patch ? 'enabled'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'enabled') <> 'boolean'
      )
      or (
        v_rule_patch ? 'title_template'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'title_template') <> 'string'
      )
      or (
        v_rule_patch ? 'body_template'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'body_template') <> 'string'
      )
      or (
        v_rule_patch ? 'schedule_config'
        and pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config')
          not in ('object', 'null')
      )
    then
      raise exception 'notification_patch_invalid' using errcode = '22023';
    end if;

    select
      rule_row.enabled,
      rule_row.event_key,
      rule_row.channel_key,
      rule_row.audience_key,
      rule_row.schedule_key,
      rule_row.schedule_config,
      rule_row.revision,
      registry_row.activation_locked,
      contract_row.contract_version,
      contract_row.contract_json
    into
      v_enabled,
      v_event_key,
      v_channel_key,
      v_audience_key,
      v_schedule_key,
      v_schedule_config,
      v_revision,
      v_activation_locked,
      v_contract_version,
      v_contract_json
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_settings_ui_registry registry_row
      on registry_row.rule_id = rule_row.id
     and registry_row.workflow_key = rule_row.workflow_key
     and registry_row.event_key = rule_row.event_key
     and registry_row.audience_key = rule_row.audience_key
     and registry_row.channel_key = rule_row.channel_key
     and registry_row.rule_variant_key = rule_row.rule_variant_key
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
     and contract_row.workflow_key = registry_row.workflow_key
     and contract_row.event_key = registry_row.event_key
     and contract_row.audience_key = registry_row.audience_key
     and contract_row.channel_key = registry_row.channel_key
     and contract_row.rule_variant_key = registry_row.rule_variant_key
    where rule_row.id = v_rule_id
      and rule_row.scope_key = 'global'
      and rule_row.workflow_key = p_workflow_key
    for update of rule_row, contract_row;
    if not found then
      raise exception 'notification_rule_not_in_registry'
        using errcode = '22023';
    end if;
    if v_revision::text <> p_expected_rule_revisions ->> v_rule_id_text then
      raise exception 'notification_revision_conflict' using errcode = '40001';
    end if;
    if v_contract_version
      <> p_expected_contract_versions ->> v_rule_id_text
    then
      raise exception 'notification_contract_version_conflict'
        using errcode = '40001';
    end if;
    if v_activation_locked and v_rule_patch ? 'enabled' then
      raise exception 'notification_activation_locked' using errcode = '55000';
    end if;

    if v_rule_patch ? 'schedule_config' then
      v_next_schedule_config := case
        when pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config') = 'null'
          then null
        else v_rule_patch -> 'schedule_config'
      end;
      if not dashboard_private.notification_schedule_config_valid_v1(
        p_workflow_key,
        v_event_key,
        v_schedule_key,
        v_next_schedule_config
      ) then
        raise exception 'notification_patch_invalid' using errcode = '22023';
      end if;
    end if;

    if not v_enabled
      and v_channel_key = 'google_chat'
      and v_rule_patch ? 'enabled'
      and (v_rule_patch ->> 'enabled')::boolean
    then
      perform 1
      from public.google_chat_webhook_settings connection_row
      where connection_row.channel = any(
        case v_audience_key
          when 'management_team' then array['admin']::text[]
          when 'executive_team' then array['executive']::text[]
          when 'subject_team' then array['english', 'math', 'science']::text[]
          else '{}'::text[]
        end
      )
      order by connection_row.channel
      for share of connection_row;
      if not dashboard_private.notification_google_chat_audience_ready_v1(
        v_audience_key
      ) then
        raise exception 'notification_google_chat_connection_required'
          using errcode = '55000';
      end if;
    end if;
  end loop;

  for v_rule_id_text in
    select patch_key.value
    from pg_catalog.jsonb_object_keys(v_rules_patch) patch_key(value)
    order by patch_key.value
  loop
    v_rule_id := v_rule_id_text::uuid;
    v_rule_patch := v_rules_patch -> v_rule_id_text;
    select
      rule_row.enabled,
      rule_row.event_key,
      rule_row.channel_key,
      rule_row.audience_key,
      rule_row.schedule_key,
      rule_row.schedule_config,
      rule_row.revision,
      rule_row.active_template_id,
      template_row.version,
      template_row.title_template,
      template_row.body_template,
      template_row.payload_schema_version,
      contract_row.contract_version,
      contract_row.contract_json
    into
      v_enabled,
      v_event_key,
      v_channel_key,
      v_audience_key,
      v_schedule_key,
      v_schedule_config,
      v_revision,
      v_active_template_id,
      v_template_version,
      v_title_template,
      v_body_template,
      v_payload_schema_version,
      v_contract_version,
      v_contract_json
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates template_row
      on template_row.rule_id = rule_row.id
     and template_row.id = rule_row.active_template_id
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
    where rule_row.id = v_rule_id;

    v_next_enabled := case
      when v_rule_patch ? 'enabled' then (v_rule_patch ->> 'enabled')::boolean
      else v_enabled
    end;
    v_next_title_template := case
      when v_rule_patch ? 'title_template' then v_rule_patch ->> 'title_template'
      else v_title_template
    end;
    v_next_body_template := case
      when v_rule_patch ? 'body_template' then v_rule_patch ->> 'body_template'
      else v_body_template
    end;
    v_next_schedule_config := case
      when not (v_rule_patch ? 'schedule_config') then v_schedule_config
      when pg_catalog.jsonb_typeof(v_rule_patch -> 'schedule_config') = 'null'
        then null
      else v_rule_patch -> 'schedule_config'
    end;

    if not dashboard_private.notification_schedule_config_valid_v1(
      p_workflow_key,
      v_event_key,
      v_schedule_key,
      v_next_schedule_config
    ) or not (
      v_contract_json -> 'supportedPayloadVersions'
      @> pg_catalog.jsonb_build_array(v_payload_schema_version)
    ) then
      raise exception 'notification_patch_invalid' using errcode = '22023';
    end if;

    v_violations := dashboard_private.notification_template_contract_violations_v1(
      v_rule_id,
      v_next_title_template,
      v_next_body_template
    );
    select pg_catalog.string_agg(violation.item ->> 'code', ',' order by violation.ordinal)
    into v_error_codes
    from pg_catalog.jsonb_array_elements(v_violations)
      with ordinality violation(item, ordinal)
    where violation.item ->> 'severity' = 'error';
    if v_error_codes is not null then
      raise exception 'notification_template_contract_invalid:%', v_error_codes
        using errcode = '22023';
    end if;

    v_template_changed := v_next_title_template is distinct from v_title_template
      or v_next_body_template is distinct from v_body_template;
    v_rule_changed := v_template_changed
      or v_next_enabled is distinct from v_enabled
      or v_next_schedule_config is distinct from v_schedule_config;
    if not v_rule_changed then
      continue;
    end if;

    v_new_template_id := v_active_template_id;
    v_new_template_version := v_template_version;
    if v_template_changed then
      select coalesce(pg_catalog.max(template_row.version), 0) + 1
      into v_new_template_version
      from dashboard_private.notification_templates template_row
      where template_row.rule_id = v_rule_id;
      v_new_template_id := pg_catalog.gen_random_uuid();
      v_new_checksum := dashboard_private.notification_seed_template_checksum_v1(
        v_next_title_template,
        v_next_body_template,
        v_contract_json -> 'availableVariables',
        v_payload_schema_version
      );
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
      ) values (
        v_new_template_id,
        v_rule_id,
        v_new_template_version,
        v_next_title_template,
        v_next_body_template,
        v_contract_json -> 'availableVariables',
        v_payload_schema_version,
        v_new_checksum,
        v_actor,
        'user',
        v_contract_version
      );
    end if;

    update dashboard_private.notification_rules rule_row
    set enabled = v_next_enabled,
        schedule_config = v_next_schedule_config,
        active_template_id = v_new_template_id,
        revision = rule_row.revision + 1,
        updated_by = v_actor,
        updated_actor_kind = 'user',
        updated_at = pg_catalog.clock_timestamp()
    where rule_row.id = v_rule_id
    returning rule_row.revision into v_new_revision;

    if v_template_changed then
      perform dashboard_private.notification_template_compliance_v1(
        v_rule_id,
        v_new_template_id
      );
    end if;

    insert into dashboard_private.notification_audit_logs(
      entity_kind,
      entity_id,
      action,
      actor_profile_id,
      actor_kind,
      request_id,
      before_summary,
      after_summary,
      reason_code
    ) values (
      'notification_rule',
      v_rule_id::text,
      'settings_updated',
      v_actor,
      'user',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'enabled', v_enabled,
        'revision', v_revision::text,
        'active_template_id', v_active_template_id,
        'template_version', v_template_version::text,
        'schedule_config', v_schedule_config,
        'content_contract_version', v_contract_version
      ),
      pg_catalog.jsonb_build_object(
        'enabled', v_next_enabled,
        'revision', v_new_revision::text,
        'active_template_id', v_new_template_id,
        'template_version', v_new_template_version::text,
        'schedule_config', v_next_schedule_config,
        'content_contract_version', v_contract_version
      ),
      'operator_settings_save_v2'
    );
    v_changed_revisions := v_changed_revisions || pg_catalog.jsonb_build_object(
      v_rule_id::text,
      v_new_revision::text
    );
  end loop;

  if v_changed_revisions <> '{}'::jsonb then
    insert into dashboard_private.notification_rule_reconciliation_jobs(
      workflow_key,
      rule_revision_map
    ) values (
      p_workflow_key,
      v_changed_revisions
    )
    returning id into v_job_id;
  end if;

  v_response := dashboard_private.notification_control_plane_snapshot_v1(
    p_workflow_key,
    v_role = 'admin'
  );
  if v_job_id is not null then
    v_response := v_response || pg_catalog.jsonb_build_object(
      'reconciliation_job', pg_catalog.jsonb_build_object(
        'job_kind', 'rule_reconciliation',
        'job_id', v_job_id,
        'status', 'pending',
        'attempt_count', 0
      )
    );
  end if;

  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    p_request_id,
    v_request_kind,
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function public.save_notification_control_plane_with_override_v2(
  p_workflow_key text,
  p_expected_rule_revisions jsonb,
  p_expected_contract_versions jsonb,
  p_patch jsonb,
  p_save_request_id uuid,
  p_override_request_id uuid,
  p_conflicting_fields jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_dashboard_role();
  v_request_kind constant text := 'notification_revision_conflict_override_v2';
  v_fingerprint text;
  v_ledger_kind text;
  v_ledger_fingerprint text;
  v_ledger_response jsonb;
  v_ledger_found boolean := false;
  v_conflicting_fields jsonb;
  v_conflicting_field text;
  v_conflicting_field_parts text[];
  v_rule_id_text text;
  v_rule_id uuid;
  v_patch_field text;
  v_conflicting_field_count bigint;
  v_distinct_conflicting_field_count bigint;
  v_response jsonb;
begin
  if v_actor is null or (v_role in ('admin', 'staff')) is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_workflow_key is null or p_workflow_key not in (
    'tasks',
    'word_retests',
    'registration',
    'transfer',
    'withdrawal',
    'makeup_requests',
    'approvals'
  ) then
    raise exception 'notification_workflow_unknown' using errcode = '22023';
  end if;
  if p_save_request_id is null
    or p_override_request_id is null
    or p_save_request_id = p_override_request_id
    or p_expected_rule_revisions is null
    or p_expected_contract_versions is null
    or p_patch is null
    or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or not (p_patch ? 'rules')
    or p_patch - 'rules' <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_patch -> 'rules') <> 'object'
    or p_conflicting_fields is null
    or pg_catalog.jsonb_typeof(p_conflicting_fields) <> 'array'
    or pg_catalog.jsonb_array_length(p_conflicting_fields) = 0
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_conflicting_fields) conflict(value)
      where pg_catalog.jsonb_typeof(conflict.value) <> 'string'
    )
  then
    raise exception 'notification_conflict_override_invalid'
      using errcode = '22023';
  end if;

  select
    pg_catalog.jsonb_agg(conflict.value order by conflict.value),
    pg_catalog.count(*),
    pg_catalog.count(distinct conflict.value)
  into
    v_conflicting_fields,
    v_conflicting_field_count,
    v_distinct_conflicting_field_count
  from pg_catalog.jsonb_array_elements_text(
    p_conflicting_fields
  ) conflict(value);
  if v_conflicting_field_count <> v_distinct_conflicting_field_count then
    raise exception 'notification_conflict_override_invalid'
      using errcode = '22023';
  end if;

  for v_conflicting_field in
    select conflict.value
    from pg_catalog.jsonb_array_elements_text(
      v_conflicting_fields
    ) conflict(value)
    order by conflict.value
  loop
    v_conflicting_field_parts := pg_catalog.regexp_match(
      v_conflicting_field,
      E'^rules\\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.(enabled|scheduleConfig|titleTemplate|bodyTemplate)$'
    );
    if v_conflicting_field_parts is null then
      raise exception 'notification_conflict_override_invalid'
        using errcode = '22023';
    end if;
    v_rule_id_text := v_conflicting_field_parts[1];
    v_rule_id := v_rule_id_text::uuid;
    if v_rule_id::text <> v_rule_id_text then
      raise exception 'notification_conflict_override_invalid'
        using errcode = '22023';
    end if;

    perform 1
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_settings_ui_registry registry_row
      on registry_row.rule_id = rule_row.id
     and registry_row.workflow_key = rule_row.workflow_key
     and registry_row.event_key = rule_row.event_key
     and registry_row.audience_key = rule_row.audience_key
     and registry_row.channel_key = rule_row.channel_key
     and registry_row.rule_variant_key = rule_row.rule_variant_key
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
    where rule_row.id = v_rule_id
      and rule_row.scope_key = 'global'
      and rule_row.workflow_key = p_workflow_key;
    if not found then
      raise exception 'notification_rule_not_in_registry'
        using errcode = '22023';
    end if;

    v_patch_field := case v_conflicting_field_parts[2]
      when 'enabled' then 'enabled'
      when 'scheduleConfig' then 'schedule_config'
      when 'titleTemplate' then 'title_template'
      when 'bodyTemplate' then 'body_template'
      else null
    end;
    if not (p_patch -> 'rules' ? v_rule_id_text)
      or pg_catalog.jsonb_typeof(
        p_patch -> 'rules' -> v_rule_id_text
      ) <> 'object'
      or not (p_patch -> 'rules' -> v_rule_id_text ? v_patch_field)
    then
      raise exception 'notification_conflict_override_invalid'
        using errcode = '22023';
    end if;
  end loop;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'actor_id', v_actor,
      'workflow_key', p_workflow_key,
      'expected_rule_revisions', p_expected_rule_revisions,
      'expected_contract_versions', p_expected_contract_versions,
      'patch', p_patch,
      'save_request_id', p_save_request_id,
      'conflicting_fields', v_conflicting_fields
    )::text
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'notification-request:' || p_override_request_id::text,
      0
    )
  );

  select
    ledger.request_kind,
    ledger.request_fingerprint,
    ledger.response_payload
  into v_ledger_kind, v_ledger_fingerprint, v_ledger_response
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_override_request_id;
  v_ledger_found := found;
  if v_ledger_found then
    if v_ledger_kind <> v_request_kind
      or v_ledger_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger_response;
  end if;

  v_response := public.save_notification_control_plane_v2(
    p_workflow_key,
    p_expected_rule_revisions,
    p_expected_contract_versions,
    p_patch,
    p_save_request_id
  );

  insert into dashboard_private.notification_audit_logs(
    entity_kind,
    entity_id,
    action,
    actor_profile_id,
    actor_kind,
    request_id,
    before_summary,
    after_summary,
    reason_code
  ) values (
    'notification_workflow',
    p_workflow_key,
    'revision_conflict_overridden',
    v_actor,
    'user',
    p_override_request_id,
    null,
    pg_catalog.jsonb_build_object(
      'conflicting_fields', v_conflicting_fields,
      'save_request_id', p_save_request_id,
      'expected_contract_versions', p_expected_contract_versions
    ),
    'operator_revision_conflict_override_v2'
  );

  insert into dashboard_private.notification_request_ledger(
    request_id,
    request_kind,
    request_fingerprint,
    response_payload
  ) values (
    p_override_request_id,
    v_request_kind,
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.notification_control_plane_snapshot_v1(
  p_workflow_key text,
  p_editable boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'scope_key', 'global',
    'workflow_key', p_workflow_key,
    'rules', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', rule_row.id,
            'workflow_key', rule_row.workflow_key,
            'event_key', rule_row.event_key,
            'event_label', registry_row.event_label,
            'group_label', registry_row.group_label,
            'trigger_description', registry_row.trigger_description,
            'sort_order', registry_row.event_sort * 100 + registry_row.cell_sort,
            'audience_key', rule_row.audience_key,
            'audience_label', registry_row.audience_label,
            'channel_key', rule_row.channel_key,
            'channel_label', registry_row.channel_label,
            'connection_key', case
              when rule_row.channel_key <> 'google_chat' then null
              when rule_row.audience_key = 'management_team'
                then 'google_chat.management'
              when rule_row.audience_key = 'executive_team'
                then 'google_chat.executive'
              else null
            end,
            'rule_variant_key', rule_row.rule_variant_key,
            'delivery_mode', rule_row.delivery_mode,
            'schedule_key', rule_row.schedule_key,
            'schedule_config', rule_row.schedule_config,
            'enabled', rule_row.enabled,
            'active_template_id', rule_row.active_template_id,
            'revision', rule_row.revision::text,
            'updated_at', rule_row.updated_at,
            'configuration_kind', registry_row.configuration_kind,
            'activation_locked', registry_row.activation_locked,
            'content_contract', contract_row.contract_json,
            'template_compliance', pg_catalog.jsonb_build_object(
              'contract_version', contract_row.contract_version,
              'compliance', compliance_row.compliance,
              'violations', coalesce(compliance_row.violations, '[]'::jsonb)
            ),
            'template', pg_catalog.jsonb_build_object(
              'id', template_row.id,
              'rule_id', template_row.rule_id,
              'version', template_row.version::text,
              'title_template', template_row.title_template,
              'body_template', template_row.body_template,
              'allowed_variables', template_row.allowed_variables,
              'payload_schema_version', template_row.payload_schema_version,
              'content_contract_version', template_row.content_contract_version,
              'checksum', template_row.checksum
            )
          )
          order by
            registry_row.event_sort,
            registry_row.cell_sort,
            rule_row.id
        )
        from dashboard_private.notification_settings_ui_registry registry_row
        join dashboard_private.notification_rules rule_row
          on rule_row.id = registry_row.rule_id
         and rule_row.scope_key = 'global'
         and rule_row.workflow_key = registry_row.workflow_key
         and rule_row.event_key = registry_row.event_key
         and rule_row.audience_key = registry_row.audience_key
         and rule_row.channel_key = registry_row.channel_key
         and rule_row.rule_variant_key = registry_row.rule_variant_key
        join dashboard_private.notification_templates template_row
          on template_row.rule_id = rule_row.id
         and template_row.id = rule_row.active_template_id
        join dashboard_private.notification_rule_content_contracts contract_row
          on contract_row.rule_id = rule_row.id
         and contract_row.workflow_key = registry_row.workflow_key
         and contract_row.event_key = registry_row.event_key
         and contract_row.audience_key = registry_row.audience_key
         and contract_row.channel_key = registry_row.channel_key
         and contract_row.rule_variant_key = registry_row.rule_variant_key
        left join dashboard_private.notification_template_compliance_audits compliance_row
          on compliance_row.template_id = template_row.id
         and compliance_row.contract_version = contract_row.contract_version
        where registry_row.workflow_key = p_workflow_key
      ),
      '[]'::jsonb
    ),
    'connections', (
      with connection_catalog(sort_order, channel, connection_key) as (
        values
          (1, 'admin'::text, 'google_chat.management'::text),
          (2, 'executive'::text, 'google_chat.executive'::text),
          (3, 'english'::text, 'google_chat.english'::text),
          (4, 'math'::text, 'google_chat.math'::text),
          (5, 'science'::text, 'google_chat.science'::text)
      )
      select pg_catalog.jsonb_agg(
        case
          when connection_row.channel is not null then
            dashboard_private.notification_connection_safe_json_v1(
              connection_row,
              p_editable
            )
          else pg_catalog.jsonb_build_object(
            'connection_key', catalog_row.connection_key,
            'connection_state', 'disconnected',
            'revision', '0',
            'configured', false,
            'webhook_url_mask', null,
            'last_verified_at', null,
            'last_error_code', null,
            'editable', coalesce(p_editable, false)
          )
        end
        order by catalog_row.sort_order
      )
      from connection_catalog catalog_row
      left join public.google_chat_webhook_settings connection_row
        on connection_row.channel = catalog_row.channel
    ),
    'delivery_summary', (
      with canonical_ranked as (
        select
          event_row.workflow_key,
          event_row.occurrence_key,
          delivery_row.rule_id,
          delivery_row.channel_key,
          delivery_row.target_key,
          delivery_row.target_generation,
          delivery_row.status as projected_status,
          delivery_row.updated_at as evidence_updated_at,
          pg_catalog.row_number() over (
            partition by
              event_row.workflow_key,
              event_row.occurrence_key,
              delivery_row.rule_id,
              delivery_row.channel_key,
              delivery_row.target_key,
              delivery_row.target_generation
            order by delivery_row.updated_at desc, delivery_row.id desc
          ) as identity_rank
        from dashboard_private.notification_deliveries delivery_row
        join dashboard_private.notification_events event_row
          on event_row.id = delivery_row.event_id
        left join dashboard_private.notification_dispatch_ownership_claims ownership_row
          on ownership_row.workflow_key = event_row.workflow_key
         and ownership_row.occurrence_key = event_row.occurrence_key
         and ownership_row.rule_id = delivery_row.rule_id
         and ownership_row.channel_key = delivery_row.channel_key
         and ownership_row.target_key = delivery_row.target_key
         and ownership_row.target_generation = delivery_row.target_generation
        where event_row.scope_key = 'global'
          and event_row.workflow_key = p_workflow_key
          and ownership_row.owner_kind is distinct from 'legacy'
      ),
      projected_evidence as (
        select
          canonical_row.projected_status,
          canonical_row.evidence_updated_at
        from canonical_ranked canonical_row
        where canonical_row.identity_rank = 1

        union all

        select
          case
            when ownership_row.terminal_outcome = 'sent' then 'sent'
            when ownership_row.terminal_outcome = 'failed' then 'failed'
            when ownership_row.terminal_outcome = 'delivery_unknown'
              then 'delivery_unknown'
            when ownership_row.state = 'reserved' then 'pending'
            else 'delivery_unknown'
          end as projected_status,
          ownership_row.updated_at as evidence_updated_at
        from dashboard_private.notification_dispatch_ownership_claims ownership_row
        where ownership_row.workflow_key = p_workflow_key
          and ownership_row.owner_kind = 'legacy'
      )
      select pg_catalog.jsonb_build_object(
        'pending_count', pg_catalog.count(*) filter (
          where evidence_row.projected_status in (
            'pending', 'claimed', 'sending', 'retry_wait'
          )
        ),
        'sent_count', pg_catalog.count(*) filter (
          where evidence_row.projected_status = 'sent'
        ),
        'failed_count', pg_catalog.count(*) filter (
          where evidence_row.projected_status = 'failed'
        ),
        'unknown_count', pg_catalog.count(*) filter (
          where evidence_row.projected_status = 'delivery_unknown'
        ),
        'latest_delivery_at', pg_catalog.max(evidence_row.evidence_updated_at)
      )
      from projected_evidence evidence_row
    ),
    'loaded_at', pg_catalog.statement_timestamp()
  );
$$;

-- The contracts registry foreign key is intentionally deferred while its
-- canonical rows are seeded above. Flush those events before ownership DDL.
set constraints all immediate;

alter table dashboard_private.notification_rule_content_contracts owner to postgres;
alter table dashboard_private.notification_template_compliance_audits owner to postgres;

alter function dashboard_private.notification_content_event_spec_v1(text)
  owner to postgres;
alter function dashboard_private.notification_content_variable_v1(text)
  owner to postgres;
alter function dashboard_private.notification_content_contract_for_identity_v1(text, text, text)
  owner to postgres;
alter function dashboard_private.notification_content_contract_for_rule_v1(uuid)
  owner to postgres;
alter function dashboard_private.notification_template_contract_violations_v1(uuid, text, text)
  owner to postgres;
alter function dashboard_private.notification_template_compliance_v1(uuid, uuid)
  owner to postgres;
alter function dashboard_private.notification_template_compliance_audits_immutable()
  owner to postgres;
alter function dashboard_private.notification_activation_lock_guard_v1()
  owner to postgres;
alter function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  owner to postgres;
alter function public.save_notification_control_plane_v2(text, jsonb, jsonb, jsonb, uuid)
  owner to postgres;
alter function public.save_notification_control_plane_with_override_v2(
  text,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  jsonb
) owner to postgres;

revoke all on function dashboard_private.notification_content_event_spec_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_content_variable_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_content_contract_for_identity_v1(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_content_contract_for_rule_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_template_contract_violations_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_template_compliance_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_template_compliance_audits_immutable()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_activation_lock_guard_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.save_notification_control_plane_v2(
  text, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.save_notification_control_plane_with_override_v2(
  text, jsonb, jsonb, jsonb, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.save_notification_control_plane_v2(
  text, jsonb, jsonb, jsonb, uuid
) to authenticated;
grant execute on function public.save_notification_control_plane_with_override_v2(
  text, jsonb, jsonb, jsonb, uuid, uuid, jsonb
) to authenticated;

commit;
