# Task 7 report — full local verification and implementation boundary

## Scope and boundary

- Verified only in the isolated `codex/dashboard-free-tier-optimization` worktree.
- No production database read or write, migration application, `main` push, Vercel deployment, worker activation, provider call, or browser-production QA was performed.
- The three new dashboard migrations remain **candidate** in `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`:
  - `20260813192115_dashboard_daily_brief.sql` — `7ce3eaa85df822396728b9e39b5973507a3c1399c1d92dfe067de824249a0e25`
  - `20260813194812_dashboard_statistics_sources.sql` — `7a881cccbd97cef0daf76cf81d45aa15e4676c1a572a927f339b8eb5f3bef3e0`
  - `20260813205051_dashboard_statistics_cache.sql` — `7ce560e6c3b6864f4b99adcf1cbe9271235ca8e0906d1e93ce985f6f22ca5de0`
- The isolated DB harness was explicitly attempted with a non-secret request ID and stopped before allocating a database with `isolated_supabase_db_baseline_review_required`. Therefore no pgTAP runtime PASS, migration application, or production parity claim is made.

## Query-invariant evidence (source/fixture contracts)

The requested runtime browser counts are represented by source/fixture contracts only; a live browser was deliberately not used.

| Invariant | Fresh evidence |
| --- | --- |
| `/admin/dashboard`: daily-brief RPC 1; statistics/conflict RPC 0 | `src/app/admin/dashboard/page.tsx` mounts only `DashboardDailyBrief`; `tests/admin-shell.test.mjs` and the scoped run assert the dashboard renders only the daily-brief path and has no statistics workspace/hook. `tests/dashboard-daily-brief.test.mjs` asserts the daily-brief service makes one bounded RPC request. |
| `/admin/statistics` initial: selected tab aggregate RPC 1 | `StatisticsWorkspace` conditionally mounts exactly one of four panels, and each panel owns one `useStatisticsSnapshot` call. `tests/statistics-workspace.test.mjs` asserts this selected-tab boundary. |
| Before another tab opens: its RPC 0 | The inactive panel is `null`; the browser cache contract returns `null` when `active: false`. `tests/statistics-snapshot-cache.test.mjs` covers this as `client memory cache loads only the active tab`. |
| Same tab re-entry within 10 minutes: RPC 0 | The same fresh client key is reused at 9:59 with loader calls remaining `1`; the expiry rollover produces the second calculation. `tests/statistics-snapshot-cache.test.mjs` covers the ten-minute client and server cache lifetimes. |
| Separate browser client, same actor/key: statistics calculation RPC 0; cache hit 1 | Two route handlers over the shared private-cache fake produce `cacheStatus: "hit"` with `calculations === 1` at 9:59. The concurrent claimant regression also proves the waiter does not calculate. |
| 400-day conflict range: existing academy-wide fixture exact parity | `tests/statistics-resource-pressure.test.mjs` asserts the executable pgTAP contract named `400-day academy-wide conflict parity`; source also limits the conflict preset to `[90, 180, 400]`. Runtime pgTAP is not claimed because the reviewed baseline gate is closed. |

## Fresh commands and results

### Exact requested commands

```bash
"$TASK_NODE" --test --experimental-strip-types tests/*.test.mjs tests/*.node.ts
```

Result: **3,011 pass / 13 fail / 3,024 total**. The full suite is not green and remains an unresolved repository-wide blocker. The failures include three local PostgreSQL catalog tests during concurrent full-suite execution and ten notification fixture/worker contract failures, including `notification_local_db_fixture_file_refused`, missing observation golden fixtures, vocabulary drift, and `worker_envelope_invalid`. The three PostgreSQL catalog tests passed in the focused dashboard/statistics suite below; that focused result is green, but it does not resolve the full-suite blocker or attribute its failures.

```bash
"$TASK_PNPM" exec tsc --noEmit --pretty false
"$TASK_PNPM" eslint src tests middleware.ts next.config.ts
"$TASK_PNPM" build
```

Each exact pnpm command stopped before its requested command because pnpm's dependency-status install rejected ignored builds for `sharp@0.34.5` and `unrs-resolver@1.11.1`. No approval, install, lockfile, or workspace configuration change was made.

```bash
"$TASK_NODE" ./node_modules/typescript/bin/tsc --noEmit --pretty false
"$TASK_NODE" ./node_modules/eslint/bin/eslint.js src tests middleware.ts next.config.ts
"$TASK_NODE" ./node_modules/next/dist/bin/next build --webpack
git diff --check
```

Results:

- TypeScript: exit 0.
- Direct ESLint: exit 0, with one existing warning in `src/features/management/use-management-records.ts:720` (`react-hooks/set-state-in-effect`); no errors.
- Direct Next webpack build: exit 0; it includes `/admin/dashboard`, `/admin/statistics`, `/api/dashboard/statistics`, and `/api/dashboard/statistics/drilldown`.
- `git diff --check`: exit 0.

### Focused dashboard/statistics verification

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/dashboard-daily-brief.test.mjs \
  tests/dashboard-metrics.test.mjs \
  tests/dashboard-resource-pressure.test.mjs \
  tests/dashboard-snapshot-cache.test.mjs \
  tests/statistics-aggregate-auth.test.mjs \
  tests/statistics-drilldown.test.mjs \
  tests/statistics-resource-pressure.test.mjs \
  tests/statistics-snapshot-cache.test.mjs \
  tests/statistics-workspace.test.mjs \
  tests/isolated-supabase-db-tests.test.mjs
```

Result: **106 pass / 0 fail**. This includes all three local PostgreSQL catalog checks that failed only during the repository-wide parallel run.

```bash
TASK_REQUEST_ID=task7-dashboard-20260814 \
"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs \
  --execute --authorized \
  --request-id "$TASK_REQUEST_ID" \
  --test supabase/tests/dashboard_statistics_cache_test.sql
```

Result: `isolated_supabase_db_baseline_review_required`, before local DB allocation. The reviewed baseline remains the explicit runtime prerequisite.

## Worktree state and handoff

- This report is the only Task 7 change.
- The pre-existing untracked `pnpm-workspace.yaml` remains untracked and must not be staged.
- Source implementation boundary is complete in this worktree; release gates remain separate: reviewed DB baseline, one-at-a-time production migration/ACL validation, `main` push, Vercel Production `READY`/SHA, browser query-count QA, and 30-minute Supabase observation.
