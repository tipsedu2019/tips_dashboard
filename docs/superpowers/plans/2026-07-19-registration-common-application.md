# Registration Common Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one registration case the single cumulative application from inquiry through admission and history, while preserving independent English/mathematics workflows, section-scoped saves, case-centric list counts, and provider-zero notification safety.

**Architecture:** Keep the normalized parent task, subject tracks, appointments, consultations, enrollments, admission batches, and event rows as canonical data. Add pure case-list and application-state projections, render create and detail through one six-section shell, and move every existing mutation surface into its owning section without changing the authoritative RPC, revision, idempotency, appointment-ID, or post-commit notification contracts.

**Tech Stack:** Next.js 16.1.1, React 19.2.3, TypeScript 5.9.3, Supabase JS 2.103.1, Node test runner with type stripping, Tailwind CSS 4, Radix/shadcn components, fixture-backed browser verification.

## Shell Preamble

Run this once in every implementation shell. This desktop environment does not guarantee a system `node` or `pnpm` on `PATH`.

~~~bash
TIPS_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
TIPS_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
export PATH="$(dirname "$TIPS_NODE"):$(dirname "$TIPS_PNPM"):$PATH"
~~~

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-07-19-registration-common-application-design.md`. One case is one document; status tabs are views of that document, never separate documents.
- The application always renders exactly these sections in this order: `문의 정보`, `레벨테스트`, `상담`, `등록·대기 정보`, `입학 처리`, `자동 이력`.
- Future fields stay visible with one concise lock reason. Do not replace them with hidden panels, stage tabs, previous/next controls, overview cards, or a separate `현재 업무` card.
- English and mathematics share case identity and common inquiry fields but retain independent statuses, directors, appointments, outcomes, waiting values, enrollments, and actions.
- A focused `trackId` may set scroll/focus/highlight only. It must never hide the other subject or turn a track into the document identity.
- State remains the result of explicit workflow actions. Do not add a free-form status selector or duplicate `ALLOWED_ACTIONS_BY_STATUS` in UI code.
- Preserve section-level commits, request keys, revision checks, committed-refresh locks, server permission checks, event creation, and canonical reloads. Do not create a page-wide save RPC.
- Preserve the current atomic create RPC and its four initial routes: inquiry hold, direct phone, level test, and visit. Only `ready_atomic` exposes non-inquiry initial routing; canonical/legacy fallback writers are inquiry-only while future section fields remain visible and locked. A saved inquiry must enter the phone queue before scheduling a visit.
- Admission-message step 1 is a single case-level action once any track is `enrollment_decided`, even before enrollment rows exist. Steps 2–5 remain locked until eligible rows exist and a batch starts.
- Keep `migration_review` in inquiry; `inquiry_closed` reopen in inquiry; `not_registered` reopen, registered add-class, and enrollment cancellation in placement; admission-batch follow-up in admission.
- Calendar navigation remains appointment-ID based. The case-list projection must not fabricate an appointment ID absent from the summary row; the existing calendar payload and case detail continue to own that identifier.
- The service already returns one parent `OpsTask` with `registrationTracks[]`. Do not add a database migration, denormalized application table, new summary RPC, or extra child queries just to group list rows.
- Keep legacy registration fallback behavior isolated. Canonical cases use the common application; legacy cases retain their safe edit path until separately migrated.
- Do not reintroduce inquiry channel, editable inquiry time, editable phone-ready time, fake operator/time fields, or duplicated request-note storage.
- No production data writes, external provider activation, remote cutover, deploy, or push are authorized by this plan.
- Browser verification must intercept Google Chat, Web Push, SOLAPI, notification worker/connection, legacy notification, and consultation-notification POSTs and finish with zero intercepted provider requests.
- Preserve unrelated working-tree changes. In particular, never stage the untracked `.pnpm-store/` directory.

## File Structure

### New files

- `src/features/tasks/registration-case-list-model.ts` — pure task-to-case projection, view membership, unique-case counts, search, representative-track selection, and stable sorting.
- `src/features/tasks/registration-case-list.tsx` — one desktop/mobile row per application with all subject badges and view-matching per-subject metadata/actions.
- `src/features/tasks/registration-application-model.ts` — fixed section order, status-to-section/action placement, create-mode locks, and section/subject dirty-key helpers.
- `src/features/tasks/registration-application-shell.tsx` — shared create/detail header and six-section frame.
- `src/features/tasks/registration-application-create.tsx` — controlled create-mode composition of the same six-section application.
- `src/features/tasks/registration-application-inquiry-section.tsx` — reusable common inquiry fields, separate subject sync, and inquiry exceptions.
- `src/features/tasks/registration-application-level-test-section.tsx` — shared appointment plus per-subject attempt/results.
- `src/features/tasks/registration-application-consultation-section.tsx` — per-subject director, phone readiness, visit appointment, and inline outcome.
- `src/features/tasks/registration-application-placement-section.tsx` — waiting, enrollment rows, add/cancel/reopen actions, and request-note reference.
- `src/features/tasks/registration-application-admission-section.tsx` — one case-level admission message and batch checklist.
- `src/features/tasks/registration-application-track-actions.tsx` — extracted per-track director, migration, level-test, consultation, waiting, terminal, and inline outcome controls.
- `tests/registration-case-list-model.test.mjs` — pure case-list inclusion/count/search/sort tests.
- `tests/registration-application-model.test.mjs` — exhaustive saved-status matrix, create locks, section order, and dirty-key tests.

### Existing files to modify

- `src/features/tasks/registration-track-model.js` and `registration-track-model.d.ts` — expose the authoritative allowed-action lookup; retain status/view and terminal predicates; remove track-count API after callers move.
- `src/features/tasks/registration-intake-workflow.ts` — reconcile every unsupported initial-route draft when atomic intake capability becomes unavailable.
- `src/features/tasks/registration-initial-plan-control.tsx` — split route, level-test, and consultation field groups so create mode can place them in their real sections.
- `src/features/tasks/registration-track-editor.tsx` — shrink to the canonical saved-application orchestrator; render all tracks through the new section components.
- `src/features/tasks/registration-appointment-editor.tsx` — support embedded section rendering and per-editor dirty reporting.
- `src/features/tasks/registration-enrollment-editor.tsx` — support per-editor dirty reporting and keep admission actions case-scoped.
- `src/features/tasks/registration-history-timeline.tsx` — render as the final application section while remaining read-only.
- `src/features/tasks/ops-task-workspace.tsx` — case-list projection, common create/detail host, create-to-detail rehydration, deep-link focus, and close protection.
- `src/features/tasks/registration-track-fixtures.ts` and `src/features/tasks/registration-track-fixture-runtime.ts` — add only the deterministic cases needed for unique-row, cross-stage, all-terminal, and same-shell browser proof.
- `scripts/verify-ops-task-browser-workflow.mjs` — replace track-row and close-on-create expectations with the approved application workflow and post-interaction safety checks.
- `tests/ops-task-service-loading.test.mjs` — characterize that one loaded parent already owns all subject tracks.
- `tests/registration-track-model.test.mjs`, `registration-track-workspace.test.mjs`, `ops-task-workspace.test.mjs`, `registration-track-service.test.mjs`, `registration-track-fixtures.test.mjs`, `registration-browser-verifier-contract.test.mjs`, `registration-appointment-calendar.test.mjs`, and `ops-task-verification-safety.test.mjs` — replace stale track-centric/source contracts and preserve server/calendar/provider safety.

### File to remove after all callers migrate

- `src/features/tasks/registration-track-list.tsx` — superseded track-per-row adapter and UI.

### Files intentionally unchanged

- Supabase migrations, RPC names, RLS, normalized tables, outbox schemas, worker enablement, and provider configuration.

---

### Task 0: Reconfirm the baseline and freeze the approved boundaries

**Files:**

- Read: `docs/superpowers/specs/2026-07-19-registration-common-application-design.md`
- Read: `src/features/tasks/ops-task-service.ts`
- Read: `src/features/tasks/registration-track-service.ts`
- Test: `tests/registration*.test.mjs`
- Test: `tests/*.test.mjs`

- [ ] Confirm the branch and working tree before implementation.

~~~bash
git status --short --branch
git diff --check
~~~

Expected: the plan/design commits may make `main` ahead of `origin/main`; `.pnpm-store/` may remain untracked; no unexplained tracked edit is overwritten.

- [ ] Run the registration baseline.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration*.test.mjs
~~~

Expected at plan-writing baseline: `507` pass, `0` fail. If concurrent work adds tests, record the new count and require zero failures.

- [ ] Run the complete baseline.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/*.test.mjs
~~~

Expected at plan-writing baseline: `1533` pass, `0` fail. Do not continue from an unexplained regression.

- [ ] Add a short execution note confirming the data boundary: `loadOpsTaskWorkspaceData` returns one `OpsTask` with all `registrationTracks[]`; only the current list adapter introduces duplicate rows.

No commit is required for this read-only checkpoint.

---

### Task 1: Build the pure case-centric list projection

**Files:**

- Create: `src/features/tasks/registration-case-list-model.ts`
- Create: `tests/registration-case-list-model.test.mjs`
- Modify: `tests/ops-task-service-loading.test.mjs`
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `tests/registration-track-model.test.mjs`

- [ ] First extend `createWorkspaceLoaderHarness` with an optional `registrationTrackSummaryFactory(taskIds)`. Set the default to `(taskIds) => taskIds.map((taskId) => registrationSummaryTrack(taskId, "track:" + taskId, "영어", "inquiry"))`, and make the `loadRegistrationTrackSummaries` mock return `tracks: registrationTrackSummaryFactory(taskIds)`. Then add this passing characterization test. Do not change production loading code for it.

~~~js
function registrationSummaryTrack(taskId, id, subject, status) {
  return {
    id,
    taskId,
    subject,
    status,
    legacy: false,
    directorProfileId: null,
    directorName: "",
    directorAssignmentSource: "",
    directorAssignmentRuleKey: "",
    waitingKind: "",
    levelTestRetakeDecision: "",
    migrationReviewRequired: false,
    stageEnteredAt: "2026-07-12T00:00:00Z",
    phoneReadyAt: null,
    phoneReadySource: null,
  }
}

test("registration parent loading preserves one task with every subject track", async () => {
  const harness = createWorkspaceLoaderHarness({
    registrationTrackSummaryFactory: (taskIds) => taskIds.flatMap((taskId) => [
      registrationSummaryTrack(taskId, "eng", "영어", "consultation_waiting"),
      registrationSummaryTrack(taskId, "math", "수학", "level_test_scheduled"),
    ]),
  })
  const load = harness.loadOpsTaskWorkspaceData({
    taskType: "registration",
    viewerId: "viewer-a",
    force: true,
  })
  harness.releaseTasks([{
    id: "case-1",
    type: "registration",
    ops_registration_details: { task_id: "case-1" },
  }])
  const data = await load

  assert.equal(data.tasks.length, 1)
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      data.tasks[0].registrationTracks.map(({ id, subject }) => [id, subject]),
    )),
    [["eng", "영어"], ["math", "수학"]],
  )
  assert.equal(harness.counts.taskQueries, 1)
})
~~~

- [ ] Add failing pure-model tests for all of these rules:

  - one task becomes one case item;
  - one case may appear once in several non-completed views;
  - two subjects in the same view stay in one row and both remain in `matchingTracks`;
  - counts increment once per case per view;
  - `closed` requires at least one track and every track terminal;
  - consultation phone queue precedes visits;
  - valid `phoneReadyAt` sorts ascending, invalid/missing values sort last;
  - the first sorted matching track is the representative;
  - ties use stable `taskId` ordering without mutating input;
  - search matches common student/phone fields, all visible subject labels, and only the selected view's matching director/place fields;
  - normalized phone search ignores spaces and hyphens.

The public contract must be:

~~~ts
export type RegistrationCaseListTrackItem = {
  key: string
  trackId: string
  subject: RegistrationSubject
  status: OpsRegistrationTrackStatus
  viewKey: RegistrationTrackViewKey
  directorProfileId: string | null
  directorName: string
  stageEnteredAt: string
  phoneReadyAt: string | null
  migrationReviewRequired: boolean
  visitScheduledAt: string
  visitPlace: string
  sourceIndex: number
  track: OpsRegistrationTrackSummary
}

export type RegistrationCaseListItem = {
  key: string
  taskId: string
  studentName: string
  sourceIndex: number
  task: OpsTask
  tracks: RegistrationCaseListTrackItem[]
}

export type RegistrationCaseListViewItem = RegistrationCaseListItem & {
  viewKey: RegistrationTrackViewKey
  matchingTracks: RegistrationCaseListTrackItem[]
  representativeTrack: RegistrationCaseListTrackItem
  representativeSortValue: string
}

export function buildRegistrationCaseListItems(
  tasks: readonly OpsTask[],
): RegistrationCaseListItem[]

export function getRegistrationCaseMatchedTracks(
  item: RegistrationCaseListItem,
  viewKey: RegistrationTrackViewKey,
): RegistrationCaseListTrackItem[]

export function getRegistrationCaseTabCounts(
  items: readonly RegistrationCaseListItem[],
): Record<RegistrationTrackViewKey, number>

export function filterRegistrationCaseListItems(
  items: readonly RegistrationCaseListItem[],
  viewKey: RegistrationTrackViewKey,
  query?: string,
): RegistrationCaseListViewItem[]

export function getRegistrationCaseTrackTimeValue(
  track: Pick<
    RegistrationCaseListTrackItem,
    "status" | "stageEnteredAt" | "phoneReadyAt" | "visitScheduledAt"
  >,
): string
~~~

- [ ] Run the new model test and confirm it fails with `ERR_MODULE_NOT_FOUND`.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-case-list-model.test.mjs
~~~

- [ ] Implement the projection. For non-closed views, return tracks whose derived view matches. For `closed`, return every track only when `tracks.length > 0 && tracks.every(isRegistrationTrackTerminal)`. Derive counts by case, never by flattening tracks. Preserve parent/source order for non-consultation views; within a case preserve track source order and use `taskId` only as the stable tie-break. Consultation alone keeps phone-before-visit and readiness-time sorting.

- [ ] Export `RegistrationTrackAction` from `registration-track-model.d.ts` and declare `getAllowedRegistrationTrackActions(status?: RegistrationTrackStatus | null): readonly RegistrationTrackAction[]`. Implement it as `Array.from(ALLOWED_ACTIONS_BY_STATUS[status] || [])` so every call returns a fresh array and callers cannot mutate the authoritative sets. UI models may place these actions but must not duplicate the matrix.

- [ ] Leave `getRegistrationTrackTabCounts(tracks)` temporarily intact in this task because the workspace still imports it. Its stale tests and export are removed atomically with the caller migration in Task 2.

- [ ] Run the focused model/service packet.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-case-list-model.test.mjs tests/registration-track-model.test.mjs tests/ops-task-service-loading.test.mjs
~~~

Expected: all tests pass; the service characterization uses no new query or RPC.

- [ ] Commit the pure projection.

~~~bash
git add src/features/tasks/registration-case-list-model.ts src/features/tasks/registration-track-model.js src/features/tasks/registration-track-model.d.ts tests/registration-case-list-model.test.mjs tests/registration-track-model.test.mjs tests/ops-task-service-loading.test.mjs
git diff --cached --check
git commit -m "refactor: group registration lists by case"
~~~

---

### Task 2: Replace track rows with one application row per view

**Files:**

- Create: `src/features/tasks/registration-case-list.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-track-model.test.mjs`
- Modify: `tests/registration-track-fixtures.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Remove: `src/features/tasks/registration-track-list.tsx`

- [ ] Add failing UI/source-contract tests for a case row that renders:

  - the student identity once;
  - every subject status badge from `item.tracks`;
  - each current-view subject's director and time from `item.matchingTracks`;
  - one case-level open/edit affordance using the representative track only as initial focus;
  - subject-labelled quick actions such as `영어 전화상담 완료`;
  - one DOM row/card keyed by `taskId` on desktop and mobile;
  - an initial limit of 40 cases, not 40 tracks.

Use this callback boundary:

~~~ts
export type RegistrationCaseListAction = "complete_consultation"

export type RegistrationCaseListProps = {
  items: RegistrationCaseListViewItem[]
  viewerId?: string | null
  viewerRole?: "admin" | "staff" | "assistant" | "teacher" | null
  loading?: boolean
  emptyLabel?: string
  disabled?: boolean
  onOpen: (taskId: string, preferredTrackId: string) => void
  onEdit: (taskId: string, preferredTrackId: string) => void
  onAction: (
    taskId: string,
    trackId: string,
    action: RegistrationCaseListAction,
  ) => void
}
~~~

- [ ] Run the focused UI/source tests before creating the component and confirm failure because `registration-case-list.tsx`/`RegistrationCaseList` is missing and the workspace still mounts track rows.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-track-workspace.test.mjs tests/registration-track-fixtures.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Implement `RegistrationCaseList` and `RegistrationCaseListRow`. Keep list permission checks as display hints only; `handleRegistrationTrackAction` must still reload detail and perform the authoritative ownership/permission check.

- [ ] Replace workspace memos with the case projection.

~~~ts
const registrationCaseItems = useMemo(
  () => buildRegistrationCaseListItems(scopedTasks),
  [scopedTasks],
)

const registrationCounts = useMemo(
  () => getRegistrationCaseTabCounts(registrationCaseItems),
  [registrationCaseItems],
)

const visibleRegistrationCaseItems = useMemo(
  () => filterRegistrationCaseListItems(
    registrationCaseItems,
    registrationView,
    deferredQuery,
  ),
  [deferredQuery, registrationCaseItems, registrationView],
)
~~~

- [ ] Keep `openRegistrationTrack(taskId, preferredTrackId)`, `editRegistrationTrack`, `handleRegistrationTrackAction`, and legacy fallback routing. Change `visibleWorkspaceItemCount` to the number of visible cases.

- [ ] Delete `registration-track-list.tsx` only after every import and source-contract fixture has moved. At the same point remove `getRegistrationTrackTabCounts` from `registration-track-model.js/.d.ts` and replace its track-count test with the case-count contract from Task 1. Search for stale names.

- [ ] In `registration-track-fixtures.test.mjs`, replace the source contract that requires `<RegistrationTrackList` with `<RegistrationCaseList` in this same commit; do not defer the renamed consumer assertion to Task 8.

~~~bash
rg -n "registration-track-list|registrationTrackItems|getRegistrationTrackTabCounts|과목별 등록 업무 목록" src tests
~~~

Expected: no production caller or stale track-row assertion remains.

- [ ] Run the case-list integration packet.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-case-list-model.test.mjs tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs tests/registration-track-fixtures.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Commit the list UI migration.

~~~bash
git add src/features/tasks/registration-case-list.tsx src/features/tasks/ops-task-workspace.tsx src/features/tasks/registration-track-list.tsx src/features/tasks/registration-track-model.js src/features/tasks/registration-track-model.d.ts tests/registration-track-workspace.test.mjs tests/registration-track-model.test.mjs tests/registration-track-fixtures.test.mjs tests/ops-task-workspace.test.mjs
git diff --cached --check
git commit -m "feat: show one row per registration case"
~~~

---

### Task 3: Define the six-section application state and shared shell

**Files:**

- Create: `src/features/tasks/registration-application-model.ts`
- Create: `src/features/tasks/registration-application-shell.tsx`
- Create: `src/features/tasks/registration-application-inquiry-section.tsx`
- Create: `tests/registration-application-model.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

- [ ] Write a failing exhaustive table test for every saved track status.

~~~js
function makeTrack(status, subject = "영어") {
  return {
    id: `track-${subject}-${status}`,
    taskId: "case-1",
    subject,
    status,
    legacy: false,
    directorProfileId: "director-1",
    directorName: "영어 원장",
    directorAssignmentSource: "default",
    directorAssignmentRuleKey: "fixture",
    waitingKind: "",
    levelTestRetakeDecision: "",
    migrationReviewRequired: status === "migration_review",
    stageEnteredAt: "2026-07-12T00:00:00Z",
    phoneReadyAt: null,
    phoneReadySource: null,
  }
}

const cases = [
  ["inquiry", "inquiry"],
  ["migration_review", "inquiry"],
  ["level_test_scheduled", "level_test"],
  ["level_test_in_progress", "level_test"],
  ["consultation_waiting", "consultation"],
  ["visit_consultation_scheduled", "consultation"],
  ["waiting", "placement"],
  ["enrollment_decided", "placement"],
  ["enrollment_processing", "admission"],
  ["registered", "placement"],
  ["not_registered", "placement"],
  ["inquiry_closed", "inquiry"],
]

for (const [status, currentSection] of cases) {
  assert.equal(
    getRegistrationApplicationTrackState({
      track: makeTrack(status),
      canManage: true,
      canCompleteConsultation: false,
    }).currentSection,
    currentSection,
  )
}
~~~

- [ ] Add tests that:

  - lock all mutations for a viewer without permission while retaining values;
  - expose only migration resolution in inquiry for `migration_review`;
  - place terminal reopen/add/cancel actions in the approved sections;
  - keep history visible/read-only for every status;
  - derive actions from `getAllowedRegistrationTrackActions`;
  - give create mode visible locked states for every future section;
  - aggregate a mixed English/mathematics case so `current` is any-track, while `editable` does not unlock a disabled sibling;
  - add/remove one dirty key without clearing another section or subject.

- [ ] Run the new model test before implementation and confirm `ERR_MODULE_NOT_FOUND` for `registration-application-model.ts`.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-application-model.test.mjs
~~~

- [ ] Fix action ownership separately from action permission. `getAllowedRegistrationTrackActions(status)` supplies the authoritative allowed set; the application model maps each returned action to its visible owner section:

~~~ts
export const REGISTRATION_ACTION_SECTION = {
  schedule_level_test: "level_test",
  route_consultation: "consultation",
  route_waiting: "placement",
  close_inquiry: "inquiry",
  resolve_migration_review: "inquiry",
  start_level_test: "level_test",
  record_level_test_result: "level_test",
  cancel_level_test: "level_test",
  complete_phone_consultation: "consultation",
  schedule_visit: "consultation",
  complete_visit_consultation: "consultation",
  cancel_visit: "consultation",
  change_waiting_kind: "placement",
  record_retest_required: "placement",
  move_to_enrollment: "placement",
  close_not_registered: "placement",
  start_enrollment_processing: "placement",
  complete_enrollment: "admission",
  cancel_admission_batch: "admission",
  start_add_class: "placement",
  cancel_enrollment: "placement",
  reopen_track: "inquiry",
} as const satisfies Record<
  RegistrationTrackAction,
  RegistrationApplicationSectionKey
>
~~~

`reopen_track` for `not_registered` is overridden to placement from track status; `inquiry_closed` keeps inquiry. Tests must pin both exceptions. This location map must never decide whether an action is permitted.

The model contract must include:

~~~ts
export const REGISTRATION_APPLICATION_SECTION_ORDER = [
  "inquiry",
  "level_test",
  "consultation",
  "placement",
  "admission",
  "history",
] as const

export type RegistrationApplicationSectionKey =
  (typeof REGISTRATION_APPLICATION_SECTION_ORDER)[number]

export type RegistrationApplicationDirtyKey =
  `${RegistrationApplicationSectionKey}:${string}`

export type RegistrationApplicationSectionState = {
  current: boolean
  editable: boolean
  lockReason: string
}

export type RegistrationApplicationTrackSectionState =
  RegistrationApplicationSectionState & {
    actions: readonly RegistrationTrackAction[]
  }

export function getRegistrationApplicationTrackState(input: {
  track: OpsRegistrationTrackSummary
  canManage: boolean
  canCompleteConsultation: boolean
}): {
  trackId: string
  subject: RegistrationSubject
  currentSection: RegistrationApplicationSectionKey
  sections: Record<
    RegistrationApplicationSectionKey,
    RegistrationApplicationTrackSectionState
  >
}

export function getRegistrationCreateSectionStates(input: {
  subjects: RegistrationSubject[]
  draft: RegistrationInitialWorkflowDraft
  writable: boolean
}): Record<RegistrationApplicationSectionKey, RegistrationApplicationSectionState>

export function getRegistrationApplicationSectionStates(input: {
  tracks: readonly ReturnType<typeof getRegistrationApplicationTrackState>[]
  caseEditableSections?: readonly RegistrationApplicationSectionKey[]
}): Record<RegistrationApplicationSectionKey, RegistrationApplicationSectionState>

export function updateRegistrationApplicationDirtyKeys(
  current: ReadonlySet<RegistrationApplicationDirtyKey>,
  key: RegistrationApplicationDirtyKey,
  dirty: boolean,
): Set<RegistrationApplicationDirtyKey>
~~~

- [ ] Implement the pure matrix without importing React or Supabase, then rerun the same model command and require it to pass.

- [ ] Build `RegistrationApplicationShell` with a minimal header: student name, all subject status badges, and the host's close affordance. Render six named slots exactly once in fixed DOM order. A section receives `editable` and `lockReason`; the shell derives disabled/`aria-disabled` state but never omits the section.

~~~ts
export type RegistrationApplicationShellProps = {
  mode: "create" | "detail"
  studentName: string
  tracks: Array<{
    key: string
    subject: RegistrationSubject
    statusLabel: string
  }>
  sectionStates: Record<
    RegistrationApplicationSectionKey,
    RegistrationApplicationSectionState
  >
  inquiry: ReactNode
  levelTest: ReactNode
  consultation: ReactNode
  placement: ReactNode
  admission: ReactNode
  history: ReactNode
}
~~~

- [ ] Build the shared inquiry section. `inquiryAt` is read-only; create mode displays `저장 시 자동 기록` and detail displays the server value. Keep common-info save separate from subject sync and include a named `exceptionContent` slot for migration/reopen actions.

- [ ] Add shell-level source/render contracts proving all titles appear in fixed order exactly once and no internal stage tabs or previous/next controls exist. Do not require create/detail consumers yet; create adopts the shell in Task 4 and detail adopts it in Task 5.

- [ ] Run the model and source-contract tests.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs
~~~

- [ ] Commit the shared application foundation.

~~~bash
git add src/features/tasks/registration-application-model.ts src/features/tasks/registration-application-shell.tsx src/features/tasks/registration-application-inquiry-section.tsx tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs
git diff --cached --check
git commit -m "feat: add registration application shell"
~~~

---

### Task 4: Render create mode as the same cumulative application

**Files:**

- Create: `src/features/tasks/registration-application-create.tsx`
- Create: `src/features/tasks/registration-application-level-test-section.tsx`
- Create: `src/features/tasks/registration-application-consultation-section.tsx`
- Create: `src/features/tasks/registration-application-placement-section.tsx`
- Create: `src/features/tasks/registration-application-admission-section.tsx`
- Modify: `src/features/tasks/registration-intake-workflow.ts`
- Modify: `src/features/tasks/registration-initial-plan-control.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/registration-intake-workflow.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

- [ ] Keep `RegistrationApplicationCreate` controlled by workspace state; it must not own persistence or create a second copy of the intake draft.

- [ ] Add failing source-contract tests proving that `등록 추가` renders the shared shell and all six sections immediately. Reverse the stale assertions that placement/admission must be absent.

The tests must require:

  - inquiry renders, in order, subject composition, student name, grade, school, parent phone, student phone, request note, and `문의일시`; editable inquiry fields are enabled and inquiry time is read-only as `저장 시 자동 기록`;
  - in `ready_atomic` mode, initial action choices are exactly `문의 유지`, `바로 전화상담`, `레벨테스트`, `방문상담`;
  - level-test and consultation field names visible even before their routes are chosen;
  - placement fields and admission checklist labels visible but locked;
  - history visible with `첫 저장 후 자동 기록됩니다` and no mutation controls;
  - one lock-reason line per locked section;
  - no `문의 채널`;
  - no nested form element inside the outer create form.

- [ ] Run the create/intake source packet before implementation and confirm it fails because create does not yet mount the common shell/future sections and initial-route capability reconciliation does not exist.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-intake-workflow.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Split `RegistrationInitialPlanControl` into section-owned exports while preserving the existing draft helpers and validation:

~~~ts
import type { JSX } from "react"

export type RegistrationInitialRouteFieldsProps =
  RegistrationInitialPlanControlProps & {
    allowedInitialActions: readonly RegistrationInitialAction[]
  }

export function RegistrationInitialRouteFields(
  props: RegistrationInitialRouteFieldsProps,
): JSX.Element

export function RegistrationInitialLevelTestFields(
  props: RegistrationInitialPlanControlProps,
): JSX.Element

export function RegistrationInitialConsultationFields(
  props: RegistrationInitialPlanControlProps,
): JSX.Element
~~~

`RegistrationInitialRouteFields` belongs in inquiry. The level-test export owns shared schedule/place plus participant badges. The consultation export owns per-subject director fields, shared visit schedule/place, and participant badges. Do not render an editable phone-ready timestamp.

Keep the operational field order literal: consultation renders `상담 책임자 → 전화상담 대기 기준일시 → 방문상담일시 → 방문상담실 → 상담 결과`. Other new groups follow the available `누가 → 언제 → 어디서 → 무엇을 → 어떻게` values without inventing operator, time, or place fields.

- [ ] Implement the four remaining section components as reusable frames. In create mode they accept visible field/empty-state content and lock state; mutation callbacks may be omitted. Keep DOM and visual order aligned, with at most two columns on desktop and one on mobile.

- [ ] Extract the registration create branch from `TypeSpecificFields` into `RegistrationApplicationCreate`. Its controlled boundary should use the existing `OpsTaskInput`, `RegistrationInitialWorkflowDraft`, director options/resolutions, and update callbacks rather than defining a second draft shape:

~~~ts
export type RegistrationApplicationCreateProps = {
  form: OpsTaskInput
  draft: RegistrationInitialWorkflowDraft
  persistence: RegistrationInitialPersistenceProbeResult
  resolvedDirectorIds: Partial<Record<RegistrationSubject, string>>
  directorOptionsBySubject: Record<
    RegistrationSubject,
    Array<{ value: string; label: string }>
  >
  disabled: boolean
  onFormPatch: (patch: Partial<OpsTaskInput>) => void
  onRegistrationFieldChange: (
    key: keyof NonNullable<OpsTaskInput["registration"]>,
    value: string | boolean,
  ) => void
  onDraftChange: (draft: RegistrationInitialWorkflowDraft) => void
}
~~~

- [ ] Use `getRegistrationCreateSectionStates` to lock fields, but always render titles and field names. Route choice must only change editability and participant badges; it must not mount/unmount the section.

- [ ] Require `RegistrationApplicationCreate` to import `RegistrationApplicationShell` and `RegistrationApplicationInquirySection` directly. The Task 4 source contract covers create only; the shared create/detail contract becomes green after Task 5.

- [ ] Pass `allowedInitialActions={persistence.mode === "ready_atomic" ? ["inquiry", "direct_phone", "level_test", "visit"] : ["inquiry"]}` from `RegistrationApplicationCreate`. `RegistrationInitialRouteFields` renders only those route choices; fallback still renders level-test/consultation field names as locked future fields.

- [ ] Add a pure `reconcileRegistrationInitialWorkflowCapabilities(draft, allowedInitialActions)` helper. Convert every subject plan not in the allowed set to `inquiry`; remove those subjects' director overrides; clear shared level-test schedule/place when no allowed level-test participant remains; and clear shared visit schedule/place when no allowed visit participant remains. Reconcile in an effect on capability change, never during render.

- [ ] Add tests for all four ready-atomic choices, inquiry-only canonical/legacy fallback, and a `ready_atomic → fallback` transition containing direct-phone, level-test, and visit drafts. The fallback submit payload must contain only inquiry plans, no initial appointment, and no stale director override.

- [ ] Keep the current outer create submit, blocker focus, atomic normalization, and request-key logic. Update blocker focus selectors to target the actual section IDs in the common shell.

- [ ] Run intake/create/application tests.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-intake-workflow.test.mjs tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Commit the cumulative create UI.

~~~bash
git add src/features/tasks/registration-application-create.tsx src/features/tasks/registration-application-level-test-section.tsx src/features/tasks/registration-application-consultation-section.tsx src/features/tasks/registration-application-placement-section.tsx src/features/tasks/registration-application-admission-section.tsx src/features/tasks/registration-intake-workflow.ts src/features/tasks/registration-initial-plan-control.tsx src/features/tasks/ops-task-workspace.tsx tests/registration-intake-workflow.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
git diff --cached --check
git commit -m "feat: render registration create as one application"
~~~

---

### Task 5: Recompose saved detail around all subject tracks

**Files:**

- Create: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-application-inquiry-section.tsx`
- Modify: `src/features/tasks/registration-application-level-test-section.tsx`
- Modify: `src/features/tasks/registration-application-consultation-section.tsx`
- Modify: `src/features/tasks/registration-application-placement-section.tsx`
- Modify: `src/features/tasks/registration-application-admission-section.tsx`
- Modify: `src/features/tasks/registration-history-timeline.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-track-fixtures.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

- [ ] Replace the stale source-contract test `overview is read-only and the selected subject owns the only action surface` with an executable contract that two tracks at different statuses expose both current sections and actions in the same application.

- [ ] Run the canonical detail source packet before implementation and confirm failure on the old selected-track-only editor, outside appointment/current-work surfaces, and old fixture component name.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-track-workspace.test.mjs tests/registration-track-fixtures.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Rename the exported semantic component to `RegistrationApplication` while keeping it in `registration-track-editor.tsx` for an incremental, reviewable migration. Update the workspace import. Do not carry a permanent compatibility alias once all production/test callers move.

Its orchestration boundary should be:

~~~ts
export type RegistrationApplicationProps = {
  task: OpsTask
  detail: OpsRegistrationCaseDetail
  focusTrackId: string | null
  viewerId: string | null
  viewerRole: RegistrationTrackViewerRole
  onFocusTrack: (trackId: string) => void
  onReload: (preferredTrackId?: string) => void | Promise<void>
  onWarning: (message: string) => void
  onAppointmentSaved?: (
    saved: RegistrationAppointmentMutationResponse,
  ) => void | Promise<void>
  profiles?: OpsProfileOption[]
  directorOptions?: OpsProfileOption[]
  teacherOptions?: OpsTeacherOption[]
  directorCatalogStatus?: RegistrationDirectorCatalogStatus
  onRetryDirectorCatalog?: () => boolean | Promise<boolean>
  classOptions?: OpsClassOption[]
  textbookOptions?: OpsTextbookOption[]
  admissionActions: Pick<
    RegistrationAdmissionPanelProps,
    | "onSendAdmissionMessage"
    | "onCheckAdmissionMessage"
    | "onReconcileAdmissionMessage"
    | "onReleaseAdmissionMessageRetry"
  >
  initialAppointmentId?: string | null
  onAppointmentOpenChange?: (appointmentId: string | null) => void
  onDirtyChange?: (dirty: boolean) => void
  notificationToken?: string
}
~~~

Remove `caseLevelActions` and consultation-dialog open props; admission and consultation become structured inline section behavior.

- [ ] Extract the existing private director, migration-review, inquiry-route, level-test, consultation, waiting, and terminal controls into `registration-application-track-actions.tsx`. Each exported editor receives one explicit `track` plus the detail/options/callbacks it already needs; none may own subject selection or hide sibling tracks.

- [ ] In that actions file, convert `RegistrationConsultationOutcomeDialog` to `RegistrationConsultationOutcomeEditor` without `Dialog`/`DialogContent` and place it in consultation. Preserve its request key, revision, validation, duplicate-submit, and post-commit reload behavior; Task 6 adds dirty reporting and recovery refinements.

- [ ] Add `embedded?: boolean` to `RegistrationAppointmentEditor` in this task and use it under level test or consultation. Embedded mode changes only surrounding chrome; appointment ID, participant, revision, notification-target, and retry contracts stay intact. Task 6 adds `onDirtyChange`.

- [ ] Compute `getRegistrationApplicationTrackState` for every `detail.tracks` entry. `focusTrackId` may add `data-registration-focus-track`, scroll, or emphasis, but every track must be rendered in every relevant section regardless of focus.

- [ ] Aggregate only shell emphasis, not subject permissions: a section is current when any track's current section matches; it is globally locked only when no track and no case-level action is editable. Mixed sections keep each track's own disabled state and lock reason so one editable subject never unlocks its sibling.

Pass `admission` in `caseEditableSections` when the case-level message is eligible or an admission batch has an allowed current action, even if every track's current section is placement.

- [ ] Move common editing and subject sync into inquiry. Common info editability derives from case-level management/identity rules, not the focused track's status. Keep the two saves independent. Add tests that terminal subject states do not disable permitted common edits, and that a progressed subject cannot be removed through sync or accidentally changed by a common-info save.

- [ ] Render every track's status/value summary in all workflow sections. For a field without a value, show the named empty field. For a future section, disable its controls and show the model's lock reason instead of omitting it.

- [ ] Move the active level-test or visit appointment editor under its owning section. Shared appointments render once with participant badges; they must not duplicate per track.

- [ ] Move waiting, repeated enrollment rows, registered add-class, cancellation, and `not_registered` reopen into placement. Render request note as a read-only reference to the inquiry value.

- [ ] Render `RegistrationAdmissionPanel` once per case in admission, not once per track. The message action uses all eligible `enrollment_decided` subjects as badges and remains available without saved enrollment rows. Add a two-decided-track test that finds exactly one send action and two subject badges. Batch steps 2–5 remain row/batch gated.

- [ ] Move `RegistrationHistoryTimeline` into the sixth section. Keep reverse chronological order and stage/subject filters if useful, but source-contract tests must find no add/edit/delete history callbacks or controls; actor, time, subject, stage, and result come from server events.

- [ ] Remove the separate `현재 업무` card, selected-stage router, outside-application appointment editor, and old overview-only application summaries. Keep status badges in the header and each subject section.

- [ ] Add the final shared-consumer contract: both `RegistrationApplicationCreate` and `RegistrationApplication` import the same shell/inquiry primitives, render the six titles in the same DOM order, and do not create nested workflow dialogs.

- [ ] In `registration-track-fixtures.test.mjs`, replace the source contract that requires `<RegistrationTrackEditor` with `<RegistrationApplication` in this same commit.

- [ ] Add exception-placement source contracts:

  - migration review and `inquiry_closed` reopen are descendants of inquiry;
  - `not_registered` reopen, registered add-class, and enrollment cancellation are descendants of placement;
  - admission-batch cancel/follow-up is a descendant of admission.

- [ ] Run the canonical detail packet.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs tests/registration-track-fixtures.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Commit the saved application recomposition.

~~~bash
git add src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-appointment-editor.tsx src/features/tasks/registration-application-inquiry-section.tsx src/features/tasks/registration-application-level-test-section.tsx src/features/tasks/registration-application-consultation-section.tsx src/features/tasks/registration-application-placement-section.tsx src/features/tasks/registration-application-admission-section.tsx src/features/tasks/registration-history-timeline.tsx src/features/tasks/ops-task-workspace.tsx tests/registration-track-workspace.test.mjs tests/registration-track-fixtures.test.mjs tests/ops-task-workspace.test.mjs
git diff --cached --check
git commit -m "feat: unify registration detail sections"
~~~

---

### Task 6: Make section mutations inline, independent, and recoverable

**Files:**

- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-enrollment-editor.tsx`
- Modify: `src/features/tasks/registration-application-model.ts`
- Modify: `src/features/tasks/registration-application-inquiry-section.tsx`
- Modify: `src/features/tasks/registration-application-level-test-section.tsx`
- Modify: `src/features/tasks/registration-application-consultation-section.tsx`
- Modify: `src/features/tasks/registration-application-placement-section.tsx`
- Modify: `src/features/tasks/registration-application-admission-section.tsx`
- Modify: `tests/registration-application-model.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-track-service.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Verify: `tests/registration-consultation-notification.test.mjs`
- Verify: `tests/registration-admission-message-route.test.mjs`

- [ ] Before production edits, write failing tests for:

  - dirty reporting from inquiry common/subjects, appointment, per-track level/consultation/waiting editors, track-level enrollment drafts, admission evidence, and batch-cancel drafts;
  - one dirty key changing without clearing another;
  - an unsaved inquiry draft surviving a consultation save plus canonical detail reload;
  - Korean section errors and first-invalid-field focus;
  - affected-section-only option failure plus retry;
  - revision conflict attempted/latest value display;
  - subject-qualified accessible names, non-color state semantics, and input-before-primary-action DOM order.

- [ ] Run the mutation packet before implementation and confirm the new contracts fail on missing dirty callbacks, sibling-draft reset, and missing localized/accessibility behavior.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs tests/registration-track-service.test.mjs
~~~

- [ ] Add dirty reporting to the inline `RegistrationConsultationOutcomeEditor` in `registration-application-track-actions.tsx` established in Task 5:

~~~ts
import type { JSX } from "react"

export type RegistrationConsultationOutcomeEditorProps = {
  subject: RegistrationSubject
  consultation: OpsRegistrationConsultation
  active: boolean
  classOptions: OpsClassOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onDirtyChange?: (dirty: boolean) => void
}

export function RegistrationConsultationOutcomeEditor(
  props: RegistrationConsultationOutcomeEditorProps,
): JSX.Element
~~~

Confirm it still has no `Dialog`, `DialogContent`, or `onOpenChange` dependency. Preserve the existing request key, revision arguments, validation focus, duplicate-submit prevention, and commit-success/detail-refresh-failure retry/lock contract; do not invent a consultation reconciliation API.

- [ ] Add `onDirtyChange?: (dirty: boolean) => void` to every extracted per-track editor that owns local input: director, migration resolution, inquiry routing, level-test action/result, consultation/outcome, waiting, and terminal reopen/cancel. Map each producer to its real owner key: `inquiry:track-track123`, `level_test:track-track123`, `consultation:track-track123`, or `placement:track-track123`.

- [ ] Add `onDirtyChange?: (dirty: boolean) => void` to the embedded `RegistrationAppointmentEditor` established in Task 5. Use `level_test:appointment-id123` / `level_test:appointment-new` for level tests and `consultation:appointment-id123` / `consultation:appointment-new` for visits. It does not weaken appointment-ID/revision checks or notification retry behavior.

- [ ] Add aggregate `onDirtyChange?: (dirty: boolean) => void` to `RegistrationEnrollmentEditor`. The component owns all draft enrollment rows for one track and reports one key such as `placement:enrollments-track123` using the real track ID; a successful batch save clears that track key only.

- [ ] Add `onDirtyChange?: (scope: "common" | "subjects", dirty: boolean) => void` to `RegistrationApplicationInquirySection`. Add `onDirtyChange?: (scope: { kind: "message_evidence" } | { kind: "batch"; batchId: string }, dirty: boolean) => void` to `RegistrationAdmissionPanel`; message scope includes provider evidence/reason, and batch scope includes selected enrollment row IDs, cancel destination, and cancel reason.

- [ ] Give the application orchestrator a `Set<RegistrationApplicationDirtyKey>`. Use stable aggregates: `inquiry:common`, `inquiry:subjects`, `inquiry:track-track123`, both section-specific appointment forms above, `level_test:track-track123`, `consultation:track-track123`, `placement:track-track123`, `placement:enrollments-track123`, `admission:message`, and `admission:batch-batch123`. Each editor adds/removes only its own key; application-level `onDirtyChange` reports whether the set is non-empty.

- [ ] Preserve sibling drafts across a section save/reload. Do not key/remount editors by the whole `detail` object or `focusTrackId`. Each editor resets local state only when its own canonical entity identity/revision key changes; a sibling's unchanged key retains its visible draft and dirty membership.

- [ ] Make the prewritten integration contract green: edit inquiry without saving, edit and save consultation, accept the canonical detail reload, and retain the inquiry draft plus `inquiry:common` key. Then save inquiry and clear only that key. Make the no-op dirty-membership model contract green as well.

- [ ] Report aggregate dirty state to the host but defer the actual dialog-close guard to Task 7. A successful server commit followed by failed canonical reload is not unsaved input: clear that editor's dirty key, enter a mutation lock for the affected section, show `저장은 완료됐지만 최신 내용을 불러오지 못했습니다`, and allow only `최신 내용 다시 불러오기`. Never replay the mutation automatically.

- [ ] Keep errors local to the section that owns the mutation and focus its first invalid field. Catalog/options failure locks only affected selectors and exposes the existing retry; it must not disable unrelated editable sections.

- [ ] Implement the error and accessibility behavior required by the prewritten contracts:

  - a section validation failure renders a Korean `role="alert"` and focuses the first invalid control in that same section;
  - an option/catalog failure disables only the affected selectors, keeps other sections editable, and exposes `다시 불러오기`;
  - a revision conflict reloads canonical values and shows the user's attempted value beside the latest value before another save;
  - every subject-owned input/button accessible name includes `영어` or `수학`;
  - empty, locked, current, saved, and failed states have text/icon semantics rather than color alone;
  - DOM order places each mobile primary action after its owned inputs.

- [ ] Preserve the authoritative transition and service packet. Add/retain tests for:

  - atomic create request-key idempotency;
  - track mutation revision conflicts;
  - appointment ID plus notification revision;
  - post-commit notification failures not replaying the database mutation;
  - case-level admission unknown/failed-hold confirmation/reconciliation;
  - scoped cache invalidation and canonical reload.

- [ ] Search for nested/stale mutation surfaces.

~~~bash
! rg -n "RegistrationConsultationOutcomeDialog|caseLevelActions|consultationOutcomeOpen|selectedStageEditor|현재 업무" src/features/tasks
~~~

Expected: command exits `0` because no production occurrence remains; negative test strings are intentionally outside this gate.

- [ ] Run the mutation packet.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-model.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs tests/registration-consultation-notification.test.mjs tests/registration-admission-message-route.test.mjs
~~~

- [ ] Commit inline, section-scoped mutation behavior.

~~~bash
git add src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-appointment-editor.tsx src/features/tasks/registration-enrollment-editor.tsx src/features/tasks/registration-application-model.ts src/features/tasks/registration-application-inquiry-section.tsx src/features/tasks/registration-application-level-test-section.tsx src/features/tasks/registration-application-consultation-section.tsx src/features/tasks/registration-application-placement-section.tsx src/features/tasks/registration-application-admission-section.tsx tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs tests/registration-track-service.test.mjs tests/ops-task-workspace.test.mjs
git diff --cached --check
git commit -m "refactor: keep registration edits in their sections"
~~~

---

### Task 7: Keep the same dialog open across atomic create and canonical detail

**Files:**

- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

- [ ] Add failing tests for one registration-only dialog host. General, transfer, withdrawal, makeup, and other task dialogs must retain their current behavior.

Use an explicit host state:

~~~ts
type RegistrationApplicationHostState =
  | { kind: "closed" }
  | { kind: "create" }
  | {
      kind: "loading_detail"
      taskId: string
      focusTrackId: string | null
      appointmentId: string | null
    }
  | {
      kind: "detail"
      taskId: string
      focusTrackId: string | null
      appointmentId: string | null
    }
  | {
      kind: "refresh_failed"
      taskId: string
      focusTrackId: string | null
      appointmentId: string | null
      message: string
    }
~~~

- [ ] Run the host source packet before implementation and confirm the new atomic/canonical tests fail because registration still uses separate create/detail dialogs and closes after save.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Render one `Dialog` with `data-registration-application-host` and `data-registration-application-mode` for registration create/loading/detail/refresh-failed modes. Exclude canonical registration from the generic form/detail dialogs so two dialogs can never be mounted for the same application.

- [ ] Route `등록 추가` to `{ kind: "create" }`. Route case rows and calendar items to the same host with `taskId` plus focus identifiers. Keep legacy-track opening on its current safe fallback.

- [ ] Refactor the successful canonical/atomic create branches to capture a common `{ taskId, tracks }` committed receipt before generic form cleanup. Immediately clear `registrationCreateAttemptRef` after either server commit so a detail-refresh retry cannot replay create.

- [ ] Add one `rehydrateCommittedRegistrationCase({ taskId, tracks })` helper that transitions the existing host to `loading_detail`, calls `loadRegistrationCaseForWorkspace(taskId, true)`, and applies the canonical detail. The atomic branch dispatches its `response.notificationTargets` and then calls this helper; the canonical inquiry-only branch has no notification-target field and calls the helper directly.

~~~ts
const focusTrackId = detail.tracks.find(
  (track) => committed.tracks.some((created) => created.id === track.id),
)?.id ?? detail.tracks[0]?.id ?? null

setRegistrationCaseDetail(detail)
setSelectedTask({ ...detail.task, registrationTracks: detail.tracks })
setSelectedRegistrationTrackId(focusTrackId)
setSelectedRegistrationAppointmentId(null)
setRegistrationApplicationHost({
  kind: "detail",
  taskId: detail.task.id,
  focusTrackId,
  appointmentId: null,
})
syncTaskDeepLink(detail.task.id, focusTrackId)
~~~

The same dialog node remains open; only its mode/content changes. Reset the create baseline and disable the old submit path before loading starts.

Notification delivery/audit warnings remain post-commit notices and failed targets remain explicit retries; neither may close the host, roll back the case, replay create, or prevent canonical detail loading.

- [ ] On post-commit detail-load failure, keep the same host in `refresh_failed` with the committed `taskId` and message `저장은 완료됐지만 최신 내용을 불러오지 못했습니다`. Render only `최신 내용 다시 불러오기` plus close. Retry `loadRegistrationCaseForWorkspace`; never call a create RPC or reuse the create request key.

- [ ] Preserve legacy/capability fallback: a truly legacy writer may use the existing close-and-notice path because it has no canonical case detail. Do not pretend it is a canonical six-section record.

- [ ] Update list/calendar deep links:

  - `taskId` identifies the document;
  - `trackId` focuses a subject section without hiding siblings;
  - `appointmentId` focuses the owning level-test/consultation section;
  - closing clears all three and host/detail state;
  - browser back/reopen resolves the same application.

- [ ] Apply dirty-close confirmation to the host. Closing create mode uses the outer form baseline; closing detail uses application dirty keys. Loading/refresh-failed modes do not warn about already committed server data.

- [ ] Make the separate atomic-writer and canonical-inquiry-writer tests green. Both reject `setFormOpen(false)` as their success action and pass the committed task ID/tracks to the shared rehydrate helper; only the atomic test expects notification-target dispatch.

- [ ] Run the host/create/detail packet.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-intake-workflow.test.mjs tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Commit the same-dialog handoff.

~~~bash
git add src/features/tasks/ops-task-workspace.tsx src/features/tasks/registration-track-editor.tsx tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
git diff --cached --check
git commit -m "feat: keep registration application open after save"
~~~

---

### Task 8: Upgrade fixtures and browser verification for the whole application

**Files:**

- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Modify: `src/features/tasks/registration-track-fixture-runtime.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
- Modify: `tests/registration-track-fixtures.test.mjs`
- Modify: `tests/registration-browser-verifier-contract.test.mjs`
- Modify: `tests/registration-appointment-calendar.test.mjs`
- Modify: `tests/ops-task-verification-safety.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

- [ ] Before fixture/runtime edits, write failing reducer/source/verifier tests for the new all-terminal case, unique case rows, same-host create, post-interaction safety checks, sibling-draft preservation, and the two one-shot fault modes defined below.

- [ ] Run the fixture/verifier packet and confirm failure on missing `fixture-task-all-terminal`, old close-on-create locators, missing fault API, and absent sibling-draft assertions.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-track-fixtures.test.mjs tests/registration-browser-verifier-contract.test.mjs tests/registration-appointment-calendar.test.mjs tests/ops-task-verification-safety.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Add this exact fixture-only fault contract:

~~~ts
export type RegistrationSubjectTrackFixtureDebugFault =
  | { kind: "option_data_once"; error: string }
  | {
      kind: "common_revision_conflict_once"
      taskId: string
      canonicalRequestNote: string
    }

debugSetNextFault?: (
  fault: RegistrationSubjectTrackFixtureDebugFault,
) => void
~~~

Expose `setNextFault` on `__TIPS_REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG__`. The adapter consumes `option_data_once` on the next `loadOptionData` call and rejects once. It consumes `common_revision_conflict_once` only on the next matching `updateRegistrationCaseCommon` action: first update that fixture case's canonical request note and increment `commonRevision`, then reject with `registration_common_revision_conflict` so the UI must reload and compare attempted/latest values.

- [ ] Add `parseRegistrationSubjectTrackFixtureQueryFault` for `fixtureFaultType`, `fixtureFaultTaskId`, `fixtureFaultCanonicalRequestNote`, and `fixtureFaultError`. Wire it beside the existing action-behavior query setup in `ops-task-workspace.tsx` before option loading/action execution. Tests must prove each fault is one-shot, scoped to its intended load/action, and leaves `externalCalls` unchanged.

- [ ] Extend deterministic fixture coverage without changing real Supabase data:

  - keep `fixture-task-dual-test` with two level-test tracks and require one level-test row;
  - keep `fixture-task-cross-stage` and require one case in consultation plus one in level-test;
  - keep `fixture-task-partial-registration` and require it absent from completed while one track is active;
  - add `fixture-task-all-terminal` with all tracks terminal and require one completed row;
  - use an inquiry/create fixture to prove all six sections and the create-to-detail rehydration;
  - keep atomic create receipt count exactly one and `externalCalls === 0`.

- [ ] Update fixture tests for case counts, same-view matching tracks, cross-view identity, all-terminal completion, persisted section mutations, and automatic event actor/time. Do not add a fixture-only product branch to production UI.

- [ ] Keep a reducer-level direct-visit test to prove atomic visit materialization and its internal notification target without dispatching it. The browser create scenario deliberately uses direct-phone plus level-test so provider interception can remain exactly zero.

- [ ] Reverse `verifyRegistrationSinglePageDialog` expectations. It must require all six section titles and locked empty fields, and reject a separate `현재 업무` card or outside-application appointment editor.

- [ ] Replace row locators such as `[subject] student 상세` with case-level accessible names. When a scenario needs one subject, open the case and then focus that subject inside the common application.

- [ ] Replace `createDialog.waitFor({ state: "hidden" })` with:

  1. capture the current `[data-registration-application-host]`;
  2. submit atomic create;
  3. require the host to remain visible;
  4. require its mode to become canonical detail;
  5. require the saved student, both subject badges, canonical task ID/deep link, and first automatic history entry.

- [ ] Make the fixture browser scenario cover:

  1. create mode immediately shows six sections and locked future fields;
  2. English direct-phone plus mathematics level-test create atomically, while the direct-visit controls and atomic-only gate are verified without submitting a notification-producing path;
  3. the same host rehydrates canonical detail without closing;
  4. returning to the list shows one case row with both states;
  5. the dual-test case appears once in level test;
  6. the cross-stage case opens the same application from two views;
  7. shared appointment edit, participant change, test start, and result stay inside level test;
  8. consultation, waiting, enrollment, and admission actions stay in their named sections;
  9. refresh/reopen restores values and statuses;
  10. automatic history shows actor/time and has no edit controls;
  11. a calendar item opens the same application and focuses its appointment section.
  12. leave inquiry text unsaved, save a phone-consultation section and accept canonical reload, then require the inquiry text and dirty-close warning to remain until inquiry is saved or explicitly discarded.

- [ ] Preserve calendar tests that one shared appointment is one calendar item identified by `appointmentId`. Add the same-case/focus assertion without moving appointment identity into case-list rows.

- [ ] Move console, page-error, failed-request, HTTP 4xx/5xx, and horizontal-overflow assertions to run after all interactions as well as after initial navigation. Keep desktop `1349x987` and mobile `390x844`; spot-check `820px` and `320px` in the live browser.

- [ ] Add executable accessibility/error checks to the fixture verifier:

  - submit an incomplete enabled section, require a Korean `role="alert"`, and assert focus moves to that section's first invalid control;
  - require every subject-owned enabled input/button accessible name to contain `영어` or `수학`;
  - require locked/current/saved/failed states to expose text or an accessible label in addition to color;
  - at mobile width, compare DOM positions so each section's primary action follows its final owned input;
  - trigger the fixture revision-conflict response and require both the attempted value and reloaded canonical value before resubmission;
  - trigger the fixture option/catalog failure and require only its section locked with `다시 불러오기` while another section remains editable.

- [ ] Keep provider-zero interception for POSTs to:

  - `/api/google-chat`;
  - `/api/web-push`;
  - `/api/solapi/**`;
  - `/api/registration/consultation-notification`;
  - `/api/notifications/worker`;
  - `/api/notifications/connections`;
  - `/api/notifications/legacy/**`.

Allow passive push-readiness GETs, but fail on permission prompts, self-tests, worker dispatches, or any intercepted provider POST. For the direct-phone plus level-test create path, final fixture evidence must show `createdResult.notificationJobs.length === 0`, `savedSnapshot.counts.notificationReceipts === 0`, `savedSnapshot.counts.externalCalls === 0`, and `interceptedProviderRequests.length === 0`. Replace the verifier's stale create-path `notificationReceipts === 1` assertion with `0`. Preserve the existing internal `target_reconciliation` superseded/applied audit jobs; they are deterministic bookkeeping evidence, not provider calls.

- [ ] Start or reuse the local server only with provider configuration disabled for this proof. Override `GOOGLE_CHAT_WEBHOOK_ADMIN`, `GOOGLE_CHAT_WEBHOOK_ENGLISH`, `GOOGLE_CHAT_WEBHOOK_EXECUTIVE`, `GOOGLE_CHAT_WEBHOOK_MATH`, `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `VAPID_PRIVATE_KEY`, `WEB_PUSH_CONTACT`, `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_KAKAO_PF_ID`, `SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID`, and `NOTIFICATION_WORKER_SECRET` to empty values without editing `.env.local`.

Do not reuse a pre-existing server whose launch environment is unknown. Resolve the current port-3001 listener first and stop it only if it is the workspace's own local Next process. Start this exact command through a dedicated exec terminal and record the returned session ID in the execution notes; only that session counts as provider-disabled evidence:

~~~bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
env PORT=3001 GOOGLE_CHAT_WEBHOOK_ADMIN= GOOGLE_CHAT_WEBHOOK_ENGLISH= GOOGLE_CHAT_WEBHOOK_EXECUTIVE= GOOGLE_CHAT_WEBHOOK_MATH= NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY= NEXT_PUBLIC_VAPID_PUBLIC_KEY= WEB_PUSH_PRIVATE_KEY= VAPID_PRIVATE_KEY= WEB_PUSH_CONTACT= SOLAPI_API_KEY= SOLAPI_API_SECRET= SOLAPI_KAKAO_PF_ID= SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID= NOTIFICATION_WORKER_SECRET= "$TIPS_NODE" node_modules/next/dist/bin/next dev
~~~

After browser QA, stop only that recorded exec session. Never use a broad process kill.

- [ ] Do not click admission-message send/reconcile or another externally dispatched action during provider-zero browser QA. Verify its case-level location, eligible-subject badges, locking, and fixture state instead; use unit/reducer tests for the mutation contract.

- [ ] Run static verifier/fixture/calendar safety tests.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration-track-fixtures.test.mjs tests/registration-browser-verifier-contract.test.mjs tests/registration-appointment-calendar.test.mjs tests/ops-task-verification-safety.test.mjs tests/ops-task-workspace.test.mjs
~~~

- [ ] Preflight the existing browser harness before claiming automated script coverage.

~~~bash
"$TIPS_NODE" -e 'import("playwright").then(() => process.stdout.write("playwright-ready\n")).catch(() => process.exit(1))'
~~~

At plan-writing time `playwright` is not declared in `package.json` and is not present in the local `node_modules`. Do not silently edit manifests or claim the script passed. Use the existing Codex in-app browser control for the required live desktop/mobile fixture proof. If the user separately authorizes making the CLI verifier self-contained, add Playwright as a scoped dev-dependency with the chosen single lockfile in a distinct infrastructure commit.

- [ ] For a CLI run when Playwright and an authenticated local fixture state are already available, keep all provider secrets blank in the server environment and run:

~~~bash
OPS_BROWSER_WORKFLOW=1 OPS_BROWSER_BASE_URL=http://localhost:3001 OPS_BROWSER_ROUTE_FILTER=registration-subject-track-fixture "$TIPS_NODE" scripts/verify-ops-task-browser-workflow.mjs
~~~

Expected JSON for both viewports: route `registration-subject-track-fixture` has `ok: true` and `interceptedProviderRequests: 0`.

- [ ] Commit fixture and verifier changes.

~~~bash
git add src/features/tasks/registration-track-fixtures.ts src/features/tasks/registration-track-fixture-runtime.ts src/features/tasks/ops-task-workspace.tsx scripts/verify-ops-task-browser-workflow.mjs tests/registration-track-fixtures.test.mjs tests/registration-browser-verifier-contract.test.mjs tests/registration-appointment-calendar.test.mjs tests/ops-task-verification-safety.test.mjs tests/ops-task-workspace.test.mjs
git diff --cached --check
git commit -m "test: verify the registration application workflow"
~~~

---

### Task 9: Run full regression, real-browser QA, and final scope review

**Files:**

- Verify: all changed source/test files
- Verify: `docs/superpowers/specs/2026-07-19-registration-common-application-design.md`
- Verify: `docs/superpowers/plans/2026-07-19-registration-common-application.md`

- [ ] Run all registration tests.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/registration*.test.mjs
~~~

Expected: more than the `507`-test baseline, `0` failures.

- [ ] Run the entire Node test suite.

~~~bash
"$TIPS_NODE" --test --experimental-strip-types tests/*.test.mjs
~~~

Expected: more than the `1533`-test baseline, `0` failures.

- [ ] Run TypeScript, ESLint, and production build.

~~~bash
"$TIPS_NODE" node_modules/typescript/bin/tsc --noEmit
"$TIPS_NODE" node_modules/eslint/bin/eslint.js src tests middleware.ts next.config.ts
"$TIPS_NODE" node_modules/next/dist/bin/next build --webpack
~~~

Expected: every command exits `0`. Fix only feature-related failures; investigate and report unrelated baseline failures rather than rewriting unrelated code.

- [ ] Use the `browser:control-in-app-browser` skill for live QA against `http://localhost:3001/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin` when the CLI Playwright import is unavailable. Verify the Task 8 workflow at desktop and mobile widths, including post-action console/network errors and provider-zero evidence.

- [ ] Manually inspect the critical mixed cases:

  - same-view two-track row keeps two owner/time blocks and subject-labelled actions;
  - cross-stage case opens one document with both active sections;
  - partial-terminal case stays out of completed;
  - every-terminal case appears once in completed;
  - create save keeps one dialog and cannot duplicate-submit;
  - admission message is one case action with all eligible subject badges;
  - history is last and immutable.

- [ ] Search for placeholders, stale contracts, and forbidden UI.

~~~bash
! rg -n --pcre2 '(?://|/\*|\*)\s*(?:TODO|FIXME)\b|not implemented' src/features/tasks scripts
! rg -n 'registration-track-list|registrationTrackItems|getRegistrationTrackTabCounts|RegistrationConsultationOutcomeDialog|selectedStageEditor|현재 업무|문의 채널' src/features/tasks
~~~

Expected: both commands exit `0` because their searches find no implementation placeholder or stale production contract. Negative test strings are outside this source-only gate.

- [ ] Confirm there is no database/provider/deployment scope drift.

~~~bash
git diff --name-only origin/main...HEAD
git diff --check
git status --short --branch
~~~

Expected: no Supabase migration, provider enablement, environment file, generated report, `.pnpm-store/`, or unrelated feature file is staged/committed.

- [ ] Review the final diff against every completion criterion in the approved design. Record evidence for section order, lock visibility, independent tracks, case counts, appointment identity, section saves, error recovery, history immutability, responsive behavior, and provider-zero safety.

- [ ] If final-review fixes are required, rerun the smallest relevant test first, then Tasks 9.1–9.3 and the affected live-browser path. Repeat the exact staging list from the task that owns the changed file, inspect `git diff --cached --check`, and commit only after all gates are green.

Do not push, deploy, enable providers, or run against production data.
