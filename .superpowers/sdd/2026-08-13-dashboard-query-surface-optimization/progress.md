# SDD ledger — plan: docs/superpowers/plans/2026-08-13-dashboard-query-surface-optimization.md

Execution branch: codex/dashboard-free-tier-optimization
Base: fad56ae59f6b5ec6999e3232bbe68e4c1d26b101
Prior plan commits: 7e364c1b..c820e853

Task 1: `a7813801` established the query-surface budget verifier and cursor contracts.
Task 1 fix round 1: enforce manifest-listed symbols, resolve local query constants, and validate decoded cursor scopes.
Task 1 fix round 2: fail closed for opaque list projection, limit, RPC, and computed query-entry expressions while preserving statically resolved bounded queries.
Task 1 fix round 3: compare exact debt occurrences, inspect no-limit and optional computed query entrypoints, and reject ambiguous canonical cursor-scope inputs.
Task 1 fix round 4: enforce contracts per direct query chain, bind each baseline-debt exception to an exact recorded-SHA fingerprint, retain only explicit single/range list exemptions, and reject mixed/whitespace wildcard projections.
Task 1 fix round 5: replace regex extraction with TypeScript AST receiver/alias analysis, compare changed legacy files against exact caller-baseline deltas, refresh baseline fingerprints, and preserve nested PostgREST projections.
Task 1 fix round 6: make the exact debt manifest the sole allowance for touched query chains, add structural timeout/order/exact-detail contracts, and reject recursive nested projection wildcards without broadening the legacy ledger.
