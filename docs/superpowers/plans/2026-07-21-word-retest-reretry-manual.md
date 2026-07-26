# 영어 단어 재재시험·업무 매뉴얼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 불합격·미응시 영어 단어 재시험에서 이전 본시험일을 이어받는 재재시험을 만들고, 재재시험의 자동 미응시 기한을 없애며, 계보 배지와 전역 업무 매뉴얼을 제공한다.

**Architecture:** 기존 `retry_of_task_id`/`retry_task_id` 양방향 연결을 유일한 계보 기준으로 읽기 모델에 노출한다. 신규 migration은 기존 RPC 서명을 유지한 채 미응시 재생성·날짜 fallback·deadline 차단을 원자적으로 처리한다. UI는 불합격/미응시 후속 생성 흐름을 하나로 일반화하고 정적 매뉴얼 dialog를 큰 workspace 파일 밖으로 분리한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Supabase/PostgreSQL, pgTAP, Lucide icons, Radix Dialog.

## Global Constraints

- 불합격과 미응시 모두 액션 이름은 `재재시험 추가`다.
- 후속 폼의 본시험일은 이전 값을 기본으로 가져오되 사용자가 수정할 수 있다.
- 미응시 원본의 결과는 `absent`로 보존한다.
- 재재시험은 `retry_of_task_id`가 존재하며 자동 미응시 기한이 없다.
- 기본 재시험의 본시험일 +7일 자동 미응시 규칙은 유지한다.
- 원본 결과 문구를 유지하고 `재재시험 추가됨`을 별도 배지로 표시한다.
- 후속 업무에는 `재재시험` 배지를 표시한다.
- 업무흐름은 수정·상세 모달에서 제거하고 메인 데이터테이블 알림 아이콘 바로 왼쪽의 매뉴얼 아이콘으로 이동한다.
- 알림 기능 플래그·Google Chat·Web Push·SOLAPI 설정을 변경하지 않는다.
- 기존 적용 migration과 notification runtime version을 수정하지 않는다.

---

## File Structure

- Modify: `src/features/tasks/ops-task-service.ts` — 계보 ID 읽기 매핑과 기존 retry RPC 호출 유지.
- Modify: `src/features/tasks/ops-task-model.js` — 자동 미응시 순수 판정 helper.
- Modify: `src/features/tasks/ops-task-workspace.tsx` — 재재시험 액션·폼·배지·매뉴얼 launcher 통합.
- Create: `src/features/tasks/word-retest-manual-dialog.tsx` — 권한과 현재 업무에 독립적인 정적 업무 매뉴얼.
- Create: `supabase/migrations/20260721093603_word_retest_reretry.sql` — 미응시 재생성, 날짜 fallback, 자식 deadline 거절.
- Modify: `tests/ops-task-model.test.mjs` — 자동 미응시 계보 단위 테스트.
- Modify: `tests/ops-task-workspace.test.mjs` — UI 계약과 매뉴얼 위치 테스트.
- Modify: `tests/notification-ops-task-producers.test.mjs` — mapper·신규 migration 계약 테스트.
- Modify: `supabase/tests/notification_ops_task_adapters_test.sql` — 재생성·deadline·원자성 pgTAP.
- Modify: `scripts/verify-ops-task-browser-workflow.mjs` — 모달 Stepper 기대를 전역 매뉴얼 검증으로 교체.

### Task 1: Expose lineage and make automatic absence testable

**Interfaces:**

- Consumes: DB fields `retry_of_task_id`, `retry_task_id`, task status, retest status, and `testAt`.
- Produces: readonly `retryOfTaskId`, `retryTaskId` and `shouldAutoMarkWordRetestAbsent(task, todayKey)`.

- [ ] **Step 1: Write the failing model test**

Add this import and test to `tests/ops-task-model.test.mjs`:

```js
import { shouldAutoMarkWordRetestAbsent } from "../src/features/tasks/ops-task-model.js";

test("only basic word retests become automatically absent after seven days", () => {
  const basic = {
    type: "word_retest",
    status: "requested",
    wordRetest: { retestStatus: "not_started", testAt: "2026-07-01" },
  };
  assert.equal(shouldAutoMarkWordRetestAbsent(basic, "2026-07-09"), true);
  assert.equal(shouldAutoMarkWordRetestAbsent({
    ...basic,
    wordRetest: { ...basic.wordRetest, retryOfTaskId: "previous-task" },
  }, "2026-07-09"), false);
  assert.equal(shouldAutoMarkWordRetestAbsent(basic, "2026-07-08"), false);
});
```

- [ ] **Step 2: Run the model test and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-model.test.mjs
```

Expected: FAIL because the helper is not exported.

- [ ] **Step 3: Move the deadline decision into the model**

Implement in `src/features/tasks/ops-task-model.js` using the existing `toDateKey` helper:

```js
export function shouldAutoMarkWordRetestAbsent(task = {}, todayKey = toDateKey(new Date())) {
  if (text(task.type) !== "word_retest") return false;
  if (!["requested", "confirmed", "on_hold"].includes(text(task.status))) return false;
  const detail = getWordRetestDetail(task);
  if (text(detail.retryOfTaskId || detail.retry_of_task_id)) return false;
  if (text(detail.retestStatus || detail.retest_status || "not_started") !== "not_started") return false;
  const testAt = toDateKey(detail.testAt || detail.test_at);
  if (!testAt || !todayKey) return false;
  const deadline = new Date(`${testAt}T00:00:00+09:00`);
  deadline.setDate(deadline.getDate() + 7);
  return todayKey > toDateKey(deadline);
}
```

Delete the duplicate workspace-local helper and import this model function.

- [ ] **Step 4: Write failing mapper assertions**

In `tests/notification-ops-task-producers.test.mjs`, execute the existing `mapWordRetest` test harness with:

```js
const mapped = mapWordRetest({
  task_id: "task-1",
  retry_of_task_id: "task-0",
  retry_task_id: "task-2",
});
assert.equal(mapped.retryOfTaskId, "task-0");
assert.equal(mapped.retryTaskId, "task-2");
```

Also assert `buildWordRetestRow` output does not contain either snake or camel link key. Expected first run: both mapped fields are `undefined`.

- [ ] **Step 5: Add readonly fields and mapper entries**

Modify `OpsWordRetestDetail` and `mapWordRetest` in `src/features/tasks/ops-task-service.ts`:

```ts
readonly retryOfTaskId?: string
readonly retryTaskId?: string
```

```ts
retryOfTaskId: text(row.retry_of_task_id),
retryTaskId: text(row.retry_task_id),
```

Do not add these fields to `buildWordRetestRow` or producer input.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-model.test.mjs tests/notification-ops-task-producers.test.mjs
```

Expected: PASS.

### Task 2: Expand the retry RPC without changing its public signature

**Interfaces:**

- Consumes: `retry_word_retest_v1(uuid,jsonb,uuid)` and `report_word_retest_absent_v1(uuid,text,uuid)`.
- Produces: the same public RPC signatures; absent-or-failed retry eligibility, previous-date fallback, preserved source result, and `40001 word_retest_absent_deadline_not_allowed` for linked children.

- [ ] **Step 1: Write the failing migration contract test**

In `tests/notification-ops-task-producers.test.mjs`, read `supabase/migrations/20260721093603_word_retest_reretry.sql` and assert:

```js
assert.match(sql, /create or replace function dashboard_private\.retry_word_retest_v1_impl/);
assert.match(sql, /v_previous_detail\.retest_status = 'absent'/);
assert.match(sql, /coalesce\(nullif\(v_detail ->> 'test_at', ''\), v_previous_detail\.test_at::text\)/);
assert.doesNotMatch(sql, /set retest_status = 'done'[\s\S]*where detail\.task_id = p_previous_task_id/);
assert.match(sql, /v_detail\.retry_of_task_id is not null[\s\S]*word_retest_absent_deadline_not_allowed/);
assert.match(sql, /word_retest\.completed/);
assert.match(sql, /word_retest\.retry_created/);
assert.doesNotMatch(sql, /ops_task_notification_producers_runtime_version[\s\S]*return 2/);
```

Expected first run: FAIL with `ENOENT`.

- [ ] **Step 2: Add pgTAP behavior cases before implementation**

Extend `supabase/tests/notification_ops_task_adapters_test.sql` with fixed UUID fixtures for a failed source, absent source, and linked child. Test:

1. failed retry still succeeds and replays for the same request ID;
2. absent retry succeeds and leaves source `retest_status='absent'` while source task becomes `done`;
3. omitted child `test_at` equals the source `test_at`;
4. an explicit changed child date remains unchanged;
5. both link columns point to each other;
6. a different request ID for the same source raises `word_retest_retry_conflict`;
7. deadline absence on a linked child raises SQLSTATE `40001` and `word_retest_absent_deadline_not_allowed`;
8. manual absence after starting the linked child succeeds;
9. a middle child can own both incoming and outgoing links;
10. an injected failure on `word_retest.retry_created` rolls back source completion, child creation, links, and prior event.

Expected current failures: absent retry conflict, missing-date context error, linked-child deadline succeeds when it should fail, and absent source is overwritten to `done`.

- [ ] **Step 3: Create the new migration transaction**

Create `supabase/migrations/20260721093603_word_retest_reretry.sql` with:

```sql
begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('dashboard_private.retry_word_retest_v1_impl(uuid,jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('dashboard_private.report_word_retest_absent_v1_impl(uuid,text,uuid)') is null
    or pg_catalog.to_regprocedure('public.retry_word_retest_v1(uuid,jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('public.report_word_retest_absent_v1(uuid,text,uuid)') is null
  then
    raise exception 'word_retest_reretry_prerequisite_missing' using errcode = '55000';
  end if;
end;
$$;
```

Redefine only the two private implementations. Keep the original request ledger, row locks, input type validation, task creation, two link updates, two event records, and response shape.

- [ ] **Step 4: Implement failed-or-absent eligibility and date fallback**

Replace the old failed-only predicate with:

```sql
if v_previous_task.status <> 'review_requested'
  or v_previous_detail.retry_task_id is not null
  or not (
    v_previous_detail.retest_status = 'absent'
    or (
      v_previous_detail.retest_status = 'done'
      and v_previous_detail.cutoff_question_count is not null
      and exists (
        select 1 from (values
          (v_previous_detail.first_score),
          (v_previous_detail.second_score),
          (v_previous_detail.third_score)
        ) score(value) where score.value is not null
      )
      and not exists (
        select 1 from (values
          (v_previous_detail.first_score),
          (v_previous_detail.second_score),
          (v_previous_detail.third_score)
        ) score(value)
        where score.value >= v_previous_detail.cutoff_question_count
      )
    )
  )
then
  raise exception 'word_retest_retry_conflict' using errcode = '40001';
end if;
```

Update only the source task status. Do not update the source detail status. Build effective detail as:

```sql
v_detail := dashboard_private.ops_task_input_detail_v2(p_input, 'word_retest')
  - 'retry_of_task_id' - 'retry_task_id';
if nullif(v_detail ->> 'test_at', '') is null then
  v_detail := v_detail || pg_catalog.jsonb_build_object('test_at', v_previous_detail.test_at);
end if;
```

- [ ] **Step 5: Reject deadline absence for linked children**

At the start of the existing `p_source='deadline'` branch add:

```sql
if v_detail.retry_of_task_id is not null then
  raise exception 'word_retest_absent_deadline_not_allowed'
    using errcode = '40001';
end if;
```

Leave manual and attendance validation unchanged. Restore private ownership/revokes and commit the transaction. Do not recreate public wrappers.

- [ ] **Step 6: Run migration contracts and pgTAP**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/notification-ops-task-producers.test.mjs
supabase test db supabase/tests/notification_ops_task_adapters_test.sql
```

Expected: all assertions pass.

### Task 3: Generalize the UI to failed and absent reretry

**Interfaces:**

- Consumes: `WordRetestRetryReason = "failed" | "absent"`, existing `retryWordRetest` service.
- Produces: `openWordRetestRetryForm(task, retryReason)`, exact labels, preserved result fallback, and one linked child.

- [ ] **Step 1: Write failing workspace assertions**

In `tests/ops-task-workspace.test.mjs`, replace old retry/Stepper expectations with assertions for:

```js
assert.match(source, /type WordRetestRetryReason = "failed" \| "absent"/);
assert.match(source, /kind: "word_retest_retry"[\s\S]*retryReason: WordRetestRetryReason/);
assert.match(source, /label: "재재시험 추가"[\s\S]*retryReason: "failed"/);
assert.match(source, /label: "재재시험 추가"[\s\S]*retryReason: "absent"/);
assert.match(source, /testAt: wordRetest\.testAt \|\| ""/);
assert.doesNotMatch(source, /testAt: ""[\s\S]*retryReason/);
assert.match(source, /재재시험 추가 및 불합격 확인/);
assert.match(source, /재재시험 추가 및 미응시 확인/);
assert.match(source, /retryReason === "absent"[\s\S]*retestStatus: originalWordRetestStatus/);
```

Expected first run: FAIL because the current type supports only failed retry and clears `testAt`.

- [ ] **Step 2: Add the retry reason to action and form intent types**

Implement:

```ts
type WordRetestRetryReason = "failed" | "absent"

type FormCompletionIntent = {
  kind?: "word_retest_retry"
  retryReason?: WordRetestRetryReason
  status?: OpsTaskStatus
  registrationPipelineStatus?: string
  wordRetestStatus?: string
}

type WordRetestPrimaryAction =
  | { kind: "status"; status: OpsTaskStatus; label: string }
  | { kind: "word_retest_complete"; label: string }
  | { kind: "word_retest_retry"; label: "재재시험 추가"; retryReason: WordRetestRetryReason }
  | { kind: "edit"; label: string; blockers?: string[] }
```

- [ ] **Step 3: Return both teacher-stage actions**

For `review_requested` teacher mode:

```ts
if (absent) return [
  { kind: "word_retest_retry", label: "재재시험 추가", retryReason: "absent" },
  { kind: "status", status: "done", label: "미응시 확인" },
]
if (scoreResult === "failed") return [
  { kind: "word_retest_retry", label: "재재시험 추가", retryReason: "failed" },
  { kind: "status", status: "done", label: "불합격 확인" },
]
```

Hide retry when `wordRetest.retryTaskId` already exists.

- [ ] **Step 4: Generalize the form opener and submission**

Rename the opener and carry the date:

```ts
const openWordRetestRetryForm = useCallback((task: OpsTask, retryReason: WordRetestRetryReason) => {
  const baseForm = formFromTask(task)
  const wordRetest = baseForm.wordRetest || {}
  setForm({
    ...baseForm,
    status: "requested",
    completedAt: "",
    wordRetest: {
      ...wordRetest,
      testAt: wordRetest.testAt || "",
      retestStatus: "not_started",
      firstScore: "",
      secondScore: "",
      thirdScore: "",
      scoreOutOf100: "",
    },
  })
  setFormCompletionIntent({ kind: "word_retest_retry", label: "재재시험 추가", retryReason })
}, [])
```

Use `retryReason` for title, submit button, notice, and fallback. Preserve `editingTask.wordRetest.retestStatus` on the source fallback rather than forcing `done`; the child fallback remains `not_started`.

- [ ] **Step 5: Run workspace tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-workspace.test.mjs
```

Expected: PASS.

### Task 4: Add lineage badges without replacing result text

- [ ] **Step 1: Add failing badge assertions**

In `tests/ops-task-workspace.test.mjs`, assert a shared `WordRetestLineageBadges` component contains both exact labels and is rendered in the list status cell and detail header. Assert `WordRetestStatusBadge` remains present.

- [ ] **Step 2: Implement the shared badge component**

```tsx
function WordRetestLineageBadges({ wordRetest }: { wordRetest?: OpsWordRetestDetail }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {wordRetest?.retryOfTaskId ? <Badge variant="outline">재재시험</Badge> : null}
      {wordRetest?.retryTaskId ? <Badge variant="secondary">재재시험 추가됨</Badge> : null}
    </span>
  )
}
```

Render it next to—not instead of—the existing status/result component in both locations.

- [ ] **Step 3: Run the workspace test and verify GREEN**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-workspace.test.mjs
```

Expected: PASS.

### Task 5: Move workflow guidance into a global manual dialog

**Interfaces:**

- Produces: `WordRetestManualDialog({ open, onOpenChange })`, no task/permission/notification props.

- [ ] **Step 1: Write failing manual tests**

In `tests/ops-task-workspace.test.mjs`, read `src/features/tasks/word-retest-manual-dialog.tsx` and assert all five approved flow strings, `DialogTitle`, semantic ordered lists, and no notification/permission props. In the workspace source assert the launcher index is lower than the notification bell index, its guard is `isWordRetestWorkspace`, and no `WordRetestProgressStepper` call remains.

Expected first run: FAIL with `ENOENT` and old Stepper calls.

- [ ] **Step 2: Create the static manual dialog**

Create `src/features/tasks/word-retest-manual-dialog.tsx` exporting:

```ts
export type WordRetestManualDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}
```

Use a scrollable dialog and semantic lanes containing exactly:

- `재시험(기본) 추가 → 시험 시작 → 점수 입력·저장 → 결과 판정`
- `본시험일 + 7일 → 미응시 보고 → 미응시 확인 또는 재재시험 추가`
- `불합격 보고 → 불합격 확인 또는 재재시험 추가`
- `합격 보고 → 합격 확인`
- `이전 본시험일 기본 유지` and `자동 미응시 기한 없음`

- [ ] **Step 3: Add the toolbar launcher immediately before the bell**

Add `wordRetestManualOpen` state. Immediately before the existing notification launcher render:

```tsx
{isWordRetestWorkspace && (
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={() => setWordRetestManualOpen(true)}
    aria-label="영어 단어 재시험 업무 매뉴얼"
    title="영어 단어 재시험 업무 매뉴얼"
    className="size-8 shrink-0 px-0"
  >
    <BookOpenText className="size-4" aria-hidden="true" />
    <span className="sr-only">영어 단어 재시험 업무 매뉴얼</span>
  </Button>
)}
```

Mount `WordRetestManualDialog` outside notification feature guards.

- [ ] **Step 4: Remove modal-local workflow charts**

Remove the edit and detail `WordRetestProgressStepper` calls and then delete obsolete dynamic chart constants/components/imports. Keep the detail status badge.

- [ ] **Step 5: Update browser verifier expectations**

In `scripts/verify-ops-task-browser-workflow.mjs`, remove the assertion that the create/edit modal contains a progress Stepper. Find the manual button by its accessible name, open it, assert all approved flow strings, close it, and assert focus returns to the launcher before continuing role-tab checks.

- [ ] **Step 6: Run UI tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-workspace.test.mjs
```

Expected: PASS.

### Task 6: Verify and commit the feature

- [ ] **Step 1: Run focused tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-model.test.mjs tests/ops-task-workspace.test.mjs tests/notification-ops-task-producers.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the entire application gate**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm lint
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec tsc --noEmit
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm build
```

Expected: all tests, lint, typecheck, and Webpack production build pass.

- [ ] **Step 3: Apply and verify the DB migration**

Apply the exact migration in production through the Supabase migration API. Query `pg_proc` to verify both private function bodies, run a rollback-only transaction proving linked child deadline rejection, and run Supabase security/performance advisors. Do not enable any notification provider.

- [ ] **Step 4: Browser QA without production mutations**

On `/admin/word-retests`, verify manual icon order, dialog content, absence of modal-local charts, lineage badge rendering on existing linked rows, and carried date in a form without submitting. Verify 320px/375px mobile and desktop layouts.

- [ ] **Step 5: Commit the independently reviewable feature**

```bash
git add src/features/tasks/ops-task-service.ts src/features/tasks/ops-task-model.js src/features/tasks/ops-task-workspace.tsx src/features/tasks/word-retest-manual-dialog.tsx supabase/migrations/20260721093603_word_retest_reretry.sql tests/ops-task-model.test.mjs tests/ops-task-workspace.test.mjs tests/notification-ops-task-producers.test.mjs supabase/tests/notification_ops_task_adapters_test.sql scripts/verify-ops-task-browser-workflow.mjs
git commit -m "feat: add word retest reretry workflow"
```
