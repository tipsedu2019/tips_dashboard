# Public Classes Supabase Recurrence Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `/api/public-classes` and keep it available through short Supabase failures without reintroducing broad database reads or retry storms.

**Architecture:** Pin every public Supabase read to an explicit production-compatible projection, then route the full API through a success-only 600-second Next Data Cache. On a cold live failure, validate and return the committed full public snapshot only when it is at most 24 hours old; only return the existing sanitized `503` payload when neither source is usable.

**Tech Stack:** Next.js 16 App Router, Node.js test runner, JavaScript ES modules, `@supabase/supabase-js`, Next Data Cache, Vercel Production, Supabase Postgres/Data API

## Global Constraints

- Work only in `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/public-classes-recurrence-prevention` on branch `codex/public-classes-recurrence-prevention` based on current `origin/main`.
- Do not modify the root checkout whose `core.worktree` points to an unrelated temporary directory.
- Do not create or apply a Supabase migration.
- Do not change cron, notification worker, SOLAPI, Google Chat, or any provider setting; do not send messages.
- Keep `PUBLIC_CLASSES_QUERY_TIMEOUT_MS = 8_000` and `.retry(false)` on every public Supabase query.
- Keep explicit projections; never replace them with `select("*")`.
- Cache only payloads whose `source === "supabase"` and whose three collection fields are arrays.
- Reject a static snapshot whose `generatedAt` is invalid, in the future, or more than 24 hours old.
- Keep success cache headers at `public, max-age=0, s-maxage=600, stale-while-revalidate=3600`; keep unrecoverable fallback responses at `503` and `no-store`.
- Use the bundled Node executable `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` and bundled pnpm `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm` when PATH does not provide them.

---

## File Structure

- Modify `src/server/public-classes-payload.js`: own named public projection constants, full payload validation/normalization, and production-compatible mapping.
- Modify `src/server/public-classes-cache.js`: own success-only full-payload caching and cold-failure snapshot fallback, alongside the existing summary cache.
- Modify `src/server/public-classes-api.js`: consume the full cache loader instead of querying Supabase directly.
- Modify `src/server/public-classes-cache-invalidation.js`: invalidate both summary and full cache tags after committed mutations.
- Modify `src/server/public-classes-cache.d.ts`: expose the full cache interfaces used by JavaScript consumers and tests.
- Modify `tests/public-classes-summary-loading.test.mjs`: verify the full query contract and API response contract through injected boundaries.
- Modify `tests/public-classes-cache.test.mjs`: verify success-only full caching, stale success retention, valid snapshot fallback, and invalid snapshot rejection.
- Reuse `public/data/public-classes.json`: committed full public snapshot; do not regenerate it from production during this task.

---

### Task 1: Pin the Full Supabase Projection to the Production Schema

**Files:**
- Modify: `src/server/public-classes-payload.js:17-27,118-145,201-220,224-326`
- Test: `tests/public-classes-summary-loading.test.mjs:78-164`

**Interfaces:**
- Consumes: a Supabase-like client with `from(table).select(columns).abortSignal(signal).retry(false)`.
- Produces: `buildPublicClassesPayload({ env, supabaseClient, mode: "full" }) -> Promise<PublicClassesPayload>`.
- Produces: exported string constants `PUBLIC_CLASSES_SUMMARY_PROJECTION`, `PUBLIC_CLASSES_FULL_CLASS_PROJECTION`, `PUBLIC_CLASSES_FULL_TEXTBOOK_PROJECTION`, and `PUBLIC_CLASSES_FULL_PROGRESS_PROJECTION`.

- [ ] **Step 1: Write the failing full-query regression test**

Add a test using a query double that records the table, exact projection, whether `abortSignal` was applied, and the retry argument. Return one active class with `fee`, one referenced textbook, and one progress row without either removed column.

```js
test("public classes full mode reads only production columns and keeps compatibility output", async () => {
  const queries = [];
  const rows = {
    classes: [{
      id: "class-1", name: "중1 영어", subject: "영어", grade: "중1",
      teacher: "담당 선생님", room: "본관 1강", schedule: "월수금 17:00-19:00",
      status: "수강", fee: 270000, capacity: 10, student_ids: [], waitlist_ids: [],
      textbook_ids: ["book-1"], textbook_info: null, lessons: [],
      schedule_plan: { sessions: [{ id: "session-1" }] }, start_date: "2026-03-01", end_date: null,
    }],
    textbooks: [{ id: "book-1", title: "교재", name: "", publisher: "출판사", price: 10000, tags: [], lessons: [], updated_at: null }],
    progress_logs: [{ id: "progress-1", class_id: "class-1", textbook_id: "book-1", progress_key: "p-1", session_id: "session-1", session_order: 1, status: "done", range_start: "1", range_end: "2", range_label: "1-2", public_note: "", teacher_note: "", updated_at: null, date: null }],
  };
  const supabaseClient = createRecordingSupabaseClient(rows, queries);

  const payload = await buildPublicClassesPayload({ env: {}, supabaseClient, mode: "full" });

  assert.deepEqual(queries.map(({ table, columns, retry }) => ({ table, columns, retry })), [
    { table: "classes", columns: "id,name,subject,grade,teacher,room,schedule,status,fee,capacity,student_ids,waitlist_ids,textbook_ids,textbook_info,lessons,schedule_plan,start_date,end_date", retry: false },
    { table: "textbooks", columns: "id,title,name,publisher,price,tags,lessons,updated_at", retry: false },
    { table: "progress_logs", columns: "id,class_id,textbook_id,progress_key,session_id,session_order,status,range_start,range_end,range_label,public_note,teacher_note,updated_at,date", retry: false },
  ]);
  assert.equal(payload.classes[0].tuition, 270000);
  assert.deepEqual(payload.progressLogs[0].completedLessonIds, []);
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/public-classes-summary-loading.test.mjs
```

Expected: FAIL because the current full projections still include `classes.tuition` and `progress_logs.completed_lesson_ids`.

- [ ] **Step 3: Add named projection constants and use them**

Add the four constants near `PUBLIC_CLASSES_QUERY_TIMEOUT_MS`, then replace inline `.select(...)` arguments.

```js
export const PUBLIC_CLASSES_SUMMARY_PROJECTION =
  "id,name,subject,grade,teacher,room,schedule,status,fee,capacity,student_ids,waitlist_ids,start_date,end_date";
export const PUBLIC_CLASSES_FULL_CLASS_PROJECTION =
  "id,name,subject,grade,teacher,room,schedule,status,fee,capacity,student_ids,waitlist_ids,textbook_ids,textbook_info,lessons,schedule_plan,start_date,end_date";
export const PUBLIC_CLASSES_FULL_TEXTBOOK_PROJECTION =
  "id,title,name,publisher,price,tags,lessons,updated_at";
export const PUBLIC_CLASSES_FULL_PROGRESS_PROJECTION =
  "id,class_id,textbook_id,progress_key,session_id,session_order,status,range_start,range_end,range_label,public_note,teacher_note,updated_at,date";
```

Keep `mapPublicClass` compatibility output but calculate both `fee` and `tuition` from `row.fee`. Keep `mapPublicProgressLog` defaulting `completedLessonIds` to `[]`.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run the command from Step 2.

Expected: all tests in `tests/public-classes-summary-loading.test.mjs` pass with no unhandled rejection.

- [ ] **Step 5: Commit the projection fix**

```bash
git add src/server/public-classes-payload.js tests/public-classes-summary-loading.test.mjs
git commit -m "fix: align public class queries with production schema"
```

---

### Task 2: Preserve a Last-Good Full Payload During Supabase Failures

**Files:**
- Modify: `src/server/public-classes-payload.js:69-82,170-187`
- Modify: `src/server/public-classes-cache.js:1-81`
- Modify: `src/server/public-classes-cache.d.ts`
- Modify: `src/server/public-classes-api.js:1-24`
- Modify: `src/server/public-classes-cache-invalidation.js:1-40`
- Test: `tests/public-classes-cache.test.mjs`
- Test: `tests/public-classes-summary-loading.test.mjs:10-67`

**Interfaces:**
- Consumes: `readPublicClassesSnapshot() -> Promise<unknown>` from `src/lib/public-classes-server.js` or an injected equivalent.
- Produces: `normalizePublicClassesFullPayload(payload) -> PublicClassesPayload | null`.
- Produces: `createPublicClassesFullCache({ loadFull, readSnapshot, cache, now }).load(...args) -> Promise<PublicClassesPayload>`.
- Produces: `loadCachedPublicClassesFull(...args) -> Promise<PublicClassesPayload>`.
- Consumes in API: `createPublicClassesApiResponder(loadPayload = loadCachedPublicClassesFull)`.

- [ ] **Step 1: Write failing full-cache tests**

Extend the cache harness so its invalidation key is supplied by the cache factory call rather than hard-coded to the summary tag. Add tests with literal payload fixtures:

```js
test("a failed warm full revalidation keeps the prior successful payload", async () => {
  let now = 0;
  let calls = 0;
  const harness = createNextDataCacheHarness({ now: () => now });
  const cache = createPublicClassesFullCache({
    cache: harness.factory,
    loadFull: async () => {
      calls += 1;
      if (calls === 1) return fullPayload("live");
      throw new Error("upstream unavailable");
    },
  });

  assert.deepEqual(await cache.load(), fullPayload("live"));
  now += 600_001;
  assert.deepEqual(await cache.load(), fullPayload("live"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("a cold full failure returns a valid static snapshot without caching a fallback", async () => {
  let fail = true;
  const cache = createPublicClassesFullCache({
    cache: createNextDataCacheHarness().factory,
    loadFull: async () => fail
      ? { source: "fallback-empty", classes: [], textbooks: [], progressLogs: [] }
      : fullPayload("recovered"),
    readSnapshot: async () => fullPayload(1),
    now: () => Date.parse("2026-08-14T01:00:00.000Z"),
  });

  assert.deepEqual(await cache.load(), fullPayload("snapshot"));
  fail = false;
  assert.deepEqual(await cache.load(), fullPayload("recovered"));
});

test("an invalid full snapshot does not turn an upstream failure into a 200", async () => {
  const cache = createPublicClassesFullCache({
    cache: createNextDataCacheHarness().factory,
    loadFull: async () => ({ source: "fallback-empty", classes: [], textbooks: [], progressLogs: [] }),
    readSnapshot: async () => ({ source: "supabase", classes: [] }),
  });

  const payload = await cache.load();
  assert.equal(payload.source, "fallback-empty");
});

test("a full snapshot older than 24 hours does not turn an upstream failure into a 200", async () => {
  const cache = createPublicClassesFullCache({
    cache: createNextDataCacheHarness().factory,
    loadFull: async () => ({ source: "fallback-empty", classes: [], textbooks: [], progressLogs: [] }),
    readSnapshot: async () => fullPayload(1),
    now: () => Date.parse("2026-08-15T01:02:00.000Z"),
  });

  const payload = await cache.load();
  assert.equal(payload.source, "fallback-empty");
});
```

- [ ] **Step 2: Run cache tests and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/public-classes-cache.test.mjs tests/public-classes-summary-loading.test.mjs
```

Expected: FAIL because `createPublicClassesFullCache`, `normalizePublicClassesFullPayload`, and `loadCachedPublicClassesFull` do not exist and the API still calls `buildPublicClassesPayload` directly.

- [ ] **Step 3: Implement full payload validation and success-only cache**

Add a strict public-shape validator:

```js
export function normalizePublicClassesFullPayload(payload) {
  if (!payload || typeof payload !== "object" || isFallbackPublicClassesPayload(payload)) return null;
  if (!Array.isArray(payload.classes) || !Array.isArray(payload.textbooks) || !Array.isArray(payload.progressLogs)) return null;
  return {
    generatedAt: typeof payload.generatedAt === "string" ? payload.generatedAt : new Date().toISOString(),
    source: "supabase",
    classes: payload.classes,
    textbooks: payload.textbooks,
    progressLogs: payload.progressLogs,
  };
}
```

In `public-classes-cache.js`, add `PUBLIC_CLASSES_FULL_CACHE_TAG = "public-classes-full-v1"`, `PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS = 86_400_000`, reuse the 600-second interval, create `loadSuccessfulPublicClassesFull`, and implement `createPublicClassesFullCache`. The cached loader must throw on fallback payloads; the outer loader catches, validates the injected snapshot and its `generatedAt` against injected `now`, then returns either the fresh snapshot or the sanitized fallback.

Use a small local `readSnapshot` function in the cache module that reads `publicClassesOutputPath`, avoiding a circular import from `src/lib/public-classes-server.js`.

Update `public-classes-cache.d.ts` with the exact exported constants and callable signatures.

Update `public-classes-cache-invalidation.js` to call `revalidateTag` once for `public-classes-summary-v1` and once for `public-classes-full-v1` before revalidating `/api/public-classes`.

- [ ] **Step 4: Route the API through the full cache and verify response semantics**

Change the API responder default dependency:

```js
import { loadCachedPublicClassesFull } from "./public-classes-cache.js";

export function createPublicClassesApiResponder(
  loadPayload = loadCachedPublicClassesFull,
) {
  return async function respond() {
    const payload = await loadPayload();
    // existing status and Cache-Control logic remains unchanged
  };
}
```

Update the existing API test so the injected function no longer expects `{ mode: "full" }`; assert that full class plans, textbooks, and progress logs remain in the `200` response. Keep the existing sanitized `503 no-store` test.

- [ ] **Step 5: Run cache and API tests and verify GREEN**

Run the command from Step 2.

Expected: all cache and public API tests pass; the invalid snapshot test returns `fallback-empty`, and a valid full snapshot remains a `200` response.

- [ ] **Step 6: Run adjacent cache mutation tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/public-classes-cache-mutation-boundaries.test.mjs tests/public-classes-cache-invalidation.test.mjs
```

Expected: all tests pass; existing mutation invalidation behavior remains intact.

- [ ] **Step 7: Commit the resilience change**

```bash
git add src/server/public-classes-payload.js src/server/public-classes-cache.js src/server/public-classes-cache.d.ts src/server/public-classes-api.js tests/public-classes-cache.test.mjs tests/public-classes-summary-loading.test.mjs
git commit -m "fix: preserve public classes through Supabase failures"
```

---

### Task 3: Verify, Publish, and Observe Production

**Files:**
- Verify only: all changed files
- Update only if required by an observed code defect: the files from Tasks 1-2 and their tests

**Interfaces:**
- Consumes: commits from Tasks 1-2.
- Produces: source/test receipt, no-migration receipt, GitHub `main` SHA, Vercel Production deployment receipt, runtime HTTP receipt, and Supabase log receipt.

- [ ] **Step 1: Install the existing locked dependencies without changing lockfiles**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm install --frozen-lockfile
git status --short
```

Expected: install succeeds and does not modify `package.json`, `pnpm-lock.yaml`, or `package-lock.json`.

- [ ] **Step 2: Run the complete Node test suite**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/*.test.mjs
```

Expected: exit 0 with zero failed tests. If unrelated pre-existing failures appear, record them separately and do not weaken tests.

- [ ] **Step 3: Run lint and production build**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm lint
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm build
```

Expected: both commands exit 0. Use the repository script unchanged; it already passes `--webpack`.

- [ ] **Step 4: Confirm the migration and provider boundaries**

```bash
git diff origin/main...HEAD --name-only
git log --oneline origin/main..HEAD
```

Expected: no path under `supabase/migrations/`; no provider or notification configuration file; only the approved public classes source, tests, design, and plan files.

- [ ] **Step 5: Integrate the reviewed branch into current GitHub main**

Fetch and require that `origin/main` has not moved unexpectedly. Rebase the branch if it moved, rerun Steps 2-4, then push the reviewed commit chain to `main` without force:

```bash
git fetch origin main
git rebase origin/main
git push origin HEAD:main
git ls-remote origin refs/heads/main
```

Expected: push succeeds without force and the remote `main` SHA equals local `HEAD`.

- [ ] **Step 6: Verify Vercel Production is READY for the pushed SHA**

Use the repository-linked Vercel project to inspect the production deployment. Confirm the deployment commit SHA equals GitHub `main`, target is Production, and state is `READY`. Do not describe GitHub push alone as deployment completion.

- [ ] **Step 7: Verify the runtime contract**

```bash
curl -L -sS -o /dev/null -w 'home code=%{http_code} total=%{time_total}s ttfb=%{time_starttransfer}s\n' --max-time 20 https://tipsedu.co.kr/
for attempt in 1 2 3; do
  curl -L -sS --max-time 20 https://tipsedu.co.kr/api/public-classes
done
```

Expected: home returns `200`; all three API calls return HTTP `200`; each JSON body has `source: "supabase"` and array fields `classes`, `textbooks`, `progressLogs`. Record response timings without printing student/contact data.

- [ ] **Step 8: Verify the post-deploy Supabase observation window**

Read current project status and recent API/Postgres/Auth logs. Require:

- project status `ACTIVE_HEALTHY`
- no new Data API `400` for `classes.tuition`
- no new Data API `400` for `progress_logs.completed_lesson_ids`
- no blocked query in the final read-only snapshot

Do not infer that historical timeouts disappeared; report the post-deploy window separately.

- [ ] **Step 9: Report all release gates separately**

Report source/tests, migration, GitHub `main`, Vercel Production, runtime API, Supabase observation, and provider/recipient boundaries as separate lines. Include exact SHAs and timestamps, and state that no DB migration or external delivery occurred.
