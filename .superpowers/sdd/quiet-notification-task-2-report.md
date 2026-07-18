# 조용한 알림 검증 작업 2 보고서

## 결과

즉시 알림 어댑터가 유효한 프로필 또는 Google Chat 연결을 하나도 해석하지 못해도, 대상 집합을 빈 배열로 만들지 않고 `audience` 대상 1건을 남기도록 변경했다. 이 대상은 SQL materializer가 `skipped/no_recipient` 결과를 보존할 수 있게 한다.

## TDD 검증

- RED: `notification-workflow-registry.test.mjs`에 프로필 0명 및 과목 Chat `unknown` 사례를 먼저 추가했다. 지정 명령 실행 결과 11개 중 9개 통과, 2개 실패였으며, 실패 내용은 기존 빈 대상 배열(`[]`)과 기대한 `audience` 대상의 차이였다.
- GREEN: 최소 구현 후 같은 명령을 다시 실행했고 11개 모두 통과했다.

실행 명령:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-workflow-registry.test.mjs
```

## 변경 파일

- `src/features/notifications/server/adapters/immediate-notification-adapter.ts`
- `tests/notification-workflow-registry.test.mjs`
- `.superpowers/sdd/quiet-notification-task-2-report.md`

## 안전성 검토

- `in_app` 및 `web_push`에서 유효 UUID 프로필이 없으면 `audience:<audienceKey>` 한 건을 반환한다.
- `google_chat`의 권위 값이 `unknown`이라 연결 키가 없을 때에도 동일한 audience 증거를 남긴다.
- 프로필 중복 제거, targetKey 정렬, canonical hash 계산은 유지했다.
- 설정에 없는 audience는 schema 오류로 거부해 잘못된 audience/connection 조합이 fallback으로 넓어지지 않게 했다.
- 테스트는 순수 어댑터/레지스트리 fixture만 사용했으며 네트워크, DB, provider 호출은 수행하지 않았다.
