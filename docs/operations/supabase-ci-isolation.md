# Supabase CI isolation

`supabase-db-push.yml` validates migrations on an ephemeral local database after
main updates. It no longer links to the hosted project, runs hosted pgTAP, pushes
production migrations, or reads production credentials. `workflow_dispatch`
uses the same isolated validation. Production schema changes require a separate
reviewed release procedure.

The main static job runs before database validation. PRs retain the required
`free-tier-guardrails`, `supabase-sql-review`, and `supabase-schema-contract`
checks. The main and PR database jobs use the same pinned Supabase CLI and run
the original 77 SQL suites and 12 DTO/concurrency probes, plus four regression
suites from the already-deployed past-state and timetable corrections.

Offline runner and transactional-builder cases remain in the static preflight.
The ten PostgreSQL fixture cases run as a mandatory, unskipped check after the
full schema validation in that same job. They reuse the pinned CLI's cached
`public.ecr.aws/supabase/postgres:17.6.1.159` image with `--pull=never`, rather
than making a second registry request on another runner. The fixture harness
requires all ten exact test names and ten actual passing TAP results, with no
skips, omissions or duplicate results. Each fixture uses `network none`, an
owned container label and checked cleanup; no repository SQL or assertion is
removed by the offline/runtime split.

The runner retains baseline catalog parity, smoke tests, local migration lint,
ACL/permission/domain assertions and the existing read-only postdeploy contract.
It additionally builds the registration and agent-calendar transactional
preflights from the actual local migration ledger and the verified forward SQL.
Both execute before forward application; the native ledger and transactional
schema fingerprint must match their preflight values after rollback. The same
forward bytes are then applied normally and the full selected suites execute.

Migration counts describe different evidence:

- The reviewed reduced dashboard baseline represents 215 historical versions.
- Seven shared English/worksheet history files remain exact-hash checked
  historical mirrors; this baseline does not replay their schemas.
- All 140 final forward migrations are hash checked and replayed locally.
- The local native ledger contains seven real test fixture migrations and 140
  forwards, totaling 147. It is never populated with a fabricated 362-row
  production ledger.

The database starts without repository SQL on a uniquely owned Docker internal
bridge. Ownership, exclusive attachment, disabled IPv6, localhost access and
absence of a default route are checked before staging the baseline. Internal
networks may expose an empty publication array or a concrete empty publication
object. Only these verified forms can use an owned localhost relay, after fresh
network/route checks and localhost database readiness. Missing or invalid maps
do not authorize a relay. Startup probes share the existing deadline and abort
signal; final boundary checks run again before repository SQL. The relay can
reach only the owned container's localhost through Docker exec. The DB
receives no Docker socket mount. Child processes inherit only PATH, locale and
disabled telemetry; probes receive only the checked local URL and a test nonce.
Cleanup stops the exact project without backups, closes owned relay sessions,
removes the owned network and removes its temporary directory. Cleanup failures
fail successful runs.

CI checks reject production secret references, linked commands, DB push, missing
or changed test inventories, mutable actions, missing verification flags and
error-ignoring paths. SQL immutability, quarantine and postdeploy predicates
remain independently enforced.

Git integration still triggers Vercel preview builds for branches and production
builds for main. This workflow change does not alter Vercel settings, application
permissions or deployed class data. A passing local/CI contract is separate
from production deployment and browser evidence.
