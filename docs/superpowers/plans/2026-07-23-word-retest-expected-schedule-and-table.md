# Word Retest Expected Schedule and Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reference-only `응시예정일시` to English word retests, expose notes in the table, align table/modal field order, replace the main-exam popover with the shared inline class-schedule calendar surface, and let the exactly linked teacher update only the expected schedule in every open stage.

**Architecture:** Store the expected appointment in a nullable `ops_word_retests.expected_retest_at` column that is deliberately excluded from test-date automation and notifications. Preserve it through the common detail upsert, but use a narrow idempotent RPC for schedule-only edits. Expand teacher visibility through exact catalog/profile linkage while keeping stage actions unchanged. Extract only the calendar's visual surface for reuse by withdrawal and word-retest wrappers, and add explicit date/time draft and focus contracts to the existing date-time picker.

**Tech Stack:** Next.js 16, React 19, TypeScript/JavaScript, Tailwind CSS, Radix UI, Supabase/Postgres RPCs, Node test runner, pgTAP, Playwright-based browser verifier.

## Global Constraints

- `expectedRetestAt` is reference-only. It must not affect status, due dates, date filters, calendar items, completion blockers, `+7일` auto-absence, retry eligibility, reminders, or notification payloads.
- Do not emit `word_retest.schedule_changed`, a canonical notification event, a fanout job, a delivery, or an external provider call when only this value changes.
- Never infer teacher ownership from a name, requester, team label, or email. Use `ops_word_retests.teacher_catalog_id -> teacher_catalogs.profile_id -> auth.uid()` only.
- Admin/staff may edit expected time on every open task. Assistant may edit it only in `requested`, `confirmed`, `in_progress`, and `on_hold`. The exactly linked teacher may edit it on every open task. Nobody may edit `done` or `canceled`.
- Keep existing assistant action ownership and teacher review actions unchanged.
- A retry starts with no expected appointment, even if a raw retry payload contains the previous value.
- Multi-student create stores no expected appointment and explains that it must be entered per student after save.
- Main exam date retains its current meaning and `+7일` behavior.
- The modal scope order is exactly `교재·시험범위 → 메모 → 출제 개수·커트라인`.
- The desktop table order is exactly the 15-column approved order.
- Do not edit existing applied migrations or redefine the final create/update/retry producer implementations.
- Apply the DB migration and verify its preflight before deploying app code.
- Do not enable Google Chat, Web Push, SOLAPI, or any notification control-plane flag.
- Preserve unrelated existing worktree changes and follow RED → GREEN for each production-code unit.
- Per-task commits are conditional on a clean isolated worktree. In the current
  shared dirty worktree, skip staging; if git later becomes writable, use
  `git add -p`, inspect `git diff --cached --check` and `git diff --cached`,
  and never stage a pre-existing user hunk.

## File Structure

- Create: `supabase/migrations/20260726035635_word_retest_expected_at.sql`
  - Add the column, extend common detail upsert, clear copied retry values, and add the narrow RPC.
- Create: `supabase/tests/word_retest_expected_at_test.sql`
  - Runtime role, retry, and notification-artifact-zero checks.
- Modify: `supabase/tests/notification_ops_task_adapters_test.sql`
  - Replace legacy linked-teacher assistant-stage mutation expectations and preserve assistant/review regressions.
- Create: `tests/word-retest-expected-at.test.mjs`
  - Static migration and service contract.
- Modify: `tests/notification-ops-task-producers.test.mjs`
  - Keep producer compatibility and no-notification assertions.
- Modify: `src/features/tasks/ops-task-service.ts`
  - Map/serialize the field and add the narrow RPC client.
- Modify: `src/features/tasks/ops-task-model.js`
  - Exact teacher visibility without calendar automation changes.
- Modify: `tests/ops-task-model.test.mjs`
  - Visibility and automation regression.
- Modify: `src/components/ui/date-time-picker.tsx`
  - Draft-state callback and trigger focus ref.
- Modify: `tests/date-time-picker.test.mjs`
  - Partial/complete/clear draft and focus-ref contract.
- Create: `src/features/tasks/class-schedule-calendar-surface.tsx`
  - Shared visual-only 42-cell calendar surface.
- Modify: `src/features/tasks/ops-task-workspace.tsx`
  - Inline calendar wrappers, form ordering, schedule-only mode, table/detail/mobile changes.
- Modify: `tests/ops-task-workspace.test.mjs`
  - Full workspace contract and withdrawal regression.
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
  - Deterministic assistant/teacher desktop/mobile verification.
- Modify: `tests/ops-task-verification-safety.test.mjs`
  - No-save and provider-zero browser safety.
- Create: `src/features/tasks/word-retest-browser-fixture.ts`
  - Exact, read-only assistant/teacher/admin browser fixture roles and rows.
- Create: `scripts/verify-word-retest-expected-at-concurrency.mjs`
  - Two-session stale-write proof on an authorized local/preview database.

---

### Task 1: Add the nullable field and narrow database mutation

**Files:**
- Create: `tests/word-retest-expected-at.test.mjs`
- Modify: `tests/notification-ops-task-producers.test.mjs`
- Create: `supabase/migrations/20260726035635_word_retest_expected_at.sql`
- Create: `supabase/tests/word_retest_expected_at_test.sql`
- Modify: `supabase/tests/notification_ops_task_adapters_test.sql`

**Database interfaces:**

```sql
alter table public.ops_word_retests
  add column if not exists expected_retest_at timestamptz;
```

```sql
dashboard_private.update_word_retest_expected_at_v1_impl(
  p_task_id uuid,
  p_expected_retest_at timestamptz,
  p_expected_updated_at timestamptz,
  p_request_id uuid
) returns jsonb

public.update_word_retest_expected_at_v1(
  p_task_id uuid,
  p_expected_retest_at timestamptz,
  p_expected_updated_at timestamptz,
  p_request_id uuid
) returns jsonb
```

- [ ] **Step 1: Write failing static contracts**

Assert:

- nullable `timestamptz`, no backfill and no index;
- the migration redefines only `dashboard_private.upsert_ops_task_detail_v2` plus the new expected-time functions/trigger;
- it does not redefine `create_ops_task_v2_impl`, `update_ops_task_v2_impl`, or `retry_word_retest_v1_impl`;
- the common upsert has `expected_retest_at` in word-retest INSERT, value, and conflict UPDATE;
- transfer and withdrawal branches remain present;
- the dedicated RPC uses the request ledger, parent-then-child locks, stale
  revision, exact role predicates, and authenticated-only grant; the static
  test compares the two `FOR UPDATE` clause positions;
- an assistant who also has a linked teacher catalog still cannot use the
  teacher branch; the linked branch requires `role = 'teacher'`;
- a linked teacher in an assistant-owned stage cannot bypass expected-only
  editing through raw `update_ops_task_v2`;
- no notification recorder/dispatcher/provider function appears;
- no `notification_rules`, `notification_runtime_flags`, or dispatch-enable
  update appears;
- retry linkage clears an incoming expected value without permanently preventing later entry.

- [ ] **Step 2: Write failing pgTAP cases**

Cover:

- column/function/grant shape;
- admin and staff on every open state;
- assistant allowed only in `requested/confirmed/in_progress/on_hold`;
- assistant rejected in `review_requested/done/canceled`;
- assistant with a linked teacher catalog is still rejected in
  `review_requested`;
- linked teacher allowed on every open state;
- unrelated teacher and name-only teacher rejected;
- raw `update_ops_task_v2` by a linked teacher in an assistant-owned stage is
  rejected when it changes memo, main exam time, assignee, status, or another
  detail field;
- raw `delete_ops_task_v1` by that teacher is rejected in the same stages;
- the actual assistant still succeeds at start/result/absence actions in
  assistant-owned stages;
- the linked teacher still succeeds at the existing review action in
  `review_requested`;
- first real change updates child value and parent `updated_at`;
- identical-value no-op keeps the revision;
- stale revision raises a `40001` error containing `stale_write`;
- same request ID and same fingerprint replays the first response;
- same request ID with different value rejects;
- a different request ID with the old revision rejects;
- create/update preserve a supplied expected value;
- retry starts null even when the raw retry input supplies a value;
- expected-only update leaves all other parent/detail fields unchanged except
  the child row's automatic `updated_at`;
- for the dedicated expected-only request ID, notification source, canonical
  event, fanout job, and delivery deltas remain zero. Existing create/update/
  retry events keep their current behavior and are not counted as
  expected-time emissions. External provider calls are asserted in the
  browser/worker spy, not inferred from pgTAP.

- [ ] **Step 3: Run static and database tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types \
  tests/word-retest-expected-at.test.mjs \
  tests/notification-ops-task-producers.test.mjs

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  dlx supabase@2.109.1 test db supabase/tests/word_retest_expected_at_test.sql

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  dlx supabase@2.109.1 test db supabase/tests/notification_ops_task_adapters_test.sql
```

- [ ] **Step 4: Add the column and preserve it in the final common upsert**

Copy the current complete `dashboard_private.upsert_ops_task_detail_v2(...)`
body from `20260716190000_notification_ops_task_producers.sql`, preserving the
transfer and withdrawal branches byte-for-byte apart from formatting. In the
word-retest branch, make exactly these three additions:

1. add `expected_retest_at` to the INSERT column list immediately after
   `test_at`;
2. add `nullif(p_detail ->> 'expected_retest_at', '')::timestamptz` in the
   matching VALUES position;
3. add `expected_retest_at = excluded.expected_retest_at` to the conflict
   UPDATE list immediately after the `test_at` assignment.

- [ ] **Step 5: Prevent retry-copy at the database boundary**

The existing retry producer first upserts the new child and then sets `retry_of_task_id`. Add a `BEFORE UPDATE OF retry_of_task_id` trigger that clears `expected_retest_at` only when the retry link is first created:

```sql
if old.retry_of_task_id is null and new.retry_of_task_id is not null then
  new.expected_retest_at := null;
end if;
```

This allows later expected-time edits on the retry child while guaranteeing the initial retry starts blank, without redefining the retry producer.

- [ ] **Step 6: Implement the private RPC**

Order the implementation:

1. validate required arguments; only `p_expected_retest_at` may be null;
2. build a fingerprint containing actor, task, value, and expected revision;
3. call `ops_task_request_replay_v2(...)`;
4. lock the parent `ops_tasks` row `FOR UPDATE`;
5. lock the child `ops_word_retests` row `FOR UPDATE`;
6. verify type and exact parent revision;
7. reject `done/canceled`;
8. enforce role predicates directly;
9. on a real change, update the child and bump only parent `updated_at`;
10. on identical value, preserve the revision;
11. finish the request ledger with:

```json
{
  "taskId": "<uuid>",
  "expectedRetestAt": "<iso-or-null>",
  "updatedAt": "<parent-revision>"
}
```

Do not call the broad `assert_ops_task_actor_v2` as the sole assistant check.
Evaluate mutually exclusive branches by the actor's actual profile role:

```text
admin/staff
OR assistant AND status IN (requested, confirmed, in_progress, on_hold)
OR teacher AND exact teacher_catalog/profile link
```

Being catalog-linked must never promote an assistant into the teacher branch.

- [ ] **Step 7: Add a server guard against full-update bypass**

Add a private marker table keyed by transaction ID, task ID, and actor ID. The
dedicated expected-time RPC inserts its marker before updating and deletes it
before return. Browser roles have no direct marker privilege.

Add restrictive `BEFORE UPDATE` triggers on `public.ops_tasks` and
`public.ops_word_retests`, plus a `BEFORE DELETE` guard on `public.ops_tasks`:

- for an exactly linked `teacher` in
  `requested/confirmed/in_progress/on_hold`, reject every unmarked update with
  `word_retest_expected_only_required`;
- for a marked dedicated update, allow only parent `updated_at` and child
  `expected_retest_at` plus the automatic child `updated_at`;
- reject linked-teacher deletion in the same assistant-owned stages;
- keep teacher-action stages on the existing full-edit path;
- do not restrict admin/staff or the existing assistant path.

This makes `expected_only` a database boundary, not only a hidden UI.

- [ ] **Step 8: Add the public wrapper and grants**

Both functions use `SECURITY DEFINER` and `SET search_path = ''`. Revoke
private/public execution and marker-table access from `public`, `anon`,
`authenticated`, and `service_role`, then grant only the public wrapper to
`authenticated`.

- [ ] **Step 9: Apply the new migration to disposable local Supabase**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  dlx supabase@2.109.1 migration up --local
```

Do not point this command at production. If local migration history prevents a
safe local `migration up`, repair or recreate a disposable local stack rather
than editing an applied migration or treating static tests as runtime proof.

- [ ] **Step 10: Run static and pgTAP tests and verify GREEN**

Run the commands from Step 3. Expected: zero failures and zero database
notification artifacts.

- [ ] **Step 11: Commit the database unit**

```bash
git add \
  tests/word-retest-expected-at.test.mjs \
  supabase/migrations/20260726035635_word_retest_expected_at.sql \
  supabase/tests/word_retest_expected_at_test.sql
git add -p \
  tests/notification-ops-task-producers.test.mjs \
  supabase/tests/notification_ops_task_adapters_test.sql
git diff --cached --check
git diff --cached
git commit -m "feat: add reference-only word retest schedule"
```

If `.git` remains read-only, report the commit as blocked and continue with the verified working-tree changes.

---

### Task 2: Map, serialize, and update the expected time in the service

**Files:**
- Modify: `tests/word-retest-expected-at.test.mjs`
- Modify: `tests/ops-task-service-loading.test.mjs`
- Modify: `src/features/tasks/ops-task-service.ts`

**Interfaces:**

```ts
export type OpsWordRetestDetail = {
  // existing fields
  expectedRetestAt?: string
}

export type UpdateWordRetestExpectedAtResult = {
  taskId: string
  expectedRetestAt: string
  updatedAt: string
}

export async function updateWordRetestExpectedAt(input: {
  taskId: string
  expectedRetestAt: string
  expectedUpdatedAt: string
}): Promise<UpdateWordRetestExpectedAtResult>
```

The public RPC may return JSON null when the appointment is cleared. The
service boundary normalizes `null` to `""`, so UI/form code remains
string-based.

- [ ] **Step 1: Add failing service tests**

Assert:

- `mapWordRetest` reads `expected_retest_at`;
- `buildWordRetestRow` writes it through the explicit Seoul parser rather than
  the machine-timezone-dependent `nullableDate`;
- empty input becomes SQL null;
- Seoul local `2026-07-24T19:30` becomes `2026-07-24T10:30:00.000Z`;
- response ISO converts back to the same Seoul local display;
- the wrapper calls `update_word_retest_expected_at_v1` through `runIdempotentOpsTaskProducerRpc`;
- response task ID/revision/value are validated;
- a clear response with `expectedRetestAt: null` normalizes to `""`;
- success clears the workspace cache;
- retry service input forces `expectedRetestAt: ""`;
- the general create/update payload carries the field without adding it to notification schedule comparisons.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types \
  tests/word-retest-expected-at.test.mjs \
  tests/ops-task-service-loading.test.mjs
```

- [ ] **Step 3: Add explicit Seoul conversion helpers**

Do not rely on the machine's local timezone. For the accepted minute input, parse as fixed Korea time:

```ts
function seoulDateTimeInputToIso(value: string) {
  const normalized = text(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) return ""
  const parsed = new Date(`${normalized}:00+09:00`)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString()
}
```

Format stored ISO values with `Intl.DateTimeFormat(..., { timeZone: "Asia/Seoul" })` for input/display helpers.

- [ ] **Step 4: Extend mapping and serialization**

Add:

```ts
expectedRetestAt: text(row.expected_retest_at)
```

and:

```ts
expected_retest_at: seoulDateTimeInputToIso(detail.expectedRetestAt) || null
```

Use the same explicit parser in the general create/update serializer and the
dedicated RPC wrapper. Stored ISO values remain ISO in the service model; only
form/input helpers convert them to Seoul-local minute strings.

- [ ] **Step 5: Add the narrow RPC wrapper**

Pass:

```ts
{
  p_task_id: input.taskId,
  p_expected_retest_at: seoulDateTimeInputToIso(input.expectedRetestAt) || null,
  p_expected_updated_at: input.expectedUpdatedAt,
}
```

Let the shared idempotent runner add `p_request_id`. Do not dispatch a source event after success.
Normalize the returned value with `text(row.expectedRetestAt)` so SQL null is a
successful clear, not a response-validation failure.

- [ ] **Step 6: Clear expected time on retry input**

When building the retry payload, explicitly set:

```ts
expectedRetestAt: ""
```

The database trigger from Task 1 remains the authoritative raw-RPC boundary.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: zero failures.

- [ ] **Step 8: Commit the service unit**

```bash
git add tests/word-retest-expected-at.test.mjs
git add -p tests/ops-task-service-loading.test.mjs src/features/tasks/ops-task-service.ts
git diff --cached --check
git diff --cached
git commit -m "feat: support word retest expected time"
```

---

### Task 3: Make teacher visibility exact without expanding actions

**Files:**
- Modify: `tests/ops-task-model.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `src/features/tasks/ops-task-model.js`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

**Model contract:**

```ts
type WordRetestRoleContext = {
  role: string
  currentTeacherCatalogId: string
}
```

- [ ] **Step 1: Add failing role and automation tests**

Assert:

- the linked teacher sees their own word retest in every state except `done/canceled`;
- an unrelated teacher with the same display name does not see it;
- requester/team/name fallback does not grant ownership;
- an unlinked legacy task stays visible to management and shows
  `담당선생님 계정 연결 필요` without entering the teacher queue;
- admin/staff stage queues remain unchanged;
- assistant shared queue remains unchanged;
- teacher action availability remains stage-specific;
- opening an expired requested/confirmed/on-hold row as a teacher performs
  zero `reportWordRetestAbsent` mutations and shows no guard error;
- admin/staff/assistant keep the existing automatic absence behavior;
- adding `expectedRetestAt` does not add a calendar item;
- period filtering and auto-absence still use `testAt`.

- [ ] **Step 2: Run model tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types \
  tests/ops-task-model.test.mjs \
  tests/ops-task-workspace.test.mjs
```

- [ ] **Step 3: Separate visibility from action ownership**

Replace broad `matchesWordRetestTeacher(...)` ownership with an exact catalog
ID comparison. Add a visibility helper for the teacher tab and a
management-facing `needsWordRetestTeacherAccountLink(...)` helper, but leave
existing stage/action predicates intact.

Admin/staff continue to pass `{}` to the stage queue so their current view does not broaden.

- [ ] **Step 4: Resolve current user's catalog exactly**

Use the already loaded teacher catalog:

```ts
teacherCatalog.profileId === currentUserId
```

Store/pass `currentTeacherCatalogId`. Never use teacher name as an ownership fallback.

- [ ] **Step 5: Render the management-only link warning**

In the existing teacher cell/detail label, show
`담당선생님 계정 연결 필요` for admin/staff when a word retest has no catalog
whose profile is linked. Do not render that task in the teacher queue and do
not synthesize ownership from its teacher name.

- [ ] **Step 6: Gate automatic absence by assistant-action authority**

The auto-absence effect currently iterates the newly broadened visible task
set. Before calling `reportWordRetestAbsent`, require the actual profile role
to be `admin`, `staff`, or `assistant`. A linked `teacher` may see the expired
row but must not trigger assistant automation simply by opening the page.

- [ ] **Step 7: Run model tests and verify GREEN**

Run the command from Step 2. Expected: zero failures.

- [ ] **Step 8: Commit the role unit**

```bash
git add -p \
  tests/ops-task-model.test.mjs \
  tests/ops-task-workspace.test.mjs \
  src/features/tasks/ops-task-model.js \
  src/features/tasks/ops-task-workspace.tsx
git diff --cached --check
git diff --cached
git commit -m "fix: use exact word retest teacher ownership"
```

---

### Task 4: Expose complete draft and one-shot focus from the date-time picker

**Files:**
- Modify: `tests/date-time-picker.test.mjs`
- Modify: `src/components/ui/date-time-picker.tsx`

**Interfaces:**

```ts
export type DateTimePickerDraftState = {
  date: string
  time: string
  isComplete: boolean
  isPartial: boolean
}

type DatePickerControlProps = {
  // existing props
  triggerRef?: React.Ref<HTMLButtonElement>
}

type DateTimePickerControlProps = {
  // existing props
  dateTriggerRef?: React.Ref<HTMLButtonElement>
  onDraftStateChange?: (state: DateTimePickerDraftState) => void
}
```

- [ ] **Step 1: Add failing component contract tests**

Cover:

- initial empty draft;
- date-only and time-only drafts set `isPartial`;
- complete date+time sets `isComplete`;
- clear emits an empty draft;
- external value reset synchronizes the draft;
- date trigger ref reaches the actual button;
- existing keyboard and `disablePortal` behavior remains.

- [ ] **Step 2: Run tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types tests/date-time-picker.test.mjs
```

- [ ] **Step 3: Forward the trigger ref**

Wire:

```text
DateTimePickerControl.dateTriggerRef
  -> DatePickerControl.triggerRef
  -> Button ref
```

- [ ] **Step 4: Emit draft state on every transition**

Centralize emission after date/time selection, clear, and external reset. Do not create a saved value until both fields are present.

- [ ] **Step 5: Run tests and verify GREEN**

Run the command from Step 2. Expected: zero failures.

- [ ] **Step 6: Commit the picker unit**

```bash
git add -p tests/date-time-picker.test.mjs src/components/ui/date-time-picker.tsx
git diff --cached --check
git diff --cached
git commit -m "feat: expose date time picker draft state"
```

---

### Task 5: Extract the shared inline class-schedule calendar

**Files:**
- Modify: `tests/ops-task-workspace.test.mjs`
- Create: `src/features/tasks/class-schedule-calendar-surface.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

**Visual-only interface:**

```ts
type ClassScheduleCalendarDay = {
  key: string
  displayLabel: string
  inCurrentMonth: boolean
  isToday: boolean
  selected: boolean
  disabled: boolean
  tone:
    | "default"
    | "muted"
    | "today"
    | "billing-previous"
    | "billing-current"
    | "billing-next"
  badges: Array<{
    primary: string
    secondary: string
    tone: "default" | "class" | "holiday" | "makeup" | "completed"
  }>
  ariaLabel: string
}

type ClassScheduleCalendarSurfaceProps = {
  monthLabel: string
  weekdayLabels: string[]
  days: ClassScheduleCalendarDay[]
  onPreviousMonth: () => void
  onNextMonth: () => void
  onSelectDay: (key: string) => void
}
```

- [ ] **Step 1: Add failing extraction and behavior tests**

Assert:

- the shared surface owns only month navigation, weekday header, 42 cells,
  structured two-line labels/badges, billing-month tones, disabled state, and
  focus ring;
- withdrawal wrapper still calculates leave session/progress and its current badges;
- word-retest wrapper is full-width inline, not a Popover;
- class selected with schedule: only class dates enabled;
- class selected without schedule data: all ordinary dates enabled;
- no class selected: dependency message shown;
- selecting a date changes only `testAt`;
- the duplicate `수업일정` chip row is removed.

- [ ] **Step 2: Run workspace tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types tests/ops-task-workspace.test.mjs
```

- [ ] **Step 3: Extract `ClassScheduleCalendarSurface`**

Move visual calendar markup and accessibility behavior only. Keep all withdrawal and word-retest calculations in their wrappers.

- [ ] **Step 4: Rebuild the withdrawal wrapper on the shared surface**

Preserve its current selected-date rules, leave-session/progress calculation, holiday/makeup presentation, and footer indicators.

- [ ] **Step 5: Replace `WordRetestMainExamDateField`**

Remove the small Popover. Render the shared surface inline at full modal width and apply the three approved availability states. Keep `testAt` as the only mutation.

- [ ] **Step 6: Run workspace tests and verify GREEN**

Run the command from Step 2. Expected: zero failures, including withdrawal regressions.

- [ ] **Step 7: Commit the calendar unit**

```bash
git add src/features/tasks/class-schedule-calendar-surface.tsx
git add -p tests/ops-task-workspace.test.mjs src/features/tasks/ops-task-workspace.tsx
git diff --cached --check
git diff --cached
git commit -m "refactor: share inline class schedule calendar"
```

---

### Task 6: Align form order, draft safety, multi-create, and schedule-only save

**Files:**
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

**Edit modes:**

```ts
type WordRetestEditMode = "full" | "expected_only"
type WordRetestEditIntent = "standard_edit" | "expected_quick"
type WordRetestPendingFocus = "expected_retest_date" | ""
```

- [ ] **Step 1: Add failing form tests**

Cover:

- form initial expected value uses explicit Seoul conversion;
- legacy note initial value is `requestNote || task.memo`;
- saving a legacy note promotes it to `requestNote` without erasing `task.memo`;
- attendee section order is main exam calendar, expected time, branch;
- scope order is textbook/unit, note, total/cutoff;
- multi-student create disables expected time, clears it before save, and shows `저장 후 학생별로 입력해 주세요.`;
- retry form starts empty;
- partial expected draft marks the form dirty, shows `날짜와 시간을 모두 선택해 주세요.`, blocks save, and protects close;
- complete draft saves;
- linked teacher in an assistant stage opens `expected_only`;
- expected-only mode renders read-only context plus only the expected-time control;
- expected-only save calls `updateWordRetestExpectedAt`, not the general update RPC;
- the table's expected-time cell sets `expected_quick` and uses expected-only
  mode for admin, staff, assistant, and teacher alike;
- done/canceled always opens read-only detail.

- [ ] **Step 2: Run workspace tests and verify RED**

Run the Task 5 test command.

- [ ] **Step 3: Add form fields and approved ordering**

Update `formFromTask`, form defaults, serialization, and dirty comparison. Move the note block immediately after textbook/unit and before total/cutoff.

- [ ] **Step 4: Enforce multi-student and retry clearing**

When `selectedStudentIds.length > 1`, clear the expected value both in state and immediately before building per-student payloads. Keep the UI disabled while the selection is multiple.

- [ ] **Step 5: Track partial draft independently**

Keep `expectedRetestDraft` in modal state. Include `isPartial` in dirty/close checks. On submit with a partial draft:

1. keep the modal open;
2. set the approved error;
3. focus the date trigger.

- [ ] **Step 6: Add full vs expected-only mode**

Determine the mode from exact teacher ownership and current task stage:

- existing teacher-action stage: keep current full flow;
- linked teacher in assistant stage: expected-only;
- admin/staff: current full flow;
- assistant in an allowed stage: preserve the current full edit flow;
- completed/canceled: detail only.

`expected_quick` overrides those standard-edit rules and always opens
expected-only mode for every editable role. The expected-only submit sends only
task ID, expected time, and current parent revision.

- [ ] **Step 7: Run workspace tests and verify GREEN**

Run the Task 5 test command. Expected: zero failures.

- [ ] **Step 8: Commit the form unit**

```bash
git add -p tests/ops-task-workspace.test.mjs src/features/tasks/ops-task-workspace.tsx
git diff --cached --check
git diff --cached
git commit -m "feat: add safe word retest schedule editing"
```

---

### Task 7: Add the 15-column table, mobile order, notes, detail, and one-shot focus

**Files:**
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

- [ ] **Step 1: Add failing table/detail tests**

Assert exact desktop order:

```text
선택, 상태, 본시험일, 응시예정일시, 담당선생님, 수업, 학생,
교재, 시험범위, 메모, 출제 개수, 커트라인, 맞은 개수, 결과, 다음 액션
```

Also assert:

- expected width 168/min 148;
- note width 220/min 160;
- expected value is exact `YYYY-MM-DD HH:mm`, including `09:00`;
- missing value is `미정`;
- expected cell is a real button and stops row propagation;
- editable click sets `expected_quick`, opens expected-only mode, selects the
  attendee section, focuses the date trigger once, and consumes pending focus;
- completed/canceled click opens detail;
- notes use `requestNote || task.memo`;
- desktop note is one-line tooltip/focus reveal;
- mobile note is two-line clamp;
- mobile order matches the approved 12 groups;
- detail shows main exam, expected time, student, textbook, unit, note, scores, and result.

- [ ] **Step 2: Run workspace tests and verify RED**

Run the Task 5 test command.

- [ ] **Step 3: Add column keys and widths**

Insert:

```ts
"expectedRetestAt"
```

immediately after `testAt`, and:

```ts
"note"
```

immediately after `unit`. Update default/min widths and grid template in the same order.

- [ ] **Step 4: Render expected time and note cells**

Use an explicit Seoul formatter that always includes time. Stop click propagation before opening edit/detail.

For notes, use the fallback once:

```ts
const note = text(task.wordRetest?.requestNote) || text(task.memo)
```

Reuse that value in desktop, mobile, modal initialization, and detail.

- [ ] **Step 5: Implement pending one-shot focus**

Store `pendingFocusTarget` when a cell opens edit. After modal mount and attendee section render, use `requestAnimationFrame` to focus the picker date trigger. Clear the pending target only after `ref.current` exists and focus succeeds.

- [ ] **Step 6: Reorder mobile and detail content**

Follow the approved order and ensure nested cell buttons do not trigger score save, row open, or status transitions.

- [ ] **Step 7: Run workspace tests and verify GREEN**

Run the Task 5 test command. Expected: zero failures.

- [ ] **Step 8: Commit the table unit**

```bash
git add -p tests/ops-task-workspace.test.mjs src/features/tasks/ops-task-workspace.tsx
git diff --cached --check
git diff --cached
git commit -m "feat: show word retest schedule and notes"
```

---

### Task 8: Verify assistant and linked-teacher workflows in the browser

**Files:**
- Modify: `tests/ops-task-verification-safety.test.mjs`
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
- Create: `src/features/tasks/word-retest-browser-fixture.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

- [ ] **Step 1: Add failing verifier contracts**

Create an exact-query fixture activated only by
`fixture=word-retest-expected-schedule`. It returns immutable task/catalog/
class data and an explicit view role for three separate routes:

- `fixtureRole=assistant`;
- `fixtureRole=teacher`;
- `fixtureRole=admin`.

Extend those rows with:

- a teacher catalog linked to the signed-in teacher profile ID;
- an assistant-stage open row;
- a teacher-action-stage row;
- a completed row;
- a distinguishable expected timestamp;
- one `requestNote` and one legacy `task.memo`;
- a class with schedule and a class without schedule.

Add dedicated `word-retest-expected-schedule-assistant`,
`word-retest-expected-schedule-teacher`, and
`word-retest-expected-schedule-admin` route entries; do not reuse the existing
`open-create` interaction. Require open/assert/cancel only. The verifier must
fail if a create/update/retry/expected-time mutation request occurs.

Add a route-level `beforeNavigation` hook. It must install all Supabase
auth/profile/data block-or-fulfill handlers before `page.goto`, not inside the
post-navigation interaction. Use a separate isolated Playwright context for
each fixture role, and never infer the fixture role from the logged-in admin
profile. The app fixture role exercises the UI branch; pgTAP from Task 1 proves
the real server role.

Add all three fully mocked routes to `deterministicFixtureOnly` so `.env.local`
cannot redirect the verification toward a remote Supabase project. Any
unmatched Supabase request fails the fixture immediately. Keep production
target rejection for every non-deterministic route.
Static safety assertions must prove the fixture module contains no Supabase
write/RPC call and is unreachable without the exact fixture query.

- [ ] **Step 2: Run verifier tests and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types \
  tests/ops-task-verification-safety.test.mjs \
  tests/ops-task-workspace.test.mjs
```

- [ ] **Step 3: Add desktop assistant assertions**

Verify:

- 15-column order;
- main exam immediately followed by expected time;
- unit immediately followed by note;
- note tooltip/focus content;
- inline full-width calendar;
- exact modal scope order;
- partial draft error and close protection;
- no page/modal horizontal overflow.

- [ ] **Step 4: Add linked-teacher assertions**

Verify:

- the linked teacher sees their open assistant-stage row;
- an unrelated/name-only teacher does not;
- expected cell opens expected-only mode;
- date trigger receives focus;
- no assistant-stage score/start/result action is granted;
- no completed/canceled row appears in the linked teacher's open-only queue.
- an expired teacher-visible row causes zero automatic-absence mutation
  requests and no error banner.

- [ ] **Step 5: Add mobile and withdrawal regressions**

Verify the approved mobile content order and two-line note. In the
admin/assistant fixture, open the completed row and confirm it opens read-only
detail. Visit `/admin/withdrawal` and confirm its shared calendar still exposes
the current withdrawal metrics and selection behavior.

- [ ] **Step 6: Keep provider and mutation guards**

Intercept/block Google Chat, Web Push, SOLAPI, notification dispatch, and task mutation requests. Fail if a save request occurs during this interaction.

- [ ] **Step 7: Build and verify the production app on localhost:3000**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  run build
```

Stop only the previously identified stale Next.js PID on port 3000, start the
new production build with `pnpm run start -- -p 3000`, and wait for
`/sign-in` to respond before running:

```bash
OPS_BROWSER_WORKFLOW=1 \
OPS_BROWSER_BASE_URL=http://localhost:3000 \
OPS_BROWSER_ROUTE_FILTER=word-retest-expected-schedule \
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/verify-ops-task-browser-workflow.mjs
```

Expected: assistant, linked teacher, desktop, mobile, and withdrawal regression checks pass with zero save/provider requests.

- [ ] **Step 8: Commit the browser verifier**

```bash
git add -p \
  tests/ops-task-verification-safety.test.mjs \
  scripts/verify-ops-task-browser-workflow.mjs \
  src/features/tasks/ops-task-workspace.tsx
git add src/features/tasks/word-retest-browser-fixture.ts
git diff --cached --check
git diff --cached
git commit -m "test: verify word retest expected schedule"
```

---

### Task 9: Prove concurrent expected-time writes in two sessions

**Files:**
- Modify: `tests/word-retest-expected-at.test.mjs`
- Create: `scripts/verify-word-retest-expected-at-concurrency.mjs`

- [ ] **Step 1: Add a failing verifier contract test**

Assert the script:

- supports `--run` and otherwise reports the unexecuted proof scope;
- requires an authorized local/preview Supabase URL, anon key, service-role
  key, and one authenticated admin/staff actor token;
- refuses the known production project and every unrecognized host;
- decodes the JWT subject and verifies through the service client that the
  profile role is `admin` or `staff`;
- creates one open word-retest fixture with a fixed parent revision;
- creates two independent authenticated clients with that same authorized
  token and releases two distinct-request-ID expected-time calls from a local
  barrier;
- requires exactly one success and one `40001` stale-write rejection;
- verifies the winning expected value and new parent revision;
- verifies unrelated parent/detail fields, excluding automatic child
  `updated_at`, are unchanged;
- verifies source/canonical/job/delivery rows remain zero;
- cleans only its namespaced fixture in reverse foreign-key order.

- [ ] **Step 2: Run the static test and verify RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types tests/word-retest-expected-at.test.mjs
```

- [ ] **Step 3: Implement the verifier**

Follow the target authorization, JWT subject validation, `--run` guard,
namespaced fixture, barrier, and cleanup patterns in
`scripts/verify-registration-subject-track-concurrency.mjs`. Using the same
authorized actor in two independent clients isolates optimistic concurrency
from role rejection. Do not claim that a single pgTAP transaction proves
concurrent stale-write behavior.

- [ ] **Step 4: Run against an authorized local or preview database**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/verify-word-retest-expected-at-concurrency.mjs \
  --run \
  --url "$TIPS_WORD_RETEST_TEST_URL" \
  --anon-key "$TIPS_WORD_RETEST_TEST_ANON_KEY" \
  --service-role-key "$TIPS_WORD_RETEST_TEST_SERVICE_ROLE_KEY" \
  --actor-token "$TIPS_WORD_RETEST_TEST_ACTOR_TOKEN"
```

Expected: one committed expected time, one stale writer, and zero database
notification artifacts. External provider zero remains a browser/worker-spy
assertion.

- [ ] **Step 5: Commit the concurrency verifier**

```bash
git add scripts/verify-word-retest-expected-at-concurrency.mjs
git add -p tests/word-retest-expected-at.test.mjs
git diff --cached --check
git diff --cached
git commit -m "test: verify word retest schedule concurrency"
```

---

### Task 10: Full regression, DB-first preflight, and handoff

**Files:**
- Verify all files in this plan

- [ ] **Step 1: Run focused Node tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types \
  tests/word-retest-expected-at.test.mjs \
  tests/notification-ops-task-producers.test.mjs \
  tests/ops-task-service-loading.test.mjs \
  tests/ops-task-model.test.mjs \
  tests/date-time-picker.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/ops-task-verification-safety.test.mjs
```

- [ ] **Step 2: Run database tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  dlx supabase@2.109.1 test db supabase/tests/word_retest_expected_at_test.sql

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  dlx supabase@2.109.1 test db supabase/tests/notification_ops_task_adapters_test.sql

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  dlx supabase@2.109.1 test db
```

Confirm the notification source/event/job/delivery counts are zero for
expected-only updates.

Run the two-session verifier:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/verify-word-retest-expected-at-concurrency.mjs \
  --run \
  --url "$TIPS_WORD_RETEST_TEST_URL" \
  --anon-key "$TIPS_WORD_RETEST_TEST_ANON_KEY" \
  --service-role-key "$TIPS_WORD_RETEST_TEST_SERVICE_ROLE_KEY" \
  --actor-token "$TIPS_WORD_RETEST_TEST_ACTOR_TOKEN"
```

- [ ] **Step 3: Run targeted lint**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  exec eslint \
  src/features/tasks/ops-task-service.ts \
  src/features/tasks/ops-task-model.js \
  src/features/tasks/word-retest-browser-fixture.ts \
  src/components/ui/date-time-picker.tsx \
  src/features/tasks/class-schedule-calendar-surface.tsx \
  src/features/tasks/ops-task-workspace.tsx \
  tests/word-retest-expected-at.test.mjs \
  tests/ops-task-model.test.mjs \
  tests/date-time-picker.test.mjs \
  tests/ops-task-workspace.test.mjs
```

- [ ] **Step 4: Run production build**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  run build
```

- [ ] **Step 5: Check patch integrity**

```bash
git diff --check
git status --short
```

Confirm:

- no existing migration was edited;
- create/update/retry producer implementations were not redefined;
- `expectedRetestAt` is absent from auto-absence, period filter, calendar, notification schedule comparison, and provider payload code;
- unrelated dirty-worktree changes remain untouched.

- [ ] **Step 6: Apply DB-first deployment preflight**

Before deploying app code, verify on the target DB:

- `expected_retest_at` exists and is nullable `timestamptz`;
- `update_word_retest_expected_at_v1` resolves with the exact signature;
- authenticated has execute and anon does not;
- a transaction-rolled-back expected-only mutation returns the new parent revision and creates no notification artifacts.

Do not deploy the app before this preflight passes.

- [ ] **Step 7: Re-run localhost:3000 browser verification**

Run the Task 8 interaction against the production build and confirm the running server is the new build, not a stale process.

- [ ] **Step 8: Final commit if git metadata is writable**

```bash
git add \
  supabase/migrations/20260726035635_word_retest_expected_at.sql \
  supabase/tests/word_retest_expected_at_test.sql \
  src/features/tasks/class-schedule-calendar-surface.tsx \
  src/features/tasks/word-retest-browser-fixture.ts \
  scripts/verify-word-retest-expected-at-concurrency.mjs \
  tests/word-retest-expected-at.test.mjs
git add -p \
  src/features/tasks/ops-task-service.ts \
  src/features/tasks/ops-task-model.js \
  src/components/ui/date-time-picker.tsx \
  src/features/tasks/ops-task-workspace.tsx \
  scripts/verify-ops-task-browser-workflow.mjs \
  tests/notification-ops-task-producers.test.mjs \
  supabase/tests/notification_ops_task_adapters_test.sql \
  tests/ops-task-service-loading.test.mjs \
  tests/ops-task-model.test.mjs \
  tests/date-time-picker.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/ops-task-verification-safety.test.mjs
git diff --cached --check
git diff --cached
git commit -m "feat: add word retest expected schedule workflow"
```

Do not stage unrelated files. If `.git` is read-only, hand off the verified working-tree diff without claiming a commit.
