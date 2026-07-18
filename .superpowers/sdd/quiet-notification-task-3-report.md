# 조용한 알림 검증 작업 3 보고서

## 결과

- RED: `notification-control-plane-worker.test.mjs` 45개 중 42개 통과, 3개 실패
  - Google Chat 기본 408이 `delivery_unknown`으로 반환되어 legacy 계약(`retry_wait`)과 달랐습니다.
  - Web Push 기본 408이 `delivery_unknown`으로 반환되어 legacy 계약과 달랐습니다.
  - canonical production worker가 두 provider에 `http408Disposition: "delivery_unknown"`을 전달하지 않았습니다.
- GREEN: 같은 테스트 45개 전부 통과했습니다.
- TypeScript: `tsc --noEmit` 통과했습니다.

## legacy 보존 증거

- Google Chat·Web Push provider의 `http408Disposition` 생략 기본값은 `retry_wait`입니다.
- 408 기본 결과는 `retry_wait/transient_pre_dispatch_failure`이며 다음 시도 시각을 가집니다.
- 425는 legacy와 canonical 모두 `retry_wait/transient_pre_dispatch_failure`로 유지됩니다.
- 정책값이 타입을 우회해 들어오더라도 `delivery_unknown`만 명시적으로 허용하고 나머지는 legacy 기본값으로 정규화합니다.
- 독립 리뷰의 비차단 권고를 반영해 비정상 정책값도 두 provider에서 `retry_wait`으로 닫히는 자동 회귀를 추가했고 45/45를 다시 통과했습니다.

## canonical 격리 증거

- production worker factory의 Google Chat과 Web Push 생성부에만
  `http408Disposition: "delivery_unknown"`을 명시했습니다.
- canonical policy의 408은 `delivery_unknown/provider_ambiguous_response`이며 `nextAttemptAt`은 `null`입니다.
- migration과 legacy route 파일은 수정하지 않았습니다.
- audience fallback은 순방향 SQL materializer에서 strict shape를 검증한 뒤
  `skipped/no_recipient`로 저장되고, worker claim SQL은 `pending/retry_wait`만 선택함을 계약 테스트로 고정했습니다.

## 검증 명령

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-control-plane-worker.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
```
