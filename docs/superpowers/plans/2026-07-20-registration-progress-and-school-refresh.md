# Registration Progress and School Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh configured schools on every registration entry, add a subject-aware top workflow stepper, render admission as one ordered five-step checklist, and restrict new level-test locations to 본관 or 별관.

**Architecture:** Reuse the existing active-track and authoritative admission models instead of adding parallel workflow state. Add small pure progress/location helpers, render them through registration-scoped presentation components, and preserve all existing RPC, conflict, history, shared-appointment, and provider-send boundaries.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Tailwind CSS, lucide-react, Node test runner, Supabase registration RPCs.

## Global Constraints

- One registration case remains one document; English and math remain independent tracks.
- The top stepper follows the currently selected subject track and uses `문의`, `레벨테스트`, `상담`, `등록·대기`, `입학 처리` in that exact order.
- Do not label skipped optional stages as completed; only `registered` is a fully completed workflow.
- Admission remains one case-wide panel and must not be duplicated per subject.
- Existing RPCs and external-message safety actions remain authoritative; a visual checkmark must not silently send a message.
- New level-test locations are exactly `본관` or `별관`; visit-consultation locations remain free text.
- Existing nonstandard level-test places remain readable in summaries, history, and conflict drafts.
- Do not add a table-wide enum/check that could reject legacy migration-review rows.
- Preserve `.pnpm-store/` and do not include it in commits.
- Do not trigger Google Chat, Web Push, SOLAPI, or any other real provider send during verification.

---

### Task 1: Fresh Registration School Catalog

**Files:**
- Modify: `tests/registration-school-options.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

**Interfaces:**
- Consumes: `ensureRegistrationOptions(force?: boolean)`.
- Produces: every registration entry path calls `ensureRegistrationOptions(true)`.

- [ ] **Step 1: Write failing tests**

Add a pure choice case proving `{ name: "기타", category: "elementary" }` appears for `초1`. Add source-contract assertions for the four entry points:

```js
assert.deepEqual(
  schoolOptions.getRegistrationSchoolChoices({
    schools: [{ id: "other", name: "기타", category: "elementary", sortOrder: 1 }],
    grade: "초1",
  }),
  [{ value: "기타", label: "기타", legacy: false }],
)
assert.equal((workspaceSource.match(/ensureRegistrationOptions\(true\)/g) || []).length >= 4, true)
```

- [ ] **Step 2: Verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-school-options.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: the force-refresh entry assertion fails because current entry paths omit `true`.

- [ ] **Step 3: Implement minimal refresh**

Change the create, edit, track-detail, and appointment-detail entry paths to call:

```ts
void ensureRegistrationOptions(true)
```

or await the same call where the path is already async.

- [ ] **Step 4: Verify GREEN and commit**

Run the Task 1 command again and commit only Task 1 files with `fix: refresh registration school options`.

### Task 2: Subject-Aware Top Progress Stepper

**Files:**
- Create: `src/features/tasks/registration-application-progress-stepper.tsx`
- Modify: `src/features/tasks/registration-application-model.ts`
- Modify: `src/features/tasks/registration-application-shell.tsx`
- Modify: `src/features/tasks/registration-application-create.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-initial-plan-control.tsx`
- Modify: `tests/registration-application-model.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces: `getRegistrationApplicationProgress(status)` returning five ordered steps with `state: "reached" | "current" | "upcoming" | "complete" | "terminal"`.
- Produces: `RegistrationApplicationProgressStepper` with `aria-current="step"` on the current or terminal step.
- Consumes: existing `activeTrackId`, `focusTrackId`, and track status; no new workflow state.

- [ ] **Step 1: Write failing model and source tests**

Cover create/inquiry, `level_test_scheduled`, `consultation_waiting`, `waiting`, `enrollment_processing`, `registered`, `not_registered`, and `inquiry_closed`. Assert the shell renders `subjectNavigation` and `progress` before the section loop, and old generic `ReadonlyInitialField label="진행상태"` is absent.

- [ ] **Step 2: Verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs
```

Expected: missing progress helper/component and old inline-status assertions fail.

- [ ] **Step 3: Implement the pure model and component**

Use the existing section order and track status mapping. Render an ordered responsive list; every item includes a lucide icon plus visible state text. Only `registered` returns five `complete` steps. Closed outcomes return one `terminal` step and do not complete later steps.

- [ ] **Step 4: Wire create and detail**

Add shell slots:

```ts
subjectNavigation?: ReactNode
progress: ReactNode
```

Render them below the header. Move the existing saved-detail subject tabs into `subjectNavigation`; derive `progress` from the active track. Create passes inquiry-current progress. Remove repeated per-section generic status labels while retaining operational status facts.

- [ ] **Step 5: Verify GREEN and commit**

Run the Task 2 command and commit Task 2 files with `feat: add registration progress stepper`.

### Task 3: Canonical Level-Test Place Selection

**Files:**
- Create: `src/features/tasks/registration-level-test-place.ts`
- Modify: `src/features/tasks/registration-initial-plan-control.tsx`
- Modify: `src/features/tasks/registration-intake-workflow.ts`
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `tests/registration-intake-workflow.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-track-service.test.mjs`

**Interfaces:**
- Produces: `REGISTRATION_LEVEL_TEST_PLACES = ["본관", "별관"] as const` and `normalizeRegistrationLevelTestPlace(value): "본관" | "별관" | null`.
- Existing read models continue exposing `place: string`.

- [ ] **Step 1: Write failing tests**

Assert the helper accepts trimmed canonical values and rejects blanks/arbitrary rooms; initial workflow blockers reject `본관 201호`; service save rejects a noncanonical `level_test` place but accepts the same free text for `visit_consultation`; source tests require a select for level tests and retain an input for visit consultation.

- [ ] **Step 2: Verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-intake-workflow.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
```

Expected: helper import or canonical-place assertions fail.

- [ ] **Step 3: Implement validation and UI**

Use a default-empty native select with exactly `본관`, `별관` in create. In the shared appointment editor, render that select only for `kind === "level_test"`; keep the existing input for visit consultations. If an editable saved level-test appointment has a legacy place, keep the state untouched, show `기존 저장 장소: <value>`, bind the select to empty, and require a canonical selection before saving.

- [ ] **Step 4: Preserve legacy reads**

Do not narrow `OpsRegistrationAppointment.place`, conflict drafts, history, calendar, summaries, or migration snapshots. Add the canonical check only to initial workflow validation and normal level-test save calls.

- [ ] **Step 5: Verify GREEN and commit**

Run the Task 3 command and commit Task 3 files with `feat: constrain level test place`.

### Task 4: Ordered Admission Progress Checklist

**Files:**
- Create: `src/features/tasks/registration-admission-progress.tsx`
- Modify: `src/features/tasks/registration-application-create.tsx`
- Modify: `src/features/tasks/registration-enrollment-editor.tsx`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-track-model.test.mjs`

**Interfaces:**
- Consumes: `getRegistrationAdmissionBatchChecklist()` and current existing send/batch/makeedu/invoice/payment/complete controls.
- Produces: one `<ol aria-label="입학 처리 진행">` with exactly five ordered items.

- [ ] **Step 1: Write failing tests**

Assert the first incomplete checklist key is current, all complete returns no current item, create uses the same five labels, the saved editor renders one ordered list, and all existing admission action calls remain present once.

- [ ] **Step 2: Verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-track-model.test.mjs tests/registration-track-workspace.test.mjs
```

Expected: ordered-list/current-step assertions fail against the current card/button layout.

- [ ] **Step 3: Implement ordered presentation**

Create a focused visual wrapper accepting five steps and their existing content. Render a check indicator for complete rows, `aria-current="step"` on the first incomplete row, and nested content below each label. Move the existing message action into step 1, target selection and MakeEdu controls into step 2, and existing advance/complete actions into steps 3–5 without changing their RPC calls or disabled conditions.

- [ ] **Step 4: Verify GREEN and commit**

Run the Task 4 command and commit Task 4 files with `feat: add admission progress checklist`.

### Task 5: Integration, Browser QA, and Review

**Files:**
- Modify as needed: `scripts/verify-ops-task-browser-workflow.mjs`
- Verify: all changed source and test files

- [ ] **Step 1: Run focused and full verification**

Run focused registration tests, the full Node test suite, TypeScript, ESLint, and `git diff --check`. Every command must exit zero before completion.

- [ ] **Step 2: Run browser verification without provider sends**

At `http://localhost:3001/admin/registration`, verify:

1. `초1` school candidates include `기타` after a registration re-entry without page reload.
2. Create shows inquiry-current top progress and no inline generic 진행상태 field.
3. Saved English/math tabs change the top active progress step.
4. Level-test place presents only 본관 and 별관; visit place stays free text.
5. Admission renders one five-item ordered checklist and no duplicate case-wide action.
6. Desktop and narrow viewport layouts remain usable.

- [ ] **Step 3: Review and integrate**

Request a whole-diff code review, fix every Critical/Important finding with focused tests, rerun full verification, then merge the feature commits locally into `main`. Do not push or deploy.
