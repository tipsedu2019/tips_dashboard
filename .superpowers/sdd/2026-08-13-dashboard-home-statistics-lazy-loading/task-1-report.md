# Task 1 report — dashboard home statistics lazy loading

## Commit

- `35e55600ac08dd6a7681d330c508ba75d2e4ac6f` — `refactor: isolate dashboard statistic slices`

## Files changed

- `src/features/dashboard/metrics.js`
- `tests/dashboard-metrics.test.mjs`
- `scripts/capture-dashboard-free-tier-catalog.mjs`
- `scripts/run-isolated-supabase-db-tests.mjs`
- `scripts/fixtures/dashboard-free-tier-baseline-scope.json`
- `scripts/fixtures/supabase-management-read-only-query-contract.json`
- `supabase/test-baselines/dashboard-free-tier-v1.sql`
- `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`
- `supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json`
- `supabase/tests/dashboard_free_tier_catalog_parity_test.sql`
- `supabase/tests/dashboard_free_tier_baseline_smoke_test.sql`
- `tests/isolated-supabase-db-tests.test.mjs`

## RED evidence

1. `TASK_NODE ... --test --experimental-strip-types tests/dashboard-metrics.test.mjs`
   - Before `buildDashboardMetricsSlice` existed: 20 pass, 1 fail.
   - Expected failure: `TypeError: dashboardMetricsModule.buildDashboardMetricsSlice is not a function`.
2. `TASK_NODE ... --test --experimental-strip-types tests/isolated-supabase-db-tests.test.mjs`
   - Before source tooling existed: 0 pass, 5 fail.
   - Expected failures: missing `scripts/capture-dashboard-free-tier-catalog.mjs` and `scripts/run-isolated-supabase-db-tests.mjs`.
3. After the first tooling implementation, the artifact-hash test failed as expected because `validateBaselineArtifactHashes` did not exist; the argv-secret test then failed as expected with `dashboard_free_tier_catalog_arguments_invalid` before the explicit argv secret rejection was implemented.

## GREEN evidence

- `TASK_NODE ... --test --experimental-strip-types tests/dashboard-metrics.test.mjs tests/isolated-supabase-db-tests.test.mjs tests/continuous-class-schedule-consumer-parity.test.mjs`
  - 32 pass, 0 fail.
- Focused task command plus harness contract:

  ```bash
  TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
  "$TASK_NODE" --test --experimental-strip-types \
    tests/dashboard-snapshot-cache.test.mjs \
    tests/dashboard-resource-pressure.test.mjs \
    tests/dashboard-metrics.test.mjs \
    tests/admin-shell.test.mjs \
    tests/continuous-class-schedule-consumer-parity.test.mjs \
    tests/ops-browser-dashboard-word-retest-contract.test.mjs \
    tests/isolated-supabase-db-tests.test.mjs
  ```

  Result: 78 pass, 0 fail.
- `git diff --check`: exit 0 before commit.
- Direct ESLint execution with the fixed Node runtime: exit 0 for all modified JS/test files.
- `TASK_NODE scripts/run-isolated-supabase-db-tests.mjs --test supabase/tests/dashboard_free_tier_baseline_smoke_test.sql`
  - Returned a plan only; it did not create/start a local DB.

## Implementation and self-review

- Added the pure `buildDashboardMetricsSlice` parity oracle. It preserves legacy overview summary semantics, projects students/classes aggregates without roster/class-summary payloads, retains academy-wide teacher/classroom/exam conflict grouping, and fixes textbook aggregate denominators with literal period fixtures.
- Added a fail-closed Management API capture entrypoint with the pinned documented Beta request shape, credential/project-ref argv refusal, status classification, no write endpoint fallback, and no artifact output prior to human review.
- Added a manifest/hash checked harness entrypoint that defaults to plan mode and refuses draft/null/hash-invalid migrations. The runtime branch refuses to start without a reviewed baseline catalog.
- Source-controlled baseline artifacts intentionally record `captureStatus: "blocked"`; they are not presented as a production catalog or as pgTAP evidence.
- Reviewed staged diff with `git diff --cached --check`; no unrelated checkout changes were staged. Existing untracked `pnpm-workspace.yaml` remains untouched.

## Concerns / blocked runtime lane

- `SUPABASE_DATABASE_READ_TOKEN`, `SUPABASE_PROJECT_REF`, and `TASK_ORIGIN_MAIN_SHA` were not available in the execution shell. The capture command therefore stopped at `dashboard_free_tier_catalog_credentials_missing` before HTTP. No production read, provider call, migration, local Supabase start, or pgTAP run occurred.
- The approved source baseline cannot be generated or reviewed until a project-scoped `database_read` fine-grained token and explicit authorized invocation are supplied. Until then, the isolated DB execution lane is intentionally blocked and the placeholder SQL tests must not be reported as pgTAP PASS.
- `pnpm exec eslint ...` attempted its workspace dependency-status install and was stopped by ignored-build policy (`sharp`, `unrs-resolver`). Direct invocation of the already-installed ESLint CLI passed; no dependency files were intentionally changed.

---

## Review fix round 1

### Changes

- Reworked `capture-dashboard-free-tier-catalog.mjs` so a validated reviewed read-only response produces three normalized source-controlled artifacts atomically: catalog JSON (definition hashes only), baseline SQL, and source-backed pgTAP parity SQL. Response failures, redirects, 405, malformed JSON, scope drift, credential failures, or origin drift occur before any rename.
- The captured statement now avoids `pg_catalog.digest`; pgcrypto schema resolution is intentionally deferred to the reviewed baseline DDL / generated definitions, following the extension-schema-safe pattern in `20260728233510_continuous_class_schedule_release2_mutations.sql`. The producer computes artifact SHA-256 in Node from canonical JSON instead of assuming an extension placement.
- Implemented the reviewed-baseline local harness: exact `/private/tmp/tips-supabase-db-qa-$TASK_REQUEST_ID` workdir, generated project ID and unique local ports, sanitized config, baseline prerequisite tests, manifest-ordered candidate/final migration hash verification, target pgTAP then probe gating, parsed loopback-only `DB_URL`, nonce-only probe environment, and one `supabase stop ... --no-backup --yes` attempt in `finally`.
- Candidate and final migration entries are accepted only with a literal SHA-256 and matching on-disk bytes; draft/null and drift are rejected before `supabase init`.
- Added `public.progress_logs` to the literal baseline scope and replaced `plan(0)` baseline placeholders with source-controlled schema/relation smoke checks.

### RED / GREEN evidence

- RED: expanded `tests/isolated-supabase-db-tests.test.mjs` initially failed because capture still rejected reviewed output and the runner lacked execution behavior.
- GREEN:

  ```bash
  TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
  "$TASK_NODE" --test --experimental-strip-types \
    tests/dashboard-snapshot-cache.test.mjs \
    tests/dashboard-resource-pressure.test.mjs \
    tests/dashboard-metrics.test.mjs \
    tests/admin-shell.test.mjs \
    tests/continuous-class-schedule-consumer-parity.test.mjs \
    tests/ops-browser-dashboard-word-retest-contract.test.mjs \
    tests/isolated-supabase-db-tests.test.mjs
  ```

  Result: 81 pass, 0 fail.

- Direct ESLint invocation for all changed JS/test files: exit 0.
- `git diff --check`: exit 0.

### Runtime boundary

- No production token/project ref was present, so no live capture or local Supabase/Docker execution was performed. The execute sequence is covered through a controlled executor and remains fail-closed until `captureStatus: "reviewed"` with matching manifest hashes exists.

---

## Re-review fix round 2

### Changes

- The runner now validates and stages every requested `--test` SQL file into the isolated worktree after prerequisite setup and before the target `supabase test db` call. Missing source paths fail with `isolated_supabase_db_target_missing` before target pgTAP.
- `supabase init` now runs before a temporary sanitized config is atomically renamed over the generated config; no repository config is copied.
- Scope completeness now requires literal relation/type/function/schema/role/trigger identities and every required object kind. The reviewed capture rejects incomplete catalogs before publication.
- Capture publication now writes an immutable staged capture set (`catalog.json`, `baseline.sql`, `parity.sql`, `manifest.json`) and atomically updates a single active-pointer file only after the set succeeds. The harness resolves and hash-validates the active set when present.
- Generated parity no longer uses unconditional `pass`; it emits normalized object identity/hash assertions for all generated catalog rows.

### RED / GREEN evidence

- RED: added staging and publication tests. Before implementation, target pgTAP reached a missing temp SQL path, and an incomplete table-only catalog was accepted.
- GREEN focused command:

  ```bash
  TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
  "$TASK_NODE" --test --experimental-strip-types tests/isolated-supabase-db-tests.test.mjs
  ```

  Result: 12 pass, 0 fail.

- Full focused regression (dashboard cache/resource/metrics/admin/session/browser contracts plus isolated harness): 83 pass, 0 fail.
- ESLint of changed tooling/tests and `git diff --check`: exit 0.

### Runtime boundary

- No production token, project ref, provider, migration, or local Supabase instance was used. The active reviewed capture pointer is intentionally absent in this worktree, so runtime execution remains fail-closed.

---

## Re-review fix round 3

### Changes

- Replaced the table-only producer query with one fixed `begin read only` snapshot statement. It reads the migration ledger plus literal-scoped roles, schemas, enum/type metadata, sequence, tables and columns, defaults, constraints, indexes, functions, RLS, policies, relation/default ACLs, and trigger definition/function/order. The result publishes only normalized identity plus `definitionSha256`; it contains no row data, raw DDL, token, or secret values.
- Added `public.progress_logs` to the in-statement literal relation allowlist and added the explicit sequence allowlist to the source scope. Function fingerprints now include signature, body hash, owner, security-definer setting, search-path, and ACL. The producer uses the existing extension-schema-safe `dashboard_private.continuous_class_schedule_hash_v1` helper rather than assuming `pg_catalog.digest`.
- Replaced generated self-comparison parity SQL with pgTAP checks that query PostgreSQL catalogs and `pg_get_functiondef`, `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_triggerdef`, policy, ACL, RLS, role, type, table, sequence, and default-ACL metadata before comparing the captured expected SHA-256.
- The documented output flags are now strict: only the three approved canonical paths are accepted. Artifact publication continues to stage an immutable four-file version then atomically changes one active-pointer file; an injected failure after the stage directory is renamed leaves the prior active pointer unchanged.
- Expanded source contract tests for all catalog kinds, default ACL access, real catalog parity expressions, canonical output rejection, and the post-rename failure boundary.

### RED / GREEN evidence

- RED (before updating the older placeholder assertions):

  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
    --test --experimental-strip-types tests/isolated-supabase-db-tests.test.mjs
  ```

  Result: 12 pass, 2 fail. The failures were the former `normalized identity` placeholder-parity expectation and an obsolete `objectKind.*trigger` assertion; both correctly exposed that the new parity and no-raw-output contract had not yet been asserted.

- GREEN harness contract:

  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
    --test --experimental-strip-types tests/isolated-supabase-db-tests.test.mjs
  ```

  Result: 15 pass, 0 fail.

- Focused dashboard regression:

  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
    --test --experimental-strip-types \
    tests/dashboard-snapshot-cache.test.mjs \
    tests/dashboard-resource-pressure.test.mjs \
    tests/dashboard-metrics.test.mjs \
    tests/admin-shell.test.mjs \
    tests/continuous-class-schedule-consumer-parity.test.mjs \
    tests/ops-browser-dashboard-word-retest-contract.test.mjs
  ```

  Result: 71 pass, 0 fail.

- Changed-file validation: `git diff --check` and Node syntax checks for both tooling scripts exited 0.

### Self-review / concerns

- Reviewed the immutable-stage then pointer-update ordering: the post-rename injection test proves the previous active set remains selected even when the newly staged version is left orphaned for recovery/inspection.
- No production token or project ref was supplied. No HTTP capture, production DB migration, provider interaction, local Supabase start, or pgTAP execution occurred. Therefore the reviewed capture/baseline/parity runtime lane is still blocked and this report does not claim a production pgTAP pass.
- The shell has no global `node`; `pnpm exec` is unusable here because its dependency-status install is rejected by the ignored-build policy. All evidence above uses the supplied bundled Node runtime directly.

---

## Re-review fix round 4

### Changes

- Made the fixed capture statement valid PostgreSQL 17 SQL by moving the scoped catalog aggregate into its own one-row CTE before combining it with the one-row migration ledger. The same local PostgreSQL execution also exposed and fixed invalid schema qualification of `coalesce` plus the `pg_default_acl.defaclobjtype` text concatenation cast.
- Added one function-identity normalizer shared by scope validation, captured identities, completeness checks, the fixed catalog query, and generated parity lookups. `date, date` and `date,date` now resolve to the same canonical identity while different argument types remain out of scope.
- Canonical `--catalog`, `--baseline`, and `--parity-test` values now publish the generated bytes at those exact paths and are recorded in the active pointer. All three noncanonical flag variants are rejected before HTTP, and a later output failure restores already-replaced canonical files while leaving the prior pointer selected.
- Retained real PostgreSQL catalog expressions in generated parity and added behavior verification: the generated role fingerprint test reports `ok` for the captured hash and `not ok` after representative hash drift.

### RED / GREEN evidence

- RED: canonical capture paths remained on the blocked placeholders; the function normalizer was absent; and PostgreSQL 17 rejected the fixed statement. A publication-failure fixture also proved an earlier canonical file remained replaced before rollback was added.
- The PostgreSQL 17 test initially reported the reviewed aggregate error, then additionally caught `pg_catalog.coalesce(...)` and ambiguous `text || "char"` errors. It now executes the full read-only statement and parses exactly one JSON object containing the canonical `get_dashboard_conflict_sources_v1(date,date)` identity.
- GREEN focused regression, using the bundled Node runtime:

  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
    --test --experimental-strip-types \
    tests/dashboard-snapshot-cache.test.mjs \
    tests/dashboard-resource-pressure.test.mjs \
    tests/dashboard-metrics.test.mjs \
    tests/admin-shell.test.mjs \
    tests/continuous-class-schedule-consumer-parity.test.mjs \
    tests/ops-browser-dashboard-word-retest-contract.test.mjs \
    tests/isolated-supabase-db-tests.test.mjs
  ```

  Result: 89 pass, 0 fail.

- Direct ESLint, Node syntax checks, and `git diff --check` exited 0.

### Runtime boundary

- The syntax and parity behavior tests used only disposable local containers from the already-present `public.ecr.aws/supabase/postgres:17.6.1.156` image. No image pull, production token, production/project database request, migration, deploy, or provider action occurred.
- The reviewed production capture remains intentionally blocked until separately authorized credentials and execution are supplied; this round does not claim production catalog or production pgTAP evidence.

---

## Re-review fix round 5 (final permitted round)

### Changes

- Corrected the migration-ledger reader to the real `supabase_migrations.schema_migrations(version, statements text[], name)` shape. The one read-only snapshot returns the statement arrays only to the in-memory producer; Node NFC-normalizes and SHA-256 hashes the canonical array, and neither statement text nor the array is published in the catalog artifact.
- Removed every private helper invocation from the Management API statement. Catalog fingerprints now come only from built-in `pg_catalog` relations/functions and are SHA-256 hashed by Node. A PostgreSQL 17 test runs the full statement as a restricted `catalog_reader` role after explicitly revoking `EXECUTE` on the old `dashboard_private` hash helper.
- Defined a strict function-signature grammar that splits top-level arguments, handles typemods, arrays, qualified identifiers, multi-word built-in types and argument modes, strips argument names, and normalizes whitespace. PostgreSQL 17 confirms that actual `pg_get_function_identity_arguments` output `p_date_from date, p_date_to date` maps to the literal scope identity `date,date`; wrong types remain rejected. The fixed catalog query independently derives canonical types from `proargtypes`, so argument names cannot affect selection.
- Trigger capture now expands each trigger event and calculates its ordinal across the complete table + timing + event group in PostgreSQL's name order before selecting a catalog identity. Generated parity repeats the same full-group ranking before filtering. A two-trigger `BEFORE UPDATE` PostgreSQL 17 test verifies capture identities and both pgTAP checks.
- The immutable four-file capture directory plus `dashboard-free-tier-v1.active.json` is now the sole runner authority. The runner fails closed when the versioned pointer is absent, malformed, or not canonical; it never falls back to the three canonical files. Canonical catalog/baseline/parity files remain requested-path copies for review compatibility, not a transactionally atomic set. Their sequential replacement is rollback-protected, and replacement plus rollback failures are surfaced together as an `AggregateError` instead of swallowing recovery errors. Only the single pointer rename activates a completed immutable set.

### RED / GREEN evidence

- RED: the new real-shape PostgreSQL test failed on nonexistent `migration_row.statements_sha256`; restricted-role/source assertions found the private helper; named arguments failed scope normalization; and the new rollback-injection/active-pointer contracts were absent.
- GREEN focused regression, using the bundled Node runtime:

  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
    --test --experimental-strip-types \
    tests/dashboard-snapshot-cache.test.mjs \
    tests/dashboard-resource-pressure.test.mjs \
    tests/dashboard-metrics.test.mjs \
    tests/admin-shell.test.mjs \
    tests/continuous-class-schedule-consumer-parity.test.mjs \
    tests/ops-browser-dashboard-word-retest-contract.test.mjs \
    tests/isolated-supabase-db-tests.test.mjs
  ```

  Result: 92 pass, 0 fail.

- Direct ESLint of the two tooling scripts and contract test, Node syntax checks, and `git diff --check` exited 0.

### Publication and runtime boundary

- Earlier report wording that described the three canonical files as being published “atomically” is superseded by this round. POSIX does not provide one atomic transaction across three independent file replacements. Safety comes from the immutable capture directory and exactly one active-pointer rename; canonical copies are non-authoritative and every failed replacement/recovery is reported.
- No production token, project ref, HTTP request, migration, deployment, provider interaction, or existing local Supabase instance was used. Only disposable containers from the already-present PostgreSQL 17 image were used. Because no reviewed production capture was authorized or created, the DB runtime lane remains **BLOCKED** and this report does not claim production catalog or production pgTAP evidence.
