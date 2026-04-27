# V2 Operational Data Workspace Upgrade Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make v2 operational CRUD/data-table screens feel closer to Excel, spreadsheets, Airtable, and Notion by removing card-heavy chrome and upgrading the shared data-workspace UX for faster scanning and manipulation.

**Architecture:** Keep existing domain models and routes intact while refactoring the presentation layer of the shared management table plus the annual-board and class-schedule operational surfaces. Favor dense toolbar + sticky-grid + compact inspector patterns instead of stacked cards and decorative shells.

**Tech Stack:** Next.js 16, React, TypeScript/TSX, TanStack Table, shadcn/ui.

---

### Task 1: Source-backed UX principles and current-surface audit
**Objective:** Translate spreadsheet/admin best practices into concrete UI targets for this repo.

**Files:**
- Modify: `docs/plans/2026-04-21-v2-operational-data-workspace-upgrade.md`
- Inspect: `v2/src/features/management/management-data-table.tsx`
- Inspect: `v2/src/features/operations/academic-annual-board-workspace.tsx`
- Inspect: `v2/src/features/operations/class-schedule-workspace.tsx`

**Step 1:** Record applied guidance.
- Prefer dense tables over cards for CRUD-heavy workflows.
- Use sticky headers / fixed key columns where practical.
- Use direct search/filter/reset actions above the data, not explanatory cards.
- Convert inspector/detail content from stacked cards into compact sectioned panels.
- Replace decorative progress/card widgets with scan-friendly text/pill/table summaries.

**Step 2:** Verify target surfaces are the operational ones named by the user.

### Task 2: Upgrade shared management table toward spreadsheet feel
**Objective:** Make students/classes/textbooks management look and feel more like a real data grid.

**Files:**
- Modify: `v2/src/features/management/management-data-table.tsx`
- Test: `tests/v2-management-shell-polish.test.js`

**Step 1:** Remove card-ish identity cells and unnecessary soft chrome.
**Step 2:** Improve density, sticky header behavior, and toolbar/action layout.
**Step 3:** Keep column config powerful but visually quieter.
**Step 4:** Update source-contract tests.

### Task 3: Rebuild annual-board shell into a denser operational grid
**Objective:** Keep the annual board table-first and remove surrounding card/sheet heaviness.

**Files:**
- Modify: `v2/src/features/operations/academic-annual-board-workspace.tsx`
- Test: `tests/v2-academic-annual-board-ux.test.js`

**Step 1:** Convert filter wrapper and board wrapper from card shells to compact bordered workspace sections.
**Step 2:** Tighten cell visuals toward spreadsheet-like scanability.
**Step 3:** Convert detail sheet from stacked cards to compact data sections.
**Step 4:** Update source-contract tests.

### Task 4: Rebuild class-schedule list + inspector into a table-first CRUD workspace
**Objective:** Make 수업계획-수업 목록 feel like an operational list with compact inspector blocks instead of dashboard cards.

**Files:**
- Modify: `v2/src/features/operations/class-schedule-workspace.tsx`
- Test: `tests/v2-class-schedule-selection-detail.test.js`

**Step 1:** Convert the main list wrapper into a denser grid shell with sticky table headers.
**Step 2:** Replace progress-bar-heavy cells with text-first summaries where useful.
**Step 3:** Convert right-side inspector and sync-group areas from cards into compact section blocks.
**Step 4:** Update source-contract tests.

### Task 5: Verification
**Objective:** Prove the UI refactor preserved behavior and builds cleanly.

**Files:**
- Test: `tests/v2-management-shell-polish.test.js`
- Test: `tests/v2-academic-annual-board-ux.test.js`
- Test: `tests/v2-class-schedule-selection-detail.test.js`
- Test: `tests/v2-management-records.test.js`
- Test: `tests/v2-operations-records.test.js`

**Step 1:** Run targeted node tests.
**Step 2:** Run `npm run build` in `v2/`.
**Step 3:** Fix any source-contract drift introduced by the redesign.
