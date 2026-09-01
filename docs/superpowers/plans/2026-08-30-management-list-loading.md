# Management List Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make student and class management lists publish at most 20 initial rows quickly, cancel obsolete reads, reject stale continuation results, and fit 10/15/20 compact rows to the available desktop height.

**Approved addendum (2026-08-31):** Keep the ten-row minimum; do not introduce five rows. For multiline content, allow vertical scrolling inside a height-bounded desktop table with a sticky header and the complete pager outside the scrollport. Preserve all cell content and mobile cards. This supersedes an absolute no-scroll interpretation of the original density goal. Validate both automatic and manual sizes, page-top reset, record-return scroll restoration, and toolbar-induced height changes. Browser evidence remains a separate gate from source/unit tests.

**Architecture:** Keep the existing `list_management_page_v1` keyset RPC and its database compatibility ceiling, but enforce the smaller list-page contract in the new UI caller. Introduce a pure page-size policy, pass one controlled size through page → hook → service → table, publish rows before non-critical metadata, and compose a caller-owned abort signal with the existing hard timeout. Detail, relation, and textbook-picker pagination remain independent at 30 rows.

**Tech Stack:** Next.js 15, React 19, TypeScript, TanStack Table 8, Supabase JS, Node test runner, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-08-30-loading-performance-vertical-slices-design.md`

## Global Constraints

- New management list page sizes are exactly `10 | 15 | 20`; the initial list maximum is 20 rows plus one cursor boundary row.
- Detail, relation, roster-preview, and class-textbook-picker requests remain 30 rows.
- The existing database function signature and 1–30 compatibility ceiling are unchanged in this plan.
- Search and domain filters remain server-owned; canonical server order remains normalized name/title plus id.
- Existing local sorting applies only to loaded rows and is not presented as whole-result sorting.
- List rows render before aggregate counts and filter-option catalogs complete.
- Caller cancellation and the eight-second timeout both reach every list/stat/filter Supabase chain; `.retry(false)` remains explicit.
- Abort errors do not replace previous rows or display a failure alert.
- No new runtime dependency, table library, query-cache library, or virtualization layer is added.
- Authentication, RLS/ACL, exact SQLSTATE behavior, mutation idempotency, and no-send boundaries do not change.

---

### Task 1: Pure page-size policy

**Files:**
- Create: `src/features/management/management-page-size.ts`
- Create: `tests/management-page-size.test.mjs`

**Interfaces:**
- Consumes: Browser viewport/body measurements expressed as numbers; optional persisted JSON.
- Produces: `MANAGEMENT_LIST_PAGE_SIZES`, `ManagementListPageSize`, `pickManagementListPageSize(fitRows)`, `estimateManagementListPageSize(viewportHeight)`, `parseManagementPageSizePreference(raw)`, and `managementPageSizeStorageKey(kind)`.

- [ ] **Step 1: Write the failing policy tests**

```js
test("management sizing quantizes measured row capacity without exceeding 20", () => {
  assert.equal(pickManagementListPageSize(9), 10);
  assert.equal(pickManagementListPageSize(10), 10);
  assert.equal(pickManagementListPageSize(14), 10);
  assert.equal(pickManagementListPageSize(15), 15);
  assert.equal(pickManagementListPageSize(19), 15);
  assert.equal(pickManagementListPageSize(20), 20);
  assert.equal(pickManagementListPageSize(200), 20);
});

test("management sizing accepts only a versioned user override", () => {
  assert.deepEqual(parseManagementPageSizePreference('{"version":1,"size":15}'), { version: 1, size: 15 });
  assert.equal(parseManagementPageSizePreference('{"version":1,"size":30}'), null);
  assert.equal(parseManagementPageSizePreference('{"version":2,"size":20}'), null);
  assert.equal(parseManagementPageSizePreference('broken'), null);
});
```

- [ ] **Step 2: Run the new test and verify the module is missing**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/management-page-size.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `management-page-size.ts`.

- [ ] **Step 3: Implement the pure policy**

```ts
import type { ManagementKind } from "./use-management-records";

export const MANAGEMENT_LIST_PAGE_SIZES = [10, 15, 20] as const;
export type ManagementListPageSize = (typeof MANAGEMENT_LIST_PAGE_SIZES)[number];
export type ManagementPageSizePreference = { version: 1; size: ManagementListPageSize };

export function pickManagementListPageSize(fitRows: number): ManagementListPageSize {
  const safeFit = Number.isFinite(fitRows) ? Math.floor(fitRows) : 20;
  return [...MANAGEMENT_LIST_PAGE_SIZES].reverse().find((size) => size <= safeFit) ?? 10;
}

export function estimateManagementListPageSize(viewportHeight: number): ManagementListPageSize {
  if (viewportHeight >= 940) return 20;
  if (viewportHeight >= 760) return 15;
  return 10;
}

export function parseManagementPageSizePreference(raw: string | null): ManagementPageSizePreference | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.version === 1 && MANAGEMENT_LIST_PAGE_SIZES.includes(value.size)
      ? value as ManagementPageSizePreference
      : null;
  } catch {
    return null;
  }
}

export function managementPageSizeStorageKey(kind: ManagementKind) {
  return `tips:management-page-size:${kind}:v1`;
}
```

- [ ] **Step 4: Run the policy tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the policy**

```bash
git add src/features/management/management-page-size.ts tests/management-page-size.test.mjs
git commit -m "feat: add management page sizing policy"
```

---

### Task 2: Progressive, cancellable management read service

**Files:**
- Modify: `src/features/management/management-service.js:22,226-350`
- Modify: `tests/management-progressive-loading.test.mjs:120-330`

**Interfaces:**
- Consumes: `limit: 10 | 15 | 20` and optional `signal: AbortSignal` for list calls.
- Produces: `loadInitialPage(...) -> Promise<{ page, effectiveFilters, canonicalReplayToken, metadata }>` where `metadata` is a settled promise resolving to `{ ok: true, stats, filterOptions } | { ok: false, error }`; `loadNextPage(...)` accepts the same signal.

- [ ] **Step 1: Add failing service behavior tests**

Add table-driven cases that call the real `createManagementReadService` with 10, 15, and 20, assert the literal `p_limit`, and assert that 30 is rejected for a list call while `loadRelationPage(... limit: 30)` remains valid. Add a deferred mock in which the list result resolves before stats/options and verify `loadInitialPage` resolves with rows while `result.metadata` is still pending. Capture each `.abortSignal(signal)` argument, abort the caller controller, and assert every captured signal becomes aborted; keep the existing literal assertion that every chain receives `.retry(false)`.

```js
for (const limit of [10, 15, 20]) {
  const result = await service.loadNextPage({ kind: "students", filters, cursor: null, limit });
  assert.equal(calls.findLast(([name]) => name === "list_management_page_v1")[1].p_limit, limit);
  assert.ok(result.rows.length <= limit);
}
await assert.rejects(
  service.loadNextPage({ kind: "students", filters, cursor: null, limit: 30 }),
  /management_page_limit_invalid/,
);
```

- [ ] **Step 2: Run the focused test and verify the new contract fails**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/management-progressive-loading.test.mjs
```

Expected: FAIL because list reads still require 30, hard-code `p_limit: 30`, do not accept a caller signal, and wait for metadata.

- [ ] **Step 3: Separate list and relation limits and compose signals**

Implement these concrete service helpers:

```js
const MANAGEMENT_LIST_PAGE_SIZES = new Set([10, 15, 20]);
const MANAGEMENT_RELATION_PAGE_SIZE = 30;
const MANAGEMENT_READ_TIMEOUT_MS = 8_000;

function managementRequestSignal(signal) {
  const timeoutSignal = AbortSignal.timeout(MANAGEMENT_READ_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function assertManagementListLimit(limit) {
  if (!MANAGEMENT_LIST_PAGE_SIZES.has(limit)) {
    throw managementReadError("management_page_limit_invalid");
  }
}
```

Thread the optional caller signal to the list, stats, and filter-option chains. Use the requested `limit` as `p_limit`; retain `30` only in relation and candidate contracts.

- [ ] **Step 4: Return rows before settled metadata**

Start the page and metadata requests together. Convert metadata failure to a settled value immediately so it cannot create an unhandled rejection while the page is pending:

```js
const metadata = Promise.all([readStats(...), readFilterOptions(...)])
  .then(([stats, filterOptions]) => ({ ok: true, stats, filterOptions }))
  .catch((error) => ({ ok: false, error }));
const page = await readListPage({ kind, filters, cursor, limit, signal });
return { page, metadata, effectiveFilters: filters };
```

Keep the existing coalesced default-period and canonical-replay behavior, but store/replay the progressive result for the same kind/filter/limit scope.

- [ ] **Step 5: Run service tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit the service contract**

```bash
git add src/features/management/management-service.js tests/management-progressive-loading.test.mjs
git commit -m "perf: stream and cancel management list reads"
```

---

### Task 3: Abort-safe hook and stale continuation guard

**Files:**
- Create: `src/features/management/management-request-gate.ts`
- Create: `tests/management-request-gate.test.mjs`
- Modify: `src/features/management/use-management-records.ts:772-960`
- Modify: `tests/management-progressive-loading.test.mjs:430-470`

**Interfaces:**
- Consumes: `useManagementRecords(kind, filters, { pageSize, enabled })` with a `ManagementListPageSize`.
- Produces: Existing hook result plus abort-safe initial/refresh/continuation behavior; `createManagementRequestGate()` supplies `begin(scope)`, `isCurrent(ticket)`, and `abort()`.

- [ ] **Step 1: Write failing request-gate tests**

```js
test("a newer management scope aborts and invalidates the previous ticket", () => {
  const gate = createManagementRequestGate();
  const first = gate.begin("students:first");
  const second = gate.begin("students:second");
  assert.equal(first.signal.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test("cleanup aborts the current management request", () => {
  const gate = createManagementRequestGate();
  const ticket = gate.begin("classes:page-1");
  gate.abort();
  assert.equal(ticket.signal.aborted, true);
  assert.equal(gate.isCurrent(ticket), false);
});
```

- [ ] **Step 2: Run the gate test and verify the module is missing**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/management-request-gate.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the gate**

```ts
export type ManagementRequestTicket = {
  generation: number;
  scope: string;
  signal: AbortSignal;
};

export function createManagementRequestGate() {
  let generation = 0;
  let controller: AbortController | null = null;
  return {
    begin(scope: string): ManagementRequestTicket {
      controller?.abort();
      controller = new AbortController();
      generation += 1;
      return { generation, scope, signal: controller.signal };
    },
    isCurrent(ticket: ManagementRequestTicket) {
      return !ticket.signal.aborted && ticket.generation === generation;
    },
    abort() {
      generation += 1;
      controller?.abort();
      controller = null;
    },
  };
}
```

- [ ] **Step 4: Integrate the gate into the hook**

Create separate initial and continuation gates with `useRef`. Do not start a list read until `enabled` is true. Build a primitive scope string from `kind`, `filters`, `pageSize`, and cursor. Pass the ticket signal into the service. Publish rows and clear the primary loading flag immediately after the page result; then await the settled metadata and apply it only if the initial ticket is still current.

On refresh/filter/page-size change, abort both gates. On unmount, abort both gates. On continuation completion, verify both the continuation ticket and the initial generation/scope before merging IDs. Treat `AbortError` or an aborted ticket as silent. For a real initial error, preserve `rows`, `stats`, and `filterOptions`, set the error message, and clear the loading flag.

- [ ] **Step 5: Run hook/service regressions**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/management-request-gate.test.mjs tests/management-progressive-loading.test.mjs tests/management-filter-transition.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the hook lifecycle**

```bash
git add src/features/management/management-request-gate.ts src/features/management/use-management-records.ts tests/management-request-gate.test.mjs tests/management-progressive-loading.test.mjs
git commit -m "fix: reject stale management continuations"
```

---

### Task 4: Controlled adaptive page size and compact table

**Files:**
- Modify: `src/features/management/management-page.tsx:1437-1470,3635-3665`
- Modify: `src/features/management/management-data-table.tsx:98,221-222,1225-1335,1683-1760,1870-1915,2272-2278,3220-3445`
- Modify: `tests/management-page-size.test.mjs`
- Modify: `tests/management-students-toolbar.test.mjs:320-355`

**Interfaces:**
- Consumes: Task 1 policy and Task 3 hook options.
- Produces: One controlled `pageSize`, `pageSizeMode: "auto" | "user"`, `onAutoPageSizeChange(size)`, and `onPageSizePreferenceChange(value)` shared by the page and table.

- [ ] **Step 1: Add failing integration expectations**

Extend the behavioral page-size tests with hand-derived available-height cases using `fit = floor((viewportBottom - bodyTop - pagerHeight - margin) / rowHeight)`. Add the existing source contract test only for integration wiring that cannot be imported without Next runtime: it must find controlled pagination state, the `10/15/20` option source, the versioned storage key helper, `ResizeObserver` cleanup, and list continuation copy based on the current page size rather than the literal `30`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/management-page-size.test.mjs tests/management-students-toolbar.test.mjs
```

Expected: FAIL because the table still has `[30]`, an uncontrolled initial pagination size, spacious cells, and literal “다음 30건” copy.

- [ ] **Step 3: Lift the page-size state into `ManagementPage`**

Initialize with `{ ready: false, mode: "auto", size: 20 }`. In a mount effect, read only `managementPageSizeStorageKey(kind)` in a `try/catch`; use a valid stored user override, otherwise use `estimateManagementListPageSize(window.innerHeight)`, then set `ready: true`. Call:

```ts
useManagementRecords(kind, managementListFilters, {
  enabled: pageSizeState.ready,
  pageSize: pageSizeState.size,
});
```

Persist only explicit user choices as `{ version: 1, size }`; choosing automatic removes the key. Pass controlled sizing props to `ManagementDataTable`. Change continuation copy to `다음 ${pageSizeState.size}건`.

- [ ] **Step 4: Control TanStack pagination and measure fit**

Keep `pageIndex` in local component state and pass:

```ts
state: {
  sorting,
  columnFilters,
  columnVisibility,
  columnOrder,
  columnSizing,
  rowSelection,
  globalFilter: deferredGlobalFilter,
  grouping,
  expanded,
  pagination: { pageIndex, pageSize },
},
onPaginationChange: (updater) => {
  setPageIndex((current) => typeof updater === "function"
    ? updater({ pageIndex: current, pageSize }).pageIndex
    : updater.pageIndex);
},
```

Attach refs to the table body and pager. In automatic mode, measure the first real row (fallback 34px), calculate fit from the viewport bottom, body top, pager height, and 16px margin, quantize through `pickManagementListPageSize`, and notify only when the quantized size changes. Use one `ResizeObserver` plus one passive `window.resize` listener and remove both during cleanup.

- [ ] **Step 5: Apply compact desktop density without shrinking actions below 24px**

Use a 36px header, approximately 34px data rows, `px-2 py-1` data cells, and a 44px minimum pager. Keep checkboxes, row-open buttons, settings, and pagination controls at least `size-6`/24px. Mobile cards remain unchanged.

- [ ] **Step 6: Run focused management tests**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/management-page-size.test.mjs tests/management-request-gate.test.mjs tests/management-progressive-loading.test.mjs tests/management-filter-transition.test.mjs tests/management-students-toolbar.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the adaptive table**

```bash
git add src/features/management/management-page.tsx src/features/management/management-data-table.tsx tests/management-page-size.test.mjs tests/management-students-toolbar.test.mjs
git commit -m "perf: fit compact management pages to viewport"
```

---

### Task 5: Regression, build, and browser evidence

**Files:**
- Create: `docs/qa/2026-08-30-management-list-loading.md`
- Modify only if a verified regression requires it: files already listed in Tasks 1–4 and their focused tests.

**Interfaces:**
- Consumes: Completed management slice.
- Produces: Local test/build evidence and viewport/request observations; no remote deployment claim.

- [ ] **Step 1: Run the focused baseline plus query-budget guards**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/query-surface-budget.test.mjs tests/keyset-pagination.test.mjs tests/management-page-size.test.mjs tests/management-request-gate.test.mjs tests/management-progressive-loading.test.mjs tests/management-filter-transition.test.mjs tests/management-students-toolbar.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run lint and production build**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node .tools/npm/package/bin/npm-cli.js run lint
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
```

Expected: both commands exit 0. If the repository uses `.codex-temp/tools/npm/bin/npm-cli.js` instead of `.tools/npm/package/bin/npm-cli.js`, use that checked-in runtime path after verifying it exists.

- [ ] **Step 3: Verify authenticated browser behavior at three heights**

Start the local production build and inspect `/admin/students` and `/admin/classes` at desktop width with viewport heights 768, 900, and 952. Record, for each surface and height: automatic page size, rendered row count, document `scrollHeight` versus `innerHeight`, observed `p_limit`, whether the old rows stay during refresh, and whether rapidly changing a filter aborts the superseded request without an error alert.

- [ ] **Step 4: Write the evidence report**

The report must state exact commands and results, distinguish automated tests/build from browser observations, and explicitly state: no Supabase migration was added/applied, no remote push was performed, no Vercel production deployment was performed, and no production p50/p95 claim is made.

- [ ] **Step 5: Commit evidence and any verified fixes**

```bash
git add docs/qa/2026-08-30-management-list-loading.md
git commit -m "test: verify management list loading slice"
```
