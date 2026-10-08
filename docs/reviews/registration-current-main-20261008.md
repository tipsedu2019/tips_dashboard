# PR96 registration cleanup integrated onto current main

Base: `3ad5a6f032dba817cca35afb8b5142b7331d3f23` (PR123). Source of retained registration work: `37a4298f77af2fe91ea20ba335a74249383cd990`. This is a local integration candidate, not a production installation or release approval. The original dirty checkout and PR96 remote branch remain untouched.

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

Read-only production metadata observed at **2026-10-08 14:58:14.652014 UTC**: PostgreSQL 17.6, ledger 383 rows, maximum `20261008124621`, sorted-version MD5 `fd849ca7e4051f4553227014d45b68b4`. Neither registration version is installed. The old broad four-state unique index and old pair constraints remain. The four affected function definitions/owners/ACLs match the current-main synthetic baseline exactly (`current-main-function-parity.json`). This replaces the old 362-row/PR97-not-installed assumption; it is a point-in-time metadata read, not a fresh release pin.

The still-needed SQL scope is exactly:

1. `20261004140438_registration_scheduled_index_online.sql` — SHA256 `bc154a3fb519c85ca7f8f21cf8f96e5bc56480f55a254b58a1306bd3e6662916`. Native nontransactional concurrent index replacement, bounded locks/statements and catalog guards.
2. `20261004140440_registration_free_recording.sql` — SHA256 `68e828b52957d6978fdce64e649302287cc2b5ff8830e402c24db0d7fabc20a7`. Finalize the index name, decouple the two pair constraints, replace the status/waiting functions in full, rewrite the booking/manager-reader definitions using exact anchors, and replace the security-invoker summary view. Phase/catalog guards are in the SQL; preimage definition/ACL parity was verified separately and must be rechecked before installation. No historical row backfill/delete and no new grants/RLS policy.

Both SQL files are byte-identical to old PR96. Actual installed recent migration numbers differ from canonical main filenames despite matching relevant definitions. Therefore generic production pending `db push --include-all`, ledger repair/remapping, or a claim that the synthetic canonical ledger proves production CLI compatibility would be incorrect. Before a separately authorized installation, freeze a fresh production/source pin, reconcile an exact registration-only execution/ledger protocol, inspect index/function state and rehearse that protocol. Concurrent index steps cannot be represented as one rollback transaction; recovery must inspect valid/ready/live indexes, core definition and ledger before acting. Do not blindly replay or claim a source revert rolls back installed SQL.

Independent review of the final source, exact-head required remote CI (`free-tier-guardrails`, `supabase-sql-review`, `supabase-schema-contract`), coordinated source/SQL release and authenticated route acceptance remain separate gates. Old green PR96 checks do not satisfy this new head. No new head was pushed, so no current remote CI success is claimed; existing billing/environment blockers must be resolved without weakening checks. PR91 rollout remains paused.

No production writes/index changes, real student test data, provider sends, new credentials/grants/cost changes, merge, push, or deployment were performed.
