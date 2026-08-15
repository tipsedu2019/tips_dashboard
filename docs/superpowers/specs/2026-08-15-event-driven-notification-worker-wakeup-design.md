# 이벤트 기반 알림 워커 wake-up 설계

**작성일:** 2026-08-15

**상태:** 사용자 방향 승인 완료 · 문서 검토 대기

**대상:** Google Chat 공용 알림 outbox, Supabase `pg_net`/`pg_cron`, Vercel `/api/notifications/worker`

## 1. 목표

1. Google Chat 알림은 권위 있는 업무 저장과 outbox 삽입이 commit되는 즉시 공용 워커를 비동기로 깨운다.
2. 1분마다 빈 큐를 확인하던 worker cron과 watchdog cron을 제거해 Supabase Free/Nano의 주기 부하와 heartbeat 쓰기를 줄인다.
3. worker 실행 중 저장이 몰려도 Vercel worker 호출이 저장 건수만큼 폭증하지 않도록 wake-up을 세대 단위로 합친다.
4. wake-up 호출 실패가 업무 저장을 rollback하거나 Google Chat event/outbox를 유실시키지 않게 한다.
5. 유실된 HTTP wake-up과 stale lease는 저빈도 복구 cron이 처리한다.
6. 알림톡의 고정된 백엔드 규칙과 오전 10시 단일 reminder schedule은 변경하지 않는다.

## 2. 확인된 현재 구조와 문제

- 업무 저장 함수는 `dashboard_private.notification_events`와 `dashboard_private.notification_event_fanout_jobs`를 같은 transaction에서 기록한다.
- `notification_event_fanout_jobs.event_id`의 unique index가 같은 event의 fanout job 중복 생성을 막는다.
- `dashboard_private.invoke_notification_worker_v1()`은 Vault의 worker URL/secret을 검증하고 `net.http_post`로 Vercel worker를 호출한다.
- Vercel worker는 fanout, reconciliation, delivery queue를 bounded batch와 lease로 처리한다.
- 현재 `tips-notification-worker-v1`과 `tips-notification-cutover-watchdog-v1`은 각각 매분 같은 시점에 실행된다.
- 빈 worker도 여러 RPC와 heartbeat 쓰기를 수행하고, watchdog은 매분 worker heartbeat를 다시 읽고 자체 heartbeat를 기록한다.
- 운영 관찰에서는 두 job이 같은 분에 `job startup timeout`을 함께 기록했다. 큐가 비어 있어도 이 주기 작업은 계속된다.

## 3. 선택한 방식

### 3.1 commit-bound outbox trigger

`dashboard_private.notification_event_fanout_jobs`에 `AFTER INSERT FOR EACH STATEMENT` trigger를 추가한다. transition table에 실제 신규 행이 있을 때만 private wake-up 함수가 한 번 실행된다.

트리거 대상은 원본 업무 테이블이 아니라 durable fanout outbox다. 따라서 다음이 성립한다.

- 업무 저장과 event/outbox 생성은 기존 원자성을 유지한다.
- `ON CONFLICT DO NOTHING`으로 새 fanout job이 생기지 않은 replay는 worker를 깨우지 않는다.
- 한 SQL statement가 여러 fanout job을 삽입해도 wake-up 함수는 한 번만 호출된다.
- `pg_net` 요청은 transaction commit 뒤 전달되므로 rollback된 업무 저장은 worker를 깨우지 않는다.

### 3.2 singleton generation coalescing

`dashboard_private.notification_worker_wakeup_state`에 `global` singleton 행 하나만 둔다. private wake-up 함수는 이 행을 잠그고 아래 상태만 기록한다.

- `requested_generation`: 신규 outbox statement를 관찰할 때마다 증가하는 세대
- `active_generation`: 현재 HTTP worker에게 전달한 세대 또는 null
- `completed_generation`: worker가 drain을 마쳤다고 확인한 마지막 세대
- `lease_expires_at`: Vercel 호출이 시작되지 않거나 종료 callback이 유실된 경우의 회수 시각
- `last_requested_at`, `last_dispatched_at`, `last_completed_at`: 비밀정보가 없는 관찰 시각
- `last_request_id`: 비밀정보가 없는 pg_net request ID
- `last_error_code`: 닫힌 오류 코드 또는 null

신규 outbox가 생기면 `requested_generation`을 증가시킨다. 실행 중인 `active_generation`이 없으면 현재 요청 세대를 body에 넣어 worker를 즉시 한 번 호출한다. 유효한 active lease가 있으면 새 HTTP 요청을 만들지 않고 요청 세대만 올린다. active lease가 만료됐다면 새 요청 세대가 stale active를 대체하고 worker를 다시 깨운다. singleton row의 transaction lock으로 동시 저장도 하나의 active generation만 얻는다.

Vercel worker는 batch 종료의 성공·실패와 관계없이 service-role-only 완료 RPC에 자신이 받은 세대와 성공 여부를 전달한다. 완료 RPC는 singleton을 잠근 뒤 다음처럼 동작한다.

- 성공했고 `requested_generation <= 완료 세대`이며 즉시 처리 가능한 queue가 없음: active generation을 비우고 종료한다.
- `requested_generation > 완료 세대`: 실행 중 들어온 저장이 있으므로 최신 요청 세대를 active로 바꾸고 후속 worker를 정확히 한 번 호출한다.
- 성공했지만 batch 뒤 즉시 처리 가능한 queue가 남음: requested generation을 한 번 올리고 후속 worker를 정확히 한 번 호출한다.
- worker 실패: active generation을 비우고 오류 코드만 남긴다. 같은 장애에서 즉시 자기호출을 반복하지 않고 다음 신규 event 또는 15분 recovery가 재시도한다.
- 오래된 worker의 늦은 완료 callback: 더 최신 active generation을 지우지 않고 무시한다.

즉시 처리 가능한 queue 검사는 fanout, rule reconciliation, target reconciliation, delivery, observation Chat job 각각에 대해 claim index를 타는 `exists`만 사용하고 상세 행이나 payload를 읽지 않는다. 미래 `next_attempt_at`까지 반복 예약하지는 않는다.

따라서 첫 저장은 즉시 worker를 깨우고, 실행 중 몰린 저장과 batch limit 뒤 backlog는 현재 batch 또는 정확히 한 번씩 이어지는 후속 batch가 회수한다. 단순 시간창 억제처럼 늦게 들어온 이벤트가 15분 recovery까지 남는 구간을 만들지 않는다.

### 3.3 업무 저장 fail-open, 전달은 at-least-once

outbox trigger와 완료 RPC의 wake-up 보조 함수는 Vault, stop latch, `pg_net` 오류를 모두 잡아 닫힌 `last_error_code`만 기록하고 반환한다. 외부 호출 준비 실패를 업무 저장 오류로 다시 던지지 않는다. enqueue 실패 시 active generation과 lease를 정리해 다음 신규 event가 즉시 다시 시도할 수 있게 한다.

이 경우에도 event와 fanout job은 `pending`으로 남는다. provider 전송의 중복 방지는 기존 event, delivery, attempt ledger 계약이 담당한다. wake-up 자체는 at-least-once여도 provider를 무조건 재전송하지 않는다.

### 3.4 저빈도 recovery cron

- `tips-notification-worker-v1`: `*/15 * * * *`로 변경하고 active 상태를 유지한다.
- `tips-notification-cutover-watchdog-v1`: unschedule한다.
- 복구 cron은 15분마다 기존 worker를 한 번 호출한다. 누락된 pg_net 요청, worker invocation 실패, stale lease, trigger 설치 전 남은 queue를 회수한다.
- 정상 이벤트는 trigger가 즉시 처리하므로 15분 cron은 전달 지연을 결정하는 기본 경로가 아니다.
- worker heartbeat는 실제 event wake-up 또는 15분 recovery 때만 기록된다. watchdog heartbeat 신규 쓰기는 중단한다.

기존 watchdog 함수와 과거 heartbeat table은 이번 migration에서 drop하지 않는다. 운영 의존성 확인 없이 파괴적 정리를 하지 않고, schedule만 제거한다.

## 4. 저장부터 Google Chat까지의 흐름

```text
업무 저장 RPC
  -> notification_events INSERT
  -> notification_event_fanout_jobs INSERT
  -> AFTER INSERT STATEMENT trigger
  -> singleton requested generation 증가
  -> active generation이 없을 때만 net.http_post enqueue
  -> transaction commit
  -> Vercel worker wake-up
  -> fanout / reconciliation / delivery drain
  -> Google Chat provider attempt
  -> durable result finalize
  -> wake-up generation 완료 RPC
  -> 실행 중 새 요청 세대 또는 즉시 backlog가 있으면 후속 worker 1회
```

오류 시 흐름은 다음과 같다.

```text
wake-up 준비 또는 HTTP invocation 실패
  -> 업무 저장과 outbox는 정상 commit
  -> 안전한 error code만 singleton에 기록
  -> active generation 정리
  -> 다음 신규 event 또는 15분 recovery cron이 queue를 다시 drain
```

## 5. 알림톡과 다른 예약 작업의 경계

- SOLAPI 템플릿, 치환 변수, 승인된 알림톡 규칙은 변경하지 않는다.
- `tips-registration-customer-reminder-v1` 또는 현재의 단일 오전 10시(KST) reminder schedule은 변경하지 않는다.
- 이번 trigger는 공용 `notification_event_fanout_jobs` 신규 삽입에만 반응한다.
- 알림톡 설정 UI를 다시 만들거나 대시보드에서 고정 규칙을 노출하지 않는다.
- Google Chat 연결/규칙을 환경 설정에서 관리하는 기존 UI 경계는 유지한다.

## 6. 관리 RPC와 관찰 계약

`public.manage_notification_worker_schedule_v1`의 동작은 하위 호환되게 유지하되 schedule 계약을 바꾼다.

- `install`: worker recovery cron 하나만 `*/15 * * * *`로 설치한다. watchdog cron은 설치하지 않는다.
- `disable`: worker recovery cron을 비활성화한다. outbox trigger의 stop latch 계약은 기존대로 유지한다.
- `remove`: worker와 잔존 watchdog 이름을 모두 제거해 과거 설치도 정리한다.
- `inspect`: worker count/active/contract, watchdog count/active가 각각 기대값인지 반환하고 wake-up singleton의 요청·active·완료 세대와 최근 시각·오류 코드를 비밀정보 없이 추가한다.

Vercel worker route는 선택적인 `wakeup_generation` 숫자만 추가로 받는다. 해당 값이 있는 event wake-up은 batch 종료 후 성공 여부와 함께 완료 RPC를 호출하고, generation이 없는 15분 recovery 호출은 기존 방식으로 queue를 drain한다. public 완료 RPC는 service role과 유효한 generation만 허용한다.

과거 응답 키는 가능한 한 유지한다. watchdog 기대값은 `0`으로 바꾸고, 운영 화면이 `1분 heartbeat 없음`을 장애로 오판하는 참조가 있는지 source test로 점검한다.

## 7. 보안과 권한

- trigger와 wake-up 함수는 `dashboard_private`에 두고 `SECURITY DEFINER`, 빈 `search_path`, `postgres` owner를 사용한다.
- `public`, `anon`, `authenticated`, `service_role`에 private 함수와 singleton table 직접 권한을 부여하지 않는다.
- 기존 public schedule manager만 `service_role` 실행을 허용한다.
- worker URL, bearer secret, Google Chat webhook, payload, 학생·보호자 정보는 singleton, 로그, 테스트, 문서에 저장하지 않는다.
- trigger 오류에는 예외 원문 대신 허용된 닫힌 오류 코드만 남긴다.

## 8. migration과 운영 전환

새 forward migration 하나로만 변경한다. 이미 적용된 migration은 수정하지 않는다.

migration은 다음 순서로 실행한다.

1. singleton table/행, private generation coalescing 함수, statement trigger를 설치한다.
2. inspect/manage RPC를 새 schedule 계약으로 교체한다.
3. 동일 이름의 worker job이 있으면 `*/15 * * * *`와 기존 command로 변경하고 active를 유지한다.
4. 잔존 watchdog job은 job ID를 정확히 조회해 unschedule한다.
5. job 이름/command가 예상 계약과 다르면 임의 교체하지 않고 migration을 실패시킨다.

운영 전환은 source/tests, migration, `main`/Vercel, runtime/worker, provider request, 실제 방 수신을 별도 gate로 확인한다. migration 적용 전에는 운영 cron을 직접 변경하지 않는다.

배포 순서는 호환성을 지킨다.

1. 선택적인 `wakeup_generation`을 이해하지만 기존 요청도 그대로 처리하는 Vercel route를 먼저 Production에 배포한다.
2. Production `READY`와 기존 generation 없는 worker 요청을 확인한다.
3. 그다음 trigger와 generation body를 보내는 DB migration을 적용한다.
4. 이전 route는 새 body를 거절하므로 순서를 뒤집지 않는다.

## 9. 테스트 전략

### 9.1 Node source contract

- 새 migration만 schedule 계약을 `*/15`와 watchdog 0으로 전환한다.
- statement trigger, transition table, requested/active/completed generation coalescing, stale lease, exception containment가 존재한다.
- worker route는 선택적 generation만 받고 완료 RPC를 `finally` 경계에서 호출한다.
- trigger가 provider URL/secret/payload를 직접 다루지 않는다.
- 기존 applied migration을 수정하지 않는다.
- 오전 10시 알림톡 reminder migration과 schedule을 변경하지 않는다.

### 9.2 pgTAP

- 신규 outbox insert는 첫 wake-up request를 하나 만든다.
- 같은 statement의 복수 insert는 request 하나로 합쳐진다.
- worker 실행 중 연속 insert는 새 active request를 만들지 않고 requested generation만 증가시킨다.
- worker 완료 시 미처리 requested generation이 있으면 후속 request를 정확히 하나 만든다.
- 성공 batch 뒤 즉시 claim 가능한 backlog가 남으면 후속 request를 하나 만들고, queue가 빌 때 멈춘다.
- 실패 batch는 due work가 남아 있어도 즉시 자기호출하지 않는다.
- 오래된 완료 callback은 최신 active generation을 지우지 않는다.
- active lease가 만료되면 신규 event가 worker를 다시 깨울 수 있다.
- replay로 fanout insert가 충돌하면 request를 만들지 않는다.
- Vault/stop latch/pg_net 오류가 나도 fanout row는 commit 가능하고 안전한 오류 코드만 남는다.
- install/inspect/disable/remove가 worker recovery cron 한 개와 watchdog 0개 계약을 지킨다.
- private ACL과 service-role-only 관리 경계를 지킨다.

### 9.3 운영 검증

- migration 전후 cron job 수와 schedule을 정확한 이름으로 비교한다.
- 1분 worker/watchdog run이 더 생기지 않는지 확인한다.
- 합성 또는 승인된 안전한 Google Chat event 한 건에서 commit 직후 pg_net request, worker heartbeat, fanout/delivery 종료를 순서대로 확인한다.
- 빈 상태 30분 동안 recovery worker는 최대 두 번이고 watchdog run은 0번인지 확인한다.
- CPU/Disk I/O, cron startup timeout, worker 평균 실행시간을 변경 전 관찰값과 비교한다.
- provider request와 실제 Google Chat 방 수신은 별도 증거로 확인한다.

## 10. 롤백

운영 이상 시 다음 순서로 되돌린다.

1. global stop latch로 신규 worker 실행을 중지한다.
2. outbox trigger를 비활성화하는 새 forward migration을 적용한다.
3. recovery cron을 `disable`한다.
4. 이미 저장된 event/outbox/delivery/heartbeat는 삭제하지 않는다.
5. 원인 수정 뒤 trigger, recovery cron, provider를 순차 재검증한다.

1분 polling과 watchdog으로 자동 복귀하지 않는다. 긴급 수동 drain이 필요하면 기존 인증된 worker route를 한 번 호출하고 결과를 별도 검증한다.

## 11. 범위 밖

- 기존 알림 control-plane 테이블과 watchdog 함수의 drop
- SOLAPI 템플릿 또는 알림톡 규칙 변경
- Google Chat webhook/identity/room routing 변경
- 대시보드 알림 UI 복원
- provider unknown 상태의 자동 재발송 정책 변경
- Supabase compute tier 변경
