# Registration Intake Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one registration inquiry choose an independent first action for English and mathematics, create any shared level-test or visit appointment atomically, expose the real phone-consultation queue timestamp, and eliminate the empty-campus save failure.

**Architecture:** Keep `ops_tasks` plus `ops_registration_details` as the shared case and the existing subject-track tables as canonical workflow state. A separate intake capability gates a new idempotent RPC that materializes the case, tracks, directors, shared appointments, level-test attempts, and consultations in one PostgreSQL transaction. Client-only draft helpers control progressive disclosure; canonical server rows, not collapsed UI state or legacy date fields, control saved workflow state.

**Tech Stack:** Next.js 16.1.1, React 19.2.3, TypeScript 5.9.3, Supabase JS 2.103.1, PostgreSQL/RLS, Supabase CLI 2.109.1 through `pnpm dlx`, Node test runner, Tailwind CSS 4, Radix/shadcn components.

## Shell Preamble

Run this once in every new implementation shell before any `node`, `pnpm`, or `pnpm dlx` command. The bundled runtime is required because this desktop environment does not guarantee a system `node` on `PATH`.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
export PATH="$(dirname "$NODE"):$PATH"
```

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-07-13-registration-intake-routing-design.md`; preserve its subject independence, queue semantics, and compatible rollout.
- Preserve the nine existing uncommitted inquiry/time-picker changes at the start of this plan. Inspect and verify them before adding intake-routing code; never reset or overwrite them.
- One inquiry creates one parent case. English and mathematics receive separate subject tracks and may choose different initial actions.
- The add dialog supports at most one shared level-test appointment and one shared visit appointment. Membership must exactly match the subjects whose selected plans require that appointment.
- Phone consultation is an unscheduled queue. Never write `phoneConsultationAt` from the ready-mode add dialog and never render an editable phone time.
- A direct phone item becomes ready at the inquiry timestamp. A post-test phone item becomes ready at the server-recorded test completion. A visit re-entry becomes ready when the server reopens the phone queue.
- The database remains strict about `campus in ('본관', '별관')`. The new-case client defaults a missing value to `본관`; the common editor exposes an exact required selector.
- Keep `registration_subject_tracks_runtime_version()` at `1`. Add an independent `registration_intake_workflow_runtime_version() = 1` only after the complete migration contract exists.
- The database expansion must deploy safely before the client. Preserve the existing core-runtime triage: core ready plus missing intake capability uses `createRegistrationCase`, core maintenance blocks mutation, and a truly legacy core uses `createOpsTask`. Only core ready plus intake version 1 exposes the new plan and atomic RPC.
- Keep list loading narrow. Do not add appointment or consultation child queries to the registration summary request; project active phone readiness through `ops_registration_subject_track_summaries`.
- Visit notifications are post-commit. A delivery failure must not repeat the database RPC or roll back the saved reservation; retain only the notification target for explicit retry.
- Do not edit historical migrations. Add one forward-only migration and keep it inside one explicit transaction.
- Do not send customer messages or Google Chat webhooks from automated tests. Use the fixture runtime for browser verification.
- Do not create records on `tipsedu.co.kr` during verification without explicit user authorization.

## File Structure

### New files

- `src/features/tasks/registration-intake-workflow.ts` — pure draft reconciliation, participant derivation, normalization, and validation.
- `src/features/tasks/registration-initial-plan-control.tsx` — compact subject-by-subject next-action control.
- `src/features/tasks/registration-intake-runtime-probe.ts` — independently cached intake capability probe.
- `tests/registration-intake-workflow.test.mjs` — pure intake draft and payload tests.
- `tests/registration-intake-runtime-probe.test.mjs` — missing/version/error/cache probe tests.
- `supabase/migrations/20260713150000_registration_intake_workflow.sql` — phone readiness, all phone insert writers, atomic create RPC, grants, and readiness marker.
- `supabase/tests/registration_intake_workflow_test.sql` — pgTAP schema/signature/privilege packet.
- `supabase/tests/registration_intake_workflow_runtime_test.sql` — pgTAP atomicity, idempotency, subject split, and readiness packet.

### Existing files to modify

- `src/features/tasks/registration-workflow.js` — campus normalization and operator-safe persistence error mapping.
- `src/features/tasks/ops-task-workspace.tsx` — create-form draft state, capability gating, conditional panels, atomic submit, and notification retry.
- `src/features/tasks/registration-track-editor.tsx` — exact campus selector and canonical phone-ready display.
- `src/features/tasks/registration-track-service.ts` — readiness types/mappers, summary projection, capability wrapper, and atomic-create wrapper.
- `src/features/tasks/registration-track-fixture-runtime.ts` — fixture capability surface.
- `src/features/tasks/registration-track-fixtures.ts` — atomic fixture reducer and canonical readiness data.
- `src/features/tasks/registration-track-list.tsx` — phone queue ordering and displayed timestamp.
- `src/features/tasks/registration-consultation-notification.js` — reusable post-commit notification-target dispatcher.
- `scripts/verify-ops-task-browser-workflow.mjs` — repeatable fixture create and canonical reopen browser scenario.
- `scripts/verify-registration-subject-track-concurrency.mjs` — real same-actor/same-key atomic-create race proof.
- `tests/registration-workflow.test.mjs` — campus and Korean error tests.
- `tests/ops-task-workspace.test.mjs` — form order, progressive disclosure, capability fallback, and atomic submit source contract.
- `tests/registration-track-workspace.test.mjs` — common editor, list readiness, and notification retry source contract.
- `tests/registration-track-schema.test.mjs` — forward migration source contract.
- `tests/registration-track-service.test.mjs` — RPC payload, response, and readiness mapping.
- `tests/registration-track-fixtures.test.mjs` — fixture capability, atomic materialization, and idempotency.
- `tests/registration-consultation-notification.test.mjs` — post-commit batch dispatch and retry behavior.
- `docs/superpowers/specs/2026-07-12-registration-subject-tracks-and-multi-enrollment-design.md` — replace the superseded phone queue ordering sentence.
- `docs/superpowers/specs/2026-07-13-registration-intake-routing-design.md` — mark the reviewed design approved.

---

### Task 0: Verify and checkpoint the already implemented intake-field refinements

**Files:**

- Modify: `src/components/ui/date-time-picker.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-workflow.js`
- Modify: `tests/date-time-picker.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-workflow.test.mjs`

- [ ] Inspect only these existing diffs and confirm they implement: hidden automatic inquiry time, 2-column/3-row inquiry order, 09:00–21:00 appointment choices, and a non-escaping time listbox.

```bash
git diff -- \
  src/components/ui/date-time-picker.tsx \
  src/features/tasks/ops-task-workspace.tsx \
  src/features/tasks/registration-appointment-editor.tsx \
  src/features/tasks/registration-track-editor.tsx \
  src/features/tasks/registration-workflow.js \
  tests/date-time-picker.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-workflow.test.mjs
```

- [ ] Run the focused baseline before layering new behavior.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test \
  tests/date-time-picker.test.mjs \
  tests/registration-workflow.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/ops-task-workspace.test.mjs
```

Expected: `199` tests pass and `0` fail. If the count changes because a concurrent edit adds tests, require zero failures and record the new count in the execution notes.

- [ ] Check whitespace and stage only the listed files.

```bash
git diff --check
git add \
  src/components/ui/date-time-picker.tsx \
  src/features/tasks/ops-task-workspace.tsx \
  src/features/tasks/registration-appointment-editor.tsx \
  src/features/tasks/registration-track-editor.tsx \
  src/features/tasks/registration-workflow.js \
  tests/date-time-picker.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-workflow.test.mjs
git diff --cached --check
```

- [ ] Commit the verified checkpoint.

```bash
git commit -m "fix: streamline registration intake fields"
```

---

### Task 1: Build the pure subject-plan draft model

**Files:**

- Create: `src/features/tasks/registration-intake-workflow.ts`
- Create: `tests/registration-intake-workflow.test.mjs`

- [ ] Write failing tests for independent English/mathematics actions, exact shared-appointment membership, last-participant draft clearing, payload normalization, and validation blockers. Manual panel collapse is UI-only state and is tested in Task 7, not stored in this model.

The module uses `import type { RegistrationSubject } from "./registration-track-service"`; the public model contract must be:

```ts
export type RegistrationInitialAction =
  | "inquiry"
  | "level_test"
  | "direct_phone"
  | "visit"

export type RegistrationInitialWorkflowDraft = {
  subjectPlans: Partial<Record<RegistrationSubject, RegistrationInitialAction>>
  levelTestScheduledAt: string
  levelTestPlace: string
  visitScheduledAt: string
  visitPlace: string
  directorOverrides: Partial<Record<RegistrationSubject, string>>
}

export type RegistrationInitialWorkflowPayload = {
  subjectPlans: Partial<Record<RegistrationSubject, RegistrationInitialAction>>
  levelTestAppointment: {
    scheduledAt: string
    place: string
    subjects: RegistrationSubject[]
  } | null
  visitAppointment: {
    scheduledAt: string
    place: string
    subjects: RegistrationSubject[]
  } | null
  directorOverrides: Partial<Record<RegistrationSubject, string>>
}
```

The tests must exercise these named exports:

```ts
createRegistrationInitialWorkflowDraft(subjects)
reconcileRegistrationInitialWorkflowDraft(draft, subjects)
setRegistrationInitialSubjectAction(draft, subject, action)
getRegistrationInitialWorkflowParticipants(draft, action)
getRegistrationInitialPanelState(draft)
normalizeRegistrationInitialWorkflow(draft, subjects)
getRegistrationInitialWorkflowBlockers(draft, subjects, resolvedDirectorIds)
```

- [ ] Run the new test and confirm it fails because the module does not exist.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test tests/registration-intake-workflow.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `registration-intake-workflow.ts`.

- [ ] Implement the pure model between source markers so the Node test can transpile it without importing React or Supabase.

```ts
// registration-intake-workflow-model:start
const SUBJECT_ORDER: RegistrationSubject[] = ["영어", "수학"]

export function setRegistrationInitialSubjectAction(
  draft: RegistrationInitialWorkflowDraft,
  subject: RegistrationSubject,
  action: RegistrationInitialAction,
) {
  const next = {
    ...draft,
    subjectPlans: { ...draft.subjectPlans, [subject]: action },
    directorOverrides: { ...draft.directorOverrides },
  }
  if (action !== "level_test" && getRegistrationInitialWorkflowParticipants(next, "level_test").length === 0) {
    next.levelTestScheduledAt = ""
    next.levelTestPlace = ""
  }
  if (action !== "visit" && getRegistrationInitialWorkflowParticipants(next, "visit").length === 0) {
    next.visitScheduledAt = ""
    next.visitPlace = ""
  }
  return next
}
// registration-intake-workflow-model:end
```

`getRegistrationInitialPanelState` derives whether level-test or consultation content is relevant; it must not store accordion open/closed state. `normalizeRegistrationInitialWorkflow` orders subjects as English then mathematics, trims places/profile IDs, requires the plan-key set to equal the selected-subject set exactly, and computes appointment membership from `subjectPlans` instead of trusting caller-supplied arrays.

- [ ] Run the pure-model tests.

```bash
"$NODE" --test tests/registration-intake-workflow.test.mjs
```

Expected: all intake-workflow tests pass.

- [ ] Commit the model.

```bash
git add src/features/tasks/registration-intake-workflow.ts tests/registration-intake-workflow.test.mjs
git diff --cached --check
git commit -m "feat: model registration intake routing"
```

---

### Task 2: Harden campus defaults, the common editor, and operator errors

**Files:**

- Modify: `src/features/tasks/registration-workflow.js`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `tests/registration-workflow.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

- [ ] Add failing unit tests for this exact behavior:

```js
assert.equal(normalizeRegistrationCampus(""), "본관")
assert.equal(normalizeRegistrationCampus("본관"), "본관")
assert.equal(normalizeRegistrationCampus("별관"), "별관")
assert.equal(normalizeRegistrationCampus("서관"), "")
assert.equal(
  getRegistrationPersistenceErrorMessage({ message: "registration_campus_invalid" }),
  "캠퍼스 정보를 확인해 주세요.",
)
assert.equal(
  getRegistrationPersistenceErrorMessage({ message: "registration_initial_subject_plan_invalid" }),
  "과목별 다음 업무를 확인해 주세요.",
)
assert.equal(
  getRegistrationPersistenceErrorMessage({ message: "registration_initial_appointment_membership_invalid" }),
  "예약에 포함된 과목을 다시 확인해 주세요.",
)
assert.equal(
  getRegistrationPersistenceErrorMessage({ message: "registration_director_required" }),
  "상담 책임자를 지정해 주세요.",
)
```

Add source-contract assertions that the new form starts with `campus: "본관"`, the ready create payload calls `normalizeRegistrationCampus`, and `RegistrationCommonInfoSection` renders a required selector containing exactly `본관` and `별관`.

- [ ] Run the three focused test files and confirm the new assertions fail.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test \
  tests/registration-workflow.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-workspace.test.mjs
```

Expected: FAIL because the normalizer/error mapper and exact campus selector do not exist.

- [ ] Add these helpers to `registration-workflow.js` and route create errors through the mapper before the generic fallback:

```js
export function normalizeRegistrationCampus(value) {
  const campus = String(value ?? "").trim()
  if (!campus) return "본관"
  return campus === "본관" || campus === "별관" ? campus : ""
}

export function getRegistrationPersistenceErrorMessage(error, fallback = "저장하지 못했습니다.") {
  const message = String(error?.message ?? error ?? "")
  if (message.includes("registration_campus_invalid")) return "캠퍼스 정보를 확인해 주세요."
  if (message.includes("registration_initial_subject_plan_invalid")) return "과목별 다음 업무를 확인해 주세요."
  if (message.includes("registration_initial_appointment_membership_invalid")) return "예약에 포함된 과목을 다시 확인해 주세요."
  if (message.includes("registration_initial_appointment_invalid")) return "예약 일시와 장소를 확인해 주세요."
  if (message.includes("registration_director_required") || message.includes("registration_director_override_invalid")) return "상담 책임자를 지정해 주세요."
  if (message.includes("idempotency_key_reused")) return "입력 내용이 변경되었습니다. 다시 저장해 주세요."
  return fallback
}
```

- [ ] Make new registration drafts use `본관`, normalize again at submit, and keep the database strict. Do not add a campus field to the add dialog.

- [ ] In `RegistrationCommonInfoSection`, initialize missing legacy campus as `본관`, include campus in `valid`, and replace the free-text input with:

```tsx
<select
  aria-label="캠퍼스"
  value={draft.campus}
  onChange={(event) => update("campus", event.target.value)}
  disabled={!canEdit || saving}
>
  <option value="본관">본관</option>
  <option value="별관">별관</option>
</select>
```

- [ ] Run the focused tests and the current ready-create service test.

```bash
"$NODE" --test \
  tests/registration-workflow.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-track-service.test.mjs
```

Expected: all selected tests pass and no assertion permits an empty create campus.

- [ ] Commit the campus hardening.

```bash
git add \
  src/features/tasks/registration-workflow.js \
  src/features/tasks/ops-task-workspace.tsx \
  src/features/tasks/registration-track-editor.tsx \
  tests/registration-workflow.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-workspace.test.mjs
git diff --cached --check
git commit -m "fix: make registration campus explicit and safe"
```

---

### Task 3: Add canonical phone-queue readiness in one forward migration

**Files:**

- Create: `supabase/migrations/20260713150000_registration_intake_workflow.sql`
- Modify: `tests/registration-track-schema.test.mjs`
- Create: `supabase/tests/registration_intake_workflow_test.sql`

- [ ] Add a failing source-contract test that finds the new migration and asserts: explicit `begin/commit`, two readiness columns, allowed-source and mode/readiness constraints, backfill, active-phone summary projection, a partial queue index, and all seven phone insertion paths.

The seven writers and their exact sources are:

| Function | `ready_at` | `ready_source` |
| --- | --- | --- |
| `route_registration_inquiry_impl` | registration `inquiry_at` | `inquiry` |
| `assign_registration_track_director_impl` | track `stage_entered_at` | `director_resolved` |
| `save_registration_shared_appointment_impl` when a visit participant is removed | `now()` | `visit_reopened` |
| `cancel_registration_appointment_impl` for a visit | `now()` | `visit_reopened` |
| `complete_registration_level_test_attempt_impl` | returned attempt `completed_at` | `level_test_completion` |
| `resolve_registration_migration_review_impl` | recovered legacy time or `now()` | `migration` |
| `reopen_registration_track_impl` | `now()` | `track_reopened` |

- [ ] Run the schema test and confirm it fails on the absent migration.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test tests/registration-track-schema.test.mjs
```

Expected: FAIL with the new migration/source-contract assertion.

- [ ] Create the migration with one transaction. Add nullable columns first, backfill existing phone rows, then validate the coupled constraint.

```sql
begin;

alter table public.ops_registration_consultations
  add column ready_at timestamptz,
  add column ready_source text;

alter table public.ops_registration_consultations
  add constraint ops_registration_consultations_ready_source_check
  check (ready_source is null or ready_source in (
    'inquiry', 'level_test_completion', 'visit_reopened',
    'director_resolved', 'track_reopened', 'migration', 'legacy'
  )) not valid;

alter table public.ops_registration_consultations
  add constraint ops_registration_consultations_mode_readiness_check
  check (
    (mode = 'phone' and ready_at is not null and ready_source is not null)
    or (mode = 'visit' and ready_at is null and ready_source is null)
  ) not valid;
```

Backfill from canonical evidence in this order, then validate both constraints:

1. Match track events whose `metadata ->> 'consultationId'` equals the consultation ID.
2. Map `inquiry_routed` to `inquiry`, `appointment_canceled`/`appointment_subject_deselected` to `visit_reopened`, `track_reopened` to `track_reopened`, migration resolution to `migration`, and delayed director repair/assignment to `director_resolved`.
3. For a post-test track, prefer the linked level-test attempt's non-null `completed_at` with `level_test_completion`.
4. If no canonical source is recoverable, use the consultation `created_at` with `legacy`.

- [ ] Add this partial queue index and recreate `public.ops_registration_subject_track_summaries` with `security_invoker = true`:

```sql
create index ops_registration_consultations_phone_waiting_ready_idx
  on public.ops_registration_consultations(ready_at, track_id)
  where mode = 'phone' and status = 'waiting';
```

The view must expose `phone_ready_at` and `phone_ready_source` from the one active waiting phone consultation without widening the client query to consultation rows.

- [ ] Copy the current definitions of the seven private writer functions into the forward migration as `create or replace function`, adding readiness columns to every phone insert. Explicitly insert `null, null` for visit rows. Do not modify `20260712182834_registration_subject_track_mutations.sql`.

- [ ] Write `registration_intake_workflow_test.sql` as a 17-assertion packet: `begin; select plan(17);`, assertions, `select * from finish(); rollback;`. Cover both column types, both constraints, view security, both view projections, the partial index, atomic RPC signature, authenticated/public/anon function privileges, capability signature/value, and lack of public/anon table mutation privileges. The function/capability assertions become green when Task 4 completes; do not run this packet against a database between Tasks 3 and 4.

- [ ] Run the local source contract.

```bash
"$NODE" --test tests/registration-track-schema.test.mjs
```

Expected: readiness schema assertions pass. Atomic-RPC assertions are intentionally added in Task 4.

- [ ] Stop at a source-verified checkpoint. Do not apply, stage, or commit this still-incomplete migration: Task 4 must add the atomic RPC and capability marker to the same file before the migration can ever be run against a database. Record `git diff --check` output and continue immediately to Task 4 in the same working tree.

---

### Task 4: Add the atomic initial-workflow RPC and capability marker

**Files:**

- Modify: `supabase/migrations/20260713150000_registration_intake_workflow.sql`
- Modify: `tests/registration-track-schema.test.mjs`
- Create: `supabase/tests/registration_intake_workflow_runtime_test.sql`

- [ ] Add failing schema assertions for these exact functions and the 15-argument public signature:

```sql
dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
  text, text, text, text, text, text, timestamptz, text[],
  text, text, jsonb, jsonb, jsonb, jsonb, text
)

public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[],
  text, text, jsonb, jsonb, jsonb, jsonb, text
)
```

Assert the private implementation is `security definer` with `set search_path = ''`, the public wrapper is `security invoker`, public/anon execution is revoked, authenticated execution is granted, the core runtime marker remains version 1, and `registration_intake_workflow_runtime_version()` is the last created object before grants and `commit`. Also assert the advisory lock occurs before receipt lookup and the initial visit event contains every notification-revision metadata key.

- [ ] Run the schema test and confirm it fails because the functions and marker do not exist.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test tests/registration-track-schema.test.mjs
```

Expected: FAIL on the new RPC/signature/readiness-marker assertions.

- [ ] Insert the private implementation and public wrapper before the migration's final `commit`. Use one outer mutation receipt with mutation type `create_case_with_initial_workflow_v1`; include every common field, plan, appointment, and override in the fingerprint.

The private implementation must execute this order directly, using existing schema-qualified pure helpers rather than chaining public RPC wrappers:

1. Validate authenticated admin/staff access, campus, subjects, plan keys, appointment membership, appointment times/places, director overrides, and request key. Raise the stable codes `registration_initial_subject_plan_invalid`, `registration_initial_appointment_membership_invalid`, `registration_initial_appointment_invalid`, `registration_director_required`, and `registration_director_override_invalid` for their matching failures.
2. Acquire `pg_advisory_xact_lock(hashtextextended(actor_id::text || ':' || request_key, 0))` before receipt lookup. Return the stored response for an identical actor/key/fingerprint; raise `idempotency_key_reused` for a changed fingerprint.
3. Insert the parent task and registration detail.
4. Insert one track for each selected subject.
5. Resolve the server director rule for each subject; apply only active eligible explicit overrides. Require a director for `direct_phone` and `visit`.
6. Create one shared level-test appointment and one scheduled attempt per member; transition only those tracks to `level_test_scheduled`.
7. Create direct phone rows with `ready_at = p_inquiry_at` and `ready_source = 'inquiry'`; transition only those tracks to `consultation_waiting`.
8. Create one shared visit appointment and one visit consultation per member with null readiness; transition only those tracks to `visit_consultation_scheduled`.
9. Leave `inquiry` plans unchanged, write subject events, recompute the parent once, store the complete response, and return it.

Reuse the existing schema-qualified helpers `resolve_registration_default_director`, `is_active_registration_director`, `transition_registration_track_status`, `write_registration_track_event`, and `recompute_registration_parent`. Do not call public RPC wrappers from the private implementation.

For every initial visit subject, write the same canonical `visit_scheduled` event contract used by `save_registration_shared_appointment_impl`. Its metadata must include `appointmentId`, `notificationRevision: 1`, `kind: 'visit_consultation'`, `scheduledAt`, `place`, `activityId`, `activeTrackIds`, `canceledTrackIds: []`, and `changeKind: 'created'`, with the event's real task/track/version fields. The returned notification target is valid only when `/api/registration/consultation-notification` can match this event to the appointment revision.

Return this stable JSON shape:

```json
{
  "taskId": "uuid",
  "commonRevision": 1,
  "subjects": ["영어", "수학"],
  "tracks": [],
  "appointments": [],
  "notificationTargets": [
    { "appointmentId": "uuid", "notificationRevision": 1 }
  ]
}
```

- [ ] Grant the exact private implementation signature to `authenticated` because the public wrapper is invoker-security. Revoke both signatures from `public, anon`, grant the public wrapper to `authenticated`, and add `public.registration_intake_workflow_runtime_version() returns integer` returning exactly `1` only after every table/view/function/grant above exists. Keep `public.registration_subject_tracks_runtime_version()` unchanged.

- [ ] Write the pgTAP runtime packet beginning with `begin; select no_plan();` and ending with `select * from finish(); rollback;`. Add independent cases for inquiry-only, level-test-only, direct-phone-only, visit-only, English test plus mathematics phone, shared two-subject test, shared two-subject visit, membership mismatch rollback, missing director rollback, sequential identical retry, mismatched-key reuse, and an induced child failure leaving no parent. Assert the visit event metadata matches the notification API contract. Do not leave a guessed assertion count that can drift as these scenarios expand.

- [ ] Include readiness assertions for all seven server insertion sources and verify a visit cancels/replaces phone readiness only for participating subjects.

- [ ] Run the source contract and, when the local Supabase stack is available, all pgTAP packets.

```bash
"$NODE" --test tests/registration-track-schema.test.mjs
pnpm dlx supabase@2.109.1 test db
```

Expected: schema source tests pass; SQL tests prove rollback and idempotent replay without emitting external notifications.

- [ ] Commit the atomic server contract.

```bash
git add \
  supabase/migrations/20260713150000_registration_intake_workflow.sql \
  supabase/tests/registration_intake_workflow_test.sql \
  supabase/tests/registration_intake_workflow_runtime_test.sql \
  tests/registration-track-schema.test.mjs
git diff --cached --check
git commit -m "feat: create registration intake atomically"
```

---

### Task 5: Add the independent capability probe and service contract

**Files:**

- Create: `src/features/tasks/registration-intake-runtime-probe.ts`
- Create: `tests/registration-intake-runtime-probe.test.mjs`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `tests/registration-track-service.test.mjs`

- [ ] Write failing probe tests for version 1, non-1, missing `PGRST202`, missing PostgreSQL `42883`, an unrelated permission error, concurrent call deduplication, reset during an in-flight request, and cached success.

Use this independent state contract:

```ts
export type RegistrationIntakeRuntimeState = {
  available: boolean
  version: 0 | 1
}
```

- [ ] Run the probe test and confirm module-not-found failure.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test tests/registration-intake-runtime-probe.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] Implement a separate cache/in-flight/generation probe between `// registration-intake-runtime-probe-factory:start` and `// registration-intake-runtime-probe-factory:end` around `registration_intake_workflow_runtime_version`. Missing-function errors return `{ available: false, version: 0 }`; unrelated errors propagate. Do not reuse or reset the core subject-track runtime cache.

- [ ] Extend service tests first, then service types, with canonical readiness:

```ts
export type RegistrationPhoneReadySource =
  | "inquiry"
  | "level_test_completion"
  | "visit_reopened"
  | "director_resolved"
  | "track_reopened"
  | "migration"
  | "legacy"

export type OpsRegistrationConsultation = {
  // existing fields
  readyAt: string | null
  readySource: RegistrationPhoneReadySource | null
}

export type OpsRegistrationTrackSummary = {
  // existing fields
  phoneReadyAt: string | null
  phoneReadySource: RegistrationPhoneReadySource | null
}
```

Add `phone_ready_at,phone_ready_source` to `TRACK_SUMMARY_COLUMNS`, map snake/camel inputs in `mapConsultation` and `mapTrack`, and never substitute `stageEnteredAt` for a missing canonical phone value.

- [ ] Add `RegistrationCaseCreateWithInitialWorkflowInput` and `RegistrationCaseCreateWithInitialWorkflowResponse`, plus the matching service method. The RPC payload must use these exact keys:

```ts
{
  p_student_name,
  p_school_grade,
  p_school_name,
  p_parent_phone,
  p_student_phone,
  p_campus,
  p_inquiry_at,
  p_subjects,
  p_request_note,
  p_priority,
  p_subject_plans,
  p_level_test_appointment,
  p_visit_appointment,
  p_director_overrides,
  p_request_key,
}
```

Map response tracks and appointments through the existing canonical mappers. Export `probeRegistrationIntakeWorkflowRuntime`, `resetRegistrationIntakeWorkflowRuntimeProbe`, and `createRegistrationCaseWithInitialWorkflow` from the service boundary.

- [ ] Run probe and service tests.

```bash
"$NODE" --test \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-runtime-probe.test.mjs \
  tests/registration-track-service.test.mjs
```

Expected: all pass; existing subject-track runtime tests remain unchanged.

- [ ] Commit the client data contract.

```bash
git add \
  src/features/tasks/registration-intake-runtime-probe.ts \
  src/features/tasks/registration-track-service.ts \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-track-service.test.mjs
git diff --cached --check
git commit -m "feat: expose registration intake runtime"
```

---

### Task 6: Make fixtures and phone queue presentation match the canonical contract

**Files:**

- Modify: `src/features/tasks/registration-track-fixture-runtime.ts`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-track-list.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `tests/registration-track-fixtures.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

- [ ] Add failing fixture tests for a version-1 intake capability and one `createRegistrationCaseWithInitialWorkflow` reducer action that creates a parent plus independent tracks, shared appointments, direct phone readiness, and exactly one stable receipt.

Test all of these fixture invariants:

- English `level_test` plus mathematics `direct_phone` produces two different track states.
- Two level-test subjects reference one appointment and two attempts.
- Two visit subjects reference one appointment and two visit consultations.
- A replay with the same request key/payload returns the stored result and unchanged state.
- Reusing the key with different payload throws `registration_subject_track_fixture_request_key_conflict`.
- `externalCallLedger` remains empty.
- A reducer exception returns no partially mutated state.

- [ ] Add failing list tests where `stageEnteredAt` order conflicts with `phoneReadyAt`; assert the phone queue sorts by `phoneReadyAt`, then stable `key`, and displays that same time.

- [ ] Run fixture/workspace tests and confirm the new assertions fail.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test \
  tests/registration-track-fixtures.test.mjs \
  tests/registration-track-workspace.test.mjs
```

Expected: FAIL because fixture capability/create and `phoneReadyAt` ordering are absent.

- [ ] Extend `RegistrationSubjectTrackFixtureAdapter` with a synchronous `intakeWorkflowRuntimeVersion: 1` value and expose it through `loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion()`. The exported service capability wrapper returns fixture version 1 before calling Supabase.

When `?fixture=registration-subject-tracks` is active, expose the ordinary `등록 추가` action for management fixture roles. Keep production permissions unchanged and keep the action hidden for the read-only assistant fixture role.

- [ ] Implement the fixture create reducer by cloning state before mutation, validating/normalizing the payload, writing every child into the clone, storing the full response receipt only after success, and returning the clone. Reuse the same subject order and response shape as the live RPC.

- [ ] Add canonical `readyAt/readySource` to every fixture phone consultation and `phoneReadyAt/phoneReadySource` to its summary projection.

- [ ] Change `RegistrationTrackListItem` and the list helpers:

```ts
phoneReadyAt: string | null

sortRegistrationConsultationItems(items) // finite Date.parse(phoneReadyAt), invalid/missing last, then key
getRegistrationTrackTimeValue(item)      // phoneReadyAt || "" for consultation_waiting
```

For a phone row, mobile uses the label `전화상담 대기 기준`; desktop prefixes the formatted value with `전화상담 대기 ·`. Normalize a missing or invalid timestamp to positive infinity during sorting, use the stable key as the tie-breaker, and display `미정`. Do not render the old text-only `전화상담 대기` in place of the time.

- [ ] In the canonical track detail phone card, show `전화상담 대기 기준일시` from the active phone consultation's `readyAt`. Render `미정` only for legacy data that genuinely lacks the new projection; never synthesize it from `stageEnteredAt`.

- [ ] Run the fixture, list, service, and workspace tests.

```bash
"$NODE" --test \
  tests/registration-track-fixtures.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/ops-task-workspace.test.mjs
```

Expected: all selected tests pass and phone ordering/display share the same canonical value.

- [ ] Commit fixture and queue parity.

```bash
git add \
  src/features/tasks/registration-track-fixture-runtime.ts \
  src/features/tasks/registration-track-fixtures.ts \
  src/features/tasks/registration-track-service.ts \
  src/features/tasks/registration-track-list.tsx \
  src/features/tasks/registration-track-editor.tsx \
  tests/registration-track-fixtures.test.mjs \
  tests/registration-track-workspace.test.mjs
git diff --cached --check
git commit -m "feat: mirror registration intake in fixtures"
```

---

### Task 7: Replace the add dialog with capability-gated progressive disclosure

**Files:**

- Create: `src/features/tasks/registration-initial-plan-control.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/registration-consultation-notification.js`
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
- Modify: `scripts/verify-registration-subject-track-concurrency.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `tests/registration-consultation-notification.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

- [ ] Add failing source/component-contract tests for the following add-form behavior:

1. `문의 정보` is always visible.
2. `과목별 다음 업무` renders one row per selected subject, in English/mathematics order, with exactly `문의 유지`, `레벨테스트`, `바로 전화상담`, `방문상담`.
3. Level-test fields render only when at least one subject selects `level_test`.
4. Consultation fields render only for `direct_phone` or `visit`.
5. A new dialog never renders placement/admission fields.
6. The consultation DOM order is counselor, phone-ready timestamp, visit appointment, visit room.
7. Collapsing a relevant panel changes visibility only and preserves the draft.
8. Validation opens the relevant collapsed panel before focusing its first invalid control.
9. Core ready plus missing intake capability hides the plan control and uses `createRegistrationCase`, not the atomic RPC.
10. Core maintenance keeps the existing mutation-blocked message and calls neither create RPC.
11. Core legacy hides the plan control and uses `createOpsTask`.
12. Core ready plus intake version 1 uses only `createRegistrationCaseWithInitialWorkflow` and does not call `persistCreatedRegistrationDirectorDefaults` or write `phoneConsultationAt`.

- [ ] Run the workspace and notification tests and confirm the new assertions fail.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-consultation-notification.test.mjs
```

Expected: FAIL because the plan control, conditional create path, and batch notification helper are absent.

- [ ] Implement `RegistrationInitialPlanControl` as a controlled component. It owns no business draft and emits only `(subject, nextAction)`. Use native buttons/radio semantics and visible subject labels; do not add explanatory cards.

- [ ] In `OpsTaskWorkspace`, keep `registrationInitialWorkflowDraft` separate from `OpsTaskInput`. Initialize it when a new registration form opens, reconcile it whenever selected subjects change, and reset it when the form closes. Keep manual accordion state in separate booleans.

Probe the intake capability only when the add dialog opens and the core runtime is ready; do not put either new work on registration-list first paint. While the intake probe is pending, keep the downstream plan UI hidden and retain the already entered inquiry fields.

For every new registration, remove the legacy all-at-once level-test, consultation, placement, and admission groups from `TypeSpecificFields`. Capability version 1 replaces only level-test/consultation with the conditional canonical panels; capability-unavailable mode remains an inquiry-only form. Existing legacy edit/read surfaces keep their compatibility fields until their own migration is retired.

- [ ] Resolve director display separately per subject:

```ts
resolveRegistrationDirectorDefault({
  subjects: [subject],
  grade: form.registration?.schoolGrade,
  inquiryAt: form.registration?.inquiryAt,
  teachers,
  profiles,
})
```

Show the resolved default for each phone/visit subject. Put a profile ID into `directorOverrides` only after the operator explicitly changes that subject's selection. A missing resolved director blocks direct phone or visit submission.

In atomic intake mode, do not write these per-subject defaults into the legacy shared `form.secondaryAssigneeId` or `registration.counselor`. Keep the existing shared automatic-director effect only for the capability-unavailable inquiry-only fallback and legacy edit surfaces.

- [ ] Render the conditional level-test panel with only shared date/time, place, and participating-subject badges. Do not render result URL at initial scheduling.

- [ ] Render the consultation panel in this desktop 2-by-2 order and the same mobile sequence:

| Left | Right |
| --- | --- |
| 상담 책임자 | 전화상담 대기 기준일시 |
| 방문상담 예약일시 | 방문상담실 |

For direct phone, display the captured inquiry timestamp read-only. For visit, show no phone-ready timestamp. Never render a phone date/time picker.

- [ ] On submit, preserve the current core-runtime branch before consulting intake capability. Core maintenance throws the existing conversion message; core legacy uses `createOpsTask`; core ready continues. For core ready plus intake version 1, validate and normalize the draft, call the atomic RPC with one stable request key, then load the saved canonical detail. Build the request-key signature from both `serializeOpsTaskInput(createPayload)` and the normalized initial-workflow payload so a changed plan receives a new key. Clear the create key immediately after a committed RPC response, before notification delivery. For core ready plus unavailable intake capability, discard no visible downstream values because the plan UI was hidden and call `createRegistrationCase`.

In the submit catch, call `getRegistrationPersistenceErrorMessage(error, getOpsTaskActionErrorMessage(error, "저장하지 못했습니다."))` so known intake codes become Korean operator instructions and unrelated failures keep the existing safe fallback.

- [ ] Extract a reusable post-commit dispatcher in `registration-consultation-notification.js`:

```js
export async function dispatchRegistrationVisitNotificationTargets(
  targets = [],
  sessionToken = "",
) {
  const failedTargets = []
  const warnings = []
  for (const target of targets) {
    try {
      const payload = await sendRegistrationVisitNotificationTarget(target, sessionToken)
      if (payload?.warning) warnings.push(payload.warning)
    } catch (error) {
      failedTargets.push(target)
    }
  }
  return { failedTargets, warnings }
}
```

The workspace stores failed targets after the database result is committed and exposes one compact `알림 재시도` action. Retry calls only the dispatcher; it never repeats `createRegistrationCaseWithInitialWorkflow`.

- [ ] Extend `verifyRegistrationSubjectTrackFixture` in `scripts/verify-ops-task-browser-workflow.mjs` with create, mixed-path, shared-appointment, canonical-reopen, readiness, and overflow assertions. The fixture path remains `?fixture=registration-subject-tracks`, and the verifier rejects any external notification request.

- [ ] Extend `scripts/verify-registration-subject-track-concurrency.mjs` with one real atomic-intake race: two concurrent identical calls from the same authenticated actor and request key must return the same response and leave exactly one parent case/receipt. Add the scenario to the network-free manifest and implement its `--run` assertion for an authorized local/preview database.

- [ ] Run all focused client tests.

```bash
"$NODE" --test \
  tests/registration-intake-workflow.test.mjs \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-consultation-notification.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-fixtures.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/ops-task-workspace.test.mjs
```

Expected: all selected tests pass; no test performs a real notification call.

- [ ] Commit the add-dialog integration.

```bash
git add \
  src/features/tasks/registration-initial-plan-control.tsx \
  src/features/tasks/ops-task-workspace.tsx \
  src/features/tasks/registration-consultation-notification.js \
  scripts/verify-ops-task-browser-workflow.mjs \
  scripts/verify-registration-subject-track-concurrency.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-consultation-notification.test.mjs \
  tests/registration-track-workspace.test.mjs
git diff --cached --check
git commit -m "feat: route registration intake by subject"
```

---

### Task 8: Align canonical documentation and run full verification

**Files:**

- Modify: `docs/superpowers/specs/2026-07-12-registration-subject-tracks-and-multi-enrollment-design.md`
- Modify: `docs/superpowers/specs/2026-07-13-registration-intake-routing-design.md`
- Verify: `scripts/verify-ops-task-browser-workflow.mjs`
- Verify: all files changed by Tasks 0–7

- [ ] Change the 2026-07-12 canonical sentence from phone queue ordering by `stage_entered_at` to ordering by active phone consultation `ready_at`, oldest first, with stable track-ID tie-breaking. Update the matching test-strategy bullet. Do not rewrite unrelated historical design decisions.

- [ ] Mark the 2026-07-13 design status `Approved`.

- [ ] Run the focused registration packet.

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test \
  tests/registration-intake-workflow.test.mjs \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-runtime-probe.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-fixtures.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-consultation-notification.test.mjs \
  tests/registration-director-default.test.mjs \
  tests/registration-workflow.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/date-time-picker.test.mjs
```

Expected: every focused test passes.

- [ ] Run the full test suite, lint, production build, and the network-free concurrency manifest.

```bash
"$NODE" --test tests/*.test.mjs
pnpm lint
pnpm build
"$NODE" scripts/verify-registration-subject-track-concurrency.mjs
```

Expected: zero test failures, zero ESLint errors, a successful Next.js production build, and a dry-run manifest listing all concurrency scenarios without network access. Record exact test counts from this run instead of copying an older count.

- [ ] If an authorized local or preview Supabase environment supplies all five target/credential values, run the real concurrency verifier. Never target the production project.

```bash
"$NODE" scripts/verify-registration-subject-track-concurrency.mjs \
  --run \
  --url "$REGISTRATION_VERIFY_SUPABASE_URL" \
  --anon-key "$REGISTRATION_VERIFY_ANON_KEY" \
  --service-role-key "$REGISTRATION_VERIFY_SERVICE_ROLE_KEY" \
  --admin-token "$REGISTRATION_VERIFY_ADMIN_TOKEN" \
  --second-admin-token "$REGISTRATION_VERIFY_SECOND_ADMIN_TOKEN"
```

Expected: every race scenario reports its invariant and exits successfully. If any required value is unavailable, record runtime concurrency verification as environment-blocked; the dry-run manifest is not a substitute for this proof.

- [ ] Run SQL tests when the local Supabase stack is available.

```bash
pnpm dlx supabase@2.109.1 test db
```

Expected: both new intake packets and all pre-existing pgTAP packets pass. If Docker is unavailable, record that as an environment limitation and do not claim database runtime verification.

- [ ] Start the local app and verify only the fixture surface.

```bash
pnpm dev
```

Open:

```text
http://127.0.0.1:3000/admin/registration?fixture=registration-subject-tracks
```

Verify at desktop `1440x900` and mobile `390x844`:

1. Basic inquiry saves with internal campus `본관` and no raw database error.
2. Initial view shows inquiry fields plus subject plans, not all downstream forms.
3. English level test plus mathematics direct phone persists separate states.
4. A two-subject level test renders one shared appointment with two subject badges.
5. A two-subject visit renders one shared appointment and subject-specific directors.
6. Direct phone shows read-only inquiry time; no phone reservation picker exists.
7. Selecting visit removes phone readiness for that subject only.
8. Closing/reopening loads the canonical saved case.
9. The phone queue orders and displays by the same readiness timestamp.
10. No modal or picker overflows horizontally, and the time menu stays anchored while scrolling.
11. Manually collapsing and reopening a relevant panel preserves its values; submitting a hidden invalid panel reopens it and focuses the first invalid field.

- [ ] Run the repeatable fixture verifier with the repository's documented browser-test credentials/environment. If those credentials are unavailable, complete the interactive local-browser checks above and record the automated verifier as environment-blocked rather than silently skipping it.

```bash
OPS_BROWSER_WORKFLOW=1 OPS_BROWSER_BASE_URL=http://127.0.0.1:3000 \
  "$NODE" scripts/verify-ops-task-browser-workflow.mjs
```

- [ ] Inspect browser console and network results. Require no React errors, failed fixture mutations, duplicate atomic-create request, or external Google Chat/customer-message request.

- [ ] Review the final diff for accidental legacy writes and placeholders.

```bash
rg -n "phoneConsultationAt|registration_campus_invalid|TODO|TBD|FIXME" \
  src/features/tasks \
  tests \
  supabase/migrations/20260713150000_registration_intake_workflow.sql \
  docs/superpowers/specs/2026-07-13-registration-intake-routing-design.md
git diff --check
git status --short
```

Expected: legacy `phoneConsultationAt` remains only in compatibility reads/tests, never in the new atomic create payload; raw campus codes appear only in mapper/tests/SQL; no new TODO/TBD/FIXME remains.

- [ ] If browser or full-suite verification required a code correction, rerun the affected focused tests and commit only the exact corrected code/test files in a separate `fix:` commit before proceeding. Do not hide implementation corrections in the documentation commit.

- [ ] Commit the documentation updates.

```bash
git add \
  docs/superpowers/specs/2026-07-12-registration-subject-tracks-and-multi-enrollment-design.md \
  docs/superpowers/specs/2026-07-13-registration-intake-routing-design.md
git diff --cached --check
git commit -m "docs: align registration queue semantics"
```

- [ ] Confirm the branch is clean and review the implementation commit series. Do not push or deploy until the user explicitly requests it.

```bash
git status --short --branch
git log --oneline --decorate -10
```
