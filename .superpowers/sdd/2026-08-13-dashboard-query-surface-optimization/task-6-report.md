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
- The integration test builds one minimal Next fixture, proves a single loader call across process A and a restarted process B sharing the same `.next` Data Cache, verifies tag invalidation raises the counter to 2, and verifies failed tag revalidation still serves the last-good HTTP payload.
- `node node_modules/typescript/bin/tsc --noEmit` completed successfully and `git diff --check` completed successfully.

## Concern gate

`node scripts/verify-query-surface-budget.mjs --surface public --base HEAD --worktree` remains red. Its guard applies list pagination/order requirements to the legacy full public compatibility projections and to the small authenticated role RPC added by the invalidation route. Applying a list limit would change the required full API compatibility contract, so this task does not mask the failure by truncating that API. No database migration, database runtime, deployment, provider call, or production mutation was performed.
