# Task6 implementation report

Status: DONE_WITH_CONCERNS (local UI scope complete; later-task/runtime boundaries below). Base05c0e487, branch codex/timetable-presets-20260923. Commit bddfcdc49e52d30c1b2b8957b5b779e013ed310e (`feat: edit timetable plans from all four views`).

## Scope and implemented behavior

All four existing view labels route through one canonical useTimetablePlan controller. No per-view saved state or shadow mutation was introduced. TimetableWorkspace owns the controller and shared view; its existing operational component stays mounted under hidden so operational preferences/read states remain intact. useDraftNavigation combines pending controller work with placement-form dirty state. Selecting a different plan, switching away, dismissal and route navigation use the shared confirmation.

New TimetablePlanPicker uses existing typed list/get/mutate/share RPCs for active/archived selection, create, rename/period, clone, archive/restore and sharing. List/service wrappers validate their response; late actor/list reads are guarded. Catalog resource filters store IDs independently of operational name preferences and display names through the shared TimetableTargetFilter optionLabels extension. Empty presets build panels from catalogs; empty catalogs show the relevant settings link. Archived and shadow entries are readonly.

TimetablePlanClassList is shared by desktop and mobile Sheet. Search/status filters preserve item-ID selections outside the filter, with explicit preset-wide/search-result scopes. Applied records and shadows cannot be selected. The Sheet item selection closes it, then the selected item can be placed through a cell/form. Safe basic-info copies from shadow create a new unplaced item without inventing sourceClass metadata. Actual transfer controls are deferred, not enabled placeholders.

TimetablePlanGrid reuses TimetableBlock and the legacy skin. Every projection uses canonical stable slot IDs and exact absolute minutes. Move/drop/resize only emit canonical item edits; moving one Monday slot preserves Wednesday and all unaffected resources. Monday–Sunday presentation does not change Sunday=0 storage. Overlapping blocks use visible side-by-side lanes instead of Map overwrite. Operational fractional-minute positions were also corrected while preserving the existing automatic actual-time±30-minute axis. The planning09–24 default and00–24 option are a scoped DESIGN exception required by the approved spec.

Pointer Events start move/resize/palette actions only at dedicated handles; ordinary touch scroll remains native. Axis is frozen through drag/save. Pointer cancel, capture loss and Escape clear previews without mutation. Target panel identity participates in moved detection even at identical coordinates. Ordinary block/cell activation opens the form. Centered cell click is distinct from range drag: click uses labeled cell start plus selected duration; drag uses the selected range.

Placement editor uses shared Form, Select, Input, Dialog and validation. Typed17:13 and end24:00 are retained exactly; multi-day save is one command; slot edits preserve siblings and IDs. Recommendations call canonical suggestPlacements, at most five, against complete operating/shadow/new-item occupancy regardless of visible filters. Hidden resources and dated occurrences remain conflict inputs. Open-form revision is captured so later collaborator refresh cannot silently permit stale overwrite. Failures retain inputs/focus. Korean status/errors, stale resolution, retry and undo are connected; saved state does not show retry merely because recovery storage is available.

Image export waits until controller/form work is saved/closed, includes preset/view/time, captures full height, hides editing handles and uses minimum1123px width at scale3. Actual downloaded PNG was independently inspected by root and implementer.

## API changes and Task5 integration fix

New UI files: timetable-plan-interaction.ts, timetable-plan-picker.tsx, timetable-plan-class-list.tsx, timetable-placement-editor.tsx, timetable-plan-workspace.tsx, components/timetable-plan-grid.jsx. Existing canonical placement adapters/contracts/conflicts are reused. New service methods listPlans/shareCandidates wrap existing RPCs; no alternate server contracts.

Root explicitly assigned the discovered failed-queue gap to Task6. A conclusive server rejection previously left a later form dispatch pending forever. Controller now adds failureKind(itemId), replaceRejected(edit), discardRejected(itemId); hook forwards them. Exact conclusive pairs only:23P01/timetable_resource_conflict and22023/timetable_invalid. A corrected explicit save replaces only the failed head with a new intent/key, retaining newer queued work and independent items. Discard similarly removes only that head. Existing dispatch rejects timetable_failed_edit_pending immediately for a failed head instead of leaving a promise unresolved. Unknown network, abort, malformed response and other code/message combinations preserve submitted body/key and require original receipt retry. confirmedRejection is not persisted, so restored recovery state remains conservatively uncertain until receipt replay. UI distinguishes original retry from correction/save. No SQLSTATE semantics, server RPC, authentication, ACL, locks or idempotency changes.

## Task7 handoff

TimetablePlanWorkspace owns selectedItemIds/setSelectedItemIds, search/listFilter and activeItemId. TimetablePlanClassList receives them as controlled props. selectedItemIds is item ID only, survives view/search/status-filter changes, and the snapshot effect prunes removed/applied items. The toolbar span data-testid=plan-selection-count is the concrete action-area extension point for a real transfer action/dialog. Task7 can mount its transfer dialog adjacent to PlacementEditor and use selectedItemIds with the current canonical state.snapshot; validate ready/eligible selections through the canonical transfer APIs. Do not derive transfer scope from visible DOM blocks or selected slot IDs.

After a validated transfer RPC result, call state.controller.applyTransfer(result). The Task5 implementation validates full snapshot or complete delta/reference metadata; its publish/rebuild changes both canonical applied records and shadow labels. That same new snapshot drives panels, class list and the selection-pruning effect; do not locally synthesize or splice shadow labels. If a server signal/refetch is required, state.refresh() performs the full canonical read. TimetablePlanPicker owns its own list reload; if Task7 creates/changes a target preset visible in that list, expose a reload nonce/callback there, rather than treating the workspace selection as a list cache. No actual transfer is wired by Task6.

## RED → GREEN and commands

Node path used: /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node (v24.19.0). Existing node_modules symlink; no installs.

Initial interaction RED: task-6-red.log records ERR_MODULE_NOT_FOUND for timetable-plan-interaction.ts;1test failed,0passed. New interaction tests cover four-view move/drop, stable sibling slots, readonly shadows, exact times, overlap lanes, cancellation, rendered grid actions, full-reference conflicts, empty catalogs and actual controlled class-list selection.

Recovery RED: task-6-recovery-red.log records four failures before controller methods existed (replaceRejected/failureKind missing). GREEN task-6-recovery-green.log:29passed. Tests include both exact rejection pairs→corrected fulfilled save/new key, unknown outcomes→replacement forbidden/identical receipt retry, and preservation of queued latest edits and independent item drafts. A later class-list render test initially failed because the test transpiler defaulted to ES5 and mishandled Set spreading; setting its target to ES2022 fixed the harness, not product behavior.

Final command (task-6-green.log):
```
node --test --experimental-strip-types tests/timetable-plan-interaction.test.mjs tests/timetable-layout.test.mjs tests/timetable-image-export.test.mjs tests/timetable-plan-controller.node.ts tests/timetable-plan-service.test.mjs tests/timetable-plan-hook.node.ts
```
Actual final output: tests75, suites0, pass75, fail0, cancelled0, skipped0, todo0. Includes all three Task6 brief-required test files and the touched controller/service/hook suites. Interaction file19passed; controller29passed.

Full TypeScript command: node node_modules/typescript/bin/tsc --noEmit --tsBuildInfoFile /tmp/task6-final-tsconfig.tsbuildinfo. task-6-tsc.log empty, exit0.
Changed-file ESLint used node node_modules/eslint/bin/eslint.js over all modified/new JS/JSX/TS/TSX sources, both changed tests and the five touched/new QA JS scripts. task-6-lint.log empty, exit0. git diff --check passed. No broad full test suite/build/CI claim.

## Browser and actual DB evidence

Original root fixture proxy/API95896 was stopped by root. Replacement session90139 owns3260/3262; original Next3261/session94061 stays running. URL http://127.0.0.1:3260/__fixture. Isolated Docker tips_timetable_20260923, networknone/socket-only, fixed synthetic actor00000000-0000-4000-8000-000000000099. New static allowlist RPC bridge invokes actual migrated DB functions; it does not duplicate business logic in JS or forward unknown RPCs. Original annual fixture remains usable. Seed changes restricted to designated synthetic fixture; initial seed constraint mistakes rolled back, then corrected seed committed. No unrelated DB reset.

Preserved artifacts: docs/qa/timetable-presets-20260923/README.md, browser-results.json, pointer-results.json, sixteen viewport/theme/view PNGs, four operational PNGs, pointer-interaction-mobile.png, panel-export.png/json. Scripts: timetable-plan-browser.mjs, timetable-plan-pointer-browser.mjs, timetable-plan-export-browser.mjs. Runtime read-only contexts only access loopback; they never attach to the user's browser. Pointer script creates and archives its own QA plan.

Final matrix:1440/390×light/dark×4views, all16 passed; every view contained the same14unique slot IDs; page overflowfalse, pageerrors[]. Operational screenshot compared against existing docs/qa/timetable-cells-refine-20260922/after-desktop.png with matching fixture names/theme/layout: header/cell colors and operational14:30–21:30 range retained; preset selector adds the expected top control row.

Pointer JSON contains16passing actions:4same-time resource moves,3cancellations(no requests),resize+5minutes,4palette drops,cellclick labeled09→09–10,60character input/end1440 with uncertain identical-key retry,conclusive23P01 correction/newkey,and native CDP mobile touch scroll. All saved operations reread actual DB results. No production claims.

Root manual notes: task-6-root-browser.md. Monday60109:10–10:10 / Wednesday60217:13–18:13, original IDs retained after all4CUA drags (revision6); Friday/Saturday23:30–24:00 saved as end1440; mobile added Tuesday09–10 while preserving prior slots (revision8). Collision input/focus and Escape→continue retained; five ordered recommendations worked. Empty preset create/rename/clone/archive/restore checked. Two discovered UI bugs were fixed and retested: handle hit-target stacking and simple centered-click interpreted as range.

Actual export panel-export.png:3369×3369,499332bytes, filename `2027 1학기 검토안-선생님 주간-2026. 9. 23. 오후 8-21-33.png`; preset/view/output timestamp and full09–24 axis visible, no bottom clipping. Root independently inspected this actual downloaded artifact, separate from screenshots.

## Self-review and boundaries

Reviewed canonical edit construction, sibling ID preservation, source metadata rules, full hidden-reference conflicts, pointer listener/capture cleanup, readonly gating, actor/lifecycle dirty navigation, form-open revisions, filter ID namespaces, export saving guard, and narrow recovery classification. Fixed findings are described above; no known unresolved Task6 functional failure.

Local bridge has no Realtime server. Product watcher is unchanged; local WebSocket errors are fixture limitations, not evidence of actual provider delivery. Polling/focus and actual DB save/read paths are separate from live Realtime. Share UI wraps existing APIs but real two-actor sharing was not manually exercised. Empty catalog rendering has focused test coverage; actual browser empty-preset/catalog-panel behavior was checked, not a destructive empty-catalog fixture reset. Task7 actual transfer and Task9 legacy import/multi-actor/capability checks remain later. No build/main CI/production migration/deploy/provider/send verification was performed. Isolated fixture QA records are synthetic; successful automatic plans were archived; unrelated/manual records left intact.

Ignored .superpowers files are not staged. Existing untracked plan/spec are reserved for Task9 and are not staged. No push/deploy requested or performed.

Post-commit check: git status --short contains only the two pre-existing Task9 plan/spec untracked files. Commit48files,1549insertions,29deletions. Fixture proxy/API session90139 and Next94061 remain available for reviewer; no process stop or DB reseed at handoff.


# Task6 review fix round1/5

FIX_BASE bddfcdc49e52d30c1b2b8957b5b779e013ed310e. All three Important findings addressed; both Minor observations addressed within touched code. No agents spawned, package installation, production/network fallback, source DB reset, push or deployment. Fix commit follows below.

## Reviewed requirements and implementation

Read task-6-review-1.md verbatim. Spec section4 wording: “블록 하나를 옮기면 그 배치 하나만 바뀐다. 수업 전체 요일을 바꾸거나 전체 담당을 바꾸는 작업은 수업 편집 폼에서 명시적으로 실행한다.”

1. Picker separates immutable pending command from current/retained input. Changing name or closing/reopening cannot replace an unknown create/clone command. While pending, any reopened management dialog resumes that original operation. Retry calls the same body/requestKey/planId before any later edit; successful create/clone receipt with changed fields transitions to a separate rename of the returned plan at its returned meta revision. Later input is retained. Successful rename retry also retains subsequently changed input for another explicit rename. Only exact final-RPC rejection pairs22023/timetable_invalid andP0001/timetable_stale permit a fresh corrected intent; unrelated SQLSTATE messages, network and malformed responses remain immutable. Correction from fix-round2: the final ordered mutate_timetable_plan_v1 is CREATE OR REPLACE at 20260923085008_timetable_operational_conflict_guards.sql:2712. Its partial-date presence/null pairing guard raises22023/timetable_invalid before receipt lookup; its later validation/stale branches and exception handler can also raise the classified pairs. The earlier claim that storage was final and all rejection branches followed receipt was incorrect. Classification still uses exact code/message pairs; no new classifier error was found in the inspected final definition. No SQL/API change.

2. Picker callbacks capture service ownership and dialog operation epoch. Share reads have AbortSignal plus completion guards; closing/reopening retires reads. Actor/service change clears candidates, errors, form, pending command and busy state. List reload uses scope+list epoch and separate list errors. Mutation success/error/finally cannot alter another actor or newer dialog; old successful creation cannot select its plan or close the newer form. Writes are not silently aborted/replaced. Unknown recovery is scoped to the current picker session; this fix does not add cross-actor or full-page-reload metadata recovery storage.

3. Placement scope is explicit: class-list `수업 전체 편집`, block `단일 배치 편집`, cell `추가 배치`. PlacementEditorDraft.scope is item/slot/add, with compatible inference for existing call sites. Whole editor prefills existing weekdays and has four opt-in controls: 전체 담당 변경/전체 강의실 변경/전체 요일 변경/전체 시각 변경. Unchecked fields do not overwrite different per-slot values. Whole weekdays remap old weekday groups to new days, retaining slot IDs, time/length/resource values and pending drafts; retained weekdays stay intact, removed days are removed, extra new days clone a template with new IDs. Whole teacher changes only teacher IDs/default; single-slot and add paths preserve all siblings. All paths build one canonical SavePlanItem edit through buildPlacementFormEdit. Exposed pure defaults/build helpers are shared by UI and behavioral interaction tests.

Minor: picker and amended form JSX/recovery callbacks were expanded into readable groups and named handlers; unrelated workspace JSX was left alone. Added direct discardRejected success test: drop only rejected head, advance queued latest edit, preserve independent pending item and settle promises. Root CUA additionally found unlabeled scope checkboxes; fixed with shared FormControl and explicit aria-label, verified by root AX after reload.

## RED→GREEN evidence and exact commands

All commands use /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node as `node` below.

- `node --test --experimental-strip-types tests/timetable-plan-picker.test.mjs` before picker changes: task-6-fix1-picker-red.log,9tests,0pass,9fail. Actual rendered component/deferred promises cover changed-input/reopen receipt recovery, actor-switched share success/failure, actor-switched creation success/failure, and same-actor newer dialog. Initial mocked autofocus needed a JSDOM-only boundary adjustment; no product focus bypass.
- `node --test --experimental-strip-types tests/timetable-plan-interaction.test.mjs` before whole-edit helper: task-6-fix1-form-red.log,22tests,19pass,3fail (new whole/default/build behaviors absent).
- Narrow correction regression initially failed in task-6-fix1-picker-validation-red.log (1test/1fail) before adding exact conclusive picker-rejection classification; matched and mismatched22023 messages now exercise corrected-vs-immutable behavior.
- Actual DB persisted-response-loss RED loaded the old component without touching the running Next app: `git show bddfcdc4:src/features/academic/timetable-plan-picker.tsx > /tmp/task6-original-picker.tsx`, then `TIMETABLE_PICKER_FIXTURE_DB=1 TIMETABLE_PICKER_SOURCE=/tmp/task6-original-picker.tsx node --test --experimental-strip-types --test-name-pattern='unknown receipt' tests/timetable-plan-picker.test.mjs`. task-6-fix1-persisted-red.log:4tests/0pass/4fail, every case recorded two distinct real persisted IDs. HTTP fetch harness initially used Playwright's ok() instead of Fetch ok property; corrected before retained RED evidence. No app defect was inferred from that harness error.
- Same actual DB command without TIMETABLE_PICKER_SOURCE: task-6-fix1-persisted-green.log:4tests/4pass/0fail; each case recorded one real persisted ID. It sends commands from the actual rendered picker to the allowlisted fixture RPC/real isolated DB and deliberately withholds the committed response before delivering a rejection to the component. The retry is sent again, identical key/body/planId asserted, and actual records reread. This is persisted response-loss proof, not a JS business-logic simulation. Create+clone × changed name+reopen all covered. Test-created IDs are archived in finally; source main preset only read. Synthetic RED duplicates were also archived.
- Final focused `node --test --experimental-strip-types tests/timetable-plan-interaction.test.mjs tests/timetable-plan-picker.test.mjs tests/timetable-plan-controller.node.ts`: task-6-fix1-green.log:62tests,62pass,0fail,0cancelled,0skipped,0todo. Interaction22, picker10, controller30. No broad full-suite rerun.
- `node node_modules/typescript/bin/tsc --noEmit --tsBuildInfoFile /tmp/task6-fix1.tsbuildinfo`: task-6-fix1-tsc.log empty, exit0. Initial inferred nullable-date object failed the discriminated paired-date type, then corrected to explicit paired union; final full typecheck clean.
- `node node_modules/eslint/bin/eslint.js src/features/academic/timetable-placement-editor.tsx src/features/academic/timetable-plan-class-list.tsx src/features/academic/timetable-plan-interaction.ts src/features/academic/timetable-plan-picker.tsx tests/timetable-plan-controller.node.ts tests/timetable-plan-interaction.test.mjs tests/timetable-plan-picker.test.mjs`: task-6-fix1-lint.log empty, exit0. Initial harness module-name and unused-destructure findings and epoch ref cleanup warning fixed. git diff --check passed.

## Browser/manual evidence and preserved artifacts

Root actual CUA/DB record appended to task-6-root-browser.md: only `수동 관리 QA 수정 복사`, iteme446fbd2-fa5b-4b4d-b244-96a997d896cd. Monc49499af-12b5-4958-9f1c-75eb9fc503b0 / Wed5ab32d96-5d55-407e-8ede-c6a35217bda4, start553/end613. Whole Kim101→Lee102 one save revision2: both IDs/days1/3/start/end/room201 retained. Whole Mon/Wed→Tue/Thu one save revision3: both IDs/start/end/Lee102/room201 retained; days2/4, no extra old days. All four whole-scope checkbox names verified in AX after reload. Root reset viewport/closed untouched form; main and automatic QA records unchanged.

Preserved docs/qa/timetable-presets-20260923/fix1-results.json has old/new actual persisted-ID counts, focused results and root's exact manual slot IDs/revisions. QA README contains reproduction and scope. Original16matrix/export evidence was not regenerated or relabeled as fix-round coverage; no changed rendering path warranted broad matrix/export reruns. Current fixture90139/Next94061 remain available.

## Self-review and remaining boundaries

Reviewed unknown-command retention through edits/close/reopen, created receipt→separate rename revision, exact rejection classification, scope/dialog callback guards on every async success/error/finally, abortable sharing reads, own per-slot defaults/ID/sourceSlotId preservation, explicit whole-field opt-in, single/add sibling and pendingSlots preservation, accessible names, and queued discard success. No known unresolved Important/Minor request in this round. Full-page reload persistence for metadata requests, actual two-account integration and live Realtime remain outside this scoped session recovery/race proof; Task7 transfer and Task9 import remain later. No production/build/main-CI/send claim.

Fix-round1 commit: c4f472812df1bbfe3dc22125fad98e3d024a0cfc (`fix: preserve preset recovery and explicit whole-class edits`). Post-commit status contains only the two pre-existing untracked Task9 plan/spec files.9files changed,609insertions,170deletions.


# Task6 review fix round2/5

FIX_BASE c4f472812df1bbfe3dc22125fad98e3d024a0cfc. Read task-6-rereview-1.md, reproduced and addressed new Important share-recovery input loss and corrected new Minor SQL provenance. Prior three Important/two Minor remain addressed. No backend, fixture DB, real user access, browser, export, matrix, production, package or deployment changes this round.

## Change and exact RED→GREEN

Picker now compares member keys and access values, including removal. After unchanged original share body/key is replayed successfully, changed members stay in the open share dialog; recoveredPlan stores returned metadata. The later explicit Save builds a separate share command with the returned metaRevision and a new requestKey. It never automatically sends the changed permission intent. Unrelated members remain intact. Existing service/dialog/actor guards, immutable pending body and narrow rejection classifier are unchanged.

Actual-component JSDOM tests use a functional shared-Select boundary and deferred service responses, not source-regex assertions. Each test submits teacher=viewer plus other=editor, loses the response, changes teacher to editor or removes teacher, retries the byte-equivalent original command, resolves its metadata revision7, and checks that the current members remain visible and no third request was automatically sent. The next explicit submit must be operation share, sameplan, expectedMetaRevision7, newkey, exact updated members preserving other=editor. Revision8 success closes the dialog without changing selected plan.

Commands below used /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node for node:

- RED before product fix: `node --test --experimental-strip-types --test-name-pattern='share receipt preserves' tests/timetable-plan-picker.test.mjs` → task-6-fix2-red.log:2tests,0pass,2fail. Both fail at `later member input remains in the open dialog`, actualnull; original body/key equality was already asserted before that failure. This exactly reproduces the review finding.
- GREEN: `node --test --experimental-strip-types tests/timetable-plan-picker.test.mjs` → task-6-fix2-green.log:12tests,12pass,0fail,0cancelled,0skipped,0todo. Both new share cases and existing create/clone recovery, actor/dialog delayed callbacks and narrow rejection cases passed.
- `node node_modules/typescript/bin/tsc --noEmit --tsBuildInfoFile /tmp/task6-fix2.tsbuildinfo` → task-6-fix2-tsc.log empty, exit0.
- `node node_modules/eslint/bin/eslint.js src/features/academic/timetable-plan-picker.tsx tests/timetable-plan-picker.test.mjs` → task-6-fix2-lint.log empty, exit0.
- `git diff --check` passed. No other test suites or browser/export/matrix rerun.

## Final SQL provenance correction

Case-insensitive ordered migration search `rg -ni 'create( or replace)? function public.mutate_timetable_plan_v1' supabase/migrations | sort` finds storage20260923081138:273 followed by operational_conflict_guards20260923085008:2712. Read the latter complete function. The final definition checks partial target-date key/null pairing before require/locks/receipt, raising22023/timetable_invalid; later validations/stale checks and exception handler also raise the classified pairs. The earlier report's storage-is-final/all-rejections-after-receipt claim was wrong and has been corrected in place. Code comment now acknowledges receipt-preceding partial-date validation and exact code/message classification. Inspection found no reason to expand/change the existing narrow classifier; no SQL mutation or new backend test was needed for a provenance-only correction.

## Self-review and remaining boundary

Reviewed membership comparison for same-count access change and fewer-member revocation, preservation of unaffected members, no automatic follow-up mutation, returned revision/new key, final success closure, and existing scope/epoch checks. No remaining fixround2 finding. QA README preserves the outcomes; raw logs remain in this ignored report directory.

Spec section7 mentions user+plan sessionStorage draft recovery. Task5 item-draft controller implements that boundary; picker metadata commands remain in-memory across its dialog close/reopen only and do not survive full page reload/remount. This is the explicitly retained final-review boundary, not a claim that all metadata recovery is complete. No unsolicited durable metadata storage was added. Deferred services prove component behavior; no real sharing permission changes or two-account provider validation were performed.

Fix-round2 commit: d1adafcf4dcfe872535f975fcdf683e7fbd98fa5 (`fix: retain pending share edits after receipt recovery`). Post-commit status: only pre-existing untracked Task9 plan/spec.3files changed,48insertions,7deletions.
