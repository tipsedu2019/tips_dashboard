# Basic class information saves preserve authored lesson history

The class-management form sends a full basic-information patch to `update_class_operational_v1`; it does not send `schedule_plan`. Before this change, updating the weekly classroom could change inferred occupancy of old lessons and run the complete operating-reference validator. An old lesson without a time then rejected an otherwise independent classroom edit with SQLSTATE `23P01` (`timetable_resource_conflict`). The isolated fixture reproduces this with 80 pre-existing authored rows, including missing historic time and overlapping rows.

## Exact behavior and boundary

One existing function is replaced: `public.update_class_operational_v1(uuid,jsonb,uuid,jsonb)`. For a patch without `schedule_plan`, without closing, and without an actual status transition, the existing private exact-row capability is used. It binds the before and expected after row to the authenticated actor, class, request, and transaction. The ordinary basic save does not build the dated/weekly comparison set. It preserves the saved lesson-plan JSON and learning data byte-for-byte as JSON values. Other classes are not written.

Entered nonempty classroom/teacher labels must resolve uniquely in their existing catalogs. Changed weekly strings must have valid weekday/time syntax and intervals; start 24:00 is invalid, end 24:00 is allowed. Existing unchanged missing or malformed fields are not revalidated while editing a different field. Empty/unassigned classrooms remain valid. Another class occupying the same resource is not a blocker for this basic-info command, consistent with the requested input-preserving policy.

Authentication, row and resource locks, exact-row guards, receipt replay, different-payload request rejection, existing table constraints, and textbook retirement behavior remain. A metadata-only update sets the unchanged room as well so the existing statement guard verifies every basic edit. An unexpected trigger that rewrites the lesson plan fails atomically. Notifications and approvals are not sent or executed.

Lesson-plan-only writes keep PR161's existing CAS/input path. Mixed basic-plus-plan commands, actual lifecycle transitions, closing, normalized weekly-default writes, timetable presets, direct table writes and makeup approval retain their prior separate paths. The class-management room edit is a basic-only command, so none of those other paths is required for the reported fix.

## Verification and expectation changes

- Initial synthetic basic room save: failed with `23P01`, historic missing-time detail; final candidate: same ordinary RPC succeeds and retains all 80 original session objects, lesson content, billing JSON, and another class.
- Dedicated basic-info fixture: 37 assertions, including full form payload, per-day resource serialization, missing history, replay, catalog/type/time failures, exact CAS on mixed commands, permission denial, textbook pruning, trigger-drift rollback, capability cleanup, and a reader tripwire proving no operating-reference call on basic save.
- Sixteen SQL files that call this RPC: 1,503 assertions passed. Includes close/roster atomicity, content preservation, shared worksets, normalized and mixed strict boundaries, agent operations and registrations.
- Previously asserted room/teacher/weekly conflicts on the basic RPC are now accepted and exact saved values are asserted. Malformed new inputs still fail: the more specific SQLSTATE is `22023`, before a historical occupancy lookup. Separate strict-path assertions are retained. Synthetic fixture restoration keeps later independent strict tests meaningful.
- Layout and AI receipt contract tests: 79/79, no skips; existing three management/service Node files: 25/25. Migration-layout verifier, changed-file ESLint, Squawk (0 issues), and whitespace checks pass.
- Single-function rollback probe: 5/5; the candidate function is restored after the probe transaction.
- No production write or failure reproduction was used. Local timings are not production performance claims.

The new SQL test is included in both isolated workflows, the exact inventory contracts and AI source closure. This changes the canonical inventory from 105 to 106 SQL files and from 178 to 179 migrations. The 24 probe identities and all previous migration bytes stay pinned. Full-release execution and independent review are separate gates; this note does not claim a new full-schema/fresh-AI release run.

## SQL and recovery scope

Migration: `20261022015000_class_basic_info_input_policy.sql`, 10,310 bytes, SHA256 `9ceff82df3ad1122dd505702320ff733bc0ee1f03782f69347dfda275ed393ff`.

It contains a transaction, local 5-second lock timeout, local 120-second statement timeout, and one `CREATE OR REPLACE FUNCTION`. It adds no table, index, helper, trigger, grant, RLS policy, credential or data migration. Function calls at runtime still perform the authorized user edit; applying the migration itself does not edit class/student rows.

Before approved application, compare the exact function baseline and ledger, check current writes/locks, and stop on drift or lock timeout. Read the result before retrying an uncertain application. Recovery replaces only this RPC with its final PR161 definition from `20261021155723_class_lesson_input_policy.sql`; retain PR161's helpers, receipt tables, registration compatibility and guards. Do not undo saved room values or lesson data. An isolated transactional rollback probe verifies exactly one changed function, unchanged ownership/ACL/security attributes, retained PR161 lesson writer, and a nonempty synthetic class row; the probe then rolls back to the candidate.

After deployment approval, use the existing class-management UI once to select the intended classroom for both weekly slots. Read back the basic fields and per-day serialization, compare the unchanged lesson-plan/learning JSON and unrelated class, and confirm a success receipt. On an uncertain response, re-read first rather than replaying with a new key.
