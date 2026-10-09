# PR96 registration cleanup integrated onto current main

> 2026-10-09 compatibility update: the local review candidate now combines operating main `6a6d7abe4f45e366beccc14efbbcce0534f0370f` (PR125) with PR96 `147039589322b09ef8d8d64ebdf313aacbd17cf1`. Evidence is in `../release/registration-pr125-20261009/` beside this checkout. The remainder of this document records the prior PR123 validation and must not be read as freshly rerun PR125 evidence. The owner explicitly permits local checks plus independent review without extra GitHub payment; the older remote-check/payment decision below is superseded for this task. Production SQL, push, merge and deployment are currently held.
>
> PR125's safe case-created actor/time parsing and structured-legacy suppression are preserved alongside PR96's other audit producers. The local integration resolves two source conflicts and one UI-test conflict without changing the two SQL files. The old installation package has been refreshed separately with the one newly recorded Chat SQL as reference-only history; only the original registration pair may execute. Current contact policy is notification use during level-test/trial/registration, with dashboard contact removal when registration concludes. No default 30-day retention or contact-removal implementation is added here.

Base: `3ad5a6f032dba817cca35afb8b5142b7331d3f23` (PR123). Source of retained registration work: `37a4298f77af2fe91ea20ba335a74249383cd990`. This is a reviewed integration candidate for the existing draft PR96, not production installation or release approval. The original dirty checkout remains untouched. The verified integration tree is connected to the unchanged old PR96 head by a local ancestry-only merge so a normal fast-forward push can preserve both histories; no force push is needed.

## Result and scope

Management staff/directors can choose all 13 manual registration states, including **청강 신청**, independently of trial attendance, teacher feedback, director decisions, enrollment, or waiting-detail completeness. Booking remains a separate explicit action. The registration view presents existing attendance/feedback/decisions as history and offers a new booking after a historical attended/completed/no-show attempt. One live scheduled booking per track, manager authorization, row locks, revision checks, receipts, and explicit notification boundaries remain enforced.

Remove trial-only campus/textbook/progress presentation and obsolete teacher-confirm/director-decision actions from this registration flow. Keep stored history, general class campus/textbooks, enrollment textbook selection, historical APIs, and existing roles/ACLs. Automatic history uses the actual audit actor/time without copying private contact payload into display metadata. No unapproved contact-form deletion patch is included.

The three product overlap files are `registration-observation-editor.tsx`, `registration-track-editor.tsx`, and `registration-track-service.ts` under `src/features/tasks/`. PR111 grade/class selection and class-catalog wiring remain; PR122 parallel enrollment/conditional summary reads remain. All 383 existing main migration files and all 161 existing manifest entries are unchanged. Approval/planner/workspace, management, AI reply/API, withdrawal/reset, enrollment editor, shared class select, workflow YAML, package files, and the isolated DB runner are unchanged.

The retained diff owns 15 registration product/fixture files, one preflight builder, two new migration files, the manifest, two SQL tests, one JSON fixture, and 15 Node/helper test files (37 paths), plus this document. The exact list and byte hashes are in `scope-preservation.json` in the evidence directory below. These shared integration paths need coordination with other workers: the three product overlap files, the manifest, the preflight builder, and registration/workspace tests. No old review reports or screenshots were imported into the application tree.

The only additional integration logic beyond retained PR96 is a strict older-pending exception in `scripts/build-supabase-transactional-preflight.mjs` for the exact filenames and independently pinned hashes of the two registration SQL files. Tests reject changed bytes, renamed files, and any unrelated older pending migration. It allows a rollback rehearsal after newer main SQL was installed; it does not authorize production migration execution or ledger repair.

## Current validation

Evidence directory beside this checkout: `../release/registration-current-main-20261008/`. These results were generated on this current integration, not inferred from old PR96 CI.

| Check | Result / evidence |
| --- | --- |
| Registration Node + ops workspace | 1,623 pass, 0 fail/skip; `registration-node-tests.txt` |
| Migration layout / SQLSTATE / preflight Node | 82 pass, 0 fail, 1 existing Linux-only skip; `schema-node-tests.txt` |
| PG17 body behind that platform gate | Supplemental unchanged test body passed on owned offline PG17 from macOS; `preflight-pg17-runtime.txt` and copy provenance. Does not replace required Linux CI. |
| Shared design contracts | 63 pass, 0 fail/skip; `design-contracts.txt` |
| SQL contracts after current-main baseline | 96 files, 5,683 assertions pass; `native-schema-contracts.json` |
| Transaction rollback rehearsals | 25 + 48 assertions; schema/catalog and ledger unchanged after rollback |
| Exact native CLI 2.115.0 migration pair | Two pending versions only; default refusal of older versions verified, isolated include-all succeeds, original ledger/history unchanged, replay no-op; `full-db-push-proof.json` |
| Phased booking/status behavior | Both indexes + old core, new index + old core, final core, and booking spanning online DDL; `application-phase-proof.json` |
| Failure recovery | Ten interruption/ack-loss/ledger/concurrent-executor cases pass; `failure-recovery-proof.json` |
| UI | Matching main/integrated fixtures at 1440px and 390px; status/fields comparison, three history rebooking cases, same-dialog failure/retry, teacher/assistant denial, manual states without booking; `ui/comparison-results.json`, `ui/review-rebooking-browser.json` |
| TypeScript / build / full ESLint | Pass / pass / 0 errors, 7 pre-existing warnings in unchanged files; `typecheck.txt`, `build.txt`, `lint.txt` |
| Squawk 2.63.0 | 0 issues in both SQL files; `squawk.txt` |
| Preservation | All existing main SQL, manifest entries and protected sources unchanged; `scope-preservation.json` |

Synthetic SQL checks include duplicate booking `55000`, stale revision `23514`, teacher booking `P0002`, teacher status `42501`, same-key receipt replay, all 169 manual state pairs, and unchanged full historical observation/appointment JSON. Other public/private function definitions and the target ACLs stay unchanged. Existing subject-completion notification source/audit behavior is retained; no provider sends occur.

Browser evidence uses actual RegistrationApplication/shared controls and a synthetic in-memory adapter. SQL booking is exercised separately against the owned DB. External browser requests are blocked; observed page errors/external requests are zero and document width matches viewport. The temporary fixture route was removed before build. Authenticated real-route/production runtime acceptance remains unverified.

## Remaining SQL installation scope and release gates

Minimal production metadata read at **2026-10-08 15:35:14.551218 UTC** queried only the two target versions, four target function definitions/ACLs and two possible index names. Neither registration version is installed. Only the old broad four-state index exists, valid/ready/live. All four function definition/source MD5s, owners, ACLs, security-definer flags and empty search paths match the tested current-main baseline. `production-install-metadata-current.json` and its exact SELECT are preserved outside the repository. This successful read used the already connected Supabase tool; no new TLS session configuration, secrets or grants were requested. Historical total ledger counts are not installation preconditions. This snapshot must still be refreshed at an approved execution window.

The still-needed SQL scope is exactly:

1. `20261004140438_registration_scheduled_index_online.sql` — SHA256 `bc154a3fb519c85ca7f8f21cf8f96e5bc56480f55a254b58a1306bd3e6662916`. Native nontransactional concurrent index replacement, bounded locks/statements and catalog guards.
2. `20261004140440_registration_free_recording.sql` — SHA256 `68e828b52957d6978fdce64e649302287cc2b5ff8830e402c24db0d7fabc20a7`. Finalize the index name, decouple the two pair constraints, replace the status/waiting functions in full, rewrite the booking/manager-reader definitions using exact anchors, and replace the security-invoker summary view. Phase/catalog guards are in the SQL; preimage definition/ACL parity was verified separately and must be rechecked before installation. No historical row backfill/delete and no new grants/RLS policy.

Both SQL files are byte-identical to old PR96. There is no production execution in this work. The exact execution/recovery plan below separates verified local behavior from the remaining production prerequisites.

## Owned paths and scope classification

| Category | Files | Scope |
| --- | ---: | --- |
| Registration runtime/model/presentation, including declarations | 14 | Manual status, current-booking/history distinction, audit actor/time, obsolete trial-only controls/fields |
| Synthetic registration fixture in `src` | 1 | Exercises the same interface without students or providers |
| Schema migrations | 2 | The exact online-index/core pair above; no global class/textbook deletion or new grants |
| Verification infrastructure | 2 | Preflight builder and migration manifest; independently pinned exceptions only |
| Tests and test fixtures | 18 | 15 Node/helper files, two SQL suites, one reader JSON fixture |
| Review/installation documentation | 1 | This document |
| **Total** | **38** | No extra feature, dependency, workflow or deployment changes |

The source/test/SQL bytes remain those verified at `b1270f34bb49968f65cde0061d4740195dfa81e9`. `769270385c9cb68841c353c811e2a177009ae077` clarified one sentence; the later ancestry-only merge has the identical Git tree. Subsequent work updates only this document. Independent code review found no blocking source issues; final packaging ancestry and this plan receive a focused follow-up review. Contact deletion remains excluded; future contact-branch integration must reconcile `registration-track-editor.tsx` and `tests/registration-track-workspace.test.mjs` explicitly.

## Installation protocol for later authorization

1. Freeze final PR head, current main and deployed app source at the execution window. Re-read the **two target migration rows, four function preimages/ACLs, relevant constraints/view and exact indexes**. Abort on unexplained drift, changed SQL hashes, invalid/new unexpected objects or another executor. No total-ledger count equality is required. Existing phase guards remain mandatory; full status/waiting replacements require the separately verified function preimages.
2. Use only an **already authorized, verified production CLI transport** with pinned CLI 2.115.0 and the same inspected staging package throughout the run. This session proved MCP read access, not production CLI connectivity; no connection/bootstrap, secret entry, CA/TLS, grant or network setup was attempted. If an existing suitable execution path is unavailable, the installation stays pending. Do not substitute a connector `apply_migration` call that may wrap concurrent DDL or change connections.
3. Prepare a reviewed staging package compatible with the actual recorded migration identities. Before execution, `migration list` must show no unexplained remote-only history and **exactly** `20261004140438` and `20261004140440` pending, with the pinned bytes above; all other entries must already be applied. The scoped execution form is pinned CLI `migration up --db-url <existing approved connection> --workdir <reviewed staging> --include-all`. It is not a command to run from an arbitrary full repository or from a two-file-only folder. No production `migration repair`, remapping, placeholder history or unrelated migration application is authorized.
4. The two-file-only folder variant was tested on a disposable current-main PG17 DB with unrelated recorded history. The CLI refuses it **before DDL** because remote versions are absent locally (`registration-only-install-protocol.json`). The refusal is an expected fail-closed result, not an installation success. Existing local proof covers a ledger-compatible package with exactly the pair pending (`full-db-push-proof.json`); it does **not** prove that the current production package is compatible. Resolving that package against recorded identities is the explicit remaining execution prerequisite, without altering production history.
5. During a coordinated registration-edit pause, let in-flight actions settle and retain the existing app. Execute the two files in order through one native CLI invocation. Keep the session advisory lock `(20261004,140440)` across online statements and core/ledger work. A competing executor fails `55P03`. Do not change timeout values: lock timeout is 5 seconds and statement timeout 120 seconds **per statement**, not a guaranteed total run duration.
6. Verify the two ledger records, exact final scheduled-only canonical index (valid/ready/live), final function/view definitions and unchanged ACLs before deploying the tested app. Release the registration-edit pause only after the new app is active, stale tabs are reloaded and authenticated role/desktop/mobile acceptance is complete. No real student mutations or provider sends are test evidence in this task.

`438` is explicitly nontransactional. `CREATE INDEX CONCURRENTLY` can commit catalog/build phases independently, followed by validation and `DROP INDEX CONCURRENTLY`; a timeout/disconnect does not roll those steps back. The new scheduled-only unique fence must be valid before the old broad fence is removed. Native CLI `440` uses its default transaction for rename, constraints, functions, view and its migration-ledger insert; no authored BEGIN/COMMIT is added. Failure of that transaction rolls back the whole core while preserving the online phase. Connection close releases the session advisory lock; a retry is a new inspected execution, not an assumption that nothing happened.

## Recovery decision table

| Observed state after interruption | Next permitted plan after inspection/authorization |
| --- | --- |
| Old broad index valid, new index absent, old core, neither target ledger row | Start the original ordered pair. |
| Old index valid, new index invalid | Stop. Do not let `IF NOT EXISTS` accept the invalid index or drop it automatically. Inspect the failed build; any invalid-object cleanup requires its own concrete approved action, then recheck the old fence and retry. |
| Both exact indexes valid, old core | Re-enter the original online file after exclusive-executor/preimage checks; valid new index is reused, old broad index is removed. |
| New index valid, old broad index invalid/absent, old core | Re-enter online phase only when its guards/ledger state permit; the new fence remains. Interrupted old DROP completion was tested. Never proceed if no valid scheduled fence exists. |
| Online ledger present, new index valid, core/440 ledger absent | Retry the original core transaction after preimage checks. Core/body/ledger failures preserve the prior core; do not redo arbitrary earlier migrations. |
| Final canonical scheduled-only index and final core, both ledger rows present | Treat lost acknowledgement as committed success only after definition/ACL/readback checks; verified CLI replay is a no-op. |
| Final core but a target ledger row absent, unexpected definitions/dependencies, or no valid fence | Stop for reconciliation. No blind replay, automatic ledger repair or broad-index restoration. |

The ten synthetic failure/recovery cases cover committed-but-unacknowledged create/drop/core, canceled create/drop, core-body/ledger failures, online-ledger failure and competing execution. They do not authorize a production repair. Once legal repeated historical trials or partial waiting details exist, simply restoring the broad index/old pair constraints may fail or invalidate accepted behavior; use a reviewed forward correction. A source revert alone never rolls back installed SQL.

## Old/new app compatibility and morning decision

Old app + old core remains functional during online index replacement: the old booking predicate still rejects historical unresolved trials until core commits, while track locks and the scheduled unique fence protect live bookings. New app + final core is the validated target. New app + old core is **not** a supported release state (free manual states/rebooking can fail), so SQL must precede the app. Old app + final core retains RPC shapes and data, but stale teacher-confirm/director-decision controls are still present in old clients; end-to-end mixed-client behavior is not established. The registration-edit pause and mandatory stale-tab reload are therefore real rollout conditions, not a claim of unrestricted mixed-version safety. Unrelated menus and permissions are unchanged.

Repository `AGENTS.md` requires successful `free-tier-guardrails`, `supabase-sql-review`, `supabase-schema-contract`, applicable suites and independent exact-source review before merging, even when GitHub does not enforce them. Branch-protection/effective-rules read APIs returned HTTP403 with a plan/visibility message; this is **not evidence of an enforced GitHub branch gate**, and no settings/cost changes were attempted. Billing-related failure to start a workflow, if reported by the current run, is execution evidence missing, not a failing product assertion. Current local results cover the affected Node/UI/SQL/native migration/recovery paths described above; they do not execute the complete Node22/Linux workflow, all unrelated HTTP/AI probes or authenticated production routes. Do not label old-head CI, platform skips, targeted local coverage or a billing-blocked run as a complete current workflow pass.

For the parent to present together in the morning (no overnight user contact):

- Review the final draft PR96 head, 38-file scope, independent review and actual named-check results. If checks did not execute, decide how to obtain the missing verification under the repository rule; do not silently infer a waiver or change billing/settings.
- Separately authorize only the two pinned SQL files **after** the compatible staging package and existing execution transport are confirmed, with the pause, metadata checks and recovery boundaries above. No unrelated migration/history repair, student mutation, new secret/grant/network setup or provider send is included.
- After schema success and the required source verification, authorize coordinated PR merge/app release and authenticated desktop/mobile management/director/unauthorized-teacher acceptance. This is separate from the already authorized code push; PR91 rollout stays paused.

No production write/index change, real student test data, provider send, new credential/grant/cost change, PR merge or manual deployment was performed. Code push to the existing draft PR is separately authorized; its exact resulting head and remote check outcomes are recorded in the final handoff/PR description.
