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

## Fix round 1 — review follow-up

- The verifier now treats every manifest-listed `file + symbol` as an explicit list rule, rather than inferring list status from the symbol name. This covers the legacy `management-service.js:selectRows` row.
- New list-path detection is independent of names: a query with a page limit, RPC `p_limit`, or task-ID batch list read is inspected. Simple local string/numeric constants are resolved before checking `.select(...)`, `.limit(...)`, and `p_limit`, so `columns = "*"` and `pageSize = 31` cannot bypass the guard.
- `decodeKeysetCursor` now validates both the envelope scope and the expected scope as exact 64-character SHA-256 hex strings before scope comparison.
- RED-first follow-up fixtures were added for all three regressions; the focused suite now reports **15 pass, 0 fail**.

## Fix round 2 — fail-closed query expressions

- Manifest-listed list symbols now receive a complete direct-query contract: direct `.from(...)` lists require a statically resolved explicit projection and positive integer limit of at most 30; direct `.rpc(...)` lists require a statically resolved `p_limit` in the same range.
- Opaque projection expressions, opaque limits, and computed query entrypoints receive distinct exact violation codes: `list_projection_unresolved`, `list_limit_unresolved`, and `list_query_method_unresolved`.
- Existing violations caused by unresolved/missing projection or limit contracts were added as exact literal baseline-debt rows only for the affected current symbols. No wildcard exception was added.
- The verifier continues to allow direct `.from(table)` with a statically resolved explicit projection/page size and a direct RPC with `p_limit: 30`.
- RED-first fixtures cover `['*'].join('')`, `Number('31')`, and `client['from'](...)`; the focused suite reports **20 pass, 0 fail**.

## Fix round 3 — occurrence debt and canonical scope safety

- Legacy-debt matching is now occurrence-count based for each exact `surface + file + symbol + violation` key. A second occurrence of an already-manifested violation is reported rather than being hidden by the first baseline occurrence.
- Every direct `.from(...)` or `.rpc(...)` in a manifest-listed symbol is inspected even without a page-limit expression; missing limits therefore fail under the existing exact contract. Computed and optional computed entrypoints such as `client?.[method]?.(...)` are detected and rejected as `list_query_method_unresolved`.
- `canonicalScopeHash` is exported as the sole SHA-256 canonical scope boundary. It now rejects `undefined`, non-finite numbers, sparse arrays, and non-plain objects rather than serializing ambiguous values; `createCursorScope` uses this boundary.
- RED-first fixtures cover the duplicate same-code violation, no-limit direct query, nonliteral optional computed entrypoint, and all invalid canonical-scope values. The focused suite reports **24 pass, 0 fail**.

## Fix round 4 — chain-complete request contracts

- Every direct `.from(...)` and `.rpc(...)` request chain in an owned changed surface is inspected. Limits are required per chain; the only direct-list exemptions are explicit `.single()` / `.maybeSingle()` or a statically bounded `.range(first, last)` of at most 30 rows.
- Query control checks no longer borrow `.select(...)`, `.limit(...)`, abort, or retry configuration from a neighbouring request. Computed query entrypoints continue to fail closed.
- Extraction includes module prefixes and single-parameter arrow functions. It stops each request at its statement boundary, so a second query chain cannot modify the first chain's fingerprint or compliance result.
- Every debt row now includes an exact SHA-256 query-chain fingerprint. The verifier loads the row's recorded baseline SHA and proves that fingerprint exists there before accepting it; a moved, fixed-then-reintroduced, or duplicated same-code violation is rejected.
- Wildcard projections are rejected when `*` appears as a trimmed field anywhere in the comma-separated projection, including `" *, name "` and `"id, *"`.
- RED-first fixtures cover direct no-limit `.from` and `.rpc` requests, per-chain controls, prefix/arrow extraction, duplicate/moved debt, explicit single/range exemptions, and wildcard spacing/mixed fields. Final focused result: **32 pass, 0 fail**.

## Fix round 4 verification

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/query-surface-budget.test.mjs \
  tests/keyset-pagination.test.mjs

"$TASK_NODE" scripts/verify-query-surface-budget.mjs \
  --surface all --base HEAD --head HEAD

"$TASK_NODE" scripts/verify-query-surface-budget.mjs \
  --surface all --base fad56ae59f6b5ec6999e3232bbe68e4c1d26b101 --worktree

git diff --check
```

All commands exited successfully. No migration, production database/deployment action, or `pnpm-workspace.yaml` modification was made.

## Fix round 5 — AST receiver analysis and baseline deltas

- Replaced regex query extraction with the installed TypeScript 5.9 AST parser; no dependency or lockfile change was made. The scanner attributes query calls to their enclosing named function (including anonymous callbacks owned by that function).
- Query detection is receiver-aware: it recognizes `client`, `supabase`, and `db` aliases; optional calls; literal computed entrypoints such as `db["from"]`; and progressive multiline query reassignment. `Array.from(...)` is ignored, while dynamic computed entrypoints and unprovable `.from` / `.rpc` receivers fail closed with exact reasons.
- `.select(...)` arguments are read as balanced AST call arguments, so explicit nested PostgREST projections remain valid instead of being cut at an inner parenthesis.
- For each changed owned file, candidate findings are compared occurrence-by-occurrence with exact findings from the caller's `--base` source. This permits Task 2–6 to modify a legacy file without enumerating every historical scanner finding, while a new chain/violation still fails. The literal debt ledger remains baseline-SHA validated; its fingerprints were regenerated from the AST baseline, and the old public summary false-positive row was removed.
- Added RED-first fixtures for the real `ops-task-service.ts` baseline-delta case (unchanged legacy source passes; injected select-star fails), aliases, optional/literal/dynamic computed receivers, multiline reassignment, `Array.from`, unprovable bare receivers, nested projections, and an RPC without an argument envelope.
- Final focused result: **37 pass, 0 fail**. The parser guard also correctly reports a missing RPC page limit rather than throwing for `rpc(name)`.

## Fix round 5 verification

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/query-surface-budget.test.mjs \
  tests/keyset-pagination.test.mjs

"$TASK_NODE" scripts/verify-query-surface-budget.mjs \
  --surface all --base HEAD --head HEAD

"$TASK_NODE" scripts/verify-query-surface-budget.mjs \
  --surface all --base fad56ae59f6b5ec6999e3232bbe68e4c1d26b101 --worktree

git diff --check
```

All commands exited successfully. No migration, production action, or `pnpm-workspace.yaml` change was made.

## Fix round 6 — manifest authority and deterministic list contracts

- Design decision: the manifest remains the sole legacy-debt allowance and was not expanded into a broad snapshot of historical findings. The diff verifier now considers only query chains whose source span is touched by the caller's diff; an unchanged old chain is outside the candidate set. For every touched chain, only an exact manifest `surface + file + symbol + violation + baseline fingerprint` can permit its legacy finding. There is no candidate-vs-baseline grandfathering.
- This keeps Task 2–6 practical when they edit unrelated portions of a legacy source file, while making a changed or new query fail unless it complies or preserves an exact listed legacy chain. RED fixtures prove both a removed manifest row and a touched unmanifested legacy query fail.
- `abortSignal` is now structurally checked as exactly `.abortSignal(AbortSignal.timeout(8000))`; a fallback/or expression containing that text does not pass.
- A page list must provide an actual `.limit(...)` and `.order(...)`. `.single()` / `.maybeSingle()` is an exception only with an exact-key `.eq("id", value)` predicate; otherwise it is treated as an unbounded list request and fails with explicit detail/limit/order reasons.
- Projection wildcard recognition is recursive across PostgREST nesting, rejecting `owner:profiles(*)` as well as top-level wildcard fields while continuing to allow explicit nested fields.
- RED-first fixtures cover manifest-row removal, unmanifested touched debt, timeout fallback bypass, bare single, unordered page, exact-key detail, and nested wildcard behavior. Final focused result: **41 pass, 0 fail**.

## Fix round 6 verification

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/query-surface-budget.test.mjs \
  tests/keyset-pagination.test.mjs

"$TASK_NODE" scripts/verify-query-surface-budget.mjs \
  --surface all --base HEAD --head HEAD

"$TASK_NODE" scripts/verify-query-surface-budget.mjs \
  --surface all --base fad56ae59f6b5ec6999e3232bbe68e4c1d26b101 --worktree

git diff --check
```

All commands exited successfully. No migration, production action, or `pnpm-workspace.yaml` change was made.
