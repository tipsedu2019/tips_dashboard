# Supabase PR Review Gates Design

## Goal

Stop registration SQLSTATE and migration-safety regressions before merge without refactoring application or database business logic.

## Scope

- Preserve the already-applied `20260823074406_registration_workflow_stale_revision_nonretryable.sql` repair and its focused behavior assertion.
- Add a catalog-level pgTAP contract for the final active public wrapper and private implementation.
- Reuse the reviewed free-tier baseline to apply every post-baseline migration in an isolated local Supabase database.
- Compare the trusted PR merge-base manifest and SQL bytes with the exact head SHA so base-final migrations are immutable and only new manifest entries can be appended.
- Run `supabase db lint --local --fail-on error` and the two focused pgTAP files in pull requests.
- Run Squawk only on added or modified migration files, with rename detection disabled so a rename destination is treated as added.
- Add narrow Codex review instructions to `AGENTS.md`.
- Make the two PR jobs required on `main` after the workflow has run successfully.

## Non-goals

- No full or partial business-logic refactor.
- No production schema mutation beyond the migration already applied and verified.
- No provider activation, notification send, or customer-facing side effect.
- No upgrade of the existing production deployment workflow's Supabase CLI `2.107.0` pin.
- No SQLFluff, Semgrep, Atlas, or Codex Security installation for this incident.

## Design

The pull-request workflow has two deterministic jobs.

1. `supabase-sql-review` verifies the exact lowercase PR base/head SHAs against Git history, rejects any edit, deletion, rename, reorder, or byte drift in the merge-base's final migration prefix, runs the existing source contracts, and runs Squawk `2.63.0` against changed migration files only. The Squawk Linux binary is downloaded directly and verified with SHA-256 `532d217c9c1ff167bbc5d32efd4184285ab1bd1a69882cf66608d2bc5ed81a28`.
2. `supabase-schema-contract` downloads Supabase CLI `2.115.0`, verified with SHA-256 `ff099608ce758b625532ef03a61f4c9520b995e94ff6cd5480dc0428cad64cb3`. It starts an isolated local database from the reviewed baseline, applies the exact manifest-pinned post-baseline migrations, runs `db lint --fail-on error`, and executes the catalog and behavior pgTAP contracts.

The isolated runner reads the immutable baseline and catalog from the active capture. In PR review mode it reads the source-controlled top-level migration manifest, verifies the current manifest and migration bytes, and compares the trusted merge-base and head Git objects with argument-array execution. It fails closed when history is unavailable and never receives a production project reference, access token, or database password.

Codex automatic review is advisory. `AGENTS.md` tells it to inspect the final function after the ordered `CREATE OR REPLACE` chain, reject business-state errors labeled as retryable database collisions, and require exact pgTAP evidence. GitHub required checks remain the hard enforcement.

## Acceptance criteria

- A stale workflow revision returns the non-retryable code `23514` and the exact message `registration_workflow_status_refresh_required`.
- The final public RPC delegates to the expected private implementation.
- The final public and private function definitions contain no manually raised `40001`.
- Both exact functions are owned by `postgres`, have only a singleton empty `search_path`, and expose only direct non-grantable `EXECUTE` ACL rows for `postgres` and `authenticated`; PUBLIC, `anon`, and `service_role` cannot execute either function.
- The existing authentication, owner, security mode, grants, locking, idempotency, and no-send behavior remain unchanged.
- PR checks run without Supabase production secrets and always report a status, including PRs without SQL changes.
- Existing `supabase-db-push.yml` behavior and CLI version remain unchanged.
