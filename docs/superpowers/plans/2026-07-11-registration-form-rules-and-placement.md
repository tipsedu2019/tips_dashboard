# Registration Form Rules and Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align registration intake, placement, admission sequencing, and director assignment with the approved operating rules while preserving registration loading performance.

**Architecture:** Put year-aware director assignment in a pure shared module consumed by registration and makeup requests. Keep registration list hydration narrow; fetch one selected class schedule on demand and compose existing shared date/time picker controls. Remove `inquiry_channel` application references before adding a generated migration that drops the column.

**Tech Stack:** Next.js 16, React 19, TypeScript/JavaScript, Node test runner, Supabase/Postgres, shadcn/Radix UI.

## Global Constraints

- Preserve all unrelated dirty-worktree changes; never reset or overwrite them.
- Do not commit, push, deploy, or apply a remote migration unless the user separately requests it.
- `inquiry_channel` is the only database column removed in this task.
- Keep legacy `level_test_completed_at`, `level_test_result`, and `consultation_at` values readable.
- Registration list loading must not reintroduce all-class `schedule_plan` hydration.
- Director rules are based on the Seoul-calendar effective year and use the approved three-year English rotation.
- English+mathematics inquiries and unsupported English grades require explicit manual selection.
- A deliberately cleared textbook is valid and must not be auto-restored for the same selected class.

---

### Task 1: Shared academic-director rule and makeup integration

**Files:**
- Create: `src/lib/academic-director-assignment.js`
- Create: `src/lib/academic-director-assignment.d.ts`
- Create: `tests/academic-director-assignment.test.mjs`
- Modify: `src/features/makeup-requests/makeup-request-model.js`
- Modify: `src/features/makeup-requests/makeup-request-model.d.ts`
- Modify: `src/features/makeup-requests/makeup-request-workspace.tsx`
- Modify: `src/features/makeup-requests/makeup-request-service.ts`
- Modify: `tests/makeup-request-model.test.mjs`
- Modify: `tests/makeup-request-workspace.test.mjs`

**Interfaces:**
- Produces: `resolveAcademicDirector({ subjects, grade, effectiveYear })` returning `{ status, directorName, candidateNames, reason, normalizedGrade, normalizedSubjects }`.
- Consumes: class subject/grade and teacher catalog/profile IDs already loaded by makeup requests.

- [ ] **Step 1: Write failing resolver matrix tests**

```js
assert.equal(resolveAcademicDirector({ subjects: ["영어"], grade: "고2", effectiveYear: 2026 }).directorName, "정보영")
assert.equal(resolveAcademicDirector({ subjects: ["영어"], grade: "고2", effectiveYear: 2027 }).directorName, "강부희")
assert.equal(resolveAcademicDirector({ subjects: ["수학"], grade: "중2", effectiveYear: 2026 }).directorName, "강정은")
assert.equal(resolveAcademicDirector({ subjects: ["수학"], grade: "고2", effectiveYear: 2026 }).directorName, "양소윤")
assert.equal(resolveAcademicDirector({ subjects: ["영어", "수학"], grade: "고2", effectiveYear: 2026 }).status, "ambiguous")
assert.equal(resolveAcademicDirector({ subjects: ["영어"], grade: "초2", effectiveYear: 2026 }).status, "unsupported")
```

- [ ] **Step 2: Run the resolver tests and verify RED**

Run: `node --test tests/academic-director-assignment.test.mjs`

Expected: FAIL because the shared module does not exist.

- [ ] **Step 3: Implement the pure resolver and declarations**

Use normalized exact grade tokens and the approved English index:

```js
const ENGLISH_DIRECTORS = ["강부희", "정보영", "김민경"]
const ownerIndex = modulo(phase - (effectiveYear - 2026), 3)
```

Return `ambiguous` when resolved subjects disagree and `unsupported` when no exact approved rule exists.

- [ ] **Step 4: Verify resolver GREEN**

Run: `node --test tests/academic-director-assignment.test.mjs`

Expected: all resolver tests pass.

- [ ] **Step 5: Write failing makeup integration tests**

Assert that the selected class uses the single computed director, 2026/2027 English assignments differ correctly, and a tampered non-manager approver is rejected.

- [ ] **Step 6: Replace makeup's group-list fallback with the shared resolver**

`getAllowedApproverNames()` must return the resolved singleton when possible. The form selects that teacher by stable catalog ID; the service recomputes and validates the rule. Preserve an explicit manager override, but do not allow a non-manager payload to bypass the computed assignment.

- [ ] **Step 7: Run makeup tests**

Run: `node --test tests/academic-director-assignment.test.mjs tests/makeup-request-model.test.mjs tests/makeup-request-workspace.test.mjs`

Expected: all tests pass.

---

### Task 2: Registration contract cleanup, required inquiry fields, and automatic completion timestamps

**Files:**
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `src/features/tasks/registration-workflow.js`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `scripts/verify-ops-task-sample-workflow.mjs`
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
- Modify: `tests/registration-workflow.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `tests/registration-service-hardening.test.mjs`
- Create: `supabase/migrations/20260711123928_drop_registration_inquiry_channel.sql`

**Interfaces:**
- Produces: registration create blockers for `학년` and `문의일시`; stage preparation that fills completion timestamps.
- Consumes: `levelTestMaterialLink` as the new level-test completion evidence.

- [ ] **Step 1: Write failing contract and workflow tests**

Tests must prove:

```js
assert.deepEqual(getRegistrationCreateBlockers({ registration: {} }), ["학생명", "과목", "학년", "학부모 전화", "문의일시"])
assert.ok(getRegistrationTransitionBlockers({ registration: { levelTestAt: "2026-07-11T10:00", levelTestPlace: "본관" } }, "1-1. 레벨테스트 완료").includes("시험지·결과지 URL"))
```

Also assert source/service contracts contain no `inquiryChannel`, `inquiry_channel`, `{문의채널}`, or visible `문의 채널` registration field.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/registration-workflow.test.mjs tests/ops-task-workspace.test.mjs tests/registration-service-hardening.test.mjs`

Expected: FAIL on the newly required fields, completion evidence, and inquiry-channel references.

- [ ] **Step 3: Remove inquiry-channel application references**

Remove the type property, DB mapping and payload, table column/key, form field/options, detail rows, sort/filter value, notification variable/context, sample payloads, and browser verification references. Do not alter historical migration files.

- [ ] **Step 4: Add required grade/inquiry-time validation and labels**

Add blocker focus keys `학년 -> schoolGrade` and `문의일시 -> inquiryAt`, enforce them in create blockers/errors, and mark both UI fields required.

- [ ] **Step 5: Replace manual completion dependencies**

Keep legacy fields in the service model. Change new stage blockers from `levelTestResult` to `levelTestMaterialLink`; remove editable level-test completion/result and consultation completion controls; stamp empty completion times while preparing the transition to prefixes `1-1.` and `3.`.

- [ ] **Step 6: Generate the migration with the Supabase CLI**

Run: `pnpm dlx supabase@latest migration new drop_registration_inquiry_channel`

Write only:

```sql
set local lock_timeout = '5s';

alter table public.ops_registration_details
  drop column if exists inquiry_channel;
```

- [ ] **Step 7: Run focused tests**

Run: `node --test tests/registration-workflow.test.mjs tests/ops-task-workspace.test.mjs tests/registration-service-hardening.test.mjs`

Expected: all focused tests pass.

---

### Task 3: Shared polished registration date/time control

**Files:**
- Modify: `src/components/ui/date-time-picker.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/ops-task-workspace.test.mjs`
- Create or modify: `tests/date-time-picker.test.mjs`

**Interfaces:**
- Produces: `DateTimePickerControl` accepting `value`, `onChange`, `dateAriaLabel`, `timeAriaLabel`, `disabled`, and placeholders.
- Consumes: local `YYYY-MM-DDTHH:mm` registration values.

- [ ] **Step 1: Write failing component/source-contract tests**

Assert that date and time updates preserve the other half and that the registration fields use `DateTimePickerControl` instead of `type="datetime-local"`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/date-time-picker.test.mjs tests/ops-task-workspace.test.mjs`

Expected: FAIL because the combined component does not exist.

- [ ] **Step 3: Implement the composed control**

Compose the existing `DatePickerControl` and `TimePickerControl` without duplicating calendar/time logic. Preserve dialog-safe popovers and responsive two-column/stacked layout.

- [ ] **Step 4: Replace registration date/time inputs**

Use the shared control for inquiry time, level-test reservation, and phone/visit consultation reservations. Keep the form value contract unchanged.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/date-time-picker.test.mjs tests/ops-task-workspace.test.mjs`

Expected: all tests pass.

---

### Task 3A: Registration academic-director default

**Files:**
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/ops-task-workspace.test.mjs`
- Reuse: `src/lib/academic-director-assignment.js`

**Interfaces:**
- Produces: a registration counselor default resolved from inquiry subjects, exact grade, and the inquiry date's Seoul-calendar year.
- Consumes: the shared `resolveAcademicDirector()` result plus profile-linked principal teacher options.

- [ ] **Step 1: Write failing default/override/late-loading tests**

Cover the 2026/2027 English rotation, mathematics divisions, ambiguous/unsupported cases, stable profile-ID selection, late option hydration, rule changes for an automatically selected value, and preservation of an existing or explicitly overridden counselor.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/academic-director-assignment.test.mjs tests/ops-task-workspace.test.mjs`

Expected: FAIL because registration does not consume the shared resolver.

- [ ] **Step 3: Add the registration default**

Use `parseRegistrationSubjects(form.subject)`, `registration.schoolGrade`, and `registration.inquiryAt` interpreted in the Seoul calendar. Resolve the official name through the profile-linked principal teacher options and write both `secondaryAssigneeId` and `registration.counselor`. An empty automatic selection may be filled after options load, and a prior automatic selection may follow a changed rule. Do not overwrite an existing saved value or an explicit administrator selection. Ambiguous/unsupported rules remain manually selectable.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/academic-director-assignment.test.mjs tests/ops-task-workspace.test.mjs`

Expected: all focused tests pass.

---

### Task 4: Selected-class schedule and textbook default/deselect

**Files:**
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/registration-workflow.js`
- Modify: `tests/ops-task-service-loading.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `tests/registration-workflow.test.mjs`

**Interfaces:**
- Produces: a selected-class schedule loader and a registration schedule picker that writes date/session atomically.
- Consumes: existing `schedule_plan.sessions`, class `textbookIds`, and shared linked-select controls.

- [ ] **Step 1: Write failing schedule/default/deselect tests**

Cover active-session filtering, date/session atomic selection, no-schedule state, first linked-textbook default, class-change recalculation, explicit clear persistence, and registration completion without a textbook.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/ops-task-service-loading.test.mjs tests/ops-task-workspace.test.mjs tests/registration-workflow.test.mjs`

Expected: FAIL on schedule selection and optional-textbook behavior.

- [ ] **Step 3: Add selected-class-only schedule hydration**

Fetch `schedule_plan` only when a registration class is selected. Merge the returned plan into that one option without changing the light registration class projection or the list's cache contract.

- [ ] **Step 4: Add the registration schedule picker**

Reuse existing schedule parsing and calendar patterns. Selecting an active session writes both `classStartDate` and `classStartSession`; changing classes clears stale values.

- [ ] **Step 5: Make textbook default and clear intentional**

On registration class change, select the first valid linked textbook. Add an explicit clear affordance. A clear action must remain empty for the same class and textbook-specific sync/audit must run only when an ID exists.

- [ ] **Step 6: Remove textbook as a universal completion blocker**

Require a textbook only for textbook-specific operations, not for registration completion. Keep class selection required.

- [ ] **Step 7: Verify GREEN and loading guard**

Run: `node --test tests/ops-task-service-loading.test.mjs tests/ops-task-workspace.test.mjs tests/registration-workflow.test.mjs`

Expected: all tests pass and the source contract proves all-class schedule hydration was not reintroduced.

---

### Task 5: Chronological admission checklist

**Files:**
- Modify: `src/features/tasks/registration-workflow.js`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/registration-workflow.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Produces: visible ordered sequence `입학신청서 발송 -> 메이크에듀 등록(수업·교재) -> 청구서 발송 -> 수납 완료 확인 -> 등록 완료`.

- [ ] **Step 1: Write failing sequence and dependency tests**

Assert exact order and dependencies: MakeEdu follows admission notice, invoice follows MakeEdu, payment follows invoice, completion follows all four. Assert auto-sync rows and `교재 청구출고표` are absent from the visible form.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/registration-workflow.test.mjs tests/ops-task-workspace.test.mjs`

Expected: FAIL against the old payment-first order and extra rows.

- [ ] **Step 3: Update checklist logic and UI**

Reorder availability/blockers, remove the auto-sync and textbook-billing controls from the visible form, label the four manual checks exactly, and render `등록 완료` from the final pipeline state.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/registration-workflow.test.mjs tests/ops-task-workspace.test.mjs`

Expected: all tests pass.

---

### Task 6: Integration, quality, and browser verification

**Files:**
- Review all files changed by Tasks 1-5.

**Interfaces:**
- Consumes all prior tasks; produces final evidence only.

- [ ] **Step 1: Run focused integration tests**

Run the union of director, makeup, registration, loading, and date-time tests. Expected: zero failures.

- [ ] **Step 2: Run TypeScript and scoped ESLint**

Run: `pnpm exec tsc --noEmit`

Run ESLint on changed source/test files. Expected: exit 0.

- [ ] **Step 3: Run the broader test suite and production build**

Run: `node --test tests/*.test.mjs`

Run: `pnpm run build`

Report unrelated pre-existing failures exactly; never describe a partial pass as all green.

- [ ] **Step 4: Verify the rendered registration flow in Browser**

The flow under test is: `/admin/registration` -> open registration add/edit dialog -> complete required inquiry fields -> verify shared date/time picker -> choose a class -> choose a real schedule session -> verify textbook default and clear -> verify director default -> verify checklist order.

Check desktop `1357x987` and mobile `430x932`, no framework overlay, no relevant console errors, and no unintended database save during UI-only verification.

- [ ] **Step 5: Verify the rendered makeup rule**

Open the makeup-request form, select representative math and English classes, and verify the computed approver matches the shared rule without submitting a request.

- [ ] **Step 6: Request final code review**

Review the complete working-tree diff against the design and this plan. Fix every Critical or Important finding and rerun the covering tests.
