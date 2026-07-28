# Lesson Design Legacy Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved legacy lesson-design usability fixes while preserving the existing `schedule_plan` save contract.

**Architecture:** Keep `ClassScheduleWorkspace` as the only legacy save boundary. Add a small pure progress-draft helper so the child dialog can edit locally, then apply one session’s changes atomically to the existing parent draft. Keep calendar state logic in `class-schedule-planner.js`; it is already implemented locally and is a release-verification item, not a rewrite.

**Tech Stack:** Next.js App Router, React, TypeScript, shadcn/Radix Dialog, Node test runner, Vitest, ESLint, Next Webpack build.

## Global Constraints

- Preserve the existing `schedule_plan` data shape and server save endpoint.
- Keep the visible calendar sequence exactly `정상 → 휴강 → 보강 → 미정 → 해제 → 정상` on timetable and non-timetable dates.
- A skipped date preserves its original session ID and progress draft until restored.
- Candidate textbooks must be limited to the selected class subject; display `science` as `과학`.
- Do not write class timetable fields, `schedule_overrides`, new database columns, migrations, RPCs, backfill, or capability activation.
- Do not expose UUIDs in visible UI.
- Do not enable Google Chat, Web Push, SOLAPI, notification workers, or permission prompts.
- Use one inline task at a time. Do not use subagents.
- Commit only after Git write access is available; do not use destructive Git recovery commands.

---

## File map

- `src/features/operations/class-schedule-workspace.tsx` — legacy lesson-design state, textbook UI, progress-dialog integration, and parent modal route lifecycle.
- `src/features/operations/lesson-progress-draft.ts` — pure immutable helpers for child-dialog textbook-progress drafts.
- `src/lib/class-schedule-planner.js` — existing calendar transition and skipped-session planner behavior; verify only.
- `tests/lesson-design-page.test.mjs` — source-level regression checks for the workspace’s visible legacy UX.
- `tests/lesson-progress-draft.node.ts` — pure draft isolation and apply-payload behavior (Node-only, excluded from Vitest discovery).
- `tests/lesson-design-page.test.mjs` and `tests/admin-shell.test.mjs` — source-level dialog lifecycle and duplicate-close regression coverage. The former standalone `dialog-exit-lifecycle` suite was removed upstream before this release was rebased.
- `tests/class-schedule-planner-calendar-toggle.test.mjs` — existing five-state calendar transition coverage.
- `docs/superpowers/specs/2026-07-28-lesson-design-legacy-release-design.md` — approved scope; do not expand it in this release.

### Task 1: Simplify textbook candidates and connected-textbook UI

**Files:**
- Modify: `src/features/operations/class-schedule-workspace.tsx:84-112,2469-2473,2724-2800,4256-4281,4800-5160`
- Modify: `tests/lesson-design-page.test.mjs`

**Interfaces:**
- Consumes: `normalizeLessonSubjectKey(value)`, `getLessonSubjectDisplayLabel(value)`, `getTextbookSubject(book)`, `lessonDesignSnapshot.plannerSubject`, and `handleLessonTextbookCatalogChange()`.
- Produces: a candidate list containing only books whose normalized subject equals the selected class subject, and a connected-textbook card whose title line includes read-only metadata.

- [x] **Step 1: Write failing source regression assertions for the reduced textbook UI**

  Add a test that extracts the textbook-finder and connected-textbook section and asserts that it has no subject-filter state or subject buttons, no `전체 기간`, `현재 회차부터`, or `<details>` `교재 정보`, and that candidate cards render `getLessonSubjectDisplayLabel(getTextbookSubject(book))`.

  ```js
  test("lesson textbook UI limits candidates to the class subject and removes duplicate controls", async () => {
    const source = await readSource("src/features/operations/class-schedule-workspace.tsx");

    assert.doesNotMatch(source, /lessonTextbookSubjectFilter/);
    assert.doesNotMatch(source, /전체 기간/);
    assert.doesNotMatch(source, /현재 회차부터/);
    assert.doesNotMatch(source, /<summary[^>]*>교재 정보<\/summary>/);
    assert.match(source, /bookSubjectKey !== plannerSubjectKey/);
    assert.match(source, /getLessonSubjectDisplayLabel\(getTextbookSubject\(book\)\)/);
  });
  ```

- [x] **Step 2: Run the new regression test and confirm it fails**

  Run:

  ```bash
  node --test --experimental-strip-types tests/lesson-design-page.test.mjs
  ```

  Expected: FAIL because the legacy source still contains the subject filter and duplicate controls.

- [x] **Step 3: Remove subject-filter state and make candidate matching strict**

  Delete `lessonTextbookSubjectFilter`, `lessonTextbookFilterOptions.subjects`, the subject-filter label/count/chip entries, and the subject-button grid. Keep search, category, and publisher filtering.

  In `lessonTextbookOptions`, require both normalized values and equality before considering a candidate:

  ```ts
  const plannerSubjectKey = normalizeLessonSubjectKey(text(lessonDesignSnapshot?.plannerSubject));
  const bookSubjectKey = normalizeLessonSubjectKey(getTextbookSubject(book));
  if (!plannerSubjectKey || !bookSubjectKey || bookSubjectKey !== plannerSubjectKey) {
    continue;
  }
  ```

  Keep `getLessonSubjectDisplayLabel` as the sole display mapping, with its existing `science -> 과학` rule.

- [x] **Step 4: Remove duplicate connected-textbook controls and move metadata beside the title**

  Delete `handleLessonTextbookCatalogRange` call sites for `전체 기간` and `현재 회차부터`, then remove those two buttons. Delete the `<details>` block containing editable 표시명/영역/세부과목 fields.

  Replace the card’s secondary text and redundant range paragraph with one metadata line directly under the title:

  ```tsx
  <p className="mt-1 truncate text-xs text-muted-foreground">
    {[book.publisher, book.area, book.subSubject, getLessonSubjectDisplayLabel(book.subject)]
      .filter(Boolean)
      .join(" · ")}
  </p>
  ```

  Keep only role, start-session, end-session, and disconnect controls. The start/end selects remain the explicit way to choose the range.

- [x] **Step 5: Run the focused textbook regression suite**

  Run:

  ```bash
  node --test --experimental-strip-types tests/lesson-design-page.test.mjs tests/class-schedule-planner-textbook-ranges.test.mjs
  ```

  Expected: PASS with all existing route/textbook range tests and the new UI-regression test passing.

- [x] **Step 6: Inspect the Task 1 diff and commit**

  Run:

  ```bash
  git diff --check
  git diff -- src/features/operations/class-schedule-workspace.tsx tests/lesson-design-page.test.mjs
  git add src/features/operations/class-schedule-workspace.tsx tests/lesson-design-page.test.mjs
  git commit -m "feat: simplify lesson textbook setup"
  ```

  **Actual result:** The final scoped diff was included in release commit `b3a99b6b`, which passed `git diff --check` and is pushed to `origin/main`.

### Task 2: Move session-progress editing into an isolated child dialog

**Files:**
- Create: `src/features/operations/lesson-progress-draft.ts`
- Create: `tests/lesson-progress-draft.node.ts`
- Modify: `src/features/operations/class-schedule-workspace.tsx:2458-2476,3693-3745,4324-4550,5700-5860`
- Modify: `tests/lesson-design-page.test.mjs`

**Interfaces:**
- Consumes: a selected lesson session’s `textbookEntries`, each exposing `id`, `planStart`, `planEnd`, and `planLabel`.
- Produces: `createLessonProgressDraft(entries)`, `updateLessonProgressDraftEntry(draft, entryId, field, value)`, and `applyLessonProgressDraft(sessionId, draft)` in the workspace.

**Implementation status (2026-07-28):** The child-dialog workflow is implemented and released in `b3a99b6b`. The initial draft-test invocation exposed a Node ESM extension issue, which was corrected before the final passing run; it was not the planned pre-implementation failure. Final Node, Vitest, ESLint, and Webpack checks pass, and browser QA confirmed Cancel/Apply isolation without saving.

- [x] **Step 1: Write failing unit tests for isolated immutable drafts**

  Create `tests/lesson-progress-draft.node.ts`:

  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import { createLessonProgressDraft, updateLessonProgressDraftEntry } from "../src/features/operations/lesson-progress-draft";

  test("editing a progress draft does not mutate session entries", () => {
    const entries = [{ id: "math-1", planStart: "p.1", planEnd: "p.5", planLabel: "1단원" }];
    const draft = createLessonProgressDraft(entries);
    const changed = updateLessonProgressDraftEntry(draft, "math-1", "planEnd", "p.7");
    assert.equal(entries[0].planEnd, "p.5");
    assert.equal(changed[0].planEnd, "p.7");
  });

  test("updating one entry preserves the other textbook entries", () => {
    const draft = createLessonProgressDraft([
      { id: "a", planStart: "1", planEnd: "2", planLabel: "A" },
      { id: "b", planStart: "3", planEnd: "4", planLabel: "B" },
    ]);
    const changed = updateLessonProgressDraftEntry(draft, "a", "planLabel", "변경");
    assert.deepEqual(changed[1], draft[1]);
  });
  ```

- [x] **Step 2: Record the pre-implementation test result**

  Run:

  ```bash
  node --test --experimental-strip-types tests/lesson-progress-draft.node.ts
  ```

  **Actual result:** This fail-first run was not captured because the helper already existed when the plan was reconciled. The completed implementation is covered by the final passing suite; do not remove it merely to recreate an obsolete failure.

- [x] **Step 3: Implement the pure draft helper**

  Create `lesson-progress-draft.ts` with the exact narrow shape:

  ```ts
  export type LessonProgressDraftEntry = {
    id: string;
    planStart: string;
    planEnd: string;
    planLabel: string;
  };

  export function createLessonProgressDraft(entries: LessonProgressDraftEntry[]) {
    return entries.map((entry) => ({ ...entry }));
  }

  export function updateLessonProgressDraftEntry(
    draft: LessonProgressDraftEntry[],
    entryId: string,
    field: "planStart" | "planEnd" | "planLabel",
    value: string,
  ) {
    return draft.map((entry) => entry.id === entryId ? { ...entry, [field]: value } : entry);
  }
  ```

- [x] **Step 4: Integrate a child dialog with Cancel and Apply boundaries**

  Add `progressDialogSessionId` and `lessonProgressDraft` state in `ClassScheduleWorkspace`. Clicking a board session with textbook entries opens the child dialog and initializes the draft from that session. Render it as a sibling `<Dialog>` after the parent dialog, never inside the inline right-side editor.

  The child dialog must use this event flow:

  ```ts
  const closeLessonProgressDialog = () => {
    setProgressDialogSessionId("");
    setLessonProgressDraft([]);
  };

  const applyLessonProgressDraft = () => {
    if (!progressDialogSessionId) return;
    updateLessonPlanDraft((current) => updateSessionTextbookEntries(current, progressDialogSessionId, lessonProgressDraft));
    closeLessonProgressDialog();
  };
  ```

  `updateSessionTextbookEntries` must only replace matching textbook-entry plan fields for `progressDialogSessionId`; it must retain every other session and every non-plan field. Cancel, overlay close, Escape, and the close button call `closeLessonProgressDialog` without `updateLessonPlanDraft`.

  Replace the inline progress inputs in `renderLessonMonthSessionDetails` and the right-hand editor with a summary and an `진도 입력` button. Preserve session navigation and existing progress-completion badges.

- [x] **Step 5: Add source regression assertions for the child-dialog boundary**

  Add a test that verifies the workspace contains `data-testid="lesson-progress-dialog"`, `진도 입력`, explicit `취소` and `적용` buttons, and an `onOpenChange` that closes the child draft without saving. Assert the inline editor no longer calls `handleLessonTextbookPlanChange` directly from an `<Input>`.

  ```js
  assert.match(source, /data-testid="lesson-progress-dialog"/);
  assert.match(source, />취소<\/Button>/);
  assert.match(source, />적용<\/Button>/);
  assert.match(source, /onOpenChange=\{\(open\) => \{\s*if \(!open\) closeLessonProgressDialog\(\);/);
  ```

- [x] **Step 6: Run draft and lesson-design tests**

  Run:

  ```bash
  node --test --experimental-strip-types tests/lesson-progress-draft.node.ts tests/lesson-design-page.test.mjs
  ```

  Expected: PASS. The tests demonstrate that Cancel cannot update the parent draft and Apply has a single-session update path.

- [x] **Step 7: Inspect the Task 2 diff and commit**

  Run:

  ```bash
  git diff --check
  git diff -- src/features/operations/lesson-progress-draft.ts src/features/operations/class-schedule-workspace.tsx tests/lesson-progress-draft.node.ts tests/lesson-design-page.test.mjs
  git add src/features/operations/lesson-progress-draft.ts src/features/operations/class-schedule-workspace.tsx tests/lesson-progress-draft.node.ts tests/lesson-design-page.test.mjs
  git commit -m "feat: edit lesson progress in a dialog"
  ```

  Expected: no whitespace errors; if Git metadata remains read-only, do not retry with elevated or destructive commands.

### Task 3: Give the parent lesson-design modal one close owner

**Implementation status (2026-07-28):** Steps 1–4 are implemented locally. The upstream rebase removed the standalone lifecycle suite, so its source-level coverage now lives in the shared lesson-design and admin-shell suites. ESLint, TypeScript, and `git diff --check` pass; browser QA passed and the release commit was created.

**Files:**
- Modify: `src/features/operations/class-schedule-workspace.tsx:3808-3820,4014-4019,6381-6410`
- Modify: `tests/lesson-design-page.test.mjs`
- Verify: `tests/admin-shell.test.mjs`

**Interfaces:**
- Consumes: `Dialog`’s controlled `open` and `onOpenChange` contract, `closeLessonDesignWorkspace()`, and `requestedLessonReturnPath`.
- Produces: `requestLessonDesignClose()` as the sole route-clearing close command; `handleLessonDesignOpenChange(false)` delegates to it exactly once.

- [x] **Step 1: Write a failing lifecycle regression test for duplicate close routing**

  Add a focused source assertion and a reducer-level test:

  ```ts
  test("a second close request while closing leaves the lifecycle unchanged", () => {
    const closing = reduceDialogLifecycle("open", "request-close");
    expect(reduceDialogLifecycle(closing, "request-close")).toBe("closing");
  });
  ```

  ```js
  assert.match(source, /const requestLessonDesignClose = useCallback/);
  assert.match(source, /if \(!open\) \{\s*requestLessonDesignClose\(\);\s*\}/);
  assert.doesNotMatch(source, /setLessonDesignOpen\(open\);\s*if \(!open\)/);
  ```

- [x] **Step 2: Run the lifecycle and source tests to confirm failure**

  Run:

  ```bash
  node --test --experimental-strip-types tests/lesson-design-page.test.mjs
  ```

  Expected: source assertion FAIL because `handleLessonDesignOpenChange` currently calls `setLessonDesignOpen(false)` and then calls a function that sets it again.

- [x] **Step 3: Make one close handler own state and route restoration**

  Rename `closeLessonDesignWorkspace` to `requestLessonDesignClose`. It must set `lessonDesignOpen` false and perform exactly one `router.replace`. Change `handleLessonDesignOpenChange` to delegate only when closing:

  ```ts
  const handleLessonDesignOpenChange = useCallback((open: boolean) => {
    if (open) {
      setLessonDesignOpen(true);
      return;
    }
    requestLessonDesignClose();
  }, [requestLessonDesignClose]);
  ```

  Update every parent close/return button to call `requestLessonDesignClose`. Do not use `onOpenChange` to navigate on an open transition. Preserve the existing Dialog transition classes; do not add `hidden`, `invisible`, forced remounting, or a second route clear.

- [x] **Step 4: Run the lifecycle tests**

  Run:

  ```bash
  node --test --experimental-strip-types tests/lesson-design-page.test.mjs
  ```

  Expected: PASS. A close request changes dialog state once and leaves the animated Radix content available for its normal exit transition.

- [x] **Step 5: Inspect the Task 3 diff and commit**

  Run:

  ```bash
  git diff --check
  git diff -- src/features/operations/class-schedule-workspace.tsx tests/lesson-design-page.test.mjs tests/admin-shell.test.mjs
  git add src/features/operations/class-schedule-workspace.tsx tests/lesson-design-page.test.mjs tests/admin-shell.test.mjs
  git commit -m "fix: stabilize lesson design modal close"
  ```

  **Actual result:** The release was committed as `7d427420` after rebasing the single release commit onto the current `origin/main`. The obsolete standalone lifecycle test was deliberately not restored.

### Task 4: Verify the already-implemented calendar toggle and release gate

**Verification status (2026-07-28):** The empty non-timetable first-click defect found during the initial browser QA was corrected with a regression test. A populated science class now visibly transitions `정상 → 휴강` on its first click, while the existing timetable cycle, textbook subject display (`과학`), child progress-dialog boundaries, and X/overlay/Escape/return close routes remain verified. No browser draft was saved. The completed release was committed as `b3a99b6b`, pushed to `origin/main`, and Vercel deployment completed successfully; no notification capability was enabled.

**Files:**
- Verify: `src/lib/class-schedule-planner.js:STATE_PRIORITY,applyCalendarDateToggle,isCountedScheduleState`
- Verify: `src/features/operations/class-schedule-workspace.tsx:handleLessonCalendarDateClick,handleLessonCalendarToggle`
- Verify: `tests/class-schedule-planner-calendar-toggle.test.mjs`
- Verify: `tests/lesson-design-page.test.mjs`
- Modify: `docs/superpowers/plans/2026-07-28-lesson-design-legacy-release.md` only to check completed boxes and record actual command results.

**Interfaces:**
- Consumes: existing `applyCalendarDateToggle({ currentState, hasBaseSession })` behavior and calendar-click handler.
- Produces: release evidence that baseline and exceptional dates cycle once per click and that skipped sessions restore without losing ID or progress data.

- [x] **Step 1: Run the calendar state suite without modifying the calendar implementation**

  Run:

  ```bash
  node --test --experimental-strip-types tests/class-schedule-planner-calendar-toggle.test.mjs tests/lesson-design-page.test.mjs
  ```

  Expected: PASS for base and non-base sequences, skipped exclusion from numbering, and one-click calendar-handler source assertions.

- [x] **Step 2: Run all targeted automated checks**

  Run:

  ```bash
  node --test --experimental-strip-types tests/class-schedule-planner-calendar-toggle.test.mjs tests/class-schedule-planner-textbook-ranges.test.mjs tests/lesson-progress-draft.node.ts tests/lesson-design-page.test.mjs
  node --test --experimental-strip-types tests/admin-shell.test.mjs
  node node_modules/eslint/bin/eslint.js src/features/operations/class-schedule-workspace.tsx src/features/operations/lesson-progress-draft.ts src/lib/class-schedule-planner.js tests/lesson-progress-draft.node.ts tests/lesson-design-page.test.mjs tests/class-schedule-planner-calendar-toggle.test.mjs
  node node_modules/next/dist/bin/next build --webpack
  ```

  Expected: all commands exit 0. Do not claim browser QA from these checks.

- [x] **Step 3: Perform browser QA only when a local class loads**

  **Actual result:** Browser QA was performed against `고1 통합과학2` with populated sessions. After the follow-up correction, an empty non-timetable cell visibly advances from `정상` to `휴강` on its first click. The test draft was closed without saving.

  Use a populated `/admin/curriculum?lessonDesign=1&classId=...` record and verify:

  1. A timetable date and a non-timetable date each cycle `정상`, `휴강`, `보강`, `미정`, `해제`, then `정상` with five clicks.
  2. Restoring `해제` preserves the same selected session and its textbook-plan text.
  3. Textbook finder shows only the class subject, and a science textbook displays `과학`.
  4. Selecting a progress session opens the child dialog; Cancel keeps the list unchanged; Apply updates only that session after the parent Save button is used.
  5. Close via X, overlay, Escape, and return button each leave the curriculum route once, without a second visual close.

  If the page still reports `classes 데이터를 불러오지 못했습니다.`, record browser QA as blocked. Do not deploy while it is blocked.

- [x] **Step 4: Final diff, status, and release decision**

  Run:

  ```bash
  git diff --check
  git status --short
  git diff --stat
  git diff -- docs/superpowers/specs/2026-07-28-lesson-design-legacy-release-design.md docs/superpowers/plans/2026-07-28-lesson-design-legacy-release.md src/features/operations/class-schedule-workspace.tsx src/features/operations/lesson-progress-draft.ts src/lib/class-schedule-planner.js tests
  ```

  **Actual result:** The rebased release commit passes `git diff --check`, the full Node suite (1,884 tests), Vitest, ESLint (zero errors), and the Webpack production build. The obsolete standalone lifecycle suite and a deleted legacy plan were intentionally not resurrected during the rebase; their relevant source-level coverage remains in the shared suites.
