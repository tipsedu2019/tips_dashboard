# Task 6 report — public class last-good summary cache

## Scope delivered

- Added a 600-second tagged Next Data Cache summary loader under `public-classes-summary-v1`. Only successful live summary payloads can enter the cache; cold failures fall back to a normalized `public/data/public-classes.json` summary and then to an unavailable empty payload.
- Kept `/api/public-classes` as the legacy full payload API. Its successful shared-cache header is now `public, max-age=0, s-maxage=600, stale-while-revalidate=3600`; fallback responses remain `no-store`.
- Replaced the three legacy full-builder wildcard projections with explicit compatibility projections.
- Added authenticated admin/staff-only cache invalidation at `POST /api/public-classes/cache/invalidate`. It accepts only `{ reason, requestId }`, calls the summary tag and full API path exactly once, and returns a pending state without rolling back a completed business mutation.
- Connected confirmed class/textbook/schedule mutation boundaries in management, operations tasks, textbook operations, and the class schedule workspace. The schedule workspace visibly states that cache refresh is pending when delivery fails.

## RED then GREEN evidence

- RED: the new cache and invalidation tests initially failed with `ERR_MODULE_NOT_FOUND` for the new production modules, and the existing API test failed because its old `s-maxage=60` header did not meet the 600-second contract.
- GREEN: `node --test --experimental-strip-types tests/public-classes-cache.test.mjs tests/public-classes-cache.integration.test.mjs tests/public-classes-cache-invalidation.test.mjs tests/public-classes-summary-loading.test.mjs tests/dashboard-snapshot-cache.test.mjs` completed **20/20**.
- GREEN: the two targeted query-surface regressions completed **2/2**; the public verifier passed against the dispatch base and the exact worktree command.
- P1 follow-up GREEN: the expanded Task 6 suite completed **23/23**. It proves exact table/projection public-compatibility guards reject substituted chains, active management/textbook CRUD returns pending refresh state to the UI, and ready plus withdrawal/transfer completion paths invalidate only after their roster RPC succeeds.
- The integration test builds one minimal Next fixture, proves a single loader call across process A and a restarted process B sharing the same `.next` Data Cache, verifies tag invalidation raises the counter to 2, and verifies failed tag revalidation still serves the last-good HTTP payload.
- `node node_modules/typescript/bin/tsc --noEmit` completed successfully and `git diff --check` completed successfully.

## Query-surface gate

- GREEN: the public-surface verifier passes against the dispatch base and the exact `--base HEAD --worktree` command.
- The guard keeps list limits, ordering, timeout, and no-retry requirements for every ordinary public list. Its only non-list exception is tied to `buildPublicClassesPayload` in the exact public payload file: the named summary compatibility selector and the three full compatibility query ordinals, each still requiring an explicit non-wildcard projection. The role lookup is listed as the established zero-argument scalar RPC, rather than a pageable RPC.
- Regression coverage proves an accidental fourth list in the same function still fails for both missing limit and ordering, and that the role RPC is not forced to accept a fictitious page argument.

This guard correction is recorded as a separate follow-up after the non-destructive Task 4 history restoration. No database migration, database runtime, deployment, provider call, or production mutation was performed.

## Round 2 P1 remediation

- Tightened the public compatibility exemption to the four literal `supabase.from(...).select(...)` chains only. It now rejects both receiver aliases and appended predicates, while preserving the legacy full `/api/public-classes` response shape.
- Bound the 38 pre-existing ops-task mutation findings to their exact dispatch-baseline fingerprints in the debt manifest. The list guard itself was not relaxed; a changed query or a different chain remains unapproved.
- Moved legacy roster, waitlist, textbook-link, withdrawal, and transfer invalidation out of partial write helpers. Successful outer logical commits now return the nonfatal refresh receipt to the ops workspace; delete and status UI paths display the pending state.
- Made management textbook deletion return an explicit `deletedIds` receipt before cache invalidation, so an empty/failed delete cannot report a cache refresh as a successful mutation.

Round 2 RED was the query-budget baseline-delta regression (38 findings). Final GREEN: `tests/query-surface-budget.test.mjs` and `tests/public-classes-cache-mutation-boundaries.test.mjs` completed **63/63**; task and public worktree query guards passed; raw `tsc --noEmit` with the bundled Node and `git diff --check` passed. `pnpm exec` was not used for TypeScript because the user-owned untracked `pnpm-workspace.yaml` makes pnpm's dependency policy try an install and fail on ignored builds. No DB, migration, deployment, provider, or production action ran.

## Round 3 P1 remediation

- The four public compatibility exceptions now require a syntactically direct `supabase.from(...).select(...)` AST chain. Receiver aliases, stored query builders, and appended predicates are rejected.
- Query debt verification supports an occurrence-bound manifest fingerprint: a baseline-approved chain moved within the same symbol no longer inherits the allowance. Existing dispatch debt remains exact-chain and count-bound.
- Canonical admission completion and enrollment cancellation call invalidation only after their RPC succeeds, return the nonfatal refresh receipt, and the enrollment editor renders a pending-cache warning. Legacy registration stage transitions now render their returned pending receipt too.

Round 3 RED added direct-builder and moved-occurrence regressions. Final GREEN: query-budget/cache boundary suites are **66/66**, task and public worktree guards pass, bundled-node TypeScript and diff check pass. No DB, migration, deployment, provider, or production action ran.

## Round 4 P1 remediation

- Default legacy-debt records now carry a required occurrence fingerprint and the verifier validates it against the recorded baseline. The stable anchor combines the exact chain with its direct predecessor statement kind, so a same-symbol move is rejected without treating unrelated predecessor-body edits as new debt.
- Public compatibility chains reject optional chaining at every `supabase`/`from`/`select` link while retaining the legacy full `/api/public-classes` response contract.
- Registration admission completion and enrollment cancellation accept an injected post-commit cache invalidator, use the committed mutation client, and retain the nonfatal pending receipt for the caller/UI.
- Cache-invalidation delivery is bounded by an abortable 3-second timeout; a hung network request resolves to the existing `pending` receipt rather than delaying a completed mutation.
- The Next fixture build explicitly selects webpack. This avoids the local unsigned-SWC-to-WASM fallback path where Turbopack cannot create its project, and restores the cross-process Data Cache proof.

Round 4 RED covered the missing default occurrence record, optional-chain compatibility bypass, VM factory import failure, and a hung invalidation request. Final GREEN: exact Task 6 suite **21/21**, full query-budget suite **68/68**, registration/cache suite **73/73**, public worktree guard, bundled-node TypeScript, and `git diff --check` all pass. No DB, migration, deployment, provider, or production action ran.

## Round 5 P1 remediation

- The cache-invalidation deadline now covers both delivery and `response.json()` parsing. A stuck body aborts and returns the existing nonfatal `pending` receipt within the same bounded deadline.
- Legacy debt occurrence identity now includes the normalized predecessor statement plus the exact query chain. A moved chain between same-kind statements is rejected; a harmless insertion before an unchanged chain remains permitted because its own source line is not changed.
- Regenerated every default occurrence fingerprint from the dispatch baseline and kept the baseline-validation regression.

Round 5 RED was a hung successful-response body plus same-kind statement move/insertion regressions. Final GREEN: exact Task 6 suite **22/22**, full query-budget suite **76/76**, registration/cache **74/74**, public and all-surface worktree guards, bundled-node TypeScript, and `git diff --check`. No DB, migration, deployment, provider, or production action ran.
