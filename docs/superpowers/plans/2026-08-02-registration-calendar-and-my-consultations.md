# Registration Calendar and My Consultations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep registration calendar navigation in calendar mode with level-test and visit-consultation filters, and make `내 담당` the safe default for consultation-requested and consultation-completed lists.

**Architecture:** Keep canonical registration rows, appointments, and authorization unchanged. Add owner filtering to the existing case-list projection, isolate URL transitions in a pure route helper, add pure calendar-kind filtering/counts, then connect those units to the existing registration workspace and deterministic browser fixture.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript 5.9, Tailwind CSS 4, Node test runner with TypeScript stripping, existing registration subject-track fixture, Playwright-based ops browser verifier.

## Global Constraints

- Implement the approved design in `docs/superpowers/specs/2026-08-02-registration-calendar-and-my-consultations-design.md` without expanding its scope.
- `상담 신청` and `상담 완료` default to `내 담당`; `전체` is always available.
- Owner matching uses `directorProfileId === registrationViewerId`; never match display names.
- A multi-subject case appears once, and `내 담당` exposes only the viewer-owned matching tracks.
- Calendar mode shows only canonical `level_test` and `visit_consultation` appointments.
- Calendar kind changes preserve `view=calendar`; list/calendar switches clean `flow`, `owner`, `view`, and `kind` according to the spec.
- Do not change database schema, SQL views, RPCs, migrations, assignment rules, permissions, notification rules, or provider state.
- Do not save fixture forms, mutate production data, send Google Chat/Web Push/SOLAPI messages, push Git, or deploy.
- Preserve the user-owned untracked file `docs/superpowers/plans/2026-08-01-registration-notion-status-open-fields.md` and exclude it from every commit.
- Use strict red-green-refactor: write each behavioral test first, run it to observe the expected failure, implement the minimum, and rerun.
- Complete one task, run its tests, inspect its diff, commit only that task, report the result, and stop before starting the next task unless the user explicitly continues.
- Baseline on 2026-08-02: the combined case-list/calendar/workspace run is 114/120. The only six failures are pre-existing stale source contracts in `tests/ops-task-workspace.test.mjs`; no task may add a seventh failure or claim that file is green.

---

## File Responsibility Map

- `src/features/tasks/registration-case-list-model.ts`: project registration cases into a selected workflow view, apply optional consultation-owner scope, then search/sort.
- `src/features/tasks/registration-workspace-route.ts`: normalize `owner`/`kind` query values and produce non-mutating list/calendar URL transitions.
- `src/features/tasks/registration-appointment-calendar-model.ts`: validate canonical appointments and derive kind-filtered items/counts without changing appointment identity.
- `src/features/tasks/registration-appointment-calendar.tsx`: load date/status-scoped appointments, apply the controlled kind filter, report counts, and render cards.
- `src/features/tasks/ops-task-workspace.tsx`: own selected list/calendar mode, owner scope, calendar kind, tab rendering, counts, and route synchronization.
- `scripts/verify-ops-task-browser-workflow.mjs`: exercise the real deterministic registration UI at desktop and mobile sizes with provider/mutation guards.
- Focused tests live beside those responsibilities in `tests/registration-case-list-model.test.mjs`, `tests/registration-workspace-route.test.mjs`, and `tests/registration-appointment-calendar.test.mjs`.

---

### Task 1: Owner-Scoped Consultation Projection

**Files:**
- Modify: `tests/registration-case-list-model.test.mjs`
- Modify: `src/features/tasks/registration-case-list-model.ts:113-157,217-235`

**Interfaces:**
- Consumes: `RegistrationWorkflowViewKey`, each track's `directorProfileId`, and the existing search/sort projection.
- Produces: `RegistrationCaseListFilterOptions` and the backward-compatible fourth argument of `filterRegistrationCaseListItems(items, viewKey, query?, options?)`.
- Guarantees: omitting `consultationOwnerId` preserves the existing `전체` behavior; passing an empty/null owner produces no personal rows.

- [ ] **Step 1: Extend the test fixture and write failing owner-scope tests**

Allow the test helper to supply a canonical workflow status:

```js
function track({
  id,
  subject = "영어",
  status = "inquiry",
  workflowStatus,
  directorName = "",
  directorProfileId = null,
  stageEnteredAt = "2026-07-12T00:00:00Z",
  phoneReadyAt = null,
  visitScheduledAt = "",
  visitPlace = "",
} = {}) {
  return {
    id,
    taskId: "",
    subject,
    status,
    workflowStatus,
    directorName,
    directorProfileId,
    stageEnteredAt,
    phoneReadyAt,
    visitScheduledAt,
    visitPlace,
    migrationReviewRequired: false,
  }
}
```

Add tests whose expected values are literal and independent of the implementation:

```js
test("mine consultation scope keeps only viewer-owned subjects in one case row", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registrationTracks: [
        track({ id: "eng", subject: "영어", status: "visit_consultation_scheduled", directorProfileId: "director-me", directorName: "내 책임자", visitScheduledAt: "2026-08-03T10:00:00+09:00" }),
        track({ id: "math", subject: "수학", status: "consultation_waiting", directorProfileId: "director-other", directorName: "다른 책임자", phoneReadyAt: "2026-08-02T09:00:00+09:00" }),
      ],
    }),
  ])

  const [mine] = filterRegistrationCaseListItems(items, "consultation_requested", "", {
    consultationOwnerId: "director-me",
  })

  assert.deepEqual(mine.matchingTracks.map((item) => item.trackId), ["eng"])
  assert.equal(mine.representativeTrack.trackId, "eng")
  assert.equal(mine.representativeSortValue, "2026-08-03T10:00:00+09:00")
  assert.deepEqual(filterRegistrationCaseListItems(items, "consultation_requested")[0].matchingTracks.map((item) => item.trackId), ["math", "eng"])
})

test("mine scope applies to completed consultation and hides other-owner search metadata", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registrationTracks: [
        track({ id: "eng", workflowStatus: "consultation_completed", directorProfileId: "director-me", directorName: "내 책임자" }),
        track({ id: "math", subject: "수학", workflowStatus: "consultation_completed", directorProfileId: "director-other", directorName: "검색되면 안 됨", visitPlace: "다른 상담실" }),
      ],
    }),
  ])

  const options = { consultationOwnerId: "director-me" }
  assert.equal(filterRegistrationCaseListItems(items, "consultation_completed", "검색되면 안 됨", options).length, 0)
  assert.equal(filterRegistrationCaseListItems(items, "consultation_completed", "수학", options).length, 0)
  assert.deepEqual(filterRegistrationCaseListItems(items, "consultation_completed", "", options)[0].matchingTracks.map((item) => item.trackId), ["eng"])
  assert.equal(filterRegistrationCaseListItems(items, "consultation_completed", "", { consultationOwnerId: "" }).length, 0)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-case-list-model.test.mjs
```

Expected: the new multi-subject assertion fails because the current function ignores the fourth argument and retains both tracks.

- [ ] **Step 3: Implement the minimal owner filter before search and representative-track selection**

Add the option type and preserve the existing default:

```ts
export type RegistrationCaseListFilterOptions = {
  consultationOwnerId?: string | null
}

export function filterRegistrationCaseListItems(
  items: readonly RegistrationCaseListItem[],
  viewKey: RegistrationWorkflowViewKey,
  query = "",
  options: RegistrationCaseListFilterOptions = {},
): RegistrationCaseListViewItem[] {
  const normalizedViewKey = normalizeRegistrationWorkflowViewKey(viewKey)
  const normalizedQuery = normalizeRegistrationCaseSearchText(query)
  const ownerScoped = normalizedViewKey === "consultation_requested" || normalizedViewKey === "consultation_completed"

  const matched = items.flatMap((item) => {
    const viewTracks = getRegistrationCaseMatchedTracks(item, normalizedViewKey)
    const sourceMatchedTracks = options.consultationOwnerId === undefined || !ownerScoped
      ? viewTracks
      : viewTracks.filter((track) => (
          Boolean(options.consultationOwnerId)
          && track.directorProfileId === options.consultationOwnerId
        ))
    const matchingTracks = normalizedViewKey === "consultation_requested"
      ? [...sourceMatchedTracks].sort(compareConsultationTracks)
      : sourceMatchedTracks
    const searchSubjectTracks = options.consultationOwnerId === undefined || !ownerScoped
      ? item.tracks
      : matchingTracks
    if (
      matchingTracks.length === 0
      || !matchesRegistrationCaseSearch(item, matchingTracks, normalizedQuery, searchSubjectTracks)
    ) return []
    const representativeTrack = matchingTracks[0]
    return [{
      ...item,
      viewKey: normalizedViewKey,
      matchingTracks,
      representativeTrack,
      representativeSortValue: getRegistrationCaseTrackTimeValue(representativeTrack),
    }]
  })

  if (normalizedViewKey !== "consultation_requested") return matched
  return [...matched].sort(compareConsultationCaseItems)
}
```

Extend `matchesRegistrationCaseSearch` with a fourth parameter that defaults to the current full track set, and replace `...item.tracks.map((track) => track.subject)` with `...subjectTracks.map((track) => track.subject)`:

```ts
function matchesRegistrationCaseSearch(
  item: RegistrationCaseListItem,
  matchingTracks: RegistrationCaseListTrackItem[],
  normalizedQuery: string,
  subjectTracks: readonly RegistrationCaseListTrackItem[] = item.tracks,
): boolean {
  if (!normalizedQuery) return true
  const registration = item.task.registration
  return [
    item.studentName,
    item.task.title,
    registration?.parentPhone,
    registration?.studentPhone,
    registration?.schoolGrade,
    registration?.schoolName,
    registration?.requestNote,
    ...subjectTracks.map((track) => track.subject),
    ...matchingTracks.flatMap((track) => [track.directorName, track.visitPlace]),
  ].some((value) => normalizeRegistrationCaseSearchText(value).includes(normalizedQuery))
}
```

Do not mutate `item.tracks` or broaden the owner filter to non-consultation views.

- [ ] **Step 4: Verify GREEN and surrounding model behavior**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-case-list-model.test.mjs tests/registration-workflow-status.test.mjs
```

Expected: all tests pass with no warnings.

- [ ] **Step 5: Review and commit Task 1 only**

Run `git diff --check`, inspect only the two Task 1 files, then:

```bash
git add tests/registration-case-list-model.test.mjs src/features/tasks/registration-case-list-model.ts
git commit -m "feat(registration): filter consultations by owner"
```

Stop and report the test count and commit before Task 2.

---

### Task 2: Pure Registration Workspace URL State

**Files:**
- Create: `tests/registration-workspace-route.test.mjs`
- Create: `src/features/tasks/registration-workspace-route.ts`

**Interfaces:**
- Consumes: `RegistrationWorkflowViewKey` and `RegistrationAppointmentCalendarKind`.
- Produces: `RegistrationConsultationOwnerScope`, `RegistrationWorkspaceCalendarKind`, `isRegistrationConsultationViewKey`, `normalizeRegistrationConsultationOwnerScope`, `normalizeRegistrationWorkspaceCalendarKind`, and `buildRegistrationWorkspaceSearchParams`.
- Guarantees: the helper clones its input, preserves unrelated fixture parameters, clears detail parameters, and never writes `owner=mine` or `kind=all` because those are defaults.

- [ ] **Step 1: Write the failing route tests**

Create `tests/registration-workspace-route.test.mjs`:

```js
import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRegistrationWorkspaceSearchParams,
  isRegistrationConsultationViewKey,
  normalizeRegistrationConsultationOwnerScope,
  normalizeRegistrationWorkspaceCalendarKind,
} from "../src/features/tasks/registration-workspace-route.ts"

test("route values normalize to safe defaults", () => {
  assert.equal(normalizeRegistrationConsultationOwnerScope(null), "mine")
  assert.equal(normalizeRegistrationConsultationOwnerScope("all"), "all")
  assert.equal(normalizeRegistrationConsultationOwnerScope("someone"), "mine")
  assert.equal(normalizeRegistrationWorkspaceCalendarKind(null), "all")
  assert.equal(normalizeRegistrationWorkspaceCalendarKind("level_test"), "level_test")
  assert.equal(normalizeRegistrationWorkspaceCalendarKind("visit_consultation"), "visit_consultation")
  assert.equal(normalizeRegistrationWorkspaceCalendarKind("phone"), "all")
  assert.equal(isRegistrationConsultationViewKey("consultation_requested"), true)
  assert.equal(isRegistrationConsultationViewKey("waiting"), false)
})

test("calendar target removes list state and preserves fixture context", () => {
  const current = new URLSearchParams("fixture=registration-subject-tracks&fixtureRole=english_admin&flow=waiting&owner=all&taskId=task-1")
  const next = buildRegistrationWorkspaceSearchParams(current, {
    mode: "calendar",
    calendarKind: "visit_consultation",
  })

  assert.equal(next.get("fixture"), "registration-subject-tracks")
  assert.equal(next.get("fixtureRole"), "english_admin")
  assert.equal(next.get("view"), "calendar")
  assert.equal(next.get("kind"), "visit_consultation")
  for (const key of ["flow", "owner", "taskId", "trackId", "appointmentId", "list", "focus"]) assert.equal(next.has(key), false)
  assert.equal(current.get("flow"), "waiting")
})

test("list targets restore flow and encode only explicit all scope", () => {
  const current = new URLSearchParams("fixture=x&view=calendar&kind=level_test&appointmentId=appointment-1")
  const all = buildRegistrationWorkspaceSearchParams(current, {
    mode: "list",
    view: "consultation_completed",
    ownerScope: "all",
  })
  assert.equal(all.get("flow"), "consultation_completed")
  assert.equal(all.get("owner"), "all")
  for (const key of ["view", "kind", "appointmentId"]) assert.equal(all.has(key), false)

  const mine = buildRegistrationWorkspaceSearchParams(all, {
    mode: "list",
    view: "consultation_requested",
    ownerScope: "mine",
  })
  assert.equal(mine.get("flow"), "consultation_requested")
  assert.equal(mine.has("owner"), false)

  const waiting = buildRegistrationWorkspaceSearchParams(all, {
    mode: "list",
    view: "waiting",
    ownerScope: "all",
  })
  assert.equal(waiting.has("owner"), false)
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-workspace-route.test.mjs
```

Expected: the import fails with `ERR_MODULE_NOT_FOUND` because the route module does not exist.

- [ ] **Step 3: Implement the pure route module**

Use this public shape:

```ts
import type { RegistrationAppointmentCalendarKind } from "./registration-appointment-calendar-model"
import type { RegistrationWorkflowViewKey } from "./registration-case-list-model"

export type RegistrationConsultationOwnerScope = "mine" | "all"
export type RegistrationWorkspaceCalendarKind = "all" | RegistrationAppointmentCalendarKind

export type RegistrationWorkspaceRouteTarget =
  | {
      mode: "list"
      view: RegistrationWorkflowViewKey
      ownerScope: RegistrationConsultationOwnerScope
    }
  | {
      mode: "calendar"
      calendarKind: RegistrationWorkspaceCalendarKind
    }

const DETAIL_KEYS = ["taskId", "trackId", "appointmentId"] as const

export function isRegistrationConsultationViewKey(value: string): value is "consultation_requested" | "consultation_completed" {
  return value === "consultation_requested" || value === "consultation_completed"
}

export function normalizeRegistrationConsultationOwnerScope(value: string | null): RegistrationConsultationOwnerScope {
  return value === "all" ? "all" : "mine"
}

export function normalizeRegistrationWorkspaceCalendarKind(value: string | null): RegistrationWorkspaceCalendarKind {
  return value === "level_test" || value === "visit_consultation" ? value : "all"
}

export function buildRegistrationWorkspaceSearchParams(
  current: URLSearchParams,
  target: RegistrationWorkspaceRouteTarget,
): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of DETAIL_KEYS) next.delete(key)
  next.delete("list")
  next.delete("focus")

  if (target.mode === "calendar") {
    next.set("view", "calendar")
    next.delete("flow")
    next.delete("owner")
    if (target.calendarKind === "all") next.delete("kind")
    else next.set("kind", target.calendarKind)
    return next
  }

  next.set("flow", target.view)
  next.delete("view")
  next.delete("kind")
  if (isRegistrationConsultationViewKey(target.view) && target.ownerScope === "all") next.set("owner", "all")
  else next.delete("owner")
  return next
}
```

- [ ] **Step 4: Verify GREEN and mutation safety**

Run the Task 2 test. Confirm all tests pass and the assertion proving `current` was not mutated remains green.

- [ ] **Step 5: Review and commit Task 2 only**

Run `git diff --check`, inspect the two new files, then:

```bash
git add tests/registration-workspace-route.test.mjs src/features/tasks/registration-workspace-route.ts
git commit -m "feat(registration): model workspace route state"
```

Stop and report before Task 3.

---

### Task 3: Calendar Kind Filtering and Counts

**Files:**
- Modify: `tests/registration-appointment-calendar.test.mjs`
- Modify: `src/features/tasks/registration-appointment-calendar-model.ts:7-50,254-296`
- Modify: `src/features/tasks/registration-appointment-calendar.tsx:15-180,204-325`

**Interfaces:**
- Produces: `RegistrationAppointmentCalendarKindFilter`, `RegistrationAppointmentCalendarKindCounts`, `filterRegistrationAppointmentCalendarItems`, and `getRegistrationAppointmentCalendarKindCounts`.
- Extends `RegistrationAppointmentCalendar` with optional controlled props `kindFilter` and `onKindCountsChange`; defaults preserve the current all-appointments UI until Task 4 wires the parent.
- Provides `data-registration-calendar-kind` on every appointment card for deterministic browser verification.

- [ ] **Step 1: Write failing kind-filter and count tests**

Add a test using canonical built items rather than raw mock objects:

```js
test("calendar kind filtering counts canonical appointments without splitting shared subjects", async () => {
  const {
    buildRegistrationAppointmentCalendarItems,
    filterRegistrationAppointmentCalendarItems,
    getRegistrationAppointmentCalendarKindCounts,
  } = await loadModel()
  const items = buildRegistrationAppointmentCalendarItems([
    calendarRow(),
    calendarRow({
      appointment_id: "appointment-visit",
      kind: "visit_consultation",
      scheduled_at: "2026-07-16T14:00:00+09:00",
      track_ids: ["track-math"],
      subjects: ["수학"],
    }),
  ])
  const originalIds = items.map((item) => item.id)

  assert.deepEqual(getRegistrationAppointmentCalendarKindCounts(items), {
    all: 2,
    level_test: 1,
    visit_consultation: 1,
  })
  assert.deepEqual(filterRegistrationAppointmentCalendarItems(items, "level_test").map((item) => item.appointmentId), ["appointment-shared"])
  assert.deepEqual(filterRegistrationAppointmentCalendarItems(items, "visit_consultation").map((item) => item.appointmentId), ["appointment-visit"])
  assert.deepEqual(filterRegistrationAppointmentCalendarItems(items, "all").map((item) => item.id), originalIds)
  assert.deepEqual(items.map((item) => item.id), originalIds)
})
```

- [ ] **Step 2: Run the calendar test and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-appointment-calendar.test.mjs
```

Expected: the new named exports are missing.

- [ ] **Step 3: Add the pure filter and counts**

Add to the model:

```ts
export type RegistrationAppointmentCalendarKindFilter = "all" | RegistrationAppointmentCalendarKind
export type RegistrationAppointmentCalendarKindCounts = Record<RegistrationAppointmentCalendarKindFilter, number>

export function filterRegistrationAppointmentCalendarItems(
  items: readonly RegistrationAppointmentCalendarItem[],
  kind: RegistrationAppointmentCalendarKindFilter,
): RegistrationAppointmentCalendarItem[] {
  return kind === "all" ? [...items] : items.filter((item) => item.kind === kind)
}

export function getRegistrationAppointmentCalendarKindCounts(
  items: readonly RegistrationAppointmentCalendarItem[],
): RegistrationAppointmentCalendarKindCounts {
  const levelTest = items.filter((item) => item.kind === "level_test").length
  const visitConsultation = items.filter((item) => item.kind === "visit_consultation").length
  return {
    all: items.length,
    level_test: levelTest,
    visit_consultation: visitConsultation,
  }
}
```

- [ ] **Step 4: Make the calendar component controlled without changing its default output**

Extend the props and derive visible items/counts:

```tsx
type RegistrationAppointmentCalendarProps = {
  onOpenAppointment: (item: RegistrationAppointmentCalendarItem) => void
  refreshToken?: string | number
  kindFilter?: RegistrationAppointmentCalendarKindFilter
  onKindCountsChange?: (counts: RegistrationAppointmentCalendarKindCounts) => void
}

export function RegistrationAppointmentCalendar({
  onOpenAppointment,
  refreshToken = "",
  kindFilter = "all",
  onKindCountsChange,
}: RegistrationAppointmentCalendarProps) {
  const visibleItems = useMemo(
    () => filterRegistrationAppointmentCalendarItems(items, kindFilter),
    [items, kindFilter],
  )
  const kindCounts = useMemo(
    () => getRegistrationAppointmentCalendarKindCounts(items),
    [items],
  )
  useEffect(() => onKindCountsChange?.(kindCounts), [kindCounts, onKindCountsChange])
}
```

Change the existing grouping loop from `for (const item of items)` to `for (const item of visibleItems)`, and change that memo's dependency from `[items]` to `[visibleItems]`. Change the empty-state condition from `items.length === 0` to `visibleItems.length === 0`. Add `data-registration-calendar-kind={item.kind}` to `appointmentCard`. Do not filter before status/date loading and do not change `item.id`, `appointmentId`, shared subject badges, or deep links.

- [ ] **Step 5: Verify GREEN, lint, and commit Task 3**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-appointment-calendar.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node .codex-temp/tools/npm/bin/npm-cli.js exec -- eslint src/features/tasks/registration-appointment-calendar-model.ts src/features/tasks/registration-appointment-calendar.tsx tests/registration-appointment-calendar.test.mjs
```

Then run `git diff --check`, inspect only the three Task 3 files, and commit:

```bash
git add tests/registration-appointment-calendar.test.mjs src/features/tasks/registration-appointment-calendar-model.ts src/features/tasks/registration-appointment-calendar.tsx
git commit -m "feat(registration): filter calendar appointment kinds"
```

Stop and report before Task 4.

---

### Task 4: Workspace Tabs, Counts, and Real Browser Flow

**Files:**
- Modify: `scripts/verify-ops-task-browser-workflow.mjs:2948-3665`
- Modify: `src/features/tasks/ops-task-workspace.tsx:267-712,8500-9075,9410-9430,9650-9670,12155-12265,12605-12630`
- Modify: `tests/registration-browser-verifier-contract.test.mjs:180-230`

**Interfaces:**
- Consumes: Task 1 owner filter, Task 2 route helper, and Task 3 calendar filter/counts.
- Produces: mode-specific tablists, `내 담당 / 전체` range control, synchronized `owner`/`kind` URL state, scoped empty copy, and a controlled calendar.
- Browser contract: the deterministic fixture must prove the navigation at both 1349×987 and 390×844 while its before/after state digest and intercepted provider-request count remain unchanged.

- [ ] **Step 1: Add a real failing browser assertion before workspace implementation**

Inside `verifyRegistrationSubjectTrackFixture`, add a helper that uses visible DOM and URL state:

```js
async function showFixtureAppointmentMonth() {
  const julyHeading = page.getByRole("heading", { name: "2026년 7월", exact: true })
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (await julyHeading.isVisible().catch(() => false)) return
    await page.getByRole("button", { name: "이전 기간", exact: true }).click()
  }
  throw new Error("registration fixture calendar could not reach 2026년 7월.")
}

async function assertRegistrationCalendarAndOwnerViews() {
  const calendarUrl = joinUrl(baseUrl, "/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin&view=calendar")
  await navigateRegistrationFixture("open specialized registration calendar", calendarUrl)
  await showFixtureAppointmentMonth()

  const kindTabs = page.getByRole("tablist", { name: "등록 예약 종류", exact: true })
  await kindTabs.waitFor({ state: "visible", timeout: 5000 })
  if (await page.getByRole("tab", { name: /^대기 신청/ }).count()) {
    throw new Error("calendar still exposes list workflow tabs.")
  }

  await kindTabs.getByRole("tab", { name: /^방문상담/ }).click()
  await page.waitForFunction(() => {
    const search = new URL(window.location.href).searchParams
    return search.get("view") === "calendar" && search.get("kind") === "visit_consultation"
  })
  const visibleKinds = await page.locator('[data-registration-calendar-item]:visible').evaluateAll((cards) => cards.map((card) => card.getAttribute("data-registration-calendar-kind")))
  if (visibleKinds.length === 0 || visibleKinds.some((kind) => kind !== "visit_consultation")) {
    throw new Error(`visit calendar rendered unexpected kinds: ${visibleKinds.join(",")}`)
  }

  await page.getByRole("button", { name: "목록", exact: true }).click()
  await page.getByRole("tab", { name: /^상담 신청/ }).click()
  const scope = page.getByRole("group", { name: "상담 목록 범위", exact: true })
  const mine = scope.getByRole("button", { name: /^내 담당/ })
  if (await mine.getAttribute("aria-pressed") !== "true") throw new Error("consultation did not default to my work.")

  const splitRow = page.locator('[data-registration-case-row]:visible').filter({ hasText: "박서준" }).first()
  const mineText = await splitRow.innerText()
  if (!mineText.includes("영어") || mineText.includes("수학") || mineText.includes("양소윤")) {
    throw new Error(`my consultation row leaked another owner's subject: ${mineText}`)
  }
  await scope.getByRole("button", { name: /^전체/ }).click()
  const allText = await splitRow.innerText()
  if (!allText.includes("영어") || !allText.includes("수학")) throw new Error("all consultation scope did not restore both subjects.")
}
```

Also call `showFixtureAppointmentMonth()` inside the existing `openRegistrationSubjectTrackFixtureCalendarItem` immediately after calendar navigation, before locating its July appointment. Call `assertRegistrationCalendarAndOwnerViews()` after the fixture's initial safety snapshot and before form-edit scenarios. These helpers perform no save or status-change action.

Add a safety-contract assertion that the helper exists, is executed, and remains inside the already guarded registration fixture verifier:

```js
assert.match(verifier, /async function assertRegistrationCalendarAndOwnerViews\(\)/)
assert.match(verifier, /await assertRegistrationCalendarAndOwnerViews\(\)/)
assert.match(verifier, /finalFixtureSnapshot\.stateDigest !== initialSnapshot\.stateDigest/)
assert.match(verifier, /assertNoInterceptedProviderRequests\("no-send registration application verification"\)/)
```

- [ ] **Step 2: Start the local app and verify browser RED**

Start the app in one terminal:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3012
```

Run the deterministic route in another terminal using the existing local browser-auth configuration:

```bash
OPS_BROWSER_WORKFLOW=1 OPS_BROWSER_ROUTE_FILTER=registration-subject-track-fixture OPS_BROWSER_BASE_URL=http://127.0.0.1:3012 /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-ops-task-browser-workflow.mjs
```

Expected: FAIL at `등록 예약 종류` because the current calendar still renders registration workflow tabs. If local browser authentication is unavailable, stop Task 4 and obtain an authorized localhost browser state; never substitute the production URL.

- [ ] **Step 3: Add state derived from URL-safe defaults**

In `ops-task-workspace.tsx`, import the Task 1–3 interfaces and add:

```tsx
const REGISTRATION_CALENDAR_KIND_TABS = [
  { key: "all", label: "전체 일정" },
  { key: "level_test", label: "레벨테스트" },
  { key: "visit_consultation", label: "방문상담" },
] as const

const [registrationConsultationOwnerScope, setRegistrationConsultationOwnerScope] = useState<RegistrationConsultationOwnerScope>("mine")
const [registrationCalendarKind, setRegistrationCalendarKind] = useState<RegistrationAppointmentCalendarKindFilter>("all")
const [registrationCalendarKindCounts, setRegistrationCalendarKindCounts] = useState<RegistrationAppointmentCalendarKindCounts>({
  all: 0,
  level_test: 0,
  visit_consultation: 0,
})
```

In the existing search-param effect:

```tsx
const normalizedRegistrationView = normalizeRegistrationViewKey(nextWorkflowFlow)
if (normalizedRegistrationView) setRegistrationView(normalizedRegistrationView)
setRegistrationCalendarKind(normalizeRegistrationWorkspaceCalendarKind(searchParams.get("kind")))
setRegistrationConsultationOwnerScope(
  normalizedRegistrationView && isRegistrationConsultationViewKey(normalizedRegistrationView)
    ? normalizeRegistrationConsultationOwnerScope(searchParams.get("owner"))
    : "mine",
)
```

- [ ] **Step 4: Replace ad-hoc registration query mutations with the pure route builder**

Extract the repeated detail/notice reset and add one local URL writer around `buildRegistrationWorkspaceSearchParams`:

```tsx
const clearRegistrationWorkspaceSelection = () => {
  setDetailOpen(false)
  setRegistrationApplicationHost({ kind: "closed" })
  setSelectedRegistrationTrackId(null)
  setSelectedRegistrationAppointmentId(null)
  setRegistrationCaseDetail(null)
  registrationTrackSelectionRef.current = ""
  setNotice("")
}

const replaceRegistrationWorkspaceSearch = (target: RegistrationWorkspaceRouteTarget) => {
  const next = buildRegistrationWorkspaceSearchParams(new URLSearchParams(window.location.search), target)
  const queryString = next.toString()
  window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}`)
}
```

Required behavior:

```tsx
const syncRegistrationView = (nextView: RegistrationViewKey) => {
  const nextOwnerScope = isRegistrationConsultationViewKey(nextView) && isRegistrationConsultationViewKey(registrationView)
    ? registrationConsultationOwnerScope
    : "mine"
  setRegistrationMode("list")
  setRegistrationView(nextView)
  setRegistrationConsultationOwnerScope(nextOwnerScope)
  setTaskFocus("none")
  clearRegistrationWorkspaceSelection()
  replaceRegistrationWorkspaceSearch({ mode: "list", view: nextView, ownerScope: nextOwnerScope })
}

const syncRegistrationConsultationOwnerScope = (ownerScope: RegistrationConsultationOwnerScope) => {
  setRegistrationConsultationOwnerScope(ownerScope)
  clearRegistrationWorkspaceSelection()
  replaceRegistrationWorkspaceSearch({ mode: "list", view: registrationView, ownerScope })
}

const syncRegistrationCalendarKind = (calendarKind: RegistrationAppointmentCalendarKindFilter) => {
  setRegistrationCalendarKind(calendarKind)
  clearRegistrationWorkspaceSelection()
  replaceRegistrationWorkspaceSearch({ mode: "calendar", calendarKind })
}
```

`syncRegistrationMode("calendar")` uses the current in-session calendar kind. `syncRegistrationMode("list")` restores the current list view and uses `mine` unless the current list view is already a consultation view with an explicit in-session scope.

Implement that rule explicitly:

```tsx
const syncRegistrationMode = (nextMode: RegistrationWorkspaceMode) => {
  setRegistrationMode(nextMode)
  clearRegistrationWorkspaceSelection()
  if (nextMode === "calendar") {
    replaceRegistrationWorkspaceSearch({ mode: "calendar", calendarKind: registrationCalendarKind })
    return
  }
  const ownerScope = isRegistrationConsultationViewKey(registrationView)
    ? registrationConsultationOwnerScope
    : "mine"
  replaceRegistrationWorkspaceSearch({ mode: "list", view: registrationView, ownerScope })
}
```

In `openRegistrationCalendarItem`, preserve `kind` together with `fixture` and `fixtureRole` when constructing the canonical detail URL. Remove `flow` from that preservation loop. This keeps the selected appointment kind through open/close without reintroducing hidden list state:

```tsx
for (const key of ["fixture", "fixtureRole", "kind"] as const) {
  const value = currentSearchParams.get(key)
  if (value) canonicalUrl.searchParams.set(key, value)
}
```

- [ ] **Step 5: Scope list rows and counts before rendering**

Derive the optional owner ID only for consultation views:

```tsx
const consultationOwnerId = isRegistrationConsultationViewKey(registrationView)
  && registrationConsultationOwnerScope === "mine"
    ? registrationViewerId
    : undefined

const visibleRegistrationCaseItems = useMemo(
  () => filterRegistrationCaseListItems(
    registrationCaseItems,
    registrationView,
    deferredQuery,
    { consultationOwnerId },
  ),
  [consultationOwnerId, deferredQuery, registrationCaseItems, registrationView],
)

const registrationConsultationScopeCounts = useMemo(() => ({
  mine: filterRegistrationCaseListItems(
    registrationCaseItems,
    registrationView,
    "",
    { consultationOwnerId: registrationViewerId },
  ).length,
  all: filterRegistrationCaseListItems(registrationCaseItems, registrationView).length,
}), [registrationCaseItems, registrationView, registrationViewerId])
```

Use the scoped Korean empty label only when the active view is consultation requested/completed and scope is `mine`; retain the current empty labels for all other views.

- [ ] **Step 6: Render mode-specific navigation and the consultation scope control**

Add a keyboard handler for the three calendar kinds:

```tsx
function handleRegistrationCalendarKindTabKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  currentKind: RegistrationAppointmentCalendarKindFilter,
) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
  event.preventDefault()
  const currentIndex = REGISTRATION_CALENDAR_KIND_TABS.findIndex((tab) => tab.key === currentKind)
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? REGISTRATION_CALENDAR_KIND_TABS.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + REGISTRATION_CALENDAR_KIND_TABS.length) % REGISTRATION_CALENDAR_KIND_TABS.length
  const nextKind = REGISTRATION_CALENDAR_KIND_TABS[nextIndex]?.key
  if (!nextKind) return
  syncRegistrationCalendarKind(nextKind)
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(`[data-registration-calendar-kind-tab="${nextKind}"]`)?.focus()
  })
}
```

Then make the existing registration navigation row branch by `registrationMode` with complete buttons in both branches:

```tsx
<div
  className={`${HORIZONTAL_TAB_BAR_CLASS} w-full !flex-nowrap !overflow-x-auto lg:flex-1`}
  role="tablist"
  aria-label={registrationMode === "calendar" ? "등록 예약 종류" : "등록 흐름"}
>
  {registrationMode === "calendar"
    ? REGISTRATION_CALENDAR_KIND_TABS.map((tab) => {
        const count = registrationCalendarKindCounts[tab.key]
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            data-registration-calendar-kind-tab={tab.key}
            tabIndex={registrationCalendarKind === tab.key ? 0 : -1}
            onClick={() => syncRegistrationCalendarKind(tab.key)}
            onKeyDown={(event) => handleRegistrationCalendarKindTabKeyDown(event, tab.key)}
            aria-selected={registrationCalendarKind === tab.key}
            aria-label={count > 0 ? `${tab.label} ${count}건` : tab.label}
            className={[
              "shrink-0 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              registrationCalendarKind === tab.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            ].join(" ")}
          >
            <span>{tab.label}</span>
            {count > 0 ? <span aria-hidden="true" className="ml-1 rounded bg-background/65 px-1.5 py-0.5 text-xs text-inherit opacity-80">{count}</span> : null}
          </button>
        )
      })
    : REGISTRATION_VIEW_TABS.map((tab) => {
        const count = registrationCounts[tab.key]
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            data-registration-view-tab={tab.key}
            tabIndex={registrationView === tab.key ? 0 : -1}
            onClick={() => syncRegistrationView(tab.key)}
            onKeyDown={(event) => handleRegistrationViewTabKeyDown(event, tab.key)}
            aria-selected={registrationView === tab.key}
            aria-label={count > 0 ? `${tab.label} ${count}건` : tab.label}
            className={[
              "shrink-0 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              registrationView === tab.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            ].join(" ")}
          >
            <span>{tab.label}</span>
            {count > 0 ? <span aria-hidden="true" className="ml-1 rounded bg-background/65 px-1.5 py-0.5 text-xs text-inherit opacity-80">{count}</span> : null}
          </button>
        )
      })}
</div>
```

When list mode is on `consultation_requested` or `consultation_completed`, render:

```tsx
<div role="group" aria-label="상담 목록 범위" className="inline-flex w-fit rounded-md border bg-background p-1">
  {(["mine", "all"] as const).map((scope) => (
    <button
      key={scope}
      type="button"
      aria-pressed={registrationConsultationOwnerScope === scope}
      onClick={() => syncRegistrationConsultationOwnerScope(scope)}
    >
      {scope === "mine" ? "내 담당" : "전체"}
      <span aria-hidden="true">{registrationConsultationScopeCounts[scope]}</span>
    </button>
  ))}
</div>
```

Add ArrowLeft/ArrowRight/Home/End handling for the three calendar tabs using the same focus pattern as the workflow tabs. Do not make consultation scope buttons look or behave like a tablist.

- [ ] **Step 7: Connect the controlled calendar and rerun focused tests**

Pass:

```tsx
<RegistrationAppointmentCalendar
  refreshToken={`${registrationFixtureRevision}:${registrationCalendarRefreshToken}`}
  kindFilter={registrationCalendarKind}
  onKindCountsChange={setRegistrationCalendarKindCounts}
  onOpenAppointment={openRegistrationCalendarItem}
/>
```

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-case-list-model.test.mjs tests/registration-workspace-route.test.mjs tests/registration-appointment-calendar.test.mjs tests/registration-browser-verifier-contract.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 8: Verify browser GREEN at both fixture viewports**

With the same local server, rerun:

```bash
OPS_BROWSER_WORKFLOW=1 OPS_BROWSER_ROUTE_FILTER=registration-subject-track-fixture OPS_BROWSER_BASE_URL=http://127.0.0.1:3012 /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-ops-task-browser-workflow.mjs
```

Expected: desktop and mobile routes pass; the final fixture state digest equals the initial digest; intercepted provider requests remain `0`.

- [ ] **Step 9: Lint, review, and commit Task 4 only**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node .codex-temp/tools/npm/bin/npm-cli.js exec -- eslint src/features/tasks/ops-task-workspace.tsx scripts/verify-ops-task-browser-workflow.mjs tests/registration-browser-verifier-contract.test.mjs
git diff --check
```

Inspect the Task 4 diff and confirm no save, notification-send, SQL, or migration code changed. Then:

```bash
git add src/features/tasks/ops-task-workspace.tsx scripts/verify-ops-task-browser-workflow.mjs tests/registration-browser-verifier-contract.test.mjs
git commit -m "feat(registration): add calendar and personal consultation views"
```

Stop and report before Task 5.

---

### Task 5: Final Regression and No-Send Browser Review

**Files:**
- Verify all files committed by Tasks 1–4.
- Do not create a verification-only commit unless a newly discovered bug requires a TDD fix.

**Interfaces:**
- Consumes the complete feature.
- Produces evidence separated into focused tests, known baseline debt, ESLint, build, browser observation, Git state, and release boundary.

- [ ] **Step 1: Run the focused registration suite**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-case-list-model.test.mjs tests/registration-workspace-route.test.mjs tests/registration-appointment-calendar.test.mjs tests/registration-track-fixtures.test.mjs tests/registration-browser-verifier-contract.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Recheck the known broad workspace baseline without hiding it**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/ops-task-workspace.test.mjs
```

Expected baseline remains exactly six failures with these names and no additional failure:

1. `registration workspace replaces Notion registration management with one application row per view`
2. `registration exposes eight ordered work tabs with case rows retaining subject-specific states`
3. `registration rows expose process-specific columns and safe deletion`
4. `registration alone uses the application list while neighboring operation tables stay wired`
5. `registration browser-back closure clears canonical state and restores the link when dirty close is canceled`
6. `registration application rows retain every subject during class sync`

Do not mark this command green; report it as unchanged pre-existing source-contract debt.

- [ ] **Step 3: Run full lint and production build**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node .codex-temp/tools/npm/bin/npm-cli.js run lint
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
```

Expected: ESLint exits 0 and the production build exits 0 with `/admin/registration` emitted.

- [ ] **Step 4: Perform final in-app browser QA at the user-reported size**

Use the Browser control skill against the localhost fixture at 1355×987, then 390×844. Use this target flow sentence: “등록 달력에서 예약 종류를 바꾸고 상담 목록에서 내 담당/전체를 전환해도 모드·과목·URL이 정확히 유지된다.”

Verify all of the following without opening a save action:

1. `달력` shows only `전체 일정 / 레벨테스트 / 방문상담` as its secondary tabs.
2. Move to the fixture month `2026년 7월`, then select each kind; `view=calendar` stays present and `kind` updates or disappears correctly.
3. Visible cards match the selected kind and still show shared subject badges.
4. `목록` → `상담 신청` defaults to `내 담당`; English viewer sees only owned subjects.
5. `전체` restores the other owner's subject in the same single case row.
6. `상담 완료` uses the same owner default and control.
7. No blocking overlay, horizontal overflow, browser console error, failed request, or provider request appears.
8. Capture the final screenshot only after all interactions and checks finish.

- [ ] **Step 5: Inspect final diff and repository state**

Run:

```bash
git diff --check
git status --short --branch
git log --oneline -8
```

Expected: no tracked changes remain after the four task commits. The user-owned untracked `docs/superpowers/plans/2026-08-01-registration-notion-status-open-fields.md` remains untouched. Do not push or deploy.

- [ ] **Step 6: Report completion boundaries**

Report separately:

- focused test count and result;
- the unchanged six-failure broad baseline;
- ESLint result;
- build result;
- desktop/mobile localhost browser observations;
- commit IDs;
- no-save/no-send evidence;
- Git push and deployment both not performed.
