begin;

set local lock_timeout = '5s';

create or replace function dashboard_private.notification_system_template_vnext_payload_v1(
  p_event_key text
)
returns table (
  workflow_key text,
  event_key text,
  title_template text,
  body_template text
)
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select
    template.item ->> 'workflowKey',
    template.item ->> 'eventKey',
    template.item ->> 'titleTemplate',
    template.item ->> 'bodyTemplate'
  from pg_catalog.jsonb_array_elements(
    (
      -- notification_system_template_vnext_fixture_begin
      $notification_system_templates$
[
  {
    "workflowKey": "tasks",
    "eventKey": "task.created",
    "titleTemplate": "📥 [할 일] 할 일이 등록됐어요 · {task_title}",
    "bodyTemplate": "[업무] {task_title}\n[상태] {current_status} · 담당 {current_assignee}\n{memo_line}\n{progress_line}"
  },
  {
    "workflowKey": "tasks",
    "eventKey": "task.assignee_changed",
    "titleTemplate": "🔄 [할 일] 담당자가 바뀌었어요 · {task_title}",
    "bodyTemplate": "[업무] {task_title}\n[변경] {before_assignee} → {after_assignee}\n{progress_line}"
  },
  {
    "workflowKey": "tasks",
    "eventKey": "task.due_changed",
    "titleTemplate": "🔄 [할 일] 일정이 바뀌었어요 · {task_title}",
    "bodyTemplate": "[업무] {task_title}\n[변경] {before_schedule} → {after_schedule}\n{progress_line}"
  },
  {
    "workflowKey": "tasks",
    "eventKey": "task.status_changed",
    "titleTemplate": "🔄 [할 일] 상태가 바뀌었어요 · {task_title}",
    "bodyTemplate": "[업무] {task_title}\n[변경] {before_status} → {after_status}\n{progress_line}"
  },
  {
    "workflowKey": "tasks",
    "eventKey": "task.completed",
    "titleTemplate": "✅ [할 일] 할 일이 완료됐어요 · {task_title}",
    "bodyTemplate": "[업무] {task_title}\n[상태] {completion_status}\n{memo_line}"
  },
  {
    "workflowKey": "tasks",
    "eventKey": "task.canceled",
    "titleTemplate": "⛔ [할 일] 할 일이 취소됐어요 · {task_title}",
    "bodyTemplate": "[업무] {task_title}\n[상태] {cancellation_status}\n{reason_line}\n{memo_line}"
  },
  {
    "workflowKey": "tasks",
    "eventKey": "task.reopened",
    "titleTemplate": "🔄 [할 일] 할 일이 다시 열렸어요 · {task_title}",
    "bodyTemplate": "[업무] {task_title}\n[변경] {before_status} → {after_status}\n{progress_line}"
  },
  {
    "workflowKey": "tasks",
    "eventKey": "task.comment_added",
    "titleTemplate": "💬 [할 일] 댓글이 등록됐어요 · {task_title}",
    "bodyTemplate": "[업무] {task_title}\n[댓글] {comment_author} · {comment_preview}\n{attachment_line}\n{progress_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.created",
    "titleTemplate": "📥 [단어 재시험] {student_name}의 재시험이 등록됐어요",
    "bodyTemplate": "[학생] {student_name}\n[수업] {class_name}\n[시험] {test_scope}\n[일정] {test_date}\n{progress_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.assigned",
    "titleTemplate": "🔄 [단어 재시험] {student_name}의 담당자가 바뀌었어요",
    "bodyTemplate": "[학생] {student_name}\n[변경] {before_assignee} → {after_assignee}\n{progress_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.schedule_changed",
    "titleTemplate": "🔄 [단어 재시험] {student_name}의 시험 일정이 바뀌었어요",
    "bodyTemplate": "[학생] {student_name}\n[변경] {before_test_date} → {after_test_date}\n{progress_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.started",
    "titleTemplate": "▶️ [단어 재시험] {student_name}의 재시험 처리가 시작됐어요",
    "bodyTemplate": "[학생] {student_name}\n[수업] {class_name}\n[시험] {test_scope}\n[상태] {start_status}\n{progress_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.result_reported",
    "titleTemplate": "📝 [단어 재시험] {student_name}의 재시험 결과가 기록됐어요",
    "bodyTemplate": "[학생] {student_name}\n[결과] {score} / 통과 기준 {pass_threshold} · {result}\n{memo_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.absent_reported",
    "titleTemplate": "⛔ [단어 재시험] {student_name}이 미응시로 기록됐어요",
    "bodyTemplate": "[학생] {student_name}\n[일정] {test_date}\n[결과] {result}\n{reason_line}\n{memo_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.revision_requested",
    "titleTemplate": "↩️ [단어 재시험] {student_name}의 결과 보완 요청이 등록됐어요",
    "bodyTemplate": "[학생] {student_name}\n[결과] {current_result}\n[상태] {request_actor}의 결과 보완 요청이 등록됐어요.\n{reason_line}\n{progress_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.retry_created",
    "titleTemplate": "📥 [단어 재시험] {student_name}의 후속 재시험이 등록됐어요",
    "bodyTemplate": "[학생] {student_name}\n[결과] 이전 재시험 {previous_result}\n[일정] 후속 재시험 {followup_schedule}\n{progress_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.completed",
    "titleTemplate": "✅ [단어 재시험] {student_name}의 재시험 업무가 완료됐어요",
    "bodyTemplate": "[학생] {student_name}\n[결과] {final_result}\n{memo_line}"
  },
  {
    "workflowKey": "word_retests",
    "eventKey": "word_retest.canceled",
    "titleTemplate": "⛔ [단어 재시험] {student_name}의 재시험이 취소됐어요",
    "bodyTemplate": "[학생] {student_name}\n[상태] {cancellation_status}\n{reason_line}"
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.case_created",
    "titleTemplate": "📥 [등록] {student_name}의 등록 문의가 들어왔어요",
    "bodyTemplate": "[학생] {student_name} · {grade}\n[과목] {subjects}\n[문의] {inquiry_at}\n{memo_line}\n{progress_line}"
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.registration_completed",
    "titleTemplate": "✅ [등록] {student_name}의 등록 처리가 완료됐어요",
    "bodyTemplate": "[과목] {registered_subjects}\n[수업] {registered_classes}\n[상태] {completion_status}\n{progress_line}"
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.case_closed",
    "titleTemplate": "⛔ [등록] {student_name}의 등록 문의가 종료됐어요",
    "bodyTemplate": "[학생] {student_name}\n[과목] {subjects}\n[상태] {close_status}\n{reason_line}\n{memo_line}"
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.appointment_reminder_due",
    "titleTemplate": "⏰ [등록] {student_name}의 상담 일정이 예정되어 있어요",
    "bodyTemplate": "[상담] {appointment_kind}\n[학생] {student_name}\n[과목] {subjects}\n[일정] {scheduled_at}\n[장소] {place}\n{progress_line}"
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.phone_consultation_ready",
    "titleTemplate": "☎️ [등록] {student_name}의 전화상담을 기다리고 있어요",
    "bodyTemplate": "[학생] {student_name}\n[과목] {subjects}\n[진행] {progress_actor}의 전화상담 확인을 기다리고 있어요."
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.visit_scheduled",
    "titleTemplate": "📅 [등록] {student_name}의 방문상담이 예약됐어요",
    "bodyTemplate": "[학생] {student_name}\n[과목] {subjects}\n[일정] {after_schedule}\n[장소] {after_place}\n{progress_line}"
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.visit_rescheduled",
    "titleTemplate": "🔄 [등록] {student_name}의 방문상담 일정이 바뀌었어요",
    "bodyTemplate": "[학생] {student_name}\n[과목] {subjects}\n[변경] {before_schedule} → {after_schedule}\n[장소] {after_place}\n{progress_line}"
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.visit_replaced",
    "titleTemplate": "🔄 [등록] {student_name}의 방문상담 예약이 교체됐어요",
    "bodyTemplate": "[학생] {student_name}\n[과목] {subjects}\n[변경] {before_appointment} → {after_appointment}\n[장소] {after_place}\n{progress_line}"
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.visit_subject_deselected",
    "titleTemplate": "➖ [등록] {student_name}의 방문상담 과목이 제외됐어요",
    "bodyTemplate": "[학생] {student_name}\n[제외] {deselected_subjects}\n[남은 과목] {other_active_subjects}\n[일정] {retained_schedule}\n[장소] {retained_place}\n{progress_line}"
  },
  {
    "workflowKey": "registration",
    "eventKey": "registration.visit_canceled",
    "titleTemplate": "⛔ [등록] {student_name}의 방문상담이 취소됐어요",
    "bodyTemplate": "[학생] {student_name}\n[과목] {subjects}\n[일정] {canceled_schedule}\n[장소] {canceled_place}\n{reason_line}\n{progress_line}"
  },
  {
    "workflowKey": "transfer",
    "eventKey": "transfer.submitted",
    "titleTemplate": "📥 [전반] {student_name}의 반 이동 신청이 들어왔어요",
    "bodyTemplate": "[변경] {before_class} → {after_class}\n[일정] {effective_date}부터 이동 예정이에요.\n[신청] {requester_name}\n{reason_line}\n{memo_line}\n{progress_line}"
  },
  {
    "workflowKey": "transfer",
    "eventKey": "transfer.completed",
    "titleTemplate": "✅ [전반] {student_name}의 반 이동이 완료됐어요",
    "bodyTemplate": "[변경] {before_class} → {after_class}\n[일정] 기존 반 {before_class_end_date}까지 · 새 반 {after_class_start_date}부터\n{progress_line}"
  },
  {
    "workflowKey": "withdrawal",
    "eventKey": "withdrawal.submitted",
    "titleTemplate": "📥 [수강 제외] {student_name}의 {subjects} 수강 제외 신청이 들어왔어요",
    "bodyTemplate": "[수업] {class_name}\n[일정] {withdrawal_date} · {withdrawal_round}부터 제외 예정이에요.\n[신청] {requester_name}\n{reason_line}\n{memo_line}\n{progress_line}"
  },
  {
    "workflowKey": "withdrawal",
    "eventKey": "withdrawal.completed",
    "titleTemplate": "✅ [수강 제외] {student_name}의 {subjects} 수강 제외 처리가 끝났어요",
    "bodyTemplate": "[수업] {class_name}\n[일정] {withdrawal_date} · {withdrawal_round}부터 제외\n{progress_line}"
  },
  {
    "workflowKey": "makeup_requests",
    "eventKey": "makeup.submitted",
    "titleTemplate": "📥 [휴보강] {class_name} {subjects} 휴보강 신청이 들어왔어요",
    "bodyTemplate": "[수업] {subjects} · {teacher_name} 선생님 담당\n[일정] 휴강 {cancellation_date} → 보강 {makeup_schedule}\n[장소] {place}\n{reason_line}\n{memo_line}\n[진행] {progress_actor}의 결재를 기다리고 있어요."
  },
  {
    "workflowKey": "makeup_requests",
    "eventKey": "makeup.refund_requested",
    "titleTemplate": "💳 [휴보강] {class_name} {subjects} 휴보강 환불 신청이 들어왔어요",
    "bodyTemplate": "[수업] {subjects} · {class_name}\n[대상] {target_schedule}\n[상태] {current_status}\n{reason_line}\n{progress_line}"
  },
  {
    "workflowKey": "makeup_requests",
    "eventKey": "makeup.approved",
    "titleTemplate": "✅ [휴보강] {class_name} {subjects} 휴보강 신청이 승인됐어요",
    "bodyTemplate": "[수업] {subjects} · {class_name}\n[일정] 휴강 {cancellation_date} → 보강 {makeup_schedule}\n[장소] {place}\n[승인] {approval_actor}\n{memo_line}"
  },
  {
    "workflowKey": "makeup_requests",
    "eventKey": "makeup.refund_completed",
    "titleTemplate": "✅ [휴보강] {class_name} {subjects} 휴보강 환불 처리가 끝났어요",
    "bodyTemplate": "[수업] {subjects} · {class_name}\n[상태] {current_status}\n[처리] {processed_at}\n{memo_line}"
  },
  {
    "workflowKey": "makeup_requests",
    "eventKey": "makeup.approval_canceled",
    "titleTemplate": "↩️ [휴보강] {class_name} {subjects} 휴보강 승인이 취소됐어요",
    "bodyTemplate": "[수업] {subjects} · {class_name}\n[상태] {current_status}\n[처리] {processed_at} · {processing_actor}\n{reason_line}\n{memo_line}"
  },
  {
    "workflowKey": "makeup_requests",
    "eventKey": "makeup.revision_requested",
    "titleTemplate": "📝 [휴보강] {class_name} {subjects} 휴보강 보완 요청이 등록됐어요",
    "bodyTemplate": "[수업] {subjects} · {class_name}\n[상태] {current_status}\n[요청] {request_actor}\n{reason_line}\n{progress_line}"
  },
  {
    "workflowKey": "makeup_requests",
    "eventKey": "makeup.rejected",
    "titleTemplate": "⛔ [휴보강] {class_name} {subjects} 휴보강 신청이 반려됐어요",
    "bodyTemplate": "[수업] {subjects} · {class_name}\n[상태] {current_status}\n[반려] {return_actor}\n{reason_line}\n{memo_line}"
  },
  {
    "workflowKey": "approvals",
    "eventKey": "approval.created",
    "titleTemplate": "📝 [전자결재] {document_title}가 작성됐어요",
    "bodyTemplate": "[문서] {document_title} · 작성자 {author_name}\n[기간] {target_period}\n[상태] {current_status}\n{attachment_line}\n{memo_line}"
  },
  {
    "workflowKey": "approvals",
    "eventKey": "approval.submitted",
    "titleTemplate": "📥 [전자결재] {document_title}가 제출됐어요",
    "bodyTemplate": "[문서] {document_title} · 작성자 {author_name}\n[기간] {target_period}\n[진행] {progress_actor}의 결재를 기다리고 있어요.\n{attachment_line}"
  },
  {
    "workflowKey": "approvals",
    "eventKey": "approval.review_started",
    "titleTemplate": "👀 [전자결재] {document_title} 검토가 시작됐어요",
    "bodyTemplate": "[문서] {document_title}\n[검토] {reviewer_name}\n[상태] {current_status}\n{memo_line}"
  },
  {
    "workflowKey": "approvals",
    "eventKey": "approval.approver_changed",
    "titleTemplate": "🔄 [전자결재] {document_title} 결재자가 바뀌었어요",
    "bodyTemplate": "[문서] {document_title}\n[변경] {before_approver} → {after_approver}\n{progress_line}"
  },
  {
    "workflowKey": "approvals",
    "eventKey": "approval.approved",
    "titleTemplate": "✅ [전자결재] {document_title} 결재가 승인됐어요",
    "bodyTemplate": "[문서] {document_title}\n[승인] {approval_actor}\n[상태] {current_status}\n[처리] {processed_at}\n{memo_line}"
  },
  {
    "workflowKey": "approvals",
    "eventKey": "approval.returned",
    "titleTemplate": "↩️ [전자결재] {document_title} 결재가 반려됐어요",
    "bodyTemplate": "[문서] {document_title}\n[반려] {return_actor}\n[상태] {current_status}\n{reason_line}\n{memo_line}"
  },
  {
    "workflowKey": "approvals",
    "eventKey": "approval.canceled",
    "titleTemplate": "🚫 [전자결재] {document_title} 결재가 취소됐어요",
    "bodyTemplate": "[문서] {document_title}\n[취소] {cancel_actor}\n[상태] {current_status}\n{reason_line}\n{memo_line}"
  },
  {
    "workflowKey": "approvals",
    "eventKey": "approval.resubmitted",
    "titleTemplate": "🔁 [전자결재] {document_title}가 다시 제출됐어요",
    "bodyTemplate": "[문서] {document_title}\n[재상신] {resubmitter_name}\n[진행] {progress_actor}의 결재를 기다리고 있어요.\n{attachment_line}"
  },
  {
    "workflowKey": "approvals",
    "eventKey": "approval.comment_added",
    "titleTemplate": "💬 [전자결재] {document_title}에 댓글이 등록됐어요",
    "bodyTemplate": "[문서] {document_title}\n[댓글] {comment_author} · {comment_preview}\n{attachment_line}\n{progress_line}"
  }
]
$notification_system_templates$::jsonb
      -- notification_system_template_vnext_fixture_end
    )
  ) template(item)
  where template.item ->> 'eventKey' = p_event_key;
$$;

create or replace function dashboard_private.install_notification_system_templates_vnext_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_expected_count bigint;
  v_inserted_count bigint;
begin
  select pg_catalog.count(*)
  into v_expected_count
  from dashboard_private.notification_settings_ui_registry registry
  join dashboard_private.notification_rule_content_contracts contract_row
    on contract_row.rule_id = registry.rule_id
   and contract_row.workflow_key = registry.workflow_key
   and contract_row.event_key = registry.event_key
   and contract_row.audience_key = registry.audience_key
   and contract_row.channel_key = registry.channel_key
   and contract_row.rule_variant_key = registry.rule_variant_key
  where registry.channel_key <> 'customer_message';

  if exists (
    select 1
    from dashboard_private.notification_settings_ui_registry registry
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = registry.rule_id
    left join lateral dashboard_private.notification_system_template_vnext_payload_v1(
      registry.event_key
    ) payload on true
    where registry.channel_key <> 'customer_message'
      and (
        payload.event_key is null
        or payload.workflow_key <> registry.workflow_key
        or nullif(pg_catalog.btrim(payload.title_template), '') is null
        or nullif(pg_catalog.btrim(payload.body_template), '') is null
        or pg_catalog.jsonb_array_length(
          dashboard_private.notification_template_contract_violations_v1(
            registry.rule_id,
            payload.title_template,
            payload.body_template
          )
        ) <> 0
      )
  ) then
    raise exception 'notification_system_template_vnext_fixture_invalid'
      using errcode = '55000';
  end if;

  with candidates as (
    select
      registry.rule_id,
      payload.title_template,
      payload.body_template,
      contract_row.contract_json -> 'availableVariables' as allowed_variables,
      (
        select pg_catalog.max(payload_version.value::integer)
        from pg_catalog.jsonb_array_elements_text(
          contract_row.contract_json -> 'supportedPayloadVersions'
        ) payload_version(value)
      ) as payload_schema_version,
      contract_row.contract_version,
      dashboard_private.notification_deterministic_uuid_v1(
        'notification-template-vnext-v1',
        registry.rule_id::text || '|content-contract-' || contract_row.contract_version
      ) as template_id,
      next_version.version
    from dashboard_private.notification_settings_ui_registry registry
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = registry.rule_id
     and contract_row.workflow_key = registry.workflow_key
     and contract_row.event_key = registry.event_key
     and contract_row.audience_key = registry.audience_key
     and contract_row.channel_key = registry.channel_key
     and contract_row.rule_variant_key = registry.rule_variant_key
    cross join lateral dashboard_private.notification_system_template_vnext_payload_v1(
      registry.event_key
    ) payload
    cross join lateral (
      select coalesce(pg_catalog.max(existing_template.version), 0) + 1 as version
      from dashboard_private.notification_templates existing_template
      where existing_template.rule_id = registry.rule_id
    ) next_version
    where registry.channel_key <> 'customer_message'
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
    candidate.template_id,
    candidate.rule_id,
    candidate.version,
    candidate.title_template,
    candidate.body_template,
    candidate.allowed_variables,
    candidate.payload_schema_version,
    dashboard_private.notification_seed_template_checksum_v1(
      candidate.title_template,
      candidate.body_template,
      candidate.allowed_variables,
      candidate.payload_schema_version
    ),
    null,
    'system',
    candidate.contract_version
  from candidates candidate
  order by candidate.rule_id
  on conflict (id) do nothing;

  get diagnostics v_inserted_count = row_count;

  if (
    select pg_catalog.count(*)
    from dashboard_private.notification_settings_ui_registry registry
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = registry.rule_id
    join lateral dashboard_private.notification_system_template_vnext_payload_v1(
      registry.event_key
    ) payload on true
    join dashboard_private.notification_templates template_row
      on template_row.id = dashboard_private.notification_deterministic_uuid_v1(
        'notification-template-vnext-v1',
        registry.rule_id::text || '|content-contract-' || contract_row.contract_version
      )
     and template_row.rule_id = registry.rule_id
    where registry.channel_key <> 'customer_message'
      and template_row.title_template = payload.title_template
      and template_row.body_template = payload.body_template
      and template_row.allowed_variables = contract_row.contract_json -> 'availableVariables'
      and template_row.payload_schema_version = (
        select pg_catalog.max(payload_version.value::integer)
        from pg_catalog.jsonb_array_elements_text(
          contract_row.contract_json -> 'supportedPayloadVersions'
        ) payload_version(value)
      )
      and template_row.content_contract_version = contract_row.contract_version
      and template_row.checksum = dashboard_private.notification_seed_template_checksum_v1(
        payload.title_template,
        payload.body_template,
        contract_row.contract_json -> 'availableVariables',
        (
          select pg_catalog.max(payload_version.value::integer)
          from pg_catalog.jsonb_array_elements_text(
            contract_row.contract_json -> 'supportedPayloadVersions'
          ) payload_version(value)
        )
      )
      and template_row.created_by is null
      and template_row.created_actor_kind = 'system'
  ) <> v_expected_count then
    raise exception 'notification_system_template_vnext_install_incomplete'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'expected_count', v_expected_count,
    'inserted_count', v_inserted_count
  );
end;
$$;

select dashboard_private.install_notification_system_templates_vnext_v1();

create or replace function public.audit_notification_content_templates_v1(
  p_audit_key text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_contract_violations jsonb;
  v_violations jsonb;
  v_compliance text;
  v_items jsonb := '[]'::jsonb;
  v_conformant_count bigint := 0;
  v_nonconformant_count bigint := 0;
  v_approved_baseline_template_id uuid;
  v_expected_payload_schema_version integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'notification_service_role_required'
      using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_audit_key, '')), '') is null
    or p_request_id is null
  then
    raise exception 'notification_content_template_audit_request_invalid'
      using errcode = '22023';
  end if;

  for v_row in
    select
      registry.workflow_label,
      registry.event_label,
      registry.channel_label,
      registry.audience_label,
      case registry.rule_variant_key
        when 'immediate' then '즉시'
        when 'offset_before' then '일정 전'
        when 'previous_day_at' then '전날'
        when 'same_day_at' then '당일'
        else registry.rule_variant_key
      end as rule_variant_label,
      rule_row.id as rule_id,
      active_template.id as active_template_id,
      active_template.title_template,
      active_template.body_template,
      active_template.allowed_variables,
      active_template.payload_schema_version,
      active_template.content_contract_version,
      active_template.checksum,
      active_template.created_actor_kind,
      contract_row.contract_version,
      contract_row.contract_json,
      baseline_template.id as approved_baseline_template_id,
      baseline_template.title_template as baseline_title_template,
      baseline_template.body_template as baseline_body_template,
      baseline_template.allowed_variables as baseline_allowed_variables,
      baseline_template.payload_schema_version as baseline_payload_schema_version,
      baseline_template.content_contract_version as baseline_content_contract_version,
      baseline_template.checksum as baseline_checksum,
      baseline_template.created_actor_kind as baseline_created_actor_kind
    from dashboard_private.notification_settings_ui_registry registry
    join dashboard_private.notification_rules rule_row
      on rule_row.id = registry.rule_id
    join dashboard_private.notification_templates active_template
      on active_template.id = rule_row.active_template_id
     and active_template.rule_id = rule_row.id
    join dashboard_private.notification_rule_content_contracts contract_row
      on contract_row.rule_id = rule_row.id
    left join dashboard_private.notification_templates baseline_template
      on baseline_template.id = dashboard_private.notification_deterministic_uuid_v1(
        'notification-template-vnext-v1',
        rule_row.id::text || '|content-contract-' || contract_row.contract_version
      )
     and baseline_template.rule_id = rule_row.id
    where registry.channel_key <> 'customer_message'
    order by
      registry.workflow_sort,
      registry.event_sort,
      registry.cell_sort,
      registry.rule_variant_key,
      registry.rule_id
  loop
    v_approved_baseline_template_id := v_row.approved_baseline_template_id;
    select pg_catalog.max(payload_version.value::integer)
    into v_expected_payload_schema_version
    from pg_catalog.jsonb_array_elements_text(
      v_row.contract_json -> 'supportedPayloadVersions'
    ) payload_version(value);

    v_contract_violations :=
      dashboard_private.notification_template_contract_violations_v1(
        v_row.rule_id,
        v_row.title_template,
        v_row.body_template
      );
    select coalesce(
      pg_catalog.jsonb_agg(violation.item ->> 'code' order by violation.ordinality),
      '[]'::jsonb
    )
    into v_violations
    from pg_catalog.jsonb_array_elements(v_contract_violations)
      with ordinality violation(item, ordinality);

    if v_row.allowed_variables is distinct from
      v_row.contract_json -> 'availableVariables'
    then
      v_violations := v_violations || '"notification_template_allowlist_outdated"'::jsonb;
    end if;
    if v_row.payload_schema_version is distinct from v_expected_payload_schema_version then
      v_violations := v_violations || '"notification_template_payload_schema_outdated"'::jsonb;
    end if;
    if v_row.content_contract_version is distinct from v_row.contract_version then
      v_violations := v_violations || '"notification_template_contract_version_outdated"'::jsonb;
    end if;
    if v_row.checksum is distinct from
      dashboard_private.notification_seed_template_checksum_v1(
        v_row.title_template,
        v_row.body_template,
        v_row.allowed_variables,
        v_row.payload_schema_version
      )
    then
      v_violations := v_violations || '"notification_template_checksum_mismatch"'::jsonb;
    end if;

    if v_row.created_actor_kind = 'system' then
      if v_approved_baseline_template_id is null
        or v_row.active_template_id is distinct from v_approved_baseline_template_id
      then
        v_violations := v_violations || '"approved_baseline_template_id_mismatch"'::jsonb;
      end if;
      if v_row.baseline_created_actor_kind is distinct from 'system' then
        v_violations := v_violations || '"notification_template_system_creator_mismatch"'::jsonb;
      end if;
      if v_row.title_template is distinct from v_row.baseline_title_template then
        v_violations := v_violations || '"notification_template_baseline_title_mismatch"'::jsonb;
      end if;
      if v_row.body_template is distinct from v_row.baseline_body_template then
        v_violations := v_violations || '"notification_template_baseline_body_mismatch"'::jsonb;
      end if;
      if v_row.allowed_variables is distinct from v_row.baseline_allowed_variables then
        v_violations := v_violations || '"notification_template_baseline_allowlist_mismatch"'::jsonb;
      end if;
      if v_row.payload_schema_version is distinct from v_row.baseline_payload_schema_version then
        v_violations := v_violations || '"notification_template_baseline_payload_schema_mismatch"'::jsonb;
      end if;
      if v_row.content_contract_version is distinct from v_row.baseline_content_contract_version then
        v_violations := v_violations || '"notification_template_baseline_contract_version_mismatch"'::jsonb;
      end if;
      if v_row.checksum is distinct from v_row.baseline_checksum then
        v_violations := v_violations || '"notification_template_baseline_checksum_mismatch"'::jsonb;
      end if;
    elsif v_row.created_actor_kind is distinct from 'user' then
      v_violations := v_violations || '"notification_template_creator_invalid"'::jsonb;
    end if;

    select coalesce(
      pg_catalog.jsonb_agg(distinct violation.item order by violation.item),
      '[]'::jsonb
    )
    into v_violations
    from pg_catalog.jsonb_array_elements(v_violations) violation(item);

    v_compliance := case
      when pg_catalog.jsonb_array_length(v_violations) = 0 then 'conformant'
      else 'legacy_custom_nonconformant'
    end;
    if v_compliance = 'conformant' then
      v_conformant_count := v_conformant_count + 1;
    else
      v_nonconformant_count := v_nonconformant_count + 1;
    end if;

    insert into dashboard_private.notification_template_compliance_audits(
      template_id,
      rule_id,
      contract_version,
      compliance,
      violations
    ) values (
      v_row.active_template_id,
      v_row.rule_id,
      v_row.contract_version,
      v_compliance,
      v_violations
    )
    on conflict do nothing;

    v_items := v_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'workflow_label', v_row.workflow_label,
        'event_label', v_row.event_label,
        'channel_label', v_row.channel_label,
        'audience_label', v_row.audience_label,
        'rule_variant_label', v_row.rule_variant_label,
        'compliance', v_compliance,
        'violations', v_violations
      )
    );
  end loop;

  insert into dashboard_private.notification_audit_logs(
    id,
    scope_key,
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
    dashboard_private.notification_deterministic_uuid_v1(
      'notification-content-template-audit-v1',
      p_audit_key || '|' || p_request_id::text
    ),
    'global',
    'notification_content_templates',
    p_audit_key,
    'audit_notification_content_templates_v1',
    null,
    'system',
    p_request_id,
    null,
    pg_catalog.jsonb_build_object(
      'conformant_count', v_conformant_count,
      'legacy_custom_nonconformant_count', v_nonconformant_count
    ),
    'read_only_content_audit'
  )
  on conflict (id) do nothing;

  return v_items;
end;
$$;

alter function dashboard_private.notification_system_template_vnext_payload_v1(text)
  owner to postgres;
alter function dashboard_private.install_notification_system_templates_vnext_v1()
  owner to postgres;
alter function public.audit_notification_content_templates_v1(text, uuid)
  owner to postgres;

revoke all on function dashboard_private.notification_system_template_vnext_payload_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.install_notification_system_templates_vnext_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.audit_notification_content_templates_v1(text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.audit_notification_content_templates_v1(text, uuid)
  to service_role;

commit;
