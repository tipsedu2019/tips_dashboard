# 7개 업무 알림 어댑터 및 단계적 전환 설계

**Date:** 2026-07-15

**Status:** Approved direction, written-spec review pending

**Depends on:** [Common Notification Control Plane Design](./2026-07-15-common-notification-control-plane-design.md)

**Related registration scheduling design:** [Registration Canonical Appointments, History, Calendar, and Reminders Design](./2026-07-15-registration-appointments-reminders-design.md)

## 1. 목표

공통 알림 플랫폼과 현재 업무 코드를 연결하는 7개 workflow adapter의 소유권, 이벤트, 대상 해석, 초기 rule 상태, 멱등성, 취소 의미, 전환 순서, 검증 기준을 고정한다.

이 문서의 핵심 결정은 다음과 같다.

- 공통 플랫폼의 정규 계층은 notification_events, notification_rules, notification_templates, notification_deliveries 네 가지다. 이 문서는 계층을 다시 설계하지 않고 업무별 입력과 해석만 정의한다.
- 업무 mutation이 성공한 뒤 브라우저가 임의의 본문과 대상을 provider API에 넘기는 방식은 종료한다. 서버 adapter가 canonical source를 다시 읽고 event, audience, template, channel을 결정한다.
- audience와 channel은 항상 분리한다. 예를 들어 management_team은 audience, google_chat은 channel, google_chat.management는 connection key다.
- 할 일 adapter는 ops_tasks.type = general만 소유한다. word_retest, registration, transfer, withdrawal row를 다시 발행하지 않는다.
- 표시명은 현재 메뉴와 동일하게 전반, canonical workflow key는 transfer로 통일한다.
- 등록, 전반, 퇴원의 메모리 설정은 화면 모양이 아니라 실제 발송 동작만 이관한다.
- 휴보강의 persisted setting과 현재 남아 있는 delivery audit은 보존하되, completed 의미, 채널별 template, 반복 상신 dedupe, 팀 공용 읽음 충돌은 정규화한다.
- 할 일, 영어 단어 재시험, 전자결재의 신규 rule은 모두 disabled로 시작한다.
- shadow 단계에서는 canonical provider를 절대 호출하지 않는다. 외부 발송은 legacy path만 수행한다.
- 등록 예약 리마인더의 시간 계산과 materialization은 별도 등록 예약 문서가 소유한다. 이 문서는 adapter handoff만 정의한다.
- 방문상담 immediate notification과 SOLAPI는 registration 안에서 가장 마지막에 전환하며 기존 claim, reconcile, delivery_unknown 의미를 그대로 보존한다.

## 2. 범위와 workflow 소유권

| UI 표시명 | workflowKey | 소유하는 source 범위 | 소유하지 않는 범위 |
| --- | --- | --- | --- |
| 할 일 | tasks | ops_tasks.type = general | 나머지 ops_tasks type 전부 |
| 영어 단어 재시험 | word_retests | ops_tasks.type = word_retest와 ops_word_retests | general 및 다른 업무 detail |
| 등록 | registration | 등록 parent, subject track, appointment, activity, admission, message | 전반·퇴원·휴보강 |
| 전반 | transfer | ops_tasks.type = transfer와 ops_transfer_details | 일반 할 일과 퇴원 |
| 퇴원 | withdrawal | ops_tasks.type = withdrawal와 ops_withdrawal_details | 일반 할 일과 전반 |
| 휴보강 | makeup_requests | makeup_requests와 그 event, setting, legacy delivery | 전자결재 |
| 전자결재 | approvals | approval_requests, approval_events, approval_comments | 휴보강 결재 상태 |

동일한 ops_tasks row를 둘 이상의 adapter가 발행하지 않는다. 공통 dispatcher도 workflowKey와 sourceType 조합을 검증하여 잘못된 ownership event를 skipped 처리하고 status_reason = workflow_scope_mismatch를 남긴다.

## 3. 공통 adapter 계약

### 3.1 Canonical event envelope

모든 adapter는 공통 문서의 동일한 envelope를 사용한다.

| 필드 | adapter 결정 |
| --- | --- |
| `event_id` | 서버가 생성한 immutable ID |
| `scope_key` | 첫 릴리스는 서버가 global로 고정. 클라이언트 입력 금지 |
| `workflow_key` | 이 문서의 7개 canonical key 중 하나 |
| `event_key` | 아래 workflow catalog의 stable key |
| `source_type` | authoritative table 또는 immutable source event 종류 |
| `source_id` | source row ID |
| `source_revision` | source가 persisted revision을 제공할 때만 bigint. 없는 경우 null |
| `occurrence_key` | 같은 업무 발생을 재시도해도 바뀌지 않는 업무별 key |
| `actor_profile_id` | 인증된 actor. system event는 null과 payload의 `actor_kind` metadata 사용 |
| `occurred_at` | canonical DB event 또는 mutation의 서버 timestamp |
| `payload_schema_version` | workflow event registry가 고정한다. 기존 비등록 adapter의 최초 버전은 1이고 새 canonical registration event는 `actor_kind`를 포함한 2다. |
| payload | resolver와 renderer에 필요한 최소 snapshot. secret과 불필요한 전화번호 제외 |
| `materialized_rule_id`, `materialized_rule_revision` | scheduled server producer만 occurrence의 stable rule/revision을 넣는다. Immediate event는 둘 다 null이고 브라우저 입력 금지 |

ops_task_events, makeup_request_events, approval_events처럼 immutable UUID event만 있고 persisted revision이 없는 source는 occurrenceKey에 event UUID를 사용하고 sourceRevision은 null로 둔다. 1이나 timestamp를 가짜 revision으로 만들지 않는다. retry는 같은 occurrenceKey를 재사용한다.

### 3.2 Producer, resolver, renderer, channel 책임

1. **Producer**는 authoritative mutation과 같은 transaction 안에서 source event, notification_event, unique `notification_event_fanout_jobs` row를 기록한다. 현재 legacy mutation이 post-commit event만 쓰는 경우 shadow adapter가 그 immutable source event를 재사용한다. 신규 전환 후에는 업무 row만 저장되거나 event만 있고 fan-out work가 누락되는 상태를 허용하지 않는다.
2. **Audience resolver**는 audience key를 profile, team, external customer target으로 해석한다. 클라이언트는 recipient ID 목록을 제출하지 않는다.
3. **Rule evaluator**는 eventKey, audienceKey, channelKey, enabled state, schedule을 평가한다.
4. **Template renderer**는 channel별 immutable template revision과 event payload만 사용한다. 클라이언트가 title 또는 body를 공급하지 않는다.
5. **Channel adapter**는 deliveryId만 받고 canonical delivery를 다시 읽어 provider에 전달한다. 기존의 arbitrary text를 받는 /api/google-chat 및 arbitrary recipient를 받는 /api/web-push는 공통 worker가 호출하지 않는다.

Provider credential, webhook URL, service-role key는 브라우저, event payload, delivery snapshot, 로그에 저장하지 않는다. private claim/finalize/reconcile RPC만 service role을 사용하며 public/anon/authenticated에 직접 쓰기 권한을 주지 않는다.

### 3.3 Audience와 channel의 분리

canonical channel key는 네 가지로 고정한다.

- in_app: 개인별 대시보드 inbox row
- web_push: 성공한 in_app recipient의 활성 push subscription별 derived child delivery
- google_chat: team connection을 사용하는 Google Chat delivery
- customer_message: 외부 고객 메시지 delivery. registration에서는 provider adapter = solapi

`management_team`, `executive_team`, `applicant_guardian`, `registration_requester`, `requester_profile`, `approver_profile`, `subject_team`, `track_director`는 channel이 아니라 workflow별 exact audience key다. Google Chat endpoint 구분은 google_chat.management, google_chat.executive, google_chat.math, google_chat.english connection key로 표현한다. 수학팀과 영어팀은 별도 channel을 만들지 않고 `subject_team` resolver가 event subject에 따라 google_chat.math 또는 google_chat.english를 고른다. Google Chat은 connection별 하나의 team target delivery를 만들고, 허용된 in_app team audience는 첫 성공 fan-out 평가 시점의 유효 profile로 한 번 펼친 뒤 target snapshot을 고정한다. Retry는 membership을 다시 계산하지 않고 provider 호출 직전 현재 권한만 재검증한다. web_push는 별도 관리 toggle이 아니라 각 in_app recipient의 활성 subscription으로부터 파생한다.

### 3.4 공통 delivery와 shadow 의미

- 정상 상태는 공통 문서의 pending, claimed, sending, retry_wait, sent, delivery_unknown, failed, skipped, disabled, canceled를 사용한다.
- shadow에서 평가한 would-be delivery는 terminal skipped와 status_reason = shadow_mode로 기록하며 새 inbox projection도 만들지 않는다.
- shadow delivery는 rendered/template/target snapshot을 보존하지만 절대로 pending으로 되돌리지 않는다.
- shadow 평가 audit action은 shadow_delivery_evaluated다.
- cutover 뒤 새로 발생한 occurrence만 정상 delivery를 만든다. 과거 shadow row를 재생하지 않는다.
- sent와 delivery_unknown은 자동 재발송하지 않는다. provider 증거가 있으면 delivery_unknown을 같은 delivery에서 sent 또는 failed로 reconcile한다. provider 미수신 증거가 있거나 admin이 중복 위험을 명시적으로 수락한 경우에만 같은 occurrence와 delivery를 retry_wait로 전이한다. 이 승인은 audit과 `next_attempt_at`만 기록하고 attempt count는 다음 실제 `claimed -> sending`에서 증가한다.

### 3.5 초기 rule seed

| workflow | enabled seed | disabled 또는 미이관 결정 |
| --- | --- | --- |
| tasks | 없음 | 전 rule disabled |
| word_retests | 없음 | 전 rule disabled |
| registration legacy 3단계 | submitted, completed → management_team → google_chat → google_chat.management | processing Google Chat은 현재도 꺼져 있으므로 disabled. applicant/operations UI cell은 실제 adapter mapping이 없어 미이관 |
| registration phone queue | phone_consultation_ready → track_director → in_app enabled | phone 전용 flag 전에는 기존 DB projection만 실제 inbox를 소유 |
| registration visit immediate | track_director → in_app, management_team → google_chat → google_chat.management | 고객 대상 없음 |
| registration SOLAPI | 자동 rule 없음. 기존 명시적 admission-message command만 유지 | scheduler 및 일반 registration event에서 자동 발송 금지 |
| transfer | submitted, completed → management_team → google_chat → google_chat.management | processing disabled. applicant/operations UI cell 미이관 |
| withdrawal | submitted, completed → management_team → google_chat → google_chat.management | processing disabled. applicant/operations UI cell 미이관 |
| makeup_requests | persisted setting을 아래 mapping대로 그대로 import | 누락 row를 UI fallback만 보고 임의 enabled하지 않음 |
| approvals | 없음 | 전 rule disabled |

등록·전반·퇴원의 메모리 template은 실제 enabled seed인 submitted와 completed의 Google Chat template만 canonical template로 이관한다. component state의 toggle 모양은 configuration source로 취급하지 않는다.

#### 3.5.1 Closed settings UI registry

설정 화면은 event namespace pattern이나 audience registry 전체를 자동 노출하지 않는다. 서버와 클라이언트가 공유하는 checked-in `settings_ui_registry`가 각 행의 exact event key, 한국어 group/label, 순서, 허용 cell, 초기 enabled 상태를 고정한다. Registry 밖 event는 `최근 전달` 또는 조사 화면에는 나타날 수 있지만 설정 matrix에는 나타나지 않는다.

반복 사용하는 cell set은 다음과 같다. 각 항목은 `한국어 label = audience/channel`의 exact mapping이다.

| set | exact cells |
| --- | --- |
| `TASK` | `요청자 = requester_profile/in_app`, `주 담당자 = primary_assignee/in_app`, `보조 담당자 = secondary_assignee/in_app`, `관리팀 = management_team/in_app`, `구글챗 · 관리팀 = management_team/google_chat` |
| `WORD` | `요청 선생님 = requesting_teacher/in_app`, `담당 조교 = assigned_assistant/in_app`, `보조 담당자 = secondary_assignee/in_app`, `관리팀 = management_team/in_app`, `구글챗 · 관리팀 = management_team/google_chat` |
| `REG_MGMT` | `관리팀 = management_team/in_app`, `구글챗 · 관리팀 = management_team/google_chat` |
| `REG_OWNER_MGMT` | `과목별 상담 책임자 = track_director/in_app`, `관리팀 = management_team/in_app`, `구글챗 · 관리팀 = management_team/google_chat` |
| `FLOW` | `요청자 = requester_profile/in_app`, `관리팀 = management_team/in_app`, `구글챗 · 관리팀 = management_team/google_chat` |
| `APPROVAL` | `요청자 = requester_profile/in_app`, `결재자 = approver_profile/in_app`, `관리팀 = management_team/in_app`, `구글챗 · 관리팀 = management_team/google_chat` |

아래 목록이 immediate 설정 UI의 닫힌 행 목록이다. 괄호 안 event key는 각각 독립 rule/template 행으로 렌더링하고 앞의 이름은 접을 수 있는 group label이다.

| workflow | group과 exact event rows | cell set | initial enabled |
| --- | --- | --- | --- |
| tasks | 할 일 생성(`task.created`), 담당 변경(`task.assignee_changed`), 일정 변경(`task.due_changed`), 상태 변경(`task.status_changed`), 완료(`task.completed`), 취소(`task.canceled`), 재개(`task.reopened`), 댓글(`task.comment_added`) | `TASK` | 전부 off |
| word_retests | 재시험 생성(`word_retest.created`), 배정(`word_retest.assigned`), 본시험일 변경(`word_retest.schedule_changed`), 시작(`word_retest.started`), 결과 보고(`word_retest.result_reported`), 미응시 보고(`word_retest.absent_reported`), 수정 요청(`word_retest.revision_requested`), 재시험 재생성(`word_retest.retry_created`), 완료(`word_retest.completed`), 취소(`word_retest.canceled`) | `WORD` | 전부 off |
| registration | 문의 접수(`registration.case_created`) | `REG_MGMT` | `management_team/google_chat`만 on |
| registration | 문의 배정(`registration.inquiry_routed`), 상담 책임자 배정(`registration.director_assigned`) | `REG_OWNER_MGMT` | 전부 off |
| registration | 전화상담 준비(`registration.phone_consultation_ready`) | `REG_OWNER_MGMT` | `track_director/in_app`만 on; phone 전용 flag 전에는 legacy projection이 소유 |
| registration | 레벨테스트 예약·변경·시작·완료·미응시·취소(`registration.level_test_scheduled`, `registration.level_test_rescheduled`, `registration.level_test_started`, `registration.level_test_completed`, `registration.level_test_absent`, `registration.level_test_canceled`) | `REG_OWNER_MGMT` | 전부 off |
| registration | 방문상담 예약·변경·교체·과목 제외·취소(`registration.visit_scheduled`, `registration.visit_rescheduled`, `registration.visit_replaced`, `registration.visit_subject_deselected`, `registration.visit_canceled`) | `REG_OWNER_MGMT` | `track_director/in_app`, `management_team/google_chat` on; 관리팀 in_app off |
| registration | 상담·대기·입학 진행(`registration.consultation_completed`, `registration.waiting_transitioned`, `registration.enrollment_decided`, `registration.admission_started`, `registration.admission_advanced`, `registration.admission_canceled`) | `REG_OWNER_MGMT` | 전부 off |
| registration | 등록 종료·문의 종료·재개(`registration.registration_completed`, `registration.case_closed`, `registration.track_reopened`) | `REG_OWNER_MGMT` | completed/closed의 `management_team/google_chat`만 on; reopened 전부 off |
| transfer | 제출(`transfer.submitted`), 처리 시작(`transfer.processing_started`), 상세 변경(`transfer.details_changed`), 완료(`transfer.completed`), 취소(`transfer.canceled`), 재개(`transfer.reopened`) | `FLOW` | submitted/completed의 `management_team/google_chat`만 on |
| withdrawal | 제출(`withdrawal.submitted`), 처리 시작(`withdrawal.processing_started`), 상세 변경(`withdrawal.details_changed`), 완료(`withdrawal.completed`), 취소(`withdrawal.canceled`), 재개(`withdrawal.reopened`) | `FLOW` | submitted/completed의 `management_team/google_chat`만 on |
| approvals | 생성(`approval.created`), 제출(`approval.submitted`), 검토 시작(`approval.review_started`), 결재자 변경(`approval.approver_changed`), 승인(`approval.approved`), 반려(`approval.returned`), 취소(`approval.canceled`), 재상신(`approval.resubmitted`), 댓글(`approval.comment_added`) | `APPROVAL` | 전부 off |

휴보강은 실제 legacy 조건 때문에 trigger별 cell이 다르다. 아래 cell만 settings registry에 존재하고 enabled 값은 해당 persisted row를 import한다. Persisted row가 있어도 실제 legacy 조건이 그 trigger에서 사용하지 않았던 cell은 inactive import metadata로만 보존하고 UI rule로 만들지 않는다.

| event | exact cells |
| --- | --- |
| `makeup.submitted`, `makeup.refund_requested` | `approver_profile/in_app`, `management_team/in_app`, `executive_team/google_chat`, `management_team/google_chat`, `subject_team/google_chat` |
| `makeup.approved`, `makeup.refund_completed`, `makeup.approval_canceled` | `requester_profile/in_app`, `approver_profile/in_app`, `management_team/in_app`, `executive_team/google_chat`, `management_team/google_chat`, `subject_team/google_chat` |
| `makeup.revision_requested`, `makeup.rejected` | `requester_profile/in_app`, `subject_team/google_chat` |

`registration.admission_message_requested`, `registration.admission_message_accepted`, `registration.admission_message_failed`, `registration.admission_message_unknown`, `registration.admission_message_reconciled`, `registration.admission_message_retry_released`, `makeup.deleted`, `approval.deleted`, dispatch ownership event는 운영 상태이고 설정 UI에 노출하지 않는다. 등록 reminder는 이 표의 immediate 행이 아니라 별도 문서의 세 variant와 kind별 exact cell registry만 사용한다.

모든 rule은 `active_template_id`가 필요하므로 seed source도 닫힌다.

- 현재 실제 발송 중인 legacy cell은 checked-in legacy renderer fixture가 만든 compatibility title/body/allowed-variable catalog를 immutable template version 1로 사용하고, Phase 2 shadow의 normalized rendered-content checksum으로 동일성을 검증한다.
- 휴보강의 실제 미사용 channel별 저장 본문은 inactive template/import metadata로 보존하고 active compatibility content를 바꾸지 않는다.
- 새로 추가되는 disabled cell은 checked-in system template를 사용한다. Exact title은 `[{workflow_label}] {event_label}`, body는 `{event_label} · {occurred_at}\n{deep_link}`이고 `workflow_label`, `event_label`은 registry constant, `occurred_at`은 envelope timestamp, `deep_link`는 workflow adapter의 same-origin route registry가 만드는 safe base rendering variable다.
- 등록 reminder의 disabled template는 title `[예약 알림] {student_name} · {appointment_kind}`, body `{appointment_date_time} · {place} · {subjects}`로 seed한다. 각 변수는 등록 문서의 allowlist를 따른다.
- Migration seed actor는 null profile + `system`이고, 운영자가 저장한 새 version부터 verified profile + `user`를 기록한다. Registry row, default template, allowed-variable entry 중 하나라도 빠지면 migration readiness marker를 만들지 않는다.

### 3.6 Closed source-type registry

| workflow/event family | canonical `source_type` | `source_id` |
| --- | --- | --- |
| tasks와 word_retests의 업무 event | `ops_task_event` | immutable `ops_task_events.id` |
| tasks comment | `ops_task_comment` | `ops_task_comments.id` |
| registration track/process event | `registration_track_event` | immutable registration track event ID |
| registration shared-appointment immediate와 scheduled reminder | `registration_appointment` | `ops_registration_appointments.id` |
| registration admission message command | `registration_message_command` | stable registration message request key |
| transfer와 withdrawal 업무 event | `ops_task_event` | immutable `ops_task_events.id` |
| makeup event | `makeup_request_event` | `makeup_request_events.id` |
| approval status event | `approval_event` | `approval_events.id` |
| approval comment | `approval_comment` | `approval_comments.id` |

모든 event catalog entry는 위 family 중 하나로 결정되며 registry 밖 `source_type`은 거절한다. Domain row ID를 source event ID처럼 섞거나 timestamp를 source ID로 만들지 않는다.

## 4. 할 일 adapter

### 4.1 Event catalog

| eventKey | 발생 조건 | 최소 payload |
| --- | --- | --- |
| task.created | general task 생성 | taskId, title, priority, requesterId, assignee IDs/team, dueAt |
| task.assignee_changed | primary, secondary, team 중 하나 변경 | before/after assignee keys |
| task.due_changed | startAt 또는 dueAt 변경 | before/after schedule |
| task.status_changed | non-terminal 상태 전이 | before/after status |
| task.completed | status가 done으로 전이 | completedAt |
| task.canceled | status가 canceled로 전이 | canceledAt, reason when present |
| task.reopened | done/canceled에서 active 상태로 전이 | before/after status |
| task.comment_added | ops_task_comments insert | commentId, authorId, taskId |

현재 coarse updated event는 assignee 또는 due change의 정확한 before/after를 담지 않는다. shadow에서는 created와 status_changed처럼 증명 가능한 event만 비교하고, cutover mutation은 변경 필드를 명시한 source event를 같은 transaction에서 기록한다. 과거 updated row에서 변경 종류를 추측하지 않는다.

### 4.2 Adapter contract

| 항목 | 결정 |
| --- | --- |
| Audience | requester_profile = requested_by, primary_assignee = assignee_id, secondary_assignee = secondary_assignee_id, management_team = 활성 admin/staff 인증 profile |
| Default | 모든 audience/channel rule disabled |
| Source of truth | ops_tasks.type = general, ops_task_events, ops_task_comments |
| Existing adapter | 전용 외부 알림 adapter 없음. 현재 workspace 상태와 event audit만 존재 |
| Identity | source event가 있으면 occurrenceKey = ops_task_events.id 또는 comment ID, sourceRevision = null |
| Schedule change | 릴리스 1은 `delivery_mode = immediate`만 허용한다. 새 `task.due_changed` event는 source revision을 만들지 않고 아직 전송되지 않은 직전 due-change 알림만 `source_schedule_changed`로 취소하며 별도 due reminder를 예약하지 않는다 |
| Cancel/withdraw | task.canceled가 이전 pending/retry_wait delivery를 `canceled/source_status_changed` 처리한다. sent와 delivery_unknown은 보존한다 |
| Reopen | task.reopened는 새 occurrence이며 canceled delivery를 복구하지 않는다 |
| Cutover | tasks shadow → disabled-rule dispatch flag on → legacy ownership guard 제거 순서 |

### 4.3 Acceptance tests

- general task 한 건이 tasks event 하나만 만들고 word_retests, transfer, withdrawal adapter에서는 0건을 만든다.
- word_retest, registration, transfer, withdrawal task를 저장해도 tasks adapter event가 생기지 않는다.
- 같은 ops_task_events UUID를 재처리하면 notification_event와 delivery가 중복되지 않는다.
- dueAt 변경은 old pending만 canceled하고 sent 이력을 바꾸지 않는다.
- 모든 rule이 disabled인 초기 상태에서 provider 호출은 0건이고 disabled audit만 남는다.
- cancel 후 reopen은 같은 delivery를 재사용하지 않고 새 occurrence를 만든다.

## 5. 영어 단어 재시험 adapter

### 5.1 Event catalog

| eventKey | 발생 조건 | 최소 payload |
| --- | --- | --- |
| word_retest.created | word_retest task와 detail 생성 | taskId, studentId/name, branch, teacher, class, testAt |
| word_retest.assigned | 담당 조교/팀 변경 | before/after assignee |
| word_retest.schedule_changed | 본시험일 또는 dueAt 변경 | before/after testAt |
| word_retest.started | retest_status가 in_progress | taskId, attempt context |
| word_retest.result_reported | retest_status done과 review_requested 저장 | score summary, pass/fail, requesterId |
| word_retest.absent_reported | retest_status absent와 review_requested 저장 | testAt, reportedAt, source |
| word_retest.revision_requested | review_requested에서 수정 흐름으로 이동 | actorId, reason when present |
| word_retest.retry_created | 불합격 확인과 새 retry task 생성 command 완료 | previousTaskId, retryTaskId, stableRequestKey |
| word_retest.completed | task status done | completedAt |
| word_retest.canceled | task status canceled | canceledAt |

본시험일 1주 경과 자동 미응시 판정은 word-retest 업무가 소유한다. adapter는 판정 알고리즘을 실행하지 않고 committed absent_reported event만 전달한다.

### 5.2 Adapter contract

| 항목 | 결정 |
| --- | --- |
| Audience | requesting_teacher = requested_by, assigned_assistant = assignee_id, secondary_assignee, management_team = 활성 admin/staff 인증 profile |
| Default | 모든 rule disabled |
| Source of truth | ops_tasks.type = word_retest, ops_word_retests, ops_task_events |
| Existing adapter | 전용 외부 sender 없음. UI의 담당선생님에게 보냈습니다 문구는 canonical delivery 증거가 아님 |
| Identity | 모든 event는 `ops_task_events.id` UUID가 occurrenceKey이고 sourceRevision = null이다. retry command는 같은 transaction에서 `word_retest.retry_created` source event를 반드시 만들고 stable request key는 그 event payload/idempotency constraint에 저장한다. 같은 request retry는 기존 source event UUID를 반환한다. |
| Retry task | 새 재시험은 새 task/source다. 이전 task delivery와 합치지 않는다 |
| Cancel | 릴리스 1은 `delivery_mode = immediate`만 허용한다. canceled는 `source_status_changed`, 새 schedule_changed는 `source_schedule_changed`로 superseded event의 아직 미전송 delivery만 취소하며 test-date reminder는 만들지 않는다 |
| Result | result_reported와 absent_reported는 같은 task라도 서로 다른 source event occurrence |
| Cutover | word_retests shadow 후 disabled 상태로 dispatch flag를 켜고, 실제 알림 rule 활성화는 별도 운영 승인으로만 수행 |

### 5.3 Acceptance tests

- word_retest 저장은 tasks workflow event를 만들지 않는다.
- 점수 저장만 한 경우와 result_reported 상태 전이가 구분된다.
- 동일 result source event 재처리는 delivery를 중복 생성하지 않는다.
- 불합격 retry command는 이전 task 완료와 새 task 생성을 각각 한 번 기록하고 retry link를 보존한다.
- retry command의 같은 stable request key 재호출은 하나의 `ops_task_events` UUID와 하나의 canonical occurrence만 반환한다.
- testAt 변경은 old pending을 취소하고 sent/unknown을 보존한다.
- 초기 rule 상태에서 dashboard, web push, Google Chat 호출이 모두 0건이다.

## 6. 등록 adapter

### 6.1 Authoritative source

등록 parent는 ops_tasks와 ops_registration_details이고, 과목별 현재 상태는 ops_registration_subject_tracks가 소유한다. 예약과 활동은 ops_registration_appointments, ops_registration_level_tests, ops_registration_consultations가 소유한다. 입학 처리는 ops_registration_admission_batches와 ops_registration_enrollments, 고객 메시지는 ops_registration_messages가 소유한다.

Ready runtime은 legacy parent의 combined pipeline, 상담자, 예약 필드를 event source로 사용하지 않는다. 새 mutation은 `ops_task_events.event_type = registration_track_event` payload version 2만 기록하며 canonical mutation 결과를 사용한다. Version 1은 과거 읽기 호환 입력일 뿐 새 producer source가 아니다.

Automatic history가 `user`, `system`, `migration`을 구분할 수 있도록 새 canonical registration event payload는 version 2로 `actor_kind`를 필수 기록한다. Version 1은 읽기 호환만 유지하며 null actor를 system 또는 migration으로 추측하지 않고 `알 수 없음`으로 표시한다.

### 6.2 Event catalog

| eventKey | canonical source event |
| --- | --- |
| registration.case_created | canonical case create 완료 |
| registration.inquiry_routed | initial_inquiry_selected, inquiry_routed |
| registration.director_assigned | director_default_resolved, director_manual_override, director_default_cleared |
| registration.phone_consultation_ready | phone waiting row created/repaired/reassigned |
| registration.level_test_scheduled | level_test_scheduled, level_test_retake_scheduled |
| registration.level_test_rescheduled | level-test appointment_updated 또는 replacement의 new appointment |
| registration.level_test_started | level_test_started |
| registration.level_test_completed | level_test_completed |
| registration.level_test_absent | level_test_absent |
| registration.level_test_canceled | level_test_canceled 또는 level-test appointment_canceled |
| registration.visit_scheduled | visit_scheduled |
| registration.visit_rescheduled | visit appointment_updated |
| registration.visit_replaced | appointment_replaced의 old/new appointment pair |
| registration.visit_subject_deselected | appointment_subject_deselected |
| registration.visit_canceled | visit appointment_canceled |
| registration.consultation_completed | consultation_completed |
| registration.waiting_transitioned | waiting_transitioned |
| registration.enrollment_decided | enrollment_decision_routed |
| registration.admission_started | admission_batch_started |
| registration.admission_advanced | admission_batch_advanced, enrollment_rows_saved, makeedu update |
| registration.admission_canceled | admission_batch_canceled 또는 registration_enrollment_canceled |
| registration.registration_completed | admission_batch_completed 또는 all-track registered recompute |
| registration.case_closed | all-track not_registered/inquiry_closed recompute |
| registration.track_reopened | track_reopened |
| registration.admission_message_requested | 기존 명시적 고객 메시지 command가 claim을 획득 |
| registration.admission_message_accepted | provider가 acceptance를 명확히 반환 |
| registration.admission_message_failed | provider가 non-acceptance를 명확히 반환 |
| registration.admission_message_unknown | timeout/network/ambiguous response |
| registration.admission_message_reconciled | provider 증거로 unknown을 확정 |
| registration.admission_message_retry_released | 증거에 따라 retry claim 해제 |
| registration.appointment_reminder_due | 별도 예약 리마인더 설계가 materialize한 occurrence |

### 6.3 Audience resolver

| audienceKey | Resolver |
| --- | --- |
| registration_requester | ops_tasks.requested_by의 현재 profile |
| track_director | 해당 revision에 참여한 track의 consultation/director snapshot. 중복 profile은 한 번만 반환 |
| management_team | 현재 활성 관리팀 profile 집합. Google Chat에서는 `target_kind = connection`, `target_key = google_chat.management` 한 target |
| subject_team | track subject에 따라 영어팀 또는 수학팀 |
| applicant_guardian | SOLAPI command에서 canonical parent phone을 서버가 조회한 단일 external target |

전화번호는 applicant_guardian resolver와 SOLAPI adapter 내부에서만 읽는다. event payload, 일반 template 변수, 로그에는 원문을 넣지 않는다.

### 6.4 Default rule와 기존 adapter

| 경로 | 초기 상태 | Legacy |
| --- | --- | --- |
| 일반 문의 접수 | registration.case_created → management_team → google_chat → google_chat.management enabled | notifyRegistrationWorkflow의 submitted 실제 경로 |
| 일반 진행 | disabled | processing의 Google Chat은 현재 disabled이고 applicant cell은 phantom |
| 일반 종료 | registration.registration_completed/case_closed → management_team → google_chat → google_chat.management enabled | completed 실제 경로 |
| 전화상담 준비 | registration.phone_consultation_ready → track_director → in_app enabled | phone 전용 flag 전에는 기존 DB direct projection이 실제 inbox owner |
| 방문상담 개인 | visit scheduled/changed/replaced/canceled → track_director → in_app enabled | /api/registration/consultation-notification |
| 방문상담 관리팀 | 같은 event → management_team → google_chat → google_chat.management enabled | 같은 route의 admin claim |
| 예약 리마인더 | 세 variant와 모든 허용 audience/channel cell을 disabled로 seed하고 명시적 설정 저장 뒤에만 활성화 | 신규 durable reminder |
| SOLAPI | automatic rule 없음. explicit admission command만 customer_message, provider adapter = solapi로 enabled | /api/solapi/registration |

applicant 또는 operations라는 channel은 만들지 않는다. 방문상담과 일반 3단계 path는 서로 다른 eventKey를 사용하므로 한 변경이 두 Google Chat 메시지를 만들지 않는다.
legacy pipeline prefix 2.*는 방문상담 adapter가 소유하며 generic registration progress event를 발행하지 않는다.

Reminder applicability는 appointment kind별 server registry로 고정한다.

| appointment kind | 허용 audience/channel cell |
| --- | --- |
| `level_test` | `management_team/in_app`, `management_team/google_chat` |
| `visit_consultation` | `track_director/in_app`, `management_team/google_chat` |

비적용 kind/cell은 `no_recipient` delivery를 만들지 않고 rule evaluation 대상에서 제외한다. 모든 허용 cell은 초기 `enabled = false`다.

### 6.5 Occurrence, revision, idempotency

- 일반 track event는 `occurrence_key = ops_task_events.id`, `source_revision = null`이다.
- 한 shared appointment revision의 immediate notification은 track event 여러 건을 하나의 aggregate event로 묶는다.
- shared appointment immediate의 `source_type/source_id`는 `registration_appointment`/`ops_registration_appointments.id`다. `occurrence_key`는 `registration:registration_appointment:{appointmentId}:source_revision:{notificationRevision}:immediate`이고 `source_revision`은 persisted `notification_revision`이다.
- 개인 dashboard delivery는 aggregate occurrence 안에서 distinct director profile별 하나다. 관리팀 Google Chat delivery는 revision별 하나다.
- replacement는 old appointment revision과 new appointment revision을 별도 occurrence로 보존한다.
- 예약 reminder occurrenceKey는 `registration:registration_appointment:{appointmentId}:source_revision:{notificationRevision}:rule:{ruleId}:rule_revision:{ruleRevision}`다. adapter는 appointmentId, source revision, stable rule ID/revision, scheduledFor, kind, place, participantTrackIds만 받으며 시간 계산이나 browser recipient 해석은 하지 않는다.
- SOLAPI occurrenceKey는 기존 registration request key다. provider custom field와 canonical delivery key에도 같은 request key를 사용한다.

현재 visit legacy path가 동일 director의 English/mathematics track을 두 delivery로 기록하더라도 canonical path는 director profile별 한 aggregate delivery를 만든다. Shadow compare에서는 이 의도된 2-to-1 변경을 `registration_visit_same_director_aggregation`으로 분류하고 다른 mismatch와 섞지 않는다.

### 6.6 Cancel, withdraw, unknown

- appointment create는 `notification_revision = 1`이다. Date/time, place, participant change, replacement, cancel은 authoritative mutation당 정확히 +1 한다. Completion과 director reassignment는 revision을 올리지 않고 status 또는 target reconciliation만 수행한다.
- 예약 reschedule, place/참여 과목 변경, replacement, cancel은 old revision의 pending/retry_wait를 `canceled/source_revision_changed` 처리하고 claimed에는 같은 reason의 cancel request를 남긴다.
- canceled appointment는 새 cancellation immediate event를 만들지만 future reminder는 만들지 않는다.
- completed appointment는 남은 pending/retry_wait reminder를 `canceled/source_status_changed` 처리하고 claimed에는 같은 reason의 cancel request를 남긴다.
- director 변경은 새 reminder event를 만들지 않는다. Track mutation, `registration.director_assigned` source event, unique target-reconciliation job이 함께 commit되고, job이 기존 미래 event의 old personal target unsent delivery를 `recipient_revoked`로 취소한 뒤 current valid director target만 다시 fan-out한다. Director 표시값은 fan-out 시점의 immutable target snapshot에 저장해 이후 profile 이름 변경이 과거 rendered content를 바꾸지 않는다.
- 등록 종료 시 unsent generic registration delivery는 취소할 수 있지만 sent와 delivery_unknown은 보존한다.
- SOLAPI sending 이후 timeout/network ambiguity는 delivery_unknown이다. 자동 retry, cancel 후 재발송, 일반 failed로의 축약을 금지한다.
- provider 미수신 증거가 있거나 admin이 중복 위험을 명시적으로 수락한 경우에만 reconcile과 retry release를 거쳐 같은 occurrence와 delivery를 retry_wait로 전이한다. 새 business event가 없으므로 새 occurrence를 만들지 않는다.

### 6.7 Cutover order

registration core shadow를 먼저 통과시키되 기존 전화상담 direct inbox projection, visit route, SOLAPI route는 계속 legacy로 둔다. Core flag만 켠 상태에서는 canonical `registration.phone_consultation_ready` delivery를 만들지 않는다. 별도 phone adapter flag를 켜는 release가 기존 DB 함수의 direct `dashboard_notifications` insert/delete를 canonical event/projection으로 교체하여 create·reassign·complete마다 정확히 한 current inbox item만 남긴다. 그 다음 visit immediate를 전환하고, 마지막으로 SOLAPI command handler를 canonical delivery claim/finalize/reconcile에 연결한다. 예약 reminder algorithm은 관련 별도 문서의 배포 gate를 따른다.

### 6.8 Acceptance tests

- 영어와 수학 track이 다른 director를 가질 때 개인 dashboard는 각 director에게 한 건씩, 관리팀 Chat은 shared appointment revision당 한 건만 생성된다.
- 같은 director가 두 track을 맡으면 개인 delivery 한 건에 두 과목이 렌더링된다.
- appointment retry가 같은 revision을 사용하면 중복이 없고 reschedule은 새 revision을 만든다.
- cancellation/replacement가 old pending reminder를 취소하고 sent/unknown을 변경하지 않는다.
- director reassignment source event와 unique target-reconciliation job이 같은 transaction에 생성되고, cancellation 뒤 crash retry가 current director delivery를 정확히 한 번 만든다.
- 일반 submitted/completed seed만 관리팀 Chat을 만들고 processing은 0건이다.
- applicant/operations phantom channel delivery는 0건이다.
- shadow와 automated test에서는 실제 Google Chat과 SOLAPI 호출이 0건이다.
- visit timeout은 delivery_unknown이고 blind retry가 일어나지 않는다.
- SOLAPI accepted, failed, unknown, reconcile, retry-release 상태가 기존 request key와 provider evidence를 보존한다.
- appointment reminder adapter가 별도 문서의 occurrence를 그대로 소비하고 자체 KST 시간 계산을 하지 않는다.
- phone adapter flag 전후 create/reassign/complete에서 legacy와 canonical inbox가 중복되지 않고 한 current unread projection만 남는다.

## 7. 전반 adapter

### 7.1 Event catalog

| eventKey | 발생 조건 |
| --- | --- |
| transfer.submitted | transfer task 생성 |
| transfer.processing_started | status가 in_progress |
| transfer.details_changed | 전/후 수업, 담당자, 날짜, 회차, 사유 변경 |
| transfer.completed | status가 done |
| transfer.canceled | status가 canceled |
| transfer.reopened | terminal 상태에서 active로 전환 |

### 7.2 Adapter contract

| 항목 | 결정 |
| --- | --- |
| Audience | requester_profile = requested_by, management_team = 관리팀 |
| Default | submitted와 completed의 management_team → google_chat → google_chat.management만 enabled |
| Source of truth | ops_tasks.type = transfer, ops_transfer_details, ops_task_events |
| Existing adapter | notifyTransferWorkflow. component memory setting과 template의 실제 legacy mapping은 google_chat_admin뿐이며 canonical mapping은 google_chat.management |
| Identity | source event UUID가 occurrenceKey, sourceRevision = null |
| Details | coarse updated event를 추측하지 않고 cutover mutation이 explicit details_changed event를 기록 |
| Cancel | canceled가 old pending/retry_wait를 `canceled/source_status_changed` 처리. cancellation rule은 disabled로 시작 |
| Reopen | 새 occurrence. 기존 completed message를 수정하거나 회수하지 않음 |
| Cutover | memory seed 고정 → shadow compare → transfer flag on과 동시에 browser sender off |

### 7.3 Acceptance tests

- submitted와 completed는 관리팀 Google Chat intent를 각각 한 번 만든다.
- processing은 applicant dashboard, operations dashboard, Google Chat을 모두 만들지 않는다.
- applicant/operations UI toggle 모양을 import해 rule을 활성화하지 않는다.
- 같은 source event 재처리는 중복 delivery를 만들지 않는다.
- cancel은 unsent만 취소하고 sent/unknown을 보존한다.
- cutover 순간 legacy sender와 canonical sender가 동시에 호출되지 않는다.

## 8. 퇴원 adapter

### 8.1 Event catalog

| eventKey | 발생 조건 |
| --- | --- |
| withdrawal.submitted | withdrawal task 생성 |
| withdrawal.processing_started | status가 in_progress |
| withdrawal.details_changed | 퇴원일, 회차, 사유, 수업시수, 교재 정보 변경 |
| withdrawal.completed | status가 done |
| withdrawal.canceled | status가 canceled |
| withdrawal.reopened | terminal 상태에서 active로 전환 |

### 8.2 Adapter contract

| 항목 | 결정 |
| --- | --- |
| Audience | requester_profile = requested_by, management_team = 관리팀 |
| Default | submitted와 completed의 management_team → google_chat → google_chat.management만 enabled |
| Source of truth | ops_tasks.type = withdrawal, ops_withdrawal_details, ops_task_events |
| Existing adapter | notifyWithdrawalWorkflow. component memory setting과 template의 실제 legacy mapping은 google_chat_admin뿐이며 canonical mapping은 google_chat.management |
| Identity | source event UUID가 occurrenceKey, sourceRevision = null |
| Details | checklist edit와 details_changed는 분리. checklist 저장이 submitted/completed를 재발행하지 않음 |
| Cancel | canceled가 old pending/retry_wait를 `canceled/source_status_changed` 처리. cancellation rule은 disabled로 시작 |
| Reopen | 새 occurrence. terminal audit 보존 |
| Cutover | memory seed 고정 → shadow compare → withdrawal flag on과 동시에 browser sender off |

### 8.3 Acceptance tests

- submitted와 completed만 관리팀 Google Chat intent를 각각 한 번 만든다.
- processing과 checklist edit는 외부 알림을 만들지 않는다.
- applicant/operations phantom channel이 canonical rule 또는 delivery로 생기지 않는다.
- 같은 completed source event를 재처리해도 중복되지 않는다.
- cancel/reopen이 terminal 이력을 덮어쓰지 않는다.
- business mutation 성공 후 provider 실패가 퇴원 상태를 rollback하지 않는다.

## 9. 휴보강 adapter

### 9.1 Event catalog와 legacy trigger normalization

| canonical eventKey | Legacy trigger/event |
| --- | --- |
| makeup.submitted | submitted와 resubmitted. 각각 source event occurrence는 별도 |
| makeup.approved | approved |
| makeup.revision_requested | returned / revision_requested |
| makeup.rejected | rejected |
| makeup.refund_requested | refund_requested |
| makeup.refund_completed | completed / refund_completed |
| makeup.approval_canceled | canceled / approval_canceled / completed_canceled |
| makeup.deleted | closed request hard delete 직전의 audit-only event |

completed는 approved의 UI alias가 아니다. 현재 service에서 completed notification trigger는 refund 완료에 사용되므로 canonical eventKey는 makeup.refund_completed, UI label은 환불 완료로 고정한다. 승인으로 곧바로 request status가 completed가 되더라도 source event가 approved이면 makeup.approved다.

### 9.2 Audience resolver

| audienceKey | Resolver |
| --- | --- |
| requester_profile | makeup_requests.requester_id |
| approver_profile | canonical approver_profile_id |
| management_team | 현재 활성 관리팀 profile |
| executive_team | 경영팀 Google Chat team target |
| subject_team | `approval_group = english`이면 `google_chat.english`, `math_middle` 또는 `math_high`이면 `google_chat.math`, `unknown`이면 target 없음. Registry 밖 값은 validation failure |

dashboard team audience는 profile별로 펼친다. Delivery identity는 rule-scoped이므로 한 recipient가 requester/approver/management처럼 서로 다른 enabled rule에 포함되면 rule별 delivery를 유지한다. 설정 UI는 같은 event/channel의 audience 중복 가능성을 표시한다. Google Chat team target은 endpoint별 한 건이다.

`approval_group = unknown`은 `subject_team`을 해석하지 않는다. 영어·수학 Google Chat delivery는 만들지 않고 legacy 호환의 `management_team -> google_chat.management`만 한 번 평가한다. `math_middle`과 `math_high`는 모두 수학 connection 한 건으로 normalize하고 `english`는 영어 connection 한 건으로 해석한다.

### 9.3 Persisted setting과 template import

makeup_notification_settings의 각 row를 eventKey, audienceKey, channelKey, enabled, title template, body template로 변환한다.

- dashboard_personal은 event별 legacy recipient 규칙을 적용하여 requester_profile 또는 approver_profile audience와 in_app channel로 import한다.
- dashboard_management는 management_team audience와 in_app channel로 import한다.
- in_app delivery가 성공하고 recipient에게 활성 push subscription이 있으면 worker가 web_push child delivery를 파생한다. legacy setting 하나를 in_app과 web_push 두 toggle로 복제하지 않는다.
- google_chat_executive는 executive_team + google_chat.executive, google_chat_admin은 management_team + google_chat.management로 import한다. google_chat_math와 google_chat_english는 모두 subject_team audience로 import하고 legacy row의 과목에 따라 google_chat.math 또는 google_chat.english connection을 해석한다.
- persisted enabled = false는 그대로 disabled다.
- 실제 persisted row가 없으면 buildDefaultNotificationSettings의 UI fallback을 import 근거로 사용하지 않는다.
- Cutover seed의 active template은 현재 renderer가 실제로 사용한 trigger별 compatibility 결과를 각 enabled rule에 복사해 발송 내용을 바꾸지 않는다. DB에 저장돼 있던 channel별 title/body는 inactive template version과 import metadata로 모두 보존한다. Admin/staff가 공통 UI에서 해당 channel rule의 저장값을 명시적으로 검토·저장한 뒤부터만 channel별 active template가 적용되며, 그 이후 renderer는 다른 channel의 첫 template를 대신 쓰지 않는다.

현재 남아 있는 makeup_notification_deliveries는 historical canonical delivery로 한 번 import한다. legacyDeliveryId, legacyDedupeKey, rendered title/body, target, createdAt을 metadata에 보존하며 provider를 다시 호출하지 않는다.

| Legacy status | Canonical historical status |
| --- | --- |
| sent | sent |
| failed | failed |
| skipped | skipped, status_reason = legacy_skipped |
| disabled | disabled |
| deduped | skipped, status_reason = legacy_deduped |

기존 table이 500건으로 prune된 사실은 import audit에 기록한다. canonical delivery history에는 500건 global prune trigger를 적용하지 않는다.

### 9.4 Occurrence, dedupe, read state

- occurrenceKey = makeup_request_events.id, sourceRevision = null이다.
- resubmitted가 canonical makeup.submitted로 mapping되어도 이전 submitted와 다른 event UUID를 사용한다.
- dashboard delivery key는 occurrence, channel, recipient profile을 포함한다.
- Google Chat delivery key는 occurrence, channel, team target을 포함한다.
- 기존 requestId + trigger + channel + target key는 반복 상신, 재승인, 재취소를 충돌시키므로 신규 key로 사용하지 않는다.
- dashboard team notification을 recipient_team 한 row로 만들지 않는다. 개인별 inbox row와 개인별 read receipt를 사용하여 한 관리팀 사용자의 읽음이 팀 전체 읽음이 되지 않게 한다.

### 9.5 Cancel/withdraw와 기존 adapter

기존 notifyMakeupRequest는 dashboard row 생성, fire-and-forget web push, Google Chat, makeup_notification_deliveries 기록을 한 client service에서 수행한다. cutover 후에는 event producer만 남고 이 외부 side effect를 실행하지 않는다.

- revision 요청 뒤 resubmit은 old occurrence를 되살리지 않고 새 submitted occurrence를 만든다.
- approval cancel은 이전 pending/retry_wait를 `canceled/source_status_changed` 처리하고 makeup.approval_canceled를 새로 만든다.
- refund 완료는 makeup.refund_completed이며 approved template을 재사용하지 않는다.
- hard delete는 makeup.deleted audit만 남기고 외부 rule은 disabled다.
- sent, delivery_unknown, imported historical delivery는 cancel/delete로 수정하지 않는다.

### 9.6 Cutover

1. persisted setting/template와 현재 보존된 delivery audit을 import한다.
2. completed mapping, channel-specific renderer, 개인별 team expansion을 shadow에서 계산한다.
3. legacy 실제 intent와 canonical shadow intent를 비교한다. 의도적으로 제거한 occurrence-less dedupe와 team-shared read row는 expected normalization으로 분류한다.
4. makeup_requests dispatch flag를 켜는 transaction에서 legacy notifyMakeupRequest provider side effect를 끈다.
5. dashboard UI는 legacy와 canonical history를 병합해 읽다가 검증 후 canonical-only로 전환한다.

### 9.7 Acceptance tests

- persisted disabled row가 cutover 후 disabled로 유지된다.
- completed row가 makeup.refund_completed로 표시되고 approved와 합쳐지지 않는다.
- Cutover 직후에는 현재 실제 compatibility content가 유지되고, admin/staff가 channel rule을 명시적으로 저장한 뒤에는 같은 trigger라도 채널마다 서로 다른 active template이 렌더링된다.
- resubmit 두 번은 두 submitted occurrence와 두 정상 delivery set을 만든다.
- 같은 source event retry는 중복을 만들지 않는다.
- 관리팀 두 명이 각각 inbox row를 받고 한 명의 읽음이 다른 사람의 unread를 없애지 않는다.
- 한 profile이 approver와 management_team에 동시에 속하면 enabled rule별 delivery가 생기며 UI가 중복 가능성을 미리 표시한다.
- `approval_group = unknown`은 영어·수학 delivery를 만들지 않고 management Google Chat만 한 번 평가한다.
- `approval_group = math_middle|math_high`는 `google_chat.math`, `english`는 `google_chat.english`, `unknown`은 subject target 없음으로 exact mapping된다.
- imported legacy delivery는 외부 발송 없이 historical 상태와 body를 보존한다.
- shadow에서 canonical Google Chat/web push 호출은 0건이다.
- cancel은 unsent만 취소하고 sent/unknown/history를 보존한다.

## 10. 전자결재 adapter

### 10.1 Event catalog

| eventKey | 발생 조건 |
| --- | --- |
| approval.created | approval_requests insert |
| approval.submitted | draft에서 최초 submitted |
| approval.review_started | submitted에서 reviewing |
| approval.approver_changed | approver_id가 바뀐 authoritative mutation의 before/after |
| approval.approved | reviewing에서 approved |
| approval.returned | active 상태에서 returned |
| approval.canceled | status가 canceled |
| approval.resubmitted | returned에서 submitted |
| approval.comment_added | approval_comments insert |
| approval.deleted | closed request delete 직전 audit |

approval_events의 created/status_changed/approver_changed UUID를 occurrenceKey로 사용한다. comment_added는 approval_comments.id를 사용한다. returned 후 submitted는 단순 중복 submitted가 아니라 approval.resubmitted로 normalize한다.

### 10.2 Adapter contract

| 항목 | 결정 |
| --- | --- |
| Audience | requester_profile = requester_id, approver_profile = approver_id, management_team = 관리 권한 profile |
| Default | 모든 rule disabled |
| Source of truth | approval_requests, approval_events DB trigger, approval_comments |
| Existing adapter | 전용 외부 sender 없음 |
| Identity | approval_events UUID 또는 comment UUID가 occurrenceKey, sourceRevision = null |
| Reassignment | approver 변경은 old approver의 unsent delivery를 `canceled/recipient_revoked` 처리하고 새 explicit event에서 새 target을 계산 |
| Withdraw | 현재 schema의 canceled를 canonical withdrawal 의미로 사용. 별도 withdrawn 상태를 만들지 않음 |
| Delete | closed row 삭제 전 approval.deleted audit. 외부 rule disabled |
| Cutover | approvals shadow 후 disabled 상태로 dispatch flag on |

### 10.3 Cancel/withdraw semantics

- requester 또는 권한 있는 operator가 status를 canceled로 확정하면 approval.canceled를 기록한다.
- 해당 문서의 pending/retry_wait approver delivery는 `canceled/source_status_changed` 처리한다.
- 이미 sent 또는 delivery_unknown인 상신/검토 메시지는 보존한다.
- returned는 취소가 아니며 재상신 가능한 terminal review outcome이다.
- resubmitted는 이전 submitted occurrence를 재사용하지 않는다.
- hard delete는 canonical event/delivery audit을 cascade delete하지 않는다.

### 10.4 Acceptance tests

- insert와 status transition DB event가 canonical event를 정확히 한 번 만든다.
- returned → submitted가 approval.resubmitted 새 occurrence를 만든다.
- approver 변경 후 old recipient unsent가 취소되고 새 recipient만 materialize된다.
- approver 변경은 같은 transaction의 `approval.approver_changed` source event UUID를 occurrence로 사용하고 재시도 시 중복되지 않는다.
- canceled가 pending만 취소하고 sent/unknown을 보존한다.
- comment_added가 comment ID 기준으로 idempotent하다.
- 초기 rule 상태에서 모든 provider 호출은 0건이다.
- closed request hard delete 뒤에도 canonical audit을 조회할 수 있다.

## 11. 단계적 migration과 cutover

### 11.1 Runtime과 feature flag

공통 runtime probe는 common_notification_control_plane_runtime_version() = 1을 요구한다. 1이 아니면 canonical dispatch를 시작하지 않고 legacy path를 유지한다.

| Flag | 의미 |
| --- | --- |
| notification_control_plane_settings_ui_enabled | 전역 설정 화면과 7개 scoped dialog |
| notification_control_plane_shadow_write_enabled | canonical event/rule/template/target을 평가하되 delivery를 skipped/shadow_mode로 종결 |
| notification_control_plane_dispatch_tasks_enabled | tasks canonical dispatch |
| notification_control_plane_dispatch_word_retests_enabled | word_retests canonical dispatch |
| notification_control_plane_dispatch_registration_enabled | registration core canonical dispatch |
| notification_control_plane_registration_phone_adapter_enabled | registration phone direct-inbox projection ownership |
| notification_control_plane_registration_visit_adapter_enabled | registration visit immediate canonical adapter ownership |
| notification_control_plane_registration_solapi_adapter_enabled | registration customer_message의 SOLAPI canonical adapter ownership |
| notification_control_plane_dispatch_transfer_enabled | transfer canonical dispatch |
| notification_control_plane_dispatch_withdrawal_enabled | withdrawal canonical dispatch |
| notification_control_plane_dispatch_makeup_requests_enabled | makeup_requests canonical dispatch |
| notification_control_plane_dispatch_approvals_enabled | approvals canonical dispatch |

한 workflow dispatch flag를 켜는 배포는 해당 legacy sender를 같은 release에서 끈다. 둘 다 외부 발송 가능한 dual-send 상태를 허용하지 않는다.

### 11.2 Migration phases

#### Phase 0 — control plane 설치

- four-layer schema, private RPC, worker, audit, metric, runtime probe를 배포한다.
- canonical event와 함께 생성되는 claimable fan-out job, schedule reconciliation job, target reconciliation job, settings request ledger, rule-scoped dispatch ownership claim을 배포한다.
- 모든 dispatch flag는 false다.
- ordinary browser와 authenticated client가 notification_events/deliveries/provider endpoint를 직접 쓰지 못하는지 검증한다.

#### Phase 0.5 — legacy sender와 producer hardening

- 모든 기존 Google Chat/Web Push caller를 arbitrary 본문·대상 POST에서 source/event ID 기반 fixed-purpose server adapter로 옮긴다.
- 자유 형식 endpoint를 폐쇄하고 stale browser/이전 bundle 호출이 provider에 도달하지 않는지 확인한다.
- legacy와 canonical secure path 모두 같은 rule-scoped occurrence dispatch ownership claim을 사용한다.
- 휴보강 browser notification writer와 등록 전화상담 direct projection을 server/RPC ownership 경계 뒤로 옮긴 뒤 authenticated direct insert를 revoke한다.
- 각 workflow cutover 전 business row, immutable source event, canonical event, fan-out job을 같은 transaction에서 생성하도록 producer를 전환한다.
- 이 gate 전에는 어떤 dispatch flag도 켜지 않는다.

#### Phase 1 — configuration과 history import

- 등록·전반·퇴원은 submitted/completed → management_team → google_chat → google_chat.management만 enabled seed한다.
- 등록의 phone-ready track-director inbox와 visit immediate track-director inbox/management Chat rule은 compatibility enabled로 seed하지만 각 specialized ownership flag 전에는 canonical delivery를 만들지 않는다.
- processing과 phantom applicant/operations UI cell은 import하지 않는다.
- 휴보강 persisted setting/template와 현재 retained delivery audit을 import한다.
- 할 일, 영어 단어 재시험, 전자결재 rule은 disabled로 생성한다.
- import는 stable migration key로 재실행 가능하고 두 번 실행해도 row가 증가하지 않는다.

#### Phase 2 — shadow write and compare

- notification_control_plane_shadow_write_enabled를 켠다.
- canonical은 skipped/shadow_mode와 shadow_delivery_evaluated만 기록하고 provider adapter 또는 새 inbox projection을 호출하지 않는다.
- legacy는 기존 외부 발송을 계속하고 발송 직전 legacy intent fingerprint를 audit에 기록한다.
- 비교 key는 workflowKey, eventKey, occurrenceKey, audienceKey, channelKey, targetKey, `template_checksum`, normalized rendered-content hash다. DB-local template version ID는 비교하지 않는다.
- active legacy path는 7일 연속 100% intent match가 필요하다. 저빈도 event는 deterministic fixture로 최소 한 complete cycle을 추가 검증한다.
- mismatch는 missing event, extra event, target mismatch, channel mismatch, template mismatch, intentional normalization으로 분류한다. intentional normalization은 이 문서에 명시된 phantom 제거, completed 분리, occurrence dedupe 수정, team read-state 분리, `registration_visit_same_director_aggregation`만 허용한다.

#### Phase 3 — workflow cutover

| 순서 | Cutover | 이유와 gate |
| --- | --- | --- |
| 1 | tasks | rule disabled 상태에서 ownership과 event 쓰기 검증 |
| 2 | word_retests | tasks와 분리된 ownership 검증, rule disabled |
| 3 | approvals | DB event 기반, rule disabled |
| 4 | transfer | memory seed의 실제 두 Chat path만 전환 |
| 5 | withdrawal | transfer와 같은 adapter pattern을 독립 flag로 전환 |
| 6 | makeup_requests | persisted import와 네 가지 normalization 검증 후 전환 |
| 7 | registration core와 예약 reminder handoff | generic submitted/completed와 내부 reminder materialization 전환 |
| 8 | registration phone inbox | 기존 direct insert/delete를 canonical projection으로 전환 |
| 9 | registration visit immediate | 기존 revision/participant/failed-target 의미를 canonical delivery로 전환 |
| 10 | registration SOLAPI | claim/reconcile/delivery_unknown을 보존한 마지막 provider 전환 |

registration phone, visit, SOLAPI는 registration workflow flag에 더해 각각 독립 flag로 분리한다. Core flag가 켜져도 specialized flag가 켜질 때까지 해당 legacy handler가 계속 소유한다. 각 전환은 shared dispatch ownership claim을 활성화하고 legacy direct side effect를 끄는 같은 release로 수행한다.

#### Phase 4 — legacy read removal

- canonical-only 기간 14일과 한 번의 rollback drill을 통과한 workflow부터 legacy delivery read를 제거한다.
- legacy setting/history table은 감사 보존 정책에 따라 read-only로 유지한다.
- 기존 dashboard notification은 만료 정책까지 표시하되 신규 row는 canonical delivery projection만 만든다.

### 11.3 Rollback

1. 해당 workflow dispatch flag를 false로 내려 새 canonical claim을 중단한다. Registration 전체 rollback은 core, phone, visit, SOLAPI flag를 각각 내린다.
2. pending/retry_wait는 `canceled/cutover_rollback`으로 끝내고 claimed에는 `cancel_requested_at`과 reason을 기록한다. `begin_send` RPC가 claim token과 cancel request를 원자적으로 확인하므로 business transaction이 lease 만료를 기다리지 않는다.
3. outstanding claim이 canceled 또는 lease-reaped 되었고 새 provider dispatch가 시작되지 않았음을 heartbeat로 확인한다.
4. sending과 delivery_unknown은 legacy로 재발송하지 않고 조사 queue에 남긴다.
5. 각 flag에 대응하는 legacy owner를 복구한다. Provider 요청 전 canonical delivery가 취소되고 ownership claim이 `reserved`인 경우에만 같은 row를 legacy owner의 다음 generation으로 transfer한다. Legacy wrapper도 동일 rule-scoped claim을 사용하고 canonical `dispatch_started`, sent, sending, 또는 delivery_unknown 증거가 있으면 provider 호출을 거절한다.
6. canonical shadow write는 계속 유지하여 rollback 기간 비교 자료를 남긴다.

Rollback은 sent row를 삭제하거나 failed/unknown을 pending으로 되돌리지 않는다. 설정 import도 되돌리지 않으며 enabled rule과 dispatch flag를 별개로 유지한다.

## 12. Audit, metrics, 운영 기준

### 12.1 Required audit

- source_event_recorded
- canonical_event_created 또는 duplicate_event_ignored
- audience_resolved와 resolution snapshot hash
- rule_evaluated와 enabled/disabled 이유
- template_rendered와 immutable template revision
- shadow_delivery_evaluated
- delivery_claimed, dispatch_started, accepted, retry_scheduled, delivery_unknown, failed, canceled
- manual_reconciled와 manual_retry_approved
- legacy_intent_recorded와 shadow_compare_result
- feature_flag_changed와 actor

Audit에는 eventId, deliveryId, workflowKey, sourceType/sourceId, occurrenceKey, rule/template revision, channel, targetKey, sanitized provider reference만 넣는다. webhook, secret, 전체 전화번호, 전체 SOLAPI 본문은 넣지 않는다.

### 12.2 Metrics와 alerts

workflow/channel별로 다음을 집계한다.

- source event 수와 canonical event 수
- duplicate event 차단 수
- shadow match/mismatch 수와 reason
- pending/claimed/sending/retry_wait backlog
- fan-out, rule-reconciliation, target-reconciliation job backlog와 failed/manual-retry 수
- sent/failed/delivery_unknown/canceled/skipped/disabled 수
- occurrence당 delivery fan-out
- provider latency와 definite/ambiguous failure
- stale revision cancellation
- team audience resolution 인원
- legacy sender와 canonical sender 동시 호출 감지

즉시 alert 조건은 다음과 같다.

- shadow mode에서 canonical provider request가 1건이라도 발생
- 같은 workflow occurrence/channel/target의 legacy와 canonical external request가 모두 발생
- delivery_unknown 신규 발생
- worker heartbeat 3회 연속 누락
- pending이 schedule보다 5분 이상 지연
- workflow scope mismatch 발생
- audience가 0명인데 enabled rule인 경우

## 13. 전체 acceptance criteria

- four-layer 공통 schema와 runtime version 1 위에서만 adapter가 동작한다.
- 클라이언트는 event body, recipient, rendered content, provider credential을 지정할 수 없다.
- 7개 workflow의 source ownership이 겹치지 않으며 general task는 다른 ops task type을 재발행하지 않는다.
- audience와 channel이 UI, rule, resolver, delivery에서 분리된다.
- Closed `settings_ui_registry`의 exact event/cell만 일곱 scoped/global 화면에 나타나고 registry 밖 기술 event는 설정 UI에 나타나지 않는다.
- 모든 registry rule seed가 non-null active template, allowed-variable catalog, deterministic system actor를 가지며 missing catalog entry는 runtime readiness를 차단한다.
- 등록·전반·퇴원 seed는 실제 submitted/completed 관리팀 Google Chat 동작과 정확히 일치한다.
- phantom applicant/operations channel이 생성되지 않는다.
- 휴보강 persisted setting/template/history가 보존되고 completed, channel template, occurrence dedupe, team read-state가 승인된 방식으로 정규화된다.
- 할 일, 영어 단어 재시험, 전자결재는 disabled rule로 시작한다.
- shadow delivery는 skipped/shadow_mode이며 외부 발송하지 않고 cutover 때 재생되지 않는다.
- cancel, reschedule, reassignment는 unsent stale delivery만 취소하고 sent/delivery_unknown 이력을 보존한다.
- 방문상담과 SOLAPI는 마지막에 전환되고 기존 revision, claim, reconcile, unknown 의미가 유지된다.
- 등록 예약 reminder algorithm은 관련 별도 문서만 소유하며 이 adapter는 canonical occurrence와 target/channel handoff만 수행한다.
- workflow feature flag rollback이 중복 발송 없이 legacy path를 복구한다.
- stale browser와 rolling release의 legacy 호출도 shared dispatch ownership claim을 통과하지 못하면 provider를 호출하지 않는다.
- 등록 전화상담 direct projection은 별도 ownership flag로 전환되어 create/reassign/complete마다 legacy/canonical 중 한 경로만 inbox를 쓴다.
- 모든 acceptance test와 shadow comparison, rollback drill이 실제 외부 발송 없는 test credential 환경에서 통과한다.
