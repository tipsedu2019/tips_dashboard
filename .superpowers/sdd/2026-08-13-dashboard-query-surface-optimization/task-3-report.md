# Task 3 report — paged management lists and selected detail

## Migration lifecycle

- `draft`: Supabase CLI v2.103.0 created `supabase/migrations/20260814011752_management_page_reads.sql` via `migration new management_page_reads`; the manifest began with a null hash.
- `candidate`: source-complete SHA-256 `a0609d3e4299a347fe25067bfd5674a7b38b49b192b9936fd1ecb437b41d12a1` is recorded and equals the on-disk migration.
- `final`: not promoted. The isolated harness stopped before database allocation with `isolated_supabase_db_baseline_review_required`; pgTAP and EXPLAIN runtime GREEN are not claimed.

## RED evidence

The first focused source run failed because `createManagementReadService` did not exist. Later regression RED runs fixed two additional boundaries before implementation: the bounded list was still locally filtering configured periods, and relation pagination returned a reusable raw cursor object instead of a kind/entity/relation-bound opaque cursor.

## Implementation

- Added authenticated-only, `security invoker`, fixed-search-path list, aggregate, faceted-option, exact-detail, and relation-page RPCs for students, classes, and textbooks.
- List reads validate exact per-kind filter objects, cap at 30, fetch 31 rows, use Korean numeric normalized name/title ordering with UUID tie-breaks, and contain no offset or list-time detail/catalog/history fan-out.
- Stats and faceted filter options use the same full server-filtered collection. Each option branch excludes only its own field and is capped at 500; class periods include server labels/aliases/default state.
- Selected details return only the requested kind's editable record and bounded first relation pages. Class schedule, assigned textbooks/groups, and form references are selection-driven; textbook progress is aggregated only for the selected textbook.
- Relation allowlists are exact. The client base64url-encodes `{v,kind,entityId,relationKind,sortValue,id}`, rejects malformed or cross-scope reuse before the DB call, and converts DB continuation boundaries into opaque cursors.
- Every read RPC uses an eight-second abort signal and disables retries. Relation picker queries use explicit projections and a hard 30-row limit.
- The active management hook replaces page one on canonical filter changes, appends/deduplicates continuation pages, reads exact off-page deep links, and refreshes only the selected row after mutations. It performs no pre-selection enrichment reads.
- All three list UIs preserve search/filter labels and actions, synchronize canonical filters through the URL, use server filter options and authoritative stats, avoid browser re-filtering of bounded rows, and expose next-30/loading/end states.
- Extended the management query-surface guard with only the three scalar read RPCs needed by this surface.

## Source GREEN evidence

Exact focused command:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/management-progressive-loading.test.mjs \
  tests/management-students-toolbar.test.mjs \
  tests/management-class-student-roster.test.mjs \
  tests/management-student-detail-selects.test.mjs \
  tests/management-student-lifecycle-history.test.mjs \
  tests/management-service-schema-fallback.test.mjs \
  tests/management-period-filter.test.mjs
```

Result: **118 pass, 0 fail**.

Additional verification:

- Full `tests/management*.test.mjs` regression: **126 pass, 0 fail**.
- TypeScript `tsc --noEmit`: exit 0.
- Management query-surface guard: exit 0.
- ESLint on all changed source/test JavaScript and TypeScript files: exit 0, no warnings.
- Supabase CLI `db lint --local`: `No schema errors found`; this checks the existing local schema and is not candidate migration replay evidence.
- `git diff --check`: exit 0.
- Candidate manifest SHA-256 equals the on-disk migration SHA-256.

## DB runtime gate — blocked, not passed

The authorized isolated command was attempted after the final candidate hash update:

```bash
"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs \
  --execute --authorized \
  --request-id task3-management-page-reads-20260814-r3 \
  --test supabase/tests/management_page_reads_test.sql
```

It stopped before allocation with `isolated_supabase_db_baseline_review_required`. No migration replay, pgTAP runtime, EXPLAIN, production query, migration application, deployment, or provider activity occurred. The manifest therefore remains `candidate`.

## Boundary

Source implementation and source verification are complete. Runtime SQL behavior is specified in `supabase/tests/management_page_reads_test.sql` but remains empirically unverified until the reviewed isolated baseline gate opens. The pre-existing untracked `pnpm-workspace.yaml` was preserved and excluded from staging.
