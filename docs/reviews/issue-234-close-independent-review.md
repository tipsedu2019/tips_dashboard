# Independent #234 close occupancy source review

Reviewer: separate read-only Critic `/root/close234_critic`.
Base: `7e0ae88b3b1367c931433f10337c9e5134344802`.
Reviewed branch: `fix/234-class-close-occupancy`, uncommitted source bound by hashes below.

Result: no remaining actionable product correctness/security findings in the reviewed source. This is not an approval, SQL runtime result, remote review, preview smoke result, or deployment claim.

The final full/windowed readers were compared with their active 20261020134458 definitions: only the return projection wrapper differs. The migration installs both wrappers and private helper in one transaction, preserves existing owner/ACL of replaced readers, and explicitly revokes API execution of the new helper. It changes no actor checks, locks, request hashes, receipts, writer, assertion, finalizer, source rows, or lifecycle write authority.

The helper removes only known closed-class/date pairs on/after the stored Asia/Seoul close day. Date-unknown blockers and active peers remain. Filtering preserves source order/multiplicity; both derived fingerprints remain bound to the original raw-source fingerprint. Actual dates older than today but on/after a stored older close stamp are now explicitly covered. Date-less legacy closures use the current Korean business day without backfilling history; the rolling-cutoff limitation must stay documented.

Mixed close plus future target source change is nonoccupying under the selected owner policy. This is not a blanket validator bypass. Existing current/past and other-class guards remain. Do not claim that every mixed input catalog/format check runs: the existing gateway only performs those checks in its non-close input branch; typed/CAS/trigger and remaining-occupancy validation are the retained contracts.

Two initial regression-quality observations were resolved in the reviewed final tests:
1. Reactivation now has a separate closed class with exactly one future active session, so a 23P01 result is not confounded by restoring active/exception/makeup duplicates within the same class/date.
2. A class closed seven days earlier verifies that only the day preceding that close survives, distinguishing stored cutoff from the legacy today fallback.

No product/test edits or test/DB execution were performed by this reviewer. SQL runtime remains unexecuted because the known image Forbidden restriction was not retried or bypassed. Static inspection cannot validate PostgreSQL syntax/runtime, all pgTAP fixtures, transaction timing, or performance. Full CI, independent remote review quota, authenticated preview smoke and release gates remain separate.

| Source | SHA-256 |
| --- | --- |
| `supabase/migrations/20261031120000_class_close_occupancy_release.sql` | `1872ae421e86e383e1c06ee9cc9df7a86c4c462ea6f9f2433cc254735f55fe63` |
| `supabase/test-baselines/dashboard-free-tier-v1.manifest.json` | `f5af67967c8c785e3900d30c6f317deb12beb4cbca9a673d7db9ed3ea599454a` |
| `src/features/academic/timetable-plan-contract.ts` | `6f2916734077b13109a80381e9fca46ff5df42523d7fafb125a5b5a657276cb0` |
| `supabase/tests/timetable_close_gateway_validation_reuse_test.sql` | `5d307c7cf20d6ecfbdb49c556cb2fc8e2c1475bce860ee8e57fc4e4d12d47ade` |
| `supabase/tests/timetable_default_projection_performance_test.sql` | `a6f64bda65de4255b34f0c1198ffd8b30991f10751d7c0a605847bdaf9b04aaa` |
| `supabase/tests/timetable_shared_validation_workset_test.sql` | `297bfafd609a97f1c40bdd0183f1b65d84fd18f5ca0bbcba5a5bccf8c8aa0c8f` |
| `tests/timetable-class-close-occupancy.test.mjs` | `3ae4949d4f35da2d3770399b503e70baf44820c54f386be03b0a93db0b7cb9df` |


---

# #234 independent test/contract read review

Reviewer: `/root/close234_test_review` (read only; not the Builder).
Base: `7e0ae88b3b1367c931433f10337c9e5134344802`.
Reviewed worktree: `/workspace/scratch/issue234-close-worktree`.

Final result: no remaining concrete test-source finding in the reviewed scope. This is source inspection, not pgTAP execution or a SQL/runtime PASS.

## Resolved during review

- Added a genuinely older stamped closure (`class453`, KST close day = today−7) with sessions on close−1, close, yesterday and today. Only close−1 remains, distinguishing stored close date from the legacy today fallback (`timetable_close_gateway_validation_reuse_test.sql:875`).
- Reactivation now uses separate single-session class464, avoiding a 23P01 caused merely by the five-state fixture's self-overlap. Its peer collision is observable through the unmodified validator (`:999`).
- Corrected the reactivation source-preservation assertion: snapshot and comparison now both target session10021/class464, instead of comparing unrelated class461 (`:946`, `:1008`).

## Inspected evidence

- Both complete and bounded producer definitions equal the final 20261020134458 definitions except for the common return projection wrapper.
- New full-reader `prosrc` SHA256 `d577eaaa428d6793d0e01963c7f03cfeb2af64798464e7aca46b31b1db9a9909` matches the updated exact-body pin.
- Normalized fixture states/IDs/session keys/time pairs fit the existing table constraints. All fixtures stay transaction-local and source records are compared after reader calls.
- Mixed future close is a positive policy control. A new pre-close collision requires exact `23P01` and preserves source/status/receipts on rollback. Existing same-transaction peer conflict and cancellation/replay assertions remain.
- Global/windowed retained session/blocker parity is compared; retained normalized history is nonempty, preventing an empty-output parity assertion from masking loss of history.
- Ordinary reopen retains exact `42501 / class_close_requires_rpc`. Owner-only reactivation is expressly a synthetic projection/conflict probe, not a newly authorized public reopen workflow.
- Private helper ACL, KST boundary, missing close stamp, unknown date blockers and raw-source preservation are covered in source. The Node fixture accurately identifies itself as expected wire data, not executed SQL output.
- All three pgTAP files are already in the SQL review workflow. The new Node test is included by the existing `tests/timetable-*` glob.

## Final source hashes

- `tests/timetable-class-close-occupancy.test.mjs`: `3ae4949d4f35da2d3770399b503e70baf44820c54f386be03b0a93db0b7cb9df`
- `supabase/tests/timetable_close_gateway_validation_reuse_test.sql`: `5d307c7cf20d6ecfbdb49c556cb2fc8e2c1475bce860ee8e57fc4e4d12d47ade`
- `supabase/tests/timetable_shared_validation_workset_test.sql`: `297bfafd609a97f1c40bdd0183f1b65d84fd18f5ca0bbcba5a5bccf8c8aa0c8f`
- `supabase/tests/timetable_default_projection_performance_test.sql`: `a6f64bda65de4255b34f0c1198ffd8b30991f10751d7c0a605847bdaf9b04aaa`
- `supabase/migrations/20261031120000_class_close_occupancy_release.sql`: `1872ae421e86e383e1c06ee9cc9df7a86c4c462ea6f9f2433cc254735f55fe63`

No tests, database commands, production queries, downloads, remote reviews or external writes were run by this reviewer. SQL image Forbidden remains an unexecuted runtime gate; no alternate runtime was used. Runtime behavior, query cost, PostgreSQL locking and the operational incident remain unverified.
