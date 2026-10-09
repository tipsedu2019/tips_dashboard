# Registration contact lifecycle integration: source candidate

This is an isolated source proposal at base `f2d308a0e2999a80f37f77f53341286561b92d51`, including the exact PR96 function replacements. It is **not installed, not a migration, and not approved for production application**. Database preparation was rejected by automatic approval review; no DB, Docker, SQL runtime, production query, real student fixture, secret read, commit, push or deployment was performed for this work.

Candidate: `docs/security/sql/registration-contact-lifecycle-integration-draft.sql`. Source checks: `tests/registration-contact-lifecycle-integration-source.test.mjs`, **23/23 passed** with the cached Node runtime. These checks verify exact final source pins, all 39 ordered text transformations and selected contracts. They do not verify PostgreSQL syntax, SQLSTATE execution, ACL installation, RLS behavior, rollback or concurrency. Independent source review identified the nullable closure CHECK and two direct-write identity/type bypasses; the candidate now rejects those cases before writes.

Final source-only freeze after the bounded reopen guard correction: SQL SHA256 `80b66bbd907a0be11864dab76bd2497612a96ec5ba222620e3a63d6cfc785094`; source test SHA256 `6815ff4f7c4a8e156094266b781ea5654307e17b95da30ae4d8d5292f90663da`. The correction is covered by a source-contract assertion, not an executed PostgreSQL regression.

## Authoritative lifecycle and business boundaries

- All **current, unarchived** tracks in `registered`, `not_registered`, `inquiry_only` close the entire case. One completed tab does not close another open subject. Zero current tracks are not vacuously complete.
- Whole-case cancellation is a real parent `ops_tasks.status='canceled'` change and contact closure in the same trusted command. Legacy canceled rows are logically closed in reads and sending gates even before physical cleanup.
- Last-current-subject exclusion closes at the guarded subject transition. Archived track rows, class/lesson-hour/settlement/enrollment records and stable internal UUIDs are retained; no history rows are deleted.
- Reopening a closed case increments its positive PostgreSQL-bigint generation, clears old typed contact and accepts only fresh input. Reopening one terminal subject while another remains open preserves the generation. The explicit reopen guard requires a fresh-generation transition only when before_phase is closed; it does not reject an already-open whole case. In this partial subject reopening, the current parent contact is preserved and contact revision advances once; typed student contact remains disabled. Old pipeline-only reopening is business history, not authority to restore contact. On a canceled parent, an explicit change through the existing manual selector to a nonterminal status on a current unarchived track atomically resets the parent to requested and opens a fresh generation. Terminal targets, archived tracks and legacy exact retries never reset the canceled parent; no new UI card/action is required.
- A closed `save_inquiry` can add/restore a nonterminal subject and explicitly collect a fresh parent number atomically: original expected-subject/common checks precede writes, then `subject sync → lifecycle transition/old contact clear → common facts`. Restoring only terminal subjects stays closed; the raw incoming parent number is never transiently inserted in that case.
- Student phone collection is disabled. Parent phone is the temporary contact slot. A metadata-only `update_common` with an **omitted** parentPhone preserves the existing open-case value; explicit null clears it, and a closed case can never preserve or restore it through this path.
- There is no blanket 30-day retention rule. A missing student UUID never extends contact retention.

The snapshot returns closedAt null for an **inferred**, unmaterialized legacy terminal or canceled case. This means the historical physical closure time is unknown, not that it happened at an invented date. Stored closed rows require a real non-null closure time/reason and null typed phones. Reads do not perform cleanup. An authorized new command materializes only its own case's forward transition; installation never bulk-clears historical rows.

## Concrete APIs and trust

`public.get_registration_case_contact_v1(p_task_id uuid,p_limit integer default 1)` returns:

```text
{version:1,taskId,revision:string,generation:string,phase:'open'|'closed',
 closureReason,closedAt:null|timestamp,commonRevision,allPhasesClosed,
 currentTrackIds:UUID[],studentId:UUID|null,parentPhone:string|null}
```

It retains the existing task read/access check. Only an active operations manager receives parent contact, only while the whole case is open and has current tracks. No student contact is returned. Existing direct table SELECT ACL/RLS are not rewritten by this draft; the new scoped read alone does not prove those old raw columns are inaccessible to other authorized database paths. That exposure requires its own exact reader/permission review before making a system-wide access claim.

`public.mutate_registration_contact_v1(p_actor_id uuid,p_command text,p_task_id uuid,p_request_key text,p_expected_generation bigint,p_expected_revision bigint,p_payload jsonb,p_request_hmac text)` is proposed **service_role-only**. The browser calls the authenticated server controller, never supplies a trusted digest. The server binds verified actor + task + command + opaque UUID request key + expected generation/revision + every payload field using the existing recipient pepper with domain separation. No key or secret is generated, provisioned, logged or read by this draft.

Create uses null task/generation/revision, internally generation/revision 1. Existing cases require positive bigint generation/revision. Both counters reject overflow with `23514`, never synthetic `40001`. Request payloads are strictly whitelisted:

| Command | Payload |
| --- | --- |
| create | studentName, schoolGrade, schoolName, parentPhone(optional), campus, inquiryAt(nullable), subjects, requestNote, priority |
| update_common | common fields above excluding subjects, expectedCommonRevision; omitted parentPhone preserves open contact |
| save_inquiry | common fields, expectedCommonRevision, expectedSubjects, subjects |
| set_workflow_status | trackId, workflowStatus, expectedWorkflowRevision |
| waiting_details | trackId, waitingKind, classId, retakeDecision |
| reopen | trackId, destination(inquiry/consultation_waiting), reason; reason participates in HMAC, never new event/receipt free body |
| close | reason(all_current_tracks_terminal/whole_case_cancelled/last_current_track_excluded) |
| archive / unarchive | expectedSubjects, subjects, exact subset/superset transition |
| bind_student | studentId, a real internal UUID only |

Waiting facts retain PR96 optional nulls and values `current_class/current_term_opening/next_term_opening`, `required/not_required`. Reopen maps to the final manual workflow setter's `inquiry/consultation_requested`, preserves business tracks and does not revive old pipeline conflict SQLSTATEs.

Mutation response/receipt:

```text
{version:1,taskId,requestKey,command,replayed:boolean,
 result:{explicit IDs/revisions/statuses/flags/subjects/track metadata,
         enrollmentFinalization?:explicit UUID/boolean projection,
         sourceEventIds?:UUID[],contactState:{...,parentPhone:null}}}
```

New tracks are explicitly enriched from typed current rows, retaining director/waiting/migration metadata and adding workflow revision/status/archivedAt. No arbitrary raw producer object is spread. The original new receipt metadata is returned before current-state stale checks on exact replay. Old raw receipts retain their original exact JSON/lexical-subject/workflow-shaped comparisons. They are not rewritten; legacy response projection may use current contact/track metadata, so byte-identical legacy whole-response replay is not promised. Existing original APIs remain necessary to retry an old raw request containing retired fields; the new API cannot reconstruct its original omitted student phone.

## Exact ordered producer evidence

Pins are UTF-8 `prosrc` MD5 derived from the ordered source, **not a verified live catalog**. Every preimage/attribute check runs before candidate DDL; each replacement anchor must appear once. Existing function OID, owner, ACL, language, SECURITY DEFINER, volatility, strictness, leakproofness and search_path are compared after source replacement. A mismatch aborts with `55000`.

| Final producer | Source | prosrc MD5 | Anchors |
| --- | --- | --- | ---: |
| create_registration_case_impl | 20260901110700_registration_flat_case_creation.sql:9 | d5ce049f39adef16428b1dc0964ff414 | 7 |
| update_registration_case_common_impl | 20260901110500_registration_flat_common_input_decoupling.sql:9 | ba45098e855e187262e31102a87c0d46 | 7 |
| save_registration_case_inquiry_v1_impl | 20260901110600_registration_subject_soft_archive.sql:855 | 5f96e3817673f97d8d803855ef7141d6 | 7 |
| set_registration_workflow_status_v1_impl | 20261004140440_registration_free_recording.sql:81 | de5e23e2f3662119c832b93ceb17e9e5 | 6 |
| save_registration_waiting_details_v2_impl | 20261004140440_registration_free_recording.sql:264 | fcb2a22ab233bf23456e1154a19a58bb | 5 |
| sync_registration_case_subjects_impl | 20260901110600_registration_subject_soft_archive.sql:500 | 75d1bb204e1597a5a0e0d12cfc2765bd | 6 |
| update_registration_case_common_with_reminders_v1_impl | 20260901110500_registration_flat_common_input_decoupling.sql:221 | 0b52417da5059cd844ccad8d2f19de71 | 1 |

Final manual `workflow_status` transition is the PR96 status setter; final `archived_at` transition is subject sync, also reached through inquiry and the existing subject snapshot wrapper. Final observation attendance/decision and consultation-result writers record facts without changing these canonical properties. Legacy waiting/reopen uses the separate `pipeline_status` transition; it is preserved for business records and is not mixed into contact closure. Historical one-time migration UPDATE statements are not active runtime writers.

## Write construction, ACL and locks

New common/create event JSON uses an explicitly versioned `contact_metadata_only` representation: presence/change flags and operation metadata, not raw phone or request-note bodies. New receipt INSERT values use a scope-tagged keyed full-command HMAC. Raw candidate fingerprint variables exist only for legacy exact comparison. **No write-then-scrub strategy, raw JSON INSERT followed by DELETE, or historical receipt rewrite is used.**

Protected transaction claims are owner-only, RLS-enabled and identified by actual transaction ID/backend PID/verified actor/task. They contain only authorization metadata and HMAC; no payload/raw contact/secret. They are removed at command completion. New outer receipts contain only HMAC + projected metadata. Task FK uses ON DELETE CASCADE to preserve the existing task-delete contract; task deletion is not a privacy cleanup tool and would delete business history.

Lock order is workflow advisory → actor/request advisory → registration parent → all ordered tracks → detail → internal-student-UUID advisory → student row → downstream resources. Existing patched writers prepare this order before original row locks. BEFORE-row guards acquire no late parent lock and require the protected claim for typed contact/lifecycle changes and manual workflow/archive/new track changes. Detail/task identity changes and registration type-switch cancellation bypass are rejected. Parent canceled transitions require trusted close or a requested-state reopening via the explicit reopen command/current-track nonterminal manual selector. Facts-only legacy business writes remain available.

The binder verifies an existing UUID under the shared `registration-student-id:<UUID>` advisory lock and student row lock. New API binding is immutable; it never creates a student, searches by phone/name/display uid/opaque MakeEdu link, or changes class/lesson-hour/settlement arrays. Broader legacy/direct `ops_tasks.student_id` mutation permissions remain a separate identity review; this API alone is not a global immutable-binding claim.

Closed transitions require `dashboard_private.retire_registration_contact_dispatch_v1(uuid,bigint)` from the separately owned message-fence candidate. Missing dependency aborts with `55000`; no no-op fallback. Retirement preserves accepted/unknown/started outcomes and uses existing canceled enums only. This integration must be reviewed as one coupled cutover; applying the lifecycle draft alone would gate old fresh writes before replacement RPC ACLs/consumers are enabled.

All new private functions/tables revoke PUBLIC/anon/authenticated/service_role access; postgres owns them. New public read/mutate RPC EXECUTE grants are **commented out/withheld**, not installed by this draft. Proposed grants are authenticated read and service_role mutation only. Existing writer ACLs are preserved. This is intentionally not a deployable partial installation.

## Required runtime and cutover gates (all pending)

1. Reconcile exact target baseline, PR96, all related audit/link, reader, UUID and provider candidates; generate an immutable CLI migration ledger after separately authorized DB verification. Recheck complete actual final definitions/attributes/ACL and helper parity; source pins do not establish provider configuration.
2. Fresh isolated install/compile and six drift failures, proving full rollback of DDL, triggers, ACL and function bodies; repeat installer rejected with exact `55000`. Verify inherited ACL/default privileges/RLS and service-role-only route, active manager/teacher/deleted/banned/forged actor denial with exact SQLSTATE assertions.
3. Exact new replay after close/reopen, changed actor/task/key/full command/HMAC conflicts, stale generation/revision no business changes, valid old raw/lexical/workflow receipt retries with unchanged historical rows; no raw aliases in new event/receipt/returned metadata.
4. Whole-case multi-subject terminal/one-tab-not-terminal/archived terminal/current-empty cases; explicit last-current exclusion; whole cancellation and direct table/type/identity bypasses; a canceled parent with still-nonterminal tracks must reopen through the reachable existing manual selector, restore requested and advance a fresh generation even when the selected status already equals the track status; terminal/archived/legacy-replay paths must remain closed. Also test an active terminal subject reopening while another current subject remains open: same generation, parent contact preserved, workflow/contact revision advanced, business arrays unchanged. Test explicit parent reopen, metadata-only missing/explicit-null contact semantics, blank inquiry date and PR96 waiting optional values.
5. Atomic inquiry rollback around sync/refresh/common, terminal restoration rejects raw before INSERT, true fresh collection after closed generation, corrupt receipt/claim and counter-max failures with complete state rollback.
6. Real concurrent connections: status/subject/common/parent cancellation versus preview/claim/provider-start, duplicate request keys, fresh generation versus stale attempt, shared UUID binding versus finalizer/batch/withdrawal/transfer locks. Prove one start boundary; accepted/unknown is never retried, no provider calls in fixtures.
7. Verify existing case delete, facts-only observation/consultation/pipeline, UUID business arrays and required sourceEventIds/nested metadata compatibility against actual consumers. Restore authorization settings on success, exception and replay.
8. Coordinate consumer activation and new grants with provider-retirement/helper dependencies; preserve no-send behavior until actual runtime proof and separate installation approval. Verify source installed/live behavior after any later authorized release.

Historical student/detail/event/receipt/audit/browser/export/free-text copies and physical backups are not purged here. Their aggregate eligibility, dependencies and irreversible deletion require a separate action-time packet. Retaining or rotating the existing server HMAC pepper affects old retry matching; versioned dual-key rotation/migration is not implemented. No global timezone/hash/audit-chain or UID atomicity guarantee is added by these source checks.
