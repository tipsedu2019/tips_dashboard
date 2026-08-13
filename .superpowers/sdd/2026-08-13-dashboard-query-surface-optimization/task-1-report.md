# Task 1 report — query-surface budget regression guard

## Scope

- Added a common query-surface verifier at `src/lib/query-surface-budget.js` and the thin CLI at `scripts/verify-query-surface-budget.mjs`.
- Added an exact literal legacy-debt manifest. Every row names its surface, file, symbol, violation code, and `fad56ae59f6b5ec6999e3232bbe68e4c1d26b101` baseline SHA; path wildcards and regex exceptions are not used.
- The verifier compares the selected change with its base revision. A manifest exception is accepted only when the same exact violation exists in that base source, preventing a new violation from being hidden behind a legacy symbol-level exception.
- Added public keyset and management-relation cursor envelopes in `src/lib/keyset-pagination.ts`. Public cursors bind the validated sort tuple and UUID to a SHA-256 scope built from surface, actor-visible role, canonical filters, and sort; mismatches fail with `cursor_scope_mismatch` before query parameters are available.
- No migration, database access, provider call, deployment, push, or production mutation was performed. The pre-existing untracked `pnpm-workspace.yaml` was not changed or staged.

## TDD evidence

1. RED: the requested test command failed because both new modules were absent (`ERR_MODULE_NOT_FOUND` for `query-surface-budget.js` and `keyset-pagination.ts`).
2. GREEN:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/query-surface-budget.test.mjs \
  tests/keyset-pagination.test.mjs
```

Result: **13 pass, 0 fail**. The fixtures reject select-star lists, list/RPC limits over 30, absent timeout/no-retry handling, and task-ID batch child reads. They also cover unstaged worktree additions, fail-closed CLI modes, malformed/base64url/unknown-version cursor input, cursor tuple validation, scope mismatch, and management relation binding.

## Verifier modes checked

```bash
"$TASK_NODE" scripts/verify-query-surface-budget.mjs \
  --surface all --base HEAD --head HEAD

"$TASK_NODE" scripts/verify-query-surface-budget.mjs \
  --surface all --base fad56ae59f6b5ec6999e3232bbe68e4c1d26b101 --worktree

git diff --check
```

All commands exited successfully. Worktree mode combines committed, index, unstaged, and untracked paths relative to `--base`; unknown surfaces or incomplete/mixed CLI modes exit fail-closed.

## Handoff

Task 2–6 should remove only their completed surface's manifest rows in the same commit as the corresponding replacement query path. This guard does not apply any database migration or alter current runtime queries itself.
