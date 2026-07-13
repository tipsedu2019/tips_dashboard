# Registration Subject Tracks and Multi-Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one student registration case while independently progressing English and mathematics, sharing real appointments when appropriate, and enrolling each subject in multiple classes through a safe `수업 추가` workflow.

**Architecture:** `ops_tasks` and `ops_registration_details` remain the common parent. Six normalized public child tables own subject tracks, shared appointments, level-test attempts, consultations, admission batches, and enrollment rows; an unexposed private table owns idempotency receipts; focused modules keep this logic out of the already-large workspace. Authenticated browser clients receive RLS-scoped reads and invoke only fixed workflow RPCs. Every public mutation is a thin invoker wrapper around a schema-qualified definer implementation in `dashboard_private`; the provider finalizer is the isolated service-role-only member of that same fixed API. Compatibility projections keep legacy readers operational during rollout.

**Tech Stack:** Next.js 16.1.1, React 19.2.3, TypeScript 5.9.3, Supabase JS 2.103.1, Supabase CLI 2.109.1 via `pnpm dlx`, PostgreSQL/RLS, Node test runner, Tailwind CSS 4, Radix/shadcn components.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-07-12-registration-subject-tracks-and-multi-enrollment-design.md` and is authoritative.
- Preserve one parent registration case. Never create duplicate `ops_tasks` rows per subject.
- Top-level tab counts are subject-track counts; the same student may appear in different tabs for different subjects.
- Phone consultations have no reservation time. Completion stamps server time and requires a subject-specific outcome.
- Level-test and visit appointments may be shared, but results and consultation outcomes remain subject-specific.
- Every registration track may contain multiple enrollment rows. Each row owns class, optional textbook, schedule, MakeEdu status, and admission-batch membership.
- Admission application is case-level once. MakeEdu confirmation is enrollment-level. Invoice and payment confirmation are admission-batch-level so later classes cannot reuse older payment state.
- Keep list loading narrow. Appointment, consultation, enrollment, textbook, roster, and schedule detail remains lazy.
- All six new `public` business tables require explicit authenticated-role grants and RLS in the same migration because new Supabase tables are no longer guaranteed to be exposed to the Data API automatically.
- Receipt-backed mutations store idempotency in `dashboard_private`, keyed by authenticated actor plus request key. The one-shot message claim and service-role finalizer intentionally use no receipt. Grant no private-table privileges to browser roles or expose this schema.
- Public RPC wrappers are `SECURITY INVOKER`; exact private implementations are `SECURITY DEFINER`, empty-search-path, schema-qualified, and fixed-purpose. Authenticated functions validate caller/parent access and revoke public/anon execution. The finalizer instead validates service role and revokes authenticated execution too.
- Do not use `service_role` in browser code. Do not use user-editable JWT metadata for authorization.
- Do not send real customer messages or Google Chat messages in automated tests.
- Do not apply a remote migration, deploy, or mutate production data without separate authorization.
- Preserve all existing dirty-worktree changes. Do not stage, commit, push, reset, or delete unrelated files during this execution.
- Generate schema and mutation migrations with `pnpm dlx supabase@2.109.1 migration new registration_subject_tracks_schema` and `pnpm dlx supabase@2.109.1 migration new registration_subject_track_mutations`; never invent migration timestamps.
- Verify Supabase CLI commands with `--help` before using them.
- The current machine has no Docker, Postgres, Podman, or Colima executable, and this repository's migration history assumes pre-existing base tables. Do not claim that `supabase db reset --local` or pgTAP ran here.
- Runtime migration verification requires either a separately authorized Supabase preview branch or a future machine with a complete local database baseline. Until then, keep migrations unapplied and report runtime DB verification as pending rather than using production.

## File Structure

### New focused modules

- `src/features/tasks/registration-track-model.js`: pure status, transition, tab, parent projection, appointment, waitlist, and admission-batch rules.
- `src/features/tasks/registration-track-model.d.ts`: exact JavaScript model interfaces for TypeScript consumers.
- `src/features/tasks/registration-track-service.ts`: typed Supabase readers and RPC wrappers for track summaries, case detail, appointments, consultations, enrollments, and batches.
- `src/features/tasks/registration-track-list.tsx`: track-flattened desktop/mobile list rows and subject-scoped actions.
- `src/features/tasks/registration-track-editor.tsx`: unified subject navigation, legacy-review gate, and common case shell.
- `src/features/tasks/registration-appointment-editor.tsx`: shared level-test and visit-appointment creation/editing.
- `src/features/tasks/registration-enrollment-editor.tsx`: repeated class rows, per-row lazy class hydration, textbook defaults, schedules, and batch checklist.
- `src/app/api/solapi/registration/legacy.ts`: temporary exact-legacy message adapter, reachable only when both readiness function and child tables are absent.
- `src/features/tasks/registration-track-fixtures.ts`: development-only in-memory multi-subject QA cases and reducers, unreachable in production.
- `tests/registration-track-model.test.mjs`: pure workflow and projection behavior.
- `tests/registration-track-schema.test.mjs`: migration/RLS/grant/function/backfill source contract.
- `tests/registration-track-service.test.mjs`: loader projections, fallback, cache, and RPC wrapper behavior.
- `tests/registration-track-workspace.test.mjs`: UI source contract and extracted pure view helpers.
- `tests/registration-track-fixtures.test.mjs`: fixture gating, deterministic transitions, and zero external-write contract.

### Existing integration points

- `src/features/tasks/ops-task-service.ts`: add child summaries to registration reads, delegate registration mutations to the focused service, and retain legacy fallback.
- `src/features/tasks/ops-task-workspace.tsx`: replace case-wide registration rendering with the focused list/editor components while retaining neighboring operation types.
- `src/features/tasks/registration-workflow.js`: keep legacy workflow helpers for fallback rows and delegate new rows to `registration-track-model.js`.
- `src/features/tasks/registration-consultation-notification.js`: create appointment/track-aware notification keys and canonical payload helpers.
- `src/app/api/registration/consultation-notification/route.ts`: reload appointment, track, director, and task data before sending visit notifications.
- `scripts/verify-ops-task-sample-workflow.mjs`: add safe in-memory subject-track samples without external writes.
- `scripts/verify-ops-task-browser-workflow.mjs`: add browser assertions for track tabs, phone queue, shared appointments, and repeated classes.
- `tests/registration-workflow.test.mjs`, `tests/ops-task-workspace.test.mjs`, `tests/registration-service-hardening.test.mjs`, `tests/ops-task-service-loading.test.mjs`, and `tests/registration-consultation-notification.test.mjs`: preserve legacy behavior and add integration contracts.

### CLI-generated migrations

- `registration_subject_tracks_schema`: six public business tables plus one private idempotency-receipt table, constraints, indexes, triggers, explicit grants, RLS policies, deterministic backfill, and compatibility fields.
- `registration_subject_track_mutations`: public invoker wrappers, private access-validating definer implementations/helpers, idempotency receipts, final-state guards, function privileges, and rollback-safe roster/history updates.

---

### Execution-shell bootstrap

Run this once in every new implementation shell before Task 0 or any `node`, `pnpm`, or Supabase CLI command. The desktop shell currently does not expose Node on its inherited `PATH`; the bundled workspace runtime is the required baseline:

```bash
export CODEX_RUNTIME_DEPS="/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies"
export PATH="$CODEX_RUNTIME_DEPS/node/bin:$CODEX_RUNTIME_DEPS/bin/override:$CODEX_RUNTIME_DEPS/bin/fallback:$PATH"
hash -r
test -x "$CODEX_RUNTIME_DEPS/node/bin/node"
node --version
pnpm --version
```

Expected: Node `v24.14.0` and the bundled pnpm both resolve. If either executable is missing, stop and reload the workspace dependency paths through the Codex app instead of running tests with a different implicit runtime. Every command block below assumes this bootstrap remains active.

---

### Task 0: Capture the dirty-worktree baseline before implementation

**Files:**
- Modify only during execution: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Record immutable context without changing Git history**

Run `git rev-parse HEAD`, `git status --short`, `node --version`, and `pnpm --version`; paste outputs and the current date into the progress file. Do not stage, commit, stash, reset, or clean the existing worktree.

- [ ] **Step 2: Capture the pre-feature test baseline**

Run the existing focused registration/loading/date/director/notification suites and then `node --test tests/*.test.mjs` before creating any Task 1 code. Record exact pass/fail counts and full failing test names. These measured failures, not hard-coded assumptions later in this plan, are the only allowable baseline failures.

- [ ] **Step 3: Capture warm-route loading measurements**

Start/reuse the local server, perform one warm-up navigation, then measure five navigations of `/admin/registration`. Record median initial route render, current parent-list hydration, current workspace-option hydration, and request counts from the existing browser verification script. The current service starts the task read plus profiles, students, classes, textbooks, and teacher-catalog reads concurrently in one `Promise.all`; record each request's duration, row count, and approximate response size, plus the slowest request/critical-path maximum, so removal of the student roster payload is attributed correctly. Preserve screenshots/console errors in the progress note. The implementation must not regress either median by more than 20%, and the final warm initial route must remain at or below 1.5 seconds; if the existing baseline already exceeds that ceiling, optimization is required rather than accepting the old number.

---

### Task 1: Pure subject-track workflow model

**Files:**
- Create: `src/features/tasks/registration-track-model.js`
- Create: `src/features/tasks/registration-track-model.d.ts`
- Test: `tests/registration-track-model.test.mjs`

**Interfaces:**
- Produces: `RegistrationTrackStatus`, `RegistrationTrackViewKey`, `RegistrationTrackSummary`, `RegistrationAdmissionBatchSummary`.
- Produces: `getRegistrationTrackViewKey(status)`, `getRegistrationTrackTabCounts(tracks)`, `isRegistrationTrackTerminal(status)`, `getRegistrationTrackNextStatus(input)`, `getRegistrationTrackTransitionBlockers(input)`, `getRegistrationLevelTestAppointmentStatus(attempts)`, `canEditRegistrationAppointment(activities)`, `getRegistrationSummaryActionPermissions(input)`, `getRegistrationActionPermissions(input)`, and `deriveRegistrationParentState(input)`.
- Consumes: no application state or Supabase client; every export is pure.

- [ ] **Step 1: Write failing status, transition, appointment, and parent-projection tests**

```js
import test from "node:test"
import assert from "node:assert/strict"
import {
  canEditRegistrationAppointment,
  deriveRegistrationParentState,
  getRegistrationLevelTestAppointmentStatus,
  getRegistrationSummaryActionPermissions,
  getRegistrationActionPermissions,
  getRegistrationTrackNextStatus,
  getRegistrationTrackTabCounts,
  getRegistrationTrackTransitionBlockers,
  getRegistrationTrackViewKey,
} from "../src/features/tasks/registration-track-model.js"

test("track statuses map one-to-one to the six registration tabs", () => {
  assert.equal(getRegistrationTrackViewKey("inquiry"), "inquiry")
  assert.equal(getRegistrationTrackViewKey("migration_review"), "inquiry")
  assert.equal(getRegistrationTrackViewKey("level_test_scheduled"), "level_test")
  assert.equal(getRegistrationTrackViewKey("consultation_waiting"), "consulting")
  assert.equal(getRegistrationTrackViewKey("waiting"), "waiting")
  assert.equal(getRegistrationTrackViewKey("enrollment_processing"), "enrollment")
  assert.equal(getRegistrationTrackViewKey("registered"), "closed")
})

test("tab counts count subject tracks rather than parent cases", () => {
  assert.deepEqual(getRegistrationTrackTabCounts([
    { id: "english", taskId: "case-1", status: "consultation_waiting" },
    { id: "math", taskId: "case-1", status: "level_test_scheduled" },
  ]), { inquiry: 0, level_test: 1, consulting: 1, waiting: 0, enrollment: 0, closed: 0 })
})

test("phone consultation completion requires an outcome and advances atomically", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "consultation_waiting",
    action: "complete_phone_consultation",
    outcome: "",
  }), ["상담 결과"])
  assert.equal(getRegistrationTrackNextStatus({
    status: "consultation_waiting",
    action: "complete_phone_consultation",
    outcome: "enrollment",
  }), "enrollment_decided")
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "visit_consultation_scheduled",
    action: "complete_visit_consultation",
    outcome: "",
  }), ["상담 결과"])
})

test("level-test completion advances only a completed subject", () => {
  assert.equal(getRegistrationTrackNextStatus({
    status: "level_test_in_progress",
    action: "record_level_test_result",
    resultStatus: "completed",
  }), "consultation_waiting")
  assert.equal(getRegistrationTrackNextStatus({
    status: "level_test_in_progress",
    action: "record_level_test_result",
    resultStatus: "absent",
  }), "level_test_scheduled")
})

test("waiting to enrollment requires an explicit retake decision", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "waiting",
    action: "move_to_enrollment",
    retakeDecision: null,
  }), ["레벨테스트 재응시 여부"])
  assert.equal(getRegistrationTrackNextStatus({
    status: "waiting",
    action: "schedule_level_test",
    retakeDecision: "required",
  }), "level_test_scheduled")
})

test("level-test appointment completes only after every attempt is terminal", () => {
  assert.equal(getRegistrationLevelTestAppointmentStatus([
    { status: "completed", materialLink: "https://drive.test/english" },
    { status: "scheduled", materialLink: "" },
  ]), "scheduled")
  assert.equal(getRegistrationLevelTestAppointmentStatus([
    { status: "completed", materialLink: "https://drive.test/english" },
    { status: "absent", materialLink: "" },
  ]), "completed")
  assert.equal(getRegistrationLevelTestAppointmentStatus([
    { status: "canceled", materialLink: "" },
    { status: "canceled", materialLink: "" },
  ]), "canceled")
  assert.equal(canEditRegistrationAppointment([{ status: "completed" }, { status: "scheduled" }]), false)
})

test("parent stays open for tracks or admission batches still in progress", () => {
  assert.deepEqual(deriveRegistrationParentState({
    tracks: [{ status: "registered" }, { status: "waiting" }],
    batches: [{ status: "completed" }],
  }), { taskStatus: "in_progress", outcome: "" })
  assert.deepEqual(deriveRegistrationParentState({
    tracks: [{ status: "registered" }, { status: "not_registered" }],
    batches: [{ status: "completed" }],
  }), { taskStatus: "done", outcome: "partial_registration" })
  assert.deepEqual(deriveRegistrationParentState({
    tracks: [{ status: "inquiry" }],
    batches: [{ status: "draft" }],
  }), { taskStatus: "in_progress", outcome: "" })
})

test("illegal cross-stage actions are blocked instead of silently jumping stages", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "inquiry",
    action: "complete_enrollment",
  }), ["현재 단계에서 할 수 없는 작업"])
  assert.equal(getRegistrationTrackNextStatus({
    status: "inquiry",
    action: "complete_enrollment",
  }), "inquiry")
})

test("UI action permissions mirror the database mutation matrix", () => {
  const track = { id: "eng", directorProfileId: "director-1", status: "consultation_waiting" }
  const activeConsultation = { trackId: "eng", directorProfileId: "director-1", mode: "phone", status: "waiting" }
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "admin", viewerId: "director-1", track, activeConsultation }), {
    canManage: true,
    canCompleteConsultation: true,
    readOnly: false,
  })
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "admin", viewerId: "director-2", track, activeConsultation }), {
    canManage: true,
    canCompleteConsultation: false,
    readOnly: false,
  })
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "staff", viewerId: "staff-1", track, activeConsultation }), {
    canManage: true,
    canCompleteConsultation: false,
    readOnly: false,
  })
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "assistant", viewerId: "assistant-1", track, activeConsultation }), {
    canManage: false,
    canCompleteConsultation: false,
    readOnly: true,
  })
  assert.equal(getRegistrationActionPermissions({ viewerRole: "teacher", viewerId: "director-1", track, activeConsultation }).canCompleteConsultation, false)
  assert.equal(getRegistrationSummaryActionPermissions({ viewerRole: "admin", viewerId: "director-1", track }).canOpenConsultationCompletion, true)
  assert.equal(getRegistrationSummaryActionPermissions({ viewerRole: "admin", viewerId: "director-2", track }).canOpenConsultationCompletion, false)
})

test("a second admission batch cannot start while another batch is open", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "enrollment_decided",
    action: "start_enrollment_processing",
    enrollmentCount: 1,
    everyScheduleValid: true,
    admissionNoticeSent: true,
    hasOtherOpenBatch: true,
  }), ["진행 중인 입학 처리"])
})

test("canceling an add-class batch restores a track that still has enrolled classes", () => {
  assert.equal(getRegistrationTrackNextStatus({
    status: "enrollment_processing",
    action: "cancel_admission_batch",
    hasSurvivingEnrolledRows: true,
  }), "registered")
  assert.equal(getRegistrationTrackNextStatus({
    status: "enrollment_processing",
    action: "cancel_admission_batch",
    hasSurvivingEnrolledRows: false,
    destination: "waiting",
  }), "waiting")
})
```

- [ ] **Step 2: Run the new model test and confirm the missing-module failure**

Run: `node --test tests/registration-track-model.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `registration-track-model.js`.

- [ ] **Step 3: Implement the exhaustive pure model**

```js
const STATUS_TO_VIEW = Object.freeze({
  inquiry: "inquiry",
  migration_review: "inquiry",
  level_test_scheduled: "level_test",
  level_test_in_progress: "level_test",
  consultation_waiting: "consulting",
  visit_consultation_scheduled: "consulting",
  waiting: "waiting",
  enrollment_decided: "enrollment",
  enrollment_processing: "enrollment",
  registered: "closed",
  not_registered: "closed",
  inquiry_closed: "closed",
})

const TERMINAL_STATUSES = new Set(["registered", "not_registered", "inquiry_closed"])
const TERMINAL_BATCH_STATUSES = new Set(["completed", "canceled"])
const TERMINAL_ATTEMPT_STATUSES = new Set(["completed", "absent", "canceled"])
const ALLOWED_ACTIONS_BY_STATUS = Object.freeze({
  inquiry: new Set(["schedule_level_test", "route_consultation", "route_waiting", "close_inquiry"]),
  migration_review: new Set(["resolve_migration_review"]),
  level_test_scheduled: new Set(["start_level_test", "record_level_test_result", "cancel_level_test", "close_inquiry"]),
  level_test_in_progress: new Set(["record_level_test_result"]),
  consultation_waiting: new Set(["complete_phone_consultation", "schedule_visit"]),
  visit_consultation_scheduled: new Set(["complete_visit_consultation", "cancel_visit"]),
  waiting: new Set(["change_waiting_kind", "record_retest_required", "schedule_level_test", "move_to_enrollment", "close_not_registered"]),
  enrollment_decided: new Set(["start_enrollment_processing", "route_waiting", "close_not_registered"]),
  enrollment_processing: new Set(["complete_enrollment", "cancel_admission_batch"]),
  registered: new Set(["start_add_class", "cancel_enrollment"]),
  not_registered: new Set(["reopen_track"]),
  inquiry_closed: new Set(["reopen_track"]),
})

function isAllowedRegistrationTrackAction(status, action) {
  return Boolean(ALLOWED_ACTIONS_BY_STATUS[status]?.has(action))
}

export function getRegistrationTrackViewKey(status) {
  return STATUS_TO_VIEW[String(status || "").trim()] || "inquiry"
}

export function getRegistrationTrackTabCounts(tracks = []) {
  const counts = { inquiry: 0, level_test: 0, consulting: 0, waiting: 0, enrollment: 0, closed: 0 }
  for (const track of tracks) counts[getRegistrationTrackViewKey(track?.status)] += 1
  return counts
}

export function isRegistrationTrackTerminal(status) {
  return TERMINAL_STATUSES.has(String(status || "").trim())
}

export function getRegistrationTrackTransitionBlockers(input = {}) {
  if (!isAllowedRegistrationTrackAction(input.status, input.action)) return ["현재 단계에서 할 수 없는 작업"]
  if (input.status === "migration_review" && input.action !== "resolve_migration_review") return ["과목 분리 확인"]
  if (["complete_phone_consultation", "complete_visit_consultation"].includes(input.action) && !input.outcome) return ["상담 결과"]
  if (input.status === "waiting" && input.action === "move_to_enrollment" && input.retakeDecision !== "not_required") {
    return ["레벨테스트 재응시 여부"]
  }
  if (input.status === "waiting" && ["record_retest_required", "schedule_level_test"].includes(input.action) && input.retakeDecision !== "required") {
    return ["레벨테스트 재응시 여부"]
  }
  if (input.status === "level_test_scheduled" && input.action === "close_inquiry"
    && (input.hasActiveAttempt || !["absent", "canceled"].includes(input.lastAttemptStatus))) {
    return ["종료 가능한 미응시·취소 이력"]
  }
  if (input.status === "level_test_scheduled" && input.action === "record_level_test_result"
    && input.resultStatus === "completed") {
    return ["시험 시작"]
  }
  if (input.action === "start_enrollment_processing") {
    return [
      Number(input.enrollmentCount || 0) > 0 ? "" : "수업",
      input.everyScheduleValid ? "" : "수업 시작 일정",
      input.admissionNoticeSent ? "" : "입학신청서 발송",
      input.hasOtherOpenBatch ? "진행 중인 입학 처리" : "",
    ].filter(Boolean)
  }
  return []
}

export function getRegistrationTrackNextStatus(input = {}) {
  if (!isAllowedRegistrationTrackAction(input.status, input.action)) return input.status || "inquiry"
  const outcomeStatus = { enrollment: "enrollment_decided", waiting: "waiting", not_registered: "not_registered" }
  if (input.action === "complete_phone_consultation" || input.action === "complete_visit_consultation") {
    return outcomeStatus[input.outcome] || input.status || "inquiry"
  }
  if (input.action === "schedule_level_test" && (input.status !== "waiting" || input.retakeDecision === "required")) return "level_test_scheduled"
  if (input.action === "record_retest_required" || input.action === "change_waiting_kind") return "waiting"
  if (input.action === "route_consultation") return "consultation_waiting"
  if (input.action === "route_waiting") return "waiting"
  if (input.action === "close_inquiry") return "inquiry_closed"
  if (input.action === "close_not_registered") return "not_registered"
  if (input.action === "cancel_level_test") return "inquiry"
  if (input.action === "move_to_enrollment" && input.retakeDecision === "not_required") return "enrollment_decided"
  if (input.action === "start_level_test") return "level_test_in_progress"
  if (input.action === "record_level_test_result") return input.resultStatus === "completed" ? "consultation_waiting" : "level_test_scheduled"
  if (input.action === "schedule_visit") return "visit_consultation_scheduled"
  if (input.action === "cancel_visit") return "consultation_waiting"
  if (input.action === "start_enrollment_processing") return "enrollment_processing"
  if (input.action === "complete_enrollment") return "registered"
  if (input.action === "start_add_class") return "enrollment_processing"
  if (input.action === "cancel_enrollment") {
    if (input.hasRemainingEnrolledRows) return "registered"
    if (input.destination === "waiting") return "waiting"
    if (input.destination === "not_registered") return "not_registered"
    return "enrollment_decided"
  }
  if (input.action === "reopen_track") return input.destination === "consultation_waiting" ? "consultation_waiting" : "inquiry"
  if (input.action === "cancel_admission_batch") {
    if (input.hasSurvivingEnrolledRows) return "registered"
    return input.destination === "waiting" ? "waiting" : "not_registered"
  }
  if (input.action === "resolve_migration_review") return input.destination || "inquiry"
  return input.status || "inquiry"
}

export function getRegistrationLevelTestAppointmentStatus(attempts = []) {
  if (attempts.length === 0) return "scheduled"
  for (const attempt of attempts) {
    if (!TERMINAL_ATTEMPT_STATUSES.has(attempt?.status)) return "scheduled"
    if (attempt.status === "completed" && !String(attempt.materialLink || "").trim()) return "scheduled"
  }
  if (attempts.every((attempt) => attempt?.status === "canceled")) return "canceled"
  return "completed"
}

export function canEditRegistrationAppointment(activities = []) {
  return activities.every((activity) => activity?.status === "scheduled")
}

export function getRegistrationActionPermissions(input = {}) {
  const canManage = ["admin", "staff"].includes(String(input.viewerRole || ""))
  const consultation = input.activeConsultation
  const canCompleteOwnConsultation = Boolean(
    input.viewerRole === "admin"
    && input.viewerId
    && input.track?.directorProfileId === input.viewerId
    && consultation?.trackId === input.track?.id
    && consultation?.directorProfileId === input.viewerId
    && ((consultation?.mode === "phone" && consultation?.status === "waiting")
      || (consultation?.mode === "visit" && consultation?.status === "scheduled")),
  )
  return {
    canManage,
    canCompleteConsultation: canCompleteOwnConsultation,
    readOnly: !canManage,
  }
}

export function getRegistrationSummaryActionPermissions(input = {}) {
  const canManage = ["admin", "staff"].includes(String(input.viewerRole || ""))
  const canOpenOwnConsultationHint = Boolean(
    input.viewerRole === "admin"
    && input.viewerId
    && input.track?.directorProfileId === input.viewerId
    && ["consultation_waiting", "visit_consultation_scheduled"].includes(input.track?.status),
  )
  return {
    canManage,
    canOpenConsultationCompletion: canOpenOwnConsultationHint,
  }
}

export function deriveRegistrationParentState({ tracks = [], batches = [] } = {}) {
  const hasOpenTrack = tracks.some((track) => !isRegistrationTrackTerminal(track?.status))
  const hasOpenBatch = batches.some((batch) => !TERMINAL_BATCH_STATUSES.has(batch?.status))
  if (hasOpenBatch) return { taskStatus: "in_progress", outcome: "" }
  if (hasOpenTrack || tracks.length === 0) return { taskStatus: tracks.length > 0 && tracks.every((track) => track?.status === "inquiry") ? "requested" : "in_progress", outcome: "" }
  const registeredCount = tracks.filter((track) => track?.status === "registered").length
  if (registeredCount === tracks.length) return { taskStatus: "done", outcome: "all_registered" }
  if (registeredCount > 0) return { taskStatus: "done", outcome: "partial_registration" }
  return { taskStatus: "canceled", outcome: "none_registered" }
}
```

Add matching literal unions and function signatures to `registration-track-model.d.ts`; do not use `any` in exported TypeScript-facing inputs.

- [ ] **Step 4: Run model and legacy workflow tests**

Run: `node --test tests/registration-track-model.test.mjs tests/registration-workflow.test.mjs`

Expected: every new model test passes and the legacy workflow suite remains green.

- [ ] **Step 5: Run targeted lint for the new model**

Run: `pnpm exec eslint src/features/tasks/registration-track-model.js tests/registration-track-model.test.mjs`

Expected: exit code 0.

### Task 2: Additive subject-track schema, RLS, grants, and deterministic backfill

**Files:**
- Create via Supabase CLI: migration named `registration_subject_tracks_schema`
- Create: `tests/registration-track-schema.test.mjs`
- Modify: `supabase/migrations/20260524160000_ops_task_completed_operation_status_guard.sql` only through a new migration; never edit the historical file

**Interfaces:**
- Consumes: track and batch status literals from Task 1.
- Produces public business tables: `ops_registration_subject_tracks`, `ops_registration_appointments`, `ops_registration_level_tests`, `ops_registration_consultations`, `ops_registration_admission_batches`, `ops_registration_enrollments`.
- Produces private receipt table: `dashboard_private.ops_registration_mutations`, unavailable through the public Data API.
- Produces RLS contract: every child-table read inherits the existing parent-task visibility exactly. Responsible directors already have linked `admin` profiles, so assignment creates no second non-admin RLS role or extra case grant.
- Produces compatibility contract: legacy parent columns remain present and readable.

- [ ] **Step 1: Verify the pinned CLI and discover command flags**

Run:

```bash
pnpm dlx supabase@2.109.1 --version
pnpm dlx supabase@2.109.1 migration new --help
pnpm dlx supabase@2.109.1 db reset --help
pnpm dlx supabase@2.109.1 migration list --help
```

Expected: version `2.109.1`; help output documents `migration new`, local reset, and local migration listing. Do not run a linked or remote command.

- [ ] **Step 2: Write the failing migration source-contract test**

```js
import test from "node:test"
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url)

async function readMigration(suffix) {
  const names = await readdir(migrationsUrl)
  const name = names.find((candidate) => candidate.endsWith(`_${suffix}.sql`))
  assert.ok(name, `missing ${suffix} migration`)
  return readFile(new URL(name, migrationsUrl), "utf8")
}

function readPolicyBlock(sql, name) {
  const marker = `create policy ${name}`
  const start = sql.indexOf(marker)
  assert.notEqual(start, -1, `missing ${name}`)
  const nextBlank = sql.indexOf("\n\n", start)
  return sql.slice(start, nextBlank === -1 ? sql.length : nextBlank)
}

test("subject-track schema is additive, exposed deliberately, and RLS protected", async () => {
  const sql = await readMigration("registration_subject_tracks_schema")
  const publicTables = [
    "ops_registration_subject_tracks",
    "ops_registration_appointments",
    "ops_registration_level_tests",
    "ops_registration_consultations",
    "ops_registration_admission_batches",
    "ops_registration_enrollments",
  ]
  for (const table of publicTables) {
    assert.match(sql, new RegExp(`create table public\\.${table}`))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  const revokeBlock = sql.match(/revoke all on table([\s\S]*?)from anon, authenticated;/)?.[1] || ""
  const grantBlock = sql.match(/grant select on table([\s\S]*?)to authenticated;/)?.[1] || ""
  for (const table of publicTables) {
    assert.match(revokeBlock, new RegExp(`public\\.${table}`))
    assert.match(grantBlock, new RegExp(`public\\.${table}`))
    assert.match(sql, new RegExp(`create policy ${table}_authenticated_select[\\s\\S]*?on public\\.${table}[\\s\\S]*?for select[\\s\\S]*?to authenticated[\\s\\S]*?using`))
  }
  assert.doesNotMatch(sql, /grant (?:insert|update|delete|select, insert)[\s\S]*public\.ops_registration_/i)
  assert.match(sql, /create table dashboard_private\.ops_registration_mutations/)
  assert.match(sql, /primary key \(actor_id, request_key\)/)
  assert.match(sql, /target_fingerprint jsonb not null/)
  assert.match(sql, /alter table dashboard_private\.ops_registration_mutations enable row level security/)
  assert.match(sql, /revoke all on dashboard_private\.ops_registration_mutations from public, anon, authenticated/)
  assert.doesNotMatch(sql, /grant\b[^;]*\bon\s+(?:table\s+)?dashboard_private\.ops_registration_mutations\b[^;]*\bto\s+authenticated\b[^;]*;/i)
  assert.doesNotMatch(sql, /create table public\.ops_registration_mutations/)
  assert.match(sql, /stage_entered_at timestamptz not null/)
  assert.match(sql, /alter table public\.ops_registration_details[\s\S]*?common_revision integer not null default 1[\s\S]*?check \(common_revision > 0\)/)
  assert.match(sql, /notification_revision integer not null default 1/)
  assert.match(sql, /student_id uuid references public\.students\(id\) on delete restrict/)
  assert.match(sql, /roster_active boolean not null default false/)
  assert.match(sql, /roster_released_at timestamptz/)
  assert.match(sql, /roster_release_source_task_id uuid references public\.ops_tasks\(id\) on delete restrict/)
  assert.match(sql, /roster_release_kind text/)
  assert.match(sql, /ops_registration_enrollments_student_class_claim_uidx[\s\S]*?\(student_id, class_id\)[\s\S]*?where roster_active/)
  assert.match(sql, /ops_registration_messages[\s\S]*?claim_active boolean/)
  assert.match(sql, /create unique index ops_registration_one_live_admission_message[\s\S]*?on public\.ops_registration_messages\s*\(task_id, template_key\)[\s\S]*?where claim_active/)
  assert.match(sql, /level_test_retake_decision text/)
  assert.match(sql, /director_assignment_source text/)
  assert.match(sql, /director_assignment_rule_key text/)
  assert.match(sql, /director_profile_id uuid references public\.profiles\(id\) on delete restrict/)
  assert.match(sql, /director_profile_id is not null\s+and director_assignment_source is not null\s+and director_assigned_at is not null/)
  assert.match(sql, /director_assignment_source = 'default'.*nullif\(btrim\(director_assignment_rule_key\), ''\) is not null/s)
  assert.match(sql, /ops_registration_enrollments_active_class_uidx[\s\S]*?where status = 'planned' or roster_active/)
  assert.match(sql, /where status = 'waitlisted'/)
  assert.match(sql, /revoke select on table public\.ops_registration_messages from authenticated/)
  assert.match(sql, /grant select \(id, task_id, template_key, request_key, status, claim_active, created_at, updated_at\) on public\.ops_registration_messages to authenticated/)
  assert.match(sql, /migration_review_required/)
  assert.match(sql, /pipeline_status = 'migration_review'/)
  const legacyWriteLockIndex = sql.indexOf("-- registration_legacy_write_lock")
  const globalRosterPreflightIndex = sql.indexOf("-- global_roster_projection_preflight")
  const attributionPreflightIndex = sql.indexOf("-- registration_subject_attribution_preflight")
  const rosterRevalidationIndex = sql.indexOf("-- registration_roster_evidence_revalidation")
  const backfillIndex = sql.indexOf("-- registration_subject_tracks_backfill")
  assert.notEqual(legacyWriteLockIndex, -1)
  assert.notEqual(globalRosterPreflightIndex, -1)
  assert.notEqual(attributionPreflightIndex, -1)
  assert.notEqual(rosterRevalidationIndex, -1)
  assert.notEqual(backfillIndex, -1)
  assert.ok(legacyWriteLockIndex < globalRosterPreflightIndex)
  assert.ok(globalRosterPreflightIndex < attributionPreflightIndex)
  assert.ok(attributionPreflightIndex < rosterRevalidationIndex)
  assert.ok(rosterRevalidationIndex < backfillIndex)
  assert.match(sql.slice(legacyWriteLockIndex, globalRosterPreflightIndex), /set local lock_timeout = '5s'[\s\S]*?lock table public\.ops_tasks in share row exclusive mode[\s\S]*?lock table public\.ops_registration_details in share row exclusive mode[\s\S]*?lock table public\.students in share row exclusive mode[\s\S]*?lock table public\.classes in share row exclusive mode/)
  const globalRosterBlock = sql.slice(globalRosterPreflightIndex, attributionPreflightIndex)
  assert.match(globalRosterBlock, /-- reviewed_roster_projection_repairs/)
  assert.match(globalRosterBlock, /registration_roster_projection_invalid/)
  assert.match(globalRosterBlock, /registration_global_roster_repair_required/)
  assert.match(globalRosterBlock, /registration_withdrawn_roster_review_required/)
  assert.match(globalRosterBlock, /global_roster_projection_symmetric/)
  const attributionBlock = sql.slice(attributionPreflightIndex, rosterRevalidationIndex)
  assert.match(attributionBlock, /-- reviewed_registration_subject_attribution/)
  assert.match(attributionBlock, /registration_subject_attribution_required/)
  assert.match(attributionBlock, /registration_subject_token_unrecognized/)
  const rosterBlock = sql.slice(rosterRevalidationIndex, backfillIndex)
  assert.match(rosterBlock, /from public\.students[\s\S]*?order by[\s\S]*?\.id[\s\S]*?for update[\s\S]*?from public\.classes[\s\S]*?order by[\s\S]*?\.id[\s\S]*?for update/)
  assert.match(rosterBlock, /roster_evidence_valid/)
  assert.match(sql.slice(backfillIndex), /registration_subject_track_coverage_mismatch/)
  assert.doesNotMatch(sql, /drop column .*pipeline_status/i)
  assert.doesNotMatch(sql, /drop column .*class_id/i)
})

test("consultation and RLS invariants are explicit", async () => {
  const sql = await readMigration("registration_subject_tracks_schema")
  const selectPolicy = readPolicyBlock(sql, "ops_tasks_select")
  const insertPolicy = readPolicyBlock(sql, "ops_tasks_insert")
  const taskUpdatePolicy = readPolicyBlock(sql, "ops_tasks_update")
  const taskDeletePolicy = readPolicyBlock(sql, "ops_tasks_delete")
  const detailUpdatePolicy = readPolicyBlock(sql, "ops_registration_details_update")
  const detailDeletePolicy = readPolicyBlock(sql, "ops_registration_details_delete")
  const eventWritePolicy = readPolicyBlock(sql, "ops_task_events_write")
  assert.match(sql, /mode = 'phone'.*appointment_id is null/s)
  assert.match(sql, /mode = 'visit'.*appointment_id is not null/s)
  assert.match(sql, /for select\s+to authenticated\s+using/s)
  assert.doesNotMatch(sql, /dashboard_private\.can_access_registration_task/)
  assert.match(selectPolicy, /current_dashboard_role\(\) in \('admin', 'staff', 'assistant'\)/)
  assert.match(selectPolicy, /requested_by = auth\.uid\(\)/)
  assert.match(selectPolicy, /assignee_id = auth\.uid\(\)/)
  assert.match(selectPolicy, /secondary_assignee_id = auth\.uid\(\)/)
  assert.match(selectPolicy, /dashboard_private\.is_ops_word_retest_teacher\(id\)/)
  assert.doesNotMatch(selectPolicy, /ops_registration_subject_tracks/)
  assert.match(sql, /create policy ops_registration_subject_tracks_authenticated_select[\s\S]*?exists[\s\S]*?from public\.ops_tasks/)
  assert.match(insertPolicy, /type <> 'registration'/)
  assert.match(insertPolicy, /requested_by is null/)
  assert.match(insertPolicy, /current_dashboard_role\(\) in \('admin', 'staff', 'assistant'\)/)
  assert.match(sql, /create or replace function dashboard_private\.prevent_registration_type_reclassification\(\)/)
  assert.match(sql, /old\.type is distinct from new\.type[\s\S]*?\(old\.type = 'registration' or new\.type = 'registration'\)/)
  assert.match(sql, /create trigger prevent_registration_type_reclassification[\s\S]*?before update of type on public\.ops_tasks/)
  assert.doesNotMatch(sql, /create policy ops_registration_details_insert/)
  assert.match(sql, /create or replace function dashboard_private\.registration_task_has_subject_tracks\(p_task_id uuid\)[\s\S]*?security definer[\s\S]*?set search_path = ''[\s\S]*?from public\.ops_registration_subject_tracks/)
  assert.match(sql, /revoke all on function dashboard_private\.registration_task_has_subject_tracks\(uuid\) from public, anon/)
  assert.match(sql, /grant execute on function dashboard_private\.registration_task_has_subject_tracks\(uuid\) to authenticated/)
  assert.match(taskUpdatePolicy, /not dashboard_private\.registration_task_has_subject_tracks\(id\)/)
  assert.doesNotMatch(taskUpdatePolicy, /from public\.ops_registration_subject_tracks/)
  assert.match(taskUpdatePolicy, /dashboard_private\.is_ops_word_retest_teacher\(id\)/)
  assert.match(taskDeletePolicy, /not dashboard_private\.registration_task_has_subject_tracks\(id\)/)
  assert.doesNotMatch(taskDeletePolicy, /from public\.ops_registration_subject_tracks/)
  assert.match(detailUpdatePolicy, /not exists[\s\S]*?ops_registration_subject_tracks/)
  assert.match(detailUpdatePolicy, /track\.task_id = ops_registration_details\.task_id/)
  assert.match(detailDeletePolicy, /not exists[\s\S]*?ops_registration_subject_tracks/)
  assert.match(detailDeletePolicy, /track\.task_id = ops_registration_details\.task_id/)
  assert.match(eventWritePolicy, /event_type not in \('registration_track_event', 'legacy_registration_imported', 'customer_message_sent', 'registration_admission_message_reconciled', 'registration_admission_message_retry_released', 'registration_subject_removed'\)/)
  assert.doesNotMatch(sql, /create policy ops_registration_(?:subject_tracks|appointments|level_tests|consultations|admission_batches|enrollments)_(?:insert|update|delete)/i)
})
```

- [ ] **Step 3: Run the schema test and confirm it fails because the migration does not exist**

Run: `node --test tests/registration-track-schema.test.mjs`

Expected: FAIL with `missing registration_subject_tracks_schema migration`.

- [ ] **Step 4: Generate the migration with the CLI**

Run: `pnpm dlx supabase@2.109.1 migration new registration_subject_tracks_schema`

Expected: one new file under `supabase/migrations/` ending in `_registration_subject_tracks_schema.sql`. Record that exact generated path in the task notes and use only that file for Steps 5–8.

At the first executable lines of that migration, add the literal marker `-- registration_legacy_write_lock`, `SET LOCAL lock_timeout = '5s';`, then acquire `LOCK TABLE public.ops_tasks IN SHARE ROW EXCLUSIVE MODE;`, `LOCK TABLE public.ops_registration_details IN SHARE ROW EXCLUSIVE MODE;`, `LOCK TABLE public.students IN SHARE ROW EXCLUSIVE MODE;`, and `LOCK TABLE public.classes IN SHARE ROW EXCLUSIVE MODE;` in exactly that order. Keep this order everywhere. Supabase's migration guidance explicitly recommends `SET LOCAL lock_timeout` for migration locks; failure to acquire any lock within five seconds aborts the transaction without partial backfill. The first two locks freeze legacy registration parent/detail writes; the latter two freeze every student/class roster-array writer while `4-1.` and `7.` evidence is read. All four remain held through child-table creation, the `-- registration_subject_tracks_backfill` scan, coverage assertions, and parent/detail policy replacement. A write that began first commits before the relevant lock and is included by the revalidated snapshot; a waiting old-app write resumes only after commit and is evaluated under the new guards. Apply the future migration only in an announced maintenance window that explicitly pauses registration and every roster-writing endpoint/job, verify no such sessions remain, and record lock duration. The table locks are the enforced fallback if an overlooked writer exists; timeout/deadlock aborts the whole migration rather than accepting a mixed roster snapshot.

Immediately after those locks, add `-- global_roster_projection_preflight`. Validate all four live JSONB columns globally: SQL null is normalized to empty only for inspection, every non-null value must be an array of UUID strings, arrays must be duplicate-free after normalization, each student/class pair must appear symmetrically on both sides in exactly one mode, and no pair may be both enrolled and waitlisted. Also require every student whose status is `퇴원` to have empty own-side arrays and no reverse class-side enrolled/waitlist reference; raise `registration_withdrawn_roster_review_required` for any violation. `재원` with no class remains valid because explicit registration cancellation may leave the student active. The current read-only snapshot has one student-side enrolled reference whose class row has since been deleted; no existing class can truthfully retain that student in enrolled or waitlist mode.

Under the literal marker `-- reviewed_roster_projection_repairs`, require an operator-reviewed portable set of `(student_id, class_id, target_mode)` rows, where target mode is `enrolled`, `waitlist`, or `removed`. Ignore literals whose student/class IDs do not exist in an empty/local environment, but for each pair that exists require exactly one reviewed target and update all four JSONB projections to that target under the locked student -> class order. The one deterministic exception is a student-side reference to a class row that no longer exists: because `enrolled` and `waitlist` are impossible targets, remove only that stale UUID, write a labeled history row with nullable `class_id`, and preserve the missing class UUID in the memo. Every other asymmetric pair still requires an explicit reviewed target. An unmatched live asymmetry raises `registration_global_roster_repair_required`; malformed JSON raises `registration_roster_projection_invalid`. After repairs, materialize and assert `global_roster_projection_symmetric = true` across every current pair.

Before subject attribution, quarantine only explicitly reviewed empty UI fixtures whose exact task/detail signatures still match and that have no student, contact, class, message, comment, attachment, notification, or automation evidence. Preserve their task/event history by converting the task to canceled `general`, record a `migration_quarantined` event, and remove only its empty registration detail. Any signature change aborts instead of inventing a subject or deleting the task.

After the table locks and subject attribution preflight, add the literal marker `-- registration_roster_evidence_revalidation`. Collect all exact student/class/profile IDs needed by deterministic attribution. Lock resolved student rows first with `ORDER BY student.id FOR UPDATE`, then class rows with `ORDER BY class.id FOR UPDATE`, then director profile rows in UUID order. Materialize a transaction-local `roster_evidence_valid` result for both sides of every candidate `4-1.`/`7.` pair and use only that result during child insertion. Immediately re-read and revalidate the four projections under those locks before setting it true; any missing/asymmetric/conflicting pair becomes `migration_review`. Never lock a class before its resolved student. This mirrors the runtime student -> class order and prevents a roster change from slipping between evidence inspection and child insertion.

- [ ] **Step 5: Create six normalized public tables and one private receipt table with exact constraints**

Use schema-qualified foreign keys and checks. The migration must implement this column contract exactly:

Before creating the child tables, add `ops_registration_details.common_revision integer NOT NULL DEFAULT 1 CHECK (common_revision > 0)`. It versions only operator-editable common information; child transitions and compatibility recomputation never increment it. Existing rows backfill to 1 in the same locked schema migration.

```sql
create table public.ops_registration_subject_tracks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  subject text not null check (subject in ('영어', '수학')),
  pipeline_status text not null check (pipeline_status in (
    'inquiry', 'migration_review', 'level_test_scheduled', 'level_test_in_progress',
    'consultation_waiting', 'visit_consultation_scheduled', 'waiting',
    'enrollment_decided', 'enrollment_processing', 'registered',
    'not_registered', 'inquiry_closed'
  )),
  director_profile_id uuid references public.profiles(id) on delete restrict,
  director_assignment_source text check (
    director_assignment_source is null or director_assignment_source in ('default', 'manual', 'migration')
  ),
  director_assignment_rule_key text,
  director_assigned_at timestamptz,
  waiting_kind text check (waiting_kind is null or waiting_kind in (
    'current_class', 'current_term_opening', 'next_term_opening'
  )),
  level_test_retake_decision text check (
    level_test_retake_decision is null or level_test_retake_decision in ('required', 'not_required')
  ),
  level_test_retake_decided_at timestamptz,
  migration_review_required boolean not null default false,
  stage_entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, subject),
  check (
    (
      director_profile_id is null
      and director_assignment_source is null
      and director_assignment_rule_key is null
      and director_assigned_at is null
    )
    or (
      director_profile_id is not null
      and director_assignment_source is not null
      and director_assigned_at is not null
      and (
        (
          director_assignment_source = 'default'
          and nullif(btrim(director_assignment_rule_key), '') is not null
        )
        or (
          director_assignment_source in ('manual', 'migration')
          and director_assignment_rule_key is null
        )
      )
    )
  ),
  check ((pipeline_status = 'migration_review') = migration_review_required),
  check ((pipeline_status = 'waiting') = (waiting_kind is not null))
);

create table public.ops_registration_appointments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  kind text not null check (kind in ('level_test', 'visit_consultation')),
  scheduled_at timestamptz not null,
  place text not null check (nullif(btrim(place), '') is not null),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'canceled')),
  notification_revision integer not null default 1 check (notification_revision > 0),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ops_registration_level_tests (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ops_registration_subject_tracks(id) on delete cascade,
  appointment_id uuid not null references public.ops_registration_appointments(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'absent', 'canceled')),
  started_at timestamptz,
  completed_at timestamptz,
  material_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_id, attempt_number),
  unique (appointment_id, track_id),
  check (status <> 'in_progress' or started_at is not null),
  check (status not in ('completed', 'absent', 'canceled') or completed_at is not null),
  check (status <> 'completed' or nullif(btrim(material_link), '') is not null)
);

create table public.ops_registration_consultations (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ops_registration_subject_tracks(id) on delete cascade,
  appointment_id uuid references public.ops_registration_appointments(id) on delete restrict,
  mode text not null check (mode in ('phone', 'visit')),
  status text not null check (status in ('waiting', 'scheduled', 'completed', 'canceled')),
  director_profile_id uuid not null references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  outcome text check (outcome is null or outcome in ('enrollment', 'waiting', 'not_registered')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((mode = 'phone' and appointment_id is null) or (mode = 'visit' and appointment_id is not null)),
  check (status <> 'completed' or (completed_at is not null and outcome is not null))
);

create table public.ops_registration_admission_batches (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  status text not null default 'draft' check (status in ('draft', 'invoiced', 'paid', 'completed', 'canceled')),
  invoice_sent_at timestamptz,
  payment_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, revision_number),
  check (status not in ('invoiced', 'paid', 'completed') or invoice_sent_at is not null),
  check (status not in ('paid', 'completed') or payment_confirmed_at is not null)
);

create table public.ops_registration_enrollments (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ops_registration_subject_tracks(id) on delete cascade,
  student_id uuid references public.students(id) on delete restrict,
  admission_batch_id uuid references public.ops_registration_admission_batches(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  textbook_id uuid references public.textbooks(id) on delete restrict,
  class_start_date date,
  class_start_session_key text,
  class_start_session text,
  status text not null default 'planned' check (status in ('planned', 'waitlisted', 'enrolled', 'canceled')),
  makeedu_registered boolean not null default false,
  roster_active boolean not null default false,
  roster_released_at timestamptz,
  roster_release_reason text,
  roster_release_source_task_id uuid references public.ops_tasks(id) on delete restrict,
  roster_release_kind text check (roster_release_kind is null or roster_release_kind in ('withdrawal', 'transfer')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (class_start_session_key is null or class_start_session_key ~ '^\d{4}-\d{2}-\d{2}:[1-9]\d*$'),
  check (
    (status = 'planned' and admission_batch_id is null and student_id is null and not roster_active
      and roster_released_at is null and roster_release_reason is null and roster_release_source_task_id is null and roster_release_kind is null)
    or (status = 'planned' and admission_batch_id is not null and student_id is not null and roster_active
      and roster_released_at is null and roster_release_reason is null and roster_release_source_task_id is null and roster_release_kind is null)
    or (status = 'waitlisted' and admission_batch_id is null and student_id is not null and roster_active
      and roster_released_at is null and roster_release_reason is null and roster_release_source_task_id is null and roster_release_kind is null)
    or (status = 'enrolled' and admission_batch_id is not null and student_id is not null and (
      (roster_active and roster_released_at is null and roster_release_reason is null and roster_release_source_task_id is null and roster_release_kind is null)
      or (not roster_active and roster_released_at is not null and nullif(btrim(roster_release_reason), '') is not null
        and roster_release_source_task_id is not null and roster_release_kind is not null)
    ))
    or (status = 'canceled' and not roster_active
      and roster_released_at is null and roster_release_reason is null and roster_release_source_task_id is null and roster_release_kind is null)
  ),
  check (status not in ('enrolled') or (
    class_start_date is not null
    and nullif(btrim(class_start_session_key), '') is not null
    and nullif(btrim(class_start_session), '') is not null
  ))
);

create table dashboard_private.ops_registration_mutations (
  actor_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  request_key text not null,
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  mutation_type text not null,
  target_fingerprint jsonb not null,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_key),
  check (nullif(btrim(request_key), '') is not null),
  check (nullif(btrim(mutation_type), '') is not null)
);
```

- [ ] **Step 6: Add update triggers, indexes, partial uniqueness, explicit grants, and RLS**

Add `public.set_updated_at()` triggers to the six new mutable business tables and ensure the existing `ops_registration_messages` table has the same trigger, so every claim/finalizer/reconciliation/release transition resets its safety timer. Add indexes for every foreign key and list predicate. Required partial indexes are:

```sql
create unique index ops_registration_enrollments_active_class_uidx
  on public.ops_registration_enrollments(track_id, class_id)
  where status = 'planned' or roster_active;

create unique index ops_registration_enrollments_student_class_claim_uidx
  on public.ops_registration_enrollments(student_id, class_id)
  where roster_active;

create unique index ops_registration_enrollments_one_waitlist_uidx
  on public.ops_registration_enrollments(track_id)
  where status = 'waitlisted';

create unique index ops_registration_admission_batches_one_open_uidx
  on public.ops_registration_admission_batches(task_id)
  where status not in ('completed', 'canceled');

create unique index ops_registration_level_tests_one_active_uidx
  on public.ops_registration_level_tests(track_id)
  where status in ('scheduled', 'in_progress');

create unique index ops_registration_consultations_one_active_uidx
  on public.ops_registration_consultations(track_id)
  where status in ('waiting', 'scheduled');

create index ops_registration_tracks_pipeline_queue_idx
  on public.ops_registration_subject_tracks(pipeline_status, stage_entered_at, task_id);
create index ops_registration_tracks_task_status_idx
  on public.ops_registration_subject_tracks(task_id, pipeline_status);
create index ops_registration_tracks_director_queue_idx
  on public.ops_registration_subject_tracks(director_profile_id, pipeline_status, stage_entered_at)
  where director_profile_id is not null;
create index ops_registration_appointments_task_kind_idx
  on public.ops_registration_appointments(task_id, kind, scheduled_at desc);
create index ops_registration_appointments_created_by_idx
  on public.ops_registration_appointments(created_by)
  where created_by is not null;
create index ops_registration_level_tests_track_created_idx
  on public.ops_registration_level_tests(track_id, created_at desc);
create index ops_registration_consultations_track_created_idx
  on public.ops_registration_consultations(track_id, created_at desc);
create index ops_registration_consultations_appointment_idx
  on public.ops_registration_consultations(appointment_id)
  where appointment_id is not null;
create index ops_registration_consultations_director_status_idx
  on public.ops_registration_consultations(director_profile_id, status, created_at);
create index ops_registration_batches_task_status_idx
  on public.ops_registration_admission_batches(task_id, status, revision_number desc);
create index ops_registration_enrollments_track_created_idx
  on public.ops_registration_enrollments(track_id, created_at);
create index ops_registration_enrollments_batch_sort_idx
  on public.ops_registration_enrollments(admission_batch_id, sort_order)
  where admission_batch_id is not null;
create index ops_registration_enrollments_class_idx
  on public.ops_registration_enrollments(class_id);
create index ops_registration_enrollments_textbook_idx
  on public.ops_registration_enrollments(textbook_id)
  where textbook_id is not null;
create index ops_registration_mutations_task_created_idx
  on dashboard_private.ops_registration_mutations(task_id, created_at desc);
```

Alter `ops_registration_messages` in this literal order so the migration never references a column before it exists:

```sql
alter table public.ops_registration_messages
  add column claim_active boolean;

update public.ops_registration_messages
set claim_active = status in ('pending', 'accepted', 'unknown');

do $$
begin
  if exists (
    select 1
    from public.ops_registration_messages
    where template_key = 'admission_application' and claim_active
    group by task_id, template_key
    having count(*) > 1
  ) then
    raise exception 'registration_message_active_claim_review_required';
  end if;
end
$$;

alter table public.ops_registration_messages
  drop constraint if exists ops_registration_messages_status_check,
  add constraint ops_registration_messages_status_check
    check (status in ('pending', 'accepted', 'failed', 'unknown')),
  add constraint ops_registration_messages_claim_state_check
    check (status = 'failed' or claim_active),
  alter column claim_active set default true,
  alter column claim_active set not null;

create unique index ops_registration_one_live_admission_message
  on public.ops_registration_messages(task_id, template_key)
  where template_key = 'admission_application' and claim_active;
```

Pending, accepted, unknown, and manually reconciled failed-hold rows keep `claim_active = true` and block every second key/actor. A definite provider failure or an explicit delayed retry release sets it false. A failed row may therefore be either blocking (`claim_active = true`) or released (`false`), while every non-failed row must remain active. The route treats a unique-conflict loser as reload-only and never calls SOLAPI.

Replace the message table's broad authenticated `SELECT` grant with column-level read access after `claim_active` exists:

```sql
revoke select on table public.ops_registration_messages from authenticated;
grant select (id, task_id, template_key, request_key, status, claim_active, created_at, updated_at)
  on public.ops_registration_messages to authenticated;
```

Keep its existing parent-scoped RLS policy. Browser/detail loaders can read only the workflow-safe current state; recipient fragments, provider IDs/status text, and error payload remain available only to the service-role route/private finalizer. Audit events expose only the intentionally normalized reconciliation summary rendered by the case history, not the raw provider response.

Grant the six exact public tables as one read-only Data API unit, and keep mutation receipts outside that unit:

```sql
revoke all on table
  public.ops_registration_subject_tracks,
  public.ops_registration_appointments,
  public.ops_registration_level_tests,
  public.ops_registration_consultations,
  public.ops_registration_admission_batches,
  public.ops_registration_enrollments
from anon, authenticated;

grant select on table
  public.ops_registration_subject_tracks,
  public.ops_registration_appointments,
  public.ops_registration_level_tests,
  public.ops_registration_consultations,
  public.ops_registration_admission_batches,
  public.ops_registration_enrollments
to authenticated;

alter table public.ops_registration_subject_tracks enable row level security;
alter table public.ops_registration_appointments enable row level security;
alter table public.ops_registration_level_tests enable row level security;
alter table public.ops_registration_consultations enable row level security;
alter table public.ops_registration_admission_batches enable row level security;
alter table public.ops_registration_enrollments enable row level security;

revoke all on schema dashboard_private from public;
grant usage on schema dashboard_private to authenticated;
grant usage on schema dashboard_private to service_role;
revoke all on dashboard_private.ops_registration_mutations from public, anon, authenticated;
alter table dashboard_private.ops_registration_mutations enable row level security;
```

Do not create a second director-specific read helper or alter the audience of `ops_tasks_select`. A responsible director is already a visible teacher-catalog principal with a linked `profiles.role = 'admin'`, so that actor is already covered by the parent policy. Each of the six child-table `SELECT` policies inherits parent visibility with an `EXISTS` query against the RLS-protected `public.ops_tasks` row: direct `task_id` for tracks/appointments/batches, and a nested track lookup for level tests/consultations/enrollments. Because the parent policy does not query the new child tables, this inheritance is non-recursive and keeps its existing admin/staff/assistant, requester, assignee, secondary-assignee, and word-retest clauses unchanged. Qualify every row ID with the policy table name to avoid column shadowing. Do not grant `anon` access. Do not grant authenticated `INSERT`, `UPDATE`, or `DELETE`; the private implementations in Task 3 are the sole write path. Tests cover parent-visible readers seeing the same case children, a non-participant ordinary teacher receiving no new access, and another admin director retaining the same broad admin read visibility without gaining consultation-completion authority.

Director read access must not accidentally become parent-write access through old policies, and new callers must not create a permanently childless registration through the legacy path. In the same migration:

- Recreate the latest `ops_tasks_insert` with every prior requested-by/role clause preserved and add `type <> 'registration'` to its `WITH CHECK`. Non-registration direct creation is unchanged; `create_registration_case_impl` is the only registration-parent creation path and bypasses RLS as the fixed owner.
- Drop `ops_registration_details_insert` and do not recreate any authenticated INSERT policy. The same creation RPC inserts the detail atomically with its tracks; existing legacy details remain readable/updatable but no new detail can be attached through the browser.
- Recreate the latest `ops_tasks_update`, `ops_tasks_delete`, `ops_registration_details_update`, and `ops_registration_details_delete` policies with every pre-existing role/status clause preserved and one additional invariant in both `USING` and `WITH CHECK` where applicable. Directly reading `ops_registration_subject_tracks` inside an `ops_tasks` policy would recurse because the child SELECT policy inherits visibility from `ops_tasks`; PostgreSQL rejects that mutual RLS dependency with `42P17`. Break the cycle with `dashboard_private.registration_task_has_subject_tracks(p_task_id uuid) returns boolean`: fixed owner `postgres`, `STABLE SECURITY DEFINER`, `SET search_path = ''`, schema-qualified child read, PUBLIC/anon execution revoked, authenticated execution granted. Parent policies use `not dashboard_private.registration_task_has_subject_tracks(id)` and contain no direct child-table subquery. Detail policies may use `not exists (select 1 from public.ops_registration_subject_tracks track where track.task_id = ops_registration_details.task_id)` because their child-policy path terminates at the nonrecursive parent SELECT policy. Qualify identifiers exactly so no policy relies on an ambiguous placeholder or shadowed `id`.
- Create `dashboard_private.prevent_registration_type_reclassification()` with `SECURITY INVOKER` and `search_path = ''`, revoke direct execution from `PUBLIC`, `anon`, and `authenticated`, and install `prevent_registration_type_reclassification` as a `BEFORE UPDATE OF type` trigger on `public.ops_tasks`. When `OLD.type IS DISTINCT FROM NEW.type` and either side is `registration`, raise an exception. This closes both legacy-policy bypasses: a caller cannot create a general task and relabel it as a childless registration, and cannot relabel a legacy/child-backed registration as another task type to escape registration guards. No registration RPC changes `type`; an exceptional future data repair must explicitly account for this invariant in a controlled migration.

Child-backed cases therefore mutate parent/common/projection fields only through the fixed-owner Task 3 RPCs; existing legacy registrations without tracks keep their prior non-type update behavior, and all non-registration task types keep their prior update behavior unless a write attempts to cross the registration type boundary. The task delete guard also prevents a direct parent delete from cascading away child history. Source and runtime tests prove direct authenticated admin/staff registration parent/detail INSERT is denied, both directions of registration type reclassification are denied, and `create_registration_case` succeeds atomically.

Recreate `ops_task_events_write` with its existing parent-visibility rule plus a reserved-event guard. Authenticated direct inserts into a child-backed case must satisfy `event_type not in ('registration_track_event', 'legacy_registration_imported', 'customer_message_sent', 'registration_admission_message_reconciled', 'registration_admission_message_retry_released', 'registration_subject_removed')`; those six parsed workflow/audit types are written only by private implementations. Preserve ordinary non-reserved task events, comments, and attachments. Legacy registration rows without subject tracks may keep the old customer-message/event path during fallback. Source tests assert the exact reserved list and runtime fixtures prove that even an assigned admin director cannot forge any canonical history type through a direct insert.

Create no browser policy and no authenticated table grant for `dashboard_private.ops_registration_mutations`; enabling RLS is defense in depth. Only the private function owner reads or inserts receipts. Every receipt-backed mutation resolves and authorizes its parent first, then looks up a receipt by the exact `(auth.uid(), request_key, task_id, mutation_type, target_fingerprint)` tuple. `create_registration_case` is the parentless receipt exception because no task exists yet: it serializes by `(auth.uid(), request_key)`, looks up by actor/key/type/fingerprint, then returns only the previously stored response belonging to that actor. `claim_registration_admission_message` is the separate one-shot no-receipt exception: send authority comes only from its actual pending-row `INSERT ... RETURNING` and is never replayed.

- [ ] **Step 7: Implement deterministic backfill without duplicating ambiguous history**

Before authoring the migration's reviewed mapping, run a read-only preflight that returns each registration task ID, student/title, pipeline status, and raw `ops_tasks.subject` whenever the subject is null/blank, has no exact `영어`/`수학` token, or mixes a recognized token with any unknown token. The current read-only aggregate snapshot contains two registration parents with `subject IS NULL` and valid detail rows; rerun the preflight at execution time because that count can drift. Do not infer their subjects from counselor, class, grade, or legacy pipeline. Present those cases for explicit operator attribution before the migration can proceed.

Under the already-held legacy write locks, add the literal marker `-- registration_subject_attribution_preflight`. Tokenize every nonblank raw subject without filtering first. Create a transaction-local resolved mapping with two sources:

- automatic mappings only for parents whose complete raw token set contains one or two distinct exact values from `영어`/`수학` and zero unknown tokens;
- literal, operator-reviewed rows under the marker `-- reviewed_registration_subject_attribution` for every null, blank, zero-recognized, or mixed recognized/unknown parent. Each reviewed row is one `(task_id, subject)` pair and may contain only `영어` or `수학`.

Join the reviewed literal map to the locked registration-parent snapshot before using or parent-specific validation. A literal whose task ID does not exist in a local/preview/fresh environment, or exists there only as a non-registration task, is ignored so the same committed migration remains portable across environments. For literals that match a current registration parent, reject duplicate subject, invalid subject, or a mapping for an automatically clean parent. A mistyped production ID cannot silently pass in production: the real null/unknown parent remains unmatched and fails the coverage assertion. Then assert that every current registration parent resolves to exactly one or two distinct subjects and that no raw unknown token is being silently retained; raise `registration_subject_token_unrecognized` for an unmapped unknown/mixed token and `registration_subject_attribution_required` for any zero-subject/null/blank parent. An empty placeholder mapping is intentionally a migration blocker on the current production snapshot until the operator supplies the reviewed rows, while an empty environment with no registration parents applies cleanly.

Only after that preflight succeeds, add `-- registration_subject_tracks_backfill` and backfill exclusively from the resolved mapping. Deduplicate per task/subject before counting or inserting. After child insertion, compare every registration parent's exact resolved subject set with its exact track subject set and raise `registration_subject_track_coverage_mismatch` if a parent has zero tracks, more than two tracks, or any missing/extra subject. Repeat the zero-child/exact-set assertion in the mutation migration immediately before creating `registration_subject_tracks_runtime_version()`, so readiness can never become `1` over a silently legacy-shaped registration. Backfill rules must otherwise be encoded directly in SQL:

```sql
-- single subject: map the legacy status to one authoritative track
case
  when detail.pipeline_status like '0.%' then 'inquiry'
  when detail.pipeline_status like '1.%' then 'level_test_scheduled'
  when detail.pipeline_status like '1-1.%' then 'consultation_waiting'
  when detail.pipeline_status like '2.%'
    and detail.visit_consultation_at is not null
    and nullif(btrim(detail.visit_consultation_place), '') is not null
    then 'visit_consultation_scheduled'
  when detail.pipeline_status like '2.%' then 'consultation_waiting'
  when detail.pipeline_status like '3.%' then 'migration_review'
  when detail.pipeline_status like '4-1.%'
    or detail.pipeline_status like '4-2.%'
    or detail.pipeline_status like '4-3.%' then 'waiting'
  when detail.pipeline_status like '5.%' then 'enrollment_decided'
  when detail.pipeline_status like '5-1.%' or detail.pipeline_status like '6.%' then 'enrollment_processing'
  when detail.pipeline_status like '7.%' then 'registered'
  when detail.pipeline_status like '8.%' then 'not_registered'
  when detail.pipeline_status like '9.%' then 'inquiry_closed'
  else 'migration_review'
end

-- progressed multi-subject: create review tracks only
case
  when normalized_subject_count > 1
    and (detail.pipeline_status like '0.%') is not true then 'migration_review'
  else mapped_pipeline_status
end
```

For `2.` specifically, the visit branch above is valid only when both the visit timestamp and a nonblank place exist. When both are absent, use `consultation_waiting` and create the phone-waiting activity. When exactly one exists, route the track to `migration_review`. `4-1.`, `4-2.`, and `4-3.` are the only recognized waiting prefixes; null, blank, unknown, or any other `4-*` value must also route to `migration_review` rather than guessing a state.

Apply this exact single-subject child mapping; when a required field is missing or inconsistent, create a `migration_review` track instead of inventing data:

| Legacy prefix | Track and children |
| --- | --- |
| `0.` | `inquiry`; no child activity. |
| `1.` | `level_test_scheduled`; create one level-test appointment/attempt only when both `level_test_at` and a nonblank legacy level-test place exist. Otherwise review. |
| `1-1.` | Create the historical appointment and completed attempt only when appointment time, nonblank place, completion time, result URL, and a uniquely mapped director exist; then create one phone-waiting consultation and use `consultation_waiting`. Otherwise review. |
| `2.` | With a uniquely mapped director, create a visit appointment/consultation only when visit time and nonblank visit place both exist. A visit time with missing place goes to review. Only when no visit time exists may the migration create a fresh phone-waiting activity and use `consultation_waiting`. Preserve any legacy phone timestamp only as imported history, never as a reservation. Missing/ambiguous director goes to review. |
| `3.` | Always `migration_review` because legacy data proves completion but does not encode the subject outcome/destination. |
| `4-1.` | `waiting/current_class`; require an exact student identity, one exactly matching class, the pair present in both waitlist arrays, and absent from both enrolled arrays. Then create one waitlisted enrollment without duplicating history. Any missing/asymmetric/conflicting roster projection goes to review; the migration never silently repairs it. |
| `4-2.`, `4-3.` | `waiting` with `current_term_opening` or `next_term_opening`; no enrollment row. |
| `5.` | `enrollment_decided`; create an unbatched planned enrollment only when class subject and any saved schedule are valid. |
| `5-1.` | `enrollment_processing`; create revision 1 `draft` batch and attach the valid planned enrollment; require the existing admission flag. |
| `6.` | `enrollment_processing` only when one exact legacy enrollment can satisfy every normal batch-start prerequisite: exact student identity, same-subject class, valid canonical start date/session, optional textbook still linked to that class, admission evidence, and MakeEdu evidence. Create and attach that exact planned row to revision 1; zero/multiple candidate rows or any invalid identity/class/session/textbook goes to review. Create `invoiced` only with invoice evidence. Create `paid` only when both invoice and payment booleans are true **and** the locked row also passes the full paid-completion validator except final roster symmetry (which completion will apply); use `task.updated_at` as a labeled imported approximation for evidenced booleans lacking timestamps. Payment=true with invoice=false, missing enrollment evidence, or any failed prerequisite goes to review—never synthesize a batch, row, invoice, or payment history. |
| `7.` | `registered` only when all evidence exists: exact student identity, same-subject class, valid canonical start session, admission flag, MakeEdu flag, invoice flag, payment flag, the student/class pair present in both enrolled arrays, and absent from both waitlist arrays. Then create a completed batch plus enrolled row and use `task.updated_at` only as a labeled imported approximation for the evidenced invoice/payment timestamps. Missing/asymmetric roster or any other invalid completion goes to review; do not invent flags, timestamps, or roster links. |
| `8.`, `9.` | `not_registered` or `inquiry_closed`; no invented child activity. |

Set `stage_entered_at` from the latest relevant legacy activity timestamp for that stage, then `task.updated_at`, then `task.created_at`; never default migrated queue rows to migration time. Set `migration_review_required = true` for every track mapped to `migration_review`, including a single-subject legacy `3.` row or any invalid completion. A progressed multi-subject case creates no attempt, consultation, batch, or enrollment children. Single-subject review shows the same outcome/state panel without a subject-attribution choice. For other single-subject cases, create child history only when the field set is unambiguous. Preserve every imported fallback timestamp/boolean in a version-1 `legacy_registration_imported` event. Create a legacy enrollment only when the class subject matches the single track exactly.

Only for a single-subject legacy case (or a future source that is independently proven subject-specific), when the counselor/director can be matched to one active profile, set `director_assignment_source = 'migration'`, leave `director_assignment_rule_key = null`, and set `director_assigned_at` from the best legacy consultation/update timestamp. Progressed multi-subject review tracks remain unassigned; never copy one parent counselor into both English and mathematics. Do not run current-year defaults over migrated assignments automatically; the review flow attributes subject-specific data and an operator may later save a deliberate manual assignment.

- [ ] **Step 8: Run source-contract tests and inspect the migration diff**

Run:

```bash
node --test tests/registration-track-schema.test.mjs
git diff --check -- supabase/migrations tests/registration-track-schema.test.mjs
```

Expected: schema tests pass; diff check emits no output.

- [ ] **Step 9: Record the database-runtime boundary instead of touching production**

Run:

```bash
command -v docker || true
command -v postgres || true
command -v psql || true
node --test tests/registration-track-schema.test.mjs
```

Expected in the current environment: the three executable lookups return no path, while the schema source-contract test passes. Record `runtime DB migration verification pending: no local Postgres/Docker; preview branch not authorized` in `.superpowers/sdd/progress.md`. Do not substitute the production project.

For every backfilled waitlisted, batched, or enrolled row, require a valid locked parent `student_id`, copy it to `ops_registration_enrollments.student_id`, set `roster_active = true`, and leave every release-metadata column null. An unbatched planned draft must keep `student_id = null`, `roster_active = false`, and null release metadata. Before inserting the resolved backfill candidate set, scan it for duplicate roster-active `(student_id, class_id)` pairs across tasks/tracks and for conflicts with the locked global roster. Do not choose a winning case. Route ambiguous candidates to migration review when no active enrollment row is created, or abort with `registration_student_class_claim_review_required` and an explicit operator map when history already claims both; rerun the zero-duplicate assertion before readiness.

### Task 3: Transactional registration mutation functions

**Files:**
- Create via Supabase CLI: migration named `registration_subject_track_mutations`
- Create: `supabase/tests/registration_subject_tracks_test.sql`
- Create: `supabase/tests/registration_subject_tracks_runtime_test.sql`
- Create: `scripts/verify-registration-subject-track-concurrency.mjs`
- Modify: `tests/registration-track-schema.test.mjs`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `src/features/management/management-service.js`
- Create: `src/features/tasks/registration-runtime-probe.ts`
- Create: `tests/registration-runtime-probe.test.mjs`
- Modify: `tests/registration-service-hardening.test.mjs`
- Modify: `tests/management-class-student-roster.test.mjs`

**Interfaces:**
- Produces RPC `create_registration_case(p_student_name text, p_school_grade text, p_school_name text, p_parent_phone text, p_student_phone text, p_campus text, p_inquiry_at timestamptz, p_subjects text[], p_request_note text, p_priority text, p_request_key text) returns jsonb`.
- Produces RPC `sync_registration_case_subjects(p_task_id uuid, p_subjects text[], p_request_key text) returns jsonb`.
- Produces RPC `update_registration_case_common(p_task_id uuid, p_student_name text, p_school_grade text, p_school_name text, p_parent_phone text, p_student_phone text, p_campus text, p_inquiry_at timestamptz, p_request_note text, p_priority text, p_expected_common_revision integer, p_request_key text) returns jsonb`.
- Produces RPC `route_registration_inquiry(p_track_id uuid, p_destination text, p_waiting_kind text, p_class_id uuid, p_request_key text) returns jsonb`.
- Produces RPC `assign_registration_track_director(p_track_id uuid, p_director_profile_id uuid, p_assignment_source text, p_rule_key text, p_expected_common_revision integer, p_request_key text) returns jsonb`.
- Produces RPC `save_registration_shared_appointment(p_appointment_id uuid, p_task_id uuid, p_kind text, p_scheduled_at timestamptz, p_place text, p_track_ids uuid[], p_replace_remaining boolean, p_expected_notification_revision integer, p_request_key text) returns jsonb`.
- Produces RPC `cancel_registration_appointment(p_appointment_id uuid, p_expected_notification_revision integer, p_reason text, p_request_key text) returns jsonb`.
- Produces RPC `start_registration_level_test_attempt(p_attempt_id uuid, p_request_key text) returns jsonb`.
- Produces RPC `complete_registration_level_test_attempt(p_attempt_id uuid, p_status text, p_material_link text, p_request_key text) returns jsonb`.
- Produces RPC `close_registration_level_test_track(p_track_id uuid, p_reason text, p_request_key text) returns jsonb`.
- Produces RPC `complete_registration_consultation(p_consultation_id uuid, p_outcome text, p_waiting_kind text, p_class_id uuid, p_request_key text) returns jsonb`.
- Produces RPC `transition_registration_waiting(p_track_id uuid, p_action text, p_waiting_kind text, p_class_id uuid, p_retake_decision text, p_reason text, p_request_key text) returns jsonb`.
- Produces RPC `route_registration_enrollment_decision(p_track_id uuid, p_destination text, p_waiting_kind text, p_class_id uuid, p_reason text, p_request_key text) returns jsonb`.
- Produces RPC `save_registration_enrollment_rows(p_track_id uuid, p_rows jsonb, p_request_key text) returns jsonb`.
- Produces one-shot RPC `claim_registration_admission_message(p_task_id uuid, p_message_request_key text) returns jsonb`; it deliberately has no replay receipt because send authority must never be replayed.
- Produces server-only RPC `finalize_registration_admission_message(p_message_id uuid, p_result text, p_provider_result jsonb) returns jsonb`, executable only by `service_role` from the authenticated API route.
- Produces RPC `reconcile_registration_admission_message(p_message_id uuid, p_resolution text, p_provider_evidence jsonb, p_reason text, p_request_key text) returns jsonb`.
- Produces RPC `release_registration_admission_message_retry(p_message_id uuid, p_provider_evidence jsonb, p_reason text, p_request_key text) returns jsonb`.
- Produces RPC `mark_registration_admission_notice_sent(p_task_id uuid, p_message_request_key text, p_request_key text) returns jsonb`.
- Produces RPC `start_registration_admission_batch(p_task_id uuid, p_track_ids uuid[], p_enrollment_ids uuid[], p_request_key text) returns jsonb`.
- Produces RPC `set_registration_enrollment_makeedu(p_enrollment_id uuid, p_registered boolean, p_request_key text) returns jsonb`.
- Produces RPC `advance_registration_admission_batch(p_batch_id uuid, p_action text, p_request_key text) returns jsonb`.
- Produces RPC `cancel_registration_admission_batch(p_batch_id uuid, p_resolutions jsonb, p_reason text, p_request_key text) returns jsonb`.
- Produces RPC `complete_registration_admission_batch(p_batch_id uuid, p_request_key text) returns jsonb`.
- Produces RPC `cancel_registration_enrollment(p_enrollment_id uuid, p_destination text, p_waiting_kind text, p_class_id uuid, p_reason text, p_request_key text) returns jsonb`.
- Produces ready-mode RPCs `complete_ops_withdrawal_roster_transition(p_task_id uuid, p_request_key text)` and `complete_ops_transfer_roster_transition(p_task_id uuid, p_request_key text)` so withdrawal/transfer task completion, registration-claim release, roster/history, and task/checklist state commit atomically.
- Produces RPC `resolve_registration_migration_review(p_task_id uuid, p_assignments jsonb, p_request_key text) returns jsonb`.
- Produces RPC `reopen_registration_track(p_track_id uuid, p_destination text, p_reason text, p_request_key text) returns jsonb`.
- Produces shared roster RPC `set_student_class_roster_mode(p_student_id uuid, p_class_id uuid, p_next_mode text, p_expected_mode text, p_memo text) returns jsonb`; this is not a registration-case mutation and is tested separately from the actor/key receipt loop.
- Produces shared type `RegistrationRuntimeState = { mode: "legacy" | "maintenance" | "ready"; version: 0 | 1 }`, `createRegistrationRuntimeProbe(client)`, and a session-cached default `probeRegistrationSubjectTrackRuntime(): Promise<RegistrationRuntimeState>`; Task 3 roster adapters and Task 4 registration loaders consume this one module.
- Produces read-only readiness RPC `registration_subject_tracks_runtime_version() returns integer`, created last and returning `1` only after parent normalization and both guards are installed.
- Every receipt-backed registration-case mutation consumes a non-empty `p_request_key` and returns the stored response for duplicate keys. The admission-message claim consumes only its unique `p_message_request_key` and is a one-shot target-state no-receipt command whose replays always return `shouldSend: false`. The shared roster command is the other target-state-idempotent no-receipt command, and the read-only readiness function also has no key.

- [ ] **Step 1: Extend the failing source-contract test for function security and names**

```js
function readFunctionBlock(sql, schema, name) {
  const marker = `create function ${schema}.${name}(`
  const start = sql.indexOf(marker)
  assert.notEqual(start, -1, `missing ${schema}.${name}`)
  const end = sql.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated ${schema}.${name}`)
  return sql.slice(start, end + 4)
}

function readFunctionArgumentTypes(block) {
  const header = block.slice(block.indexOf("(") + 1, block.indexOf(")\nreturns"))
  return [...header.matchAll(/p_[a-z0-9_]+\s+(uuid\[\]|text\[\]|timestamptz|boolean|integer|jsonb|uuid|text)/g)]
    .map((match) => match[1])
}

test("registration mutations are invoker-safe, explicit, and authenticated-only", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const signatures = {
    create_registration_case: ["text", "text", "text", "text", "text", "text", "timestamptz", "text[]", "text", "text", "text"],
    sync_registration_case_subjects: ["uuid", "text[]", "text"],
    update_registration_case_common: ["uuid", "text", "text", "text", "text", "text", "text", "timestamptz", "text", "text", "integer", "text"],
    route_registration_inquiry: ["uuid", "text", "text", "uuid", "text"],
    assign_registration_track_director: ["uuid", "uuid", "text", "text", "integer", "text"],
    save_registration_shared_appointment: ["uuid", "uuid", "text", "timestamptz", "text", "uuid[]", "boolean", "integer", "text"],
    cancel_registration_appointment: ["uuid", "integer", "text", "text"],
    start_registration_level_test_attempt: ["uuid", "text"],
    complete_registration_level_test_attempt: ["uuid", "text", "text", "text"],
    close_registration_level_test_track: ["uuid", "text", "text"],
    complete_registration_consultation: ["uuid", "text", "text", "uuid", "text"],
    transition_registration_waiting: ["uuid", "text", "text", "uuid", "text", "text", "text"],
    route_registration_enrollment_decision: ["uuid", "text", "text", "uuid", "text", "text"],
    save_registration_enrollment_rows: ["uuid", "jsonb", "text"],
    claim_registration_admission_message: ["uuid", "text"],
    finalize_registration_admission_message: ["uuid", "text", "jsonb"],
    reconcile_registration_admission_message: ["uuid", "text", "jsonb", "text", "text"],
    release_registration_admission_message_retry: ["uuid", "jsonb", "text", "text"],
    mark_registration_admission_notice_sent: ["uuid", "text", "text"],
    start_registration_admission_batch: ["uuid", "uuid[]", "uuid[]", "text"],
    set_registration_enrollment_makeedu: ["uuid", "boolean", "text"],
    advance_registration_admission_batch: ["uuid", "text", "text"],
    cancel_registration_admission_batch: ["uuid", "jsonb", "text", "text"],
    complete_registration_admission_batch: ["uuid", "text"],
    cancel_registration_enrollment: ["uuid", "text", "text", "uuid", "text", "text"],
    complete_ops_withdrawal_roster_transition: ["uuid", "text"],
    complete_ops_transfer_roster_transition: ["uuid", "text"],
    resolve_registration_migration_review: ["uuid", "jsonb", "text"],
    reopen_registration_track: ["uuid", "text", "text", "text"],
  }
  const actionByFunction = {
    sync_registration_case_subjects: "sync_subjects",
    update_registration_case_common: "update_common",
    route_registration_inquiry: "route_inquiry",
    assign_registration_track_director: "assign_director",
    save_registration_shared_appointment: "save_appointment",
    cancel_registration_appointment: "cancel_appointment",
    start_registration_level_test_attempt: "start_level_test",
    complete_registration_level_test_attempt: "complete_level_test",
    close_registration_level_test_track: "close_level_test",
    complete_registration_consultation: "complete_consultation",
    transition_registration_waiting: "transition_waiting",
    route_registration_enrollment_decision: "route_enrollment_decision",
    save_registration_enrollment_rows: "save_enrollment_rows",
    claim_registration_admission_message: "claim_admission_message",
    reconcile_registration_admission_message: "reconcile_admission_message",
    release_registration_admission_message_retry: "release_admission_message_retry",
    mark_registration_admission_notice_sent: "mark_admission_notice",
    start_registration_admission_batch: "start_admission_batch",
    set_registration_enrollment_makeedu: "set_makeedu",
    advance_registration_admission_batch: "advance_admission_batch",
    cancel_registration_admission_batch: "cancel_admission_batch",
    complete_registration_admission_batch: "complete_admission_batch",
    cancel_registration_enrollment: "cancel_enrollment",
    complete_ops_withdrawal_roster_transition: "complete_withdrawal_roster_transition",
    complete_ops_transfer_roster_transition: "complete_transfer_roster_transition",
    resolve_registration_migration_review: "resolve_migration_review",
    reopen_registration_track: "reopen_track",
  }
  const functionNames = Object.keys(signatures)
  assert.deepEqual(Object.keys(actionByFunction), functionNames.filter((name) => !["create_registration_case", "finalize_registration_admission_message"].includes(name)))
  for (const functionName of functionNames) {
    const implementation = readFunctionBlock(sql, "dashboard_private", `${functionName}_impl`)
    const wrapper = readFunctionBlock(sql, "public", functionName)
    assert.deepEqual(readFunctionArgumentTypes(implementation), signatures[functionName])
    assert.deepEqual(readFunctionArgumentTypes(wrapper), signatures[functionName])
    assert.match(implementation, /security definer/)
    assert.match(implementation, /set search_path = ''/)
    if (functionName !== "finalize_registration_admission_message") {
      assert.match(implementation, /pg_advisory_xact_lock/)
    }
    if (functionName === "claim_registration_admission_message") {
      assert.doesNotMatch(implementation, /target_fingerprint|idempotency_key_reused|ops_registration_mutations/)
      assert.match(implementation, /insert[\s\S]*ops_registration_messages[\s\S]*on conflict do nothing[\s\S]*returning/s)
      assert.match(implementation, /'shouldSend',[\s\S]*true/s)
    } else if (functionName === "finalize_registration_admission_message") {
      assert.doesNotMatch(implementation, /target_fingerprint|idempotency_key_reused|ops_registration_mutations/)
      assert.match(implementation, /auth\.role\(\)\s*<>\s*'service_role'/)
      assert.match(implementation, /for update/)
    } else {
      assert.match(implementation, /target_fingerprint/)
      assert.match(implementation, /idempotency_key_reused/)
    }
    assert.doesNotMatch(implementation, /update\s+public\.ops_registration_subject_tracks\b[^;]*\bpipeline_status\s*=/s)
    assert.doesNotMatch(implementation, /update\s+public\.ops_registration_subject_tracks\b[^;]*\bstage_entered_at\s*=/s)
    if (functionName === "create_registration_case") {
      assert.match(implementation, /current_dashboard_role\(\).*'admin'.*'staff'/s)
    } else if (functionName === "finalize_registration_admission_message") {
      assert.doesNotMatch(implementation, /assert_registration_mutation_access/)
    } else {
      const expectedAction = actionByFunction[functionName]
      assert.match(implementation, new RegExp(`dashboard_private\\.assert_registration_mutation_access\\([^;]*'${expectedAction}'[^;]*\\);`))
      if (functionName !== "complete_registration_consultation") {
        assert.doesNotMatch(implementation, /assert_registration_mutation_access\([^;]*'complete_consultation'[^;]*\);/)
      }
    }
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, /set search_path = ''/)
    const sqlSignature = signatures[functionName].join(", ")
    const revokedRoles = functionName === "finalize_registration_admission_message"
      ? "public\\s*,\\s*anon\\s*,\\s*authenticated"
      : "public\\s*,\\s*anon"
    const grantedRole = functionName === "finalize_registration_admission_message" ? "service_role" : "authenticated"
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${functionName}_impl\\(${sqlSignature.replaceAll("[]", "\\[\\]")}\\)\\s+from\\s+${revokedRoles}\\s*;`, "i"))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${functionName}_impl\\(${sqlSignature.replaceAll("[]", "\\[\\]")}\\)\\s+to\\s+${grantedRole}\\s*;`, "i"))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${functionName}\\(${sqlSignature.replaceAll("[]", "\\[\\]")}\\)\\s+from\\s+${revokedRoles}\\s*;`, "i"))
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}\\(${sqlSignature.replaceAll("[]", "\\[\\]")}\\)\\s+to\\s+${grantedRole}\\s*;`, "i"))
  }
  assert.match(sql, /for update/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /target_fingerprint/)
  assert.match(sql, /idempotency_key_reused/)
  assert.match(sql, /dashboard_private\.ops_registration_mutations/)
  assert.doesNotMatch(sql, /public\.ops_registration_mutations/)
  assert.match(sql, /create or replace function dashboard_private\.prevent_ops_roster_completion_bypass\(\)/)
  assert.match(sql, /current_user\s*<>\s*'postgres'/)
  assert.match(sql, /old\.type[\s\S]*?'withdrawal'[\s\S]*?'transfer'[\s\S]*?new\.type/)
  assert.match(sql, /before insert or update of type, status on public\.ops_tasks/)
  assert.match(sql, /before insert or update of timetable_roster_updated on public\.ops_(?:withdrawal|transfer)_details/)
  assert.match(sql, /student_status_transition_requires_workflow/)
  assert.match(sql, /before update of status on public\.students/)
  assert.match(sql, /dashboard_private\.validate_registration_class_session/)
  assert.match(sql, /dashboard_private\.apply_student_class_roster_mode/)
  assert.match(sql, /dashboard_private\.apply_registration_current_class_wait/)
  assert.match(sql, /dashboard_private\.is_active_registration_director/)
  assert.match(sql, /dashboard_private\.resolve_registration_default_director/)
  assert.match(sql, /dashboard_private\.assert_registration_track_director_ready/)
  assert.match(sql, /dashboard_private\.transition_registration_track_status/)
  assert.match(sql, /transition_registration_track_status\(p_track_id uuid,\s*p_next_status text,\s*p_next_waiting_kind text,\s*p_next_retake_decision text,\s*p_next_migration_review_required boolean\)/s)
  assert.match(sql, /dashboard_private\.assert_registration_mutation_access/)
  assert.match(sql, /dashboard_private\.write_registration_track_event/)
  assert.match(sql, /dashboard_private\.derive_registration_parent_projection/)
  assert.match(sql, /dashboard_private\.recompute_registration_parent/)
  assert.match(sql, /registration_subjects_required/)
  assert.match(sql, /registration_last_subject_required/)
  assert.match(sql, /registration_appointment_tracks_required/)
  assert.match(sql, /registration_subject_track_coverage_mismatch/)
  assert.match(sql, /registration_roster_projection_invalid/)
  assert.match(sql, /create or replace function public\.prevent_completed_operation_reopen/)
  assert.match(sql, /create(?: or replace)? function public\.prevent_registration_compatibility_override/)
  const completedGuardIndex = sql.indexOf("create or replace function public.prevent_completed_operation_reopen")
  const recomputeBackfillIndex = sql.indexOf("-- registration_backfill_parent_recompute")
  const globalRosterGatewayLockIndex = sql.indexOf("-- global_roster_gateway_lock")
  const compatibilityTriggerIndex = sql.indexOf("create trigger prevent_registration_compatibility_override")
  assert.ok(completedGuardIndex < recomputeBackfillIndex)
  assert.ok(recomputeBackfillIndex < compatibilityTriggerIndex)
  assert.ok(recomputeBackfillIndex < globalRosterGatewayLockIndex)
  assert.match(sql.slice(globalRosterGatewayLockIndex), /set local lock_timeout = '5s'[\s\S]*?lock table public\.students in share row exclusive mode[\s\S]*?lock table public\.classes in share row exclusive mode[\s\S]*?registration_global_roster_repair_required/)
  assert.match(sql.slice(globalRosterGatewayLockIndex), /registration_withdrawn_roster_review_required/)
  assert.match(sql, /registration_backfill_parent_recompute[\s\S]*?order by task\.id/)
  assert.match(sql, /registration_parent_projection_mismatch/)
  assert.match(sql, /create function public\.registration_subject_tracks_runtime_version\(\)[\s\S]*?select 1/)
  assert.match(sql, /grant execute on function public\.registration_subject_tracks_runtime_version\(\) to authenticated/)
  assert.ok(compatibilityTriggerIndex < sql.indexOf("create function public.registration_subject_tracks_runtime_version"))
  for (const helperName of [
    "validate_registration_class_session",
    "apply_student_class_roster_mode",
    "apply_registration_current_class_wait",
    "is_active_registration_director",
    "resolve_registration_default_director",
    "assert_registration_track_director_ready",
    "transition_registration_track_status",
    "assert_registration_mutation_access",
    "write_registration_track_event",
    "derive_registration_parent_projection",
    "recompute_registration_parent",
  ]) {
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${helperName}`))
  }
  const rosterImpl = readFunctionBlock(sql, "dashboard_private", "set_student_class_roster_mode_impl")
  const rosterWrapper = readFunctionBlock(sql, "public", "set_student_class_roster_mode")
  assert.deepEqual(readFunctionArgumentTypes(rosterImpl), ["uuid", "uuid", "text", "text", "text"])
  assert.deepEqual(readFunctionArgumentTypes(rosterWrapper), ["uuid", "uuid", "text", "text", "text"])
  assert.match(rosterImpl, /security definer/)
  assert.match(rosterImpl, /current_dashboard_role\(\) in \('admin', 'staff'\)/)
  assert.doesNotMatch(rosterImpl, /'assistant'/)
  assert.match(rosterImpl, /apply_student_class_roster_mode/)
  assert.match(rosterImpl, /registration_roster_mode_conflict/)
  assert.match(rosterWrapper, /security invoker/)
  assert.match(sql, /revoke execute on function dashboard_private\.set_student_class_roster_mode_impl\(uuid, uuid, text, text, text\) from public, anon;/)
  assert.match(sql, /grant execute on function dashboard_private\.set_student_class_roster_mode_impl\(uuid, uuid, text, text, text\) to authenticated;/)
  assert.match(sql, /revoke execute on function public\.set_student_class_roster_mode\(uuid, uuid, text, text, text\) from public, anon;/)
  assert.match(sql, /grant execute on function public\.set_student_class_roster_mode\(uuid, uuid, text, text, text\) to authenticated;/)
  assert.match(sql, /create or replace function dashboard_private\.prevent_direct_roster_array_write\(\)/)
  assert.match(sql, /current_user <> 'postgres'/)
  assert.match(sql, /create trigger prevent_direct_student_roster_insert[\s\S]*?before insert on public\.students/)
  assert.match(sql, /create trigger prevent_direct_class_roster_insert[\s\S]*?before insert on public\.classes/)
  assert.match(sql, /create trigger prevent_direct_student_roster_array_write[\s\S]*?before update of class_ids, waitlist_class_ids on public\.students/)
  assert.match(sql, /create trigger prevent_direct_class_roster_array_write[\s\S]*?before update of student_ids, waitlist_ids on public\.classes/)
  assert.match(sql, /create trigger prevent_linked_student_delete[\s\S]*?before delete on public\.students/)
  assert.match(sql, /create trigger prevent_linked_class_delete[\s\S]*?before delete on public\.classes/)
  assert.match(sql, /registration_roster_write_requires_rpc/)
  assert.match(sql, /registration_roster_cleanup_required/)
  assert.match(sql, /registration_history_preservation_required/)
  assert.doesNotMatch(sql, /create policy student_class_enrollment_history[^;]*for (?:all|insert|update|delete)/i)
  assert.match(sql, /revoke all on table public\.student_class_enrollment_history from anon, authenticated;/)
  assert.match(sql, /grant select on table public\.student_class_enrollment_history to authenticated;/)
  assert.doesNotMatch(sql, /grant\s+(?!select\s+on)[^;]*on\s+(?:table\s+)?public\.student_class_enrollment_history[^;]*to\s+(?:anon|authenticated)/i)
})
```

- [ ] **Step 2: Run the schema test and confirm the missing mutation migration failure**

Run: `node --test tests/registration-track-schema.test.mjs`

Expected: FAIL with `missing registration_subject_track_mutations migration`.

- [ ] **Step 3: Generate the mutation migration and inspect database-test help**

Run:

```bash
pnpm dlx supabase@2.109.1 migration new registration_subject_track_mutations
pnpm dlx supabase@2.109.1 test db --help
```

Expected: one new migration ending in `_registration_subject_track_mutations.sql`; help shows how `supabase test db` runs local pgTAP files.

- [ ] **Step 4: Implement one shared authorization and idempotency pattern inside every function**

Each function must use this exact structural pattern with its own typed parameters and response body. Resolve and authorize the target parent before looking up an idempotency receipt, and scope every replay to actor, parent task, mutation type, and key:

The mutation access matrix is deliberately narrower than read access. Responsible directors are visible teacher-catalog principals with linked `admin` profiles; the implementation does not invent a contradictory non-admin director role. Admin/staff can execute every management mutation except consultation completion. `complete_consultation` is responsibility-bound and requires the caller to have role `admin`, be the current track director, and still match the consultation's stored director snapshot after locks. Staff and other admin directors may manage the case but cannot complete that consultation. Assistants, task participants, teachers, and viewers remain read-only. Encode the role/current-track half once in an unexposed helper, then recheck the consultation snapshot inside the completion implementation:

```sql
create or replace function dashboard_private.assert_registration_mutation_access(
  p_task_id uuid,
  p_track_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_action = 'complete_consultation' then
    if public.current_dashboard_role() = 'admin' and exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.id = p_track_id
        and track.task_id = p_task_id
        and track.director_profile_id = (select auth.uid())
    ) then
      return;
    end if;
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if public.current_dashboard_role() in ('admin', 'staff') then
    return;
  end if;
  raise exception 'registration_access_denied' using errcode = '42501';
end;
$$;
```

Set the helper owner to `postgres` and revoke execution from PUBLIC/anon/authenticated. Every browser-authenticated private implementation except `create_registration_case_impl` calls it after resolving the parent and optional track, before any receipt lookup or write. The one-shot message claim passes a null track and still calls the management action check before its pending insert. Case creation has no target parent yet and therefore performs the equivalent explicit admin/staff check. The provider finalizer is not browser-authenticated: it rejects every role except `service_role`, has separate grants, and never calls this helper. Source and pgTAP tests prove that the assigned admin director can complete only their own consultation; a sibling admin director, staff member, teacher, or assistant cannot complete it. The same assigned admin director still has ordinary admin management authority for other actions, which is intentional and matches the existing dashboard role model.

Use the exact per-function action literals from the source-contract map above. No management implementation may pass `complete_consultation`; that literal belongs only to `complete_registration_consultation_impl`. Runtime fixtures prove assigned-admin success plus sibling-admin, staff, teacher, and assistant completion denial. Separate management-action fixtures prove admin/staff success and non-management denial; do not expect an assigned admin director to lose ordinary admin management authority.

```sql
create function dashboard_private.complete_registration_consultation_impl(
  p_consultation_id uuid,
  p_outcome text,
  p_waiting_kind text,
  p_class_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_track_id uuid;
  v_mode text;
  v_activity_status text;
  v_source_status text;
  v_next_status text;
  v_track_director_id uuid;
  v_consultation_director_id uuid;
  v_actor_id uuid := (select auth.uid());
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_request_key), '') is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'consultationId', p_consultation_id,
    'outcome', p_outcome,
    'waitingKind', p_waiting_kind,
    'classId', p_class_id
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor_id::text || ':' || p_request_key, 0));

  select track.task_id, track.id
  into v_task_id, v_track_id
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where consultation.id = p_consultation_id;

  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
  for update;
  select consultation.mode, consultation.status, track.pipeline_status,
         track.director_profile_id, consultation.director_profile_id
  into v_mode, v_activity_status, v_source_status,
       v_track_director_id, v_consultation_director_id
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where consultation.id = p_consultation_id
    and track.task_id = v_task_id
  for update of track, consultation;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, v_track_id, 'complete_consultation'
  );
  if v_track_director_id is distinct from v_actor_id
    or v_consultation_director_id is distinct from v_actor_id then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.assert_registration_track_director_ready(v_track_id);

  select mutation.response_payload,
         mutation.task_id = v_task_id
           and mutation.mutation_type = 'complete_consultation'
           and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = p_request_key;
  if found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if found then return v_response; end if;
  if not coalesce(
    (v_mode = 'phone' and v_activity_status = 'waiting' and v_source_status = 'consultation_waiting')
    or (v_mode = 'visit' and v_activity_status = 'scheduled' and v_source_status = 'visit_consultation_scheduled'),
    false
  ) then
    raise exception 'consultation_activity_conflict' using errcode = '40001';
  end if;
  if p_outcome is null or p_outcome not in ('enrollment', 'waiting', 'not_registered') then
    raise exception 'consultation_outcome_required' using errcode = '22023';
  end if;
  if p_outcome = 'waiting' and (
    p_waiting_kind is null
    or p_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening')
  ) then
    raise exception 'waiting_kind_required' using errcode = '22023';
  end if;
  if p_outcome <> 'waiting' and p_waiting_kind is not null then
    raise exception 'waiting_kind_not_allowed' using errcode = '22023';
  end if;
  if p_outcome = 'waiting' and p_waiting_kind = 'current_class' and p_class_id is null then
    raise exception 'waiting_class_required' using errcode = '22023';
  end if;
  if not (p_outcome = 'waiting' and p_waiting_kind = 'current_class') and p_class_id is not null then
    raise exception 'waiting_class_not_allowed' using errcode = '22023';
  end if;
  if p_outcome = 'waiting' and p_waiting_kind = 'current_class' then
    perform dashboard_private.apply_registration_current_class_wait(
      v_task_id, v_track_id, p_class_id, v_actor_id
    );
  end if;

  update public.ops_registration_consultations
  set status = 'completed', completed_at = now(), outcome = p_outcome, updated_at = now()
  where id = p_consultation_id;

  v_next_status := case p_outcome
    when 'enrollment' then 'enrollment_decided'
    when 'waiting' then 'waiting'
    else 'not_registered'
  end;
  perform dashboard_private.transition_registration_track_status(
    v_track_id,
    v_next_status,
    case when p_outcome = 'waiting' then p_waiting_kind else null end,
    null,
    false
  );

  if v_mode = 'visit' then
    update public.ops_registration_appointments appointment
    set status = 'completed'
    where appointment.id = (
      select visit.appointment_id
      from public.ops_registration_consultations visit
      where visit.id = p_consultation_id
    )
      and not exists (
        select 1
        from public.ops_registration_consultations sibling
        where sibling.appointment_id = appointment.id
          and sibling.status not in ('completed', 'canceled')
      );
  end if;

  select pg_catalog.jsonb_build_object(
    'consultation', pg_catalog.jsonb_build_object(
      'id', consultation.id,
      'trackId', consultation.track_id,
      'appointmentId', consultation.appointment_id,
      'mode', consultation.mode,
      'status', consultation.status,
      'directorProfileId', consultation.director_profile_id,
      'completedAt', consultation.completed_at,
      'outcome', consultation.outcome,
      'createdAt', consultation.created_at,
      'updatedAt', consultation.updated_at
    ),
    'track', pg_catalog.jsonb_build_object(
      'id', track.id,
      'taskId', track.task_id,
      'subject', track.subject,
      'status', track.pipeline_status,
      'legacy', false,
      'directorProfileId', track.director_profile_id,
      'directorName', coalesce(profile.name, ''),
      'directorAssignmentSource', coalesce(track.director_assignment_source, ''),
      'directorAssignmentRuleKey', coalesce(track.director_assignment_rule_key, ''),
      'waitingKind', coalesce(track.waiting_kind, ''),
      'levelTestRetakeDecision', coalesce(track.level_test_retake_decision, ''),
      'migrationReviewRequired', track.migration_review_required,
      'stageEnteredAt', track.stage_entered_at
    )
  )
  into v_response
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  left join public.profiles profile on profile.id = track.director_profile_id
  where consultation.id = p_consultation_id;
  perform dashboard_private.write_registration_track_event(
    v_task_id,
    v_track_id,
    'consultation_completed',
    v_source_status,
    case p_outcome when 'enrollment' then 'enrollment_decided' when 'waiting' then 'waiting' else 'not_registered' end,
    null,
    jsonb_build_object('mode', v_mode, 'outcome', p_outcome, 'waitingKind', p_waiting_kind, 'classId', p_class_id)
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);
  insert into dashboard_private.ops_registration_mutations(actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload)
  values (v_actor_id, p_request_key, v_task_id, 'complete_consultation', v_target_fingerprint, v_response);
  return v_response;
end;
$$;

create function public.complete_registration_consultation(
  p_consultation_id uuid,
  p_outcome text,
  p_waiting_kind text,
  p_class_id uuid,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.complete_registration_consultation_impl(
    p_consultation_id, p_outcome, p_waiting_kind, p_class_id, p_request_key
  );
$$;
```

The first consultation lookup resolves IDs only; it grants no authority. Authorization is re-evaluated after the parent, track, and consultation snapshot are locked. The caller must still have dashboard role `admin`, and both the current track director and consultation snapshot must equal that caller; neither staff nor an unassigned admin bypasses this ownership check. Reassignment follows the same lock order, so a former director cannot win a reassignment-versus-completion race. Receipt-backed private implementations use the same post-lock caller revalidation, actor/key advisory lock, exact canonical JSONB argument fingerprint, target-state validation, deterministic row locks, transition-event insertion, compatibility recomputation, and private mutation-receipt insertion. JSONB equality detects a reused key with any different normalized argument without extension-schema or hash-collision assumptions. Each exposed function is only a schema-qualified `SECURITY INVOKER` wrapper with the identical signature. Use unique function names; do not overload signatures. `create_registration_case_impl` takes the actor/key advisory lock before its first receipt lookup because the parent task does not exist yet. The service-role-only message finalizer is the deliberate exception: it has no actor/request key or receipt and uses locked parent/detail/message rows as a compare-and-set boundary.

For receipt-backed operations, canonical fingerprints trim text, convert empty optional values to JSON null, sort/deduplicate subject/track/enrollment UUID arrays, and sort enrollment-row objects by stable row ID then class ID before building JSONB. Treat `cancel_registration_admission_batch.p_resolutions` as an unordered set: reject duplicate `trackId` entries and sort normalized objects by `trackId`. Treat `resolve_registration_migration_review.p_assignments` the same way: `RegistrationMigrationAssignment` is keyed by its exact `group` field (`level_test`, `consultation`, or `placement`), so reject duplicate `group` entries; separately reject duplicate `trackId` in `trackStates`, sort `assignments` by `group`, sort `trackStates` by `trackId`, and sort/deduplicate every nested subject-ID set before fingerprinting. A replay with semantically identical normalized input—including either array order—returns the stored response; the same actor/key with any different task, operation, target, or normalized argument raises `idempotency_key_reused`. The one-shot admission claim never participates in this receipt/fingerprint rule.

Every receipt-backed private implementation uses one global lock order to avoid cross-operation deadlocks: actor/request advisory lock -> all parent/source `ops_tasks` rows sorted by UUID -> subject tracks sorted by UUID -> appointment and subject activities sorted by UUID -> deterministic student-identity advisory lock when materialization may create a student -> existing student row -> admission batch and enrollment/claim rows sorted by UUID -> classes sorted by UUID -> textbooks sorted by UUID. A function skips irrelevant levels but never reverses the order. Withdrawal and transfer transitions lock both their source task and the linked registration parent in the same UUID-sorted task tier. The service-role message finalizer has no advisory tier and locks parent/detail -> exact message after its ID-only lookup. Record a per-function lock-order review table in the progress file; the future runtime packet provides the actual proof with two-session shared-appointment/batch/waitlist/student-identity concurrency fixtures.

Define these unexposed helpers in the same migration. They are called only from the exact private implementations and receive no browser grants:

- `dashboard_private.validate_registration_class_session(p_class_id uuid, p_date date, p_session_key text) returns jsonb` reads only the locked class's `schedule_plan` and returns `{ valid, sessionDate, sessionKey, sessionLabel }`. It accepts arrays from `sessions` or `session_list`, state aliases `scheduleState|schedule_state|state` with allowed values `active|normal|makeup`, date aliases `date|session_date|dateValue|date_value`, and number aliases `sessionNumber|session_number`. The canonical key is `${YYYY-MM-DD}:${positive integer}` and the server-derived display label is `${number}회차`; the supplied date must equal the key date and selected schedule entry. Every row save, batch start, and completion reruns this helper and persists/compares its canonical date/key/label, so a stale UI selection or spoofed display text cannot pass.
- `dashboard_private.is_active_registration_director(p_profile_id uuid) returns boolean` is the concrete live-principal predicate: the profile exists with `profiles.role = 'admin'` and at least one linked `teacher_catalogs` row has `profile_id = p_profile_id` and `is_visible = true`. Profile existence or an old name alone is never sufficient.
- `dashboard_private.resolve_registration_default_director(p_subject text, p_school_grade text, p_inquiry_at timestamptz) returns jsonb` mirrors the approved year-aware rule in SQL and returns `{ profileId, ruleKey, directorName }` only when exactly one visible teacher-catalog/admin-profile mapping matches the expected name. Derive the effective year only with `extract(year from p_inquiry_at AT TIME ZONE 'Asia/Seoul')`; never depend on the database session timezone, and use that same Seoul year in the persisted rule key. Mathematics resolves `강정은` for elementary/middle and `양소윤` for high school. English uses the 2026 grade/name cohorts and shifts each teacher's cohort forward one grade per calendar year exactly as the existing JS resolver; unsupported grades, zero matches, or multiple matches return an unavailable result rather than guessing. Source/runtime fixtures compare the SQL rule table against the JS rule fixtures for 2026, 2027, boundary grades, and UTC timestamps on both sides of the Seoul Dec-31/Jan-1 boundary.
- `dashboard_private.assert_registration_track_director_ready(p_track_id uuid) returns void` locks/reads the track's current parent/detail inputs, requires the stored profile to pass the active predicate, and, when assignment source is `default`, requires both stored profile and stored rule key to equal the current SQL resolver result. Manual/migration assignments need only the active predicate. Direct phone routing, completed-level-test queue creation, phone/visit consultation completion, visit save/replacement, migration-review consultation targets, visit-cancel-to-phone, and reopen call this exact helper under the current parent/track locks and raise `registration_director_refresh_required` on absence, inactive ownership, or a stale default after grade/year change.
- `dashboard_private.apply_student_class_roster_mode(p_student_id uuid, p_class_id uuid, p_next_mode text, p_expected_mode text, p_claim_enrollment_id uuid, p_memo text, p_actor_id uuid) returns jsonb` is the only database writer for the four canonical roster projections and accepts `enrolled`, `waitlist`, or `removed`. The live columns are JSONB, not PostgreSQL `uuid[]`: coalesce SQL null to `[]::jsonb`, require `jsonb_typeof(...) = 'array'`, require every element to be a valid UUID string, normalize/deduplicate in stable UUID order, and write JSONB arrays back. A scalar/object/non-UUID element raises `registration_roster_projection_invalid` before any write. Lock the student, active registration student/class claim row, and class in the declared global order; validate that the current student/class projections agree and equal `p_expected_mode`, otherwise raise `registration_roster_mode_conflict`.

  An `ops_registration_enrollments` row with `roster_active = true` makes `(student_id,class_id)` ownership explicit regardless of whether it is planned-in-batch, waitlisted, or enrolled. A registration mutation must pass that exact enrollment ID; a null/different claim raises `registration_student_class_claim_conflict`. A generic roster command passes null and is allowed only when no roster-active registration claim exists. A supplied claim ID with no matching roster-active row is also rejected. This prevents another registration case or a management screen from treating an already claimed pair as its idempotent no-op. `enrolled` sets `students.status = '재원'`, adds `class_id` to `students.class_ids`, removes it from `waitlist_class_ids`, adds `student_id` to `classes.student_ids`, and removes it from `waitlist_ids`. `waitlist` first rejects an enrolled current mode, sets the student status to `재원`, removes the class/student from both enrolled JSONB arrays, and adds them to both waitlist JSONB arrays. `removed` removes both IDs from all four arrays; it deliberately leaves `students.status` unchanged because withdrawal—not registration cancellation—owns the `재원` -> `퇴원` transition. After re-reading and proving symmetry, insert exactly one `student_class_enrollment_history` row only when the mode actually changed. Preserve the existing table constraint by encoding logical removed as SQL `next_mode = NULL` (and a missing prior relationship as `previous_mode = NULL`); use action `enrolled|waitlist|removed`, the supplied memo, and `changed_by = p_actor_id`. The helper/API maps SQL null back to logical response mode `removed`, so it never attempts to insert the forbidden literal `removed` into `next_mode`. Return the committed normalized four-array snapshot; any mismatch or history failure rolls back everything.
- `dashboard_private.apply_registration_current_class_wait(p_task_id uuid, p_track_id uuid, p_class_id uuid, p_actor_id uuid) returns void` applies the shared student-identity rule, validates class subject, and under student -> existing claim/enrollment -> class locks creates the one waitlisted enrollment with its resolved `student_id`. The partial unique student/class claim must succeed before any roster write. A new claim requires current roster mode `removed`; an exact same-track owned wait row may require/currently remain `waitlist`. Delegate with the exact claim row ID and expected mode to `apply_student_class_roster_mode`. A claim owned by another case/track raises `registration_student_class_already_active`; it is never treated as success.
- `dashboard_private.transition_registration_track_status(p_track_id uuid, p_next_status text, p_next_waiting_kind text, p_next_retake_decision text, p_next_migration_review_required boolean) returns boolean` is the sole post-migration writer for `pipeline_status` and its CHECK-coupled companions. Validate that waiting kind is non-null exactly for `waiting`, migration-review-required is true exactly for `migration_review`, and retake decision is null outside `waiting`; reject invalid combinations before writing. In one `UPDATE`, set status, waiting kind, retake decision plus its decided timestamp, migration-review flag, and `updated_at`; set `stage_entered_at = now()` only when the machine status is distinct, otherwise preserve it. A real status change returns true. A same-status companion edit may update waiting kind/retake decision and `updated_at` but returns false; an exact no-op performs no write. This single atomic statement is required because the immediate table CHECK constraints make separate companion/status updates invalid in either order. Every RPC supplies all four next-state values explicitly. Backfill alone bypasses the helper to preserve historical `stage_entered_at` while inserting already-consistent rows. Source/runtime tests cover transition into/out of waiting, migration-review exit, real transition stamping, same-stage companion edits, exact no-op preservation, and same-key replay preservation.
- `dashboard_private.set_student_class_roster_mode_impl(p_student_id uuid, p_class_id uuid, p_next_mode text, p_expected_mode text, p_memo text) returns jsonb` is a fixed-owner `SECURITY DEFINER` command for existing non-registration roster screens. It preserves the latest authoritative student/class write policy and permits only `admin`/`staff`; assistants are explicitly denied. Validate `auth.uid()` and normalize both modes to `enrolled|waitlist|removed`. Under student -> roster-active registration claim -> class locks, reject `registration_student_class_claim_conflict` whenever a roster-active registration enrollment owns the pair—even when current mode already equals the requested target. With no claim, an exact current==target is a replay-safe no-op; otherwise require current mode to equal `p_expected_mode`, then delegate with null claim ID to `apply_student_class_roster_mode`. The exact camelCase response is `{ studentId, classId, previousMode, nextMode, changed, studentClassIds, studentWaitlistClassIds, classStudentIds, classWaitlistIds }`, with every array a normalized UUID-string array. Its public wrapper has the identical signature and is `SECURITY INVOKER`.
- `complete_ops_withdrawal_roster_transition` replaces the existing client-side remove/status/checklist/rollback sequence for a withdrawal whose requested status is `done`. Withdrawal is a whole-student academy exit, not a one-class cancellation: the selected source class is an identity/intent anchor, while completion enumerates every symmetric current `enrolled` **and** `waitlist` class for the locked student and every 0-or-1 roster-active registration claim for those pairs. Legacy or management-created relationships may have zero claim; one claim per pair identifies its registration track/parent; more than one for a pair is `registration_student_class_claim_invariant`. Resolve the source student identity and current claim-parent set without authority, lock the withdrawal task plus those parents in UUID order, acquire the same deterministic registration-student identity advisory lock used by materialization, then lock/revalidate the student, claim rows, batches, and classes in global order. After the student lock, re-read every claim/open-batch parent; if the set differs from the prelocked set, raise `registration_workflow_retry_required` without acquiring a new parent lock or mutating anything. Reject `registration_open_admission_batch` if any roster-active planned claim/open batch exists for that student; the operator must cancel it first. This rescan plus the withdrawn-student guard on every claim creator gives a single winner even when batch start/current-class wait had locked its parent but not yet materialized a claim. Require admin/staff access, a completed withdrawal checklist, the same locked student/source class as the task, the source among the current enrolled set, and symmetric projections for every affected pair. For each enrolled pair call `apply_student_class_roster_mode(..., 'removed', 'enrolled', optionalClaimId, ...)`; for each waitlist pair use expected mode `waitlist`. A claimed enrolled row keeps `status = 'enrolled'` but sets `roster_active = false`, release timestamp/reason/source task, and `roster_release_kind = 'withdrawal'`. A claimed waitlisted row becomes `status = 'canceled', roster_active = false` with null release metadata and an immutable withdrawal-canceled event, and its `waiting/current_class` track atomically moves to `not_registered` so no current-class wait remains. Unclaimed pairs write no registration release event. Only after every relationship is removed, set the student to `퇴원`, mark `timetable_roster_updated`, complete the task, and write existing checklist/auto-sync plus conditional registration events in the same transaction. Preserve every paid batch, enrolled row core fields, and registered-track/admission outcome as history. Same-key replay returns the original committed response; any failure rolls back all removals, track transitions, claim releases, student status, and completion. The UI confirmation lists every affected enrolled/waitlist class. Runtime fixtures cover multi-class/two-subject withdrawal, registered-English/current-class-waiting-Math, and withdrawal racing both batch start and wait materialization; no winner may leave `퇴원` with a live claim.
- `complete_ops_transfer_roster_transition` replaces the existing client-side remove/add/status/checklist/rollback sequence for a transfer whose requested status is `done`. Resolve the source student/classes and a 0-or-1 roster-active source registration claim without authority; allow zero for legacy/management rosters, derive optional registration track/parent from one, and reject an invariant count above one. Lock the transfer task plus optional registration parent in UUID order, then optional track, student, optional source claim, and both classes sorted by UUID, and re-read the claim cardinality. Require the same locked student/from-class as the source task, a different valid destination class, a completed transfer checklist, source mode `enrolled`, destination mode `removed`, the exact source claim when present, and no roster-active registration claim for `(student,destination)`. In one transaction remove the source roster projection using the exact optional claim ID, conditionally release that source enrollment with `roster_release_kind = 'transfer'` and source-task metadata, add the destination roster projection through the shared helper with no registration claim, keep the student `재원`, mark `timetable_roster_updated`, complete the transfer task, and write both existing task events plus the conditional immutable registration-release event. A prior paid registration enrollment remains `enrolled` history but inactive; the destination relationship belongs to the transfer workflow rather than manufacturing a paid registration enrollment. Same-key replay is stable and any later failure restores both classes, any source claim, task/checklist state, student status, and every history write. Runtime fixtures cover both claimed and unclaimed withdrawal/transfer completion.
- Neither cross-workflow RPC exposes a standalone “release claim” primitive. `ops-task-service.ts` calls the matching RPC instead of writing roster arrays, student status, history, detail checklist, or final task status itself; the pre-completion edit path may still save ordinary source fields, but the final `done` transition is database-owned. Runtime fixtures inject a failure after the first logical roster step in each RPC and prove there is no partially released claim or half-completed withdrawal/transfer.
- Add `dashboard_private.prevent_ops_roster_completion_bypass()` as a `SECURITY INVOKER`, empty-search-path trigger guard. On insert, a withdrawal/transfer task must start non-`done`; direct terminal creation raises `ops_roster_completion_requires_rpc`. On update, when `OLD.type IS DISTINCT FROM NEW.type` and either side is `withdrawal` or `transfer`, raise `ops_roster_type_immutable`, so a caller cannot reclassify an open roster task to general and complete it in two writes. A direct authenticated transition of a withdrawal/transfer task into `done` also raises unless `current_user = 'postgres'`. For each withdrawal/transfer detail insert or update, lock/read its parent, require the parent type to exactly match the detail table, and reject a true `timetable_roster_updated` on insert or a false-to-true update unless `current_user = 'postgres'`; a general task can never host a roster detail as a bypass. Install it as `BEFORE INSERT OR UPDATE OF type, status` on `ops_tasks` and `BEFORE INSERT OR UPDATE OF timetable_roster_updated` on both details; revoke its direct execution. A private completion implementation runs as fixed owner `postgres`, while an ordinary browser write runs as `authenticated`, so only the atomic path may stamp final state. No other task/status or pre-completion field is affected. Runtime tests prove even an admin cannot use direct terminal task/detail inserts, one-statement/two-step type changes, a general-task/detail mismatch, or status/checklist bypasses, while normal nonterminal/false creation and both claimed/unclaimed RPC completions pass.
- Install `SECURITY INVOKER` trigger helpers for the ready-mode gateway. On authenticated `INSERT` into `students` or `classes`, roster columns may be SQL null or canonical empty JSONB arrays only; a nonempty/scalar/object value raises `registration_roster_write_requires_rpc`. On roster-array updates, any direct authenticated change raises the same error. Also guard `students.status`: any real transition with `current_user <> 'postgres'` raises `student_status_transition_requires_workflow`. Only postgres-owned roster commands may set `재원`—a genuine admin/staff class/waitlist assignment is an explicit reactivation—and the atomic withdrawal RPC may set `퇴원`; a future status-only reactivation still requires its own workflow instead of a field flip. Ordinary management edits strip/disable status. Student/class deletion inspects both sides and protected history, rejecting linked/history-bearing records; only unlinked, never-used mistakes may be physically deleted. Revoke direct execution on trigger/helpers. This current-user distinction is confined to the roster/status gateway; business invariant triggers validate values regardless of caller.
- Drop the current broad `student_class_enrollment_history_staff_write` path, execute exact `REVOKE ALL ON TABLE public.student_class_enrollment_history FROM anon, authenticated`, then `GRANT SELECT ... TO authenticated` with the existing read policy. This removes INSERT/UPDATE/DELETE plus TRUNCATE/TRIGGER/REFERENCES; RLS alone cannot protect TRUNCATE. The postgres-owned roster helper is the sole history writer. Preserve existing authenticated read visibility, but direct teacher/admin/staff history forgery, mutation, deletion, or truncate must fail; source and runtime tests cover the privilege set.

Refactor every current roster writer in the same release before installing those triggers. In `ops-task-service.ts`, the ready-mode branches of `assignOpsStudentToClass`, `assignOpsStudentToWaitlist`, removal, and every `restore*RosterSnapshot`/rollback/inverse path use `set_student_class_roster_mode` with the exact expected current mode; if a concurrent command changed the pair, the inverse receives a conflict and surfaces explicit recovery rather than overwriting newer truth. In `management-service.js`, `assignStudentToClass`, `removeStudentFromClass`, and their rollback paths use the same RPC. Their local objects are built only from its committed response. Ready-mode ordinary create/update/upsert payloads strip all four canonical roster fields **and `status`**; status is displayed read-only and changes only as a consequence of the roster/withdrawal workflow. Create the row unlinked, then add requested links through the RPC. Before any `deleteStudent`/`deleteClass`, check the union of own-side/reverse-side links and protected history. If any link or history exists, do not unlink merely to delete; route to withdrawal/inactive archival. Physical DELETE remains only for already-unlinked, never-used mistaken records, and the trigger repeats that proof atomically. Refactor every direct history insert to the RPC/helper as well. Keep the old direct implementation isolated behind an explicit `legacy` runtime adapter only when both readiness function and child tables are absent. `maintenance` blocks all roster controls app-wide with `데이터 전환 중`—it never falls back—so the migration trigger and client refactor have no mixed-version window. Runtime tests deny direct admin `재원 <-> 퇴원` flips and prove roster/withdrawal/transfer RPCs set the intended status.

Implement that mode decision first in `registration-runtime-probe.ts`. The readiness RPC treats `PGRST202`, SQL `42883`, or the narrowly matched PostgREST missing-function/schema-cache message as “function absent”; other errors throw. Only then issue the zero-row/head child-table probe. That probe treats SQL `42P01` and PostgREST `PGRST205` as “table absent” -> legacy; an existing table -> maintenance; every other error throws. Exact readiness version 1 -> ready. It owns the sole session cache and cache reset hook; Task 3 imports it directly, and Task 4 re-exports/consumes it rather than implementing a second probe. Its standalone test covers PGRST202, 42883 message matching, PGRST205, 42P01, all three modes, unexpected-error propagation, in-flight dedupe, cache reset, and the guarantee that maintenance never falls back to legacy writes. This makes the Task 3 service checkpoint independently executable before the focused registration service exists.

`registration-service-hardening.test.mjs` and `management-class-student-roster.test.mjs` assert admin/staff RPC access, assistant denial, expected-mode conflicts, exact committed-response mapping, maintenance blocking, legacy-only fallback, ready-mode create/update/upsert field stripping, safe inverse handling, linked/history-bearing delete blocking with archive redirection, never-used delete allowance, asymmetric insert denial, and direct history forge/delete denial. A source scan fails if any ready create/update/upsert/restore/delete branch writes the four canonical arrays or history table directly. Extend the two-client concurrency script with one admin using the generic roster RPC while another completes a registration batch on a different class for the same student; after both commit, neither relationship is lost, all four JSONB projections are symmetric, and history contains one row per real transition. This closes the stale browser read/whole-array overwrite race outside registration RPCs.
- `dashboard_private.write_registration_track_event(p_task_id uuid, p_track_id uuid, p_event_type text, p_source text, p_destination text, p_reason text, p_metadata jsonb) returns void` inserts one `ops_task_events` row with fixed `event_type = 'registration_track_event'`, `field_name = 'registration_track:' || track_id`, and canonical `after_value` JSON: `{ version: 1, eventType, actorId, trackId, subject, source, destination, reason, metadata, occurredAt }`. Every transition uses this helper. Appointment mutations write one event for every affected track with metadata `{ appointmentId, notificationRevision, changeKind, activeTrackIds, canceledTrackIds }`; batch events put all affected track IDs in metadata. The notification route accepts an appointment revision only when these canonical per-track events agree. The UI parses only version 1 and falls back to plain legacy event text.
- `dashboard_private.derive_registration_parent_projection(p_task_id uuid) returns jsonb` is a read-only deterministic helper containing the projection algorithm. `dashboard_private.recompute_registration_parent(p_task_id uuid) returns void` locks the parent, obtains that JSON, and is the only compatibility projection writer after child rows exist. The derived state is `requested` only when every track is inquiry and no batch is open; `in_progress` while any track/batch is open; `done` when all are terminal and any is registered; otherwise `canceled`. Completion time is stable: every open projection writes `completed_at = null`; an ordinary open -> done/canceled transition stamps the transaction time; recomputing the same already-terminal projection preserves the locked prior `completed_at` exactly. During backfill, a still-terminal legacy parent preserves a valid historical completion, or uses the latest attributable legacy terminal timestamp then parent `updated_at`/`created_at` when the field is missing; reopening into migration review clears it. Thus common edits and saved unbatched add-class drafts cannot rewrite closed history. The helper writes the earliest non-terminal legacy pipeline by workflow order and projects invoice/payment from the latest non-canceled batch. Parent director compatibility follows the authoritative design exactly: choose the first nonterminal track by English before mathematics, then track UUID, regardless of whether it currently has a director. Project that track's director/profile name when present; when the chosen first track is unassigned—or when every track is terminal—set both `ops_tasks.secondary_assignee_id` and `ops_registration_details.counselor` to SQL null. Never fall through to a later mathematics director merely because the earlier English track is unassigned.

  For representative class/textbook and MakeEdu only, define the compatibility-enrollment set as every non-canceled row except an unbatched `planned` row whose track is still `registered`; that exception is a saved add-class draft and must not alter a closed parent's legacy projection until `start_registration_admission_batch` attaches it and reopens the track. Choose representative class/textbook from this set by English-before-math, enrollment `sort_order`, then enrollment UUID as the mandatory final tie-breaker, and compute MakeEdu only from this set. Existing enrolled rows retain precedence naturally because the closed-track add-class drafts are excluded. Closed compatibility is `7.` when any registered, otherwise `8.` when any not-registered, otherwise `9.`. Projection fixtures assert mixed English/math ownership, first-English-unassigned null projection despite a directed mathematics track, terminal clearing, equal-sort deterministic selection, closed-time preservation on recompute/add-class draft, open-transition stamping, and backfill historical-time preservation.

The legacy pipeline projection inside `recompute_registration_parent` is exact: inquiry/migration review -> `0.`; scheduled/in-progress test -> `1.`; phone/visit consultation -> `2.`; waiting kind -> `4-1./4-2./4-3.`; enrollment decided -> `5.`; processing with draft batch -> `5-1.`; processing with invoiced/paid batch -> `6.`; registered -> `7.`; not registered -> `8.`; inquiry-only -> `9.`. Every private mutation calls the helper once after its authoritative child writes and before saving its receipt.

In this new mutation migration, use this exact order; never edit the historical migrations:

1. Create the derive/recompute helpers.
2. `CREATE OR REPLACE public.prevent_completed_operation_reopen()` with the child-aware rule. It keeps the existing rule for non-registration operations. When registration child tracks exist, it permits any status change—including done to in-progress/canceled—only when `NEW.status` and `NEW.completed_at` exactly equal the current child-derived projection. This must be active before normalizing a legacy `done` parent whose new tracks are open migration review.
3. Under the literal marker `-- registration_backfill_parent_recompute`, iterate every backfilled task with child tracks in `order by task.id`, call `dashboard_private.recompute_registration_parent(task.id)`, then run one assertion query that raises `registration_parent_projection_mismatch` if any parent status/completed time/subject or derived detail projection differs. A fixture covers progressed multi-subject `done`/legacy `6.` -> open `migration_review`/`0.`, followed by a successful common edit and review resolution.
4. Only after zero mismatches, create `public.prevent_registration_compatibility_override()` and install its trigger. For child-backed registrations, derived `ops_tasks.subject/class_id/textbook_id/secondary_assignee_id`, `ops_registration_details.pipeline_status/counselor/makeedu_registered/makeedu_invoice_sent/payment_checked` must equal `derive_registration_parent_projection`. Historical class-start/level-test/phone-consultation/visit-consultation fields and obsolete `textbook_ready`/automatic-checklist fields must remain `IS NOT DISTINCT FROM OLD`. `admission_notice_sent` is deliberately not a derived/immutable field: RLS already blocks direct child-backed detail DML, and only `mark_registration_admission_notice_sent` may change it after verifying an accepted message. The runtime packet proves that RPC can stamp the flag through the trigger.
5. Keep both migrations inside the same announced maintenance window with every roster writer still paused. At the literal mutation marker `-- global_roster_gateway_lock`, set the same five-second local lock timeout, acquire `public.students` then `public.classes` in `SHARE ROW EXCLUSIVE` mode, and hold both locks through commit. Under those locks, repeat the global four-JSONB projection validation with no repair path and require zero malformed, asymmetric, duplicate, or dual-mode pairs; raise `registration_global_roster_repair_required` or `registration_roster_projection_invalid` otherwise. Require every `퇴원` student to have empty own/reverse roster projections and zero `roster_active` registration enrollments, otherwise raise `registration_withdrawn_roster_review_required`. Also assert that every registration parent has one detail and exactly one or two exact subject tracks matching the normalized parent projection; raise `registration_subject_track_coverage_mismatch` otherwise. The second locked scan closes the inter-migration TOCTOU window. Only then, while those locks remain held, install direct roster/status/history guards and create/grant `registration_subject_tracks_runtime_version()` last. It returns `1`; its existence means both migrations, normalization, coverage checks, guards, and functions are installed. Revoke PUBLIC/anon execution and grant authenticated execution.
- These two parent-compatibility trigger functions are fixed-owner `SECURITY DEFINER`, use `search_path = ''`, schema-qualify all reads, and have default execute revoked from browser roles. They expose no RPC endpoint; the trigger engine invokes them. Their logic is purely invariant-based and never distinguishes callers via `current_user` or `session_user`. The separately specified roster/status completion gateway is intentionally `SECURITY INVOKER` and may distinguish authenticated DML from postgres-owned atomic RPC writes.
- Set every private implementation/helper owner explicitly to `postgres`, revoke table access from browser roles, and test that authenticated generic mismatched parent/detail writes fail while add-class, last-enrollment cancel, and batch-cancel RPC-derived writes pass.

- [ ] **Step 5: Implement exact business invariants for every RPC**

Implement these operations, without client-side multi-write substitutes:

- `create_registration_case`: normalize `p_subjects` as a set, require exactly one or two distinct values, raise `registration_subjects_required` for empty input, and reject every value outside exact English/math, then insert `ops_tasks`, `ops_registration_details`, one track per subject, and a mutation receipt in one transaction. Also require student name, grade, valid parent phone, and inquiry time. The public signature has no `p_student_id`; the removed existing-student control cannot inject an arbitrary link. New inquiry parents begin with `student_id = null`, and the first waitlist/admission materialization performs the locked exact-identity resolution described below.
- `sync_registration_case_subjects`: normalize `p_subjects` as a set and require exactly one or two distinct exact English/math values before any write. Add selected inquiry tracks and remove only inquiry tracks with no operational activity, manual/migration ownership, appointment/attempt/consultation, wait/enrollment/batch, or non-default business history; empty input/last-track removal always raises `registration_last_subject_required`. A durable automatic-default assignment and its `director_default_resolved` event alone are explicitly removable: delete that unused track and record one parent-scoped `registration_subject_removed` event containing the removed subject/default provenance so audit is preserved without keeping a phantom track. Any manual assignment or later activity still blocks removal and requires explicit closure. Recompute the legacy subject projection and assert the parent still has one or two tracks before saving the receipt. Runtime/UI tests cover create-dual -> persist both automatic defaults -> remove one untouched inquiry subject, plus manual-assignment/activity denial.
- `update_registration_case_common`: lock one existing registration parent/detail and update only `ops_tasks.student_name/title/campus/priority` plus `ops_registration_details.inquiry_at/school_grade/school_name/parent_phone/student_phone/request_note`. Require `p_expected_common_revision` to equal the locked detail revision after exact same-key receipt replay is checked; otherwise raise `registration_common_revision_conflict` with no write. Require the same student-name, grade, valid parent-phone, inquiry-time, campus, and priority validation as creation. It never accepts or rewrites subject, stage, director, class, textbook, appointment, result, consultation, or checklist fields, so the compatibility guard cannot be bypassed by a whole-form update. On success increment `common_revision` exactly once and return the new value with one common-info event and one receipt in the same transaction. Compare normalized NEW versus OLD values for all four identity fields (`student_name`, `school_name`, `parent_phone`, `student_phone`) under lock. Freeze identity changes once any roster/admission history exists: any admission batch; any enrollment row that is not unbatched `planned`; `admission_notice_sent = true`; or any admission-application message with `claim_active = true`, including a manually reconciled failed-hold. A definitively failed or explicitly released row with `claim_active = false` releases only the message boundary when no other history exists. After the freeze reject every identity-field change with `registration_student_identity_correction_required`, even when the new value happens to match the linked student row; leave the entire edit unchanged so a claimed or sent application can never point at a prior identity. Before that boundary, a changed identity that no longer exactly matches a persisted `student_id` may clear only that stale parent link and record `student_link_recheck_required`. Never mutate the shared `students` row or auto-create a student during common-info editing. Runtime fixtures cover safe pre-roster unlink, stale common-revision denial, pending/accepted/unknown/failed-hold freeze, released-failed unfreeze, optional-field changes that still match but are rejected after history, rejection after current-class waiting, and rejection after completed registration.
- `route_registration_inquiry`: after locking, require the source track to be exactly `inquiry`; stale callers may not jump a scheduled, consultation, waiting, registered, or terminal track through this RPC. Accept only `consultation_waiting`, `waiting`, or `inquiry_closed`. Direct consultation calls `assert_registration_track_director_ready` under lock, catching inactive ownership and stale defaults; otherwise return `registration_director_refresh_required`. It creates exactly one active `phone/waiting` consultation row and does not create a reservation time. This ordinary phone-queue entry creates no dashboard reservation notification: the director works the oldest-first consultation queue, while notifications are reserved for a real visit reservation or an ownership handoff/repair. Waiting requires one of the three waiting kinds and resets the three-state retake decision; `current_class` additionally requires a same-subject class and atomically creates the one waitlisted enrollment plus both roster projections. Level-test routing is performed only by saving a real shared test appointment, never by creating an appointment-less scheduled status. A pgTAP fixture calls the RPC from a later stage and requires `registration_invalid_source_state` with no child/event mutation.
- `assign_registration_track_director`: validate every non-null profile with `is_active_registration_director` and accept UI commands only `default`, `manual`, or `clear_default` (`migration` is backfill-only). Every command requires a non-null `p_expected_common_revision` equal to the locked detail revision after same-key replay; otherwise return `registration_common_revision_conflict`. A default assignment additionally requires a canonical non-empty rule key and may update only a null/default nonterminal track. Run `resolve_registration_default_director` against the current locked subject/grade/inquiry time and require both `p_director_profile_id` and `p_rule_key` to equal its unique result; otherwise raise `registration_director_default_stale`. This prevents a buggy caller from labeling another active principal as the default and prevents a delayed revision-A resolution from landing after revision B. Manual assignment uses the revision currently displayed in detail but remains an explicit operator choice independent of the default rule. When the valid rule key or resolved profile changes after grade/inquiry-year edits, update the default and record `director_default_resolved`. A manual assignment stores a null rule key, `director_assignment_source = 'manual'`, `director_assigned_at = now()`, and records `director_manual_override`; later default passes must leave it unchanged. `clear_default` requires `p_director_profile_id` and `p_rule_key` both null, permits only a currently null/default nonterminal track, and atomically clears profile/source/rule/assigned time when the SQL resolver is unsupported/unavailable. It never clears manual or migration ownership. Backfill preserves legacy directors as `migration`, which is also never auto-overwritten. Persist the per-track director/source/key atomically and update the legacy parent projection. If one active phone-waiting consultation exists, a non-null reassignment updates its director snapshot in the same transaction; clearing leaves the required historical snapshot intact but current-track ownership becomes null, so completion is denied until management assigns a valid director and the next assignment refreshes the snapshot. Cancel/replace the stale director's queue notification and surface a management `담당자 지정 필요` notification. If an active visit consultation exists, block reassignment or clearing with `registration_visit_reassign_requires_reschedule`; cancel/rebook the visit instead. Completed/canceled consultations remain immutable history. Terminal `registered`, `not_registered`, and `inquiry_closed` tracks reject every standalone assignment/clear so grade or inquiry-time edits cannot rewrite historical ownership; saving an add-class draft does not create an exception.
- `save_registration_shared_appointment`: normalize `p_track_ids` to a distinct UUID set before fingerprinting or validation, require one or two tracks, and raise `registration_appointment_tracks_required` for an empty set so creation/edit can never leave an orphan appointment; removing every participant uses the explicit cancel RPC. For create, require both `p_appointment_id` and `p_expected_notification_revision` null. For edit/replacement, require a non-null expected revision, fingerprint it, lock the appointment, and reject a stale `notification_revision`. Lock task/tracks and confirm one parent. For `visit_consultation`, call `assert_registration_track_director_ready` for every selected/remaining track. Accept a newly selected level-test track only with no active attempt and source (a) inquiry, (b) waiting with retake required, or (c) scheduled with latest absent/canceled; completed is never reschedulable.

  For `waiting/current_class` retest entry, follow actor -> parent -> track/appointment activities -> persisted student -> active waitlisted enrollment -> class. Require that enrollment's `student_id` and class match the track, current symmetric roster mode is `waitlist`, and the roster-active student/class claim is exactly that waitlisted row. Call `apply_student_class_roster_mode(student, class, 'removed', 'waitlist', waitEnrollment.id, ...)`, then mark the row canceled with `roster_active = false`, null release metadata, and reason `level_test_retake_scheduled`, and atomically transition the track to `level_test_scheduled` with null waiting/retake companions. This is the sole retest-exit path and reverses neither the student/enrollment lock order nor another case's claim. Reject a newly selected visit track unless consultation-waiting with no active visit elsewhere. Before inserting its visit child, lock and cancel that track's exact active `phone/waiting` consultation with reason `visit_scheduled`; every nonselected subject's phone row stays active. Creation makes one appointment plus one attempt/visit child per selected track.

  While all existing children remain scheduled, the selected-track diff adds/cancels activities authoritatively, updates shared time/place, and increments notification revision once per real diff. Deselecting a scheduled level-test child cancels that child with reason `appointment_subject_deselected` and, when no other active attempt remains, atomically returns only that subject track to `inquiry`; it may never leave `level_test_scheduled` without an active reservation. Deselecting a scheduled visit child returns that subject to consultation waiting and creates one phone-waiting row only when its director is ready, using the same assignment-required response as full cancellation otherwise. Same-key/no-op edits preserve the revision; ordinary edit is forbidden after any terminal child. Runtime fixtures cover dual-test edit to one subject (deselected track inquiry, selected track still scheduled), dual-visit edit to one subject (one phone queue plus one visit), and single-subject visit scheduling that cancels only its prior phone row.

  `p_replace_remaining=true` checks the old expected revision and requires normalized `p_track_ids` to equal the exact set of every currently scheduled child track on that old appointment. It permits neither adding a new track nor moving only a subset; those are separate edits/new reservations, because a partially terminal appointment's remaining-child replacement must have one unambiguous audit boundary. Validate every moved visit track's current director, increment the old appointment revision, mark all moved scheduled children canceled/replaced, and create a replacement appointment at revision 1. It then creates one new active child for every moved subject: a moved level-test subject gets a new `scheduled` attempt on the new appointment with `attempt_number = locked max + 1`; a moved visit subject gets a new `scheduled` consultation on the new appointment with the locked current director snapshot. The track remains in its corresponding scheduled machine state, terminal old children stay untouched, and both appointment statuses are recomputed only after the new children exist. No immutable old `appointment_id` is rewritten. Each affected track event stores appointment ID, revision, active/canceled track IDs, change kind, and reason. The RPC response always includes the new authoritative `appointmentId`/`notificationRevision`, `requiresDirectorAssignmentTrackIds`, plus `notificationTargets: [{ appointmentId, notificationRevision }]` for every old/new visit appointment whose directors or management summary must be refreshed. Tests cover empty-set rejection, duplicate-ID set semantics, duplicate-active rejection, inactive/stale-default visit denial, stale-revision rejection, exact remaining-set enforcement, current-appointment inclusion, current-class-retake roster removal, completed-English/absent-mathematics attempt-2 rescheduling, add, deselect, time/place edits, revision-stable retries, old/new replacement targets, old/new child counts and IDs, incremented attempt numbers, no orphan replacement appointment, all-scheduled edit, and partially-terminal remaining-child replacement.
- `cancel_registration_appointment`: require the caller's expected notification revision plus a reason; after locking, reject a stale revision with `registration_appointment_revision_conflict`. Cancellation itself remains allowed when a director is inactive. Cancel only still-scheduled child activities, preserve completed/absent history, return a level-test track with no remaining active attempt to `inquiry`, and return affected visit tracks to consultation waiting. For each visit track, create a fresh phone-waiting row only when `assert_registration_track_director_ready` succeeds; otherwise create no live queue row, record `director_assignment_required`, and return that track in `requiresDirectorAssignmentTrackIds` so management assigns a valid director before routing. A partially terminal appointment cannot erase terminal children. Increment `notification_revision` exactly once, write the same revision metadata/event, and return `notificationTargets` for visit appointments so cancellation notices are delivered only after commit. Same-key replay returns the same revision/targets.
- `start_registration_level_test_attempt`: require a scheduled attempt and a `level_test_scheduled` track, stamp the start event/server time, and move only that subject to `level_test_in_progress`.
- `complete_registration_level_test_attempt`: accept absent/canceled directly from scheduled, but accept completed only from in-progress. Completed requires a result URL and calls `assert_registration_track_director_ready` before any queue write; surface `registration_director_refresh_required` rather than a foreign-key error for missing/inactive/stale ownership. Update the shared appointment only after all attempts are terminal, mark an all-canceled appointment canceled, and for each completed subject atomically create exactly one active `phone/waiting` consultation row before advancing it to consultation waiting. Absent/canceled requires neither URL nor director and remains allowed when a director is unavailable, leaving the track reschedulable in the level-test tab.
- `close_registration_level_test_track`: require a reason, a `level_test_scheduled` track with no active attempt, and a latest terminal attempt of absent/canceled; then close only that subject as inquiry-only and preserve every attempt.
- `complete_registration_consultation`: use the concrete SQL pattern above; visit and phone outcomes are identical after validating their mode-specific state. If the outcome is `waiting/current_class`, require and validate `p_class_id`, create the waitlisted enrollment, and update both roster projections in the same transaction. A shared visit appointment becomes completed only after every visit child is completed or canceled, so one subject can finish while another remains pending.
- `transition_registration_waiting`: accept only `change_waiting_kind`, `record_retest_required`, `move_to_enrollment`, or `close_not_registered`. Changing to current-class waiting requires a same-subject class and atomically creates/updates its waitlist row and both projections. `record_retest_required` stores `required` but leaves the track waiting until a real level-test appointment is saved; that appointment removes the active waitlist projection and moves the track. `move_to_enrollment` requires `not_required`; closure requires a reason encoded in the event. Leaving current-class waiting always removes active projections but preserves the row as canceled history.
- `route_registration_enrollment_decision`: from `enrollment_decided` only, allow waiting or not-registered before processing starts; current-class waiting requires a same-subject class and symmetric waitlist update. Atomically mark every unbatched planned row canceled so stale active classes cannot block a later decision, while preserving each row/event as history.
- `save_registration_enrollment_rows`: allow only `enrollment_decided` tracks or `registered` tracks preparing an add-class revision. Each input object has an exact allowed-key whitelist: `id`, `classId`, `textbookId`, `classStartDate`, `classStartSessionKey`, `classStartSession`, and `sortOrder`. Reject every unknown key before fingerprinting, explicitly including both dialects of server-owned fields (`status`, `makeeduRegistered`, `makeedu_registered`, `admissionBatchId`, `admission_batch_id`, `trackId`, `track_id`) plus browser-only `clientKey`; never silently discard an alias. A provided ID must already belong to the supplied track and be an unbatched planned row; an omitted ID creates a row. Omission never deletes; the explicit cancel RPC handles removal/history. Validate track subject against every class, validate non-null textbook IDs against that class's linked `textbook_ids`, allow an all-null schedule only for drafts/waitlists, and reject another same-track/class row whose status is planned or whose `roster_active` is true; released enrolled history is allowed. For a non-null schedule, call `validate_registration_class_session`; require the browser label to equal the returned server label, fingerprint/store the canonical date/key/label, and rederive it at batch start/completion. Return exact camelCase `{ trackId, rows }` in stable order; same-key replay returns identical persisted IDs. Tests cover released-history re-enrollment, key/date/label mismatch, stale schedule removal, and canonical label.
- `claim_registration_admission_message`: this is the one explicit no-receipt, target-state-idempotent exception. Validate nonempty task/message keys, acquire an advisory lock derived from the canonical message key (not actor), reject `registration_message_request_key_reused` if that key already belongs to a different task or template, then lock parent task -> detail -> sorted tracks/enrollments. Require admin/staff. **Before evaluating new-send eligibility**, reload the task/template row with `claim_active = true`: pending, accepted, unknown, or failed-hold all return exact camelCase `{ taskId, messageId, messageRequestKey, claimStatus, claimActive: true, shouldSend: false, retryRequiresNewMessageKey: false }`; accepted enables mark-only recovery even if the last eligible track was routed away after provider acceptance, while the other three remain block-only. If the same message key belongs to an inactive failed row, return `{ taskId, messageId, messageRequestKey, claimStatus: "failed", claimActive: false, shouldSend: false, retryRequiresNewMessageKey: true }`. A key that belongs to another task/template is always an error. Only when no current active claim exists does the RPC revalidate child eligibility and identity under the locks before inserting a brand-new pending row.

  Otherwise insert one pending active `admission_application` row with `p_message_request_key` and the locked recipient last four, using `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Only the transaction whose actual `INSERT ... RETURNING` produced the new row may return exact winner payload `{ taskId, messageId, messageRequestKey, claimStatus: "pending", claimActive: true, shouldSend: true, retryRequiresNewMessageKey: false, studentName, parentPhone, commonRevision }`. Every same-key replay, different-key race loser, or unique-conflict path reloads canonical state and returns the exact false branch above; no `ops_registration_mutations` receipt ever stores or replays send authority. Once an active claim exists, common identity cannot change, so the route sends only the winner's locked snapshot. Source/runtime tests race same actor/same key and different actors/different keys, assert a cross-task key reuse error, and require exactly one true result/provider call. Only an inactive failed row permits a new send, and that send must use a brand-new message key.
- `reconcile_registration_admission_message`: require admin/staff plus a non-empty reason and JSONB provider evidence, resolve the task ID from the message without granting authority, then follow actor/request advisory -> parent/detail -> exact message lock order. Browser reconciliation never decides a `pending` provider call: return `registration_message_provider_check_required`, and let the server route inspect the provider before the finalizer records accepted, definitive failed, or unknown. Accept only `unknown -> accepted`, `unknown -> failed-hold`, or `failed-hold -> accepted`; a failed-hold is `status = 'failed' AND claim_active = true`. The evidence object allows exactly `providerMessageId`, `providerGroupId`, `lookupRequestKey`, `observedState`, `observedStatusCode`, and `observedStatusMessage`; reject unknown keys, require at least one nonblank provider ID or a `lookupRequestKey` equal to the locked message key, and require observed state `accepted|failed|not_found|closed`. Accepted requires `observedState = 'accepted'` plus a provider message/group ID. Failed-hold requires `failed|not_found|closed`. Normalize empty optionals to JSON null before fingerprinting. Accepted keeps `claim_active = true`; failed-hold also keeps it true and never exposes immediate resend. Stamp `updated_at = now()` on every real transition so the release delay starts at the manual decision, write one immutable reserved `registration_admission_message_reconciled` event with old/new status/claim/evidence, and store the receipt. Same-key replay is stable. Runtime/UI tests cover pending denial, malformed evidence, unknown-to-accepted, unknown-to-failed-hold, failed-hold-to-accepted when later provider evidence arrives, audit immutability, timer reset, and mark recovery.
- `release_registration_admission_message_retry`: require admin/staff, non-empty reason, the same exact JSONB evidence schema with observed state `failed|not_found|closed`, `status = 'failed'`, `claim_active = true`, and `updated_at <= now() - interval '15 minutes'`. Under actor/request -> parent/detail -> message locks, set only `claim_active = false` plus `updated_at = now()`, preserve the failed/provider record, write one immutable reserved `registration_admission_message_retry_released` event with old/new claim state, and return `{ taskId, messageId, messageRequestKey, status: "failed", claimActive: false, retryRequiresNewMessageKey: true }`. Never release pending, unknown, or accepted rows. Same-key replay is stable; a later send requires a new message key. This explicit `재발송 허용` action is the only human path that releases a failed-hold.
- `mark_registration_admission_notice_sent`: under the parent lock, first verify the supplied message request belongs to the same task/admission template and has status `accepted`. The one-time guard is task-level, not actor-receipt-level: if `admission_notice_sent` is already true, return the canonical stamped/no-op response without inserting another event, even when another admin uses another request key. Otherwise stamp the flag and exactly one admission-notice event, then store the actor receipt. Browser code never calls it directly. Runtime and route fixtures replay the accepted message as a second admin and assert one flag/event and no second send.
- `start_registration_admission_batch`: require every included track to be `enrollment_decided` or `registered` with new add-class rows, the canonical case-level `ops_registration_details.admission_notice_sent = true` stamp (accepted-but-unsynced alone is not enough), an explicit non-empty enrollment-ID set, at least one selected row for every included track, and no other open batch. Every selected row must belong to exactly one included track, be unbatched/planned, and pass class/subject/textbook/canonical-session validation; no unselected draft is attached implicitly. Resolve/materialize the task student, then obey parent -> sorted tracks -> student identity advisory/student row -> batch/enrollment rows -> sorted classes/textbooks. Under those locks require every selected student/class roster mode to be `removed`. Create the batch and set `student_id = resolved_student_id`, `admission_batch_id`, and `roster_active = true` on the exact selected rows in one transaction; the partial unique student/class claim must succeed for every row or raise `registration_student_class_already_active` and roll back the whole batch. This claim happens before invoice/payment work, so another case or the generic roster RPC cannot bill/mutate the same pair while the batch is open. Then move only included tracks to `enrollment_processing`.
- `set_registration_enrollment_makeedu`: toggle one current open-batch row only while the batch is `draft`; reject changes after invoice, payment, completion, or cancellation. The checklist derives the aggregate MakeEdu step from these rows.
- `advance_registration_admission_batch`: under the locked batch, `invoice_sent` is exactly `draft -> invoiced` and requires every non-canceled batch enrollment MakeEdu-confirmed; `payment_confirmed` is exactly `invoiced -> paid`. Stamp each timestamp/event once. A different actor/key repeating `invoice_sent` on already invoiced or `payment_confirmed` on already paid returns the canonical no-op state without restamping or another event; out-of-order actions and completed/canceled batches raise a state conflict. Same-key receipt replay returns the original response. Runtime/concurrency fixtures prove two actors cannot rewrite invoice/payment audit times.
- `cancel_registration_admission_batch`: require a non-empty top-level `p_reason` and allow only draft/invoiced batches before payment. Under the global lock order, set every still-planned selected row to `status = 'canceled'` and `roster_active = false` with null release metadata while preserving its frozen `student_id` and `admission_batch_id`; this releases the open-batch student/class claim without manufacturing withdrawal history and keeps exact canceled-batch membership reconstructable. Then cancel the batch and classify each participating track by whether any historical `status = 'enrolled'` row survives outside it, regardless of current `roster_active`; cross-workflow withdrawal/transfer release changes live ownership but does not erase the track's prior registered admission outcome. Such an add-class track is restored automatically to `registered` and must not appear in `p_resolutions`; unrelated unbatched add-class drafts may remain editable and stay excluded from closed compatibility. Only a track with no surviving historical enrolled row is first-admission and requires exactly one resolution `{ trackId, destination: "waiting" | "not_registered", waitingKind?: ..., classId?: uuid }`; reject missing/extra/duplicate resolutions and validate each current-class choice against that track's subject. For `waiting/current_class`, call `apply_registration_current_class_wait` after the old claims are released and before the atomic companion/status transition so the one replacement waitlisted enrollment and all four projections are committed with the batch cancellation; other waiting kinds create no roster link. Before routing that first-admission track, atomically mark every other unbatched `planned` row for the track canceled with null claim/release metadata and the same reason/event, including rows deliberately not selected into the batch, so waiting/terminal tracks retain no active draft. Preserve all row/batch history, assert every canceled selected row still references the canceled batch, use the top-level reason on every track event, recompute the parent together, and reject paid batches as requiring a separate finance-correction workflow.
- `complete_registration_admission_batch`: require locked batch status exactly `paid`, both invoice/payment timestamps, and every included row MakeEdu-confirmed; a draft/invoiced row with forged timestamps is denied. Lock the parent/tracks, persisted student, batch/rows, classes, and non-null textbooks in the global order. Revalidate the locked student identity and require it not withdrawn, plus every row's frozen student to match. For every row, rerun the full validator: class/subject, no other same-track/class row that is planned or roster-active, linked optional textbook, selectable canonical session, this row's exact roster-active student/class claim, and current roster mode removed. Then call the roster helper in class order, mark rows enrolled while preserving `roster_active = true`, mark tracks registered, complete the batch, and recompute projections. Return exact camelCase `{ batch, enrollments }` in stable order; same-key replay is identical. Any failed validator or later error rolls back every row, projection, history, and receipt.
- `cancel_registration_enrollment`: require a reason and allow unbatched planned or roster-active enrolled rows only; waitlisted rows must use `transition_registration_waiting` so the track cannot remain current-class waiting without a projection. Resolve IDs without authority, then obey actor advisory -> parent -> track -> student identity advisory/locked student when roster work may occur -> sorted batches/enrollments -> class. Under those locks reject `registration_open_admission_batch` if any nonterminal batch contains any enrollment for the track. This blocks both canceling an older enrolled row during an add-class revision and canceling a planned row already attached to an open batch; the operator must cancel or complete that batch first. Unbatched planned cancellation never deletes history, keeps student/batch null and `roster_active = false`, and leaves the current track state unchanged. Enrolled cancellation requires current mode `enrolled` plus this row's roster-active student/class claim, calls `apply_student_class_roster_mode(..., 'removed', 'enrolled', enrollment.id, ...)`, then atomically marks that row canceled with `roster_active = false` and null release metadata; student status is unchanged and its completed batch remains immutable. If another roster-active enrolled row remains, destination fields must be null and the track stays registered. Canceling the last roster-active enrolled row requires destination `enrollment_decided`, `waiting`, or `not_registered`. For `waiting/current_class`, after the old claim is canceled call `apply_registration_current_class_wait` before the atomic companion/status transition, so the replacement wait row and symmetric projections cannot be omitted. `enrollment_decided` may retain other unbatched planned rows as active drafts. `waiting` and `not_registered` atomically cancel every remaining unbatched planned row for that track with null claim/release metadata and the same reason/event before changing state. Runtime tests race row cancellation against batch start/completion, cover last-row cancellation into current-class waiting, and assert the global lock order and one consistent winner.
- `resolve_registration_migration_review`: require complete per-field subject attribution where applicable plus one valid target state for every review track, create activities only for chosen subjects, enforce state-specific waiting/enrollment requirements, clear each review flag, and preserve untouched parent legacy fields as read-only history. Every phone/visit consultation target calls `assert_registration_track_director_ready`; an inactive or stale-default owner cannot be imported as a live queue. A `level_test_scheduled` target is valid only when the attributed level-test group contains both a real appointment time and a nonblank place; incomplete legacy level-test data can resolve only to `inquiry` (or another independently valid state), creates no appointment/attempt, and remains common history until the operator books a fresh test through the normal appointment RPC. Enrollment targets reuse the exact backfill/runtime validators, never a looser review-only path: `enrollment_decided` may create one unbatched planned row only from an attributed placement group with a unique same-subject class plus valid optional textbook/schedule; `enrollment_processing` requires the exact legacy `5-1.` or `6.` evidence, unique selected row, case admission, per-row MakeEdu where evidenced, and valid draft/invoice/payment dependencies; `registered` requires the full locked legacy `7.` identity, class/subject, schedule, textbook, admission, MakeEdu, invoice/payment, and symmetric four-roster proof. If the target-specific proof fails, disable that target and route the operator to `enrollment_decided` (to repair through the normal row/batch flow) or another earlier valid state; never manufacture a paid/completed batch. Runtime fixtures cover each valid target and missing placement, zero/multiple rows, invalid session/textbook, missing application/MakeEdu/batch evidence, identity mismatch, and asymmetric registered roster.
- `reopen_registration_track`: require a non-empty reason and explicit destination `inquiry` or `consultation_waiting` from only not-registered/inquiry-only. Consultation waiting calls `assert_registration_track_director_ready` and creates exactly one active phone/waiting consultation row; otherwise return `registration_director_refresh_required`. Because standalone assignment is intentionally blocked on terminal history, management reopens such a stale case to inquiry first, lets the nonterminal default/manual assignment persist, then routes it to consultation. Registered add-class does not use this generic RPC and does not change director ownership: saving an unbatched planned row leaves the case closed, and `start_registration_admission_batch` atomically reopens only the admission state/parent and creates the new revision for those rows.

Functions that first materialize a student (`route_registration_inquiry` for current-class waiting, `complete_registration_consultation` for current-class waiting, `transition_registration_waiting`, and `start_registration_admission_batch`) share one exact identity rule: prefer the saved `ops_tasks.student_id`; otherwise acquire `pg_advisory_xact_lock(hashtextextended('registration-student:' || normalized_name || ':' || normalized_required_parent_phone, 0))` after track/activity locks and before lookup/create. Under that identity lock, re-query `students.name` plus every available student/parent phone identity and school. Create a student only when the second lookup finds no exact match, save the resulting ID back to the parent, and never expose the removed `기존 학생 연결` control again. More than one exact match raises `registration_student_identity_ambiguous`; a persisted ID whose locked row mismatches raises `registration_student_identity_mismatch`. Before creating any roster-active wait/batch claim, require the locked student not to be `퇴원`; otherwise raise `registration_student_reactivation_required`. Reactivation is a separate explicit management workflow, never an incidental race winner. The withdrawal RPC derives/acquires this same advisory identity from its preliminary locked-source student snapshot and revalidates it after the lock. The required parent phone makes concurrent same-case identity keys stable even when an optional student phone is absent. Two-session fixtures prove one identity materialization and prove withdrawal-versus-batch/wait races always yield one consistent winner.

The current read-only data snapshot contains one exact full-identity duplicate group with one active and one withdrawn student, although no current registration references it. Do not silently prefer the active row or merge records in this workflow. A future matching inquiry intentionally receives `registration_student_identity_ambiguous`; the UI links to 학생관리 with `중복 학생 정리 후 다시 시도하세요`, and a separately authorized management cleanup must establish one canonical record before retrying.

`assign_registration_track_director` also owns the cancellation-repair edge case. When a valid non-null assignment is saved on a locked `consultation_waiting` track with no active phone/visit consultation, create exactly one fresh `phone/waiting` row with the newly assigned director snapshot and enqueue that director's internal dashboard notification in the same transaction. The durable row uses `dashboard_notifications.type = 'registration_consultation'`, the subject-specific href `/admin/registration?taskId={taskId}&trackId={trackId}`, and exact unique dedupe key `registration:{taskId}:track:{trackId}:consultation:{consultationId}:director:{directorProfileId}`. Insert a new row when the key is absent. When an actual director handoff assigns a director who previously held and read that same consultation notification (`A -> B -> A` or `clear -> A`), the conflict handler reactivates that canonical row by refreshing its content/time and setting `read_at = null`; an unchanged-director retry does nothing and never reopens a read alert. This transaction commits only the internal queue signal. Google Chat/webhook or push delivery remains post-commit and may warn/retry without rolling back the authoritative assignment. If an active phone row already exists, update its director snapshot and `updated_at` only when the director ID actually changes, then enqueue/reactivate the new director with the same consultation-based key shape; the active-row unique index prevents duplicate activities and the profile-bearing dedupe key prevents duplicate notification rows for one ownership snapshot. Clearing ownership removes any unread stale director notification for that active consultation, deliberately preserves the consultation's historical director snapshot, and raises the management assignment-required state; completion remains denied until a new assignment refreshes that snapshot. Runtime tests cover visit cancellation with unavailable ownership -> no row -> later assignment -> one completable phone row and exactly one durable notification, unchanged-owner retry timestamp preservation, and `A -> B -> A` notification reactivation.

`finalize_registration_admission_message` owns every provider-result write; the send route never updates `ops_registration_messages` directly. It is callable only with `service_role`, has no actor/request advisory lock and no receipt, resolves the parent from the message ID without authority, then locks parent/detail -> exact message. Exact EXECUTE grants/revokes are the primary authorization boundary. The required `auth.role() = 'service_role'` body check is retained only as defense in depth inside this non-RLS function and must not be copied into table-policy authorization. Accept only `accepted|failed|unknown` plus an exact provider-result JSON whitelist (`providerMessageId`, `providerGroupId`, `providerStatusCode`, `providerStatusMessage`, `errorMessage`) and reject unknown keys. Pending or unknown may become accepted, definitively failed, or unknown; accepted sets/keeps `claim_active = true`, definitive provider failure sets it false, and unknown keeps it true. A manual failed-hold may still become accepted when authoritative provider evidence arrives before explicit release, preserving `claim_active = true`; accepted therefore wins that locked race. Accepted and inactive failed rows are terminal, and a released failed row never reactivates from a late callback. A same-state or disallowed late result returns the authoritative exact camelCase `{ taskId, messageId, applied: false, currentStatus, claimActive, messageRequestKey, requiresAdmissionMark, retryRequiresNewMessageKey }`. A real compare-and-set transition writes provider fields/status/claim state plus `updated_at = now()` once and returns the same shape with `applied: true`; it inserts no mutation receipt. `requiresAdmissionMark` is true exactly for authoritative accepted, and `retryRequiresNewMessageKey` is true exactly for inactive failed. Runtime/concurrency tests cover authenticated direct-call denial, service-role success, pending/unknown/failed-hold transitions, finalizer-versus-reconciliation races, accepted precedence over an unreleased failed-hold, timer reset, no released-row reversal, and no second send.

- [ ] **Step 6: Revoke broad function access and grant only authenticated execution**

For every exact signature created in Step 4–5, add both statements:

```sql
revoke execute on function public.complete_registration_consultation(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.complete_registration_consultation(uuid, text, text, uuid, text) to authenticated;
```

Repeat with the exact argument types for every authenticated public wrapper. For each matching private `*_impl` signature, revoke execution from `public` and `anon`, grant execution to `authenticated` only because the invoker wrapper must call it, and verify `dashboard_private` is absent from the project's exposed schemas. The one exception is `finalize_registration_admission_message(uuid,text,jsonb)` and its private implementation: revoke both from `public`, `anon`, **and** `authenticated`, grant both only to `service_role`, and grant `service_role` schema usage; browser code cannot invoke either layer. Direct Data API access to other private implementations remains impossible because the private schema is unexposed; a direct SQL caller still reaches only the same exact access-validating operation, never a generic write primitive. Revoke all table privileges on the private receipt table from browser roles.

For the eleven mutation-only helpers (`assert_registration_mutation_access`, `apply_student_class_roster_mode`, the three director validation/resolution helpers, the status-transition helper, and the five validation/wait/projection/event helpers), revoke execution from `public`, `anon`, and `authenticated`; only the fixed private-function owner may call them from inside an implementation. No director-specific RLS helper is created. Explicitly revoke the default PUBLIC execute privilege immediately after every helper is created.

- [ ] **Step 7: Prepare an exact 12-assertion pgTAP schema/security packet**

`supabase/tests/registration_subject_tracks_test.sql` is prepared now and executed only in the separately authorized database-runtime lane. Its exact assertions are:

```sql
begin;
select plan(12);

select has_table('public', 'ops_registration_subject_tracks');
select has_table('public', 'ops_registration_appointments');
select has_table('public', 'ops_registration_level_tests');
select has_table('public', 'ops_registration_consultations');
select has_table('public', 'ops_registration_admission_batches');
select has_table('public', 'ops_registration_enrollments');
select has_table('dashboard_private', 'ops_registration_mutations');
select has_function('public', 'complete_registration_consultation', array['uuid', 'text', 'text', 'uuid', 'text']);
select has_function('public', 'complete_registration_admission_batch', array['uuid', 'text']);
select function_privs_are(
  'public', 'complete_registration_consultation', array['uuid', 'text', 'text', 'uuid', 'text'],
  'authenticated', array['EXECUTE']
);
select is_empty($$select 1 from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'complete_registration_consultation' and grantee in ('PUBLIC', 'anon') and privilege_type = 'EXECUTE'$$);
select is_empty($$select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('ops_registration_subject_tracks', 'ops_registration_appointments', 'ops_registration_level_tests', 'ops_registration_consultations', 'ops_registration_admission_batches', 'ops_registration_enrollments') and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')$$);

select * from finish();
rollback;
```

- [ ] **Step 8: Prepare executable runtime and two-session verification fixtures**

Create `supabase/tests/registration_subject_tracks_runtime_test.sql` as a transactional pgTAP file with fixed UUID fixtures for auth users/profiles, students, English/math classes, textbooks, registration cases, and legacy review cases. It uses `set local role authenticated` plus request JWT claims for a management admin, assigned admin director, sibling admin director, staff, assistant, ordinary teacher, and a narrowly isolated service-role finalizer lane, and declares `select plan(150)`. Its assertions are fixed in this exact order:

1. atomic RPC creation with exactly two subject tracks.
2. empty-subject create denial.
3. direct registration parent insert denial.
4. general-task-to-registration reclassification denial.
5. legacy-registration-to-general reclassification denial.
6. direct registration detail insert denial.
7. child-backed parent update denial.
8. child-backed detail update denial.
9. direct child-backed parent delete denial.
10. direct child-backed detail delete denial.
11. reserved-event forgery denial.
12. invalid/null director-provenance combinations rejected.
13. assigned director profile deletion restricted.
14. ready-version registration coverage contains no childless parent.
15. ready-version global roster shape/symmetry assertion succeeds.
16. parent-visible admin director can read the case and children.
17. non-participant ordinary teacher receives no new case read.
18. assigned admin director own-consultation completion.
19. sibling admin director consultation-completion denial.
20. staff consultation-completion denial.
21. ordinary-teacher consultation-completion denial on an admin-owned track.
22. assistant consultation-completion denial.
23. admin management mutation success outside consultation completion.
24. staff management mutation success outside consultation completion.
25. valid default-director clear leaves all four provenance fields null.
26. manual-director clear denial.
27. wrong but active profile rejected as a default assignment.
28. stale common-revision default assignment denial.
29. stale-default direct-phone routing denial.
30. inactive-director direct-phone routing denial.
31. same actor/key replay returns the stored response.
32. changed-payload key reuse denial.
33. safe pre-roster identity edit clears only a stale student link.
34. stale common-revision save denial.
35. every active admission claim—including failed-hold—freezes identity, while inactive failed releases only that boundary.
36. post-history optional identity-field change denial.
37. identity change after current-class waiting denial.
38. identity change after completed registration denial.
39. common revision increments exactly once and remains stable on replay.
40. cross-actor admission-notice replay produces one flag and one event.
41. duplicate exact student identity raises the management-cleanup error.
42. SQL default-director resolver returns the exact current profile and rule key.
43. sync-to-empty/last-subject removal denial.
44. duplicate-containing dual-subject appointment input produces one child per distinct track.
45. empty appointment-track-set denial.
46. duplicate-active appointment denial.
47. stale appointment edit revision conflict.
48. stale appointment cancel revision conflict.
49. completed-English/absent-mathematics attempt-2 rescheduling.
50. independent consultation outcome.
51. stale-default level-test completion queue denial.
52. inactive-director visit save denial.
53. stale-default visit save denial.
54. visit cancellation with unavailable director succeeds without a phone row and returns assignment-required.
55. valid migration-review enrollment-processing import.
56. invalid migration-review enrollment-processing evidence denial.
57. valid migration-review registered import.
58. invalid migration-review registered evidence denial.
59. malformed scalar/object roster JSON rejection.
60. malformed roster UUID-string element rejection.
61. generic roster RPC admin/staff success with exact committed response.
62. generic roster RPC assistant denial.
63. generic roster expected-mode conflict.
64. nonempty student roster insert denial.
65. nonempty class roster insert denial.
66. direct authenticated roster-array update denial.
67. direct enrollment-history insert forgery denial.
68. direct enrollment-history update/delete denial.
69. authenticated history TRUNCATE privilege absence.
70. linked student delete denial when only the reverse class side references it.
71. unlinked but history-bearing student delete denial.
72. already-unlinked never-used student delete allowance.
73. one-sided enrolled projection rejected by the roster helper.
74. current-wait student enrolled-array absence.
75. current-wait student waitlist-array presence.
76. current-wait class enrolled-array absence.
77. current-wait class waitlist-array presence.
78. one waitlist history row.
79. batch enrollment symmetry across both enrolled arrays.
80. required-retest appointment cancels the current-class waitlisted row and removes both waitlist projections.
81. one enrolled/removed history row per real transition.
82. second-row batch rollback.
83. stale class-subject rollback at paid completion.
84. stale/unlinked textbook rollback at paid completion.
85. locked student-identity mismatch rollback at paid completion.
86. mixed add-class cancellation restore/routing plus unselected first-admission draft cancellation.
87. registered-track unbatched add-class draft preserves closed projection then cancels on last-row waiting route.
88. batch completion response returns the committed batch and enrollment rows.
89. paid completion commits every row and all four roster projections atomically.
90. progressed legacy done case recomputes to migration review then resolves.
91. missing level-test place review resolves to inquiry with zero child activity.
92. incomplete visit time/place review.
93. inconsistent legacy payment-without-invoice review.
94. registered legacy row with missing evidence review.
95. multi-subject legacy counselor remains unassigned.
96. asymmetric current-wait roster review.
97. asymmetric registered roster review.
98. legacy 6 row with zero valid enrollment goes to review.
99. legacy 6 row with invalid canonical session goes to review.
100. real machine-status transition stamps stage_entered_at once.
101. same-stage waiting-kind/director/common edit preserves stage_entered_at.
102. same-key replay preserves stage_entered_at.
103. parent director projection chooses the first active English track before mathematics and projects its assigned director.
104. parent director projection remains null when the first active English track is unassigned even if mathematics is directed.
105. fully terminal parent clears both legacy director projections.
106. stale-default phone/visit consultation completion denial after grade or Seoul-effective-year change.
107. last-row and admission-batch cancellation into current-class waiting each materialize one waitlisted row with symmetric four-projection state.
108. reconciliation JSON evidence and reason are both required and unknown keys are denied.
109. every pending-message browser reconciliation is denied in favor of server provider check.
110. unknown-to-accepted and accepted-unsynced-after-last-eligibility recovery each produce one admission flag/event mark with zero resend.
111. unknown-to-failed-hold keeps the claim active and identity/send blocked.
112. failed-hold-to-accepted succeeds before release when later provider evidence proves acceptance.
113. reconciliation same-key replay preserves one immutable audit event and timestamp.
114. assigning a valid director after unavailable-owner visit cancellation creates exactly one completable phone consultation.
115. failed-hold retry release before the 15-minute delay is denied.
116. failed-hold transition resets `updated_at`, so an old unknown timestamp cannot bypass the delay.
117. explicit delayed retry release sets only `claim_active = false`, preserves failed history, and requires a new message key.
118. authenticated admin/staff direct execution of the message finalizer is denied.
119. service-role finalizer performs pending-to-accepted, pending-to-unknown, and definitive pending-to-inactive-failed transitions with exact camelCase claim state.
120. finalizer accepted result wins against an unreleased failed-hold, while an already released failed row cannot reactivate.
121. a message request key reused by another task/template raises `registration_message_request_key_reused`.
122. the message claim-state CHECK rejects a non-failed row with `claim_active = false`.
123. direct authenticated provider-field/message status mutation and every newly reserved event forgery are denied.
124. scheduling one subject for a visit cancels only its active phone row; the sibling phone queue remains waiting.
125. deselecting one subject from an all-scheduled dual level test returns only that track to inquiry and leaves no appointment-less scheduled state.
126. phone/waiting requires `consultation_waiting`, visit/scheduled requires `visit_consultation_scheduled`, null outcome is denied, and non-waiting outcomes reject waiting fields.
127. `route_registration_inquiry` invoked from any later stage is denied with no child/event change.
128. automatic-default-only dual inquiry permits removal of one untouched subject and records the parent removal audit.
129. manual director assignment or operational activity blocks subject removal.
130. two registration cases cannot hold the same roster-active student/class claim.
131. a generic roster command is denied while an open-batch/wait/enrolled claim owns that same pair.
132. forged invoice/payment timestamps cannot complete a non-paid batch.
133. batch advance enforces exact draft-to-invoiced-to-paid order; cross-actor replay cannot restamp timestamps/events.
134. every backfilled waitlisted/batched/enrolled row is roster-active with frozen student, while an unbatched planned draft is inactive with null student.
135. canceled batch rows release claims but retain frozen student and canceled-batch membership.
136. a released enrolled history row permits a later planned row for the same track/class and renders no live cancellation claim.
137. direct authenticated student-status transitions in either direction are denied while roster/withdrawal/transfer RPC transitions succeed.
138. direct terminal withdrawal/transfer task or completion-flag insert/update is denied.
139. withdrawal/transfer type reclassification, general-task/detail mismatch, and two-step completion bypass are denied.
140. claimed whole-student withdrawal removes every enrolled and current-class waitlist pair, releases/cancels claims, closes wait tracks, then sets `퇴원` atomically.
141. unclaimed legacy/management whole-student withdrawal completes through the same atomic roster/status/task path.
142. claimed transfer releases only the source registration claim, moves the roster to the destination, and preserves paid admission history.
143. unclaimed legacy/management transfer moves the roster and task state atomically.
144. injected withdrawal failure rolls back all classes, waitlists, claims, student status, task/checklist, history, and receipts.
145. injected transfer failure rolls back both classes, any claim, student status, task/checklist, history, and receipts.
146. withdrawal rejects an open admission-batch claim and a withdrawn student cannot materialize a wait/batch claim without explicit reactivation.
147. withdrawn-state readiness invariant requires zero live student/class projections and zero roster-active claims.
148. registration cancellation counts only roster-active enrolled rows; released history is read-only and does not block re-enrollment.
149. canceled selected rows remain linked to their canceled admission batch and preserve audit reconstruction.
150. message-table column grants expose only workflow-safe state columns to authenticated readers, not recipient/provider/error payload.

Every fixture rolls back at file end.

Create `scripts/verify-registration-subject-track-concurrency.mjs` using two independently authenticated admin user clients plus a service-role client, behind an explicit `--run --url --anon-key --service-role-key --admin-token --second-admin-token` gate. The tokens must belong to distinct admin actors; seed `--admin-token` as the current assigned director and `--second-admin-token` as the sibling director/management reassigner. Without `--run` it prints the planned cases and exits before constructing a client or making any network call; a unit/source assertion fixes that behavior and all six run arguments. Production URL/hostname detection aborts before reading or using the service key. On an authorized local/preview database, the service client seeds/cleans namespaced fixtures and, in one separately labeled lane, invokes only the server-only message finalizer; it never substitutes for either human actor on authenticated management operations.

The two admin clients materialize the same normalized student identity concurrently and must select/create one student. They open the same appointment revision and race two authoritative edits, proving exactly one revision winner. Separate lanes prove one active attempt and one winner for batch-start versus row-cancel. Race the generic roster RPC against batch start on the **same** student/class pair and require exactly one owner; also race generic roster on another class against batch completion to prove unrelated relationships survive without whole-array loss. Race two registration cases for the same student/class claim and require one rollback-safe winner. Race invoice/payment repeats across actors and preserve first audit timestamps.

For messages, race claim against common identity edit, race two actors/message keys for one `shouldSend: true`, and race the service-role finalizer accepted result against admin failed-hold reconciliation; accepted must prevail while unreleased, and no path sends twice. For consultation ownership, commit reassignment before releasing the prior director's paused completion and require the old director to fail the post-lock snapshot check. For cross-workflow lifecycle, pause batch start before its first claim and current-class waiting before materialization, then race each against whole-student withdrawal in both lock orders. A batch/wait-first winner makes withdrawal retry/reject; a withdrawal-first winner makes the later claim fail `registration_student_reactivation_required`. Final assertions require no `퇴원` student with any live roster/claim and no partial task/checklist/history state. Cleanup deletes only namespaced fixture rows in reverse foreign-key order.

The deterministic race harness uses a private, default-empty checkpoint table with exactly four operation kinds: `admission_batch_before_first_claim`, `current_class_wait_before_materialization`, `withdrawal_after_parent_snapshot`, and `withdrawal_before_status_flip`. The early withdrawal checkpoint proves the contender captured the pre-claim parent set before a lifecycle-first holder is released; the late withdrawal checkpoint proves a withdrawal-first holder owns its student/class lock tier before the lifecycle request starts. Its public control surface is limited to fixed-purpose arm/wait/release/disarm RPCs granted only to `service_role`; authenticated admins still perform every lifecycle and withdrawal mutation. Arming requires the exact linked task/student pair from one `[codex-registration-race-*]` fixture namespace. The internal helper takes a namespaced advisory transaction lock at the exact mutation boundary and polls only that checkpoint's release flag. An armed checkpoint expires after 12 seconds and aborts the paused business transaction on timeout or premature disarm; an absent or already released row has no effect. The verifier observes the holder's exact checkpoint before launching the competing authenticated request; in lifecycle-first cases it also observes and releases the competing withdrawal's fixed parent-snapshot checkpoint before releasing the holder. Every checkpoint releases in `finally`, both operations settle, and every row is disarmed before reverse-order fixture cleanup. The service credential remains unread until the local/preview production guard passes, and the mechanism accepts no SQL, relation, predicate, or arbitrary debug input.

Source-contract assertions and service mocks cover names, privileges, call shapes, and static guard presence only. The two executable fixtures above are the promised runtime proof packet; their execution remains pending until a separately authorized preview/local database exists. Production is never used as that substitute.

- [ ] **Step 9: Validate the mutation SQL contract without applying it**

Run:

```bash
node --test \
  tests/registration-track-schema.test.mjs \
  tests/registration-runtime-probe.test.mjs \
  tests/registration-service-hardening.test.mjs \
  tests/management-class-student-roster.test.mjs
node scripts/verify-registration-subject-track-concurrency.mjs
git diff --check -- supabase/migrations supabase/tests scripts/verify-registration-subject-track-concurrency.mjs src/features/tasks/registration-runtime-probe.ts src/features/tasks/ops-task-service.ts src/features/management/management-service.js tests/registration-track-schema.test.mjs tests/registration-runtime-probe.test.mjs tests/registration-service-hardening.test.mjs tests/management-class-student-roster.test.mjs
```

Expected: source-contract tests pass, the concurrency script reports dry-run scenarios without network calls, and diff check emits no output. Keep both pgTAP files plus the gated concurrency script ready for the separately authorized database-runtime verification lane; do not run `db push`, `migration up --linked`, or any remote command.

### Task 4: Typed track service, narrow summaries, lazy detail, and RPC wrappers

**Files:**
- Create: `src/features/tasks/registration-track-service.ts`
- Create: `tests/registration-track-service.test.mjs`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `tests/ops-task-service-loading.test.mjs`

**Interfaces:**
- Consumes model types and status helpers from Task 1.
- Produces `OpsRegistrationTrackSummary`, `OpsRegistrationCaseDetail`, `OpsRegistrationAppointment`, `OpsRegistrationLevelTest`, `OpsRegistrationConsultation`, `OpsRegistrationAdmissionBatch`, and `OpsRegistrationEnrollment`.
- Produces `createRegistrationTrackService(client, options)` for tests and default exported wrappers for the application.
- Produces typed browser wrappers for Task 3's authenticated registration RPCs: case creation/common-info update/subject routing, director assignment, appointment save/cancel, level-test start/finish, consultation completion, waiting/enrollment-decision routing, enrollment draft/MakeEdu/cancel, message claim/reconcile/retry-release/admission mark, batch advance/cancel/complete, migration review, and track reopening. It explicitly does **not** export the service-role finalizer or the ops-task withdrawal/transfer completion RPCs. The finalizer helper exists only inside the server API route; withdrawal/transfer wrappers remain in their ops-task service boundary.
- Produces `loadOpsRegistrationWorkspaceOptionData({ viewerId, force })`, a registration-only summary loader that never reads the students table and never hydrates class schedules or rosters.
- Its result includes `directorCatalogStatus: "authoritative" | "partial" | "error"`; component-local pre-resolution state is `loading`.
- Consumes and re-exports the single session-cached `probeRegistrationSubjectTrackRuntime()` from `registration-runtime-probe.ts`, returning `{ mode: "legacy" | "maintenance" | "ready", version: 0 | 1 }`; only ready/version 1 enables child-backed list/detail/mutation UI.

- [ ] **Step 1: Write failing service tests for projection, fallback, caching, and RPC names**

```js
import test from "node:test"
import assert from "node:assert/strict"
import ts from "typescript"
import vm from "node:vm"
import { readFile } from "node:fs/promises"

const source = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")

function sourceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker)
  const end = text.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing ${startMarker}`)
  assert.notEqual(end, -1, `missing ${endMarker}`)
  return text.slice(start + startMarker.length, end)
}

function loadFactory(mocks) {
  const factorySource = sourceBetween(
    source,
    "// registration-track-service-factory:start",
    "// registration-track-service-factory:end",
  )
  const compiled = ts.transpileModule(`${factorySource}\nmodule.exports = { createRegistrationTrackService }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, ...mocks })
  return module.exports.createRegistrationTrackService
}

test("track summary loader requests only list-safe columns", async () => {
  const selects = []
  const client = createSupabaseReadMock({ selects, rows: [{ id: "track-1", task_id: "task-1", subject: "영어", pipeline_status: "consultation_waiting" }] })
  const service = loadFactory({})(client, { now: () => 1, probeRuntime: async () => ({ mode: "ready", version: 1 }) })
  const result = await service.loadTrackSummaries(["task-1"], "viewer-1")
  assert.equal(result.tracks[0].subject, "영어")
  assert.ok(selects.every((value) => !/schedule_plan|textbook|student_ids|waitlist_ids/.test(value)))
})

test("missing child tables return a legacy adapter signal rather than blank data", async () => {
  const client = createSupabaseErrorMock({ code: "42P01", message: "relation does not exist" })
  const service = loadFactory({})(client, { probeRuntime: async () => ({ mode: "legacy", version: 0 }) })
  assert.deepEqual(await service.loadTrackSummaries(["task-1"], "viewer-1"), { mode: "legacy", tracks: [] })
})

test("service delegates runtime state to the injected shared probe", async () => {
  for (const state of [
    { mode: "legacy", version: 0 },
    { mode: "maintenance", version: 0 },
    { mode: "ready", version: 1 },
  ]) {
    let calls = 0
    const service = loadFactory({})(createSupabaseReadMock({ rows: [] }), {
      probeRuntime: async () => { calls += 1; return state },
    })
    assert.deepEqual(await service.probeRuntime(), state)
    assert.equal(calls, 1)
  }
})

test("same viewer and task share one in-flight detail read", async () => {
  const gate = deferred()
  const client = createSupabaseDetailMock(gate.promise)
  const service = loadFactory({})(client, { probeRuntime: async () => ({ mode: "ready", version: 1 }) })
  const left = service.loadCaseDetail("task-1", "viewer-1")
  const right = service.loadCaseDetail("task-1", "viewer-1")
  gate.resolve(createCaseDetailRows())
  assert.equal(await left, await right)
  assert.equal(client.queryCount(), 9)
})

test("mutation wrappers call the exact authenticated RPC names", async () => {
  const calls = []
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: { ok: true }, error: null } } }
  const service = loadFactory({})(client, { probeRuntime: async () => ({ mode: "ready", version: 1 }) })
  await service.updateRegistrationCaseCommon({ taskId: "task-1", studentName: "김다미", schoolGrade: "고1", schoolName: "중앙여고", parentPhone: "01012345678", studentPhone: "", campus: "본관", inquiryAt: "2026-07-12T10:00:00+09:00", requestNote: "", priority: "normal", expectedCommonRevision: 3, requestKey: "request-common" })
  await service.completeRegistrationConsultation({ consultationId: "c-1", outcome: "enrollment", waitingKind: "", classId: "", requestKey: "request-consult" })
  await service.completeRegistrationAdmissionBatch({ batchId: "batch-1", requestKey: "request-batch" })
  assert.deepEqual(calls.map(([name]) => name), [
    "update_registration_case_common",
    "complete_registration_consultation",
    "complete_registration_admission_batch",
  ])
  assert.deepEqual(calls.map(([, args]) => args.p_request_key), ["request-common", "request-consult", "request-batch"])
  assert.equal(calls[0][1].p_expected_common_revision, 3)
})
```

Keep the marked factory block runtime-import-free: all imports used by that block are `import type`, constants/helpers it executes live inside the markers, and application singleton/default-wrapper dependencies are passed through `client`/`options`. In particular, `options.probeRuntime` is required by the pure factory; the default application wrapper passes the shared imported `probeRegistrationSubjectTrackRuntime`, while tests inject deterministic states. The factory may expose a delegating `probeRuntime` method but never reimplements detection. Default app wrappers and runtime imports stay outside the block. The test deliberately transpiles only this extraction, never the entire service module, so CommonJS `require(...)` from normal application imports cannot fail the VM before behavior assertions run.

Define the small `deferred`, `createSupabaseReadMock`, `createSupabaseErrorMock`, `createSupabaseDetailMock`, and `createCaseDetailRows` helpers in the test file; each mock must implement only the fluent methods used by the service and must assert table names and filters.

- [ ] **Step 2: Run the service test and confirm the missing-file failure**

Run: `node --test tests/registration-track-service.test.mjs`

Expected: FAIL because `registration-track-service.ts` does not exist.

- [ ] **Step 3: Define exact public types and row mappers**

```ts
export type OpsRegistrationTrackStatus =
  | "inquiry" | "migration_review" | "level_test_scheduled" | "level_test_in_progress"
  | "consultation_waiting" | "visit_consultation_scheduled" | "waiting"
  | "enrollment_decided" | "enrollment_processing" | "registered"
  | "not_registered" | "inquiry_closed"

export type OpsRegistrationTrackSummary = {
  id: string
  taskId: string
  subject: "영어" | "수학"
  status: OpsRegistrationTrackStatus
  legacy: boolean
  directorProfileId: string | null
  directorName: string
  directorAssignmentSource: "" | "default" | "manual" | "migration"
  directorAssignmentRuleKey: string
  waitingKind: "" | "current_class" | "current_term_opening" | "next_term_opening"
  levelTestRetakeDecision: "" | "required" | "not_required"
  migrationReviewRequired: boolean
  stageEnteredAt: string
}

export type OpsRegistrationEnrollment = {
  id: string
  trackId: string
  studentId: string | null
  admissionBatchId: string | null
  classId: string
  textbookId: string | null
  classStartDate: string | null
  classStartSessionKey: string | null
  classStartSession: string | null
  status: "planned" | "waitlisted" | "enrolled" | "canceled"
  makeeduRegistered: boolean
  rosterActive: boolean
  rosterReleasedAt: string | null
  rosterReleaseReason: string | null
  rosterReleaseSourceTaskId: string | null
  rosterReleaseKind: "withdrawal" | "transfer" | null
  sortOrder: number
}

export type OpsRegistrationAppointment = {
  id: string
  taskId: string
  kind: "level_test" | "visit_consultation"
  scheduledAt: string
  place: string
  status: "scheduled" | "completed" | "canceled"
  notificationRevision: number
  createdAt: string
  updatedAt: string
}

export type OpsRegistrationLevelTest = {
  id: string
  trackId: string
  appointmentId: string
  attemptNumber: number
  status: "scheduled" | "in_progress" | "completed" | "absent" | "canceled"
  startedAt: string | null
  completedAt: string | null
  materialLink: string | null
}

export type OpsRegistrationConsultation = {
  id: string
  trackId: string
  appointmentId: string | null
  mode: "phone" | "visit"
  status: "waiting" | "scheduled" | "completed" | "canceled"
  directorProfileId: string
  completedAt: string | null
  outcome: "enrollment" | "waiting" | "not_registered" | null
  createdAt: string
  updatedAt: string
}

export type OpsRegistrationAdmissionBatch = {
  id: string
  taskId: string
  revisionNumber: number
  status: "draft" | "invoiced" | "paid" | "completed" | "canceled"
  invoiceSentAt: string | null
  paymentConfirmedAt: string | null
  createdAt: string
  updatedAt: string
}

export type OpsRegistrationTrackEvent = {
  id: string
  taskId: string
  trackId: string | null
  eventType: string
  subject: "영어" | "수학" | null
  source: string | null
  destination: string | null
  reason: string | null
  metadata: Record<string, unknown>
  actorId: string | null
  occurredAt: string
  legacyText: string | null
}

export type OpsRegistrationCaseDetail = {
  task: OpsTask
  commonRevision: number
  admissionApplicationMessageId: string | null
  admissionApplicationMessageStatus: "" | "pending" | "accepted" | "unknown" | "failed_hold"
  admissionApplicationMessageClaimActive: boolean
  admissionApplicationMessageUpdatedAt: string | null
  admissionApplicationAccepted: boolean
  comments: OpsTaskComment[]
  attachments: OpsTaskAttachment[]
  tracks: OpsRegistrationTrackSummary[]
  appointments: OpsRegistrationAppointment[]
  levelTests: OpsRegistrationLevelTest[]
  consultations: OpsRegistrationConsultation[]
  admissionBatches: OpsRegistrationAdmissionBatch[]
  enrollments: OpsRegistrationEnrollment[]
  events: OpsRegistrationTrackEvent[]
  migrationLegacy: null | Record<string, unknown>
}

export type RegistrationCommonUpdateResponse = {
  taskId: string
  commonRevision: number
}

export type RegistrationAdmissionMessageClaimResponse =
  | {
      taskId: string
      messageId: string
      messageRequestKey: string
      claimStatus: "pending"
      claimActive: true
      shouldSend: true
      retryRequiresNewMessageKey: false
      studentName: string
      parentPhone: string
      commonRevision: number
    }
  | {
      taskId: string
      messageId: string
      messageRequestKey: string
      claimStatus: "pending" | "accepted" | "unknown" | "failed"
      claimActive: boolean
      shouldSend: false
      retryRequiresNewMessageKey: boolean
    }

export type RegistrationAdmissionProviderEvidence = {
  providerMessageId?: string
  providerGroupId?: string
  lookupRequestKey?: string
  observedState: "accepted" | "failed" | "not_found" | "closed"
  observedStatusCode?: string
  observedStatusMessage?: string
}

export type RegistrationAdmissionMessageReconciliationResponse = {
  taskId: string
  messageId: string
  messageRequestKey: string
  previousStatus: "unknown" | "failed"
  previousClaimActive: true
  nextStatus: "accepted" | "failed"
  claimActive: true
  requiresAdmissionMark: boolean
  requiresRetryRelease: boolean
}

export type RegistrationAdmissionMessageReleaseResponse = {
  taskId: string
  messageId: string
  messageRequestKey: string
  status: "failed"
  claimActive: false
  retryRequiresNewMessageKey: true
}

export type RegistrationAppointmentMutationResponse = {
  appointmentId: string
  notificationRevision: number
  notificationTargets: Array<{ appointmentId: string; notificationRevision: number }>
  requiresDirectorAssignmentTrackIds: string[]
}

export type RegistrationEnrollmentRowsSaveResponse = {
  trackId: string
  rows: OpsRegistrationEnrollment[]
}

export type RegistrationConsultationCompletionResponse = {
  consultation: OpsRegistrationConsultation
  track: OpsRegistrationTrackSummary
}

export type RegistrationAdmissionBatchCompletionResponse = {
  batch: OpsRegistrationAdmissionBatch
  enrollments: OpsRegistrationEnrollment[]
}

export type StudentClassRosterModeResponse = {
  studentId: string
  classId: string
  previousMode: "enrolled" | "waitlist" | "removed"
  nextMode: "enrolled" | "waitlist" | "removed"
  changed: boolean
  studentClassIds: string[]
  studentWaitlistClassIds: string[]
  classStudentIds: string[]
  classWaitlistIds: string[]
}
```

Map snake_case rows at the service boundary. UI components must never read raw database column names.
All optional database UUIDs are typed `string | null` in detail/service contracts. Form-only empty strings are normalized to `null` before `client.rpc`; tests cover new appointment, optional class/textbook, and phone consultation payloads so PostgREST never receives `""` for a UUID.
Every wrapper has an explicit `Promise<ResponseAlias>` return and calls `callRpc<ResponseAlias>(...)`; do not rely on inferred `unknown` from JSONB. At minimum, common update, one-shot admission-message claim, appointment save/cancel, consultation completion, enrollment-row save, batch completion, and shared roster mode use the aliases above. Claim tests narrow on `shouldSend`, require identity only on the true winner branch, and prove failed/live false branches never expose send authority. Mock tests assert camelCase mapping and required arrays, including committed enrollment rows returned by `completeRegistrationAdmissionBatch`.

Do not declare or export the finalizer response in `registration-track-service.ts`. Task 9 declares `RegistrationAdmissionMessageFinalizationResponse` locally inside the server route with the exact `{ taskId, messageId, messageRequestKey, applied, currentStatus, claimActive, requiresAdmissionMark, retryRequiresNewMessageKey }` shape.

- [ ] **Step 4: Implement the narrow list loader and selected-case detail loader**

Use these exact projections:

```ts
const TRACK_SUMMARY_COLUMNS = [
  "id", "task_id", "subject", "pipeline_status", "director_profile_id", "director_assignment_source", "director_assignment_rule_key",
  "waiting_kind", "level_test_retake_decision", "migration_review_required", "stage_entered_at", "updated_at",
].join(",")

const TASK_SCOPED_CASE_READS = [
  ["ops_registration_subject_tracks", "*,director:profiles!ops_registration_subject_tracks_director_profile_id_fkey(id,name)"],
  ["ops_registration_appointments", "*"],
  ["ops_registration_admission_batches", "*"],
] as const

const TRACK_SCOPED_CASE_READS = [
  ["ops_registration_level_tests", "*"],
  ["ops_registration_consultations", "*"],
  ["ops_registration_enrollments", "*"],
] as const
```

Before its first child-backed read, the service calls the shared probe module, which session-caches `registration_subject_tracks_runtime_version`; exact version `1` returns `ready`. The shared module alone classifies missing readiness function as `PGRST202`, SQL `42883`, or the narrowly matched PostgREST missing-function/schema-cache message, then performs one minimal `ops_registration_subject_tracks.select("id", { head: true, count: "exact" }).limit(0)` existence probe. That child probe classifies only `PGRST205` or SQL `42P01` as table-absent -> `legacy`; an existing table -> `maintenance`; every other error throws. `legacy` uses the pre-migration adapter. `maintenance` renders an explicit migration-in-progress banner and blocks registration create, common edit, subject sync, row actions, every registration mutation, and the app-wide roster controls until the second migration finishes; it never retries legacy creation or roster writes against partial guards. Once the probe has returned `ready`, a later missing child relation/readiness function is deployment corruption: invalidate the cache, throw an explicit migration-integrity error, and never fall back to legacy writes in that request. `ready` reads only `TRACK_SUMMARY_COLUMNS` scoped by `task_id`, deduplicates non-null `director_profile_id` values, and, only when needed, performs one narrow `profiles.select("id,name").in("id", directorIds)` follow-up to map `directorName`; it never waits for the full workspace option loader. It does not read consultations or appointments; phone versus visit is derived from the machine status, and opening/completing a row lazily loads the selected case. Tests assert cached explicit modes from the shared module, create/edit/action absence in maintenance, ready-then-missing corruption propagation, one deduped profile follow-up, no profile read when all director IDs are null, and no email/role/options payload on the list path.

The detail loader is deliberately two-phase. Phase 1 runs one exact-ID parent/detail/comments/attachments read, the three `task_id` business reads, one narrow-column `ops_task_events` read filtered only by the exact task ID, and one narrow `ops_registration_messages` read in parallel. Do not apply an event-type allowlist: canonical version-1 events are parsed structurally, while existing `created`, `updated`, `status_changed`, `manual_checked`, `auto_checked`, `rollback`, and any future unknown task event remain visible as plain legacy history. The track read embeds only the director profile's `id,name` through the explicit FK and maps it to `directorName`, so a cold deep link does not depend on list cache or add a tenth query. The message query selects only `id,status,claim_active,template_key,request_key,updated_at`, filters the exact task plus admission-application template and `claim_active = true`, and uses `limit(1)` under the partial unique invariant; it never hydrates recipient/body/provider payload. Map active failed to canonical UI status `failed_hold`; map ID/status/claim/update time to the detail fields, derive accepted only from accepted, and freeze identity for every active claim without changing the nine-query count. Released failed rows remain in chronological events/history but are not the current blocking message. Phase 1 maps the full selected row into `detail.task/comments/attachments`, extracts track IDs, then Phase 2 runs the three `track_id IN (...)` reads in parallel. It never issues an unscoped level-test, consultation, enrollment, message, or event query. Map version-1 JSON events at the service boundary and derive `migrationLegacy` from the one selected parent detail only when review is required. A normal or review detail load makes nine scoped queries. Cache by `viewerId:taskId`. Store both resolved values and in-flight promises; delete rejected promises and ignore stale completions after invalidation. Loading/source tests assert the event query has `.eq("task_id", taskId)` and no event allowlist, the message query has `.eq("claim_active", true)` rather than a status allowlist, and a cold deep link returns the embedded director name in exactly nine queries.

Instrument the actual loaders with named marks/measures: `registration:parent-list`, `registration:option-summary`, `registration:track-summary`, `registration:case-detail`, and `registration:class-detail:{classId}`. Each measure brackets the awaited network work, records a cache-hit boolean and query count in the verification logger, and is cleared between the five browser runs. Track-summary query count is one without assigned directors and two with at least one assigned director. Loading tests inject a fake performance sink and assert start/end pairing on success and failure.

- [ ] **Step 5: Implement typed RPC wrappers with caller-owned stable request keys**

```ts
export function createRegistrationMutationRequestKey(kind: string, entityId = "") {
  return `${kind}:${entityId || "new"}:${crypto.randomUUID()}`
}

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return data as T
}

export async function claimRegistrationAdmissionMessage(input: {
  taskId: string
  messageRequestKey: string
}): Promise<RegistrationAdmissionMessageClaimResponse> {
  return callRpc<RegistrationAdmissionMessageClaimResponse>("claim_registration_admission_message", {
    p_task_id: input.taskId,
    p_message_request_key: input.messageRequestKey,
  })
}

export async function reconcileRegistrationAdmissionMessage(input: {
  messageId: string
  resolution: "accepted" | "failed"
  providerEvidence: RegistrationAdmissionProviderEvidence
  reason: string
  requestKey: string
}): Promise<RegistrationAdmissionMessageReconciliationResponse> {
  return callRpc<RegistrationAdmissionMessageReconciliationResponse>("reconcile_registration_admission_message", {
    p_message_id: input.messageId,
    p_resolution: input.resolution,
    p_provider_evidence: input.providerEvidence,
    p_reason: input.reason,
    p_request_key: input.requestKey,
  })
}

export async function releaseRegistrationAdmissionMessageRetry(input: {
  messageId: string
  providerEvidence: RegistrationAdmissionProviderEvidence
  reason: string
  requestKey: string
}): Promise<RegistrationAdmissionMessageReleaseResponse> {
  return callRpc<RegistrationAdmissionMessageReleaseResponse>("release_registration_admission_message_retry", {
    p_message_id: input.messageId,
    p_provider_evidence: input.providerEvidence,
    p_reason: input.reason,
    p_request_key: input.requestKey,
  })
}

export async function completeRegistrationConsultation(input: {
  consultationId: string
  outcome: "enrollment" | "waiting" | "not_registered"
  waitingKind: "" | "current_class" | "current_term_opening" | "next_term_opening"
  classId: string
  requestKey: string
}): Promise<RegistrationConsultationCompletionResponse> {
  return callRpc<RegistrationConsultationCompletionResponse>("complete_registration_consultation", {
    p_consultation_id: input.consultationId,
    p_outcome: input.outcome,
    p_waiting_kind: input.waitingKind || null,
    p_class_id: input.classId || null,
    p_request_key: input.requestKey,
  })
}
```

Implement every factory method and default exported wrapper with the same full `verbRegistrationNoun` name used by downstream tasks—such as `updateRegistrationCaseCommon`, `completeRegistrationConsultation`, and `completeRegistrationAdmissionBatch`—with no undocumented short aliases. Use the exact RPC name and typed parameters from Task 3. Every receipt-backed wrapper requires a non-empty `input.requestKey`; the service never silently generates a fresh key during a retry. Each receipt-backed UI submit flow creates one key when a logical submission starts and stores it in a ref keyed by operation plus normalized draft revision. Duplicate clicks and network/unknown outcomes reuse that same key. After an unknown outcome, disable material editing and new submission keys until a same-key retry returns the stored response or an authoritative reload proves the committed IDs/state and merges them into the draft; this is mandatory for case creation and newly inserted enrollment rows because a new key could duplicate server-generated rows. Clear the old key and allow a new draft revision only after confirmed success or confirmed non-commit/failure—not merely a timeout. Tests distinguish confirmed validation failure (edit -> new key) from unknown response loss (edit disabled, same-key recovery, authoritative ID merge). The no-receipt claim instead requires one non-empty provider/message `messageRequestKey`; repeated calls with that key are safe only because the database returns `shouldSend: false` after the winning insert. Separate claim tests assert one message key and one true winner.

- [ ] **Step 6: Integrate summaries and detail delegation into `ops-task-service.ts`**

- Extend registration-only task mapping with `registrationTracks: OpsRegistrationTrackSummary[]` while leaving withdrawal, transfer, and word-retest shapes unchanged.
- Replace the current registration list's embedded wildcard query. The parent list selects only `id,title,type,status,priority,requested_by,assignee_id,secondary_assignee_id,student_id,student_name,campus,subject,created_at,updated_at` plus narrow `ops_registration_details(task_id,pipeline_status,school_grade,school_name,inquiry_at)`. It must not embed `ops_task_comments(*)`, `ops_task_attachments(*)`, `ops_task_events(*)`, or `ops_registration_details(*)`. Query narrow track summaries after that parent list; load the full selected parent/detail/comments/attachments only in `loadRegistrationCaseDetail(taskId, viewerId)`.
- Split the current five-read `readOpsTaskWorkspaceOptionData` path. Non-registration task types keep the generic loader. Registration calls `loadOpsRegistrationWorkspaceOptionData`, which issues exactly four reads in one `Promise.all`: minimal profiles (`id,name,email,role,login_id`), registration class summaries (`id,name,subject,grade,teacher,room,textbook_ids,status` with the existing missing-column fallback), textbook summaries (`id,title,name,publisher,subject,status` with fallback), and visible teacher catalogs (`id,name,subjects,is_visible,sort_order,profile_id,account_email`). It returns `students: []`, never queries `students`, excludes clearly inactive class/textbook rows when the status column exists, and excludes `schedule_plan`, fees, `student_ids`, and `waitlist_ids`. `directorCatalogStatus` is `authoritative` only when the profiles and teacher-catalog reads both succeed with `profile_id`, `is_visible`, role, and identity columns present; any missing-column fallback (especially a teacher row without `profile_id`) is `partial`, and a failed read is `error`. Neither partial nor error data may clear a durable default. Class schedules and linked-book validation remain exact-ID reads through `loadOpsRegistrationClassDetail` only.
- When schema is not ready, construct one legacy summary per parsed subject using the existing pipeline adapter and mark it `legacy: true`; every real child-track summary explicitly carries `legacy: false`, so consumers never infer mode from an ID shape.
- Make `loadOpsRegistrationCaseDetail(taskId, viewerId)` delegate to `loadRegistrationCaseDetail(taskId, viewerId)` and require the authenticated viewer ID from the workspace caller; both cache keys include that viewer ID, so a later session cannot reuse another viewer's authorized detail result.
- Keep `loadOpsRegistrationClassDetail(classId)` unchanged and exact-ID-only; the enrollment editor will call it per selected row.
- Clear track summary/detail caches from `clearOpsTaskWorkspaceDataCache()` and after every successful registration RPC.
- Extend `ops-task-service-loading.test.mjs` to capture the parent-list select string and fail if it contains any of `ops_registration_details(*)`, `ops_task_comments(*)`, `ops_task_attachments(*)`, or `ops_task_events(*)`; also assert those relations appear only in the exact-ID detail path. Add a registration-option harness that asserts the called tables are exactly profiles/classes/textbooks/teacher_catalogs, `students` is absent, maximum concurrent reads is four, and no select contains `schedule_plan`, `student_ids`, or `waitlist_ids`.

- [ ] **Step 7: Run focused service and loading tests**

Run:

```bash
node --test tests/registration-track-service.test.mjs tests/ops-task-service-loading.test.mjs tests/registration-service-hardening.test.mjs
pnpm exec tsc --noEmit
```

Expected: every focused test passes; TypeScript exits 0; registration list projections contain no schedule/textbook/roster payload.

### Task 5: Track-flattened registration tabs, desktop/mobile rows, and deep links

**Files:**
- Create: `src/features/tasks/registration-track-list.tsx`
- Create: `tests/registration-track-workspace.test.mjs`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Consumes `OpsTask.registrationTracks` from Task 4 and the view/count/summary-action permission helpers from Task 1.
- Produces `RegistrationTrackListItem`, `buildRegistrationTrackListItems(tasks)`, `filterRegistrationTrackListItems(items, viewKey)`, and `RegistrationTrackList`.
- Emits `onOpen(taskId, trackId)`, `onAction(taskId, trackId, action)`, and `onEdit(taskId, trackId)`.

- [ ] **Step 1: Write failing pure list-adapter and source-contract tests**

```js
test("one parent case becomes one work item per subject track", () => {
  const items = buildRegistrationTrackListItems([{
    id: "case-1",
    title: "등록: 김다미",
    studentName: "김다미",
    registrationTracks: [
      { id: "eng", subject: "영어", status: "consultation_waiting", stageEnteredAt: "2026-07-10T00:00:00Z" },
      { id: "math", subject: "수학", status: "level_test_scheduled", stageEnteredAt: "2026-07-11T00:00:00Z" },
    ],
  }])
  assert.deepEqual(items.map((item) => [item.key, item.subject, item.viewKey]), [
    ["case-1:eng", "영어", "consulting"],
    ["case-1:math", "수학", "level_test"],
  ])
})

function fixtureItems() {
  return buildRegistrationTrackListItems([{
    id: "case-1",
    title: "등록: 김다미",
    studentName: "김다미",
    registrationTracks: [
      { id: "eng", subject: "영어", status: "consultation_waiting", stageEnteredAt: "2026-07-10T00:00:00Z" },
      { id: "math", subject: "수학", status: "level_test_scheduled", stageEnteredAt: "2026-07-11T00:00:00Z" },
    ],
  }])
}

test("same parent tracks can appear in different tabs", () => {
  const items = fixtureItems()
  assert.deepEqual(filterRegistrationTrackListItems(items, "consulting").map((item) => item.trackId), ["eng"])
  assert.deepEqual(filterRegistrationTrackListItems(items, "level_test").map((item) => item.trackId), ["math"])
})

test("workspace keeps trackId in registration deep links", async () => {
  const source = await readFile(new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url), "utf8")
  assert.match(source, /searchParams\.set\("trackId", nextTrackId\)/)
  assert.match(source, /<RegistrationTrackList/)
  assert.match(source, /selectedRegistrationTrackId/)
  assert.match(source, /getRegistrationSummaryActionPermissions/)
  assert.match(source, /getRegistrationActionPermissions/)
})
```

Wrap only `buildRegistrationTrackListItems` and `filterRegistrationTrackListItems` in literal markers `// registration-track-list-adapter:start` and `// registration-track-list-adapter:end`. The workspace test uses the same `sourceBetween` helper as Task 4, transpiles/evaluates only that adapter block, and injects the real pure-model `getRegistrationTrackViewKey` into the VM globals before calling the exported functions; every other executable dependency must live inside the markers. The snippet above defines `fixtureItems` in the test file. React imports, JSX, and `RegistrationTrackList` remain outside the markers and are checked as source contracts rather than evaluated. Never transpile/evaluate the entire TSX module in this pure adapter test.

- [ ] **Step 2: Run the workspace test and confirm RED**

Run: `node --test tests/registration-track-workspace.test.mjs`

Expected: FAIL because `registration-track-list.tsx` and the `trackId` integration do not exist.

- [ ] **Step 3: Implement the stable list adapter**

```tsx
export type RegistrationTrackListItem = {
  key: string
  taskId: string
  trackId: string
  studentName: string
  subject: "영어" | "수학"
  status: OpsRegistrationTrackStatus
  viewKey: RegistrationTrackViewKey
  directorName: string
  directorProfileId: string | null
  stageEnteredAt: string
  migrationReviewRequired: boolean
  task: OpsTask
  track: OpsRegistrationTrackSummary
}

export function buildRegistrationTrackListItems(tasks: OpsTask[]) {
  return tasks.flatMap((task) => (task.registrationTracks || []).map((track) => ({
    key: `${task.id}:${track.id}`,
    taskId: task.id,
    trackId: track.id,
    studentName: task.studentName || task.title,
    subject: track.subject,
    status: track.status,
    viewKey: getRegistrationTrackViewKey(track.status),
    directorProfileId: track.directorProfileId,
    directorName: track.directorName,
    stageEnteredAt: track.stageEnteredAt,
    migrationReviewRequired: track.migrationReviewRequired,
    task,
    track,
  })))
}

export function filterRegistrationTrackListItems(items: RegistrationTrackListItem[], viewKey: RegistrationTrackViewKey) {
  return items.filter((item) => item.viewKey === viewKey)
}
```

Sort phone-consultation waiting items by `stageEnteredAt` oldest first. Preserve the existing user-selected table sort for all other views.

- [ ] **Step 4: Build the subject-scoped desktop and mobile rows**

The visible identity block is always:

```tsx
<div className="min-w-0">
  <div className="flex min-w-0 items-center gap-2">
    <span className="truncate font-medium">{item.studentName}</span>
    <Badge variant="outline">{item.subject}</Badge>
    <RegistrationTrackStatusBadge status={item.status} />
  </div>
  <p className="truncate text-xs text-muted-foreground">
    {item.task.registrationTracks?.length > 1 ? "같은 문의의 과목별 진행" : "단일 과목 문의"}
  </p>
</div>
```

Render `directorName || "미지정"` in the responsible-director column/metadata; this value comes from the narrow track-summary profile lookup, not option hydration. Actions include the subject in their accessible name, for example `[영어] 전화상담 완료`. Because the list deliberately has no consultation rows, it calls `getRegistrationSummaryActionPermissions`: admin/staff see stage-appropriate management affordances, while only an `admin` viewer whose ID matches the track director sees the consultation-completion affordance for `consultation_waiting|visit_consultation_scheduled`. That affordance is a hint, not mutation authority. Its click loads exact case detail, resolves the actual active consultation, calls strict `getRegistrationActionPermissions`, and opens the outcome dialog only if `canCompleteConsultation` is still true; otherwise it reloads the row and shows the state/ownership change. A different admin director still sees ordinary management controls but not completion; staff, assistant, task participant, and teacher do not see completion. Tests cover the summary hint followed by strict allow, strict denial after reassignment, sibling-admin/staff denial, and no list consultation query. Desktop keeps the existing compact table density. Mobile uses one card per track and no page-level horizontal overflow.

- [ ] **Step 5: Replace registration-only list derivation in the workspace**

- Derive `registrationTrackItems` from registration parent tasks.
- Derive tab counts from all track items before applying the selected tab filter.
- Pass filtered track items to `RegistrationTrackList`; leave withdrawal/transfer/word-retest tables untouched.
- Pass resolved `viewerId` and `viewerRole` from the authenticated profile to the list and detail shell; never infer mutation rights from row visibility or track status alone.
- Add `selectedRegistrationTrackId` state and synchronize `trackId` with `window.history.replaceState` beside `taskId`.
- Opening an item sets both IDs. Closing detail removes both query parameters.
- If a legacy fallback task has no real track ID, use `legacy:${task.id}:${subject}` only in memory and omit `trackId` from mutations.

- [ ] **Step 6: Run list, workspace, and loading tests**

Run:

```bash
node --test tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs tests/ops-task-service-loading.test.mjs
pnpm exec tsc --noEmit
```

Expected: all focused tests pass; each parent/subject pair has one stable list key; the registration list query remains narrow.

### Task 6: Unified case editor, subject navigation, and migration-review gate

**Files:**
- Create: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-service-hardening.test.mjs`

**Interfaces:**
- Consumes `OpsRegistrationCaseDetail` and RPC wrappers from Task 4.
- Produces `RegistrationTrackEditor` with `task`, `detail`, `selectedTrackId`, `viewerId`, `viewerRole`, `onSelectTrack`, `onReload`, `onWarning`, and optional `caseLevelActions` props. The last prop is rendered outside the selected-track branch so Task 9 can keep one admission panel visible for the whole case.
- Produces `RegistrationMigrationReviewEditor` with one explicit subject attribution per legacy field group.
- Produces `updateRegistrationCaseCommon(input)` service method backed by the narrow `update_registration_case_common` RPC.
- Produces `syncRegistrationCaseSubjects({ taskId, subjects, requestKey })` service method backed by `sync_registration_case_subjects` RPC; the caller owns one stable logical-submission key and reuses it for retries.
- Produces inquiry-stage actions backed by `route_registration_inquiry`; `레벨테스트 예약` opens the shared appointment editor, while `바로 상담`, `대기`, and `문의만 완료` use the route RPC.

- [ ] **Step 1: Add failing editor source-contract tests**

```js
test("track editor shows common information once and subject-scoped navigation", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /등록 공통 정보/)
  assert.match(source, /detail\.tracks\.map/)
  assert.match(source, /selectedTrackId/)
  assert.match(source, /track\.subject/)
  assert.match(source, /track\.status/)
  assert.match(source, /updateRegistrationCaseCommon/)
  assert.match(source, /expectedCommonRevision:\s*detail\.commonRevision/)
  assert.match(source, /getRegistrationIdentityEditLock\(detail\)/)
  assert.match(source, /admissionApplicationAccepted/)
  assert.match(source, /공통 정보 저장/)
  assert.match(source, /문의일시/)
  assert.match(source, /필수/)
})

test("migration review blocks ordinary actions until explicit attribution", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /과목 분리 확인 필요/)
  assert.match(source, /RegistrationMigrationReviewEditor/)
  assert.match(source, /migrationReviewRequired/)
  assert.match(source, /resolveRegistrationMigrationReview/)
  assert.match(source, /상담 책임자/)
  assert.match(source, /assignRegistrationTrackDirector/)
  assert.match(source, /consultation_waiting/)
  assert.match(source, /visit_consultation_scheduled/)
  assert.match(source, /directorProfileId/)
})

test("subject removal is routed through the history-aware RPC", async () => {
  const service = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  assert.match(service, /sync_registration_case_subjects/)
  assert.match(service, /p_subjects/)
})

test("inquiry decisions are subject-scoped and never fake a phone reservation", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /레벨테스트 예약/)
  assert.match(source, /바로 상담/)
  assert.match(source, /문의만 완료/)
  assert.match(source, /routeRegistrationInquiry/)
  assert.doesNotMatch(source, /phoneConsultationAt/)
})

test("waiting controls require the retest decision and expose explicit closure", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /레벨테스트 재응시 필요/)
  assert.match(source, /재응시 없이 등록/)
  assert.match(source, /대기 종료 · 미등록/)
  assert.match(source, /transitionRegistrationWaiting/)
})
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test tests/registration-track-workspace.test.mjs tests/registration-service-hardening.test.mjs`

Expected: FAIL because the focused editor and subject-sync RPC wrapper do not exist.

- [ ] **Step 3: Wire the Task 3 common-info and subject-sync mutations before the editor**

Use both Task 3 RPCs with these exact signatures:

```sql
public.update_registration_case_common(
  p_task_id uuid,
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_request_note text,
  p_priority text,
  p_expected_common_revision integer,
  p_request_key text
) returns jsonb;

public.sync_registration_case_subjects(
  p_task_id uuid,
  p_subjects text[],
  p_request_key text
) returns jsonb
```

`getRegistrationIdentityEditLock(detail)` returns true for any non-planned enrollment, admission batch, sent admission flag, or `detail.admissionApplicationMessageClaimActive`; both the section and its source test use this one helper. This includes `failed_hold` and exactly mirrors the database claim boundary; a released failed row is absent from the active detail query and no longer locks identity by itself. Pending shows `입학신청서 발송 처리 중`, accepted-without-flag shows the sync-recovery state, unknown shows `발송 결과 확인 필요`, and failed-hold shows `미접수 확인 · 재발송 잠금`, so reload never enables an edit that the database will reject. The common-info wrapper normalizes optional phone/school/note values to SQL null, passes the detail's `commonRevision` as `p_expected_common_revision`, passes the UI's stable logical-submission key, and never sends legacy workflow fields. The section has its own `공통 정보 저장` action so a subject-change failure cannot leave one combined browser submission half-applied. Student name, grade, parent phone, and inquiry date/time are visibly marked `필수`; the shared polished date-time control is used for inquiry time. When the helper is true, student name/school/phone identity controls are locked with `학생 연결 보정 필요`; grade, campus, inquiry time, priority, and request note remain editable. The server repeats both history and revision checks. `registration_common_revision_conflict` discards the local stale draft, reloads, and shows `다른 사용자가 공통 정보를 변경했습니다`; it is never silently retried with a new key. A successful save uses the returned incremented `commonRevision` and reloads the one case.

The subject wrapper passes distinct English/math values and a separate stable logical-submission key. Assert that the function inserts newly selected inquiry tracks and deletes only inquiry tracks with no track-linked appointment, attempt, consultation, or enrollment. Creation/director-default events do not make a fresh track undeletable, and a batch blocks removal only when that track has an enrollment in it. If business activity exists, surface `registration_subject_has_history` next to the subject control. Recompute `ops_tasks.subject` from remaining tracks in English/math order inside the RPC.

- [ ] **Step 4: Implement the editor shell with one common header and subject controls**

```tsx
export function RegistrationTrackEditor({
  task,
  detail,
  selectedTrackId,
  onSelectTrack,
  onReload,
  onWarning,
  caseLevelActions,
  viewerId,
  viewerRole,
}: RegistrationTrackEditorProps) {
  const selectedTrack = detail.tracks.find((track) => track.id === selectedTrackId) || detail.tracks[0] || null
  const reviewBlocked = detail.tracks.some((track) => track.migrationReviewRequired)
  const activeConsultation = selectedTrack
    ? detail.consultations.find((item) => item.trackId === selectedTrack.id && ["waiting", "scheduled"].includes(item.status)) || null
    : null
  const permissions = getRegistrationActionPermissions({ viewerId, viewerRole, track: selectedTrack, activeConsultation })

  return (
    <div className="grid min-w-0 gap-4">
      <RegistrationCommonInfoSection
        task={detail.task}
        commonRevision={detail.commonRevision}
        identityLocked={getRegistrationIdentityEditLock(detail)}
        title="등록 공통 정보"
        canEdit={permissions.canManage}
        onSave={(draft, requestKey) => updateRegistrationCaseCommon({
          ...draft,
          taskId: detail.task.id,
          expectedCommonRevision: detail.commonRevision,
          requestKey,
        })}
        onSaved={onReload}
      />
      <div role="tablist" aria-label="과목별 등록 진행" className="flex min-w-0 gap-1 overflow-x-auto">
        {detail.tracks.map((track) => (
          <Button
            key={track.id}
            role="tab"
            type="button"
            variant={track.id === selectedTrack?.id ? "default" : "ghost"}
            aria-selected={track.id === selectedTrack?.id}
            onClick={() => onSelectTrack(track.id)}
          >
            {track.subject} · {getRegistrationTrackStatusLabel(track.status)}
          </Button>
        ))}
      </div>
      {reviewBlocked ? (
        <RegistrationMigrationReviewEditor task={task} detail={detail} permissions={permissions} onResolved={onReload} />
      ) : selectedTrack ? (
        <RegistrationTrackStageEditor
          task={detail.task}
          track={selectedTrack}
          detail={detail}
          permissions={permissions}
          onReload={onReload}
          onWarning={onWarning}
        />
      ) : null}
      {caseLevelActions}
    </div>
  )
}
```

Keep the existing clean icon-only dialog close button. Use one scroll container for the dialog; nested sections must not introduce page-level scrolling. `caseLevelActions` is always after the selected subject's stage editor and is never nested inside it; selecting an inquiry/level-test subject therefore cannot hide a shared admission batch already in progress for another subject. The common editor, subject sync, migration review, appointment controls, waiting actions, enrollment rows, and case admission panel require `permissions.canManage`. Only the actual active consultation completion may render for `permissions.canCompleteConsultation` when `canManage` is false. Read-only viewers still see the full shared case and history.

- [ ] **Step 5: Implement explicit migration attribution**

Group the one parent legacy snapshot into `level_test`, `consultation`, and `placement` groups. Each non-empty group gets one required choice: English, mathematics, or `공통 이력만 유지`. Saving sends:

```ts
type RegistrationMigrationAssignment = {
  group: "level_test" | "consultation" | "placement"
  trackId: string | null
  preserveAsCommonHistory: boolean
}

type RegistrationMigrationTrackState = {
  trackId: string
  targetStatus:
    | "inquiry" | "level_test_scheduled" | "consultation_waiting" | "visit_consultation_scheduled" | "waiting"
    | "enrollment_decided" | "enrollment_processing"
    | "registered" | "not_registered" | "inquiry_closed"
  waitingKind?: "current_class" | "current_term_opening" | "next_term_opening"
  classId?: string
}
```

For each review track, render a `상담 책임자` selector before target-state controls. A multi-subject review track never receives an automatic default. Saving the selector first calls `assignRegistrationTrackDirector({ trackId: reviewTrack.id, directorProfileId: selectedDirectorProfileId, assignmentSource: "manual", ruleKey: null, expectedCommonRevision: detail.commonRevision, requestKey: submissionKeys.getOrCreate("migration-director", reviewTrack.id) })`; the review payload does not smuggle a director ID into the resolution RPC. Both `consultation_waiting` and `visit_consultation_scheduled` targets remain disabled until that subject has a persisted director. Visit additionally requires the attributed consultation group to contain a valid time and nonblank place. If the operator does not want to attribute an incomplete visit, preserve it as common history and create a fresh reservation later.

The resolution RPC payload remains exactly `{ assignments: RegistrationMigrationAssignment[], trackStates: RegistrationMigrationTrackState[] }`. The save button stays disabled until every non-empty group has exactly one assignment and every review track has one valid target state plus its conditional director/waiting/class fields. `level_test_scheduled` is selectable only when the one attributed level-test group contains both a real legacy time and nonblank place. If either is missing, preserve that group in common history, disable the scheduled target with `예약 정보가 불완전해 새 예약이 필요합니다`, and resolve the track to inquiry before opening the normal shared-appointment editor; the review RPC creates no partial appointment or attempt. `enrollment_processing` and `registered` remain disabled until the editor's derived evidence preview passes the exact server validators listed in Task 3; failed evidence offers `등록 결정으로 이동` rather than importing a partial paid/completed state. The database repeats every gate, rechecks the saved director for consultation targets, creates only history justified by the attributed group, clears every review flag, and records the chosen source/destination. The missing-place runtime fixture must resolve to inquiry with zero appointment/attempt rows before a later valid normal booking. A single-subject legacy `3.` case skips attribution but still requires its one target state/outcome. On success, reload the case and focus the first non-review track. Never duplicate one group into both tracks.

- [ ] **Step 6: Integrate the new editor into create, edit, and detail flows**

- New registration creation keeps the existing required common inquiry fields and multi-subject toggle, but submit calls `createRegistrationCase` so parent and tracks are atomic.
- Existing-case common information is editable in the same case dialog but saves through `updateRegistrationCaseCommon` only; it never falls back to the old whole-form task/detail writer. Its save button remains disabled until student name, grade, valid parent phone, and inquiry time are present.
- Editing subjects calls `syncRegistrationCaseSubjects`; preserve selection if its track survives.
- Each inquiry track independently exposes `레벨테스트 예약`, `바로 상담`, `대기`, and `문의만 완료`. `바로 상담` first requires the subject director and creates a phone queue item; `대기` requires its waiting kind, and current-class waiting also requires a same-subject class; `문의만 완료` requires confirmation. `레벨테스트 예약` saves a real appointment for one or both selected tracks.
- Opening a real track loads `loadRegistrationCaseDetail(taskId, viewerId)` and renders `RegistrationTrackEditor`.
- When neither migration exists, legacy fallback rows continue using the old form. When child tables exist but runtime readiness version 1 does not, the registration workspace is maintenance/read-only and exposes neither legacy nor new mutations. Once ready, real child tracks use only the new editor/RPCs; do not mix legacy and new mutations.
- Completed tracks stay read-only except for dedicated reopen/add-class actions.
- Waiting tracks show change-waiting-kind, `레벨테스트 재응시 필요`, `재응시 없이 등록`, and `대기 종료 · 미등록`. The retest action first records `required`, then opens the real appointment editor; enrollment records `not_required`; closure requires a reason. Each calls `transitionRegistrationWaiting` with one stable logical-submission key.

- [ ] **Step 7: Run editor, legacy, and type checks**

Run:

```bash
node --test tests/registration-track-workspace.test.mjs tests/registration-service-hardening.test.mjs tests/registration-workflow.test.mjs
pnpm exec tsc --noEmit
pnpm exec eslint src/features/tasks/registration-track-editor.tsx src/features/tasks/ops-task-workspace.tsx
```

Expected: focused suites and typecheck pass; ESLint reports no new warnings or errors.

### Task 7: Shared level-test and visit-appointment editor

**Files:**
- Create: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `tests/registration-track-model.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Consumes `DateTimePickerControl`, track detail, appointment/activity rows, and Task 4 RPC wrappers.
- Produces `RegistrationAppointmentEditor` with `kind`, `taskId`, `eligibleTracks`, `appointment`, `activities`, `onSaved`, and `onWarning`.
- Produces service methods `startRegistrationLevelTestAttempt(input)` and `completeRegistrationLevelTestAttempt(input)` backed by their exact Task 3 RPCs.
- Produces `closeRegistrationLevelTestTrack(input)` for an absent/canceled subject with no active attempt.
- Produces service method `cancelRegistrationAppointment(input)` backed by `cancel_registration_appointment`.
- Produces model helpers `getEligibleSharedAppointmentTracks(kind, tracks, activities, currentAppointmentId)` and `getRegistrationAppointmentEditMode(activities)`.

- [ ] **Step 1: Write failing eligibility, immutability, and UI source tests**

```js
test("shared level test includes both eligible subjects but keeps results independent", () => {
  assert.deepEqual(getEligibleSharedAppointmentTracks("level_test", [
    { id: "eng", subject: "영어", status: "inquiry" },
    { id: "math", subject: "수학", status: "inquiry" },
    { id: "waiting", subject: "수학", status: "waiting", levelTestRetakeDecision: "required" },
    { id: "closed", subject: "영어", status: "registered" },
  ]).map((track) => track.id), ["eng", "math", "waiting"])
})

test("appointment eligibility excludes an active activity elsewhere but keeps the current scheduled selection", () => {
  const tracks = [
    { id: "eng", subject: "영어", status: "waiting", levelTestRetakeDecision: "required" },
    { id: "math", subject: "수학", status: "level_test_scheduled" },
  ]
  const activities = [
    { trackId: "eng", appointmentId: "other", status: "scheduled" },
    { trackId: "math", appointmentId: "current", status: "scheduled" },
  ]
  assert.deepEqual(
    getEligibleSharedAppointmentTracks("level_test", tracks, activities, "current").map((track) => track.id),
    ["math"],
  )
})

test("a shared test reschedules only the absent subject after its sibling completed", () => {
  const tracks = [
    { id: "eng", subject: "영어", status: "consultation_waiting" },
    { id: "math", subject: "수학", status: "level_test_scheduled" },
  ]
  const activities = [
    { trackId: "eng", appointmentId: "old", status: "completed", attemptNumber: 1 },
    { trackId: "math", appointmentId: "old", status: "absent", attemptNumber: 1 },
  ]
  assert.deepEqual(
    getEligibleSharedAppointmentTracks("level_test", tracks, activities, null).map((track) => track.id),
    ["math"],
  )
})

test("started shared appointment requires replacement rather than in-place edit", () => {
  assert.equal(getRegistrationAppointmentEditMode([{ status: "scheduled" }, { status: "scheduled" }]), "edit")
  assert.equal(getRegistrationAppointmentEditMode([{ status: "completed" }, { status: "scheduled" }]), "replace_remaining")
})

test("appointment editor uses one schedule and one result control per subject", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /DateTimePickerControl/)
  assert.match(source, /적용 과목/)
  assert.match(source, /activities\.map/)
  assert.match(source, /시험지·결과지 URL/)
  assert.match(source, /시험 시작/)
  assert.match(source, /startRegistrationLevelTestAttempt/)
  assert.match(source, /문의 종료/)
  assert.match(source, /closeRegistrationLevelTestTrack/)
  assert.match(source, /남은 과목 일정 다시 잡기/)
  assert.match(source, /예약 취소/)
  assert.match(source, /cancelRegistrationAppointment/)
})
```

- [ ] **Step 2: Run appointment-focused tests and confirm RED**

Run: `node --test tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs`

Expected: FAIL because the eligibility/edit-mode helpers and appointment editor are missing.

- [ ] **Step 3: Wire the Task 3 level-test start and completion mutations**

Use both Task 3 RPCs:

```sql
public.start_registration_level_test_attempt(
  p_attempt_id uuid,
  p_request_key text
) returns jsonb;

public.complete_registration_level_test_attempt(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
) returns jsonb
```

Each wrapper requires the UI's stable request key. Start accepts only a scheduled attempt and moves only its track to in-progress. Completion sends only `completed`, `absent`, or `canceled` plus the subject material link. Tests assert that completed requires a non-empty link, absent/canceled does not, only the completed subject advances to `consultation_waiting`, and the shared appointment completes only when every attached attempt is terminal.

- [ ] **Step 4: Implement eligible-track and edit-mode helpers**

```js
export function getEligibleSharedAppointmentTracks(
  kind,
  tracks = [],
  activities = [],
  currentAppointmentId = null,
) {
  const currentId = String(currentAppointmentId || "")
  const activeStatuses = kind === "level_test"
    ? new Set(["scheduled", "in_progress"])
    : new Set(["scheduled"])

  return tracks.filter((track) => {
    const trackActivities = activities.filter((activity) => activity?.trackId === track?.id)
    const latestActivity = trackActivities.reduce((latest, activity) => (
      !latest || Number(activity?.attemptNumber || 0) > Number(latest?.attemptNumber || 0)
        ? activity
        : latest
    ), null)
    const isScheduledOnCurrent = Boolean(currentId) && trackActivities.some((activity) => (
      activity?.appointmentId === currentId && activity?.status === "scheduled"
    ))
    if (isScheduledOnCurrent) return true

    const hasActiveElsewhere = trackActivities.some((activity) => (
      activeStatuses.has(activity?.status)
      && activity?.appointmentId !== currentId
    ))
    if (hasActiveElsewhere) return false

    if (kind === "level_test") {
      return track?.status === "inquiry"
        || (track?.status === "waiting" && track?.levelTestRetakeDecision === "required")
        || (track?.status === "level_test_scheduled" && ["absent", "canceled"].includes(latestActivity?.status))
    }
    return track?.status === "consultation_waiting"
  })
}

export function getRegistrationAppointmentEditMode(activities = []) {
  return activities.every((activity) => activity?.status === "scheduled")
    ? "edit"
    : "replace_remaining"
}
```

- [ ] **Step 5: Build one appointment form with subject participation controls**

The caller passes only kind-matching normalized activities (`{ trackId, appointmentId, status, attemptNumber? }`): level-test attempts for a level-test editor and visit consultations for a visit editor; phone-waiting rows are deliberately excluded. This keeps a scheduled child selectable while editing its current appointment, excludes any candidate already active on another appointment, and allows a `level_test_scheduled` track as a new candidate only when its latest numbered attempt is absent/canceled and no attempt remains active. A completed attempt and a free `visit_consultation_scheduled` track remain excluded. Add matching no-`any` declarations and tests for both level-test and visit modes. The server repeats the same eligibility/one-active-child/latest-attempt checks under row locks so a stale browser cannot create a duplicate active activity.

The editor contains one polished date/time control, one place control, and English/math subject toggles. At least one subject is required. It passes the current kind's activities and `appointment?.id || null` into the eligibility helper before rendering toggles. Save calls:

```ts
const requestKey = submissionKeys.getOrCreate("appointment", normalizedDraft)
const saved = await saveRegistrationSharedAppointment({
  appointmentId: appointment?.id || null,
  expectedNotificationRevision: appointment?.notificationRevision ?? null,
  taskId,
  kind,
  scheduledAt,
  place,
  trackIds: selectedTrackIds,
  replaceRemaining: editMode === "replace_remaining",
  requestKey,
})
onSaved(saved)
```

The wrapper maps a missing appointment and its expected revision to SQL `null`; it never sends `""` to a UUID parameter. Every edit/replacement passes the revision that was loaded with the form. On `registration_appointment_revision_conflict`, discard the local appointment draft, reload the case, and show `다른 사용자가 예약을 변경했습니다. 최신 내용을 확인하세요`; never auto-retry a stale authoritative diff under a new key. Task 7 stops at the typed `onSaved(saved)` handoff and performs no notification dispatch, keeping this checkpoint independent of the canonical endpoint work. Task 8 consumes the authoritative `saved.notificationTargets`: creation/edit normally returns one target; replacement returns old and new visit appointments.

For level tests, render one activity result row per subject after the appointment:

```tsx
{activities.map((activity) => (
  <section key={activity.id} className="grid gap-2 rounded-md border p-3">
    <div className="flex items-center justify-between gap-2">
      <Badge variant="outline">{trackById.get(activity.trackId)?.subject}</Badge>
      <RegistrationActivityStatusBadge status={activity.status} />
    </div>
    <TextField
      label="시험지·결과지 URL"
      value={draftLinks[activity.id] || activity.materialLink || ""}
      onChange={(value) => updateDraftLink(activity.id, value)}
    />
    {activity.status === "scheduled" ? (
      <LevelTestScheduledActions
        activity={activity}
        onStart={() => startRegistrationLevelTestAttempt({
          attemptId: activity.id,
          requestKey: submissionKeys.getOrCreate("level-test-start", activity.id),
        })}
        onAbsentOrCancel={completeRegistrationLevelTestAttempt}
      />
    ) : activity.status === "in_progress" ? (
      <LevelTestResultActions activity={activity} onComplete={completeRegistrationLevelTestAttempt} />
    ) : null}
  </section>
))}
```

Completed/absent/canceled activities are immutable. Replacement moves only scheduled activities to a new appointment and keeps terminal history attached to the original. The completed-result action is disabled with an inline `상담 책임자` blocker until that track has a saved director; absent/canceled remains available.

When a subject's latest attempt is absent/canceled and it has no active attempt, show `다시 예약` and `문의 종료`. Rebooking opens this editor; closure requires a reason and calls `closeRegistrationLevelTestTrack` with a stable key. Completed attempts never expose inquiry closure.

`예약 취소` requires a reason and calls `cancelRegistrationAppointment` with the currently loaded `expectedNotificationRevision` and a stable key derived from appointment ID plus reason revision. A stale-revision error reloads instead of canceling newer work. It never edits or deletes completed/absent activities. If every activity was still scheduled, the appointment becomes canceled; if some were already terminal, only remaining scheduled activities are canceled and the original appointment remains immutable history. Task 7 passes the authoritative response, including `notificationTargets`, through `onSaved(saved)` only; Task 8 owns canonical dispatch and its endpoint-mocked cancellation/replacement tests.

- [ ] **Step 6: Integrate visit scheduling into the consultation stage**

- A consultation-waiting track defaults to phone handling.
- `방문상담 예약` opens the same appointment editor with `kind="visit_consultation"` and one or both eligible tracks.
- Scheduling a visit cancels the selected tracks' active phone-waiting consultation rows and creates visit rows; unselected tracks remain in the phone queue.
- After authoritative save/cancel, call only the typed `onSaved(saved)` handoff. Do not call a notification endpoint in Task 7 and do not send a phone reservation notification.
- Keep the returned visit `notificationTargets` intact so Task 8 can dispatch creation/edit/cancel once and replacement exactly twice for old/new appointments.

- [ ] **Step 7: Run appointment, date-picker, and notification-adjacent tests**

Run:

```bash
node --test tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs tests/date-time-picker.test.mjs tests/registration-consultation-notification.test.mjs
pnpm exec tsc --noEmit
```

Expected: shared appointment, independent-result, immutability, date/time, and existing notification tests pass.

### Task 8: Phone-consultation queue, subject outcomes, and appointment-aware notifications

**Files:**
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-track-list.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-consultation-notification.js`
- Modify: `src/app/api/registration/consultation-notification/route.ts`
- Modify: `tests/registration-consultation-notification.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Consumes `completeRegistrationConsultation` from Task 4.
- Consumes `RegistrationAppointmentMutationResponse` from Task 7's `onSaved` handoff and owns visit notification dispatch.
- Produces `RegistrationConsultationOutcomeDialog` for phone and visit completion.
- Produces `getRegistrationVisitNotificationDedupeKey({ appointmentId, notificationRevision, trackId, directorProfileId })`, revision-scoped admin-chat keys, and appointment-aware canonical message helpers.
- Notification endpoint accepts only `{ appointmentId: string }`; it reloads every other value from the database.
- Adds `sendRegistrationVisitNotificationTarget(target)` and wires the appointment editor to iterate authoritative `notificationTargets` only in this task; per-target failures become one retryable post-save warning.

- [ ] **Step 1: Write failing queue, outcome, and notification-key tests**

```js
test("phone queue is oldest first and never shows a reservation time", () => {
  const items = sortRegistrationConsultationItems([
    consultationItem("new", "2026-07-12T03:00:00Z", "phone"),
    consultationItem("old", "2026-07-10T03:00:00Z", "phone"),
  ])
  assert.deepEqual(items.map((item) => item.trackId), ["old", "new"])
  assert.equal(getRegistrationConsultationTimeLabel(items[0]), "전화상담 대기")
})

test("visit notification key is scoped by appointment revision, track, and director", () => {
  assert.equal(getRegistrationVisitNotificationDedupeKey({
    appointmentId: "appointment-1",
    notificationRevision: 2,
    trackId: "english",
    directorProfileId: "director-1",
  }), "registration:visit:appointment-1:revision:2:track:english:director:director-1")
})

test("real appointment edits refresh notifications while same-revision retries dedupe", () => {
  const base = { appointmentId: "appointment-1", trackId: "english", directorProfileId: "director-1" }
  assert.equal(
    getRegistrationVisitNotificationDedupeKey({ ...base, notificationRevision: 1 }),
    getRegistrationVisitNotificationDedupeKey({ ...base, notificationRevision: 1 }),
  )
  assert.notEqual(
    getRegistrationVisitNotificationDedupeKey({ ...base, notificationRevision: 1 }),
    getRegistrationVisitNotificationDedupeKey({ ...base, notificationRevision: 2 }),
  )
  assert.notEqual(
    getRegistrationVisitAdminChatKey("appointment-1", 1),
    getRegistrationVisitAdminChatKey("appointment-1", 2),
  )
})

test("notification route accepts appointmentId and reloads canonical track data", async () => {
  const source = await readFile(new URL("../src/app/api/registration/consultation-notification/route.ts", import.meta.url), "utf8")
  assert.match(source, /body\.appointmentId/)
  assert.match(source, /ops_registration_appointments/)
  assert.match(source, /ops_registration_consultations/)
  assert.match(source, /ops_registration_subject_tracks/)
  assert.match(source, /notification_revision/)
  assert.match(source, /registration_track_event/)
  assert.doesNotMatch(source, /body\.message/)
})

test("visit cancellation and replacement dispatch only canonical revision targets", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /notificationTargets/)
  assert.match(source, /cancelRegistrationAppointment/)
  assert.match(source, /sendRegistrationVisitNotificationTarget/)
})
```

- [ ] **Step 2: Run consultation tests and confirm RED**

Run: `node --test tests/registration-consultation-notification.test.mjs tests/registration-track-workspace.test.mjs`

Expected: FAIL because the phone-queue helpers and appointment-aware notification contract are missing.

- [ ] **Step 3: Implement oldest-first phone work items and completion dialog**

Phone items sort by `stageEnteredAt` ascending before any secondary stable ID sort. They display `전화상담 대기` instead of a date. The list query does not contain consultations; clicking the subject-scoped row action first reuses/loads the selected case detail, resolves that track's one active phone consultation, recomputes `getRegistrationActionPermissions` with the actual consultation snapshot, and opens the dialog only when `canCompleteConsultation` remains true:

```tsx
<RegistrationConsultationOutcomeDialog
  subject={track.subject}
  mode={consultation.mode}
  open={outcomeDialogOpen}
  onSubmit={async ({ outcome, waitingKind, classId }) => {
    await completeRegistrationConsultation({
      consultationId: consultation.id,
      outcome,
      waitingKind: outcome === "waiting" ? waitingKind : "",
      classId: outcome === "waiting" && waitingKind === "current_class" ? classId : "",
      requestKey: submissionKeys.getOrCreate("consultation-complete", {
        consultationId: consultation.id,
        outcome,
        waitingKind,
        classId,
      }),
    })
    await onReload()
  }}
/>
```

The three outcomes are `등록`, `대기`, and `미등록 완료`. Choosing `대기` requires one of the three waiting kinds. `현재 학기 수강반 대기` additionally shows a same-subject class selector and requires one class; the other two waiting kinds do not show a class field. The dialog shows no editable completion time; the database stamps it. Visit completion uses the same dialog per participating subject.

- [ ] **Step 4: Replace case-wide notification helpers with appointment/track helpers**

```js
export function getRegistrationVisitNotificationDedupeKey(input = {}) {
  return [
    "registration:visit",
    text(input.appointmentId),
    "revision",
    String(Number(input.notificationRevision)),
    "track",
    text(input.trackId),
    "director",
    text(input.directorProfileId),
  ].join(":")
}

export function getRegistrationVisitAdminChatKey(appointmentId, notificationRevision) {
  return `registration:visit:${text(appointmentId)}:revision:${Number(notificationRevision)}:admin-chat`
}
```

The canonical message includes student, shared appointment date/time/place, participating subject badges, and each subject/director pair. It never includes client-supplied free text.

- [ ] **Step 5: Rewrite the API route around the authoritative appointment**

The endpoint flow is exact:

1. Authenticate the bearer token and require dashboard role `admin` or `staff`.
2. Require only `appointmentId` in the JSON body.
3. Reload a `visit_consultation` appointment including its authoritative `notification_revision`, its registration task, every attached visit consultation (scheduled/completed/canceled), each subject track/director profile, and the canonical registration-track events for that appointment revision.
4. Reject missing, non-visit, cross-task, director-less, or revision/event-mismatched data with 4xx. A canceled/replaced appointment is valid only for a canonical cancellation/replacement revision event.
5. Create one dashboard notification per track changed by that revision using a key derived from appointment ID + authoritative revision + track + director. Scheduled/updated rows receive the canonical reservation state; canceled/replaced rows receive an explicit cancellation/replacement state and reason, so an old live notice is never left as the last signal.
6. Claim and send one management Google Chat summary using appointment ID + authoritative revision. A retry against the same saved revision deduplicates; an actual time/place edit, participation add/deselect, cancellation, or replacement has a new revision and sends the refreshed canonical payload. Adding a second subject therefore refreshes the first director and the management-room two-subject summary instead of being suppressed by the original one-subject keys. Replacement invokes this once for the old revision and once for the new appointment.
7. Preserve the existing `delivery_unknown` policy when the webhook outcome is ambiguous.
8. Return `{ ok: true, warning, appointmentId, notificationRevision, notifiedTrackIds }`.

Each dashboard notification href is canonical and subject-specific: `/admin/registration?taskId={taskId}&trackId={trackId}`. Add tests for both query parameters, a time/place edit producing revision 2, adding a second subject producing refreshed per-director and admin-chat revision-2 keys, and same-revision retry deduplication.

Keep the service-role client server-only. Never return webhook URLs or tokens.

- [ ] **Step 6: Prove phone handling never calls the reservation endpoint**

Add a source assertion that the phone completion handler calls only `completeRegistrationConsultation` and `onReload`, while the visit appointment handler iterates authoritative `notificationTargets` through `sendRegistrationVisitNotificationTarget(target)`. The raw `fetch("/api/registration/consultation-notification", ...)` exists only inside that helper. This prevents duplicate call sites and a future regression that sends fake phone reservation alerts.

- [ ] **Step 7: Run consultation, route, and workspace checks**

Run:

```bash
node --test tests/registration-consultation-notification.test.mjs tests/registration-track-workspace.test.mjs tests/registration-service-hardening.test.mjs
pnpm exec tsc --noEmit
pnpm exec eslint src/features/tasks/registration-consultation-notification.js src/app/api/registration/consultation-notification/route.ts src/features/tasks/registration-track-list.tsx src/features/tasks/registration-track-editor.tsx
```

Expected: all focused checks pass; no automated test sends a real webhook request.

### Task 9: Repeated enrollment rows, `수업 추가`, and admission-batch revisions

**Files:**
- Create: `src/features/tasks/registration-enrollment-editor.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `src/app/api/solapi/registration/route.ts`
- Create: `src/app/api/solapi/registration/legacy.ts`
- Modify: `tests/registration-track-model.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/ops-task-service-loading.test.mjs`
- Create: `tests/registration-admission-message-route.test.mjs`

**Interfaces:**
- Produces `RegistrationEnrollmentDraft` and pure helpers `createRegistrationEnrollmentDraft`, `serializeRegistrationEnrollmentRows`, `mergeSavedRegistrationEnrollmentRows`, `getRegistrationEnrollmentBlockers`, `applyRegistrationEnrollmentClassSelection`, and `getRegistrationAdmissionBatchChecklist`.
- Produces subject-scoped `RegistrationEnrollmentEditor` with `taskId`, `track`, that track's enrollments, classes, textbooks, `permissions`, and row mutation callbacks.
- Produces case-scoped `RegistrationAdmissionPanel` with `taskId`, every track, all enrollments, every batch, `admissionNoticeSent`, `admissionApplicationMessageId`, `admissionApplicationMessageStatus`, `admissionApplicationMessageClaimActive`, `admissionApplicationMessageUpdatedAt`, `permissions`, `onCheckAdmissionMessage({ messageId })`, `onReconcileAdmissionMessage({ messageId, resolution, providerEvidence, reason, requestKey })`, `onReleaseAdmissionMessageRetry({ messageId, providerEvidence, reason, requestKey })`, and batch mutation callbacks. It owns child-aware eligibility, pending server-check, unknown/failed-hold reconciliation and delayed release, accepted-but-unsynced recovery, batch selection/checklist/history, and is independent of the selected subject tab.
- Produces `getRegistrationAdmissionApplicationState({ tracks, enrollments, admissionNoticeSent, admissionApplicationMessageStatus, admissionApplicationMessageClaimActive })` with exact `{ eligible, delivered, syncNeeded, blocked, canSend }` semantics shared by the UI and route fixtures.
- Wires `routeRegistrationEnrollmentDecision`, `setRegistrationEnrollmentMakeedu`, `advanceRegistrationAdmissionBatch`, `cancelRegistrationAdmissionBatch`, and `cancelRegistrationEnrollment` with stable request keys and explicit confirmations/reasons.
- Reuses exact-ID `loadOpsRegistrationClassDetail(classId)`; no all-class schedule hydration is allowed.

- [ ] **Step 1: Write failing repeated-row and batch-rule tests**

```js
test("new class rows keep stable IDs and do not reset existing rows", () => {
  const first = createRegistrationEnrollmentDraft({ clientKey: "draft-1" })
  const second = createRegistrationEnrollmentDraft({ clientKey: "draft-2" })
  const selected = applyRegistrationEnrollmentClassSelection(first, {
    classItem: { id: "eng-a", subject: "영어", textbookIds: ["book-a"] },
    availableTextbookIds: ["book-a"],
  })
  assert.equal(selected.classId, "eng-a")
  assert.equal(selected.textbookId, "book-a")
  assert.equal(second.classId, "")
  assert.equal(first.id, null)
  assert.deepEqual(serializeRegistrationEnrollmentRows([selected])[0], {
    classId: "eng-a", textbookId: "book-a", classStartDate: null,
    classStartSessionKey: null, classStartSession: null, sortOrder: 0,
  })
})

test("new-row retry remaps the authoritative persisted ID without changing the request key", () => {
  const local = createRegistrationEnrollmentDraft({ clientKey: "local-1", classId: "eng-a" })
  const saved = mergeSavedRegistrationEnrollmentRows([local], [{ id: "db-1", classId: "eng-a", sortOrder: 0 }])
  assert.equal(saved[0].clientKey, "local-1")
  assert.equal(saved[0].id, "db-1")
})

test("enrollment blockers are row-specific and reject cross-subject or duplicate classes", () => {
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [
      { id: null, clientKey: "1", classId: "eng-a", classStartDate: "2026-07-20", classStartSession: "1회차" },
      { id: null, clientKey: "2", classId: "eng-a", classStartDate: "2026-07-22", classStartSession: "2회차" },
    ],
    classes: [{ id: "eng-a", subject: "영어" }],
  }), [{ rowId: "2", field: "classId", message: "중복 수업" }])
})

test("later class creates a fresh batch checklist", () => {
  assert.deepEqual(getRegistrationAdmissionBatchChecklist({
    admissionNoticeSent: true,
    enrollments: [{ makeeduRegistered: true }, { makeeduRegistered: false }],
    batch: { status: "draft", invoiceSentAt: "", paymentConfirmedAt: "" },
  }), {
    admissionNotice: true,
    makeedu: false,
    invoice: false,
    payment: false,
    complete: false,
  })
})

test("case admission application eligibility follows child tracks, not the earliest parent projection", () => {
  const state = getRegistrationAdmissionApplicationState({
    tracks: [
      { id: "english", status: "enrollment_decided" },
      { id: "math", status: "level_test_scheduled" },
    ],
    enrollments: [],
    admissionNoticeSent: false,
    admissionApplicationMessageStatus: "",
    admissionApplicationMessageClaimActive: false,
  })
  assert.deepEqual(state, { eligible: true, delivered: false, syncNeeded: false, blocked: false, canSend: true })
  assert.deepEqual(getRegistrationAdmissionApplicationState({
    tracks: [{ id: "english", status: "registered" }],
    enrollments: [{ trackId: "english", status: "planned", admissionBatchId: null }],
    admissionNoticeSent: false,
    admissionApplicationMessageStatus: "accepted",
    admissionApplicationMessageClaimActive: true,
  }), { eligible: true, delivered: true, syncNeeded: true, blocked: false, canSend: false })
  for (const status of ["pending", "unknown", "failed_hold"]) {
    const blocked = getRegistrationAdmissionApplicationState({
      tracks: [{ id: "english", status: "enrollment_decided" }],
      enrollments: [],
      admissionNoticeSent: false,
      admissionApplicationMessageStatus: status,
      admissionApplicationMessageClaimActive: true,
    })
    assert.equal(blocked.blocked, true)
    assert.equal(blocked.canSend, false)
  }
})

test("enrollment editor exposes a subject-scoped add button", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /수업 추가/)
  assert.match(source, /track\.subject/)
  assert.match(source, /loadOpsRegistrationClassDetail/)
  assert.match(source, /선택 안 함 · 이미 보유/)
  assert.match(source, /setRegistrationEnrollmentMakeedu/)
  assert.match(source, /cancelRegistrationAdmissionBatch/)
  assert.match(source, /cancelRegistrationEnrollment/)
})

test("admission panel is case-scoped and renders every current-batch row", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /RegistrationAdmissionPanel/)
  assert.match(source, /currentBatchEnrollments\.map/)
  assert.match(source, /trackById\.get\(enrollment\.trackId\)/)
  assert.match(source, /입학 처리/)
  const shell = await readFile(new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url), "utf8")
  assert.match(shell, /caseLevelActions/)
  assert.match(shell, /RegistrationAdmissionPanel/)
})
```

- [ ] **Step 2: Run enrollment tests and confirm RED**

Run: `node --test tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs`

Expected: FAIL because repeated-row helpers and editor are missing.

- [ ] **Step 3: Make child eligibility and one accepted admission message authoritative**

Keep the UI button pointed at `/api/solapi/registration`, but remove every ready-mode use of parent pipeline eligibility. Before **every** GET/POST branch, the server route runs the three-state readiness contract: version 1 is ready; missing function plus missing child table is legacy; existing child table without readiness is maintenance; unexpected errors fail closed. Extract the current pre-migration direct-DML implementation unchanged into `legacy.ts` and invoke it only from exact legacy mode. `route.ts` itself contains no direct message/detail/event DML. Maintenance returns HTTP 503 `REGISTRATION_MIGRATION_IN_PROGRESS` before claim, provider lookup/send, finalizer, reconciliation, mark, or release. Ready uses only the child-backed flow below. Tests prove all three modes, that maintenance makes zero external/legacy calls, and that ready never imports/calls the legacy adapter.

In ready mode, `getRegistrationAdmissionApplicationState` defines eligibility as either (a) at least one track is `enrollment_decided`, or (b) a `registered` track owns at least one unbatched planned add-class row. Released enrolled history and canceled rows do not qualify. A sibling subject may remain earlier. The GET response returns `admissionEligible`, canonical current active message ID/status/claimActive/update time, derived accepted, and `admissionNoticeSent`; it exposes no recipient/provider payload. Active failed maps to `failed_hold`. `delivered = accepted || admissionNoticeSent`, `syncNeeded = accepted && !admissionNoticeSent`, `blocked = claimActive && status in pending|unknown|failed_hold`, and `canSend = eligible && !delivered && !claimActive`. Pending renders `발송 처리 중`, accepted-unsynced renders `발송 접수됨 · 상태 동기화 필요`, unknown renders `발송 결과 확인 필요`, and failed-hold renders `미접수 확인 · 재발송 잠금`; none exposes send.

For `action` absent or `send`, ready-mode POST never reads name/phone or inserts/updates a message directly. It calls the claim RPC before any route-local eligibility shortcut; an existing accepted claim can recover its mark even after eligibility disappears. Only `shouldSend: true` permits one SOLAPI call using frozen identity. Add `showMessageList: true` and `customFields: { registrationRequestKey: claim.messageRequestKey }`. Pass every provider outcome to a route-local finalizer helper that calls only the service-role finalizer RPC. A successful response with provider ID/group is accepted; explicit rejection before acceptance is definitive failed; ambiguous network outcome is unknown. Trust returned status **and** claimActive. Accepted then calls the authenticated mark RPC with stable key; mark failure warns but never resends. Source tests scan `route.ts`/ready helpers for any direct message/detail/event DML or browser-service finalizer export. The isolated `legacy.ts` adapter is checked separately for exact legacy-only reachability and is removed in the later legacy-retirement migration.

`action: "check"` is the orphan-pending recovery path and never calls claim or send. Require admin/staff, the current message ID, and at least 15 minutes since its server update time. Using the existing SOLAPI HMAC credentials, call official `GET /messages/v4/list`: query exact saved `provider_message_id`/`provider_group_id` when available; otherwise query the frozen full recipient and a tight request-time window, then filter the returned message-list object to the exact `customFields.registrationRequestKey`. A matching provider record is finalized `accepted` with its IDs/status. A successful lookup with no exact match is still indeterminate and finalizes `unknown`, never definitive failed; lookup/network failure leaves the row unchanged and returns a retryable warning. If accepted, run mark recovery. This branch makes a crashed send recoverable without letting browser evidence decide a pending row.

Provider reference: [SOLAPI 메시지 목록 조회](https://solapi.com/developers/api/msg-getList) documents `GET /messages/v4/list`, exact message/group filters, date windows, and the object-shaped `messageList`; [SOLAPI 메시지 발송](https://solapi.com/developers/api/messages) documents `showMessageList`, provider IDs, group state, and custom fields. Keep provider parsing in route-local helpers and fixture it rather than coupling UI code to raw response shapes.

`action: "reconcile"` never calls claim, send, or provider lookup. It validates the exact JSON evidence object, resolution, reason, and message ID, then calls only `reconcileRegistrationAdmissionMessage`; accepted triggers mark recovery, while failed becomes an active failed-hold. `action: "release"` never claims or sends: it calls only `releaseRegistrationAdmissionMessageRetry` after the server-enforced 15-minute failed-hold delay and reloads the case. Only after release removes the active claim does the panel expose `다시 발송`, which generates a brand-new message key. The panel shows `발송 상태 확인` for pending, `확인 결과 기록` for unknown, `접수 확인` plus delayed `재발송 허용` for failed-hold, and no mutation control to read-only roles. Failed-hold-to-accepted remains available until release when later provider evidence proves acceptance.

Route/workspace tests cover child eligibility, registered add-class eligibility, no-eligible new-send rejection, new acceptance, same-key replay, different actor/key race, claim-versus-identity edit, cross-task message-key reuse, readiness maintenance blocking, route-local service-role finalization, exact provider-query/custom-field recovery, too-early pending check, pending-to-accepted/unknown check, malformed reconciliation evidence, unknown-to-accepted/failed-hold, failed-hold-to-accepted, release delay/timer reset, explicit release then brand-new-key send, accepted mark recovery after the last eligible track was routed away with zero provider call, one flag/event/provider call, and no direct message/detail/event update. Ordinary unit tests mock fetch and never contact SOLAPI.

- [ ] **Step 4: Wire the Task 3 admission-batch advance mutation**

Use the Task 3 RPC:

```sql
public.advance_registration_admission_batch(
  p_batch_id uuid,
  p_action text,
  p_request_key text
) returns jsonb
```

The wrapper accepts only `invoice_sent` or `payment_confirmed`. Tests execute the exact `draft -> invoiced -> paid` sequence, assert invoice requires every non-canceled batch enrollment to have `makeedu_registered = true`, payment requires locked status `invoiced` plus invoice time, and completed/canceled/out-of-order actions reject. Same-key replay returns the original response. A second admin with a different key replaying the already-committed same action receives the canonical no-op state with the original `invoiceSentAt`/`paymentConfirmedAt` and no second event; timestamps can never be restamped. Compatibility booleans update from the authoritative batch. Batch completion remains a separate RPC because it performs roster writes.

- [ ] **Step 5: Implement row-draft and validation helpers**

```js
export function createRegistrationEnrollmentDraft({ id = null, clientKey, sortOrder = 0, ...initial } = {}) {
  return {
    id: id || null,
    clientKey: clientKey || id || crypto.randomUUID(),
    classId: "",
    textbookId: "",
    textbookExplicitlyCleared: false,
    classStartDate: "",
    classStartSessionKey: "",
    classStartSession: "",
    status: "planned",
    makeeduRegistered: false,
    sortOrder,
    ...initial,
  }
}

export function applyRegistrationEnrollmentClassSelection(row, input = {}) {
  const linked = input.classItem?.textbookIds || []
  const available = new Set(input.availableTextbookIds || [])
  return {
    ...row,
    classId: input.classItem?.id || "",
    textbookId: linked.find((id) => available.has(id)) || "",
    textbookExplicitlyCleared: false,
    classStartDate: "",
    classStartSessionKey: "",
    classStartSession: "",
  }
}
```

`serializeRegistrationEnrollmentRows` strips `clientKey` and includes `id` only when it is a non-null persisted UUID. New rows are therefore inserts, never fake updates. `mergeSavedRegistrationEnrollmentRows` replaces each submitted row with the authoritative RPC result while preserving its local `clientKey` by returned sort order/class association. Unknown network outcomes retain the same normalized payload and request key; retry returns the receipt's same persisted IDs and then performs the same merge. `getRegistrationEnrollmentBlockers` returns `{ rowId: clientKey, field, message }` entries for missing class, duplicate current class, mismatched subject, invalid class, missing/invalid schedule during admission processing, and invalid non-empty textbook. The exact duplicate set is rows with `status = 'planned' OR rosterActive = true`; a released historical enrolled row (`status = 'enrolled', rosterActive = false`) does not block re-enrollment in the same class. Empty textbook is valid.

- [ ] **Step 6: Build the repeated desktop/mobile row editor**

```tsx
<section className="grid gap-3" aria-label={`${track.subject} 수강 수업`}>
  {draftRows.map((row, index) => (
    <RegistrationEnrollmentRow
      key={row.clientKey}
      row={row}
      subject={track.subject}
      classOptions={subjectClasses}
      classDetail={classDetailById[row.classId] || null}
      loadingClassDetail={loadingClassIds.has(row.classId)}
      onChange={(patch) => updateRow(row.clientKey, patch)}
      onRemoveLocal={() => removeLocalRow(row.clientKey)}
      onCancelPersisted={() => openCancelEnrollment(row.id)}
      canRemoveLocal={row.id === null}
      canCancelPersisted={row.id !== null && (row.status === "planned" || (row.status === "enrolled" && row.rosterActive)) && !trackHasOpenBatch}
      desktopIndex={index}
    />
  ))}
  <Button type="button" variant="outline" onClick={addRow}>
    <Plus className="size-4" aria-hidden="true" />
    수업 추가
  </Button>
</section>
```

Filter class options by normalized track subject. Selecting a class calls `loadOpsRegistrationClassDetail` for that exact ID and stores detail in a map so multiple rows can load concurrently without overwriting each other. The schedule selector uses only active/normal/makeup sessions and saves the canonical `${dateKey}:${sessionNumber}` key alongside its derived date/label. The textbook default and explicit clear flag are stored per row.

Desktop uses a compact repeated grid. Mobile uses one bordered vertical card per row. An unsaved row (`id === null`) exposes only immediate local removal. A persisted unbatched `planned` row or roster-active `enrolled` row exposes `수강 취소`; released enrolled rows and canceled rows render immutable history with their withdrawal/transfer source and no cancellation control. Confirmation requires a reason, and “last enrolled row” counts only roster-active enrolled rows; released history never keeps a track falsely active or blocks a new row for that class. If any open batch contains a row for that track, every persisted row-cancel action is disabled with `진행 중인 입학 처리를 먼저 완료하거나 취소하세요`; the RPC repeats the check under lock. Waitlisted rows expose only track-level waiting change/exit actions, never a row-only cancel. Enrollment-decided tracks also show `대기로 전환` and `미등록 완료` via `routeRegistrationEnrollmentDecision` before a batch starts.

- [ ] **Step 7: Save drafts and start a revision-safe admission batch**

On `수업 정보 저장`, validate only that subject's rows, serialize nullable IDs, and call `saveRegistrationEnrollmentRows` with one stable logical-submission key. Replace/remap local rows from the authoritative response before clearing that key; an unknown failure retries the same payload/key and receives the same inserted IDs. Batch creation is not owned by this selected-track editor. The case-level admission panel groups every persisted unbatched planned row by subject and lets the operator explicitly select one or more eligible tracks/rows; unsaved `id === null` rows cannot enter a batch. On `입학 처리 시작`, require the one-time admission application and call `startRegistrationAdmissionBatch` with the selected track IDs and exact selected enrollment IDs. This permits English and mathematics, or multiple classes under either subject, to enter one real billing batch together while never absorbing an unselected draft.

If the track was already registered, saving a new unbatched planned row does not reopen the track or parent. `startRegistrationAdmissionBatch` atomically creates the new revision, attaches only those new rows, moves the registered track to enrollment processing, and reopens the parent through the child-aware guard. Completed batch financial fields and enrolled row identity/class/schedule/textbook/batch fields remain immutable history. The sole enrolled-row mutation allowed later is an explicit audited cancellation (`status -> canceled`) or cross-workflow live-ownership release (`rosterActive -> false` plus release metadata); neither rewrites the completed batch or admission outcome.

- [ ] **Step 8: Render and enforce one case-level current-batch checklist**

Mount `RegistrationAdmissionPanel` through Task 6's `caseLevelActions` slot whenever any track is `enrollment_decided`, `enrollment_processing`, or `registered`, whenever any admission-batch history exists, **or whenever a current active admission message/admission-message event exists**. The condition depends on the full case, not the selected track, so routing the last enrollment-decided track to waiting/not-registered cannot hide pending/unknown/failed-hold reconciliation or accepted mark recovery. With no open batch it shows unbatched planned rows grouped by subject; selection/start controls render only for admin/staff `permissions.canManage`. With an open batch it derives `currentBatchEnrollments` from every row whose `admissionBatchId` matches that batch, labels each row with subject and class, and renders the exact order. Read-only viewers see status/history but no mutation controls. Tests route the last eligible track away while each message state is active and require the panel to remain mounted:

1. `입학신청서 발송` — parent-level and retained across revisions.
2. One `메이크에듀 등록 · {subject} · {class}` control per active batch enrollment, calling `setRegistrationEnrollmentMakeedu` with a stable key.
3. `청구서 발송` — calls `advanceRegistrationAdmissionBatch({ batchId, action: "invoice_sent", requestKey: submissionKeys.getOrCreate("batch-invoice", batchId) })` only after every MakeEdu row.
4. `수납 완료 확인` — calls `advanceRegistrationAdmissionBatch({ batchId, action: "payment_confirmed", requestKey: submissionKeys.getOrCreate("batch-payment", batchId) })` only after invoice.
5. `등록 완료` — calls `completeRegistrationAdmissionBatch({ batchId, requestKey: submissionKeys.getOrCreate("batch-complete", batchId) })` only after payment.

Completed revisions appear in a collapsed `이전 입학 처리` history. No parent boolean can make a later revision appear paid. Switching the subject tab changes only the subject-scoped class-row editor; the shared panel, mixed-track checklist, and open-batch controls remain mounted and complete.

An open draft/invoiced batch also shows `입학 처리 취소` with one required cancellation reason. For each participating track, the panel derives whether an older enrolled row survives outside the current batch. Such add-class tracks show the fixed result `기존 등록 유지` and no destination control. Only first-admission tracks show an independent waiting/not-registered destination; each current-class waiting resolution additionally requires a same-subject class. It sends the top-level reason plus resolutions for exactly those first-admission tracks to `cancelRegistrationAdmissionBatch`. Mixed batches can therefore restore one registered subject while routing the other independently. Paid batches do not expose this action. Every action disables on first submit, reuses its request key on unknown failure, and reloads the unified case after confirmed success.

- [ ] **Step 9: Preserve selected-class-only hydration and cache isolation**

Extend loading tests so three draft rows with two unique class IDs make exactly two exact-ID detail requests. Verify the summary loader still excludes `schedule_plan` and that stale detail for row A cannot populate row B after rapid class switching.

- [ ] **Step 10: Run enrollment, service, and type checks**

Run:

```bash
node --test tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-service-loading.test.mjs tests/registration-service-hardening.test.mjs
pnpm exec tsc --noEmit
pnpm exec eslint src/features/tasks/registration-enrollment-editor.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-track-service.ts
```

Expected: repeated-row, revision, exact-ID loading, service, type, and lint checks pass.

### Task 10: Per-track director defaults, detail history, and compatibility projections

**Files:**
- Modify: `src/features/tasks/registration-director-default.js`
- Modify: `src/features/tasks/registration-director-default.d.ts`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `tests/registration-director-default.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-service-hardening.test.mjs`

**Interfaces:**
- Produces `resolveRegistrationTrackDirectorDefaults({ tracks, grade, inquiryAt, teachers, profiles, catalogStatus })` returning one resolution, canonical rule key, `shouldAssign`, and `shouldClear` per track ID. `catalogStatus` is `authoritative`, `loading`, `partial`, or `error`; missing/fallback option data is never treated as proof that a durable default disappeared.
- Produces `assignRegistrationTrackDirector({ trackId, directorProfileId: string | null, assignmentSource: "default" | "manual" | "clear_default", ruleKey: string | null, expectedCommonRevision: number, requestKey })` backed by `assign_registration_track_director`, used for defaults, stale-default clearing, and manual overrides.
- Produces subject-track detail history for appointments, attempts, consultations, enrollments, and admission batches.
- Consumes deterministic compatibility projections written by Task 3; never treats them as authoritative when child rows exist.

- [ ] **Step 1: Write failing dual-director and detail-history tests**

```js
test("English and Math resolve directors independently instead of becoming ambiguous", () => {
  const result = resolveRegistrationTrackDirectorDefaults({
    tracks: [
      { id: "eng", subject: "영어", directorProfileId: "" },
      { id: "math", subject: "수학", directorProfileId: "" },
    ],
    grade: "고1",
    inquiryAt: "2026-07-12T10:00:00+09:00",
    teachers: teacherFixtures,
    profiles: profileFixtures,
  })
  assert.equal(result.eng.counselor, "강부희")
  assert.equal(result.math.counselor, "양소윤")
  assert.equal(result.eng.status, "resolved")
  assert.equal(result.math.status, "resolved")
  assert.match(result.eng.ruleKey, /^academic-director-v1:/)
})

test("default assignments re-resolve after rule inputs change but manual overrides survive", () => {
  const defaultTrack = { id: "eng", subject: "영어", directorProfileId: "old", directorAssignmentSource: "default", directorAssignmentRuleKey: "academic-director-v1:2026:영어:초4" }
  const manualTrack = { ...defaultTrack, id: "manual", directorProfileId: "manual-director", directorAssignmentSource: "manual", directorAssignmentRuleKey: "" }
  const result = resolveRegistrationTrackDirectorDefaults({
    tracks: [defaultTrack, manualTrack],
    grade: "초5",
    inquiryAt: "2027-07-12T10:00:00+09:00",
    teachers: teacherFixtures,
    profiles: profileFixtures,
  })
  assert.equal(result.eng.shouldAssign, true)
  assert.equal(result.manual.shouldAssign, false)
  assert.equal(result.manual.profileId, "manual-director")
})

test("a persisted default clears when the changed grade has no supported rule", () => {
  const result = resolveRegistrationTrackDirectorDefaults({
    tracks: [{ id: "eng", subject: "영어", directorProfileId: "old", directorAssignmentSource: "default", directorAssignmentRuleKey: "academic-director-v1:2026:영어:초4" }],
    grade: "초2",
    inquiryAt: "2026-07-12T10:00:00+09:00",
    teachers: teacherFixtures,
    profiles: profileFixtures,
  })
  assert.equal(result.eng.shouldAssign, false)
  assert.equal(result.eng.shouldClear, true)
  assert.equal(result.eng.profileId, "")
})

test("a persisted default clears when its newly resolved profile is unavailable", () => {
  const result = resolveRegistrationTrackDirectorDefaults({
    tracks: [{ id: "eng", subject: "영어", directorProfileId: "old", directorAssignmentSource: "default", directorAssignmentRuleKey: "academic-director-v1:2026:영어:초4" }],
    grade: "초5",
    inquiryAt: "2027-07-12T10:00:00+09:00",
    teachers: [],
    profiles: profileFixtures,
    catalogStatus: "authoritative",
  })
  assert.equal(result.eng.shouldAssign, false)
  assert.equal(result.eng.shouldClear, true)
})

test("transient or partial option hydration never clears a durable default", () => {
  const result = resolveRegistrationTrackDirectorDefaults({
    tracks: [{ id: "eng", subject: "영어", directorProfileId: "old", directorAssignmentSource: "default", directorAssignmentRuleKey: "academic-director-v1:2026:영어:초4" }],
    grade: "초5",
    inquiryAt: "2027-07-12T10:00:00+09:00",
    teachers: [],
    profiles: [],
    catalogStatus: "error",
  })
  assert.equal(result.eng.shouldAssign, false)
  assert.equal(result.eng.shouldClear, false)
})

test("terminal tracks preserve historical ownership across grade and year edits", () => {
  const result = resolveRegistrationTrackDirectorDefaults({
    tracks: [{ id: "eng", subject: "영어", status: "registered", directorProfileId: "old", directorAssignmentSource: "default", directorAssignmentRuleKey: "academic-director-v1:2026:영어:초4" }],
    grade: "초2",
    inquiryAt: "2027-07-12T10:00:00+09:00",
    teachers: teacherFixtures,
    profiles: profileFixtures,
    catalogStatus: "authoritative",
  })
  assert.equal(result.eng.status, "terminal_preserved")
  assert.equal(result.eng.shouldAssign, false)
  assert.equal(result.eng.shouldClear, false)
})

test("migration-review tracks never receive an automatic director default", () => {
  const result = resolveRegistrationTrackDirectorDefaults({
    tracks: [{ id: "review", subject: "영어", directorProfileId: "", directorAssignmentSource: "", migrationReviewRequired: true }],
    grade: "고1",
    inquiryAt: "2026-07-12T10:00:00+09:00",
    teachers: teacherFixtures,
    profiles: profileFixtures,
  })
  assert.equal(result.review.status, "review_required")
  assert.equal(result.review.shouldAssign, false)
})

test("director RPC wrapper types the atomic clear-default command", async () => {
  const service = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  assert.match(service, /directorProfileId:\s*string\s*\|\s*null/)
  assert.match(service, /assignmentSource:\s*"default"\s*\|\s*"manual"\s*\|\s*"clear_default"/)
  assert.match(service, /p_director_profile_id/)
  assert.match(service, /p_assignment_source/)
  assert.match(service, /p_expected_common_revision/)
})

test("detail panel labels every history row with its subject", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /과목별 진행 이력/)
  assert.match(source, /trackById\.get\(.*trackId.*\)\?\.subject/)
  assert.match(source, /이전 입학 처리/)
})

test("new child rows take precedence over legacy parent fields", async () => {
  const source = await readFile(new URL("../src/features/tasks/ops-task-service.ts", import.meta.url), "utf8")
  assert.match(source, /registrationTracks\.length > 0/)
  assert.match(source, /buildLegacyRegistrationTrackSummaries/)
})
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test tests/registration-director-default.test.mjs tests/registration-track-workspace.test.mjs tests/registration-service-hardening.test.mjs`

Expected: FAIL because per-track default resolution and history rendering are missing.

- [ ] **Step 3: Resolve and persist director defaults per subject track**

```js
export function resolveRegistrationTrackDirectorDefaults(input = {}) {
  return Object.fromEntries((input.tracks || []).map((track) => {
    if (["registered", "not_registered", "inquiry_closed"].includes(track.status)) {
      return [track.id, { profileId: track.directorProfileId, status: "terminal_preserved", ruleKey: track.directorAssignmentRuleKey || null, shouldAssign: false, shouldClear: false }]
    }
    if (["manual", "migration"].includes(track.directorAssignmentSource)) {
      return [track.id, { profileId: track.directorProfileId, status: "preserved", ruleKey: null, shouldAssign: false, shouldClear: false }]
    }
    if (track.migrationReviewRequired) {
      return [track.id, { profileId: "", status: "review_required", ruleKey: null, shouldAssign: false, shouldClear: false }]
    }
    const resolved = resolveRegistrationDirectorDefault({
      subjects: [track.subject],
      grade: input.grade,
      inquiryAt: input.inquiryAt,
      teachers: input.teachers,
      profiles: input.profiles,
    })
    const ruleKey = buildRegistrationDirectorRuleKey({ subject: track.subject, grade: input.grade, inquiryAt: input.inquiryAt })
    const shouldClear = track.directorAssignmentSource === "default"
      && (resolved.status === "unsupported"
        || (resolved.status === "unavailable" && input.catalogStatus === "authoritative"))
      && Boolean(track.directorProfileId || track.directorAssignmentRuleKey)
    return [track.id, {
      ...resolved,
      profileId: resolved.status === "resolved" ? resolved.profileId : "",
      ruleKey: resolved.status === "resolved" ? ruleKey : null,
      shouldAssign: resolved.status === "resolved"
        && (track.directorProfileId !== resolved.profileId || track.directorAssignmentRuleKey !== ruleKey),
      shouldClear,
    }]
  }))
}
```

`buildRegistrationDirectorRuleKey` returns `academic-director-v1:{inquiryYear}:{subject}:{normalizedGrade}`. On create/load and after a successful common-info edit, only admin/staff with `permissions.canManage` apply each nonterminal `shouldAssign` default with `assignmentSource: "default"`, its rule key, and the currently loaded/returned `detail.commonRevision`; they apply each nonterminal `shouldClear` result with `directorProfileId: null`, `assignmentSource: "clear_default"`, `ruleKey: null`, and that same revision. A read-only viewer never invokes the mutation on load; they see the durable owner or `담당자 지정 필요` state only. Manual choices also pass the detail revision. A deterministically unsupported subject/grade rule may clear immediately. A profile/catalog `unavailable` result may clear only when the profiles/teachers option snapshot completed successfully and is marked `authoritative`; `loading`, request failure, or a partial fallback returns `shouldClear = false`, keeps the durable default, and shows a retry warning. Skip every terminal or `migrationReviewRequired` track. A stale common revision reloads the case and re-runs resolution; it is never blindly retried with the old rule/profile. A failed non-conflict post-edit default refresh/clear is retryable and leaves the durable old default/source visible with an explicit warning; the next authoritative management load retries. Persist every manual choice—including the review editor's per-track selector—with `assignmentSource: "manual"` and `ruleKey: null`; the wrapper normalizes legacy `""` to SQL null or rejects it, and a test requires `p_rule_key: null`. Never update the table directly, and never auto-overwrite or clear `manual` or `migration` sources. English/math no longer share a single ambiguous resolver call. A successful active-phone reassignment refreshes the new director's internal queue notification; clearing removes the stale director notification and raises the management assignment-required state; a visit-reassignment error focuses the reservation controls. The legacy parent director projection is written only by the database compatibility function. Tests open the same case as admin, staff, assistant, and ordinary participant and require automatic persist calls only for the first two.

The workspace passes `loadOpsRegistrationWorkspaceOptionData().directorCatalogStatus` directly as `catalogStatus`; before that promise settles it passes `loading`. A fallback that lacks `teacher_catalogs.profile_id` is always `partial`, never authoritative. Source/service tests assert this wiring so an empty fallback catalog cannot clear a valid default.

- [ ] **Step 4: Render subject-labeled operational history**

In `RegistrationTrackEditor`, render a single chronological history combining:

- Appointment created/rescheduled/canceled.
- Level-test subject result or absence.
- Phone/visit consultation completion and outcome.
- Waiting-kind and retake decision.
- Enrollment row add/cancel/complete.
- Admission-batch invoice/payment/completion.

Every child row derives its subject via `trackId` and shows a subject badge. Shared appointment headers show every participating subject once; their individual results remain separate rows.
Parse version-1 registration transition events into actor, subject, source, destination, reason, metadata, and server time. Preserve and display prior waiting kind, retake decision, class, appointment, and batch identifiers from metadata rather than reading the track's current overwritten fields. Unknown versions and every task-scoped pre-migration event render as plain legacy history without crashing. Add a fixture with legacy `status_changed` and `updated` rows and assert both remain visible beside parsed version-1 subject events.

- [ ] **Step 5: Make child rows authoritative with explicit legacy fallback**

The read rule is exact:

```ts
const registrationTracks = mappedTrackRows.length > 0
  ? mappedTrackRows
  : buildLegacyRegistrationTrackSummaries(task, registration)
```

When `mappedTrackRows.length > 0`, list filters, tab counts, director labels, status, actions, classes, textbooks, and schedules use child rows only. Parent fields remain visible only in the compatibility/history section or migration-review panel.

- [ ] **Step 6: Verify existing single-subject and mixed-subject scenarios**

Add fixtures for:

- Legacy single-subject inquiry with no child rows.
- New single-subject case with one track and two classes.
- New English/math case with two directors and two different stages.
- Progressed legacy English/math case in migration review.
- Registered English batch 1 plus waiting mathematics.
- Mathematics batch 2 added after English completion.

Run:

```bash
node --test tests/registration-director-default.test.mjs tests/registration-track-workspace.test.mjs tests/registration-service-hardening.test.mjs tests/ops-task-workspace.test.mjs
pnpm exec tsc --noEmit
```

Expected: all fixtures pass without changing existing withdrawal, transfer, word-retest, or makeup director behavior.

### Task 11: Verification scripts, pending database packet, build, and real browser QA

**Files:**
- Create: `src/features/tasks/registration-track-fixtures.ts`
- Create: `tests/registration-track-fixtures.test.mjs`
- Modify: `scripts/verify-ops-task-sample-workflow.mjs`
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
- Verify: `scripts/verify-registration-subject-track-concurrency.mjs`
- Modify: `.superpowers/sdd/progress.md`
- Test: all focused and full test files under `tests/`

**Interfaces:**
- Consumes every completed task.
- Produces a reproducible local verification record without remote DB mutation or real external messages.
- Leaves the local development server running on `http://127.0.0.1:3000`.

- [ ] **Step 1: Add a production-inaccessible in-memory browser fixture harness**

`registration-track-fixtures.ts` exports the approved dual-subject cases plus a pure reducer for every UI mutation used in QA. In `ops-task-workspace.tsx`, activate it only when `process.env.NODE_ENV !== "production"` and the exact query is `fixture=registration-subject-tracks`. In fixture mode, reads and writes stay in component memory; Supabase clients, message routes, notification routes, payment actions, and webhooks are never called. In production builds, the query parameter is ignored and normal data loading is used. Tests assert the production gate, deterministic reset on reload, stable IDs, and zero external-call paths.

- [ ] **Step 2: Add deterministic in-memory verification fixtures**

Add sample cases for:

```js
const subjectTrackSamples = [
  {
    name: "same-day dual level test",
    tracks: [track("영어", "level_test_scheduled"), track("수학", "level_test_scheduled")],
    appointments: [sharedLevelTestAppointment(["영어", "수학"])],
  },
  {
    name: "split visit and phone consultation",
    tracks: [track("영어", "visit_consultation_scheduled"), track("수학", "consultation_waiting")],
  },
  {
    name: "partial registration with later batch",
    tracks: [track("영어", "registered"), track("수학", "enrollment_processing")],
    batches: [completedBatch(1, ["영어"]), openBatch(2, ["수학"])],
  },
  {
    name: "multiple English classes",
    tracks: [track("영어", "enrollment_processing")],
    enrollments: [enrollment("영어", "eng-a"), enrollment("영어", "eng-special")],
  },
]
```

The sample script asserts status/tab mapping, independent subject transitions, fresh batch revisions, and two enrollment rows. It must not call Supabase or external endpoints unless the existing explicit `--run` flag is supplied, and the new subject-track scenarios remain in-memory even with that flag.

Refactor the pre-existing authorized database-backed lanes in both verification scripts before the ready-mode roster guards are installed. In `verify-ops-task-browser-workflow.mjs` and `verify-ops-task-sample-workflow.mjs`, seed students/classes with SQL-null or canonical empty roster arrays only. Establish every enrolled/waitlist/removed relationship through `set_student_class_roster_mode` using an independently authenticated admin/staff client, with the exact expected mode and committed response; never use the setup-only service client for a business mutation. Remove every direct insert/update/delete of `student_class_enrollment_history` and every whole-array roster write. Cleanup first calls the same RPC to reach `removed` in deterministic student/class order and verifies all four projections; because audit-bearing fixture entities are intentionally protected from physical deletion, ready-mode DB-backed runs are allowed only on disposable local/preview databases and end by archiving their namespaced entities plus printing the required local reset/preview cleanup instruction. The new registration subject scenarios themselves remain in-memory and leave no database rows.

Add source assertions over both scripts that fail on nonempty roster seed arrays, direct `student_class_enrollment_history` DML, ready-mode `.update({ class_ids|waitlist_class_ids|student_ids|waitlist_ids ... })`, or a roster RPC invoked with a service-role client. Their dry runs remain network-free. Update prior `leftover = 0` assertions to distinguish active fixture data (must be zero) from intentionally retained namespaced audit history on disposable databases.

- [ ] **Step 3: Extend browser verification assertions without submitting real data**

The browser script must assert:

- Track tabs and counts render from subject-track items.
- A dual-subject case exposes both subject controls.
- Phone consultation shows `전화상담 대기` and no reservation field.
- Visit appointment can select one or both subjects.
- Enrollment shows `수업 추가` and preserves two draft rows.
- Each row owns its own textbook clear and schedule control.
- Current batch checklist order is admission application, per-row MakeEdu, invoice, payment, completion.
- Case-level admission panel stays visible when switching to a non-enrollment sibling track.
- Assigned-admin director, sibling-admin director, staff, and assistant fixture roles expose only their permitted actions.
- A migration-review consultation target stays blocked until that subject's manual director is saved.
- Mobile layout at 430×932 has no page-level horizontal overflow.

The script opens `http://127.0.0.1:3000/admin/registration?fixture=registration-subject-tracks`, may execute fixture-only actions, then reloads to reset. It never invokes a real completion RPC, webhook, customer message, payment, or remote migration operation.

- [ ] **Step 4: Run the complete focused test union**

Run:

```bash
node --test \
  tests/registration-track-model.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-track-fixtures.test.mjs \
  tests/registration-admission-message-route.test.mjs \
  tests/registration-workflow.test.mjs \
  tests/registration-director-default.test.mjs \
  tests/registration-consultation-notification.test.mjs \
  tests/registration-service-hardening.test.mjs \
  tests/registration-runtime-probe.test.mjs \
  tests/management-class-student-roster.test.mjs \
  tests/ops-task-service-loading.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/date-time-picker.test.mjs
```

Expected: every focused test passes.

- [ ] **Step 5: Finalize the unapplied database verification packet**

Run:

```bash
node --test tests/registration-track-schema.test.mjs
node scripts/verify-registration-subject-track-concurrency.mjs
git diff --check -- supabase/migrations supabase/tests scripts/verify-registration-subject-track-concurrency.mjs
```

Expected: the migration/function/RLS/grant/backfill source contract passes, the concurrency script's dry run is network-free, and diff check emits no output. In `.superpowers/sdd/progress.md`, list the two generated migration filenames, both prepared pgTAP files and their 12 + 150 planned assertions, the gated concurrency script, the missing local database runtime, and the exact future commands `pnpm dlx supabase@2.109.1 test db` plus the script's authorized preview/local `--run` invocation with distinct assigned-admin `--admin-token` and sibling-admin `--second-admin-token`. Do not apply either migration to the production project.

- [ ] **Step 6: Run static checks and production build**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec eslint \
  src/features/tasks/registration-track-model.js \
  src/features/tasks/registration-track-service.ts \
  src/features/tasks/registration-runtime-probe.ts \
  src/features/tasks/registration-track-list.tsx \
  src/features/tasks/registration-track-editor.tsx \
  src/features/tasks/registration-appointment-editor.tsx \
  src/features/tasks/registration-enrollment-editor.tsx \
  src/features/tasks/registration-track-fixtures.ts \
  src/features/tasks/ops-task-service.ts \
  src/features/tasks/ops-task-workspace.tsx \
  src/features/management/management-service.js \
  src/features/tasks/registration-consultation-notification.js \
  src/app/api/registration/consultation-notification/route.ts \
  src/app/api/solapi/registration/route.ts \
  scripts/verify-registration-subject-track-concurrency.mjs \
  tests/registration-track-*.test.mjs \
  tests/registration-runtime-probe.test.mjs \
  tests/management-class-student-roster.test.mjs
pnpm run build
git diff --check
```

Expected: TypeScript, targeted ESLint, build, and diff check exit 0. A Babel large-file informational note for the existing workspace is acceptable; new warnings are not.

If macOS rejects the bundled native SWC/lightningcss module solely because the bundled Node binary is signed, reproduce the known ad-hoc signed runtime outside the workspace and rerun the same build:

```bash
cp "$(command -v node)" /tmp/tips-node-unsigned
codesign --remove-signature /tmp/tips-node-unsigned
codesign --force --sign - /tmp/tips-node-unsigned
mkdir -p /tmp/tips-node-bin
ln -sf /tmp/tips-node-unsigned /tmp/tips-node-bin/node
PATH="/tmp/tips-node-bin:$PATH" pnpm run build
```

- [ ] **Step 7: Run the full suite and compare only against the measured Task 0 baseline**

Run: `node --test tests/*.test.mjs`

Expected: every new registration test passes. A failure is tolerated only when its exact test name and error were recorded in Task 0 and remain byte-for-byte equivalent; any new or changed failure is a regression and must be fixed before browser QA.

- [ ] **Step 8: Start or reuse the local server and verify liveness**

Run:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/admin/registration
```

Expected: one listener and HTTP 200. If no listener exists, run `pnpm dev`, wait for `Ready`, and repeat the curl. Keep the server process alive after verification.

- [ ] **Step 9: Perform desktop and mobile browser QA on the exact route**

Before browser automation, read and use the `browser:control-in-app-browser` skill. Verify `http://127.0.0.1:3000/admin/registration?fixture=registration-subject-tracks` at 1357×987 and 430×932. Separately open the normal route to confirm its real list/fallback still loads, but make no mutations.

Desktop scenarios:

1. English consultation and mathematics level test from one parent appear in different tabs and open the same case with the correct subject focused.
2. One level-test appointment selects both subjects and shows separate result URL rows.
3. One visit selects both subjects; another draft selects only English while mathematics remains phone waiting.
4. Phone waiting has no date/time field and exposes subject-scoped completion/result action.
5. The assigned English admin director can complete only the English consultation while retaining ordinary admin management actions. A sibling mathematics admin retains ordinary management actions but cannot complete English; staff cannot complete either director-owned consultation. Assistant/task-participant fixtures are read-only.
6. Enrollment adds two classes under one subject without resetting the first row.
7. The case-level admission panel stays visible when selecting a sibling inquiry/test track, and mixed-subject current-batch rows remain complete.
8. Each class loads only its exact schedule and textbook default; clearing one textbook does not clear another.
9. A later subject shows a new admission batch rather than inherited invoice/payment checks.
10. Migration-review fixture skips automatic director defaults, blocks consultation targets until a manual per-subject director is saved, then allows explicit attribution.
11. Visit edit/cancel/replacement produces revision-scoped mocked notification targets without any real webhook.

Mobile scenarios:

- Subject controls remain reachable without page overflow.
- Shared appointment participation and result rows stack clearly.
- Enrollment rows render as separate cards with a visible `수업 추가` button.
- The icon-only close button remains at the top right.
- No clipped date/time, dropdown, or action controls.

Do not submit production-like mutations. Use unsaved drafts or the local fixture path and discard changes afterward. Check the browser console for errors.

- [ ] **Step 10: Quantify loading and record the final verification**

Record in `.superpowers/sdd/progress.md`:

- Five-run medians for `registration:parent-list`, `registration:option-summary`, `registration:track-summary`, `registration:case-detail`, and both `registration:class-detail:{classId}` measures.
- Before/after Task 0 comparison and per-loader query counts/cache hits.
- Exact class-detail request count for two enrollment rows.
- Focused test totals, prepared-but-not-run pgTAP assertion count, full-suite totals, typecheck/lint/build results.
- Desktop/mobile scenarios completed.
- Confirmation that no remote migration, external Google Chat, customer message, commit, push, or deployment occurred.

Expected: the list settles before detail hydration, option summaries issue four concurrent reads with no students request, no list/option request contains class schedules, and one unique selected class produces one cached exact-ID detail read. Warm normal-route and parent-list medians are no more than 20% slower than Task 0 and initial render is at most 1.5 seconds. Option summary and track summary are each at most 750 ms, selected-case detail at most 1 second, and each uncached exact-class detail at most 500 ms when measured against a real preview/local database; because that runtime is unavailable here, mark those DB-backed thresholds pending rather than substituting fixture timings. Fixture timings prove render-path behavior only.

---

## Execution Completion Criteria

- One parent case supports independent English and mathematics stage movement.
- Shared level-test and visit appointments preserve subject-specific results/outcomes.
- Phone consultation is an oldest-first work queue with server-stamped completion, not a reservation form.
- Each subject can save and complete multiple class enrollment rows.
- Later subjects/classes receive a new admission batch and cannot inherit old invoice/payment state.
- Roster projection across multiple classes is transactional and idempotent.
- New-table SQL grants authenticated read access only, enables RLS, blocks direct browser DML, and adds exact indexes; runtime database application remains a separately authorized verification step because no safe local database runtime is available.
- Legacy single-subject rows remain usable; ambiguous progressed multi-subject rows require explicit attribution.
- Registration list loading remains narrow, registration option summaries omit students and run in parallel, and selected-class schedule hydration remains exact-ID-only.
- Focused tests, migration source contracts, TypeScript, targeted ESLint, build, and dev-fixture browser QA meet the expected results above; pgTAP and real DB-backed transaction/performance proof are prepared and clearly reported as pending runtime execution.
- No remote migration, real notification, deployment, or Git-history mutation occurs.
