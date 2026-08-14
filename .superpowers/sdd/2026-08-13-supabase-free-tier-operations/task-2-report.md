# Task 2 report — free-tier query and cron guardrails

## Scope

- Added `scripts/verify-free-tier-query-contracts.mjs` as the operations wrapper around the existing `src/lib/query-surface-budget.js` verifier. The wrapper does not copy the shared projection, order, limit, retry, large-IN, or query-debt rules.
- Added diff-scoped checks for direct migration-time cron activation, every-minute notification cron, heartbeat/watchdog tables and writes, raw phone/message/webhook/provider receipt columns, and broad cron delete/unschedule statements.
- Added strict CI and local worktree modes. CI requires two full 40-character commit SHAs and compares the computed merge-base to head. Worktree mode compares its resolved base with committed, index, unstaged, and untracked files. Missing objects, disconnected histories, and mixed modes fail closed.
- Added a baseline-SHA-bound operational exception contract. An exception must identify one migration file, statement symbol, violation, approved reason, and SHA-256 checksum; the exact occurrence must exist at both the immutable exception baseline and the caller base. The built-in ledger is empty and frozen, and its expected contents are test-visible.
- Added the `verify:free-tier` package script and a pull-request-only GitHub Actions workflow with read-only repository permission. It has no Supabase secret, DB push, migration application, provider send, worker activation, or deployment step. The existing Supabase DB push workflow was not changed.
- The pre-existing untracked `pnpm-workspace.yaml` was preserved and excluded from edits and staging.

## TDD evidence

Initial RED with no production module:

```text
ERR_MODULE_NOT_FOUND: scripts/verify-free-tier-query-contracts.mjs
0 pass, 1 fail
```

After adding only an empty verifier shell, the behavior-level RED run produced **4 pass, 5 fail**. The failures were the intended missing behaviors: operational SQL rules, shared query-verifier delegation, checksum exceptions, CLI fail-closed validation, and worktree diff coverage.

Focused GREEN command:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/free-tier-operational-guardrails.test.mjs \
  tests/query-surface-budget.test.mjs
```

Initial result: **109 pass, 0 fail**. After the independent review fixes below, the same command reports **116 pass, 0 fail**.

The tests use temporary real git repositories and cover merge-base selection, disconnected histories, invalid objects, CI/worktree mode mixing, committed/index/unstaged/untracked paths, unchanged historical migrations, exact legacy checksums, all fixed operational SQL rules, shared query select-star rejection, and the shared exact-ID detail allowance.

## Additional verification

- Direct local guard body: `"$TASK_NODE" scripts/verify-free-tier-query-contracts.mjs --base HEAD --surface all --worktree` — exit 0.
- ESLint for the new verifier and tests — exit 0 with no errors or warnings after cleanup.
- `git diff --check` — exit 0.
- The eight migrations in the current PR merge-base diff were inspected by the new operational scanner and produced zero findings.

## Independent review fix round

Four reviewer regressions were encoded before changing production code. The operational suite produced **8 pass, 4 fail** for the intended gaps:

- comment-looking `--` content inside a SQL string could weaken the exception checksum;
- dollar-quoted `DO` execution and function-defined every-minute cron were hidden with inert dollar content;
- receipt tables could use generic `phone`, `message`, `hook_url`, and `raw_receipt` columns;
- `--base HEAD --worktree` did not include the just-committed HEAD change.

The exception checksum now hashes the raw trimmed statement, so any executable or comment change to the occurrence invalidates the allowance. The scanner distinguishes top-level/direct and executable `DO` schedule activation from inert function definitions, while still rejecting every-minute notification cron and heartbeat writes defined inside executable bodies. Operational receipt/audit/delivery tables reject generic and usual raw PII column variants. In local mode, the documented symbolic `HEAD` base compares `HEAD^` with the current committed HEAD plus index, unstaged, and untracked paths; an explicit full base SHA retains its literal comparison meaning.

Review-fix verification: operational suite **12 pass, 0 fail**; combined suite **112 pass, 0 fail**; ESLint, direct local guard body, and `git diff --check` all exit 0.

The second review added two more RED tests: PostgreSQL dollar-quoted cadence had to be recognized, while cron text inside a `RAISE NOTICE` string and `message`/`phone`/`webhook` CHECK values had to remain inert. The scanner now locates actual `cron.schedule(...)` calls outside SQL string literals, parses their balanced arguments, and decodes both single-quoted and dollar-quoted cadence literals. Receipt checks parse only actual `CREATE TABLE`/`ALTER TABLE ADD` column identifiers instead of scanning the entire DDL statement. Final operational result: **14 pass, 0 fail**; final combined result: **114 pass, 0 fail**.

The final review found that `)` inside line/block comments could truncate balanced cron and DDL parsing. A final RED covered both cases; the shared argument parser now tracks nested line/block comments before interpreting parentheses or commas. Final operational result: **15 pass, 0 fail**; final combined result: **115 pass, 0 fail**.

The last PostgreSQL-equivalence review added a RED for quoted `"cron"."schedule"` identifiers and `E'* * * * *'` cadence literals. Both now use the same exact call/argument boundary, without broadening string-content matching. Final operational result: **16 pass, 0 fail**; final combined result: **116 pass, 0 fail**.

The exact plan command using `"$TASK_PNPM" run verify:free-tier -- --base HEAD --surface all --worktree` did not reach the npm script. The managed pnpm pre-run dependency check stopped on the pre-existing untracked `pnpm-workspace.yaml`, whose placeholder `allowBuilds` values leave `sharp` and `unrs-resolver` unapproved, with `ERR_PNPM_IGNORED_BUILDS`. This task did not alter or approve that user-owned file. The same package-script command body passed through the fixed Node runtime as recorded above.

## Release boundary

This task changed source tests and PR CI only. It did not access or mutate a database, apply a migration, activate cron, enable a worker, use a Supabase secret, deploy, push, contact a provider, or establish a recipient receipt.
