# Task7 report — selected transfers

Status: implementation complete; root review pending. Commit: `fb5f3a600ebaaeebea1cbc434bef79057d233bd3` — `feat: promote selected timetable drafts without changing running classes`.

## Scope and grounding

Worktree `/Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard`, branch `codex/timetable-presets-20260923`, base `d1adafcf4dcfe872535f975fcdf683e7fbd98fa5`. Read task-7-brief, task-7-controller-notes, review-global-constraints, Task3–6 interfaces, approved spec §§6–9, AGENTS, tips-quality, DESIGN and shared Dialog/controls/table patterns. No root CONTEXT or docs/adr exists. Supabase skill routes were read. The existing Task6 preset editor and operational timetable are the visual references; shared semantic tokens and UI primitives were reused. No global token/style change or new shortcut was introduced.

Selected/bulk promotion and plan transfers are implemented. Root explicitly approved two narrow integration fixes: postcommit operating view/cache refresh and applied→new draft pending resolution through the existing add-placement editor. No Task8 race/performance harness or Task9 import expansion was performed. Existing untracked plan/spec files are intentionally excluded from this commit.

## Implementation and public interfaces

New migration `supabase/migrations/20260923120931_timetable_plan_transfers.sql` was created by the existing Supabase CLI, not a manually chosen timestamp.

Public RPC signatures are exactly `public.preview_timetable_plan_transfer_v1(p_request jsonb)` and `public.commit_timetable_plan_transfer_v1(p_command jsonb)`. Existing canonical TransferRequest/TransferCommitCommand/TransferResult types and service methods are reused. `TransferPreview.warnings` is optional for explicit pending preservation. Preview validates echoed source/target/mode/policy/ordered selection, all mappings, issue shapes and fingerprints before enabling commit. Results contain the full canonical source snapshot, labels, mappings, applied/removed items, target items/slots and new shadow classes/slots.

The private preparation helper validates strict request keys, duplicates, plan identities, current authorization, then acquires existing shared global operating lock → UUID-sorted plan locks → UUID-sorted related class locks. Authorization is repeated after waiting on locks. Commit checks the current actor's authorization before consulting the existing immutable receipt; identical receipt replay precedes selection/revision/fingerprint evaluation. Body changes under the same key fail. Preview fingerprint covers source/target full snapshots, selected request, operating catalog/shadow/dated reference, actor/role and subject-area catalog. No client `noConflict` is accepted.

Permissions: operating promotion requires source edit/manage permission, restricted to admin/staff. Shared preset editors may copy/move only when they can edit BOTH source and target; plan copy does not widen read-only source access. `canTransfer` specifically means operating-promotion permission and is documented in the contract. Plan target access is authoritatively checked by the server. Revoked target access rejects even an existing receipt replay.

Operating copy creates new classes and marks originals applied; move creates new classes and removes source drafts. For each new class, the exact composition is insert `개강 준비` → existing `initialize_new_class_schedule_v1` → update that newly created class to `수강` → final operating conflict assertion, all under the shared lock/transaction. Existing classes are never downgraded/updated, and no roster/history/session/curriculum/payment content is copied. Minute conversion preserves17:13 and end24:00.

All operating transfers and all moves reject pending or zero-slot items. Only explicit other-plan copy `keep_pending` preserves unresolved details/IDs and converts conflicting source slots to pending originals with new pending IDs. Source plan stays draft and target item/slot IDs are new. Capacity checks preserve500items/2000slots and the existing per-item2000pending limit; conversion overflow returns22023/timetable_capacity. Applied items remain single-use after close/deletion; clone creates a new draft with cleared applied fields and original placements pending.

## Controller, recovery and caches

`createTimetableTransferSession` owns an immutable command before network dispatch, persisted under the existing actor/plan sessionStorage prefix. Close/reopen or remount restores the same body/key; no new preview replaces an uncertain command. Actor retirement clears storage and ignores late results. The dialog is keyed by actor scope, preventing previous-actor destination options/local state from surviving. Exact conclusive SQL error pairs permit fresh preview; unknown errors retain intent. A committed result plus failed refresh is `refresh_failed`, retaining the result and offering refresh only, never allocating a new transfer key. A full remount can recover the same existing receipt because only command persistence is necessary.

`controller.applyTransfer` retires older in-flight reads. An equal source plan sequence with a divergent operating fingerprint cannot order a plan-only copy receipt against newer operating data: it preserves the newer snapshot and marks reference unverifiable. All accepted transfer receipts require a subsequent coherent read before becoming verified. A real DB producer→service→controller test proves the sequence/fingerprint case, including dated reference preservation.

`AcademicTimetableWorkspace` keeps the existing mounted operational component and filter/preferences, uses a narrow refresh ref, reloads the preset picker, clears the existing registration service cache, and calls the established public-class cache invalidation helper. `useAcademicWorkspaceData.refreshVerified` rejects unsuccessful/unaccepted/density-limited reads, so a visible committed-but-refresh-failed boundary is preserved. No new global cache was invented; existing management/curriculum navigation/load behavior remains. Actual DB-backed UI evidence confirms switching to 운영 시간표 displays the new classes.

## Pending recovery handoff for Task9

`formatPendingSlot` renders weekday/minutes/resource labels and reason, preserving raw original data without exposing UUID JSON. `pendingPlacementDraft(item, slots, pendingId)` uses the existing add editor and preloads original day/time/resources/duration, including known times/resources with a missing day. `PlacementEditorDraft.pendingResolutionId` identifies exactly one original. `buildPlacementFormEdit` requires add scope and a selected valid day, adds normalized slots and removes that pending ID in one ordinary item mutation. Unselected pending details and sibling IDs are unchanged; no occupancy is added before confirmation. Existing controller unknown-outcome/retry behavior owns the exact combined mutation. Cancel, local conflict and actual lost response preserve original pending and current input.

Task8 can reuse the canonical two transfer RPCs under the same global lock and receipt tables; Task9 can reuse the pending draft/helper without introducing another mutation contract. Two-browser share revocation and actual concurrent connections remain later gates by root agreement.

## SQL provenance, ACL and error evidence

Ordered migration source was searched and final actual migrated definitions were inspected. New four functions are final in20260923120931. Final preexisting initializer is20260923085008:1048, final private operating assertion:140, final shared lock:2773. Source provenance is in `task-7-definition-provenance.log`. All new functions are postgres-owned SECURITY DEFINER with empty search_path. Private prepare/evaluate have postgres execute only. Public preview/commit have authenticated execute, PUBLIC/anon revoked, and existing service_role default execute retained. No RLS/table policy or existing helper ACL was changed.

`task-7-final-db-audit.log` records current ACL and pg_get_functiondef MD5 after final reapply: prepare d7eed54f3fa674b5d1c861a8e8d130a8; evaluate78d73536afb27be6c4a378c33ca0bb19; previewfc6a16c4c7ca696db18feb7b73f025c1; commit59fd98ecc078b92f20614ab083886507. Business errors are22023/timetable_invalid or timetable_capacity, P0001/timetable_stale,42501/timetable_forbidden,23P01/timetable_resource_conflict. No domain40001. Final pgTAP asserts exact pairs.

Existing class deletion defect: actual rollback-only reproduction returned SQLSTATE23503, `insert or update on table "dashboard_audit_logs" violates foreign key constraint "dashboard_audit_logs_class_id_fkey"`. Final trigger is AFTER INSERT OR DELETE OR UPDATE `classes.dashboard_audit_classes` calling `dashboard_private.log_dashboard_audit_event_v2()` (final source20260814115116). Audit class FK and item applied/source class FKs all reference classes(id) ON DELETE SET NULL. The AFTER DELETE audit insert reintroduces the deleted class ID. Existing class deletion source provides no alternate atomic delete RPC avoiding this trigger. Per explicit root approval, FK/tombstone tests remove slots while class exists, disable ONLY this class audit trigger inside their synthetic transaction, delete their class, enable it again, and assert stateO. Exceptions roll back transaction state. pgTAP rolls back everything; browser commits only its own synthetic lifecycle. This proves FK/applied/shadow semantics, NOT a working production deletion flow. Product audit code was not changed.

## RED → GREEN evidence

All logs below are in this ignored task directory and retained.

- `task-7-db-red.log`: actual missing public RPC assertions `not ok1`, `not ok2` before implementation. Final DB suite133/133.
- `task-7-ordering-red.log`: equal-sequence old receipt replaced expected `new-operating`; one assertion failed. Controller fix and actual producer ordering now pass.
- `task-7-service-red.log`: three malformed/mismatched previews produced `Missing expected rejection`; final validation tests pass.
- `task-7-pending-label-red.log`: formatter absent (`undefined` vs `function`); readable preservation assertion passes.
- `task-7-pending-resolve-red.log`: chosen pending remained alongside pending2; final atomic mutation/sibling assertions pass.
- `task-7-capacity-red.log`: `not ok100 - conflict conversion respects per-item pending capacity`, complete plan1..133; after guard all133 pass.

Final exact commands (NODE is `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`; DOCKER is `/Users/hyunjun/.local/bin/docker`; all run from this worktree with approved filesystem/loopback escalation):

```sh
/Users/hyunjun/.npm/_npx/66b4952730d9cac8/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration new timetable_plan_transfers
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/migrations/20260923120931_timetable_plan_transfers.sql
/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/timetable_plan_transfers_test.sql
$NODE --test --experimental-strip-types tests/timetable-transfer-service.test.mjs tests/timetable-transfer-interaction.test.mjs tests/timetable-plan-controller.node.ts tests/timetable-plan-interaction.test.mjs tests/timetable-plan-service.test.mjs tests/timetable-plan-hook.node.ts tests/timetable-plan-picker.test.mjs tests/academic-scoped-reads.test.mjs
TIMETABLE_TRANSFER_FIXTURE_DB=1 $NODE --test --experimental-strip-types tests/timetable-transfer-service.test.mjs
$NODE --test --experimental-strip-types tests/common-controls-ui.test.mjs tests/workspace-tabs.test.mjs tests/premium-semantic-contrast.test.mjs
$NODE node_modules/typescript/bin/tsc --noEmit --tsBuildInfoFile /tmp/task7.tsbuildinfo
$NODE scripts/qa/timetable-transfer-browser.mjs
$NODE scripts/qa/timetable-transfer-edge-browser.mjs
git diff --check
```

ESLint executed via Python subprocess `[NODE,'node_modules/eslint/bin/eslint.js',*files]`, where files are all changed .ts/.tsx/.mjs from `git diff --name-only` plus the two new transfer TS/TSX files, two transfer tests and two browser scripts. Final exit0, no warnings. `task-7-lint.log` and `task-7-tsc.log` are empty successful outputs. Focused109pass/0fail; actual ordering5pass/0fail; design10pass/0fail. The pgTAP parser independently matched every assertion number1..133 against final plan1..133, rejected `not ok|ERROR:|FATAL:`, and required finalROLLBACK; printed `pgTAP133/133passed, noerrors, ROLLBACK=True`. This is not a claim based solely on psql exit status.

The approved network-none standalone Docker is not a Supabase CLI-managed stack, so the brief's `supabase test db ...` was executed as the equivalent socket psql/pgTAP suite above without an unapproved host DB URL or stack start. No install/network fallback was used. Final migration reapply used the exact file after the capacity guard. Broad build/full CI not run.

DB coverage includes all12 direction/mode/count variants; per-item mappings/metadata/newIDs; strict unresolved policy; all-or-none move and applied-copy failure on last class insert; immutable receipts; auth/ACL/revocation; catalogs/target revision/session fingerprint; exact17:13 and endMinute1440; source_class_id never excluding a shadow; newly visible labels in other plans; close/delete applied lifecycle; unchanged nonempty existing class, student roster/status, enrollment history and session JSON.

## Browser and runtime evidence

`docs/qa/timetable-presets-20260923/transfer-browser-results.json`: desktop1440/mobile390, each4checks, bothpassed, errors[]. Three selected classes after excluding zero-slot, actual commit followed by discarded response, dialogclose/reopen→identicalbody/key replay, exactly3classes, actual operating reader visibility, other-preset labels. Original six PNGs retained. Root independently opened both preview PNGs and results JSON; no overflow/occlusion reported.

`transfer-edge-results.json`:9checks, passedtrue, errors[]. Explicit keep_pending/secondcopy; strict move+exclude; catalog stale/recheck; applied clone; pending cancel/conflict/unknown/retry/sibling safety; shadow modify/close/delete stale preview. `transfer-pending-readable.png` independently viewed by implementer: all fields and readable weekday/time/resources/reason visible, no internal JSON; `transfer-edge-complete.png` retained. Browser scripts use separate headless contexts with only127.0.0.1:3260/3262 routes and reject external/WebSocket traffic.

Proxy/API now session3609; previous90139 was gone and48739 stopped before authorized restart. Next3261 retained. Actual operating RPC bridge is opt-in header `x-timetable-fixture-db:1`; default annual/manual visual baseline remains hardcoded. Final actual reader signature uses text class_group_id (initial uuid assumption produced42883 and was corrected against final source). The fixture cache endpoint is synthetic ack and does NOT prove a deployed/public provider cache refresh. The bridge has no live Realtime delivery. Product sends were never invoked.

Browser test-created plans were archived, classes closed, catalogs removed. Three plans from an early failed harness attempt were explicitly identified by ID and archived at final cleanup. Existing manual itemae260000-0000-4000-8000-000000000501 remains revision8; final audit triggerO. Transient harness failures were fixed (row-selection checkbox removal timing, async clone close wait, typed operating RPC mapping); final captured JSON is successful. Old failure PNGs were removed; useful RED logs remain.

## Self-review and boundaries

Inspected source diff, new migration and focused tests, named public/private definitions, shared global lock composition, receipt/auth ordering, cache error classification, pending preservation, actor scope, and QA fixture boundary. No enabled placeholder action remains. No existing running class/student/session update path was added. Capacity guard was the one final self-review correctness fix and received actual RED→GREEN evidence. Final tiny pending missing-day time/resource prefill and actor-key reset are covered by final focused/type/lint checks; no full browser rerun was claimed after those narrow changes. The last real browser run already passed the fully known-day pending atomic flow and9edges.

Remaining review concerns are explicitly bounded: existing audit DELETE bug; live provider/Realtime and two-account browser revocation unverified here; full races/performance/regression remain Task8/9; no production migration/deploy/public invalidation/real promotion/send was performed. No new architecture ambiguity or known Task7 implementation failure remains. Root independent review is next.


# Review fix round1 (base fb5f3a60)

Both findings in `task-7-review-1.md` are addressed. Fix commit: `36989ac56486cc0d5e2920bdb25d2226eb5feeba`.

Important: the placement form now carries `subjectAreaKey`, initializes it from the draft, and offers active science choices through the existing authenticated `list_active_science_subject_areas_v1()` contract (final unchanged source20260722110000:164). The timetable service maps server `area_key`/label rows to typed options, rejects invalid/inactive responses and supports abort. No product key/label list is hardcoded. Ordinary draft saves may remain incomplete; operating preview still authoritatively blocks missing/inactive science metadata. Non-science edits clear science-only metadata.

Each eligible draft preview row has `수업 정보 수정`. It resets the uncommitted preview, opens the existing whole-item editor, uses the ordinary revision/fingerprint item mutation, returns to the same selection and requires a new explicit preview. It preserves all slot IDs/minutes/resources unless the existing whole-edit controls are selected. Submitted/uncertain transfer commands disable row editing and both handler/parent guard against edits; the existing session retains the exact original body/key. The pending callback was stabilized to avoid a hidden transfer dialog's ordinary rerender clearing the editing form's dirty state. No session/RPC/lock/cache rewrite was made.

Minor: `PlacementEditorDraft.weekdays` allows known pending weekdays to be prefilled independently of known time. Monday/null start/null end now produces formWeekdays[1]. Original pending data, other pending rows, slot siblings and atomic resolution path remain unchanged.

Exact commands (same NODE absolute path as above):

```sh
$NODE --test --experimental-strip-types --test-name-pattern='pending known|science' tests/timetable-transfer-interaction.test.mjs tests/timetable-transfer-service.test.mjs
$NODE --test --experimental-strip-types tests/timetable-transfer-interaction.test.mjs tests/timetable-transfer-service.test.mjs tests/timetable-plan-interaction.test.mjs
$NODE scripts/qa/timetable-transfer-science-browser.mjs
$NODE node_modules/typescript/bin/tsc --noEmit --tsBuildInfoFile /tmp/task7-fix1.tsbuildinfo
git diff --check
```

`task-7-fix1-red.log`:3fail — actual [] vs expected[1], undefined vs expected empty subjectAreaKey, missing catalog method. `task-7-fix1-green.log`:39tests,39pass,0fail. ESLint used `[NODE,'node_modules/eslint/bin/eslint.js',*files]` where files are amended .ts/.tsx/.mjs from git diff plus the new science browser script; exit0 and empty `task-7-fix1-lint.log`. Final full TypeScript output empty in `task-7-fix1-tsc.log`. No SQL migration/function/ACL changed; previous133assertions are prior evidence rather than a claimed rerun.

Actual migrated-RPC/UI regression: `task-7-fix1-browser.log` and committed `transfer-science-results.json` show3checks/passedtrue/errors[]. New fully placed science/high1 draft with null area blocked; affected row opens existing form, real active catalog selection saves and preserves the same slot at1033–1063; fresh preview returns no blockers; promotion commits, response is deliberately lost, row editing is disabled, identicalbody/key recovery yields exactlyone active class whose subject_area_key equals the selected actual catalog key. The new draft was prepared by the ordinary item RPC; correction, fresh preview, promotion and retry were actual browser actions. Root independently inspected the result JSON and correction PNG. No full desktop/mobile matrix rerun was needed for this scoped amendment.

Fixture notes: old proxy was absent; new proxy/API session30851 on3260/3262, Next3261 preserved. Both academic_subject_settings and academic_subject_areas lacked science seed rows. Initial attempts discovered the existing area CHECK allows only foundation keys and area rows require the parent settings FK; these were fixture setup failures, not a product validation bypass. The final script extracts/reuses existing20260722090000 seed SQL, does not overwrite existing settings on conflict, reads its chosen key through the actual RPC, and restores its old active flag. New foundation area rows remain inactive after proof because the retained closed synthetic class references them. No prior catalog row was deleted/rewritten. An initial successful UI run had cleanup after browser close; corrected order and rerun succeeded, and its exact leftover plan a7d5ceb1-9753-418b-9ce5-8421cc46ee11 was separately archived/resources removed/class closed. Final successful planb2566ce8-33d3-42f5-a826-582e03a971cb was likewise cleaned by the script.

Self-review: inspected all amended source/fixture diffs and existing final catalog signature/security; checked row edit→old preview reset→normal mutation→fresh preview, no immutable command replacement, active-only choices, unchanged placements, partial pending preservation, no server relaxation, no new shortcuts/tokens. Existing audit DELETE limitation remains unchanged. Race/performance/two-account/provider/release work is still Task8/9 or explicit release scope. No further Task7 known failure remains; root rereview pending.
