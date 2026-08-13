# Task 5 report — private statistics cache and active-tab hook

## Status

- Source implementation and focused Node contracts: **GREEN**
- Direct ESLint and TypeScript: **GREEN**
- Migration lifecycle: **candidate**
- Isolated pgTAP runtime: **BLOCKED before database allocation**
- Production database, deployment, provider, and recipient lanes: **not requested and not touched**

## Migration lifecycle

- `draft`: `supabase/migrations/20260813205051_dashboard_statistics_cache.sql`, created only by Supabase CLI v2.103.0 with `migration new dashboard_statistics_cache`; the shared manifest entry was immediately recorded with `status:"draft"` and `sha256:null`.
- `candidate`: SHA-256 `7ce560e6c3b6864f4b99adcf1cbe9271235ca8e0906d1e93ce985f6f22ca5de0`, recorded only after the migration, Node RED contracts, and fixture-backed pgTAP source were written.
- `final`: not promoted. The approved reviewed active baseline capture is absent, so migration replay and pgTAP did not run. Promoting without pgTAP GREEN would violate the shared manifest lifecycle.

## Files changed

- `supabase/migrations/20260813205051_dashboard_statistics_cache.sql`
- `supabase/tests/dashboard_statistics_cache_test.sql`
- `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`
- `src/features/dashboard/statistics-contract.ts`
- `src/features/dashboard/statistics-cache.ts`
- `src/features/dashboard/server/statistics-route.ts`
- `src/features/dashboard/use-statistics-snapshot.ts`
- `src/app/api/dashboard/statistics/route.ts`
- `tests/statistics-snapshot-cache.test.mjs`
- `tests/statistics-resource-pressure.test.mjs`
- `.superpowers/sdd/2026-08-13-dashboard-home-statistics-lazy-loading/task-5-report.md`

The pre-existing untracked `pnpm-workspace.yaml` was preserved and excluded.

## TDD evidence

After the exact CLI-created migration existed only as an empty file and its manifest entry was `draft`/null, the focused command was run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types \
  tests/statistics-snapshot-cache.test.mjs \
  tests/statistics-resource-pressure.test.mjs
```

Result: 12 pass, 12 intended failures. The failures proved the missing cache modules/route/hook, missing CAS wrappers and pgTAP file, empty migration, and still-draft lifecycle.

After the first implementation, the focused cache suite reported 7 pass / 2 fail. One failure exposed that the memory-cache loader was deferred by one microtask rather than registering the in-flight request synchronously; the other exposed an over-broad source assertion. The loader was corrected and the assertion narrowed to the cache adapter. The required re-run after both patches reported 9 pass / 0 fail. A later active-tab contract expansion explicitly covered initial overview, inactive-tab zero calls, a new-tab call, and a ten-minute overview re-entry without a call.

## Source GREEN evidence

Fresh exact focused source verification:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/statistics-snapshot-cache.test.mjs \
  tests/statistics-resource-pressure.test.mjs
```

Result: 24 pass, 0 fail.

Additional fresh checks:

- direct installed ESLint on the changed TypeScript and test files: 0 errors, 0 warnings;
- `tsc --noEmit --pretty false`: exit 0;
- `git diff --check`: exit 0;
- on-disk migration SHA-256 equals the candidate manifest hash exactly.

The exact requested pnpm-eslint command was also attempted. The repository runtime wrapper stopped before ESLint because dependency status enforcement rejects the existing ignored build scripts `sharp@0.34.5` and `unrs-resolver@1.11.1`. No dependency or build-approval files were changed. Running the already-installed ESLint CLI directly with the pinned Node runtime passed cleanly.

## Implemented contract

- Added a private `dashboard_private.dashboard_statistics_cache` table containing only actor, role, contract/request identity, tab, CAS ownership/generation, timestamps, and aggregate JSON payload. It has forced RLS, no public/anon/authenticated/service direct table privileges, a fixed unique actor-role-contract-request key, and state constraints separating `computing` from `ready` rows.
- Added the four exact public PostgREST wrappers. They are PostgreSQL-owned `SECURITY DEFINER` functions with empty search paths, revoked from PUBLIC/anon/authenticated, and executable only by `service_role`.
- Claims use a 15-second lease. An active claimant returns `wait`; an expired lease, expired ready entry, or forced request increments the generation and installs a new claim token. Finalize stores only a matching generation/token owner, assigns an exact ten-minute TTL, and returns `superseded` for stale work.
- Finalize accepts only object payloads with tab-specific aggregate top-level keys. Drilldown roster endpoints are not routed through the cache.
- Invalidation is exact actor/role/contract/request CAS and increments generation, preventing a slow prior response from overwriting current data. There is no global cross-actor invalidation.
- Each claim opportunistically deletes at most 20 rows belonging to the same actor whose expiry is older than 24 hours, using deterministic expiry/role/contract/hash order. No cron was added.
- The server validates the bearer session and dashboard role using the authenticated JWT client. Only the actor JWT client invokes the security-invoker `get_dashboard_statistics_sources_v1`; the service client is confined to cache wrappers.
- Every PostgREST statistics/cache RPC uses an eight-second abort timeout and `.retry(false)`. A losing claimant polls read at 100ms, 250ms, and 500ms, then returns `503 statistics_cache_busy` with `Retry-After: 1` without calculating or taking over the lease.
- The key order is exactly `[userId, role, "dashboard-statistics-v1", tab, subject, division, dateFrom, dateTo].join(":")`. Access tokens are used only in the Authorization header and are never included in keys or stored payloads.
- The browser cache is memory-only, deduplicates in-flight requests, keeps successful snapshots for ten minutes, never retains failures, and skips inactive tabs. Tab/range changes abort the prior request.
- Conflict presets are today through +90/+180/+400 days. Textbook presets are inclusive recent 30/90/180/365 days. URL `range` restoration is allowlisted and defaults to 90.
- The returned `generatedAt`, `expiresAt`, and `cacheStatus` are preserved in the hook state for UI display.

## DB runtime gate — blocked, not passed

The exact authorized harness shape was attempted with a generated non-secret request ID:

```bash
TASK_REQUEST_ID=task5-cache-20260814
"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs \
  --execute --authorized \
  --request-id "$TASK_REQUEST_ID" \
  --test supabase/tests/dashboard_statistics_cache_test.sql
```

Result: exact output `isolated_supabase_db_baseline_review_required`.

The runner stopped at the reviewed active-baseline gate. It did not allocate/start a database, replay migrations, execute pgTAP, read production, or apply any production migration. Consequently this report claims fixture-backed pgTAP source coverage, not pgTAP runtime PASS, and the manifest remains `candidate` with its matching hash.

## Self-review

- Rechecked cache identity includes actor ID, role, contract version, tab/filter/range-derived request hash, and that no invalidation scans other actor keys.
- Rechecked service-role code never invokes the human statistics source RPC, while the authenticated JWT client never receives cache wrapper execute rights.
- Rechecked waiters never calculate, retry PostgREST, or steal a live lease.
- Rechecked roster drilldowns and access tokens are absent from cache storage and persistent browser storage.
- Remaining empirical risk is exactly the blocked PostgreSQL lane: migration execution, privileges/RLS, CAS fixture behavior, expiry boundaries, and cleanup count are specified in pgTAP source but cannot be claimed passed until a reviewed active baseline is available.

## Review fix round 1

### RED

Four behavior tests were added before the implementation change. The focused cache suite reported 9 pass / 4 intended failures:

- a cache hit received at 9:59 before the authoritative server expiry was incorrectly retained for a fresh browser ten-minute window;
- already-expired and malformed snapshots were returned and retained rather than rejected;
- no force-intent state machine existed to preserve a forced request through StrictMode cleanup or a dependency-change abort;
- snapshot state was not keyed, so the prior tab/filter/range result could remain visible until the next request settled.

### Changes

- Successful browser snapshots are normalized inside the memory cache and cached until `min(receivedAt + 10 minutes, snapshot.expiresAt)`. A snapshot whose authoritative expiry is at or before receipt raises `dashboard_statistics_snapshot_expired`; malformed and expired results are removed from the in-flight entry and never retained.
- The test now fixes a server hit at 9:59, proves it is reused for only the remaining 999ms, and proves the browser does not extend it past the server's 10:00 expiry.
- Force refresh now has requested/completed revisions. Starting an effect does not consume the request. StrictMode cleanup, cancellation, request-key dependency changes, failures, and stale earlier completions preserve the pending intent; only the matching successful forced fetch marks it completed.
- Snapshot state now stores `{key, snapshot}`. The hook exposes a snapshot only when its stored key equals the active cache key, so tab, preset, subject, division, and date changes hide the prior result synchronously rather than waiting for the replacement request.

### GREEN and blocked DB lane

Fresh focused verification after the review fix passed 28/28:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/statistics-snapshot-cache.test.mjs \
  tests/statistics-resource-pressure.test.mjs
```

Direct ESLint of the changed cache/hook/test files, `tsc --noEmit`, and `git diff --check` exited 0. The SQL migration was not changed, so its candidate SHA-256 remains `7ce560e6c3b6864f4b99adcf1cbe9271235ca8e0906d1e93ce985f6f22ca5de0`.

The authorized isolated DB harness was re-attempted and again returned the exact fail-closed result `isolated_supabase_db_baseline_review_required` before database allocation. No migration replay, pgTAP execution, production read, production migration, or deployment is claimed. The manifest remains `candidate`.

## Review fix round 2

### RED

Added a valid-looking response envelope containing `ok`, contract/tab, timestamps, and cache status but no own `data` field. Before the normalizer fix, the focused cache suite reported 13 pass / 1 intended failure: the cache returned and retained that envelope instead of raising `dashboard_statistics_response_invalid`.

### Change and GREEN

`normalizeDashboardStatisticsSnapshot` now requires an own `data` property using `Object.prototype.hasOwnProperty.call`. This rejects a missing field even if the rest of the envelope is valid-looking, while preserving `data: null` as an explicit payload. Because memory-cache normalization occurs before storage, the rejected promise removes the in-flight entry; the regression test proves a following valid loader is invoked and cached rather than receiving the invalid result.

Fresh focused verification passed 29/29 across the cache and resource-pressure suites. Direct ESLint of the changed contract/test files, `tsc --noEmit`, and `git diff --check` exited 0. No SQL, manifest, DB runtime, production database, or deployment change was made; the migration remains at the same candidate hash and the previously recorded isolated DB baseline blocker remains authoritative.
