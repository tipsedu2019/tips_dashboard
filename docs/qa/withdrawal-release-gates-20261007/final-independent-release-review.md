# Final independent review — conditional code GO, release gates open

Reviewed local clean candidate `8b0ca153835bcf988d74f84428df18a3dc473bd5`. No new code defect after the narrowly revised scheduler manager. This is a conditional code review GO; **releaseReady=false** because actual automatic cron and actual browser-save E2E have not executed. Production SQL, real students, sends and deployment were not performed.

## Resolved native ACL defect

P1 was found in the original 240eff71 manager: postgres is a non-superuser, cron.job is owned by supabase_admin, and direct UPDATE fails. cron.alter_job EXECUTE is also unavailable to postgres. Final 90000 SHA is `b1060906d750280cacb3ff78d043ad5a5cd551c30638f8121920e40226f3733e`. It uses only existing allowed schedule/unschedule APIs. No table grant, extension grant, role membership or owner change was added.

Independently proved every byte outside the manager CREATE span equals the original migration. Exact drift/duplicate checks remain. Native probing shows named schedule retains active=false, so an exact inactive job is unscheduled then recreated; an active exact job remains a single job. Disable and remove both unschedule metadata, preserve pending snapshots, and do not cancel an in-flight worker. Job ID can change. Final operations and rollout docs state these semantics accurately. The original 240eff71 manager must not be installed under the captured Supabase ACL.

## Actual verification and its limits

- Native Supabase PG17.6.1.159 replay applied the captured baseline and 151 ordered migrations, then reloaded only the exact final b106 manager. This is **not** a fresh replay of all 151 files at the final 8b0ca153 contents. The manager-only byte-equality check bounds that delta.
- Exact final source pgTAP: completion 96/96 and boundary 123/123 pass. Native cron API behavior passes with unchanged extension ACL. Targeted Node tests 31/31, migration layout and SQLSTATE contract pass. Earlier unchanged app validation (types/lint and broader 397 tests), neutral SQL 52 assertions and actual display matrices retain their original source/provenance; they are not new save-E2E results.
- Fixture-only source setup changes match actual signup profile creation, valid class sessions through the existing audit context, and the school category CHECK. Original business assertions remain; boundary adds one unscheduled-metadata assertion. No business function, RLS or active trigger is stubbed or disabled.
- Real cron setup attempts did not reach a minute tick. Actual deferred timetable COMMIT exposed fixture session identity/resource deficiencies. The corrected fixed resource/session identity helper is prepared but unexecuted. Rollback pgTAP does not prove that deferred COMMIT path. Natural due release, real worker null-auth context, 30-second cancellation, automatic retry and duplicate job timing remain unverified.
- Actual browser-save framework is prepared and independently read: real route/service, fixed typed SQL catalog with extended bindings, authenticated role plus synthetic claims, exact source/gate hashes, assigned writable IDs, separate readonly IDs, real reads/receipts, committed-ACK-loss injection and separate DB audits. Its DB connections, SQL writes, browser cases and actual receipts are **zero**. Local provider/cache barriers and a network-none DB do not claim production delivery or PostgREST JWT signature validation.

## Recommended release split

Retain the existing four migrations and app as one candidate and separate activation of only the new named cron job. With the job absent, absent-roster/no-claim completion works at any cutoff, enrolled/past completion works, and enrolled/today-or-future completion is fail-closed. This preserves the approved through-cutoff policy. The first stage still installs queue/worker/helpers/RPC permissions; it is not a minimal DB schema change. A separate queue-free completion branch would require a new future-date restriction and a separately verified upgrade path, so it is not recommended as an unreviewed nightly shortcut. The standalone neutral wording patch remains independent and does not resolve completion blockers.

## Remaining blockers

The parent reported GitHub500 with remote draft PR still on old 240eff71/unmerged; this reviewer did not independently read GitHub. Final local hashes do not establish that the remote PR is updated. The old candidate remains unsuitable for installation.

Automatic approval review rejected `run-linux-node.py run-actual-cron.mjs` and the one bounded retry `load-linux-sql.py patch-qa-complete-resources-identity.sql`, citing the original wording-only scope and operating-SQL prohibition and declining authorization relayed only by an assistant. Both rejected actions created no process. No alternate browser/HTTP/tool path was used. The parent has requested direct end-user approval before resuming. Elapsed time is not approval. Until resolved, actual cron and actual save-E2E are incomplete.

Evidence: `approval-blocked-status.json`, `corrected-source-manifest.json`, final product TAP/results, `native-cron-schedule-probe.json`, and the separate `../withdrawal-e2e-20261007/browser-save/save-e2e-status.json`. Old failed attempts and pre-native-ACL static review remain preserved.

## Final readback and cleanup

Owned-only cleanup is complete: the PostgreSQL server stopped with PID 0; its container and socket volume were removed with absence checks; its log SHA-256 is preserved. The separate browser idle client was also stopped and removed. No SQL or cron was executed during cleanup. All new browser connections, queries, writes and receipts remain zero. Prepared code, failed attempts and proof files remain on disk; a resumed verification requires a fresh isolated fixture.

The parent's latest readonly GitHub readback still reports remote 240eff71, draft=true, merged=false and the requested hold notice absent from the PR body after two server-500 failures. This is parent-observed remote evidence, not a Github query by this reviewer. The local fixed code must not be confused with that old remote candidate.

The final rollout constraint is correct: changing the 90000 file is limited to this unpublished candidate. If an operating ledger already records the earlier 90000 SHA, do not rerun it or repair its hash; inspect the actual state and use a separately reviewed forward migration. No operating ledger was queried here. The original attached JPEG also remains pixel-unverified per the parent's bounded Library materialization failure report; synthetic browser screenshots are not that image.

Operating release decision remains NO. Direct approval to resume isolated cron/save verification was not received; no bypass or elapsed-time approval was used.
