begin;

set local timezone = 'Asia/Seoul';
set local statement_timeout = '60s';
set local lock_timeout = '5s';
set constraints all deferred;

-- notification_content_local_qa_fixture
-- notification_content_local_qa_preflight_begin
do $$
declare
  relation_name text;
  relation_oid regclass;
  relation_count bigint;
  required_relations constant text[] := array[
    'auth.users',
    'public.profiles',
    'public.makeup_notification_settings',
    'dashboard_private.notification_settings_ui_registry',
    'dashboard_private.notification_settings_import_metadata',
    'dashboard_private.notification_rules',
    'dashboard_private.notification_templates',
    'dashboard_private.notification_rule_content_contracts',
    'dashboard_private.notification_template_compliance_audits',
    'dashboard_private.notification_runtime_flags',
    'dashboard_private.registration_appointment_reminder_applicability',
    'dashboard_private.notification_contract_bridge_state',
    'public.approval_comments',
    'public.approval_events',
    'public.approval_requests',
    'public.approval_templates',
    'public.classes',
    'public.dashboard_notifications',
    'public.dashboard_notification_read_receipts',
    'public.dashboard_push_subscriptions',
    'public.google_chat_webhook_settings',
    'public.makeup_notification_deliveries',
    'public.makeup_request_events',
    'public.makeup_requests',
    'public.ops_task_attachments',
    'public.ops_task_comments',
    'public.ops_task_events',
    'public.ops_tasks',
    'public.students',
    'dashboard_private.notification_audit_logs',
    'dashboard_private.notification_contract_deployment_receipts',
    'dashboard_private.notification_contract_route_outcomes',
    'dashboard_private.notification_contract_traffic',
    'dashboard_private.notification_deliveries',
    'dashboard_private.notification_dispatch_ownership_claims',
    'dashboard_private.notification_event_fanout_jobs',
    'dashboard_private.notification_events',
    'dashboard_private.notification_makeup_legacy_imports',
    'dashboard_private.notification_makeup_reconcile_audits',
    'dashboard_private.notification_makeup_retention_observations',
    'dashboard_private.notification_makeup_retention_snapshots',
    'dashboard_private.notification_request_ledger',
    'dashboard_private.notification_rule_reconciliation_jobs',
    'dashboard_private.notification_target_reconciliation_jobs',
    'dashboard_private.notification_worker_heartbeats'
  ];
  required_functions constant text[] := array[
    'dashboard_private.notification_deterministic_uuid_v1(text,text)',
    'dashboard_private.notification_seed_template_checksum_v1(text,text,jsonb,integer)',
    'dashboard_private.notification_seed_template_payload_v1(uuid)',
    'dashboard_private.notification_seed_workflow_settings_v1()',
    'dashboard_private.notification_content_contract_for_identity_v1(text,text,text)',
    'dashboard_private.notification_template_compliance_v1(uuid,uuid)',
    'dashboard_private.notification_system_template_vnext_payload_v1(text)',
    'dashboard_private.install_notification_system_templates_vnext_v1()'
  ];
  function_name text;
begin
  foreach relation_name in array required_relations loop
    relation_oid := pg_catalog.to_regclass(relation_name);
    if relation_oid is null then
      raise exception 'notification_content_local_qa_relation_missing:%', relation_name
        using errcode = '55000';
    end if;

    execute pg_catalog.format('select pg_catalog.count(*) from %s', relation_oid)
      into relation_count;
    if relation_count <> 0 then
      raise exception 'notification_content_local_qa_preflight_not_empty:%:%',
        relation_name, relation_count
        using errcode = '55000';
    end if;
  end loop;

  foreach function_name in array required_functions loop
    if pg_catalog.to_regprocedure(function_name) is null then
      raise exception 'notification_content_local_qa_function_missing:%', function_name
        using errcode = '55000';
    end if;
  end loop;
end;
$$;

create temporary table notification_content_local_qa_event_catalog(
  workflow_key text not null,
  event_key text not null,
  event_label text not null,
  group_label text not null,
  trigger_description text not null,
  event_sort integer not null,
  primary key (workflow_key, event_key)
) on commit drop;

insert into notification_content_local_qa_event_catalog(
  workflow_key,
  event_key,
  event_label,
  group_label,
  trigger_description,
  event_sort
) values
  ('tasks', 'task.created', '할 일 생성', '할 일', '새 할 일이 저장되었을 때', 1),
  ('tasks', 'task.assignee_changed', '담당 변경', '할 일', '주 담당자 또는 보조 담당자가 변경되었을 때', 2),
  ('tasks', 'task.due_changed', '일정 변경', '할 일', '시작일 또는 마감일이 변경되었을 때', 3),
  ('tasks', 'task.status_changed', '상태 변경', '할 일', '진행 상태가 변경되었을 때', 4),
  ('tasks', 'task.completed', '완료', '할 일', '할 일이 완료되었을 때', 5),
  ('tasks', 'task.canceled', '취소', '할 일', '할 일이 취소되었을 때', 6),
  ('tasks', 'task.reopened', '재개', '할 일', '완료하거나 취소한 할 일을 다시 열었을 때', 7),
  ('tasks', 'task.comment_added', '댓글', '할 일', '새 댓글이 등록되었을 때', 8),

  ('word_retests', 'word_retest.created', '재시험 생성', '영어 단어 재시험', '영어 단어 재시험이 생성되었을 때', 1),
  ('word_retests', 'word_retest.assigned', '배정', '영어 단어 재시험', '담당 조교 또는 보조 담당자가 배정되었을 때', 2),
  ('word_retests', 'word_retest.schedule_changed', '본시험일 변경', '영어 단어 재시험', '본시험일 또는 일정이 변경되었을 때', 3),
  ('word_retests', 'word_retest.started', '시작', '영어 단어 재시험', '재시험 처리가 시작되었을 때', 4),
  ('word_retests', 'word_retest.result_reported', '결과 보고', '영어 단어 재시험', '재시험 결과가 보고되었을 때', 5),
  ('word_retests', 'word_retest.absent_reported', '미응시 보고', '영어 단어 재시험', '미응시 결과가 보고되었을 때', 6),
  ('word_retests', 'word_retest.revision_requested', '수정 요청', '영어 단어 재시험', '결과 수정이 요청되었을 때', 7),
  ('word_retests', 'word_retest.retry_created', '재시험 재생성', '영어 단어 재시험', '후속 재시험이 생성되었을 때', 8),
  ('word_retests', 'word_retest.completed', '완료', '영어 단어 재시험', '재시험 업무가 완료되었을 때', 9),
  ('word_retests', 'word_retest.canceled', '취소', '영어 단어 재시험', '재시험 업무가 취소되었을 때', 10),

  ('registration', 'registration.case_created', '문의 접수', '등록 진행', '새 등록 문의가 접수되었을 때', 1),
  ('registration', 'registration.registration_completed', '등록 완료', '등록 진행', '등록 처리가 완료되었을 때', 2),
  ('registration', 'registration.case_closed', '문의 종료', '등록 진행', '등록 없이 문의가 종료되었을 때', 3),
  ('registration', 'registration.appointment_reminder_due', '예약 알림', '예약 알림', '예약 일정에 맞춘 알림 시각이 되었을 때', 4),
  ('registration', 'registration.phone_consultation_ready', '전화상담 준비', '상담 인계', '전화상담 담당자에게 인계할 준비가 되었을 때', 101),
  ('registration', 'registration.visit_scheduled', '방문상담 예약', '상담 인계', '방문상담 일정이 처음 배정되었을 때', 102),
  ('registration', 'registration.visit_rescheduled', '방문상담 일정 변경', '상담 인계', '방문상담 일정이 변경되었을 때', 103),
  ('registration', 'registration.visit_replaced', '방문상담 예약 교체', '상담 인계', '방문상담 예약이 다른 예약으로 교체되었을 때', 104),
  ('registration', 'registration.visit_subject_deselected', '방문상담 과목 제외', '상담 인계', '방문상담 대상 과목이 제외되었을 때', 105),
  ('registration', 'registration.visit_canceled', '방문상담 취소', '상담 인계', '방문상담 예약이 취소되었을 때', 106),

  ('transfer', 'transfer.submitted', '제출', '전반 진행', '전반 신청이 제출되었을 때', 1),
  ('transfer', 'transfer.completed', '완료', '전반 진행', '전반 처리가 완료되었을 때', 2),
  ('withdrawal', 'withdrawal.submitted', '제출', '퇴원 진행', '퇴원 신청이 제출되었을 때', 1),
  ('withdrawal', 'withdrawal.completed', '완료', '퇴원 진행', '퇴원 처리가 완료되었을 때', 2),

  ('makeup_requests', 'makeup.submitted', '신청 제출', '휴보강 처리', '휴보강 신청이 제출되었을 때', 1),
  ('makeup_requests', 'makeup.refund_requested', '환불 신청', '휴보강 처리', '휴보강 환불이 신청되었을 때', 2),
  ('makeup_requests', 'makeup.approved', '결재 승인', '휴보강 처리', '휴보강 신청이 승인되었을 때', 3),
  ('makeup_requests', 'makeup.refund_completed', '환불 완료', '휴보강 처리', '휴보강 환불 처리가 완료되었을 때', 4),
  ('makeup_requests', 'makeup.approval_canceled', '승인 취소', '휴보강 처리', '휴보강 승인이 취소되었을 때', 5),
  ('makeup_requests', 'makeup.revision_requested', '보완 요청', '휴보강 처리', '휴보강 신청 보완이 요청되었을 때', 6),
  ('makeup_requests', 'makeup.rejected', '반려', '휴보강 처리', '휴보강 신청이 반려되었을 때', 7),

  ('approvals', 'approval.created', '생성', '전자결재', '전자결재 문서가 생성되었을 때', 1),
  ('approvals', 'approval.submitted', '제출', '전자결재', '전자결재 문서가 제출되었을 때', 2),
  ('approvals', 'approval.review_started', '검토 시작', '전자결재', '결재 검토가 시작되었을 때', 3),
  ('approvals', 'approval.approver_changed', '결재자 변경', '전자결재', '현재 결재자가 변경되었을 때', 4),
  ('approvals', 'approval.approved', '승인', '전자결재', '전자결재가 승인되었을 때', 5),
  ('approvals', 'approval.returned', '반려', '전자결재', '전자결재가 반려되었을 때', 6),
  ('approvals', 'approval.canceled', '취소', '전자결재', '전자결재가 취소되었을 때', 7),
  ('approvals', 'approval.resubmitted', '재상신', '전자결재', '전자결재가 다시 제출되었을 때', 8),
  ('approvals', 'approval.comment_added', '댓글', '전자결재', '전자결재에 새 댓글이 등록되었을 때', 9);


-- notification_content_local_qa_install_begin
insert into auth.users(
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '31500000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'notification-content-local-qa@runtime.invalid',
  crypt('notification-content-local-qa-only', gen_salt('bf')),
  '2026-08-04 00:00:00+00',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"notification-content-local-qa-v1"}'::jsonb,
  '2026-08-04 00:00:00+00',
  '2026-08-04 00:00:00+00'
);

insert into public.profiles(
  id,
  role,
  name,
  email,
  created_at,
  updated_at
) values (
  '31500000-0000-4000-8000-000000000001',
  'admin',
  '알림 콘텐츠 로컬 QA',
  'notification-content-local-qa@runtime.invalid',
  '2026-08-04 00:00:00+00',
  '2026-08-04 00:00:00+00'
);

insert into public.makeup_notification_settings(
  trigger_kind,
  channel,
  enabled,
  title_template,
  body_template,
  updated_by,
  updated_at
)
select
  trigger_catalog.trigger_kind,
  channel_catalog.channel,
  true,
  trigger_catalog.title_template,
  '{수업} · {휴강일} 휴강 / {보강일시} · {보강강의실} 보강',
  null,
  '2026-08-04 00:00:00+00'
from (
  values
    ('submitted'::text, '휴보강 신청서가 올라왔습니다'::text),
    ('refund_requested'::text, '휴보강 환불 신청이 올라왔습니다'::text),
    ('approved'::text, '휴보강 신청서가 결재 승인되어 자동 처리되었습니다'::text),
    ('completed'::text, '휴보강 신청서가 결재 승인되어 자동 처리되었습니다'::text),
    ('canceled'::text, '휴보강 승인이 취소되었습니다'::text),
    ('returned'::text, '휴보강 신청서 보완 요청이 도착했습니다'::text),
    ('rejected'::text, '휴보강 신청서가 반려되었습니다'::text)
) trigger_catalog(trigger_kind, title_template)
cross join (
  values
    ('dashboard_personal'::text),
    ('dashboard_management'::text),
    ('google_chat_executive'::text),
    ('google_chat_admin'::text),
    ('google_chat_math'::text),
    ('google_chat_english'::text)
) channel_catalog(channel);

insert into dashboard_private.notification_runtime_flags(
  flag_key,
  enabled,
  revision,
  updated_by,
  updated_at
) values
  ('notification_control_plane_settings_ui_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_shadow_write_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_dispatch_tasks_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_dispatch_word_retests_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_dispatch_registration_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_registration_phone_adapter_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_registration_visit_adapter_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_registration_solapi_adapter_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_dispatch_transfer_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_dispatch_withdrawal_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_dispatch_makeup_requests_enabled', false, 1, null, '2026-08-04 00:00:00+00'),
  ('notification_control_plane_dispatch_approvals_enabled', false, 1, null, '2026-08-04 00:00:00+00');

insert into dashboard_private.registration_appointment_reminder_applicability(
  appointment_kind,
  audience_key,
  channel_key,
  created_at
) values
  ('level_test', 'management_team', 'in_app', '2026-08-04 00:00:00+00'),
  ('level_test', 'management_team', 'google_chat', '2026-08-04 00:00:00+00'),
  ('visit_consultation', 'track_director', 'in_app', '2026-08-04 00:00:00+00'),
  ('visit_consultation', 'management_team', 'google_chat', '2026-08-04 00:00:00+00');

insert into dashboard_private.notification_contract_bridge_state(
  state_key,
  installed_at,
  closed_at
) values (
  'legacy_contract_bridge_v1',
  '2026-08-04 00:00:00+00',
  null
);

create temporary table notification_content_local_qa_rule_group_source(
  payload jsonb not null
) on commit drop;

-- notification_content_local_qa_rule_groups_begin
insert into notification_content_local_qa_rule_group_source(payload) values (
-- notification_content_local_qa_rule_groups_json_begin
$notification_content_local_qa_rule_groups$
{
  "ruleGroups": [
    {
      "workflowKey": "tasks",
      "eventKeys": ["task.created", "task.assignee_changed", "task.due_changed", "task.status_changed", "task.completed", "task.canceled", "task.reopened", "task.comment_added"],
      "cells": [
        {"audienceKey":"requester_profile","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"primary_assignee","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"secondary_assignee","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}
      ],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"disabled","dispatchOwner":"none"
    },
    {
      "workflowKey": "word_retests",
      "eventKeys": ["word_retest.created", "word_retest.assigned", "word_retest.schedule_changed", "word_retest.started", "word_retest.result_reported", "word_retest.absent_reported", "word_retest.revision_requested", "word_retest.retry_created", "word_retest.completed", "word_retest.canceled"],
      "cells": [
        {"audienceKey":"requesting_teacher","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"assigned_assistant","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"secondary_assignee","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}
      ],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"disabled","dispatchOwner":"none"
    },
    {
      "workflowKey": "approvals",
      "eventKeys": ["approval.created", "approval.submitted", "approval.review_started", "approval.approver_changed", "approval.approved", "approval.returned", "approval.canceled", "approval.resubmitted", "approval.comment_added"],
      "cells": [
        {"audienceKey":"requester_profile","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"approver_profile","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}
      ],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"disabled","dispatchOwner":"none"
    },
    {
      "workflowKey":"registration",
      "eventKeys":["registration.case_created","registration.registration_completed","registration.case_closed"],
      "cells":[{"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"enabled","dispatchOwner":"legacy"
    },
    {
      "workflowKey":"transfer",
      "eventKeys":["transfer.submitted","transfer.completed"],
      "cells":[{"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"enabled","dispatchOwner":"legacy"
    },
    {
      "workflowKey":"withdrawal",
      "eventKeys":["withdrawal.submitted","withdrawal.completed"],
      "cells":[{"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"enabled","dispatchOwner":"legacy"
    },
    {
      "workflowKey":"makeup_requests",
      "eventKeys":["makeup.submitted","makeup.refund_requested"],
      "cells":[
        {"audienceKey":"approver_profile","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"executive_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]},
        {"audienceKey":"subject_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}
      ],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"enabled","dispatchOwner":"legacy"
    },
    {
      "workflowKey":"makeup_requests",
      "eventKeys":["makeup.approved","makeup.refund_completed","makeup.approval_canceled"],
      "cells":[
        {"audienceKey":"requester_profile","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"approver_profile","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"executive_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]},
        {"audienceKey":"subject_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}
      ],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"enabled","dispatchOwner":"legacy"
    },
    {
      "workflowKey":"makeup_requests",
      "eventKeys":["makeup.revision_requested","makeup.rejected"],
      "cells":[
        {"audienceKey":"requester_profile","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"subject_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}
      ],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"enabled","dispatchOwner":"legacy"
    },
    {
      "workflowKey":"registration",
      "eventKeys":["registration.appointment_reminder_due"],
      "cells":[
        {"audienceKey":"management_team","channelKey":"in_app","ruleVariantKeys":["previous_day_at","same_day_at","offset_before"]},
        {"audienceKey":"track_director","channelKey":"in_app","ruleVariantKeys":["previous_day_at","same_day_at","offset_before"]},
        {"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["previous_day_at","same_day_at","offset_before"]}
      ],
      "scopeState":"in_scope","configurationKind":"editable_rule","enabledState":"disabled","dispatchOwner":"legacy"
    },
    {
      "workflowKey":"registration",
      "eventKeys":["registration.phone_consultation_ready"],
      "cells":[{"audienceKey":"track_director","channelKey":"in_app","ruleVariantKeys":["immediate"]}],
      "scopeState":"in_scope","configurationKind":"fixed_policy_editable_template","enabledState":"enabled","dispatchOwner":"legacy"
    },
    {
      "workflowKey":"registration",
      "eventKeys":["registration.visit_scheduled","registration.visit_rescheduled","registration.visit_replaced","registration.visit_subject_deselected","registration.visit_canceled"],
      "cells":[
        {"audienceKey":"track_director","channelKey":"in_app","ruleVariantKeys":["immediate"]},
        {"audienceKey":"management_team","channelKey":"google_chat","ruleVariantKeys":["immediate"]}
      ],
      "scopeState":"in_scope","configurationKind":"fixed_policy_editable_template","enabledState":"enabled","dispatchOwner":"legacy"
    },
    {
      "workflowKey":"registration",
      "eventKeys":["registration.admission_message_requested"],
      "cells":[{"audienceKey":"applicant_guardian","channelKey":"customer_message","ruleVariantKeys":["immediate"]}],
      "scopeState":"excluded_channel","configurationKind":"not_applicable","enabledState":"enabled","dispatchOwner":"legacy"
    }
  ],
  "noRuleEvents": [
    {"workflowKey":"registration","eventKey":"registration.inquiry_routed"},
    {"workflowKey":"registration","eventKey":"registration.director_assigned"},
    {"workflowKey":"registration","eventKey":"registration.level_test_scheduled"},
    {"workflowKey":"registration","eventKey":"registration.level_test_rescheduled"},
    {"workflowKey":"registration","eventKey":"registration.level_test_started"},
    {"workflowKey":"registration","eventKey":"registration.level_test_completed"},
    {"workflowKey":"registration","eventKey":"registration.level_test_absent"},
    {"workflowKey":"registration","eventKey":"registration.level_test_canceled"},
    {"workflowKey":"registration","eventKey":"registration.consultation_completed"},
    {"workflowKey":"registration","eventKey":"registration.waiting_transitioned"},
    {"workflowKey":"registration","eventKey":"registration.enrollment_decided"},
    {"workflowKey":"registration","eventKey":"registration.admission_started"},
    {"workflowKey":"registration","eventKey":"registration.admission_advanced"},
    {"workflowKey":"registration","eventKey":"registration.admission_canceled"},
    {"workflowKey":"registration","eventKey":"registration.track_reopened"},
    {"workflowKey":"registration","eventKey":"registration.admission_message_accepted"},
    {"workflowKey":"registration","eventKey":"registration.admission_message_failed"},
    {"workflowKey":"registration","eventKey":"registration.admission_message_unknown"},
    {"workflowKey":"registration","eventKey":"registration.admission_message_reconciled"},
    {"workflowKey":"registration","eventKey":"registration.admission_message_retry_released"},
    {"workflowKey":"transfer","eventKey":"transfer.processing_started"},
    {"workflowKey":"transfer","eventKey":"transfer.details_changed"},
    {"workflowKey":"transfer","eventKey":"transfer.canceled"},
    {"workflowKey":"transfer","eventKey":"transfer.reopened"},
    {"workflowKey":"withdrawal","eventKey":"withdrawal.processing_started"},
    {"workflowKey":"withdrawal","eventKey":"withdrawal.details_changed"},
    {"workflowKey":"withdrawal","eventKey":"withdrawal.canceled"},
    {"workflowKey":"withdrawal","eventKey":"withdrawal.reopened"},
    {"workflowKey":"makeup_requests","eventKey":"makeup.deleted"},
    {"workflowKey":"approvals","eventKey":"approval.deleted"}
  ]
}
$notification_content_local_qa_rule_groups$::jsonb
-- notification_content_local_qa_rule_groups_json_end
);

create temporary table notification_content_local_qa_identities
on commit drop
as
select
  group_item.ordinality::integer as group_position,
  event_item.ordinality::integer as event_position,
  cell_item.ordinality::integer as cell_position,
  variant_item.ordinality::integer as variant_position,
  group_item.value ->> 'workflowKey' as workflow_key,
  event_item.value as event_key,
  cell_item.value ->> 'audienceKey' as audience_key,
  cell_item.value ->> 'channelKey' as channel_key,
  variant_item.value as rule_variant_key,
  group_item.value ->> 'scopeState' as scope_state,
  group_item.value ->> 'configurationKind' as configuration_kind,
  group_item.value ->> 'enabledState' as enabled_state,
  group_item.value ->> 'dispatchOwner' as dispatch_owner,
  pg_catalog.concat_ws(
    '|',
    group_item.value ->> 'workflowKey',
    event_item.value,
    cell_item.value ->> 'audienceKey',
    cell_item.value ->> 'channelKey',
    variant_item.value
  ) as identity_key
from notification_content_local_qa_rule_group_source source
cross join lateral pg_catalog.jsonb_array_elements(source.payload -> 'ruleGroups')
  with ordinality group_item(value, ordinality)
cross join lateral pg_catalog.jsonb_array_elements_text(group_item.value -> 'eventKeys')
  with ordinality event_item(value, ordinality)
cross join lateral pg_catalog.jsonb_array_elements(group_item.value -> 'cells')
  with ordinality cell_item(value, ordinality)
cross join lateral pg_catalog.jsonb_array_elements_text(cell_item.value -> 'ruleVariantKeys')
  with ordinality variant_item(value, ordinality);

do $$
begin
  if (select pg_catalog.count(*) from notification_content_local_qa_identities) <> 186
    or (
      select pg_catalog.count(*)
      from notification_content_local_qa_identities
      where scope_state = 'in_scope'
    ) <> 185
    or (
      select pg_catalog.count(*)
      from notification_content_local_qa_identities
      where scope_state = 'excluded_channel'
    ) <> 1
    or (
      select pg_catalog.count(distinct workflow_key)
      from notification_content_local_qa_identities
      where scope_state = 'in_scope'
    ) <> 7
    or (
      select pg_catalog.count(distinct (workflow_key, event_key))
      from notification_content_local_qa_identities
      where scope_state = 'in_scope'
    ) <> 48
  then
    raise exception 'notification_content_local_qa_rule_groups_invalid'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.string_agg(identity_key, E'\n' order by identity_key collate "C"),
          'UTF8'
        )
      ),
      'hex'
    )
    from notification_content_local_qa_identities
    where scope_state = 'in_scope'
  ) <> '9da69d7da440a519239ac7599629c94b27beb0c78ba55bb079e2081a01e2b137' then
    raise exception 'notification_content_local_qa_identity_hash_mismatch'
      using errcode = '55000';
  end if;
end;
$$;

insert into dashboard_private.notification_settings_ui_registry(
  rule_id, workflow_key, workflow_label, workflow_sort,
  event_key, event_label, group_label, trigger_description, event_sort,
  audience_key, audience_label, channel_key, channel_label, cell_sort,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  initial_enabled, source_trigger_kind, configuration_kind, activation_locked
)
select
  dashboard_private.notification_deterministic_uuid_v1(
    'notification-rule-v1',
    pg_catalog.concat_ws(
      '|', 'global', identity.workflow_key, identity.event_key,
      identity.audience_key, identity.channel_key, identity.rule_variant_key
    )
  ),
  identity.workflow_key,
  case identity.workflow_key
    when 'tasks' then '할 일'
    when 'word_retests' then '영어 단어 재시험'
    when 'registration' then '등록'
    when 'transfer' then '전반'
    when 'withdrawal' then '퇴원'
    when 'makeup_requests' then '휴보강'
    when 'approvals' then '전자결재'
  end,
  case identity.workflow_key
    when 'tasks' then 1
    when 'word_retests' then 2
    when 'registration' then 3
    when 'transfer' then 4
    when 'withdrawal' then 5
    when 'makeup_requests' then 6
    when 'approvals' then 7
  end,
  identity.event_key,
  event_catalog.event_label,
  event_catalog.group_label,
  case
    when identity.event_key = 'registration.appointment_reminder_due' then
      case identity.rule_variant_key
        when 'previous_day_at' then '예약 전날 14:00'
        when 'same_day_at' then '예약 당일 14:00'
        when 'offset_before' then '예약 1시간 전'
      end
    else event_catalog.trigger_description
  end,
  event_catalog.event_sort,
  identity.audience_key,
  case
    when identity.event_key = 'registration.appointment_reminder_due'
      and identity.audience_key = 'track_director' then '과목별 상담 책임자'
    when identity.audience_key = 'requester_profile' then '요청자'
    when identity.audience_key = 'primary_assignee' then '주 담당자'
    when identity.audience_key = 'secondary_assignee' then '보조 담당자'
    when identity.audience_key = 'requesting_teacher' then '요청 선생님'
    when identity.audience_key = 'assigned_assistant' then '담당 조교'
    when identity.audience_key = 'approver_profile' then '결재자'
    when identity.audience_key = 'executive_team' then '경영팀'
    when identity.audience_key = 'subject_team' then '과목팀'
    when identity.audience_key = 'management_team'
      and identity.channel_key = 'google_chat'
      and identity.event_key <> 'registration.appointment_reminder_due'
      then '구글챗 · 관리팀'
    when identity.audience_key = 'management_team' then '관리팀'
  end,
  identity.channel_key,
  case identity.channel_key
    when 'in_app' then '대시보드'
    when 'google_chat' then '구글챗'
  end,
  case
    when identity.event_key = 'registration.appointment_reminder_due'
      then identity.variant_position * 10 + identity.cell_position
    else identity.cell_position
  end,
  identity.rule_variant_key,
  case
    when identity.event_key = 'registration.appointment_reminder_due' then 'scheduled'
    else 'immediate'
  end,
  case
    when identity.event_key = 'registration.appointment_reminder_due'
      then identity.rule_variant_key
    else null
  end,
  case identity.rule_variant_key
    when 'previous_day_at' then pg_catalog.jsonb_build_object(
      'anchor_key', 'appointment_scheduled_at',
      'local_time', '14:00',
      'timezone', 'Asia/Seoul'
    )
    when 'same_day_at' then pg_catalog.jsonb_build_object(
      'anchor_key', 'appointment_scheduled_at',
      'local_time', '14:00',
      'timezone', 'Asia/Seoul'
    )
    when 'offset_before' then pg_catalog.jsonb_build_object(
      'anchor_key', 'appointment_scheduled_at',
      'lead_minutes', 60,
      'timezone', 'Asia/Seoul'
    )
    else null
  end,
  identity.enabled_state = 'enabled',
  case identity.event_key
    when 'makeup.submitted' then 'submitted'
    when 'makeup.refund_requested' then 'refund_requested'
    when 'makeup.approved' then 'approved'
    when 'makeup.refund_completed' then 'completed'
    when 'makeup.approval_canceled' then 'canceled'
    when 'makeup.revision_requested' then 'returned'
    when 'makeup.rejected' then 'rejected'
    else null
  end,
  'editable_rule',
  false
from notification_content_local_qa_identities identity
join notification_content_local_qa_event_catalog event_catalog
  on event_catalog.workflow_key = identity.workflow_key
 and event_catalog.event_key = identity.event_key
where identity.scope_state = 'in_scope'
  and identity.configuration_kind = 'editable_rule'
order by identity.group_position, identity.event_position,
  identity.variant_position, identity.cell_position;

do $$
begin
  if (
    select pg_catalog.count(*)
    from dashboard_private.notification_settings_ui_registry
  ) <> 174 then
    raise exception 'notification_content_local_qa_editable_registry_install_incomplete'
      using errcode = '55000';
  end if;
end;
$$;

select dashboard_private.notification_seed_workflow_settings_v1();

do $$
begin
  if (select pg_catalog.count(*) from dashboard_private.notification_rules) <> 174
    or (select pg_catalog.count(*) from dashboard_private.notification_templates) <> 174
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_settings_import_metadata
    ) <> 42
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_settings_import_metadata
      where import_state = 'active'
    ) <> 36
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_settings_import_metadata
      where import_state = 'inactive'
        and inactive_reason = 'inactive_not_used_by_legacy_sender'
    ) <> 6
  then
    raise exception 'notification_content_local_qa_editable_seed_incomplete'
      using errcode = '55000';
  end if;
end;
$$;
-- notification_content_local_qa_fixed_install_begin
create temporary table notification_content_local_qa_fixed_templates
on commit drop
as
select
  identity.*,
  identity.event_key || '|' || identity.audience_key || '|' || identity.channel_key
    as rule_key,
  dashboard_private.notification_deterministic_uuid_v1(
    'registration-handoff-rule-v1',
    identity.event_key || '|' || identity.audience_key || '|' || identity.channel_key
  ) as rule_id,
  dashboard_private.notification_deterministic_uuid_v1(
    'registration-handoff-template-v1',
    identity.event_key || '|' || identity.audience_key || '|' || identity.channel_key || '|1'
  ) as template_id,
  case
    when identity.event_key = 'registration.phone_consultation_ready'
      then '[{subject}] 전화상담 대기'
    when identity.event_key = 'registration.admission_message_requested'
      then '입학신청서 안내'
    when identity.audience_key = 'track_director' then
      case identity.event_key
        when 'registration.visit_scheduled' then '[{subjects}] 방문상담 예약 배정'
        when 'registration.visit_rescheduled' then '[{subjects}] 방문상담 예약 변경'
        when 'registration.visit_replaced' then '[{subjects}] 방문상담 예약 교체'
        when 'registration.visit_subject_deselected' then '[{subjects}] 방문상담 과목 제외'
        when 'registration.visit_canceled' then '[{subjects}] 방문상담 예약 취소'
      end
    else
      case identity.event_key
        when 'registration.visit_scheduled' then '방문상담 예약 배정 · {student_name}'
        when 'registration.visit_rescheduled' then '방문상담 예약 변경 · {student_name}'
        when 'registration.visit_replaced' then '방문상담 예약 교체 · {student_name}'
        when 'registration.visit_subject_deselected' then '방문상담 과목 제외 · {student_name}'
        when 'registration.visit_canceled' then '방문상담 예약 취소 · {student_name}'
      end
  end as title_template,
  case
    when identity.event_key = 'registration.phone_consultation_ready'
      then '{student_name} 학생 상담을 확인하세요.'
    when identity.event_key = 'registration.admission_message_requested'
      then '{student_name} 학생 입학신청서 안내'
    when identity.audience_key = 'track_director'
      then '{student_name} 학생 · {scheduled_at} · {place}'
    else '{subjects} · {scheduled_at} · {place}'
  end as body_template,
  case
    when identity.event_key = 'registration.phone_consultation_ready' then
      '[
        {"key":"subject","token":"subject","pii_class":"none"},
        {"key":"student_name","token":"student_name","pii_class":"student_name"}
      ]'::jsonb
    when identity.event_key = 'registration.admission_message_requested' then
      '[{"key":"student_name","token":"student_name","pii_class":"student_name"}]'::jsonb
    else
      '[
        {"key":"subjects","token":"subjects","pii_class":"none"},
        {"key":"student_name","token":"student_name","pii_class":"student_name"},
        {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
        {"key":"place","token":"place","pii_class":"location"}
      ]'::jsonb
  end as allowed_variables,
  2 as payload_schema_version
from notification_content_local_qa_identities identity
where identity.configuration_kind = 'fixed_policy_editable_template'
   or identity.scope_state = 'excluded_channel';

insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  enabled, active_template_id, revision,
  created_by, created_actor_kind, updated_by, updated_actor_kind
)
select
  fixed.rule_id,
  'global',
  fixed.workflow_key,
  fixed.event_key,
  fixed.channel_key,
  fixed.audience_key,
  fixed.rule_variant_key,
  'immediate',
  null,
  null,
  true,
  fixed.template_id,
  1,
  null,
  'system',
  null,
  'system'
from notification_content_local_qa_fixed_templates fixed
order by fixed.rule_key;

insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind,
  content_contract_version
)
select
  fixed.template_id,
  fixed.rule_id,
  1,
  fixed.title_template,
  fixed.body_template,
  fixed.allowed_variables,
  fixed.payload_schema_version,
  dashboard_private.notification_seed_template_checksum_v1(
    fixed.title_template,
    fixed.body_template,
    fixed.allowed_variables,
    fixed.payload_schema_version
  ),
  null,
  'system',
  null
from notification_content_local_qa_fixed_templates fixed
order by fixed.rule_key;

insert into dashboard_private.notification_settings_ui_registry(
  rule_id, workflow_key, workflow_label, workflow_sort,
  event_key, event_label, group_label, trigger_description, event_sort,
  audience_key, audience_label, channel_key, channel_label, cell_sort,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  initial_enabled, source_trigger_kind, configuration_kind, activation_locked
)
select
  fixed.rule_id,
  'registration',
  '등록',
  3,
  fixed.event_key,
  event_catalog.event_label,
  event_catalog.group_label,
  event_catalog.trigger_description,
  event_catalog.event_sort,
  fixed.audience_key,
  case fixed.audience_key
    when 'track_director' then '트랙 담당자'
    when 'management_team' then '관리팀'
  end,
  fixed.channel_key,
  case fixed.channel_key
    when 'in_app' then '대시보드'
    when 'google_chat' then 'Google Chat'
  end,
  case fixed.audience_key
    when 'track_director' then 1
    else 2
  end,
  'immediate',
  'immediate',
  null,
  null,
  true,
  null,
  'fixed_policy_editable_template',
  true
from notification_content_local_qa_fixed_templates fixed
join notification_content_local_qa_event_catalog event_catalog
  on event_catalog.workflow_key = fixed.workflow_key
 and event_catalog.event_key = fixed.event_key
where fixed.scope_state = 'in_scope'
order by event_catalog.event_sort, fixed.audience_key;

do $$
begin
  if (select pg_catalog.count(*) from dashboard_private.notification_settings_ui_registry) <> 185
    or (select pg_catalog.count(*) from dashboard_private.notification_rules) <> 186
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_templates
      where content_contract_version is null
    ) <> 186
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_settings_ui_registry
      where configuration_kind = 'fixed_policy_editable_template'
        and activation_locked
    ) <> 11
  then
    raise exception 'notification_content_local_qa_fixed_seed_incomplete'
      using errcode = '55000';
  end if;
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
  contract_json,
  created_at
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
  ),
  '2026-08-04 00:00:00+00'
from dashboard_private.notification_settings_ui_registry registry
order by registry.workflow_sort, registry.event_sort, registry.cell_sort, registry.rule_id;

do $$
declare
  contract_row record;
begin
  for contract_row in
    select
      contract.rule_id,
      rule_row.active_template_id
    from dashboard_private.notification_rule_content_contracts contract
    join dashboard_private.notification_rules rule_row
      on rule_row.id = contract.rule_id
    order by contract.rule_id
  loop
    perform dashboard_private.notification_template_compliance_v1(
      contract_row.rule_id,
      contract_row.active_template_id
    );
  end loop;
end;
$$;

select dashboard_private.install_notification_system_templates_vnext_v1();

-- notification_content_local_qa_verify_begin
do $$
declare
  relation_name text;
  relation_oid regclass;
  relation_count bigint;
  operational_relations constant text[] := array[
    'public.approval_comments',
    'public.approval_events',
    'public.approval_requests',
    'public.approval_templates',
    'public.classes',
    'public.dashboard_notifications',
    'public.dashboard_notification_read_receipts',
    'public.dashboard_push_subscriptions',
    'public.google_chat_webhook_settings',
    'public.makeup_notification_deliveries',
    'public.makeup_request_events',
    'public.makeup_requests',
    'public.ops_task_attachments',
    'public.ops_task_comments',
    'public.ops_task_events',
    'public.ops_tasks',
    'public.students',
    'dashboard_private.notification_audit_logs',
    'dashboard_private.notification_contract_deployment_receipts',
    'dashboard_private.notification_contract_route_outcomes',
    'dashboard_private.notification_contract_traffic',
    'dashboard_private.notification_deliveries',
    'dashboard_private.notification_dispatch_ownership_claims',
    'dashboard_private.notification_event_fanout_jobs',
    'dashboard_private.notification_events',
    'dashboard_private.notification_makeup_legacy_imports',
    'dashboard_private.notification_makeup_reconcile_audits',
    'dashboard_private.notification_makeup_retention_observations',
    'dashboard_private.notification_makeup_retention_snapshots',
    'dashboard_private.notification_request_ledger',
    'dashboard_private.notification_rule_reconciliation_jobs',
    'dashboard_private.notification_target_reconciliation_jobs',
    'dashboard_private.notification_worker_heartbeats'
  ];
begin
  if (select pg_catalog.count(*) from auth.users) <> 1
    or not exists (
      select 1
      from auth.users user_row
      where user_row.id = '31500000-0000-4000-8000-000000000001'
        and user_row.email = 'notification-content-local-qa@runtime.invalid'
    )
    or (select pg_catalog.count(*) from public.profiles) <> 1
    or not exists (
      select 1
      from public.profiles profile_row
      where profile_row.id = '31500000-0000-4000-8000-000000000001'
        and profile_row.email = 'notification-content-local-qa@runtime.invalid'
        and profile_row.role = 'admin'
    )
  then
    raise exception 'notification_content_local_qa_actor_mismatch'
      using errcode = '55000';
  end if;

  if (select pg_catalog.count(*) from dashboard_private.notification_settings_ui_registry) <> 185
    or (select pg_catalog.count(*) from dashboard_private.notification_rules) <> 186
    or (select pg_catalog.count(*) from dashboard_private.notification_templates) <> 371
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_templates
      where content_contract_version is null
    ) <> 186
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_templates
      where content_contract_version = '1'
    ) <> 185
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_rule_content_contracts
    ) <> 185
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_template_compliance_audits
    ) <> 185
    or (
      select pg_catalog.count(*)
      from public.makeup_notification_settings
    ) <> 42
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_settings_import_metadata
    ) <> 42
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_runtime_flags
    ) <> 12
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags
      where enabled
    )
    or (
      select pg_catalog.count(*)
      from dashboard_private.registration_appointment_reminder_applicability
    ) <> 4
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_contract_bridge_state
      where state_key = 'legacy_contract_bridge_v1'
        and closed_at is null
    ) <> 1
  then
    raise exception 'notification_content_local_qa_exact_count_mismatch'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.count(distinct workflow_key)
    from dashboard_private.notification_settings_ui_registry
  ) <> 7
    or (
      select pg_catalog.count(distinct (workflow_key, event_key))
      from dashboard_private.notification_settings_ui_registry
    ) <> 48
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_settings_ui_registry
      where initial_enabled
    ) <> 50
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_rules
      where enabled
    ) <> 51
  then
    raise exception 'notification_content_local_qa_workflow_shape_mismatch'
      using errcode = '55000';
  end if;

  if exists (
    with expected(workflow_key, expected_count) as (
      values
        ('approvals'::text, 36::bigint),
        ('makeup_requests'::text, 32::bigint),
        ('registration'::text, 23::bigint),
        ('tasks'::text, 40::bigint),
        ('transfer'::text, 2::bigint),
        ('withdrawal'::text, 2::bigint),
        ('word_retests'::text, 50::bigint)
    ), actual as (
      select workflow_key, pg_catalog.count(*) as actual_count
      from dashboard_private.notification_settings_ui_registry
      group by workflow_key
    )
    select 1
    from expected
    full join actual using (workflow_key)
    where expected.expected_count is distinct from actual.actual_count
  ) then
    raise exception 'notification_content_local_qa_registry_workflow_count_mismatch'
      using errcode = '55000';
  end if;

  if exists (
    with expected(workflow_key, expected_count) as (
      values
        ('approvals'::text, 36::bigint),
        ('makeup_requests'::text, 32::bigint),
        ('registration'::text, 24::bigint),
        ('tasks'::text, 40::bigint),
        ('transfer'::text, 2::bigint),
        ('withdrawal'::text, 2::bigint),
        ('word_retests'::text, 50::bigint)
    ), actual as (
      select workflow_key, pg_catalog.count(*) as actual_count
      from dashboard_private.notification_rules
      group by workflow_key
    )
    select 1
    from expected
    full join actual using (workflow_key)
    where expected.expected_count is distinct from actual.actual_count
  ) then
    raise exception 'notification_content_local_qa_rule_workflow_count_mismatch'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.string_agg(identity_key, E'\n' order by identity_key collate "C"),
          'UTF8'
        )
      ),
      'hex'
    )
    from (
      select pg_catalog.concat_ws(
        '|',
        registry.workflow_key,
        registry.event_key,
        registry.audience_key,
        registry.channel_key,
        registry.rule_variant_key
      ) as identity_key
      from dashboard_private.notification_settings_ui_registry registry
    ) identities
  ) <> '9da69d7da440a519239ac7599629c94b27beb0c78ba55bb079e2081a01e2b137' then
    raise exception 'notification_content_local_qa_registry_identity_hash_mismatch'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from dashboard_private.notification_rules rule_row
    join dashboard_private.notification_templates active_template
      on active_template.id = rule_row.active_template_id
     and active_template.rule_id = rule_row.id
    join dashboard_private.notification_templates vnext_template
      on vnext_template.id = 'c54c781a-9bcf-5aee-8f2c-91e63516828b'
     and vnext_template.rule_id = rule_row.id
     and vnext_template.content_contract_version = '1'
    where rule_row.id = '08c5fd0c-36bb-5798-869a-1f9ff46a902a'
      and rule_row.active_template_id = '222914cb-f640-55b9-862c-0343f547480d'
      and active_template.content_contract_version is null
  ) then
    raise exception 'notification_content_local_qa_round_trip_identity_mismatch'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from dashboard_private.notification_settings_ui_registry registry
    join dashboard_private.notification_rules rule_row
      on rule_row.id = registry.rule_id
    join dashboard_private.notification_templates active_template
      on active_template.id = rule_row.active_template_id
     and active_template.rule_id = rule_row.id
    left join dashboard_private.notification_rule_content_contracts contract
      on contract.rule_id = registry.rule_id
    left join dashboard_private.notification_templates vnext_template
      on vnext_template.id = dashboard_private.notification_deterministic_uuid_v1(
        'notification-template-vnext-v1',
        registry.rule_id::text || '|content-contract-' || contract.contract_version
      )
     and vnext_template.rule_id = registry.rule_id
    where active_template.content_contract_version is not null
      or contract.rule_id is null
      or vnext_template.id is null
      or vnext_template.content_contract_version <> '1'
  ) then
    raise exception 'notification_content_local_qa_contract_graph_incomplete'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.count(*)
    from dashboard_private.notification_settings_ui_registry
    where configuration_kind = 'fixed_policy_editable_template'
      and activation_locked
  ) <> 11
    or exists (
      select 1
      from dashboard_private.notification_settings_ui_registry
      where configuration_kind = 'editable_rule'
        and activation_locked
    )
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_rules
      where channel_key = 'customer_message'
    ) <> 1
    or exists (
      select 1
      from dashboard_private.notification_settings_ui_registry
      where channel_key = 'customer_message'
    )
  then
    raise exception 'notification_content_local_qa_scope_policy_mismatch'
      using errcode = '55000';
  end if;

  if (
    select pg_catalog.count(*)
    from dashboard_private.notification_settings_import_metadata
    where import_state = 'active'
  ) <> 36
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_settings_import_metadata
      where import_state = 'inactive'
        and inactive_reason = 'inactive_not_used_by_legacy_sender'
        and pg_catalog.jsonb_array_length(mapped_rule_ids) = 0
    ) <> 6
  then
    raise exception 'notification_content_local_qa_import_metadata_mismatch'
      using errcode = '55000';
  end if;

  foreach relation_name in array operational_relations loop
    relation_oid := pg_catalog.to_regclass(relation_name);
    if relation_oid is null then
      raise exception 'notification_content_local_qa_operational_relation_missing:%', relation_name
        using errcode = '55000';
    end if;

    execute pg_catalog.format('select pg_catalog.count(*) from %s', relation_oid)
      into relation_count;
    if relation_count <> 0 then
      raise exception 'notification_content_local_qa_operational_rows_present:%:%',
        relation_name, relation_count
        using errcode = '55000';
    end if;
  end loop;
end;
$$;

commit;
