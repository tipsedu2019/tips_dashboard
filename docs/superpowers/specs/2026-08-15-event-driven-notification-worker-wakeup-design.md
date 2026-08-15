# 이벤트 기반 Google Chat 발송·수동 재발송 설계

**작성일:** 2026-08-15

**상태:** 사용자 방향 승인 완료 · 수정 문서 검토 대기

**대상:** Google Chat 공용 알림 outbox, 각 업무의 저장·완료 UI, Supabase `pg_net`, Vercel `/api/notifications/worker`

## 1. 목표

1. Google Chat 알림은 권위 있는 업무 저장과 outbox 삽입이 commit되는 즉시 공용 worker를 비동기로 깨운다.
2. 정기 worker cron, recovery cron, watchdog cron을 모두 제거해 알림이 없을 때 Supabase 알림 리소스 사용을 0에 가깝게 만든다.
3. 담당자는 자신이 수행한 저장·완료 흐름 바로 옆에서 해당 Google Chat 발송 상태를 확인한다.
4. 발송되지 않았으면 같은 위치에서 `Google Chat 재발송`을 직접 실행한다.
5. 수동 재발송은 기존 event/outbox/delivery를 이어서 처리하며 같은 업무 알림을 새로 중복 생성하지 않는다.
6. 외부 호출 실패가 업무 저장을 rollback하거나 원본 업무 상태를 되돌리지 않게 한다.
7. 청강의 시간 기반 Google Chat reminder·feedback request는 담당 선생님의 대시보드 할 일로 대체한다.
8. SOLAPI 알림톡의 고정 백엔드 규칙과 오전 10시 단일 reminder schedule은 변경하지 않는다.

## 2. 확인된 현재 구조와 문제

- 업무 저장 함수는 `dashboard_private.notification_events`와 `dashboard_private.notification_event_fanout_jobs`를 같은 transaction에서 기록한다.
- `notification_event_fanout_jobs.event_id` unique index가 같은 event의 fanout job 중복 생성을 막는다.
- 여러 producer 응답은 이미 `notificationEventId`와 `fanoutJobId`를 반환하지만 UI가 이를 공통 발송 상태로 사용하지 않는다.
- `dashboard_private.invoke_notification_worker_v1()`은 Vault의 worker URL/secret을 검증하고 `net.http_post`로 Vercel worker를 호출한다.
- Vercel worker는 fanout, reconciliation, delivery queue를 bounded batch와 lease로 처리한다.
- 현재 환경 설정의 `최근 전달`은 workflow별 집계 숫자만 보여 주며 개별 업무나 재발송 동작은 없다.
- 기존 `reconcile_notification_delivery_v1`은 일부 terminal delivery의 수동 조정을 지원하지만, worker 호출 전 outbox 단계에 머문 건과 담당자별 source 권한을 완전히 다루지 않는다.
- 1분 worker/watchdog는 빈 queue에서도 반복 RPC와 heartbeat 쓰기를 만들고 운영 중 같은 분에 startup timeout을 기록했다.

## 3. 검토한 방식

### 3.1 채택: 이벤트 wake-up + 인라인 수동 재발송 + 담당 교사 할 일

저장 event는 비동기 worker를 즉시 깨우고, 실패는 업무 화면에서 담당자가 재처리한다. 청강의 미래 reminder/feedback request는 attendance 저장 시 생성되는 대시보드 할 일로 대체한다. 유휴 상태의 정기 실행이 없고 기존 업무 권한·할 일 UI를 재사용할 수 있다.

### 3.2 기각: 정기 recovery worker 유지

주기를 15분이나 30분으로 낮춰도 알림이 없는 시간에 worker와 heartbeat가 계속 실행된다. 사용자가 요청한 유휴 리소스 0 경계와 맞지 않는다.

### 3.3 기각: Google Tasks 또는 Google Chat space task 연동

외부 개인 할 일은 대시보드 담당자·권한·피드백 제출 상태와 원자적으로 연결되지 않는다. OAuth와 외부 동기화 실패까지 추가되므로 대시보드 `운영 → 할 일`을 source of truth로 유지한다.

### 3.4 기각: 정기 sweep으로 피드백 할 일 생성

수업 종료 시각을 주기적으로 검색해 task를 만들면 이름만 task worker일 뿐 polling 부하가 다시 생긴다. 이미 존재하는 attendance 기록 transaction이 정확한 업무 생성 경계다.

## 4. 선택한 구조

### 4.1 commit-bound outbox trigger

`dashboard_private.notification_event_fanout_jobs`에 `AFTER INSERT FOR EACH STATEMENT` trigger를 추가한다. transition table에 실제 신규 행이 있을 때만 private wake-up 함수가 한 번 실행된다.

트리거 대상은 원본 업무 테이블이 아니라 durable fanout outbox다.

- 업무 저장과 event/outbox 생성은 기존 원자성을 유지한다.
- `ON CONFLICT DO NOTHING` replay는 새 fanout job이 없으므로 worker를 다시 깨우지 않는다.
- 한 SQL statement가 여러 fanout job을 삽입해도 wake-up은 한 번이다.
- 비동기 `pg_net` 요청은 업무 저장 transaction을 외부 provider 응답 동안 붙잡지 않는다.
- trigger 내부의 Vault/stop latch/`pg_net` 오류는 닫힌 오류 코드로만 기록하고 업무 저장 오류로 다시 던지지 않는다.

### 4.2 singleton generation coalescing

연속 저장에 worker HTTP 요청이 폭증하지 않도록 `dashboard_private.notification_worker_wakeup_state`에 `global` singleton 행 하나만 둔다.

- `requested_generation`: 신규 outbox statement 또는 수동 재발송 요청마다 증가
- `active_generation`: 현재 Vercel worker에 전달한 세대 또는 null
- `completed_generation`: worker가 drain을 마쳤다고 확인한 마지막 세대
- `lease_expires_at`: 호출 시작 또는 완료 callback 유실을 판별하는 시각
- `last_requested_at`, `last_dispatched_at`, `last_completed_at`: 운영 확인 시각
- `last_request_id`: 비밀정보가 없는 pg_net request ID
- `last_error_code`: 허용된 닫힌 오류 코드 또는 null

신규 요청은 active generation이 없을 때 즉시 worker를 깨운다. 유효한 active lease가 있으면 요청 세대만 올린다. worker는 batch 종료 후 자신이 받은 generation과 성공 여부를 완료 RPC에 전달한다.

- 성공했고 실행 중 새 요청이나 즉시 claim 가능한 backlog가 없으면 active generation을 비운다.
- 실행 중 새 요청 또는 batch 뒤 backlog가 있으면 후속 worker를 정확히 한 번 호출한다.
- worker가 실패하면 즉시 자기호출을 반복하지 않고 active generation을 비운다.
- 오래된 callback은 더 최신 active generation을 지우지 않는다.
- active lease가 만료되면 담당자의 수동 재발송이 stale active를 대체하고 worker를 다시 깨운다.

즉시 backlog 검사는 각 queue의 claim index를 사용하는 `exists`만 수행하고 payload나 상세 행을 읽지 않는다.

### 4.3 정기 실행 없음

다음 두 job을 정확한 job ID로 unschedule한다.

- `tips-notification-worker-v1`
- `tips-notification-cutover-watchdog-v1`

15분 또는 30분 recovery worker도 만들지 않는다. 기존 watchdog 함수와 과거 heartbeat table은 dependency 확인 없이 drop하지 않지만 신규 schedule과 heartbeat는 만들지 않는다.

`manage_notification_worker_schedule_v1`은 과거 job을 다시 설치하지 못하도록 바꾼다.

- `inspect`: worker/watchdog job count와 active count가 모두 0인지 확인한다.
- `disable`, `remove`: 과거 이름으로 남은 job을 안전하게 비활성화하거나 제거한다.
- `install`: `notification_periodic_worker_retired`로 실패 폐쇄한다.

알림톡의 별도 오전 10시 reminder job은 이 목록에 포함하지 않는다.

기존 청강 Google Chat job 중 미래 시각을 기다리는 아래 두 종류는 신규 생성을 중단한다.

- `registration.observation_reminder_due`: 수업 3시간 전 Google Chat
- `registration.observation_feedback_due`: 수업 종료 30분 후 Google Chat

migration 시점에 아직 `pending`/`claimed`인 두 종류는 `scheduled_google_chat_replaced_by_task`로 canceled 처리한다. 이미 전송된 delivery와 감사 이력은 변경하지 않는다. 예약·변경·취소·담당자 변경·피드백 제출처럼 실제 저장과 함께 발생하는 Google Chat event는 유지한다.

## 5. 각 프로세스의 발송 상태 UI

환경 설정의 `최근 전달` 탭은 제거한다. 환경 설정에는 Google Chat 규칙, 연결, 멘션 설정만 남긴다.

Google Chat event를 만드는 각 저장·완료 흐름은 응답의 notification event/fanout identity를 공통 `GoogleChatDeliveryControl`에 전달한다. 기존 producer가 identity를 반환하지 않는 경우에는 forward migration에서 동일한 최소 receipt를 응답에 추가한다.

공통 컴포넌트는 저장·완료 버튼과 같은 결과 영역에 다음 상태만 표시한다.

| 상태 | 화면 | 담당자 동작 |
| --- | --- | --- |
| `processing` | `Google Chat 전송 중` | 기다리기 또는 상태 새로고침 |
| `sent` | `Google Chat 전송 완료` | 없음 |
| `failed` | `Google Chat 전송 실패` | `Google Chat 재발송` |
| `unknown` | `Google Chat 전송 확인 필요` | 실제 방 확인 후 재발송 |
| `delayed` | `Google Chat 처리가 지연되고 있습니다` | `다시 처리` |
| `not_applicable` | 표시하지 않음 | 없음 |

성공 표시는 현재 업무 흐름 안에서만 간결하게 유지한다. 별도 badge, inbox, unread count, 전역 알림 목록은 만들지 않는다.

한 event가 여러 Google Chat rule·방·대상을 만들면 상태는 다음 우선순위로 집계한다.

1. 하나라도 `unknown`이면 `unknown`
2. 하나라도 fanout/pending/sending이면 `processing` 또는 5초 뒤 `delayed`
3. 하나라도 확정 실패하고 나머지가 terminal이면 `failed`
4. 적용 대상 전체가 `sent`이면 `sent`
5. 적용 가능한 Google Chat rule/target이 없으면 `not_applicable`

재발송은 실패·불명·미처리 Google Chat delivery만 대상으로 하며 이미 `sent`인 방과 대상은 절대 다시 보내지 않는다. 화면에는 `3건 중 2건 전송 완료 · 1건 실패`처럼 안전한 건수만 표시하고 room, target identity, 메시지 본문은 노출하지 않는다.

### 5.1 제한적 상태 확인

저장 완료 직후 해당 event 하나만 최대 세 번 확인한다.

- 즉시 1회
- 약 2초 뒤 1회
- 약 5초 뒤 1회

`sent`, `failed`, `unknown`이 확인되면 즉시 멈춘다. 5초 뒤에도 fanout/delivery가 terminal이 아니면 `delayed`와 수동 `다시 처리`를 표시한다.

화면을 벗어나면 확인을 중단한다. 페이지 전체 polling, background interval, 환경 설정 집계 refresh는 사용하지 않는다. 사용자가 `상태 새로고침`을 누르면 해당 event 한 건만 다시 읽는다.

### 5.2 적용 범위

Google Chat event를 만드는 현재 업무 action에 공통 적용한다.

- 등록: 방문상담·청강의 예약 저장, 변경, 취소, 담당자 변경, 피드백 제출
- 업무: 생성, 배정, 진행·완료 등 Google Chat 규칙이 연결된 상태 변경
- 단어 재시험
- 반 이동·퇴원
- 휴보강
- 결재

규칙이 꺼져 있거나 Google Chat 대상이 없는 event는 `not_applicable`로 보고 UI를 표시하지 않는다. 신규 workflow는 공통 receipt와 권한 adapter를 제공해야 이 컴포넌트를 사용할 수 있다.

### 5.3 청강 피드백 할 일

시간 기반 Google Chat 대신 대시보드 `운영 → 할 일`을 업무 원장으로 사용한다. 외부 Google Tasks나 Google Chat space task는 만들지 않는다.

직원이 `청강 진행`을 기록해 observation 상태가 `attended_feedback_pending`으로 바뀌는 같은 transaction에서 담당 선생님의 일반 할 일을 생성한다.

- 제목: `청강 피드백 작성 · {학생명} · {과목}`
- 유형: 기존 `general` 할 일
- 주 담당자: observation의 `teacher_profile_id`
- 요청자: 청강 진행을 기록한 사용자
- 상태: `requested`
- 우선순위: `normal`
- 마감: 청강 `ends_at + 24시간`
- 학생·수업·과목: 기존 task list가 표시할 수 있는 최소 snapshot

`dashboard_private.registration_observation_feedback_tasks` link table에 `observation_id`, 생성된 `task_id`, 담당 교사, 생성 시 observation revision을 저장한다. `observation_id`와 `task_id`는 각각 unique로 고정해 attendance replay나 이중 클릭이 같은 할 일을 다시 만들지 못하게 한다.

할 일을 열면 일반 메모를 편집하는 대신 `피드백 작성` 버튼을 우선 표시하고 해당 등록 업무의 정확한 observation feedback panel로 이동한다. 학생명·과목은 기존 권한 안에서만 보이며 URL이나 task memo에 민감한 피드백 내용을 넣지 않는다.

피드백 제출 transaction은 연결된 할 일을 `done`으로 바꾸고 `completed_at`을 제출 시각으로 기록한다. 반대로 연결된 할 일에서 상태만 `done`으로 바꾸는 것은 `registration_observation_feedback_required`로 거부하고 피드백 작성 화면을 안내한다. 따라서 할 일 완료와 실제 피드백 완료가 갈라지지 않는다.

연결된 task의 제목, 담당자, 마감, 상태는 observation lifecycle이 소유한다. 일반 할 일 편집·삭제·취소 RPC는 link row가 있으면 해당 필드 변경을 거부한다. 담당자는 댓글을 남기고 `피드백 작성`으로 이동할 수 있지만 task를 별도로 닫거나 다른 사람에게 넘기지 않는다.

피드백 제출 전 담당 선생님이 바뀌면 open task의 `assignee_id`를 현재 observation teacher로 원자 재배정하고 task event에 이전·신규 담당자를 남긴다. 이미 완료된 task는 재배정하지 않는다.

이 system task 생성은 notification event를 만들지 않는다. 따라서 Google Chat reminder를 할 일로 바꾸면서 다시 `task.created` Google Chat을 보내는 순환을 만들지 않는다.

## 6. 조회와 수동 재발송 API

### 6.1 event 단위 상태 조회

새 authenticated RPC는 `notification_event_id` 하나만 받아 현재 로그인 사용자가 해당 원본 업무를 볼 권한이 있는지 workflow별 authorization adapter로 재검증한다.

응답은 다음 최소 정보만 포함한다.

- event ID
- 상태 enum
- 마지막 변경 시각
- 안전한 reason code
- 재발송 허용 여부
- 중복 위험 확인 필요 여부

학생명, 전화번호, 메시지 본문, webhook URL, provider 응답 원문, target identity는 반환하지 않는다. 직접 private queue/table 조회 권한은 부여하지 않는다.

### 6.2 수동 재발송

`retry_google_chat_notification_event_v1`은 다음 입력만 받는다.

- event ID
- idempotency request ID
- `Google Chat 방에 메시지가 없음을 확인했습니다` 확인값

처리 순서는 다음과 같다.

1. 현재 사용자가 원본 업무를 볼 수 있고 해당 action을 다시 처리할 권한이 있는지 workflow별 authorization adapter로 확인한다.
2. event, fanout job, Google Chat delivery, dispatch ownership을 같은 transaction에서 잠근다.
3. `sent`면 재발송을 거부한다.
4. 아직 provider dispatch 전인 `processing`/`delayed`면 기존 job 상태를 유지하고 worker wake-up만 다시 요청한다.
5. 확정 실패한 Google Chat delivery만 기존 ownership과 함께 audited manual retry 상태로 되돌린다.
6. `unknown` Google Chat delivery만 확인값이 true인 경우 duplicate-risk audit를 남기고 재시도를 허용한다.
7. 이미 `sent`인 delivery는 같은 event의 다른 target이 실패했어도 변경하지 않는다.
8. 원본 source와 rule/target이 현재도 유효한지 worker의 기존 revalidation 경계에서 다시 확인한다.
9. singleton requested generation을 증가시키고 worker를 즉시 한 번 깨운다.

재발송은 새 notification event를 만들지 않는다. 같은 request ID replay는 같은 응답을 반환하고, 다른 event나 확인값에 request ID를 재사용하면 거부한다.

## 7. 저장부터 Google Chat까지의 흐름

```text
업무 저장·완료 RPC
  -> notification_events INSERT
  -> notification_event_fanout_jobs INSERT
  -> statement trigger가 requested generation 증가
  -> active generation이 없을 때 pg_net HTTP enqueue
  -> 업무 transaction commit
  -> Vercel worker가 queue drain
  -> Google Chat provider attempt
  -> durable delivery finalize
  -> generation 완료 RPC
  -> UI가 해당 event만 제한적으로 확인
```

누락 또는 실패 시 흐름은 다음과 같다.

```text
UI에 failed / unknown / delayed 표시
  -> 담당자가 실제 Google Chat 방 확인
  -> 재발송 또는 다시 처리 버튼
  -> source 권한·현재 상태·중복 위험 재검증
  -> 기존 job/delivery를 retry 가능 상태로 전환
  -> worker 즉시 wake-up
```

사용자가 수동 재발송하지 않으면 pending/failed 상태는 자동 처리하지 않는다. 이는 정기 리소스를 사용하지 않는 대신 담당자가 결과를 확인한다는 이번 운영 결정이다.

## 8. 권한과 보안

- UI가 보인다는 사실만으로 재발송 권한을 주지 않는다.
- 공통 조회/재발송 RPC는 event의 workflow/source를 읽고 workflow-owned authorization adapter를 반드시 통과한다.
- 관리자·직원 전체 허용으로 단순화하지 않고 기존 업무의 조회·수정 권한과 동일하게 제한한다.
- private trigger/wake-up 함수는 `SECURITY DEFINER`, 빈 `search_path`, `postgres` owner를 사용하고 모든 일반 role의 직접 실행을 revoke한다.
- authenticated public RPC는 내부에서 `auth.uid()`와 원본 업무 권한을 확인하며 event ID 외 private 식별자를 신뢰하지 않는다.
- worker URL, bearer secret, Google Chat webhook, 메시지 payload, 학생·보호자 정보는 wake-up state, audit, UI, 테스트에 저장하지 않는다.
- `unknown` 재발송은 사용자 확인, request ledger, duplicate-risk audit가 모두 있어야 한다.

## 9. migration과 호환 배포

이미 적용된 migration은 수정하지 않고 새 forward migration만 추가한다.

호환 배포 순서는 다음과 같다.

1. 선택적인 `wakeup_generation`과 완료 callback을 이해하는 Vercel worker route를 먼저 배포한다. 기존 generation 없는 호출은 그대로 처리한다.
2. 공통 UI는 새 runtime capability가 없으면 렌더하지 않도록 같은 배포에 포함한다.
3. Production `READY`와 기존 worker 요청 호환성을 확인한다.
4. DB migration이 singleton, trigger, status/retry RPC, authorization adapter registry, feedback-task link/runtime capability를 설치한다.
5. migration이 청강 attendance/feedback mutation에 task 생성·자동 완료를 연결하고 미래 Google Chat reminder/feedback job 생성을 중단한다.
6. migration 마지막에 periodic worker와 watchdog job을 unschedule한다.
7. 이후 저장 event 한 건으로 trigger, worker, 상태 UI, Google Chat 실제 수신을 확인한다.
8. 실패 fixture로 담당자 수동 재발송과 실제 수신을 별도 확인한다.
9. 청강 진행 fixture에서 담당 교사 할 일 생성, deep link, 피드백 제출 자동 완료를 확인한다.

DB migration이 실패하면 cron 제거도 rollback되어 반쪽 전환을 만들지 않는다. Production migration 전에 운영 cron을 직접 수정하지 않는다.

## 10. 테스트 전략

### 10.1 Node source/UI 계약

- 새 migration만 trigger와 schedule retirement를 설치하고 기존 applied migration을 수정하지 않는다.
- worker route는 선택적 generation과 완료 callback을 처리한다.
- 각 Google Chat producer 응답이 공통 notification receipt를 제공한다.
- 저장 직후 event 단위 확인은 최대 세 번이며 background interval이 없다.
- `sent`에는 재발송 버튼이 없고 `failed`, `unknown`, `delayed`에만 허용된 버튼이 있다.
- `unknown`은 사용자 확인 없이는 retry API를 호출하지 않는다.
- 환경 설정의 `최근 전달` 탭과 delivery 집계 조회를 제거한다.
- 청강 진행 응답은 연결된 feedback task ID를 반환하고 정확한 observation panel deep link를 만든다.
- 연결된 feedback task는 일반 완료 동작을 제공하지 않고 피드백 작성 동작을 제공한다.
- 알림톡 UI, 템플릿, 오전 10시 schedule을 변경하지 않는다.

### 10.2 pgTAP

- 신규 fanout insert는 worker wake-up 하나를 만들고 업무 transaction rollback 시 request도 남지 않는다.
- 같은 statement의 복수 insert와 worker 실행 중 연속 insert는 generation으로 합쳐진다.
- worker 성공 뒤 새 요청/backlog가 있으면 후속 worker 하나만 만들고 queue가 비면 멈춘다.
- worker 실패는 즉시 자기호출하지 않는다.
- periodic worker/watchdog job count와 active count는 0이다.
- `install` action은 retired 오류로 닫힌다.
- source 권한 없는 event 조회·재발송은 존재 여부를 노출하지 않고 거부된다.
- `sent` 재발송, request ID 충돌, 확인 없는 `unknown` 재발송을 거부한다.
- 일부 target만 실패한 event는 성공 target을 보존하고 실패 target만 retry한다.
- `delayed`는 기존 fanout을 보존하고 wake-up만 다시 요청한다.
- 확정 실패 retry는 기존 event/delivery/ownership generation을 감사 가능하게 이어간다.
- attendance mutation replay와 동시 실행은 observation당 feedback task 하나만 만든다.
- feedback task 담당자는 observation teacher와 같고 마감은 `ends_at + 24 hours`다.
- feedback task 직접 완료는 거부되고 feedback 제출 transaction만 task를 완료한다.
- feedback task의 제목·담당자·마감·상태 편집과 삭제·취소는 일반 task RPC에서 거부된다.
- 피드백 제출 전 teacher 변경은 open task만 재배정한다.
- 신규 attendance/reschedule은 `reminder_due`·`feedback_due` Chat job을 만들지 않는다.
- migration 전 pending 미래 Chat job은 canceled되지만 이미 sent인 delivery는 보존된다.
- private table/function ACL과 service-role worker 경계를 지킨다.

### 10.3 운영 검증

- source/tests 통과 후 별도 gate로 migration과 배포 상태를 확인한다.
- worker/watchdog/recovery cron이 모두 0이고 오전 10시 알림톡 job만 기존 계약대로 남는지 확인한다.
- 빈 상태 30분 동안 알림 worker HTTP 요청과 worker/watchdog heartbeat 신규 행이 0인지 확인한다.
- 업무 저장 한 건에서 commit 직후 pg_net request, worker heartbeat, fanout/delivery 종료, UI `전송 완료`, Google Chat 실제 방 수신을 순서대로 확인한다.
- 실패 fixture 한 건에서 UI `전송 실패`, 담당자 권한, 수동 재발송, 두 번째 worker request와 실제 수신을 확인한다.
- `unknown` fixture는 사용자 확인 전 provider request 0, 확인 후 감사 행 1과 provider request 1인지 확인한다.
- 실제 청강 진행 한 건에서 담당 교사의 받은 할 일에 즉시 나타나고 마감이 종료 24시간 후인지 확인한다.
- 할 일의 `피드백 작성`으로 exact observation panel을 열고 제출하면 받은 할 일에서 완료로 이동하는지 확인한다.
- 3시간 전·종료 30분 후 시각이 지나도 해당 Google Chat request가 생성되지 않는지 확인한다.
- CPU/Disk I/O, cron startup timeout, worker 실행 횟수를 변경 전 관찰값과 비교한다.

## 11. 롤백

운영 이상 시 다음 순서로 중지한다.

1. global stop latch로 신규 worker 실행을 막는다.
2. UI runtime capability를 내려 재발송 버튼을 숨긴다.
3. trigger를 비활성화하는 새 forward migration을 적용한다.
4. 이미 저장된 event/outbox/delivery/heartbeat는 삭제하지 않는다.
5. 원인 수정 뒤 provider-zero, 단일 test event, 실제 방 수신 순서로 다시 검증한다.

periodic worker/watchdog/recovery cron을 자동으로 복원하지 않는다. 긴급 처리도 담당자의 명시적 수동 재발송 경계를 사용한다.

## 12. 범위 밖

- 기존 notification control-plane table과 과거 heartbeat table drop
- SOLAPI 템플릿 또는 알림톡 규칙 변경
- Google Chat webhook/identity/room routing 변경
- 외부 Google Tasks 또는 Google Chat space task 연동
- 대시보드 알림 inbox, unread badge, web push 복원
- provider `unknown` 상태의 무확인 자동 재발송
- 정기 worker, watchdog, recovery cron 신설
- Supabase compute tier 변경
