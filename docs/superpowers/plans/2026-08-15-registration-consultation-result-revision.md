# Registration Consultation Result Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the consultation owner save and revise `미정`, `대기`, `청강`, `등록`, or `미등록` with consultation notes while preserving observation history and atomically converting current-class waitlist membership into a prepared enrollment.

**Architecture:** A forward migration expands the consultation outcome constraint and introduces one revision-aware RPC that owns consultation, workflow, waitlist, observation, and prepared-enrollment invariants. The existing React editor becomes a five-choice controlled form with conditional waiting fields and uses the same RPC for first save and later correction. Historical observation/wait rows remain immutable evidence while only active claims and current workflow state move.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase Postgres/PLpgSQL, Node test runner, pgTAP/local Supabase QA.

## Global Constraints

- Valid outcome values are exactly `undecided`, `waiting`, `observation`, `enrollment`, `not_registered`.
- Result and note save atomically with workflow status and any wait/enrollment conversion.
- The consultation owner retains edit access after completion; other users remain read-only.
- Saving a result does not create an appointment or send a customer message.
- Active observation must be completed, canceled, or marked no-show before changing away from `observation`.
- Terminal observation rows, attendance, and feedback are never deleted or overwritten by result correction.
- Current-class wait to enrollment removes both waitlist projections and prepares the same class for enrollment in one transaction.
- Admission batches, payment, enrolled roster, and completed registration are never automatically reversed.
- Existing customer/provider delivery failures never roll back core registration state.
- Do not apply a production migration or send a customer message during source implementation.

---

## File Structure

- Create `supabase/migrations/20260815122000_registration_consultation_outcome_revision.sql`: constraint expansion, atomic save/correction RPC, wait-to-enrollment conversion, ACL/runtime capability.
- Modify `src/features/tasks/registration-track-model.d.ts`: five-value outcome and save-state types.
- Modify `src/features/tasks/registration-track-model.js`: validation, conditional waiting requirements, editable-completed state.
- Modify `src/features/tasks/registration-track-service.ts`: new RPC client and strict response mapping.
- Modify `src/features/tasks/registration-application-track-actions.tsx`: five result buttons and conditional wait/class inputs.
- Modify `src/features/tasks/registration-track-editor.tsx`: render the editor for completed/observation/waiting/enrollment/not-registered states when the owner can correct.
- Modify `src/features/tasks/registration-track-fixtures.ts`: deterministic five-result and conversion behavior.
- Modify `src/features/tasks/registration-track-history.js`: Korean labels for undecided/observation and correction events.
- Create `tests/registration-consultation-outcome-revision.test.mjs`; modify focused model/service/workspace/schema/fixture/history suites.

### Task 1: Five-Outcome Domain Model and Conditional Validation

**Files:**
- Create: `tests/registration-consultation-outcome-revision.test.mjs`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `tests/registration-track-model.test.mjs`

**Interfaces:**
- Produces type `RegistrationConsultationOutcome = "undecided" | "waiting" | "observation" | "enrollment" | "not_registered"`.
- Produces `getRegistrationConsultationOutcomeSaveState({ savedOutcome,draftOutcome,savedNote,draftNote,waitingKind,classId,canEdit })` with `blockers` and `canSave`.

- [ ] **Step 1: Write failing model tests**

```js
for (const outcome of ["undecided", "waiting", "observation", "enrollment", "not_registered"]) {
  assert.equal(getRegistrationConsultationOutcomeSaveState({
    savedOutcome: "", draftOutcome: outcome, savedNote: "", draftNote: "",
    waitingKind: outcome === "waiting" ? "next_term_opening" : "",
    classId: "", canEdit: true,
  }).canSave, true)
}
assert.deepEqual(waitingWithoutKind.blockers, ["대기 유형"])
assert.deepEqual(currentClassWithoutClass.blockers, ["대기 반"])
```

Also assert no waiting fields are accepted for non-waiting outcomes and a note-only edit is dirty after completion.

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-consultation-outcome-revision.test.mjs tests/registration-track-model.test.mjs`

- [ ] **Step 3: Add exact types and model validation**

```ts
export type RegistrationConsultationOutcome =
  | "undecided"
  | "waiting"
  | "observation"
  | "enrollment"
  | "not_registered"
```

Use one exported outcome array as the runtime validator. Return blockers instead of duplicating button-specific checks in the component.

- [ ] **Step 4: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/features/tasks/registration-track-model.d.ts src/features/tasks/registration-track-model.js tests/registration-consultation-outcome-revision.test.mjs tests/registration-track-model.test.mjs
git commit -m "feat: model five consultation results"
```

### Task 2: Atomic Consultation Result Revision RPC

**Files:**
- Create: `supabase/migrations/20260815122000_registration_consultation_outcome_revision.sql`
- Modify: `tests/registration-consultation-outcome-revision.test.mjs`
- Modify: `tests/registration-track-schema.test.mjs`

**Interfaces:**
- Produces `public.save_registration_consultation_result_v2(uuid,text,text,text,uuid,integer,uuid)`.
- Parameters: consultation ID, outcome, note, waiting kind, class ID, expected workflow revision, request UUID.
- Returns: consultation ID/status/outcome/note, track ID/workflow status/revision, waiting kind, active enrollment ID, prepared enrollment ID.

- [ ] **Step 1: Add failing SQL contract tests**

Assert the expanded check constraint, exact parameter list, stable lock order, owner-only access, expected revision, idempotency ledger, note redaction from audit metadata, and response fields.

```js
assert.match(sql, /outcome in \('undecided', 'waiting', 'observation', 'enrollment', 'not_registered'\)/)
assert.match(sql, /p_expected_workflow_revision integer/)
assert.match(sql, /registration_consultation_result_refresh_required/)
assert.doesNotMatch(eventMetadataBlock, /p_note|v_note/)
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-consultation-outcome-revision.test.mjs tests/registration-track-schema.test.mjs`

- [ ] **Step 3: Expand the outcome constraint safely**

Drop only the named consultation outcome/status-completion checks, recreate them with the five outcomes, and preserve all existing rows. `status=completed` continues to require `completed_at` and a non-null outcome.

- [ ] **Step 4: Implement validation, locks, and replay**

Validate fields with this matrix:

```sql
if v_outcome = 'waiting' then
  -- require one waiting kind; require class only for current_class
elsif v_waiting_kind is not null or p_class_id is not null then
  raise exception 'registration_consultation_waiting_fields_not_allowed';
end if;
```

Lock task, registration detail, all case tracks, consultation, observation/appointment rows, enrollment rows, student, and affected classes in deterministic ID order. Require `workflow_revision=p_expected_workflow_revision`. Store the request fingerprint in `dashboard_private.ops_registration_mutations` under `save_consultation_result_v2`.

- [ ] **Step 5: Implement outcome-to-workflow mapping**

Use:

```sql
v_target_workflow_status := case v_outcome
  when 'undecided' then 'consultation_completed'
  when 'waiting' then case v_waiting_kind
    when 'current_class' then 'waiting_current_class'
    when 'current_term_opening' then 'waiting_new_class'
    else 'waiting_next_opening'
  end
  when 'observation' then 'observation_requested'
  when 'enrollment' then 'enrollment_requested'
  else 'not_registered'
end;
```

Update consultation result/note and track workflow revision in the same transaction. Do not insert observation appointments or notification/customer-message jobs.

For `observation`, copy the existing `enter_registration_observation_v1_impl` transition contract: require a valid source state, set `observation_return_workflow_status` to the source workflow status, then set `workflow_status='observation_requested'` and increment the workflow revision. Do not create an observation or appointment row at this step.

- [ ] **Step 6: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add supabase/migrations/20260815122000_registration_consultation_outcome_revision.sql tests/registration-consultation-outcome-revision.test.mjs tests/registration-track-schema.test.mjs
git commit -m "feat: save consultation result revisions atomically"
```

### Task 3: Preserve Observation History and Block Active Observation Changes

**Files:**
- Modify: `supabase/migrations/20260815122000_registration_consultation_outcome_revision.sql`
- Modify: `tests/registration-consultation-outcome-revision.test.mjs`
- Modify: `tests/registration-observation-feedback-mutations.test.mjs`

**Interfaces:**
- Consumes: `ops_registration_observations`, their appointments, current workflow revision.
- Produces: error `registration_observation_transition_requires_action` for an active observation; no mutation of terminal observation data.

- [ ] **Step 1: Add failing observation-boundary tests**

Test scheduled and `attended_feedback_pending` observations reject an outcome change. Test `completed`, `canceled`, and `no_show` observations survive a change to enrollment/not-registered byte-for-byte for attendance, suitability, feedback reason, teacher, appointment, and revisions.

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-consultation-outcome-revision.test.mjs tests/registration-observation-feedback-mutations.test.mjs`

- [ ] **Step 3: Add the active-observation guard**

Reject when the current observation status is `scheduled` or `attended_feedback_pending` and the target outcome is not `observation`. The UI error maps to `청강을 취소 또는 미진행으로 마감한 뒤 상담 결과를 변경해 주세요.`

- [ ] **Step 4: Prove the RPC never updates historical observation tables**

The result RPC may read/lock observation rows but must contain no `UPDATE` or `DELETE` against `ops_registration_observations`, observation appointments, attendance, or feedback fields. Add a source-contract assertion for this absence.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add supabase/migrations/20260815122000_registration_consultation_outcome_revision.sql tests/registration-consultation-outcome-revision.test.mjs tests/registration-observation-feedback-mutations.test.mjs
git commit -m "feat: preserve observation history on consultation changes"
```

### Task 4: Convert Current-Class Wait to Prepared Enrollment

**Files:**
- Modify: `supabase/migrations/20260815122000_registration_consultation_outcome_revision.sql`
- Modify: `tests/registration-consultation-outcome-revision.test.mjs`
- Modify: `tests/registration-track-schema.test.mjs`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Modify: `tests/registration-track-fixtures.test.mjs`

**Interfaces:**
- Consumes: active waitlisted enrollment and `apply_student_class_roster_mode`.
- Produces: canceled inactive historical wait row plus one same-class planned enrollment; response `prepared_enrollment_id`.

- [ ] **Step 1: Add failing atomic-conversion tests**

Test student/class waitlist projections removed, old row canceled/inactive, same class planned row created with `student_id NULL` and `roster_active=false`, track waiting kind cleared, one prepared row on replay, and full rollback when planned insertion is forced to fail.

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-consultation-outcome-revision.test.mjs tests/registration-track-schema.test.mjs tests/registration-track-fixtures.test.mjs`

- [ ] **Step 3: Implement the conversion inside the result transaction**

Call `apply_student_class_roster_mode(student_id,class_id,'removed','waitlist',old_enrollment_id,'registration_waiting_promoted',actor_id)`, cancel the old row, and insert:

```sql
insert into public.ops_registration_enrollments(
  track_id,class_id,status,roster_active,sort_order
) values (
  v_track.id,v_wait_class_id,'planned',false,0
) returning id into v_prepared_enrollment_id;
```

Cancel conflicting unbatched planned drafts before inserting. Preserve the old wait row for history but exclude it from active wait reads.

- [ ] **Step 4: Handle non-class waiting outcomes**

For current/new/next waiting changes, remove obsolete active class claims before creating the requested current-class claim. For new-class/next-opening wait to enrollment, clear waiting state and do not invent a class; the registration editor opens with no prepared row.

- [ ] **Step 5: Mirror behavior in fixtures and run tests**

Run the Step 2 command. Expected: PASS.

```bash
git add supabase/migrations/20260815122000_registration_consultation_outcome_revision.sql src/features/tasks/registration-track-fixtures.ts tests/registration-consultation-outcome-revision.test.mjs tests/registration-track-schema.test.mjs tests/registration-track-fixtures.test.mjs
git commit -m "feat: promote current wait class into enrollment draft"
```

### Task 5: Strict Service Client and Completed-Consultation Edit Permission

**Files:**
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `tests/registration-track-service.test.mjs`
- Modify: `tests/registration-track-model.test.mjs`

**Interfaces:**
- Produces `saveRegistrationConsultationResult(input)` using `save_registration_consultation_result_v2`.
- Produces permission `canEditConsultationResult` for the matching director on both active and completed consultation records.

- [ ] **Step 1: Write failing service and permission tests**

```js
assert.deepEqual(rpcCall, ["save_registration_consultation_result_v2", {
  p_consultation_id: "consultation-1",
  p_outcome: "undecided",
  p_note: "추후 다시 연락",
  p_waiting_kind: null,
  p_class_id: null,
  p_expected_workflow_revision: 4,
  p_request_key: requestId,
}])
```

Assert a completed consultation owned by the current director is editable and a different actor is not.

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-track-service.test.mjs tests/registration-track-model.test.mjs`

- [ ] **Step 3: Implement strict request/response mapping**

Validate UUIDs, five outcomes, workflow statuses, revisions, and nullable enrollment IDs. Remove the UI path that uses `saveRegistrationConsultationDetails` for outcome changes; retain a compatibility export only if another caller still requires it.

- [ ] **Step 4: Separate edit permission from active consultation action permission**

Keep `canCompleteConsultation` for first completion. Add `canEditConsultationResult` when viewer ID, track director, and consultation director match and the role is allowed. Do not make all admins/staff implicit editors when they are not the assigned consultation owner.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-model.js src/features/tasks/registration-track-model.d.ts tests/registration-track-service.test.mjs tests/registration-track-model.test.mjs
git commit -m "feat: expose consultation result revision service"
```

### Task 6: Five-Choice Consultation Editor

**Files:**
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-consultation-outcome-revision.test.mjs`

**Interfaces:**
- Consumes: Task 1 model, Task 5 service/permission, existing class selector/catalog.
- Produces: one accessible five-button result group with conditional waiting fields and reusable save behavior.

- [ ] **Step 1: Add failing UI source/behavior tests**

Assert labels and order `미정, 대기, 청강, 등록, 미등록`; conditional `WAITING_KIND_OPTIONS`; current-class selector only; saved-note hydration; owner-only editing after completion; revision error and active-observation guidance; no automatic AlimTalk/appointment calls.

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-track-workspace.test.mjs tests/registration-consultation-outcome-revision.test.mjs`

- [ ] **Step 3: Implement the controlled editor**

Use this exact option model:

```ts
const CONSULTATION_OUTCOME_OPTIONS = [
  { value: "undecided", label: "미정" },
  { value: "waiting", label: "대기" },
  { value: "observation", label: "청강" },
  { value: "enrollment", label: "등록" },
  { value: "not_registered", label: "미등록" },
] as const
```

Reset waiting kind/class when the result changes away from waiting. Preserve the draft after errors. After success, reload the case and clear dirty state only when the committed response is accepted.

- [ ] **Step 4: Keep the editor visible in later workflow views**

Render the latest consultation result card in consultation-completed, waiting, observation, enrollment-requested, and not-registered details. Do not hide historical observation panels when the current result changes.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-track-editor.tsx tests/registration-track-workspace.test.mjs tests/registration-consultation-outcome-revision.test.mjs
git commit -m "feat: edit five consultation result choices"
```

### Task 7: History Labels, Full Verification, and Release Gate

**Files:**
- Modify: `src/features/tasks/registration-track-history.js`
- Modify: `tests/registration-track-history.test.mjs`
- Modify only scoped files if verification finds a defect.

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: Korean history descriptions and a source/test/build checkpoint ready for separate migration/main/deploy gates.

- [ ] **Step 1: Add failing history tests**

Assert `undecided -> 미정`, `observation -> 청강`, correction descriptions include old/new labels and actor/time, and consultation note text is not copied into event descriptions or metadata.

- [ ] **Step 2: Implement labels and run focused history tests**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-track-history.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run the full consultation/registration suite**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types \
  tests/registration-consultation-outcome-revision.test.mjs \
  tests/registration-track-model.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-track-fixtures.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/registration-track-history.test.mjs \
  tests/registration-observation-feedback-mutations.test.mjs
```

Expected: all PASS.

- [ ] **Step 4: Run lint and production build**

Run: `pnpm lint`

Run: `pnpm build`

Expected: both exit 0. The build script already supplies webpack.

- [ ] **Step 5: Commit history/verification corrections**

```bash
git add src/features/tasks/registration-track-history.js tests/registration-track-history.test.mjs
git commit -m "test: verify consultation result revisions"
```

- [ ] **Step 6: Stop at the source gate and report remaining gates**

Report source/tests, migration application, `main` merge/push, Vercel Production `READY`, authenticated runtime behavior, provider request count, and customer receipt independently. Do not claim deployment or customer messaging from source tests.
