# Supabase Loading Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase 장애를 복구하고 Auth 또는 휴보강 조회가 지연돼도 대시보드가 무한 로딩에 머물지 않게 한다.

**Architecture:** 운영 복구는 Supabase 프로젝트 재시작과 실제 Auth·REST·SQL 확인으로 닫는다. 코드 보강은 공통 Promise 제한시간, Auth 전용 경계, 휴보강 PostgREST 요청 취소와 재시도 UI로 나누며 정상 데이터·권한·저장 흐름은 유지한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase JS 2, Node test runner, ESLint, Vercel Git deployment

## Global Constraints

- 고객 메시지 발송, 알림 워커 활성화, DB 마이그레이션은 수행하지 않는다.
- 비밀번호, API 키, 세션 토큰을 테스트 출력이나 오류 메시지에 포함하지 않는다.
- 정상 Auth·휴보강 데이터 계약은 바꾸지 않는다.
- 모든 구현은 최신 `origin/main`에서 만든 `codex/supabase-loading-recovery` worktree에서 수행한다.

---

### Task 1: 공통 Promise 제한시간

**Files:**
- Create: `src/lib/promise-timeout.ts`
- Create: `tests/promise-timeout.test.mjs`

**Interfaces:**
- Produces: `OperationTimeoutError`, `withPromiseTimeout<T>(operation, options)`
- Consumes: native `setTimeout`, `clearTimeout`, and Promise semantics only

- [ ] **Step 1: Write the failing test**

```js
test("withPromiseTimeout rejects a never-settling operation with a stable code", async () => {
  await assert.rejects(
    withPromiseTimeout(new Promise(() => {}), {
      timeoutMs: 5,
      code: "auth_operation_timeout",
      message: "서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
    }),
    (error) => error instanceof OperationTimeoutError
      && error.code === "auth_operation_timeout"
      && error.message === "서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
  )
})
```

The same file verifies that an on-time resolution is returned unchanged and an original rejection is preserved.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test --experimental-strip-types tests/promise-timeout.test.mjs`

Expected: FAIL because `src/lib/promise-timeout.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
export class OperationTimeoutError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "OperationTimeoutError"
    this.code = code
  }
}

export async function withPromiseTimeout<T>(
  operation: PromiseLike<T>,
  options: { timeoutMs: number; code: string; message: string },
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OperationTimeoutError(options.code, options.message)), options.timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve(operation), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node --test --experimental-strip-types tests/promise-timeout.test.mjs`

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/promise-timeout.ts tests/promise-timeout.test.mjs
git commit -m "fix: bound stalled async operations"
```

### Task 2: Auth 초기화와 로그인 제한시간

**Files:**
- Create: `src/lib/supabase-auth-operations.ts`
- Modify: `src/providers/auth-provider.tsx`
- Modify: `src/lib/auth-error-messages.ts`
- Modify: `tests/auth-login.test.mjs`

**Interfaces:**
- Consumes: `withPromiseTimeout`
- Produces: `loadAuthSession(client, timeoutMs?)`, `signInWithPassword(client, credentials, timeoutMs?)`

- [ ] **Step 1: Write the failing tests**

Add behavior tests that pass a fake Auth client whose `getSession` and `signInWithPassword` return `new Promise(() => {})`, inject a 5 ms deadline, and expect `auth_operation_timeout`. Add direct assertions that both `auth_operation_timeout` and `Failed to fetch` map to `서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.`.

- [ ] **Step 2: Run the Auth test to verify RED**

Run: `node --test --experimental-strip-types tests/auth-login.test.mjs`

Expected: FAIL because the bounded Auth operations and timeout copy do not exist.

- [ ] **Step 3: Implement the bounded Auth operations**

Use a 10,000 ms production deadline. Cache the bounded initial-session Promise in `initialAuthSessionPromise`, so React Strict Mode shares one request and the cache clears after either success or timeout. Replace the direct login call with the bounded sign-in operation. Preserve the existing stale-refresh-token and profile-resolution behavior.

- [ ] **Step 4: Normalize retryable Auth failures**

In `getAuthErrorMessage`, map `auth_operation_timeout`, `failed to fetch`, `network request failed`, and `load failed` to the stable Korean retry message before returning raw provider text.

- [ ] **Step 5: Run the Auth tests to verify GREEN**

Run: `node --test --experimental-strip-types tests/auth-login.test.mjs tests/auth-guard-loading.test.mjs`

Expected: all Auth tests pass and the login form still clears `isSubmitting` through its existing `finally` block.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase-auth-operations.ts src/providers/auth-provider.tsx src/lib/auth-error-messages.ts tests/auth-login.test.mjs
git commit -m "fix: stop waiting indefinitely for auth"
```

### Task 3: 휴보강 조회 취소와 다시 불러오기

**Files:**
- Create: `src/features/makeup-requests/makeup-request-loading.ts`
- Modify: `src/features/makeup-requests/makeup-request-service.ts`
- Modify: `src/features/makeup-requests/makeup-request-workspace.tsx`
- Modify: `tests/makeup-request-workspace.test.mjs`

**Interfaces:**
- Produces: `MAKEUP_TABLE_TIMEOUT_MS`, `getMakeupWorkspaceLoadErrorMessage(error)`
- Consumes: Supabase PostgREST builder `.abortSignal()` and `.retry(false)`

- [ ] **Step 1: Write the failing tests**

Add a direct behavior test for `getMakeupWorkspaceLoadErrorMessage` that maps an `AbortError` and `Failed to fetch` to `서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요.`. Add a VM-backed builder test that executes `readTable` and `readNotificationDeliveryRows` against a complete fake query builder and asserts that each attaches an AbortSignal and calls `retry(false)`. Add a rendered-source contract for a `다시 불러오기` button wired to `refresh` in the error state.

- [ ] **Step 2: Run the 휴보강 test to verify RED**

Run: `node --test --experimental-strip-types tests/makeup-request-workspace.test.mjs`

Expected: FAIL because the timeout helper, request cancellation, and retry button do not exist.

- [ ] **Step 3: Implement request cancellation**

Set `MAKEUP_TABLE_TIMEOUT_MS` to 12,000 ms. Append `.abortSignal(AbortSignal.timeout(MAKEUP_TABLE_TIMEOUT_MS)).retry(false)` to both table-read paths. Use `getMakeupWorkspaceLoadErrorMessage` in the loader catch so timeout/network errors return a stable retryable message while missing-relation handling stays unchanged.

- [ ] **Step 4: Implement the retry affordance**

Render the current error message and a small outline `다시 불러오기` button in the same alert. The button calls `void refresh()` and is disabled while `loading` is true. Do not add explanatory cards or additional controls.

- [ ] **Step 5: Run the 휴보강 tests to verify GREEN**

Run: `node --test --experimental-strip-types tests/makeup-request-workspace.test.mjs`

Expected: all tests pass; timeout maps to the Korean message and both read paths abort without automatic PostgREST retry.

- [ ] **Step 6: Commit**

```bash
git add src/features/makeup-requests/makeup-request-loading.ts src/features/makeup-requests/makeup-request-service.ts src/features/makeup-requests/makeup-request-workspace.tsx tests/makeup-request-workspace.test.mjs
git commit -m "fix: recover from stalled makeup loading"
```

### Task 4: 통합 검증과 운영 배포

**Files:**
- Verify only: all files changed by Tasks 1-3

**Interfaces:**
- Consumes: GitHub `main` integration and Vercel Git deployment
- Produces: production commit SHA, Vercel deployment ID/status, browser QA evidence

- [ ] **Step 1: Run focused and regression tests**

Run the three focused test files, then all tests under `tests/` with Node's test runner. Record pass/fail counts.

- [ ] **Step 2: Run lint and production build**

Run `eslint` on the changed source/tests, then `next build --webpack`. Both must exit 0.

- [ ] **Step 3: Verify the recovered provider before release**

Require project status `ACTIVE_HEALTHY`, Auth health and REST minimal read success with the active publishable key, and `select now()` success. Check that `registration_director_default_stale` is not continuing to flood current Postgres logs.

- [ ] **Step 4: Rebase or fast-forward safety check**

Run `git fetch origin main`, compare the recorded base with current `origin/main`, and rebase only if remote main moved. Re-run focused tests after any rebase.

- [ ] **Step 5: Push the verified commit to main**

Run `git push origin HEAD:main` without force. Do not use the stale local `main` checkout.

- [ ] **Step 6: Verify Vercel Production**

Wait for the Git-triggered deployment whose commit SHA equals the new remote `main`. Require `READY`, the production alias, successful route/API probes, and no new relevant runtime errors.

- [ ] **Step 7: Run production Browser QA**

Target flow: `/sign-in?next=/admin/makeup-requests` → sign in → `/admin/makeup-requests` renders meaningful controls → refresh/retry control is available on a simulated or naturally occurring load error without a framework overlay. Capture URL/title, DOM, console health, screenshot, and one interaction proof.
