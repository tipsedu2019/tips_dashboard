# Task 9 fix round 1 re-review

## Finding verdict

- **I1 — Preserve independent dirty owners when a recovered create opens its resulting plan** — **ADDRESSED**. `src/features/academic/timetable-workspace.tsx:221-252` now keeps picker, editor, and transfer dirty states separately and ORs them with the plan draft. The create/clone commit no longer clears picker dirty. `src/features/academic/timetable-plan-workspace.tsx:75-87,115,302` forwards editor and transfer state to separate callbacks and clears only those owners on plan unmount. The unchanged picker continuation retains `mode='rename'` after the original receipt (`src/features/academic/timetable-plan-picker.tsx:202-217`), so the transfer mount's `false` callback cannot disable its guard.

## New breakage in the fix diff

- **Critical/Important: None found.** The new regression script at `scripts/qa/timetable-dirty-owner-browser.mjs:10-37` covers create and clone, then save and explicit discard. It verifies the original immutable retry, resulting plan/transfer mount, no stored original metadata, a guarded synthetic `beforeunload`, a native browser close warning that is dismissed, exact DB name after save/discard, and guard release. Retained RED is 4/4 at the guard assertion; retained GREEN is 4/4 (`docs/qa/timetable-presets-20260923/evidence/task9-fix1-dirty-red.json`, `docs/qa/timetable-presets-20260923/task9-dirty-owner-results.json`).
- Deferred Minor M1 and M2 from review 1 remain open outside this fix's product diff. The latest safe-environment build still logs four synthetic `public_classes_read_failed` 403 blocks (`docs/qa/timetable-presets-20260923/evidence/task9-fix1-build.log:12-48`); the QA report describes this accurately. Narrow-screen legacy candidate date wrapping was not changed.

## Out-of-scope observations

- `tests/class-schedule-draft-navigation.test.mjs` remains 15/19 at both the pre-fix base and current branch, versus 19/19 at the feature origin with the identical test blob. Its helper recognizes the old write shape, while the branch uses `update_class_operational_v1` with `p_patch.schedule_plan`. This predates the I1 fix and requires final whole-branch triage; it is not a newly introduced fix-diff finding. The comparison does not establish whether the product save flow works (`docs/qa/timetable-presets-20260923/evidence/task9-fix1-unrelated-baseline.log`, `task9-fix1-unrelated-origin.log`).

## Checks and boundaries

- Read the scoped brief, controller notes, global constraints, review 1, fix report, supplied fix package, affected source, and retained evidence. The fix report names the covering browser and Node runs and gives their outcomes; inspected raw JSON/logs agree. Focused Node 56/56, TypeScript exit 0, touched-path ESLint exit 0, and release build exit 0 are recorded in `docs/qa/timetable-presets-20260923/evidence/task9-fix1-command-results.json` and matching logs. Empty TypeScript/lint logs alone do not prove exit status; the command-result record supplies that claim.
- No suite was rerun: the actual integration proof addresses the named I1 path, and source inspection raised no unanswered fix-specific risk. No production, DB, server, checkout, index, HEAD, or branch action was performed in this review.

**Fix round: All findings addressed, no new Critical/Important breakage.** M1/M2 stay deferred Minor; the unrelated four-test branch regression stays with final whole-branch triage.
