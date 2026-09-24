# Whole-branch review 1 — timetable presets

Reviewed 2026-09-24, branch `codex/timetable-presets-20260923`.

- Base: `eb23d7d8e1e629ffcf58d0f286aafa1d33deec72`
- Head: `75585a5f4bbb266af7c9ac38147b3eb4c0a39371`
- Worktree: `/Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard`
- Verdict: **Not ready to merge. Six Important findings need the consolidated fix wave.** No Critical finding identified. Three Minor dispositions remain explicit below.
- Scope: complete product integration, approved spec/plan and reasonable operating expectations; previous task verdicts did not pre-grade this review. Local implementation is authorized; production/push/deploy/real operating promotions remain outside authorization.

## Strengths

The architecture separates independent plans from operational classes, models four projections over stable canonical placement IDs, and keeps live operational shadows independent of applied snapshots. Integer-minute/half-open interval contracts and delta-based movement preserve off-grid input. Server authorization and full-reference conflict checks remain authoritative; selected transfers are transactional and receipt-backed, and active shadows remain occupied across plans. The operational gateway, triggers and common lock cover existing writers as well as new planner writers. No-history/no-send coverage examines relation contents rather than merely asserting that one notification function was not called.

The evidence package is unusually candid about limits: actual two-connection barriers versus simulated concurrency, polling/focus versus provider Realtime, new-class empty histories versus existing-class preservation, clean timetable suites versus incomplete historical notification prerequisites, and valid frame timing versus withdrawn handler timing. The latest independent dirty-owner correction is appropriately scoped and has actual-browser RED/GREEN evidence.

These strengths do not resolve the six paths below.

## Findings

### Critical

None identified in the reviewed source and bounded local evidence. This is not a production-safety certification.

### Important

#### I1 — A committed editor save cannot replay its receipt after response loss and refresh/reload

**Location:** `src/features/academic/timetable-plan-model.ts:290-293`; caller `src/features/academic/timetable-plan-workspace.tsx:114,119-123`.

The editor always dispatches an explicit opening `expectedItemRevision`, which is persisted with the pending entry. If the server commits revision 1→2 but the response is lost, a refresh/reload correctly reads revision 2. Retry then compares the persisted expected revision 1 with current revision 2 and rejects locally **before** reaching `entry.submitted` and `service.saveItem`. The immutable original body/key therefore never reaches the server's receipt lookup. A newly created item has the same null→1 problem. Polling can cause this without a full reload.

A focused, read-only probe imported the real controller, used memory storage and a fake service whose first save committed revision 2 then threw response loss, destroyed/recreated the controller, loaded the updated snapshot, and retried. Result:

```json
{"serverRevision":2,"totalSaveRpcCalls":1,"retryError":"timetable_stale","failureKind":"stale","dirty":true}
```

The user sees a concurrency conflict for their own successful save and cannot settle it by retrying the original request. Choosing “latest” may discard subsequent local work, and the normal receipt acceptance/undo lifecycle is skipped. The recorded successful recovered item fixture does not cover the actual editor's explicit-revision submission path.

**Fix:** Apply the local revision preflight only to an intent that has never been submitted. Submitted immutable commands must reach their original server receipt first; keep current authorization, receipt-superseded handling and downstream revalidation. Add existing-item and new-item editor cases with explicit revisions, commit-then-response-loss, refresh/reload, same key/body replay, and retained subsequent input.

#### I2 — A failed deletion removes its own recovery controls

**Location:** `src/features/academic/timetable-plan-model.ts:88-93`; `src/features/academic/timetable-plan-workspace.tsx:291,306-308`.

The optimistic overlay removes an item for every pending delete, including an errored/stale delete. The workspace obtains its displayed snapshot from that overlay, but renders stale resolution by enumerating `snapshot.items`. A concurrently changed item whose delete receives `timetable_stale` is absent from that list, so neither “latest content” nor “reapply my input” is rendered. It is also absent from the class list/editor. Closing the delete dialog does not discard the pending command; clicking delete again encounters the existing failed queue. Generic Retry resends the stale immutable command and remains stale.

Real-controller, memory-service probe:

```json
{"case":"stale-delete","saveState":"stale","dirty":true,"failureKind":"stale","draftIds":[],"uiStaleResolutionIds":[]}
```

A second retry remained stale/dirty. This strands ordinary collaborative deletion recovery and leaves navigation/transfer blocked or guarded across reload.

**Fix:** Drive recovery controls from pending operations or a canonical-plus-draft union, not only rendered draft items. Offer explicit accept-server/reapply-delete for a confirmed stale deletion, while retaining immutable replay for an uncertain deletion. Cover stale delete, confirmed rejection, and successful-but-lost delete receipts with actual rendered controls; do not clear an unknown outcome merely to unblock the UI.

#### I3 — The documented item/slot capacity rejection is treated as an uncertain outcome

**Location:** `src/features/academic/timetable-plan-model.ts:74-77`; producer `supabase/migrations/20260923081138_timetable_plan_storage.sql:254`; UI `src/features/academic/timetable-placement-editor.tsx:149-161`.

`isConfirmedRejection` recognizes only `23P01/timetable_resource_conflict` and `22023/timetable_invalid`. The same authoritative mutation rejects the 501st item or an over-2000-slot save with **`22023/timetable_capacity`**. The add control remains enabled at the limit. This definite transaction rejection is classified `uncertain`, so the editor disables correction/save and exposes only immutable retry, not discard. Retrying unchanged input deterministically fails again; the pending entry remains dirty.

Real-controller probe with that exact server pair:

```json
{"case":"capacity-save","saveState":"error","dirty":true,"failureKind":"uncertain","draftIds":["i","new"],"uiStaleResolutionIds":[]}
```

The second call remained uncertain/dirty. This is a reachable maximum-supported-dataset workflow, not a speculative transport failure.

**Fix:** Recognize the exact capacity producer pair as a confirmed rejection, provide a useful Korean capacity message, and expose correction/discard. A preventive add limit can help but must not replace the server guard or handle concurrent capacity changes by assumption. Test both item and slot limit recovery and ensure ambiguous errors still require original-request replay.

#### I4 — Existing teacher-only schedule text is now parsed as a classroom

**Location:** `src/features/management/class-schedule-slots.ts:150-154`.

The new `hasResourcePair` branch correctly preserves an explicit empty side of a comma pair. However, the no-comma branch no longer uses `firstDetailIsTeacher` to choose the classroom fallback. A historical `(홍길동)` detail now becomes both teacher and classroom. Management calls this parser when opening/editing legacy classes (`management-page.tsx:2630,2875`) and preparing the schedule representation (`:2072,2133,2175`). This can show a teacher name as a room, force unnecessary repair, or propagate a corrupted room string on save.

A read-only probe imported the HEAD function and loaded the exact base source through Node's TypeScript stripping, with identical arguments:

```text
parseClassScheduleSlots('월 17:13-18:43 (홍길동)', '김선생', '1강의실')
base: teacher 홍길동, classroom 1강의실
HEAD: teacher 홍길동, classroom 홍길동
```

Control probes confirmed the intentional new behavior for `(홍길동, )` and `(, 2강의실)`—those explicit empty sides should remain empty.

**Fix:** Restore teacher-only fallback without reverting explicit comma-empty handling. Include teacher-only, classroom-only, full pair, empty teacher, empty classroom, day-specific fallback, and slash-separated historical forms in the targeted parser regression set. Check the legacy management editor's parsed value, not just formatted display text.

#### I5 — Preparation import can erase the original placement needed for repair

**Location:** `supabase/migrations/20260923150523_timetable_plan_import_recovery.sql:44-46,113-114`; presentation `src/features/academic/timetable-plan-interaction.ts:13-17`.

When a legacy preparation-class schedule piece fails the import-specific regex, it is replaced by blank `day/start/end`, retaining only class-level teacher/room. The original `piece` is never placed in the safe preview/entry. Commit serializes the already blank line into pending `sourceText`; the UI consequently shows only “원본 배치 확인 필요”. The original string in `raw` is used only for the source fingerprint and does not recover this information in the resulting item.

This affects even a form already accepted by the existing management parser: `월 17:13–18:43` uses an en dash accepted by `DAY_GROUP_PATTERN` in `class-schedule-slots.ts:18`, whereas this importer accepts only `[-~]`. Both valid weekday and exact original times disappear from the imported pending item. Other malformed historical text has the same loss. The source class itself is preserved, but staff must leave the recovery flow and rediscover the original to repair it. This violates the pending-recovery intent and the acceptance condition of no lost original weekday.

**Fix:** Align supported legacy schedule grammar where appropriate and retain an explicitly whitelisted original schedule string/allowed placement fields when parsing fails. Show the safe original and diagnostic in the pending UI. Do not retain an entire historical entry or unknown/student/status fields. Add preparation-import cases for accepted legacy punctuation and genuinely malformed time, checking both safe preview/commit persistence and displayed recovery input.

#### I6 — The existing lesson-plan draft lifecycle suite regresses from 19/19 to 15/19

**Location:** `tests/class-schedule-draft-navigation.test.mjs:139,227,306`; changed production call `src/features/operations/class-schedule-workspace.tsx:3669-3672`.

The same test blob (`771c73bae005a58cb7f656a8a7e84c1eb2edb2c6`) passes 19/19 at the actual feature base `eb23d7d8` but passes 15/19 at both pre-I1 `49faaa8e` and current HEAD. This is a branch regression. The collector only recognizes `update:`/`save_` requests, while this branch uses `update_class_operational_v1`. Its payload assertions also expect `args.schedule_plan` instead of `args.p_patch.schedule_plan`. Four save/late-actor/retry lifecycle tests fail before exercising their intended post-submit behavior.

Evidence: `docs/qa/timetable-presets-20260923/evidence/task9-fix1-node.log`, `task9-fix1-unrelated-baseline.log`, and `task9-fix1-unrelated-origin.log`, corroborated by source inspection. I did not rerun them. The failure does **not** demonstrate a product save failure, and it is **not** preexisting merely because it predates the narrow I1 fix.

**Fix:** Adapt the existing request/argument harness to the guarded RPC while retaining every original lifecycle assertion. Restore 19/19 on this branch and the relevant timetable covering checks. Do not delete, skip, or weaken the failing cases; this suite protects an existing operating consumer changed by the feature.

### Minor

#### M1 — Safe-environment builds exit successfully with synthetic public-read failures

**Location:** `docs/qa/timetable-presets-20260923/evidence/task9-fix1-build.log:12-48`.

Four `public_classes_read_failed` / HTTP 403 blocks remain in the latest successful build. Carry as an explicit evidence limitation, not a claim of clean public-read validation. The synthetic environment and documented fallback explain why this does not by itself block local timetable correctness. Prefer a deterministic safe fixture if practical; no production credentials or public control-plane changes are needed for this review. No finding of a newly broken production public API is supported.

#### M2 — Mobile import candidate dates break inside digits

**Location:** `src/features/academic/timetable-plan-import-dialog.tsx:94`.

The candidate's `break-all` text splits `2026-09-23` into `2026-09-2` and `3` in the saved 390px dark screenshot `docs/qa/timetable-presets-20260923/task9-import-mobile-dark.png`, inspected directly. It is readable with effort but makes candidate comparison needlessly harder. Keep normal text wrapping and give the date an unbreakable span or a separate secondary line. Verify the same narrow viewport and long candidate labels.

#### M3 — Maximum supported capacity still misses the frame target

**Location:** `docs/qa/timetable-presets-20260923/REPORT.md`, section “남은 한계와 출시 전 별도 gate”; `performance-browser.json` / `performance-comparison.json`.

500 items/2000 slots has valid frame p95 33.6–33.7ms versus the approved 32ms target; 600 slots is 17.5ms. The root's explicit deferral is acknowledged, so this is a retained accepted performance limitation rather than a newly invented blocking redesign. It remains **target unmet**, never PASS. Historical pointer-handler/handler-to-commit values remain withdrawn. If addressed in this fix wave, measure the same valid endpoint/fixture and avoid extrapolating from pure-model speed.

## Integration and final SQL assessment

Read the final context, global constraints, root acceptance map, full approved spec/plan, final REPORT/runbook, deferred/parked/Ruling ledger, Task9 review/rereview, repository quality/design routing, product diff and affected implementations. Raw historical logs were sampled to substantiate concrete claims rather than repeatedly read in full.

| Boundary | Review assessment |
|---|---|
| Independent plans and shadows | Separate plan/item/slot tables; no class-term surrogate. Active operating shadows are read-only and dynamically derived; applied items do not reoccupy their historical slots. Clone of an applied item becomes unplaced. |
| Four projections and exact minutes | Shared projection/adapter uses stable slot identities; integer minutes, half-open overlap, end 1440 and original-minute drag offsets are preserved in source and focused recorded checks. |
| Server conflict scope | All operational references participate before client filters. Both-or-neither target dates are enforced; dated occurrences supplement rather than release weekly shadows. Changed-occupancy validation permits metadata repair of historical conflicts. |
| Authorization | Current authorization precedes receipt replay. RLS/ACL separates plan editing/sharing from operating promotion. Plan-specific revocation cleanup preserves another allowed plan's pending request; actor retirement clears actor scope. |
| Locking/concurrency | Final shared operating lock precedes sorted plans/classes/items for guarded writers. Trigger baseline/finalize guards cover direct operating DML. Ten recorded races use persistent independent backend connections and an observed lock barrier, not Promise concurrency alone. |
| SQLSTATE | Final makeup definitions use P0001 for named stale domain states and 23P01 for named occupancy conflicts. Genuine 40001 remains PostgreSQL concurrency; unsupported isolation is explicit 25001. The final pgTAP suite asserts producer pairs. |
| Transfer/no history/no send | Selected operations are transactional with immutable receipt and new UUIDs; original classes/history preserved, new classes empty. No-send SQL checks count/content for 13 relevant relations across four modes. Applied tombstone claim is bounded separately below. |
| Import | Admin/staff-only safe-field reads, independent legacy view candidates, fingerprint check and transactional import are appropriate. Missing subject is explicit rejection. Original-placement recovery has I5. |
| Recovery/dirty lifecycle | Metadata/transfer original-request retention and independent dirty-owner fix have strong evidence. Item recovery remains incomplete under I1–I3. |
| Existing operating consumers | Guarded create/update/save/init/generate and makeup consumers are wired through the shared contract. The old schedule parser has I4; the protected lesson-plan consumer lost executable lifecycle coverage under I6. |
| UX/design | Shared controls/tokens/tabs/grid presentation are reused; no custom shortcuts. Narrow controls and focus/export evidence are present. M2 is a concrete remaining visual defect. |

Final-definition check: reviewed the ordered migration chain and captured final `pg_get_functiondef`/owner/search_path/ACL (`evidence/task9-final-definitions-acl.json`), not just the first definition in 085008. Normalized-body source matching found 44/45 captured bodies directly in migration source. The remaining `get_academic_timetable_range_v1` is dynamically patched; inspected its ordered resource-join/time-matching modifications and final captured definition. Final provenance also records exact-source equality for eight critical functions. The active defining layers are storage `081138`, operating guards and their last replacements `085008`, transfers `120931`, makeup SQLSTATE replacements `131454`, aggregated read/guard `134651`, and import `150523`; earlier definitions were not treated as active merely because they appeared first. Private helper ACLs stay owner-only and public gateway ACLs exclude anonymous execution. No fresh production or local DB mutation/introspection was performed during this review; this assessment combines final captured introspection with current source provenance.

Named unchanged dependency inspected: final `public.current_dashboard_role` in the ordered `20260316092000` migration, to test whether a NULL role might bypass the continuous-schedule actor check. It returns a coalesced profile/email-fallback role or `viewer`; the hypothesized NULL-role bypass is not supported. Existing management parser consumers were inspected specifically for I4 propagation. I did not broaden into an unrelated application audit.

## Checks performed and evidence limits

- No source/index/HEAD/branch/DB/server mutations; no suites rerun, no browser sessions launched, no deployment or network publication. This report is the only requested write. Worktree was clean before the report.
- Three focused in-memory probe invocations were justified by unanswered risks: (1) stale delete and capacity rejection through the real controller, (2) committed-response-loss editor revision replay through the real controller and memory storage, (3) exact base-versus-HEAD legacy parser behavior. They did not use a real DB or prove browser rendering; the corresponding UI consequences are traced in the cited source. Probe outputs are retained above.
- Recalculated recorded SQL result totals: 11 files, **657 passed / 657 planned**, all recorded exits 0 and no failures. Reviewed no-send SQL assertions and concurrency barrier implementation/results. This verifies the supplied evidence's scope/consistency, not a newly executed suite.
- Rehashed all **12/12 feature migration files** against `task9-manifest-validation.json`. The recorded runner validated 117 ordered migrations; I did not independently rerun all 117 or recapture baseline/catalog.
- Read retained Node summaries: broad named gate181/181, shared design63/63, latest I1 covering56/56; these overlap and must not be summed. Full tsc/touched lint/build exit0 are recorded, not freshly run. Four branch lifecycle failures remain I6.
- Read actual-DB browser9/9, mobile/keyboard/logout3/3, and latest dirty-owner4/4 evidence and their scripts/limits. Create/import response loss was actual route-fetch commit then lost response. Another-plan item storage preservation used a seeded controller-format fixture; it does not prove editor explicit-revision recovery (I1).
- Directly inspected the saved mobile import PNG. Existing export evidence records a real3369×3369 PNG with100 last-panel slots/full axis and forced rendering. I did not rerender/export or redo all pointer/performance gates.
- Full product diff/source received priority; repeated historical SQL/build logs were read only where needed. No claim that every raw log line was independently replayed or reread.

## Declined to judge / considered and set aside — explicit root dispositions required

These are all considered behaviors/limits set aside from a new blocking finding, with the reason. They are not silently accepted as completed evidence.

1. **Production migration, main CI, deployment, real legacy preference presence/recovery, real operating promotion:** deliberately unperformed and separately authorized gates. Local completion cannot claim any of them. Runbook retains their order.
2. **Provider Realtime delivery and public-cache delivery:** polling/focus and invalidation invocation are evidenced; actual provider receipt is not. No live provider intervention is authorized. Keep separate release checks.
3. **Provider sends/customer notifications:** no-send local invariants are supported; no provider-send test is claimed or requested. Never activate providers as a review remedy.
4. **Historical notification whole-suite failures:** retain as not PASS. Exact origin producer hash/55000 missing legacy rule, registry/content-contract gaps and private42501 explain mixed-fixture limits. The obsolete-trigger/ACL reconciliation fixes adapter13/writer5 only. These do not prove a feature regression and do not justify broad notification migration/control-plane edits; they also prevent “entire app green”.
5. **Existing audit DELETE foreign-key defect and real class-deletion success:** unchanged defect; synthetic tombstone test temporarily disables only the offending trigger inside rollback. That test supports snapshot FK semantics, not the real deletion API. No deletion-success claim accepted.
6. **Performance cap miss:** explicitly accepted root deferral, carried as M3. No new architectural redesign finding solely from this already disclosed miss; target remains unmet.
7. **Historical handler/commit-lag numbers:** instrumentation timestamp occurs before the relevant handler. Those interpretations are withdrawn, not performance evidence. Valid frame/whole-gesture/pure-model observations remain separately labeled.
8. **Initial Task1 RED raw output:** absent; later retained RED/GREEN and final tests support current changes. Cannot retrospectively claim the missing original artifact exists.
9. **Arbitrary multipointer hardware behavior:** seven cancellation checks mean six real cases plus one bounded synthetic listener-replacement case. That does not establish every hardware multi-pointer ordering. No concrete additional failure observed to justify new blocking work.
10. **Global legacy app_preferences ACL redesign:** new import RPC restricts its own access/fields. Full preexisting preference-table policy redesign is outside this feature; no assertion that all historical clients are now private.
11. **Malformed missing-subject legacy one-click repair:** explicit validated rejection is an approved boundary; do not guess a subject. This is distinct from I5, which loses available placement information from accepted sources.
12. **New browser-session recovery and unsubmitted form autosave:** spec promises same-tab submitted-request persistence and dirty protection for unsubmitted forms. Closed-session durability/autosave is not promised; no missing-feature finding. Stored server plans are durable independently.
13. **Automatic merging of the four historical view candidates:** intentionally independent candidates; merging would invent conflicting source authority. No demand for automatic reconciliation.
14. **Whole-plan clone retaining conflicting draft placements:** approved Ruling preserves an independent plan snapshot and surfaces current conflicts; applied snapshots become unplaced drafts. No requirement to silently reposition/drop placements during clone.
15. **Metadata-only repair retaining preexisting slot/resource problems:** changed-occupancy policy intentionally permits non-occupancy edits; promotion still revalidates all selected placements. No blanket retrofit of historical errors requested.
16. **Creating an active class without resolvable occupancy:** guard now rejects it; preparation classes remain available. This is an intentional approved operating-safety change, not an accidental compatibility regression like I4.
17. **Transient reference-read failure with unchanged revision after recovery:** polling may not refresh a same-version snapshot from `unverifiable` to `verified`; explicit refresh/focus can recover and writes stay blocked. I considered automatic self-healing but found no unsafe write or violation sufficient for a blocking finding. Root may choose a small UX recovery improvement.
18. **Applied snapshot list detail richness:** stored historical fields are retained, but the list emphasizes date/time rather than exposing every teacher/room/grade/tuition detail. I considered a dedicated read-only detail view, but did not establish a required missing workflow or data loss; root may rule on whether read-only snapshot inspection needs expansion.
19. **Single global advisory lock throughput:** deliberate conservative consistency boundary. Recorded large-reference writer latency is finite and the evidence contains actual races. No demonstrated unacceptable queue/timeout warrants replacing the lock in this fix wave; cap rendering remains separately M3.
20. **NULL-role authorization bypass hypothesis:** disproved by the named unchanged role helper's non-null fallback; not a finding.
21. **Synthetic build403 and narrow candidate wrapping:** retained as M1/M2, not silently converted to success or escalated into an unverified production incident.
22. **Latest Task9 dirty-owner I1:** independent owner state/OR and current actual-browser create/clone×save/discard4GREEN address that specific report. I did not reopen it merely because distinct item-recovery failures exist.
23. **Adjacent lifecycle suite as “preexisting”:** explicitly declined that exemption. Actual feature-base comparison shows regression; it remains Important I6 even though the narrower Task9fix1 did not introduce it.

## Consolidated fix and scoped rereview recommendation

Fix I1–I6 together, preserve all original safety/receipt/auth boundaries, and correct M2 if practical. M1/M3 need truthful retained dispositions, not inflated success wording. The important fixes require targeted executable regressions for committed explicit-revision receipt replay, rendered delete recovery, definite capacity rejection recovery, historical parser fallback, safe original import placement, and all19 lesson-plan lifecycle cases. Recheck affected existing consumers and exact final import SQL/pgTAP after SQL changes. For recovery changes, add one actual-browser lost editor response/reload path and a stale-delete UI path; source-pattern tests alone will not establish usable controls.

Then perform the one scoped rereview against this list plus the integrated fix diff. No production action is necessary to make the fixes concrete and reviewable.
