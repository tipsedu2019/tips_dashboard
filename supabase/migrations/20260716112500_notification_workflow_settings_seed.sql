begin;

set local lock_timeout = '5s';

create table if not exists dashboard_private.notification_settings_ui_registry (
  rule_id uuid not null unique,
  workflow_key text not null,
  workflow_label text not null,
  workflow_sort integer not null,
  event_key text not null,
  event_label text not null,
  group_label text not null,
  trigger_description text not null,
  event_sort integer not null,
  audience_key text not null,
  audience_label text not null,
  channel_key text not null,
  channel_label text not null,
  cell_sort integer not null,
  rule_variant_key text not null default 'immediate',
  delivery_mode text not null default 'immediate',
  schedule_key text,
  schedule_config jsonb,
  initial_enabled boolean not null,
  source_trigger_kind text,
  created_at timestamptz not null default now(),
  primary key (
    workflow_key,
    event_key,
    audience_key,
    channel_key,
    rule_variant_key
  ),
  constraint notification_settings_ui_registry_workflow_check
    check (workflow_key in (
      'tasks',
      'word_retests',
      'registration',
      'transfer',
      'withdrawal',
      'makeup_requests',
      'approvals'
    )),
  constraint notification_settings_ui_registry_label_check
    check (
      nullif(btrim(workflow_label), '') is not null
      and nullif(btrim(event_label), '') is not null
      and nullif(btrim(group_label), '') is not null
      and nullif(btrim(trigger_description), '') is not null
      and nullif(btrim(audience_label), '') is not null
      and nullif(btrim(channel_label), '') is not null
    ),
  constraint notification_settings_ui_registry_sort_check
    check (workflow_sort > 0 and event_sort > 0 and cell_sort > 0),
  constraint notification_settings_ui_registry_immediate_check
    check (
      delivery_mode = 'immediate'
      and rule_variant_key = 'immediate'
      and schedule_key is null
      and schedule_config is null
    )
);

create table if not exists dashboard_private.notification_settings_import_metadata (
  source_key text primary key,
  source_table text not null,
  source_revision text not null,
  source_checksum text not null,
  workflow_key text not null,
  event_key text,
  mapped_rule_ids jsonb not null,
  import_state text not null,
  inactive_reason text,
  source_snapshot jsonb not null,
  imported_at timestamptz not null default now(),
  constraint notification_settings_import_checksum_check
    check (source_checksum ~ '^[0-9a-f]{64}$'),
  constraint notification_settings_import_rules_check
    check (jsonb_typeof(mapped_rule_ids) = 'array'),
  constraint notification_settings_import_state_check
    check (
      (import_state = 'active' and inactive_reason is null)
      or (
        import_state = 'inactive'
        and inactive_reason = 'inactive_not_used_by_legacy_sender'
      )
    ),
  constraint notification_settings_import_snapshot_check
    check (jsonb_typeof(source_snapshot) = 'object')
);

alter table dashboard_private.notification_settings_ui_registry enable row level security;
alter table dashboard_private.notification_settings_import_metadata enable row level security;

revoke all on table dashboard_private.notification_settings_ui_registry
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_settings_import_metadata
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.notification_deterministic_uuid_v1(
  p_namespace text,
  p_key text
)
returns uuid
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  with digest as (
    select pg_catalog.md5(p_namespace || ':' || p_key) as value
  )
  select (
    pg_catalog.substr(value, 1, 8) || '-'
    || pg_catalog.substr(value, 9, 4) || '-5'
    || pg_catalog.substr(value, 14, 3) || '-8'
    || pg_catalog.substr(value, 18, 3) || '-'
    || pg_catalog.substr(value, 21, 12)
  )::uuid
  from digest;
$$;

create or replace function dashboard_private.notification_seed_template_checksum_v1(
  p_title_template text,
  p_body_template text,
  p_allowed_variables jsonb,
  p_payload_schema_version integer
)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'title_template', p_title_template,
          'body_template', p_body_template,
          'allowed_variables', p_allowed_variables,
          'payload_schema_version', p_payload_schema_version
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );
$$;

with
workflow_catalog(workflow_key, workflow_label, workflow_sort) as (
  values
    ('tasks', '할 일', 1),
    ('word_retests', '영어 단어 재시험', 2),
    ('registration', '등록', 3),
    ('transfer', '전반', 4),
    ('withdrawal', '퇴원', 5),
    ('makeup_requests', '휴보강', 6),
    ('approvals', '전자결재', 7)
),
event_catalog(
  workflow_key,
  event_key,
  event_label,
  group_label,
  trigger_description,
  event_sort,
  cell_set
) as (
  values
    ('tasks', 'task.created', '할 일 생성', '할 일', '새 할 일이 저장되었을 때', 1, 'TASK'),
    ('tasks', 'task.assignee_changed', '담당 변경', '할 일', '주 담당자 또는 보조 담당자가 변경되었을 때', 2, 'TASK'),
    ('tasks', 'task.due_changed', '일정 변경', '할 일', '시작일 또는 마감일이 변경되었을 때', 3, 'TASK'),
    ('tasks', 'task.status_changed', '상태 변경', '할 일', '진행 상태가 변경되었을 때', 4, 'TASK'),
    ('tasks', 'task.completed', '완료', '할 일', '할 일이 완료되었을 때', 5, 'TASK'),
    ('tasks', 'task.canceled', '취소', '할 일', '할 일이 취소되었을 때', 6, 'TASK'),
    ('tasks', 'task.reopened', '재개', '할 일', '완료하거나 취소한 할 일을 다시 열었을 때', 7, 'TASK'),
    ('tasks', 'task.comment_added', '댓글', '할 일', '새 댓글이 등록되었을 때', 8, 'TASK'),

    ('word_retests', 'word_retest.created', '재시험 생성', '영어 단어 재시험', '영어 단어 재시험이 생성되었을 때', 1, 'WORD'),
    ('word_retests', 'word_retest.assigned', '배정', '영어 단어 재시험', '담당 조교 또는 보조 담당자가 배정되었을 때', 2, 'WORD'),
    ('word_retests', 'word_retest.schedule_changed', '본시험일 변경', '영어 단어 재시험', '본시험일 또는 일정이 변경되었을 때', 3, 'WORD'),
    ('word_retests', 'word_retest.started', '시작', '영어 단어 재시험', '재시험 처리가 시작되었을 때', 4, 'WORD'),
    ('word_retests', 'word_retest.result_reported', '결과 보고', '영어 단어 재시험', '재시험 결과가 보고되었을 때', 5, 'WORD'),
    ('word_retests', 'word_retest.absent_reported', '미응시 보고', '영어 단어 재시험', '미응시 결과가 보고되었을 때', 6, 'WORD'),
    ('word_retests', 'word_retest.revision_requested', '수정 요청', '영어 단어 재시험', '결과 수정이 요청되었을 때', 7, 'WORD'),
    ('word_retests', 'word_retest.retry_created', '재시험 재생성', '영어 단어 재시험', '후속 재시험이 생성되었을 때', 8, 'WORD'),
    ('word_retests', 'word_retest.completed', '완료', '영어 단어 재시험', '재시험 업무가 완료되었을 때', 9, 'WORD'),
    ('word_retests', 'word_retest.canceled', '취소', '영어 단어 재시험', '재시험 업무가 취소되었을 때', 10, 'WORD'),

    ('registration', 'registration.case_created', '문의 접수', '등록 진행', '새 등록 문의가 접수되었을 때', 1, 'MGMT_CHAT'),
    ('registration', 'registration.registration_completed', '등록 완료', '등록 진행', '등록 처리가 완료되었을 때', 2, 'MGMT_CHAT'),
    ('registration', 'registration.case_closed', '문의 종료', '등록 진행', '등록 없이 문의가 종료되었을 때', 3, 'MGMT_CHAT'),

    ('transfer', 'transfer.submitted', '제출', '전반 진행', '전반 신청이 제출되었을 때', 1, 'MGMT_CHAT'),
    ('transfer', 'transfer.completed', '완료', '전반 진행', '전반 처리가 완료되었을 때', 2, 'MGMT_CHAT'),
    ('withdrawal', 'withdrawal.submitted', '제출', '퇴원 진행', '퇴원 신청이 제출되었을 때', 1, 'MGMT_CHAT'),
    ('withdrawal', 'withdrawal.completed', '완료', '퇴원 진행', '퇴원 처리가 완료되었을 때', 2, 'MGMT_CHAT'),

    ('approvals', 'approval.created', '생성', '전자결재', '전자결재 문서가 생성되었을 때', 1, 'APPROVAL'),
    ('approvals', 'approval.submitted', '제출', '전자결재', '전자결재 문서가 제출되었을 때', 2, 'APPROVAL'),
    ('approvals', 'approval.review_started', '검토 시작', '전자결재', '결재 검토가 시작되었을 때', 3, 'APPROVAL'),
    ('approvals', 'approval.approver_changed', '결재자 변경', '전자결재', '현재 결재자가 변경되었을 때', 4, 'APPROVAL'),
    ('approvals', 'approval.approved', '승인', '전자결재', '전자결재가 승인되었을 때', 5, 'APPROVAL'),
    ('approvals', 'approval.returned', '반려', '전자결재', '전자결재가 반려되었을 때', 6, 'APPROVAL'),
    ('approvals', 'approval.canceled', '취소', '전자결재', '전자결재가 취소되었을 때', 7, 'APPROVAL'),
    ('approvals', 'approval.resubmitted', '재상신', '전자결재', '전자결재가 다시 제출되었을 때', 8, 'APPROVAL'),
    ('approvals', 'approval.comment_added', '댓글', '전자결재', '전자결재에 새 댓글이 등록되었을 때', 9, 'APPROVAL')
),
cell_catalog(
  cell_set,
  audience_key,
  audience_label,
  channel_key,
  channel_label,
  cell_sort
) as (
  values
    ('TASK', 'requester_profile', '요청자', 'in_app', '대시보드', 1),
    ('TASK', 'primary_assignee', '주 담당자', 'in_app', '대시보드', 2),
    ('TASK', 'secondary_assignee', '보조 담당자', 'in_app', '대시보드', 3),
    ('TASK', 'management_team', '관리팀', 'in_app', '대시보드', 4),
    ('TASK', 'management_team', '구글챗 · 관리팀', 'google_chat', '구글챗', 5),
    ('WORD', 'requesting_teacher', '요청 선생님', 'in_app', '대시보드', 1),
    ('WORD', 'assigned_assistant', '담당 조교', 'in_app', '대시보드', 2),
    ('WORD', 'secondary_assignee', '보조 담당자', 'in_app', '대시보드', 3),
    ('WORD', 'management_team', '관리팀', 'in_app', '대시보드', 4),
    ('WORD', 'management_team', '구글챗 · 관리팀', 'google_chat', '구글챗', 5),
    ('APPROVAL', 'requester_profile', '요청자', 'in_app', '대시보드', 1),
    ('APPROVAL', 'approver_profile', '결재자', 'in_app', '대시보드', 2),
    ('APPROVAL', 'management_team', '관리팀', 'in_app', '대시보드', 3),
    ('APPROVAL', 'management_team', '구글챗 · 관리팀', 'google_chat', '구글챗', 4),
    ('MGMT_CHAT', 'management_team', '구글챗 · 관리팀', 'google_chat', '구글챗', 1)
),
fixed_registry as (
  select
    workflow_catalog.workflow_key,
    workflow_catalog.workflow_label,
    workflow_catalog.workflow_sort,
    event_catalog.event_key,
    event_catalog.event_label,
    event_catalog.group_label,
    event_catalog.trigger_description,
    event_catalog.event_sort,
    cell_catalog.audience_key,
    cell_catalog.audience_label,
    cell_catalog.channel_key,
    cell_catalog.channel_label,
    cell_catalog.cell_sort,
    case
      when event_catalog.workflow_key in ('tasks', 'word_retests', 'approvals')
        then false
      else true
    end as enabled
  from event_catalog
  join workflow_catalog using (workflow_key)
  join cell_catalog using (cell_set)
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
  initial_enabled
)
select
  dashboard_private.notification_deterministic_uuid_v1(
    'notification-rule-v1',
    pg_catalog.concat_ws(
      '|',
      'global',
      fixed_registry.workflow_key,
      fixed_registry.event_key,
      fixed_registry.audience_key,
      fixed_registry.channel_key,
      'immediate'
    )
  ),
  fixed_registry.workflow_key,
  fixed_registry.workflow_label,
  fixed_registry.workflow_sort,
  fixed_registry.event_key,
  fixed_registry.event_label,
  fixed_registry.group_label,
  fixed_registry.trigger_description,
  fixed_registry.event_sort,
  fixed_registry.audience_key,
  fixed_registry.audience_label,
  fixed_registry.channel_key,
  fixed_registry.channel_label,
  fixed_registry.cell_sort,
  'immediate',
  'immediate',
  fixed_registry.enabled
from fixed_registry
on conflict do nothing;

with
makeup_event_catalog(
  trigger_kind,
  event_key,
  event_label,
  trigger_description,
  event_sort,
  event_family
) as (
  values
    ('submitted', 'makeup.submitted', '신청 제출', '휴보강 신청이 제출되었을 때', 1, 'request'),
    ('refund_requested', 'makeup.refund_requested', '환불 신청', '휴보강 환불이 신청되었을 때', 2, 'request'),
    ('approved', 'makeup.approved', '결재 승인', '휴보강 신청이 승인되었을 때', 3, 'result'),
    ('completed', 'makeup.refund_completed', '환불 완료', '휴보강 환불 처리가 완료되었을 때', 4, 'result'),
    ('canceled', 'makeup.approval_canceled', '승인 취소', '휴보강 승인이 취소되었을 때', 5, 'result'),
    ('returned', 'makeup.revision_requested', '보완 요청', '휴보강 신청 보완이 요청되었을 때', 6, 'review'),
    ('rejected', 'makeup.rejected', '반려', '휴보강 신청이 반려되었을 때', 7, 'review')
),
makeup_cell_sources(
  event_family,
  source_channel,
  audience_key,
  audience_label,
  channel_key,
  channel_label,
  cell_sort
) as (
  values
    ('request', 'dashboard_personal', 'approver_profile', '결재자', 'in_app', '대시보드', 1),
    ('request', 'dashboard_management', 'management_team', '관리팀', 'in_app', '대시보드', 2),
    ('request', 'google_chat_executive', 'executive_team', '경영팀', 'google_chat', '구글챗', 3),
    ('request', 'google_chat_admin', 'management_team', '구글챗 · 관리팀', 'google_chat', '구글챗', 4),
    ('request', 'google_chat_english', 'subject_team', '과목팀', 'google_chat', '구글챗', 5),
    ('request', 'google_chat_math', 'subject_team', '과목팀', 'google_chat', '구글챗', 5),
    ('result', 'dashboard_personal', 'requester_profile', '요청자', 'in_app', '대시보드', 1),
    ('result', 'dashboard_personal', 'approver_profile', '결재자', 'in_app', '대시보드', 2),
    ('result', 'dashboard_management', 'management_team', '관리팀', 'in_app', '대시보드', 3),
    ('result', 'google_chat_executive', 'executive_team', '경영팀', 'google_chat', '구글챗', 4),
    ('result', 'google_chat_admin', 'management_team', '구글챗 · 관리팀', 'google_chat', '구글챗', 5),
    ('result', 'google_chat_english', 'subject_team', '과목팀', 'google_chat', '구글챗', 6),
    ('result', 'google_chat_math', 'subject_team', '과목팀', 'google_chat', '구글챗', 6),
    ('review', 'dashboard_personal', 'requester_profile', '요청자', 'in_app', '대시보드', 1),
    ('review', 'google_chat_english', 'subject_team', '과목팀', 'google_chat', '구글챗', 2),
    ('review', 'google_chat_math', 'subject_team', '과목팀', 'google_chat', '구글챗', 2)
),
makeup_registry_candidates as (
  select
    event_catalog.trigger_kind,
    event_catalog.event_key,
    event_catalog.event_label,
    event_catalog.trigger_description,
    event_catalog.event_sort,
    cell_source.audience_key,
    cell_source.audience_label,
    cell_source.channel_key,
    cell_source.channel_label,
    cell_source.cell_sort,
    pg_catalog.bool_and(legacy_setting.enabled) as enabled
  from makeup_event_catalog event_catalog
  join makeup_cell_sources cell_source
    on cell_source.event_family = event_catalog.event_family
  join public.makeup_notification_settings legacy_setting
    on legacy_setting.trigger_kind = event_catalog.trigger_kind
   and legacy_setting.channel = cell_source.source_channel
  join public.makeup_notification_settings template_setting
    on template_setting.trigger_kind = event_catalog.trigger_kind
   and template_setting.channel = 'dashboard_personal'
   and nullif(pg_catalog.btrim(template_setting.title_template), '') is not null
   and nullif(pg_catalog.btrim(template_setting.body_template), '') is not null
  group by
    event_catalog.trigger_kind,
    event_catalog.event_key,
    event_catalog.event_label,
    event_catalog.trigger_description,
    event_catalog.event_sort,
    cell_source.audience_key,
    cell_source.audience_label,
    cell_source.channel_key,
    cell_source.channel_label,
    cell_source.cell_sort
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
  initial_enabled,
  source_trigger_kind
)
select
  dashboard_private.notification_deterministic_uuid_v1(
    'notification-rule-v1',
    pg_catalog.concat_ws(
      '|',
      'global',
      'makeup_requests',
      candidate.event_key,
      candidate.audience_key,
      candidate.channel_key,
      'immediate'
    )
  ),
  'makeup_requests',
  '휴보강',
  6,
  candidate.event_key,
  candidate.event_label,
  '휴보강 처리',
  candidate.trigger_description,
  candidate.event_sort,
  candidate.audience_key,
  candidate.audience_label,
  candidate.channel_key,
  candidate.channel_label,
  candidate.cell_sort,
  'immediate',
  'immediate',
  candidate.enabled,
  candidate.trigger_kind
from makeup_registry_candidates candidate
on conflict do nothing;

create or replace function dashboard_private.notification_seed_template_payload_v1(
  p_rule_id uuid
)
returns table (
  title_template text,
  body_template text,
  allowed_variables jsonb,
  payload_schema_version integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when registry.workflow_key = 'makeup_requests' then template_setting.title_template
      when registry.event_key = 'registration.case_created'
        then '등록 문의 접수 · {학생}'
      when registry.event_key in (
        'registration.registration_completed',
        'registration.case_closed'
      ) then '등록 종료 · {학생}'
      when registry.event_key = 'transfer.submitted'
        then '전반 신청 접수 · {학생}'
      when registry.event_key = 'transfer.completed'
        then '전반 처리 완료 · {학생}'
      when registry.event_key = 'withdrawal.submitted'
        then '퇴원 신청 접수 · {학생}'
      when registry.event_key = 'withdrawal.completed'
        then '퇴원 처리 완료 · {학생}'
      else '[{workflow_label}] {event_label}'
    end as title_template,
    case
      when registry.workflow_key = 'makeup_requests' then template_setting.body_template
      when registry.event_key = 'registration.case_created'
        then E'{학생} 학생 등록 문의가 접수되었습니다.\n학년: {학년}\n문의일시: {문의일시}'
      when registry.event_key in (
        'registration.registration_completed',
        'registration.case_closed'
      ) then E'{학생} 학생 등록 프로세스가 {진행상태}(으)로 닫혔습니다.\n수업: {수업}\n등록 확인: {등록 확인}'
      when registry.event_key = 'transfer.submitted'
        then E'{담당선생님} 선생님이 {학생} 학생의 전반을 신청했습니다.\n전 수업: {전 수업}\n후 수업: {후 수업}'
      when registry.event_key = 'transfer.completed'
        then E'{학생} 학생 전반 처리가 완료되었습니다.\n전 수업 종료일: {전 수업 종료일}\n후 수업 시작일: {후 수업 시작일}'
      when registry.event_key = 'withdrawal.submitted'
        then E'{담당선생님} 선생님이 {학생} 학생의 퇴원을 신청했습니다.\n수업: {수업}'
      when registry.event_key = 'withdrawal.completed'
        then E'{학생} 학생 퇴원 처리가 완료되었습니다.\n퇴원일: {퇴원일}\n퇴원회차: {퇴원회차}'
      else E'{event_label} · {occurred_at}\n{deep_link}'
    end as body_template,
    case
      when registry.workflow_key = 'makeup_requests' then
        '[
          {"key":"process","token":"프로세스","pii_class":"none"},
          {"key":"status","token":"상태","pii_class":"none"},
          {"key":"class_name","token":"수업","pii_class":"class_name"},
          {"key":"subject","token":"과목","pii_class":"none"},
          {"key":"teacher_name","token":"선생님","pii_class":"staff_name"},
          {"key":"reason","token":"사유","pii_class":"free_text"},
          {"key":"cancel_date","token":"휴강일","pii_class":"schedule"},
          {"key":"makeup_at","token":"보강일시","pii_class":"schedule"},
          {"key":"makeup_room_spaced","token":"보강 강의실","pii_class":"location"},
          {"key":"makeup_room","token":"보강강의실","pii_class":"location"},
          {"key":"requester_name","token":"신청자","pii_class":"staff_name"},
          {"key":"submitted_at","token":"상신일시","pii_class":"schedule"},
          {"key":"revision_requested_at","token":"보완요청일시","pii_class":"schedule"},
          {"key":"revision_reason","token":"보완 사유","pii_class":"free_text"},
          {"key":"approved_at","token":"승인일시","pii_class":"schedule"},
          {"key":"approval_note","token":"승인 메모","pii_class":"free_text"},
          {"key":"rejected_at","token":"반려일시","pii_class":"schedule"},
          {"key":"rejected_reason","token":"반려 사유","pii_class":"free_text"},
          {"key":"canceled_at","token":"승인취소일시","pii_class":"schedule"},
          {"key":"canceled_note","token":"승인취소 메모","pii_class":"free_text"},
          {"key":"approver_name","token":"결재자","pii_class":"staff_name"},
          {"key":"fallback_title","token":"제목","pii_class":"none"},
          {"key":"fallback_body","token":"본문","pii_class":"none"}
        ]'::jsonb
      when registry.workflow_key in ('registration', 'transfer', 'withdrawal') then
        '[
          {"key":"student_name","token":"학생","pii_class":"student_name"},
          {"key":"grade","token":"학년","pii_class":"none"},
          {"key":"inquiry_at","token":"문의일시","pii_class":"schedule"},
          {"key":"status","token":"진행상태","pii_class":"none"},
          {"key":"class_name","token":"수업","pii_class":"class_name"},
          {"key":"registration_checked","token":"등록 확인","pii_class":"none"},
          {"key":"teacher_name","token":"담당선생님","pii_class":"staff_name"},
          {"key":"before_class","token":"전 수업","pii_class":"class_name"},
          {"key":"after_class","token":"후 수업","pii_class":"class_name"},
          {"key":"before_end_date","token":"전 수업 종료일","pii_class":"schedule"},
          {"key":"after_start_date","token":"후 수업 시작일","pii_class":"schedule"},
          {"key":"withdrawal_date","token":"퇴원일","pii_class":"schedule"},
          {"key":"withdrawal_round","token":"퇴원회차","pii_class":"none"}
        ]'::jsonb
      else
        '[
          {"key":"workflow_label","token":"workflow_label","pii_class":"none"},
          {"key":"event_label","token":"event_label","pii_class":"none"},
          {"key":"occurred_at","token":"occurred_at","pii_class":"schedule"},
          {"key":"deep_link","token":"deep_link","pii_class":"same_origin_path"}
        ]'::jsonb
    end as allowed_variables,
    1 as payload_schema_version
  from dashboard_private.notification_settings_ui_registry registry
  left join public.makeup_notification_settings template_setting
    on registry.workflow_key = 'makeup_requests'
   and template_setting.trigger_kind = registry.source_trigger_kind
   and template_setting.channel = 'dashboard_personal'
  where registry.rule_id = p_rule_id;
$$;

create or replace function dashboard_private.notification_seed_workflow_settings_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if exists (
    select expected_trigger.trigger_kind
    from (
      values
        ('submitted'::text),
        ('refund_requested'::text),
        ('approved'::text),
        ('completed'::text),
        ('canceled'::text),
        ('returned'::text),
        ('rejected'::text)
    ) expected_trigger(trigger_kind)
    left join public.makeup_notification_settings legacy_setting
      on legacy_setting.trigger_kind = expected_trigger.trigger_kind
     and legacy_setting.channel in ('google_chat_english', 'google_chat_math')
    group by expected_trigger.trigger_kind
    having pg_catalog.count(legacy_setting.channel) <> 2
      or pg_catalog.count(distinct legacy_setting.channel) <> 2
      or pg_catalog.count(distinct legacy_setting.enabled) > 1
  ) then
    raise exception 'notification_makeup_subject_settings_review_required'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from dashboard_private.notification_settings_ui_registry registry
    left join lateral dashboard_private.notification_seed_template_payload_v1(
      registry.rule_id
    ) payload on true
    where payload.title_template is null
      or payload.body_template is null
      or payload.allowed_variables is null
      or not dashboard_private.notification_template_content_valid_v1(
        payload.title_template,
        payload.body_template,
        payload.allowed_variables
      )
  ) then
    raise exception 'notification_makeup_template_review_required'
      using errcode = '55000';
  end if;

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
    registry.schedule_key,
    registry.schedule_config,
    registry.initial_enabled,
    dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-v1',
      registry.rule_id::text || '|1'
    ),
    1::bigint,
    null,
    'system',
    null,
    'system'
  from dashboard_private.notification_settings_ui_registry registry
  order by registry.workflow_sort, registry.event_sort, registry.cell_sort, registry.rule_id
  on conflict do nothing;

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
    created_actor_kind
  )
  select
    dashboard_private.notification_deterministic_uuid_v1(
      'notification-template-v1',
      registry.rule_id::text || '|1'
    ),
    registry.rule_id,
    1::bigint,
    payload.title_template,
    payload.body_template,
    payload.allowed_variables,
    payload.payload_schema_version,
    dashboard_private.notification_seed_template_checksum_v1(
      payload.title_template,
      payload.body_template,
      payload.allowed_variables,
      payload.payload_schema_version
    ),
    null,
    'system'
  from dashboard_private.notification_settings_ui_registry registry
  cross join lateral dashboard_private.notification_seed_template_payload_v1(
    registry.rule_id
  ) payload
  order by registry.workflow_sort, registry.event_sort, registry.cell_sort, registry.rule_id
  on conflict do nothing;

  if exists (
    select 1
    from dashboard_private.notification_settings_ui_registry registry
    left join dashboard_private.notification_rules rule_row
      on rule_row.id = registry.rule_id
     and rule_row.scope_key = 'global'
     and rule_row.workflow_key = registry.workflow_key
     and rule_row.event_key = registry.event_key
     and rule_row.audience_key = registry.audience_key
     and rule_row.channel_key = registry.channel_key
     and rule_row.rule_variant_key = registry.rule_variant_key
    where rule_row.id is null
      or rule_row.created_by is not null
      or rule_row.created_actor_kind <> 'system'
  ) then
    raise exception 'notification_seed_idempotency_violation'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from dashboard_private.notification_settings_ui_registry registry
    cross join lateral dashboard_private.notification_seed_template_payload_v1(
      registry.rule_id
    ) payload
    left join dashboard_private.notification_templates template_row
      on template_row.id = dashboard_private.notification_deterministic_uuid_v1(
        'notification-template-v1',
        registry.rule_id::text || '|1'
      )
     and template_row.rule_id = registry.rule_id
     and template_row.version = 1
    where template_row.id is null
      or template_row.title_template <> payload.title_template
      or template_row.body_template <> payload.body_template
      or template_row.allowed_variables <> payload.allowed_variables
      or template_row.payload_schema_version <> payload.payload_schema_version
      or template_row.checksum <> dashboard_private.notification_seed_template_checksum_v1(
        payload.title_template,
        payload.body_template,
        payload.allowed_variables,
        payload.payload_schema_version
      )
      or template_row.created_by is not null
      or template_row.created_actor_kind <> 'system'
  ) then
    raise exception 'notification_seed_idempotency_violation'
      using errcode = '55000';
  end if;

  with legacy_sources as (
    select
      'makeup_notification_settings:'
        || legacy_setting.trigger_kind
        || ':'
        || legacy_setting.channel as source_key,
      legacy_setting.*,
      coalesce(
        (
          select pg_catalog.jsonb_agg(registry.rule_id order by registry.rule_id)
          from dashboard_private.notification_settings_ui_registry registry
          where registry.workflow_key = 'makeup_requests'
            and registry.source_trigger_kind = legacy_setting.trigger_kind
            and (
              (
                legacy_setting.channel = 'dashboard_personal'
                and registry.channel_key = 'in_app'
                and registry.audience_key in (
                  'requester_profile',
                  'approver_profile'
                )
              )
              or (
                legacy_setting.channel = 'dashboard_management'
                and registry.audience_key = 'management_team'
                and registry.channel_key = 'in_app'
              )
              or (
                legacy_setting.channel = 'google_chat_executive'
                and registry.audience_key = 'executive_team'
                and registry.channel_key = 'google_chat'
              )
              or (
                legacy_setting.channel = 'google_chat_admin'
                and registry.audience_key = 'management_team'
                and registry.channel_key = 'google_chat'
              )
              or (
                legacy_setting.channel in ('google_chat_english', 'google_chat_math')
                and registry.audience_key = 'subject_team'
                and registry.channel_key = 'google_chat'
              )
            )
        ),
        '[]'::jsonb
      ) as mapped_rule_ids,
      (
        select pg_catalog.min(registry.event_key)
        from dashboard_private.notification_settings_ui_registry registry
        where registry.workflow_key = 'makeup_requests'
          and registry.source_trigger_kind = legacy_setting.trigger_kind
      ) as event_key
    from public.makeup_notification_settings legacy_setting
  )
  insert into dashboard_private.notification_settings_import_metadata(
    source_key,
    source_table,
    source_revision,
    source_checksum,
    workflow_key,
    event_key,
    mapped_rule_ids,
    import_state,
    inactive_reason,
    source_snapshot
  )
  select
    legacy_source.source_key,
    'public.makeup_notification_settings',
    pg_catalog.to_char(
      legacy_source.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'trigger_kind', legacy_source.trigger_kind,
            'channel', legacy_source.channel,
            'enabled', legacy_source.enabled,
            'title_template', legacy_source.title_template,
            'body_template', legacy_source.body_template
          )::text,
          'UTF8'
        )
      ),
      'hex'
    ),
    'makeup_requests',
    legacy_source.event_key,
    legacy_source.mapped_rule_ids,
    case
      when pg_catalog.jsonb_array_length(legacy_source.mapped_rule_ids) > 0
        then 'active'
      else 'inactive'
    end,
    case
      when pg_catalog.jsonb_array_length(legacy_source.mapped_rule_ids) = 0
        then 'inactive_not_used_by_legacy_sender'
      else null
    end,
    pg_catalog.jsonb_build_object(
      'trigger_kind', legacy_source.trigger_kind,
      'channel', legacy_source.channel,
      'enabled', legacy_source.enabled,
      'title_template', legacy_source.title_template,
      'body_template', legacy_source.body_template
    )
  from legacy_sources legacy_source
  order by legacy_source.trigger_kind, legacy_source.channel
  on conflict do nothing;

  select pg_catalog.jsonb_build_object(
    'registry_count', (
      select pg_catalog.count(*)
      from dashboard_private.notification_settings_ui_registry
    ),
    'registry_checksum', (
      select pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            coalesce(
              pg_catalog.string_agg(
                registry.rule_id::text
                  || ':' || registry.workflow_key
                  || ':' || registry.event_key
                  || ':' || registry.audience_key
                  || ':' || registry.channel_key
                  || ':' || registry.initial_enabled::text,
                '|' order by registry.workflow_sort, registry.event_sort,
                  registry.cell_sort, registry.rule_id
              ),
              ''
            ),
            'UTF8'
          )
        ),
        'hex'
      )
      from dashboard_private.notification_settings_ui_registry registry
    ),
    'rule_count', (
      select pg_catalog.count(*)
      from dashboard_private.notification_rules rule_row
      join dashboard_private.notification_settings_ui_registry registry
        on registry.rule_id = rule_row.id
    ),
    'rule_revision_checksum', (
      select pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            coalesce(
              pg_catalog.string_agg(
                rule_row.id::text
                  || ':' || rule_row.revision::text
                  || ':' || rule_row.active_template_id::text,
                '|' order by rule_row.id
              ),
              ''
            ),
            'UTF8'
          )
        ),
        'hex'
      )
      from dashboard_private.notification_rules rule_row
      join dashboard_private.notification_settings_ui_registry registry
        on registry.rule_id = rule_row.id
    ),
    'template_count', (
      select pg_catalog.count(*)
      from dashboard_private.notification_templates template_row
      join dashboard_private.notification_settings_ui_registry registry
        on registry.rule_id = template_row.rule_id
      where template_row.version = 1
    ),
    'import_count', (
      select pg_catalog.count(*)
      from dashboard_private.notification_settings_import_metadata
    ),
    'import_checksum', (
      select pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            coalesce(
              pg_catalog.string_agg(
                metadata.source_key
                  || ':' || metadata.source_revision
                  || ':' || metadata.source_checksum
                  || ':' || metadata.import_state,
                '|' order by metadata.source_key
              ),
              ''
            ),
            'UTF8'
          )
        ),
        'hex'
      )
      from dashboard_private.notification_settings_import_metadata metadata
    )
  ) into v_result;

  return v_result;
end;
$$;

select dashboard_private.notification_seed_workflow_settings_v1();

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
            'template', pg_catalog.jsonb_build_object(
              'id', template_row.id,
              'rule_id', template_row.rule_id,
              'version', template_row.version::text,
              'title_template', template_row.title_template,
              'body_template', template_row.body_template,
              'allowed_variables', template_row.allowed_variables,
              'payload_schema_version', template_row.payload_schema_version,
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
        where registry_row.workflow_key = p_workflow_key
      ),
      '[]'::jsonb
    ),
    'connections', coalesce(
      (
        select pg_catalog.jsonb_agg(
          dashboard_private.notification_connection_safe_json_v1(
            connection_row,
            p_editable
          )
          order by case connection_row.channel
            when 'admin' then 1
            when 'executive' then 2
            when 'math' then 3
            when 'english' then 4
            else 99
          end
        )
        from public.google_chat_webhook_settings connection_row
        where connection_row.channel in ('admin', 'executive', 'math', 'english')
      ),
      '[]'::jsonb
    ),
    'delivery_summary', (
      select pg_catalog.jsonb_build_object(
        'pending_count', pg_catalog.count(*) filter (
          where delivery_row.status in ('pending', 'claimed', 'sending', 'retry_wait')
        ),
        'sent_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'sent'
        ),
        'failed_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'failed'
        ),
        'unknown_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'delivery_unknown'
        ),
        'latest_delivery_at', pg_catalog.max(delivery_row.updated_at)
      )
      from dashboard_private.notification_deliveries delivery_row
      join dashboard_private.notification_events event_row
        on event_row.id = delivery_row.event_id
      where event_row.scope_key = 'global'
        and event_row.workflow_key = p_workflow_key
    ),
    'loaded_at', pg_catalog.statement_timestamp()
  );
$$;

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.save_notification_control_plane_unchecked_v1(text,jsonb,jsonb,uuid)'
  ) is null then
    execute 'alter function public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid) set schema dashboard_private';
    execute 'alter function dashboard_private.save_notification_control_plane_v1(text,jsonb,jsonb,uuid) rename to save_notification_control_plane_unchecked_v1';
  end if;
end;
$$;

create or replace function public.save_notification_control_plane_v1(
  p_workflow_key text,
  p_expected_revisions jsonb,
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
  v_rule_id_text text;
  v_rule_id uuid;
begin
  if v_actor is null or (v_role in ('admin', 'staff')) is not true then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;

  if p_patch is not null
    and pg_catalog.jsonb_typeof(p_patch) = 'object'
    and p_patch ? 'rules'
    and pg_catalog.jsonb_typeof(p_patch -> 'rules') = 'object'
  then
    for v_rule_id_text in
      select patch_key.value
      from pg_catalog.jsonb_object_keys(p_patch -> 'rules') patch_key(value)
      order by patch_key.value
    loop
      if v_rule_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception 'notification_rule_not_in_registry'
          using errcode = '22023';
      end if;
      v_rule_id := v_rule_id_text::uuid;
      perform 1
      from dashboard_private.notification_rules rule_row
      join dashboard_private.notification_settings_ui_registry registry_row
        on registry_row.rule_id = rule_row.id
       and registry_row.workflow_key = rule_row.workflow_key
       and registry_row.event_key = rule_row.event_key
       and registry_row.audience_key = rule_row.audience_key
       and registry_row.channel_key = rule_row.channel_key
       and registry_row.rule_variant_key = rule_row.rule_variant_key
      where rule_row.id = v_rule_id
        and rule_row.scope_key = 'global'
        and rule_row.workflow_key = p_workflow_key;
      if not found then
        raise exception 'notification_rule_not_in_registry'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  return dashboard_private.save_notification_control_plane_unchecked_v1(
    p_workflow_key,
    p_expected_revisions,
    p_patch,
    p_request_id
  );
end;
$$;

create or replace function public.save_notification_control_plane_with_override_v1(
  p_workflow_key text,
  p_expected_rule_revisions jsonb,
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
  v_request_kind constant text := 'notification_revision_conflict_override';
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

  v_response := public.save_notification_control_plane_v1(
    p_workflow_key,
    p_expected_rule_revisions,
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
      'save_request_id', p_save_request_id
    ),
    'operator_revision_conflict_override'
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

do $$
declare
  v_expected_flags constant text[] := array[
    'notification_control_plane_settings_ui_enabled',
    'notification_control_plane_shadow_write_enabled',
    'notification_control_plane_dispatch_tasks_enabled',
    'notification_control_plane_dispatch_word_retests_enabled',
    'notification_control_plane_dispatch_registration_enabled',
    'notification_control_plane_registration_phone_adapter_enabled',
    'notification_control_plane_registration_visit_adapter_enabled',
    'notification_control_plane_registration_solapi_adapter_enabled',
    'notification_control_plane_dispatch_transfer_enabled',
    'notification_control_plane_dispatch_withdrawal_enabled',
    'notification_control_plane_dispatch_makeup_requests_enabled',
    'notification_control_plane_dispatch_approvals_enabled'
  ]::text[];
begin
  if (
    select pg_catalog.count(*) <> 12
      or pg_catalog.count(*) filter (where flag_row.enabled) <> 0
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = any(v_expected_flags)
  ) or exists (
    select 1
    from dashboard_private.notification_runtime_flags flag_row
    where not (flag_row.flag_key = any(v_expected_flags))
  ) then
    raise exception 'notification_seed_runtime_flag_enabled'
      using errcode = '55000';
  end if;
end;
$$;

alter table dashboard_private.notification_settings_ui_registry owner to postgres;
alter table dashboard_private.notification_settings_import_metadata owner to postgres;
alter function dashboard_private.notification_deterministic_uuid_v1(text, text)
  owner to postgres;
alter function dashboard_private.notification_seed_template_checksum_v1(
  text,
  text,
  jsonb,
  integer
) owner to postgres;
alter function dashboard_private.notification_seed_template_payload_v1(uuid)
  owner to postgres;
alter function dashboard_private.notification_seed_workflow_settings_v1()
  owner to postgres;
alter function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  owner to postgres;
alter function dashboard_private.save_notification_control_plane_unchecked_v1(
  text,
  jsonb,
  jsonb,
  uuid
) owner to postgres;
alter function public.save_notification_control_plane_v1(text, jsonb, jsonb, uuid)
  owner to postgres;
alter function public.save_notification_control_plane_with_override_v1(
  text,
  jsonb,
  jsonb,
  uuid,
  uuid,
  jsonb
) owner to postgres;

revoke all on function dashboard_private.notification_deterministic_uuid_v1(text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_seed_template_checksum_v1(
  text,
  text,
  jsonb,
  integer
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_seed_template_payload_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_seed_workflow_settings_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_notification_control_plane_unchecked_v1(
  text,
  jsonb,
  jsonb,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function public.save_notification_control_plane_v1(text, jsonb, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.save_notification_control_plane_with_override_v1(
  text,
  jsonb,
  jsonb,
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.save_notification_control_plane_v1(
  text,
  jsonb,
  jsonb,
  uuid
) to authenticated;
grant execute on function public.save_notification_control_plane_with_override_v1(
  text,
  jsonb,
  jsonb,
  uuid,
  uuid,
  jsonb
) to authenticated;

commit;
