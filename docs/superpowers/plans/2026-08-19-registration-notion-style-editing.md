# Registration Notion-Style Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every operator-entered registration fact editable independently of workflow status, preserve true empty states, and fix legacy lesson-session persistence without implicitly changing external delivery or roster state.

**Architecture:** Keep workflow status as navigation/highlight state and move corrections through section-scoped data saves. Add explicit normalization for legacy schedule keys, nullable waiting-detail persistence, and a data-only consultation correction RPC; preserve immutable provider, admission-batch, and roster history while recording when edited enrollment intent needs external reconciliation.

**Tech Stack:** Next.js 16, React 19, TypeScript, JavaScript model helpers, Supabase/Postgres RPCs, Node test runner, ESLint, Vercel

**Spec:** `docs/superpowers/specs/2026-08-19-registration-notion-style-editing-design.md`

## Global Constraints

- `permissions.canManage` is the edit authorization boundary for operator-entered registration facts.
- Workflow status must not hide or lock previously entered facts.
- Empty database values must render as empty controls and `입력 없음`; no synthetic waiting defaults.
- Data corrections must not send AlimTalk, call MakeEdu, issue invoices, change payment state, or mutate roster history.
- Keep optimistic-concurrency, idempotency-key, subject/class, textbook/class, and session-integrity checks.
- Create migrations with `supabase migration new`; do not hand-invent a migration ledger filename.
- Never expose the Supabase service role or other credentials in source, tests, logs, or plan output.

---

## File Map

- `src/features/tasks/registration-workflow.js`: normalize legacy and normalized lesson-session choices.
- `src/features/tasks/registration-track-model.js` and `.d.ts`: pure empty-state/edit-state helpers shared by UI and tests.
- `src/features/tasks/registration-application-track-actions.tsx`: waiting, director, and consultation editors.
- `src/features/tasks/registration-track-editor.tsx`: remove workflow-status rendering gates for operator facts.
- `src/features/tasks/registration-enrollment-editor.tsx`: allow intent corrections and show external reconciliation state.
- `src/features/tasks/registration-track-service.ts`: typed RPC adapters for nullable waiting details and consultation corrections.
- Migration path: run `supabase migration new registration_notion_style_editing`, store its printed path in `REGISTRATION_EDITING_MIGRATION`, and use that exact file for all SQL tasks.
- `tests/registration-workflow.test.mjs`: schedule serialization regressions.
- `tests/registration-track-model.test.mjs`: pure empty/edit state rules.
- `tests/registration-track-workspace.test.mjs`: source/UI contracts for all-stage editing.
- `tests/registration-track-service.test.mjs`: exact RPC names and nullable payload mapping.
- `tests/registration-track-schema.test.mjs`: SQL security, idempotency, data-only, and no-provider/no-roster contracts.
- `tests/registration-observation-enrollment-source.test.mjs`: enrollment detail correction versus canonical operational enrollment.

---

### Task 1: Fix the legacy lesson-session key contract

**Files:**
- Modify: `src/features/tasks/registration-workflow.js`
- Test: `tests/registration-workflow.test.mjs`

**Interfaces:**
- Consumes: `getSelectableRegistrationScheduleSessions(schedulePlan, { normalized })`
- Produces: legacy choices with `value = "YYYY-MM-DD:sessionNumber"` and no `lessonSessionId`; normalized choices remain unchanged.

- [ ] **Step 1: Change the existing legacy regression expectation before production code**

```js
test("registration schedule choices canonicalize a legacy UUID key to date and sequence", () => {
  assert.deepEqual(getSelectableRegistrationScheduleSessions({
    sessions: [{
      id: "10000000-0000-4000-8000-000000000011",
      sessionKey: "10000000-0000-4000-8000-000000000011",
      date: "2026-08-03",
      scheduleState: "active",
      sessionNumber: 1,
    }],
  }, { normalized: false }), [{
    value: "2026-08-03:1",
    dateKey: "2026-08-03",
    sessionNumber: 1,
    sessionLabel: "1회차",
    state: "active",
  }])
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --experimental-strip-types --test-name-pattern='canonicalize a legacy UUID key' tests/registration-workflow.test.mjs
```

Expected: FAIL because the current value is the UUID session key.

- [ ] **Step 3: Make session-key selection storage-mode aware**

Change the core calculation to:

```js
const normalizedSessionKey = text(entry.sessionKey || entry.session_key)
const value = options.normalized === false
  ? `${dateKey}:${sessionNumber}`
  : normalizedSessionKey || `${dateKey}:${sessionNumber}`
```

Keep the existing positive-session-number validation for legacy rows and keep `lessonSessionId` omitted when `normalized === false`.

- [ ] **Step 4: Run the schedule tests and verify GREEN**

```bash
node --test --experimental-strip-types --test-name-pattern='registration schedule choices|R77 registration schedule' tests/registration-workflow.test.mjs
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit the independent fix**

```bash
git add src/features/tasks/registration-workflow.js tests/registration-workflow.test.mjs
git commit -m "fix: canonicalize legacy enrollment sessions"
```

---

### Task 2: Model true empty waiting details

**Files:**
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Test: `tests/registration-track-model.test.mjs`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces: `getRegistrationWaitingDetailsDraft(track, currentClassWaitClassId)` returning `{ waitingKind, classId, retakeDecision, persisted }`.
- `persisted` is true only when a waiting-detail column contains a stored value; workflow-history `waitingKind` is not a detail fallback.

- [ ] **Step 1: Write pure model tests for empty and persisted values**

```js
test("waiting details stay empty until an operator stores them", () => {
  assert.deepEqual(getRegistrationWaitingDetailsDraft({
    waitingKind: "current_term_opening",
    waitingDetailKind: "",
    waitingDetailClassId: null,
    waitingDetailRetakeDecision: "",
  }, ""), {
    waitingKind: "",
    classId: "",
    retakeDecision: "",
    persisted: false,
  })
})

test("waiting detail columns restore the operator's saved values", () => {
  assert.deepEqual(getRegistrationWaitingDetailsDraft({
    waitingDetailKind: "current_class",
    waitingDetailClassId: "class-1",
    waitingDetailRetakeDecision: "required",
  }, "class-history"), {
    waitingKind: "current_class",
    classId: "class-1",
    retakeDecision: "required",
    persisted: true,
  })
})
```

- [ ] **Step 2: Run the focused model tests and verify RED**

```bash
node --test --experimental-strip-types --test-name-pattern='waiting details stay empty|waiting detail columns restore' tests/registration-track-model.test.mjs
```

Expected: FAIL because the helper is not exported.

- [ ] **Step 3: Implement and type the pure helper**

```js
export function getRegistrationWaitingDetailsDraft(track = {}) {
  const waitingKind = enrollmentText(track.waitingDetailKind)
  const classId = waitingKind === "current_class"
    ? enrollmentText(track.waitingDetailClassId)
    : ""
  const retakeDecision = enrollmentText(track.waitingDetailRetakeDecision)
  return {
    waitingKind,
    classId,
    retakeDecision,
    persisted: Boolean(waitingKind || classId || retakeDecision),
  }
}
```

Declare the exact return union in `.d.ts` using existing `RegistrationWaitingKind` and `"" | "required" | "not_required"` values.

- [ ] **Step 4: Add the UI contract test before editing the component**

Assert the waiting editor:

```js
assert.match(waitingSource, /getRegistrationWaitingDetailsDraft\(track/)
assert.doesNotMatch(waitingSource, /\|\| "current_term_opening"/)
assert.doesNotMatch(waitingSource, /\|\| "not_required"/)
assert.match(waitingSource, /cleanLabel=\{savedWaitingPersisted \? "저장됨" : "입력 없음"\}/)
```

Run the named workspace test and verify it fails.

- [ ] **Step 5: Use the helper and expose explicit optional retake selection**

Initialize the component from the helper, add a `RegistrationSelect` for 재응시 with no selected value, and set the save button label from `persisted`. Add a visible `입력 지우기` button only when the saved or draft state contains at least one value.

- [ ] **Step 6: Run model and workspace tests**

```bash
node --test --experimental-strip-types tests/registration-track-model.test.mjs
node --test --experimental-strip-types --test-name-pattern='waiting details' tests/registration-track-workspace.test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/registration-track-model.js src/features/tasks/registration-track-model.d.ts src/features/tasks/registration-application-track-actions.tsx tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs
git commit -m "fix: preserve empty registration waiting details"
```

---

### Task 3: Persist nullable and clearable waiting details

**Files:**
- Create: run `supabase migration new registration_notion_style_editing`; use the generated `supabase/migrations/*_registration_notion_style_editing.sql`
- Modify: `src/features/tasks/registration-track-service.ts`
- Test: `tests/registration-track-service.test.mjs`
- Test: `tests/registration-track-schema.test.mjs`

**Interfaces:**
- Produces RPC: `public.save_registration_waiting_details_v2(uuid,text,uuid,text,text) -> jsonb`.
- Empty contract: all three detail values may be null together; `current_class` requires a class; other kinds reject a class; retake may independently be null.

- [ ] **Step 1: Check current Supabase guidance before SQL work**

Fetch `https://supabase.com/changelog.md`, scan relevant breaking changes, and query official docs for Postgres functions, RLS, and function grants. Record only applicable constraints in the implementation notes; do not add unrelated dependency changes.

- [ ] **Step 2: Create the migration through the CLI**

```bash
supabase --version
supabase migration new registration_notion_style_editing
```

Use the exact path printed by the CLI in every later `git add` command.

- [ ] **Step 3: Write failing SQL contract assertions**

Assert that the migration:

```js
assert.match(sql, /create or replace function public\.save_registration_waiting_details_v2\(/i)
assert.match(sql, /v_waiting_kind is null[\s\S]*v_class_id is null[\s\S]*v_retake_decision is null/i)
assert.match(sql, /waiting_detail_kind = v_waiting_kind[\s\S]*waiting_detail_class_id = v_class_id[\s\S]*waiting_detail_retake_decision = v_retake_decision/i)
assert.match(sql, /revoke execute[\s\S]*from public, anon/i)
assert.match(sql, /grant execute[\s\S]*to authenticated/i)
```

Run the focused schema test and verify RED.

- [ ] **Step 4: Implement the RPC with access, idempotency, and clear semantics**

The function must:

1. normalize empty text to null;
2. validate the allowed combinations described above;
3. lock the track and call `dashboard_private.assert_registration_mutation_access`;
4. use the existing actor/request-key mutation ledger;
5. update only the three `waiting_detail_*` columns and `updated_at`;
6. write a version-2 user event without changing pipeline/workflow status;
7. return nullable camel-case response fields.

- [ ] **Step 5: Write the service test before adapter changes**

```js
await service.saveRegistrationWaitingDetails({
  trackId: "track-1",
  waitingKind: "",
  classId: "",
  retakeDecision: "",
  requestKey: key,
})
assert.deepEqual(lastRpc, {
  name: "save_registration_waiting_details_v2",
  args: {
    p_track_id: "track-1",
    p_waiting_kind: null,
    p_class_id: null,
    p_retake_decision: null,
    p_request_key: key,
  },
})
```

- [ ] **Step 6: Switch the service adapter and wire the clear button**

Use the v2 RPC and nullable payloads. The clear button must submit all empty fields; it must not fake a local clear without persistence.

- [ ] **Step 7: Run schema, service, and waiting UI tests**

```bash
node --test --experimental-strip-types --test-name-pattern='waiting details' tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/*_registration_notion_style_editing.sql src/features/tasks/registration-track-service.ts src/features/tasks/registration-application-track-actions.tsx tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
git commit -m "feat: make registration waiting details clearable"
```

---

### Task 4: Make consultation ownership and results status-independent

**Files:**
- Modify: `supabase/migrations/*_registration_notion_style_editing.sql`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-track-service.ts`
- Test: `tests/registration-track-schema.test.mjs`
- Test: `tests/registration-track-service.test.mjs`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces RPC: `public.correct_registration_consultation_result_v1(uuid,text,text,integer,text) -> jsonb`.
- Correction changes only consultation outcome/note and revision metadata; it never changes track status, waiting details, observation rows, enrollment rows, notifications, or external systems.

- [ ] **Step 1: Write failing UI contracts**

```js
assert.doesNotMatch(directorSection, /REGISTRATION_DIRECTOR_EDITABLE_STATUSES/)
assert.match(directorSection, /const canEdit = permissions\.canManage/)
assert.doesNotMatch(editorSource, /REGISTRATION_DIRECTOR_VISIBLE_STATUSES\.has\(context\.track\.status\)/)
assert.match(outcomeSource, /permissions\.canManage/)
```

Also assert every supported status renders the director section and that `registered`, `not_registered`, and `inquiry_closed` remain editable for managers.

- [ ] **Step 2: Verify RED, then remove status and owner locks in UI**

Keep only saving, loading/catalog failure, conflict, and authorization locks. The director selector must display saved inactive/missing profiles as a preserved current option until an active replacement is selected.

- [ ] **Step 3: Write failing DB tests for a data-only consultation correction and row revision**

The schema test must prove the function:

```js
assert.match(sql, /create or replace function public\.correct_registration_consultation_result_v1\(/i)
assert.match(sql, /add column if not exists revision integer not null default 1/i)
assert.match(sql, /update public\.ops_registration_consultations[\s\S]*outcome = v_outcome[\s\S]*note = v_note/i)
assert.match(sql, /revision = consultation\.revision \+ 1/i)
assert.doesNotMatch(correctionBody, /update public\.ops_registration_subject_tracks/)
assert.doesNotMatch(correctionBody, /ops_registration_enrollments|ops_registration_observations|notification|webhook|solapi/i)
```

- [ ] **Step 4: Implement the data-only RPC**

Add `ops_registration_consultations.revision integer not null default 1 check (revision > 0)` and expose it in the existing detail projections and service mapper. Require an authenticated active manager, exact consultation/track/task membership, expected consultation revision, and request-key idempotency. Permit `undecided`, `waiting`, `observation`, `enrollment`, and `not_registered`; normalize an empty note to null. Update the consultation record, increment its revision, and write a user correction event without modifying workflow status.

- [ ] **Step 5: Add and test the service adapter**

Add:

```ts
correctRegistrationConsultationResult(input: {
  consultationId: string
  outcome: RegistrationConsultationOutcome
  note: string
  expectedRevision: number
  requestKey: string
}): Promise<OpsRegistrationConsultation>
```

Assert the exact RPC name and snake-case arguments before implementation.

- [ ] **Step 6: Route existing completed consultations through correction**

Use the existing completion RPC only when creating the first completed result. When a result already exists, use `correctRegistrationConsultationResult`; never infer a workflow transition from the edited result. The status combobox remains the explicit workflow control.

- [ ] **Step 7: Run focused tests and commit**

```bash
node --test --experimental-strip-types --test-name-pattern='director|consultation result|consultation correction' tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
git add supabase/migrations/*_registration_notion_style_editing.sql src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-track-service.ts tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
git commit -m "feat: allow status-independent consultation corrections"
```

---

### Task 5: Correct existing appointments without workflow transitions

**Files:**
- Modify: `supabase/migrations/*_registration_notion_style_editing.sql`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Test: `tests/registration-track-schema.test.mjs`
- Test: `tests/registration-track-service.test.mjs`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces RPC: `public.correct_registration_appointment_v1(uuid,timestamptz,text,integer,text) -> jsonb`.
- Consumes `OpsRegistrationAppointment.notificationRevision` for optimistic concurrency.
- Updates appointment schedule/place and revision only; track, level-test, consultation status, and provider delivery remain unchanged.

- [ ] **Step 1: Write the failing schema contract**

```js
assert.match(sql, /create or replace function public\.correct_registration_appointment_v1\(/i)
assert.match(appointmentCorrection, /p_expected_notification_revision integer/)
assert.match(appointmentCorrection, /scheduled_at = p_scheduled_at[\s\S]*place = v_place[\s\S]*notification_revision = appointment\.notification_revision \+ 1/i)
assert.doesNotMatch(appointmentCorrection, /update public\.ops_registration_subject_tracks|update public\.ops_registration_level_tests|update public\.ops_registration_consultations/i)
assert.doesNotMatch(appointmentCorrection, /webhook|solapi|http_post|notification_deliveries/i)
```

- [ ] **Step 2: Implement the data-only appointment correction RPC**

Require active-manager access, task membership, a non-empty allowed place, valid timestamp, exact notification revision, and request-key idempotency. Lock the appointment, update only `scheduled_at`, `place`, `notification_revision`, and `updated_at`, cancel any still-pending reminder with `source_schedule_changed`, write a user correction event, and return the updated appointment. Do not change the appointment or child status.

- [ ] **Step 3: Write the service adapter test before implementation**

```js
await service.correctRegistrationAppointment({
  appointmentId: "appointment-1",
  scheduledAt: "2026-08-11T14:00:00+09:00",
  place: "본관",
  expectedNotificationRevision: 3,
  requestKey: key,
})
assert.equal(lastRpc.name, "correct_registration_appointment_v1")
assert.equal(lastRpc.args.p_expected_notification_revision, 3)
```

- [ ] **Step 4: Add the typed adapter and route edits of existing appointments through it**

Add:

```ts
correctRegistrationAppointment(input: {
  appointmentId: string
  scheduledAt: string
  place: string
  expectedNotificationRevision: number
  requestKey: string
}): Promise<OpsRegistrationAppointment>
```

Keep the existing appointment-creation RPC for records without an appointment ID. Existing appointments use the correction RPC regardless of workflow status.

- [ ] **Step 5: Verify no workflow or provider effects and commit**

```bash
node --test --experimental-strip-types --test-name-pattern='appointment correction|existing appointment' tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
git add supabase/migrations/*_registration_notion_style_editing.sql src/features/tasks/registration-track-service.ts src/features/tasks/registration-application-track-actions.tsx tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
git commit -m "feat: add status-independent appointment corrections"
```

---

### Task 6: Preserve editability while protecting externalized enrollment history

**Files:**
- Modify: `supabase/migrations/*_registration_notion_style_editing.sql`
- Modify: `src/features/tasks/registration-enrollment-editor.tsx`
- Modify: `src/features/tasks/registration-track-service.ts`
- Test: `tests/registration-observation-enrollment-source.test.mjs`
- Test: `tests/registration-track-schema.test.mjs`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- `save_registration_enrollment_details_v1` continues as the UI save entrypoint.
- Produces response field `externalReconciliationRequired: boolean`.
- Unbatched planned rows update canonical enrollment rows; batched/roster-active history is not modified, while operator intent is stored in `enrollment_detail_rows` and flagged for reconciliation.

- [ ] **Step 1: Write failing SQL isolation tests**

Cover both branches:

```js
assert.match(detailsBody, /v_externalized boolean/)
assert.match(detailsBody, /admission_batch_id is not null|roster_active/)
assert.match(detailsBody, /enrollment_detail_rows = v_validated_rows/)
assert.match(detailsBody, /'externalReconciliationRequired', v_externalized/)
assert.doesNotMatch(externalizedBranch, /update public\.ops_registration_enrollments|delete from public\.ops_registration_enrollments/i)
```

- [ ] **Step 2: Extract non-mutating row validation in SQL**

Add `dashboard_private.validate_registration_enrollment_detail_rows_v1(uuid,jsonb) -> jsonb` that normalizes the request, checks class subject, textbook membership, and lesson session validity, and returns canonical rows without writing enrollment, batch, roster, provider, or notification tables.

- [ ] **Step 3: Branch the enrollment-detail save**

For tracks with no externalized enrollment, preserve the canonical save behavior. For tracks with any batch-linked or roster-active enrollment, validate and write only `ops_registration_subject_tracks.enrollment_detail_rows`, return `externalReconciliationRequired=true`, and record a user event. Never change the externalized enrollment IDs or history.

- [ ] **Step 4: Write the UI contract before changing the editor**

Replace the current lock assertion with:

```js
assert.doesNotMatch(canEditBlock, /!trackHasOpenBatch/)
assert.match(source, /externalReconciliationRequired/)
assert.match(source, /외부 반영 정정 필요/)
```

- [ ] **Step 5: Allow editing and display reconciliation state**

Set `canEditRows` from manage permission plus loading/conflict state only. Map the new response field, reload committed detail rows, and display `외부 반영 정정 필요` without invoking MakeEdu, billing, payment, or roster actions.

- [ ] **Step 6: Run enrollment source/schema/service/workspace tests and commit**

```bash
node --test --experimental-strip-types --test-name-pattern='enrollment detail|external reconciliation|registration start schedule' tests/registration-observation-enrollment-source.test.mjs tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
git add supabase/migrations/*_registration_notion_style_editing.sql src/features/tasks/registration-enrollment-editor.tsx src/features/tasks/registration-track-service.ts tests/registration-observation-enrollment-source.test.mjs tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
git commit -m "feat: separate enrollment corrections from external history"
```

---

### Task 7: Enforce the all-status editing contract across the detail frame

**Files:**
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-application-inquiry-section.tsx`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Test: `tests/registration-track-model.test.mjs`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces: `canEditRegistrationFacts({ canManage, saving, loading, conflict }): boolean`.
- Workflow status, section name, consultation owner, and terminal state are intentionally absent from this interface.

- [ ] **Step 1: Write the pure policy test**

```js
test("registration fact editing depends on authorization and transient locks, not workflow status", () => {
  for (const status of [
    "inquiry", "level_test_scheduled", "level_test_in_progress",
    "consultation_waiting", "visit_consultation_scheduled", "waiting",
    "enrollment_decided", "enrollment_processing", "registered",
    "not_registered", "inquiry_closed",
  ]) {
    assert.equal(canEditRegistrationFacts({ canManage: true, saving: false, loading: false, conflict: false, status }), true)
  }
  assert.equal(canEditRegistrationFacts({ canManage: false }), false)
  assert.equal(canEditRegistrationFacts({ canManage: true, saving: true }), false)
})
```

- [ ] **Step 2: Verify RED and implement the helper without accepting status**

The production signature must omit `status`; the test passes an extra field only to prove it has no effect.

- [ ] **Step 3: Add a source-level inventory test for every operator fact editor**

Extract the inquiry, appointment, director, consultation result, waiting, and enrollment blocks. Assert each uses manage permission plus transient locks and does not compare against `track.status`, `pipelineStatus`, `workflowStatus`, `terminal`, or director ownership to decide field editability.

- [ ] **Step 4: Replace remaining workflow-based field locks**

Use the shared helper or an equivalent direct transient-lock expression. Preserve status restrictions only on external action buttons and destructive/compensating operations, not on textboxes, selectors, calendars, or section save buttons.

- [ ] **Step 5: Verify no synthetic defaults or hidden past sections remain**

Run:

```bash
node --test --experimental-strip-types --test-name-pattern='registration fact editing|all-status editing|waiting details|director' tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/registration-track-model.js src/features/tasks/registration-track-model.d.ts src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-application-inquiry-section.tsx src/features/tasks/registration-application-track-actions.tsx tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs
git commit -m "refactor: decouple registration facts from workflow status"
```

---

### Task 8: Full verification, migration, deployment, and production readback

**Files:**
- Verify all modified files from Tasks 1-7
- Update tests only if a real contract gap is discovered; do not weaken assertions to obtain GREEN.

**Interfaces:**
- Consumes: all task outputs.
- Produces: verified source, production migration, `main`, Vercel Production `READY`, and read-only runtime evidence. Provider delivery remains untouched.

- [ ] **Step 1: Run all focused registration suites**

```bash
node --test --experimental-strip-types tests/registration-workflow.test.mjs
node --test --experimental-strip-types tests/registration-track-model.test.mjs
node --test --experimental-strip-types tests/registration-track-service.test.mjs
node --test --experimental-strip-types tests/registration-track-schema.test.mjs
node --test --experimental-strip-types tests/registration-observation-enrollment-source.test.mjs
node --test --experimental-strip-types --test-name-pattern='schedule|waiting|director|consultation|all-status|external reconciliation' tests/registration-track-workspace.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Run static and production build gates**

```bash
pnpm lint
pnpm build
git diff --check
git status --short
```

Record existing warnings separately from new errors. Do not append `-- --webpack`; the package build script already supplies webpack.

- [ ] **Step 3: Review migration safety before production apply**

Confirm function grants, `auth.uid()`/active-manager checks, mutation-ledger behavior, no provider calls, no roster mutation in correction branches, and no unvalidated dynamic SQL. Run Supabase security and performance advisors after applying the migration and report new versus pre-existing notices.

- [ ] **Step 4: Apply the migration and run read-only SQL checks**

Use the configured Supabase project tooling. Verify the new function signatures with `pg_get_function_identity_arguments`, confirm grants, and read back 김시현's currently null waiting detail fields without changing them.

- [ ] **Step 5: Commit any final migration-ledger/test adjustments, then push `main`**

```bash
git status --short
git log -7 --oneline
git push origin main
git ls-remote origin refs/heads/main
```

- [ ] **Step 6: Verify Vercel Production**

Find the deployment whose `githubCommitSha` equals local `HEAD`. Wait until `target=production` and `readyState=READY`; a different READY deployment does not close the gate.

- [ ] **Step 7: Perform read-only browser verification**

In the authenticated production dashboard, open 김시현's registration detail without saving:

1. confirm 상담 책임자 is a usable selector at `입학 진행 중`;
2. confirm waiting kind, class, and retake are empty and the section says `입력 없음`;
3. open the start schedule and confirm past lesson dates are enabled;
4. select no values and trigger no save, AlimTalk, MakeEdu, billing, payment, or roster action.

Actual successful persistence of a chosen lesson requires the user to identify the intended date or explicitly authorize a test mutation. Report this runtime-write gate separately from code, migration, deploy, and read-only UI evidence.

---

## Final Evidence Format

Report these gates separately:

1. Source and tests: exact suites and pass/fail counts.
2. Migration: filename, production application status, function/grant readback, advisors.
3. GitHub: `main` SHA and remote equality.
4. Vercel: deployment URL, target, and `READY` state for the same SHA.
5. Runtime UI: all-status edit controls and true empty waiting state.
6. Runtime write: whether an explicitly chosen schedule was actually saved.
7. Providers/external systems: no AlimTalk, MakeEdu, invoice, payment, or roster operation unless separately authorized.
