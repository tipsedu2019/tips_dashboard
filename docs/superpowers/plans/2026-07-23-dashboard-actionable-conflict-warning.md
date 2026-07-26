# Dashboard Actionable Conflict Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an academy-wide, actionable schedule-conflict warning at the top of `/admin/dashboard`, cover exam/teacher/classroom/student conflicts, create at most one durable no-notification task per conflict, and remove only the filter container's decorative outer border.

**Architecture:** Normalize all four conflict sources once in the dashboard metrics layer, independently of statistics filters. Preserve source identifiers and source-read status through the dashboard hook. Use two visibility-aware Supabase RPCs backed by a private conflict-to-task registry: one lists links for the conflicts currently on screen, and one revalidates and creates a no-notification general task under row locks. Render the resulting state in one persistent alert above the filters and KPI strip.

**Tech Stack:** Next.js 16, React 19, TypeScript/JavaScript, Tailwind CSS, Supabase/Postgres RPCs, Node test runner, pgTAP, Playwright-based browser verifier.

## Global Constraints

- Preserve the already implemented science statistics, student-roster popovers, and collapsed-by-default class-operation groups.
- The warning is academy-wide. `activeSubject` and `activeDivision` must never filter its rows.
- Apply the approved exam rule exactly: same-subject exam day conflicts; a prior-day class is allowed when the next day's exam subjects contain the class subject; it conflicts only when every next-day subject is different.
- Count normalized conflict rows, not classes or conflicting entities.
- Include registered students only in student schedule collisions; do not include waitlisted students.
- Keep weekly conflict keys independent of the current week's date and of mutable teacher/classroom display names.
- Never call `create_ops_task_v2`, `record_ops_task_notification_source_v2`, a notification dispatcher, or an external provider from the conflict producer.
- Do not enable Google Chat, Web Push, SOLAPI, or any notification control-plane flag.
- Do not mutate live operations data during browser QA.
- Do not edit already-applied migrations. Add a new migration.
- Before every edit, inspect the target hunk because the listed files already contain unrelated user changes.
- Per-task commits are conditional on a clean isolated worktree. In the current
  shared dirty worktree, skip staging; if git later becomes writable, use
  `git add -p`, inspect `git diff --cached --check` and `git diff --cached`,
  and never stage a pre-existing user hunk.
- Follow RED → GREEN for each production-code unit.

## File Structure

- Modify: `src/features/dashboard/metrics.js`
  - Preserve source IDs and normalize four conflict types.
- Create: `src/features/dashboard/conflict-contract.ts`
  - Own the shared TypeScript row/payload/link contracts used by UI and task service.
- Modify: `src/hooks/use-tips-dashboard-metrics.ts`
  - Load catalogs, expose exam-source state, and provide retry.
- Modify: `src/app/admin/dashboard/components/section-cards.tsx`
  - Render the top alert, row actions, and filter border cleanup.
- Modify: `src/features/tasks/ops-task-service.ts`
  - Add list/create conflict-link RPC clients.
- Modify: `src/features/tasks/ops-task-workspace.tsx`
  - Map the linked-task delete guard to the approved Korean message.
- Create: `supabase/migrations/20260726035612_dashboard_conflict_task_producer.sql`
  - Add registry, canonicalization/revalidation helpers, RPCs, and delete trigger.
- Modify: `tests/dashboard-metrics.test.mjs`
  - Model and key invariants.
- Modify: `tests/admin-shell.test.mjs`
  - Loader and UI source contracts.
- Create: `tests/dashboard-conflict-task-producer.test.mjs`
  - Static SQL/service safety contract.
- Modify: `tests/ops-task-workspace.test.mjs`
  - Delete error mapping.
- Create: `supabase/tests/dashboard_conflict_task_producer_test.sql`
  - Runtime roles, idempotency, visibility, stale, and notification-artifact-zero coverage.
- Create: `scripts/verify-dashboard-conflict-concurrency.mjs`
  - Two-session creation and source-update races.
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
  - Deterministic desktop/mobile dashboard verification.

---

### Task 1: Normalize academy-wide conflict rows

**Files:**
- Modify: `tests/dashboard-metrics.test.mjs`
- Modify: `src/features/dashboard/metrics.js`

**Interfaces:**

```ts
type DashboardConflictRow = {
  key: string
  type: "exam" | "teacher" | "classroom" | "student"
  occurrenceKind: "dated" | "weekly"
  title: string
  nextOccurrenceAt: string
  recurrenceDay: string
  problem: string
  ownerLabel: string
  resolution: string
  classIds: string[]
  classNames: string[]
  affectedStudentIds: string[]
  subject: string
  campus: string
  primaryAssigneeProfileId: string
  secondaryAssigneeProfileId: string
  assigneeTeam: string
  source: {
    classIds: string[]
    studentIds: string[]
    examEventIds: string[]
    examDetailIds: string[]
    teacherCatalogIds: string[]
    classroomCatalogIds: string[]
    weekday: string
    overlapStart: string
    overlapEnd: string
    examDate: string
    examRule: string
  }
}
```

- [ ] **Step 1: Add failing normalization tests**

Add focused cases that assert:

- four conflict types become flat rows;
- `riskCount === conflictRows.length`;
- a reversed class pair produces the same weekly key;
- changing teacher/classroom names does not change the key;
- changing overlap time does change the key;
- weekly `nextOccurrenceAt` changes with `now` while the key remains stable;
- student collisions ignore waitlist-only membership and deduplicate a registered student/class pair;
- source event/detail/catalog/student IDs survive projection;
- past dated exam conflicts are omitted;
- science classes participate;
- same-day same-subject conflicts;
- next-day mixed subjects including the current subject are allowed;
- next-day all-other-subjects conflict.

Use a fixed Seoul clock argument:

```js
const now = "2026-07-23T09:00:00+09:00";
const metrics = buildDashboardMetrics({
  classes,
  students,
  academicEvents,
  academicEventExamDetails,
  now,
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types tests/dashboard-metrics.test.mjs
```

Expected: failures for missing `conflictRows`, unstable keys, source IDs, or incorrect student membership/counting.

- [ ] **Step 3: Preserve source identifiers**

Extend `buildExamDetailRows(...)` and the class/catalog enrichment inputs so IDs are retained alongside display labels. Do not put names in canonical keys.

Keep the parser contract aligned with:

```js
parseAcademicSchedule(schedule, classItem)
```

from `src/features/academic/records.js`.

- [ ] **Step 4: Add deterministic key and Seoul occurrence helpers**

Implement small pure helpers next to the existing collision builders:

```js
function sortedIds(values = []) {
  return [...new Set(values.map(text).filter(Boolean))].sort();
}

function weeklyConflictKey(type, { weekday, overlapStart, overlapEnd, classIds, studentId = "" }) {
  const identity = [
    `${type}:v1`,
    studentId,
    weekday,
    overlapStart,
    overlapEnd,
    ...sortedIds(classIds),
  ].filter(Boolean);
  return identity.join(":");
}
```

Compute `nextOccurrenceAt` in `Asia/Seoul`, but never include it in a weekly key.

- [ ] **Step 5: Build `buildDashboardConflictRows(...)`**

Normalize:

- exam: one row per class/date/rule, with affected students deduplicated;
- teacher: one row per sorted class pair/weekday/overlap;
- classroom: one row per sorted class pair/weekday/overlap;
- student: one row per registered student/sorted class pair/weekday/overlap.

Map owners exactly:

- exam and teacher conflicts use the linked `teacher_catalogs.profile_id` when available;
- classroom conflicts use `관리팀`;
- student conflicts use the two linked teacher profiles as primary/secondary;
- if no profile is linked, assign the management team and keep the original teacher label in the memo-facing row text.

- [ ] **Step 6: Return conflict rows independently of filtered analytics**

Add `conflictRows` and source metadata to both `createEmptyDashboardMetrics()` and `buildDashboardMetrics(...)`. Calculate them from all loaded classes before creating `analyticsByView`.

Set:

```js
riskCount: conflictRows.length
```

- [ ] **Step 7: Run the metrics suite and verify GREEN**

Run the command from Step 2. Expected: zero failures.

- [ ] **Step 8: Commit the model unit**

```bash
git add -p tests/dashboard-metrics.test.mjs src/features/dashboard/metrics.js
git diff --cached --check
git diff --cached
git commit -m "feat: normalize dashboard schedule conflicts"
```

If `.git` remains read-only, record the commit as blocked and continue without staging unrelated changes.

---

### Task 2: Preserve source loading and catalog ownership

**Files:**
- Modify: `tests/admin-shell.test.mjs`
- Modify: `src/hooks/use-tips-dashboard-metrics.ts`

**Interfaces:**

```ts
type ConflictSourceStatus = "loading" | "ready" | "error"

type DashboardConflictSources = {
  schedule: { status: ConflictSourceStatus; error: string }
  exam: { status: ConflictSourceStatus; error: string }
}

type DashboardMetrics = ExistingDashboardMetrics & {
  conflictSources: DashboardConflictSources
  retryExamSources: () => void
}
```

The hook must keep returning this flat metrics object because
`src/app/admin/dashboard/page.tsx` passes the whole return value directly to
`<SectionCards metrics={metrics} />`.

- [ ] **Step 1: Replace the old optional-error test with failing source-state tests**

Assert that:

- optional exam-table timeout/error becomes `exam.status === "error"`, not a successful empty list;
- schedule conflicts can be returned while exam sources are still loading;
- schedule source transitions are `loading` before the core class/student read,
  `ready` after metrics normalization, and `error` only when the core source
  read fails;
- retry increments a request revision and refetches only the enrichment/source phase;
- ready empty exam sources remain distinguishable from an error;
- teacher and classroom catalog projections include IDs/profile linkage.

- [ ] **Step 2: Run the shell tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types tests/admin-shell.test.mjs
```

- [ ] **Step 3: Add catalog projections**

Extend the table column map with:

```ts
teacher_catalogs: "id,name,profile_id,subjects,is_visible"
classroom_catalogs: "id,name,subjects,is_visible"
```

Pass catalog rows to `buildDashboardMetrics(...)`.

- [ ] **Step 4: Stop collapsing exam errors into `[]`**

Keep core class/student loading behavior unchanged. For optional exam sources, return an explicit result object from `readTable`/`withTableTimeout`, set `exam.status`, and keep the previous schedule rows available.

Do not turn an error into an all-clear state.

- [ ] **Step 5: Add `retryExamSources`**

Use a dedicated revision state in the hook and make the enrichment effect depend on it. Reset only exam source state to `loading`, then replace it with `ready` or `error`.

- [ ] **Step 6: Run the shell tests and verify GREEN**

Run the command from Step 2. Expected: zero failures.

- [ ] **Step 7: Commit the loader unit**

```bash
git add -p tests/admin-shell.test.mjs src/hooks/use-tips-dashboard-metrics.ts
git diff --cached --check
git diff --cached
git commit -m "feat: expose dashboard conflict source state"
```

---

### Task 3: Define the client task-link contract

**Files:**
- Create: `tests/dashboard-conflict-task-producer.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Create: `src/features/dashboard/conflict-contract.ts`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

**Interfaces:**

```ts
export type DashboardConflictTaskLink = {
  conflictKey: string
  linked: boolean
  taskId: string
  canOpen: boolean
  alreadyExists: boolean
}

export type DashboardConflictRpcInput = {
  type: "exam" | "teacher" | "classroom" | "student"
  occurrenceKind: "dated" | "weekly"
  classIds: string[]
  studentIds: string[]
  examEventIds: string[]
  examDetailIds: string[]
  teacherCatalogIds: string[]
  classroomCatalogIds: string[]
  weekday: string
  overlapStart: string
  overlapEnd: string
  examDate: string
  examRule: "same-day-subject" | "day-before-other-subject" | ""
}

export async function listDashboardConflictTaskLinks(
  conflicts: DashboardConflictRpcInput[],
): Promise<DashboardConflictTaskLink[]>

export async function createDashboardConflictTask(
  conflict: DashboardConflictRpcInput,
): Promise<DashboardConflictTaskLink>
```

- [ ] **Step 1: Write failing service and error-mapping tests**

Verify:

- list calls `list_dashboard_conflict_task_links_v1`;
- create uses `runIdempotentOpsTaskProducerRpc` with `create_dashboard_conflict_task_v1`;
- create clears the shared task workspace cache;
- response validation rejects a leaked task ID when `canOpen` is false;
- the client does not call `createOpsTask`;
- `dashboard_conflict_task_delete_forbidden` maps to `일정 충돌에서 생성된 할 일은 삭제 대신 완료 또는 취소해 주세요.`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types \
  tests/dashboard-conflict-task-producer.test.mjs \
  tests/ops-task-workspace.test.mjs
```

- [ ] **Step 3: Add the shared TypeScript contract**

Create `src/features/dashboard/conflict-contract.ts` and export
`DashboardConflictRow`, its nested source type, `DashboardConflictTaskLink`,
and the exact `DashboardConflictRpcInput` above. `metrics.js` remains the
runtime producer; UI and service import the shared TypeScript contract instead
of each declaring a different shape. Add a projector that strips title,
display names, owner, resolution, local `key`, and every other server-derived
field before either RPC call.

- [ ] **Step 4: Add strict response normalization**

Normalize RPC rows so:

```ts
taskId = canOpen ? text(row.taskId) : ""
```

The SQL JSON response and client use camelCase keys only:
`conflictKey`, `taskId`, `canOpen`, `alreadyExists`, and `linked`. Reject
unknown conflict keys and duplicate results. Keep links keyed by the requested
canonical row key.

- [ ] **Step 5: Add list/create wrappers**

The create wrapper must pass only the conflict source contract and a request ID. It must not accept arbitrary task type/status/priority fields. On success, call `clearOpsTaskWorkspaceDataCache()`.

- [ ] **Step 6: Add the deletion error message**

Insert the unique error branch before generic delete/stale handling in `getOpsTaskActionErrorMessage(...)`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: zero failures.

- [ ] **Step 8: Commit the service unit**

```bash
git add tests/dashboard-conflict-task-producer.test.mjs src/features/dashboard/conflict-contract.ts
git add -p \
  tests/ops-task-workspace.test.mjs \
  src/features/tasks/ops-task-service.ts \
  src/features/tasks/ops-task-workspace.tsx
git diff --cached --check
git diff --cached
git commit -m "feat: add dashboard conflict task client"
```

---

### Task 4: Add the durable, visibility-aware conflict producer

**Files:**
- Modify: `tests/dashboard-conflict-task-producer.test.mjs`
- Create: `supabase/migrations/20260726035612_dashboard_conflict_task_producer.sql`
- Create: `supabase/tests/dashboard_conflict_task_producer_test.sql`

**Database contract:**

```sql
create table dashboard_private.dashboard_conflict_task_links (
  conflict_key text primary key,
  task_id uuid not null unique references public.ops_tasks(id) on delete restrict,
  conflict_type text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
```

Public RPCs:

```sql
public.list_dashboard_conflict_task_links_v1(p_conflicts jsonb) returns jsonb
public.create_dashboard_conflict_task_v1(p_conflict jsonb, p_request_id uuid) returns jsonb
```

- [ ] **Step 1: Add failing static and pgTAP contracts**

Static assertions must cover:

- registry constraints and direct privilege revocation;
- `SECURITY DEFINER` and `SET search_path = ''`;
- list roles `admin/staff/teacher/assistant/viewer`;
- create roles `admin/staff/teacher`;
- request replay before source revalidation;
- candidate-key advisory lock;
- deterministic source-row lock ordering;
- private, service-role-only arm/wait/release/disarm verification checkpoints
  that are inert unless an authorized fixture row is armed;
- calls to `insert_ops_task_from_json_v2`, not `create_ops_task_v2`;
- no `record_ops_task_notification_source_v2`, canonical notification recorder, dispatch, or provider call;
- delete trigger error token.

pgTAP cases must cover role access, canonical key validation, stale source
rejection, idempotent replay, visibility-aware task IDs, deletion guard, and
zero notification artifacts. Include these sequence cases:

- a completed request replays its original response even after the source
  conflict disappears, because replay precedes revalidation;
- the same request ID with a different fingerprint rejects;
- a new request ID for the same still-live conflict returns the existing link
  with `alreadyExists: true`;
- a linked conflict that disappears keeps its registry/task, and the same
  canonical conflict reappearing returns that original link;
- a new request for a disappeared conflict rejects
  `dashboard_conflict_stale`.
- a dated exam request before the current Asia/Seoul date rejects stale;
- request kind is exactly `create_dashboard_conflict_task_v1`, and the
  fingerprint includes actor plus the normalized candidate conflict/key.

- [ ] **Step 2: Run tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types tests/dashboard-conflict-task-producer.test.mjs

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  dlx supabase@2.109.1 test db supabase/tests/dashboard_conflict_task_producer_test.sql
```

Expected: missing migration/functions/table.

- [ ] **Step 3: Add private canonicalization and permission helpers**

Implement helpers that:

- validate type, occurrence kind, UUIDs, date, weekday, and overlap time;
- sort IDs before key construction;
- reproduce `parseAcademicSchedule`, including `schedule_plan` active/makeup
  sessions plus start/end fallbacks;
- reproduce modern-event coverage: when modern exam coverage exists, do not
  fall back to a legacy exam day;
- validate both direct-subject events and legacy `academic_exam_days`;
- reproduce the bidirectional registered-roster rule while excluding waitlist
  membership;
- reproduce the mixed next-day rule that allows a class when the exam subjects
  contain its own subject;
- reject dated exam conflicts before today's `Asia/Seoul` date;
- build the request ledger entry with kind
  `create_dashboard_conflict_task_v1` and a fingerprint containing actor plus
  the normalized candidate conflict/key;
- reproduce the current `ops_tasks_select` visibility predicate explicitly because `SECURITY DEFINER` bypasses RLS;
- map only `teacher_catalogs.profile_id` to assignees, never catalog IDs or names.

In the same migration, add the private checkpoint table/helper and
service-role-only wrappers used by Task 5. Support two named phases:

- `before_source_lock`, after the advisory lock but before any source row lock;
- `after_source_lock`, after every canonical source row has been locked.

The normal path performs one indexed missing-row check per phase and returns
immediately; only an explicitly armed local or preview fixture can wait.

- [ ] **Step 4: Implement request replay and lock order**

Inside create:

1. validate actor and input shape;
2. compute request fingerprint;
3. call `dashboard_private.ops_task_request_replay_v2(...)`;
4. return completed replay before revalidation;
5. acquire `pg_advisory_xact_lock` for the candidate key;
6. lock source rows ordered by schema/table/primary key;
7. re-read and recompute the conflict;
8. reject disappeared or changed conflicts with `dashboard_conflict_stale`.

For exam parents, lock the event before details so concurrent detail insertion is serialized.

- [ ] **Step 5: Create or return one linked no-notification task**

When no registry row exists, build the task entirely from locked source rows:

```sql
type = 'general'
status = 'requested'
priority = 'high'
requested_by = auth.uid()
```

Compute due time as the previous day at 18:00 Asia/Seoul, falling back to today at 23:59 when already past or imminent. Insert through `dashboard_private.insert_ops_task_from_json_v2(...)`, then insert the registry row.

The locked-source task builder must also set and test:

- title: `[일정 충돌] {충돌 요약}`;
- `class_id`, `subject`, and `campus` when a single canonical value exists;
- primary and secondary profile assignees for student conflicts;
- management-team fallback when no profile is linked;
- the original unlinked teacher label in the memo;
- memo fields for conflict key, occurrence, classes, problem, owner, and
  ordered resolution steps.

When a row exists, return it without creating another task. Return `taskId` only if the caller satisfies the explicit visibility helper.

- [ ] **Step 6: Add a universal delete guard**

Create a `BEFORE DELETE ON public.ops_tasks` trigger that raises:

```text
dashboard_conflict_task_delete_forbidden
```

when the task is present in the registry. This must protect the current delete RPC and future direct deletion paths.

- [ ] **Step 7: Apply grants**

Revoke all registry/private-helper access from `public`, `anon`,
`authenticated`, and `service_role`. Grant only the two conflict public
wrappers to `authenticated`. Grant only the verification checkpoint wrappers
to `service_role`; keep their table and private waiter inaccessible directly.
Enforce application roles inside each conflict wrapper/private implementation.

- [ ] **Step 8: Apply the new migration to disposable local Supabase**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  dlx supabase@2.109.1 migration up --local
```

Do not point this command at production. If local migration history is not in a
state where `migration up --local` is safe, stop and repair/use a disposable
local stack; do not edit an already-applied migration or mark pgTAP green from
static inspection alone.

- [ ] **Step 9: Run static and pgTAP tests and verify GREEN**

Run the commands from Step 2. Expected: zero failures and all database
notification source/canonical event/job/delivery counts remain zero. External
provider zero is verified by the browser/worker spy.

- [ ] **Step 10: Commit the database unit**

```bash
git add \
  tests/dashboard-conflict-task-producer.test.mjs \
  supabase/migrations/20260726035612_dashboard_conflict_task_producer.sql \
  supabase/tests/dashboard_conflict_task_producer_test.sql
git diff --cached --check
git diff --cached
git commit -m "feat: add idempotent dashboard conflict tasks"
```

---

### Task 5: Verify real two-session races

**Files:**
- Create: `scripts/verify-dashboard-conflict-concurrency.mjs`
- Modify: `tests/dashboard-conflict-task-producer.test.mjs`

- [ ] **Step 1: Add a failing verifier contract test**

Assert the script:

- requires a local/temporary Supabase URL and two independent connections;
- refuses production hosts;
- supports `--run` and otherwise prints the unexecuted proof scope;
- requires URL, anon key, service-role key, and two authenticated actor tokens;
- tests same-key create/create;
- tests source-update/create;
- rolls back or deletes only its own fixture;
- verifies one task/link for create/create;
- verifies `dashboard_conflict_stale` after a source change wins;
- verifies notification source, canonical event, fanout job, and delivery
  counts are zero.

- [ ] **Step 2: Run the static test and verify RED**

Run the Node test from Task 4.

- [ ] **Step 3: Implement the verifier**

Follow `scripts/verify-registration-subject-track-concurrency.mjs` for two-client
setup, fixture IDs, production-host refusal, and cleanup. For create/create,
hold the first request at `after_source_lock`, start the second request, then
release and assert one registry/task. For source-update/create, hold create at
`before_source_lock`, commit the source update, release create, and assert the
fresh lock/revalidation rejects `dashboard_conflict_stale`. Do not use a single
pgTAP transaction or best-effort simultaneous promises as a concurrency
substitute.

- [ ] **Step 4: Run the verifier against local Supabase**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/verify-dashboard-conflict-concurrency.mjs \
  --run \
  --url "$TIPS_CONFLICT_TEST_URL" \
  --anon-key "$TIPS_CONFLICT_TEST_ANON_KEY" \
  --service-role-key "$TIPS_CONFLICT_TEST_SERVICE_ROLE_KEY" \
  --admin-token "$TIPS_CONFLICT_TEST_ADMIN_TOKEN" \
  --second-admin-token "$TIPS_CONFLICT_TEST_SECOND_ADMIN_TOKEN"
```

Expected: both race scenarios pass and database notification-artifact counts
are zero. If local Supabase credentials are unavailable, report this exact gate
as unexecuted; do not replace it with a regex assertion. External provider zero
remains a browser/worker-spy assertion.

- [ ] **Step 5: Commit the concurrency verifier**

```bash
git add scripts/verify-dashboard-conflict-concurrency.mjs
git add -p tests/dashboard-conflict-task-producer.test.mjs
git diff --cached --check
git diff --cached
git commit -m "test: verify dashboard conflict task races"
```

---

### Task 6: Render the top alert and row-local task states

**Files:**
- Modify: `tests/admin-shell.test.mjs`
- Modify: `src/app/admin/dashboard/components/section-cards.tsx`

- [ ] **Step 1: Add failing UI contract tests**

Assert:

- source order is `ConflictWarning`, `DashboardHeader`, `KpiStrip`, panels;
- the warning does not reference `activeSubject` or `activeDivision`;
- zero rows hide the alert only when both sources are ready;
- exam error text and retry control remain visible;
- default display is the first three rows with `aria-expanded`;
- sort order is occurrence, then exam/teacher/classroom/student;
- filter wrapper no longer has outer `border` or decorative `bg-background`;
- internal segmented-control border/focus classes remain;
- row state is isolated by conflict key;
- read-only roles never see a create button;
- linked-but-not-visible state has no task URL.
- the component reads the actual role from `useAuth()` rather than inferring
  permissions from the selected dashboard mode.

- [ ] **Step 2: Run shell tests and verify RED**

Run the Task 2 command.

- [ ] **Step 3: Replace the filtered exam board with `ConflictWarning`**

Render one `Alert` surface with:

- `일정 충돌 N건`;
- source error line and retry;
- the first three sorted rows by default;
- `전체 보기` / `접기`;
- type text, occurrence, problem, owner, and resolution;
- responsive stacked mobile layout.

Remove the nested `Card` and old filtered `getConflictRows(...)`.

- [ ] **Step 4: Load link state only when conflict keys change**

Use a sorted key signature and keep:

```ts
type ConflictActionState =
  | { status: "checking" }
  | { status: "idle" }
  | { status: "saving" }
  | { status: "linked"; taskId: string; canOpen: boolean }
  | { status: "error"; message: string }
```

Update only the clicked row. A failed row must not disable other rows.

- [ ] **Step 5: Implement role and visibility behavior**

- `admin/staff/teacher`: show create for unlinked rows;
- `assistant/viewer`: show `관리팀 등록 필요` for unlinked rows;
- linked + openable: `등록됨 · 할 일 보기` to `/admin/tasks?taskId=<id>`;
- linked + hidden: disabled `등록됨 · 담당자가 처리 중`;
- error: `등록 실패 · 다시 시도`, with row-local text and one toast.

Use an `aria-live` region for saving/error results.

- [ ] **Step 6: Move the alert and remove only the filter outer border**

In `SectionCards`, render:

```tsx
<ConflictWarning ... />
<DashboardHeader ... />
<KpiStrip ... />
```

Remove only `rounded-xl border bg-background` from the filter's outer wrapper. Preserve its layout spacing and the internal control borders.

- [ ] **Step 7: Run shell tests and verify GREEN**

Run the Task 2 command. Expected: zero failures.

- [ ] **Step 8: Commit the UI unit**

```bash
git add -p tests/admin-shell.test.mjs src/app/admin/dashboard/components/section-cards.tsx
git diff --cached --check
git diff --cached
git commit -m "feat: add actionable dashboard conflict warning"
```

---

### Task 7: Add deterministic browser coverage

**Files:**
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
- Modify: `tests/ops-task-verification-safety.test.mjs`

- [ ] **Step 1: Add failing verifier safety tests**

Require a `dashboard-conflicts` interaction that intercepts dashboard Supabase reads/RPCs before navigation and provides:

- all four conflict types, including science;
- a linked `canOpen: true` row;
- a linked `canOpen: false` row;
- an unlinked row;
- exam-source error/retry state.

Assert the interaction never performs a live create mutation and retains provider POST blocking.
Model the exam-source failure with one explicit route-scoped 503 fixture and
teach `assertRouteHealth` to ignore only that exact mocked request. Every other
4xx/5xx remains a verifier failure. Provide separate mocked profile responses
for creator and viewer fixture routes so read-only behavior is exercised
without changing the live user.
Add a route-level `beforeNavigation` hook in `inspectRoute` so every auth,
profile, data, and RPC handler is installed before `page.goto`; an unmatched
Supabase request fails the deterministic fixture. Use isolated contexts for the
creator and viewer fixture routes.

- [ ] **Step 2: Run the verifier tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types \
  tests/ops-task-verification-safety.test.mjs \
  tests/admin-shell.test.mjs
```

- [ ] **Step 3: Implement desktop/mobile assertions**

At both viewports, verify:

- alert is the first dashboard content surface;
- filter wrapper has no decorative outer border;
- default three rows and expand/collapse;
- exact problem/owner/resolution text;
- hidden task ID never appears in DOM or URL;
- read-only behavior;
- no horizontal overflow, page error, console error, or failed app request.

Add both dashboard fixture interactions to `deterministicFixtureOnly` so a
fully mocked run does not consult or validate `.env.local`'s Supabase target.
Keep the production-host rejection for every non-deterministic route.

- [ ] **Step 4: Run the deterministic interaction against production mode on port 3000**

Build:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  run build
```

Stop only the previously identified stale Next.js PID on port 3000, start the
new production build with `pnpm run start -- -p 3000`, and wait for `/sign-in`
to respond. Add the deterministic
`dashboard-conflicts` route to `ROUTES`, and run only that route through the
verifier's existing environment contract:

```bash
OPS_BROWSER_WORKFLOW=1 \
OPS_BROWSER_BASE_URL=http://localhost:3000 \
OPS_BROWSER_ROUTE_FILTER=dashboard-conflicts \
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/verify-ops-task-browser-workflow.mjs
```

Expected: desktop and mobile pass, no live task is created, provider call count is zero.

- [ ] **Step 5: Commit the browser verifier**

```bash
git add -p scripts/verify-ops-task-browser-workflow.mjs tests/ops-task-verification-safety.test.mjs
git diff --cached --check
git diff --cached
git commit -m "test: verify dashboard conflict warning"
```

---

### Task 8: Full regression and handoff

**Files:**
- Verify all files in this plan
- Verify existing science/roster dashboard work

- [ ] **Step 1: Run focused Node tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types \
  tests/dashboard-metrics.test.mjs \
  tests/admin-shell.test.mjs \
  tests/dashboard-conflict-task-producer.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/ops-task-verification-safety.test.mjs
```

- [ ] **Step 2: Run database tests and concurrency verifier**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  dlx supabase@2.109.1 test db supabase/tests/dashboard_conflict_task_producer_test.sql

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/verify-dashboard-conflict-concurrency.mjs \
  --run \
  --url "$TIPS_CONFLICT_TEST_URL" \
  --anon-key "$TIPS_CONFLICT_TEST_ANON_KEY" \
  --service-role-key "$TIPS_CONFLICT_TEST_SERVICE_ROLE_KEY" \
  --admin-token "$TIPS_CONFLICT_TEST_ADMIN_TOKEN" \
  --second-admin-token "$TIPS_CONFLICT_TEST_SECOND_ADMIN_TOKEN"
```

- [ ] **Step 3: Run targeted lint and production build**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  exec eslint \
  src/features/dashboard/metrics.js \
  src/hooks/use-tips-dashboard-metrics.ts \
  src/app/admin/dashboard/components/section-cards.tsx \
  src/features/tasks/ops-task-service.ts \
  src/features/tasks/ops-task-workspace.tsx \
  tests/dashboard-metrics.test.mjs \
  tests/admin-shell.test.mjs \
  tests/dashboard-conflict-task-producer.test.mjs

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  run build
```

- [ ] **Step 4: Check the patch**

```bash
git diff --check
git status --short
```

Confirm unrelated existing changes remain intact and no generated/cache directory entered the patch.

- [ ] **Step 5: Re-run localhost:3000 browser verification**

Verify the production build, not a stale development server. Confirm:

- science is still selectable;
- student rosters still open;
- all class-operation groups start closed;
- warning is above filters;
- the filter outer border is gone;
- no task/provider mutation occurred.

- [ ] **Step 6: Final commit if git metadata is writable**

```bash
git add \
  src/features/dashboard/conflict-contract.ts \
  supabase/migrations/20260726035612_dashboard_conflict_task_producer.sql \
  supabase/tests/dashboard_conflict_task_producer_test.sql \
  scripts/verify-dashboard-conflict-concurrency.mjs \
  tests/dashboard-conflict-task-producer.test.mjs
git add -p \
  src/features/dashboard/metrics.js \
  src/hooks/use-tips-dashboard-metrics.ts \
  src/app/admin/dashboard/components/section-cards.tsx \
  src/features/tasks/ops-task-service.ts \
  src/features/tasks/ops-task-workspace.tsx \
  scripts/verify-ops-task-browser-workflow.mjs \
  tests/dashboard-metrics.test.mjs \
  tests/admin-shell.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/ops-task-verification-safety.test.mjs
git diff --cached --check
git diff --cached
git commit -m "feat: add actionable dashboard conflict workflow"
```

Do not stage any unrelated dirty-worktree file. If `.git` is read-only, hand off the verified working-tree diff without claiming a commit.
