# Task 4 report — mode-scoped operations reads

## Migration lifecycle

- `draft`: Supabase CLI v2.103.0 created `supabase/migrations/20260814035710_operations_scoped_reads.sql` via `migration new operations_scoped_reads`; the manifest began with a null hash.
- `candidate`: source-complete SHA-256 `266603c7b020c4e2b2681287f0f7bd63bd9ae411451b26778dd22a80a4abd87d` is recorded and equals the on-disk migration.
- `final`: not promoted. The isolated harness stopped before database allocation with `isolated_supabase_db_baseline_review_required`; migration replay and pgTAP runtime GREEN are not claimed.

## RED evidence

- The new operations service/source suite first ran **0 pass / 8 fail** because the mode service, migration, scoped hook, and mode UI did not exist.
- The visible-range calendar callback contract independently failed **0 pass / 1 fail** before `CalendarMain` exposed its exact rendered range.

## Implementation

- Replaced the initial 17-table operations fan-out with a discriminated `calendar | annual | class_schedule` request and one mode RPC per initial read.
- Calendar reads exactly the rendered inclusive range, rejects ranges over 42 days, returns at most 2,000 complete rows, and fails all-or-nothing with `visible_range_too_dense` plus a seven-day recovery. The last successful grid remains mounted.
- Annual board reads only the selected year, returns renderer-ready bounded entries and summary data, excludes full notes/raw curriculum payloads, and fails all-or-nothing above 4,000 entries or 400 KiB.
- Calendar and annual edit actions make no detail request before selection and use one exact `get_academic_event_detail_v1(eventId)` request after selection. Deep-linked calendar selection follows the same exact-detail boundary.
- Class schedule list sends the canonical term/search/subject/grade/teacher/sync-group filter scope to the server, uses Korean-numeric name plus UUID keyset order, reads 30+1 rows, appends/deduplicates `다음 30건`, and displays authoritative same-filter stats/options without browser re-filtering.
- Class list rows contain only explicit summary scalars and never read `schedule_plan`. The selected class continues to use exact `get_class_schedule_v1(classId,dateFrom,dateTo)` for its visible month.
- Small teacher/classroom/subject catalogs are bounded and cached for 30 minutes inside the authenticated user/role service scope.
- All read RPCs use an eight-second abort signal and disable automatic retries. New RPCs are fixed-search-path `security invoker` functions granted only to `authenticated`; no service-role client or new definer function was added.
- Extended the query-surface guard only for the exact scalar or internally bounded operations read contracts used by this surface.

## Source GREEN evidence

Focused command:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/operations-scoped-reads.test.mjs \
  tests/academic-calendar-ui.test.mjs \
  tests/academic-annual-board.test.mjs \
  tests/class-schedule-planner-calendar-toggle.test.mjs \
  tests/continuous-class-schedule-consumer-parity.test.mjs
```

Result: **38 pass, 0 fail**.

Additional verification:

- Query-surface budget regression plus Task 4 service suite: **64 pass, 0 fail**.
- TypeScript `tsc --noEmit`: exit 0.
- Operations query-surface guard: exit 0.
- ESLint on changed source/test files: exit 0 after resolving the only warning.
- `git diff --check`: exit 0.
- Task 4 migration lexical normalization: GREEN.
- Candidate manifest SHA-256 equals the on-disk migration SHA-256.

The repository-wide migration-layout suite remains blocked by the pre-existing Task 3 candidate `20260814011752_management_page_reads.sql` lexical-normalization finding. Task 4's `20260814035710_operations_scoped_reads.sql` is no longer in that finding.

## DB runtime gate — blocked, not passed

The authorized isolated command was attempted after the candidate hash update:

```bash
"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs \
  --execute --authorized \
  --request-id 8f4a17a0-a22d-4a75-8d41-bc45ca71c8b4 \
  --test supabase/tests/operations_academic_scoped_reads_test.sql
```

It stopped before allocation with `isolated_supabase_db_baseline_review_required`. No migration replay, pgTAP runtime, production query, migration application, deployment, worker, webhook, or provider activity occurred. The manifest therefore remains `candidate`.

## Boundary

Source implementation and source verification are complete. Runtime SQL behavior is specified in `supabase/tests/operations_academic_scoped_reads_test.sql` but remains empirically unverified until the reviewed isolated baseline gate opens. The pre-existing untracked `pnpm-workspace.yaml` was preserved and excluded from staging.

## Adversarial fix round 1

Review RED was **6 pass / 8 fail**. A second exact-wire-shape RED reproduced the stored metadata array loss as **0 pass / 1 fail**, and an annual-board read-save regression reproduced the missing metadata envelope as **0 pass / 1 fail**.

The round closes these source contracts:

- Exact event detail now returns the untouched stored note, parses `[[TIPS_META]]`, and preserves unknown metadata plus exam term, science area, scalar scopes, and structured scope arrays through both calendar and annual-board read-save paths.
- Annual RPC rows now carry renderer-ready `examTerm`, stable synthetic derived IDs, `parentEventId`, `sourceKind`, and one row per comma-delimited grade. Derived subject rows edit the parent academic event instead of masquerading as it.
- Lesson-design deep links hydrate the exact class ID even outside page one. The editor opens only after the exact legacy `schedule_plan`, connected textbooks, and subject-scoped teacher/classroom catalogs arrive; the initial class list still does not read `schedule_plan`.
- Continuation append captures both request revision and fingerprint and rejects stale rows or stale errors after a scope change.
- Dense calendar recovery retains the last successful monthly grid while loading and then renders an actual seven-day agenda. Returning to month mode cannot cache the seven-day response as a month.
- The exact lesson-design RPC and all other Task 4 reads remain eight-second/no-retry, authenticated-only, fixed-search-path `security invoker` boundaries. No new definer or service-role client was introduced.

Final source evidence:

- Task 4 focused UI/service/read-safety/query suite: **112 pass / 0 fail**.
- Exact operations plus query-budget suite: **70 pass / 0 fail**.
- TypeScript, targeted ESLint, operations worktree query guard, and `git diff --check`: GREEN.
- Candidate migration SHA-256: `b45e5a2d49ebe42780f08ced9d8a5094581c7f8cbef30538040607d5cde21940`, equal to the manifest and on-disk SQL.
- The repository-wide source run remains non-GREEN for unrelated notification fixture/golden drift already present in the shared branch. Migration-layout verification remains separately blocked by pre-existing Task 3 `20260814011752_management_page_reads.sql` lexical normalization. Task 4 focused verification is GREEN.

No DB runtime command was run in this fix round. The manifest remains `candidate`; migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, worker, webhook, and provider effects are all unclaimed.
