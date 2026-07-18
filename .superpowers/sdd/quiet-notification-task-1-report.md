# 조용한 알림 검증 작업 1 보고서

## 결과

Google Chat과 Web Push에서 POST 이후 HTTP 408을 받으면 자동 재시도하지 않고 `delivery_unknown`으로 종결하도록 보완했다. HTTP 425는 기존대로 명시적 사전 거절로 분류해 `retry_wait`을 유지한다.

## TDD 검증

- RED 명령: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-control-plane-worker.test.mjs`
- RED 결과: 43개 중 41개 통과, 2개 실패. Google Chat/Web Push 408이 실제로 `retry_wait`를 반환해 새 테스트가 기대한 `delivery_unknown`과 불일치했다.
- GREEN 명령: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-control-plane-worker.test.mjs`
- GREEN 결과: 43개 전체 통과, 실패 0개.

## 변경 파일

- `src/features/notifications/server/providers/google-chat-provider.ts`: 408만 `delivery_unknown` 및 `provider_ambiguous_response`로 분류했다.
- `src/features/notifications/server/providers/web-push-provider.ts`: 408만 같은 안전한 종결 상태로 분류했다.
- `tests/notification-control-plane-worker.test.mjs`: 두 공급자의 408 종결과 425 재시도 대기 회귀를 고정했다.

## 자체 검토

- 실제 네트워크, DB, 공급자 호출은 하지 않았으며 주입된 fixture transport만 사용했다.
- 429, 425, 5xx 및 다른 상태 코드의 기존 분류는 변경하지 않았다.
- 408 결과는 `nextAttemptAt=null`이므로 worker의 자동 재발송 대상이 되지 않는다.
- `.pnpm-store/`는 변경하거나 스테이징하지 않았다.

## 커밋

- 구현 및 테스트: `a11bd088fc9ad1bd2bc9a052d768d2d2061b6d8c` (`fix: stop retrying ambiguous 408 notifications`)
