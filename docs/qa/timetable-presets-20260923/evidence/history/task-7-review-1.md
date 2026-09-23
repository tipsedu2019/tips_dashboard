# Task7 independent review — fb5f3a60

## Spec Compliance

FAIL. Required metadata repair is incomplete. A new science draft cannot obtain the subjectAreaKey required for operating promotion through the placement editor or transfer preview. Otherwise reviewed transfer semantics, atomicity, immutable receipts, current authorization, pending preservation, applied lifecycle, coherent refresh and pending-resolution extension meet Task7.

Actual races, broad no-send/performance, imports, two-actor browser and full release verification remain Tasks8/9.

## Strengths

- supabase/migrations/20260923120931_timetable_plan_transfers.sql:30 shared operating lock before sorted plan/class locks, post-wait authorization; authenticated receipt lookup precedes selection/fingerprint revalidation.
- Same migration:144 fresh classes, schedule initialization then activation, source and receipt changes in one transaction; existing classes not repurposed.
- src/features/academic/timetable-transfer-session.ts:71 persists immutable intent, retains unknown body/key, separates committed refresh failure.
- src/features/academic/timetable-plan-model.ts:472 equal-sequence stale reference protection plus coherent refresh.
- src/features/academic/timetable-plan-interaction.ts:278 atomic one-pending removal/new slots with sibling preservation.

## Important 1 — required science metadata has no repair path

src/features/academic/timetable-transfer-dialog.tsx:80; src/features/academic/timetable-plan-interaction.ts:207; supabase/migrations/20260923120931_timetable_plan_transfers.sql:82.

Server requires an active subject-area key for science. Transfer rows only display metadata/generic blocker, and placement form has no subject-area control. Actual blankPlanItem → placementFormDefaults → buildPlacementFormEdit probe produces fully placed 과학/고1 with subjectAreaKey:null; reopening cannot supply it. Spec§6 requires missing promotion metadata correction from the affected row. Add correction including subject-area selection via existing item mutation and fresh preview. Regression: new science draft → correction → preview → promotion; current fixtures use English only.

## Minor 1 — known weekday lost from pending prefill when time unknown

src/features/academic/timetable-plan-interaction.ts:196.

target requires both weekday and start time. Pending Monday/unknown time opens no weekday selected; actual probe storedWeekday:1, formWeekdays:[]. Preserve weekday independently. Original pending data remains, so avoidable re-entry rather than data loss.

## Focused Checks / Evidence

Reviewer read complete198KB diff in passes, recovered tool-truncated browser setup, no git/source/DB mutation or suite rerun. Read exact progress.md rulings. Inspected cut-off placement editor function body only for metadata controls.

Named checks cleared: final operating assert compares new occupancy to txbaseline, plan-only copies with unchanged operating conflicts allowed; effectiveweekly starts asOfDate; shadowFingerprint includes datedFingerprint; cache helper distinct pending outcome/operating refresh rejects badreads; actor retirement purges shared prefix incltransfer.

Retained logs parsed: pgTAP133/133, focused109/109, actualordering5/5, design10/10, no warning/error noise. TypeScript/ESLint empty successful logs. Private ACL postgres-only; publicauthenticated+retainedservice_role, noPUBLIC/anon. 390px screenshot nooverflow; desktop/mobile+9edgeJSON arelocalfixtureevidence. Audit DELETE workaround provesFK/shadow/appliedsemantics only, not productdeleteflow; noauditfixrequested.

Ran only two new readonlyJSprobes: science metadata and partial-time weekdayprefill.

## Assessment

Spec compliance FAIL. Task quality Needs fixes. Transaction/recovery strong; ordinary science promotion blocked by missing correction UI.
