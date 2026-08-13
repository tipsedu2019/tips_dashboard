# Task 2 report — dashboard daily brief DB contract

## Migration lifecycle log

- `draft`: `supabase/migrations/20260813192115_dashboard_daily_brief.sql`, created only by Supabase CLI v2.103.0 with `migration new dashboard_daily_brief`; manifest hash `null`.
- `candidate`: SHA-256 `7ce3eaa85df822396728b9e39b5973507a3c1399c1d92dfe067de824249a0e25`, recorded after SQL/source and pgTAP fixture source were written and immediately before the DB-test attempt.
- `final`: not promoted. The shared harness did not reach migration replay or pgTAP because the approved reviewed baseline capture is unavailable. Promoting without pgTAP GREEN would violate the manifest lifecycle contract.

## Files changed

- `supabase/migrations/20260813192115_dashboard_daily_brief.sql`
- `supabase/tests/dashboard_daily_brief_test.sql`
- `tests/dashboard-daily-brief.test.mjs`
- `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`
- `.superpowers/sdd/2026-08-13-dashboard-home-statistics-lazy-loading/task-2-report.md`

The existing snapshot-source migration `20260809021903_dashboard_snapshot_sources.sql` and all source-controlled blocked baseline/catalog/parity artifacts were preserved unchanged.

## RED evidence

The migration path existed only as the empty file produced by the exact CLI command and the manifest entry was `draft` with a null hash when the source test was first run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types tests/dashboard-daily-brief.test.mjs
```

Result: 0 pass, 5 fail. The failures were the intended missing-contract failures:

- manifest lifecycle was `draft`, not candidate/final;
- the migration had no stable invoker/KST bounds function;
- scheduled appointment and open-task predicates were absent;
- the four-count/five-item privacy-safe projection was absent;
- authenticated-only ACL and pgTAP boundary fixture ownership were absent.

## Source GREEN evidence

Focused task command:

```bash
"$TASK_NODE" --test --experimental-strip-types tests/dashboard-daily-brief.test.mjs
```

Result: 5 pass, 0 fail.

Full source-focused dashboard/harness regression:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/dashboard-daily-brief.test.mjs \
  tests/dashboard-snapshot-cache.test.mjs \
  tests/dashboard-resource-pressure.test.mjs \
  tests/dashboard-metrics.test.mjs \
  tests/admin-shell.test.mjs \
  tests/continuous-class-schedule-consumer-parity.test.mjs \
  tests/ops-browser-dashboard-word-retest-contract.test.mjs \
  tests/isolated-supabase-db-tests.test.mjs
```

Result: 97 pass, 0 fail.

Additional source validation:

- direct ESLint of `tests/dashboard-daily-brief.test.mjs`: exit 0;
- `node --check tests/dashboard-daily-brief.test.mjs`: exit 0;
- `git diff --check`: exit 0;
- on-disk migration SHA-256 equals the candidate manifest hash exactly.

## Implementation contract

- Added one SQL-language `stable security invoker` RPC with `set search_path = ''`.
- The single statement owns one `bounds` CTE, derives the KST `local_date`, inclusive start and exclusive end from `statement_timestamp()`, and returns that same statement timestamp as `generatedAt`.
- Reads only the canonical, security-invoker `public.ops_registration_appointment_calendar` for appointments and `public.ops_tasks` for open tasks, preserving both relations' existing RLS visibility.
- Counts only `scheduled` appointments in KST today for `level_test`, `visit_consultation`, and `observation_class`.
- Counts only RLS-visible tasks due in KST today with status `requested`, `confirmed`, `in_progress`, or `on_hold`; tasks never enter `upcoming`.
- Projects at most five appointments ordered by `(scheduled_at, source_id)` into the documented safe fields. It does not use `select *`, full-row JSON, phone/contact fields, counseling/consultation notes, task memo/request note, or message content.
- Revokes execute from `PUBLIC`, `anon`, and the default `authenticated` grant, then grants execute only to `authenticated`.
- pgTAP source covers function metadata/ACL, KST 00:00 and 23:59, canceled/completed exclusion, equal-time source-ID tie breaking, six-to-five limiting, open-status filtering, and an RLS-hidden task. The fixture is transaction-scoped and rolls back.

## DB runtime gate — blocked, not passed

The exact approved harness shape was attempted with a non-secret local request ID:

```bash
"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs \
  --execute --authorized \
  --request-id task2-dashboard-daily-brief-20260814 \
  --test supabase/tests/dashboard_daily_brief_test.sql
```

Result: exit 1, exact stderr `isolated_supabase_db_baseline_review_required`.

Evidence for the gate:

- `supabase/test-baselines/dashboard-free-tier-v1.active.json` is absent;
- `SUPABASE_DATABASE_READ_TOKEN`, `SUPABASE_PROJECT_REF`, and `TASK_REQUEST_ID` were absent from the task environment;
- canonical baseline/catalog files still explicitly state `captureStatus: "blocked"` / approved Management API read-only capture required;
- the harness checks the active immutable reviewed capture before runtime allocation, so no local Supabase/Docker start, migration replay, target pgTAP, production read, or production migration occurred.

Therefore this report claims source GREEN only. It does not claim pgTAP GREEN, DB runtime verification, production catalog verification, migration application, deployment, or full Task 2 completion. The manifest remains `candidate` with its matching hash until approved baseline capture and isolated pgTAP are available.

## Self-review

- Verified that appointment counts and the five-item projection share the same materialized statement-local relation and exact KST half-open range.
- Verified deterministic limiting happens before JSON aggregation and ordering is repeated in the aggregate.
- Verified the task query is independent from the appointment projection and reads no task title or private detail.
- Verified observation deep links contain only canonical IDs already exposed by the appointment calendar view; no contact or consultation content is returned.
- Verified no `security definer`, service-role grant, production mutation, provider call, existing migration rewrite, or baseline-placeholder substitution was introduced.
- Remaining risk is exactly the blocked runtime lane: PostgreSQL execution and RLS behavior are specified in pgTAP source but are not empirically passed until the reviewed baseline gate is satisfied.
