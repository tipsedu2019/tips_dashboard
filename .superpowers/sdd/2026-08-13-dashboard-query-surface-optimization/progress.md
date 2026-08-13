# SDD ledger — plan: docs/superpowers/plans/2026-08-13-dashboard-query-surface-optimization.md

Execution branch: codex/dashboard-free-tier-optimization
Base: fad56ae59f6b5ec6999e3232bbe68e4c1d26b101
Prior plan commits: 7e364c1b..c820e853

Task 1: `a7813801` established the query-surface budget verifier and cursor contracts.
Task 1 fix round 1: enforce manifest-listed symbols, resolve local query constants, and validate decoded cursor scopes.
Task 1 fix round 2: fail closed for opaque list projection, limit, RPC, and computed query-entry expressions while preserving statically resolved bounded queries.
Task 1 fix round 3: compare exact debt occurrences, inspect no-limit and optional computed query entrypoints, and reject ambiguous canonical cursor-scope inputs.
