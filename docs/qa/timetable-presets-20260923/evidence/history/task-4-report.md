# Task 4 — operational conflict guards

Status: DONE_WITH_CONCERNS (local implementation and isolated runtime complete; two-connection races belong to Task8). Base 6abe3b39; branch codex/timetable-presets-20260923. Commit: e1240a77 (feat: enforce shared teacher and room conflict checks).

## Scope and requirements

Implemented one authoritative weekly + dated operating reference and shared guard for all inventoried operating schedule/status/session/makeup/legacy writers. Existing public RPC argument contracts are unchanged. Operating writes never read or reserve future plan drafts. New unresolved active weekly/actual occupancy fails closed; preparing unplaced defaults remain valid. Unchanged existing conflicts and metadata-only edits remain possible; coordinate/resource/effective-date changes are compared, so moving an existing conflicted pair to another overlap is rejected while safe repair is allowed.

New files: migration 20260923085008_timetable_operational_conflict_guards.sql; timetable-operational-service.ts; timetable_operational_conflicts_test.sql; timetable-operational-service.test.mjs. Canonical contract, pure conflict helpers and existing management/operations consumers were extended. No planner UI, transfer implementation, student copying, automatic storage-mode cutover, production migration, provider call, send, push or deployment.

Migration creation used the required CLI:

`/Users/hyunjun/.npm/_npx/66b4952730d9cac8/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration new timetable_operational_conflict_guards`

## Public and private interfaces

- `get_timetable_operational_reference_v1() -> jsonb`: authorized timetable roles only, authenticated execute, anon denied. Returns the canonical TimetableOperatingReference, with no student, roster or lesson-content fields.
- `update_class_operational_v1(p_class_id uuid, p_patch jsonb, p_request_key uuid, p_expected_schedule_plan jsonb DEFAULT NULL) -> jsonb {classRow, closeResult}`: admin/staff, allowlisted update fields, request receipt replay scoped to actor/operation/key. Legacy schedule_plan requires exact old JSON CAS. Normalized-owned schedule/teacher/room direct mutation is rejected. Close invokes the existing close RPC inside the same transaction before locking class metadata. Omitted columns are not dynamically SET. No client skip flag exists.
- Existing save/default/init/generate/session/content/storage/close/makeup public signatures retained exactly. Actual installed signatures are in task-4-definition-audit.json and task-4-final-functions.json.
- `dashboard_private.lock_timetable_operating_resources_v1()` remains the sole lock helper. Exact key: `pg_advisory_xact_lock(pg_catalog.hashtextextended('tips:timetable:operational',0))`. It permits READ COMMITTED / READ UNCOMMITTED writes and rejects REPEATABLE READ / SERIALIZABLE with exact `25001 / timetable_isolation_not_supported`. Reads remain available.
- `read_timetable_weekly_reference_v1()` preserves Task3 weekly foundation. `read_timetable_operating_reference_v1()` adds dated data and coherent fingerprints.
- `timetable_effective_date_v1(reference jsonb, date date) -> SETOF jsonb`, `timetable_occupancy_key_v1(jsonb) -> jsonb`, `timetable_intersects_v1(jsonb,jsonb) -> boolean`, `assert_timetable_operational_conflicts_v1() -> void` implement canonical effective occupancy and change-aware validation.
- Trigger helpers: `timetable_operating_before_statement_v1`, `timetable_operating_after_statement_v1`, `timetable_operating_finalize_v1`.
- `validate_timetable_item_slots_v1` now adds bounded actual-date conflicts while always retaining weekly reservations. get_plan/get_revision reflect bounded dated completeness; mutate_plan validates paired dates.

## Task5/6 dated/reference contract

Canonical types live in src/features/academic/timetable-plan-contract.ts. Existing weekly fields remain: shadowSlots, shadowClasses, catalogs, unresolvedOccupancies, shadowFingerprint, complete. Normalized stable shadow IDs are `live:${classId}:${slotId}`. Legacy weekly slots use deterministic synthetic slot UUID identity; sourceSlotId is null and identity is never inferred by comparing displayed names/times.

Additional fields:

- `asOfDate: string` — server business date in Asia/Seoul.
- `datedSessions: DatedTimetableSession[]` — `{id,classId,sourceSlotId,date,state,startMinute,endMinute,teacherId,classroomId,revision}`; time/resource fields nullable for skipped/tbd or unresolved source. States active/exception/makeup/skipped/tbd. Includes actual sessions under preparing/closed classes too.
- `datedUnresolvedOccupancies: (OccupancyBlocker & {date: string|null, sessionId?: string})[]`; optional opaque occupancyFingerprint excludes labels/content. Null date means unknown date and cannot be narrowed safely.
- `datedComplete: boolean`, `datedFingerprint: string`.
- `TimetableConflict.date?: string` for concrete dated exceptions.

`complete` in the standalone operating reference describes weekly completeness. `datedComplete` describes all actual data. A bounded PlanSnapshot/PlanRevision sets complete=false when an unresolved actual date intersects its range or an unresolved date is unknown. Unbounded weekly editing remains available if weekly complete=true. UI suggestions must use `operatingReferenceComplete(reference, period)` and `findOperatingConflicts(slots,reference,period)`; suggestPlacements accepts optional operatingReference/period and offers no placements for an incomplete applicable scope.

`shadowFingerprint` is intentionally composite: weekly/catalog fingerprint + Asia/Seoul asOfDate + datedFingerprint. Dated fingerprint covers actual sessions, dated blockers, and raw occupancy source values. PlanRevision does NOT need separate datedFingerprint/asOfDate fields for invalidation: its existing shadowFingerprint changes for actual-session-only changes AND local day rollover. Twenty-second visible polling therefore recovers even when a sanitized event is missed. A snapshot still carries separate datedFingerprint for preview/transfer evidence. Content-only edits do not fabricate occupancy changes.

### Distinguish recurring plans from dated operating writes

For a recurring preset, weekly live shadows always reserve their weekly places. Optional targetStartDate/targetEndDate are review metadata, not an operating validity interval or activation scheduler. A skipped/moved day never frees that weekly reservation for another recurring plan. A bounded period ADDS actual active/exception/makeup occupancy (including off-pattern exceptions). Matching normalized actual/default rows with same class/source slot/date and same position/resources are deduplicated in plan conflict display; source-less rows remain additive even if names/times look identical.

For an actual operating date, any matching class/sourceSlot/date session is authoritative over its weekly default. Skipped/tbd suppress the default and reserve nothing; active/exception/makeup reserve actual coordinates. Source-less sessions never suppress a default. Defaults supplement today/future only, using asOfDate from Asia/Seoul. Past dates contain actual sessions only, preserving historical snapshots instead of retroactively reapplying today's weekly pattern. This fixed a real Task1 historical-session regression; evidence is retained below.

Both target dates or neither are now required by canonical PlanCommand type, server validation (`22023 / timetable_invalid`) and table CHECK. Earlier temporary tests that treated skipped dated days as freeing recurring preset weekly space were replaced with the root-confirmed strict recurring rule. No existing operating class lifetime is inferred from these dates.

Normalized makeup newly-created timestamps are explicitly converted to Asia/Seoul. Local 00:30 with UTC previous-day instant remains local date/00:30; 23:30 to next-day00:00 becomes same session date with end_time24:00. Other interior cross-midnight spans reject22023. Only unique exact classroom catalog name resolves ID; missing/ambiguous identity blocks. No historical rows are backfilled.

## Writer inventory and lock order

| Actual writer / service | Final guard and ordering |
| --- | --- |
| management-service createClass / public create_class_with_group_memberships_v1 | Existing SECURITY INVOKER create retained. classes INSERT BEFORE STATEMENT takes global before row mutation; transaction-final DB guard rejects conflicting/unknown final occupancy. PostgREST commit occurs before success response. |
| management-service updateClass status/schedule/teacher/room, closed class metadata | New atomic update_class_operational_v1, global first; close RPC retains existing student/task/class order; then class metadata row lock; final assert and receipt. |
| save_class_schedule_defaults_v1 / initialize_new_class_schedule_v1 | Global before require_continuous class lock; normalized slot rows/projection; assert before return. |
| generate_class_lesson_sessions_v1 / save_class_lesson_session_v1 | Global before class/session locks; statement guards on actual rows/projection; assert before return. |
| save_class_lesson_content_v1 | Global at entry because this content path still projects classes.schedule_plan after class lock. Avoids lock inversion despite unchanged occupancy; content-only fixture produces no false operating signal. |
| backfill_class_schedule_shadow_v1 / verify_class_schedule_shadow_v1 / activate_class_schedule_storage_v1 / deactivate_class_schedule_storage_v1 | Global before class/storage locks; existing explicit mode/verification contracts retained, no planner-driven automatic activation. |
| close_class_atomic_v1 and legacy deleteClass archive path | Global before existing roster/student/task/class locks; existing roster/history behavior retained. |
| operations class-schedule-workspace legacy lesson save | Direct classes.schedule_plan update replaced by atomic gateway + exact expected schedule_plan; stable submitted request key survives ambiguous network retry. |
| public create_makeup_request_v2 / transition_makeup_request_v2 / delete_makeup_request_v2 | Global in OUTERMOST wrappers before assistant permission helper or request locks; original role restrictions and request receipts retained; assert before return. |
| private create/transition/delete_makeup_request_v2_unguarded | Global first also protects internal entry; normalized/legacy effect handlers acquire same reentrant key. |
| private notification_apply/revert_makeup_calendar_effects_v1 and *_legacy_v1, apply/revert_normalized_makeup_effect_v1 | Global before request/session/class access; actual sessions or legacy schedule_plan go through statement and final guards. |
| private require_continuous_class_schedule_mutation_v1, project_continuous_class_schedule_plan_v1, save_continuous_schedule_defaults_rows_v1, reconcile_continuous_schedule_shadow_slots_v1 | Global first, covers internal composition before row/projection work. |
| legacy/stale-client direct classes DML; direct slot/session/catalog DML | BEFORE STATEMENT global precedes DML row locks; transaction-final constraint guard catches bypass; no public skip GUC. |
| registration/transfer roster-only helpers; ops-task-service classes updates at inspected roster/textbook sites | Unchanged. Their fields do not invoke operating statement triggers; zero-row textbook-only UPDATE proves no operating advisory lock. If a path changes guarded occupancy columns, DB guard applies automatically. |
| management metadata-only UPDATE | Changed old upsert to UPDATE(id).select so metadata editing no longer accidentally invokes INSERT operating trigger. Optional class_type/subject_area_key fallback retained; zero affected rows raiseP0002. No schedule/status/resource columns sent. |

Existing public schedule paths operate on one class; existing deterministic roster/student lock order stays intact. Task7 multiple-class composition must obtain the global key FIRST and sort class UUIDs before class row locking. Arbitrary clients may still create a deadlock by manually locking rows before calling guarded SQL; PostgreSQL aborts such a transaction, never bypasses conflict validation. True two-connection contention/race proof is deferred to Task8.

Triggers cover INSERT/DELETE and UPDATE OF:

- classes: schedule,teacher,room,status,start_date,end_date,schedule_storage_mode,schedule_plan.
- class_schedule_slots: weekday,start_time,end_time,teacher_catalog_id,classroom_catalog_id,class_id.
- class_lesson_sessions: session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,class_id,source_schedule_slot_id.
- teacher_catalogs/classroom_catalogs: name,is_visible,subjects.

All five tables have BEFORE and AFTER statement triggers. Private baseline has one deferred constraint AFTER UPDATE trigger. Public signal transport remains the only published table among inspected classes/items/signals.

## Transaction baseline / existing-conflict preservation

Private postgres-owned RLS table timetable_operating_write_baselines stores one txid baseline +ready flag. No client SELECT/DML or helper execute privileges. BEFORE captures once; AFTER marks ready even for zero affected rows. Constraint trigger is queued on UPDATE, not initial INSERT, so SET CONSTRAINTS IMMEDIATE validates after the real mutation. Finalizer compares final state, emits a sanitized operating sequence if fingerprint changed, then deletes the baseline. Multiple queued callbacks become no-ops after deletion. Savepoint/exception rollback rolls back both baseline and mutation. Multiple normal RPCs in one transaction retain the original baseline until flush. Tests cover 0row, multipleRPC, explicitflush, immediate mode followed by additional writes, exceptionrollback, and final baselinecount0.

Changed occupancy comparison contains time, teacher/room IDs, class, weekday/effective date and source identity, not just collision-pair IDs. Duplicate actual source/date rows are counted. Existing unresolved labels may change without creating new occupancy; deleting occupancy is allowed. New unknown active occupancy or changing its actual unresolved values fails closed. New weekly allocations also honor dated unresolved bounds; unknown date blocks all applicable allocation.

## Task7 safe new-class composition

An active/empty intermediate class cannot be returned as a successful standalone normal save. Compose transfer in one database transaction: global lock -> sorted target row locks -> insert new class as 개강 준비 -> initialize normalized slots while still preparing -> update final 수강 status -> assert_timetable_operational_conflicts_v1() -> transfer receipt/return. Use server-private composition, not a client-configurable skip flag. Intermediate active/empty direct DML can exist inside a deferred transaction only if its final committed state is valid. Existing public initialization retains its before-return validation. Do not copy students, waitlists, attendance, notification or lesson history. Transfer implementation itself remains Task7.

## Error and service contracts

Eight final class_schedule_stale producers now use P0001: initialize_new_class_schedule, preview_class_lesson_session_generation, generate_class_lesson_sessions, save_class_lesson_session, save_class_lesson_content, backfill_class_schedule_shadow, verify_class_schedule_shadow, activate_class_schedule_storage (all _v1). All eight were invoked against installed final functions with exact SQLSTATE pgTAP assertions. Genuine40001 remains unknown/non-domain in the client mapper. Unrelated historical makeup-state40001 definitions are outside this enumerated correction and were not relabeled.

Conflict and unresolved operating occupancy =23P01/timetable_resource_conflict (shared safe consumer message); unsupported isolation =25001/timetable_isolation_not_supported. Service error messages are localized without clearing drafts. Operational gateway retry retains same request key for identical submitted body across lost response. Workspace generation/session/legacy saves retain request key across retry. Successful gateway/defaults/initialize writes return cache-pending separately; existing management notice reports saved state and cache refresh waiting. Final focused regression reproduces then fixes defaults/initialize cache exceptions escaping as save failures.

## Executed evidence

Evidence directory: `.superpowers/sdd/2026-09-23-timetable-presets/` (ignored, deliberately not staged). Runtime: isolated Docker tips_timetable_20260923, public.ecr.aws/supabase/postgres:17.6.1.159; network none/no ports/no production data; container never reset. All fixtures rollback.

Exact psql runner:

`/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -At`

RED logs:

- task-4-red.log: original path-specific conflicts allowed and stale producers40001; six failures.
- task-4-service-red.log: new service contract absent.
- task-4-makeup-timezone-red.log: actual normalized makeup stored UTC minutes/date instead of local time; four failures before fix.
- task-4-historical-projection-red.log: Task1 preserved history regression from projecting today's weekly defaults into past dates.
- task-4-defaults-cache-red.log: actual service defaults save propagated cache exception after committed RPC; 1/8 failure before focusedfix.

GREEN commands/results:

1. Runner `< /tmp/task4-producer.sql > .../task-4-operational-green.log`: 88/88 across actual RR(5), SERIALIZABLE(5), RCmain(78) rollback transactions. /tmp/task4-producer.sql is committed timetable_operational_conflicts_test.sql plus final captured reference JSON SELECT before rollback. Plans5+5+78, all ok-lines parsed, no not-ok/error. The committed SQL file is independently executable with the same runner. Checks include actual authenticated/anon roles, all eight exact stale errors, teacher/room cross-subject collisions, gateway/default/init/generation/session/makeup/storage/content paths, legacy bypass, baseline lifecycle, KST boundaries, dated authority, prep/closed actual sessions, unchanged conflict vs changed coordinate, drafts ignored, paired periods, sanitized signals, no-send/student-history snapshots.
2. Runner `< supabase/tests/timetable_schedule_mutation_safety_test.sql > .../task-4-task1-regression.log`:60/60. Two-line fixture amendment puts incomplete/unassigned projection fixture in preparing state; all projection assertions retained. New Task4 separately rejects active unresolved occupancy.
3. Runner `< supabase/tests/timetable_plan_storage_test.sql > .../task-4-storage-regression.log`:73/73.
4. Runner `< supabase/tests/timetable_plan_permissions_test.sql > .../task-4-permission-regression.log`:24/24.
5. `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/timetable-operational-service.test.mjs tests/continuous-class-schedule-release2-service.test.mjs tests/management-continuous-class-schedule.test.mjs tests/management-class-close-atomic.test.mjs tests/management-service-schema-fallback.test.mjs tests/timetable-conflicts.node.ts > .../task-4-node-green.log 2>&1`:47/47 final focused suite, zero failed/skipped. Includes metadata UPDATE fallback/zero rows, actual gateway retry, dated consumer parity and final defaults/initialize pending receipt.
6. Same node `node_modules/typescript/bin/tsc --noEmit --incremental false > .../task-4-tsc.log 2>&1`:exit0, empty diagnostics.
7. Actual nonempty SQL JSON in task-4-producer-reference.json assigned to canonical TimetableOperatingReference in task-4-producer-contract.ts; strict standalone TypeScript compilation passed, task-4-producer-contract.log empty.
8. `python3 /tmp/task4-audit.py`: parses all pgTAP assertions + finish plans/errors (not just process status), compares final installed pg_get_functiondef body to final migration, original signatures, owners, search_path and private ACLs:43/43 matching final bodies. Raw task-4-final-functions.json, task-4-definition-audit.json. Eight stale producers verified there as well as runtime.
9. task-4-final-table-acl-triggers.log: private baseline RLS/no client privileges, baselinecount0, signal RLS/auth SELECT only, all11 final triggers, only sanitized signal published among affected tables.
10. `git diff --check`:pass. Final full migration applied transactionally with COMMIT:task-4-final-apply.log. Iterative local reapply dropped only Task4-owned triggers/baseline/date-pair constraint, never reset baseline container or Task1/Task3 foundations.

Self-review completed on final migration/function/ACL/lock order, source and focused tests. No extra broad test loop after final service-only fix; DB evidence remains valid because final DB source was unchanged.

## Remaining limits and handoff concerns

- Task8 must run actual two-connection races, including pinned-snapshot RR attempts, concurrent plan vs operating mutation and opposite-order contender scenarios. Task4 provides exact isolation error/path evidence but does not claim race execution.
- Local DB has no Realtime server/network. Signal table mutation/RLS/publication verified; websocket delivery and production rollout remain separate gates. Composite revision fingerprint provides polling fallback.
- Pre-existing comma-containing legacy teacher text remains intrinsically ambiguous and returns a blocker; normalized IDs are authoritative. No silent normalization or historical backfill.
- No browser visual claim: changed consumer error/receipt integration is covered by focused service/type tests; planner UI comes later.
- Public create remains the existing invoker RPC and relies on transaction-final guard for direct clients; Task7 should use the preparing->slots->active composition above and explicit final assertion.
- No production migration, provider activation, notification send, push or deploy was performed. Stop gate remains in effect until independent review + Task8 prove complete concurrency behavior.

## Review fix round 1 (base e1240a77)

All four Important findings in task-4-review-1.md addressed; no unrelated exploration or new feature scope. Final fix commit: 609cb7e7 (fix: preserve bulk schedule ownership and legacy occupancy diagnostics).

1. Bulk management's actual merged-row caller now passes resolveScheduleOwnership:true. updateClass reads get_class_schedule_defaults_v1 for EACH class and uses its authoritative storageMode (not row labels or a potentially runtime-gated authoritativeSource) to omit schedule-owned columns for normalized classes. Status/name/metadata still pass to the unchanged atomic gateway; legacy/shadow payload behavior remains. Missing/unknown mode fails closed before mutation. Gateway normalized-column rejection was not weakened. Tests invoke actual service with merged bulk rows and mock the real gateway rejection for schedule-owned keys, for both status and name updates across mixed normalized/legacy rows, plus unavailable mode. The public RPC argument contract is unchanged; ownership resolution is an internal service option.
2. Legacy session date parses independently before resource/time/identity validation. A known date remains in the blocker even when other fields are invalid; only unknown/invalid date yields null. Tests exercise known past, in-period, out-of-period and unknown date against actual public reader, get_plan, get_revision and changed weekly operating writes. Past/out-of-range blockers no longer globally invalidate unrelated planning/operating work.
3. Original legacy start/end time text is checked for whole-minute precision BEFORE PostgreSQL time casts. Nonzero seconds/fractional seconds become a date-scoped unresolved blocker and never canonical truncated minutes. Even fractions smaller than PostgreSQL time precision cannot round into a valid reservation. Exact :00 / :00.000 are equivalent whole-minute representations and remain accepted. Original schedule_plan JSON is unchanged. Actual 10:00:30 and 10:00:00.125 fixtures prove source preservation, blocker date, absence from canonical datedSessions, bounded plan incompleteness and rejection of an apparently adjacent10:00 occupancy.
4. Legacy null/string/number elements are shape-checked before object-only subtraction. Their original JSON safely supplies the opaque fingerprint, and they become unknown-date blockers. Each fixture proves reader/baseline does not crash, exact source remains, blocker fingerprint exists, bounded preset is incomplete, and new operating allocation rejects with the domain conflict (not cannot-delete-from-scalar).

Minor: touched Task1 fixture initializes pgtap conditionally via pg_extension check; no global warning suppression. Its rerun has no NOTICE. No history normalization, student/notification change, signature/ACL/lock/idempotency change, production/provider operation, push or deploy.

### Retained RED and covering GREEN

Evidence directory is the same ignored `.superpowers/sdd/2026-09-23-timetable-presets/`.

- RED command: node --test --experimental-strip-types tests/management-continuous-class-schedule.test.mjs → task-4-fix1-bulk-red.log. 3 failures: actual status/name service saves returned22023/class_schedule_validation; unknown mode did not reject.
- RED command: psql runner below < supabase/tests/timetable_operational_conflicts_test.sql → task-4-fix1-db-red.log. Actual old installed reader produced32 not-ok assertions across the four boundaries; finish plans5+5+125 retained. Process status alone was not used as pass evidence.
- Final reader-only application (container untouched otherwise): psql runner < /tmp/task4-fix1-reader.sql → task-4-fix1-apply.log, CREATE FUNCTION. That file is the exact final reader definition extracted from the existing not-yet-released Task4 migration.
- GREEN command: psql runner < supabase/tests/timetable_operational_conflicts_test.sql → task-4-fix1-db-green.log:135/135, finish plans5+5+125, no not-ok/ERROR/NOTICE. Includes47 added assertions; all transactions rollback.
- GREEN command: psql runner < supabase/tests/timetable_schedule_mutation_safety_test.sql → task-4-fix1-task1-green.log:60/60, no not-ok/ERROR/NOTICE, rollback.
- GREEN command: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/management-continuous-class-schedule.test.mjs tests/timetable-operational-service.test.mjs tests/management-service-schema-fallback.test.mjs tests/management-class-close-atomic.test.mjs` → task-4-fix1-node-green.log:38/38, zero skipped/failed.
- Type command: same node `node_modules/typescript/bin/tsc --noEmit --incremental false` → task-4-fix1-tsc.log:exit0, empty diagnostics.
- `git diff --check`:pass. No repeat of unrelated Task3/broad test suites.

Exact psql runner: `/Users/hyunjun/.local/bin/docker exec -i tips_timetable_20260923 psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -At`.

Final installed evidence: task-4-fix1-final-reader.json contains pg_get_functiondef/prosrc/signature/owner/search_path/SECURITY DEFINER/anon/authenticated execute flags. A Python comparison against the final migration reader and prior final-definition metadata passed; reader SHA256 ffca9763581fb571cdfff8be92638502bcfab8b778818838c1a5cb4bcba324a7. Original no-arg signature, postgres owner, empty search_path, definer=true, anon/authenticated execute=false retained. task-4-fix1-audit.log also parses each pgTAP ok-line and finish plan and rejects not-ok/ERROR/NOTICE. This updated reader artifact supersedes only the reader body in the earlier43-function dump; other42 functions were unchanged.

Self-review covered the six changed files and all four reviewer findings. Remaining concerns remain the prior handoff gates only: Task8 actual two-connection races, later browser recovery and actual Realtime delivery; no new unresolved scope. DB write ownership returns to root after final report.
