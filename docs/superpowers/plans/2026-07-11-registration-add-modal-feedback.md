# Registration Add Modal Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the registration add modal accept an English and math inquiry together, explain its three initial requirements, save early level-test or consultation reservations into the correct workflow stage, and remove the irrelevant existing-student selector and verbose top-right close button.

**Architecture:** Keep the single registration case and existing scalar `ops_tasks.subject` column. Add pure workflow helpers for canonical subject serialization and early-stage inference, consume the workflow's `enabledSections` in the form, and preserve the inquiry subject when later management links are synchronized. No schema migration is required.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Supabase.

## Global Constraints

- Initial registration requirements remain `학생명`, at least one `과목`, and a valid 01x `학부모 전화`.
- `학년`, `학교`, `학생 전화`, `문의 채널`, and `문의일시` are optional for the initial save.
- Level-test and consultation fields are editable from the inquiry stage; placement and admission fields remain stage-gated.
- A level-test reservation date promotes an inquiry to pipeline prefix `1.`; a consultation reservation promotes it to prefix `2.`.
- Multiple subjects are stored canonically as `영어, 수학` and remain filterable by either subject.
- Existing single-subject records remain readable and writable.
- The top-right close control keeps its accessible name and dirty-form handling while displaying only the X icon.

---

### Task 1: Lock Workflow Behavior With Failing Tests

**Files:**
- Modify: `tests/registration-workflow.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Produces: `parseRegistrationSubjects(value: unknown): string[]`
- Produces: `serializeRegistrationSubjects(values: unknown[]): string`
- Produces: `getRegistrationPrefillPipelineStatus(input: object): string`
- Produces: UI source contracts for enabled early sections, icon-only close, required/optional labels, no existing-student selector, and clickable registration save.

- [x] **Step 1: Add workflow tests**

```js
assert.deepEqual(parseRegistrationSubjects("영어, 수학"), ["영어", "수학"]);
assert.equal(serializeRegistrationSubjects(["수학", "영어", "수학"]), "영어, 수학");
assert.deepEqual(
  getRegistrationFormState("0. 등록 문의", "requested").enabledSections,
  ["inquiry", "level_test", "consultation"],
);
assert.match(getRegistrationPrefillPipelineStatus({ registration: { pipelineStatus: "0. 등록 문의", levelTestAt: "2026-07-12T10:00" } }), /^1\./);
assert.match(getRegistrationPrefillPipelineStatus({ registration: { pipelineStatus: "0. 등록 문의", phoneConsultationAt: "2026-07-12T11:00" } }), /^2\./);
```

- [x] **Step 2: Add source-contract tests**

```js
assert.doesNotMatch(formDialogSource, /showCloseButtonText/);
assert.match(registrationFormSource, /registrationFormState\.enabledSections\.includes\(sectionKey\)/);
assert.doesNotMatch(inquirySource, /기존 학생 연결/);
assert.match(inquirySource, /requirement="required"/);
assert.match(inquirySource, /requirement="optional"/);
assert.match(formDialogSource, /disabled=\{saving \|\| \(!canSubmitCurrentForm && form\.type !== "registration"\)\}/);
```

- [x] **Step 3: Run the tests and verify RED**

Run: `node --test tests/registration-workflow.test.mjs tests/ops-task-workspace.test.mjs`

Expected: failures for missing subject helpers, missing prefill status inference, locked early sections, visible close text, the existing-student selector, and the registration save-button contract.

### Task 2: Implement Workflow And Persistence Rules

**Files:**
- Modify: `src/features/tasks/registration-workflow.js`
- Modify: `src/features/tasks/ops-task-service.ts`

**Interfaces:**
- Consumes: existing `REGISTRATION_PIPELINE_STATUSES` and scalar `OpsTaskInput.subject`.
- Produces: the three pure workflow helpers from Task 1.
- Preserves: the inquiry's canonical subject string during registration management-link synchronization.

- [x] **Step 1: Add canonical subject parsing and serialization**

```js
export function parseRegistrationSubjects(value) {
  const subjects = text(value).split(/[,·/+]/).map(text).filter(Boolean);
  return [...new Set(subjects)].sort((left, right) => REGISTRATION_SUBJECT_ORDER.indexOf(left) - REGISTRATION_SUBJECT_ORDER.indexOf(right));
}

export function serializeRegistrationSubjects(values = []) {
  return parseRegistrationSubjects(values.join(", ")).join(", ");
}
```

- [x] **Step 2: Enable early reservation sections and infer the saved pipeline**

```js
const minimumEditableIndex = REGISTRATION_FORM_STAGES.indexOf("consultation");
enabledSections: terminal
  ? []
  : REGISTRATION_FORM_STAGES.slice(0, Math.max(historicalIndex, minimumEditableIndex) + 1),
```

`getRegistrationPrefillPipelineStatus()` keeps non-inquiry statuses unchanged, chooses prefix `3.` for a completed consultation timestamp, `2.` for phone or visit reservation timestamps, `1-1.` for a level-test completion timestamp/result, `1.` for a level-test reservation timestamp, and otherwise keeps prefix `0.`.

- [x] **Step 3: Preserve inquiry subjects during registration link sync**

```ts
subject: text(input.subject) || text(classRow?.subject) || null,
```

- [x] **Step 4: Run workflow tests and verify GREEN**

Run: `node --test tests/registration-workflow.test.mjs`

Expected: all workflow tests pass.

### Task 3: Implement The Registration Form UX

**Files:**
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Test: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Consumes: `parseRegistrationSubjects`, `serializeRegistrationSubjects`, and `getRegistrationPrefillPipelineStatus`.
- Produces: a two-toggle registration subject control that writes the canonical scalar subject string.

- [x] **Step 1: Add explicit field requirement labels**

Add a small `FormFieldLabel` renderer with `required` and `optional` states. Apply `required` to student name, subject, and parent phone, and `optional` to the other inquiry fields. Show an inline parent-phone format error for a non-empty invalid value.

- [x] **Step 2: Replace the registration subject listbox with two multi-select toggles**

```tsx
<RegistrationSubjectField
  label={<FormFieldLabel label="과목" requirement="required" />}
  values={parseRegistrationSubjects(form.subject)}
  onChange={(values) => updateForm("subject", serializeRegistrationSubjects(values))}
/>
```

- [x] **Step 3: Remove the existing-student selector and unlock early sections**

Use `registrationFormState.enabledSections.includes(sectionKey)` for `RegistrationFormSection.enabled`. Delete the inquiry-stage `LinkedSelect` labeled `기존 학생 연결`.

- [x] **Step 4: Make save actionable and derive early workflow status**

Keep the Save button enabled for registration forms unless `saving` is true. On submit, replace a prefix-0 pipeline with `getRegistrationPrefillPipelineStatus(form)` before normalization so transition validation can report any missing appointment-specific field.

- [x] **Step 5: Keep the top-right close icon-only**

Remove `showCloseButtonText` from the form `DialogContent`; preserve `closeButtonLabel` and `onCloseButtonClick`.

- [x] **Step 6: Make subject filters membership-aware**

Build the subject filter options by flattening `parseRegistrationSubjects(task.subject)` and match a selected subject with `.includes(selectedSubjectFilter)`.

- [x] **Step 7: Run focused tests and verify GREEN**

Run: `node --test tests/registration-workflow.test.mjs tests/ops-task-workspace.test.mjs`

Expected: all focused tests pass.

### Task 4: Verify The Real Surface

**Files:**
- No committed verification artifacts.

**Interfaces:**
- Verifies: `/admin/registration?flow=consulting` in the in-app browser.

- [x] **Step 1: Run static verification**

Run: `pnpm exec eslint src/features/tasks/registration-workflow.js src/features/tasks/ops-task-service.ts src/features/tasks/ops-task-workspace.tsx tests/registration-workflow.test.mjs tests/ops-task-workspace.test.mjs`

Run: `pnpm build`

Run: `git diff --check`

Expected: every command exits 0.

- [x] **Step 2: Verify the desktop interaction**

Open Registration Add, confirm the top-right close control is icon-only, select both subjects, enter a valid 010 parent number and a level-test or consultation reservation, save, and confirm the case appears in `상담/레벨테스트` with `영어, 수학` persisted.

The visible interaction, validation, enabled reservations, and dual-subject state were verified. A unique `영어, 수학` case was saved, advanced through inquiry, level-test reservation/completion, consultation reservation/completion, inquiry-only close, canceled-outcome reopen, and deletion paths. Follow-up database counts confirmed zero residual task, detail, or student fixture rows.

- [x] **Step 3: Verify mobile layout**

At 390x844, confirm required/optional labels remain readable, both subject toggles are reachable, enabled reservation fields accept input, and the modal has no horizontal overflow or obscured actions.
