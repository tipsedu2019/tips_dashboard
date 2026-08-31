# Baseline Policy Fidelity Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore faithful restrictive-policy reproduction without changing operational permissions or historical artifacts.

**Architecture:** Fix the producer's missing policy mode and add a narrowly approved MCP policy export/offline repair path. Publish a derived capture that changes only the seven proven policy modes, then verify it in isolated Docker before resuming makeup work.

**Tech Stack:** Node native ESM/test, PostgreSQL17/pgTAP, existing Supabase CLI2.115 runner and MCP connection.

**Spec:** `docs/superpowers/specs/2026-08-31-baseline-policy-fidelity-repair-design.md`.

## Global Constraints

- No production DDL, business-row reads, deployment, provider activity or sends.
- Retain all old capture directories and the original baseline bytes as the prefix of the repaired baseline.
- Keep the migration ledger, originMainSha, every non-target catalog entry, policy predicate/roles/command, all finalized migration bytes and ordered entries unchanged.
- The existing token-based capture path and its guards remain unchanged; the newly authorized MCP path is explicit, catalog-only and read-only.
- New policy catalog entries use `policyFingerprintVersion:2`; historical entries without the version use exact legacy fingerprint SQL. Invalid explicit versions fail closed.
- Do not change the runner's final/hash/manifest/security gates to admit the unrelated makeup draft.
- Keep live `.next`, unrelated Docker DB and in-progress makeup files untouched. One implementer; independent review after each task. No implementation-owned subagents.

## Task 1: Fix policy mode propagation and implement guarded derived capture

**Files:** Modify `scripts/capture-dashboard-free-tier-catalog.mjs` and affected producer cases in `tests/isolated-supabase-db-tests.test.mjs`; create `scripts/repair-dashboard-free-tier-policy-modes.mjs` and `tests/dashboard-policy-mode-capture.test.mjs`.

**Interfaces:** Export `dashboardFreeTierPolicyModeStatement()` from the new module (fixed seven-policy read-only query specified in the design). Export `repairDashboardFreeTierPolicyModes({root,authorized,requestId,expectedCaptureId,envelope,publish})`; explicit `authorized:true` and validated request ID are mandatory. Root calls this with a freshly observed MCP envelope, not a fabricated HTTP response. Expose/reuse the existing capture-set staging/publisher helper as `publishDashboardFreeTierCaptureSet` instead of duplicating publication. The normal capture path continues using its current API/credential contracts.

- [ ] Write actual RED tests for both policy modes, missing/nonboolean mode, normalization preserving false, different mode fingerprints and historical parity compatibility. Example: `buildFinalSchemaReconciliation([{objectKind:'policy',schema:'public',identity:'makeup_requests.test_deny',replayFingerprint:JSON.stringify({command:'*',roles:['authenticated'],using:'false',check:'false',permissive:false})}])` must emit `as restrictive`; switching false to true must emit permissive and change v2 parity hash input. Run with `node --test tests/dashboard-policy-mode-capture.test.mjs` and preserve genuine failing output.
- [ ] Implement four-stage mode propagation (fixed SELECT, semantic role normalization, reconciliation, fingerprint SQL) and explicit v2 catalog marker in normal new capture artifacts. Historical marker absence selects legacy SQL, not assumed permission mode. Require boolean mode on new replay fingerprints; update synthetic fixtures to model the actual producer response.
- [ ] Implement the exact seven-policy query and offline repair validator from the design. Literal identities are the seven listed in the spec. Strictly compare each mode-free normalized fingerprint hash to immutable source entries before using its SQL predicates. The only baseline change is an appended generated reconciliation of those policies. Keep all existing catalog entries unchanged except target hash/version; add `policyModeRepair` provenance. Source manifest must be all-final, and new manifest only updates baseline/catalog hashes.
- [ ] Add failure-atomic behavior tests using actual temporary files: unapproved/malformed envelope, wrong source/statement hash, duplicate/missing/extra target, boolean mode not false, predicate/role/command drift, existing artifact tamper, unfinalized manifest, and injected publish failure. Assert old files/pointer bytes unchanged and no new successful capture; do not assert mocks merely exist. A success fixture must preserve source-prefix bytes, old capture files and migration entries, publish a new content-addressed set, and give seven mode-sensitive expectations with no unrelated drift.
- [ ] Run new tests and affected `tests/isolated-supabase-db-tests.test.mjs` once after focused iterations; lint owned JS/test files and diff-check. Self-review and commit only owned code/tests. No actual capture publication or Docker run in this task; root fetches approved metadata and Task2 owns runtime proof. Write full report with RED/GREEN logs and concerns.

## Task 2: Publish and prove the derived baseline in isolated Docker

**Files:** Generate a new directory under `supabase/test-baselines/dashboard-free-tier-v1-captures/`, update canonical baseline/catalog/parity and active pointer; update only baseline/catalog metadata in top-level manifest. Create `supabase/tests/dashboard_policy_mode_fidelity_test.sql`; update `docs/qa/2026-08-31-numbered-pagination.md` and this plan. Do not edit any historical capture or migration. Root manages partial manifest staging to preserve the uncommitted makeup draft.

**Interfaces:** Consume Task1's fixed-query export and `repairDashboardFreeTierPolicyModes` plus root's actual read-only MCP envelope. Use the unchanged isolated runner against a clean never-served committed-file copy, with its33 finalized entries. Runtime node/CLI paths and protected hashes are supplied in the handoff, not inferred from PATH.

- [ ] Root invokes the exported exact query via the existing approved Supabase MCP connection; verify `transactionReadOnly:true`, server17, seven targets, false modes and matching old fingerprints. Persist only schema metadata plus exact statement/hash envelope in a task-local scratch file; no credentials or operational records.
- [ ] Build a clean never-served temporary copy of committed HEAD. Invoke the reviewed repair there with explicit authorization/request ID/source capture. Inspect generated differences: old baseline prefix unchanged; exactly seven appended CREATE POLICY AS RESTRICTIVE; seven target catalog hashes/version markers; provenance; mode-aware seven parity expectations; identical old captures, ledger, origin and all33 finalized entries. Do not resnapshot unrelated worksheet drift.
- [ ] Add pgTAP coverage using a synthetic local-only policy fixture plus catalog assertions and valid makeup role fixtures. For the generic fixture, a permissive `using(true)` and restrictive `using(false)` must yield0 rows under authenticated, then rollback. Verify seven actual policy modes and expected predicates/roles; actual involved/unrelated/assistant reads on makeup retain intended results. Run `node scripts/run-isolated-supabase-db-tests.mjs --review-head --execute --authorized --request-id policy-mode-repair-proof --require-final --test supabase/tests/dashboard_policy_mode_fidelity_test.sql` in that temporary copy. Preserve full sanitized output and cleanup evidence, without invoking workers or providers.
- [ ] Run affected producer/runner tests and verify the exact old-final migration prefix from trusted Git objects. Root publishes only the already-proved artifacts to the main worktree, merges manifest metadata without consuming the makeup draft, and commits owned artifacts/test/docs with safe index ownership. No generic exception or rewritten historical hash is allowed. Record new capture ID and hashes, historical proofs superseded, untested browser/production boundaries, then request independent review before resuming secondary Task4.
