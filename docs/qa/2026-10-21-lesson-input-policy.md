# Lesson input preservation — local implementation evidence

## Scope and status

Base: `59c0621749349d511a2010a7162ce123abd70704` (production PR159/160 baseline). The held performance candidate `6f33c07c0f16c23f3ddc27d34e40a3fe49cbfea5` is not included. This candidate implements the user's explicit policy that lesson schedules store authored dates, times, teachers, classrooms and notes without date-by-date occupancy blocking.

Local implementation and focused validation only. No production reads/writes, schedule save retry, SQL installation, push, PR, merge or deployment occurred in this phase. The latest follow-up section records the two independent review rounds and current verification status; exact-head re-review of the final UI correction is still pending. Existing production 70 lessons and Chrome 352210481's October nine-lesson draft were not touched.

## Implementation boundaries

- Legacy lesson UI reads and edits materialized rows by stable identity rather than rebuilding every row from weekday defaults. An explicitly added month/range can generate new rows; existing rows, order, learning content, billing ownership and opaque historical values are retained. Distinct lesson identities can share a date and interval.
- Normalized note editing/merge/save preserves memo, public note and teacher note whitespace and deliberate empty values. In the UI, approved makeup rows remain read-only by exact session identity; an unrelated ordinary row sharing that date remains editable. Date-level calendar ambiguity and broader layout/scroll/selection UX remain a follow-up, not a completed redesign.
- Existing `update_class_operational_v1` receives the input policy only for an exact `{schedule_plan}` patch. Mixed/basic-information/closure commands retain their original strict path.
- Normalized `generate_class_lesson_sessions_v1` and `save_class_lesson_session_v1` retain authentication, class authorization, revision checks, catalog references, generation identity uniqueness, audit and request-receipt behavior. Projection updates only the changed keys, preserving peer JSON and array positions.
- Shared occupancy reader/validator/assertion, generic projection, weekly-default and makeup-approval policies are unchanged. Completed makeup reflection retains the existing approval path; owned makeup rows are protected in the UI. Independent review reproduced an existing server limitation on both baseline and candidate: ordinary normalized RPC editing of an approved row can cause subsequent approval cancellation to fail with makeup_lesson_session_stale. This change does not claim server-wide immutability or fix that separate issue. The changed tests retain strict diagnostics by exercising mixed patches where appropriate; they do not disable the shared validators.
- Whole-plan CAS/revision, request key/body hash replay, atomic receipt/data rollback, valid changed wire values and references remain. Unchanged malformed historical rows are retained only up to their previous multiplicity. Explicit deletion with a current CAS is allowed; the implementation never silently regenerates IDs.

## SQL footprint

`supabase/migrations/20261021155723_class_lesson_input_policy.sql`

- 36,891 bytes; SHA256 `f9da4cf18a4380ce37c14f8c42be65d64c5491894bf2562527ab2081f336e587`.
- Replaces five existing functions: the three public gateways above and private `timetable_operating_before_statement_v1` / `timetable_operating_after_statement_v1`.
- Adds seven owner-only private helpers, one **permanent** private capability table with a primary-key index, and five AFTER ROW guards. The table is not temporary; only its rows are transaction scoped. Existing public table RLS/ACL, indexes, constraints and auth functions are not changed. New private objects revoke direct access/execution from PUBLIC, anon, authenticated and service_role.
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

These measurements belong to the prior bab7b30 candidate. They include the authenticated RPC and SET CONSTRAINTS ALL IMMEDIATE, but exclude HTTP/PostgREST, network and durable COMMIT latency. The pairs used fixed baseline→candidate order, and the baseline comparator restored five function definitions inside the candidate schema, leaving the new row guards installed. The original paired runner source was not retained; the six raw execution logs are retained. This confirms removal of the repeated full-reference work under the changed policy within that experiment. It does not estimate production speed or establish that operational SQLSTATE57014 is resolved. The synthetic statement budget was8s; production scale/hardware and live result still require post-release verification. This is a policy change, not merely a faster equivalent conflict checker.

## Recovery and release prerequisites

`../nullable-room-handoff/input-policy-rollback-review.sql` restores the exact five captured baseline definitions and explicitly removes the five new triggers, seven private helpers and scope table in dependency order, without CASCADE or deleting accepted data/receipts. A transaction-only local dry run succeeded and ROLLBACK restored the candidate catalog. Reverting policy can make later strict edits reject already accepted overlaps; never delete history to hide that consequence.

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


## Independent-review P2 follow-up (2026-10-22)

The prior immutable candidate `bab7b30e0955d130e577a3a45be070d964e63acf` received three P2 findings. The independent four helper and two React fixtures were copied into the existing registered test files without changing their assertions. Before edits they reproduced **5 failures / 1 pass** (`input-policy-ui-review-red.log`). After the fixes they all pass in the complete related runs; no independent fixture was removed or softened.

- An end-time edit now applies only explicitly changed schedule fields, preserving the row's existing start time, ID, billing metadata, memo and learning content. An unchanged fallback stays in the date map instead of being materialized into the row; shadowed known schedule keys are removed, while opaque map metadata is retained. Calendar map edits and newly created makeup rows also cannot import arbitrary row metadata. Partial form input, no-op, reset and makeup metadata regressions are covered.
- Clearing an ordinary makeup link restores the original lesson to active and removes only its linked ordinary makeup row. Approval/decision logic is untouched.
- Selected-row, original-lesson and drag-source lookups tolerate null history. Opaque array elements remain in the save payload at their original positions; they are not removed from stored history.

The single-use `finish_timetable_strict_boundary_v1` body was folded into `begin_class_lesson_input_scope_v1`, reducing the new private functions from eight to seven. Prior strict validation, invalidation and baseline cleanup remain in their original order. A missing strict baseline skips only that block, not scope issuance. No locks, receipts, revision checks or shared validator definitions changed in this follow-up.

### Why the remaining SQL structures exist

This is not a function-only migration. Its exact objects are five existing function replacements; seven new private functions; `dashboard_private.class_lesson_input_scopes` with its primary-key index and RLS; and five new AFTER ROW triggers. New objects have no API privileges. Existing public RLS/ACLs, auth functions, table constraints and indexes are not modified, and there is no business-data migration.

| New private helper | Purpose |
| --- | --- |
| `begin_class_lesson_input_scope_v1` | Close any preceding strict segment and issue a private, actor/transaction/statement/row-bound capability. Shared by three official writers. |
| `end_class_lesson_input_scope_v1` | Verify statement completion and exact row consumption, then delete the scope; shared by three writers. |
| `class_lesson_input_after_row_v1` | Compare actual OLD/NEW values and row identities after BEFORE-trigger processing, including nested writes. Shared by five guards. |
| `assert_class_lesson_input_fields_v1` | Validate changed types and catalog references, shared by row and date-map validation. |
| `assert_legacy_lesson_input_v1` | Preserve opaque unchanged history while validating authored rows and identities. Kept separate for readable gateway code; inlining would not reduce the validation work. |
| `write_class_lesson_plan_input_v1` | Reuse exact class UPDATE/CAS behavior for direct legacy input and normalized projection. |
| `project_class_lesson_input_sessions_v1` | Update only specified normalized IDs in their original JSON positions; the existing generic projection rebuilds peers. |

The permanent private table supplies non-client-writable capability state across statement and row trigger execution. Each transaction has at most one row, normally inserted/consumed/deleted inside one statement; failures roll it back. It incurs real table write work. The two guards on classes and class_lesson_sessions check the intended target. Three guards on class_schedule_slots, teacher_catalogs and classroom_catalogs reject nested writes to other operating data, including columns absent from the existing UPDATE-column trigger lists. Outside a scope all five guards still execute a lookup then return; their cost is not zero.

A client GUC, caller role or trigger depth alone cannot prove the exact allowed statement/row set. Reusing the existing operating baseline/proof table would require changing its reference/finalizer/foreign-key consumers. Removing the two catalog guards weakens the existing exact-write boundary; replacement guards would still be needed. Transition-table triggers would require event-specific redesign beyond this narrow change. The scope and guards are therefore retained for the current security boundary; they are not claimed to be the mathematically smallest possible design. Inlining the single-use finisher is the concrete reduction made here.

### Exact follow-up verification and limits

- Related UI/helper/month/source-contract Node run: **112/112**, skipped 0. TypeScript, changed-file ESLint and production build pass.
- New task-owned network-isolated DB `tips_timetable_input_p2_20261022`: clean baseline/prerequisite + **178 ordered migrations** applied. Unchanged policy **77/77** and full-save contract **38/38** pass with the new SQL hash, including reader zero and 70→79 preservation. No new production latency claim is made.
- Runtime catalog: exactly five baseline function definitions changed and seven added; the sole-use helper is absent. All other public/private function definitions and replaced-function metadata match baseline. Existing public table metadata matches baseline, and public policies match the prior reviewed candidate. The known isolated setup reconciliation removes the old `makeup_notification_settings_staff_write` policy; this is not an effect of this migration. New table/helper API privileges are denied, RLS enabled, PK count 1, guard count 5, residual scope 0, diagnostic parameter ACL null.
- Updated exact rollback: **11/11**, existing definitions/security metadata and business rows/receipts preserved, new objects removed within the rehearsal, then ROLLBACK restored the candidate catalog exactly. Rollback file: **13,635 bytes**, SHA256 `7103a73ca405c97fba387c84e0f8ec2e38cca87b85939eae63b82d8d6e1ff6e6`.
- Migration layout, domain SQLSTATE and Squawk pass (0 issues). Prior independent **8 SQL / 557 assertions**, two actual concurrency races and rollback 11 remain evidence for bab7b30; they were not rerun wholesale or relabeled as new-head tests. The new SQL inlining is covered by the two SQL files and new rollback/catalog checks above.

At the first P2 handoff, canonical **105 SQL / 24 probes**, applicable AI producer/consumer parity, full release contract flags and remote CI had not been executed for that candidate. The subsequent independent execution and its reuse are recorded below; remote CI remains unexecuted. Narrow follow-up success does not establish the three full required release checks. Exact-head independent re-review is pending. A no-weekday new month remains a separate UX boundary; this fix does not alter weekday policy. NULL expected-revision handling and the approved-row server limitation found on baseline are not newly proven safe or repaired here.

No production write, publish, merge, deployment, migration application, or October save retry occurred. Production 70 rows and the October draft remain untouched. There is no current access blocker: normal approved Docker escalation succeeded after the default sandbox denied socket access. No socket permissions or other container state were changed.

Follow-up evidence prefix in `../nullable-room-handoff/`: `input-policy-p2-*`, plus `inputp2-clean-replay.log` and `input-policy-ui-review-red.log`. The baseline-policy comparison first failed because of the documented setup reconciliation; its corrected comparison explicitly records that difference instead of treating it as a product change. Final immutable candidate/diff and resource cleanup are recorded in the follow-up handoff.


## Second P2 follow-up — cancellation and actual reader parity

Review source: `/Users/hyunjun/Documents/Codex/2026-10-22/task/input-policy-p2-review/independent-review.md` and `execution-summary.json`, reviewed head `4c1dea8596064803abb92b8ad847efe849fa3ae8`. This follow-up changes **one product helper only** (`legacy-authored-lesson-plan.ts`), its tests and this evidence document. SQL, shared JS resolver, SQL resolver, permissions, atomic gateways and approval workflow are unchanged. The SQL remains **36,891 bytes / f9da4cf18a4380ce37c14f8c42be65d64c5491894bf2562527ab2081f336e587**; its prior object inventory and rollback remain exact.

The first cancellation is now distinct from makeup unlinking: absent and empty map dates compare equally, and an empty unlink with no actual source/map/link is a no-op. A real linked makeup still restores the source to active. Thus a first ordinary calendar click remains exception instead of being overwritten by the restore path.

The prior field-removal representation was incompatible with the existing resolver: any object date map substitutes for the entire raw schedule source. For a unique date with an existing object map, the writer now mirrors only the raw row's own six schedule fields into that map. It retains unedited map fallback values and opaque map metadata, and it never imports map IDs/billing/notes/learning content into the raw row. Raw rows still receive only explicitly edited fields. Explicit resource changes clear stale resource names; explicit room changes/reset also clear the semantic classroomUnresolved marker. Reset clears known schedule overrides from both sources. No new map is created for a missing/nonobject map. Date-map-to-row edits require exactly one total row on the date, including approved peers.

**Assertion integrity:** original six independent fixtures and the two new actual React reproductions retain identical assertion calls (8/8 verified by AST extraction). Before changes, the seven new adjacent helper/React cases reproduced 5 failures and 2 passes. One additional helper's exact `{opaque:…}` map-shape expectation was deliberately corrected to the full synchronized schedule-plus-opaque object: that metadata-only shape cannot yield the required raw values with unchanged readers. Its effective 15:30, explicit NULL-room and raw-preservation assertions remain intact. Earlier local tests that expected stripped schedule keys were likewise changed to exact synchronized objects, not loosened presence checks.

New validation:

- Related React/helper/month run **93/93**, skipped0, including old six and new two. A subsequent single-case React run adds only payload capture diagnostics and passes1/1; it overlaps the93 and is not an additional distinct test. TypeScript, changed-file ESLint, production build and diff checks pass.
- Actual helper output plus actual React DOM→Save RPC-stub payload feed the unchanged JS consumer. **12 JSON inputs** then feed the final ordered SQL resolver in read-only transactions, with complete returned objects equal to JS in **12/12** cases. They cover partial map, metadata-only starting map, explicit NULL room/stale marker, retained raw start, reset, calendar map editing, ordinary same-date peers, approved peer, first cancellation, true restoration and actual React save. The regression's actual SQL end is **13:30**, kind resolved; it is no longer10:00.
- SQL verification used a fresh own network-none PostgreSQL17 container and the exact final pure resolver definition selected from the hash-verified ordered migration manifest. It did not replay the entire schema or exercise a class-save RPC. Only local schema/function setup and read-only JSON SELECTs were performed; no business fixtures or production data were written. The container was stopped, removed with its volume and confirmed absent. This is actual SQL consumer execution, not an operational save claim.
- The parent's independent whole run on4c1dea passed **105 SQL /6,922 assertions**, **24/24 probes**, **AI consumer3/3**, Linux fixture10/10 and migration-layout negative49/49, with required runtime flags. SQL, scripts, workflows and probes are byte-unchanged in this follow-up; all **82 receipt source-file hashes** still match. These results are reused by source/impact comparison, not rerun or relabeled as remote CI/current-head full execution. The original local run used its documented transport adapter; its limitations remain.

Remaining existing boundary: multiple same-date rows with an existing shared object map are ambiguous to the unchanged resolver. This helper leaves that shared map and peers intact; it does not claim that editing one ID resolves this old ambiguity. Same-date independent rows without a shared map and approved peers were explicitly verified. The approved-row server ownership limitation, NULL revision-input limitation and no-weekday new-month UX boundary remain separate, unchanged issues.

No publication, merge, deployment, operational SQL or lesson save was attempted. The production70 and October draft remain untouched. Exact-head independent re-review is the next step. Final source/diff identity, assertion comparison, full-run reuse provenance, read-only SQL inputs/results and cleanup are in `../nullable-room-handoff/input-policy-p3-*`.
