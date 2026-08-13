# Task 3 report — dashboard daily brief

## Changes

- Replaced the dashboard home page's metrics/section-card entry point with `DashboardDailyBrief`.
- Added a fail-closed wire contract for the `get_dashboard_daily_brief_v1` payload: exact top-level/count/item fields, safe non-negative integer counts, valid timestamps, at most five upcoming items, and only the three documented appointment source kinds.
- Added one client service call with the required 8-second abort signal and disabled retry. The hook makes that sole initial request; errors retain navigation and show a compact retry control.
- Added the count grid, linked appointment rows, and direct registration/task/academic/class shortcuts without introductory briefing copy or rich-statistics/conflict/textbook imports.

## RED

Before implementation, the focused command reported 36 passing and 3 intended failures:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/dashboard-daily-brief.test.mjs \
  tests/admin-shell.test.mjs \
  tests/ops-browser-dashboard-word-retest-contract.test.mjs
```

- The old home page did not render `DashboardDailyBrief` and still referenced `useTipsDashboardMetrics` and `SectionCards`.
- The daily brief service and strict contract modules were absent.

## GREEN

The same focused command passed: 39 tests, 0 failures.

TypeScript validation also passed:

```bash
"$TASK_NODE" node_modules/typescript/bin/tsc --noEmit --pretty false
```

`git diff --check` passed.

## Self-review

- The only Supabase RPC in the new home path is `get_dashboard_daily_brief_v1`; it is invoked once by the service path and has no summary/conflict fan-out or `Promise.all` source loading.
- A malformed response, unrecognized source kind, or sixth item is rejected before rendering; the UI shows no invented zero values when no valid brief is available.
- No production database access, migration application, provider request, deployment, or `pnpm-workspace.yaml` change was made. Runtime availability of the Task 2 candidate RPC remains a separate blocked gate.

## Review fix round 1

### RED

Added focused contract/service tests for invalid calendar dates, date-only and timezone-free timestamps, null/array top-level payloads, malformed count and appointment values, `data: null, error: null`, and RPC errors. Before the fix, the focused daily-brief test command had 9 passing tests and 1 expected failure: `2026-02-30` and timezone-free timestamps were accepted by the permissive `Date.parse` boundary.

### GREEN

The focused daily-brief test command passed 10/10 after the fix. The full Task 3 coverage command and TypeScript check were then rerun successfully.

### Boundary review

- `localDate` now requires `YYYY-MM-DD` and must round-trip through a UTC calendar date without rollover.
- `generatedAt` and `scheduledAt` now require complete seconds, an explicit `Z` or numeric timezone offset, a valid calendar-date prefix, and a parseable instant.
- `data: null` with no RPC error is treated as invalid contract data, while a non-null RPC error is propagated unchanged.
- No production/DB runtime action or `pnpm-workspace.yaml` edit was made.
