# Task 4 report — reversible dashboard audit diffs

## Source implementation

- Created the forward-only candidate migration `20260814115116_dashboard_audit_diff_format.sql` with constant/null additive audit columns, a v2 partial covering predecessor index, an internal sequence, private forward/reverse patch helpers, and an entity advisory-lock chain trigger.
- Replaced all seven named dashboard audit triggers with the private v2 trigger. INSERT/DELETE use `full_v2`; UPDATE uses `diff_v2`, including an empty no-op patch.
- Added owner/ACL/RLS source boundaries for the dedicated non-login audit writer and removed the direct authenticated audit INSERT policy.
- Added source contracts for migration shape, candidate-byte manifest binding, helper privacy, and fail-closed concurrency probe configuration. Added the pgTAP fixture for its later reviewed-baseline run.

## Verification

```text
source tests: 15/15 pass
minimal local PostgreSQL 17 migration parse/apply: reached v2 trigger invocation
isolated harness: isolated_supabase_db_baseline_review_required before allocation
```

The minimal local fixture intentionally did not reproduce the full Supabase `auth.jwt()` contract, so its trigger invocation stopped at that missing fixture function; the production migration already depends on the same `auth.jwt()` contract used by the prior audit trigger. This is not claimed as a full-schema pgTAP result.

## Runtime boundary

The manifest is `candidate` with SHA-256 `0c453beba2492d2d85fc4a7b9d8e709f40833e42f384c77c453146b59773e0f5`. The approved isolated harness cannot start until a reviewed baseline pointer exists, so pgTAP, two-client concurrency, EXPLAIN, and final promotion remain unrun. No production database, migration application, cron, deployment, provider request, or recipient receipt was changed.
