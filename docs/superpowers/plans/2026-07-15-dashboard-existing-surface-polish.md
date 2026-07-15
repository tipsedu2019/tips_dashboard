# Dashboard Existing-Surface Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-used dashboard faster and more trustworthy by removing the inaccurate task summary, exposing the existing scope filters, and placing the dashboard first for full-access users without starting the deferred cross-workflow work-summary project.

**Architecture:** Keep `useTipsDashboardMetrics`, the existing `analyticsByView` buckets, student/class panels, conflict rows, access rules, and navigation consumers intact. Delete the single-consumer general-task summary path, render the two existing filter state axes through the existing accessible `SegmentedControl`, and reorder only `fullOverviewItems`. Per-profile notification read receipts and Web Push readiness remain owned by Task 7 of the common notification control-plane plan.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Tailwind CSS, lucide-react, Node test runner, pnpm, authenticated browser QA.

## Execution Boundary and Order

Execute this quick dashboard surface plan first. Then execute, in order:

1. `docs/superpowers/plans/2026-07-15-common-notification-control-plane.md`
2. `docs/superpowers/plans/2026-07-15-registration-appointments-reminders.md`
3. `docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md`

The common notification plan as a whole exclusively owns receipt schema, inbox list/count/mark-read RPCs, Push readiness/API/subscription/service-worker work, and their tests. Its Task 7 owns the popover/client integration, including the non-navigation `읽음` sibling button and readiness actions. Do not duplicate any of those changes here even though they appear in the approved dashboard design.

## Global Constraints

- Do not add `내가 해야 할 일`, `내가 요청한 일`, workflow counts, a combined deadline list, or a replacement top summary card.
- Do not add a loader, SQL view, RPC, projection, or client join across `ops_tasks`, `makeup_requests`, and `approval_requests`.
- Preserve the meaning and data path of every existing KPI, student distribution, exam conflict, and class-operation metric.
- Preserve `activeSubject`, `activeDivision`, `analyticsByView`, `getBucket`, and `getConflictRows`; this plan changes their controls, not their calculations.
- Reorder only `fullOverviewItems`. Do not add `/admin/dashboard` to `assistantOverviewItems` and do not change `AuthGuard`.
- Do not modify notification receipt, Push, Google Chat, SOLAPI, database, migration, or provider code in this plan.
- Browser QA must make zero Google Chat, Web Push, and SOLAPI provider requests.
- Preserve unrelated worktree changes. Stage only the files named by each task.

---

### Task 1: Remove the inaccurate task summary and its dead data path

**Files:**
- Modify: `src/app/admin/dashboard/page.tsx`
- Delete: `src/features/tasks/ops-task-dashboard-summary.tsx`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `tests/admin-shell.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Removes: `OpsTaskDashboardSummary`, `OpsTodoDashboardSummaryData`, and `loadOpsTodoDashboardSummaryData()`.
- Preserves: `Page -> useTipsDashboardMetrics() -> SectionCards`, all full workspace loaders, `mapTask`, `readTable`, and browser smoke-route coverage.

- [ ] **Step 1: Replace the positive summary contract with a failing absence contract**

In `tests/admin-shell.test.mjs`, replace the dashboard sample-assets test preamble with:

```js
test("dashboard starts with live metrics and removes the inaccurate todo summary", async () => {
  const [pageSource, serviceSource] = await Promise.all([
    readSource("src/app/admin/dashboard/page.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);

  assert.match(pageSource, /SectionCards/);
  assert.doesNotMatch(pageSource, /OpsTaskDashboardSummary/);
  assert.equal(
    await pathExists("src/features/tasks/ops-task-dashboard-summary.tsx"),
    false,
  );
  assert.doesNotMatch(
    serviceSource,
    /OpsTodoDashboardSummaryData|loadOpsTodoDashboardSummaryData/,
  );
```

Keep the existing loop that asserts the old sample chart/table files are absent, then close the test. In `tests/ops-task-workspace.test.mjs`, rename `dashboard and browser workflow scripts target the new operation surfaces` to `browser workflow scripts target the operation surfaces`, stop reading `ops-task-dashboard-summary.tsx`, remove its assertions, and add:

```js
assert.equal(
  await pathExists("src/features/tasks/ops-task-dashboard-summary.tsx"),
  false,
);
assert.doesNotMatch(
  serviceSource,
  /OpsTodoDashboardSummaryData|loadOpsTodoDashboardSummaryData/,
);
```

Retain the workspace cache, registration projection, browser routes, and sample-workflow assertions in that test. Remove only the service assertions for the dedicated summary query.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/admin-shell.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: FAIL because the dashboard still renders `OpsTaskDashboardSummary`, the component file still exists, and the dedicated loader is still exported. The measured pre-change baseline is 87 passing focused tests.

- [ ] **Step 3: Delete only the summary render and single-consumer loader**

Make `src/app/admin/dashboard/page.tsx` exactly:

```tsx
"use client"

import { useTipsDashboardMetrics } from "@/hooks/use-tips-dashboard-metrics"

import { SectionCards } from "./components/section-cards"

export default function Page() {
  const metrics = useTipsDashboardMetrics()

  return (
    <div className="px-3 pb-5 sm:px-4 sm:pb-6 lg:px-6">
      <SectionCards metrics={metrics} />
    </div>
  )
}
```

Delete `src/features/tasks/ops-task-dashboard-summary.tsx`. In `ops-task-service.ts`, delete the contiguous block beginning with:

```ts
export type OpsTodoDashboardSummaryData = {
```

and ending after `loadOpsTodoDashboardSummaryData()`'s closing brace immediately before `function mapOpsClassOption`. Do not remove shared helpers merely because that deleted function used them.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command again.

Expected: all focused tests PASS and neither source nor tests reference the removed symbols.

- [ ] **Step 5: Commit the removal**

```bash
git add src/app/admin/dashboard/page.tsx src/features/tasks/ops-task-dashboard-summary.tsx src/features/tasks/ops-task-service.ts tests/admin-shell.test.mjs tests/ops-task-workspace.test.mjs
git commit -m "fix: remove misleading dashboard task summary"
```

---

### Task 2: Expose subject and division filters without changing analytics

**Files:**
- Modify: `src/app/admin/dashboard/components/section-cards.tsx`
- Modify: `tests/admin-shell.test.mjs`

**Interfaces:**
- Produces: `DashboardVisibleFilters` with visible `과목` and `부서` labels and two independent `SegmentedControl` groups.
- Consumes unchanged: `SUBJECT_TABS`, `DIVISION_TABS`, `DashboardSubjectKey`, `DashboardDivisionKey`, `activeSubject`, `activeDivision`, and their existing change callbacks.
- Removes from this file: `DashboardFilterMenu`, `FilterRadioGroup`, `getScopedFilterLabel`, `getFilterSummary`, `SlidersHorizontal`, and dropdown-menu imports.
- Preserves: `SegmentedControl`, `getActiveLabel`, `ChevronDown`, status badge behavior, and all analytics calculations.

- [ ] **Step 1: Write a failing direct-filter contract**

In the existing `dashboard exposes subject and division tabs with conflict process rows` test, replace the dropdown-specific assertions with:

```js
const visibleFilterBlock = source.slice(
  source.indexOf("function DashboardVisibleFilters"),
  source.indexOf("function DashboardHeader"),
);
const segmentedControlBlock = source.slice(
  source.indexOf("function SegmentedControl"),
  source.indexOf("function ListScopeToggle"),
);

for (const value of [
  ">과목</span>",
  ">부서</span>",
  'label="과목"',
  "items={SUBJECT_TABS}",
  'label="부서"',
  "items={DIVISION_TABS}",
  "grid min-w-0 gap-2",
  "sm:flex",
]) {
  assert.ok(visibleFilterBlock.includes(value), value);
}
assert.match(segmentedControlBlock, /role="group" aria-label=\{label\}/);
assert.match(segmentedControlBlock, /aria-pressed=\{isActive\}/);
assert.doesNotMatch(source, /DashboardFilterMenu|FilterRadioGroup|전체 범위/);
assert.doesNotMatch(source, /DropdownMenuRadioGroup|DropdownMenuContent/);
assert.doesNotMatch(source, /activeFilterCount|SlidersHorizontal/);
```

Keep the existing tab constants, status, conflict-row, distribution, and class-operation assertions. In `dashboard keeps dense cards readable on mobile widths`, add:

```js
assert.match(source, /grid min-w-0 gap-2 sm:flex sm:flex-wrap sm:items-center/);
assert.doesNotMatch(source, /DashboardFilterMenu/);
```

- [ ] **Step 2: Run the dashboard contract test and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/admin-shell.test.mjs
```

Expected: FAIL because `DashboardVisibleFilters` does not exist and the dropdown implementation is still present.

- [ ] **Step 3: Replace the dropdown with the existing segmented control**

Remove `SlidersHorizontal` from the lucide import and remove the entire dropdown-menu import. Keep `ChevronDown`, which is used by list disclosures. Delete `getScopedFilterLabel`, `getFilterSummary`, `FilterRadioGroup`, and `DashboardFilterMenu`; keep `getActiveLabel` because the class-operation group selector still consumes it.

Add immediately before `DashboardHeader`:

```tsx
function DashboardVisibleFilters({
  subject,
  division,
  onSubjectChange,
  onDivisionChange,
}: {
  subject: DashboardSubjectKey
  division: DashboardDivisionKey
  onSubjectChange: (next: DashboardSubjectKey) => void
  onDivisionChange: (next: DashboardDivisionKey) => void
}) {
  return (
    <div className="grid min-w-0 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">과목</span>
        <SegmentedControl
          label="과목"
          value={subject}
          items={SUBJECT_TABS}
          onChange={onSubjectChange}
        />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">부서</span>
        <SegmentedControl
          label="부서"
          value={division}
          items={DIVISION_TABS}
          onChange={onDivisionChange}
        />
      </div>
    </div>
  )
}
```

Replace the `DashboardFilterMenu` call inside `DashboardHeader` with:

```tsx
<DashboardVisibleFilters
  subject={subject}
  division={division}
  onSubjectChange={onSubjectChange}
  onDivisionChange={onDivisionChange}
/>
```

Keep the existing outer bordered header and status badge. The filters stack as two rows below `sm` and share a wrapping row at `sm` and above. Do not add a horizontal scroller or collapse them into another menu.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/admin-shell.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: all focused tests PASS. Search confirms the removed dropdown names are absent from `section-cards.tsx`, while `getActiveLabel` and both filter state axes remain.

- [ ] **Step 5: Commit the visible filters**

```bash
git add src/app/admin/dashboard/components/section-cards.tsx tests/admin-shell.test.mjs
git commit -m "feat: expose dashboard scope filters"
```

---

### Task 3: Put the dashboard first for full-access users only

**Files:**
- Modify: `src/lib/navigation.ts`
- Modify: `tests/admin-shell.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Produces: `/admin/dashboard` as index `0` of `fullOverviewItems`.
- Preserves: every other full-access item's relative order, all nested task/calendar items, the assistant menu, `buildAdminNavGroups`, sidebar rendering, quick-search rendering, and route authorization.

- [ ] **Step 1: Write failing order and access-boundary tests**

In `navigation keeps todo queues and separates operation menus`, add:

```js
const assistantOverviewBlock = source.slice(
  source.indexOf("const assistantOverviewItems"),
  source.indexOf("const fullOverviewItems"),
);
const dashboardIndex = fullOverviewBlock.indexOf('title: "대시보드"');
const todoIndex = fullOverviewBlock.indexOf(`title: "${ko.todo}"`);

assert.notEqual(dashboardIndex, -1);
assert.ok(dashboardIndex < todoIndex);
assert.match(
  fullOverviewBlock,
  /const fullOverviewItems: NavItem\[\] = \[\s*\{ title: "대시보드", url: "\/admin\/dashboard"/,
);
assert.doesNotMatch(assistantOverviewBlock, /title: "대시보드"/);
```

Keep the existing `할 일 < 영어 단어 재시험 < 등록` relative-order assertions. In `assistant navigation only exposes allowed operation surfaces`, add the exact current-variable contract:

```js
const assistantOverviewBlock = navigationSource.slice(
  navigationSource.indexOf("const assistantOverviewItems"),
  navigationSource.indexOf("const fullOverviewItems"),
);
assert.doesNotMatch(assistantOverviewBlock, /url: "\/admin\/dashboard"/);
```

Preserve the assertions that both sidebar and quick search consume `buildAdminNavGroups`.

- [ ] **Step 2: Run the navigation contracts and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/admin-shell.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: FAIL because `대시보드` currently follows `전자결재` in `fullOverviewItems`.

- [ ] **Step 3: Move one existing navigation item**

Make the beginning of `fullOverviewItems`:

```ts
const fullOverviewItems: NavItem[] = [
  { title: "대시보드", url: "/admin/dashboard", icon: LayoutDashboard },
  {
    title: "할 일",
    url: "/admin/tasks",
    icon: ClipboardCheck,
    items: [
      { title: "받은함", url: "/admin/tasks?list=inbox" },
      { title: "보낸함", url: "/admin/tasks?list=sent" },
      { title: "완료", url: "/admin/tasks?list=completed" },
    ],
  },
```

Remove the old later dashboard entry. Do not edit `assistantOverviewItems`, `overview`, `app-sidebar.tsx`, `command-search.tsx`, or `auth-guard.tsx`; the two navigation consumers inherit the order from the shared source.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command again.

Expected: all focused tests PASS; the full-access dashboard item precedes `할 일`, all later items retain order, and the assistant block still excludes the route.

- [ ] **Step 5: Commit the navigation order**

```bash
git add src/lib/navigation.ts tests/admin-shell.test.mjs tests/ops-task-workspace.test.mjs
git commit -m "fix: prioritize dashboard navigation"
```

---

### Task 4: Verify the current dashboard as a real operating surface

**Files:**
- Verify only; do not add another dashboard abstraction or summary.

**Interfaces:**
- Verifies: source contracts, full regression suite, TypeScript/lint/build, authenticated desktop and mobile behavior.
- Hands off: notification receipt/Push backend work to common-plan Tasks 2 and 5, and popover/client integration to Task 7.

- [ ] **Step 1: Run focused, full, type, and lint verification while the dev server remains usable**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/admin-shell.test.mjs tests/ops-task-workspace.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/*.test.mjs
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
```

Expected: focused tests pass, the measured 1011-test suite reports zero failures and includes the revised contracts, TypeScript and lint pass, and `git diff --check` prints nothing. If an unrelated baseline failure appears, record it separately and do not weaken the new assertions. Do not run `next build` while the port-3000 dev server is using the same `.next` directory.

- [ ] **Step 2: Confirm the local surface is reachable**

Check `http://localhost:3000/admin/dashboard`. If it is not already served, start the repository's normal development server in a persistent terminal and wait for the authenticated dashboard route to load. Treat `ERR_CONNECTION_REFUSED` as a server-state issue, not as a dashboard logic regression.

- [ ] **Step 3: Perform authenticated desktop QA at `1349x987`**

Using the existing signed-in session, verify all of the following:

1. The page begins with the visible filter surface; there is no top `할 일 요약` section containing `받은함`, `보낸함`, or the inaccurate `완료` card. The sidebar's legitimate 할 일 submenu remains unchanged.
2. `과목` shows `전체`, `영어`, `수학` and `부서` shows `전체`, `초중등부`, `고등부` without opening a menu.
3. Select `영어`, `수학`, and back to `전체`; select `초중등부`, `고등부`, and back to `전체`.
4. Select a combined non-default state such as `수학 + 고등부`; confirm KPI, student distribution, and class-operation content all update from the existing bucket, then reset both axes.
5. The sidebar's first full-access operation item is `대시보드` and quick search presents the same shared order.
6. There are no new console/runtime errors and no notification/provider request is emitted by these interactions.

- [ ] **Step 4: Perform authenticated mobile QA at `390x844`**

Verify that `과목` and `부서` occupy separate visible rows, all six choices remain tappable, the status badge does not cover a choice, and:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

is true. Repeat one cross-axis selection and confirm panels update without clipped text, page-wide horizontal scroll, or focus/touch overlap.

- [ ] **Step 5: Stop only the known dev session and verify the production build**

After browser QA, stop the terminal session that owns `pnpm dev` with `Ctrl-C`; do not use a broad `pkill`. Then run:

```bash
pnpm run build
git diff --check
```

Expected: the production build exits `0` and diff check prints nothing.

- [ ] **Step 6: Restore the local server and perform a final route sanity check**

Restart `pnpm dev` in a persistent terminal, reload `http://localhost:3000/admin/dashboard`, and verify the visible filters and first navigation item still render with no console/runtime error. Leave the local server running for the user's ongoing use.

- [ ] **Step 7: Record the handoff boundary**

Do not claim notification inline read or Web Push is fixed by this plan. Continue with `2026-07-15-common-notification-control-plane.md`: Task 2 owns receipt schema, Task 5 owns inbox RPCs and Push API/subscription/service-worker readiness, and Task 7 owns the sibling `읽음` action plus client readiness/self-test UX.
