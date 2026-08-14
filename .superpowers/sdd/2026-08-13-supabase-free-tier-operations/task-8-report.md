# Task 8 report — reviewed baseline and isolated runtime finalization

## Production read-only evidence

The user authorized direct use of the logged-in Supabase project `slnjqlzzhewblvttiidk`. One catalog query ran inside `begin read only ... rollback`; it read schema metadata and the migration ledger only, never application rows. The reviewed response identifies PostgreSQL 17 and 194 migration-ledger rows. Canonical artifacts were normalized, hashed, published as immutable capture `7203dec3049b97a8`, and activated atomically.

## Isolated runtime evidence

All nine manifest migrations replayed successfully against the reviewed baseline in isolated PostgreSQL 17. Every migration-owned pgTAP suite passed. Task, management, operations, and academic page contracts also executed real first-page, continuation, and exact-detail `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` assertions plus bounded response-size checks. The audit probe proved concurrent same-entity updates form one ordered chain and a rolled-back update leaves the expected sequence gap. The runner now recomputes the immutable capture ID from all four artifacts, exposes a final-only lifecycle gate, and stages only the exact buffers verified before local runtime allocation. Its mutation regression changes the source baseline, parity, migration, smoke test, and probe after validation and proves the staged bytes remain unchanged. Final request `browser-approved-isolated-final-r95` used those gates and returned `status: passed`.

## Source verification

The focused source/runtime suite passed **186/186**. The capture/harness subset passed **46/46** after review hardening. TypeScript, the all-surface query guard, and `git diff --check` passed. All nine manifest entries are `final`, and each stored SHA-256 matches the exact migration bytes. The capture/harness tests now cover immutable publication and mutation rejection, final lifecycle state, full migration-ledger replay, safe data-statement omission, schema reconciliation, and probe isolation.

## Boundary

This finalizes source and isolated-runtime evidence only. No production migration was applied, no `main` push or Vercel deployment occurred, no cron/worker was activated, and no provider request or recipient delivery occurred. The user-owned untracked `pnpm-workspace.yaml` remains untouched.
