# Task 3A 보고서: 완료된 미응시 원본에서 재재시험 추가 복구

## 결과

- 완료 목록의 `done + absent + retryTaskId 없음` 원본은 담당선생님 모드에서만 `재재시험 추가` 액션 한 개를 제공합니다.
- 조교 모드, 후속 링크가 있는 완료 업무, 완료된 불합격·합격·취소 업무에는 복구 액션을 제공하지 않습니다.
- 재재시험 생성 뒤 원본의 `done`, `completedAt`, `absent`, 기존 완료 이력과 결과를 보존합니다.
- 자식은 기존 경로와 같은 `requested/not_started`, 이전 본시험일 기본값, 수정 가능한 날짜와 양방향 링크를 사용합니다.
- 이미 완료된 원본은 `word_retest.retry_created`만 기록하고, 기존 `review_requested` 원본은 `word_retest.completed`와 `word_retest.retry_created` 두 이벤트를 계속 기록합니다.
- 공개 RPC 서명, 적용 완료 migration, 알림 runtime/provider 설정은 변경하지 않았습니다.

## TDD RED

UI 소스 계약, 신규 migration 계약, pgTAP fixture/assertion을 구현보다 먼저 추가했습니다.

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-workspace.test.mjs tests/notification-ops-task-producers.test.mjs
```

결과:

```text
tests 116
pass 114
fail 2

완료된 미응시 원본 복구는 완료 시각을 보존하고 완료 이벤트를 중복 기록하지 않는다
completed absent word retests expose one recovery reretry action only in teacher mode
```

두 실패 모두 완료 미응시 복구 분기와 조건부 완료 이벤트가 아직 없는 정확한 계약 지점에서 발생했습니다.

로컬 fallback 완료 시각 보존도 구현을 제거한 상태에서 별도로 RED를 확인했습니다.

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-name-pattern="reretry reload fallbacks" tests/ops-task-workspace.test.mjs
```

```text
tests 1
pass 0
fail 1

AssertionError: /completedAt: editingTask\.completedAt \|\| new Date\(\)\.toISOString\(\)/
```

## TDD GREEN 및 검증

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-workspace.test.mjs tests/notification-ops-task-producers.test.mjs
```

결과:

```text
tests 116
pass 116
fail 0
```

추가 검증:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/Documents/Codex/tips_dashboard/node_modules/typescript/bin/tsc --noEmit
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/Documents/Codex/tips_dashboard/node_modules/eslint/bin/eslint.js src/features/tasks/ops-task-workspace.tsx tests/ops-task-workspace.test.mjs tests/notification-ops-task-producers.test.mjs
git diff --check
```

TypeScript, 대상 ESLint, 변경 공백 검사는 종료 코드 0입니다. ESLint는 500KB 초과 TSX에 대한 Babel 코드 생성 최적화 해제 안내만 출력했고 오류는 없었습니다.

## 변경 파일

- `src/features/tasks/ops-task-workspace.tsx`
  - 완료 미응시 원본의 담당선생님 전용 복구 액션
  - 이미 완료된 원본의 로컬 fallback `completedAt` 보존
- `supabase/migrations/20260721093603_word_retest_reretry.sql`
  - `review_requested` 기존 허용 조건 보존
  - `done + absent`만 추가 허용
  - 기존 `completed_at` 보존
  - 이전 상태가 `done`이면 완료 이벤트 생략
- `tests/ops-task-workspace.test.mjs`
  - 완료 미응시 teacher 전용 단일 액션과 fallback 완료 시각 계약
- `tests/notification-ops-task-producers.test.mjs`
  - migration eligibility, 완료 시각, 조건부 이벤트 계약
- `supabase/tests/notification_ops_task_adapters_test.sql`
  - 고정 완료 시각과 기존 완료 이력이 있는 `done/absent` fixture
  - 원본 보존, 자식 상태, 양방향 링크, 이벤트 수, 다른 요청 충돌 검증

## 커밋

- 메시지: `fix: allow reretry after absence confirmation`
- 해시: 이 보고서를 포함한 현재 Task 3A 커밋이며 최종 handoff의 `git rev-parse HEAD` 값으로 기록합니다.

## 자체 검토

- UI 조건은 `mode === "teacher"`, `status === "done"`, `retestStatus === "absent"`, `retryTaskId` 없음의 교집합이며 완료 조기 반환보다 먼저 평가됩니다.
- migration의 `review_requested` 불합격/미응시 식은 그대로 유지하고, 별도 `done/absent` 분기만 추가했습니다.
- 원본 task update는 `completed_at = coalesce(task.completed_at, clock_timestamp())`라 기존 완료 시각을 바꾸지 않습니다.
- 완료 이벤트는 `v_previous_status <> 'done'`에서만 기록하므로 기존 검토 중 흐름은 두 이벤트, 완료 복구는 `retry_created` 한 이벤트입니다.
- 기존 producer payload sanitizer와 원본/자식 fallback 링크는 유지했고 집중 회귀가 통과했습니다.
- 테스트 fixture는 원본의 기존 완료 이력 보존, 자식 `requested/not_started`, 양방향 링크와 중복 요청 충돌을 직접 검증합니다.

## 보류 사항

- 운영 DB에는 migration을 적용하지 않았습니다.
- 운영 스키마에서 migration과 전체 `notification_ops_task_adapters_test.sql`을 하나의 transaction에 넣고 마지막에 `rollback`하는 pgTAP은 root agent가 커밋 이후 실행할 예정입니다.
- 따라서 현재 GREEN은 Node 계약, TypeScript, 대상 ESLint와 diff 검사 기준이며 운영-schema rollback pgTAP 결과는 아직 보류입니다.
