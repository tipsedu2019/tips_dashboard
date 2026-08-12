# Task 1 Report: Restore the Nine Production Migration Receipts in Git

## Status

- Result: PASS
- Scope: local migration source, verifier, tests, and disposable local DB QA only
- Production writes: 0
- Git push / GitHub workflow / main update / PR: 0
- Vercel deployment: 0
- Runtime or provider activation: 0
- Provider requests: 0

## Clean Base

- Branch: `codex/google-chat-profile-mentions`
- Base HEAD: `b317c0145410651ccc3888a68db7452cfde99621`
- Initial `git status --short --branch`: clean (`## codex/google-chat-profile-mentions`)

## Read-only Production Receipt Evidence

Project `slnjqlzzhewblvttiidk` was queried once through the read-only SQL interface for `supabase_migrations.schema_migrations(version,name,statements)`. The result contained exactly nine requested rows. Every row had `statement_count=1`; all names, byte counts, and SHA-256 values matched the approved brief.

| Version | Name | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `20260807030434` | `registration_korean_template_renderer` | 3370 | `53e0d49c96c9ea38418e082370755a071ab75d3d44fe7b12c6240eb44fd6945e` |
| `20260807111442` | `registration_management_google_chat_dispatch` | 20271 | `e367278104df0fad8d74e17cafd7eb0fd24baa90e32efb1cdec18e0cb8ac6b5b` |
| `20260807125038` | `registration_customer_message_preview_target_rpc` | 1702 | `3cb54293dbef73b0eccbc92e14bda2e7f51d2c51e0a55d927daa8192ce720f37` |
| `20260808044202` | `registration_level_test_summary_consultation_chat` | 7041 | `06f57db749b84e41d4647ce44d231633a1ad2f54da9b2149cd93bd33349990bb` |
| `20260808050410` | `registration_director_retry_circuit_breaker` | 1051 | `068349ad45c5c230a45c789d70fab3ce7b1c19e69ea6f958c68f921941048004` |
| `20260808124315` | `registration_customer_message_subject_admission_details` | 32981 | `c75e570cb032c5d4d7ec266b2128d103618a0490e293255aab6f688d71574ef0` |
| `20260811142055` | `science_consultation_requests` | 2912 | `340b7d2c8d53ade12c7a2f9df98669218826d56a8b6e02f920e897788378d547` |
| `20260811142152` | `science_consultation_requests_deny_policy` | 159 | `e5abe58f49fe926eb3e35a4471cd9adb49c052f0d677453ffd0f48d80a88c491` |
| `20260811142353` | `science_consultation_rate_limits` | 1472 | `aa177ab5d3151d7f2fa55883f7efc8526999828ee5cbd210693f5ddafc09fc30` |

The SQL statements were inspected only as migration source. The six named registration statements matched the existing local migration purpose; four were already byte-identical, preview-target differed only by its final newline, and director retry differed only by the local explanatory comment plus final newline. The three science statements created only the named request, deny-policy, and rate-limit schema objects and their stored indexes, grants/RLS, and cleanup schedules.

## TDD Evidence

### RED

Tests-only changes were made first: nine aligned identity/hash entries, six obsolete filename entries, and the four path-owning test references.

Command:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test \
  tests/supabase-migration-layout.test.mjs \
  tests/notification-registration-handoffs.test.mjs \
  tests/registration-consultation-notification.test.mjs \
  tests/registration-customer-solapi-db.test.mjs
```

Result: exit 1 with 6 failures. The failures were caused by the new aligned paths being absent while obsolete files still existed: the four path-owning behaviors, isolated runner source path assertion, and remote-history identity test failed. No Production or provider call occurred.

### GREEN

After six `git mv` operations, exact-byte restoration, the three science file creates, verifier extension, and runner path update, the same focused command passed.

Fresh final result: `focused_node_tests pass=119 fail=0`.

The mutation-sensitive fixture now uses the first newly aligned registration file and its obsolete counterpart directly. It independently exercises:

- aligned file missing -> `remote_history_aligned_migration_not_regular`
- aligned file hash mutation -> `remote_history_aligned_migration_hash_mismatch`
- obsolete timestamp reappearance -> `remote_history_obsolete_timestamp_present`

Production verifier result:

```text
Supabase migration layout verified.
```

## Exact-byte Restoration

- Six same-name alternate timestamp migrations were moved with `git mv`.
- Preview-target final newline and director explanatory comment/final newline were removed to match `statements[1]` exactly.
- Three science files were created from the inspected stored statements.
- Fresh `shasum -a 256` output for all nine files matched the table above exactly.
- Six obsolete timestamp strings remain only in `OBSOLETE_REMOTE_HISTORY_SQL` in the verifier and its independent test oracle. There are no stale executable path references in `scripts`, `tests`, or `.github`.

## Isolated Local DB Provider-zero Gate

The brief's package alias `verify:registration-observation:solapi:local` is not present at this base HEAD, so that package command exited before execution. The existing package script is `verify:registration-observation:local-db`, but this pnpm version passes a literal `--` which the fail-closed runner rejects. No DB or provider action occurred in either rejected invocation.

The same repository-owned observation runner was then executed directly with the approved arguments:

```bash
PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --experimental-strip-types \
  scripts/run-registration-observation-local-db-qa.mjs \
  --execute --approved-local-db --focus solapi
```

Result:

```json
{
  "mode": "executed-local-db",
  "focus": "solapi",
  "runtimeVersion": 0,
  "providerCalls": 0,
  "cleanup": "passed",
  "report": {
    "status": 0,
    "primaryError": null,
    "cleanupErrors": [],
    "startAttempted": true,
    "setupStarted": true,
    "providerCalls": 0
  }
}
```

The runner used disposable loopback resources, ran the cumulative SOLAPI contract/queue/dispatch pgTAP focus, left runtime version zero, made no provider calls, and cleaned up its resources.

## Self-review

- `git diff --check`: PASS
- Exact nine byte hashes: PASS
- Focused Node tests: 119/119 PASS
- Production migration layout verifier: PASS
- Disposable local DB SOLAPI gate: PASS, `runtimeVersion=0`, `providerCalls=0`, `cleanup=passed`
- Change scope: six renames, three creates, verifier/test manifest extension, four executable test path updates, and one local runner path update
- No migration repair, link, DB push, Production write, workflow dispatch, push, PR, deployment, activation, send, or provider request was performed.

## Concern

The only operational discrepancy is the stale command name in the brief: the requested `verify:registration-observation:solapi:local` package alias does not exist at the recorded base HEAD. The underlying repository-owned runner completed successfully when invoked directly with the exact approved execution/focus arguments. Adding or changing a package script was outside Task 1's exact file scope and was not done.
