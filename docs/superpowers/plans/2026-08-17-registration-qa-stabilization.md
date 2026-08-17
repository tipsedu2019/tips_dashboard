# 등록 메뉴 QA 안정화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록 목록의 부분 실패를 격리하고 상담·청강 화면의 권한, 상태, 저장 경계를 실제 저장 상태와 일치시킨다.

**Architecture:** 목록 RPC는 필수 경계로 유지하고 등록 런타임 점검만 선택 경계로 낮춘다. 편집 UI는 저장된 도메인 상태를 기준으로 권한, 상담 방식, 현재 단계와 저장 가능 상태를 계산한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase JS, Node test runner

## Global Constraints

- 운영 DB 변경, 배포, 외부 알림 발송·재시도·설정 변경을 하지 않는다.
- 상태 변경이 예약 생성 또는 고객 알림 발송을 암묵적으로 일으키면 안 된다.
- 청강 회차의 `classLessonSessionId`와 `legacySessionKey` 경계를 유지한다.
- 모든 변경은 실패 테스트 확인 후 최소 구현으로 통과시킨다.

---

### Task 1: 목록 런타임 점검 부분 실패 격리

**Files:**
- Modify: `src/features/tasks/ops-task-service.ts:1743-1831`
- Test: `tests/ops-task-service-loading.test.mjs`

**Interfaces:**
- Produces: `loadOpsTaskPage`가 등록 런타임 점검 거부 시에도 성공한 목록 행과 `registrationRuntime: null`을 반환한다.

- [ ] **Step 1: Write the failing test**

```js
test("registration runtime probe failure does not discard a successful page", async () => {
  const loadPage = loadOpsTaskPageWithMocks({
    supabase: { rpc: (name) => name === "list_ops_task_page_v1"
      ? taskPageRpcResult([{ id: "case-a", row_data: { id: "case-a" }, sort_values: [] }])
      : taskPageRpcResult(null) },
    probeRegistrationSubjectTrackRuntime: async () => { throw new Error("runtime unavailable") },
  })
  const result = await loadPage({
    filters: { taskType: "registration" }, cursor: null, limit: 30, viewerId: "viewer-a",
  })
  assert.deepEqual(JSON.parse(JSON.stringify(result.page.rows)), [{ id: "case-a" }])
  assert.equal(result.registrationRuntime, null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/ops-task-service-loading.test.mjs`

Expected: FAIL with `runtime unavailable`.

- [ ] **Step 3: Write minimal implementation**

```ts
options.filters.taskType === "registration"
  ? probeRegistrationSubjectTrackRuntime().catch(() => null)
  : Promise.resolve(null)
```

Keep `pageResult.error` fatal.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/ops-task-service-loading.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/ops-task-service.ts tests/ops-task-service-loading.test.mjs
git commit -m "fix: preserve registration list on runtime probe failure"
```

### Task 2: 관리자 상담 결과 편집 권한 정렬

**Files:**
- Modify: `src/features/tasks/registration-track-editor.tsx:1404-1419`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces: `RegistrationConsultationOutcomeEditor`에 관리자, 상담 완료 담당자, 결과 편집자 모두 `editable: true`가 전달된다.

- [ ] **Step 1: Write the failing test**

```js
assert.match(
  source,
  /editable=\{Boolean\(context\.permissions\.canManage \|\| context\.permissions\.canCompleteConsultation \|\| context\.permissions\.canEditConsultationResult\)\}/,
)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/registration-track-workspace.test.mjs`

Expected: FAIL because `canManage` is absent.

- [ ] **Step 3: Write minimal implementation**

```tsx
editable={Boolean(
  context.permissions.canManage
  || context.permissions.canCompleteConsultation
  || context.permissions.canEditConsultationResult,
)}
```

Do not alter the server save RPC.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/registration-track-workspace.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/registration-track-editor.tsx tests/registration-track-workspace.test.mjs
git commit -m "fix: allow managers to edit consultation outcomes"
```

### Task 3: 저장된 상담 방식으로 초기 UI와 dirty 상태 결정

**Files:**
- Modify: `src/features/tasks/registration-application-model.ts:147-162`
- Modify: `src/features/tasks/registration-track-editor.tsx:1436-1455`
- Test: `tests/registration-application-model.test.mjs`

**Interfaces:**
- Produces: `getRegistrationConsultationModeDraft({ draftMode, savedMode })`가 완료된 방문상담도 clean한 방문상담으로 반환한다.

- [ ] **Step 1: Write the failing test**

```js
test("completed visit consultation remains visit and clean without an active appointment", () => {
  const mode = getRegistrationConsultationModeDraft({ draftMode: null, savedMode: "visit" })
  assert.deepEqual(mode, { mode: "visit", savedMode: "visit", dirty: false, phoneDisabled: false })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/registration-application-model.test.mjs`

Expected: FAIL because the helper accepts `hasVisitAppointment`.

- [ ] **Step 3: Write minimal implementation**

```ts
export function getRegistrationConsultationModeDraft(input: {
  draftMode: RegistrationConsultationMode | null
  savedMode: RegistrationConsultationMode
}) {
  const savedMode = input.savedMode
  const mode = input.draftMode || savedMode
  return { mode, savedMode, dirty: mode !== savedMode, phoneDisabled: false }
}
```

In the editor use `"visit"` when an active appointment exists or the latest non-canceled consultation has `mode === "visit"`; otherwise use `"phone"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/registration-application-model.ts src/features/tasks/registration-track-editor.tsx tests/registration-application-model.test.mjs
git commit -m "fix: seed consultation mode from saved consultation"
```

### Task 4: 현재 워크플로 단계 의미 보존

**Files:**
- Modify: `src/features/tasks/registration-track-editor.tsx:1030-1066`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces: 관리자가 모든 섹션을 편집해도 `openSectionStates`는 계산된 `current`와 `upcoming` 값을 보존한다.

- [ ] **Step 1: Write the failing test**

```js
assert.doesNotMatch(
  source,
  /current: section !== "history"/,
)
assert.match(source, /current: state\.current/)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/registration-track-workspace.test.mjs`

Expected: FAIL because every non-history section is forced current.

- [ ] **Step 3: Write minimal implementation**

In the existing `openSectionStates` map preserve:

```ts
current: state.current,
upcoming: state.upcoming,
```

Keep the existing management-only `editable` and lock-reason branches.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/registration-track-workspace.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/registration-track-editor.tsx tests/registration-track-workspace.test.mjs
git commit -m "fix: preserve current registration workflow section"
```

### Task 5: 무변경 청강 예약 저장 차단

**Files:**
- Modify: `src/features/tasks/registration-observation-editor.tsx:24-120,1000-1080`
- Test: `tests/registration-observation-workspace.test.mjs`

**Interfaces:**
- Produces: `isRegistrationObservationBookingDirty({ current, classId, sessionId })`와 clean한 `RegistrationSaveButton`.

- [ ] **Step 1: Write the failing test**

```js
assert.equal(isRegistrationObservationBookingDirty({
  current: { classId: "class-a", classLessonSessionId: "session-a", legacySessionKey: null },
  classId: "class-a",
  sessionId: "normalized:session-a",
}), false)
assert.equal(isRegistrationObservationBookingDirty({
  current: { classId: "class-a", classLessonSessionId: "session-a", legacySessionKey: null },
  classId: "class-a",
  sessionId: "normalized:session-b",
}), true)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/registration-observation-workspace.test.mjs`

Expected: FAIL because the helper and clean-state guard do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function isRegistrationObservationBookingDirty(input: {
  current: Pick<RegistrationObservationAttempt, "classId"> & RegistrationObservationSessionSource | null
  classId: string
  sessionId: string
}) {
  return !input.current
    || input.current.classId !== input.classId
    || sessionValue(input.current) !== input.sessionId
}
```

Derive `bookingDirty` after `selectedSession`. Use `RegistrationSaveButton` with `dirty={bookingDirty}`, `cleanLabel="저장됨"`, and a blocked state for existing saving, committed mutations, or prerequisite errors. Prevent the confirmation dialog from opening when clean.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/registration-observation-workspace.test.mjs tests/registration-observation-booking.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/registration-observation-editor.tsx tests/registration-observation-workspace.test.mjs
git commit -m "fix: block unchanged observation booking saves"
```

### Task 6: Integrated verification

**Files:**
- Modify: no production file unless a direct verification regression requires it.
- Test: focused registration service, model, editor, and observation test files.

- [ ] **Step 1: Run focused regression tests**

```bash
node --test --experimental-strip-types \
  tests/ops-task-service-loading.test.mjs \
  tests/registration-application-model.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-observation-workspace.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run wider validation**

```bash
node --test --experimental-strip-types tests/registration-*.test.mjs
pnpm lint
pnpm build
git diff --check
```

Expected: changed-area tests, lint, build, and diff check pass. Classify missing `jsdom` or unrelated existing failures separately; do not mask them.

- [ ] **Step 3: Run read-only browser QA**

Inspect local and authenticated registration screens. Do not click save, cancel, send, or status-change controls. Confirm list availability, one accurate current-stage label, the saved consultation mode, manager result editability, and the clean observation save state.

- [ ] **Step 4: Handle a direct verification regression**

Do not create a standalone verification commit. If verification exposes a direct regression in one of the five scoped behaviors, return to that task, add its failing test to the task's existing test file, apply the smallest correction in that task's listed production file, rerun that task's focused command, and amend the corresponding task commit.
