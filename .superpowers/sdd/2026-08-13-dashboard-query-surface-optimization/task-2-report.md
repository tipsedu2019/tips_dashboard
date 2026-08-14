# Task 2 report — paged task lists and exact selected detail

## Migration lifecycle

- `draft`: `supabase/migrations/20260813234824_ops_task_page_reads.sql` was created with Supabase CLI v2.103.0 via `migration new ops_task_page_reads`; the manifest entry initially had `sha256: null`.
- `candidate`: SHA-256 `937bc111d6c8799845faab09b0f22211e3c9013c92b29ac9543360682ba72257` was recorded after the SQL and pgTAP source were complete and before the isolated DB attempt. The on-disk migration hash still matches it exactly.
- `final`: not promoted. The isolated harness stopped before database allocation with `isolated_supabase_db_baseline_review_required`, so this task does not claim pgTAP or EXPLAIN runtime GREEN.

## RED evidence

The first focused source run failed in the intended two places before implementation:

- the service had no bounded 30+1 page/stats RPC contract and still loaded list child relations;
- the workspace had no page-one replace / ID-deduplicated append / exact deep-link detail boundary.

Result: 416 pass, 2 fail. The production code was then changed to satisfy those tests; tests were not weakened to preserve the old fan-out behavior.

## Implementation

- Added authenticated-only, `security invoker`, empty-search-path `list_ops_task_page_v1` and `get_ops_task_list_stats_v1` RPCs. They validate exact subtype filter schemas, reject `action`, `select`, unknown, missing, and cross-subtype keys, validate cursor arity/types, cap requests at 30, use deterministic keyset tuples ending in `id asc`, and return explicit compact columns.
- The task page reads only the selected subtype's one-to-one detail relation. Registration track/observation summaries are embedded in its compact row; comments, attachments, events, and unrelated subtype details are not part of list reads.
- Added three bounded, query-driven task indexes; no offset pagination, dynamic sort SQL, service-role access, or `security definer` was introduced.
- Split the client service into page and exact-detail boundaries. Page and stats RPCs share canonical filters, use an eight-second abort signal with retry disabled, trim 31 rows to 30, and bind the next cursor to the filter/sort scope. Registration runtime is probed once per page response.
- `loadOpsTaskById()` reads one exact task ID, selected subtype detail by exact `task_id`, bounded child rows by exact `task_id`, and only the required profile IDs.
- The workspace preserves the existing subtype filters and header-sort contracts, replaces on filter changes, appends with ID deduplication on `loadMore()`, exposes `다음 30건`/loading/end states, avoids client re-filtering/re-sorting of server pages, and resolves an off-page deep link with the exact detail loader.
- Extended the task query-surface guard with the exact scalar stats RPC allowance and a regression proving that allowance does not broaden arbitrary RPCs.

## Source GREEN evidence

Exact focused command:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/ops-task-service-loading.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/query-surface-budget.test.mjs
```

Result: **418 pass, 0 fail**.

Additional verification:

- `"$TASK_NODE" node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `"$TASK_NODE" scripts/verify-query-surface-budget.mjs --surface tasks --base HEAD --worktree`: exit 0.
- Supabase CLI `db lint --local`: `No schema errors found`; this checks the existing local schema and is not evidence that the candidate migration was replayed.
- `git diff --check`: exit 0.
- candidate manifest SHA-256 equals the on-disk migration SHA-256.

## DB runtime gate — blocked, not passed

The approved isolated command shape was attempted:

```bash
"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs \
  --execute --authorized \
  --request-id task2-ops-task-page-reads-current \
  --test supabase/tests/ops_task_page_reads_test.sql
```

It stopped before database allocation with `isolated_supabase_db_baseline_review_required`. Consequently no migration replay, pgTAP runtime, query plan, EXPLAIN, production read/write, or migration application occurred. The manifest correctly remains `candidate` until an approved reviewed baseline permits isolated DB execution.

## Boundary and remaining gate

Source implementation and focused source verification are complete. Runtime SQL behavior remains specified by `supabase/tests/ops_task_page_reads_test.sql` but is not empirically passed. Release, production migration, deployment, provider execution, and production browser verification are outside this task and were not performed. The pre-existing untracked `pnpm-workspace.yaml` was preserved and excluded from staging.

## Adversarial review fix round 1

### RED evidence

Five reviewer regressions were encoded before the fix: lazy non-registration option catalogs, subject-track registration membership/order, authoritative sibling stats/facets, filter-aware mutation reconciliation, and canonical off-page registration detail. The first exact service/workspace run finished **135 pass, 6 fail**.

### Fixes

- Non-registration editor and filter entry points now call `loadOpsTaskWorkspaceOptionData()` lazily; page-one load still performs no option-catalog fan-out.
- Registration page membership, consultation owner filtering, normalized search, embedded representative track, and consultation ordering now derive from the matching subject-track summary's `workflow_status`, `director_profile_id`, and phone-waiting timestamps. The lateral representative is bounded to one track, preventing duplicate parent rows.
- The stats RPC now returns server-authoritative `byView`, `metrics`, and bounded `facets` objects. Paged tab counts, operational badges, owner counts, and list filter catalogs consume these aggregates rather than the selected 30 rows.
- Mutations that can change membership or order reconcile by reloading page one with the active canonical SQL filters. Load-more responses are generation-guarded so a stale cursor response cannot append after reconciliation.
- A task-only off-page registration deep link uses the exact task read only for identification, then opens `loadOpsRegistrationCaseDetail` through the canonical case host.

### Verification

- Exact five-suite focused run: **424 pass, 0 fail**.
- Exact service/workspace run: **141 pass, 0 fail**.
- TypeScript `tsc --noEmit`: exit 0.
- Task query-surface guard: exit 0.
- `git diff --check`: exit 0.
- Updated migration candidate SHA-256: `f4efe37189ad885a10d54dc4a979db6f92c62545f6969ab4d98be2b637b54a87`.
- pgTAP source now asserts authoritative aggregate object shapes and the 100-option facet cap. The reviewed-baseline gate remains unchanged, so runtime pgTAP/EXPLAIN is still not claimed and the manifest remains `candidate`.
