# Task 3 report — read-only Supabase resource evidence

## Scope

- Added a fixed nine-section resource evidence manifest with eight bounded database sections and the two experimental advisor GETs.
- Added a plan/execute collector that accepts only the reviewed Management API read-only query contract, redacts SQL and credentials from evidence, and requires explicit authority, environment-only credentials, a request ID, and a new absolute output path.
- Added bracketed capture timestamps, owner-only atomic evidence writes, and a conservative before/after comparator that returns `unknown` on interval, reset-marker, extension, project, or Postgres-version drift.
- Documented capture timing and comparison rules in the resource-pressure runbook.

## Verification

```text
tests/free-tier-operational-guardrails.test.mjs + tests/supabase-resource-evidence-comparator.test.mjs: 22/22 pass
scripts/collect-supabase-resource-evidence.mjs --mode plan: pass
node syntax checks: pass
git diff --check: pass
```

No read token was supplied and no execution capture was attempted. No production database, migration, cron, deployment, provider request, or recipient receipt was changed.

## Runtime boundary

An execute capture remains intentionally blocked until a reviewed `database_read` token and project ref are provided through the approved environment boundary. The collector will then use only POST `/v1/projects/{ref}/database/query/read-only` success status 201 and the two advisor GETs; failures write no evidence file.
