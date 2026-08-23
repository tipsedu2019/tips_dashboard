# Supabase PR Review Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic pull-request checks that catch wrong retry codes, final-function drift, and risky PostgreSQL migrations before merge.

**Architecture:** Reuse the repository's reviewed free-tier baseline runner instead of replaying the incomplete migration history into an empty database. A static job checks source and changed migrations; an isolated database job applies all manifest-pinned migrations after the baseline, lints the resulting schema, and runs focused pgTAP contracts.

**Tech Stack:** Node.js 22.18 in GitHub Actions, Supabase CLI 2.115.0, PostgreSQL 17, pgTAP, Squawk 2.63.0, GitHub Rulesets, Codex automatic PR review.

**Spec:** `docs/superpowers/specs/2026-08-23-supabase-review-gates-design.md`

## Global Constraints

- Do not refactor application or database business logic.
- Preserve `supabase/migrations/20260823074406_registration_workflow_stale_revision_nonretryable.sql` byte-for-byte because it is already applied in production.
- Preserve the existing `supabase-db-push.yml` behavior and its Supabase CLI `2.107.0` pin.
- The new PR workflow must receive no Supabase access token, project reference, or database password.
- Pin Supabase CLI `2.115.0` Linux amd64 archive SHA-256 to `ff099608ce758b625532ef03a61f4c9520b995e94ff6cd5480dc0428cad64cb3`.
- Pin Squawk `2.63.0` Linux x64 binary SHA-256 to `532d217c9c1ff167bbc5d32efd4184285ab1bd1a69882cf66608d2bc5ed81a28`.
- Automated tests and migrations must not send notifications or contact providers.

---

### Task 1: Isolated final-schema and SQLSTATE contracts

**Files:**
- Modify: `tests/isolated-supabase-db-tests.test.mjs`
- Modify: `scripts/run-isolated-supabase-db-tests.mjs`
- Modify: `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`
- Modify: `tests/ops-task-completion-actor.test.mjs`
- Create: `supabase/tests/active_registration_workflow_sqlstate_contract_test.sql`
- Preserve and commit: `supabase/migrations/20260823074406_registration_workflow_stale_revision_nonretryable.sql`
- Preserve and commit: `supabase/tests/registration_level_test_result_parent_reconciliation_test.sql`

**Interfaces:**
- Consumes: the active reviewed baseline capture and the top-level post-baseline migration manifest.
- Produces: runner flags `--review-head` and `--lint`, plus an isolated final-schema pgTAP file.

- [ ] **Step 1: Write failing runner tests.**

Add assertions that parsing `--review-head --lint` returns both booleans, that review-head mode reads `supabase/test-baselines/dashboard-free-tier-v1.manifest.json` while preserving baseline/catalog/parity from the active capture, and that execute mode calls:

```text
supabase db lint --local --workdir <isolated-root> --fail-on error
```

after migration application and before focused pgTAP. Pass an injected `supabasePath` and assert every Supabase child uses that exact executable.

- [ ] **Step 2: Run the focused Node test and verify RED.**

Run:

```bash
node --test tests/isolated-supabase-db-tests.test.mjs
```

Expected: FAIL because `reviewHead`, `lint`, and the injected CLI-path behavior do not exist.

- [ ] **Step 3: Implement the minimal runner extension.**

Extend argument parsing with `reviewHead: false` and `lint: false`. In `--review-head` mode, use the top-level manifest path while retaining the active capture's baseline, catalog, and parity paths. Resolve the CLI command from the injected `supabasePath`, then `TASK_SUPABASE_CLI`, then the existing local fallback. When `--lint` is set, execute:

```js
await invoke(["db", "lint", "--local", "--workdir", runtime.tempRoot, "--fail-on", "error"])
```

after `migration up` and before requested tests.

- [ ] **Step 4: Complete the exact post-baseline manifest.**

List every `supabase/migrations/*.sql` version not present in the active capture catalog's migration ledger, in ascending order. Record each file's SHA-256 and `status: "final"`. The final entry must be:

```json
{
  "fileName": "20260823074406_registration_workflow_stale_revision_nonretryable.sql",
  "status": "final",
  "sha256": "28a5af2540ed20475200e30d410e97b7fd4f7772e89a989f8a0ed64aee29532a"
}
```

Update the ops-task manifest test from `candidate` to `final` because that migration is already committed and deployed.

- [ ] **Step 5: Add the final active-function pgTAP contract.**

Create a transaction-scoped pgTAP test that resolves these exact signatures:

```sql
public.set_registration_workflow_status_v1(uuid,text,integer,text)
dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)
```

Assert both functions exist, the public wrapper delegates to the private implementation, the wrapper is security-invoker, the implementation is security-definer and owned by `postgres`, authenticated retains its expected execution grants, and neither final `pg_get_functiondef` manually raises SQLSTATE `40001`. Assert the private final definition contains `registration_workflow_status_refresh_required` with `23514`. Finish with `select * from finish(); rollback;`.

- [ ] **Step 6: Verify GREEN for Task 1.**

Run:

```bash
node --test tests/isolated-supabase-db-tests.test.mjs tests/ops-task-completion-actor.test.mjs tests/retryable-sqlstate-contract.test.mjs
node scripts/verify-domain-sqlstate-contract.mjs
```

Expected: zero failures and the line `domain SQLSTATE contract verified`.

- [ ] **Step 7: Commit Task 1.**

```bash
git add scripts/run-isolated-supabase-db-tests.mjs tests/isolated-supabase-db-tests.test.mjs tests/ops-task-completion-actor.test.mjs supabase/test-baselines/dashboard-free-tier-v1.manifest.json supabase/tests/active_registration_workflow_sqlstate_contract_test.sql supabase/tests/registration_level_test_result_parent_reconciliation_test.sql supabase/migrations/20260823074406_registration_workflow_stale_revision_nonretryable.sql
git commit -m "test: enforce active Supabase SQLSTATE contracts"
```

### Task 2: Pull-request workflow and Codex review rules

**Files:**
- Modify: `tests/supabase-migration-layout.test.mjs`
- Modify: `scripts/verify-supabase-migration-layout.mjs`
- Create: `.github/workflows/supabase-sql-review.yml`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 1 runner flags and both focused pgTAP files.
- Produces: required check job names `supabase-sql-review` and `supabase-schema-contract`.

- [ ] **Step 1: Write the failing workflow-boundary test.**

Add a fixture assertion that removing `.github/workflows/supabase-sql-review.yml` produces `required_sql_review_workflow_not_regular`, and that changing its bytes produces `required_sql_review_workflow_hash_mismatch`.

- [ ] **Step 2: Run the migration-layout test and verify RED.**

Run:

```bash
node --test tests/supabase-migration-layout.test.mjs
```

Expected: FAIL because the required workflow and verifier contract do not exist.

- [ ] **Step 3: Add the PR workflow.**

Trigger on `pull_request` types `opened`, `synchronize`, `reopened`, and `ready_for_review`, without path filters. Set `permissions: contents: read`. The static job must run the existing migration-layout, retry-code, and transactional-builder Node tests and both existing verifiers. Download Squawk `2.63.0`, verify its exact SHA-256, and execute it with `--pg-version 17` only when the merge-base diff contains added or modified `supabase/migrations/*.sql` files.

The schema job must download Supabase CLI `2.115.0`, verify its exact SHA-256, and run:

```bash
TASK_SUPABASE_CLI="${RUNNER_TEMP}/supabase-cli/supabase" node scripts/run-isolated-supabase-db-tests.mjs \
  --review-head --lint --require-final --execute --authorized \
  --request-id "github-pr-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" \
  --test supabase/tests/active_registration_workflow_sqlstate_contract_test.sql \
  --test supabase/tests/registration_level_test_result_parent_reconciliation_test.sql
```

- [ ] **Step 4: Pin the workflow in the existing fail-closed verifier.**

Add `.github/workflows/supabase-sql-review.yml` to the allowed exact workflow set, add the two dedicated missing/hash diagnostics, and set its SHA-256 only after the final workflow content is stable. Do not change the existing `supabase-db-push.yml` hash or commands.

- [ ] **Step 5: Add Codex review guidance.**

Add a short `Code Review Rules` section to `AGENTS.md` requiring reviewers to determine the final active PL/pgSQL definition across ordered migrations, reject business-state conflicts manually labeled `40001`, require exact SQLSTATE plus final-definition pgTAP evidence, and preserve authentication, RLS/ACL, locks, idempotency, and no-send boundaries.

- [ ] **Step 6: Verify GREEN for Task 2.**

Run:

```bash
node --test tests/supabase-migration-layout.test.mjs tests/retryable-sqlstate-contract.test.mjs tests/supabase-transactional-preflight-builder.test.mjs
node scripts/verify-supabase-migration-layout.mjs
node scripts/verify-domain-sqlstate-contract.mjs
actionlint .github/workflows/supabase-sql-review.yml .github/workflows/supabase-db-push.yml .github/workflows/free-tier-guardrails.yml
squawk --pg-version 17 supabase/migrations/20260823074406_registration_workflow_stale_revision_nonretryable.sql
```

Expected: all commands exit zero and Squawk reports no issue for the repair migration.

- [ ] **Step 7: Commit Task 2.**

```bash
git add .github/workflows/supabase-sql-review.yml AGENTS.md scripts/verify-supabase-migration-layout.mjs tests/supabase-migration-layout.test.mjs
git commit -m "ci: block unsafe Supabase SQL changes"
```

### Task 3: Whole-branch verification and GitHub enforcement handoff

**Files:**
- Verify all files changed by Tasks 1 and 2.
- External after PR checks exist: GitHub ruleset and Codex automatic review settings.

**Interfaces:**
- Consumes: the two commits and their test evidence.
- Produces: a reviewed feature branch ready for a pull request; after user selects PR integration, two required status checks on `main`.

- [ ] **Step 1: Run the full source test suite.**

Run all repository `tests/*.test.mjs` with Node's test runner, then run ESLint and the Next.js production build. Record pre-existing warnings separately from errors.

- [ ] **Step 2: Run local tool validations.**

Run actionlint, both repository verifiers, and Squawk against the changed migration. If Docker is unavailable, record isolated pgTAP as awaiting GitHub Actions rather than claiming it passed locally.

- [ ] **Step 3: Request a whole-branch code review.**

Review the complete diff from `origin/main` through the branch head for scope, security, test quality, workflow safety, and preservation of the production deployment workflow.

- [ ] **Step 4: Present the integration choices.**

Use the finishing-development-branch workflow. Push and create a pull request only after the user selects that option.

- [ ] **Step 5: After the PR jobs have both succeeded, configure GitHub enforcement.**

Create or update the `main` ruleset to require pull requests, strict/up-to-date `supabase-sql-review` and `supabase-schema-contract` checks, resolved review conversations, and no force pushes. Do not require an impossible self-approval when the repository has only one maintainer. Enable Codex automatic review if the repository is connected and the authenticated account has the required GitHub administration permission.

