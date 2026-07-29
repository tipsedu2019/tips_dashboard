# Release 2 연속 수업 일정 기준선

기준 시각: 2026-07-29 Asia/Seoul

## 변경 전 경계

- 구현 브랜치: `codex/continuous-schedule-release-2`
- 기준 commit: `5d51e536`
- `main`은 `3f1edf05`에 유지한다.
- 이 기준선 수집에서는 운영 DB에 SELECT 이외의 작업을 수행하지 않았다.
- Google Chat, Web Push, SOLAPI, notification worker 설정을 변경하거나 실제
  발송을 실행하지 않았다.

## 운영 DB read-only 결과

| 항목 | 값 |
| --- | --- |
| 적용 migration | `20260728152442_continuous_class_schedule_foundation` |
| continuous schedule runtime | `0` |
| classes | 70 |
| legacy / shadow / normalized | 70 / 0 / 0 |
| schedule revision 최소 / 최대 | 0 / 0 |
| class_schedule_slots | 0 |
| class_lesson_sessions | 0 |
| dashboard_private.class_schedule_mutation_receipts | 0 |

확인 SQL은 class 수와 storage mode, revision 범위, 신규 테이블 count만
집계했다. 수업명, 학생, 교재, 연락처, 원본 `schedule_plan`을 출력하지 않았다.

## 로컬 검증

다음 Release 1 focused 테스트가 통과했다.

```bash
node --test --experimental-strip-types \
  tests/continuous-class-schedule-model.node.ts \
  tests/continuous-class-schedule-schema.test.mjs \
  tests/continuous-class-schedule-runtime-probe.test.mjs \
  tests/continuous-class-schedule-service.test.mjs \
  tests/continuous-class-schedule-backfill-preview.test.mjs
```

결과: 25 passed, 0 failed.

전체 Node 기준선도 실행했다.

```bash
node --test --experimental-strip-types tests/*.test.mjs tests/*.node.ts
```

결과: 1,913 passed, 0 failed.

## 계속 진행 조건

- runtime은 0으로 유지한다.
- 모든 수업은 legacy authority를 유지한다.
- Release 2의 migration, RPC, UI는 로컬 branch에서만 구현한다.
- 운영 migration 적용, shadow backfill, runtime 1, normalized class activation은
  각각 별도 게이트와 명시적 승인 전까지 실행하지 않는다.
