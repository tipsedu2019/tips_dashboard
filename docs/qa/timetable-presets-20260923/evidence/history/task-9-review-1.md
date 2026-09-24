# Task 9 review 1

## Spec Compliance

- ❌ Issues found: the new picker recovery integration does not reliably preserve the navigation/beforeunload guard for unsaved follow-up metadata after a recovered create/clone. See Important I1. The import, durable evidence, rollback, source-CAS, manager-only recovery and scoped-revocation requirements inspected here are otherwise implemented.
- ⚠️ Cannot verify from this task diff alone: all four projections' stable-ID movement, every partial/all copy/move combination, historical operational writer locking and no-send behavior, and the complete two-connection race matrix. These were implemented before this base. `docs/qa/timetable-presets-20260923/REPORT.md:46-50` links retained Task1–8 evidence; the controller must apply its root acceptance map rather than treating Task9's evidence packaging as a new implementation review of them.
- ⚠️ Main CI, production migration, production legacy preference existence/recovery, deployed UI, provider Realtime/public-cache delivery, real operational promotion and provider sending are not verified here and are correctly recorded as unperformed (`REPORT.md:3,89`). No production action is needed for this local review.
- ⚠️ The reported 500-item/2000-slot frame p95 of 33.6–33.7 ms still misses the 32 ms target (`REPORT.md:85`). Task9 does not change that measured path. A local Task9 approval must not silently convert the retained Task8 limitation into a passed performance criterion; root acceptance must keep its explicit disposition.

## Strengths

- Management authorization is performed before source reads and again after the shared operating lock, before receipt lookup. The new import does not trust client provenance, checks the reviewed source fingerprint under a source-row lock, creates new UUIDs, and records one immutable receipt (`supabase/migrations/20260923150523_timetable_plan_import_recovery.sql:58-91,124-133`). Final captured ACLs give the private helpers only owner execution, while public RPCs retain explicit authenticated entry with server authorization.
- The legacy projection whitelists both ordinary metadata and the schedule-line payload later retained in pending slots. Student/status/arbitrary nested properties are not copied; missing subject is explicitly rejected; four source keys remain distinct (`20260923150523_timetable_plan_import_recovery.sql:12-32,60-65,108-118`). The import pgTAP assertions exercise actual RPC output, unchanged source rows, exact SQLSTATE, authorization and immutable replay (`supabase/tests/timetable_plan_import_test.sql:25-65`), rather than only matching SQL strings.
- Submitted metadata/import recovery retains the original command/key, separates metadata follow-up fields, and handles unavailable sessionStorage without claiming a server save. Actual DB browser fault injection loses the response after commit and verifies identical retry plus one resulting preset (`src/features/academic/timetable-plan-picker.tsx:87-135,184-227`; `timetable-plan-import-dialog.tsx:25-79`; `scripts/qa/timetable-rollout-browser.mjs:21-33`).
- Single-plan retirement is separate from actor logout. Related source/target transfers and metadata are removed while unrelated actor-scoped bytes remain; tests cover both related and unrelated metadata, and browser evidence explicitly labels its seeded permitted-plan recovery boundary (`src/features/academic/timetable-plan-recovery.ts:32-62`; `tests/timetable-plan-recovery.node.ts:5-19`; `scripts/qa/timetable-rollout-browser.mjs:51-62`).
- Failed refreshed references retain the last good board but disable new add/create/transfer interaction, with actual disabled-control clicks and zero corresponding mutation requests in the browser check (`timetable-plan-workspace.tsx:287`; `scripts/qa/timetable-rollout-browser.mjs:42-50`).
- Release/runbook boundaries are explicit: schema, no backfill, final definitions/ACL, capability, build-time UI flag, operating-read smoke, and non-deleting UI rollback (`docs/operations/timetable-presets-runbook.md:7-13,31-40`). Clean replay refuses an existing container and does not reset the original manual DB (`scripts/qa/timetable-clean-replay.py:3-6`). All 117 manifest hashes matched the current local migration bytes in my read-only comparison; all relative REPORT Markdown links resolved.
- The short-block title fix remains in the existing shared timetable block/CSS and is documented for both operating/preset grids and export (`components/legacy-timetable-grid.jsx:36-42`; `timetable-grid-skin.module.css:265`; `DESIGN.md:179`). The saved 390px dark image has no page overflow and uses the shared dialog/controls. A fresh matching-data visual comparison was not rerun.

## Issues

### Critical (Must Fix)

None found in the Task9 scope inspected.

### Important (Should Fix)

**I1 — Preserve independent dirty owners when a recovered create opens its resulting plan.**

Primary changed location: `src/features/academic/timetable-workspace.tsx:248` (also the single `formDirty` state at line 221 and the shared setter passed to the workspace at line 250).

Reproduction path from the code: submit create or clone; lose its response after the server commits; change the name to a follow-up value; reload and recover the original request. `timetable-plan-picker.tsx:202-217` removes the completed command from sessionStorage and intentionally leaves a `rename` continuation dialog with the follow-up fields, then invokes `onCommitted`. The parent clears `formDirty` and mounts the new plan. Once that plan snapshot arrives, the new transfer dialog's `useEffect(() => onPending(!!transfer?.command))` emits `false` (`timetable-transfer-dialog.tsx:42`); `TimetablePlanWorkspace` forwards it to that same parent setter (`timetable-plan-workspace.tsx:84`). This overwrites the picker's still-dirty form state. The picker effect only depends on mode/recovering/importDirty, so typing further fields does not restore the guard (`timetable-plan-picker.tsx:135`).

The follow-up name is now unsaved, its old recovery record has intentionally been removed, and `useDraftNavigation` receives false (`timetable-workspace.tsx:243`; `src/hooks/use-draft-navigation.tsx:25`). Reload/close/navigation can therefore lose it without the required warning. This is an integration defect, not an objection to the intentionally narrow submitted-command persistence boundary.

Use independent picker/editor/transfer dirty state and combine the active owners with OR, or an explicit owner-keyed registration. Switching plans must not clear another owner's active continuation form. Add a focused integration assertion for the existing lost-create/clone → reload → original receipt → follow-up rename path: after the new plan and its transfer session have mounted, the guard remains enabled until the follow-up is saved or explicitly discarded. The existing browser check verifies input retention and then cancels the dialog (`scripts/qa/timetable-rollout-browser.mjs:25-28`), so it does not answer this risk. Finding is static control-flow/effect evidence; no new browser run or DB mutation was performed.

### Minor (Nice to Have)

**M1 — Final build evidence remains noisy rather than pristine.** `docs/qa/timetable-presets-20260923/evidence/task9-release-build-final.log:13-48` contains four `public_classes_read_failed` blocks with 403 responses for classes/textbooks/progress_logs. The report correctly identifies the synthetic environment and does not claim production read success. This is not a new planner defect or build failure, but the reviewer rubric requires retaining the warning as a finding. If a future build fixture can return the intended safe public-read response, make that harness adjustment; otherwise keep the exact documented exception and do not summarize the build as error-free output. No production credentials should be introduced to silence it.

**M2 — Legacy candidate dates break inside a digit on narrow screens.** `src/features/academic/timetable-plan-import-dialog.tsx:94` applies `break-all` to the entire candidate label; the saved `docs/qa/timetable-presets-20260923/task9-import-mobile-dark.png` shows `2026-09-2` followed by `3` on the next line for each row. Use normal word wrapping for the label and a nonbreaking date span. This is a readability refinement, not a functional blocker.

## Assessment

**Task quality: Needs fixes.**

The import boundary and SQL tests are careful, and the report is unusually explicit about local/production and old/new evidence boundaries. I1 is a real cross-component ownership problem in the newly added recovery/dirty wiring and should be fixed before accepting Task9; the remaining two items are nonblocking.

## Exact checks and limits

- Reviewed supplied requirements: task-9 brief, controller notes, binding global constraints and reviewer rubric; applied TIPS quality/design and the Supabase authorization/locking guidance. `CONTEXT.md` and `docs/adr/` do not exist in this worktree. Quick memory search found no relevant timetable-preset history; no memory-derived factual claim is used.
- Reviewed package `review-ed3e7a31..49faaa8e.diff` for base `ed3e7a3199e1c222b274836cd5a7d3b8650a48af`, head `49faaa8ef5fbfa082f747fe24b5b266cf2c8b483`, in bounded passes: requirements/docs, all Task9 production code/SQL/test hunks, fixture/QA scripts, final evidence and retained-history inventory. The 220 preserved history artifacts were treated as historical evidence, not newly authored product code; I did not manually reread every historical raw SQL output line. No git command was rerun and no source/index/HEAD/branch was changed.
- Named dependency check: **import provenance and final authority**. Inspected the unchanged storage validator/receipt helper and located all definitions in ordered migrations; the validator/require/receipt helpers remain from `20260923081138`, the operating lock's final replacement is `20260923085008`, and the new import functions occur in the last listed feature migration `20260923150523`. Compared these contracts with the final captured `pg_get_functiondef`/ACL JSON. Confirmed first/new slot uses null client provenance and later kept slots match already inserted server provenance. No live DB query was run.
- Named dependency check: **pending malformed-time consumer compatibility**. Inspected service pending-slot guards omitted from the service diff hunk. They accept nullable integers for pending times, so preserving invalid-time diagnostic values does not make the saved snapshot unreadable. No additional finding.
- Named dependency check: **I1 dirty-owner overwrite**. Inspected the workspace's omitted setup and transfer onPending effect (their diff context cuts off these function bodies), plus the unchanged `use-draft-navigation.tsx` consumer. This establishes the callback/effect path and the guard's actual enabled condition. No broader navigation crawl or test suite rerun.
- Read-only evidence audit counted all 11 clean SQL TAP files: 657 `ok`, zero `not ok`, with the retained plan totals; read final focused/Node/build evidence and browser JSON/script assertions. These are inspected implementer results, not newly executed tests. Empty successful lint/tsc logs do not independently prove their exit status; exit-0 claims remain report/process evidence.
- Read-only SHA256 comparison: all 117 manifest migrations match; zero mismatches. Read-only REPORT relative-link check: zero missing targets. Inspected the saved 390×844 dark screenshot; did not rerun browser, performance, build, Node, SQL, migration replay, main CI or provider checks.
- No production access/actions, server starts/stops, dependency installation, DB writes or tests were performed. Only this review report is written.
