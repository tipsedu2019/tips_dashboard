# Task 3 report — paged management lists and selected detail

## Migration lifecycle

- `draft`: Supabase CLI v2.103.0 created `supabase/migrations/20260814011752_management_page_reads.sql` via `migration new management_page_reads`; the manifest began with a null hash.
- `candidate`: adversarial-review source-complete SHA-256 `cf7b8c6ca321bcb0104315e8a8f949c961e0288907ccb99c0863e7adef476e12` is recorded and equals the on-disk migration.
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

## Adversarial fix round 1

- Preserved assigned class textbook IDs through the exact-detail adapter so ordinary saves cannot erase assignments.
- Removed the inaccessible private filter helper from all invoker RPC paths, inlined exact filter validation, and added an authenticated-role pgTAP invocation contract.
- Canonicalized student enrollment relations across registration rows, student forward arrays, and class reverse roster arrays; roster payloads now carry contacts and lifecycle payloads carry renderer-ready Korean labels.
- Completed bounded list projections for every visible scalar, corrected class roster counts, and removed `textbooks.lessons` JSONB inspection from list/stat/option paths.
- Debounced canonical search URL/RPC scope changes by 300 ms, persisted the effective class period into the URL, and refetched page one, stats, and options after create/update/delete/roster mutations.
- Exposed opaque relation continuation through the hook and wired selected-detail `다음 30건` append/deduplication for student/class rosters.
- Replaced legacy roster full-collection reads and whole-row upserts with exact-ID projections and roster-array-only updates/rollback.
- RED evidence: the new review suite first ran **0 pass / 11 fail**. Final review suite: **11/11 GREEN**. Final `tests/management-*.test.mjs`: **137/137 GREEN**. Combined focused management/query/textbook suite: **185/185 GREEN**. TypeScript, relevant ESLint (zero warnings), management query guard, migration hash, and diff check are GREEN.
- The authorized isolated gate was retried with request ID `96b7fd52-e799-49ba-ab68-6bfc669fe7a8`; it again stopped at `isolated_supabase_db_baseline_review_required`. No DB allocation, migration replay, pgTAP runtime, or EXPLAIN GREEN is claimed, and the manifest remains `candidate`.

## Adversarial fix round 2

- The first class page now resolves the server default period before any list, stats, or filter-option RPC. The resolved ID is the request scope for all three reads, the continuation scope, and the canonical URL; there is no initial null-period scan.
- Class detail calls the approved `list_active_science_subject_areas_v1()` boundary instead of selecting `academic_subject_areas` directly. The pgTAP source contract executes student, class, and textbook detail as an authenticated admin fixture, including the class science-reference branch.
- Assigned textbook IDs are independent from joined display rows. Existing IDs that have no current textbook row remain in `textbook_ids` during an ordinary save.
- The class textbook picker uses a dedicated 30+1 server search with server-applied visible taxonomy filters, Korean-numeric title ordering, UUID tie-break, query-and-filter-bound opaque continuation, eight-second abort, and retries disabled. Candidate pages append without duplicates, selection stays open for first and additional choices, and stale search/detail-close responses cannot replace the current picker state.
- Candidate list projections contain only picker scalars and never inspect `textbooks.lessons`; selected assigned rows remain a separate exact-detail payload.
- RED evidence: the new behavior suite first ran **8 pass / 2 fail** because default-period initialization and candidate search did not exist. Final progressive-loading suite is **10/10 GREEN**; full `tests/management*.test.mjs` is **139/139 GREEN**; combined management/query-budget/textbook-picker/schema verification is **205/205 GREEN**.
- TypeScript, relevant ESLint (zero warnings), management query-surface guard, migration hash equality, and diff check are GREEN. Candidate SHA-256 is `e5d5f408be3de36e11be6616bfcb66049e264247d959131d87651fe26de4aacf`.
- Per round-2 instruction, no isolated database command was run. Migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, and provider activity remain unexecuted and unclaimed; the migration remains `candidate`.

## Adversarial fix round 3

- Replaced every whole-row `to_jsonb(class)` and `to_jsonb(textbook)` in bounded management lists, stats, filter options, and class-textbook candidates with explicit scalar projections. Those read paths contain neither `classes.schedule_plan` nor `textbooks.lessons`; selected-detail branches remain outside this bounded-path contract.
- Preserved list/stat/filter/candidate filter parity while projecting only the names, taxonomy, status, price, roster ID, and display scalars each branch uses. Textbook active-class counts now inspect only `classes.textbook_ids`.
- The default-period result keeps one short-lived, one-shot canonical bundle. The URL normalization replay consumes that same result, so the equivalent list, stats, and filter-option RPCs remain one call each; later refreshes query normally.
- The class textbook picker now has one parent-controlled query value for its input, result request, and query/filter-bound continuation cursor. Subject/grade remounts cannot leave an empty local input attached to results from an older parent query.
- RED evidence: the focused round-3 contracts first ran **19 pass / 3 fail**. Final focused result is **22/22 GREEN**; full management is **140/140 GREEN**; combined management/query-budget/textbook-picker/schema verification is **206/206 GREEN**.
- TypeScript, relevant ESLint (zero warnings), management query-surface guard, migration hash equality, and diff check are GREEN. Candidate SHA-256 is `f3e3ff36b6d0ae0de232910f91fe07b7441eff86d3af4f5e4189358286265c81`.
- No database runtime command was run. Migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, and provider activity remain unexecuted and unclaimed; the migration remains `candidate`.

## Adversarial fix round 4

- Removed the remaining whole-row student and registration-enrollment conversions from bounded list, stats, filter-option, and class roster-count branches. Student display/filter scalars, enrollment `roster_active`, and student `class_ids` are now read directly; the bounded region has no whole-row `to_jsonb(student|enrollment|class|textbook)` and no heavyweight fields.
- Replaced the time-based general bundle cache with an opaque URL-canonicalization replay token. Only the exact effective filters produced by the corresponding no-period request can consume that token once. Explicit refresh discards an unused token and always executes list, stats, and options again, while truly concurrent identical no-period calls share one in-flight Promise.
- Candidate query, class subject/grade, and taxonomy filter changes immediately make the committed picker scope mismatch: old rows are hidden, continuation disappears, and loading is shown before the 250 ms request starts. Continuation reads only the committed class/query/filter snapshot and cannot use mutable in-progress scope.
- RED evidence: the focused round-4 contracts first ran **19 pass / 3 fail**. Final focused result is **22/22 GREEN**; full management is **140/140 GREEN**; combined management/query-budget/textbook-picker/schema verification is **206/206 GREEN**.
- TypeScript, relevant ESLint (zero warnings), management query-surface guard, migration hash equality, and diff check are GREEN. Candidate SHA-256 is `1508a71f54472893935e0921a656ec80d6fac5429cae5800b8ce2396dbd04fac`.
- No database runtime command was run. Migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, and provider activity remain unexecuted and unclaimed; the migration remains `candidate`.

## Adversarial fix round 5

- Removed whole-row conversions from the bounded 30+1 detail-relation RPC as well. Lifecycle, class roster, recent-issue, and textbook-assignment branches now read only the scalar or bounded JSON fields they use; the invariant covers the complete relation function and rejects whole-row `to_jsonb(student|enrollment|class|textbook)`, `schedule_plan`, and `lessons`.
- Added revision-aware initial-bundle coordination. An explicit refresh or mutation invalidates the matching passive in-flight no-period request, bypasses coalescing, and executes a fresh list/stats/options bundle. A late passive response cannot install a replay token, while passive concurrent identical initial calls still share one Promise.
- RED evidence: the focused round-5 contracts first ran **21 pass / 2 fail**. Final focused result is **23/23 GREEN**; full management is **141/141 GREEN**; combined management/query-budget/textbook-picker/schema verification is **207/207 GREEN**.
- TypeScript, relevant ESLint (zero warnings), management query-surface guard, migration hash equality, and diff check are GREEN. Candidate SHA-256 is `44dff0d605127f5cd4efcd954f9bb324e846b60dc5d956755e6aa63b67f1dcc5`.
- No database runtime command was run. Migration replay, pgTAP runtime, EXPLAIN, production migration, deployment, and provider activity remain unexecuted and unclaimed; the migration remains `candidate`.
