# Lesson input preservation — local implementation evidence

## Scope and status

Base: `59c0621749349d511a2010a7162ce123abd70704` (production PR159/160 baseline). The held performance candidate `6f33c07c0f16c23f3ddc27d34e40a3fe49cbfea5` is not included. This candidate implements the user's explicit policy that lesson schedules store authored dates, times, teachers, classrooms and notes without date-by-date occupancy blocking.

Local implementation and focused validation only. No production reads/writes, schedule save retry, SQL installation, push, PR, merge or deployment occurred in this phase. Independent review of the immutable candidate is the next step, not a completed release gate. Existing production 70 lessons and Chrome 352210481's October nine-lesson draft were not touched.

## Implementation boundaries

- Legacy lesson UI reads and edits materialized rows by stable identity rather than rebuilding every row from weekday defaults. An explicitly added month/range can generate new rows; existing rows, order, learning content, billing ownership and opaque historical values are retained. Distinct lesson identities can share a date and interval.
- Normalized note editing/merge/save preserves memo, public note and teacher note whitespace and deliberate empty values. Approved makeup rows remain read-only by exact session identity; an unrelated ordinary row sharing that date remains editable. Date-level calendar ambiguity and broader layout/scroll/selection UX remain a follow-up, not a completed redesign.
- Existing `update_class_operational_v1` receives the input policy only for an exact `{schedule_plan}` patch. Mixed/basic-information/closure commands retain their original strict path.
- Normalized `generate_class_lesson_sessions_v1` and `save_class_lesson_session_v1` retain authentication, class authorization, revision checks, catalog references, generation identity uniqueness, audit and request-receipt behavior. Projection updates only the changed keys, preserving peer JSON and array positions.
- Shared occupancy reader/validator/assertion, generic projection, weekly-default and makeup-approval policies are unchanged. Completed makeup reflection and owned makeup rows remain protected. The changed tests retain strict diagnostics by exercising mixed patches where appropriate; they do not disable the shared validators.
- Whole-plan CAS/revision, request key/body hash replay, atomic receipt/data rollback, valid changed wire values and references remain. Unchanged malformed historical rows are retained only up to their previous multiplicity. Explicit deletion with a current CAS is allowed; the implementation never silently regenerates IDs.

## SQL footprint

`supabase/migrations/20261021155723_class_lesson_input_policy.sql`

- 37,354 bytes; SHA256 `67186bb67b32982f1bce9b9e8aa881fec97ed53756b94b3d1d0ebf2a35bb1525`.
- Replaces five existing functions: the three public gateways above and private `timetable_operating_before_statement_v1` / `timetable_operating_after_statement_v1`.
- Adds eight owner-only private helpers, one private transaction-scoped capability table and five AFTER ROW guards. Existing public table RLS/ACL, indexes, constraints and auth functions are not changed. New private objects revoke direct access/execution from PUBLIC, anon, authenticated and service_role.
- Each capability is tied to actor, transaction, command, relation, SQL operation and exact OLD/NEW rows. It is not a client GUC. Suppressed/extra/altered/nested writes fail atomically. A preceding strict segment must validate before a lesson scope opens; later strict writes start their own baseline. Constraint modes are unchanged.
- Pure lesson input does not build a global timetable reference. A pre-existing strict segment deliberately retains its validation boundary and cost.

The official migration CLI created the file. Local clean replay installed the existing 177 migrations, then this exact migration. Squawk reported zero issues. Existing owners/ACLs for all five replaced functions, five shared definition hashes, public policies and parameter ACLs matched the captured local baseline after testing and rollback rehearsal.

## Focused runtime verification

Network-isolated PostgreSQL container `tips_timetable_input_20261021` (`203f84d9…`) used only synthetic users/classes/resources. No ports were published. It was normally stopped and removed after verification; race fixtures and audit history were removed with the owned database, not by disabling audit guards.

- New policy pgTAP: **77/77**. Exact 70→79 plan, October/November/December 9/8/8, original 70 rows and learning/billing/order preserved, duplicate request vs distinct same-date identity, incomplete history, authorization, invalid types/references, CAS, replay, mixed strict boundaries, row/column/nested-write guards, immediate/deferred mode, rollback, normalized generation/edit/projection and no-send.
- New full-save performance contract: **38/38**. Actual authenticated RPC plus deferred completion; exact read-back, old rows/periods/history, October settlement key and request replay/stale rejection.
- Existing relevant SQL: **29 files / 2,289 assertions**, all passed. Includes operating conflicts, nullable-room policy, shared workset/reader, mutation safety, isolation, class closure, normalized release2, makeup approval occupancy and collision candidates, preset permissions/no-send and registration observation booking.
- Real two-connection races: **2/2**. Advisory wait observed; different keys with the same old snapshot produce `00000/P0001` and one receipt. Identical key/payload produces two equal successful responses and one receipt. Final JSON and unrelated synthetic domain hashes are intact.
- UI validation: React+authored-helper **63/63**, followed by the final opaque-history React case **1/1**. A subsequent narrow normalized-note/approved-row/record-contract set passed **16/16**. These are successive runs with overlap, not a claim of80 distinct tests. The final UUID/form-shape helper run passed **11/11**; final TypeScript and changed-file ESLint passed.
- CI inventory/immutable-source contracts: layout **49/49**, receipt **29/29**, then changed-source inventory checks **2/2 + 2/2**, skipped 0. Existing 177 manifest entries remain exact; final inventory is 178 migrations, 105 SQL files and the unchanged 24 probes. Workflow changes only add the new tests.

The canonical 105-SQL/24-probe workflow and all unrelated Node suites were not rerun. No remote CI success is claimed. Five additional older-stage diagnostics were attempted outside the canonical105 list; each had the **same failure with the baseline five function definitions**: Google Chat's missing dblink setup, two notification-import/settings fixture contracts, backfill auth-user fixture FK and foundation runtime0/old pgTAP expectations. These are recorded as unsuccessful extra diagnostics, not counted as passing tests or reasons to weaken assertions/permissions.

## Synthetic performance, not production latency

Three paired runs used the same container, unchanged synthetic background fingerprint and identical fixture: 84 background classes ×128 dated rows (10,752), plus a target70 and requested October9. Four unrelated synthetic race classes were present identically for every paired run. Each variant was rolled back, including function replacements used only to measure the baseline.

| Variant | RPC + deferred completion (ms) | Median | Global reference calls |
| --- | --- | --- | --- |
| Baseline | 1173.80 /1188.41 /1162.41 | 1173.80ms | 3 |
| Candidate | 7.55 /7.66 /7.62 | 7.62ms | 0 |

This confirms removal of the repeated full-reference work under the changed policy. It does not estimate production speed or establish that operational SQLSTATE57014 is resolved. The synthetic statement budget was8s; production scale/hardware and live result still require post-release verification. This is a policy change, not merely a faster equivalent conflict checker.

## Recovery and release prerequisites

`../nullable-room-handoff/input-policy-rollback-review.sql` restores the exact five captured baseline definitions and explicitly removes the five new triggers, eight private helpers and scope table in dependency order, without CASCADE or deleting accepted data/receipts. A transaction-only local dry run succeeded and ROLLBACK restored the candidate catalog. Reverting policy can make later strict edits reject already accepted overlaps; never delete history to hide that consequence.

Before any publication/release: independent review of the exact immutable candidate; complete applicable release gates with honest current evidence; separately confirm this **new SQL footprint** and authorized production application. Prior PR159 SQL approval is not approval of this new migration. Preserve auth/RLS/ACL and existing guardrails. Do not reapply PR159/160 or resume014.

After an eventual approved release, confirm the actual deployed code/schema, read the current English class before saving, then submit only missing October1/6/8/13/15/20/22/27/29 at19:30–21:30 (권용재/별관2강), October billing ownership. Verify existing70 preserved, October9/November8/December8 and total79 by fresh read. A success message alone is not completion.

## Evidence index

Local evidence directory: `../nullable-room-handoff/` relative to the repository:

- `input-policy-local-migration.log`, `inputpolicy20261021-clean-replay.log`
- `input-policy-new-policy-final.json`, `input-policy-direct-contracts.json`
- `input-policy-paired-benchmark.json`, `input-policy-concurrency.json`
- `input-policy-baseline-diagnostics.json`, `input-policy-ci-inventory-evidence.json`
- `input-policy-baseline-five-functions.sql`, `input-policy-baseline-catalog.json`, `input-policy-candidate-catalog.json`
- `input-policy-rollback-review.sql`, `input-policy-rollback-dry-run.log`, `input-policy-cleanup.json`

The implementation handoff outside Git records the final candidate commit/diff hash and UI validation evidence. The first concurrency runner failed while collecting output ordering, and its attempted fixture deletion failed on an audit FK; both were preserved as test-harness evidence. Corrected runs passed without changing product SQL or audit protections. Cleanup was verified by a separate read after a case-sensitive status-message assertion failed; no second removal was attempted.
