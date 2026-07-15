# Common Notification Control Plane Design

**Date:** 2026-07-15

**Status:** Approved

## 목적

할 일, 영어 단어 재시험, 등록, 전반, 퇴원, 휴보강, 전자결재의 알림 규칙·템플릿·전달 상태·연결 정보를 하나의 제어면에서 관리한다. 업무 변경은 업무 도메인이 소유하고, 공통 알림 제어면은 이미 커밋된 업무 이벤트를 받아 수신자를 결정하고 전달한다.

이 설계가 보장하는 기준은 다음과 같다.

1. 업무 저장과 알림 전달은 분리한다. 알림 실패나 일부 채널 실패는 이미 커밋된 업무 상태를 되돌리지 않는다.
2. 동일한 업무 발생은 재시도 횟수와 관계없이 한 이벤트로 취급하고, 실제로 새로 발생한 제출·예약 변경·리마인더 회차는 서로 다른 이벤트로 취급한다.
3. 수신자, 메시지 본문, Google Chat webhook은 브라우저가 정하지 않는다. 서버가 저장된 이벤트·규칙·템플릿·연결·권한을 다시 읽어 계산한다.
4. 인앱 알림은 개인별 projection과 사용자별 read receipt를 갖는다. 팀 대상 Google Chat은 팀원 수와 무관하게 채널당 한 번만 전송한다.
5. 외부 전송 결과가 모호하면 실패로 단정하거나 자동 재전송하지 않고 `delivery_unknown`으로 보존한다.
6. 기존 알림 데이터와 등록 전용 claim/reconciliation 상태기계는 호환 기간 동안 그대로 유지한다.

## 비목표

- 알림 제어면이 업무 상태 전이, 담당자 배정, 결재 권한 또는 등록 파이프라인을 대신하지 않는다.
- SOLAPI의 claim, provider reconciliation, `unknown` 상태나 방문상담의 예약 revision 계약을 일반적인 `sent/failed` 기록으로 축소하지 않는다.
- 아직 알림이 없던 할 일, 영어 단어 재시험, 전자결재를 배포와 동시에 활성화하지 않는다.
- 기존 `dashboard_notifications`, `dashboard_push_subscriptions`, `google_chat_webhook_settings`, 휴보강 전달 이력, 등록 전용 전달·claim 테이블을 첫 릴리스에서 삭제하거나 이름을 바꾸지 않는다.
- 과거 인앱 알림을 새 이벤트로 재발송하거나, 읽음 상태를 다시 계산하거나, 과거 전달 이력을 완전하게 복원하지 않는다.
- 첫 릴리스에 학원별 멀티테넌시나 팀별 규칙 상속을 추가하지 않는다. 모든 규칙의 `scope_key`는 `global`이고 팀 구분은 `audience_key`로 표현한다.

## 현재 호환 기준

공통화 전에 존재하는 다음 계약을 동작 기준으로 삼는다.

- `public.dashboard_notifications`는 인앱 알림 read model이고 `public.dashboard_push_subscriptions`는 사용자별 브라우저 구독이다.
- `public.google_chat_webhook_settings`는 `executive`, `admin`, `math`, `english` 연결을 보유한다.
- 휴보강은 `makeup_notification_settings`와 `makeup_notification_deliveries`에 영구 설정과 전달 이력이 있다.
- 퇴원·전반·일반 등록 설정은 현재 브라우저 로컬 상태다. 표시되는 `applicant`, `operations` 채널은 실제 전송 구현이 없고, `google_chat_admin`만 외부 전송된다.
- 등록 파이프라인의 `2.*` 구간은 일반 등록 알림을 건너뛰고 방문상담 전용 경로를 사용한다.
- 방문상담 알림은 appointment revision, subject track, director를 기준으로 중복을 방지하며 모호한 webhook 결과를 `delivery_unknown`으로 유지한다.
- 전화상담 담당자 알림은 담당자 변경과 완료 때 읽지 않은 인앱 알림을 회수할 수 있다.
- `ops_registration_messages`와 SOLAPI 경로는 claim, stable request key, accepted/failed/unknown, provider 조회와 재조정을 자체적으로 관리한다.

이 기준보다 더 많은 채널을 활성화하거나 더 넓은 수신자에게 보내는 것은 마이그레이션이 아니라 새 제품 동작이므로 별도 설정 저장 후 발생한 이벤트부터 적용한다.

## Canonical Vocabulary

모든 데이터베이스 값과 RPC/HTTP wire 필드는 아래 영문 snake_case key를 사용하고, UI만 한국어 표시명을 사용한다. TypeScript 내부 DTO는 명시적인 boundary mapper를 통과한 뒤 camelCase를 사용할 수 있지만 snake_case wire payload와 섞지 않는다. PostgreSQL `bigint` revision/generation은 JSON 경계에서 decimal string으로 내보내고 TypeScript `number`로 축소하지 않는다. 도메인 adapter는 임의 문자열 대신 이 registry의 값만 생성한다.

| 용어 | 의미 |
| --- | --- |
| scope | 규칙이 속한 설정 경계. 첫 릴리스의 유일한 값은 `global`이다. |
| workflow | 알림을 발생시킨 업무 영역이다. |
| event | 업무에서 실제로 발생한 불변 사실이다. |
| occurrence | 같은 event key가 여러 번 합법적으로 발생할 때 각 발생을 구분하는 안정적인 식별자다. |
| source revision | 원본 도메인이 영구 revision을 제공할 때의 단조 증가 버전이다. 없는 도메인에는 값을 만들지 않는다. |
| rule | workflow/event/channel/audience 조합의 활성 여부와 적용 템플릿이다. |
| template | rule에 속한 불변 버전의 제목·본문·허용 변수 정의다. |
| channel | `in_app`, `web_push`, `google_chat`, `customer_message` 중 전달 수단이다. |
| audience | 담당자, 신청자 또는 팀처럼 수신자를 계산하는 허용된 전략이다. |
| target | audience resolver가 한 event에 대해 확정한 개인 프로필, webhook connection, push subscription 또는 고객 endpoint다. |
| connection | Google Chat처럼 외부 provider에 접속하는 서버 관리 자격 정보다. |
| delivery | 하나의 event/rule/target/channel 조합에 대한 전달 상태다. |
| adapter | 도메인 데이터를 canonical event와 audience target으로 변환하는 서버 모듈이다. |

### Workflow keys

| `workflow_key` | UI 표시명 |
| --- | --- |
| `tasks` | 할 일 |
| `word_retests` | 영어 단어 재시험 |
| `registration` | 등록 |
| `transfer` | 전반 |
| `withdrawal` | 퇴원 |
| `makeup_requests` | 휴보강 |
| `approvals` | 전자결재 |

`transfer`의 한국어 표시명은 모든 설정·전달 이력·오류 메시지에서 `전반`으로 고정한다.

### Event registry

`event_key`는 workflow 안에서만 의미가 있는 짧은 상태명이 아니라 도메인 prefix를 포함한 fully-qualified stable key다.

| workflow | event namespace | 예시 |
| --- | --- | --- |
| `tasks` | `task.*` | `task.created`, `task.assignee_changed`, `task.completed` |
| `word_retests` | `word_retest.*` | `word_retest.created`, `word_retest.result_reported`, `word_retest.canceled` |
| `registration` | `registration.*` | `registration.case_created`, `registration.visit_scheduled`, `registration.admission_message_unknown` |
| `transfer` | `transfer.*` | `transfer.submitted`, `transfer.processing_started`, `transfer.completed` |
| `withdrawal` | `withdrawal.*` | `withdrawal.submitted`, `withdrawal.processing_started`, `withdrawal.completed` |
| `makeup_requests` | `makeup.*` | `makeup.submitted`, `makeup.refund_completed`, `makeup.approval_canceled` |
| `approvals` | `approval.*` | `approval.submitted`, `approval.approved`, `approval.resubmitted` |

완전한 closed event registry와 각 발생 조건은 [7개 업무 알림 어댑터 및 단계적 전환 설계](./2026-07-15-notification-workflow-adapters-design.md)의 workflow catalog가 소유하며 이 설계의 canonical contract로 함께 적용한다. 공통 제어면은 registry 밖 문자열을 거절하고 legacy `submitted/processing/completed`를 임의의 범용 event로 축약하지 않는다.

등록 `2.*` 상태 이동에는 legacy coarse processing event를 만들지 않는다. 방문상담 생성·실질 변경·취소·교체는 `registration.visit_*`, 전화상담 담당자 배정은 `registration.phone_consultation_ready`, 고객 입학 메시지는 `registration.admission_message_*` event로 분리한다.

### Channel keys

- `in_app`: 개인별 `dashboard_notifications` 행을 생성한다.
- `web_push`: 성공한 `in_app` 전달에서 파생되는 하위 delivery다. 관리자 규칙 matrix의 독립 토글이 아니며 사용자 본인의 push subscription이 존재할 때만 생성된다.
- `google_chat`: 팀 connection 한 곳으로 보내는 외부 전달이다.
- `customer_message`: SOLAPI 같은 고객 메시지 provider 전달이다. 등록 도메인의 명시적 사용자 행동과 전용 adapter가 계속 소유한다.

Google Chat의 관리팀·경영팀·수학팀·영어팀은 서로 다른 channel이 아니다. 모두 `channel_key = google_chat`이고, audience와 connection으로 구분한다.

| audience | connection |
| --- | --- |
| `management_team` | `google_chat.management` |
| `executive_team` | `google_chat.executive` |
| `subject_team` when subject is mathematics | `google_chat.math` |
| `subject_team` when subject is English | `google_chat.english` |

### Audience registry

| workflow | 허용 `audience_key` |
| --- | --- |
| `tasks` | `requester_profile`, `primary_assignee`, `secondary_assignee`, `management_team` |
| `word_retests` | `requesting_teacher`, `assigned_assistant`, `secondary_assignee`, `management_team` |
| `registration` | `registration_requester`, `track_director`, `management_team`, `subject_team`, `applicant_guardian` |
| `transfer` | `requester_profile`, `management_team` |
| `withdrawal` | `requester_profile`, `management_team` |
| `makeup_requests` | `requester_profile`, `approver_profile`, `management_team`, `executive_team`, `subject_team` |
| `approvals` | `requester_profile`, `approver_profile`, `management_team` |

규칙에는 임의 profile ID, 전화번호, webhook URL을 저장하지 않는다. adapter의 audience resolver가 event snapshot과 현재 권한 있는 도메인 관계를 이용해 target을 확정한다. `google_chat`은 `management_team`, `executive_team`, `subject_team`만 허용하고 개인 audience와 조합할 수 없다. `customer_message`는 `applicant_guardian`만 허용한다.

## 저장 위치와 보안 경계

네 핵심 테이블은 모두 `dashboard_private` schema에 둔다.

- `dashboard_private.notification_events`
- `dashboard_private.notification_rules`
- `dashboard_private.notification_templates`
- `dashboard_private.notification_deliveries`

`dashboard_private.notification_audit_logs`도 같은 schema에 둔다. 기존 registration security-definer wrapper가 사용하는 schema usage는 유지하되, `anon`과 `authenticated`에는 notification table, sequence, internal function의 직접 권한을 부여하지 않는다. Schema usage 자체를 전역 revoke해 기존 등록 RPC를 깨뜨리지 않는다. 서비스 역할과 검증된 public security-definer wrapper만 notification 원본 행에 접근한다.

공개 경계는 다음으로 제한한다.

- `public.dashboard_notifications`: 최종 사용자의 개인 인앱 read model
- `public.dashboard_notification_read_receipts`: notification/profile별 읽음 receipt. 브라우저 직접 writer는 두지 않는다.
- `public.dashboard_push_subscriptions`: 최종 사용자가 자기 브라우저 구독만 관리하는 read model
- `public.common_notification_control_plane_runtime_version()`: capability 숫자만 반환
- 관리자용 narrow read/save RPC: 역할 검사 후 필요한 설정과 마스킹된 전달 요약만 반환

private 테이블을 그대로 노출하는 public view는 만들지 않는다. 관리자·직원도 이벤트 payload, 렌더링된 전체 PII, webhook secret를 직접 select하지 않는다.

## 데이터 모델

### `dashboard_private.notification_events`

한 행은 재시도와 무관한 불변 업무 발생 한 번이다.

| 필드 | 계약 |
| --- | --- |
| `id uuid primary key` | 서버 생성 event ID |
| `scope_key text not null` | 첫 릴리스는 `global`만 허용 |
| `workflow_key text not null` | canonical workflow registry 값 |
| `event_key text not null` | 해당 workflow의 event registry 값 |
| `source_type text not null` | `ops_task_event`, `makeup_request_event`, `approval_event`, `registration_appointment`처럼 adapter registry에 등록된 원본 종류 |
| `source_id text not null` | 원본 PK의 안정적인 문자열 표현 |
| `source_revision bigint null` | 원본에 영구 revision이 있을 때만 기록 |
| `occurrence_key text not null` | 실제 발생을 구분하는 도메인 생성 key |
| `actor_profile_id uuid null` | 시스템 발생이면 null, 사용자 발생이면 검증된 profile ID |
| `occurred_at timestamptz not null` | 업무 발생 시각 |
| `payload_schema_version integer not null` | adapter payload schema 버전 |
| `payload jsonb not null` | 서버 allowlist로 만든 최소 snapshot |
| `rule_snapshot jsonb not null` | event 발생 시점의 matching rule/template revision 목록 |
| `materialized_rule_id uuid null`, `materialized_rule_revision bigint null` | 예약형 event가 occurrence에 포함한 단 하나의 stable rule/revision. 즉시형은 null |
| `created_at timestamptz not null` | event 적재 시각 |

유일 키는 `(scope_key, workflow_key, source_type, source_id, event_key, occurrence_key)`다. 동일 요청 재시도는 같은 `occurrence_key`를 사용하므로 한 event만 남는다.

`source_revision`은 원본이 저장한 단조 증가 revision이 있을 때만 사용한다. 방문상담 appointment와 예약형 schedule은 이를 제공한다. `ops_task_events`, `makeup_request_events`, `approval_events`처럼 event UUID는 있지만 원본 revision이 없는 경우 `occurrence_key`에 그 UUID를 쓰고 `source_revision = null`로 저장한다. `1`, 현재 시각 또는 클라이언트 카운터를 임의 revision으로 만들지 않는다.

반복 제출·재상신·재환불은 각 authoritative event UUID가 다르므로 서로 다른 occurrence다. 예약형 이벤트는 `{workflow}:{source_type}:{source_id}:source_revision:{source_revision}:rule:{rule_id}:rule_revision:{rule_revision}` 형식을 사용한다. `scheduled_for`는 delivery에 별도로 저장한다. source나 rule/template 시간이 실제로 바뀌면 persisted revision이 증가해 새 occurrence가 되고, 같은 예약 실행의 worker 재시도는 occurrence를 바꾸지 않는다.

event의 식별 필드와 payload는 불변이다. 보존 기간 만료 때 service-role redaction job이 payload의 PII만 삭제할 수 있으며 식별 필드와 발생 시각은 유지한다.

`rule_snapshot`은 event insert 함수가 같은 트랜잭션에서 서버 측으로 만든다. 각 항목은 `rule_id`, `rule_revision`, `rule_variant_key`, `enabled`, `channel_key`, `audience_key`, `delivery_mode`, `schedule_key`, `schedule_config`, `template_id`만 포함하고 secret나 렌더링 본문은 포함하지 않는다. adapter envelope와 브라우저는 이 필드를 공급할 수 없다. 즉시 event는 `materialized_rule_id = null`이고 발생 시점에 일치한 rule 목록을 snapshot하며 fan-out은 현재 rule row가 아니라 그 목록을 사용한다. 예약형 event는 occurrence에 포함된 rule ID/revision을 두 materialized field에 저장하고 `rule_snapshot`도 정확히 그 한 rule만 포함한다. Fan-out worker는 다른 예약 rule을 다시 검색하지 않으므로 rule별 event가 모든 reminder rule과 교차 확장되지 않는다. rule과 template는 hard delete하지 않아 snapshot이 참조한 version을 항상 해석할 수 있게 한다.

A database constraint requires the two materialized-rule fields to be both null or both non-null. `delivery_mode = immediate` events require both null; scheduled events require both non-null, a one-entry snapshot with the same ID/revision, and an occurrence key containing those exact values.

### `dashboard_private.notification_rules`

한 행은 한 workflow/event/channel/audience 조합의 전달 정책이다.

| 필드 | 계약 |
| --- | --- |
| `id uuid primary key` | 안정적인 rule ID |
| `scope_key text not null` | `global` |
| `workflow_key text not null` | canonical workflow key |
| `event_key text not null` | 해당 workflow의 허용 event key |
| `channel_key text not null` | canonical channel key |
| `audience_key text not null` | 해당 workflow의 허용 audience key |
| `rule_variant_key text not null` | `immediate` 또는 고정 예약 variant key |
| `delivery_mode text not null` | `immediate` 또는 `scheduled` |
| `schedule_key text null` | 예약형 adapter registry의 일정 종류 |
| `schedule_config jsonb null` | 예약형 schedule key별 검증된 시간 설정 |
| `enabled boolean not null` | event fan-out 활성 여부 |
| `active_template_id uuid not null` | 현재 사용할 독립 template version |
| `revision bigint not null` | rule field 또는 `active_template_id`가 실질적으로 바뀔 때만 정확히 1 증가하는 낙관적 잠금 값 |
| `created_by uuid null`, `created_actor_kind text not null` | 운영 저장이면 admin/staff profile과 `user`, migration seed면 null과 `system` |
| `updated_by uuid null`, `updated_actor_kind text not null` | 마지막 변경 actor. 운영 저장은 `user`, migration seed는 `system` |
| `created_at`, `updated_at` | 감사 시각 |

유일 키는 `(scope_key, workflow_key, event_key, channel_key, audience_key, rule_variant_key)`다. 즉시형의 `rule_variant_key`는 `immediate`이고, 예약형은 `previous_day_at`, `same_day_at`, `offset_before`처럼 고정된 schedule variant를 사용한다. 따라서 같은 event/channel/audience에도 D-1, D-day, 상대 시간 규칙이 각각 존재할 수 있다. server registry는 workflow/event/channel/audience/variant 조합을 검증한다. 예를 들어 개인 audience와 `google_chat`, 팀 audience와 `customer_message` 조합은 저장할 수 없다.

`delivery_mode = immediate`이면 `rule_variant_key = immediate`이고 `schedule_key`와 `schedule_config`는 null이다. `scheduled`이면 `rule_variant_key = schedule_key`이고 schedule key는 adapter registry의 `previous_day_at`, `same_day_at`, `offset_before` 중 해당 workflow가 허용한 값이다. wall-clock 규칙은 `{anchor_key, local_time, timezone: "Asia/Seoul"}`, 상대 규칙은 `{anchor_key, lead_minutes, timezone: "Asia/Seoul"}`로 저장한다. `anchor_key`도 adapter allowlist 값만 허용하고 `lead_minutes`는 0 이상의 정수다. 클라이언트가 임의 SQL field, timezone 또는 cron 표현식을 저장할 수 없다.

저장 RPC는 각 변경 rule의 `expected_revision`을 요구한다. 현재 revision과 다르면 전체 저장을 409 conflict로 거절하고 어느 rule도 부분 저장하지 않는다.

no-op 저장은 새 template version이나 rule revision을 만들지 않는다. 같은 `request_id`와 같은 normalized patch의 재시도는 최초 성공 결과를 그대로 반환하며, 같은 `request_id`를 다른 patch에 재사용하면 거절한다.

Actor constraints permit only `user` and `system`: `user` requires a verified profile ID, while `system` requires null. Migration-created disabled/default rows use `system` and the UI labels them `시스템 초기값`; the first effective operator save records the authenticated profile as the updater without rewriting the seed creator.

### `dashboard_private.notification_templates`

template은 rule 안의 수정 가능한 문자열이 아니라 독립적인 불변 버전 계층이다.

| 필드 | 계약 |
| --- | --- |
| `id uuid primary key` | template version ID |
| `rule_id uuid not null` | 소유 rule |
| `version bigint not null` | rule 안에서 1부터 증가 |
| `title_template text not null` | 제목 template |
| `body_template text not null` | 본문 template |
| `allowed_variables jsonb not null` | key, UI token, PII 분류를 포함한 서버 생성 allowlist |
| `payload_schema_version integer not null` | 렌더러가 요구하는 event payload 버전 |
| `checksum text not null` | 정규화된 제목·본문·변수 정의 hash |
| `created_by uuid null`, `created_actor_kind text not null` | 운영 저장이면 admin/staff profile과 `user`, migration seed면 null과 `system` |
| `created_at timestamptz not null` | 생성 시각 |

유일 키는 `(rule_id, version)`다. 이미 생성된 template 행은 수정하지 않는다. 제목·본문이 바뀌면 새 version을 insert하고 같은 저장 트랜잭션에서 rule의 `active_template_id`와 `revision`을 갱신한다. 내용이 동일한 저장은 새 version을 만들지 않는다.

`notification_templates.rule_id -> notification_rules.id`는 deferred foreign key다. Template에는 unique `(rule_id, id)`를 두고, rule의 `(id, active_template_id)`는 template의 `(rule_id, id)`를 참조하는 composite `DEFERRABLE INITIALLY DEFERRED` foreign key로 만든다. 따라서 한 rule이 다른 rule의 template를 활성화할 수 없다. 최초 seed 트랜잭션은 미리 생성한 두 UUID로 template와 rule을 insert하고 commit 시점에 양쪽 참조를 검증한다. nullable 임시 rule이나 rule 안의 inline template를 만들지 않는다.

기존 `{학생}` 형식은 호환 token으로 보존한다. 내부 변수 key는 `student_name` 같은 영문 key이고 `allowed_variables`가 `{key: "student_name", token: "학생", pii_class: "student_name"}` 관계를 고정한다. UI는 한국어 token을 삽입하지만 서버만 이를 event payload에 매핑한다. 미등록 token, raw HTML, provider mention, 허용되지 않은 외부 URL은 저장 단계에서 거절한다.

### `dashboard_private.notification_deliveries`

한 행은 하나의 target으로 보내는 한 channel 전달이다.

| 필드 | 계약 |
| --- | --- |
| `id uuid primary key` | delivery ID |
| `event_id uuid not null` | 불변 event |
| `rule_id uuid not null` | 적용 rule |
| `rule_revision bigint not null` | fan-out 시점의 rule snapshot |
| `template_id uuid not null` | 적용한 불변 template version |
| `channel_key text not null` | canonical channel |
| `audience_key text not null` | canonical audience |
| `target_generation bigint not null default 0` | 같은 source revision 안에서 수신자 집합이 바뀐 횟수. source가 별도 recipient revision을 제공하지 않으면 `0` |
| `target_set_hash text not null` | 정렬·정규화된 전체 target set의 hash |
| `target_kind text not null` | `profile`, `connection`, `push_subscription`, `customer_endpoint`, `audience` |
| `target_key text not null` | 서버가 확정한 안정적인 target 식별자 |
| `target_profile_id uuid null` | 개인 인앱/푸시 target일 때의 profile |
| `connection_key text null` | 외부 팀 connection일 때의 canonical key |
| `target_snapshot jsonb not null` | 이름 변경 등으로 과거 렌더 결과가 바뀌지 않는 PII 최소화 target snapshot |
| `parent_delivery_id uuid null` | `web_push`가 파생된 `in_app` delivery |
| `status text not null` | canonical delivery status |
| `status_reason text null` | `shadow_mode`, `no_recipient`, `connection_missing` 같은 허용 reason code |
| `dedupe_key text not null unique` | event/rule/channel/target 조합 hash |
| `rendered_title text not null` | fan-out 시점의 렌더 결과 |
| `rendered_body text not null` | fan-out 시점의 렌더 결과 |
| `href text null` | 검증된 앱 내부 경로 |
| `scheduled_for timestamptz not null` | provider 시도가 가능해지는 시각. 즉시형은 event 발생 시각, 예약형은 계산된 미래 시각 |
| `attempt_count integer not null` | 실제 provider 요청을 시작한 횟수 |
| `max_attempts integer not null` | channel policy의 상한 |
| `claimed_by text null`, `claim_token uuid null`, `lease_expires_at timestamptz null` | worker lease |
| `next_attempt_at timestamptz null` | `retry_wait` 재시도 시각 |
| `last_attempt_started_at timestamptz null` | 모호한 종료 판정 기준 |
| `cancel_requested_at timestamptz null`, `cancel_reason text null` | 이미 claim된 미전송 작업을 업무 transaction이 기다리지 않고 취소시키는 표식 |
| `provider_message_id text null` | provider가 제공할 때만 저장 |
| `provider_response_code text null` | PII 없는 provider 결과 code |
| `last_error_code text null` | 정규화된 오류 code |
| `last_error_summary text null` | secret와 본문을 제거한 짧은 설명 |
| `sent_at`, `resolved_at`, `created_at`, `updated_at` | 상태 시각 |

`dedupe_key`는 `sha256(event_id | rule_id | channel_key | target_kind | target_key | target_generation)`로 계산한다. template, 재시도 횟수, dispatch `owner_generation`은 포함하지 않는다. 같은 target generation의 event를 다시 확장해도 새 delivery가 생기지 않고, 실제 새 occurrence는 새 event ID를 가진다. 수신자 집합이 A→B→A로 돌아와도 각 재배정의 단조 증가 `target_generation`이 과거 canceled A와 새 A를 구분한다.

`status_reason`은 정상 `pending/claimed/sending/sent`에서는 null이고 `retry_wait`, `delivery_unknown`, `failed`, `skipped`, `disabled`, `canceled`에서는 registry reason code가 필수다. `web_push` child delivery는 부모 `in_app`의 rule ID, rule revision, template ID를 상속하되 channel과 target subscription이 다르므로 별도 dedupe key를 갖는다.

`web_push`는 성공한 개인 `in_app` delivery와 활성 subscription 각각에 대해 별도 child delivery를 만든다. push 실패는 부모 인앱 전달의 `sent` 상태를 바꾸지 않는다.

수신자가 0명인 경우에는 실제 profile을 위조하지 않는다. `target_kind = audience`, `target_key = audience:{audience_key}`인 synthetic target 한 건을 event/rule별로 만들고 `skipped/no_recipient`로 종결한다.

### `public.dashboard_notification_read_receipts`

읽음은 공유 notification row의 mutable 전역 속성이 아니라 로그인 profile의 독립 receipt다. 테이블은 `notification_id uuid not null references public.dashboard_notifications(id) on delete cascade`, `profile_id uuid not null references public.profiles(id) on delete cascade`, `read_at timestamptz not null default now()`를 가지며 primary key는 `(notification_id, profile_id)`다. RLS를 켜고 authenticated에는 자기 `profile_id = auth.uid()` receipt의 select만 허용한다. Insert/update/delete는 직접 grant하지 않고 ownership을 다시 확인하는 `mark_dashboard_notification_read_v1`만 수행한다. Admin/staff도 다른 profile의 receipt를 직접 읽거나 수정할 수 없다.

기존 `dashboard_notifications.read_at`은 과거 bundle 호환 컬럼으로 유지하고 backfill하거나 지우지 않는다. 신규 읽음 mutation은 이 컬럼을 갱신하지 않는다. 호환 행에 receipt가 없고 legacy `read_at`이 이미 non-null이면 그 시각을 역사적 effective read 값으로만 사용한다. 이 과거 공유 상태를 개인별로 추정해 되돌리지 않지만, migration 뒤 아직 unread인 개인/팀 행의 모든 새 읽음은 profile별 receipt로 분리된다. Canonical projection과 fixed-purpose legacy projection은 처음부터 row `read_at = null`로 만들고 receipt만 사용한다.

`dashboard_private.visible_dashboard_notification_rows_v1(p_profile_id uuid)` 하나가 active/revoked, displayable type, personal recipient, legacy management-team membership, effective receipt/read 시각을 정의한다. `get_dashboard_notification_inbox_v1`과 `get_dashboard_notification_unread_count_v1`은 반드시 이 relation을 그대로 사용하며 client-side content grouping이나 별도 unread predicate를 두지 않는다. 따라서 목록의 unread dot, badge count, pagination이 같은 행 집합을 센다.

### Durable support queues

네 핵심 계층 사이의 작업 유실을 막기 위해 `dashboard_private.notification_event_fanout_jobs`를 둔다. Canonical event와 unique fan-out job은 같은 transaction에서 생성된다. Job은 event ID, status(`pending`, `claimed`, `succeeded`, `failed`), attempt count, `next_attempt_at`, claim token, lease, rule별 outcome summary, last error, created/completed timestamp를 가진다. Cron worker는 delivery보다 fan-out job을 먼저 claim하고, unique event/rule/target key로 중간 실패를 idempotent하게 이어서 처리한다. Event만 커밋되고 delivery 확장 작업이 사라지는 상태를 허용하지 않는다.

예약 규칙 재계산은 별도의 `dashboard_private.notification_rule_reconciliation_jobs`가 담당한다. 같은 예약 event의 수신자 관계만 바뀌는 담당자 재배정은 `dashboard_private.notification_target_reconciliation_jobs`가 담당한다. Target job은 workflow/source/source revision, authoritative domain source-event ID, `recipient_set_changed` reconciliation kind, source가 잠근 단조 증가 `target_generation`, previous/current target-set hash, status, attempt count, claim lease, cancellation/fan-out count, last error, timestamps를 가지며 `(workflow_key, source_type, source_id, source_revision, source_event_id, reconciliation_kind)`가 unique다. 여기서 `source_event_id`는 `dashboard_private.notification_events.id` FK가 아니라 재배정을 실제로 커밋한 도메인의 immutable raw event UUID(예: registration raw v2 event)다. Rule마다 별도 target job을 만들지 않는다. 담당자 변경, authoritative domain source event, recipient generation 증가, target job insert는 같은 transaction에서 커밋되고 worker는 old generation의 미시도 target 취소와 existing notification event의 current generation fan-out을 idempotent하게 끝낸다. 이 세 queue는 supporting orchestration table이며 `notification_events`, `notification_rules`, `notification_templates`, `notification_deliveries` 네 canonical data layer를 대체하지 않는다.

세 orchestration queue는 같은 lease contract를 사용한다: `pending -> claimed -> succeeded | pending | failed`; retryable 오류는 attempt count와 `next_attempt_at`을 갱신하고 같은 row를 `pending`으로 되돌리며, 만료된 `claimed` lease도 provider side effect가 없는 queue 작업이므로 `pending`으로 회수한다. Non-retryable 오류 또는 max attempts 초과만 `failed`다. Admin/staff의 `다시 시도`는 failed row의 identity와 captured revisions를 바꾸지 않고 `failed -> pending`으로 전환해 같은 job을 재실행한다. `succeeded`는 terminal이고 새 job으로 복제하지 않는다.

운영자는 아래 두 public wrapper만 사용한다.

```sql
public.get_notification_orchestration_job_status_v1(
  p_job_kind text,
  p_job_id uuid
) returns jsonb

public.retry_notification_orchestration_job_v1(
  p_job_kind text,
  p_job_id uuid,
  p_expected_attempt_count integer,
  p_request_id uuid
) returns jsonb
```

두 함수는 `fanout | rule_reconciliation | target_reconciliation`과 authenticated `admin | staff`만 허용한다. Status 응답은 `{job_kind, job_id, workflow_key, status, attempt_count, next_attempt_at, last_error_code, created_at, completed_at}`만 반환하고 source payload, target, rendered body, connection, secret를 반환하지 않는다. Retry는 현재 상태가 `failed`, 오류 registry가 `manually_retryable`, attempt count가 expected 값과 같을 때만 같은 row를 `pending`/`next_attempt_at = now()`로 되돌린다. Job ID, cursor, source/event/rule/target captured revision, target generation/hash, 기존 attempt count는 유지하고 claim/lease/completed fields만 비운다. `succeeded`, `claimed`, 아직 실행 가능한 `pending`, non-retryable failure, stale expected count를 거절한다. `p_request_id`와 normalized `(job_kind, job_id, expected_attempt_count)` fingerprint는 private request ledger에 저장되어 같은 요청 재시도는 같은 결과를 반환하고 payload가 달라진 request ID 재사용은 거절한다. 실제 재실행 뒤 attempt count는 worker claim/finish 계약에 따라 계속 증가하며 기존 시도는 audit에서 사라지지 않는다.

### `dashboard_private.notification_audit_logs`

설정 저장, template version 생성, connection 변경, 수동 재시도, unknown 판정, delivery 상태 전이를 append-only로 기록한다.

필드는 `id`, `scope_key`, `entity_kind`, `entity_id`, `action`, `actor_profile_id`, `actor_kind`, `request_id`, `before_summary`, `after_summary`, `reason_code`, `created_at`이다. `actor_kind`는 `user` 또는 `system`이고 위와 같은 profile-nullability constraint를 사용한다. summary에는 rule key, revision, 상태 code, 마스킹된 target만 저장하고 webhook URL, 전화번호, 렌더링된 전체 본문은 저장하지 않는다. authenticated 역할의 update/delete는 허용하지 않는다.

## Event Envelope와 생성 경계

adapter가 만드는 canonical envelope는 다음 필드만 가진다.

```text
event_id
scope_key
workflow_key
event_key
source_type
source_id
source_revision
occurrence_key
actor_profile_id
occurred_at
payload_schema_version
payload
materialized_rule_id       # scheduled server producer only; immediate null
materialized_rule_revision # scheduled server producer only; immediate null
```

일반 브라우저는 event envelope 자체를 제출할 수 없고, fixed-purpose scheduled producer만 두 materialized-rule field를 지정할 수 있다. 클라이언트 업무 payload에 `title`, `body`, `href`, `target_profile_id`, `phone`, `webhook_url`, materialized-rule field를 넣어도 거절한다.

Canonical dispatch를 켜는 workflow는 fixed-purpose mutation RPC 또는 DB trigger가 authoritative 상태, immutable source event, `notification_events`, unique `notification_event_fanout_jobs`를 한 transaction에서 커밋해야 한다. 이 필수 event/job insert가 실패하면 그 canonical 업무 mutation도 commit하지 않는다. 브라우저 직접 mutation 뒤 알림을 호출하는 workflow는 이 atomic producer로 전환되기 전까지 canonical dispatch flag를 켤 수 없다.

Private producer `dashboard_private.record_notification_event_v1(...) returns jsonb`의 성공 결과는 정확히 `{event_id, fanout_job_id}` 두 UUID field만 가진다. 동일 occurrence replay는 기존 event와 그 unique fan-out job의 같은 pair를 반환한다. Domain mutation은 이 opaque `fanout_job_id`를 operator status reference로 반환할 수 있지만 common queue table을 직접 select하지 않는다. Event payload, rule snapshot, queue lease/cursor는 producer 응답에 포함하지 않는다.

호환 기간의 아직 전환되지 않은 legacy mutation은 저장 성공 뒤 서버 adapter가 canonical source를 다시 읽는 후행 shadow event를 만들 수 있다. 이 shadow enqueue 실패는 이미 저장된 legacy 업무를 되돌리지 않으며, UI는 업무 mutation을 반복하지 않는 알림-only retry를 제공한다. 이 경로는 비교용일 뿐 canonical dispatch owner가 될 수 없다.

event를 받은 fan-out worker는 event payload schema, 활성 rule, template version, audience resolver를 검증하고 delivery를 idempotent하게 생성한다. rule이나 수신자가 없더라도 event 자체는 삭제하지 않는다.

## Adapter rendering과 worker contract

도메인 adapter는 수신자뿐 아니라 immutable event/target snapshot을 template 변수와 내부 deep link로 바꾸는 두 callback을 필수로 제공한다. 공통 worker가 domain payload field를 추측하거나 workflow별 URL을 hard-code하지 않는다.

```ts
export type NotificationRenderInput = {
  eventId: string
  workflowKey: NotificationWorkflowKey
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
  rule: NotificationRuleSnapshot
  targetGeneration: DbBigInt
  target: NotificationTarget
  scheduledFor: string
}

export type NotificationRenderContext = Readonly<Record<string, string>>

export interface NotificationWorkflowAdapter {
  workflowKey: NotificationWorkflowKey
  resolveTargets(input: NotificationResolveInput): Promise<NotificationTargetSet>
  buildRenderContext(input: NotificationRenderInput): Promise<NotificationRenderContext>
  buildDeepLink(input: NotificationRenderInput): Promise<string | null>
  revalidateBeforeSend(input: NotificationRevalidationInput): Promise<NotificationRevalidationResult>
  reconcileScheduledRules?(input: RuleReconciliationInput): Promise<RuleReconciliationBatch>
  reconcileTargets?(input: TargetReconciliationInput): Promise<TargetReconciliationBatch>
}

export function createNotificationWorker(input: {
  getAdapter: (workflowKey: string) => NotificationWorkflowAdapter | null
}): NotificationWorker
```

`resolveTargets`는 rule 하나마다 한 번 호출한다. Worker는 event, captured rule, immutable template, target 각각을 private repository에서 읽은 뒤 target마다 같은 `NotificationRenderInput`을 두 callback에 전달한다. `buildRenderContext`는 preformatted string 값만 반환하며 template 원문, webhook, subscription secret를 받지 않는다. Worker는 반환 key가 template `allowed_variables` 밖이면 거절하고, template가 실제 사용하는 모든 token이 없거나 payload schema version이 맞지 않으면 provider 전 `failed/render_validation_failed`로 끝낸다. 제목·본문 token 치환, 길이/HTML/mention 검증은 common renderer만 수행한다.

`buildDeepLink`는 `null` 또는 `/admin/...` same-origin 상대 경로만 반환한다. Worker는 protocol-relative, absolute external, `javascript:` 및 workflow allowlist 밖 경로를 거절한다. Callback 결과를 받은 worker만 `rendered_title`, `rendered_body`, `href`를 delivery에 저장한다. Adapter는 렌더링된 본문을 delivery/apply RPC에 직접 제출하거나 provider를 호출하지 않는다.

Rule/target reconciliation callback은 여전히 source/occurrence/target draft만 반환한다. Worker가 각 draft에 대해 두 rendering callback을 다시 호출하고 snake_case apply batch를 만든다. 즉시 fan-out과 reconciliation fan-out은 동일한 render/deep-link path를 사용한다. Provider 직전에는 `revalidateBeforeSend`와 begin/commit RPC가 authoritative source/recipient/flag/ownership을 다시 검사한다. Adapter가 없으면 fan-out은 `failed/payload_schema_unsupported`, optional reconciler가 없으면 해당 job은 `failed/reconciler_missing`이며 다른 workflow adapter나 generic renderer가 추측하지 않는다.

## 수신자 fan-out과 전달 의미

### 개인·팀 인앱 알림

- 개인 audience는 target profile 하나당 `in_app` delivery 하나와 `dashboard_notifications.recipient_profile_id` 행 하나를 만들고, 읽음 때 해당 profile의 receipt 하나만 insert한다.
- 팀 audience는 event의 첫 성공 fan-out 평가 시점에 활성 팀원 profile을 서버에서 해석하고 profile마다 별도 `in_app` delivery와 inbox 행을 만든다. 해석된 target set과 hash를 fan-out job/delivery snapshot에 고정하며 같은 event의 worker retry에서 새 팀원을 다시 섞지 않는다.
- 같은 팀에 속한 두 사람이 notification row의 `read_at`을 공유하지 않는다. `mark_dashboard_notification_read_v1`은 호출자 본인의 receipt만 만들며 다른 팀원의 row/receipt를 변경하지 않는다.
- `management_team`의 활성 profile은 `profiles.role in ('admin', 'staff')`이면서 삭제·정지되지 않은 인증 계정으로 서버가 확인한다. 단순히 과거 profile row가 남아 있다는 이유만으로 수신자에 넣지 않는다. 첫 릴리스에서 authoritative membership을 계산할 수 없는 `assignee_team` 인앱 cell은 노출하지 않는다.
- 팀원이 0명이면 synthetic audience target의 `skipped/no_recipient` delivery를 남기고 설정 화면에 표시한다.
- 신규 canonical inbox projection은 `source_delivery_id`, `revoked_at`, `revoked_reason`을 가진다. 담당자 변경이나 업무 완료로 아직 읽지 않은 알림을 회수해야 할 때, 미투영 `pending`/`retry_wait` delivery는 `canceled/recipient_revoked`, pre-send `claimed`는 cancel request로 처리한다. 이미 `sent`인 in-app delivery의 unread projection은 `source_delivery_id`로 `revoked_at`과 reason만 기록하고 원본 delivery의 `sent` 이력은 바꾸지 않는다. Active inbox query는 revoked row를 숨기지만 물리 삭제하지 않는다. 이미 읽은 행, notification ID, read timestamp, delivery 감사 이력은 보존한다.

기존 팀 공유 `dashboard_notifications` 행은 그대로 두며 개인별 행으로 복제하지 않는다. 다만 migration 뒤 unread인 legacy 팀 행은 management-team 자격이 있는 각 호출자가 자기 receipt를 따로 만들므로 한 사람의 읽음이 다른 사람의 badge를 줄이지 않는다. 이미 non-null인 legacy `read_at`은 역사적 공유 결과로 보존한다. 새 제어면으로 생성하는 행부터 개인별 projection과 receipt를 모두 사용한다.

### 팀 Google Chat

팀 audience는 팀원으로 fan-out하지 않는다. `(event_id, rule_id, connection_key)`당 delivery 하나만 만들고 해당 connection으로 한 번만 보낸다. 영어와 수학이 함께 참여한 방문상담은 appointment revision당 관리팀 요약 한 건을 만들고, 책임자 인앱 알림은 distinct director profile별 한 건에 해당 subject badge를 묶는다.

connection이 없거나 비활성화되어 있으면 `failed/connection_missing`으로 끝내고 `sent`나 `skipped`로 가장하지 않는다. 연결 복구 뒤 admin/staff가 실패 delivery를 재시도할 수 있다.

Delivery identity는 rule-scoped다. 같은 profile이 서로 다른 audience rule에 동시에 포함되면 각 rule의 다른 template와 감사 의미를 보존하기 위해 별도 delivery가 생긴다. 첫 릴리스는 rule 간 자동 합치기나 template 우선순위를 만들지 않으며, 설정 UI는 같은 event/channel에서 audience가 겹치면 중복 가능성을 표시한다.

### 고객 메시지

`customer_message`는 공통 자유 발송 기능이 아니다. 등록의 명시적 입학 메시지 행동만 event를 만들 수 있고 SOLAPI adapter는 기존 `ops_registration_messages`의 claim, stable request key, provider lookup, acceptance/unknown 판단을 계속 사용한다. 공통 delivery는 그 상태를 참조하는 projection이며 provider 상태의 원본이 아니다.

## 상태 전이와 `delivery_unknown`

허용 상태는 다음과 같다.

- 실행 상태: `pending`, `claimed`, `sending`, `retry_wait`
- 성공 상태: `sent`
- 보류 상태: `delivery_unknown`
- 종료 상태: `failed`, `skipped`, `disabled`, `canceled`

허용 전이는 다음과 같다.

```text
pending | retry_wait -> claimed
claimed -> sending | pending | canceled | failed
sending -> sent | retry_wait | delivery_unknown | failed
pending -> skipped | disabled | canceled
retry_wait -> canceled
delivery_unknown -> sent | failed | retry_wait
failed -> retry_wait   (manual_retryable reason, deadline과 attempt 여유가 있을 때만)
```

- `disabled`는 event 시점에 rule이 비활성인 사실을 shadow/감사 목적으로 남길 때 사용한다.
- `skipped`는 rule은 유효하지만 수신자 없음, shadow mode처럼 외부 시도를 의도적으로 하지 않은 경우다.
- `failed`는 validation 오류, 누락된 connection, 재시도 한도 초과처럼 더 이상 자동 재시도하지 않는 확정 실패다.
- `retry_wait`는 명확한 비수락 응답이나 전송 전 일시 오류에만 사용한다.
- `delivery_unknown`은 요청을 provider가 받았을 가능성이 있지만 timeout, connection reset, worker crash 때문에 결과를 증명할 수 없는 상태다. 성공도 실패도 아니며 자동 재전송하지 않는다.

provider 조회가 가능한 SOLAPI는 reconciliation으로 unknown을 해소한다. Google Chat처럼 조회가 불가능한 channel은 관리자가 실제 채널을 확인한 뒤 `전송됨으로 처리`, `실패로 처리`, `중복 가능성을 확인하고 재전송 승인` 중 하나를 명시적으로 실행한다. 재전송 승인은 감사 로그를 남기고 `retry_wait`로 전환한다. 일반 사용자는 unknown을 해소할 수 없다.

Unknown 수동 재시도는 provider 미수신 증거가 있거나 관리자가 중복 위험을 명시적으로 수락한 경우에만 같은 delivery를 `retry_wait`로 전환한다. 승인은 `next_attempt_at`과 `manual_retry_approved` audit만 기록하고 `attempt_count`를 올리지 않는다. Attempt count는 다음 실제 `claimed -> sending` 전이에서만 증가한다.

확정 실패 중 `connection_missing`, `provider_definite_rejection`처럼 registry가 `manually_retryable`로 분류한 reason만 admin/staff가 같은 row의 `failed -> retry_wait`를 승인할 수 있다. `transient_pre_dispatch_failure`는 terminal failed가 아니라 일반 `retry_wait`로 처리한다. 업무 deadline 전이고 `attempt_count < max_attempts`여야 하며 `retry_window_closed`, `max_attempts_exhausted`, `render_validation_failed`, `schedule_validation_failed`, `payload_schema_unsupported`는 재개할 수 없다.

### Closed status-reason registry

| destination status | 허용 reason code |
| --- | --- |
| `retry_wait` | `provider_rate_limited`, `provider_definite_rejection`, `transient_pre_dispatch_failure`, `connection_restored_manual_retry`, `manual_retry_approved` |
| `delivery_unknown` | `provider_timeout_after_dispatch`, `connection_reset_after_dispatch`, `worker_lost_after_send_start`, `provider_ambiguous_response` |
| `failed` | `connection_missing`, `provider_definite_rejection`, `render_validation_failed`, `schedule_validation_failed`, `payload_schema_unsupported`, `max_attempts_exhausted`, `retry_window_closed` |
| `skipped` | `shadow_mode`, `no_recipient`, `workflow_scope_mismatch`, `not_applicable`, `legacy_skipped`, `legacy_deduped` |
| `disabled` | `rule_disabled` |
| `canceled` | `source_status_changed`, `source_schedule_changed`, `source_revision_changed`, `rule_revision_changed`, `recipient_revoked`, `cutover_rollback` |

Adapter는 단순 `stale`이나 provider 원문을 저장하지 않고 이 registry의 구체적인 code를 사용한다. `not_before_appointment`는 delivery가 생기지 않은 schedule-evaluation audit reason이므로 이 표의 delivery reason이 아니다.

## Claim, lease, retry

service-role 전용 `claim_notification_deliveries_v1(p_worker_id, p_batch_size, p_lease_seconds)` RPC는 다음을 한 트랜잭션에서 수행한다.

1. `scheduled_for <= now() AND (status = 'pending' OR (status = 'retry_wait' AND next_attempt_at <= now()))`인 행을 선택한다.
2. `FOR UPDATE SKIP LOCKED`로 서로 다른 worker가 같은 delivery를 선택하지 못하게 한다.
3. `claimed_by`, 새 `claim_token`, `lease_expires_at`, `status = claimed`를 기록한다.
4. claim token과 필요한 delivery ID만 반환한다.

worker는 provider 호출 직전에 fixed-purpose `begin_notification_delivery_send_v1` RPC로 claim token, `cancel_requested_at`, source 상태, target 권한을 다시 확인한다. 예약형 delivery는 현재 stable rule revision도 event snapshot과 같아야 하고, 즉시형 delivery는 event의 당시 `rule_snapshot`을 유지한다. 검증이 성공한 경우에만 `sending`, `last_attempt_started_at`, 증가한 `attempt_count`를 한 transaction에 기록한다. 취소 요청 또는 현재 source status/revision, rule revision, recipient 권한 불일치는 각각 closed registry의 `source_status_changed`, `source_revision_changed`, `rule_revision_changed`, `recipient_revoked`로 provider 호출 없이 `canceled` 처리한다. `claimed` 상태에서 lease가 만료되고 provider 호출을 시작하지 않은 행은 `pending`으로 되돌릴 수 있다. `sending` 상태에서 lease가 만료된 행은 이미 provider가 받았을 수 있으므로 `delivery_unknown/worker_lost_after_send_start`로 전환한다.

자동 재시도는 지수 backoff와 jitter를 사용하고 channel별 `max_attempts`를 넘지 않는다. HTTP 429, 명확한 5xx 비수락, provider 호출 전 네트워크 준비 실패는 `retry_wait`가 될 수 있다. timeout이나 request body 전송 후 connection reset은 `delivery_unknown`이다. `sent`, `delivery_unknown`, `failed`, `skipped`, `disabled`, `canceled`는 일반 worker가 다시 claim하지 않는다.

## 설정 저장의 적용 시점

즉시 이벤트 규칙과 예약형 규칙의 적용 시점을 분리한다.

### 즉시 이벤트 규칙

설정 저장이 커밋된 뒤 새로 발생한 event부터 새 rule revision과 template version을 적용한다. 이미 생성된 event와 delivery는 당시 snapshot을 유지하며 재계산하지 않는다. 설정 변경으로 과거 알림을 새로 보내거나 이미 성공한 delivery 본문을 바꾸지 않는다.

### 예약형 규칙

설정 저장 트랜잭션은 workflow별 shared advisory transaction lock을 appointment producer보다 먼저 획득하고, rule/template revision 갱신과 `dashboard_private.notification_rule_reconciliation_jobs` enqueue를 함께 커밋한다. 해당 workflow의 producer도 같은 advisory lock을 row lock보다 먼저 획득한다. 먼저 시작한 producer가 끝난 뒤 설정 저장과 reconciliation snapshot이 진행되거나, 먼저 저장된 새 rule revision을 뒤의 producer가 읽게 하여 R1 appointment가 R2 scan 뒤에 늦게 커밋되는 누락을 막는다. job은 `id`, `workflow_key`, 저장된 rule revision map, 공통 orchestration queue 상태/attempt/next-attempt/lease, 처리·취소·재생성 건수, `last_error_code`, `created_at`, `completed_at`을 가진다. 저장 성공 뒤 adapter reconciliation은 아직 provider 요청을 시작하지 않은 미래 `pending` 또는 `retry_wait` delivery를 `canceled/rule_revision_changed`로 만들고, `enabled`이고 appointment kind에 적용 가능하며 `now() < scheduled_for < appointment.scheduled_at`인 rule occurrence만 새 `rule_revision`으로 생성한다. Disabled, non-applicable, already-passed round는 event/delivery로 backfill하지 않는다.

`claimed`이지만 `sending` 전인 미래 delivery를 기다리면서 business lock을 잡지 않는다. `cancel_requested_at`과 `cancel_reason = rule_revision_changed`를 기록하고 commit한다. `begin_notification_delivery_send_v1`가 이를 확인해 provider 호출 전에 취소하며, lease reaper도 같은 요청을 종결한다. `sending`, `sent`, `delivery_unknown`, `failed`, `skipped`, `disabled`, 이미 `canceled`인 이력은 수정하거나 재생성하지 않는다. reconciliation 재시도는 같은 rule revision과 occurrence key를 사용해 중복을 만들지 않는다.

설정 UI는 `설정 저장됨`과 `예약 알림 재계산`을 서로 다른 상태로 표시한다. 저장이 성공하고 재계산이 진행 중이면 마지막 저장 시각과 함께 `예약 알림 재계산 중`을 표시한다. 재계산 실패는 저장 성공을 취소하지 않고 `예약 알림 재계산 실패 · 다시 시도`를 제공한다. 다시 시도는 reconciliation job만 재실행하며 rule/template을 다시 저장하지 않는다.

## API와 RPC 경계

### 설정 read/save

- `get_notification_control_plane_v1(p_workflow_key)`는 admin/staff만 호출할 수 있고 rule, 현재 template, revision, 마스킹된 최근 전달 요약을 반환한다.
- `save_notification_control_plane_v1(p_workflow_key, p_expected_revisions, p_patch, p_request_id)`는 admin/staff만 호출할 수 있다. server registry 검증, 새 template insert, rule revision 증가, 감사 로그, 예약 재계산 enqueue를 한 트랜잭션에서 수행한다. Private request ledger는 `request_id`, normalized patch fingerprint, committed revision/result를 저장해 동일 retry에는 같은 결과를 반환하고 다른 payload 재사용을 거절한다.
- 두 RPC 모두 호출자의 `auth.uid()`와 profile role을 내부에서 다시 검사한다. 브라우저가 `updated_by`를 지정할 수 없다.

### Event와 delivery

- generic public `insert notification event` RPC는 제공하지 않는다. 업무 mutation RPC 또는 인증된 server adapter만 event를 생성한다.
- `claim_notification_deliveries_v1`와 상태 전이 RPC는 service role 전용이다.
- 내부 dispatcher는 `deliveryId`와 claim token만 받는다. event, rule revision, immutable template, target, connection을 private schema에서 다시 읽고 렌더링·권한·상태를 재검증한다.
- admin/staff용 retry endpoint는 `deliveryId`와 사유만 받는다. 본문, target, webhook을 받지 않는다.
- orchestration status/retry endpoint는 위의 exact job RPC만 호출하고 업무 mutation, rule save, 새 job insert를 호출하지 않는다.

인앱 read model의 public signature는 다음으로 고정한다.

```sql
public.get_dashboard_notification_inbox_v1(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb

public.get_dashboard_notification_unread_count_v1() returns jsonb

public.mark_dashboard_notification_read_v1(
  p_notification_id uuid
) returns jsonb
```

세 RPC 모두 `auth.uid()`를 내부에서 얻고 viewer/profile ID를 인자로 받지 않는다. Inbox는 stable `(created_at desc, id desc)` cursor, active item, effective per-profile `read_at`, decimal-string `unread_count`, 다음 cursor만 반환한다. Count는 inbox와 같은 private visible-row relation을 센다. Mark는 active personal row 또는 현재 admin/staff가 볼 수 있는 legacy management-team row를 잠그고 `(notification_id, auth.uid())` receipt를 `ON CONFLICT DO NOTHING`으로 insert한다. 결과는 `{notification_id, newly_read, read_at, unread_count}`이며 unread count도 같은 relation에서 계산한다. 다른 개인의 row, revoked row, 내부 claim type은 `not_found`로 처리해 존재를 노출하지 않는다.

현재 `/api/google-chat`와 `/api/web-push`의 자유 형식 POST 계약은 첫 workflow cutover 전에 폐쇄한다. 그 전에 모든 active legacy sender를 source/event ID만 받는 fixed-purpose server adapter로 옮기고 서버가 원본, workflow, event, target, template를 다시 계산한다. 오래 열린 브라우저와 이전 배포 bundle의 `channel + text`, `profileIds/teamKeys + title/body/href` 요청은 `422 notification_payload_forbidden`으로 실패하며 provider를 호출하지 않는다.

Rolling release 중에도 legacy와 canonical sender는 같은 `dashboard_private.notification_dispatch_ownership_claims`의 `(workflow_key, occurrence_key, rule_id, channel_key, target_key, target_generation)` unique row를 원자적으로 claim해야 한다. Phase 0.5의 fixed-purpose legacy adapter도 source event를 읽은 뒤 canonical compatibility rule을 해석하므로 같은 stable `rule_id`와 target generation을 사용한다. 서로 다른 enabled audience rule이 우연히 같은 target을 만들면 rule ID가 달라 각각의 승인된 delivery를 보존하고, 같은 semantic rule/generation의 legacy/canonical 이중 발송만 차단한다. Claim row는 `owner_kind`, handoff 전용 `owner_generation`, `state = reserved | dispatch_started | closed`, `dispatch_started_at`, provider reference, timestamps를 가진다. `owner_generation`은 업무 수신자 버전인 `target_generation`과 절대 혼용하지 않는다. `begin_send`가 delivery 전이와 claim의 `dispatch_started`를 원자적으로 기록한다. Server-side feature flag가 그 claim의 허용 owner를 정하고, 다른 owner의 claim은 provider 호출 전 canonical delivery를 `skipped/legacy_deduped`로 끝내고 별도 `ownership_not_acquired` audit을 남긴다.

Canonical delivery를 아직 소유하지 않는 fixed-purpose legacy inbox bridge는 title/body/href를 commit RPC에 보내지 않는다. Service-role-only common helper가 authoritative source/event, compatibility rule/template, exact profile target을 다시 읽고 위 adapter `buildRenderContext`/`buildDeepLink`와 common renderer로 immutable compatibility `in_app` delivery를 먼저 materialize한다. Helper input은 `{workflowKey, eventId, ruleId, targetProfileId, targetGeneration, legacyOwnerKey, expectedOwnerGeneration, requestId}`뿐이며 `owner_kind = legacy`를 강제로 사용한다. 이 전용 materialize path는 generic dispatch flag가 false일 때의 `skipped/legacy_skipped` evaluator를 호출하지 않지만 fixed-purpose domain bridge 이외의 caller에는 노출하지 않는다. Canonical worker claim은 legacy-owned compatibility delivery를 선택하지 않는다.

Bridge는 같은 delivery identity로 `begin_legacy_notification_dispatch_v1`을 호출해 받은 claim/token을 다음 exact RPC에 전달한다.

```sql
public.commit_legacy_notification_in_app_projection_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid
) returns jsonb
```

이 service-role-only RPC는 delivery와 ownership row를 함께 lock하고 `channel_key = in_app`, stored `target_kind = profile`, `owner_kind = legacy`, identity/generation/token 일치, active source/rule/recipient를 다시 확인한다. 그런 다음 delivery에 이미 저장된 title/body/href/target만 사용해 `source_delivery_id` unique inbox row를 insert하고, delivery를 `sent`, ownership을 `closed`와 `provider_reference = inbox:{notification_id}`로 바꾸는 일을 한 transaction에서 수행한다. Push child는 만들지 않는다. 동일 token replay는 같은 notification ID를 반환하고 다른 delivery/claim/token 조합은 거절한다. Insert나 상태 전이 중 하나라도 실패하면 모두 rollback하므로 projection 없는 sent delivery나 닫힌 claim 없는 inbox가 생기지 않는다. External legacy provider는 기존 begin/finalize pair를 사용하지만 in-app은 이 atomic commit을 finalize 대용으로만 사용한다.

Rollback takeover는 provider 요청이 시작되지 않은 claim만 허용한다. Canonical pending/retry/claimed delivery가 취소되고 claim이 여전히 `reserved`이며 provider reference가 없을 때, flag 전환 transaction이 같은 row의 owner를 legacy로 바꾸고 generation을 증가시킬 수 있다. `dispatch_started`, canonical `sent`, 또는 `delivery_unknown` claim은 절대 transfer하지 않으며 legacy가 같은 occurrence를 재발송하지 않는다. 모든 transfer는 `ownership_transferred_pre_dispatch` audit을 남긴다. `ownership_not_acquired`와 transfer reason은 delivery status reason이 아니라 dispatch-ownership audit reason이다. 이 ownership gate와 자유형 endpoint 폐쇄가 완료되기 전에는 어떤 workflow도 dispatch cutover를 시작하지 않는다.

## 권한, RLS, secret, PII

### 역할

- `admin`, `staff`: 규칙과 template 조회·저장, 마스킹된 전달 상태 조회, 확정 실패 재시도
- `admin`: 위 권한에 더해 Google Chat connection 생성·교체·검증·해제와 unknown 수동 판정
- 일반 사용자: 본인 인앱 알림 조회·읽음 처리, 본인 push subscription 관리
- service role: event 적재, fan-out, claim, provider 전달, raw private 행 접근

`manager`, `super_admin` 같은 다른 문자열을 암묵적으로 admin/staff로 취급하지 않는다. 역할 확장이 필요하면 profile 권한 모델에서 먼저 명시적으로 정규화한다.

### RLS와 DB 권한

- private 핵심 테이블에는 authenticated insert/update/delete 정책을 만들지 않는다.
- `dashboard_notifications`의 실제 수신자 컬럼은 `recipient_profile_id`다. 신규 projection은 service role 또는 검증된 security-definer 함수만 insert하며 사용자가 actor, recipient, type, href를 직접 넣지 못한다.
- 기존 휴보강 browser writer를 fixed-purpose server/RPC projection으로 먼저 전환하고 배포 호환 기간을 통과한 뒤에만 authenticated insert grant/policy를 revoke한다. 그 전의 expand migration은 현재 client를 깨뜨리는 조기 revoke를 하지 않는다.
- inbox direct select/update 대신 위 narrow list/count/mark RPC를 기본 browser 경계로 사용한다. 내부 visible-row relation은 신규 개인 행의 `recipient_profile_id = auth.uid()`와 현재 admin/staff의 legacy `recipient_team = '관리팀'`만 허용하고, admin/staff가 다른 사람의 신규 개인 본문을 읽는 catch-all은 제거한다. Row `read_at` direct update grant도 호환 writer 전환 뒤 제거한다.
- `dashboard_notification_read_receipts`는 RLS로 `profile_id = auth.uid()` select만 허용하고 browser role의 direct insert/update/delete는 revoke한다. `mark_dashboard_notification_read_v1`가 active visibility를 다시 검사해 자기 receipt만 idempotent하게 만든다.
- `dashboard_push_subscriptions`는 기존처럼 본인 행만 관리하며, push 전송 대상 조회는 service role만 수행한다.
- 전달 운영 화면은 private 원본 대신 PII를 제거한 narrow RPC 결과만 사용한다.

### Connections

Connections는 규칙·template 화면과 분리한다. 첫 릴리스는 기존 `google_chat_webhook_settings`를 호환 저장소로 유지하되 `webhook_url_ciphertext`, `webhook_url_mask`, `connection_state`, `revision`, `updated_by`, `last_verified_at`, `last_error_code`를 먼저 추가한다. `connection_state`는 `legacy_active`, `encrypted_active`, `disconnected`로 제한한다. SQL migration이 Next.js encryption key를 직접 사용하지 않는다. Controlled server/Vault-backed backfill이 ciphertext를 채우고 state를 `encrypted_active`로 바꾼다. Repository는 `encrypted_active`에서 ciphertext만, `legacy_active`에서만 legacy plaintext fallback을 읽고, `disconnected`에서는 두 값을 모두 무시한다. 모든 Google Chat reader와 rollback path가 ciphertext를 읽는 것이 검증된 뒤 별도 contract migration이 기존 `webhook_url`의 `NOT NULL`을 제거하고 plaintext를 null로 지운다. 테이블 자체는 제거하지 않는다.

Compatibility repository는 canonical connection을 기존 row key에 명시적으로 매핑하며 DB primary key를 rename하지 않는다: `google_chat.management -> admin`, `google_chat.executive -> executive`, `google_chat.math -> math`, `google_chat.english -> english`.

connection GET은 admin에게도 전체 URL을 반환하지 않고 host와 마지막 식별 조각만 마스킹해 반환한다. staff는 연결됨/오류/마지막 검증 시각만 읽고 수정할 수 없다. PATCH는 admin만 가능하며 URL host가 Google Chat webhook allowlist에 맞는지 검증하고 암호화 저장한 뒤 state를 `encrypted_active`로 바꾼다. Disconnect는 한 transaction에서 state를 먼저 `disconnected`로 바꾸고 ciphertext를 삭제하며 감사 로그를 남긴다. 호환 기간의 plaintext가 아직 남아 있어도 `disconnected` state 때문에 fallback으로 부활하지 않는다.

### Web Push readiness와 사용자 테스트

Web Push readiness는 workflow dispatch flag와 별도인 연결 capability다. Canonical environment 이름은 browser build의 `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, server의 matching `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_CONTACT`다. 기존 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` alias는 호환 reader로만 허용하고 readiness 응답에는 key 값이나 subscription endpoint를 노출하지 않는다. Public/private key pair, service-role database access, `dashboard_push_subscriptions` relation, `/sw.js`, `/manifest.webmanifest`, secure context(HTTPS 또는 localhost)가 모두 준비되지 않으면 `ready`가 아니다.

Browser state는 `checking | unsupported | server_unconfigured | asset_missing | permission_prompt | permission_denied | subscription_missing | subscription_owner_mismatch | ready`로 구분한다. `permission_prompt`와 `subscription_missing`을 같은 `꺼짐` 문구로 뭉개지 않고, permission 요청은 사용자가 `켜기`를 누른 gesture 안에서만 실행한다. `permission_denied`는 OS/browser 설정에서 다시 허용하는 안내를 표시하며 disabled button만 남기지 않는다. 상태는 로그인 profile 변경, popover open, `visibilitychange`/focus 복귀 때 새로 확인하고 initial `unsupported` flash 대신 `checking`을 표시한다.

`GET /api/notifications/push-readiness`는 authenticated caller에게 boolean capability와 normalized state code만 반환한다. Browser는 별도로 same-origin `/sw.js`와 manifest가 HTTP 200인지 확인하고 실제 service-worker registration/subscription을 검사한다. Server binding은 현재 browser endpoint가 `auth.uid()` 소유 row와 일치할 때만 ready다. 다른 profile에 묶인 endpoint는 `subscription_owner_mismatch`이며 `subscribed`로 가장하지 않는다. 명시적 `이 계정으로 다시 연결` action만 authenticated fixed-purpose subscription route를 통해 ownership을 바꾸고, 단순 상태 조회나 다른 사용자의 로그인은 endpoint를 조용히 재할당하지 않는다.

`POST /api/notifications/push-readiness`는 `{action: "send_test", subscription_endpoint: string}`만 받고 해당 endpoint가 현재 `auth.uid()` 소유인지 다시 확인한다. Title/body/href/profile/team을 입력받지 않고 고정된 테스트 제목·본문과 same-origin 설정 화면 link 한 건만 현재 browser subscription으로 보낸다. 응답은 `sent | expired | failed`와 normalized code뿐이며 provider 원문을 반환하지 않는다. 이 explicit test는 workflow dispatch flag를 켜거나 canonical business delivery를 만들지 않고 `push_connection_tested` audit만 남긴다. 자동 테스트는 provider fixture를 사용하고 실제 push를 보내지 않으며, staging/production의 수동 테스트만 사용자 확인 뒤 한 건을 보낸다.

### PII와 보존

- event payload는 workflow adapter의 field allowlist만 포함한다. 전체 도메인 row나 session/token을 복사하지 않는다.
- 전화번호는 `customer_message` adapter 외 채널에서 끝 네 자리만 남기고 마스킹한다. Google Chat과 delivery 운영 로그에는 전체 학부모·학생 전화번호를 넣지 않는다.
- href는 동일 origin의 허용된 `/admin/...` 경로만 저장하며 `javascript:`, protocol-relative URL, 외부 redirect를 거절한다.
- 구조화 로그에는 event ID, delivery ID, workflow/event/channel, 상태 code와 latency만 남기고 제목·본문·webhook·전화번호는 남기지 않는다.
- 첫 릴리스는 임의의 90일/365일 파기 숫자를 새로 도입하지 않고 기존 운영 보존 정책을 유지한다. 별도 승인된 retention job을 도입할 때도 `pending`, `claimed`, `sending`, `retry_wait`, `delivery_unknown`과 연결된 event/delivery는 redaction하지 않고 terminal `resolved_at`을 기준으로 계산한다.
- 기존 domain-specific delivery/claim 테이블은 각 도메인의 기존 보존 정책을 유지하며 공통 정리 job이 삭제하지 않는다.

## 설정 UI

### 전역 화면

`/admin/settings/notifications`는 더 이상 대시보드로 redirect하지 않고 공통 제어면을 연다. 상단 업무 선택은 다음 순서를 고정한다.

1. 할 일
2. 영어 단어 재시험
3. 등록
4. 전반
5. 퇴원
6. 휴보강
7. 전자결재

각 업무 화면은 `규칙 및 템플릿`, `최근 전달`을 제공한다. admin에게만 `Connections` 편집 탭을 제공하고 staff에게는 같은 위치에서 마스킹된 연결 상태를 read-only로 보여 준다. Connections는 event/channel matrix 안에 webhook 입력칸으로 섞지 않는다.

### Scoped dialog

각 업무 메뉴의 `알림 설정`은 동일한 `NotificationControlPanel`을 locked `workflow_key`로 여는 scoped dialog다. 전역 페이지와 dialog는 같은 loader, draft model, validator, save RPC, revision conflict 처리, matrix/card renderer를 사용한다. dialog에 별도 로컬 기본값이나 별도 webhook 저장 로직을 두지 않는다.

dialog는 matrix 밖에 현재 workflow가 사용하는 Google Chat connection의 마스킹된 상태를 한 줄로 표시한다. Admin에게는 전역 Connections 탭의 해당 connection으로 이동하는 `연결 관리` action을 제공하고, staff에게는 연결됨·오류·마지막 검증 시각만 read-only로 보여 준다. 필요한 connection이 없거나 검증에 실패한 상태에서 꺼져 있던 Google Chat cell을 새로 켜면 draft validation 오류를 표시하고 저장을 막으며, matrix 안에 webhook 입력칸을 만들지 않는다. 이미 enabled인 rule의 connection이 나중에 끊기면 rule 이력은 보존하고 `연결 필요` 상태와 복구 action을 표시하며 delivery는 공통 `failed/connection_missing` 계약을 따른다.

### Desktop과 mobile

desktop은 event를 행으로, 허용된 audience/channel 조합을 열로 표시하는 compact matrix를 사용한다. 각 cell은 활성 switch와 template 편집 action을 제공하고, event 행 아래에 trigger 설명과 마지막 저장 상태를 한 줄로 표시한다. 허용되지 않은 조합은 비활성 switch가 아니라 cell 자체를 렌더하지 않는다.

행·그룹 label, 순서, exact event key, exact audience/channel cell, 초기 enabled 값, 초기 template는 adapter 문서의 closed `settings_ui_registry`만 따른다. Event catalog나 audience registry를 pattern match해 기술 이벤트 또는 모든 조합을 자동 노출하지 않는다. 서버 save validator도 같은 registry 밖 rule key를 거절한다.

mobile은 event 하나당 카드 하나를 사용한다. 카드 안에서 audience별 허용 channel switch를 세로로 배치하고 각 audience/channel rule 행에 `내용 수정` action을 둔다. 한 action으로 묶는 경우에는 sheet에서 편집할 rule의 audience·channel·예약 variant를 먼저 명확히 선택하게 한다. 페이지 전체 가로 스크롤을 만들지 않는다. desktop matrix와 mobile card는 동일한 rule별 draft state를 사용한다.

### 명시적 저장 계약

- 자동 저장하지 않는다. switch, template, 예약 offset 변경은 draft에만 적용된다.
- 화면과 dialog 하단에 sticky `변경사항 저장` bar를 둔다. dirty가 없거나 validation 오류가 있으면 저장 action을 비활성화한다.
- dirty 상태에서 X, ESC, 바깥 클릭, workflow 이동, 브라우저 뒤로 가기 또는 route 이동을 시도하면 `저장하지 않은 변경사항이 있습니다` 확인을 표시한다. 선택지는 `저장하고 이동`, `변경 버리고 이동`, `계속 편집`으로 고정한다.
- `저장하고 이동`은 save RPC 성공 후에만 원래 이동을 계속한다. 저장 실패나 revision conflict에서는 이동하지 않고 현재 draft와 dirty를 유지한다.
- 저장 중에는 중복 submit을 막고 draft를 유지한다.
- 성공하면 dirty를 비우고 `저장됨 · YYYY-MM-DD HH:mm`을 표시한다. 예약형 변경이 있으면 별도로 재계산 진행/성공/실패 상태를 표시한다.
- 실패하면 draft와 dirty를 유지하고 서버 error code를 사용자 문장으로 표시한다. 재시도는 같은 expected revision으로 save RPC만 다시 호출한다.

revision conflict가 발생하면 서버는 현재 snapshot과 revision을 반환하고 아무 변경도 저장하지 않는다. UI는 로컬 draft를 보존한 채 충돌 필드를 표시한다.

- `최신 설정 불러오기`는 확인 후 로컬 draft를 버리고 서버 snapshot을 적용한다.
- `내 변경 유지`는 최신 snapshot 위에 로컬에서 실제로 변경한 field patch만 다시 적용한다. 원격에서도 같은 field가 바뀌었다면 그 field를 충돌 표시하고 다음 저장이 원격 값을 덮어쓴다는 확인을 한 번 더 요구한다. 이 명시적 overwrite는 감사 로그에 `revision_conflict_overridden`으로 기록한다.

### 전달 상태와 부분 성공

업무 화면은 업무 저장 결과와 알림 결과를 분리해 표시한다.

- canonical event commit 뒤 fan-out 실패: `업무는 저장됨 · 알림 처리 실패`와 `알림만 다시 시도`
- 전환 전 legacy 후행 enqueue 실패: `업무는 저장됨 · 알림 등록 실패`와 `알림만 다시 시도`. 이 호환 경로는 canonical dispatch owner가 아니다.
- 전달 중: `업무는 저장됨 · 알림 전송 중`
- 일부 실패: `업무는 저장됨 · 3개 중 2개 전송, 1개 실패`와 실패 delivery 재시도
- unknown 포함: `업무는 저장됨 · 전송 결과 확인 필요`와 관리자 확인 action

성공한 delivery는 부분 실패 재시도에 포함하지 않는다. 최근 전달 목록은 workflow, event, channel, 마스킹된 대상, 상태, 발생·시도·성공 시각, reason code를 보여 주고 전체 PII 본문은 보여 주지 않는다.

## 관측성

모든 worker와 RPC는 `request_id`, `event_id`, `delivery_id`, `occurrence_key`로 연결되는 구조화 로그를 남긴다. 다음 지표를 workflow와 channel별로 집계한다.

- event 적재 성공/중복/실패 수
- event-to-delivery fan-out 지연
- fan-out/rule-reconciliation/target-reconciliation job backlog, retry, failed 수
- `pending`, `retry_wait`, `delivery_unknown`, `failed` queue 크기와 최고 대기 시간
- provider 성공률, retry 횟수, latency
- claim lease 만료와 stale `sending` 수
- `connection_missing`, `no_recipient`, `render_validation_failed` 수
- 예약 reconciliation 성공/실패/대기 시간

운영 경고는 unknown 발생, oldest pending 임계 초과, 반복 connection failure, reconciliation failure, claim lease expiry 급증에 대해 생성한다. 경고에는 ID와 reason code만 포함하고 메시지 본문과 secret는 포함하지 않는다.

## 호환 마이그레이션과 rollout

### 1. Expand

- `dashboard_private` 핵심 테이블, 감사 로그, narrow RPC, worker claim RPC, runtime marker를 추가한다.
- `notification_event_fanout_jobs`, `notification_rule_reconciliation_jobs`, `notification_target_reconciliation_jobs`, settings request ledger, rule-scoped dispatch ownership claim을 추가한다.
- `dashboard_notifications`에 nullable `source_delivery_id`, `revoked_at`, `revoked_reason`을 expand하고 기존 행은 그대로 둔다. 신규 canonical active-inbox query만 `revoked_at is null`을 적용한다.
- `public.common_notification_control_plane_runtime_version() returns 1`을 migration의 마지막 readiness marker로 만든다.
- 기존 공개 테이블과 domain-specific table을 변경 없이 읽을 수 있게 유지한다.
- live 환경에만 존재할 수 있는 `ops_task_notification_deliveries`, `ops_task_automation_runs`는 `to_regclass`로 탐지하고 발견된 행을 별도 legacy import source로 기록한다. 존재하지 않아도 migration은 성공한다.

### 2. 설정 import

- 휴보강 설정은 원본 row를 보존하며 canonical rule/template로 복사한다.
- 휴보강 `completed`가 UI에서 숨겨졌던 점과 채널별 template를 저장했지만 첫 template만 렌더링했던 점은 자동으로 한쪽을 선택하지 않는다. 현재 실제 렌더 결과를 compatibility template로 활성화하고 저장 원본은 import metadata와 감사 로그에 남겨 관리자가 비교할 수 있게 한다.
- 퇴원·전반·일반 등록은 코드 기본값을 seed하되 기존에 실제 외부 발송된 `google_chat + management_team`만 해당 event에 활성화한다. 표시만 되고 전송되지 않았던 applicant/operations 조합은 disabled로 시작한다.
- 등록 `2.*`의 legacy coarse processing event는 seed하지 않고 `registration.visit_*` adapter가 계속 소유한다.
- 전화상담 준비의 `track_director/in_app` compatibility rule은 enabled로 seed하되 phone 전용 ownership flag 전에는 canonical delivery를 만들지 않고 기존 DB projection만 inbox를 쓴다.
- 할 일, 영어 단어 재시험, 전자결재의 모든 rule은 disabled로 시작한다.
- 과거 `dashboard_notifications` ID, `read_at`, `dedupe_key`를 변경하거나 새 delivery로 backfill하지 않는다.
- 기존 휴보강 delivery는 legacy ID와 상태를 참조하는 읽기용 import row로만 남기며 새 외부 발송 후보가 되지 않는다.
- 등록의 세 신규 reminder variant와 허용 audience/channel cell은 모두 `enabled = false`로 seed한다. 운영자가 공통 설정에서 명시적으로 켜고 저장하기 전에는 기존 미래 예약도 새 리마인더를 만들지 않는다.

### 3. Legacy hardening gate

- 모든 legacy browser provider call을 source/event ID 기반 fixed-purpose server adapter로 전환한다.
- 기존 휴보강과 등록 전화상담의 직접 `dashboard_notifications` writer를 검증된 server/RPC projection으로 옮긴다.
- 자유 형식 Google Chat/Web Push POST를 폐쇄하고 stale browser 요청이 provider를 호출하지 않는지 검증한다.
- Canonical producer 대상 workflow는 business row, source event, canonical event, fan-out job을 한 transaction에 쓰는 fixed-purpose RPC/trigger로 전환한다.
- Legacy와 canonical secure path가 동일 dispatch ownership claim을 사용하게 한다.
- 이 gate가 끝나기 전에는 shadow 비교는 가능하지만 dispatch flag는 켤 수 없다.

### 4. Shadow write

`notification_control_plane_shadow_write_enabled`를 켜면 adapter가 canonical event와 예상 delivery를 생성하지만 외부 전송과 새 inbox projection은 하지 않는다. 예상 delivery는 별도 `shadow` 상태를 만들지 않고 `skipped/shadow_mode`로 종결한다. 렌더링·target snapshot은 비교에 사용하고 cutover 때 다시 열지 않는다. 감사 action은 `shadow_delivery_evaluated`다.

기존 발송 결과와 canonical 예상 target, template, occurrence, channel을 비교한다. 불일치가 해소되기 전에는 dispatch flag를 켜지 않는다.

### 5. Workflow별 cutover

모든 notification flag는 `dashboard_private.notification_runtime_flags`의 server-authoritative row로 저장한다. 각 row는 `flag_key`, `enabled`, `revision`, `updated_by`, `updated_at`을 가지며 설치 시 아래 값 전체를 false로 seed한다. Authenticated UI는 narrow capability RPC가 반환한 `notification_control_plane_settings_ui_enabled`만 사용하고 build-time `NEXT_PUBLIC_*` 복제본을 만들지 않는다. Dispatch와 shadow 판단은 provider 직전 DB ownership RPC가 같은 row를 다시 읽으므로 오래 열린 브라우저나 rolling server가 flag를 우회하지 못한다. Flag 변경은 service-role 전용 optimistic-revision RPC와 request ID로 감사되며 enabled rule 저장과 별개다. UI flag 외의 shadow/dispatch/specialized flag 활성화는 common runtime, workflow-adapters runtime, 최근 성공 worker heartbeat가 모두 확인될 때만 허용한다. Registration generic dispatch와 세 specialized registration flag는 여기에 더해 dynamically discovered `public.registration_appointment_reminders_runtime_version() = 1`이 필요하며 함수 부재, 다른 version, 조회 오류는 모두 fail closed다. Dispatch flag 비활성화는 같은 transaction에서 미시도 canonical work를 취소 또는 cancel-request 처리하고 sending/sent/unknown 이력은 보존한다.

generic dispatch flag는 다음 이름을 사용하며 기본값은 false다.

```text
notification_control_plane_dispatch_tasks_enabled
notification_control_plane_dispatch_word_retests_enabled
notification_control_plane_dispatch_registration_enabled
notification_control_plane_dispatch_transfer_enabled
notification_control_plane_dispatch_withdrawal_enabled
notification_control_plane_dispatch_makeup_requests_enabled
notification_control_plane_dispatch_approvals_enabled
```

한 workflow에서 기존 sender를 먼저 비활성화한 뒤 같은 배포 단위에서 canonical dispatch flag를 활성화한다. 두 sender를 동시에 외부 전송 가능 상태로 두지 않는다. shadow delivery는 cutover 뒤 재사용하지 않고 새 occurrence부터 canonical sender가 처리한다.

등록은 generic, 방문상담, SOLAPI를 별도 단계로 전환한다.

```text
notification_control_plane_registration_visit_adapter_enabled
notification_control_plane_registration_phone_adapter_enabled
notification_control_plane_registration_solapi_adapter_enabled
```

generic 등록과 예약 reminder를 먼저 전환하고, 전화상담 direct inbox projection, 방문상담 immediate, SOLAPI projection을 각각 별도 flag로 전환한다. 전화상담 flag가 꺼져 있으면 기존 DB projection만 소유하고 canonical `registration.phone_consultation_ready` delivery는 만들지 않는다. 방문상담 flag가 꺼져 있으면 기존 appointment revision/claim 경로가 계속 발송한다. SOLAPI flag가 꺼져 있으면 `ops_registration_messages`만 provider 전달을 소유한다. 전용 flag를 켠 뒤에도 기존 domain table은 필요한 provider 상태의 원본으로 유지한다.

### 6. UI cutover와 유지 기간

`notification_control_plane_settings_ui_enabled`가 workflow에 켜지는 순간 기존 route-local 설정 control은 제거하고 같은 위치의 action이 공통 scoped dialog 하나만 연다. 중복된 read-only 설정 화면을 병행하지 않는다. 필요한 경우 일회성 이전 안내만 보여 준다. `dashboard_notifications`, push subscriptions, Google Chat settings, domain-specific delivery/claim table 삭제는 이 설계의 rollout에 포함하지 않는다.

## 실패 안전성

- schema/runtime marker가 없으면 새 UI와 dispatcher는 fail closed하고 기존 sender를 임의로 끄지 않는다.
- event payload version을 지원하지 않으면 delivery를 만들지 않고 event를 보존하며 운영 경고를 발생시킨다.
- template 렌더링 실패, 미등록 변수, 길이 초과는 provider를 호출하기 전에 `failed/render_validation_failed`로 기록한다.
- Google Chat webhook 미설정은 HTTP 200 `skipped`나 `sent`로 기록하지 않는다.
- provider timeout을 확정 실패로 바꾸지 않는다.
- Canonical producer transaction의 필수 source event, notification event, fan-out job, 해당 mutation에 필요한 target-reconciliation job insert 실패는 업무 mutation과 함께 rollback한다. Commit 뒤 fan-out/reconciliation, rendering, delivery creation, provider 전달 실패는 authoritative 업무 상태를 rollback하지 않는다.
- 수동 retry는 delivery만 다루고 업무 생성·상태 변경 RPC를 다시 호출하지 않는다.

## Acceptance Tests

### Schema와 idempotency

- 네 핵심 테이블이 `dashboard_private`에 있고 anon/authenticated 직접 권한이 없다.
- 동일 event envelope 재적재는 unique key로 같은 event를 반환한다.
- 같은 휴보강 신청의 API 재시도는 한 event지만 실제 재상신의 새 event UUID는 새 occurrence를 만든다.
- source revision이 없는 event는 null을 유지하고 임의 `1`을 저장하지 않는다.
- 동일 event/rule/target 재확장은 delivery를 중복 생성하지 않는다.
- event transaction이 unique fan-out job도 함께 만들며, event commit 직후 worker가 중단되거나 일부 rule 확장 뒤 중단돼도 job retry가 빠진/중복 delivery 없이 완료된다.
- `record_notification_event_v1`이 `{event_id, fanout_job_id}`만 반환하고 동일 occurrence replay가 같은 pair를 반환하므로 domain UI가 common job table을 직접 읽지 않는다.
- 예약형 event의 `materialized_rule_id/revision`과 single-entry `rule_snapshot`이 occurrence의 rule과 일치하고, fan-out이 다른 reminder rule로 교차 확장되지 않는다.
- 담당자 변경 transaction이 unique target-reconciliation job을 함께 만들며 old target 취소 직후 worker가 중단돼도 retry가 current target delivery를 정확히 한 번 생성한다.
- 세 orchestration queue의 expired claim과 retryable failure가 같은 job identity로 `pending` 복귀하고, role-checked 수동 retry도 request-ledger idempotency와 expected attempt CAS를 지키며 captured revision을 바꾸지 않는다. Succeeded/claimed/nonretryable job은 재개되지 않고 status 응답에는 payload/target/body/secret가 없다.
- template 수정은 이전 행을 update하지 않고 새 version과 rule revision을 원자적으로 만든다.
- 한 rule이 다른 rule 소유 template를 `active_template_id`로 지정하면 composite FK가 거절한다.
- D-1, D-day, 상대 시간 reminder가 같은 event/channel/audience 아래 서로 다른 `rule_variant_key`로 공존한다.
- 설정 저장 직전에 생성되고 저장 직후 fan-out된 즉시 event가 event의 이전 `rule_snapshot`을 사용한다.

### Fan-out과 읽음

- 팀 audience의 인앱 알림은 활성 팀원마다 별도 inbox 행과 read state를 만든다.
- 팀 target은 첫 성공 fan-out 평가에서 snapshot되고 같은 job retry 중 membership 변화로 늘거나 줄지 않는다.
- 한 사용자의 읽음 처리가 다른 팀원의 알림을 읽음 처리하지 않는다.
- canonical/legacy personal row와 migration 뒤 unread인 legacy management-team row의 읽음은 `(notification_id, profile_id)` receipt 한 건만 만들고 notification row `read_at`을 갱신하지 않는다.
- inbox list와 unread count가 같은 visible-row relation과 effective receipt를 사용하고 client-side regrouping을 하지 않아 목록 dot, badge, mark 응답의 count가 일치한다.
- inline `읽음` action은 sibling link navigation이나 popover close를 일으키지 않고 `newly_read = true`일 때만 count를 한 번 줄인다.
- 같은 팀 audience의 Google Chat은 팀원 수와 관계없이 connection당 한 번만 전송한다.
- 영어·수학 공동 방문상담은 distinct director profile별 인앱 한 건에 해당 track badge를 묶고, 관리팀 Google Chat은 appointment revision별 한 건이다.
- push는 인앱 성공 뒤 subscription별 child delivery이고 push 실패가 인앱 성공을 바꾸지 않는다.
- 전화상담 담당자 변경은 이전 담당자의 unread projection만 회수하고 감사 이력을 남긴다.
- unread projection 회수는 `source_delivery_id`로 해당 row에 revoke metadata를 기록하고 active 목록에서 숨기되 물리 삭제나 read-state 재작성을 하지 않는다.
- 팀 membership은 첫 성공 fan-out 평가 때 한 번 snapshot되고 retry에서 바뀌지 않으며, provider 호출 직전 권한을 잃은 target은 `canceled/recipient_revoked`가 된다.
- 수신자 집합이 A→B→A로 바뀌면 세 target generation이 서로 다른 delivery identity를 만들고, 첫 A의 canceled/sent 감사 이력을 다시 열지 않은 채 마지막 A만 새 전달 후보가 된다.

### 권한과 보안

- admin/staff는 rule/template를 저장할 수 있고 일반 사용자는 읽거나 저장할 수 없다.
- Google Chat connection 변경과 unknown 수동 판정은 admin만 가능하다.
- staff와 admin에게 반환되는 connection 값은 항상 마스킹되고 전체 webhook URL은 응답·로그·감사에 없다.
- `disconnected` connection은 legacy plaintext가 남은 dual-read 기간에도 fallback으로 되살아나지 않는다.
- 일반 사용자는 자기 inbox와 push subscription만 읽고 수정한다.
- Admin/staff도 다른 profile의 read receipt나 신규 personal inbox를 catch-all로 읽거나 수정할 수 없고, mark RPC는 revoked/비소유 row를 not-found로 처리한다.
- 자유 `channel + text`, 임의 profile/team/phone, 임의 title/body/href를 보내는 API 요청은 거절되고 외부 전송이 없다.
- 외부 href와 script URL, 미등록 template 변수, 전체 전화번호가 Google Chat에 렌더링되는 template를 거절한다.

### Claim, retry, unknown

- 동시 worker가 `FOR UPDATE SKIP LOCKED`로 같은 delivery를 claim하지 않는다.
- provider 호출 전 만료된 claim은 pending으로 돌아가고, sending 후 worker 유실은 `delivery_unknown`이 된다.
- 확정 일시 오류는 backoff 후 재시도하며 max attempts 뒤 failed가 된다.
- timeout과 connection reset은 `delivery_unknown`이고 자동 재전송되지 않는다.
- missing webhook은 `failed/connection_missing`이며 sent나 skipped가 아니다.
- sent delivery와 `delivery_unknown` delivery는 일반 retry worker가 다시 claim하지 않는다.
- `delivery_unknown` 수동 재전송은 admin 확인과 감사 로그 없이는 실행되지 않는다.
- `failed -> retry_wait`는 manually-retryable reason, 남은 deadline, attempt 여유가 모두 있을 때만 허용된다.
- 수동 retry 승인은 attempt count를 바꾸지 않고 다음 실제 `claimed -> sending`에서만 증가한다.

### 설정 UI와 적용 시점

- 전역 페이지가 일곱 업무를 승인된 순서와 표시명으로 제공하고 `transfer`를 `전반`으로 표시한다.
- 업무별 dialog와 전역 페이지가 동일 component와 RPC를 사용한다.
- desktop은 matrix, mobile은 세로 card이고 페이지 가로 overflow가 없다.
- 변경은 자동 저장되지 않고 sticky 저장 bar, dirty 표시, 닫기 확인, 성공·실패, 최근 저장 시각이 동작한다.
- stale revision 저장은 원자적으로 409를 반환하고 로컬 draft를 잃지 않는다.
- 같은 request ID/patch 저장 재시도는 최초 결과를 반환하고, 다른 patch의 request ID 재사용은 거절한다.
- dirty 이동 확인의 `저장하고 이동`은 저장 성공 때만 이동하며 실패 시 draft를 유지한다.
- 전역 저장 뒤 workflow를 바꾸고 돌아오거나 새로고침하거나 scoped dialog를 다시 열어도 switch, 예약 시각, audience/channel, rule별 template가 동일하다.
- scoped dialog 저장 뒤 전역 페이지를 열어도 같은 persisted revision과 값이 보인다.
- mobile과 desktop이 같은 audience/channel/variant의 서로 다른 template를 정확히 편집·복원한다.
- 즉시 규칙 변경은 저장 후 새 event부터 적용되고 기존 delivery는 변하지 않는다.
- 예약 규칙 변경은 설정 저장 성공과 reconciliation 상태를 분리해 표시한다.
- 예약 reconciliation은 미시도 미래 delivery만 취소·재생성하고 sent/`delivery_unknown`/terminal 이력을 바꾸지 않는다.
- reconciliation 실패 retry는 업무나 rule/template 저장을 반복하지 않는다.
- Connections 편집은 규칙 matrix와 분리되고 staff에게 read-only로 보인다.
- 각 scoped dialog가 관련 Google Chat 연결 상태를 matrix 밖에 표시하고, admin의 `연결 관리` 이동과 staff read-only 상태를 제공하며, 연결 없는 신규 Chat 활성화를 저장하지 않는다.
- `/admin/tasks`, `/admin/word-retests`, `/admin/registration`, `/admin/transfer`, `/admin/withdrawal`, `/admin/makeup-requests`, `/admin/approvals` 각각에서 동일한 `알림 설정` action이 올바른 locked workflow로 열리고, scoped 저장값이 전역 화면·재진입·새로고침에서 동일하게 보인다.
- Push 상태는 checking, server/asset misconfiguration, permission prompt/denied, missing/mismatched subscription, ready를 구분하고 denied 복구 안내와 명시적 current-browser test action을 제공한다.

### 호환과 rollout

- shadow mode는 외부 Google Chat, web push, SOLAPI 또는 새 inbox 행을 만들지 않고 `skipped/shadow_mode`만 기록한다.
- workflow cutover 순간 legacy sender와 canonical sender가 동시에 활성화되지 않는다.
- 첫 cutover 전에 자유형 provider POST가 폐쇄되고 stale browser가 호출해도 외부 전송이 0건이며, legacy/canonical ownership claim은 같은 occurrence의 한 owner만 허용한다.
- 같은 occurrence/target에 서로 다른 enabled rule 두 개가 있으면 rule-scoped ownership claim 두 개가 모두 유효하고, 각 rule 안에서는 legacy/canonical 중 한 owner만 provider를 호출한다.
- rollback은 pre-dispatch `reserved` claim만 audited generation transfer하고 `dispatch_started`/sent/unknown claim의 legacy takeover를 거절한다.
- Fixed-purpose legacy inbox bridge는 raw title/body/href commit 인자를 받지 않고 stored compatibility delivery와 ownership token만 atomic commit한다. Replay는 같은 inbox ID를 반환하며 inbox insert, delivery sent, claim close 중 일부만 남지 않는다.
- 기존 browser inbox writer를 server projection으로 옮기기 전에 authenticated insert를 revoke하지 않으며, revoke 뒤 현재 휴보강/전화상담 동작이 fixed-purpose RPC로 유지된다.
- 퇴원·전반·등록 import가 기존 실제 Google Chat 발송보다 넓은 channel/audience를 활성화하지 않는다.
- 등록 `2.*`가 legacy coarse processing event를 만들지 않고 기존 방문상담 revision dedupe와 `delivery_unknown`을 보존한다.
- Generic/specialized registration flag는 common/adapters runtime과 worker heartbeat만으로 켜지지 않고 `registration_appointment_reminders_runtime_version() = 1`도 요구한다.
- SOLAPI accepted/failed/unknown/reconcile 계약과 stable provider request key가 유지된다.
- 기존 dashboard notification ID/read state와 domain-specific delivery/claim 행이 그대로 남는다.
- 실제 외부 Google Chat, web push, 고객 메시지는 자동 테스트에서 전송하지 않고 provider fixture로 상태 전이를 검증한다.
- migration seed의 null profile + `system` actor와 운영 저장의 verified profile + `user` actor constraint가 모두 통과하고 반대 조합은 거절된다.

### 운영 검증

- ephemeral Supabase/Postgres에서 pgTAP, 역할 impersonation, deferred FK, RLS, `SKIP LOCKED`, lease, advisory-lock 두 session 경합, pg_cron/pg_net smoke test를 통과한다.
- focused database/RPC tests, server adapter tests, TypeScript, ESLint, production build를 통과한다.
- desktop과 mobile에서 전역 설정, scoped dialog, dirty close, revision conflict, partial failure, unknown 확인 흐름을 실제 브라우저로 검증한다.
- Localhost에서는 matching VAPID pair로 `/sw.js` registration, current-profile subscription binding, fixed self-test 수신을 검증한다. Staging/production에서는 `/sw.js`와 `/manifest.webmanifest`가 HTTP 200인지 먼저 확인하고 explicit self-test 한 건을 실제 desktop Chrome과 설치형 mobile surface에서 확인한다. Automated suite는 provider fixture만 사용한다.
- staging에서 shadow 비교 지표와 queue/unknown/reconciliation 관측 지표를 확인한 뒤 workflow별 flag를 활성화한다.
