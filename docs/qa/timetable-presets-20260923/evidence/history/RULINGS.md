# Chronological controller rulings

Verbatim Ruling lines from the controller progress ledger, in order. Later rulings supersede provisional assumptions. Current result is REPORT.md; Task9 controller notes are also retained in full.

`progress.md:29`
Ruling: The plan text saying this work ends at planning is superseded by the user instruction 진행 — implement the approved spec; production release remains separate.

`progress.md:30`
Ruling: Use subagent-driven implementation with sequential implementers and task reviews after initial inline setup — task size warrants fresh context; cost is extra review time.

`progress.md:36`
Ruling: Task 3 must produce the shared operating resource lock and private shadow/catalog reader that its plan read/save RPCs consume; Task 4 will expose the reference endpoint and connect all operating writes — resolves the plan dependency without stub validation; cost is moving foundation work earlier.

`progress.md:40`
Ruling: Plan snapshots need separate minimal operating class display metadata (id/name/subject/grade/status/revision) alongside pure ShadowSlot coordinates — names are necessary for shadow details; expose no student arrays/history. Task 3 must add a typed shadowClasses array and return it with the coherent snapshot. Cost is one additive wire field; slot identity remains unchanged.

`progress.md:43`
Ruling: Remaining manual class_schedule_stale/40001 producers in untouched continuous schedule entrypoints move to Task 4 when those entrypoints gain shared guards; Task 1 converts touched functions only. Task 4 must add exact P0001 pgTAP assertions for its final definitions.

`progress.md:64`
Ruling: Task 1 round 3 timetable reads use exact normalized slots for normalized-mode classes, preserving empty resource fields; legacy/shadow mode keeps its existing full-room-suffix parsing — normalized data is the authoritative source and avoids inventing a string encoding. Pre-existing ambiguous legacy teacher names remain a diagnostic concern for Task 4, not an automatic normalization. Cost if wrong: read compatibility rework in the timetable RPC.

`progress.md:69`
Ruling: Correct the earlier full-room-suffix description: preserve the original SQL room-token classifier for ambiguous details with more than two comma tokens, while exactly two positions retain explicit empty/literal semantics. Normalized mode reads slot rows. This addresses the same reported new regression without claiming to solve pre-existing legacy teacher-name ambiguity; cost if wrong is additional compatibility repair.

`progress.md:76`
Ruling: Task8 concurrency verifier may take explicit --local --container tips_timetable_20260923 instead of a mandatory TCP URL, because the approved fixture DB has no network and only a container-local socket. Still require two independent connections and actual barrier/outcome evidence. Cost if wrong: verifier CLI portability work; production connectivity is not introduced.

`progress.md:86`
Ruling: Task2 adds projectTimetableSlot(slot,view) plus resolveMovedGridTarget(slot,originGridTarget,targetGridTarget). Movement delta compares both absolute grid pointer minutes before5minute snapping, so differing cropped axes and grab offsets remain explicit. Task6 consumes this contract and freezes its axis. Cost if wrong: localized adapter/UI integration rework.

`progress.md:87`
Ruling: Existing teacher_catalogs/classroom_catalogs each have unique lower(name) indexes in the actual DB. Keep those constraints; do not remove them to manufacture duplicate-name test fixtures. Cover stable-ID semantics in pure tests and legal DB resource-name cases; document the schema restriction. Cost if wrong: an additional schema design is needed if real same-name catalog rows become a product requirement.

`progress.md:89`
Ruling: Add one RLS-protected ID/revision-only timetable_invalidation_signals table acrossTasks3/4/5 rather than publishing full plan/class records. Required by specified minimal event payload and no existing reusable signal transport. Task3 creates/per-plan emits;Task4 operating invalidates;Task5 subscribes+polls. Cost if wrong: one small schema/migration to maintain. Supabase official Postgres Changes/Authorization docs checked; localDB publication exists but no Realtime runtime, so live delivery evidence remains a separate gate.

`progress.md:94`
Ruling: Whole-plan duplication preserves existing draft placements and their current operating conflicts with new IDs; applied items become new unplaced drafts. This is a saved-plan copy and does not create operating occupancy. Selected plan-to-plan transfers still validate destination occupancy in Task7. Cost if wrong: localized clone behavior adjustment; no operating history is touched.

`progress.md:99`
Ruling: Retain private helper name lock_timetable_operating_resources_v1 from Task3 and route Tasks4/7/8 through it, with the exact approved bigint hash key tips:timetable:operational. No second operational-named lock helper/key — avoids split locking. Cost if wrong: internal callsite rename only.

`progress.md:102`
Ruling: Task5 may introduce the canonical Task7 transfer types/RPC argument types early to compile the real service adapter. It must not fabricate transfer responses or expose a working action before Task7 server implementation. Cost if wrong: additive contract refinement in Task7.

`progress.md:103`
Ruling: Pending/zero-slot rejection in Task7 applies to operating promotion and moves. Explicit plan-target copy with keep_pending may preserve unresolved/unplaced source drafts and their original pending details; it never discards slots. This reconciles repair/import behavior with all-or-none promotion. Cost if wrong: localized copy validation/UI policy change, no operational write.

`progress.md:106`
Ruling: Task9 import/recovery acceptance implies implementing its narrow server import/read boundary and tests if absent, not merely documenting an unimplemented flow. Existing task file list was illustrative; add CLI migration and canonical service/UI integration as required, preserving raw legacy preferences and no operational data writes. Cost if wrong: additional local importer code to maintain.

`progress.md:118`
Ruling: Keep the specified actor/plan-scoped sessionStorage for unsaved draft recovery, but correct the spec phrase browser-exit recovery to same-tab reload/session recovery. Server-saved presets persist normally; closing a tab/window can clear sessionStorage, so use existing beforeunload guard and never promise recovery of unsaved work after a fresh browser session. MDN sessionStorage checked2026-09-23. Cost if wrong: durable local draft storage would need a separately scoped storage/privacy implementation.

`progress.md:120`
Ruling: New active operating occupancy with unresolved resources must be rejected; preparing-class unplaced defaults remain allowed, existing unresolved occupancy permits metadata-only repair/removal. Task1 partial-resource projection regression fixtures may move to preparing status to preserve the old projection contract, with separate Task4 actual active rejection tests, not removed assertions. This follows fail-closed occupancy rather than allowing a new unknown resource reservation. Cost if wrong: operating defaults validation policy may need refinement for a distinct explicitly-unassigned state.

`progress.md:121`
Ruling: Existing normalized makeup helper writes classroom text without its catalogID; Task4 may resolve only a unique exact catalog name and reject new unresolved occupancy, with no historical backfill or aggregate fallback. Required for stable-ID conflict checks. Cost if wrong: localized makeup resource validation rework.

`progress.md:126`
Ruling: Task4 may correct normalized makeup helper timezone conversion to explicit Asia/Seoul for newly written dated sessions. Existing startAt timestamptz→date/time uses DB session timezone and shifts +09 input by9hours in UTC fixture, undermining conflict checks. No historical backfill. Require early-local-time/UTC-previous-day and23:30→nextday00:00 (24:00) boundary regressions. Cost if wrong: localized makeup datetime mapping adjustment.

`progress.md:129`
Ruling: Preset planning always reserves live weekly shadow positions; an optional target date range adds checks for actual dated occupancy and does not let a one-day skipped/moved session free the recurring weekly position. This follows user continuing-class shadow requirement and spec91/154 (range is review metadata, not new operating validity). Source-slot/date actual-session authority, skipped exclusion and dedup apply to dated operating conflict checks. Task4 temporary effective-date-only plan tests must change to this confirmed rule. Cost if wrong: later product policy may allow a separate one-off timetable type, not silently weaken this recurring planner.

`progress.md:130`
Ruling: A plan target period requires both start/end dates or neither; one-sided dates return22023 validation. Task3 previously allowed partial metadata; no deployed presets exist in this worktree. Avoid unbounded or silently incomplete dated checks and align UI form/types/tests. Cost if wrong: optional one-sided period semantics would need explicit additional design.

`progress.md:132`
Ruling: Shared advisory-lock timetable writes accept READ COMMITTED/READ UNCOMMITTED only. RR/SERIALIZABLE may retain a pre-lock stale snapshot, so helper rejects writes with exact25001/timetable_isolation_not_supported; reads stay available and genuine40001 is untouched. Task4 actual separate-isolation transaction tests, Task8 snapshot-pinned two-connection bypass test. Cost if wrong: advanced custom SQL clients must use supported RC transactions or a future stronger isolation-compatible occupancy design.

`progress.md:146`
Ruling: Non-integral-minute legacy occupancy must preserve its raw source and produce a correctly scoped unresolved blocker, rather than silently truncating/rounding seconds into the integer-minute canonical model. This follows exact-minute/fail-closed contracts; no history rewrite. Cost if wrong: supporting second-level timetable editing would require a separately expanded time model.

`progress.md:168`
Ruling: Task8 must resolve the five touched makeup definitions that still preserve ten pre-existing manual domain40001 raises, in addition to concurrency proof. Task4 report disclosed them outside its eight class_schedule_stale conversions, but final AGENTS/spec requires40001 reserved for genuineDBcollisions. Add narrowmigration + actualexactSQLSTATE/consumercompatibility tests before transfer release; preserve names/signatures/locks. Cost if wrong: clients that special-case old40001 need compatibility mapping, covered by targeted tests. Task4review completion stands as task-scoped evidence; this is an explicit open final releasegate, not a claim of allSQLSTATEs alreadyclean.

`progress.md:186`
Ruling: Task6 may extend the Task5 controller with an explicit recovery action for a definitively rejected item command, because integration exposed that fixing the form after a server23P01/22023 response queues forever behind the failed command. Known server rejection may be explicitly replaced/discarded with new intent/key; ambiguous network/response failures retain original body/key and require receipt retry. Include controller and real UI regressions, preserving otheritems and latestdraft. Cost if wrong: misclassified uncertain commits could duplicate or lose user intent, so classify narrow server code/message pairs and test unknown outcomes cannot be discarded/replaced through this action.

`progress.md:215`
Ruling: If the existing operational delete path cannot bypass a demonstrated pre-existing audit DELETE foreign-key defect, Task7 may isolate the applied-class FK tombstone test by temporarily disabling only that audit trigger inside a synthetic fixture transaction, with rollback/restoration verified. Preserve exact SQLSTATE/message/final-trigger evidence and distinguish this from real operational deletion-flow proof; do not alter product audit behavior. Cost if wrong: the tombstone test may not represent the eventual deletion API and that separate existing defect needs later repair.

`progress.md:223`
Ruling: Task7 may connect each pending placement to the existing add-placement form and resolve it atomically with a new normalized slot. The applied-to-new-draft browser flow exposed that pending was displayed but had no resolution action, which would permanently prevent promotion and violate the approved pending-repair contract. Preserve other pending entries/sibling slot IDs and all inputs on cancel, rejection or unknown outcome; add focused behavioral and browser proof. Cost if wrong: localized editor/controller integration rework; no operating class/history mutation is introduced.

`progress.md:229`
Ruling: Task8's narrow SQLSTATE follow-up also includes notification_assert_makeup_room_available_v1(uuid), whose final20260716192000 definition still raises manual40001/makeup_room_collision and is called by Task4's final transition at20260923085008:384. Preserve its message/ACL/lock semantics, use a domain-conflict code and update exact consumer/test mappings. This closes the concrete adjacent makeup path exercised by the required races, without broad unrelated notification refactoring. Cost if wrong: existing makeup approval clients may need compatibility mapping, so verify HTTP409 and user recovery for new domain codes while preserving real40001 behavior.

`progress.md:245`
Ruling: Task8 may wrap only the trusted approve/cancel calendar-effect calls in the existing private continuous-schedule audit context, saving/restoring all five GUCs and using the actual class/request key/operation/reason. Public actor/source/room validation, shared lock, direct-write guard and ACLs remain intact. This fixes the concrete public path required for the session-generation versus makeup race; test success/failure restoration, direct-write denial and public RPC RED/GREEN without preset guard context. Cost if wrong: localized approval/cancellation audit-context repair; an overly broad context could weaken same-transaction write protection, so verify it does not leak.

`progress.md:247`
Ruling: Task9 will close the recorded metadata recovery gap by preserving an already-submitted uncertain create/clone/rename/share/archive/restore command in actor-scoped sessionStorage and recovering its identical body/key after same-tab reload/remount. Preserve subsequent entered fields separately until that receipt is resolved, reuse actor-retirement purge and storage-failure handling, and keep unsubmitted form text under the existing navigation guard rather than promising durable form autosave. A memory-only unknown create after reload can otherwise start a second intent and create another preset. Cost if wrong: localized picker recovery integration and storage schema maintenance; no cross-session localStorage or operating-history writes are introduced.

`progress.md:256`
Ruling: Task8 may replace only that measured normalized-session accumulation loop with ordered set-based jsonb_agg in a CLI-generated migration, preserving every row/status/null/blocker/raw field and lesson.id order plus fingerprint/ACL/lock contracts. Require full-result equality against the original reader and same nonempty dated-history timing/payload evidence; do not truncate history, paginate collision data or change legacy parsing. Cost if wrong: changed reference/fingerprint could affect stale/conflict decisions, so exact JSONB comparison and final-source/ACL audit are release gates.

`progress.md:259`
Ruling: Task8 may avoid unchanged-versus-unchanged pair computation in pointer placement validation while still comparing every changed slot against the complete canonical scope. The brief preferred visible-panel rendering optimization, but profiling proves redundant full-scope all-pairs validation also consumes the frame budget. Preserve conflict ordering/labels, same-class siblings, all shadows/dated occupancy, and existing-conflict repair behavior; exact output-equivalence tests cover the skipped pairs. Cost if wrong: a missed changed-slot conflict could produce misleading UI acceptance, so retain authoritative DB checks and full-scope equivalence regressions.

`progress.md:262`
Ruling: Task8 must also optimize the concretely measured repeated per-row occupancy-key counts in assert_timetable_operational_conflicts_v1 rather than leave an11second global-lock cost on existing operating writes. Group per-date key multiplicities once and inspect only increased occupancy, with exact old/new outcomes and SQLSTATE comparison; preserve every date, source/date overrides, removed skipped overrides, duplicate-key increases, prior conflict repair, baseline/finalizer/auth/lock order. Extend only as justified by a new measured hotspot and rerun covering operational SQL/races plus the same real-write timing samples. Cost if wrong: skipped occupancy changes could weaken conflict protection; semantic parity, edge-case assertions and actual races are required before review.

`progress.md:273`
Ruling: Retain the measured max-cap frame33.6–33.7ms as an explicitly unmet32ms performance target, not aPASS, and finish Task8 after required functional/export/provenance checks instead of broadening into another rendering refactor or rerunning until a favorable sample appears. The brief states a target plus visible-panel optimization; measured full-scope validation and visible-panel fixes now reduce150ms to33.6ms, while normal600-slot workload is17.5ms. Cost if wrong: maximum-size boards can still show occasional two-frame drag response/startup hitches and may need later focused rendering work; preserve exact metric/fixture and expose it to independent review and final QA.

`progress.md:296`
Ruling: Task9 preset-creating import commands must receive the same actor-scoped immutable submitted-request recovery as ordinary create/clone, including source fingerprint and original request key, instead of opening a fresh creation intent after an unknown response and reload. The new import RPC must not recreate the duplicate-preset gap being closed for metadata. Reuse the narrow existing recovery boundary, not broad unsubmitted-form autosave. Cost if wrong: one additive recovery command shape and focused import receipt tests; operating classes and legacy preference originals remain untouched.

`progress.md:302`
Ruling: Legacy recovery must not silently substitute English for a missing subject. Reject malformed missing-subject candidates with an explicit, user-readable metadata error, preserving the source preference; valid historical entries remain importable and unresolved time/resources still use pending. This avoids creating a silently promotable class with invented business metadata. Cost if wrong: a malformed old candidate requires manual reconstruction or a later explicit metadata-repair flow instead of one-click bulk recovery.
