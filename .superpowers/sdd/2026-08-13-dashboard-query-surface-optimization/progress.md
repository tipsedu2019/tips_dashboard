# SDD ledger — plan: docs/superpowers/plans/2026-08-13-dashboard-query-surface-optimization.md

Execution branch: codex/dashboard-free-tier-optimization
Base: fad56ae59f6b5ec6999e3232bbe68e4c1d26b101
Prior plan commits: 7e364c1b..c820e853

Task 1: complete (commits a7813801..ff97d7e8; adversarial review fix rounds 1-11 complete; focused 59/59, CI/worktree verifier, ESLint, and diff check green)

Task 1: `a7813801` established the query-surface budget verifier and cursor contracts.
Task 1 fix round 1: enforce manifest-listed symbols, resolve local query constants, and validate decoded cursor scopes.
Task 1 fix round 2: fail closed for opaque list projection, limit, RPC, and computed query-entry expressions while preserving statically resolved bounded queries.
Task 1 fix round 3: compare exact debt occurrences, inspect no-limit and optional computed query entrypoints, and reject ambiguous canonical cursor-scope inputs.
Task 1 fix round 4: enforce contracts per direct query chain, bind each baseline-debt exception to an exact recorded-SHA fingerprint, retain only explicit single/range list exemptions, and reject mixed/whitespace wildcard projections.
Task 1 fix round 5: replace regex extraction with TypeScript AST receiver/alias analysis, compare changed legacy files against exact caller-baseline deltas, refresh baseline fingerprints, and preserve nested PostgREST projections.
Task 1 fix round 6: make the exact debt manifest the sole allowance for touched query chains, add structural timeout/order/exact-detail contracts, and reject recursive nested projection wildcards without broadening the legacy ledger.
Task 1 fix round 7: recheck all chains in deletion- or dependency-affected functions, bind manifest debt to both historical and caller baselines, enforce root-only deterministic list controls, and use effective final abort/retry settings.
Task 1 fix round 8: fail closed for uncertain relation options and local values, model shared Supabase builders as immutable request branches, reject RPC spreads and arbitrary task-ID fan-out, and tighten detail-key validity.
Task 1 fix round 9: propagate conditional builder provenance, resolve constants/options at their lexical use site with object-mutation tracking, inspect bound Supabase methods, and prohibit all task-ID `.in` fan-out.
Task 1 fix round 10: connect direct builder aliases and transitive bound query aliases to the same request graph, inspect bound builder operations, and fail closed for resolved or unknown tasks `.in` columns.
Task 1 fix round 11: propagate immutable aliases of bound builder operations, so task-ID `.in` remains visible through `filter -> run` assignments.

Task 2: source-complete / DB-runtime-blocked. Added 30+1 keyset task pages, separate same-filter stats, compact subtype rows, exact selected-detail reads, append/deep-link workspace behavior, and the tasks query-guard regression. Focused source suites are 418/418 GREEN; TypeScript, tasks query guard, local schema lint, candidate hash, and diff check are GREEN. The isolated harness stopped before allocation with `isolated_supabase_db_baseline_review_required`, so the migration remains candidate and no pgTAP/EXPLAIN runtime GREEN is claimed. See `task-2-report.md`.

Task 2 adversarial fix round 1: reviewer findings are source-complete. Non-registration catalogs are lazy on editor/filter open; registration membership/search/owner/order use matching subject-track summaries; paged UI uses authoritative sibling stats/facets; membership/order-changing mutations refetch active-filter page one with stale append protection; task-only off-page registration links open canonical case detail. RED was 135 pass / 6 fail; final focused suites are 424/424 GREEN, exact service/workspace is 141/141 GREEN, TypeScript/query guard/diff checks pass, and candidate hash is `f4efe37189ad885a10d54dc4a979db6f92c62545f6969ab4d98be2b637b54a87`. DB runtime remains reviewed-baseline blocked and unclaimed.

Task 2 adversarial fix round 2: page-one replacement now preserves loaded non-registration catalogs; create and management withdrawal handoff await catalogs before defaults/prefill; continuation pages skip stats RPC and preserve first-page stats; registration subject search is constrained to the selected workflow/owner; general assignee facets include secondary assignments and word-retest manual names have exact filter values. RED was 141 pass / 6 fail; exact service/workspace is 147/147 and five-suite focused is 430/430 GREEN. TypeScript/query guard/ESLint/local schema lint/diff checks pass. Candidate hash is `afa89fe970b5c367f05e67e5b76e38dafa96a7f233001fce019db940cb7082a1`; isolated DB remains reviewed-baseline blocked and runtime pgTAP/EXPLAIN is unclaimed.

Task 3: source-complete / DB-runtime-blocked. Added 30+1 Korean-numeric keyset management pages, same-filter authoritative stats and faceted options, exact selected details, bounded opaque-cursor relations, selection-driven catalog/picker reads, canonical URL filters, append/dedupe/deep-link UI, and management query-guard coverage. Focused source suites are 118/118 and the full management glob is 126/126 GREEN; TypeScript, management query guard, ESLint, local schema lint, candidate hash, and diff checks pass. Candidate SHA-256 is `a0609d3e4299a347fe25067bfd5674a7b38b49b192b9936fd1ecb437b41d12a1`. The isolated harness stopped before allocation with `isolated_supabase_db_baseline_review_required`, so the manifest remains candidate and no pgTAP/EXPLAIN runtime GREEN is claimed. See `task-3-report.md`.
